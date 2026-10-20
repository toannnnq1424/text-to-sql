"""Dataset-scoped persistent source-kit memory using real local embeddings."""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
from wren.memory import WrenMemory

_LOCK = RLock()


class KnowledgeError(Exception):
    pass


class LocalEmbeddings:
    def __init__(self):
        self.model = os.getenv("KNOWLEDGE_EMBEDDING_MODEL", "embeddinggemma:300m")
        self.base = os.getenv("KNOWLEDGE_EMBEDDING_URL", "http://127.0.0.1:11434/v1").rstrip("/")
        parsed = urlsplit(self.base)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "localhost", "host.docker.internal"}
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path not in {"", "/v1"}
            or not self.model
            or len(self.model) > 200
        ):
            raise KnowledgeError("Local embedding endpoint is not configured safely.")

    def compute_source_embeddings(self, texts):
        if not texts:
            return []
        vectors = []
        with httpx.Client(timeout=60, follow_redirects=False) as client:
            for offset in range(0, len(texts), 32):
                batch = texts[offset : offset + 32]
                if any(len(text.encode("utf-8")) > 16384 for text in batch):
                    raise KnowledgeError("An index item exceeds the embedding text limit.")
                response = client.post(
                    self.base + "/embeddings", json={"model": self.model, "input": batch}
                )
                if response.status_code != 200 or len(response.content) > 4 * 1024 * 1024:
                    raise KnowledgeError("The local embedding model is unavailable.")
                data = response.json().get("data", [])
                data.sort(key=lambda item: item.get("index", -1))
                if len(data) != len(batch):
                    raise KnowledgeError("Invalid embedding response.")
                for index, item in enumerate(data):
                    vector = item.get("embedding", [])
                    if (
                        item.get("index") != index
                        or not 32 <= len(vector) <= 4096
                        or any(
                            not isinstance(v, (int, float))
                            or isinstance(v, bool)
                            or not math.isfinite(v)
                            for v in vector
                        )
                    ):
                        raise KnowledgeError("Invalid embedding vector.")
                    vectors.append(vector)
        return vectors

    def compute_query_embeddings(self, query):
        return self.compute_source_embeddings([query] if isinstance(query, str) else query)


