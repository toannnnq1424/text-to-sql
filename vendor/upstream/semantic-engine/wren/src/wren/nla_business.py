"""NLA business compiler: configured measures, declared grain and safe joins.

Uses the source kit's SQLGlot dialect implementation. Output is a candidate;
Java must still native-plan, independently guard and execute it read-only.
"""

from __future__ import annotations

import math
import re
from collections import deque

import sqlglot
from sqlglot import exp
from wren.nla_planning import DatasetPlanningError

DIALECTS = {"POSTGRESQL": "postgres", "MYSQL": "mysql", "SQL_SERVER": "tsql"}
FUNCTIONS = {
    "sum",
    "count",
    "avg",
    "min",
    "max",
    "cast",
    "trycast",
    "coalesce",
    "nullif",
    "round",
    "abs",
    "lower",
    "upper",
    "trim",
    "length",
    "concat",
    "substring",
    "strposition",
}


def key(table):
    return table["schema"], table["name"]


def fail():
    raise DatasetPlanningError("SEMANTIC_MODEL_INVALID")


class BusinessCompiler:
    def __init__(self, context: dict, dialect: str):
        self.context = context
        if dialect not in DIALECTS:
            fail()
        self.dialect = DIALECTS[dialect]
        self.tables = {key(table): table for table in context["tables"]}
        self.metrics = self._named(context.get("metrics", []))
        self.dimensions = self._named(context.get("dimensions", []))
        if {name.casefold() for name in self.metrics} & {
            name.casefold() for name in self.dimensions
        }:
            fail()
        self.aliases = {ref: "nla_t" + str(i) for i, ref in enumerate(self.tables)}
        self.edges = {}
        for relation in context.get("relationships", []):
            left, right = relation["from"], relation["to"]
            a, b = key(left["table"]), key(right["table"])
            self._column(a, left["column"])
            self._column(b, right["column"])
            cardinality = relation["cardinality"]
            if cardinality not in {"ONE_TO_ONE", "MANY_TO_ONE", "ONE_TO_MANY", "MANY_TO_MANY"}:
                fail()
            if cardinality in {"MANY_TO_ONE", "ONE_TO_ONE"}:
                self.edges.setdefault(a, []).append((b, left["column"], right["column"]))
            if cardinality in {"ONE_TO_MANY", "ONE_TO_ONE"}:
                self.edges.setdefault(b, []).append((a, right["column"], left["column"]))
        for name, dimension in self.dimensions.items():
            self._column(key(dimension["table"]), dimension["column"])
        for name, metric in self.metrics.items():
            refs = [key(ref) for ref in metric.get("tableRefs", [])]
            if (
                not refs
                or len(refs) != len(set(refs))
                or any(ref not in self.tables for ref in refs)
            ):
                fail()
            if not set(metric.get("compatibleDimensions", [])) <= set(self.dimensions):
                fail()
            expression = self._expression(metric["expression"], set(refs), aggregate=True)
            for ref in refs:
                self._path(refs[0], ref)
            for dim in metric.get("compatibleDimensions", []):
                self._path(refs[0], key(self.dimensions[dim]["table"]))

    @staticmethod
    def _named(items):
        result = {}
        for item in items:
            name = item["name"]
            if (
                not name
                or len(name) > 200
                or name.casefold() in {existing.casefold() for existing in result}
                or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,199}", name)
            ):
                fail()
            result[name] = item
        return result

    def _column(self, ref, column):
        if ref not in self.tables or column not in {c["name"] for c in self.tables[ref]["columns"]}:
            fail()
        return exp.column(column, table=self.aliases[ref], quoted=True)

    def _expression(self, text, refs, *, aggregate):
        if not isinstance(text, str) or not text or len(text) > 10000:
            fail()
        try:
            statements = sqlglot.parse("SELECT " + text, read=self.dialect, error_level="RAISE")
        except Exception:
            fail()
        if len(statements) != 1 or not isinstance(statements[0], exp.Select):
            fail()
        query = statements[0]
        if len(query.expressions) != 1 or any(
            value for name, value in query.args.items() if name != "expressions"
        ):
            fail()
        expression = query.expressions[0]
        if isinstance(expression, exp.Alias) or any(
            isinstance(n, (exp.Query, exp.Window, exp.Command, exp.Parameter, exp.Placeholder))
            or n.comments
            for n in expression.walk()
        ):
            fail()
        for node in expression.find_all(exp.Func):
            name = node.name.lower() if isinstance(node, exp.Anonymous) else node.key.lower()
            if name not in FUNCTIONS:
                fail()
        if aggregate and not any(isinstance(node, exp.AggFunc) for node in expression.walk()):
            fail()
        for star in expression.find_all(exp.Star):
            if not isinstance(star.parent, exp.Count):
                fail()
        for node in expression.find_all(exp.AggFunc):
            parent = node.parent
            while parent is not None:
                if isinstance(parent, exp.AggFunc):
                    fail()
                parent = parent.parent
        for column in list(expression.find_all(exp.Column)):
            if column.catalog:
                fail()
            candidates = []
            for ref in refs:
                if column.table and column.table != ref[1]:
                    continue
                if column.db and column.db != ref[0]:
                    continue
                if column.name in {c["name"] for c in self.tables[ref]["columns"]}:
                    candidates.append(ref)
            if len(candidates) != 1:
                fail()
            if aggregate:
                parent = column.parent
                while parent is not None and not isinstance(parent, exp.AggFunc):
                    parent = parent.parent
                if parent is None:
                    fail()
            column.replace(self._column(candidates[0], column.name))
        return expression

    def _path(self, source, destination):
        if source == destination:
            return []
        queue = deque([(source, [])])
        distances = {source: 0}
        answers = []
        while queue:
            ref, path = queue.popleft()
            if answers and len(path) >= len(answers[0]):
                continue
            for target, left, right in set(self.edges.get(ref, [])):
                step = (ref, target, left, right)
                candidate = path + [step]
                if target == destination:
                    answers.append(candidate)
                    if len(answers) > 1:
                        # Parallel foreign keys and diamond paths have different
                        # business meaning; never choose one silently.
                        fail()
                elif target not in distances or distances[target] == len(candidate):
                    distances[target] = len(candidate)
                    queue.append((target, candidate))
        if len(answers) != 1:
            # Never invent a join, cross a many-side edge or multiply fact grains.
            fail()
        return answers[0]

    def _table(self, ref):
        return exp.Table(
            this=exp.to_identifier(ref[1], quoted=True),
            db=exp.to_identifier(ref[0], quoted=True),
            alias=exp.TableAlias(this=exp.to_identifier(self.aliases[ref], quoted=True)),
        )

    def compile(self, selection):
        if not isinstance(selection, dict) or set(selection) - {
            "metrics",
            "dimensions",
            "filters",
            "limit",
        }:
            fail()
        selected_metrics = selection.get("metrics", [])
        selected_dimensions = selection.get("dimensions", [])
        filters = selection.get("filters", [])
        limit = selection.get("limit", 100)
        if not all(
            isinstance(items, list) for items in (selected_metrics, selected_dimensions, filters)
        ):
            fail()
        if not all(isinstance(name, str) for name in selected_metrics + selected_dimensions):
            fail()
        for item in filters:
            if (
                not isinstance(item, dict)
                or set(item) - {"dimension", "operator", "value"}
                or item.get("dimension") not in self.dimensions
                or item.get("operator")
                not in {"EQ", "NE", "GT", "GTE", "LT", "LTE", "CONTAINS", "IS_NULL", "IS_NOT_NULL"}
            ):
                fail()
        if (
            not 1 <= len(selected_metrics) <= 10
            or len(selected_dimensions) > 5
            or len(filters) > 10
            or not isinstance(limit, int)
            or isinstance(limit, bool)
            or not 1 <= limit <= 1000
            or len(set(selected_metrics)) != len(selected_metrics)
            or len(set(selected_dimensions)) != len(selected_dimensions)
            or not set(selected_metrics) <= self.metrics.keys()
            or not set(selected_dimensions) <= self.dimensions.keys()
        ):
            fail()
        root = key(self.metrics[selected_metrics[0]]["tableRefs"][0])
        for name in selected_metrics:
            if key(self.metrics[name]["tableRefs"][0]) != root:
                # Different fact grains require independent aggregates, not a row join.
                fail()
            if not set(selected_dimensions + [item["dimension"] for item in filters]) <= set(
                self.metrics[name].get("compatibleDimensions", [])
            ):
                fail()
        goals = {key(self.dimensions[name]["table"]) for name in selected_dimensions}
        goals.update(key(self.dimensions[item["dimension"]]["table"]) for item in filters)
        for name in selected_metrics:
            goals.update(key(ref) for ref in self.metrics[name]["tableRefs"])
        joins = {}
        for goal in sorted(goals):
            for step in self._path(root, goal):
                joins[step[1]] = step
        projections = []
        groups = []
        for name in selected_dimensions:
            dim = self.dimensions[name]
            column = self._column(key(dim["table"]), dim["column"])
            projections.append(exp.alias_(column.copy(), name, quoted=True))
            groups.append(column)
        for name in selected_metrics:
            metric = self.metrics[name]
            expression = self._expression(
                metric["expression"], {key(ref) for ref in metric["tableRefs"]}, aggregate=True
            )
            projections.append(exp.alias_(expression, name, quoted=True))
        query = exp.select(*projections).from_(self._table(root))
        for parent, target, left, right in joins.values():
            query = query.join(
                self._table(target),
                join_type="LEFT",
                on=exp.EQ(this=self._column(parent, left), expression=self._column(target, right)),
            )
        predicates = []
        for item in filters:
            if set(item) - {"dimension", "operator", "value"}:
                fail()
            dim = self.dimensions[item["dimension"]]
            column = self._column(key(dim["table"]), dim["column"])
            op = item["operator"]
            value = item.get("value")
            if (
                not isinstance(value, (str, int, float, bool, type(None)))
                or (isinstance(value, str) and len(value) > 2000)
                or (isinstance(value, float) and not math.isfinite(value))
            ):
                fail()
            if op in {"IS_NULL", "IS_NOT_NULL"}:
                if value is not None:
                    fail()
                predicate = exp.Is(this=column, expression=exp.Null())
                if op == "IS_NOT_NULL":
                    predicate = exp.Not(this=predicate)
            elif op == "CONTAINS" and isinstance(value, str):
                predicate = exp.GT(
                    this=exp.StrPosition(this=column, substr=exp.convert(value)),
                    expression=exp.Literal.number(0),
                )
            else:
                operator = {
                    "EQ": exp.EQ,
                    "NE": exp.NEQ,
                    "GT": exp.GT,
                    "GTE": exp.GTE,
                    "LT": exp.LT,
                    "LTE": exp.LTE,
                }.get(op)
                if operator is None or value is None:
                    fail()
                predicate = operator(this=column, expression=exp.convert(value))
            predicates.append(predicate)
        if predicates:
            query = query.where(exp.and_(*predicates))
        if groups:
            query = query.group_by(*groups).order_by(*[g.copy() for g in groups])
        query = query.limit(limit)
        return {
            "sql": query.sql(dialect=self.dialect),
            "explanation": "Truy vấn được biên dịch từ metric, dimension và quan hệ đã cấu hình; không gọi LLM.",
            "assumptions": [
                "Chỉ dùng đường join many-to-one/one-to-one đã khai báo để giữ đúng mức hạt."
            ],
            "selectedMetrics": selected_metrics,
            "selectedDimensions": selected_dimensions,
            "chartRecommendation": {
                "type": "bar" if len(selected_dimensions) == 1 else "table",
                "title": ", ".join(selected_metrics),
                "x": selected_dimensions[0] if len(selected_dimensions) == 1 else None,
                "series": [{"column": name, "label": name} for name in selected_metrics],
            },
            "confidence": 1.0,
            "model": "semantic-compiler",
        }
