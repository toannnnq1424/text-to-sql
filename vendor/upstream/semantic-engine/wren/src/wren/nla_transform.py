"""NLA fork: compile bounded relational layer transforms using the kit ASTs."""

import re

import sqlglot
from sqlglot import exp
from wren.nla_business import DIALECTS, FUNCTIONS, fail


class TransformCompiler:
    @staticmethod
    def compile(columns, transform, dialect):
        if dialect not in DIALECTS or not isinstance(transform, dict):
            fail()
        read = DIALECTS[dialect]
        available = {column["name"] for column in columns}
        if len(available) != len(columns) or not available:
            fail()
        if set(transform) - {"columns", "filter", "groupBy"}:
            fail()
        projected = transform.get("columns", [])
        groups = transform.get("groupBy", [])
        if (
            not isinstance(projected, list)
            or not isinstance(groups, list)
            or not 1 <= len(projected) <= 200
            or len(groups) > 20
        ):
            fail()

        def expression(text):
            if not isinstance(text, str) or not text or len(text) > 10000:
                fail()
            try:
                statements = sqlglot.parse("SELECT " + text, read=read, error_level="RAISE")
            except Exception:
                fail()
            if len(statements) != 1 or not isinstance(statements[0], exp.Select):
                fail()
            query = statements[0]
            if len(query.expressions) != 1 or any(
                value for name, value in query.args.items() if name != "expressions"
            ):
                fail()
            item = query.expressions[0]
            if isinstance(item, exp.Alias) or any(
                isinstance(node, (exp.Query, exp.Window, exp.Parameter, exp.Placeholder))
                or node.comments
                for node in item.walk()
            ):
                fail()
            for func in item.find_all(exp.Func):
                name = func.name.lower() if isinstance(func, exp.Anonymous) else func.key.lower()
                if name not in FUNCTIONS | {"extract", "year", "month", "day", "case", "if"}:
                    fail()
            for column in list(item.find_all(exp.Column)):
                if (
                    column.name not in available
                    or column.table not in {"", "input"}
                    or column.db
                    or column.catalog
                ):
                    fail()
                column.replace(exp.column(column.name, table="input", quoted=True))
            if any(
                isinstance(node, exp.Star) and not isinstance(node.parent, exp.Count)
                for node in item.walk()
            ):
                fail()
            for aggregate in item.find_all(exp.AggFunc):
                if any(isinstance(child, exp.AggFunc) for child in aggregate.iter_expressions()):
                    fail()
                if any(isinstance(parent, exp.AggFunc) for parent in _parents(aggregate)):
                    fail()
            return item

        names = []
        selections = []
        for column in projected:
            if not isinstance(column, dict) or set(column) != {"name", "expression"}:
                fail()
            name = column["name"]
            if (
                not isinstance(name, str)
                or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", name)
                or name.casefold() in {item.casefold() for item in names}
            ):
                fail()
            names.append(name)
            selections.append(expression(column["expression"]))
        grouping = [expression(text) for text in groups]
        if any(node.find(exp.AggFunc) for node in grouping):
            fail()
        aggregates = any(node.find(exp.AggFunc) for node in selections)
        if aggregates or grouping:
            # An unaggregated subtree must be exactly a configured grouping
            # expression. This permits SUM(amount) / NULLIF(COUNT(*), 0), while
            # rejecting amount + SUM(amount) and mismatched GROUP BY lists.
            def grouped(node):
                if node in grouping or isinstance(node, exp.AggFunc):
                    return True
                if isinstance(node, (exp.Column, exp.Star)):
                    return False
                return all(grouped(child) for child in node.iter_expressions())

            if not all(grouped(node) for node in selections):
                fail()
        table = exp.Table(
            this=exp.to_identifier("__nla_input", quoted=True),
            alias=exp.TableAlias(this=exp.to_identifier("input", quoted=True)),
        )
        query = exp.select(
            *[exp.alias_(node, name, quoted=True) for node, name in zip(selections, names)]
        ).from_(table)
        if transform.get("filter"):
            predicate = expression(transform["filter"])
            if predicate.find(exp.AggFunc):
                fail()
            query = query.where(predicate)
        if grouping:
            query = query.group_by(*grouping)
        return {"sql": query.sql(dialect=read), "names": names}


def _parents(node):
    parent = node.parent
    while parent is not None:
        yield parent
        parent = parent.parent
