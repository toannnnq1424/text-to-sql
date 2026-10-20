"""Source-fork business/transform compilation and private workbench boundaries."""

import hashlib
from copy import deepcopy

import httpx
import pytest
import sqlglot
from fastapi.testclient import TestClient
from sqlglot import exp
from wren.nla_business import BusinessCompiler
from wren.nla_planning import DatasetPlanningError
from wren.nla_transform import TransformCompiler

import knowledge
from app import Context, Example, Input, app, recalled_example_is_valid

TOKEN = "workbench-tests-private-service-token-32-characters"
DIALECTS = ["POSTGRESQL", "MYSQL", "SQL_SERVER"]


def semantic_context():
    table = {"schema": "analytics", "name": "events"}
    dimension_table = {"schema": "analytics", "name": "channels"}
    return {
        "tables": [
            {
                **table,
                "columns": [
                    {"name": "id", "dataType": "BIGINT"},
                    {"name": "channel_id", "dataType": "BIGINT"},
                    {"name": "amount", "dataType": "DECIMAL"},
                ],
            },
            {
                **dimension_table,
                "columns": [
                    {"name": "id", "dataType": "BIGINT"},
                    {"name": "label", "dataType": "STRING"},
                ],
            },
        ],
        "metrics": [
            {
                "name": "total_value",
                "expression": "SUM(amount)",
                "tableRefs": [table],
                "compatibleDimensions": ["channel"],
            }
        ],
        "dimensions": [
            {
                "name": "channel",
                "table": dimension_table,
                "column": "label",
                "dataType": "STRING",
            }
        ],
        "relationships": [
            {
                "from": {"table": table, "column": "channel_id"},
                "to": {"table": dimension_table, "column": "id"},
                "cardinality": "MANY_TO_ONE",
            }
        ],
        "examples": [
            {
                "question": "How many events?",
                "sqlDialect": "POSTGRESQL",
                "sql": 'SELECT COUNT(*) AS count FROM "analytics"."events"',
            }
        ],
        "businessRules": ["Value measures the configured amount before adjustments."],
        "semanticVersion": "semantic-a",
        "schemaVersion": "schema-a",
        "timezone": "UTC",
        "referenceTime": "2026-10-21T00:00:00Z",
    }


def envelope(dialect="POSTGRESQL"):
    return {
        "correlationId": "workbench-test",
        "warehouseId": "authorized-warehouse",
        "datasetId": "authorized-dataset",
        "sqlDialect": dialect,
        "semanticContext": semantic_context(),
    }


