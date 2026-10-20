#!/usr/bin/env python3
"""Actual OIDC Java→Python/source-kit→DB3 checks, with local Ollama only."""

import argparse
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
REPORT = ROOT / ".local/compose-app/workbench-report.json"


def request(path, token, body=None, method=None, expected=200):
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(
            urllib.request.Request(compose.API + path, headers=headers, data=data, method=method),
            timeout=180,
        ) as reply:
            value = json.load(reply)
            status = reply.status
    except urllib.error.HTTPError as error:
        status = error.code
        value = json.load(error)
    if status != expected:
        code = (value.get("error") or {}).get("code", "UNKNOWN")
        raise AssertionError(
            f"{method or ('POST' if body is not None else 'GET')} {path.split('?')[0]} HTTP {status} ({code}), expected {expected}"
        )
    return value


def column(table, name):
    normalized = name.lower().replace("_", "")
    return next(
        item["name"]
        for item in table["columns"]
        if item["name"].lower().replace("_", "") == normalized
    )


def quoted(engine, name):
    if engine == "MYSQL":
        return "`" + name.replace("`", "``") + "`"
    if engine == "SQL_SERVER":
        return "[" + name.replace("]", "]]") + "]"
    return '"' + name.replace('"', '""') + '"'


def wait_run(path, token):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        result = request(path, token)
        if result["status"] != "RUNNING":
            return result
        time.sleep(0.5)
    raise AssertionError("Pipeline did not finish within its deadline")


