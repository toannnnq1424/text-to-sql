#!/usr/bin/env python3
"""Live bulk-file acceptance through Java: file bytes → typed DB3 → registered catalog.

Only generated disposable targets are cleaned up, using administrative test helpers.
Source data and tokens are never printed. Run using file-service/.venv/bin/python.
"""

import argparse
import io
import json
import re
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from docker_chinook import ROOT, execute
from verify_sql_import import Client, quote, require

BASE = "/warehouse/ingestion/files"
ENGINES = ("POSTGRESQL", "MYSQL", "SQL_SERVER")


def upload(client, extension, content):
    boundary = "nla-" + uuid.uuid4().hex
    data = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="observations.{extension}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()
        + content
        + f"\r\n--{boundary}--\r\n".encode()
    )
    return client.request(BASE, multipart=(data, f"multipart/form-data; boundary={boundary}"))


def fixtures():
    import pyarrow as pa
    import pyarrow.parquet as pq
    from openpyxl import Workbook

    headers = ["id", "amount", "label", "active", "occurred"]
    values = [
        ["9007199254740993", "1234.5000", "Nhạc O'Brien", "true", "2026-10-20T08:00:00+07:00"],
        ["2", "1.0000", None, "false", "2026-10-21T01:02:03.123456"],
    ]
    csv = (
        ",".join(headers)
        + "\n"
        + "\n".join(",".join("" if v is None else str(v) for v in row) for row in values)
        + "\n"
    ).encode()
    wb = Workbook()
    wb.active.append(headers)
    for row in values:
        wb.active.append(row)
    out = io.BytesIO()
    wb.save(out)
    table = pa.table({h: [row[i] for row in values] for i, h in enumerate(headers)})
    parquet = pa.BufferOutputStream()
    pq.write_table(table, parquet)
    return {"csv": csv, "xlsx": out.getvalue(), "parquet": parquet.getvalue().to_pybytes()}


