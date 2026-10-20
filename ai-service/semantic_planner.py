"""Build Wren manifests and plan SQL using the native semantic engine."""

from __future__ import annotations

import base64
import json
import re
from typing import Any, Literal

import sqlglot
import wren_core
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlglot import exp
from sqlglot.optimizer.scope import traverse_scope

from third_party.wren_semantic.cte_rewriter import CTERewriter
from third_party.wren_semantic.session_context import session_context


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, validate_by_name=True)


class PhysicalTable(StrictModel):
    schema_: str = Field(alias="schema", min_length=1, max_length=256)
    table: str = Field(min_length=1, max_length=256)


class ManifestColumn(StrictModel):
    name: str = Field(min_length=1, max_length=256)
    type: str = Field(min_length=1, max_length=100)


class ManifestModel(StrictModel):
    name: str = Field(min_length=1, max_length=256)
    tableReference: PhysicalTable
    columns: list[ManifestColumn] = Field(min_length=1, max_length=1000)
    primaryKey: str | None = Field(default=None, max_length=256)


JoinType = Literal["ONE_TO_ONE", "MANY_TO_ONE", "ONE_TO_MANY", "MANY_TO_MANY"]


class ManifestRelationship(StrictModel):
    name: str = Field(min_length=1, max_length=512)
    models: list[str] = Field(min_length=2, max_length=2)
    joinType: JoinType
    condition: str = Field(min_length=1, max_length=2000)


class Manifest(StrictModel):
    catalog: Literal["nla"]
    schema_: Literal["semantic"] = Field(alias="schema")
    dataSource: Literal["postgres", "mysql", "mssql"]
    models: list[ManifestModel] = Field(min_length=1, max_length=1000)
    relationships: list[ManifestRelationship] = Field(max_length=5000)


class PlanRequest(StrictModel):
    correlationId: str = Field(min_length=1, max_length=100)
    sqlDialect: Literal["POSTGRESQL", "MYSQL", "SQL_SERVER"]
    sql: str = Field(min_length=1, max_length=100000)
    manifest: Manifest


class SourceTable(StrictModel):
    schema_: str = Field(alias="schema")
    name: str


class PlanResponse(StrictModel):
    sql: str
    sourceModels: list[str]
    sourceTables: list[SourceTable]
    plannerVersion: Literal["wren-core-py/0.4.0"]


DIALECTS = {
    "POSTGRESQL": ("postgres", "postgres"),
    "MYSQL": ("mysql", "mysql"),
    "SQL_SERVER": ("mssql", "tsql"),
}


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


class PlanningFailure(Exception):
    def __init__(self, code: str):
        self.code = code


def _canonical_identifier(value: str) -> str:
    return value.casefold()


def _parse_select(sql: str, dialect: str) -> exp.Expression:
    try:
        parsed = sqlglot.parse(sql, read=dialect, error_level="RAISE")
    except sqlglot.errors.ParseError as error:
        raise PlanningFailure("SQL_VALIDATION_ERROR") from error
    if len(parsed) != 1 or not isinstance(parsed[0], exp.Query):
        raise PlanningFailure("SQL_VALIDATION_ERROR")
    return parsed[0]


def _model_map(manifest: Manifest) -> dict[tuple[str, str], ManifestModel]:
    models_by_name: dict[str, ManifestModel] = {}
    models_by_table: dict[tuple[str, str], ManifestModel] = {}
    for model in manifest.models:
        name_key = _canonical_identifier(model.name)
        physical_key = (
            model.tableReference.schema_,
            model.tableReference.table,
        )
        if name_key in models_by_name or physical_key in models_by_table:
            raise PlanningFailure("SEMANTIC_MODEL_INVALID")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$#]{0,255}", model.name):
            raise PlanningFailure("SEMANTIC_MODEL_INVALID")
        columns = [column.name for column in model.columns]
        if len(columns) != len(set(columns)):
            raise PlanningFailure("SEMANTIC_MODEL_INVALID")
        models_by_name[name_key] = model
        models_by_table[physical_key] = model
    for relationship in manifest.relationships:
        if any(_canonical_identifier(name) not in models_by_name for name in relationship.models):
            raise PlanningFailure("SEMANTIC_MODEL_INVALID")
    return models_by_table


