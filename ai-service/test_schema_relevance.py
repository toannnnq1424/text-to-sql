"""Language/context regression fixtures only; no runtime question→SQL lookup or network."""

import json
from copy import deepcopy

import httpx
import pytest
from fastapi.testclient import TestClient

from app import Controlled, Input, SemanticContextSelector, app
from context_index import clear_schema_index_cache, normalize_text
from schema_relevance import AmbiguousTableReference, table_mentions

TOKEN = "readiness-ai-service-token-minimum32chars"


def table(name, schema="analytics", description="", columns=None):
    return {
        "schema": schema,
        "name": name,
        "description": description,
        "columns": columns or [{"name": "id", "dataType": "INTEGER"}],
    }


def context(tables, *, metrics=None, dimensions=None, relationships=None, examples=None):
    return {
        "tables": tables,
        "metrics": metrics or [],
        "dimensions": dimensions or [],
        "relationships": relationships or [],
        "examples": examples or [],
        "businessRules": [],
        "semanticVersion": "test-1",
        "schemaVersion": "test-1",
        "timezone": "Asia/Ho_Chi_Minh",
        "referenceTime": "2026-10-21T00:00:00Z",
    }


def body(question, definition, engine="POSTGRESQL"):
    return {
        "correlationId": "readiness-ai-test",
        "warehouseId": "test-warehouse",
        "datasetId": "test-dataset",
        "sqlDialect": engine,
        "question": question,
        "semanticContext": definition,
    }


def ref(name, schema="analytics"):
    return {"schema": schema, "name": name}


def relation(left, right, column="id"):
    return {
        "from": {"table": ref(left), "column": column},
        "to": {"table": ref(right), "column": column},
        "cardinality": "MANY_TO_ONE",
    }


def select(question, definition, engine="POSTGRESQL", offline=False):
    return SemanticContextSelector().select(
        Input.model_validate(body(question, definition, engine)), offline=offline
    )


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setenv("PYTHON_AI_TOKEN", TOKEN)
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setenv("LLM_API_KEY", "readiness-private-test-key")
    monkeypatch.setenv("LLM_MODEL", "readiness-test-model")
    monkeypatch.setenv("LLM_MAX_CONCURRENT_REQUESTS", "2")
    monkeypatch.setenv("LLM_ADMISSION_TIMEOUT_MS", "250")
    monkeypatch.setenv("KNOWLEDGE_ENABLED", "false")
    clear_schema_index_cache()
    previous = getattr(app.state, "provider_transport", None)
    yield
    if previous is not None:
        app.state.provider_transport = previous
    elif hasattr(app.state, "provider_transport"):
        delattr(app.state, "provider_transport")


@pytest.mark.parametrize(
    "text", ["Doanh thu theo vùng", "DOANH THU THEO VUNG", "doanh_thu theo-vung"]
)
def test_retrieval_folds_accents_separators_without_changing_physical_identity(text):
    assert normalize_text(text) == "doanh thu theo vung"
    original = table("ĐịaĐiểm", columns=[{"name": "Mã_Vùng", "dataType": "STRING"}])
    definition = context([original])
    selected = select("Tên ĐịaĐiểm?", definition)
    assert selected["tables"][0]["name"] == "ĐịaĐiểm"
    assert selected["tables"][0]["columns"][0]["name"] == "Mã_Vùng"
    assert definition["tables"][0] == original


