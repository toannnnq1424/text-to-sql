#!/usr/bin/env python3
"""Verify and remove exactly the disposable targets recorded by the live browser test."""

import importlib.util
import json
import re
import urllib.request
from pathlib import Path

from docker_chinook import ROOT, execute
from verify_sql_import import quote, require


def main():
    manifest_path = ROOT / ".local/compose-app/file-browser-manifest.json"
    if not manifest_path.exists():
        return
    manifest = json.loads(manifest_path.read_text())
    spec = importlib.util.spec_from_file_location("compose_deploy", ROOT / "infra/local/compose.py")
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
    token = deploy.service_token()
    for item in manifest:
        engine = item["engine"]
        require(engine in {"POSTGRESQL", "MYSQL", "SQL_SERVER"}, "Unexpected test engine")
        name = item["targetTable"]
        require(
            re.fullmatch(r"nla_browser_[a-f0-9]{10}", name) is not None, "Unsafe test table name"
        )
        prefix = "SET NOCOUNT ON; " if engine == "SQL_SERVER" else ""
        database = "nla_import" if engine == "MYSQL" else "nla_chinook"
        for layer in ("raw", "staging", "warehouse", "mart"):
            target = quote(engine, "nla_import") + "." + quote(engine, name + "_" + layer)
            if item.get("datasetId"):
                count = execute(
                    engine,
                    prefix + "SELECT COUNT(*) FROM " + target + ";",
                    db=database,
                    reader=True,
                )
                require(count.strip() == "2", "Browser layer persistence mismatch")
            execute(engine, "DROP TABLE IF EXISTS " + target + ";", db=database)
        if item.get("datasetId"):
            dataset = item["datasetId"]
            require(
                re.fullmatch(r"ds-[a-f0-9-]{36}", dataset) is not None, "Unsafe test dataset ID"
            )
            request = urllib.request.Request(
                "http://127.0.0.1:8085/api/v1/datasets/" + dataset,
                data=b'{"status":"DISABLED"}',
                method="PATCH",
                headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                require(response.status == 200, "Cannot disable disposable Dataset")
        print("Verified and cleaned disposable file-browser targets:", engine)
    manifest_path.rename(manifest_path.with_suffix(".cleaned.json"))


if __name__ == "__main__":
    main()
