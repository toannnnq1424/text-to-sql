#!/usr/bin/env python3
"""Real imported non-Chinook warehouse fixtures and result/metadata integration checks.

Synthetic observations are test inputs uploaded via the actual application. They are
not runtime fallback data. The private manifest records every owned object for cleanup.
"""

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from decimal import Decimal
from pathlib import Path

import compose
from llm_profile import profile_environment

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / ".local/compose-app/analytics-fixtures.json"
REPORT = ROOT / ".local/compose-app/analytics-report.json"
PREFIX = "/warehouse/ingestion/files"
OBSERVATIONS = [
    {
        "observed_on": f"2026-09-{day:02d}",
        "station": station,
        "temperature": str(Decimal(base) + day),
        "rainfall": str(Decimal(day) / 10),
    }
    for day in range(1, 5)
    for station, base in (("North", "20.5"), ("Central", "24.5"), ("South", "28.5"))
]


def persist(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2))
    path.chmod(0o600)


def request(path, token, body=None, method=None, status=200):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    try:
        with urllib.request.urlopen(
            urllib.request.Request(compose.API + path, data=data, headers=headers, method=method),
            timeout=180,
        ) as response:
            code = response.status
            raw = response.read()
    except urllib.error.HTTPError as error:
        code, raw = error.code, error.read()
    result = json.loads(raw) if raw else None
    if code != status:
        error = ((result or {}).get("error") or {}).get("code", "UNKNOWN")
        raise AssertionError(
            f"{method or ('POST' if data is not None else 'GET')} {path}: HTTP {code} {error}, expected {status}"
        )
    return result


def upload(token):
    boundary = "nla-analytics-" + str(time.time_ns())
    rows = "observed_on,station,temperature,rainfall\n" + "\n".join(
        ",".join(row[field] for field in ("observed_on", "station", "temperature", "rainfall"))
        for row in OBSERVATIONS
    )
    data = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-observations.csv"\r\nContent-Type: text/csv\r\n\r\n{rows}\r\n--{boundary}--\r\n'
    ).encode()
    req = urllib.request.Request(
        compose.API + PREFIX,
        data=data,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "multipart/form-data; boundary=" + boundary,
        },
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def quoted(engine, value):
    if engine == "MYSQL":
        return "`" + value.replace("`", "``") + "`"
    if engine == "SQL_SERVER":
        return "[" + value.replace("]", "]]") + "]"
    return '"' + value.replace('"', '""') + '"'


def prepare(token):
    if MANIFEST.exists():
        raise SystemExit(
            "A test manifest already exists; verify or clean those exact fixtures first."
        )
    fixtures = []
    persist(MANIFEST, fixtures)
    for entry in json.loads((ROOT / ".local/compose-app/registry.json").read_text()):
        engine = entry["engine"]
        source = request("/warehouses/" + entry["warehouseId"], token)
        suffix = {"POSTGRESQL": "PG", "MYSQL": "MYSQL", "SQL_SERVER": "MSSQL"}[engine]
        warehouse = request(
            "/warehouses",
            token,
            {
                "name": "Synthetic analytics QA / " + engine,
                "engine": engine,
                "host": source["host"],
                "port": source["port"],
                "database": source["database"],
                "defaultSchema": "nla_import",
                "username": source["username"],
                "credentialReference": "env:NLA_CHINOOK_" + suffix + "_PASSWORD",
                "importUsername": "nla_importer",
                "importCredentialReference": "env:NLA_IMPORT_" + suffix + "_PASSWORD",
            },
            status=201,
        )
        item = {
            "engine": engine,
            "warehouseId": warehouse["warehouseId"],
            "sourceWarehouseId": entry["warehouseId"],
            "datasetId": None,
            "uploadId": None,
            "runId": None,
            "tables": [],
            "queries": {},
        }
        fixtures.append(item)
        persist(MANIFEST, fixtures)
        assert request("/warehouses/" + item["warehouseId"] + "/test", token, {})["reachable"]
        namespaces = request(PREFIX + "/targets?warehouseId=" + item["warehouseId"], token)[
            "namespaces"
        ]
        item["targetSchema"] = namespaces[0]
        item["targetTable"] = (
            "analytics_qa_"
            + hashlib.sha256((engine + str(time.time_ns())).encode()).hexdigest()[:10]
        )
        file = upload(token)
        item["uploadId"] = file["id"]
        persist(MANIFEST, fixtures)
        plan = request(
            PREFIX + "/" + file["id"] + "/validate",
            token,
            {
                "warehouseId": item["warehouseId"],
                "targetSchema": item["targetSchema"],
                "targetTable": item["targetTable"],
                "datasetName": "Synthetic observations / " + engine,
                "columns": file["columns"],
            },
        )
        item["tables"] = [
            {"schema": layer["schema"], "name": layer["table"]} for layer in plan["layers"]
        ]
        persist(MANIFEST, fixtures)
        run = request(
            PREFIX + "/runs",
            token,
            {"planId": plan["id"], "digest": plan["digest"], "idempotencyKey": item["targetTable"]},
            status=202,
        )
        item["runId"] = run["id"]
        persist(MANIFEST, fixtures)
        deadline = time.monotonic() + 90
        while run["status"] in {"PENDING", "RUNNING"} and time.monotonic() < deadline:
            time.sleep(0.5)
            run = request(PREFIX + "/runs/" + run["id"], token)
        assert run["status"] == "SUCCESS", (engine, run.get("error"))
        item["datasetId"] = run["datasetId"]
        persist(MANIFEST, fixtures)
    print(
        json.dumps(
            {
                "status": "PREPARED",
                "engines": len(fixtures),
                "rowsPerEngine": len(OBSERVATIONS),
                "realUpload": True,
            }
        )
    )


