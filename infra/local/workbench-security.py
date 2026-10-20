#!/usr/bin/env python3
"""Real local OIDC authorization, pipeline failure and independent DB3 result checks.

Creates isolated short-lived service-account identities and test-only tables. No online
model calls, mock transports, credentials, tokens or source rows are written to reports.
"""

import copy
import hashlib
import json
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal
from pathlib import Path

import compose
from llm_profile import profile_environment

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "data/scripts"))
import docker_chinook as db

REPORT = ROOT / ".local/compose-app/workbench-security-report.json"
report = {"mocked": False, "onlineProviderTested": False, "checks": {}, "engines": {}}
owned = {
    "clients": [],
    "grants": [],
    "tables": [],
    "datasets": [],
    "pipelines": [],
    "runs": [],
    "queries": [],
}


def request(path, token=None, body=None, method=None, expected=200):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    payload = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(
            urllib.request.Request(
                compose.API + path, data=payload, headers=headers, method=method
            ),
            timeout=120,
        ) as reply:
            raw = reply.read()
            value = json.loads(raw) if raw else None
            status = reply.status
    except urllib.error.HTTPError as error:
        raw = error.read()
        value = json.loads(raw) if raw else None
        status = error.code
    if status != expected:
        code = ((value or {}).get("error") or {}).get("code", "UNKNOWN")
        raise AssertionError(
            f"{method or ('POST' if body is not None else 'GET')} {path.split('?')[0]} HTTP{status} {code}; expected{expected}"
        )
    return value


def quote(engine, name):
    if engine == "MYSQL":
        return "`" + name.replace("`", "``") + "`"
    if engine == "SQL_SERVER":
        return "[" + name.replace("]", "]]") + "]"
    return '"' + name.replace('"', '""') + '"'


def table(engine, schema, name):
    return quote(engine, schema) + "." + quote(engine, name)


def execute(engine, sql, reader=False):
    database = "nla_import" if engine == "MYSQL" else "nla_chinook"
    if engine == "SQL_SERVER":
        sql = "SET NOCOUNT ON; " + sql + ";\nGO\n"
    return db.execute(engine, sql, db=database, reader=reader)


def existing(engine, schema, name):
    # All names passed here are generated ASCII identifiers, never external input.
    if not name.replace("_", "").isalnum() or not schema.replace("_", "").isalnum():
        raise AssertionError("Unsafe test identifier")
    query = f"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='{schema}' AND table_name='{name}'"
    return int(execute(engine, query, reader=True).strip())


def column(physical, name):
    return next(
        c["name"] for c in physical["columns"] if c["name"].lower().replace("_", "") == name.lower()
    )


def transform(columns, filter="", group=None):
    return {
        "columns": [{"name": name, "expression": sql} for name, sql in columns],
        "filter": filter,
        "groupBy": group or [],
    }


def definition(entry, physical, suffix):
    engine = entry["engine"]
    namespaces = request(
        "/warehouse/ingestion/files/targets?warehouseId=" + entry["warehouseId"], admin
    )["namespaces"]
    return {
        "name": "Security integration " + suffix,
        "sourceWarehouseId": entry["warehouseId"],
        "sourceDatasetId": entry["datasetId"],
        "sourceTable": {"schema": physical["schema"], "name": physical["name"]},
        "targetWarehouseId": entry["warehouseId"],
        "targetSchema": namespaces[0],
        "targetTable": suffix,
        "datasetName": "Security integration " + suffix,
        "stages": {
            "staging": transform([("amount", quote(engine, column(physical, "total")))]),
            "warehouse": transform([("revenue", "SUM(amount)")]),
            "mart": transform([("revenue", "revenue")]),
        },
        "maxRows": 1000,
        "maxBytes": 5242880,
        "timeoutSeconds": 15,
    }


def wait_run(run_id):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        run = request("/pipelines/runs/" + run_id, admin)
        if run["status"] != "RUNNING":
            return run
        time.sleep(0.3)
    raise AssertionError("Runtime failure test exceeded deadline")


