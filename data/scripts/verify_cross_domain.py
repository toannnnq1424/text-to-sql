#!/usr/bin/env python3
"""Real Java→Python→three-engine evaluation with an isolated synthetic second domain.

This test creates a uniquely named temporary table and registered test dataset,
then disables the dataset and removes its table. No runtime seed or UI fallback.
Expected results are calculated independently from synthetic records in SQLite.
"""

import argparse
import json
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
import uuid
from copy import deepcopy
from decimal import Decimal
from pathlib import Path

from docker_chinook import ROOT, execute

ENGINES = ("POSTGRESQL", "MYSQL", "SQL_SERVER")
RECORDS = [
    (1, "open", "billing", None, "high"),
    (2, "closed", "billing", 25, "normal"),
    (3, "closed", "technical", 62, "high"),
    (4, "pending", "technical", None, "normal"),
    (5, "closed", "account", 9, "low"),
    (6, "open", "account", None, "normal"),
    (7, "closed", "billing", 40, "high"),
    (8, "pending", "billing", 11, "low"),
    (9, "closed", "technical", 33, "normal"),
    (10, "open", "technical", None, "high"),
    (11, "closed", "account", 14, "normal"),
    (12, "closed", "account", 20, "low"),
]


def quote(engine, value):
    if engine == "MYSQL":
        return f"`{value}`"
    if engine == "SQL_SERVER":
        return f"[{value}]"
    return f'"{value}"'


def canonical(rows):
    def value(cell):
        if cell is None:
            return None
        try:
            number = Decimal(str(cell))
            if number.is_finite():
                # Mean computations differ in driver scale; compare a declared tolerance.
                return str(number.quantize(Decimal("0.000001")))
        except Exception:
            pass
        return str(cell)

    return sorted(json.dumps({k: value(v) for k, v in row.items()}, sort_keys=True) for row in rows)


