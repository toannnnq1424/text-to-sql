#!/usr/bin/env python3
"""Real OIDC→encrypted provider settings→Python/Ollama→three actual warehouses.

Only local Ollama is called. Online profiles use generated test-only keys and are
never selected for inference. Cleanup restores the original default and deletes
only profile IDs recorded by this run, retaining normal query/audit history.
"""

import argparse
import hashlib
import importlib.util
import json
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

import compose
from llm_profile import profile_environment

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / ".local/compose-app/model-providers-report.json"
MANIFEST = ROOT / ".local/compose-app/model-providers-owned.json"
BASE = "/settings/model-providers"
sys.path.insert(0, str(ROOT / "data/scripts"))
import docker_chinook as db


def request(path, token=None, body=None, method=None, expected=200):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if data is not None:
        headers["Content-Type"] = "application/json"
    try:
        with urllib.request.urlopen(
            urllib.request.Request(compose.API + path, data=data, headers=headers, method=method),
            timeout=120,
        ) as response:
            code, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        code, raw = error.code, error.read()
    value = json.loads(raw) if raw else None
    if code != expected:
        reason = ((value or {}).get("error") or {}).get("code", "UNKNOWN")
        raise AssertionError(f"{path}: HTTP{code} {reason}, expected{expected}")
    return value


