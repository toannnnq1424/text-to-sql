#!/usr/bin/env python3
"""Disposable DB3 targets for the source-registration UI acceptance test only."""

import argparse
import json
import uuid
from pathlib import Path

from docker_chinook import LOCAL, execute, literal
from provision_pipeline import qualified, table_statement, target_grants

MANIFEST = LOCAL / "source-registration-fixture.json"
SCHEMAS = {"POSTGRESQL": "public", "MYSQL": "nla_chinook", "SQL_SERVER": "dbo"}
LAYERS = ("raw", "stage", "warehouse", "mart")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "verify", "cleanup"))
    args = parser.parse_args()
    if args.action == "prepare":
        if MANIFEST.exists():
            raise SystemExit("An existing acceptance manifest must be cleaned first.")
        suffix = uuid.uuid4().hex[:12]
        manifest = {"prefix": "srcui_" + suffix, "engines": {}}
        MANIFEST.write_text(json.dumps(manifest))
        MANIFEST.chmod(0o600)
        for engine, schema in SCHEMAS.items():
            column = "title" if engine == "POSTGRESQL" else "Title"
            config = {
                "columns": [column],
                "columnTypes": {column: "STRING"},
                "requiredColumns": [],
                "maxStringLengths": {},
            }
            config.update(
                {
                    layer: {"schema": schema, "name": f"{manifest['prefix']}_{layer}"}
                    for layer in LAYERS
                }
            )
            manifest["engines"][engine] = {"column": column, "tables": [], "expectedRows": 347}
            for layer in LAYERS:
                execute(engine, table_statement(engine, config[layer], config), "nla_chinook")
                manifest["engines"][engine]["tables"].append(config[layer])
                MANIFEST.write_text(json.dumps(manifest))
            for sql in target_grants(engine, config):
                execute(engine, sql, "nla_chinook")
        print("PASS: twelve isolated targets created for source registration acceptance.")
        return
    manifest = json.loads(MANIFEST.read_text())
    prefix = manifest["prefix"]
    if not prefix.startswith("srcui_") or len(prefix) != 18 or not prefix[6:].isalnum():
        raise SystemExit("Invalid fixture identity; refusing database access.")
    for engine, entry in manifest["engines"].items():
        for target in entry["tables"]:
            if target["schema"] != SCHEMAS[engine] or target["name"] not in {
                f"{prefix}_{layer}" for layer in LAYERS
            }:
                raise SystemExit("Target differs from exact disposable manifest.")
            if args.action == "cleanup":
                execute(engine, f"DROP TABLE IF EXISTS {qualified(engine, target)};", "nla_chinook")
            else:
                prefix_sql = "SET NOCOUNT ON; " if engine == "SQL_SERVER" else ""
                response = execute(
                    engine,
                    prefix_sql + f"SELECT COUNT(*) FROM {qualified(engine, target)};",
                    "nla_chinook",
                )
                values = [
                    int(line.strip()) for line in response.splitlines() if line.strip().isdigit()
                ]
                if values != [entry["expectedRows"]]:
                    raise AssertionError(f"{engine}: actual layer count differs from source.")
    if args.action == "cleanup":
        names = ",".join(
            literal(f"Source UI acceptance {prefix} {engine}") for engine in manifest["engines"]
        )
        # These metadata records belong only to this exact disposable manifest.
        execute(
            "POSTGRESQL",
            f"BEGIN; "
            f"DELETE FROM ingestion_request WHERE run_id IN (SELECT id FROM operation_run WHERE kind='INGESTION' AND document->>'sourceId' IN (SELECT source_id FROM ingestion_source WHERE document->>'name' IN ({names}))); "
            f"DELETE FROM operation_run WHERE kind='INGESTION' AND document->>'sourceId' IN (SELECT source_id FROM ingestion_source WHERE document->>'name' IN ({names})); "
            f"DELETE FROM ingestion_source WHERE document->>'name' IN ({names}); COMMIT;",
            "nla_metadata_compose",
        )
        MANIFEST.unlink()
    print(f"PASS: source registration fixture {args.action} on all three engines.")


if __name__ == "__main__":
    main()
