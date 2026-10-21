import pytest

from candidate_validation import InvalidAggregation, validate_aggregation

CONTEXT = {
    "tables": [
        {
            "schema": "analytics",
            "name": "observations",
            "columns": [
                {"name": "station", "dataType": "STRING"},
                {"name": "temperature", "dataType": "DECIMAL"},
                {"name": "quantity", "dataType": "INTEGER"},
            ],
        }
    ]
}


@pytest.mark.parametrize("dialect", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
@pytest.mark.parametrize(
    "sql",
    [
        "SELECT AVG(temperature) AS average_temperature, station FROM analytics.observations",
        "SELECT station, SUM(quantity) FROM analytics.observations GROUP BY temperature",
        "SELECT SUM(quantity) FROM analytics.observations ORDER BY station",
        "SELECT station, SUM(quantity) FROM analytics.observations GROUP BY station HAVING temperature > 1",
        "WITH bad AS (SELECT AVG(temperature), station FROM analytics.observations) SELECT * FROM bad",
        "SELECT station, SUM(quantity), SUM(temperature) OVER () FROM analytics.observations GROUP BY station",
    ],
)
def test_invalid_aggregate_grain_is_rejected_generically(sql, dialect):
    with pytest.raises(InvalidAggregation):
        validate_aggregation(sql, dialect, CONTEXT)


@pytest.mark.parametrize("dialect", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
@pytest.mark.parametrize(
    "sql",
    [
        "SELECT AVG(temperature) AS average_temperature, station FROM analytics.observations GROUP BY station",
        "SELECT station, temperature FROM analytics.observations",
        "SELECT station, COUNT(*) OVER () AS n FROM analytics.observations",
        "SELECT station, SUM(quantity), SUM(SUM(quantity)) OVER () AS overall FROM analytics.observations GROUP BY station",
        "SELECT SUM(quantity) FROM analytics.observations WHERE station = 'A'",
        "SELECT SUM(quantity), 1 AS constant FROM analytics.observations",
        "SELECT UPPER(station) AS s, COUNT(*) AS n FROM analytics.observations GROUP BY UPPER(station) ORDER BY n",
        "SELECT station AS s, SUM(quantity) AS n FROM analytics.observations GROUP BY s ORDER BY n",
        "SELECT station AS s, SUM(quantity) AS n FROM analytics.observations GROUP BY 1 ORDER BY n",
        "SELECT station, (SELECT COUNT(*) FROM analytics.observations) AS overall FROM analytics.observations",
        "WITH good AS (SELECT station, COUNT(*) AS n FROM analytics.observations GROUP BY station) SELECT * FROM good",
    ],
)
def test_valid_grouping_window_and_subquery_scopes_are_preserved(sql, dialect):
    validate_aggregation(sql, dialect, CONTEXT)


@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from app import app

    monkeypatch.setenv("PYTHON_AI_TOKEN", "candidate-repair-tests-token-at-least-32-characters")
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setenv("LLM_MODEL", "local-test-model")
    monkeypatch.setenv("LLM_API_KEY", "local-test-key")
    monkeypatch.setenv("KNOWLEDGE_ENABLED", "false")
    with TestClient(app) as value:
        yield value
    if hasattr(app.state, "provider_transport"):
        del app.state.provider_transport


def request_body():
    return {
        "correlationId": "aggregate-repair",
        "warehouseId": "warehouse",
        "datasetId": "dataset",
        "sqlDialect": "POSTGRESQL",
        "question": "Average temperature by station?",
        "semanticContext": {
            **CONTEXT,
            "metrics": [],
            "dimensions": [],
            "relationships": [],
            "examples": [],
            "businessRules": [],
            "semanticVersion": "1",
            "schemaVersion": "1",
            "timezone": "UTC",
            "referenceTime": "2026-10-21T00:00:00Z",
        },
    }


def answer(sql):
    import json

    return {
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {
                            "sql": sql,
                            "explanation": "Average by the requested station grain",
                            "assumptions": [],
                            "selectedMetrics": [],
                            "selectedDimensions": [],
                            "confidence": 0.9,
                            "model": "local-test-model",
                            "chartRecommendation": {
                                "type": "bar",
                                "x": "station",
                                "title": "Average by station",
                                "series": [{"column": "average_temperature", "label": "Average"}],
                            },
                        }
                    )
                }
            }
        ]
    }


def post(client):
    return client.post(
        "/internal/v1/text-to-sql",
        json=request_body(),
        headers={
            "Authorization": "Bearer candidate-repair-tests-token-at-least-32-characters",
            "X-Correlation-ID": "aggregate-repair",
            "X-Execution-Mode": "API",
        },
    )


