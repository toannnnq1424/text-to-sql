from __future__ import annotations

from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app import app
from semantic_planner import PlanningFailure, PlanRequest, plan_sql


def request(engine: str) -> dict:
    schema = "dbo" if engine == "SQL_SERVER" else "public"
    source = {"POSTGRESQL": "postgres", "MYSQL": "mysql", "SQL_SERVER": "mssql"}[engine]
    sql = {
        "POSTGRESQL": 'SELECT COUNT(*) FROM public."Album"',
        "MYSQL": "SELECT COUNT(*) FROM `public`.`Album`",
        "SQL_SERVER": "SELECT COUNT(*) FROM [dbo].[Album]",
    }[engine]
    return {
        "correlationId": "plan-test-001",
        "sqlDialect": engine,
        "sql": sql,
        "manifest": {
            "catalog": "nla",
            "schema": "semantic",
            "dataSource": source,
            "models": [
                {
                    "name": "nla_model_0",
                    "tableReference": {"schema": schema, "table": "Album"},
                    "columns": [
                        {"name": "AlbumId", "type": "INTEGER"},
                        {"name": "Title", "type": "STRING"},
                        {"name": "ArtistId", "type": "INTEGER"},
                    ],
                    "primaryKey": "AlbumId",
                }
            ],
            "relationships": [],
        },
    }


