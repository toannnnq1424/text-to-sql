#!/usr/bin/env python3
"""Real HTTP/DB integration smoke; no mocks, secrets or row payloads in logs."""

import json
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = dict(line.split("=", 1) for line in (ROOT / ".local/docker.env").read_text().splitlines())
BASE = "http://127.0.0.1:8080/api/v1"


def call(path, body=None):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": "Bearer " + CONFIG["LOCAL_API_TOKEN"],
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)


def main():
    report = {"engines": {}, "mode": "DETERMINISTIC", "mocked": False}
    assert call("/health")["status"] == "UP"
    for suffix, engine in [("pg", "POSTGRESQL"), ("mysql", "MYSQL"), ("mssql", "SQL_SERVER")]:
        wh = "wh-chinook-" + suffix
        ds = "ds-chinook-" + suffix
        assert call("/warehouses/" + wh + "/test", {})["reachable"]
        catalog = call("/datasets/" + ds + "/catalog")
        assert catalog["tableCount"] == 11
        query = call(
            "/query",
            {
                "warehouseId": wh,
                "datasetId": ds,
                "question": "How many tracks are in the catalog?",
                "mode": "DETERMINISTIC",
            },
        )
        assert query["status"] == "SUCCESS", query.get("error")
        assert str(query["result"]["rows"][0]["track_count"]) == "3503"
        country = call(
            "/query",
            {
                "warehouseId": wh,
                "datasetId": ds,
                "question": "Tổng doanh số theo quốc gia thanh toán?",
                "mode": "DETERMINISTIC",
            },
        )
        assert country["status"] == "SUCCESS", country.get("error")
        assert country["result"]["returnedRowCount"] == 24
        saved = call(
            "/query/" + query["queryId"] + "/saved", {"name": "Chinook verified track count"}
        )
        assert saved["queryId"] == query["queryId"]
        idem = str(uuid.uuid4())
        body = {
            "warehouseId": wh,
            "datasetId": ds,
            "sourceId": "chinook-country-sales-" + suffix,
            "idempotencyKey": idem,
        }
        ingestion = call("/warehouse/ingestion/run", body)
        assert ingestion["status"] == "SUCCESS", ingestion.get("error")
        assert ingestion["rowsWritten"] == 24
        assert call("/warehouse/ingestion/run", body)["runId"] == ingestion["runId"]
        evaluation = call(
            "/evaluation/run",
            {
                "warehouseId": wh,
                "datasetId": ds,
                "suiteId": "chinook-core",
                "mode": "DETERMINISTIC",
            },
        )
        report["engines"][engine] = {
            "catalogTables": catalog["tableCount"],
            "queryId": query["queryId"],
            "trackCount": 3503,
            "countryRows": country["result"]["returnedRowCount"],
            "ingestion": {
                "runId": ingestion["runId"],
                "status": ingestion["status"],
                "rowsWritten": ingestion["rowsWritten"],
                "idempotencyVerified": True,
            },
            "evaluation": evaluation,
        }
        print(
            engine,
            "real query + snapshot/save + ingestion + idempotency:",
            ingestion["status"],
            "evaluation:",
            evaluation["status"],
            flush=True,
        )
    (ROOT / ".local/real-integration-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )
    assert all(
        x["evaluation"]["status"] == "SUCCESS" for x in report["engines"].values()
    ), "Some evaluation cases failed; inspect .local report and case API."
    print("PASS: three-engine real service/database smoke.")


if __name__ == "__main__":
    main()
