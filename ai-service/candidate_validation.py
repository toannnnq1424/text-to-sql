"""Validate aggregate scope semantics without rewriting model SQL or executing it."""

import json
import re

import sqlglot
from sqlglot import exp
from sqlglot.optimizer.qualify import qualify
from sqlglot.optimizer.scope import traverse_scope
from sqlglot.schema import MappingSchema

from context_index import normalize_text
from schema_relevance import AmbiguousTableReference, table_mentions

DIALECTS = {"POSTGRESQL": "postgres", "MYSQL": "mysql", "SQL_SERVER": "tsql"}
NUMERIC_TYPES = {
    "DECIMAL",
    "DOUBLE",
    "DOUBLE PRECISION",
    "FLOAT",
    "INTEGER",
    "BIGINT",
    "MONEY",
    "NUMERIC",
    "NUMBER",
    "REAL",
    "SMALLINT",
    "TINYINT",
}
AGGREGATE_INTENTS = {
    "SUM": ("sum", "total", "tong", "cong"),
    "AVG": ("average", "avg", "mean", "trung binh", "binh quan"),
}
TEMPORAL_TYPES = {
    "DATE",
    "DATETIME",
    "DATETIME2",
    "DATETIMEOFFSET",
    "TIMESTAMP",
    "TIMESTAMP WITH TIME ZONE",
    "TIMESTAMPTZ",
}


class InvalidAggregation(Exception):
    """Safe model-correction diagnostic; no provider/native exception is exposed."""

    diagnostic = (
        "The SQL result grain is inconsistent with its grouped expressions or chart columns. "
        "Every chart x/series reference must occur in the SELECT result. "
        "An aggregate query selects or orders a nonaggregated expression that is not "
        "determined by its GROUP BY expressions. Reconsider the requested result grain. "
        "Return a complete corrected candidate using only the same authorized context. "
        "Do not add grouping blindly or change the user's question."
    )

    def __init__(self, *, outputs=None, missing=None, requested_key=None, requested_measure=None):
        if requested_measure is not None:
            function, column = requested_measure
            self.diagnostic = (
                "The question explicitly requests "
                + function
                + " of the authorized physical column "
                + json.dumps(column, ensure_ascii=False)
                + ". The candidate does not aggregate that column with the requested function. "
                "Correct the candidate while preserving the requested date/grouping grain; "
                "do not replace the measure with COUNT or another column. Return the complete "
                "corrected candidate JSON."
            )
        if requested_key is not None:
            self.diagnostic = (
                "The question explicitly requests the authorized primary key "
                + json.dumps(requested_key, ensure_ascii=False)
                + " for breaking ties. Preserve entity identity by grouping by that key "
                "as well as its displayed name, and include the requested key in ORDER BY "
                "after the aggregate rank with the requested direction. Different entities "
                "can have the same display name. Do not merge them, add output columns or "
                "change the question. Return the complete corrected candidate JSON."
            )
        if outputs is not None:
            self.diagnostic = (
                "The candidate chart references result columns that the SQL does not return. "
                "Actual selected output names: "
                + json.dumps(outputs, ensure_ascii=False)
                + ". Missing chart references: "
                + json.dumps(missing, ensure_ascii=False)
                + ". Correct the SQL aliases or chart x/series names so they refer to the same "
                "actual result, preserving the question and grouping grain. Do not keep the "
                "mismatched chart references. Return the complete candidate JSON."
            )
        super().__init__(self.diagnostic)