def verify(token, structured_only=False):
    if profile_environment(ROOT).get("LLM_BASE_URL") != "http://127.0.0.1:11434/v1":
        raise SystemExit("Only local Ollama may be tested by this runner.")
    fixtures = json.loads(MANIFEST.read_text())
    report = {"mocked": False, "onlineProviderTested": False, "engines": {}}
    try:
        for item in fixtures:
            engine = item["engine"]
            base = "/datasets/" + item["datasetId"]
            model = request(base + "/semantic-model", token)
            if model["semanticVersion"] == "1.0.0":
                assert model["metrics"] == [] and model["examples"] == []
                suggestions = request(base + "/question-suggestions?pageSize=100", token)["items"]
                assert suggestions and all(s["origin"] == "PHYSICAL_SCHEMA" for s in suggestions)
                assert all(
                    "chinook" not in json.dumps(s).lower() and "album" not in json.dumps(s).lower()
                    for s in suggestions
                )
                item["schemaSuggestionsVerified"] = True
                persist(MANIFEST, fixtures)
                physical = model["tables"][0]
                ref = {"schema": physical["schema"], "name": physical["name"]}
                table = ".".join(quoted(engine, ref[key]) for key in ("schema", "name"))
                expression = lambda field: table + "." + quoted(engine, field)
                model["semanticVersion"] = "analytics-qa-2"
                model["dimensions"] = [
                    {
                        "name": "station",
                        "description": "Station label configured in this test dataset",
                        "table": ref,
                        "column": "station",
                        "dataType": "STRING",
                        "synonyms": [],
                    },
                    {
                        "name": "observed_day",
                        "description": "Observation day configured in this test dataset",
                        "table": ref,
                        "column": "observed_on",
                        "dataType": "DATE",
                        "synonyms": [],
                    },
                ]
                model["metrics"] = [
                    {
                        "name": "mean_temperature",
                        "description": "Configured mean temperature",
                        "expression": "AVG(" + expression("temperature") + ")",
                        "unit": "degC",
                        "tableRefs": [ref],
                        "compatibleDimensions": ["station", "observed_day"],
                        "synonyms": [],
                    },
                    {
                        "name": "max_temperature",
                        "description": "Configured maximum temperature",
                        "expression": "MAX(" + expression("temperature") + ")",
                        "unit": "degC",
                        "tableRefs": [ref],
                        "compatibleDimensions": ["station", "observed_day"],
                        "synonyms": [],
                    },
                    {
                        "name": "total_rainfall",
                        "description": "Configured rainfall total",
                        "expression": "SUM(" + expression("rainfall") + ")",
                        "unit": "mm",
                        "tableRefs": [ref],
                        "compatibleDimensions": ["station", "observed_day"],
                        "synonyms": [],
                    },
                    {
                        "name": "observation_count",
                        "description": "Configured observation count",
                        "expression": "COUNT(*)",
                        "unit": "count",
                        "tableRefs": [ref],
                        "compatibleDimensions": ["station", "observed_day"],
                        "synonyms": [],
                    },
                ]
                request(base + "/semantic-model/validate", token, model)
                request(base + "/semantic-model", token, model, method="PUT")
            suggestions = request(base + "/question-suggestions?pageSize=100", token)["items"]
            assert any(s["origin"] == "SEMANTIC_MODEL" for s in suggestions)
            assert all("chinook" not in json.dumps(s).lower() for s in suggestions)
            checks = [
                ("scalar", ["observation_count"], [], "number"),
                ("grouped", ["mean_temperature"], ["station"], "bar"),
                ("multiple", ["mean_temperature", "max_temperature"], ["station"], "grouped-bar"),
                ("timeline", ["total_rainfall"], ["observed_day"], "line"),
            ]
            queries = {}
            for name, metrics, dimensions, chart in checks:
                query = request(
                    base + "/semantic-query",
                    token,
                    {"metrics": metrics, "dimensions": dimensions, "filters": [], "limit": 100},
                )
                assert query["status"] == "SUCCESS", (engine, name, query.get("error"))
                assert query["chart"]["type"] == chart, (engine, name, query["chart"])
                assert query["candidateSql"] and query["generatedSql"]
                if name == "scalar":
                    assert str(query["result"]["rows"][0]["observation_count"]) == "12"
                    assert "nla_model_" not in query["generatedSql"]
                elif name == "grouped":
                    actual = {
                        row["station"]: Decimal(row["mean_temperature"])
                        for row in query["result"]["rows"]
                    }
                    assert actual == {
                        "North": Decimal("23"),
                        "Central": Decimal("27"),
                        "South": Decimal("31"),
                    }
                elif name == "multiple":
                    assert len(query["chart"]["series"]) == 2
                    assert sorted(
                        Decimal(row["max_temperature"]) for row in query["result"]["rows"]
                    ) == [Decimal("24.5"), Decimal("28.5"), Decimal("32.5")]
                else:
                    assert all(
                        Decimal(row["total_rainfall"])
                        in {Decimal("0.3"), Decimal("0.6"), Decimal("0.9"), Decimal("1.2")}
                        for row in query["result"]["rows"]
                    )
                item["queries"][name] = query["queryId"]
                queries[name] = {
                    "queryId": query["queryId"],
                    "chart": chart,
                    "rows": query["result"]["returnedRowCount"],
                }
                persist(MANIFEST, fixtures)
            suites = request("/evaluation/test-suites?datasetId=" + item["datasetId"], token)[
                "items"
            ]
            assert any(
                suite["suiteId"] == "dataset-schema" and suite["origin"] == "CURRENT_SCHEMA"
                for suite in suites
            )
            assert all(
                suite["suiteId"] not in {"chinook-core", "synthetic-support"} for suite in suites
            )
            if structured_only:
                report["engines"][engine] = {
                    "status": "STRUCTURED_PASS_NATURAL_PENDING",
                    "schemaSuggestions": item["schemaSuggestionsVerified"],
                    "questions": len(suggestions),
                    "queries": queries,
                    "datasetScopedEvaluation": True,
                }
                persist(REPORT, report)
                continue
            question = (
                "Tính nhiệt độ temperature trung bình của mỗi station trong bảng "
                + item["targetTable"]
                + "_mart."
            )
            query = request(
                "/query",
                token,
                {
                    "warehouseId": item["warehouseId"],
                    "datasetId": item["datasetId"],
                    "question": question,
                    "mode": "API",
                },
                status=201,
            )
            assert query["status"] == "SUCCESS", (engine, query.get("error"))
            assert query["model"] == "qwen3:4b"
            assert "nla_model_" not in query["generatedSql"]
            assert len(query["result"]["rows"]) == 3
            values = sorted(
                Decimal(str(value))
                for row in query["result"]["rows"]
                for value in row.values()
                if str(value).replace(".", "", 1).isdigit()
            )
            assert values == [Decimal("23"), Decimal("27"), Decimal("31")], (engine, values)
            item["queries"]["natural"] = query["queryId"]
            persist(MANIFEST, fixtures)
            report["engines"][engine] = {
                "status": "PASS",
                "schemaSuggestions": item["schemaSuggestionsVerified"],
                "questions": len(suggestions),
                "curatedExamples": len(model["examples"]),
                "queries": queries,
                "localModelQueryId": query["queryId"],
                "datasetScopedEvaluation": True,
            }
            persist(REPORT, report)
        report["status"] = "STRUCTURED_PASS_NATURAL_PENDING" if structured_only else "PASS"
    except Exception as error:
        report["status"] = "FAIL"
        report["failure"] = str(error)
        raise
    finally:
        persist(REPORT, report)
        print(json.dumps(report))