def _logical_model_references(
    ast: exp.Expression,
    dialect: str,
    models: dict[tuple[str, str], ManifestModel],
) -> list[ManifestModel]:
    # Use resolved scopes: a qualified physical table may share a name with a CTE.
    sources = []
    for scope in traverse_scope(ast):
        for _, (_, source) in scope.selected_sources.items():
            if isinstance(source, exp.Table):
                sources.append(source)
    found: dict[str, ManifestModel] = {}
    for table in sources:
        raw_name = table.name
        if table.catalog:
            raise PlanningFailure("SQL_VALIDATION_ERROR")
        raw_schema = table.db
        lookup_name = raw_name
        lookup_schema = raw_schema
        if dialect == "postgres":
            if not table.this.args.get("quoted"):
                lookup_name = lookup_name.lower()
            if raw_schema and not table.args["db"].args.get("quoted"):
                lookup_schema = lookup_schema.lower()
        candidates = [
            model
            for (schema, name), model in models.items()
            if name == lookup_name and (not raw_schema or schema == lookup_schema)
        ]
        if not candidates and dialect == "tsql":
            candidates = [
                model
                for (schema, name), model in models.items()
                if name.casefold() == raw_name.casefold()
                and (not raw_schema or schema.casefold() == raw_schema.casefold())
            ]
        if len(candidates) != 1:
            raise PlanningFailure("INSUFFICIENT_CONTEXT")
        model = candidates[0]
        # Keep the physical qualifier valid when the original SQL has no alias.
        # Replacing the table name alone would leave Album.Title unresolved.
        if not table.alias:
            table.set("alias", exp.TableAlias(this=table.this.copy()))
        table.set("this", exp.to_identifier(model.name, quoted=True))
        table.set("db", None)
        table.set("catalog", None)
        found[_canonical_identifier(model.name)] = model
    if not found:
        raise PlanningFailure("INSUFFICIENT_CONTEXT")
    return list(found.values())


def _validate_manifest_relations(manifest: Manifest) -> None:
    names = {_canonical_identifier(model.name) for model in manifest.models}
    if len(names) != len(manifest.models):
        raise PlanningFailure("SEMANTIC_MODEL_INVALID")


def plan_sql(request: PlanRequest) -> PlanResponse:
    data_source, sqlglot_dialect = DIALECTS[request.sqlDialect]
    if request.manifest.dataSource != data_source:
        raise PlanningFailure("SQL_DIALECT_ERROR")
    _validate_manifest_relations(request.manifest)
    models = _model_map(request.manifest)
    original_ast = _parse_select(request.sql, sqlglot_dialect)
    logical_models = _logical_model_references(original_ast, sqlglot_dialect, models)
    source_model_names = [model.name for model in logical_models]

    wren_manifest = request.manifest.model_dump(by_alias=True)
    for model in wren_manifest["models"]:
        for column in model["columns"]:
            normalized_type = TYPE_ALIASES.get(column["type"].casefold())
            if normalized_type is None:
                raise PlanningFailure("SEMANTIC_MODEL_INVALID")
            column["type"] = normalized_type
    manifest_bytes = json.dumps(
        wren_manifest,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    manifest_b64 = base64.b64encode(manifest_bytes).decode("ascii")
    try:
        extractor = wren_core.ManifestExtractor(manifest_b64)
        resolved_models = extractor.resolve_used_table_names(original_ast.sql())
        if not resolved_models:
            raise PlanningFailure("INSUFFICIENT_CONTEXT")
        if {_canonical_identifier(name) for name in resolved_models} != {
            _canonical_identifier(name) for name in source_model_names
        }:
            raise PlanningFailure("SEMANTIC_MODEL_INVALID")
        with session_context(manifest_b64, data_source) as session:
            rewriter = CTERewriter(
                manifest_b64,
                session,
                data_source,
                fallback=False,
            )
            rewritten = rewriter.rewrite(original_ast.sql(dialect=sqlglot_dialect))
        _parse_select(rewritten, sqlglot_dialect)
    except PlanningFailure:
        raise
    except (ValueError, RuntimeError, TypeError, ValidationError) as error:
        raise PlanningFailure("SEMANTIC_MODEL_INVALID") from error
    except Exception as error:
        raise PlanningFailure("SQL_VALIDATION_ERROR") from error

    source_tables = [
        SourceTable(
            schema_=model.tableReference.schema_,
            name=model.tableReference.table,
        )
        for model in logical_models
    ]
    if len(rewritten.encode("utf-8")) > 100000:
        raise PlanningFailure("SQL_VALIDATION_ERROR")
    return PlanResponse(
        sql=rewritten,
        sourceModels=source_model_names,
        sourceTables=source_tables,
        plannerVersion="wren-core-py/0.4.0",
    )