def run(suite="all"):
    if profile_environment(ROOT).get("LLM_BASE_URL") != "http://127.0.0.1:11434/v1":
        raise SystemExit(
            "This smoke test requires the local Ollama profile; online providers are never tested."
        )
    online = ROOT / ".local/compose-app/provider.env"
    digest = hashlib.sha256(online.read_bytes()).hexdigest()
    report = {
        "mocked": False,
        "onlineProviderTested": False,
        "suite": suite,
        "engines": {},
        "createdPipelines": [],
    }
    global REPORT
    REPORT = ROOT / f".local/compose-app/workbench-{suite}-report.json"
    token = compose.service_token()
    try:
        for entry in json.loads((ROOT / ".local/compose-app/registry.json").read_text()):
            engine = entry["engine"]
            prefix = "/datasets/" + entry["datasetId"]
            context = request(prefix + "/semantic-model", token)
            validated = request(prefix + "/semantic-model/validate", token, context)
            assert validated["valid"] is True
            selection = {
                "metrics": [context["metrics"][0]["name"]],
                "dimensions": [],
                "filters": [],
                "limit": 10,
            }
            query = request(prefix + "/semantic-query", token, selection)
            assert query["status"] == "SUCCESS", (engine, query.get("error", {}).get("code"))
            assert query["executionMode"] == "SEMANTIC"
            assert query["model"] == "semantic-compiler"
            assert query["result"]["returnedRowCount"] >= 1
            changed = {**context, "timezone": "not/a/timezone"}
            request(prefix + "/semantic-model/validate", token, changed, expected=400)
            indexed = {"schemaItems": 0}
            recalled = {"hits": []}
            generated = {"queryId": None}
            if suite == "all":
                indexed = request(prefix + "/knowledge/index", token, {})
                assert indexed["status"] == "READY" and indexed["schemaItems"] > 0
                recalled = request(
                    prefix + "/knowledge/search",
                    token,
                    {"question": "total sales by country", "limit": 3},
                )
                assert recalled["strategy"] == "vector" and recalled["hits"]
                request(prefix + "/knowledge/examples", token, {"queryId": query["queryId"]})
                examples = request(prefix + "/knowledge/examples", token)
                approved = next(
                    item
                    for item in examples["items"]
                    if item["sql"] == query["generatedSql"] and item["source"] == "approved-query"
                )
                request(
                    prefix + "/knowledge/examples/" + approved["entryId"], token, method="DELETE"
                )
                generated = request(
                    "/query",
                    token,
                    {
                        "warehouseId": entry["warehouseId"],
                        "datasetId": entry["datasetId"],
                        "question": "How many artists are present in the Artist table?",
                        "mode": "API",
                    },
                    expected=201,
                )
                assert generated["status"] == "SUCCESS", (
                    engine,
                    generated.get("error", {}).get("code"),
                )
                assert generated["model"] == "qwen3:4b"
                assert str(next(iter(generated["result"]["rows"][0].values()))) == "275", engine
            invoice = next(
                table for table in context["tables"] if table["name"].lower() == "invoice"
            )
            country = quoted(engine, column(invoice, "BillingCountry"))
            total = quoted(engine, column(invoice, "Total"))
            target = request(
                "/warehouse/ingestion/files/targets?warehouseId=" + entry["warehouseId"], token
            )
            namespace = target["namespaces"][0]
            if isinstance(namespace, dict):
                namespace = namespace["name"]
            name = (
                "nla_workbench_"
                + hashlib.sha256((engine + str(time.time_ns())).encode()).hexdigest()[:10]
            )
            definition = {
                "name": "Validated sales transformations " + engine,
                "sourceWarehouseId": entry["warehouseId"],
                "sourceDatasetId": entry["datasetId"],
                "sourceTable": {"schema": invoice["schema"], "name": invoice["name"]},
                "targetWarehouseId": entry["warehouseId"],
                "targetSchema": namespace,
                "targetTable": name,
                "datasetName": "Workbench integration " + engine,
                "stages": {
                    "staging": {
                        "columns": [
                            {"name": "region", "expression": country},
                            {"name": "amount", "expression": total},
                        ],
                        "filter": total + " > 5",
                        "groupBy": [],
                    },
                    "warehouse": {
                        "columns": [
                            {"name": "region", "expression": "region"},
                            {"name": "revenue", "expression": "SUM(amount)"},
                            {"name": "orders", "expression": "COUNT(*)"},
                        ],
                        "filter": "",
                        "groupBy": ["region"],
                    },
                    "mart": {
                        "columns": [
                            {"name": "region", "expression": "region"},
                            {"name": "revenue", "expression": "revenue"},
                            {"name": "orders", "expression": "orders"},
                        ],
                        "filter": "revenue > 0",
                        "groupBy": [],
                    },
                },
                "maxRows": 1000,
                "maxBytes": 5242880,
                "timeoutSeconds": 15,
            }
            preview = request("/pipelines/preview", token, definition)
            assert preview["valid"] is True and len(preview["stages"]) == 4
            assert len(preview["stages"][0]["columns"]) > len(preview["stages"][1]["columns"])
            assert preview["warnings"]
            saved = request("/pipelines", token, definition)
            pipeline_id = saved["pipelineId"]
            report["createdPipelines"].append(
                {
                    "pipelineId": pipeline_id,
                    "engine": engine,
                    "targetSchema": namespace,
                    "targetTable": name,
                }
            )
            run = request(
                "/pipelines/" + pipeline_id + "/run", token, {"idempotencyKey": name}, expected=202
            )
            finished = wait_run("/pipelines/runs/" + run["runId"], token)
            assert finished["status"] == "SUCCESS", (engine, finished.get("error"))
            assert finished["datasetId"] and len(finished["createdTables"]) == 4
            counts = {stage["name"]: stage["rowsWritten"] for stage in finished["stages"]}
            assert counts["RAW"] == 412
            assert 0 < counts["MART"] < counts["STAGING"] < counts["RAW"]
            replay = request(
                "/pipelines/" + pipeline_id + "/run", token, {"idempotencyKey": name}, expected=202
            )
            assert replay["runId"] == run["runId"]
            actual = request("/datasets/" + finished["datasetId"] + "/semantic-model", token)
            assert actual["metrics"] == [] and len(actual["tables"]) == 1
            request("/pipelines/preview", token, definition, expected=409)
            report["engines"][engine] = {
                "status": "PASS",
                "knowledgeAndModel": "PASS" if suite == "all" else "NOT RUN",
                "semanticQueryId": query["queryId"],
                "localModelQueryId": generated["queryId"],
                "indexedItems": indexed["schemaItems"],
                "vectorHits": len(recalled["hits"]),
                "pipelineRunId": run["runId"],
                "datasetId": finished["datasetId"],
                "rows": counts,
            }
            REPORT.write_text(json.dumps(report, indent=2))
        report["status"] = "PASS"
    except Exception as error:
        report["status"] = "FAIL"
        report["failure"] = str(error)
        raise
    finally:
        assert (
            hashlib.sha256(online.read_bytes()).hexdigest() == digest
        ), "Online configuration changed"
        REPORT.write_text(json.dumps(report, indent=2))
        REPORT.chmod(0o600)
        print(json.dumps(report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=("all", "pipeline"), default="all")
    run(parser.parse_args().suite)