@pytest.mark.parametrize("engine", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
def test_accentless_business_phrases_keep_metric_dimension_and_declared_join(engine):
    definition = context(
        [
            table(
                "fact_payment",
                columns=[
                    {"name": "amount", "dataType": "DECIMAL"},
                    {"name": "id", "dataType": "INTEGER"},
                ],
            ),
            table(
                "dim_region",
                columns=[
                    {"name": "region", "dataType": "STRING"},
                    {"name": "id", "dataType": "INTEGER"},
                ],
            ),
            table("unrelated_logs"),
        ],
        metrics=[
            {
                "name": "collected_amount",
                "description": "Tổng doanh thu",
                "expression": "SUM(analytics.fact_payment.amount)",
                "unit": "VND",
                "tableRefs": [ref("fact_payment")],
                "compatibleDimensions": ["region"],
                "synonyms": ["doanh thu"],
            }
        ],
        dimensions=[
            {
                "name": "region",
                "description": "Vùng kinh doanh",
                "table": ref("dim_region"),
                "column": "region",
                "dataType": "STRING",
                "synonyms": ["vùng"],
            }
        ],
        relationships=[relation("fact_payment", "dim_region")],
    )
    selected = select("Tong doanh thu theo vung?", definition, engine)
    assert {x["name"] for x in selected["tables"]} == {"fact_payment", "dim_region"}
    assert [x["name"] for x in selected["metrics"]] == ["collected_amount"]
    assert [x["name"] for x in selected["dimensions"]] == ["region"]
    assert selected["relationships"] == definition["relationships"]


def test_explicit_dimension_table_does_not_erase_independent_metric_anchor():
    definition = context(
        [
            table(
                "lab_result",
                columns=[
                    {"name": "fee", "dataType": "DECIMAL"},
                    {"name": "id", "dataType": "INTEGER"},
                ],
            ),
            table("Clinic"),
        ],
        metrics=[
            {
                "name": "collected_fee",
                "description": "Thu phí xét nghiệm",
                "expression": "SUM(analytics.lab_result.fee)",
                "unit": "VND",
                "tableRefs": [ref("lab_result")],
                "compatibleDimensions": [],
                "synonyms": ["thu phí"],
            }
        ],
        relationships=[relation("lab_result", "Clinic")],
    )
    selected = select("Tổng thu phí theo Clinic?", definition)
    assert {x["name"] for x in selected["tables"]} == {"lab_result", "Clinic"}
    assert len(selected["metrics"]) == 1


def test_multiple_explicit_names_keep_shorter_separate_name_but_not_subphrase():
    tables = [table("device"), table("sensor_reading"), table("sensor")]
    found = table_mentions("Compare device with sensor_reading", tables)
    assert found.positions == {0, 1}
    definition = context(tables, relationships=[relation("device", "sensor_reading")])
    selected = select("Compare device with sensor_reading", definition)
    assert {x["name"] for x in selected["tables"]} == {"device", "sensor_reading"}


@pytest.mark.parametrize(
    "question",
    [
        "How many rows in sales.orders?",
        'Có bao nhiêu dòng trong "sales"."orders"?',
        "Count [sales].[orders] rows",
    ],
)
def test_qualified_reference_selects_only_exact_schema(question):
    definition = context([table("orders", "sales"), table("orders", "archive")])
    selected = select(question, definition)
    assert [(x["schema"], x["name"]) for x in selected["tables"]] == [("sales", "orders")]


@pytest.mark.parametrize(
    "question",
    ["Count orders rows", "How many records in table orders?", "Count missing.orders rows"],
)
def test_duplicate_or_wrong_qualified_name_requires_clarification(question):
    with pytest.raises(Controlled) as error:
        select(question, context([table("orders", "sales"), table("orders", "archive")]))
    assert error.value.code == "INSUFFICIENT_CONTEXT"


@pytest.mark.parametrize(
    "question,name",
    [
        ("Count rows in albummm", "Album"),
        ("How many Alubm rows?", "Album"),
        ("Có bao nhiêu employeeee?", "Employee"),
        ("How many temperatuer records?", "temperature"),
        ("Có bao nhiêu DimCustomerr?", "DimCustomer"),
        ("Count fact_order_itmes records", "fact_order_items"),
    ],
)
def test_unique_conservative_typo_is_explicit_uncertain_assumption(question, name):
    tables = [table(name), table("unrelated_inventory")]
    resolution = table_mentions(question, tables)
    assert resolution.positions == {0}
    assert len(resolution.assumptions) == 1
    assert "approximate match" in resolution.assumptions[0]
    assert name in resolution.assumptions[0]
    selected = select(question, context(tables))
    assert [x["name"] for x in selected["tables"]] == [name]
    assert any("Identifier-resolution" in x for x in selected["businessRules"])


def test_similar_multiple_identifiers_fail_instead_of_choosing_nearest():
    with pytest.raises(AmbiguousTableReference):
        table_mentions("Count metrs records", [table("meters"), table("metres")])


@pytest.mark.parametrize(
    "question",
    [
        "How many cut rows?",
        "What is the meaning of life?",
        "Forecast next year's unknown business domain",
    ],
)
def test_unknown_or_short_names_do_not_fabricate_context(question):
    with pytest.raises(Controlled) as error:
        select(question, context([table("cat"), table("events")]))
    assert error.value.code == "UNSUPPORTED_QUESTION"


def test_filter_literal_is_not_a_table_mention():
    found = table_mentions(
        "Show Products where title = 'albummm'", [table("Products"), table("Album")]
    )
    assert found.positions == {0} and found.assumptions == ()
    found = table_mentions("Count rows in table 'albummm'", [table("Album")])
    assert found.positions == {0} and found.assumptions


def test_qualified_column_matching_another_table_name_keeps_its_authorized_table():
    tables = [
        table("sensor", columns=[{"name": "reading", "dataType": "DECIMAL"}]),
        table("reading"),
    ]
    found = table_mentions("Sum sensor.reading", tables)
    assert found.positions == {0} and not found.assumptions
    selected = select("Sum sensor.reading", context(tables))
    assert [t["name"] for t in selected["tables"]] == ["sensor"]


def test_unquoted_prose_never_concatenates_into_compound_identifier():
    found = table_mentions("Compare account owner ages", [table("account_owner_age")])
    assert not found.positions


def test_disconnected_required_tables_and_tight_budget_fail_closed(monkeypatch):
    definition = context([table("patient"), table("weather_reading")])
    with pytest.raises(Controlled) as error:
        select("Compare patient and weather_reading", definition)
    assert error.value.code == "INSUFFICIENT_CONTEXT"
    monkeypatch.setenv("LLM_REQUEST_MAX_BYTES", "1000")
    with pytest.raises(Controlled) as error:
        select("Count patient rows", definition)
    assert error.value.code == "INSUFFICIENT_CONTEXT"


def test_typo_does_not_expand_offline_support():
    with TestClient(app) as client:
        response = client.post(
            "/internal/v1/text-to-sql",
            json=body("Count albummm rows", context([table("Album")])),
            headers={
                "Authorization": "Bearer " + TOKEN,
                "X-Correlation-ID": "readiness-ai-test",
                "X-Execution-Mode": "DETERMINISTIC",
            },
        )
    assert (
        response.status_code == 422 and response.json()["error"]["code"] == "UNSUPPORTED_QUESTION"
    )


def test_actual_provider_boundary_preserves_question_and_appends_resolution_assumption():
    observed = []
    question = "Có bao nhiêu bản ghi trong bảng albummm?"
    definition = context([table("Album")])
    candidate = {
        "sql": 'SELECT COUNT(*) AS record_count FROM "analytics"."Album"',
        "explanation": "Đếm số bản ghi.",
        "assumptions": [],
        "selectedMetrics": [],
        "selectedDimensions": [],
        "chartRecommendation": {
            "type": "number",
            "title": "Số bản ghi",
            "series": [{"column": "record_count", "label": "Số bản ghi"}],
        },
        "confidence": 0.9,
        "model": "ignored",
    }

    def provider(request):
        observed.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "model": "readiness-test-model",
                "choices": [{"message": {"content": json.dumps(candidate)}}],
            },
        )

    app.state.provider_transport = httpx.MockTransport(provider)
    with TestClient(app) as client:
        response = client.post(
            "/internal/v1/text-to-sql",
            json=body(question, definition),
            headers={
                "Authorization": "Bearer " + TOKEN,
                "X-Correlation-ID": "readiness-ai-test",
                "X-Execution-Mode": "API",
            },
        )
    assert response.status_code == 200, response.text
    assert len(response.json()) == 8 and len(observed) == 1
    envelope = json.loads(observed[0]["messages"][1]["content"])
    assert envelope["question"] == question
    assert len(response.json()["assumptions"]) == 1
    assert "albummm" in response.json()["assumptions"][0]
    assert "readiness-private-test-key" not in json.dumps(observed)


