#!/usr/bin/env python3
"""Run the local product smoke against provisioned databases without logging secrets."""

import json
import time
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = dict(
    line.split("=", 1)
    for line in (ROOT / ".local/docker.env").read_text().splitlines()
    if line and not line.startswith("#")
)
BASE = "http://127.0.0.1:8080/api/v1"


def call(path, body=None):
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": "Bearer " + CONFIG["LOCAL_API_TOKEN"],
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def main():
    report = {"engines": {}, "mode": "DETERMINISTIC", "mocked": False}
    assert call("/health")["status"] == "UP"

    for suffix, engine in [
        ("pg", "POSTGRESQL"),
        ("mysql", "MYSQL"),
        ("mssql", "SQL_SERVER"),
    ]:
        warehouse_id = "wh-chinook-" + suffix
        dataset_id = "ds-chinook-" + suffix
        assert call(f"/warehouses/{warehouse_id}/test", {})["reachable"]
        catalog = call(f"/datasets/{dataset_id}/catalog")
        assert catalog["tableCount"] == 11

        query = call(
            "/query",
            {
                "warehouseId": warehouse_id,
                "datasetId": dataset_id,
                "question": "How many tracks are in the catalog?",
                "mode": "DETERMINISTIC",
            },
        )
        assert query["status"] == "SUCCESS", query.get("error")
        assert str(query["result"]["rows"][0]["track_count"]) == "3503"

        country_query = call(
            "/query",
            {
                "warehouseId": warehouse_id,
                "datasetId": dataset_id,
                "question": "Tổng doanh số theo quốc gia thanh toán?",
                "mode": "DETERMINISTIC",
            },
        )
        assert country_query["status"] == "SUCCESS", country_query.get("error")
        assert country_query["result"]["returnedRowCount"] == 24

        saved = call(
            f"/query/{query['queryId']}/saved",
            {"name": "Chinook verified track count"},
        )
        assert saved["queryId"] == query["queryId"]

        source_id = "chinook-country-sales-" + suffix
        source = call(f"/warehouse/ingestion/sources/{source_id}")
        targets = [source.get(layer) for layer in ("raw", "stage", "warehouse", "mart")]
        assert all(isinstance(target, dict) for target in targets), source
        assert len({(target["schema"], target["name"]) for target in targets}) == 4

        request_body = {
            "warehouseId": warehouse_id,
            "datasetId": dataset_id,
            "sourceId": source_id,
            "idempotencyKey": str(uuid.uuid4()),
        }
        ingestion = call("/warehouse/ingestion/run", request_body)
        assert ingestion["status"] == "SUCCESS", ingestion.get("error")
        assert ingestion["rowsWritten"] == 24
        assert [step["status"] for step in ingestion["steps"]] == ["SUCCESS"] * 4
        replay = call("/warehouse/ingestion/run", request_body)
        assert replay["runId"] == ingestion["runId"]

        evaluation = call(
            "/evaluation/run",
            {
                "warehouseId": warehouse_id,
                "datasetId": dataset_id,
                "suiteId": "chinook-core",
                "mode": "DETERMINISTIC",
            },
        )
        deadline = time.monotonic() + 180
        while evaluation["status"] in {"PENDING", "RUNNING"}:
            if time.monotonic() > deadline:
                raise AssertionError("Evaluation exceeded smoke deadline")
            time.sleep(0.25)
            evaluation = call("/evaluation/runs/" + evaluation["runId"])
        report["engines"][engine] = {
            "catalogTables": catalog["tableCount"],
            "queryId": query["queryId"],
            "trackCount": 3503,
            "countryRows": country_query["result"]["returnedRowCount"],
            "ingestion": {
                "runId": ingestion["runId"],
                "status": ingestion["status"],
                "rowsWritten": ingestion["rowsWritten"],
                "persistedLayers": [step["stage"] for step in ingestion["steps"]],
                "idempotencyVerified": True,
            },
            "evaluation": evaluation,
        }
        print(
            engine,
            "real query + saved query + four-layer ingestion + idempotency:",
            ingestion["status"],
            "evaluation:",
            evaluation["status"],
            flush=True,
        )

    report_path = ROOT / ".local/real-integration-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    assert all(run["evaluation"]["status"] == "SUCCESS" for run in report["engines"].values())
    print("PASS: three-engine real service/database smoke.")


if __name__ == "__main__":
    main()
