"""NLA fork: authorized physical SQL planning without database execution.

Project-owned extension of the supplied SDK. Java supplies a dataset-scoped
manifest; this module binds physical identifiers, verifies native resolution and
checks physical lineage again after the SDK rewrite. It never discovers a
catalog, creates a connector, or receives database credentials.
"""

from __future__ import annotations

import base64
import json
import re
from contextlib import AbstractContextManager
from copy import deepcopy
from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable

import sqlglot
import wren_core
from sqlglot import exp
from sqlglot.optimizer.qualify import qualify
from sqlglot.optimizer.scope import traverse_scope
from sqlglot.schema import MappingSchema
from wren.config import WrenConfig
from wren.nla_compaction import compact_generated_models
from wren.type_mapping import parse_type

if TYPE_CHECKING:
    from wren.engine import WrenEngine


@dataclass(frozen=True)
class DatasetPlan:
    sql: str
    source_models: tuple[str, ...]
    source_tables: tuple[tuple[str, str], ...]


class DatasetPlanningError(Exception):
    """Safe application reason code; raw SDK errors stay inside the service."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


TYPE_ALIASES = {
    "bigint": "bigint",
    "smallint": "integer",
    "tinyint": "integer",
    "int": "integer",
    "integer": "integer",
    "serial": "integer",
    "bigserial": "bigint",
    "numeric": "decimal",
    "decimal": "decimal",
    "real": "float",
    "float": "float",
    "double": "float",
    "boolean": "boolean",
    "bool": "boolean",
    "bit": "boolean",
    "date": "date",
    "time": "time",
    "timestamp": "timestamp",
    "datetime": "timestamp",
    "datetime2": "timestamp",
    "char": "varchar",
    "nchar": "varchar",
    "varchar": "varchar",
    "nvarchar": "varchar",
    "text": "varchar",
    "tinytext": "varchar",
    "mediumtext": "varchar",
    "longtext": "varchar",
    "string": "varchar",
    "uuid": "varchar",
    "json": "varchar",
    "jsonb": "varchar",
    "binary": "binary",
    "varbinary": "binary",
    "blob": "binary",
    "bytea": "binary",
}

DIALECTS = {"postgres": "postgres", "mysql": "mysql", "mssql": "tsql"}
MAX_SQL_BYTES = 100_000


def _parse_read(sql: str, dialect: str) -> exp.Expression:
    if not sql or len(sql.encode("utf-8")) > MAX_SQL_BYTES:
        raise DatasetPlanningError("SQL_VALIDATION_ERROR")
    try:
        statements = sqlglot.parse(sql, read=dialect, error_level="RAISE")
    except sqlglot.errors.ParseError as error:
        raise DatasetPlanningError("SQL_VALIDATION_ERROR") from error
    if len(statements) != 1 or not isinstance(statements[0], exp.Query):
        raise DatasetPlanningError("SQL_VALIDATION_ERROR")
    ast = statements[0]
    # SELECT INTO and writable CTEs can still have a SELECT root. Reject them
    # before any native planning, independently of Java's execution guard.
    forbidden = (
        exp.Insert,
        exp.Update,
        exp.Delete,
        exp.Create,
        exp.Drop,
        exp.Alter,
        exp.Merge,
        exp.Command,
        exp.Into,
        exp.Copy,
        exp.Transaction,
        exp.Lock,
    )
    if any(isinstance(node, forbidden) for node in ast.walk()):
        raise DatasetPlanningError("SQL_VALIDATION_ERROR")
    return ast


def _model_map(manifest: dict) -> dict[tuple[str, str], dict]:
    by_table = {}
    names = set()
    for model in manifest["models"]:
        name = model["name"]
        physical = model["tableReference"]
        key = (physical["schema"], physical["table"])
        if (
            name.casefold() in names
            or key in by_table
            or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$#]{0,255}", name)
        ):
            raise DatasetPlanningError("SEMANTIC_MODEL_INVALID")
        columns = [column["name"] for column in model["columns"]]
        if len(columns) != len(set(columns)) or not columns:
            raise DatasetPlanningError("SEMANTIC_MODEL_INVALID")
        if model.get("primaryKey") and model["primaryKey"] not in columns:
            raise DatasetPlanningError("SEMANTIC_MODEL_INVALID")
        names.add(name.casefold())
        by_table[key] = model
    for relationship in manifest.get("relationships", []):
        if any(name.casefold() not in names for name in relationship["models"]):
            raise DatasetPlanningError("SEMANTIC_MODEL_INVALID")
    if not by_table:
        raise DatasetPlanningError("INSUFFICIENT_CONTEXT")
    return by_table


def _bind_physical(ast: exp.Expression, dialect: str, models: dict) -> list[dict]:
    found = {}
    for scope in traverse_scope(ast):
        for _, (_, table) in scope.selected_sources.items():
            if not isinstance(table, exp.Table):
                continue
            if table.catalog:
                raise DatasetPlanningError("SQL_VALIDATION_ERROR")
            name, schema = table.name, table.db
            if dialect == "postgres":
                if not table.this.args.get("quoted"):
                    name = name.lower()
                if schema and not table.args["db"].args.get("quoted"):
                    schema = schema.lower()
            candidates = [
                model
                for (physical_schema, physical_name), model in models.items()
                if physical_name == name and (not schema or physical_schema == schema)
            ]
            if not candidates and dialect == "tsql":
                candidates = [
                    model
                    for (physical_schema, physical_name), model in models.items()
                    if physical_name.casefold() == name.casefold()
                    and (not schema or physical_schema.casefold() == schema.casefold())
                ]
            if len(candidates) != 1:
                raise DatasetPlanningError("INSUFFICIENT_CONTEXT")
            model = candidates[0]
            if not table.alias:
                table.set("alias", exp.TableAlias(this=table.this.copy()))
            table.set("this", exp.to_identifier(model["name"], quoted=True))
            table.set("db", None)
            table.set("catalog", None)
            found[model["name"].casefold()] = model
    if not found:
        raise DatasetPlanningError("INSUFFICIENT_CONTEXT")
    return list(found.values())


def _canonicalize_sql_server_columns(ast, models):
    """Return planner-normalized references to exact authorized physical spelling.

    Keep the Java guard case-sensitive: a TSQL normalization choice must not
    require broadening its allowlist matching for every SQL Server resource.
    Derived/CTE references similarly bind to their actual projection labels.
    """
    for scope in traverse_scope(ast):
        outputs = {
            projection.alias_or_name.casefold(): projection.alias_or_name
            for projection in scope.expression.selects
            if projection.alias_or_name
        }
        for column in scope.columns:
            if column.is_star:
                continue
            if not column.table:
                target = outputs.get(column.name.casefold())
                if target:
                    column.set("this", exp.to_identifier(target, quoted=True))
                continue
            source = scope.sources.get(column.table)
            names = []
            if isinstance(source, exp.Table):
                candidates = [
                    model
                    for (namespace, table), model in models.items()
                    if table.casefold() == source.name.casefold()
                    and (not source.db or namespace.casefold() == source.db.casefold())
                ]
                if len(candidates) == 1:
                    names = [field["name"] for field in candidates[0]["columns"]]
            elif source is not None:
                names = source.expression.named_selects
            matches = [name for name in names if name.casefold() == column.name.casefold()]
            if len(matches) == 1:
                column.set("this", exp.to_identifier(matches[0], quoted=True))
    return ast


def _qualify_physical(ast, dialect, models):
    schema = {}
    for (namespace, table), model in models.items():
        schema.setdefault(namespace, {})[table] = {
            column["name"]: "UNKNOWN" for column in model["columns"]
        }
    for scope in traverse_scope(ast):
        for reference, source in scope.selected_sources.values():
            if isinstance(source, exp.Table) and not reference.alias:
                reference.set("alias", exp.TableAlias(this=reference.this.copy()))
    original = [
        (
            scope.expression,
            [projection.copy() for projection in scope.expression.expressions],
            list(scope.outer_columns),
        )
        for scope in traverse_scope(ast)
        if isinstance(scope.expression, exp.Select)
    ]
    try:
        result = qualify(
            ast,
            dialect=dialect,
            schema=MappingSchema(schema, dialect=dialect, normalize=dialect != "postgres"),
            infer_schema=False,
            expand_stars=False,
            allow_partial_qualification=False,
            validate_qualify_columns=True,
        )
    except sqlglot.errors.OptimizeError as error:
        raise DatasetPlanningError("SQL_VALIDATION_ERROR") from error
    # Qualification needs output aliases internally, but inventing _col_0 for a
    # caller's unaliased aggregate would change its result-column contract.
    for select, projections, outer_columns in original:
        if len(select.expressions) != len(projections):
            continue
        for position, (before, after) in enumerate(zip(projections, list(select.expressions))):
            if not isinstance(after, exp.Alias):
                continue
            if position < len(outer_columns):
                # SQLGlot pushes explicit WITH q(x)/derived AS q(x) names into
                # projections and removes the outer list. These names override
                # the inner aliases and must not be restored to physical names.
                after.set("alias", exp.to_identifier(outer_columns[position], quoted=True))
            elif isinstance(before, exp.Alias):
                after.set("alias", before.args["alias"].copy())
            elif isinstance(before, exp.Column):
                label = before.name
                if dialect == "tsql":
                    actual_names = {
                        column["name"]
                        for model in models.values()
                        for column in model["columns"]
                        if column["name"].casefold() == label.casefold()
                    }
                    if len(actual_names) == 1:
                        label = actual_names.pop()
                after.set("alias", exp.to_identifier(label, quoted=True))
            else:
                after.replace(after.this)
    if dialect == "tsql":
        _canonicalize_sql_server_columns(result, models)
    return result


def _sources(models: list[dict]) -> tuple[tuple[str, str], ...]:
    return tuple(
        (model["tableReference"]["schema"], model["tableReference"]["table"]) for model in models
    )


def plan_for_dataset(
    engine_type: type[WrenEngine],
    sql: str,
    manifest: dict,
    data_source: str,
    session_lease: Callable[[str, str], AbstractContextManager],
) -> DatasetPlan:
    """Use the real SDK pipeline with the app's authorized dataset boundary."""
    try:
        if manifest.get("dataSource") != data_source or data_source not in DIALECTS:
            raise DatasetPlanningError("SQL_DIALECT_ERROR")
        dialect = DIALECTS[data_source]
        # Native normalization must not mutate the caller's immutable manifest.
        normalized = deepcopy(manifest)
        models = _model_map(normalized)
        ast = _parse_read(sql, dialect)
        protected_ctes = {cte.alias_or_name for cte in ast.find_all(exp.CTE)}
        # Resolve physical sources before column qualification so unknown/ambiguous
        # tables preserve the established fail-closed reason code.
        _bind_physical(ast.copy(), dialect, models)
        ast = _qualify_physical(ast, dialect, models)
        used_models = _bind_physical(ast, dialect, models)
        expected_names = {model["name"].casefold() for model in used_models}
        for model in normalized["models"]:
            for column in model["columns"]:
                scalar = TYPE_ALIASES.get(column["type"].casefold())
                if scalar is None:
                    parsed = parse_type(column["type"], dialect)
                    scalar = TYPE_ALIASES.get(parsed.split("(", 1)[0].strip().casefold())
                if scalar is None:
                    raise DatasetPlanningError("SEMANTIC_MODEL_INVALID")
                column["type"] = scalar
        encoded = base64.b64encode(
            json.dumps(normalized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ).decode("ascii")
        resolved = wren_core.ManifestExtractor(encoded).resolve_used_table_names(ast.sql())
        if not resolved or {name.casefold() for name in resolved} != expected_names:
            raise DatasetPlanningError("SEMANTIC_MODEL_INVALID")
        with session_lease(encoded, data_source) as session:
            with engine_type(
                manifest_str=encoded,
                data_source=data_source,
                connection_info={},
                fallback=False,
                config=WrenConfig(strict_mode=True),
                session_context_override=session,
                planning_only=True,
            ) as engine:
                rewritten = engine.dry_plan(ast.sql(dialect=dialect))
        # Independently resolve physical sources from the generated AST, rather
        # than trusting the lineage selected before rewrite. A rewritten query
        # cannot silently switch to another table even inside the same dataset.
        actual_sources = _sources(_bind_physical(_parse_read(rewritten, dialect), dialect, models))
        expected_sources = _sources(used_models)
        if set(actual_sources) != set(expected_sources):
            raise DatasetPlanningError("SQL_VALIDATION_ERROR")
        compacted = compact_generated_models(
            _parse_read(rewritten, dialect),
            [model["name"] for model in normalized["models"]],
            protected_ctes,
            case_sensitive=dialect != "tsql",
        ).sql(dialect=dialect)
        compacted_sources = _sources(
            _bind_physical(_parse_read(compacted, dialect), dialect, models)
        )
        if set(compacted_sources) != set(expected_sources):
            raise DatasetPlanningError("SQL_VALIDATION_ERROR")
        return DatasetPlan(
            sql=compacted,
            source_models=tuple(model["name"] for model in used_models),
            source_tables=expected_sources,
        )
    except DatasetPlanningError:
        raise
    except (KeyError, ValueError, RuntimeError, TypeError) as error:
        raise DatasetPlanningError("SEMANTIC_MODEL_INVALID") from error
    except Exception as error:
        raise DatasetPlanningError("SQL_VALIDATION_ERROR") from error