def test_one_grouping_correction_uses_same_authorized_context_and_is_checked(client):
    import json

    import httpx

    from app import app

    calls = []
    invalid = "SELECT AVG(temperature) AS average_temperature, station FROM analytics.observations"
    valid = invalid + " GROUP BY station"

    def provider(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json=answer(invalid if len(calls) == 1 else valid))

    app.state.provider_transport = httpx.MockTransport(provider)
    response = post(client)
    assert response.status_code == 200, response.text
    assert len(calls) == 2
    assert response.json()["sql"] == valid
    assert calls[0]["messages"][:2] == calls[1]["messages"][:2]
    assert "GROUP BY" in calls[1]["messages"][-1]["content"]


@pytest.mark.parametrize("second", ["invalid", "unsafe", "provider-error"])
def test_correction_is_once_and_never_skips_validation(client, second):
    import httpx

    from app import app

    calls = []
    invalid = "SELECT AVG(temperature) AS average_temperature, station FROM analytics.observations"

    def provider(request):
        calls.append(request)
        if len(calls) == 2 and second == "provider-error":
            return httpx.Response(503, text="private provider trace")
        sql = (
            "DELETE FROM analytics.observations"
            if len(calls) == 2 and second == "unsafe"
            else invalid
        )
        return httpx.Response(200, json=answer(sql))

    app.state.provider_transport = httpx.MockTransport(provider)
    response = post(client)
    assert response.status_code in {502, 503}
    assert len(calls) == 2
    assert "private" not in response.text


def test_unsafe_first_candidate_is_not_sent_back_for_repair(client):
    import httpx

    from app import app

    calls = []

    def provider(request):
        calls.append(request)
        return httpx.Response(200, json=answer("DELETE FROM analytics.observations"))

    app.state.provider_transport = httpx.MockTransport(provider)
    assert post(client).status_code == 502
    assert len(calls) == 1


def test_first_and_correction_share_one_wall_clock_budget(client, monkeypatch):
    import asyncio

    import httpx

    from app import app

    monkeypatch.setenv("LLM_TIMEOUT_MS", "100")
    calls = []
    invalid = "SELECT AVG(temperature) AS average_temperature, station FROM analytics.observations"

    async def provider(request):
        calls.append(request)
        await asyncio.sleep(0.065)
        return httpx.Response(200, json=answer(invalid))

    app.state.provider_transport = httpx.MockTransport(provider)
    response = post(client)
    assert response.status_code == 504
    assert response.json()["error"]["code"] == "PROVIDER_TIMEOUT"
    assert len(calls) == 2


def test_aggregate_missing_chart_dimension_is_repaired_as_grain_error(client):
    import httpx

    from app import app

    calls = []
    invalid = "SELECT AVG(temperature) AS average_temperature FROM analytics.observations"
    corrected = "SELECT station, AVG(temperature) AS average_temperature FROM analytics.observations GROUP BY station"

    def provider(request):
        calls.append(request)
        return httpx.Response(200, json=answer(invalid if len(calls) == 1 else corrected))

    app.state.provider_transport = httpx.MockTransport(provider)
    response = post(client)
    assert response.status_code == 200, response.text
    assert len(calls) == 2
    assert response.json()["sql"] == corrected


def test_structured_grammar_restricts_chart_and_semantic_reference_names(client, monkeypatch):
    import json

    import httpx

    from app import app

    monkeypatch.setenv("LLM_STRUCTURED_OUTPUT", "true")
    captured = []

    def provider(request):
        captured.append(json.loads(request.content))
        return httpx.Response(
            200,
            json=answer(
                "SELECT station, AVG(temperature) AS average_temperature FROM analytics.observations GROUP BY station"
            ),
        )

    app.state.provider_transport = httpx.MockTransport(provider)
    assert post(client).status_code == 200
    schema = captured[0]["response_format"]["json_schema"]["schema"]
    assert schema["$defs"]["Chart"]["properties"]["type"]["enum"] == [
        "table",
        "number",
        "bar",
        "grouped-bar",
        "line",
        "area",
        "pie",
    ]
    assert schema["anyOf"][0]["properties"]["selectedMetrics"]["maxItems"] == 0
    assert schema["anyOf"][0]["properties"]["selectedDimensions"]["maxItems"] == 0


def test_alias_correction_receives_exact_missing_chart_reference_and_outputs(client):
    import json

    import httpx

    from app import app

    calls = []
    sql = "SELECT station AS x, AVG(temperature) AS average_temperature FROM analytics.observations GROUP BY station"

    def provider(request):
        calls.append(json.loads(request.content))
        response = answer(sql)
        if len(calls) == 2:
            candidate = json.loads(response["choices"][0]["message"]["content"])
            candidate["chartRecommendation"]["x"] = "x"
            response["choices"][0]["message"]["content"] = json.dumps(candidate)
        return httpx.Response(200, json=response)

    app.state.provider_transport = httpx.MockTransport(provider)
    response = post(client)
    assert response.status_code == 200
    assert response.json()["sql"] == sql
    assert response.json()["chartRecommendation"]["x"] == "x"
    diagnostic = calls[1]["messages"][-1]["content"]
    assert 'Actual selected output names: ["x", "average_temperature"]' in diagnostic
    assert 'Missing chart references: ["station"]' in diagnostic