def test_ambiguous_reference_never_calls_provider():
    app.state.provider_transport = httpx.MockTransport(
        lambda _: pytest.fail("Ambiguous table must not invoke model")
    )
    with TestClient(app) as client:
        response = client.post(
            "/internal/v1/text-to-sql",
            json=body(
                "Count orders rows", context([table("orders", "sales"), table("orders", "archive")])
            ),
            headers={
                "Authorization": "Bearer " + TOKEN,
                "X-Correlation-ID": "readiness-ai-test",
                "X-Execution-Mode": "API",
            },
        )
    assert (
        response.status_code == 422 and response.json()["error"]["code"] == "INSUFFICIENT_CONTEXT"
    )


def test_large_schema_selects_independent_metric_path_without_unrelated_metadata(monkeypatch):
    definition = context(
        [
            table(
                "Reading",
                columns=[
                    {"name": "value", "dataType": "DECIMAL"},
                    {"name": "id", "dataType": "INTEGER"},
                ],
            ),
            table("Station"),
        ],
        metrics=[
            {
                "name": "mean_value",
                "description": "Mean observation",
                "expression": "AVG(analytics.Reading.value)",
                "unit": "mm",
                "tableRefs": [ref("Reading")],
                "compatibleDimensions": [],
                "synonyms": ["average observation"],
            }
        ],
        relationships=[relation("Reading", "Station")],
    )
    definition["tables"].extend(
        table("unrelated_" + str(i), description="unrelated metadata") for i in range(500)
    )
    monkeypatch.setenv("LLM_REQUEST_MAX_BYTES", "15000")
    selected = select("average observation by Station", definition)
    assert {x["name"] for x in selected["tables"]} == {"Reading", "Station"}
    assert len(selected["relationships"]) == 1
    assert len(json.dumps(selected)) < 5000