class Client:
    def __init__(self, base, token):
        parsed = urllib.parse.urlparse(base)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise ValueError("Evaluation requires an explicitly local API")
        self.base = base.rstrip("/")
        self.token = token

    def call(self, path, body=None, method=None):
        req = urllib.request.Request(
            self.base + path,
            data=json.dumps(body).encode() if body is not None else None,
            method=method,
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=70) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            envelope = json.load(error)
            raise AssertionError(
                f"Java API HTTP {error.code}: {envelope.get('error', {}).get('code')}"
            ) from None


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
    corpus = json.loads((ROOT / "ai-service/evaluation/synthetic-support.json").read_text())
    warehouses = {
        row["engine"]: row
        for row in client.call("/warehouses?pageSize=100")["items"]
        if row.get("database") == "nla_chinook" and row["status"] == "ACTIVE"
    }
    assert set(warehouses) == set(ENGINES), "Three local sample warehouses required"
    expected_db = sqlite3.connect(":memory:")
    expected_db.row_factory = sqlite3.Row
    expected_db.execute(
        "CREATE TABLE support_ticket(ticket_id INTEGER,status TEXT,category TEXT,resolution_minutes INTEGER,priority TEXT)"
    )
    expected_db.executemany("INSERT INTO support_ticket VALUES (?,?,?,?,?)", RECORDS)
    report = {
        "mocked": False,
        "mode": "DETERMINISTIC",
        "domain": "synthetic-support",
        "synthetic": True,
        "meanTolerance": "0.000001",
        "cases": [],
    }
    try:
        for engine in ENGINES:
            warehouse = warehouses[engine]
            schema = {"POSTGRESQL": "public", "MYSQL": "nla_chinook", "SQL_SERVER": "dbo"}[engine]
            table = "it_support_" + uuid.uuid4().hex[:12]
            target = f"{quote(engine,schema)}.{quote(engine,table)}"
            dataset = None
            try:
                # Names and values below are generated/trusted test fixtures, not upload SQL.
                execute(
                    engine,
                    f"CREATE TABLE {target} (ticket_id BIGINT PRIMARY KEY,status VARCHAR(20) NOT NULL,category VARCHAR(30) NOT NULL,resolution_minutes INTEGER NULL,priority VARCHAR(20) NOT NULL);",
                    db="nla_chinook",
                )
                literals = []
                for record in RECORDS:
                    literals.append(
                        "("
                        + ",".join(
                            (
                                "NULL"
                                if cell is None
                                else (
                                    str(cell)
                                    if isinstance(cell, int)
                                    else "'" + cell.replace("'", "''") + "'"
                                )
                            )
                            for cell in record
                        )
                        + ")"
                    )
                execute(
                    engine,
                    f"INSERT INTO {target} (ticket_id,status,category,resolution_minutes,priority) VALUES "
                    + ",".join(literals)
                    + ";",
                    db="nla_chinook",
                )
                principal = "'nla_reader'@'%'" if engine == "MYSQL" else "nla_reader"
                execute(engine, f"GRANT SELECT ON {target} TO {principal};", db="nla_chinook")
                discovery = client.call(f"/warehouses/{warehouse['warehouseId']}/discover", {})
                assert discovery["status"] == "SUCCESS"
                dataset = client.call(
                    "/datasets",
                    {
                        "warehouseId": warehouse["warehouseId"],
                        "name": "Synthetic support integration test " + table,
                        "description": "Generated local acceptance fixture; not production data",
                        "allowedSchemas": [schema],
                        "allowedTables": [{"schema": schema, "name": table}],
                        "semanticVersion": "1.0.0",
                        "schemaVersion": "1.0.0",
                    },
                )
                semantics = deepcopy(corpus["dialects"][engine]["semanticContext"])
                # Substitute only the fixture's known table identifier, never arbitrary user SQL.
                semantics = json.loads(
                    json.dumps(semantics)
                    .replace("support_ticket", table)
                    .replace("nla_synthetic", schema)
                )
                client.call(f"/datasets/{dataset['datasetId']}/semantic-model", semantics, "PUT")
                for case in corpus["dialects"][engine]["cases"]:
                    actual = client.call(
                        "/query",
                        {
                            "warehouseId": warehouse["warehouseId"],
                            "datasetId": dataset["datasetId"],
                            "question": case["question"],
                            "mode": "DETERMINISTIC",
                        },
                    )
                    entry = {
                        "caseId": case["caseId"],
                        "engine": engine,
                        "queryId": actual["queryId"],
                        "logicalCaseId": case["logicalCaseId"],
                    }
                    if case["expectedRejection"]:
                        passed = actual["status"] == "REJECTED"
                    else:
                        english = next(
                            item
                            for item in corpus["dialects"]["POSTGRESQL"]["cases"]
                            if item["caseId"] == case["caseId"]
                        )
                        sql = english["expectedSql"].replace('"public".', "")
                        expected = [dict(row) for row in expected_db.execute(sql).fetchall()]
                        passed = (
                            actual["status"] == "SUCCESS"
                            and canonical(actual["result"]["rows"]) == canonical(expected)
                            and actual["chart"]["type"] == case["expectedChart"]
                        )
                    entry["status"] = "PASS" if passed else "FAIL"
                    entry["queryStatus"] = actual["status"]
                    entry["errorCode"] = (actual.get("error") or {}).get("code")
                    report["cases"].append(entry)
                    print(engine, case["caseId"], entry["status"], flush=True)
            finally:
                if dataset is not None:
                    client.call(
                        f"/datasets/{dataset['datasetId']}", {"status": "DISABLED"}, "PATCH"
                    )
                execute(engine, f"DROP TABLE IF EXISTS {target};", db="nla_chinook")
        assert all(
            case["status"] == "PASS" for case in report["cases"]
        ), "Cross-domain cases failed; inspect private report (no row values)."
        report["status"] = "PASS"
    finally:
        report.setdefault("status", "FAIL")
        output = ROOT / ".local/cross-domain-report.json"
        output.parent.mkdir(mode=0o700, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")
        output.chmod(0o600)
        expected_db.close()


if __name__ == "__main__":
    main()