def identity(role, master):
    realm = json.loads((ROOT / ".local/oidc/import/nla-realm.json").read_text())
    client = copy.deepcopy(realm["clients"][0])
    name = "nla-workbench-security-" + role.lower() + "-" + secrets.token_hex(5)
    secret = secrets.token_urlsafe(48)
    client.update(
        {
            "clientId": name,
            "name": "Temporary workbench security test",
            "publicClient": False,
            "standardFlowEnabled": False,
            "directAccessGrantsEnabled": False,
            "serviceAccountsEnabled": True,
            "fullScopeAllowed": True,
            "redirectUris": [],
            "webOrigins": [],
            "attributes": {"nla.managed-by": "workbench-security.py"},
            "secret": secret,
        }
    )
    collection = compose.IDP + "/admin/realms/nla/clients"
    compose.request(collection, token=master, body=client)
    created = compose.request(collection + "?clientId=" + name, token=master)[0]
    resource = collection + "/" + created["id"]
    owned["clients"].append(resource)
    user = compose.request(resource + "/service-account-user", token=master)
    mapping = compose.request(compose.IDP + "/admin/realms/nla/roles/" + role, token=master)
    compose.request(
        compose.IDP + "/admin/realms/nla/users/" + user["id"] + "/role-mappings/realm",
        token=master,
        body=[mapping],
    )
    token = compose.request(
        compose.ISSUER + "/protocol/openid-connect/token",
        form={"grant_type": "client_credentials", "client_id": name, "client_secret": secret},
    )["access_token"]
    actual = request("/session", token)
    assert role in actual["roles"] and actual["subject"] == user["id"]
    return token, actual["subject"]


def compare_mart(entry, context, saved, outcome):
    engine = entry["engine"]
    invoice = next(t for t in context["tables"] if t["name"].lower() == "invoice")
    country = quote(engine, column(invoice, "billingcountry"))
    amount = quote(engine, column(invoice, "total"))
    source = table(engine, invoice["schema"], invoice["name"])
    mart = table(engine, saved["targetSchema"], saved["targetTable"] + "_mart")
    # Numeric comparison is Decimal-based and independent of the app/compiler's result snapshot.
    source_query = f"SELECT CONCAT({country},'|',CAST(SUM({amount}) AS DECIMAL(38,10)),'|',COUNT(*)) FROM {source} WHERE {amount}>5 GROUP BY {country}"
    mart_query = f"SELECT CONCAT({quote(engine, 'region')},'|',CAST({quote(engine, 'revenue')} AS DECIMAL(38,10)),'|',{quote(engine, 'orders')}) FROM {mart}"

    def rows(sql):
        result = {}
        for line in execute(engine, sql, reader=True).splitlines():
            line = line.strip()
            if not line:
                continue
            name, revenue, orders = line.split("|")
            result[name] = (Decimal(revenue), int(orders))
        return result

    expected = rows(source_query)
    actual = rows(mart_query)
    assert actual == expected and len(actual) == 24, (
        engine + " mart result differs from native source aggregation"
    )
    return {
        "status": "PASS",
        "groupsCompared": len(actual),
        "ordersCompared": sum(v[1] for v in actual.values()),
        "decimalRevenueEquivalent": True,
        "pipelineRunId": outcome["pipelineRunId"],
    }


