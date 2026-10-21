#!/usr/bin/env python3
"""Real OIDC role/resource/validation boundaries for dataset quality, no model calls."""

import json
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import compose

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = spec_from_file_location(name.replace("-", "_"), Path(__file__).with_name(name + ".py"))
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runtime = load("quality-runtime")
security = load("workbench-security")
request = security.request


def main():
    admin = compose.service_token()
    security.admin = admin
    accounts = json.loads((ROOT / ".local/oidc/accounts.json").read_text())
    master = compose.request(
        compose.IDP + "/realms/master/protocol/openid-connect/token",
        form={"client_id": "admin-cli", "grant_type": "password", **accounts["admin"]},
    )["access_token"]
    fixtures = json.loads(runtime.MANIFEST.read_text())
    first = fixtures[0]
    base = "/datasets/" + first["datasetId"] + "/quality"
    report = {"mocked": False, "checks": {}, "status": "FAIL"}
    try:
        for suffix, method, body in (
            ("/rules", "GET", None),
            ("/rules", "PUT", {}),
            ("/runs", "GET", None),
            ("/runs", "POST", {}),
        ):
            request(base + suffix, method=method, body=body, expected=401)
        for role in ("VIEWER", "ANALYST", "OPERATOR"):
            token, subject = security.identity(role, master)
            request(base + "/rules", token, expected=403)
            request(base + "/runs", token, {}, expected=403)
            request(
                "/warehouses/" + first["warehouseId"] + "/access",
                admin,
                {"subject": subject},
                expected=201,
            )
            security.owned["grants"].append((first["warehouseId"], subject))
            config = request(base + "/rules", token)
            assert config["datasetId"] == first["datasetId"]
            assert request(base + "/runs?page=1&pageSize=1", token)["items"]
            if role in {"VIEWER", "ANALYST"}:
                request(
                    base + "/rules",
                    token,
                    {"revision": config["revision"], "rules": config["rules"]},
                    method="PUT",
                    expected=403,
                )
                request(base + "/runs", token, {}, expected=403)
            else:
                saved = request(
                    base + "/rules",
                    token,
                    {"revision": config["revision"], "rules": config["rules"]},
                    method="PUT",
                )
                run = request(base + "/runs", token, {}, expected=202)
                run = runtime.wait(token, base, run)
                assert run["status"] == "FAILED" and run["revision"] == saved["revision"]
            report["checks"][role] = "PASS; resource grant and role enforced"
        other = fixtures[1]
        wrong_path = "/datasets/" + other["datasetId"] + "/quality/runs/" + first["qualityRuns"][0]
        request(wrong_path, admin, expected=404)
        config = request(base + "/rules", admin)
        for change in (
            {"column": "not_an_existing_column"},
            {"table": {"schema": first["targetSchema"], "name": "not_an_allowed_table"}},
        ):
            bad = [dict(x) for x in config["rules"]]
            bad[0].update(change)
            request(
                base + "/rules",
                admin,
                {"revision": config["revision"], "rules": bad},
                method="PUT",
                expected=400,
            )
        request("/datasets/" + first["datasetId"], admin, {"status": "DISABLED"}, method="PATCH")
        try:
            request(base + "/runs", admin, {}, expected=409)
        finally:
            request("/datasets/" + first["datasetId"], admin, {"status": "ACTIVE"}, method="PATCH")
        report["checks"]["ownershipValidationDisabled"] = "PASS"
        report["status"] = "PASS"
    finally:
        failures = security.cleanup(master)
        assert not failures, failures
        report["cleanup"] = "PASS"
        runtime.persist(ROOT / ".local/compose-app/quality-security-report.json", report)
    print(json.dumps(report))


if __name__ == "__main__":
    main()