def explicit_physical_aggregate_intent(question, context, *, require_table=False):
    """Resolve an explicitly named physical aggregate without business semantics."""
    normalized_question = " " + normalize_text(question) + " "
    functions = [
        function
        for function, cues in AGGREGATE_INTENTS.items()
        if any(" " + normalize_text(cue) + " " in normalized_question for cue in cues)
    ]
    if len(functions) != 1:
        return None

    tables = context.get("tables", [])
    selected_positions = set(range(len(tables)))
    if require_table:
        try:
            mentions = table_mentions(question, tables, allow_fuzzy=False)
        except AmbiguousTableReference:
            return None
        if len(mentions.positions) != 1:
            return None
        selected_positions = set(mentions.positions)

    numeric_columns = set()
    for position in selected_positions:
        table = tables[position]
        if table.get("queryable") is False:
            continue
        for column in table.get("columns", []):
            if column.get("dataType", "").upper() not in NUMERIC_TYPES:
                continue
            for name in [column.get("name", ""), *column.get("synonyms", [])]:
                normalized_name = normalize_text(name)
                if len(normalized_name.replace(" ", "")) < 4:
                    continue
                if " " + normalized_name + " " in normalized_question:
                    numeric_columns.add((position, table["schema"], table["name"], column["name"]))
    if len(numeric_columns) != 1:
        return None

    position, schema, table_name, measure = next(iter(numeric_columns))
    table = tables[position]
    temporal_names = {
        normalize_text(column.get("name", "")): column.get("name", "")
        for column in table.get("columns", [])
        if column.get("dataType", "").upper() in TEMPORAL_TYPES
    }
    temporal_matches = [
        name
        for normalized_name, name in temporal_names.items()
        if normalized_name and " " + normalized_name + " " in normalized_question
    ]
    temporal_cues = {
        "date",
        "day",
        "month",
        "time",
        "trend",
        "ngay",
        "thang",
        "xu huong",
    }
    question_terms = set(normalize_text(question).split())
    has_temporal_intent = bool(question_terms & temporal_cues)
    if has_temporal_intent and len(temporal_matches) != 1:
        return None

    return {
        "function": functions[0],
        "schema": schema,
        "table": table_name,
        "measure": measure,
        "groupBy": temporal_matches[0] if temporal_matches else None,
    }


def _regular_aggregate(node):
    if not isinstance(node, exp.AggFunc):
        return False
    parent = node.parent
    while parent is not None and not isinstance(parent, exp.Query):
        if isinstance(parent, exp.Window):
            return False
        if isinstance(parent, exp.AggFunc):
            # SUM(SUM(value)) OVER () contains a normal inner aggregate.
            return True
        parent = parent.parent
    return True


def validate_aggregation(sql, dialect, context, chart=None, question=""):
    """Raise only for invalid grouping; leave table/security checks to existing guards."""
    read = DIALECTS[dialect]
    schema = {}
    for table in context.get("tables", []):
        schema.setdefault(table["schema"], {})[table["name"]] = {
            column["name"]: "UNKNOWN" for column in table["columns"]
        }
    ast = sqlglot.parse_one(sql, read=read)
    validate_requested_physical_aggregate(ast, context, question)
    if chart and chart.get("type") != "table":
        outputs = set(ast.named_selects)
        if "*" not in outputs:
            references = [item.get("column") for item in chart.get("series", [])]
            if chart.get("type") != "number":
                references.append(chart.get("x"))
            missing = [reference for reference in references if reference not in outputs]
            if missing:
                # A dimension named by the candidate's own chart but absent from
                # SELECT is a result-grain inconsistency, not a reason to invent
                # grouping ourselves or silently display an unrelated scalar.
                raise InvalidAggregation(outputs=list(ast.named_selects), missing=missing)
    # Qualification on a copy resolves GROUP BY aliases/ordinals and column
    # qualifiers. It does not alter the returned/executed candidate. This check
    # is deliberately not a replacement for Java's complete physical allowlist.
    ast = qualify(
        ast,
        dialect=read,
        schema=MappingSchema(schema, dialect=read, normalize=read != "postgres"),
        infer_schema=True,
        allow_partial_qualification=True,
        validate_qualify_columns=False,
    )
    for scope in traverse_scope(ast):
        select = scope.expression
        if not isinstance(select, exp.Select):
            continue
        groups = select.args.get("group")
        grouping = groups.expressions if groups else []
        roots = list(select.expressions)
        roots.extend(select.args[name] for name in ("having", "order") if select.args.get(name))

        def local_nodes(node):
            yield node
            for child in node.iter_expressions():
                if not isinstance(child, exp.Query):
                    yield from local_nodes(child)

        aggregating = bool(grouping) or any(
            _regular_aggregate(node) for root in roots for node in local_nodes(root)
        )
        if not aggregating:
            continue
        # The bounded intent predicate applies only to a direct outer aggregate.
        # A subquery can group the entity while the outer query orders it; this
        # validator must not demand the final tie-break in every nested scope.
        if select is ast:
            validate_requested_key_order(select, grouping, scope.sources, context, question)
        aliases = {
            item.alias: item.this for item in select.expressions if isinstance(item, exp.Alias)
        }

        def grouped(node, resolving=frozenset()):
            if node in grouping or _regular_aggregate(node) or isinstance(node, exp.Query):
                return True
            if isinstance(node, exp.Column):
                if not node.table and node.name in aliases and node.name not in resolving:
                    return grouped(aliases[node.name], resolving | {node.name})
                return False
            if isinstance(node, exp.Star):
                # COUNT(*) is stopped at its aggregate above. SELECT * must have
                # been expanded from actual schema or is unsafe at this grain.
                return False
            return all(grouped(child, resolving) for child in node.iter_expressions())

        if not all(grouped(root) for root in roots):
            raise InvalidAggregation()