def cleanup(token):
    """Remove only exact test objects recorded before upload/creation, retaining audit history."""
    sys.path.insert(0, str(ROOT / "data/scripts"))
    import docker_chinook as db

    fixtures = json.loads(MANIFEST.read_text())
    if len(fixtures) != 3 or {item["engine"] for item in fixtures} != {
        "POSTGRESQL",
        "MYSQL",
        "SQL_SERVER",
    }:
        raise AssertionError("Expected exactly three owned test warehouses")
    for item in fixtures:
        assert re.fullmatch(r"analytics_qa_[0-9a-f]{10}", item["targetTable"])
        assert re.fullmatch(r"wh-[0-9a-f-]{36}", item["warehouseId"])
        assert re.fullmatch(r"ds-[0-9a-f-]{36}", item["datasetId"])
        assert len(item["tables"]) == 4
        for layer in item["tables"]:
            assert layer["schema"] == item["targetSchema"]
            assert layer["name"] in {
                item["targetTable"] + "_" + stage
                for stage in ("raw", "staging", "warehouse", "mart")
            }
        current = request("/warehouses/" + item["warehouseId"], token)
        assert current["name"] == "Synthetic analytics QA / " + item["engine"]
        request("/datasets/" + item["datasetId"], token, {"status": "DISABLED"}, method="PATCH")
        request("/datasets/" + item["datasetId"] + "/knowledge", token, method="DELETE")
        request(PREFIX + "/" + item["uploadId"], token, method="DELETE", status=204)
        for layer in reversed(item["tables"]):
            table = ".".join(quoted(item["engine"], layer[key]) for key in ("schema", "name"))
            sql = "DROP TABLE IF EXISTS " + table + ";"
            if item["engine"] == "SQL_SERVER":
                sql += "\nGO\n"
            db.execute(
                item["engine"], sql, db="nla_import" if item["engine"] == "MYSQL" else "nla_chinook"
            )
        wh = "'" + item["warehouseId"] + "'"
        ds = "'" + item["datasetId"] + "'"
        upload_id = item["uploadId"]
        if not re.fullmatch(r"[A-Za-z0-9-]+", upload_id):
            raise AssertionError("Invalid owned upload identifier")
        upload = "'" + upload_id + "'"
        statements = [
            "BEGIN;",
            "DELETE FROM saved_result WHERE query_id IN (SELECT id FROM query_history WHERE dataset_id="
            + ds
            + ");",
            "DELETE FROM query_history WHERE dataset_id=" + ds + ";",
            "DELETE FROM operation_run WHERE document->>'datasetId'=" + ds + ";",
            "DELETE FROM file_ingestion_run WHERE warehouse_id=" + wh + ";",
            "DELETE FROM file_ingestion_plan WHERE warehouse_id=" + wh + ";",
            "DELETE FROM file_upload WHERE id=" + upload + ";",
            "DELETE FROM dataset WHERE id=" + ds + ";",
            "DELETE FROM resource_access WHERE warehouse_id=" + wh + ";",
            "DELETE FROM warehouse WHERE id=" + wh + ";",
            "COMMIT;",
        ]
        db.execute("POSTGRESQL", "\n".join(statements), db="nla_metadata_compose")
        item["cleaned"] = True
        persist(MANIFEST, fixtures)
    counts = {}
    for engine in ("POSTGRESQL", "MYSQL", "SQL_SERVER"):
        counts[engine] = {}
        for canonical, expected in db.SOURCE["expectedCounts"].items():
            special = {
                "invoice_line": "InvoiceLine",
                "media_type": "MediaType",
                "playlist_track": "PlaylistTrack",
            }
            name = (
                canonical if engine == "POSTGRESQL" else special.get(canonical, canonical.title())
            )
            table = quoted(engine, name)
            if engine == "SQL_SERVER":
                table = "[dbo]." + table
            sql = "SELECT COUNT(*) FROM " + table + ";"
            if engine == "SQL_SERVER":
                sql = "SET NOCOUNT ON; " + sql + "\nGO\n"
            actual = int(db.execute(engine, sql, db="nla_chinook", reader=True))
            assert actual == expected, (engine, canonical, actual, expected)
            counts[engine][canonical] = actual
    result = {
        "status": "PASS",
        "removedWarehouses": 3,
        "removedDatasets": 3,
        "removedTables": 12,
        "originalChinookCounts": counts,
    }
    persist(ROOT / ".local/compose-app/analytics-cleanup-report.json", result)
    print(json.dumps(result))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "verify", "cleanup"))
    parser.add_argument("--structured-only", action="store_true")
    args = parser.parse_args()
    token = compose.service_token()
    if args.action == "verify":
        verify(token, args.structured_only)
    else:
        {"prepare": prepare, "cleanup": cleanup}[args.action](token)


if __name__ == "__main__":
    main()
