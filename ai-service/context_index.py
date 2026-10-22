"""Request-local schema indexes and relevance helpers for prompt context."""

# Adapted from Wren Engine's dependency-free schema indexing and description approach.
# Copyright 2024 Canner, Inc. Wren Engine is licensed under Apache-2.0; see
# third-party/licenses/WREN-APACHE-2.0.txt and docs/platform-reuse.md.

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from functools import lru_cache
from typing import Any


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    normalized = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", normalized)
    normalized = re.sub(r"[_\-]+", " ", normalized).casefold()
    # Accent folding affects retrieval terms only, never physical SQL identifiers.
    normalized = "".join(
        char
        for char in unicodedata.normalize("NFKD", normalized)
        if not unicodedata.combining(char)
    ).replace("đ", "d")
    return " ".join(re.findall(r"[\w]+", normalized, flags=re.UNICODE))


def schema_fingerprint(context_json: str) -> str:
    return hashlib.sha256(context_json.encode("utf-8")).hexdigest()


def describe_schema(context: dict[str, Any]) -> str:
    """Create a stable, readable snapshot description for diagnostics and retrieval."""
    lines: list[str] = []
    for table in context.get("tables", []):
        name = f"{table.get('schema', '')}.{table.get('name', '')}".strip(".")
        logical_name = table.get("logicalName") or ""
        description = table.get("description") or ""
        grain = table.get("grain") or ""
        lines.append(
            f"Table {name}; logical name: {logical_name}; grain: {grain}; "
            f"description: {description}".rstrip()
        )
        for column in table.get("columns", []):
            line = f"  Column {column.get('name')} ({column.get('dataType')})"
            detail = column.get("description")
            synonyms = column.get("synonyms", [])
            if detail:
                line += f": {detail}"
            if synonyms:
                line += f"; synonyms: {', '.join(synonyms)}"
            if "nullable" in column:
                line += f"; nullable: {column.get('nullable')}"
            lines.append(line)
    for metric in context.get("metrics", []):
        lines.append(
            f"Metric {metric.get('name')}: {metric.get('description', '')}; "
            f"expression: {metric.get('expression', '')}"
        )
    for dimension in context.get("dimensions", []):
        lines.append(
            f"Dimension {dimension.get('name')}: {dimension.get('description', '')}; "
            f"column: {dimension.get('table', {}).get('schema', '')}."
            f"{dimension.get('table', {}).get('name', '')}.{dimension.get('column', '')}"
        )
    for relationship in context.get("relationships", []):
        left = relationship.get("from", {})
        right = relationship.get("to", {})
        lines.append(
            "Relationship "
            f"{left.get('table', {}).get('schema', '')}."
            f"{left.get('table', {}).get('name', '')}.{left.get('column', '')} -> "
            f"{right.get('table', {}).get('schema', '')}."
            f"{right.get('table', {}).get('name', '')}.{right.get('column', '')}"
        )
    for rule in context.get("businessRules", []):
        lines.append(f"Business rule: {rule}")
    for example in context.get("examples", []):
        lines.append(
            f"Example ({example.get('sqlDialect')}): {example.get('question')} -> "
            f"{example.get('sql')}"
        )
    return "\n".join(lines)


@lru_cache(maxsize=32)
def _cached_index(fingerprint: str, context_json: str) -> dict[str, Any]:
    """Cache only derived indexes; the key is the exact canonical context snapshot."""
    context = json.loads(context_json)

    def terms(value: Any) -> set[str]:
        # JSON field names are structural, not business synonyms. Including keys
        # like name/table/column made ordinary questions select unrelated tables.
        if isinstance(value, str):
            return set(normalize_text(value).split())
        if isinstance(value, dict):
            return set().union(*(terms(item) for item in value.values()))
        if isinstance(value, list):
            return set().union(*(terms(item) for item in value))
        return set()

    def semantic_terms(item: dict[str, Any]) -> set[str]:
        return terms(
            {key: item.get(key) for key in ("name", "description", "synonyms", "category")}
        )

    table_keys = [(table.get("schema"), table.get("name")) for table in context.get("tables", [])]
    table_by_key = {
        (table.get("schema"), table.get("name")): table for table in context.get("tables", [])
    }
    relationship_adjacency: dict[tuple[Any, Any], list[tuple[tuple[Any, Any], int]]] = {}
    for index, relationship in enumerate(context.get("relationships", [])):
        left = relationship.get("from", {}).get("table", {})
        right = relationship.get("to", {}).get("table", {})
        left_key = (left.get("schema"), left.get("name"))
        right_key = (right.get("schema"), right.get("name"))
        relationship_adjacency.setdefault(left_key, []).append((right_key, index))
        relationship_adjacency.setdefault(right_key, []).append((left_key, index))

    return {
        "fingerprint": fingerprint,
        "context": context,
        "tableKeys": table_keys,
        "tableByKey": table_by_key,
        "relationshipAdjacency": relationship_adjacency,
        "tableTerms": [
            terms(table) | set(normalize_text(describe_schema({"tables": [table]})).split())
            for table in context.get("tables", [])
        ],
        "metricTerms": [semantic_terms(metric) for metric in context.get("metrics", [])],
        "dimensionTerms": [
            semantic_terms(dimension) for dimension in context.get("dimensions", [])
        ],
        "exampleTerms": [terms(example) for example in context.get("examples", [])],
    }


def get_schema_index(context: dict[str, Any]) -> dict[str, Any]:
    structural_context = dict(context)
    structural_context.pop("referenceTime", None)
    serialized = json.dumps(
        structural_context,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    cached = _cached_index(schema_fingerprint(serialized), serialized)
    return {
        **cached,
        "context": {
            **cached["context"],
            "referenceTime": context.get("referenceTime"),
        },
    }


def overlap_score(question_terms: set[str], item_terms: set[str]) -> int:
    return len(question_terms & item_terms)


def cached_snapshot_count() -> int:
    return _cached_index.cache_info().currsize


def clear_schema_index_cache() -> None:
    _cached_index.cache_clear()
