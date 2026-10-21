#!/usr/bin/env python3
"""Actual application upload→persisted quality rules→native read-only DB3 checks.

Synthetic inputs are isolated acceptance fixtures, never product fallback data.
Owned IDs/names are persisted before loading; cleanup retains normal audit records.
"""

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

import compose

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / ".local/compose-app/quality-fixtures.json"
REPORT = ROOT / ".local/compose-app/quality-report.json"
PREFIX = "/warehouse/ingestion/files"
OBSERVATIONS = [
    {"item_id": 1, "parent_id": 1, "amount": 10, "category": "A", "required_value": "x"},
    {"item_id": 2, "parent_id": 1, "amount": 20, "category": "B", "required_value": "y"},
    {"item_id": 2, "parent_id": 999, "amount": -1, "category": "C", "required_value": None},
    {"item_id": 3, "parent_id": None, "amount": 105, "category": "A", "required_value": "z"},
    {"item_id": 4, "parent_id": 2, "amount": 50, "category": "B", "required_value": "p"},
    {"item_id": 5, "parent_id": 3, "amount": 0, "category": "A", "required_value": "q"},
]


def load(name):
    spec = importlib.util.spec_from_file_location(
        name.replace("-", "_"), Path(__file__).with_name(name + ".py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


helpers = load("analytics-runtime")
request = helpers.request
persist = helpers.persist
quoted = helpers.quoted


def upload(token):
    boundary = "nla-quality-" + str(time.time_ns())
    data = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="quality-observations.json"\r\n'
        f"Content-Type: application/json\r\n\r\n{json.dumps(OBSERVATIONS)}\r\n--{boundary}--\r\n"
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


def prepare(token):
    if MANIFEST.exists():
        raise SystemExit(
            "Quality fixture manifest exists; inspect/cleanup exact owned objects first."
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
                "name": "Data quality QA / " + engine,
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
            "datasetId": None,
            "uploadId": None,
            "runId": None,
            "tables": [],
            "qualityRuns": [],
        }
        fixtures.append(item)
        persist(MANIFEST, fixtures)
        assert request("/warehouses/" + item["warehouseId"] + "/test", token, {})["reachable"]
        item["targetSchema"] = request(
            PREFIX + "/targets?warehouseId=" + item["warehouseId"], token
        )["namespaces"][0]
        item["targetTable"] = (
            "quality_qa_" + hashlib.sha256((engine + str(time.time_ns())).encode()).hexdigest()[:10]
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
                "datasetName": "Quality observations / " + engine,
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
            time.sleep(0.3)
            run = request(PREFIX + "/runs/" + run["id"], token)
        assert run["status"] == "SUCCESS", engine
        item["datasetId"] = run["datasetId"]
        context = request("/datasets/" + item["datasetId"] + "/semantic-model", token)
        table = context["tables"][0]
        item["table"] = {"schema": table["schema"], "name": table["name"]}
        persist(MANIFEST, fixtures)
    print(
        json.dumps(
            {"status": "PREPARED", "engines": len(fixtures), "rowsPerEngine": 6, "realUpload": True}
        )
    )


def rules(item):
    def rule(identifier, kind, **fields):
        return {
            "ruleId": identifier,
            "name": "Quality " + identifier,
            "type": kind,
            "table": item["table"],
            "enabled": True,
            **fields,
        }

    return [
        rule("required", "NOT_NULL", column="required_value"),
        rule("identifier", "UNIQUE", column="item_id"),
        rule("amount-range", "RANGE", column="amount", min="0", max="100"),
        rule("category-set", "ACCEPTED_VALUES", column="category", values=["A", "B"]),
        rule("row-count", "ROW_COUNT", min="6", max="6"),
        rule(
            "parent-reference",
            "REFERENCE",
            column="parent_id",
            referenceTable=item["table"],
            referenceColumn="item_id",
        ),
    ]


def wait(token, base, started):
    deadline = time.monotonic() + 130
    run = started
    while run["status"] == "RUNNING" and time.monotonic() < deadline:
        time.sleep(0.2)
        run = request(base + "/runs/" + run["runId"], token)
    assert run["status"] != "RUNNING", "Quality run exceeded acceptance deadline"
    return run


def independent_counts(item):
    """Separate native reader queries over the uploaded rows; no quality-service SQL."""
    sys.path.insert(0, str(ROOT / "data/scripts"))
    import docker_chinook as db

    engine = item["engine"]
    target = ".".join(quoted(engine, item["table"][k]) for k in ("schema", "name"))
    column = lambda name: "q." + quoted(engine, name)
    queries = {
        "required": "SELECT COUNT(*) FROM "
        + target
        + " q WHERE "
        + column("required_value")
        + " IS NULL",
        "identifier": "SELECT COUNT("
        + column("item_id")
        + ")-COUNT(DISTINCT "
        + column("item_id")
        + ") FROM "
        + target
        + " q",
        "amount-range": "SELECT COUNT(*) FROM "
        + target
        + " q WHERE "
        + column("amount")
        + "<0 OR "
        + column("amount")
        + ">100",
        "category-set": "SELECT COUNT(*) FROM "
        + target
        + " q WHERE "
        + column("category")
        + " NOT IN ('A','B')",
        "row-count": "SELECT COUNT(*) FROM " + target + " q",
        "parent-reference": "SELECT COUNT(*) FROM "
        + target
        + " q WHERE "
        + column("parent_id")
        + " IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "
        + target
        + " r WHERE r."
        + quoted(engine, "item_id")
        + "="
        + column("parent_id")
        + ")",
    }
    actual = {}
    for name, sql in queries.items():
        if engine == "SQL_SERVER":
            sql = "SET NOCOUNT ON; " + sql + ";\nGO\n"
        actual[name] = int(
            db.execute(
                engine, sql, db="nla_import" if engine == "MYSQL" else "nla_chinook", reader=True
            )
        )
    assert actual == {
        "required": 1,
        "identifier": 1,
        "amount-range": 2,
        "category-set": 1,
        "row-count": 6,
        "parent-reference": 1,
    }, engine
    return actual


def empty_table_check(token, item, base):
    """Exercise zero rows using only this runner's exact owned mart, then restore it.

    The original six rows were uploaded through the app. Test-only administrative
    writes simulate an empty source; restoration copies its own unchanged warehouse
    layer, and independent reader checks prove all original observations remain.
    """
    sys.path.insert(0, str(ROOT / "data/scripts"))
    import docker_chinook as db

    assert re.fullmatch(r"quality_qa_[0-9a-f]{10}", item["targetTable"])
    mart = item["targetTable"] + "_mart"
    source = item["targetTable"] + "_warehouse"
    assert item["table"] == {"schema": item["targetSchema"], "name": mart}
    table = (
        lambda name: quoted(item["engine"], item["targetSchema"])
        + "."
        + quoted(item["engine"], name)
    )

    def execute(sql):
        if item["engine"] == "SQL_SERVER":
            sql += "\nGO\n"
        return db.execute(
            item["engine"], sql, db="nla_import" if item["engine"] == "MYSQL" else "nla_chinook"
        )

    try:
        execute("DELETE FROM " + table(mart) + ";")
        run = wait(token, base, request(base + "/runs", token, {}, status=202))
        assert run["status"] == "FAILED" and len(run["checks"]) == 6
        for check in run["checks"]:
            assert check["checkedRows"] == "0"
            assert check["violations"] == ("1" if check["type"] == "ROW_COUNT" else "0")
    finally:
        count_sql = "SELECT COUNT(*) FROM " + table(mart) + ";"
        if item["engine"] == "SQL_SERVER":
            count_sql = "SET NOCOUNT ON; " + count_sql
        remaining = int(execute(count_sql))
        if remaining == 0:
            execute("INSERT INTO " + table(mart) + " SELECT * FROM " + table(source) + ";")
        else:
            assert remaining == 6, "Unexpected owned fixture state during restoration"
    independent_counts(item)
    return run["runId"]


def verify(token, restart=False):
    fixtures = json.loads(MANIFEST.read_text())
    report = {"mocked": False, "onlineProviderTested": False, "engines": {}}
    try:
        for item in fixtures:
            independent = independent_counts(item)
            base = "/datasets/" + item["datasetId"] + "/quality"
            configured = request(base + "/rules", token)
            original = {"revision": configured["revision"], "rules": rules(item)}
            saved = request(base + "/rules", token, original, method="PUT")
            request(base + "/rules", token, original, method="PUT", status=409)
            invalid = {"revision": saved["revision"], "rules": [*rules(item)]}
            invalid["rules"][0] = {**invalid["rules"][0], "sql": "SELECT 1"}
            request(base + "/rules", token, invalid, method="PUT", status=400)
            started_at = time.monotonic()
            started = request(base + "/runs", token, {}, status=202)
            accepted_ms = round((time.monotonic() - started_at) * 1000)
            item["qualityRuns"].append(started["runId"])
            persist(MANIFEST, fixtures)
            outcome = wait(token, base, started)
            assert outcome["status"] == "FAILED", (item["engine"], outcome.get("error"))
            assert outcome["consistency"] == "PER_CHECK"
            expected = {
                "required": ("6", "1"),
                "identifier": ("6", "1"),
                "amount-range": ("6", "2"),
                "category-set": ("6", "1"),
                "row-count": ("6", "0"),
                "parent-reference": ("5", "1"),
            }
            actual = {
                check["ruleId"]: (check["checkedRows"], check["violations"])
                for check in outcome["checks"]
            }
            assert actual == expected, (item["engine"], actual)
            assert outcome["revision"] == saved["revision"]
            passing = [dict(check) for check in saved["rules"]]
            passing[0].update({"column": "item_id"})
            passing[1]["enabled"] = False
            passing[2].update({"min": "-1", "max": "105"})
            passing[3]["values"] = ["A", "B", "C"]
            passing[5]["column"] = "item_id"
            passing_saved = request(
                base + "/rules",
                token,
                {"revision": saved["revision"], "rules": passing},
                method="PUT",
            )
            second = request(base + "/runs", token, {}, status=202)
            item["qualityRuns"].append(second["runId"])
            persist(MANIFEST, fixtures)
            passed = wait(token, base, second)
            assert passed["status"] == "PASSED", (item["engine"], passed.get("error"))
            assert len(passed["checks"]) == 5 and all(
                c["violations"] == "0" for c in passed["checks"]
            )
            assert request(base + "/runs/" + started["runId"], token) == outcome
            history = request(base + "/runs?page=1&pageSize=1", token)
            assert history["totalItems"] >= 2 and len(history["items"]) == 1
            # Restore violating rules for the UI: this is configuration, not manufactured result data.
            final = request(
                base + "/rules",
                token,
                {"revision": passing_saved["revision"], "rules": rules(item)},
                method="PUT",
            )
            item["revision"] = final["revision"]
            empty_run_id = empty_table_check(token, item, base)
            item["qualityRuns"].append(empty_run_id)
            persist(MANIFEST, fixtures)
            report["engines"][item["engine"]] = {
                "status": "PASS",
                "emptyRunId": empty_run_id,
                "failedRunId": started["runId"],
                "passedRunId": second["runId"],
                "violations": {k: v[1] for k, v in actual.items()},
                "asyncAcceptMs": accepted_ms,
                "independentReaderCounts": independent,
                "historySnapshots": "PASS",
                "revisionConflict": "PASS",
            }
        if restart:
            compose.compose("restart", "backend")
            compose.compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "180", "backend")
            token = compose.service_token()
            for item in fixtures:
                base = "/datasets/" + item["datasetId"] + "/quality"
                assert request(base + "/rules", token)["revision"] == item["revision"]
                assert (
                    request(base + "/runs/" + item["qualityRuns"][0], token)["status"] == "FAILED"
                )
            report["restartPersistence"] = "PASS"
        report["status"] = "PASS"
    except BaseException:
        report["status"] = "FAIL"
        raise
    finally:
        persist(REPORT, report)
    print(json.dumps(report))


def cleanup(token):
    sys.path.insert(0, str(ROOT / "data/scripts"))
    import docker_chinook as db

    fixtures = json.loads(MANIFEST.read_text())
    assert len(fixtures) == 3 and {x["engine"] for x in fixtures} == {
        "POSTGRESQL",
        "MYSQL",
        "SQL_SERVER",
    }
    for item in fixtures:
        assert re.fullmatch(r"quality_qa_[0-9a-f]{10}", item["targetTable"])
        assert re.fullmatch(r"wh-[0-9a-f-]{36}", item["warehouseId"])
        assert re.fullmatch(r"ds-[0-9a-f-]{36}", item["datasetId"])
        assert (
            request("/warehouses/" + item["warehouseId"], token)["name"]
            == "Data quality QA / " + item["engine"]
        )
        assert len(item["tables"]) == 4
        for layer in item["tables"]:
            assert layer["schema"] == item["targetSchema"]
            assert layer["name"] in {
                item["targetTable"] + "_" + s for s in ("raw", "staging", "warehouse", "mart")
            }
        request("/datasets/" + item["datasetId"], token, {"status": "DISABLED"}, method="PATCH")
        request(PREFIX + "/" + item["uploadId"], token, method="DELETE", status=204)
        for layer in reversed(item["tables"]):
            sql = (
                "DROP TABLE IF EXISTS "
                + ".".join(quoted(item["engine"], layer[k]) for k in ("schema", "name"))
                + ";"
            )
            if item["engine"] == "SQL_SERVER":
                sql += "\nGO\n"
            db.execute(
                item["engine"], sql, db="nla_import" if item["engine"] == "MYSQL" else "nla_chinook"
            )
        assert re.fullmatch(r"[A-Za-z0-9-]+", item["uploadId"])
        ds, wh, upload_id = ("'" + item[k] + "'" for k in ("datasetId", "warehouseId", "uploadId"))
        statements = [
            "BEGIN;",
            "DELETE FROM operation_run WHERE document->>'datasetId'=" + ds + ";",
            "DELETE FROM file_ingestion_run WHERE warehouse_id=" + wh + ";",
            "DELETE FROM file_ingestion_plan WHERE warehouse_id=" + wh + ";",
            "DELETE FROM file_upload WHERE id=" + upload_id + ";",
            "DELETE FROM data_quality_rules WHERE dataset_id=" + ds + ";",
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
            name = (
                canonical
                if engine == "POSTGRESQL"
                else {
                    "invoice_line": "InvoiceLine",
                    "media_type": "MediaType",
                    "playlist_track": "PlaylistTrack",
                }.get(canonical, canonical.title())
            )
            table = quoted(engine, name)
            if engine == "SQL_SERVER":
                table = "[dbo]." + table
            sql = "SELECT COUNT(*) FROM " + table + ";"
            if engine == "SQL_SERVER":
                sql = "SET NOCOUNT ON; " + sql + "\nGO\n"
            actual = int(db.execute(engine, sql, db="nla_chinook", reader=True))
            assert actual == expected, (engine, canonical)
            counts[engine][canonical] = actual
    result = {
        "status": "PASS",
        "removedWarehouses": 3,
        "removedDatasets": 3,
        "removedTables": 12,
        "originalChinookCounts": counts,
    }
    persist(ROOT / ".local/compose-app/quality-cleanup-report.json", result)
    print(json.dumps(result))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "verify", "cleanup"))
    parser.add_argument("--restart-backend", action="store_true")
    args = parser.parse_args()
    token = compose.service_token()
    if args.action == "verify":
        verify(token, args.restart_backend)
    else:
        {"prepare": prepare, "cleanup": cleanup}[args.action](token)
