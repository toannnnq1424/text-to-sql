#!/usr/bin/env python3
"""Real OIDC→Java→configured local model semantic draft acceptance, without activation.

Requires analytics-runtime.py prepare and the application stack. Uses owned weather
fixtures; never writes semantic definitions or tests an online model. Private reports
contain definition names/counts and statuses, without credentials, tokens or data rows.
"""

import hashlib
import importlib.util
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

import compose
from llm_profile import profile_environment

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / ".local/compose-app/analytics-assist-report.json"


def request(path, token=None, body=None, expected=200):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    try:
        with urllib.request.urlopen(
            urllib.request.Request(compose.API + path, headers=headers, data=data), timeout=150
        ) as response:
            value = json.load(response)
            code = response.status
    except urllib.error.HTTPError as error:
        code = error.code
        value = json.load(error)
    if code != expected:
        error = ((value or {}).get("error") or {}).get("code", "UNKNOWN")
        raise AssertionError(f"{path}: HTTP{code} {error}; expected{expected}")
    return value


def snapshot(context):
    return {key: value for key, value in context.items() if key != "referenceTime"}


def write_report(report):
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    REPORT.chmod(0o600)


def run():
    profile = profile_environment(ROOT)
    if profile.get("LLM_BASE_URL") != "http://127.0.0.1:11434/v1":
        raise SystemExit("This acceptance runner only permits the local Ollama profile.")
    fixtures = json.loads((ROOT / ".local/compose-app/analytics-fixtures.json").read_text())
    if {item["engine"] for item in fixtures} != {"POSTGRESQL", "MYSQL", "SQL_SERVER"}:
        raise SystemExit("Prepare all three owned analytics fixtures first.")
    online = ROOT / ".local/compose-app/provider.env"
    digest = hashlib.sha256(online.read_bytes()).hexdigest()
    accounts = json.loads((ROOT / ".local/oidc/accounts.json").read_text())
    master = compose.request(
        compose.IDP + "/realms/master/protocol/openid-connect/token",
        form={"client_id": "admin-cli", "grant_type": "password", **accounts["admin"]},
    )["access_token"]
    admin = compose.service_token()
    spec = importlib.util.spec_from_file_location(
        "workbench_security_helpers", ROOT / "infra/local/workbench-security.py"
    )
    security = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(security)
    security.admin = admin
    report = {
        "mocked": False,
        "onlineProviderTested": False,
        "operation": "reviewed semantic draft only",
        "roleIdentityType": "fresh real Keycloak service accounts",
        "roles": {},
        "engines": {},
    }
    try:
        target = "/datasets/" + fixtures[0]["datasetId"] + "/semantic-assist"
        request(target, body={"instruction": "Describe observation metrics"}, expected=401)
        report["anonymous"] = "PASS"
        for role in ("VIEWER", "ANALYST", "OPERATOR"):
            token, _ = security.identity(role, master)
            request(target, token, {"instruction": "Describe observation metrics"}, expected=403)
            report["roles"][role] = "FORBIDDEN as required"
        request(target, admin, {"instruction": " "}, expected=400)
        request(target, admin, {"instruction": "a" * 2001}, expected=400)
        for item in fixtures:
            admin = compose.service_token()
            security.admin = admin
            prefix = "/datasets/" + item["datasetId"]
            before = request(prefix + "/semantic-model", admin)
            assert len(before["tables"]) == 1
            started = time.monotonic()
            result = request(
                prefix + "/semantic-assist",
                admin,
                {
                    "instruction": "Đề xuất duy nhất một metric mới tính AVG(rainfall), đặt tên rõ nghĩa cho lượng mưa trung bình; tương thích dimension station từ cột station. Viết mô tả tiếng Việt rõ đây là trung bình trường rainfall theo mức hạt dòng quan sát; đơn vị để trống. Giữ nguyên mọi định nghĩa hiện có. Nếu dimension station đã có thì không đề xuất lại. Không thêm quy tắc hoặc joins.",
                },
            )
            assert result["model"] == profile["LLM_MODEL"]
            assert result["warnings"] and set(result) == {"model", "semanticModel", "warnings"}
            draft = result["semanticModel"]
            draft_path = ROOT / (
                ".local/compose-app/analytics-assist-draft-" + item["engine"] + ".json"
            )
            draft_path.write_text(json.dumps(result, ensure_ascii=False, indent=2))
            draft_path.chmod(0o600)
            existing_names = {metric["name"] for metric in before["metrics"]}
            metric = next(
                metric
                for metric in draft["metrics"]
                if metric["name"] not in existing_names
                and "AVG" in metric["expression"].upper()
                and "rainfall" in metric["expression"]
            )
            assert metric["description"].strip()
            assert "AVG" in metric["expression"].upper()
            assert "station" in metric["compatibleDimensions"]
            assert any(dimension["name"] == "station" for dimension in draft["dimensions"])
            assert all(existing in draft["metrics"] for existing in before["metrics"])
            assert all(
                existing in draft["dimensions"]
                for existing in before["dimensions"]
                if existing["name"] != "station"
            )
            validated = request(prefix + "/semantic-model/validate", admin, draft)
            assert validated["valid"] is True
            after = request(prefix + "/semantic-model", admin)
            assert snapshot(after) == snapshot(before), "Draft operation changed active semantics"
            report["engines"][item["engine"]] = {
                "status": "PASS",
                "model": result["model"],
                "source": "current API-discovered weather metadata",
                "datasetId": item["datasetId"],
                "proposedMetric": metric["name"],
                "descriptionPresent": True,
                "compatibleDimension": "station",
                "sourceCompilerAndJavaValidation": "PASS",
                "unrelatedDefinitionsPreserved": True,
                "activeSnapshotUnchanged": True,
                "elapsedSeconds": round(time.monotonic() - started, 2),
            }
            write_report(report)
        report["status"] = "PASS"
    except BaseException as failure:
        report["status"] = "FAIL"
        report["failure"] = str(failure)
        raise
    finally:
        try:
            cleanup_master = compose.request(
                compose.IDP + "/realms/master/protocol/openid-connect/token",
                form={"client_id": "admin-cli", "grant_type": "password", **accounts["admin"]},
            )["access_token"]
            security.admin = compose.service_token()
            failures = security.cleanup(cleanup_master)
        except BaseException:
            failures = ["Temporary IdP account cleanup failed; inspect local test identities."]
        report["cleanup"] = "PASS" if not failures else failures
        if failures:
            report["status"] = "FAIL"
        assert hashlib.sha256(online.read_bytes()).hexdigest() == digest
        write_report(report)
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    run()