def persist(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    path.chmod(0o600)


def assert_safe(value, known_keys):
    text = json.dumps(value)
    assert all(key not in text for key in known_keys)
    for forbidden in ('"apiKey"', '"encryptedApiKey"', '"encrypted_api_key"'):
        assert forbidden not in text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--restart-backend", action="store_true")
    args = parser.parse_args()
    if profile_environment(ROOT).get("LLM_BASE_URL") != "http://127.0.0.1:11434/v1":
        raise SystemExit("Only the local Ollama profile may be tested by this runner.")
    token = compose.service_token()
    before = request(BASE, token)
    online_file = ROOT / ".local/compose-app/provider.env"
    online_hash = hashlib.sha256(online_file.read_bytes()).hexdigest()
    owned = {"providerIds": [], "originalDefault": before["defaultProviderId"]}
    persist(MANIFEST, owned)
    generated_keys = ["model-qa-" + secrets.token_urlsafe(36) for _ in range(3)]
    report = {"mocked": False, "onlineProviderTested": False, "engines": {}}
    security = None
    try:
        assert before["configurationAvailable"]
        assert any(p["kind"] == "OLLAMA" and p["source"] == "ENVIRONMENT" for p in before["items"])
        request(BASE, expected=401)
        accounts = json.loads((ROOT / ".local/oidc/accounts.json").read_text())
        master = compose.request(
            compose.IDP + "/realms/master/protocol/openid-connect/token",
            form={"client_id": "admin-cli", "grant_type": "password", **accounts["admin"]},
        )["access_token"]
        spec = importlib.util.spec_from_file_location(
            "provider_security_helpers", ROOT / "infra/local/workbench-security.py"
        )
        security = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(security)
        security.admin = token
        local_input = {
            "name": "Local model settings QA",
            "kind": "OLLAMA",
            "baseUrl": "http://host.docker.internal:11434/v1",
            "model": "qwen3:4b",
            "enabled": True,
        }
        for role in ("VIEWER", "ANALYST", "OPERATOR"):
            role_token, _ = security.identity(role, master)
            assert_safe(request(BASE, role_token), generated_keys)
            request(BASE, role_token, local_input, expected=403)
            request(BASE + "/default", role_token, {"providerId": None}, method="PUT", expected=403)
        local = request(BASE, token, local_input, expected=201)
        owned["providerIds"].append(local["providerId"])
        persist(MANIFEST, owned)
        assert local["configured"] and not local["hasApiKey"]
        local = request(
            BASE + "/" + local["providerId"],
            token,
            {**local_input, "revision": local["revision"], "apiKey": generated_keys[2]},
            method="PUT",
        )
        assert local["hasApiKey"]
        cloud_input = {
            "name": "Online config QA only - no calls",
            "kind": "ONLINE",
            "baseUrl": "https://api.openai.com/v1",
            "model": "not-used-online-test-model",
            "enabled": True,
            "apiKey": generated_keys[0],
        }
        cloud = request(BASE, token, cloud_input, expected=201)
        owned["providerIds"].append(cloud["providerId"])
        persist(MANIFEST, owned)
        assert cloud["hasApiKey"] and cloud["configured"]
        assert_safe(cloud, generated_keys)
        pid = cloud["providerId"]
        assert pid.startswith("provider-") and all(c in "0123456789abcdef-" for c in pid[9:])
        ciphertext = db.execute(
            "POSTGRESQL",
            "SELECT encrypted_api_key FROM model_provider WHERE id='" + pid + "';",
            db="nla_metadata_compose",
        ).strip()
        assert ciphertext.startswith("v1:") and all(key not in ciphertext for key in generated_keys)
        update = {key: value for key, value in cloud_input.items() if key != "apiKey"}
        update["revision"] = cloud["revision"]
        updated = request(BASE + "/" + pid, token, update, method="PUT")
        assert updated["hasApiKey"] and updated["revision"] != cloud["revision"]
        request(BASE + "/" + pid, token, update, method="PUT", expected=409)
        update.update({"revision": updated["revision"], "apiKey": generated_keys[1]})
        request(
            BASE + "/" + pid,
            token,
            {**update, "name": generated_keys[0]},
            method="PUT",
            expected=400,
        )
        rotated = request(BASE + "/" + pid, token, update, method="PUT")
        assert rotated["hasApiKey"]
        update.pop("apiKey")
        update.update({"revision": rotated["revision"], "enabled": False, "clearApiKey": True})
        request(
            BASE + "/" + pid,
            token,
            {**update, "name": generated_keys[1]},
            method="PUT",
            expected=400,
        )
        cleared = request(BASE + "/" + pid, token, update, method="PUT")
        assert not cleared["hasApiKey"] and not cleared["configured"]
        report["keyLifecycle"] = {
            "encrypted": True,
            "preserved": True,
            "rotated": True,
            "cleared": True,
            "staleRevisionRejected": True,
            "oldKeyMetadataEchoRejected": True,
        }
        request(
            BASE, token, {**cloud_input, "baseUrl": "https://forbidden.invalid/v1"}, expected=400
        )
        request(
            BASE, token, {**cloud_input, "baseUrl": "https://secret@example.com/v1"}, expected=400
        )
        chosen = request(
            BASE + "/default", token, {"providerId": local["providerId"]}, method="PUT"
        )
        assert chosen["defaultProviderId"] == local["providerId"]
        request(BASE + "/" + local["providerId"], token, method="DELETE", expected=409)
        if args.restart_backend:
            compose.compose("restart", "backend")
            compose.compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "180", "backend")
            restored = request(BASE, token)
            recovered = next(p for p in restored["items"] if p["providerId"] == local["providerId"])
            assert recovered["hasApiKey"] and recovered["revision"] == local["revision"]
            assert restored["defaultProviderId"] == local["providerId"]
            report["restartPersistence"] = (
                "PASS; default, revision and encrypted key survived real container restart"
            )
        for entry in json.loads((ROOT / ".local/compose-app/registry.json").read_text()):
            token = compose.service_token()
            context = request("/datasets/" + entry["datasetId"] + "/semantic-model", token)
            question = next(
                ex["question"] for ex in context["examples"] if ex["sqlDialect"] == entry["engine"]
            )
            body = {
                "warehouseId": entry["warehouseId"],
                "datasetId": entry["datasetId"],
                "question": question,
            }
            api = request(
                "/query",
                token,
                {**body, "mode": "API", "providerId": local["providerId"]},
                expected=201,
            )
            assert api["status"] == "SUCCESS", (entry["engine"], api.get("error"))
            assert (
                api["model"] == "qwen3:4b" and api["provider"]["providerId"] == local["providerId"]
            )
            assert api["provider"]["kind"] == "OLLAMA" and api["executionMode"] == "API"
            assert_safe(api, generated_keys)
            automatic = request("/query", token, {**body, "mode": "AUTO"}, expected=201)
            assert (
                automatic["status"] == "SUCCESS"
                and automatic["provider"]["providerId"] == local["providerId"]
            )
            offline = request("/query", token, {**body, "mode": "DETERMINISTIC"}, expected=201)
            assert offline["status"] == "SUCCESS" and offline.get("provider") is None
            assert offline["model"] != "qwen3:4b" and offline["executionMode"] == "DETERMINISTIC"
            request(
                "/query",
                token,
                {**body, "mode": "DETERMINISTIC", "providerId": local["providerId"]},
                expected=400,
            )
            report["engines"][entry["engine"]] = {
                "status": "PASS",
                "apiQueryId": api["queryId"],
                "autoQueryId": automatic["queryId"],
                "offlineQueryId": offline["queryId"],
                "model": api["model"],
            }
        report["roles"] = "anonymous401, VIEWER/ANALYST/OPERATOR read200+write403"
        assert_safe(request(BASE, token), generated_keys)
        report["status"] = "PASS"
    except Exception as error:
        report["status"] = "FAIL"
        report["failure"] = str(error)
        raise
    finally:
        token = compose.service_token()
        cleanup_failures = []
        try:
            current = request(BASE, token)
            if current["defaultProviderId"] in owned["providerIds"]:
                request(
                    BASE + "/default", token, {"providerId": owned["originalDefault"]}, method="PUT"
                )
            for pid in reversed(owned["providerIds"]):
                request(BASE + "/" + pid, token, method="DELETE", expected=204)
        except Exception:
            cleanup_failures.append("Owned model profile cleanup requires inspection")
        if security:
            try:
                accounts = json.loads((ROOT / ".local/oidc/accounts.json").read_text())
                master = compose.request(
                    compose.IDP + "/realms/master/protocol/openid-connect/token",
                    form={"client_id": "admin-cli", "grant_type": "password", **accounts["admin"]},
                )["access_token"]
                cleanup_failures.extend(security.cleanup(master))
            except BaseException:
                cleanup_failures.append("Temporary role identities require inspection")
        report["cleanup"] = "PASS" if not cleanup_failures else cleanup_failures
        assert online_hash == hashlib.sha256(online_file.read_bytes()).hexdigest()
        persist(REPORT, report)
        print(json.dumps(report))


if __name__ == "__main__":
    main()
