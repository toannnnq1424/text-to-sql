"""Model-backed draft proposals; mocked transport here verifies failures and privacy only."""

import json
from copy import deepcopy

import httpx
import pytest
from fastapi.testclient import TestClient

from app import app
from test_workbench import semantic_context

TOKEN = "semantic-assist-tests-service-secret-at-least-32-characters"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PYTHON_AI_TOKEN", TOKEN)
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setenv("LLM_MODEL", "local-semantic-model")
    monkeypatch.setenv("LLM_API_KEY", "private-provider-key-do-not-echo")
    monkeypatch.setenv("LLM_STRUCTURED_OUTPUT", "true")
    with TestClient(app) as client:
        yield client
    if hasattr(app.state, "provider_transport"):
        del app.state.provider_transport


def envelope(engine="POSTGRESQL"):
    return {
        "correlationId": "assist-test",
        "warehouseId": "metadata-only-warehouse",
        "datasetId": "current-dataset",
        "sqlDialect": engine,
        "semanticContext": semantic_context(),
        "instruction": "Describe the amount total and a row count; preserve configured definitions.",
    }


def proposal():
    return {
        "metrics": [
            {
                "name": "event_count",
                "description": "Count each physical event row once.",
                "expression": "COUNT(*)",
                "tableRefs": [{"schema": "analytics", "name": "events"}],
                "compatibleDimensions": ["channel"],
                "unit": "",
                "synonyms": [],
            }
        ],
        "dimensions": [],
        "businessRules": ["Confirm the row grain before using this count as a business KPI."],
        "warnings": ["Business meaning requires administrator review."],
    }


def post(client, payload=None, headers=None):
    return client.post(
        "/internal/v1/semantic-assist",
        json=payload or envelope(),
        headers=headers or {"Authorization": "Bearer " + TOKEN, "X-Correlation-ID": "assist-test"},
    )


@pytest.mark.parametrize("engine", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
def test_proposal_uses_real_client_protocol_and_source_compiler_without_activation(client, engine):
    captured = []

    def answer(request):
        captured.append(json.loads(request.content))
        return httpx.Response(
            200, json={"choices": [{"message": {"content": json.dumps(proposal())}}]}
        )

    app.state.provider_transport = httpx.MockTransport(answer)
    response = post(client, envelope(engine))
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["model"] == "local-semantic-model"
    assert data["metrics"][0]["name"] == "event_count"
    assert "category" not in data["metrics"][0]
    assert data["warnings"]
    assert set(data) == {"model", "metrics", "dimensions", "businessRules", "warnings"}
    body = captured[0]
    assert body["response_format"]["json_schema"]["name"] == "semantic_proposal"
    user = json.loads(body["messages"][1]["content"])
    assert user["sqlDialect"] == engine and user["semanticContext"]["examples"] == []
    assert set(user) == {"instruction", "sqlDialect", "semanticContext"}
    assert "private-provider-key" not in json.dumps(body)
    assert "password" not in json.dumps(user).lower()
    assert "data rows" not in json.dumps(user).lower()


@pytest.mark.parametrize(
    "mutation",
    [
        "unknown-column",
        "wrong-type",
        "write-expression",
        "unknown-field",
        "oversized-description",
        "unknown-table",
        "duplicate-name",
        "blank-description",
    ],
)
def test_invalid_drafts_fail_closed(client, mutation):
    draft = proposal()
    if mutation == "unknown-column":
        draft["metrics"][0]["expression"] = "SUM(unknown_amount)"
    elif mutation == "wrong-type":
        draft["dimensions"] = [
            {
                "name": "amount_dimension",
                "description": "Existing amount column with intentionally wrong proposed type",
                "table": {"schema": "analytics", "name": "events"},
                "column": "amount",
                "dataType": "STRING",
            }
        ]
    elif mutation == "write-expression":
        draft["metrics"][0]["expression"] = "COUNT(*); DROP TABLE analytics.events"
    elif mutation == "unknown-field":
        draft["credentials"] = "do not accept"
    elif mutation == "oversized-description":
        draft["metrics"][0]["description"] = "a" * 2001
    elif mutation == "duplicate-name":
        draft["metrics"].append(deepcopy(draft["metrics"][0]))
    elif mutation == "blank-description":
        draft["metrics"][0]["description"] = " "
    else:
        draft["metrics"][0]["tableRefs"][0]["name"] = "other_dataset_table"
    app.state.provider_transport = httpx.MockTransport(
        lambda req: httpx.Response(
            200, json={"choices": [{"message": {"content": json.dumps(draft)}}]}
        )
    )
    response = post(client)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "INVALID_MODEL_RESPONSE"
    assert "do-not-echo" not in response.text


def test_auth_correlation_and_input_privacy_reject_before_model(client):
    app.state.provider_transport = httpx.MockTransport(
        lambda request: pytest.fail("provider called before validation")
    )
    assert post(client, headers={"X-Correlation-ID": "assist-test"}).status_code == 401
    assert (
        post(
            client, headers={"Authorization": "Bearer " + TOKEN, "X-Correlation-ID": "different"}
        ).status_code
        == 400
    )
    data = envelope()
    data["password"] = "secret"
    assert post(client, data).status_code == 422
    data = envelope()
    data["instruction"] = " "
    assert post(client, data).status_code == 422
    data = envelope()
    data["instruction"] = "a" * 2001
    assert post(client, data).status_code == 422


@pytest.mark.parametrize(
    "failure,expected", [("timeout", 504), ("unavailable", 503), ("malformed", 502)]
)
def test_provider_failure_does_not_fabricate_a_draft(client, failure, expected):
    def answer(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("private backend detail", request=request)
        if failure == "unavailable":
            return httpx.Response(401, text="private upstream error")
        return httpx.Response(200, json={"choices": [{"message": {"content": "not-json"}}]})

    app.state.provider_transport = httpx.MockTransport(answer)
    response = post(client)
    assert response.status_code == expected
    assert "metrics" not in response.json()
    assert "private" not in response.text


def test_empty_semantics_still_accepts_current_schema_proposal(client):
    data = envelope()
    data["semanticContext"].update(
        {"metrics": [], "dimensions": [], "examples": [], "businessRules": []}
    )
    draft = proposal()
    draft["metrics"][0]["compatibleDimensions"] = []
    app.state.provider_transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200, json={"choices": [{"message": {"content": json.dumps(draft)}}]}
        )
    )
    response = post(client, data)
    assert response.status_code == 200
    assert response.json()["metrics"][0]["expression"] == "COUNT(*)"


def test_existing_semantics_and_new_named_definitions_validate_together(client):
    draft = proposal()
    draft["metrics"][0]["name"] = "total_value"
    draft["metrics"][0]["expression"] = "SUM(analytics.events.amount)"
    app.state.provider_transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200, json={"choices": [{"message": {"content": json.dumps(draft)}}]}
        )
    )
    before = deepcopy(envelope())
    assert post(client, before).status_code == 200
    assert before["semanticContext"]["metrics"][0]["name"] == "total_value"