@pytest.mark.parametrize("engine", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
def test_native_planner_rewrites_physical_sql_for_each_supported_dialect(engine):
    planned = plan_sql(PlanRequest.model_validate(request(engine)))

    assert planned.plannerVersion == "wren-core-py/0.4.0"
    assert planned.sourceModels == ["nla_model_0"]
    assert planned.sourceTables[0].name == "Album"
    assert "nla_model_0" not in planned.sql
    assert "WITH" not in planned.sql.upper()
    assert '"public"."Album"' in planned.sql if engine == "POSTGRESQL" else True
    assert "dbo.[Album]" in planned.sql if engine == "SQL_SERVER" else True


def test_planner_resolves_join_and_emits_both_physical_sources():
    payload = request("POSTGRESQL")
    payload["manifest"]["models"].append(
        {
            "name": "nla_model_1",
            "tableReference": {"schema": "public", "table": "Artist"},
            "columns": [{"name": "ArtistId", "type": "INTEGER"}],
            "primaryKey": "ArtistId",
        }
    )
    payload["manifest"]["relationships"] = [
        {
            "name": "fk_album_artist",
            "models": ["nla_model_1", "nla_model_0"],
            "joinType": "ONE_TO_MANY",
            "condition": 'nla_model_1."ArtistId" = nla_model_0."ArtistId"',
        }
    ]
    payload["sql"] = (
        'SELECT a."Title" FROM public."Album" a '
        'JOIN public."Artist" r ON a."ArtistId" = r."ArtistId"'
    )

    planned = plan_sql(PlanRequest.model_validate(payload))

    assert set(planned.sourceModels) == {"nla_model_0", "nla_model_1"}
    assert {table.name for table in planned.sourceTables} == {"Album", "Artist"}
    assert "WITH" not in planned.sql.upper()
    assert "JOIN" in planned.sql.upper()


def test_unknown_physical_table_fails_closed():
    payload = request("POSTGRESQL")
    payload["sql"] = "SELECT COUNT(*) FROM public.Albummm"

    with pytest.raises(PlanningFailure) as error:
        plan_sql(PlanRequest.model_validate(payload))

    assert error.value.code == "INSUFFICIENT_CONTEXT"


def test_dialect_and_manifest_mismatch_rejected():
    payload = request("MYSQL")
    payload["manifest"]["dataSource"] = "postgres"

    with pytest.raises(PlanningFailure) as error:
        plan_sql(PlanRequest.model_validate(payload))

    assert error.value.code == "SQL_DIALECT_ERROR"


def test_unknown_manifest_fields_rejected():
    payload = request("POSTGRESQL")
    payload["manifest"]["password"] = "must-not-be-accepted"
    with pytest.raises(Exception):
        PlanRequest.model_validate(payload)


def test_private_endpoint_auth_correlation_and_plan(monkeypatch):
    token = "semantic-planner-test-token-with-minimum-32-characters"
    monkeypatch.setenv("PYTHON_AI_TOKEN", token)
    with TestClient(app) as client:
        payload = request("POSTGRESQL")
        headers = {
            "Authorization": f"Bearer {token}",
            "X-Correlation-ID": payload["correlationId"],
        }
        response = client.post("/internal/v1/semantic-plan", json=payload, headers=headers)

        assert response.status_code == 200, response.text
        assert response.json()["plannerVersion"] == "wren-core-py/0.4.0"
        assert client.post("/internal/v1/semantic-plan", json=payload).status_code == 401
        mismatched = deepcopy(headers)
        mismatched["X-Correlation-ID"] = "another-id"
        assert (
            client.post("/internal/v1/semantic-plan", json=payload, headers=mismatched).status_code
            == 400
        )


@pytest.mark.parametrize("engine", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
def test_original_physical_qualifier_survives_model_alias_rewrite(engine):
    payload = request(engine)
    payload["sql"] = {
        "POSTGRESQL": 'SELECT "Album"."Title" FROM public."Album"',
        "MYSQL": "SELECT `Album`.`Title` FROM `public`.`Album`",
        "SQL_SERVER": "SELECT [Album].[Title] FROM [dbo].[Album]",
    }[engine]
    planned = plan_sql(PlanRequest.model_validate(payload))
    assert planned.sourceTables[0].name == "Album"
    assert "Title" in planned.sql


def test_distinct_quoted_postgresql_tables_keep_exact_physical_identity():
    payload = request("POSTGRESQL")
    other = deepcopy(payload["manifest"]["models"][0])
    other["name"] = "nla_model_1"
    other["tableReference"]["table"] = "album"
    payload["manifest"]["models"].append(other)
    planned = plan_sql(PlanRequest.model_validate(payload))
    assert [t.name for t in planned.sourceTables] == ["Album"]
    payload["sql"] = "SELECT COUNT(*) FROM public.album"
    planned = plan_sql(PlanRequest.model_validate(payload))
    assert [t.name for t in planned.sourceTables] == ["album"]


def test_unquoted_postgresql_case_folds_without_retargeting_quoted_table():
    payload = request("POSTGRESQL")
    other = deepcopy(payload["manifest"]["models"][0])
    other["name"] = "nla_model_1"
    other["tableReference"]["table"] = "album"
    payload["manifest"]["models"].append(other)
    payload["sql"] = "SELECT COUNT(*) FROM PUBLIC.ALBUM"
    planned = plan_sql(PlanRequest.model_validate(payload))
    assert [table.name for table in planned.sourceTables] == ["album"]


def test_qualified_physical_table_is_not_hidden_by_same_named_cte():
    payload = request("POSTGRESQL")
    payload["sql"] = 'WITH "Album" AS (SELECT 1 AS n) SELECT COUNT(*) FROM public."Album"'
    planned = plan_sql(PlanRequest.model_validate(payload))
    assert [table.name for table in planned.sourceTables] == ["Album"]


def test_full_vendored_sdk_facade_is_called_without_any_connector(monkeypatch):
    import wren.engine as sdk

    original = sdk.WrenEngine.dry_plan
    calls = []

    def traced(self, sql, properties=None):
        calls.append(sql)
        assert self.connection_info == {}
        assert self._session_context_override is not None
        assert self._config.strict_mode is True
        assert self._planning_only is True
        return original(self, sql, properties)

    def forbidden(*args, **kwargs):
        raise AssertionError("The AI planner must never create a database connector")

    monkeypatch.setattr(sdk.WrenEngine, "dry_plan", traced)
    monkeypatch.setattr(sdk, "get_connector", forbidden)
    for dialect in ("POSTGRESQL", "MYSQL", "SQL_SERVER"):
        response = plan_sql(PlanRequest.model_validate(request(dialect)))
        assert response.sourceTables[0].name == "Album"
    assert len(calls) == 3


def test_sdk_type_parser_normalizes_parameterized_physical_types():
    body = request("POSTGRESQL")
    body["manifest"]["models"][0]["columns"][1]["type"] = "character varying(255)"
    body["sql"] = 'SELECT "Title" FROM public."Album"'
    result = plan_sql(PlanRequest.model_validate(body))
    assert "Title" in result.sql


@pytest.mark.parametrize(
    "sql",
    [
        'SELECT * INTO public.new_album FROM public."Album"',
        'WITH changed AS (DELETE FROM public."Album" RETURNING *) SELECT * FROM changed',
        'SELECT * FROM public."Album"; DELETE FROM public."Album"',
    ],
)
def test_fork_rejects_writes_even_with_select_root(sql):
    payload = request("POSTGRESQL")
    payload["sql"] = sql
    with pytest.raises(PlanningFailure) as error:
        plan_sql(PlanRequest.model_validate(payload))
    assert error.value.code == "SQL_VALIDATION_ERROR"


def test_fork_rejects_rewrite_that_switches_to_another_authorized_table(monkeypatch):
    from wren.engine import WrenEngine

    payload = request("POSTGRESQL")
    other = deepcopy(payload["manifest"]["models"][0])
    other["name"] = "nla_model_1"
    other["tableReference"]["table"] = "AnotherAlbum"
    payload["manifest"]["models"].append(other)
    monkeypatch.setattr(
        WrenEngine,
        "dry_plan",
        lambda *args: 'SELECT COUNT(*) FROM public."AnotherAlbum"',
    )
    with pytest.raises(PlanningFailure) as error:
        plan_sql(PlanRequest.model_validate(payload))
    assert error.value.code == "SQL_VALIDATION_ERROR"


def test_fork_preserves_manifest_and_rejects_ambiguous_unqualified_table():
    payload = request("POSTGRESQL")
    original = deepcopy(payload)
    plan_sql(PlanRequest.model_validate(payload))
    assert payload == original
    other = deepcopy(payload["manifest"]["models"][0])
    other["name"] = "nla_model_1"
    other["tableReference"]["schema"] = "another_schema"
    payload["manifest"]["models"].append(other)
    payload["sql"] = 'SELECT COUNT(*) FROM "Album"'
    with pytest.raises(PlanningFailure) as error:
        plan_sql(PlanRequest.model_validate(payload))
    assert error.value.code == "INSUFFICIENT_CONTEXT"


@pytest.mark.parametrize("method", ["query", "dry_run"])
def test_fork_planning_only_engine_cannot_open_any_connector(monkeypatch, method):
    import wren.engine as sdk
    from wren.model.error import ErrorCode, WrenError

    monkeypatch.setattr(sdk.WrenEngine, "dry_plan", lambda *args: "SELECT 1")

    def forbidden(*args, **kwargs):
        raise AssertionError("A planning service must not create a connector")

    monkeypatch.setattr(sdk, "get_connector", forbidden)
    with sdk.WrenEngine("e30=", "postgres", {}, planning_only=True) as engine:
        with pytest.raises(WrenError) as error:
            getattr(engine, method)("SELECT 1")
    assert error.value.error_code == ErrorCode.INVALID_CONNECTION_INFO