def headers():
    return {"Authorization": "Bearer " + TOKEN, "X-Correlation-ID": "workbench-test"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PYTHON_AI_TOKEN", TOKEN)
    monkeypatch.setenv("KNOWLEDGE_ENABLED", "false")
    with TestClient(app) as value:
        yield value


@pytest.mark.parametrize("dialect", DIALECTS)
def test_business_compiles_typed_filters_and_safe_grain(dialect):
    result = BusinessCompiler(semantic_context(), dialect).compile(
        {
            "metrics": ["total_value"],
            "dimensions": ["channel"],
            "filters": [{"dimension": "channel", "operator": "CONTAINS", "value": "' OR 1=1"}],
            "limit": 25,
        }
    )
    read = {"POSTGRESQL": "postgres", "MYSQL": "mysql", "SQL_SERVER": "tsql"}[dialect]
    ast = sqlglot.parse_one(result["sql"], read=read)
    assert [table.name for table in ast.find_all(exp.Table)] == ["events", "channels"]
    assert ast.args["joins"][0].side == "LEFT"
    assert ast.args["group"] is not None
    assert result["selectedMetrics"] == ["total_value"]
    assert result["model"] == "semantic-compiler"
    assert "25" in ast.args["limit"].sql()
    assert any(literal.this == "' OR 1=1" for literal in ast.find_all(exp.Literal))


@pytest.mark.parametrize("cardinality", ["ONE_TO_MANY", "MANY_TO_MANY", None])
def test_business_rejects_unsafe_declared_join_grain(cardinality):
    context = semantic_context()
    context["relationships"][0]["cardinality"] = cardinality
    with pytest.raises(DatasetPlanningError):
        BusinessCompiler(context, "POSTGRESQL")


def test_business_rejects_ambiguous_parallel_foreign_keys():
    context = semantic_context()
    second = deepcopy(context["relationships"][0])
    second["from"]["column"] = "id"
    context["relationships"].append(second)
    with pytest.raises(DatasetPlanningError):
        BusinessCompiler(context, "POSTGRESQL")


@pytest.mark.parametrize(
    "expression",
    [
        "amount",
        "amount + SUM(amount)",
        "SUM(missing)",
        "SUM(amount) FROM secret.table",
        "SUM(amount) ORDER BY amount",
        "SUM(amount); DELETE FROM events",
        "(SELECT SUM(amount) FROM events)",
        "SUM(SUM(amount))",
        "SUM(amount) OVER ()",
        "pg_sleep(1)",
        "COUNT(*) /* hide injected instructions */",
    ],
)
def test_business_rejects_invalid_measure_expression(expression):
    context = semantic_context()
    context["metrics"][0]["expression"] = expression
    with pytest.raises(DatasetPlanningError):
        BusinessCompiler(context, "POSTGRESQL")


@pytest.mark.parametrize(
    "selection",
    [
        {"metrics": ["unknown"]},
        {"metrics": ["total_value", "total_value"]},
        {"metrics": ["total_value"], "limit": True},
        {"metrics": ["total_value"], "filters": [{"dimension": "missing", "operator": "EQ"}]},
        {"metrics": ["total_value"], "filters": [{"dimension": "channel", "operator": "SQL"}]},
        {
            "metrics": ["total_value"],
            "filters": [{"dimension": "channel", "operator": "IS_NULL", "value": "x"}],
        },
        {
            "metrics": ["total_value"],
            "filters": [{"dimension": "channel", "operator": "EQ", "value": float("nan")}],
        },
    ],
)
def test_business_invalid_selection_has_controlled_error(selection):
    with pytest.raises(DatasetPlanningError):
        BusinessCompiler(semantic_context(), "POSTGRESQL").compile(selection)


COLUMNS = [
    {"name": "category", "dataType": "STRING", "nullable": True},
    {"name": "amount", "dataType": "DECIMAL", "nullable": True},
]


def transform():
    return {
        "columns": [
            {"name": "category", "expression": "UPPER(category)"},
            {"name": "total", "expression": "SUM(amount)"},
        ],
        "filter": "amount >= 1",
        "groupBy": ["UPPER(category)"],
    }


@pytest.mark.parametrize("dialect", DIALECTS)
def test_transform_compiles_independent_layer_schema(dialect):
    result = TransformCompiler.compile(COLUMNS, transform(), dialect)
    read = {"POSTGRESQL": "postgres", "MYSQL": "mysql", "SQL_SERVER": "tsql"}[dialect]
    ast = sqlglot.parse_one(result["sql"], read=read)
    assert result["names"] == ["category", "total"]
    assert [table.name for table in ast.find_all(exp.Table)] == ["__nla_input"]
    assert ast.args["where"] is not None
    assert ast.args["group"] is not None


@pytest.mark.parametrize(
    "expression",
    [
        "SUM(amount) + amount",
        "SUM(SUM(amount))",
        "SUM(amount) OVER ()",
        "SUM(amount) FROM other",
        "SUM(amount) LIMIT 1",
        "SUM(amount); DROP TABLE events",
        "SUM(amount) AS injected",
        "SUM(secret.amount)",
        "SUM(unknown)",
        "LOAD_FILE('/private')",
        "pg_read_file('/private')",
        "(SELECT amount FROM other)",
        "*",
        "SUM(amount) /* explanation */",
    ],
)
def test_transform_rejects_invalid_projection(expression):
    body = transform()
    body["columns"][1]["expression"] = expression
    with pytest.raises(DatasetPlanningError):
        TransformCompiler.compile(COLUMNS, body, "POSTGRESQL")


def test_transform_rejects_missing_grouping_and_aggregate_filters():
    body = transform()
    body["groupBy"] = []
    with pytest.raises(DatasetPlanningError):
        TransformCompiler.compile(COLUMNS, body, "MYSQL")
    body = transform()
    body["filter"] = "SUM(amount) > 1"
    with pytest.raises(DatasetPlanningError):
        TransformCompiler.compile(COLUMNS, body, "SQL_SERVER")
    body = transform()
    body["groupBy"] = ["SUM(amount)"]
    with pytest.raises(DatasetPlanningError):
        TransformCompiler.compile(COLUMNS, body, "POSTGRESQL")


@pytest.mark.parametrize("dialect", DIALECTS)
def test_private_routes_accept_json_enum_and_reject_unknown_filter(client, dialect):
    response = client.post(
        "/internal/v1/business-validate", headers=headers(), json=envelope(dialect)
    )
    assert response.status_code == 200, response.text
    response = client.post(
        "/internal/v1/business-plan",
        headers=headers(),
        json={
            **envelope(dialect),
            "selection": {"metrics": ["total_value"], "dimensions": ["channel"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["model"] == "semantic-compiler"
    response = client.post(
        "/internal/v1/business-plan",
        headers=headers(),
        json={
            **envelope(dialect),
            "selection": {
                "metrics": ["total_value"],
                "filters": [{"dimension": "typo", "operator": "EQ", "value": "x"}],
            },
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "SEMANTIC_MODEL_INVALID"
    response = client.post(
        "/internal/v1/transform-plan",
        headers=headers(),
        json={
            "correlationId": "workbench-test",
            "sqlDialect": dialect,
            "columns": COLUMNS,
            "transform": transform(),
        },
    )
    assert response.status_code == 200, response.text


def test_private_workbench_auth_and_correlation(client):
    for path in ["business-plan", "transform-plan", "knowledge/status"]:
        assert client.post("/internal/v1/" + path, json=envelope()).status_code == 401
    response = client.post(
        "/internal/v1/business-validate",
        headers={**headers(), "X-Correlation-ID": "wrong"},
        json=envelope(),
    )
    assert response.status_code == 400


def test_recalled_sql_is_replanned_against_current_physical_allowlist():
    request = Input.model_validate({**envelope(), "question": "Count events"})
    assert recalled_example_is_valid(
        Example(
            question="Count",
            sqlDialect="POSTGRESQL",
            sql='SELECT COUNT(*) AS n FROM "analytics"."events"',
        ),
        request,
    )
    assert not recalled_example_is_valid(
        Example(
            question="Missing",
            sqlDialect="POSTGRESQL",
            sql='SELECT missing FROM "analytics"."events"',
        ),
        request,
    )
    assert not recalled_example_is_valid(
        Example(question="Other", sqlDialect="POSTGRESQL", sql="SELECT * FROM private.secrets"),
        request,
    )
    assert not recalled_example_is_valid(
        Example(question="Write", sqlDialect="POSTGRESQL", sql="DELETE FROM analytics.events"),
        request,
    )


class FixedEmbeddings:
    """Tests use deterministic vectors with the actual SDK/LanceDB storage path."""

    def compute_source_embeddings(self, texts):
        return [
            [(value + 1) / 256 for value in hashlib.sha256(text.encode()).digest()]
            for text in texts
        ]

    def compute_query_embeddings(self, query):
        return self.compute_source_embeddings([query] if isinstance(query, str) else query)


@pytest.fixture
def memory(monkeypatch, tmp_path):
    monkeypatch.setenv("KNOWLEDGE_ROOT", str(tmp_path))
    monkeypatch.setattr(knowledge, "LocalEmbeddings", FixedEmbeddings)
    return knowledge.DatasetKnowledge("warehouse", "dataset", "POSTGRESQL", semantic_context())


def test_source_kit_lancedb_index_search_approvals_and_reset(memory):
    assert memory.status()["status"] == "EMPTY"
    status = memory.index()
    assert status["status"] == "READY"
    assert status["schemaItems"] == 11
    assert status["exampleCount"] == 1
    results = memory.search("channel amount", 20)
    assert results["strategy"] == "vector"
    assert {item["itemType"] for item in results["hits"]} >= {
        "metric",
        "dimension",
        "business_rule",
        "relationship",
    }
    assert len(results["examples"]) == 1
    example = {
        "question": "Approved actual query",
        "sql": "SELECT COUNT(*) FROM analytics.channels",
    }
    approved = memory.remember(example)
    assert approved["total"] == 2
    assert memory.remember(example)["total"] == 2
    stable = next(
        item["entryId"] for item in approved["items"] if item["source"] == "approved-query"
    )
    assert memory.index()["exampleCount"] == 2
    assert memory.forget(stable)["total"] == 1
    assert memory.reset()["status"] == "EMPTY"
    assert memory.index()["status"] == "READY"


def test_knowledge_dataset_isolation_and_stale_version(memory):
    memory.index()
    other = knowledge.DatasetKnowledge("other", "dataset", "POSTGRESQL", semantic_context())
    assert other.status()["status"] == "EMPTY"
    different_dialect = knowledge.DatasetKnowledge(
        "warehouse", "dataset", "MYSQL", semantic_context()
    )
    assert different_dialect.status()["status"] == "EMPTY"
    changed = semantic_context()
    changed["semanticVersion"] = "semantic-b"
    stale = knowledge.DatasetKnowledge("warehouse", "dataset", "POSTGRESQL", changed)
    assert stale.status()["status"] == "STALE"
    with pytest.raises(knowledge.KnowledgeError):
        stale.search("channel")
    assert stale.index()["semanticVersion"] == "semantic-b"
    assert memory.status()["status"] == "STALE"


def test_failed_index_rebuild_retains_previous_generation(memory, monkeypatch):
    memory.index()
    before = memory._state()

    def broken(self, texts):
        raise RuntimeError("provider failure including sensitive details")

    monkeypatch.setattr(FixedEmbeddings, "compute_source_embeddings", broken)
    with pytest.raises(knowledge.KnowledgeError) as error:
        memory.index()
    assert "sensitive" not in str(error.value)
    assert memory._state() == before
    assert memory.status()["status"] == "READY"


def test_knowledge_private_api_uses_real_store_and_controlled_errors(client, memory):
    response = client.post("/internal/v1/knowledge/status", headers=headers(), json=envelope())
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "EMPTY"
    response = client.post("/internal/v1/knowledge/index", headers=headers(), json=envelope())
    assert response.status_code == 200, response.text
    response = client.post(
        "/internal/v1/knowledge/search",
        headers=headers(),
        json={**envelope(), "question": "channel"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["hits"]
    response = client.post("/internal/v1/knowledge/remember", headers=headers(), json=envelope())
    assert response.status_code == 422
    response = client.post("/internal/v1/knowledge/reset", headers=headers(), json=envelope())
    assert response.status_code == 200
    assert response.json()["status"] == "EMPTY"


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://remote.example/v1",
        "http://localhost:11434/v1?secret=x",
        "http://user:pass@localhost:11434/v1",
        "http://localhost:11434/private",
    ],
)
def test_embedding_endpoint_is_server_local_and_credential_free(monkeypatch, endpoint):
    monkeypatch.setenv("KNOWLEDGE_EMBEDDING_URL", endpoint)
    with pytest.raises(knowledge.KnowledgeError):
        knowledge.LocalEmbeddings()


def test_generation_retrieves_actual_memory_and_revalidates_examples(client, memory, monkeypatch):
    monkeypatch.setenv("KNOWLEDGE_ENABLED", "true")
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setenv("LLM_MODEL", "local-test-model")
    monkeypatch.setenv("LLM_API_KEY", "local-test-key")
    captured = []

    def provider(request):
        captured.append(request.content.decode())
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": '{"sql":"SELECT COUNT(*) AS n FROM analytics.events","explanation":"Count configured events","assumptions":[],"selectedMetrics":[],"selectedDimensions":[],"chartRecommendation":{"type":"number","title":"Event count","series":[{"column":"n","label":"Count"}]},"confidence":0.95,"model":"local-test-model"}'
                        }
                    }
                ]
            },
        )

    app.state.provider_transport = httpx.MockTransport(provider)
    try:
        response = client.post(
            "/internal/v1/text-to-sql",
            json={**envelope(), "question": "How many events?"},
            headers={**headers(), "X-Execution-Mode": "API"},
        )
        assert response.status_code == 200, response.text
        assert captured and "How many events?" in captured[0]
        assert "analytics" in captured[0]
        # Generation auto-indexed the exact authorized envelope into actual LanceDB.
        status = client.post("/internal/v1/knowledge/status", headers=headers(), json=envelope())
        assert status.json()["status"] == "READY"
    finally:
        del app.state.provider_transport


def test_deterministic_never_initializes_embeddings(client, monkeypatch):
    monkeypatch.setenv("KNOWLEDGE_ENABLED", "true")
    monkeypatch.setattr(
        knowledge.DatasetKnowledge,
        "index",
        lambda self: pytest.fail("embedding used in deterministic mode"),
    )
    response = client.post(
        "/internal/v1/text-to-sql",
        json={**envelope(), "question": "How many events?"},
        headers={**headers(), "X-Execution-Mode": "DETERMINISTIC"},
    )
    assert response.status_code == 200
    assert response.json()["model"] == "deterministic-semantic-examples"


def test_generation_knowledge_failure_is_explicit_and_redacted(client, monkeypatch):
    monkeypatch.setenv("KNOWLEDGE_ENABLED", "true")

    def unavailable(self):
        raise RuntimeError("private internal credential must not be returned")

    monkeypatch.setattr(knowledge.DatasetKnowledge, "index", unavailable)
    response = client.post(
        "/internal/v1/text-to-sql",
        json={**envelope(), "question": "Count events"},
        headers={**headers(), "X-Execution-Mode": "API"},
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "KNOWLEDGE_UNAVAILABLE"
    assert "credential" not in response.text


@pytest.mark.parametrize("failure", ["http", "missing", "nan", "boolean", "dimension"])
def test_embedding_adapter_rejects_malformed_or_unavailable_reply(monkeypatch, failure):
    original = httpx.Client

    def answer(request):
        if failure == "http":
            return httpx.Response(503, text="private provider trace")
        vector = [0.25] * 32
        if failure == "nan":
            # JSON non-finite vectors must fail validation, never enter LanceDB.
            return httpx.Response(200, content=b'{"data":[{"index":0,"embedding":[NaN]}]}')
        if failure == "boolean":
            vector[0] = True
        if failure == "dimension":
            vector = vector[:2]
        data = [] if failure == "missing" else [{"index": 0, "embedding": vector}]
        return httpx.Response(200, json={"data": data})

    monkeypatch.setattr(
        knowledge.httpx,
        "Client",
        lambda **kwargs: original(transport=httpx.MockTransport(answer), **kwargs),
    )
    with pytest.raises(knowledge.KnowledgeError):
        knowledge.LocalEmbeddings().compute_source_embeddings(["schema text"])
