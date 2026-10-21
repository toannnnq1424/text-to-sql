"""Remove native-generated identity models without touching business operations.

The kit optimizer collapses nested identity projections inside a generated model.
Only a direct physical-table identity is then substituted into its callers. User
CTEs, casts, filters, distinct, groups, windows and limits are never inlined here.
"""

from sqlglot import exp
from sqlglot.optimizer.merge_subqueries import merge_subqueries
from sqlglot.optimizer.scope import Scope, traverse_scope


def _projection(expression):
    value = expression.this if isinstance(expression, exp.Alias) else expression
    return isinstance(value, (exp.Column, exp.Literal))


def _identity_body(body):
    if not isinstance(body, exp.Select):
        return None
    for select in body.find_all(exp.Select):
        if any(
            value for name, value in select.args.items() if name not in {"expressions", "from_"}
        ):
            return None
        if not select.expressions or not all(_projection(item) for item in select.expressions):
            return None
    # This invokes the pinned kit SQLGlot rule rather than reimplementing nested
    # projection/alias substitution. Above checks exclude volatile expressions and
    # every row-shaping operation before asking the optimizer to merge anything.
    collapsed = merge_subqueries(body.copy())
    source = collapsed.args.get("from_")
    if source is None or not isinstance(source.this, exp.Table):
        return None
    table = source.this
    names = []
    constants = False
    for projection in collapsed.expressions:
        value = projection.this if isinstance(projection, exp.Alias) else projection
        if isinstance(value, exp.Literal):
            constants = True
        elif (
            not isinstance(value, exp.Column)
            or value.table not in {"", table.alias_or_name}
            or projection.alias_or_name != value.name
            or value.name in names
        ):
            return None
        else:
            names.append(value.name)
    return collapsed, table, names, constants


def compact_generated_models(ast, generated_names, protected_ctes, *, case_sensitive=True):
    """Compact a copy of the actual native plan, never the original candidate."""
    result = ast.copy()
    allowed = {name.casefold() for name in generated_names} - {
        name.casefold() for name in protected_ctes
    }
    candidates = {}
    for cte in result.find_all(exp.CTE):
        name = cte.alias_or_name.casefold()
        if name not in allowed:
            continue
        identity = _identity_body(cte.this)
        if identity is not None:
            candidates[id(cte.this)] = (cte, identity)
    if not candidates:
        return result
    for scope in traverse_scope(result):
        for alias, (reference, source) in list(scope.selected_sources.items()):
            if not isinstance(reference, exp.Table) or not isinstance(source, Scope):
                continue
            candidate = candidates.get(id(source.expression))
            if candidate is None:
                continue
            _, (_, physical, projected_names, constants) = candidate
            used_columns = [column for column in scope.columns if column.table == alias]
            if constants and used_columns:
                continue
            matching_names = (
                set(projected_names)
                if case_sensitive
                else {name.casefold() for name in projected_names}
            )
            if any(
                (column.name if case_sensitive else column.name.casefold()) not in matching_names
                for column in used_columns
            ):
                continue
            output_names = {
                name if case_sensitive else name.casefold()
                for name in scope.expression.named_selects
            }
            if any(
                not column.table
                and (column.name if case_sensitive else column.name.casefold())
                not in matching_names | output_names
                for column in scope.columns
            ):
                continue
            projections = scope.expression.expressions
            has_plain_star = any(isinstance(item, exp.Star) for item in projections)
            has_scoped_star = any(
                isinstance(item, exp.Column) and item.is_star and item.table == alias
                for item in projections
            )
            if has_plain_star and len(scope.selected_sources) != 1:
                continue
            if (has_plain_star or has_scoped_star) and constants:
                continue
            if has_plain_star or has_scoped_star:
                expanded = []
                for item in projections:
                    if isinstance(item, exp.Star) or (
                        isinstance(item, exp.Column) and item.is_star and item.table == alias
                    ):
                        expanded.extend(
                            exp.column(name, table=alias, quoted=True) for name in projected_names
                        )
                    else:
                        expanded.append(item)
                scope.expression.set("expressions", expanded)
            replacement = physical.copy()
            replacement.set("alias", exp.TableAlias(this=exp.to_identifier(alias, quoted=True)))
            # The replacement retains the caller's alias, so outer references and
            # self-join distinctions remain exactly the same.
            reference.replace(replacement)
    remaining = {
        id(source.expression)
        for scope in traverse_scope(result)
        for _, source in scope.selected_sources.values()
        if isinstance(source, Scope)
    }
    for identity, (cte, _) in candidates.items():
        if identity in remaining:
            cte.set("this", candidates[identity][1][0])
        else:
            with_node = cte.parent
            cte.pop()
            if with_node is not None and not with_node.expressions:
                with_node.pop()
    # An unused alias is redundant for a plain physical source. Never remove a
    # referenced alias or alter the projection/result labels.
    for scope in traverse_scope(result):
        referenced = {column.table for column in scope.columns}
        for alias, (reference, source) in scope.selected_sources.items():
            if isinstance(source, exp.Table) and isinstance(reference, exp.Table):
                if reference.alias and alias not in referenced:
                    reference.set("alias", None)
    return result
