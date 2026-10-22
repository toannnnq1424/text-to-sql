"""Independent-oracle runner regressions, without model or warehouse calls."""

import importlib.util
from decimal import Decimal
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "readiness_ai_runtime", Path(__file__).with_name("readiness-ai-runtime.py")
)
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)


def test_result_comparison_keeps_duplicate_rows_and_strict_order():
    tolerance = Decimal("0.000001")
    assert RUNTIME.rows_equal([["A", 1], ["A", 1]], [["A", "1"], ["A", "1.0"]], False, tolerance)
    assert not RUNTIME.rows_equal([["A", 1], ["A", 1]], [["A", "1"], ["B", "1"]], False, tolerance)
    assert not RUNTIME.rows_equal([["A", 1], ["B", 2]], [["B", "2"], ["A", "1"]], True, tolerance)
    assert not RUNTIME.rows_equal([[1]], [["1.000002"]], False, tolerance)
    assert not RUNTIME.rows_equal([[None]], [["None"]], False, tolerance)


def test_oracle_fetches_every_persisted_page_instead_of_comparing_preview(monkeypatch):
    calls = []

    def request(path, token):
        calls.append(path)
        page = int(path.rsplit("=", 1)[1])
        start = (page - 1) * 100
        return 200, {"rows": [{"n": n} for n in range(start, min(start + 100, 205))]}, 1

    monkeypatch.setattr(RUNTIME, "request", request)
    query = {
        "queryId": "qry-test",
        "result": {"rows": [{"n": n} for n in range(20)], "returnedRowCount": 205},
    }
    result = RUNTIME.result_pages(query, "test-token")
    assert len(result["rows"]) == 205 and result["rows"][-1] == {"n": 204}
    assert len(calls) == 3 and all("/query/qry-test/result?pageSize=100&page=" in p for p in calls)
    assert not result["snapshotFetchFailed"]


def test_missing_result_page_is_failed_evidence_not_silent_pass(monkeypatch):
    monkeypatch.setattr(RUNTIME, "request", lambda *args: (403, {"error": {}}, 1))
    result = RUNTIME.result_pages(
        {"queryId": "qry-test", "result": {"rows": [], "returnedRowCount": 25}}, "test-token"
    )
    assert result["snapshotFetchFailed"] and not result["rows"]
