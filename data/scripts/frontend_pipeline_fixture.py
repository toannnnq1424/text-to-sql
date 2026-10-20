#!/usr/bin/env python3
"""Disposable Docker-only tables for the real frontend ingestion browser test.

This is test administration, not application ingestion. The application uses its
registered source API; targets must already exist with least-privilege grants.
"""

import argparse
import json
import re
from copy import deepcopy
from pathlib import Path
from urllib.parse import quote

from docker_chinook import LOCAL, RUNTIME, execute
from provision_pipeline import qualified, table_statement, target_grants
from verify_sql_import import Client

LAYERS = {"raw": "fe_raw_", "stage": "fe_stage_", "warehouse": "fe_wh_", "mart": "fe_mart_"}


def api(client, path, body=None):
    status, value = client.request(path, body)
    if status >= 400:
        raise RuntimeError("Fixture setup API request failed; no credentials or payload logged.")
    return value


def write_manifest(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")
    path.chmod(0o600)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "verify", "cleanup"))
    parser.add_argument("--base-url", default="http://127.0.0.1:8088/api/v1")
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--suffix", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_]{1,40}", args.suffix):
        parser.error("Suffix must be a short test identifier.")
    values = dict(
        line.split("=", 1)
        for line in RUNTIME.read_text().splitlines()
        if line and not line.startswith("#")
    )
    client = Client(args.base_url, values["LOCAL_API_TOKEN"])
    source_path = "/warehouse/ingestion/sources/" + quote(args.source_id, safe="")
    source = api(client, source_path)
    warehouse = api(client, "/warehouses/" + quote(source["warehouseId"], safe=""))
    engine = warehouse["engine"]
    expected_schema = {"POSTGRESQL": "public", "MYSQL": "nla_chinook", "SQL_SERVER": "dbo"}
    if engine not in expected_schema or warehouse["database"] != "nla_chinook":
        parser.error("Fixture administration requires the isolated local Docker sample database.")
    path = LOCAL / f"frontend-pipeline-{engine}-{args.suffix}.json"

    if args.action == "prepare":
        if path.exists():
            parser.error("Fixture manifest exists; verify or clean it instead of overwriting.")
        config = deepcopy(source)
        for layer, prefix in LAYERS.items():
            if source[layer]["schema"] != expected_schema[engine]:
                parser.error("Source target schema is outside the isolated test namespace.")
            config[layer] = {"schema": expected_schema[engine], "name": prefix + args.suffix}
        for name in config["columns"]:
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", name):
                parser.error("Fixture column identifier is invalid.")
        probe = api(client, source_path + "/test", {})
        if probe["truncated"]:
            parser.error("Use a bounded, non-truncated source for this browser fixture.")
        manifest = {"engine": engine, "created": [], "expectedRows": probe["rowCount"]}
        write_manifest(path, manifest)
        for layer in LAYERS:
            execute(engine, table_statement(engine, config[layer], config), "nla_chinook")
            manifest["created"].append(config[layer])
            write_manifest(path, manifest)
        for statement in target_grants(engine, config):
            execute(engine, statement, "nla_chinook")
        print(f"{engine}: four disposable typed targets ready; source rows {probe['rowCount']}.")
        return

    manifest = json.loads(path.read_text())
    if manifest["engine"] != engine:
        parser.error("Fixture engine differs from the stored setup manifest.")
    for target in manifest["created"]:
        if target["schema"] != expected_schema[engine] or target["name"] not in {
            prefix + args.suffix for prefix in LAYERS.values()
        }:
            parser.error("Refusing to access a table outside this fixture's exact manifest.")
    if args.action == "verify":
        counts = []
        for target in manifest["created"]:
            output = execute(
                engine, f"SELECT COUNT(*) FROM {qualified(engine, target)};", "nla_chinook"
            )
            numeric = [line.strip() for line in output.splitlines() if line.strip().isdigit()]
            if len(numeric) != 1:
                raise AssertionError("Fixture count response is not a single numeric row.")
            counts.append(int(numeric[0]))
        if len(counts) != 4 or any(value != manifest["expectedRows"] for value in counts):
            raise AssertionError("Persisted layer row counts do not match the real source.")
        print(f"{engine}: actual four-layer row counts {counts}, PASS.")
    else:
        for target in reversed(manifest["created"]):
            execute(engine, f"DROP TABLE IF EXISTS {qualified(engine, target)};", "nla_chinook")
        path.unlink()
        print(f"{engine}: exact disposable targets removed.")


if __name__ == "__main__":
    main()
