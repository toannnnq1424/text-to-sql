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
    assert "nla_model_0" in planned.sql
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
    assert "WITH" in planned.sql.upper()


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