def validate_requested_physical_aggregate(ast, context, question):
    """Keep a candidate from silently changing an explicit physical measure."""
    normalized_question = " " + normalize_text(question) + " "
    requested_functions = [
        function
        for function, cues in AGGREGATE_INTENTS.items()
        if any(" " + normalize_text(cue) + " " in normalized_question for cue in cues)
    ]
    if not requested_functions:
        return

    mentioned_columns = {}
    for table in context.get("tables", []):
        for column in table.get("columns", []):
            if column.get("dataType", "").upper() not in NUMERIC_TYPES:
                continue
            names = [column.get("name", ""), *column.get("synonyms", [])]
            for name in names:
                normalized_name = normalize_text(name)
                if len(normalized_name.replace(" ", "")) < 4:
                    continue
                if " " + normalized_name + " " in normalized_question:
                    mentioned_columns.setdefault(normalized_name, set()).add(
                        (table["schema"], table["name"], column["name"])
                    )

    unique_columns = set().union(*mentioned_columns.values()) if mentioned_columns else set()
    if len(unique_columns) != 1:
        return
    schema, table, requested_column = next(iter(unique_columns))
    aggregate_nodes = {
        "SUM": list(ast.find_all(exp.Sum)),
        "AVG": list(ast.find_all(exp.Avg)),
    }
    aliases = {
        source.alias_or_name.casefold()
        for source in ast.find_all(exp.Table)
        if source.name.casefold() == table.casefold()
        and (not source.db or source.db.casefold() == schema.casefold())
    }
    for function in requested_functions:
        includes_requested_column = any(
            any(
                column.name.casefold() == requested_column.casefold()
                and (not column.table or not aliases or column.table.casefold() in aliases)
                for column in aggregate.find_all(exp.Column)
            )
            for aggregate in aggregate_nodes[function]
        )
        if not includes_requested_column:
            raise InvalidAggregation(requested_measure=(function, requested_column))


def validate_requested_key_order(select, grouping, sources, context, question):
    """Validate explicit key tie-breaks only; never infer a key or synthesize SQL.

    The question must name one authorized primary-key column unambiguously.
    General ranking intent and business ambiguity remain the model's task.
    """
    match = re.search(
        r"\b(?:break\s+ties\s+by|tie[- ]break(?:er)?\s+by)\s+"
        r"[\[\"`]?([\w]+)[\]\"`]?\s*(ascending|descending|asc|desc)?\b",
        re.sub(r"'(?:[^']|'')*'", " ", question),
        re.IGNORECASE,
    )
    if not match:
        return
    named_key = normalize_text(match.group(1))
    candidates = [
        (table["schema"], table["name"], key)
        for table in context.get("tables", [])
        if len(table.get("primaryKey", [])) == 1
        for key in table.get("primaryKey", [])
        if normalize_text(key) == named_key
    ]
    if len(candidates) != 1:
        return
    schema, table, key = candidates[0]
    aliases = {
        alias
        for alias, source in sources.items()
        if isinstance(source, exp.Table)
        and source.name.casefold() == table.casefold()
        and (not source.db or source.db.casefold() == schema.casefold())
    }
    if not aliases:
        return

    output_aliases = {
        item.alias: item.this for item in select.expressions if isinstance(item, exp.Alias)
    }

    def matches(column, resolving=frozenset()):
        if (
            isinstance(column, exp.Column)
            and not column.table
            and column.name in output_aliases
            and column.name not in resolving
        ):
            return matches(output_aliases[column.name], resolving | {column.name})
        return (
            isinstance(column, exp.Column)
            and column.name.casefold() == key.casefold()
            and (not column.table or column.table in aliases)
        )

    requested_desc = (match.group(2) or "asc").casefold().startswith("desc")
    order = select.args.get("order")
    ordered_key = bool(order) and any(
        index > 0 and matches(item.this) and bool(item.args.get("desc")) == requested_desc
        for index, item in enumerate(order.expressions)
    )
    if not any(matches(group) for group in grouping) or not ordered_key:
        raise InvalidAggregation(requested_key=schema + "." + table + "." + key)
