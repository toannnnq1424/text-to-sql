#!/usr/bin/env python3
"""Provision writer grants and typed staging/mart tables from registered definitions."""

import json
import secrets
from typing import Any

from docker_chinook import CONFIG, LOCAL, ROOT, RUNTIME, execute, init, literal
from pipeline_config import load_sample_pipeline_configs

SQL_TYPES = {
    "POSTGRESQL": {
        "INTEGER": "bigint",
        "DECIMAL": "decimal(38,10)",
        "BOOLEAN": "boolean",
        "DATE": "date",
        "TIMESTAMP": "timestamp",
    },
    "MYSQL": {
        "INTEGER": "bigint",
        "DECIMAL": "decimal(38,10)",
        "BOOLEAN": "boolean",
        "DATE": "date",
        "TIMESTAMP": "datetime(6)",
    },
    "SQL_SERVER": {
        "INTEGER": "bigint",
        "DECIMAL": "decimal(38,10)",
        "BOOLEAN": "bit",
        "DATE": "date",
        "TIMESTAMP": "datetime2(7)",
    },
}


def quote(engine: str, value: str) -> str:
    if engine == "POSTGRESQL":
        return f'"{value}"'
    if engine == "MYSQL":
        return f"`{value}`"
    return f"[{value}]"


def qualified(engine: str, target: dict[str, str]) -> str:
    return f"{quote(engine, target['schema'])}.{quote(engine, target['name'])}"


def column_type(engine: str, name: str, config: dict[str, Any]) -> str:
    logical_type = config["columnTypes"][name]
    if logical_type == "STRING":
        length = config["maxStringLengths"].get(name)
        if engine == "POSTGRESQL":
            return f"varchar({length})" if length else "text"
        if engine == "MYSQL":
            return f"varchar({length})" if length else "text"
        return f"nvarchar({length})" if length else "nvarchar(max)"
    return SQL_TYPES[engine][logical_type]


def table_statement(
    engine: str,
    target: dict[str, str],
    config: dict[str, Any],
) -> str:
    definitions = []
    required = set(config["requiredColumns"])
    for name in config["columns"]:
        nullability = " NOT NULL" if name in required else " NULL"
        definitions.append(
            f"{quote(engine, name)} {column_type(engine, name, config)}{nullability}"
        )
    return f"CREATE TABLE {qualified(engine, target)} ({', '.join(definitions)});"


def source_grants(engine: str, config: dict[str, Any]) -> list[str]:
    statements = []
    for source in config["sourceObjects"]:
        statements.append(
            f"GRANT SELECT ON {qualified(engine, source)} TO "
            + ("'nla_writer'@'%'" if engine == "MYSQL" else "nla_writer")
            + ";"
        )
    return statements


def target_grants(engine: str, config: dict[str, Any]) -> list[str]:
    names = [qualified(engine, config["stage"]), qualified(engine, config["mart"])]
    if engine == "MYSQL":
        return [f"GRANT SELECT,INSERT,DELETE ON {name} TO 'nla_writer'@'%';" for name in names]
    return [f"GRANT SELECT, INSERT, DELETE ON {name} TO nla_writer;" for name in names]


def provision():
    configs = load_sample_pipeline_configs(ROOT)
    values = init()
    engine_suffixes = {
        "POSTGRESQL": "PG",
        "MYSQL": "MYSQL",
        "SQL_SERVER": "MSSQL",
    }
    for engine, config in configs.items():
        marker = LOCAL / f"pipeline-{engine}.json"
        key = f"NLA_PIPELINE_{engine_suffixes[engine]}_PASSWORD"
        if key not in values:
            values[key] = "Nla_" + secrets.token_urlsafe(27) + "9!"
            CONFIG.write_text("".join(f"{name}={value}\n" for name, value in values.items()))
            CONFIG.chmod(0o600)
        if not marker.exists():
            database = "nla_chinook"
            execute(
                engine,
                table_statement(engine, config["stage"], config)
                + "\n"
                + table_statement(engine, config["mart"], config),
                database,
            )
            password = literal(values[key])
            if engine == "POSTGRESQL":
                execute(
                    engine,
                    f"CREATE ROLE nla_writer LOGIN PASSWORD {password} "
                    "NOSUPERUSER NOCREATEDB NOCREATEROLE;"
                    "\nGRANT CONNECT ON DATABASE nla_chinook TO nla_writer;",
                )
                grants = source_grants(engine, config) + target_grants(engine, config)
                grants.insert(0, "GRANT USAGE ON SCHEMA public TO nla_writer;")
                execute(engine, "\n".join(grants), database)
            elif engine == "MYSQL":
                execute(
                    engine,
                    f"CREATE USER 'nla_writer'@'%' IDENTIFIED BY {password};",
                )
                execute(
                    engine,
                    "\n".join(source_grants(engine, config) + target_grants(engine, config)),
                    database,
                )
            else:
                execute(
                    engine,
                    f"CREATE LOGIN nla_writer WITH PASSWORD={password},CHECK_POLICY=ON;\nGO\n",
                )
                grants = [
                    "CREATE USER nla_writer FOR LOGIN nla_writer;",
                    *source_grants(engine, config),
                    *target_grants(engine, config),
                    "GO",
                ]
                execute(engine, "\n".join(grants), database)
            marker.write_text(
                json.dumps(
                    {
                        "engine": engine,
                        "writer": "nla_writer",
                        "tables": [config["stage"], config["mart"]],
                    },
                    indent=2,
                )
                + "\n"
            )
    runtime = dict(line.split("=", 1) for line in RUNTIME.read_text().splitlines())
    runtime.update(values)
    RUNTIME.write_text("".join(f"{name}={value}\n" for name, value in runtime.items()))
    RUNTIME.chmod(0o600)
    print("Provisioned configured pipeline writers and typed staging/mart tables.")


if __name__ == "__main__":
    provision()
