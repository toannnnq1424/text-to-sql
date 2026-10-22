"""Conservative, metadata-only table mentions for bounded language context selection.

These helpers do not generate SQL, rewrite user questions, or establish database
identity. Exact physical references remain authoritative in the Java guard. A
near-match is merely an explicit assumption that the model/user can inspect.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from context_index import normalize_text


class AmbiguousTableReference(Exception):
    """A name has multiple authorized meanings; no arbitrary table is selected."""


@dataclass(frozen=True)
class TableMentions:
    positions: frozenset[int]
    assumptions: tuple[str, ...] = ()


_IDENTIFIER = r'(?:"(?:[^\"]|\"\")+"|`(?:[^`]|``)+`|\[(?:[^\]]|\]\])+\]|[^\W\d]\w*)'
_QUALIFIED = re.compile(rf"(?P<schema>{_IDENTIFIER})\s*\.\s*(?P<table>{_IDENTIFIER})", re.UNICODE)
# Language stop words are relevance policy, never domain-specific table mappings.
_GENERIC = {
    "about",
    "after",
    "average",
    "before",
    "between",
    "column",
    "columns",
    "compare",
    "count",
    "distinct",
    "first",
    "from",
    "group",
    "having",
    "highest",
    "latest",
    "least",
    "limit",
    "lowest",
    "maximum",
    "minimum",
    "number",
    "order",
    "record",
    "records",
    "select",
    "show",
    "table",
    "tables",
    "their",
    "there",
    "these",
    "total",
    "trong",
    "bang",
    "ban",
    "bao",
    "nhieu",
    "ghi",
    "cua",
    "theo",
    "tong",
    "trung",
    "binh",
    "nhat",
    "thap",
    "cao",
    "dau",
    "tien",
    "lieu",
    "du",
    "cac",
    "nhung",
}


def _unquote(value: str) -> str:
    if value.startswith("["):
        return value[1:-1].replace("]]", "]")
    if value.startswith('"'):
        return value[1:-1].replace('""', '"')
    if value.startswith("`"):
        return value[1:-1].replace("``", "`")
    return value


def _fold_name(value: str) -> str:
    return normalize_text(_unquote(value))


def _repeated(value: str) -> str:
    return re.sub(r"(.)\1+", r"\1", value)


def _near(left: str, right: str) -> bool:
    if min(len(left), len(right)) < 4 or max(len(left), len(right)) > 80:
        return False
    if _repeated(left) == _repeated(right):
        return True
    if abs(len(left) - len(right)) > (1 if min(len(left), len(right)) < 8 else 2):
        return False
    # One insertion/deletion/substitution or adjacent transposition for short names.
    # Longer names allow two edits, with a high similarity floor. Never map short
    # business abbreviations or arbitrary words by nearest-neighbor alone.
    if SequenceMatcher(None, left, right, autojunk=False).ratio() < 0.8:
        return False
    maximum = 1 if min(len(left), len(right)) < 8 else 2
    previous_previous = None
    previous = list(range(len(right) + 1))
    for i, a in enumerate(left, 1):
        current = [i]
        for j, b in enumerate(right, 1):
            distance = min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (a != b))
            if i > 1 and j > 1 and a == right[j - 2] and left[i - 2] == b:
                distance = min(distance, previous_previous[j - 2] + 1)
            current.append(distance)
        previous_previous, previous = previous, current
    return previous[-1] <= maximum


def table_mentions(
    question: str, tables: list[dict[str, Any]], *, allow_fuzzy: bool = True
) -> TableMentions:
    by_name: dict[str, set[int]] = {}
    for position, table in enumerate(tables):
        for label in (table["name"], table.get("logicalName")):
            if label:
                by_name.setdefault(_fold_name(label), set()).add(position)

    # Quoted filter values are data, not table mentions. A quoted name directly
    # following a table cue is still usable as an identifier in ordinary prose.
    def mask_literal(match):
        prefix = normalize_text(question[max(0, match.start() - 20) : match.start()])
        return match.group(0) if prefix.endswith(("table", "bang")) else " " * len(match.group(0))

    mention_question = re.sub(r"'(?:[^']|'')*'", mask_literal, question)
    positions: set[int] = set()
    qualified_positions: set[int] = set()
    # A qualified same-name reference must not pull in the table from another schema.
    masked_question = mention_question
    for match in _QUALIFIED.finditer(mention_question):
        schema, name = (_fold_name(match.group(key)) for key in ("schema", "table"))
        matches = {
            p
            for p, table in enumerate(tables)
            if _fold_name(table["schema"]) == schema and _fold_name(table["name"]) == name
        }
        if len(matches) > 1:
            raise AmbiguousTableReference()
        if not matches:
            # In prose, table.column is an equally valid physical reference.
            # A column name can also be another table's name; do not mistake
            # that for an unknown schema or select the unrelated table.
            column_matches = {
                p
                for p in by_name.get(schema, set())
                if any(_fold_name(column["name"]) == name for column in tables[p]["columns"])
            }
            if len(column_matches) > 1:
                raise AmbiguousTableReference()
            if column_matches:
                positions.update(column_matches)
                masked_question = masked_question.replace(match.group(0), " ")
                continue
        if not matches and name in by_name:
            raise AmbiguousTableReference()
        if matches:
            positions.update(matches)
            qualified_positions.update(matches)
            masked_question = masked_question.replace(match.group(0), " ")
    normalized_unqualified = normalize_text(masked_question)
    mentions: list[tuple[int, int, str]] = []
    for name in by_name:
        for match in re.finditer(r"(?<!\w)" + re.escape(name) + r"(?!\w)", normalized_unqualified):
            mentions.append((match.start(), match.end(), name))
    # Suppress partial names only within the same phrase, never a shorter table
    # mentioned elsewhere in a multi-table question.
    exact = [
        item
        for item in mentions
        if not any(
            other[0] <= item[0] and other[1] >= item[1] and other != item for other in mentions
        )
    ]
    for _, _, name in exact:
        matches = by_name[name]
        if len(matches) > 1:
            raise AmbiguousTableReference()
        positions.update(matches)

    if not allow_fuzzy:
        return TableMentions(frozenset(positions))
    exact_words = {word for _, _, name in exact for word in name.split()}
    assumptions = []
    # Preserve original identifier boundaries. DimCustomer, dim_customer and
    # "Customer records" each form one identifier when quoted/compound, while
    # unrelated prose words are never concatenated to invent a matching name.
    tokens = dict.fromkeys(
        _fold_name(match.group(0)) for match in re.finditer(_IDENTIFIER, masked_question)
    )
    for token in tokens:
        compact_token = token.replace(" ", "")
        if (
            token in _GENERIC
            or set(token.split()) <= exact_words
            or not 4 <= len(compact_token) <= 80
        ):
            continue
        possible = {
            name: indexes
            for name, indexes in by_name.items()
            if _near(compact_token, name.replace(" ", ""))
        }
        if not possible:
            continue

        def similarity(name):
            return SequenceMatcher(
                None, compact_token, name.replace(" ", ""), autojunk=False
            ).ratio()

        best = max(similarity(name) for name in possible)
        # Repeated suffix typing can be farther away but is an exact collapsed match.
        if any(_repeated(compact_token) == _repeated(name.replace(" ", "")) for name in possible):
            candidates = set().union(
                *(
                    indexes
                    for name, indexes in possible.items()
                    if _repeated(compact_token) == _repeated(name.replace(" ", ""))
                )
            )
        else:
            candidates = set().union(
                *(indexes for name, indexes in possible.items() if similarity(name) >= best - 0.08)
            )
        if len(candidates) > 1:
            raise AmbiguousTableReference()
        position = next(iter(candidates))
        if position in positions:
            continue
        positions.add(position)
        table = tables[position]
        assumptions.append(
            f"Tên bảng/Table: {token} → {table['schema']}.{table['name']} "
            "(khớp gần/approximate match)."
        )
    return TableMentions(frozenset(positions | qualified_positions), tuple(assumptions))
