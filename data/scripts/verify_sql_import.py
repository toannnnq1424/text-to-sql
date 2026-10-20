#!/usr/bin/env python3
"""Exercise Java SQL Import against isolated local Docker targets, without API doubles.

Only generated integration-test tables under nla_import are created/removed. This
is an acceptance test, never an importer for arbitrary user-provided SQL files.
"""

import argparse
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from docker_chinook import ROOT, execute

ENGINES = ("POSTGRESQL", "MYSQL", "SQL_SERVER")


def quote(engine, value):
    if engine == "MYSQL":
        return f"`{value}`"
    if engine == "SQL_SERVER":
        return f"[{value}]"
    return f'"{value}"'


def fixture(engine, table):
    name = f"{quote(engine, 'nla_import')}.{quote(engine, table)}"
    boolean = "BIT" if engine == "SQL_SERVER" else "BOOLEAN"
    timestamp = (
        "DATETIME2" if engine == "SQL_SERVER" else "DATETIME" if engine == "MYSQL" else "TIMESTAMP"
    )
    first_bool, second_bool = ("1", "0") if engine == "SQL_SERVER" else ("TRUE", "FALSE")
    return (
        f"CREATE TABLE {name} (id INTEGER PRIMARY KEY, amount DECIMAL(18,3) NOT NULL, "
        f"note VARCHAR(100), active {boolean}, event_date DATE, event_time {timestamp});\n"
        f"INSERT INTO {name} (id,amount,note,active,event_date,event_time) VALUES "
        f"(1,123.125,'O''Brien [literal]',{first_bool},'2026-10-20','2026-10-20 01:02:03'),"
        f"(2,1.000,NULL,{second_bool},'2026-10-21','2026-10-21 01:02:03');\n"
    ).encode("utf-8")


