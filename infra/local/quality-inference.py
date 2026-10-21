#!/usr/bin/env python3
"""Local Ollama inference regression after shared admission changes; never online."""

import importlib.util
import json
from pathlib import Path

import compose
from llm_profile import profile_environment

ROOT = Path(__file__).resolve().parents[2]


def main():
    if profile_environment(ROOT).get("LLM_BASE_URL") != "http://127.0.0.1:11434/v1":
        raise SystemExit("Only local Ollama is allowed in this acceptance runner.")
    spec = importlib.util.spec_from_file_location(
        "model_provider_smoke", Path(__file__).with_name("model-providers-smoke.py")
    )
    smoke = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(smoke)
    token = compose.service_token()
    profiles = smoke.request("/settings/model-providers", token)
    chosen = next(x for x in profiles["items"] if x["providerId"] == profiles["defaultProviderId"])
    if chosen["kind"] != "OLLAMA":
        raise SystemExit("The active default must be local Ollama before this check.")
    report = {"mocked": False, "onlineProviderTested": False, "engines": {}}
    for item in json.loads((ROOT / ".local/compose-app/registry.json").read_text()):
        context = smoke.request("/datasets/" + item["datasetId"] + "/semantic-model", token)
        example = next(x for x in context["examples"] if x["sqlDialect"] == item["engine"])
        query = smoke.request(
            "/query",
            token,
            {
                "warehouseId": item["warehouseId"],
                "datasetId": item["datasetId"],
                "question": example["question"],
                "mode": "API",
                "providerId": chosen["providerId"],
            },
            expected=201,
        )
        assert query["status"] == "SUCCESS" and query["executionMode"] == "API"
        assert query["model"] == chosen["model"] and query["provider"]["kind"] == "OLLAMA"
        assert query["result"]["returnedRowCount"] > 0
        report["engines"][item["engine"]] = {
            "status": "PASS",
            "queryId": query["queryId"],
            "model": query["model"],
        }
    report["status"] = "PASS"
    path = ROOT / ".local/compose-app/quality-inference-report.json"
    path.write_text(json.dumps(report, indent=2))
    path.chmod(0o600)
    print(json.dumps(report))


if __name__ == "__main__":
    main()
