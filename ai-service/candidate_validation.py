"""Validate aggregate scope semantics without rewriting model SQL or executing it."""

import json

import sqlglot
from sqlglot import exp
from sqlglot.optimizer.qualify import qualify
from sqlglot.optimizer.scope import traverse_scope
from sqlglot.schema import MappingSchema

DIALECTS = {"POSTGRESQL": "postgres", "MYSQL": "mysql", "SQL_SERVER": "tsql"}


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

    def __init__(self, *, outputs=None, missing=None):
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


def validate_aggregation(sql, dialect, context, chart=None):
    """Raise only for invalid grouping; leave table/security checks to existing guards."""
    read = DIALECTS[dialect]
    schema = {}
    for table in context.get("tables", []):
        schema.setdefault(table["schema"], {})[table["name"]] = {
            column["name"]: "UNKNOWN" for column in table["columns"]
        }
    ast = sqlglot.parse_one(sql, read=read)
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