class Client:
    def __init__(self, base, token):
        parsed = urllib.parse.urlparse(base)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise ValueError("This acceptance runner requires a loopback HTTP API.")
        self.base = base.rstrip("/")
        self.token = token

    def request(self, path, body=None, multipart=None):
        headers = {"Authorization": f"Bearer {self.token}"}
        data = None
        if multipart is not None:
            data, content_type = multipart
            headers["Content-Type"] = content_type
        elif body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base + path, data=data, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=70) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def validate(self, warehouse, dialect, sql, filename="acceptance.sql"):
        boundary = "nla-" + uuid.uuid4().hex
        parts = []
        for key, value in {
            "warehouseId": warehouse,
            "sourceDialect": dialect,
            "targetSchema": "nla_import",
        }.items():
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
            )
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/sql\r\n\r\n'.encode()
            + sql
            + f"\r\n--{boundary}--\r\n".encode()
        )
        return self.request(
            "/import/sql/validate",
            multipart=(b"".join(parts), f"multipart/form-data; boundary={boundary}"),
        )


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def verify_rows(engine, table):
    name = f"{quote(engine, 'nla_import')}.{quote(engine, table)}"
    output = execute(
        engine,
        f"SELECT COUNT(*), SUM(amount), SUM(CASE WHEN note IS NULL THEN 1 ELSE 0 END) FROM {name};",
        db="nla_import" if engine == "MYSQL" else "nla_chinook",
        importer=True,
    )
    match = re.search(r"(?:^|\n)\s*(2)[|\s]+([0-9.]+)[|\s]+(1)(?:\s|$)", output)
    require(match is not None, f"{engine}: persisted row count/null integrity mismatch")
    require(Decimal(match[2]) == Decimal("124.125"), f"{engine}: decimal precision mismatch")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080/api/v1")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".local/docker.env")
    args = parser.parse_args()
    config = dict(
        line.split("=", 1)
        for line in args.env_file.read_text().splitlines()
        if line and not line.startswith("#")
    )
    client = Client(args.base_url, config["LOCAL_API_TOKEN"])
    status, response = client.request("/warehouses?pageSize=100")
    require(status == 200, "Cannot read authorized warehouse registry")
    warehouses = {
        row["engine"]: row["warehouseId"]
        for row in response["items"]
        if row.get("database") == "nla_chinook" and row["status"] == "ACTIVE"
    }
    require(
        set(warehouses) == set(ENGINES), "Expected three provisioned isolated Docker warehouses"
    )
    report = {"mocked": False, "checkedAt": datetime.now(timezone.utc).isoformat(), "cases": []}
    try:
        for target in ENGINES:
            for source in ENGINES:
                table = "nla_it_" + uuid.uuid4().hex[:12]
                try:
                    code, plan = client.validate(warehouses[target], source, fixture(source, table))
                    require(
                        code == 200,
                        f"{source} -> {target}: validation HTTP {code} ({plan.get('error', {}).get('code', '')})",
                    )
                    require(
                        plan["sourceDialect"] == source, "Plan must preserve caller sourceDialect"
                    )
                    require(plan["targetEngine"] == target, "Plan target engine mismatch")
                    body = {
                        "planId": plan["planId"],
                        "planDigest": plan["planDigest"],
                        "idempotencyKey": uuid.uuid4().hex,
                    }
                    code, _ = client.request("/import/sql/runs", {**body, "planDigest": "0" * 64})
                    require(code == 409, "Tampered digest must reject")
                    code, run = client.request("/import/sql/runs", body)
                    require(code == 202, f"{source} -> {target}: import submission failed")
                    deadline = time.monotonic() + 70
                    while run["status"] == "RUNNING" and time.monotonic() < deadline:
                        time.sleep(0.15)
                        detail_code, run = client.request("/import/sql/runs/" + run["runId"])
                        require(detail_code == 200, "Cannot poll persisted import run")
                    require(
                        run["status"] == "SUCCESS", f"{source} -> {target}: import execution failed"
                    )
                    require(run["rowsAffected"] == 2, "Import row count mismatch")
                    repeat_code, repeated = client.request("/import/sql/runs", body)
                    require(
                        repeat_code == 202 and repeated["runId"] == run["runId"],
                        "Duplicate confirmation must return same run",
                    )
                    detail_code, detail = client.request("/import/sql/runs/" + run["runId"])
                    require(
                        detail_code == 200 and detail["status"] == "SUCCESS",
                        "Import run persistence mismatch",
                    )
                    verify_rows(target, table)
                    report["cases"].append(
                        {
                            "sourceDialect": source,
                            "targetEngine": target,
                            "runId": run["runId"],
                            "status": "PASS",
                            "rowsVerified": 2,
                        }
                    )
                    print(source, "->", target, "PASS", flush=True)
                finally:
                    name = f"{quote(target, 'nla_import')}.{quote(target, table)}"
                    execute(
                        target,
                        f"DROP TABLE IF EXISTS {name};",
                        db="nla_import" if target == "MYSQL" else "nla_chinook",
                    )
        for sql in (
            b"DROP TABLE nla_import.protected;",
            b"SELECT 1;",
            b"CREATE TABLE nla_import.x (id INT); INSERT INTO nla_import.x (id) SELECT 1;",
        ):
            code, _ = client.validate(warehouses["POSTGRESQL"], "POSTGRESQL", sql)
            require(
                400 <= code < 500, "Unsupported/destructive input must fail with controlled 4xx"
            )
        code, _ = client.validate(warehouses["POSTGRESQL"], "POSTGRESQL", b"\xff")
        require(400 <= code < 500, "Invalid UTF-8 must fail with controlled 4xx")
        report["status"] = "PASS"
    except Exception:
        report["status"] = "FAIL"
        raise
    finally:
        path = ROOT / ".local/application-import-report.json"
        path.parent.mkdir(mode=0o700, exist_ok=True)
        path.write_text(json.dumps(report, indent=2) + "\n")
        path.chmod(0o600)


if __name__ == "__main__":
    main()
