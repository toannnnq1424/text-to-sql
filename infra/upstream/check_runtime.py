#!/usr/bin/env python3
"""Verify the vendored SDK/native factories through authenticated Java evaluation."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infra/local"))
import compose


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", default="chinook-core")
    args = parser.parse_args()
    token = compose.service_token()
    entries = json.loads((ROOT / ".local/compose-app/registry.json").read_text())
    suites = compose.request(compose.API + "/evaluation/test-suites?pageSize=100", token=token)[
        "items"
    ]
    suite = next((item for item in suites if item["suiteId"] == args.suite), None)
    if not suite or set(suite["engines"]) != {"POSTGRESQL", "MYSQL", "SQL_SERVER"}:
        parser.error("Select a registered suite covering all three engines.")
    report = {"mocked": False, "suiteId": suite["suiteId"], "engines": {}}
    for entry in entries:
        run = compose.request(
            compose.API + "/evaluation/run",
            token=token,
            body={
                "warehouseId": entry["warehouseId"],
                "datasetId": entry["datasetId"],
                "suiteId": suite["suiteId"],
                "mode": "DETERMINISTIC",
            },
        )
        deadline = time.monotonic() + 180
        while run["status"] in {"PENDING", "RUNNING"}:
            if time.monotonic() > deadline:
                raise SystemExit("Evaluation deadline exceeded.")
            time.sleep(0.25)
            run = compose.request(compose.API + "/evaluation/runs/" + run["runId"], token=token)
        if run["status"] != "SUCCESS":
            raise SystemExit("Evaluation failed; inspect authenticated run details.")
        metrics = run["metrics"]
        if (
            metrics["completedCases"] != metrics["totalCases"]
            or metrics["resultEquivalenceRate"] != 1
        ):
            raise SystemExit("Result equivalence acceptance failed.")
        report["engines"][entry["engine"]] = {
            "status": "PASS",
            "runId": run["runId"],
            "metrics": metrics,
        }
    if len(report["engines"]) != 3:
        raise SystemExit("All three engines must be verified.")
    report["status"] = "PASS"
    compose.private_write(
        ROOT / ".local/full-adoption-evaluation.json", json.dumps(report, indent=2)
    )
    print(json.dumps(report))


if __name__ == "__main__":
    main()
