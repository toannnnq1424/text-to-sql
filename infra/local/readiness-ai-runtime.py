#!/usr/bin/env python3
"""Unseen local Ollama→Java→three-engine result acceptance, without registry mutation.

Only existing registered Chinook datasets and an existing OLLAMA profile are used.
Independent expectations come from read-only physical source columns evaluated by
SQLite, never from generated SQL or runtime semantic examples. No browser actions.
"""

import argparse
import hashlib
import json
import sqlite3
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

import compose

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "data/scripts"))
import docker_chinook as db

ENGINES = ("POSTGRESQL", "MYSQL", "SQL_SERVER")
SNAPSHOT = {
    "album": {"album_id": "INTEGER", "artist_id": "INTEGER", "title": "TEXT"},
    "employee": {"employee_id": "INTEGER"},
    "invoice": {
        "invoice_id": "INTEGER",
        "customer_id": "INTEGER",
        "invoice_date": "TEXT",
        "billing_country": "TEXT",
        "total": "REAL",
    },
    "invoice_line": {
        "invoice_line_id": "INTEGER",
        "invoice_id": "INTEGER",
        "track_id": "INTEGER",
        "quantity": "INTEGER",
    },
    "track": {"track_id": "INTEGER", "genre_id": "INTEGER", "name": "TEXT"},
    "genre": {"genre_id": "INTEGER", "name": "TEXT"},
    "customer": {"customer_id": "INTEGER", "country": "TEXT", "company": "TEXT"},
}


def request(path, token, body=None):
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    query = urllib.request.Request(compose.API + path, headers=headers, data=data)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(query, timeout=75) as response:
            return response.status, json.load(response), round((time.monotonic() - started) * 1000)
    except urllib.error.HTTPError as error:
        try:
            value = json.load(error)
        except (ValueError, UnicodeError):
            value = {"error": {"code": "NON_JSON_HTTP_ERROR"}}
        return error.code, value, round((time.monotonic() - started) * 1000)
    except (TimeoutError, urllib.error.URLError):
        return (
            0,
            {"error": {"code": "CLIENT_TRANSPORT_FAILURE"}},
            round((time.monotonic() - started) * 1000),
        )


def service_token():
    """Read existing service identity without editing IdP/registry configuration."""
    identity = json.loads((ROOT / ".local/compose-app/provisioner.json").read_text())
    return compose.request(
        compose.ISSUER + "/protocol/openid-connect/token",
        form={
            "client_id": identity["clientId"],
            "client_secret": identity["secret"],
            "grant_type": "client_credentials",
        },
    )["access_token"]


def result_pages(query, token):
    """POST returns a preview; fetch every persisted result page before comparison."""
    first = query.get("result") or {}
    expected_count = first.get("returnedRowCount", 0)
    if len(first.get("rows", [])) >= expected_count:
        return first
    rows = []
    page = 1
    while len(rows) < expected_count:
        code, value, _ = request(
            "/query/" + query["queryId"] + "/result?pageSize=100&page=" + str(page), token
        )
        if code != 200 or not value.get("rows"):
            return {**first, "rows": rows, "snapshotFetchFailed": True}
        rows.extend(value["rows"])
        page += 1
    return {**first, "rows": rows, "snapshotFetchFailed": False}


