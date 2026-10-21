#!/usr/bin/env python3
"""Actual asynchronous evaluation of four owned uploaded layers on all three engines.

Checks immediate accepted state, persisted progress, model execution and independently
executed SQL count oracles. Creates/deletes only owned metadata and private knowledge;
never changes imported fixture tables, original datasets or online provider settings.
"""

import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import compose
from llm_profile import profile_environment

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "data/scripts"))
import docker_chinook as db

REPORT = ROOT / ".local/compose-app/analytics-evaluation-report.json"
MANIFEST = ROOT / ".local/compose-app/analytics-evaluation-owned.json"


def request(path, token, body=None):
    headers = {"Accept": "application/json", "Authorization": "Bearer " + token}
    payload = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(body).encode()
    expected = (
        201
        if path == "/datasets" and body is not None
        else 202 if path == "/evaluation/run" else 200
    )
    try:
        with urllib.request.urlopen(
            urllib.request.Request(compose.API + path, data=payload, headers=headers), timeout=150
        ) as response:
            if response.status != expected:
                raise AssertionError("Unexpected evaluation HTTP status " + str(response.status))
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise AssertionError(f"{path}: HTTP{error.code}, expected{expected}") from None


def persist(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    path.chmod(0o600)


def identifiers(values):
    if any(not value.replace("-", "").isalnum() for value in values):
        raise AssertionError("Unsafe owned metadata identifier")
    return ",".join("'" + value + "'" for value in values)


def cleanup(owned):
    token = compose.service_token()
    failures = []
    for item in owned:
        try:
            compose.request(
                compose.API + "/datasets/" + item["datasetId"],
                token=token,
                body={"status": "DISABLED"},
                method="PATCH",
            )
            if item.get("runId"):
                deadline = time.monotonic() + 90
                state = request("/evaluation/runs/" + item["runId"], token)
                while state["status"] == "RUNNING" and time.monotonic() < deadline:
                    time.sleep(0.5)
                    state = request("/evaluation/runs/" + item["runId"], token)
                if state["status"] == "RUNNING":
                    failures.append("Owned run still executing; disabled metadata retained safely")
                    continue
            compose.request(
                compose.API + "/datasets/" + item["datasetId"] + "/knowledge",
                token=token,
                method="DELETE",
            )
            dataset_id = identifiers([item["datasetId"]])
            statements = ["BEGIN;"]
            if item.get("runId"):
                run_id = identifiers([item["runId"]])
                statements += [
                    "DELETE FROM operation_run WHERE kind='EVALUATION_CASE' AND document->>'runId' IN ("
                    + run_id
                    + ");",
                    "DELETE FROM operation_run WHERE kind='EVALUATION' AND id IN (" + run_id + ");",
                ]
            statements += [
                "DELETE FROM query_history WHERE dataset_id IN (" + dataset_id + ");",
                "DELETE FROM dataset WHERE id IN (" + dataset_id + ");",
                "COMMIT;",
            ]
            db.execute("POSTGRESQL", "\n".join(statements), db="nla_metadata_compose")
            item["cleaned"] = True
        except BaseException:
            failures.append("Owned evaluation metadata cleanup failed")
    persist(MANIFEST, owned)
    return failures


def run():
    if profile_environment(ROOT).get("LLM_BASE_URL") != "http://127.0.0.1:11434/v1":
        raise SystemExit("Only the local Ollama profile is allowed")
    fixtures = json.loads((ROOT / ".local/compose-app/analytics-fixtures.json").read_text())
    online = ROOT / ".local/compose-app/provider.env"
    digest = hashlib.sha256(online.read_bytes()).hexdigest()
    owned = []
    persist(MANIFEST, owned)
    report = {"mocked": False, "onlineProviderTested": False, "engines": {}}
    try:
        for fixture in fixtures:
            token = compose.service_token()
            dataset = request(
                "/datasets",
                token,
                {
                    "warehouseId": fixture["warehouseId"],
                    "name": "Owned async evaluation " + str(time.time_ns()),
                    "description": "Four uploaded synthetic observation layers; isolated acceptance metadata",
                    "allowedSchemas": [fixture["targetSchema"]],
                    "allowedTables": fixture["tables"],
                    "semanticVersion": "1.0.0",
                    "schemaVersion": "1.0.0",
                },
            )
            item = {
                "datasetId": dataset["datasetId"],
                "warehouseId": fixture["warehouseId"],
                "engine": fixture["engine"],
                "runId": None,
                "cleaned": False,
            }
            owned.append(item)
            persist(MANIFEST, owned)
            started = time.monotonic()
            accepted = request(
                "/evaluation/run",
                token,
                {
                    "warehouseId": fixture["warehouseId"],
                    "datasetId": dataset["datasetId"],
                    "suiteId": "dataset-schema",
                    "mode": "API",
                },
            )
            elapsed = time.monotonic() - started
            item["runId"] = accepted["runId"]
            persist(MANIFEST, owned)
            assert accepted["status"] == "RUNNING" and accepted["completedAt"] is None
            assert accepted["metrics"]["completedCases"] == 0
            assert accepted["metrics"]["totalCases"] == 4
            assert elapsed < 5, "Run admission blocked on model execution"
            state = accepted
            progress = [0]
            deadline = time.monotonic() + 240
            while state["status"] == "RUNNING" and time.monotonic() < deadline:
                time.sleep(0.5)
                state = request("/evaluation/runs/" + item["runId"], token)
                progress.append(state["metrics"]["completedCases"])
            cases = request("/evaluation/results?runId=" + item["runId"] + "&pageSize=100", token)[
                "items"
            ]
            details = [request("/evaluation/results/" + case["resultId"], token) for case in cases]
            persist(
                ROOT
                / (
                    ".local/compose-app/analytics-evaluation-diagnostics-"
                    + fixture["engine"]
                    + ".json"
                ),
                {"run": state, "results": details},
            )
            if state["status"] != "SUCCESS":
                report["engines"][fixture["engine"]] = {
                    "status": "FAIL",
                    "runId": item["runId"],
                    "acceptedSeconds": round(elapsed, 3),
                    "acceptedHttpStatus": 202,
                    "initialStatus": accepted["status"],
                    "persistedProgress": sorted(set(progress)),
                    "terminalStatus": state["status"],
                    "metrics": state["metrics"],
                    "failureCases": [
                        {
                            field: detail.get(field)
                            for field in (
                                "question",
                                "status",
                                "validationResult",
                                "resultEquivalent",
                                "chartMatch",
                                "failureReason",
                            )
                        }
                        for detail in details
                        if detail["status"] != "PASSED"
                    ],
                }
                persist(REPORT, report)
                continue
            assert state["metrics"]["completedCases"] == 4
            assert state["metrics"]["resultEquivalenceRate"] == 1
            assert state["model"] == "qwen3:4b"
            assert len(cases) == 4 and all(case["status"] == "PASSED" for case in cases)
            for detail in details:
                assert detail["resultEquivalent"] is True
                assert str(detail["expectedResult"]["rows"][0]["record_count"]) == "12"
                assert str(detail["actualResult"]["rows"][0]["record_count"]) == "12"
            report["engines"][fixture["engine"]] = {
                "status": "PASS",
                "runId": item["runId"],
                "acceptedSeconds": round(elapsed, 3),
                "acceptedHttpStatus": 202,
                "initialStatus": accepted["status"],
                "persistedProgress": sorted(set(progress)),
                "caseCount": 4,
                "independentCounts": [12] * 4,
                "model": state["model"],
                "executionSuccessRate": state["metrics"]["executionSuccessRate"],
                "resultEquivalenceRate": state["metrics"]["resultEquivalenceRate"],
            }
            persist(REPORT, report)
        report["status"] = (
            "PASS"
            if all(item["status"] == "PASS" for item in report["engines"].values())
            else "FAIL"
        )
    except BaseException as failure:
        report["status"] = "FAIL"
        report["failure"] = str(failure)
        raise
    finally:
        failures = cleanup(owned)
        report["cleanup"] = "PASS" if not failures else failures
        if failures:
            report["status"] = "FAIL"
        assert hashlib.sha256(online.read_bytes()).hexdigest() == digest
        persist(REPORT, report)
        print(json.dumps(report, ensure_ascii=False))
    if report["status"] != "PASS":
        raise SystemExit("Evaluation acceptance failed; see the preserved per-engine diagnostics")


if __name__ == "__main__":
    run()
