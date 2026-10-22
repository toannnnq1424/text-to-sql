import json
import os
import re
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import (
    Candidate,
    Context,
    DeterministicModelClient,
    Input,
    SemanticContextSelector,
    app,
    normalize,
    provider_payload,
    serialize_provider_payload,
)
from context_index import cached_snapshot_count, clear_schema_index_cache

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "test-service-secret-token-with-minimum-32-characters"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PYTHON_AI_TOKEN", TOKEN)
    previous_transport = getattr(app.state, "provider_transport", None)
    with TestClient(app) as test_client:
        yield test_client
    if previous_transport is None:
        if hasattr(app.state, "provider_transport"):
            delattr(app.state, "provider_transport")
    else:
        app.state.provider_transport = previous_transport


def payload(engine="POSTGRESQL"):
    suffix = {"POSTGRESQL": "postgresql", "MYSQL": "mysql", "SQL_SERVER": "mssql"}[engine]
    ctx = json.loads((ROOT / f"data/chinook/semantic-{suffix}.json").read_text())
    tables = {}
    for metric in ctx["metrics"]:
        for table_ref in metric["tableRefs"]:
            key = (table_ref["schema"], table_ref["name"])
            tables.setdefault(key, set())
    for dimension in ctx["dimensions"]:
        key = (dimension["table"]["schema"], dimension["table"]["name"])
        tables.setdefault(key, set()).add(dimension["column"])
    identifier = r'(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$#]*)'
    table_pattern = re.compile(
        rf"\b(?:FROM|JOIN)\s+(?:({identifier})\s*\.\s*)?({identifier})",
        re.IGNORECASE,
    )

    def unquote(identifier_value):
        if identifier_value[0] in {'"', "`"}:
            return identifier_value[1:-1]
        if identifier_value[0] == "[":
            return identifier_value[1:-1]
        return identifier_value

    default_schema = "dbo" if engine == "SQL_SERVER" else "public"
    for example in ctx["examples"]:
        for match in table_pattern.finditer(example["sql"]):
            schema = unquote(match.group(1)) if match.group(1) else default_schema
            name = unquote(match.group(2))
            tables.setdefault((schema, name), set())
    for schema, name in tables:
        tables[(schema, name)].add("track_id")
    ctx["tables"] = [
        {
            "schema": schema,
            "name": name,
            "columns": [{"name": column, "dataType": "STRING"} for column in sorted(columns)],
        }
        for (schema, name), columns in tables.items()
    ]
    return {
        "correlationId": "test-corr",
        "warehouseId": "w",
        "datasetId": "d",
        "sqlDialect": engine,
        "question": ctx["examples"][0]["question"],
        "semanticContext": ctx,
    }


def headers(mode="DETERMINISTIC"):
    return {
        "Authorization": "Bearer " + TOKEN,
        "X-Correlation-ID": "test-corr",
        "X-Execution-Mode": mode,
    }