def cleanup(master):
    failures = []
    for dataset_id in owned["datasets"]:
        try:
            request("/datasets/" + dataset_id + "/knowledge", admin, method="DELETE")
        except Exception:
            failures.append("temporary knowledge cleanup")
    for warehouse, subject in owned["grants"]:
        try:
            request(
                "/warehouses/" + warehouse + "/access?subject=" + urllib.parse.quote(subject),
                admin,
                method="DELETE",
                expected=204,
            )
        except Exception:
            failures.append("resource grant cleanup")
    for resource in owned["clients"]:
        try:
            compose.request(resource, token=master, method="DELETE")
        except BaseException:
            failures.append("temporary IdP client cleanup")
    for engine, schema, name in reversed(owned["tables"]):
        try:
            execute(engine, "DROP TABLE IF EXISTS " + table(engine, schema, name))
        except Exception:
            failures.append(engine + " test table cleanup")

    def sql_values(values):
        if any(not v.replace("-", "").isalnum() for v in values):
            raise AssertionError("Unsafe metadata cleanup ID")
        return ",".join("'" + v + "'" for v in values)

    try:
        statements = []
        if owned["pipelines"]:
            ids = sql_values(owned["pipelines"])
            statements.extend(
                [
                    f"DELETE FROM transformation_target_claim WHERE run_id IN (SELECT run_id FROM transformation_request WHERE pipeline_id IN ({ids}));",
                    f"DELETE FROM transformation_request WHERE pipeline_id IN ({ids});",
                ]
            )
        if owned["runs"]:
            statements.append(
                "DELETE FROM operation_run WHERE id IN (" + sql_values(owned["runs"]) + ");"
            )
        if owned["pipelines"]:
            statements.append(
                "DELETE FROM transformation_pipeline WHERE id IN ("
                + sql_values(owned["pipelines"])
                + ");"
            )
        if owned["queries"]:
            statements.append(
                "DELETE FROM query_history WHERE id IN (" + sql_values(owned["queries"]) + ");"
            )
        if owned["datasets"]:
            statements.append(
                "DELETE FROM dataset WHERE id IN (" + sql_values(owned["datasets"]) + ");"
            )
        if statements:
            db.execute(
                "POSTGRESQL",
                "BEGIN;" + "\n".join(statements) + "COMMIT;",
                db="nla_metadata_compose",
            )
    except Exception:
        failures.append("test metadata cleanup")
    return failures