def wait(client, run):
    deadline = time.monotonic() + 180
    while run["status"] in {"PENDING", "RUNNING"} and time.monotonic() < deadline:
        time.sleep(0.15)
        code, run = client.request(BASE + "/runs/" + run["id"])
        require(code == 200, "Cannot read persisted file run")
    return run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8088/api/v1")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".local/docker.env")
    args = parser.parse_args()
    config = dict(
        line.split("=", 1)
        for line in args.env_file.read_text().splitlines()
        if line and not line.startswith("#")
    )
    client = Client(args.base_url, config["LOCAL_API_TOKEN"])
    status, response = client.request("/warehouses?pageSize=100")
    require(status == 200, "Cannot read warehouse registry")
    warehouses = {
        row["engine"]: row["warehouseId"]
        for row in response["items"]
        if row.get("database") == "nla_chinook" and row["status"] == "ACTIVE"
    }
    require(set(warehouses) == set(ENGINES), "Three live warehouse targets required")
    report = {"mocked": False, "checkedAt": datetime.now(timezone.utc).isoformat(), "cases": []}
    code, _ = upload(client, "sql", b"DROP DATABASE unwanted")
    require(code == 422, "File upload must reject SQL")
    code, _ = upload(client, "csv", b"a,a\n1,2\n")
    require(code == 422, "File upload must reject duplicate headers")
    for extension, content in fixtures().items():
        code, source = upload(client, extension, content)
        require(code == 200, f"{extension} upload failed HTTP{code}")
        require(source["rowCount"] == 2 and source["columnCount"] == 5, "Inference mismatch")
        for engine in ENGINES:
            name = "nla_file_" + uuid.uuid4().hex[:12]
            dataset = None
            tables = [name + "_" + layer for layer in ("raw", "staging", "warehouse", "mart")]
            try:
                code, namespaces = client.request(
                    BASE + "/targets?warehouseId=" + warehouses[engine]
                )
                require(
                    code == 200 and "nla_import" in namespaces["namespaces"],
                    f"{engine} actual writer namespaces missing",
                )
                request = {
                    "warehouseId": warehouses[engine],
                    "targetSchema": "nla_import",
                    "targetTable": name,
                    "datasetName": "File acceptance / " + engine,
                    "columns": source["columns"],
                }
                invalid = json.loads(json.dumps(request))
                invalid["columns"][2]["dataType"] = "BIGINT"
                code, error = client.request(BASE + "/" + source["id"] + "/validate", invalid)
                require(
                    code == 422 and error["error"]["code"] == "FILE_MAPPING_INVALID",
                    "Full-file mapping rejection missing",
                )
                code, plan = client.request(BASE + "/" + source["id"] + "/validate", request)
                require(code == 200, f"{extension}->{engine} validate HTTP{code}")
                confirm = {
                    "planId": plan["id"],
                    "digest": plan["digest"],
                    "idempotencyKey": uuid.uuid4().hex,
                }
                code, _ = client.request(BASE + "/runs", {**confirm, "digest": "0" * 64})
                require(code == 400, "Digest tamper accepted")
                code, run = client.request(BASE + "/runs", confirm)
                require(code == 202, f"{engine} confirm failed HTTP{code}")
                code, retry = client.request(BASE + "/runs", confirm)
                require(
                    code == 202 and retry["id"] == run["id"],
                    "Idempotent replay created duplicate job",
                )
                run = wait(client, run)
                require(run["status"] == "SUCCESS", f"{extension}->{engine} run {run['status']}")
                dataset = run["datasetId"]
                require(
                    dataset is not None and run["rowsLoaded"] == 2, "No registered file dataset"
                )
                for table in tables:
                    require(
                        re.fullmatch(r"nla_file_[a-f0-9]{12}_(raw|staging|warehouse|mart)", table)
                        is not None,
                        "Unsafe acceptance table name",
                    )
                    target = quote(engine, "nla_import") + "." + quote(engine, table)
                    count = execute(
                        engine,
                        ("SET NOCOUNT ON; " if engine == "SQL_SERVER" else "")
                        + "SELECT COUNT(*) FROM "
                        + target
                        + ";",
                        db="nla_import" if engine == "MYSQL" else "nla_chinook",
                        reader=True,
                    )
                    require(count.strip() == "2", f"{engine} persisted layer count mismatch")
                target = quote(engine, "nla_import") + "." + quote(engine, tables[-1])
                amount = execute(
                    engine,
                    ("SET NOCOUNT ON; " if engine == "SQL_SERVER" else "")
                    + "SELECT SUM(amount) FROM "
                    + target
                    + ";",
                    db="nla_import" if engine == "MYSQL" else "nla_chinook",
                    reader=True,
                )
                require(
                    Decimal(amount.strip()) == Decimal("1235.5000"), "Decimal aggregate mismatch"
                )
                code, catalog = client.request("/datasets/" + dataset + "/tables")
                require(
                    code == 200
                    and catalog["totalItems"] == 1
                    and catalog["items"][0]["name"] == tables[-1],
                    f"{engine} registered mart catalog missing",
                )
                report["cases"].append(
                    {
                        "format": extension,
                        "engine": engine,
                        "status": "PASS",
                        "layers": 4,
                        "rowCount": 2,
                    }
                )
                print(
                    f"PASS {extension} -> {engine}: upload/mapping/digest/idempotency/persistence/catalog"
                )
            finally:
                if dataset:
                    # Existing Client supports POST by default; use explicit PATCH here.
                    import urllib.request

                    req = urllib.request.Request(
                        client.base + "/datasets/" + dataset,
                        data=b'{"status":"DISABLED"}',
                        method="PATCH",
                        headers={
                            "Authorization": "Bearer " + client.token,
                            "Content-Type": "application/json",
                        },
                    )
                    with urllib.request.urlopen(req, timeout=30):
                        pass
                for table in tables:
                    target = quote(engine, "nla_import") + "." + quote(engine, table)
                    execute(
                        engine,
                        "DROP TABLE IF EXISTS " + target + ";",
                        db="nla_import" if engine == "MYSQL" else "nla_chinook",
                    )
    # Large genuine upload exercises cancellation in an active JDBC batch. No rows
    # are fabricated by the app; only this explicit acceptance fixture generates them.
    content = ("id,measurement\n" + "1,123.4500\n" * 100000).encode()
    code, source = upload(client, "csv", content)
    require(code == 200 and source["rowCount"] == 100000, "Large full-file inference failed")
    for engine in ENGINES:
        name = "nla_file_" + uuid.uuid4().hex[:12]
        layers = [name + "_" + layer for layer in ("raw", "staging", "warehouse", "mart")]
        try:
            request = {
                "warehouseId": warehouses[engine],
                "targetSchema": "nla_import",
                "targetTable": name,
                "datasetName": "Cancellation acceptance",
                "columns": source["columns"],
            }
            code, plan = client.request(BASE + "/" + source["id"] + "/validate", request)
            require(code == 200, "Cancellation plan failed")
            code, run = client.request(
                BASE + "/runs",
                {
                    "planId": plan["id"],
                    "digest": plan["digest"],
                    "idempotencyKey": uuid.uuid4().hex,
                },
            )
            require(code == 202, "Cancellation run not accepted")
            deadline = time.monotonic() + 10
            while run["status"] == "PENDING" and time.monotonic() < deadline:
                time.sleep(0.01)
                _, run = client.request(BASE + "/runs/" + run["id"])
            require(run["status"] == "RUNNING", "Cancellation must interrupt active work")
            code, _ = client.request(BASE + "/runs/" + run["id"] + "/cancel", {})
            require(code == 200, "Cancel rejected")
            run = wait(client, run)
            require(
                run["status"] == "CANCELLED" and run["datasetId"] is None,
                "Cancelled work registered a Dataset",
            )
            require(
                run["partialFailure"] == (engine == "MYSQL"),
                "Unexpected transactional/implicit-DDL cancellation state",
            )
            report["cases"].append(
                {
                    "engine": engine,
                    "kind": "cancel-active-100000-rows",
                    "status": "PASS",
                    "partialFailure": run["partialFailure"],
                }
            )
            print(
                f"PASS active cancellation -> {engine}: no Dataset, correct rollback/partial state"
            )
        finally:
            for table in layers:
                execute(
                    engine,
                    "DROP TABLE IF EXISTS "
                    + quote(engine, "nla_import")
                    + "."
                    + quote(engine, table)
                    + ";",
                    db="nla_import" if engine == "MYSQL" else "nla_chinook",
                )
    report["status"] = "PASS"
    path = ROOT / ".local/file-ingestion-report.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    path.chmod(0o600)
    print(f"PASS {len(report['cases'])} real format/engine cases, exact cleanup complete")


if __name__ == "__main__":
    main()