def persist(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    path.chmod(0o600)


def independent_snapshot():
    connection = sqlite3.connect(":memory:")
    counts = {}
    hashes = {}
    for table, columns in SNAPSHOT.items():
        names = list(columns)
        sql = "SELECT row_to_json(snapshot) FROM (SELECT " + ",".join(names)
        sql += " FROM public." + table + " ORDER BY " + names[0] + ") snapshot;"
        raw = db.execute("POSTGRESQL", sql, db="nla_chinook", reader=True)
        rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
        expected_count = db.SOURCE["expectedCounts"][table]
        if len(rows) != expected_count:
            raise SystemExit("Physical Chinook oracle snapshot differs from pinned source count.")
        counts[table] = len(rows)
        hashes[table] = hashlib.sha256(raw.encode()).hexdigest()
        connection.execute(
            "CREATE TABLE " + table + " (" + ",".join(k + " " + v for k, v in columns.items()) + ")"
        )
        connection.executemany(
            "INSERT INTO " + table + " VALUES (" + ",".join("?" for _ in names) + ")",
            [tuple(row[name] for name in names) for row in rows],
        )
    return connection, {
        "engine": "POSTGRESQL",
        "readerOnly": True,
        "counts": counts,
        "sha256": hashes,
    }


def value_equal(left, right, tolerance):
    if left is None or right is None:
        return left is right
    try:
        a, b = Decimal(str(left)), Decimal(str(right))
        if a.is_finite() and b.is_finite():
            return abs(a - b) <= tolerance
    except InvalidOperation:
        pass
    return str(left) == str(right)


def rows_equal(expected, actual, ordered, tolerance):
    if len(expected) != len(actual):
        return False
    remaining = list(actual)
    for position, row in enumerate(expected):
        matches = [position] if ordered else range(len(remaining))
        found = next(
            (
                index
                for index in matches
                if index < len(remaining)
                and len(row) == len(remaining[index])
                and all(value_equal(a, b, tolerance) for a, b in zip(row, remaining[index]))
            ),
            None,
        )
        if found is None:
            return False
        if not ordered:
            remaining.pop(found)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=ROOT / ".local/compose-app/readiness-ai-report.json"
    )
    parser.add_argument("--case", action="append", dest="case_ids")
    parser.add_argument("--engine", action="append", choices=ENGINES)
    parser.add_argument(
        "--resume", action="store_true", help="Keep completed evidence and run missing cases only"
    )
    args = parser.parse_args()
    parsed = urllib.parse.urlparse(compose.API)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise SystemExit("This acceptance runner is restricted to local Java.")
    token = service_token()
    status, profiles, _ = request("/settings/model-providers", token)
    if status != 200:
        raise SystemExit("Cannot inspect configured model profile safely.")
    profile = next(p for p in profiles["items"] if p["providerId"] == profiles["defaultProviderId"])
    target = urllib.parse.urlparse(profile["baseUrl"])
    if (
        profile["kind"] != "OLLAMA"
        or target.hostname not in {"localhost", "127.0.0.1", "host.docker.internal"}
        or target.port != 11434
        or not profile["enabled"]
        or not profile["configured"]
    ):
        raise SystemExit(
            "The existing default must be configured local Ollama; no settings changed."
        )
    corpus_path = ROOT / "ai-service/evaluation/readiness-corpus.json"
    corpus = json.loads(corpus_path.read_text())
    cases = [c for c in corpus["cases"] if not args.case_ids or c["id"] in args.case_ids]
    if not cases or (args.case_ids and len(cases) != len(set(args.case_ids))):
        raise SystemExit("Unknown or duplicate requested validation case.")
    oracle, snapshot = independent_snapshot()
    registry = [
        entry
        for entry in json.loads((ROOT / ".local/compose-app/registry.json").read_text())
        if not args.engine or entry["engine"] in args.engine
    ]
    if not registry:
        raise SystemExit("No existing registered dataset matches the requested engine.")
    report = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "mocked": False,
        "mode": "API",
        "onlineProviderTested": False,
        "registryOrIngestionMutated": False,
        "provider": {key: profile[key] for key in ("providerId", "kind", "model", "source")},
        "source": db.SOURCE,
        "oracleSnapshot": snapshot,
        "corpusSha256": hashlib.sha256(corpus_path.read_bytes()).hexdigest(),
        "numericTolerance": corpus["numericTolerance"],
        "plannedCaseCount": len(registry) * len(cases),
        "cases": [],
    }
    if args.resume:
        previous = json.loads(args.output.read_text())
        for key in ("provider", "corpusSha256", "oracleSnapshot", "plannedCaseCount"):
            if previous.get(key) != report[key]:
                raise SystemExit(
                    "Resume evidence changed: " + key + "; use a separate output file."
                )
        report = previous
        report.setdefault("resumedAt", []).append(datetime.now(timezone.utc).isoformat())
    persist(args.output, report)
    completed = {(case["engine"], case["caseId"]) for case in report["cases"]}
    for entry in registry:
        token = service_token()
        code, semantics, _ = request("/datasets/" + entry["datasetId"] + "/semantic-model", token)
        if code != 200:
            raise SystemExit("Registered dataset semantic metadata could not be read.")
        for case in cases:
            if (entry["engine"], case["id"]) in completed:
                continue
            if any(
                e["question"].casefold() == case["question"].casefold()
                for e in semantics["examples"]
            ):
                raise SystemExit(
                    "Unseen validation question unexpectedly exists in runtime examples."
                )
            token = service_token()
            code, actual, latency = request(
                "/query",
                token,
                {
                    "warehouseId": entry["warehouseId"],
                    "datasetId": entry["datasetId"],
                    "question": case["question"],
                    "mode": "API",
                    "providerId": profile["providerId"],
                },
            )
            output = result_pages(actual, token)
            columns = [c["name"] for c in output.get("columns", [])]
            rows = [[row.get(column) for column in columns] for row in output.get("rows", [])]
            expected = (
                [list(row) for row in oracle.execute(case["oracleSql"]).fetchall()]
                if case.get("oracleSql")
                else None
            )
            local_provenance = (
                actual.get("executionMode") == "API"
                and actual.get("model") == profile["model"]
                and (actual.get("provider") or {}).get("kind") == "OLLAMA"
            )
            if case.get("expectedRejection"):
                passed = code == 201 and actual.get("status") == "REJECTED"
            else:
                passed = (
                    code == 201
                    and actual.get("status") == "SUCCESS"
                    and local_provenance
                    and not output.get("truncated")
                    and not output.get("snapshotFetchFailed")
                    and rows_equal(
                        expected, rows, case["ordered"], Decimal(corpus["numericTolerance"])
                    )
                    and (
                        not case.get("requiresApproximateAssumption")
                        or any("approximate" in a for a in actual.get("assumptions", []))
                    )
                )
            record = {
                "engine": entry["engine"],
                "caseId": case["id"],
                "question": case["question"],
                "expectedRejection": bool(case.get("expectedRejection")),
                "status": "PASS" if passed else "FAIL",
                "httpStatus": code,
                "queryStatus": actual.get("status"),
                "errorCode": (actual.get("error") or {}).get("code"),
                "queryId": actual.get("queryId"),
                "elapsedMs": latency,
                "model": actual.get("model"),
                "provider": actual.get("provider"),
                "semanticVersion": actual.get("semanticVersion"),
                "schemaVersion": actual.get("schemaVersion"),
                "generatedSql": actual.get("generatedSql"),
                "candidateSql": actual.get("candidateSql"),
                "assumptions": actual.get("assumptions"),
                "expectedRows": expected,
                "actualRows": rows,
                "actualColumns": columns,
                "returnedRowCount": output.get("returnedRowCount"),
                "truncated": output.get("truncated"),
                "snapshotFetchFailed": output.get("snapshotFetchFailed", False),
            }
            report["cases"].append(record)
            report["passed"] = sum(item["status"] == "PASS" for item in report["cases"])
            report["failed"] = len(report["cases"]) - report["passed"]
            persist(args.output, report)
            print(
                json.dumps(
                    {
                        k: record[k]
                        for k in (
                            "engine",
                            "caseId",
                            "status",
                            "queryStatus",
                            "errorCode",
                            "elapsedMs",
                        )
                    }
                ),
                flush=True,
            )
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    positive = [case for case in report["cases"] if not case["expectedRejection"]]
    safety = [case for case in report["cases"] if case["expectedRejection"]]
    latencies = sorted(case["elapsedMs"] for case in report["cases"])
    report["resultAccuracy"] = {
        "passed": sum(case["status"] == "PASS" for case in positive),
        "attempted": len(positive),
    }
    report["controlledRejection"] = {
        "passed": sum(case["status"] == "PASS" for case in safety),
        "attempted": len(safety),
    }
    report["latencyMs"] = {
        "median": statistics.median(latencies),
        "p95": latencies[max(0, (len(latencies) * 95 + 99) // 100 - 1)],
        "maximum": max(latencies),
    }
    report["status"] = "PASS" if not report["failed"] else "FAIL"
    persist(args.output, report)
    print(json.dumps({k: report[k] for k in ("status", "passed", "failed")}), flush=True)


if __name__ == "__main__":
    main()