def _hash(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def _manifest(context):
    models = []
    for table in context["tables"]:
        models.append(
            {
                "name": table["schema"] + "." + table["name"],
                "properties": {
                    "description": table.get("description", ""),
                    "grain": table.get("grain", ""),
                },
                "columns": [
                    {
                        "name": col["name"],
                        "type": col["dataType"],
                        "properties": {
                            "description": col.get("description", ""),
                            "synonyms": col.get("synonyms", []),
                        },
                    }
                    for col in table["columns"]
                ],
            }
        )
    relationships = []
    for position, relation in enumerate(context.get("relationships", [])):
        left, right = relation["from"], relation["to"]
        left_name = left["table"]["schema"] + "." + left["table"]["name"]
        right_name = right["table"]["schema"] + "." + right["table"]["name"]
        relationships.append(
            {
                "name": "relationship_" + str(position),
                "models": [left_name, right_name],
                "joinType": relation["cardinality"],
                "condition": left_name
                + "."
                + left["column"]
                + " = "
                + right_name
                + "."
                + right["column"],
            }
        )
    return {
        "catalog": "nla",
        "schema": "knowledge",
        "models": models,
        "relationships": relationships,
        "semanticMetrics": context.get("metrics", []),
        "semanticDimensions": context.get("dimensions", []),
        "businessRules": context.get("businessRules", []),
        "semanticVersion": context["semanticVersion"],
        "schemaVersion": context["schemaVersion"],
    }


class DatasetKnowledge:
    def __init__(self, warehouse_id, dataset_id, dialect, context):
        root = Path(os.getenv("KNOWLEDGE_ROOT", ".local/knowledge")).absolute()
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.scope = root / _hash([warehouse_id, dataset_id, dialect])
        self.scope.mkdir(exist_ok=True, mode=0o700)
        self.dataset_id = dataset_id
        self.context = context
        self.dialect = dialect
        self.model = os.getenv("KNOWLEDGE_EMBEDDING_MODEL", "embeddinggemma:300m")
        self.manifest = _manifest(context)
        self.fingerprint = _hash([self.manifest, context.get("examples", []), self.model])

    def _state(self):
        path = self.scope / "state.json"
        return json.loads(path.read_text()) if path.exists() else None

    def _write(self, state):
        temporary = self.scope / ("state-" + uuid4().hex + ".tmp")
        temporary.write_text(json.dumps(state, ensure_ascii=False))
        temporary.chmod(0o600)
        temporary.replace(self.scope / "state.json")

    def status(self):
        with _LOCK:
            state = self._state()
            current = bool(state and state.get("fingerprint") == self.fingerprint)
            return {
                "datasetId": self.dataset_id,
                "status": "EMPTY" if not state else "READY" if current else "STALE",
                "schemaItems": state.get("schemaItems", 0) if state else 0,
                "exampleCount": state.get("exampleCount", 0) if state else 0,
                "embeddingModel": self.model,
                "indexedAt": state.get("indexedAt") if state else None,
                "semanticVersion": self.context["semanticVersion"],
                "schemaVersion": self.context["schemaVersion"],
                "error": None,
            }

    def _memory(self, state):
        generation = state.get("generation", "")
        if not generation.isalnum():
            raise KnowledgeError("Invalid persisted knowledge state.")
        return WrenMemory(path=self.scope / generation, embedding_function=LocalEmbeddings())

    def index(self):
        with _LOCK:
            from wren.memory.schema_indexer import extract_schema_items

            if len(extract_schema_items(self.manifest)) > 10000:
                raise KnowledgeError("Dataset exceeds the 10000-item index limit.")
            previous = self._state()
            if (
                not previous
                and sum(
                    (item / "state.json").is_file()
                    for item in self.scope.parent.iterdir()
                    if item.is_dir()
                )
                >= 128
            ):
                raise KnowledgeError("The configured knowledge index quota is full.")
            generation = uuid4().hex
            state = {"fingerprint": self.fingerprint, "generation": generation}
            try:
                retained = []
                if previous and previous.get("fingerprint") == self.fingerprint:
                    previous_memory = self._memory(previous)
                    rows, _ = previous_memory._store.list_queries(limit=1000)
                    retained = [row for row in rows if row.get("tags") == "approved-query"]
                    del previous_memory
                memory = self._memory(state)
                result = memory.index_manifest(self.manifest, replace=True, seed_queries=False)
                examples = self.context.get("examples", [])
                if len(examples) > 200:
                    raise KnowledgeError("Dataset exceeds the curated example limit.")
                for example in examples:
                    if example["sqlDialect"] == self.dialect:
                        memory.store_query(
                            example["question"],
                            example["sql"],
                            datasource=self.dialect,
                            tags="semantic-config",
                        )
                # Retain approvals only when every physical/semantic input is identical.
                # Changed metadata must be re-approved by Java, never blindly copied.
                configured = {
                    (entry["question"], entry["sql"])
                    for entry in examples
                    if entry["sqlDialect"] == self.dialect
                }
                retained = [
                    row for row in retained if (row["nl_query"], row["sql_query"]) not in configured
                ]
                for row in retained:
                    memory.store_query(
                        row["nl_query"],
                        row["sql_query"],
                        datasource=self.dialect,
                        tags="approved-query",
                    )
                state.update(
                    schemaItems=result["schema_items"],
                    exampleCount=sum(e["sqlDialect"] == self.dialect for e in examples)
                    + len(retained),
                    indexedAt=datetime.now(timezone.utc).isoformat(),
                )
                del memory
                self._write(state)
                if previous and previous.get("generation", "").isalnum():
                    shutil.rmtree(self.scope / previous["generation"], ignore_errors=True)
                return self.status()
            except Exception:
                shutil.rmtree(self.scope / generation, ignore_errors=True)
                raise KnowledgeError(
                    "Local knowledge indexing failed; the previous index was retained."
                ) from None

    def _current(self):
        state = self._state()
        if not state or state.get("fingerprint") != self.fingerprint:
            raise KnowledgeError(
                "The knowledge index is empty or stale; rebuild it for this dataset."
            )
        return state

    @staticmethod
    def _entry(row):
        return {
            "entryId": _hash([row["nl_query"], row["sql_query"], row["datasource"]]),
            "question": row["nl_query"],
            "sql": row["sql_query"],
            "sqlDialect": row["datasource"],
            "source": row.get("tags", "approved-query"),
        }

    def examples(self):
        with _LOCK:
            state = self._current()
            memory = self._memory(state)
            rows, total = memory._store.list_queries(limit=1000)
            return {"items": [self._entry(row) for row in rows], "total": total}

    def search(self, question, limit=8):
        if not question.strip() or len(question) > 1000 or not 1 <= limit <= 20:
            raise KnowledgeError("Invalid knowledge search.")
        with _LOCK:
            state = self._current()
            memory = self._memory(state)
            result = memory.get_context(self.manifest, question, limit=limit, threshold=0)
            return {
                "strategy": "vector",
                "question": question,
                "embeddingModel": self.model,
                "hits": [
                    {
                        "itemType": item["item_type"],
                        "name": item["item_name"],
                        "modelName": item["model_name"],
                        "text": item["text"],
                        "distance": float(item.get("_distance", 0)),
                    }
                    for item in result.get("results", [])
                ],
                "examples": [
                    self._entry(row)
                    for row in memory.recall_queries(
                        question, limit=min(limit, 5), datasource=self.dialect
                    )
                ],
            }

    def remember(self, example):
        with _LOCK:
            state = self._current()
            memory = self._memory(state)
            existing, _ = memory._store.list_queries(limit=1000)
            entry_id = _hash([example["question"], example["sql"], self.dialect])
            if not any(self._entry(row)["entryId"] == entry_id for row in existing):
                if len(existing) >= 1000:
                    raise KnowledgeError("The dataset query memory is full.")
                memory.store_query(
                    example["question"],
                    example["sql"],
                    datasource=self.dialect,
                    tags="approved-query",
                )
                state["exampleCount"] += 1
                self._write(state)
            return self.examples()

    def forget(self, entry_id):
        with _LOCK:
            state = self._current()
            memory = self._memory(state)
            rows, _ = memory._store.list_queries(limit=1000)
            indexes = [row["_row_id"] for row in rows if self._entry(row)["entryId"] == entry_id]
            deleted = memory._store.forget_queries_by_ids(indexes)
            state["exampleCount"] = max(0, state["exampleCount"] - deleted)
            self._write(state)
            return self.examples()

    def reset(self):
        with _LOCK:
            shutil.rmtree(self.scope, ignore_errors=True)
            return self.status()
