from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

from semantic_planner import PlanRequest, plan_sql
from test_semantic_planner import request
from third_party.wren_semantic import session_context as sessions


def test_reuses_native_session_without_caching_sql_or_leaking_manifest(monkeypatch):
    sessions._cached.cache_clear()
    original = sessions.wren_core.SessionContext
    created = []

    def create(*args):
        created.append(args[0])
        return original(*args)

    monkeypatch.setattr(sessions.wren_core, "SessionContext", create)
    first = request("POSTGRESQL")
    plan_sql(PlanRequest.model_validate(first))
    second = deepcopy(first)
    second["sql"] = 'SELECT "Title" FROM public."Album"'
    result = plan_sql(PlanRequest.model_validate(second))
    assert len(created) == 1
    assert "Title" in result.sql
    changed = deepcopy(second)
    changed["manifest"]["models"][0]["columns"].append({"name": "NewColumn", "type": "STRING"})
    plan_sql(PlanRequest.model_validate(changed))
    assert len(created) == 2
    assert "NewColumn" not in plan_sql(PlanRequest.model_validate(second)).sql
    sessions._cached.cache_clear()


def test_concurrent_native_rewrites_keep_separate_request_ast_and_bound_cache():
    sessions._cached.cache_clear()
    variants = []
    for index in range(16):
        body = request("SQL_SERVER")
        body["sql"] = f"SELECT COUNT(*) AS count_{index} FROM [dbo].[Album]"
        variants.append(PlanRequest.model_validate(body))
    with ThreadPoolExecutor(max_workers=4) as workers:
        results = list(workers.map(plan_sql, variants))
    for index, result in enumerate(results):
        assert f"count_{index}" in result.sql
        assert result.sourceTables[0].name == "Album"
    assert sessions._cached.cache_info().currsize == 1
    assert sessions._cached.cache_info().maxsize == 8
    sessions._cached.cache_clear()


def test_large_authorized_manifests_are_planned_without_retention(monkeypatch):
    sessions._cached.cache_clear()
    monkeypatch.setattr(sessions, "MAX_CACHED_MANIFEST_BYTES", 1)
    plan_sql(PlanRequest.model_validate(request("MYSQL")))
    assert sessions._cached.cache_info().currsize == 0