def main():
    global admin
    if profile_environment(ROOT).get("LLM_BASE_URL") != "http://127.0.0.1:11434/v1":
        raise SystemExit("Only the local Ollama profile is allowed")
    online = ROOT / ".local/compose-app/provider.env"
    online_digest = hashlib.sha256(online.read_bytes()).hexdigest()
    accounts = json.loads((ROOT / ".local/oidc/accounts.json").read_text())
    master = compose.request(
        compose.IDP + "/realms/master/protocol/openid-connect/token",
        form={"client_id": "admin-cli", "grant_type": "password", **accounts["admin"]},
    )["access_token"]
    admin = compose.service_token()
    registry = json.loads((ROOT / ".local/compose-app/registry.json").read_text())
    previous = json.loads((ROOT / ".local/compose-app/workbench-pipeline-report.json").read_text())
    try:
        first = registry[0]
        prefix = "/datasets/" + first["datasetId"]
        baseline_pipeline = previous["createdPipelines"][0]
        pipeline = "/pipelines/" + baseline_pipeline["pipelineId"]
        baseline_run = previous["engines"][first["engine"]]["pipelineRunId"]
        context = request(prefix + "/semantic-model", admin)
        if request(prefix + "/knowledge", admin)["status"] != "READY":
            assert request(prefix + "/knowledge/index", admin, {})["status"] == "READY"
        selection = {
            "metrics": [context["metrics"][0]["name"]],
            "dimensions": [],
            "filters": [],
            "limit": 10,
        }
        for path, body, method in [
            (prefix + "/knowledge", None, "GET"),
            (prefix + "/semantic-model", None, "GET"),
            ("/pipelines", None, "GET"),
            ("/pipelines/runs/" + baseline_run, None, "GET"),
            (prefix + "/semantic-query", selection, "POST"),
            (prefix + "/knowledge/search", {"question": "sales", "limit": 1}, "POST"),
            ("/pipelines/preview", {}, "POST"),
        ]:
            request(path, body=body, method=method, expected=401)
        report["checks"]["anonymousBoundaries"] = "PASS"
        roles = {}
        for role in ("VIEWER", "ANALYST", "OPERATOR"):
            token, subject = identity(role, master)
            request(prefix + "/knowledge", token, expected=403)
            request(pipeline, token, expected=403)
            request("/pipelines/runs/" + baseline_run, token, expected=403)
            request(
                prefix + "/knowledge/search", token, {"question": "sales", "limit": 1}, expected=403
            )
            assert request("/pipelines", token)["items"] == []
            request(
                "/warehouses/" + first["warehouseId"] + "/access",
                admin,
                {"subject": subject},
                expected=201,
            )
            owned["grants"].append((first["warehouseId"], subject))
            assert request(prefix + "/knowledge", token)["datasetId"] == first["datasetId"]
            retrieved = request(
                prefix + "/knowledge/search", token, {"question": "total sales", "limit": 1}
            )
            assert retrieved["strategy"] == "vector" and len(retrieved["hits"]) == 1
            request(prefix + "/knowledge/examples", token)
            request(pipeline, token)
            request("/pipelines/runs/" + baseline_run, token)
            for path, body, method in [
                (prefix + "/semantic-model/validate", context, "POST"),
                (prefix + "/semantic-model", context, "PUT"),
                (prefix + "/knowledge/index", {}, "POST"),
                (prefix + "/knowledge", None, "DELETE"),
                (prefix + "/knowledge/examples", {"queryId": "unreachable"}, "POST"),
                (prefix + "/knowledge/examples/" + "a" * 64, None, "DELETE"),
                ("/pipelines", {}, "POST"),
                ("/pipelines/preview", {}, "POST"),
                (pipeline, {"status": "DISABLED"}, "PATCH"),
            ]:
                request(path, token, body, method=method, expected=403)
            if role == "ANALYST":
                query = request(prefix + "/semantic-query", token, selection)
                owned["queries"].append(query["queryId"])
                assert query["status"] == "SUCCESS"
            else:
                request(prefix + "/semantic-query", token, selection, expected=403)
            request(
                pipeline + "/run",
                token,
                {"idempotencyKey": "scoped-role-check"},
                expected=409 if role == "OPERATOR" else 403,
            )
            other = next(e for e in registry if e["warehouseId"] != first["warehouseId"])
            request("/datasets/" + other["datasetId"] + "/knowledge", token, expected=403)
            roles[role] = {
                "deniedWithoutGrant": True,
                "authorizedReadsWithGrant": True,
                "writeRoleBoundaries": True,
                "otherWarehouseDenied": True,
            }
        report["checks"]["scopedOidcRoles"] = roles
        unknown = copy.deepcopy(context)
        unknown["metrics"][0]["expression"] = "SUM(private_payroll.balance)"
        request(prefix + "/semantic-model/validate", admin, unknown, expected=422)
        request(
            prefix + "/knowledge/search", admin, {"question": "sales", "limit": 21}, expected=400
        )
        request(
            prefix + "/knowledge/examples",
            admin,
            {"queryId": previous["engines"]["MYSQL"]["semanticQueryId"]},
            expected=400,
        )
        report["checks"]["semanticUnknownReferencesAndKnowledgeBounds"] = "PASS"
        for entry in registry:
            engine = entry["engine"]
            context = request("/datasets/" + entry["datasetId"] + "/semantic-model", admin)
            saved_report = next(
                item for item in previous["createdPipelines"] if item["engine"] == engine
            )
            clone = request(
                "/datasets",
                admin,
                {
                    "warehouseId": entry["warehouseId"],
                    "name": "Owned semantic activation fixture " + secrets.token_hex(5),
                    "description": "Isolated activation verification",
                    "allowedSchemas": list(dict.fromkeys(t["schema"] for t in context["tables"])),
                    "allowedTables": [
                        {"schema": t["schema"], "name": t["name"]} for t in context["tables"]
                    ],
                    "semanticVersion": context["semanticVersion"],
                    "schemaVersion": context["schemaVersion"],
                },
                expected=201,
            )
            owned["datasets"].append(clone["datasetId"])
            clone_prefix = "/datasets/" + clone["datasetId"]
            activation = copy.deepcopy(context)
            activation["semanticVersion"] = "1.0.101"
            activated = request(clone_prefix + "/semantic-model", admin, activation, method="PUT")
            assert activated["semanticVersion"] == "1.0.101"
            active = request(clone_prefix + "/semantic-model", admin)
            assert (
                active["metrics"] == activation["metrics"]
                and active["dimensions"] == activation["dimensions"]
            )
            assert active["semanticVersion"] == "1.0.101"
            changed = copy.deepcopy(active)
            changed["metrics"][0]["description"] = (
                changed["metrics"][0].get("description", "") + " Activation edit"
            )
            request(clone_prefix + "/semantic-model", admin, changed, method="PUT", expected=409)
            assert request(clone_prefix + "/semantic-model", admin)["metrics"] == active["metrics"]
            structured = request(
                clone_prefix + "/semantic-query",
                admin,
                {
                    "metrics": [active["metrics"][0]["name"]],
                    "dimensions": [],
                    "filters": [],
                    "limit": 10,
                },
            )
            owned["queries"].append(structured["queryId"])
            assert structured["status"] == "SUCCESS" and structured["semanticVersion"] == "1.0.101"
            stale_check = "NOT RUN"
            if engine == "POSTGRESQL":
                assert request(clone_prefix + "/knowledge/index", admin, {})["status"] == "READY"
                changed["semanticVersion"] = "1.0.102"
                request(clone_prefix + "/semantic-model", admin, changed, method="PUT")
                assert request(clone_prefix + "/knowledge", admin)["status"] == "STALE"
                request(
                    clone_prefix + "/knowledge/search",
                    admin,
                    {"question": "sales", "limit": 1},
                    expected=503,
                )
                assert request(clone_prefix + "/knowledge/index", admin, {})["status"] == "READY"
                assert (
                    request(clone_prefix + "/knowledge", admin, method="DELETE")["status"]
                    == "EMPTY"
                )
                stale_check = "PASS"
            request(clone_prefix, admin, {"status": "DISABLED"}, method="PATCH")
            report["engines"][engine] = {
                "independentMart": compare_mart(
                    entry, context, saved_report, previous["engines"][engine]
                )
            }
            physical = next(t for t in context["tables"] if t["name"].lower() == "invoice")
            name = "nla_security_" + secrets.token_hex(5)
            valid = definition(entry, physical, name)
            truncated = {**valid, "maxRows": 1}
            request("/pipelines/preview", admin, truncated, expected=400)
            assert not any(
                existing(engine, valid["targetSchema"], name + "_" + layer)
                for layer in ("raw", "staging", "warehouse", "mart")
            )
            for expression in (
                "unknown_pipeline_column",
                "1; DROP TABLE __nla_input",
                "(SELECT COUNT(*) FROM private_payroll)",
            ):
                invalid = copy.deepcopy(valid)
                invalid["stages"]["staging"]["columns"][0]["expression"] = expression
                request("/pipelines/preview", admin, invalid, expected=422)
            assert not any(
                existing(engine, valid["targetSchema"], name + "_" + layer)
                for layer in ("raw", "staging", "warehouse", "mart")
            )
            saved = request("/pipelines", admin, valid)
            owned["pipelines"].append(saved["pipelineId"])
            # Freeze an intentional post-validation data failure using only a fixture table.
            fixture = "nla_security_source_" + secrets.token_hex(5)
            namespace = valid["targetSchema"]
            text_type = "NVARCHAR(50)" if engine == "SQL_SERVER" else "VARCHAR(50)"
            execute(
                engine,
                f"CREATE TABLE {table(engine, namespace, fixture)} ({quote(engine, 'amount_text')} {text_type}); INSERT INTO {table(engine, namespace, fixture)} VALUES ('1')",
            )
            owned["tables"].append((engine, namespace, fixture))
            if engine == "POSTGRESQL":
                execute(
                    engine,
                    "GRANT SELECT ON " + table(engine, namespace, fixture) + " TO nla_reader",
                )
            request("/warehouses/" + entry["warehouseId"] + "/discover", admin, {}, expected=202)
            dataset = request(
                "/datasets",
                admin,
                {
                    "warehouseId": entry["warehouseId"],
                    "name": "Temporary runtime failure fixture " + fixture,
                    "description": "Isolated integration fixture",
                    "allowedSchemas": [namespace],
                    "allowedTables": [{"schema": namespace, "name": fixture}],
                    "semanticVersion": "1.0.0",
                    "schemaVersion": "1.0.0",
                },
                expected=201,
            )
            owned["datasets"].append(dataset["datasetId"])
            broken = copy.deepcopy(valid)
            broken.update(
                {
                    "name": "Controlled runtime conversion failure",
                    "sourceDatasetId": dataset["datasetId"],
                    "sourceTable": {"schema": namespace, "name": fixture},
                    "targetTable": "nla_security_fail_" + secrets.token_hex(5),
                }
            )
            broken["stages"]["staging"] = transform(
                [("amount", "CAST(" + quote(engine, "amount_text") + " AS DECIMAL(38,11))")]
            )
            definition_saved = request("/pipelines", admin, broken)
            owned["pipelines"].append(definition_saved["pipelineId"])
            execute(
                engine,
                f"UPDATE {table(engine, namespace, fixture)} SET {quote(engine, 'amount_text')}='1.12345678901'",
            )
            run = request(
                "/pipelines/" + definition_saved["pipelineId"] + "/run",
                admin,
                {"idempotencyKey": "intentional-conversion-error"},
                expected=202,
            )
            owned["runs"].append(run["runId"])
            finished = wait_run(run["runId"])
            assert finished["status"] == "FAILED" and finished["datasetId"] is None
            raw_name = broken["targetTable"] + "_raw"
            assert finished["partialFailure"] is (engine == "MYSQL")
            assert existing(engine, namespace, raw_name) == (1 if engine == "MYSQL" else 0)
            if engine == "MYSQL":
                assert finished["createdTables"] == [{"schema": namespace, "name": raw_name}]
                assert finished["stages"][0]["rowsWritten"] == 1
                owned["tables"].append((engine, namespace, raw_name))
            else:
                assert finished["createdTables"] == []
                assert all(stage["rowsWritten"] == 0 for stage in finished["stages"])
            replay = request(
                "/pipelines/" + definition_saved["pipelineId"] + "/run",
                admin,
                {"idempotencyKey": "intentional-conversion-error"},
                expected=202,
            )
            assert replay["runId"] == run["runId"]
            request(
                "/pipelines/" + definition_saved["pipelineId"],
                admin,
                {"status": "DISABLED"},
                method="PATCH",
            )
            request(
                "/pipelines/" + definition_saved["pipelineId"] + "/run",
                admin,
                {"idempotencyKey": "intentional-conversion-error"},
                expected=409,
            )
            report["engines"][engine].update(
                {
                    "semanticActivation": "PASS",
                    "semanticVersionConflict": "PASS",
                    "structuredQueryFromActivatedSnapshot": "PASS",
                    "knowledgeStaleAndReset": stale_check,
                    "invalidTransformRejectedBeforeDdl": "PASS",
                    "truncatedSourceRejectedWithoutDdl": "PASS",
                    "failedRunReplayStable": "PASS",
                    "changedDefinitionIdempotencyConflict": "PASS",
                    "runtimeFailure": {
                        "status": "PASS",
                        "transactionalRollback": engine != "MYSQL",
                        "explicitPartialObjects": engine == "MYSQL",
                    },
                }
            )
        report["status"] = "PASS"
    except BaseException as error:
        report["status"] = "FAIL"
        report["failure"] = str(error)
        raise
    finally:
        failures = cleanup(master)
        report["cleanup"] = "PASS" if not failures else failures
        assert hashlib.sha256(online.read_bytes()).hexdigest() == online_digest
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        REPORT.chmod(0o600)
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