@pytest.mark.parametrize("engine", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
def test_deterministic_uses_declared_dialect(client, engine):
    body = payload(engine)
    r = client.post("/internal/v1/text-to-sql", json=body, headers=headers())
    assert r.status_code == 200, r.text
    assert r.json()["sql"] == body["semanticContext"]["examples"][0]["sql"]
    assert r.json()["model"] == "deterministic-semantic-examples"


def test_no_auth(client):
    assert client.post("/internal/v1/text-to-sql", json=payload()).status_code == 401


def test_correlation_mismatch(client):
    assert (
        client.post(
            "/internal/v1/text-to-sql",
            json={**payload(), "correlationId": "different"},
            headers=headers(),
        ).status_code
        == 400
    )


def test_unsupported_not_fabricated(client):
    r = client.post(
        "/internal/v1/text-to-sql",
        json={**payload(), "question": "Delete all records"},
        headers=headers(),
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "UNSUPPORTED_QUESTION"


def test_no_context(client):
    body = payload()
    body["semanticContext"]["tables"] = []
    r = client.post("/internal/v1/text-to-sql", json=body, headers=headers())
    assert r.json()["error"]["code"] == "INSUFFICIENT_CONTEXT"


def test_api_no_key_never_falls_back(client, monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    r = client.post("/internal/v1/text-to-sql", json=payload(), headers=headers("API"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"


def test_unknown_request_fields(client):
    r = client.post(
        "/internal/v1/text-to-sql", json={**payload(), "password": "not-allowed"}, headers=headers()
    )
    assert r.status_code == 422


def test_unknown_nested_context_fields_are_rejected(client):
    body = payload()
    body["semanticContext"]["tables"][0]["connectionString"] = "must-not-be-accepted"
    response = client.post(
        "/internal/v1/text-to-sql",
        json=body,
        headers=headers(),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_unknown_sql_dialect_has_contract_error(client):
    response = client.post(
        "/internal/v1/text-to-sql",
        json={**payload(), "sqlDialect": "ORACLE"},
        headers=headers(),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "SQL_DIALECT_ERROR"


def test_invalid_mode(client):
    assert (
        client.post("/internal/v1/text-to-sql", json=payload(), headers=headers("FAKE")).status_code
        == 400
    )


def test_budget_rejects_incomplete_context(monkeypatch):
    monkeypatch.setenv("LLM_REQUEST_MAX_BYTES", "100")
    with pytest.raises(Exception):
        SemanticContextSelector().select(Input.model_validate(payload()))


@pytest.mark.parametrize("domain", ["chinook", "synthetic-support"])
def test_retrieval_reduces_serialized_prompt_vs_previous_selector(domain):
    if domain == "chinook":
        body = payload()
        body["question"] = "Tổng doanh số theo quốc gia thanh toán?"
    else:
        definition = json.loads(
            (ROOT / "ai-service/evaluation/synthetic-support.json").read_text()
        )["dialects"]["POSTGRESQL"]["semanticContext"]
        body = {
            "correlationId": "retrieval-benchmark",
            "warehouseId": "warehouse-test",
            "datasetId": "dataset-test",
            "sqlDialect": "POSTGRESQL",
            "question": "Thời gian xử lý trung bình theo danh mục là bao nhiêu?",
            "semanticContext": definition,
        }
    request = Input.model_validate(body)

    # Reproduce the previous production selector's same-dialect top-eight few-shot
    # behavior for these under-budget snapshots, then serialize its actual HTTP body.
    previous_context = request.semanticContext.model_dump(by_alias=True)
    question_terms = set(re.findall(r"\w+", normalize(request.question)))

    def previous_relevance(example):
        example_terms = set(re.findall(r"\w+", normalize(json.dumps(example, ensure_ascii=False))))
        return len(question_terms & example_terms)

    previous_context["examples"] = sorted(
        [
            example
            for example in previous_context["examples"]
            if example["sqlDialect"] == request.sqlDialect
        ],
        key=previous_relevance,
        reverse=True,
    )[:8]
    previous_body = serialize_provider_payload(request, previous_context, "benchmark-model")

    selected_context = SemanticContextSelector().select(request)
    selected_body = serialize_provider_payload(request, selected_context, "benchmark-model")

    assert len(selected_body) < len(previous_body)
    assert len(selected_context["examples"]) <= 5
    assert all(
        example["sqlDialect"] == request.sqlDialect for example in selected_context["examples"]
    )


@pytest.mark.parametrize("engine", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
def test_full_evaluation_examples(client, engine):
    body = payload(engine)
    for example in body["semanticContext"]["examples"]:
        body["question"] = example["question"]
        response = client.post("/internal/v1/text-to-sql", json=body, headers=headers())
        assert response.status_code == 200, (engine, example["question"], response.text)


@pytest.mark.parametrize(
    ("engine", "suffix"),
    [
        ("POSTGRESQL", "postgresql"),
        ("MYSQL", "mysql"),
        ("SQL_SERVER", "mssql"),
    ],
)
def test_chinook_evaluation_corpus_matches_expected_candidates(client, engine, suffix):
    corpus = json.loads((ROOT / f"data/chinook/evaluation-{suffix}.json").read_text())
    body = payload(engine)
    for case in corpus["cases"]:
        request = {**body, "question": case["question"]}
        response = client.post(
            "/internal/v1/text-to-sql",
            json=request,
            headers=headers(),
        )
        if case["expectedRejection"]:
            assert response.status_code == 422, (case["caseId"], response.text)
            assert response.json()["error"]["code"] == case.get(
                "expectedReason", "UNSUPPORTED_QUESTION"
            )
            continue
        assert response.status_code == 200, (case["caseId"], response.text)
        assert response.json()["sql"] == case["expectedSql"]
        assert response.json()["chartRecommendation"]["type"] == case["expectedChart"]


def provider_response(
    sql='SELECT COUNT(*) AS track_count FROM "public"."track"',
    selected_metrics=None,
):
    content = {
        "sql": sql,
        "explanation": "Counts tracks in the selected catalog.",
        "assumptions": [],
        "selectedMetrics": selected_metrics or [],
        "selectedDimensions": [],
        "chartRecommendation": {
            "type": "number",
            "title": "Track count",
            "series": [{"column": "track_count", "label": "Tracks"}],
        },
        "confidence": 0.95,
        "model": "provider-must-not-override-configured-name",
    }
    return {"choices": [{"message": {"content": json.dumps(content)}}]}


def enable_provider(monkeypatch, response_body=None, status=200):
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.test/v1")
    monkeypatch.setenv("LLM_API_KEY", "provider-test-secret")
    monkeypatch.setenv("LLM_MODEL", "configured-test-model")

    def handler(request):
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer provider-test-secret"
        payload = json.loads(request.content)
        assert payload["model"] == "configured-test-model"
        assert payload["temperature"] == 0
        return httpx.Response(status, json=response_body or provider_response())

    app.state.provider_transport = httpx.MockTransport(handler)


def test_qwen3_ollama_prompt_adds_no_think_without_changing_user_question(monkeypatch):
    body = payload()
    body["question"] = "Tổng YearlyIncome theo DateFirstPurchase?"
    request = Input.model_validate(body)
    monkeypatch.setenv("LLM_PROVIDER_KIND", "OLLAMA")
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:11434/v1")
    monkeypatch.setenv("LLM_MODEL", "qwen3:4b")
    monkeypatch.setenv("LLM_REASONING_EFFORT", "none")

    generated = provider_payload(
        request, request.semanticContext.model_dump(by_alias=True), "qwen3:4b"
    )

    assert generated["messages"][0]["content"].endswith("/no_think")
    user_content = json.loads(generated["messages"][1]["content"])
    assert user_content["question"] == body["question"]


def test_qwen3_no_think_switch_is_not_added_to_online_provider(monkeypatch):
    body = payload()
    request = Input.model_validate(body)
    monkeypatch.setenv("LLM_PROVIDER_KIND", "ONLINE")
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.test/v1")
    monkeypatch.setenv("LLM_API_KEY", "provider-test-secret")
    monkeypatch.setenv("LLM_MODEL", "qwen3:4b")

    generated = provider_payload(
        request, request.semanticContext.model_dump(by_alias=True), "qwen3:4b"
    )

    assert not generated["messages"][0]["content"].endswith("/no_think")


def test_provider_api_returns_strict_candidate(client, monkeypatch):
    enable_provider(monkeypatch)
    response = client.post(
        "/internal/v1/text-to-sql",
        json=payload(),
        headers=headers("API"),
    )
    assert response.status_code == 200, response.text
    assert response.json()["model"] == "configured-test-model"


def test_ollama_qwen3_disables_reasoning_by_default(monkeypatch):
    monkeypatch.delenv("LLM_REASONING_EFFORT", raising=False)
    request = Input.model_validate(payload())
    context = request.semanticContext.model_dump(by_alias=True)

    body = provider_payload(
        request,
        context,
        "qwen3:4b",
        provider_kind="OLLAMA",
    )

    assert body["reasoning_effort"] == "none"


def test_explicit_reasoning_effort_is_preserved_for_ollama_qwen3(monkeypatch):
    monkeypatch.setenv("LLM_REASONING_EFFORT", "low")
    request = Input.model_validate(payload())
    context = request.semanticContext.model_dump(by_alias=True)

    body = provider_payload(
        request,
        context,
        "qwen3:4b",
        provider_kind="OLLAMA",
    )

    assert body["reasoning_effort"] == "low"


@pytest.mark.parametrize("index_status", ["EMPTY", "STALE"])
def test_query_does_not_build_knowledge_index_inline(client, monkeypatch, index_status):
    monkeypatch.setenv("KNOWLEDGE_ENABLED", "true")

    class KnowledgeWithoutReadyIndex:
        def __init__(self, *_args):
            pass

        def status(self):
            return {"status": index_status}

        def index(self):
            pytest.fail("Query must not synchronously rebuild the dataset index")

        def search(self, _question):
            pytest.fail("Query must skip retrieval while the dataset index is not ready")

    monkeypatch.setattr("knowledge.DatasetKnowledge", KnowledgeWithoutReadyIndex)
    enable_provider(monkeypatch)

    response = client.post(
        "/internal/v1/text-to-sql",
        json=payload(),
        headers=headers("API"),
    )

    assert response.status_code == 200, response.text
    assert response.json()["model"] == "configured-test-model"


def test_query_uses_model_when_optional_knowledge_search_fails(client, monkeypatch):
    monkeypatch.setenv("KNOWLEDGE_ENABLED", "true")

    class KnowledgeSearchFailure:
        def __init__(self, *_args):
            pass

        def status(self):
            return {"status": "READY"}

        def search(self, _question):
            raise RuntimeError("private embedding endpoint detail")

    monkeypatch.setattr("knowledge.DatasetKnowledge", KnowledgeSearchFailure)
    enable_provider(monkeypatch)

    response = client.post(
        "/internal/v1/text-to-sql",
        json=payload(),
        headers=headers("API"),
    )

    assert response.status_code == 200, response.text
    assert response.json()["model"] == "configured-test-model"
    assert "private embedding endpoint detail" not in response.text


def test_provider_boundary_compacts_same_snapshot_without_losing_join_context(
    client,
    monkeypatch,
):
    body = payload()
    context = body["semanticContext"]
    body["question"] = "Tổng doanh số theo tên bản nhạc?"
    invoice = next(table for table in context["tables"] if table["name"] == "invoice")
    track = next(table for table in context["tables"] if table["name"] == "track")
    for table, logical_name, grain in (
        (invoice, "Invoice", "One row per invoice"),
        (track, "Track", "One row per track"),
    ):
        table.update(
            logicalName=logical_name,
            description=f"Physical source for {logical_name.lower()} analytics",
            grain=grain,
            primaryKey=[table["columns"][0]["name"]],
        )
        for column in table["columns"]:
            column.update(nullable=None, description="Source column", synonyms=[column["name"]])

    invoice_line = {
        "schema": "public",
        "name": "invoice_line",
        "logicalName": "Invoice line",
        "description": "Bridge from invoices to tracks",
        "grain": "One row per invoice line",
        "columns": [
            {
                "name": "invoice_id",
                "dataType": "INTEGER",
                "nullable": False,
                "description": "Invoice key",
                "synonyms": ["invoice"],
            },
            {
                "name": "track_id",
                "dataType": "INTEGER",
                "nullable": None,
                "description": "Track key",
                "synonyms": ["song"],
            },
        ],
    }
    existing_invoice_line = next(
        (table for table in context["tables"] if table["name"] == "invoice_line"),
        None,
    )
    if existing_invoice_line is None:
        context["tables"].append(invoice_line)
    else:
        existing_columns = {column["name"] for column in existing_invoice_line["columns"]}
        existing_invoice_line["columns"].extend(
            column for column in invoice_line["columns"] if column["name"] not in existing_columns
        )
    next(metric for metric in context["metrics"] if metric["name"] == "total_sales")[
        "compatibleDimensions"
    ].append("track_name")
    context["relationships"] = [
        {
            "from": {"table": {"schema": "public", "name": "invoice"}, "column": "track_id"},
            "to": {
                "table": {"schema": "public", "name": "invoice_line"},
                "column": "invoice_id",
            },
            "cardinality": "ONE_TO_MANY",
        },
        {
            "from": {
                "table": {"schema": "public", "name": "invoice_line"},
                "column": "track_id",
            },
            "to": {"table": {"schema": "public", "name": "track"}, "column": "track_id"},
            "cardinality": "MANY_TO_ONE",
        },
    ]
    for table_number in range(40):
        context["tables"].append(
            {
                "schema": "unrelated",
                "name": f"archive_{table_number}",
                "logicalName": f"Historical logistics batch {table_number}",
                "description": "Unrelated archival inventory and shipment records",
                "grain": "One row per historical shipment event",
                "columns": [
                    {
                        "name": f"shipment_attribute_{column_number}",
                        "dataType": "VARCHAR",
                        "nullable": True,
                        "description": "Unrelated shipment metadata",
                        "synonyms": ["inventory", "shipment"],
                    }
                    for column_number in range(30)
                ],
            }
        )

    monkeypatch.setenv("LLM_MODEL", "configured-test-model")
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.test/v1")
    monkeypatch.setenv("LLM_API_KEY", "provider-test-secret")
    request = Input.model_validate(body)
    complete_body = serialize_provider_payload(
        request,
        context,
        "configured-test-model",
    )

    monkeypatch.setenv("LLM_REQUEST_MAX_BYTES", "25000")
    selected = SemanticContextSelector().select(request)
    selected_body = serialize_provider_payload(request, selected, "configured-test-model")
    assert len(selected_body) < len(complete_body) * 0.1
    assert {table["name"] for table in selected["tables"]} == {
        "invoice",
        "track",
        "invoice_line",
    }
    selected_tables = {(table["schema"], table["name"]): table for table in selected["tables"]}
    assert selected_tables[("public", "invoice")]["logicalName"] == "Invoice"
    assert selected_tables[("public", "invoice")]["grain"] == "One row per invoice"
    assert selected_tables[("public", "invoice")]["columns"][0]["nullable"] is None
    assert len(selected_tables[("public", "invoice")]["columns"]) == len(invoice["columns"])
    assert len(selected["relationships"]) == 2

    observed_request: list[bytes] = []

    def handler(provider_request):
        observed_request.append(provider_request.content)
        return httpx.Response(200, json=provider_response())

    app.state.provider_transport = httpx.MockTransport(handler)
    response = client.post(
        "/internal/v1/text-to-sql",
        json=body,
        headers=headers("API"),
    )
    assert response.status_code == 200, response.text
    assert len(observed_request) == 1
    assert observed_request[0] == selected_body
    assert len(observed_request[0]) <= 25000


def test_context_cache_reuses_structure_but_sends_fresh_reference_time(client, monkeypatch):
    clear_schema_index_cache()
    body = payload()
    body["question"] = "How many tracks?"
    monkeypatch.setenv("LLM_MODEL", "configured-test-model")
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.test/v1")
    monkeypatch.setenv("LLM_API_KEY", "provider-test-secret")
    observed_times = []

    def handler(provider_request):
        payload_sent = json.loads(provider_request.content)
        user_message = json.loads(payload_sent["messages"][1]["content"])
        observed_times.append(user_message["semanticContext"]["referenceTime"])
        return httpx.Response(200, json=provider_response())

    app.state.provider_transport = httpx.MockTransport(handler)
    first_time = "2026-10-20T12:00:00Z"
    second_time = "2026-10-20T12:01:00Z"
    for reference_time in (first_time, second_time):
        body["semanticContext"]["referenceTime"] = reference_time
        response = client.post(
            "/internal/v1/text-to-sql",
            json=body,
            headers=headers("API"),
        )
        assert response.status_code == 200, response.text

    assert cached_snapshot_count() == 1
    assert observed_times == [first_time, second_time]


def test_selected_examples_keep_sql_physical_dependencies_without_semantic_tags():
    body = payload()
    context = body["semanticContext"]
    context["examples"] = [
        {
            "question": "How much invoice revenue by customer?",
            "sqlDialect": "POSTGRESQL",
            "sql": (
                "SELECT c.customer_id, SUM(i.total) AS revenue "
                'FROM "public"."invoice" i '
                'JOIN "public"."customer" c ON c.customer_id = i.customer_id '
                "GROUP BY c.customer_id"
            ),
            "selectedMetrics": [],
            "selectedDimensions": [],
        }
    ]
    body["question"] = "How much invoice revenue by customer?"
    for table_name in ("invoice", "customer"):
        table = next(table for table in context["tables"] if table["name"] == table_name)
        if "customer_id" not in {column["name"] for column in table["columns"]}:
            table["columns"].append({"name": "customer_id", "dataType": "INTEGER"})
    context["relationships"] = [
        {
            "from": {
                "table": {"schema": "public", "name": "invoice"},
                "column": "customer_id",
            },
            "to": {
                "table": {"schema": "public", "name": "customer"},
                "column": "customer_id",
            },
            "cardinality": "MANY_TO_ONE",
        }
    ]
    request = Input.model_validate(body)
    selected = SemanticContextSelector().select(request)
    assert {(table["schema"], table["name"]) for table in selected["tables"]} == {
        ("public", "invoice"),
        ("public", "customer"),
    }
    assert len(selected["relationships"]) == 1


def test_single_table_exact_example_does_not_pull_in_partial_name_matches():
    body = payload()
    body["question"] = "Có bao nhiêu bản ghi trong bảng invoice?"
    request = Input.model_validate(body)
    selected = SemanticContextSelector().select(request)
    assert {(table["schema"], table["name"]) for table in selected["tables"]} == {
        ("public", "invoice")
    }
    assert selected["metrics"] == []
    assert selected["dimensions"] == []


@pytest.mark.parametrize(
    ("sql", "code"),
    [
        ("SELECT * FROM track; DROP TABLE track", "INVALID_MODEL_RESPONSE"),
        ("SELECT pg_sleep(10)", "INVALID_MODEL_RESPONSE"),
        ("SELECT * FROM track -- comment", "INVALID_MODEL_RESPONSE"),
        ("SELECT * FROM track # hidden comment", "INVALID_MODEL_RESPONSE"),
        ("SELECT * FROM OPENROWSET('provider', 'source')", "INVALID_MODEL_RESPONSE"),
        ("SELECT * FROM `track`", "SQL_DIALECT_ERROR"),
        ("SELECT TOP (5) * FROM track", "SQL_DIALECT_ERROR"),
    ],
)
def test_provider_candidate_checks_are_enforced(client, monkeypatch, sql, code):
    enable_provider(monkeypatch, provider_response(sql))
    response = client.post(
        "/internal/v1/text-to-sql",
        json=payload(),
        headers=headers("API"),
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == code


def test_provider_error_has_no_fallback(client, monkeypatch):
    enable_provider(monkeypatch, {"error": "provider details must not leak"}, status=503)
    response = client.post(
        "/internal/v1/text-to-sql",
        json=payload(),
        headers=headers("API"),
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"
    assert "provider details" not in response.text


def test_provider_timeout_is_controlled(client, monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.test/v1")
    monkeypatch.setenv("LLM_API_KEY", "provider-test-secret")
    monkeypatch.setenv("LLM_MODEL", "configured-test-model")

    def timeout(request):
        raise httpx.ReadTimeout("private provider detail")

    app.state.provider_transport = httpx.MockTransport(timeout)
    response = client.post(
        "/internal/v1/text-to-sql",
        json=payload(),
        headers=headers("API"),
    )
    assert response.status_code == 504
    assert response.json()["error"]["code"] == "PROVIDER_TIMEOUT"
    assert "private provider detail" not in response.text


def test_malformed_provider_payload_is_sanitized(client, monkeypatch):
    enable_provider(monkeypatch, ["not", "an", "object"])
    response = client.post(
        "/internal/v1/text-to-sql",
        json=payload(),
        headers=headers("API"),
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "INVALID_MODEL_RESPONSE"


def test_invalid_provider_url_is_rejected(client, monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "https://user:password@llm.example.test/v1")
    monkeypatch.setenv("LLM_API_KEY", "provider-test-secret")
    monkeypatch.setenv("LLM_MODEL", "configured-test-model")
    response = client.post(
        "/internal/v1/text-to-sql",
        json=payload(),
        headers=headers("API"),
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"


def test_provider_declared_low_confidence_is_controlled(client, monkeypatch):
    enable_provider(
        monkeypatch, {"choices": [{"message": {"content": '{"error":"LOW_CONFIDENCE"}'}}]}
    )
    response = client.post(
        "/internal/v1/text-to-sql",
        json=payload(),
        headers=headers("API"),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "LOW_CONFIDENCE"


def test_duplicate_exact_examples_are_ambiguous():
    body = payload()
    body["semanticContext"]["examples"].append(body["semanticContext"]["examples"][0])
    request = Input.model_validate(body)
    with pytest.raises(Exception) as error:
        import anyio

        anyio.run(
            DeterministicModelClient().generate,
            request,
            SemanticContextSelector().select(request),
        )
    assert getattr(error.value, "code", None) == "LOW_CONFIDENCE"


def test_provider_candidate_cannot_select_unprovided_semantics(client, monkeypatch):
    enable_provider(monkeypatch, provider_response(selected_metrics=["total_sales"]))

    def selected_context_without_metrics(self, request):
        selected = request.semanticContext.model_dump(by_alias=True)
        selected["metrics"] = []
        return selected

    monkeypatch.setattr(
        SemanticContextSelector,
        "select",
        selected_context_without_metrics,
    )
    response = client.post(
        "/internal/v1/text-to-sql",
        json=payload(),
        headers=headers("API"),
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "INVALID_MODEL_RESPONSE"


def test_provider_prompt_excludes_warehouse_ids_and_credentials(client, monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.test/v1")
    monkeypatch.setenv("LLM_API_KEY", "provider-test-secret")
    monkeypatch.setenv("LLM_MODEL", "configured-test-model")
    captured = {}

    def handler(request):
        captured.update(json.loads(request.content))
        return httpx.Response(200, json=provider_response())

    app.state.provider_transport = httpx.MockTransport(handler)
    response = client.post(
        "/internal/v1/text-to-sql",
        json=payload(),
        headers=headers("API"),
    )
    assert response.status_code == 200, response.text
    prompt = json.dumps(captured)
    for private_value in (
        "warehouseId",
        "datasetId",
        "credentialReference",
        "connectionString",
        "test-service-secret-token",
    ):
        assert private_value not in prompt


def test_context_rejects_invalid_metric_column():
    body = payload()
    body["semanticContext"]["dimensions"][0]["column"] = "missing_column"
    with pytest.raises(ValueError):
        Input.model_validate(body)


def test_synthetic_second_domain_corpus_covers_all_dialects(client):
    suite = json.loads((ROOT / "ai-service/evaluation/synthetic-support.json").read_text())
    assert suite["synthetic"] is True
    assert set(suite["dialects"]) == {"POSTGRESQL", "MYSQL", "SQL_SERVER"}
    for dialect, definition in suite["dialects"].items():
        context = definition["semanticContext"]
        for case in definition["cases"]:
            body = {
                "correlationId": "test-corr",
                "warehouseId": "synthetic-evaluation-only",
                "datasetId": "synthetic-evaluation-only",
                "sqlDialect": dialect,
                "question": case["question"],
                "semanticContext": context,
            }
            response = client.post(
                "/internal/v1/text-to-sql",
                json=body,
                headers=headers(),
            )
            if case["expectedRejection"]:
                assert response.status_code == 422
                assert response.json()["error"]["code"] == case["expectedReason"]
                continue
            assert response.status_code == 200, (case["caseId"], response.text)
            result = response.json()
            assert result["sql"] == case["expectedSql"]
            assert result["chartRecommendation"]["type"] == case["expectedChart"]
            assert result["selectedMetrics"] == case["selectedMetrics"]
            assert result["selectedDimensions"] == case["selectedDimensions"]


def test_evaluation_inventory_has_42_logical_cases_in_two_domains():
    engines = {
        "POSTGRESQL": "postgresql",
        "MYSQL": "mysql",
        "SQL_SERVER": "mssql",
    }
    logical_cases = set()
    domains = set()
    for dialect, suffix in engines.items():
        chinook = json.loads((ROOT / f"data/chinook/evaluation-{suffix}.json").read_text())
        support = json.loads((ROOT / "ai-service/evaluation/synthetic-support.json").read_text())
        corpus_cases = chinook["cases"] + support["dialects"][dialect]["cases"]
        case_ids = set()
        languages_by_case = {}
        for case in corpus_cases:
            assert case["domain"] in {"chinook-music-store", "synthetic-support"}
            case_ids.add(case["logicalCaseId"])
            language = "en" if case["question"].isascii() else "vi"
            languages_by_case.setdefault(case["logicalCaseId"], set()).add(language)
            domains.add(case["domain"])
        assert len(case_ids) == 42
        assert all(languages == {"en", "vi"} for languages in languages_by_case.values())
        logical_cases.update(case_ids)
    assert len(logical_cases) == 42
    assert domains == {"chinook-music-store", "synthetic-support"}


@pytest.mark.skipif(
    not all(os.getenv(name) for name in ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL")),
    reason="Set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL to run the real-provider smoke test.",
)
def test_configured_real_provider_smoke(client):
    body = payload()
    response = client.post(
        "/internal/v1/text-to-sql",
        json=body,
        headers=headers("API"),
    )
    assert response.status_code == 200, response.text
    assert response.json()["sql"].lstrip().casefold().startswith(("select", "with"))
