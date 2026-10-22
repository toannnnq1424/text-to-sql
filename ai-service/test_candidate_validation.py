import pytest

from candidate_validation import InvalidAggregation, validate_aggregation

TOKEN = "candidate-repair-tests-token-at-least-32-characters"

CONTEXT = {
    "tables": [
        {
            "schema": "analytics",
            "name": "observations",
            "columns": [
                {"name": "station", "dataType": "STRING"},
                {"name": "temperature", "dataType": "DECIMAL"},
                {"name": "quantity", "dataType": "INTEGER"},
                {"name": "observed_at", "dataType": "TIMESTAMP"},
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


@pytest.mark.parametrize("dialect", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
@pytest.mark.parametrize(
    "sql",
    [
        "SELECT station, SUM(quantity) AS n FROM analytics.observations GROUP BY station ORDER BY n DESC",
        "SELECT station, SUM(quantity) AS n FROM analytics.observations GROUP BY station,sensor_id ORDER BY n DESC",
        "SELECT station, SUM(quantity) AS n FROM analytics.observations GROUP BY station,sensor_id ORDER BY n DESC,sensor_id DESC",
        "SELECT station, SUM(quantity) AS n FROM analytics.observations GROUP BY station,sensor_id ORDER BY sensor_id ASC,n DESC",
    ],
)
def test_explicit_authorized_key_tiebreak_does_not_merge_duplicate_display_names(sql, dialect):
    from copy import deepcopy

    context = deepcopy(CONTEXT)
    context["tables"][0]["primaryKey"] = ["sensor_id"]
    context["tables"][0]["columns"].append({"name": "sensor_id", "dataType": "BIGINT"})
    with pytest.raises(InvalidAggregation, match="primary key"):
        validate_aggregation(
            sql,
            dialect,
            context,
            question="Rank station names and break ties by sensor_id ascending",
        )


@pytest.mark.parametrize("dialect", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
@pytest.mark.parametrize("direction", ["ASC", "DESC"])
def test_explicit_key_grouping_order_can_preserve_key_without_extra_output(dialect, direction):
    from copy import deepcopy

    context = deepcopy(CONTEXT)
    context["tables"][0]["primaryKey"] = ["sensor_id"]
    context["tables"][0]["columns"].append({"name": "sensor_id", "dataType": "BIGINT"})
    validate_aggregation(
        "SELECT o.station,SUM(o.quantity) AS n FROM analytics.observations o "
        "GROUP BY o.station,o.sensor_id ORDER BY n DESC,o.sensor_id " + direction,
        dialect,
        context,
        question="Rank station names; break ties by sensor_id " + direction.lower(),
    )


def test_unconfigured_key_and_no_explicit_tiebreak_do_not_invent_entity_identity():
    sql = "SELECT station,SUM(quantity) AS n FROM analytics.observations GROUP BY station ORDER BY n DESC"
    validate_aggregation(sql, "POSTGRESQL", CONTEXT, question="break ties by unknown_id ascending")
    validate_aggregation(sql, "POSTGRESQL", CONTEXT, question="Show totals by station")


@pytest.mark.parametrize("dialect", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
def test_explicit_physical_measure_cannot_be_silently_replaced_with_row_count(dialect):
    sql = (
        "SELECT DATE(observed_at) AS observed_day, COUNT(*) AS record_count "
        "FROM analytics.observations GROUP BY observed_day"
    )
    with pytest.raises(InvalidAggregation, match="SUM.*temperature"):
        validate_aggregation(
            sql,
            dialect,
            CONTEXT,
            question="Xu hướng tổng temperature theo ngày của observed_at",
        )


@pytest.mark.parametrize(
    ("question", "sql"),
    [
        (
            "Xu hướng tổng temperature theo ngày của observed_at",
            "SELECT DATE(observed_at) AS observed_day, SUM(temperature) AS total_temperature "
            "FROM analytics.observations GROUP BY observed_day",
        ),
        (
            "Average temperature by observed_at",
            "SELECT DATE(observed_at) AS observed_day, AVG(temperature) AS average_temperature "
            "FROM analytics.observations GROUP BY observed_day",
        ),
        (
            "Tong temperature by observed_at",
            "SELECT DATE(observed_at) AS observed_day, SUM(temperature) AS total_temperature "
            "FROM analytics.observations GROUP BY observed_day",
        ),
    ],
)
def test_explicit_physical_aggregate_is_supported_without_semantic_definitions(question, sql):
    validate_aggregation(sql, "POSTGRESQL", CONTEXT, question=question)


def test_explicit_key_alias_and_filter_literal_do_not_cause_false_positive():
    from copy import deepcopy

    context = deepcopy(CONTEXT)
    context["tables"][0]["primaryKey"] = ["sensor_id"]
    context["tables"][0]["columns"].append({"name": "sensor_id", "dataType": "INTEGER"})
    validate_aggregation(
        "SELECT station,sensor_id AS identity,SUM(quantity) AS n "
        "FROM analytics.observations GROUP BY station,sensor_id ORDER BY n DESC,identity ASC",
        "POSTGRESQL",
        context,
        question="Rank station names; break ties by sensor_id ascending",
    )
    validate_aggregation(
        "SELECT station,SUM(quantity) AS n FROM analytics.observations "
        "WHERE station = 'break ties by sensor_id ascending' GROUP BY station",
        "POSTGRESQL",
        context,
        question="Group by station where station = 'break ties by sensor_id ascending'",
    )


def test_nested_ordering_and_composite_or_ambiguous_keys_are_not_guessed():
    from copy import deepcopy

    context = deepcopy(CONTEXT)
    context["tables"][0]["primaryKey"] = ["sensor_id"]
    context["tables"][0]["columns"].append({"name": "sensor_id", "dataType": "INTEGER"})
    validate_aggregation(
        "WITH grouped AS (SELECT station,sensor_id,SUM(quantity) AS n "
        "FROM analytics.observations GROUP BY station,sensor_id) "
        "SELECT station,n FROM grouped ORDER BY n DESC,sensor_id ASC",
        "POSTGRESQL",
        context,
        question="Rank station names; break ties by sensor_id ascending",
    )
    sql = "SELECT station,SUM(quantity) AS n FROM analytics.observations GROUP BY station"
    context["tables"][0]["primaryKey"] = ["sensor_id", "station"]
    validate_aggregation(sql, "POSTGRESQL", context, question="break ties by sensor_id ascending")
    context["tables"][0]["primaryKey"] = ["sensor_id"]
    context["tables"].append({**context["tables"][0], "schema": "other"})
    validate_aggregation(sql, "POSTGRESQL", context, question="break ties by sensor_id ascending")


@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from app import app

    monkeypatch.setenv("PYTHON_AI_TOKEN", TOKEN)
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


def answer(sql, chart=None):
    import json

    chart_recommendation = chart or {
        "type": "bar",
        "x": "station",
        "title": "Average by station",
        "series": [{"column": "average_temperature", "label": "Average"}],
    }
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
                            "chartRecommendation": chart_recommendation,
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
            "Authorization": f"Bearer {TOKEN}",
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


def test_explicit_primary_key_intent_uses_same_bounded_correction_path(client):
    import json

    import httpx

    from app import app

    calls = []
    invalid = (
        "SELECT station,AVG(temperature) AS average_temperature "
        "FROM analytics.observations GROUP BY station ORDER BY average_temperature DESC"
    )
    valid = (
        "SELECT station,AVG(temperature) AS average_temperature "
        "FROM analytics.observations GROUP BY station,sensor_id "
        "ORDER BY average_temperature DESC,sensor_id ASC"
    )

    def provider(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json=answer(invalid if len(calls) == 1 else valid))

    app.state.provider_transport = httpx.MockTransport(provider)
    body = request_body()
    table = body["semanticContext"]["tables"][0]
    table["primaryKey"] = ["sensor_id"]
    table["columns"] = [*table["columns"], {"name": "sensor_id", "dataType": "INTEGER"}]
    body["question"] = (
        "Rank station names by average temperature; break ties by sensor_id ascending"
    )
    response = client.post(
        "/internal/v1/text-to-sql",
        json=body,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "X-Correlation-ID": "aggregate-repair",
            "X-Execution-Mode": "API",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["sql"] == valid and len(calls) == 2
    assert calls[0]["messages"][:2] == calls[1]["messages"][:2]
    assert "primary key" in calls[1]["messages"][-1]["content"]


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


def test_generation_budget_allows_configured_local_model_latency(monkeypatch):
    from app import generation_budget

    monkeypatch.setenv("LLM_TIMEOUT_MS", "55000")
    assert generation_budget() == 50


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


def test_wrong_physical_measure_is_corrected_before_candidate_is_returned(client):
    import json

    import httpx

    from app import app

    body = request_body()
    body["question"] = "Xu hướng tổng temperature theo ngày của observed_at"
    missing_measure = (
        "SELECT DATE(observed_at) AS observed_day, COUNT(*) AS record_count "
        "FROM analytics.observations GROUP BY observed_day"
    )
    correct_measure = (
        "SELECT DATE(observed_at) AS observed_day, SUM(temperature) AS total_temperature "
        "FROM analytics.observations GROUP BY observed_day"
    )
    calls = []

    def provider(request):
        calls.append(json.loads(request.content))
        if len(calls) == 1:
            sql = missing_measure
            column = "record_count"
            label = "Records"
        else:
            sql = correct_measure
            column = "total_temperature"
            label = "Total temperature"
        return httpx.Response(
            200,
            json=answer(
                sql,
                {
                    "type": "line",
                    "x": "observed_day",
                    "title": "Temperature trend",
                    "series": [{"column": column, "label": label}],
                },
            ),
        )

    app.state.provider_transport = httpx.MockTransport(provider)
    response = client.post(
        "/internal/v1/text-to-sql",
        json=body,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "X-Correlation-ID": "aggregate-repair",
            "X-Execution-Mode": "API",
        },
    )
    assert response.status_code == 200, response.text
    assert len(calls) == 2
    assert "SUM(temperature)" in response.json()["sql"]
    assert "SUM" in calls[1]["messages"][-1]["content"]
    assert "temperature" in calls[1]["messages"][-1]["content"]


@pytest.mark.parametrize("dialect", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
def test_low_confidence_exact_physical_aggregate_gets_one_bounded_retry(client, dialect):
    import json

    import httpx

    from app import app

    body = request_body()
    body["sqlDialect"] = dialect
    body["question"] = (
        "Xu hướng tổng temperature theo ngày của observed_at " "trong bảng analytics.observations"
    )
    corrected = (
        "SELECT DATE(observed_at) AS observed_day, "
        "SUM(temperature) AS total_temperature "
        "FROM analytics.observations GROUP BY observed_day"
    )
    calls = []

    def provider(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            content = json.dumps({"error": "LOW_CONFIDENCE"})
        else:
            content = answer(
                corrected,
                {
                    "type": "line",
                    "x": "observed_day",
                    "title": "Temperature trend",
                    "series": [{"column": "total_temperature", "label": "Total temperature"}],
                },
            )["choices"][0]["message"]["content"]
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": content}}], "model": "local-test-model"},
        )

    app.state.provider_transport = httpx.MockTransport(provider)
    response = client.post(
        "/internal/v1/text-to-sql",
        json=body,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "X-Correlation-ID": "aggregate-repair",
            "X-Execution-Mode": "API",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["sql"] == corrected
    assert len(calls) == 2
    assert calls[0]["messages"][:2] == calls[1]["messages"][:2]
    assert "Missing business metric definitions do not make" in calls[1]["messages"][-1]["content"]
    assert '"measure": "temperature"' in calls[1]["messages"][-1]["content"]


def test_low_confidence_without_explicit_physical_aggregate_is_not_retried(client):
    import json

    import httpx

    from app import app

    calls = []

    def provider(request):
        calls.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps({"error": "LOW_CONFIDENCE"})}}],
                "model": "local-test-model",
            },
        )

    app.state.provider_transport = httpx.MockTransport(provider)
    response = post(client)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "LOW_CONFIDENCE"
    assert len(calls) == 1


def test_low_confidence_retry_cannot_expand_into_a_third_request(client):
    import json

    import httpx

    from app import app

    body = request_body()
    body["question"] = (
        "Xu hướng tổng temperature theo ngày của observed_at " "trong bảng analytics.observations"
    )
    wrong_sql = (
        "SELECT DATE(observed_at) AS observed_day, COUNT(*) AS record_count "
        "FROM analytics.observations GROUP BY observed_day"
    )
    calls = []

    def provider(request):
        calls.append(json.loads(request.content))
        if len(calls) == 1:
            content = json.dumps({"error": "LOW_CONFIDENCE"})
        else:
            content = answer(
                wrong_sql,
                {
                    "type": "line",
                    "x": "observed_day",
                    "title": "Records by day",
                    "series": [{"column": "record_count", "label": "Records"}],
                },
            )["choices"][0]["message"]["content"]
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": content}}], "model": "local-test-model"},
        )

    app.state.provider_transport = httpx.MockTransport(provider)
    response = client.post(
        "/internal/v1/text-to-sql",
        json=body,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "X-Correlation-ID": "aggregate-repair",
            "X-Execution-Mode": "API",
        },
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "INVALID_MODEL_RESPONSE"
    assert len(calls) == 2


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
