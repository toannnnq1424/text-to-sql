import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import Candidate, Context, Input, SemanticContextSelector, app

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "test-service-secret-token-with-minimum-32-characters"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PYTHON_AI_TOKEN", TOKEN)
    return TestClient(app)


def payload(engine="POSTGRESQL"):
    suffix = {"POSTGRESQL": "postgresql", "MYSQL": "mysql", "SQL_SERVER": "mssql"}[engine]
    ctx = json.loads((ROOT / f"data/chinook/semantic-{suffix}.json").read_text())
    ctx["tables"] = [
        {
            "schema": "public",
            "name": "track",
            "columns": [{"name": "track_id", "dataType": "INTEGER"}],
        }
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


def test_invalid_mode(client):
    assert (
        client.post("/internal/v1/text-to-sql", json=payload(), headers=headers("FAKE")).status_code
        == 400
    )


def test_budget_rejects_incomplete_context(monkeypatch):
    monkeypatch.setenv("LLM_CONTEXT_CHARS", "100")
    with pytest.raises(Exception):
        SemanticContextSelector().select(Input.model_validate(payload()))


@pytest.mark.parametrize("engine", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
def test_full_evaluation_examples(client, engine):
    body = payload(engine)
    for example in body["semanticContext"]["examples"]:
        body["question"] = example["question"]
        response = client.post("/internal/v1/text-to-sql", json=body, headers=headers())
        assert response.status_code == 200, (engine, example["question"], response.text)
