#!/usr/bin/env python3
"""Pinned Microsoft analytical sample projection in three new isolated databases.

This is trusted administrative sample provisioning, not arbitrary app SQL import.
No customer contact data, bulk data, or credentials are committed to the repository.
"""

import argparse
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import urllib.request
import zipfile
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import docker_chinook as db

ROOT = Path(__file__).resolve().parents[2]
SOURCE = json.loads((ROOT / "data/adventureworks/source.json").read_text())
LOCAL = ROOT / ".local/adventureworks"
ARCHIVE = LOCAL / "AdventureWorksDW-data-warehouse-install-script.zip"
DATABASE = SOURCE["database"]
READER = "nla_awdw_reader"
ENGINES = ("POSTGRESQL", "MYSQL", "SQL_SERVER")
SUFFIX = {"POSTGRESQL": "PG", "MYSQL": "MYSQL", "SQL_SERVER": "MSSQL"}


def persist(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    path.chmod(0o600)


def credentials():
    path = ROOT / ".local/sample-readers.env"
    values = {}
    if path.exists():
        values = dict(
            line.split("=", 1)
            for line in path.read_text().splitlines()
            if line and not line.startswith("#")
        )
    for engine in ENGINES:
        values.setdefault(
            "NLA_SAMPLE_AWDW_" + SUFFIX[engine] + "_PASSWORD",
            "Nla_" + secrets.token_urlsafe(32) + "9!",
        )
    path.write_text("".join(k + "=" + v + "\n" for k, v in values.items()))
    path.chmod(0o600)
    return values


def download():
    LOCAL.mkdir(parents=True, exist_ok=True)
    if not ARCHIVE.exists():
        temporary = ARCHIVE.with_suffix(".partial")
        with (
            urllib.request.urlopen(SOURCE["url"], timeout=60) as response,
            temporary.open("wb") as output,
        ):
            size = 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > 32 * 1024 * 1024:
                    raise ValueError("Sample archive exceeds pinned size budget.")
                output.write(chunk)
        temporary.replace(ARCHIVE)
    if hashlib.sha256(ARCHIVE.read_bytes()).hexdigest() != SOURCE["sha256"]:
        raise ValueError("Sample archive checksum mismatch; refusing provisioning.")
    return ARCHIVE


def rows_for(archive, table):
    with zipfile.ZipFile(archive) as source:
        content = source.read(table["file"])
    if hashlib.sha256(content).hexdigest() != table["sha256"]:
        raise ValueError("Pinned sample member checksum mismatch.")
    rows = []
    for line in content.decode("utf-8-sig").splitlines():
        fields = line.split("|")
        if len(fields) != table["sourceColumnCount"]:
            raise ValueError("Pinned sample row width changed.")
        row = {}
        for column in table["columns"]:
            value = fields[column["sourceIndex"]]
            if value == "" and column["nullable"]:
                row[column["name"]] = None
            elif column["type"] == "INTEGER":
                row[column["name"]] = str(int(value))
            elif column["type"] == "DECIMAL":
                number = Decimal(value)
                if not number.is_finite():
                    raise ValueError("Nonfinite source value")
                row[column["name"]] = format(number, "f")
            else:
                row[column["name"]] = value
        rows.append(row)
    if len(rows) != table["rowCount"]:
        raise ValueError("Pinned sample row count changed.")
    return rows


def source_data():
    path = download()
    rows = {table["name"]: rows_for(path, table) for table in SOURCE["tables"]}
    for table in SOURCE["tables"]:
        keys = {tuple(row[c] for c in table["primaryKey"]) for row in rows[table["name"]]}
        if len(keys) != len(rows[table["name"]]):
            raise ValueError("Source primary key is not unique: " + table["name"])
        for fk in table["foreignKeys"]:
            reference = {row[fk["referenceColumn"]] for row in rows[fk["referenceTable"]]}
            if any(
                row[fk["column"]] is not None and row[fk["column"]] not in reference
                for row in rows[table["name"]]
            ):
                raise ValueError(
                    "Projected source relation is not closed: " + table["name"] + "." + fk["column"]
                )
    return rows


def quote(engine, value):
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,99}", value):
        raise ValueError("Unsafe sample identifier")
    if engine == "MYSQL":
        return "`" + value + "`"
    if engine == "SQL_SERVER":
        return "[" + value + "]"
    return '"' + value + '"'


def table_name(engine, name):
    return (
        quote(engine, DATABASE if engine == "MYSQL" else SOURCE["schema"])
        + "."
        + quote(engine, name)
    )


def literal(engine, value, column=None):
    if value is None:
        return "NULL"
    if column and column["type"] in {"INTEGER", "DECIMAL"}:
        return str(value)
    escaped = str(value).replace("'", "''")
    if engine == "MYSQL":
        escaped = escaped.replace("\\", "\\\\")
    return ("N" if engine == "SQL_SERVER" else "") + "'" + escaped + "'"


def execute(engine, sql, reader=False):
    if engine == "SQL_SERVER":
        sql = "SET NOCOUNT ON;\n" + sql + "\nGO\n"
    if not reader:
        return db.execute(engine, sql, db=DATABASE)
    values = credentials()
    password = values["NLA_SAMPLE_AWDW_" + SUFFIX[engine] + "_PASSWORD"]
    args = {
        "POSTGRESQL": [
            "-e",
            "PGPASSWORD",
            "postgres",
            "psql",
            "-X",
            "-q",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            READER,
            "-d",
            DATABASE,
            "-At",
        ],
        "MYSQL": [
            "-e",
            "MYSQL_PWD",
            "mysql",
            "mysql",
            "--batch",
            "--skip-column-names",
            "-u",
            READER,
            DATABASE,
        ],
        "SQL_SERVER": [
            "-e",
            "SQLCMDPASSWORD",
            "sqlserver",
            "/opt/mssql-tools18/bin/sqlcmd",
            "-S",
            "localhost",
            "-U",
            READER,
            "-C",
            "-b",
            "-h",
            "-1",
            "-W",
            "-d",
            DATABASE,
        ],
    }[engine]
    key = {"POSTGRESQL": "PGPASSWORD", "MYSQL": "MYSQL_PWD", "SQL_SERVER": "SQLCMDPASSWORD"}[engine]
    result = subprocess.run(
        [
            "docker",
            "compose",
            "--env-file",
            str(db.CONFIG),
            "-f",
            str(ROOT / "infra/compose.databases.yml"),
            "exec",
            "-T",
            *args,
        ],
        input=sql,
        text=True,
        capture_output=True,
        env=dict(os.environ, **{key: password}),
    )
    if result.returncode:
        raise RuntimeError("Sample reader database operation rejected; SQL/credentials suppressed.")
    return result.stdout.strip()


def ddl(engine, table):
    columns = []
    for column in table["columns"]:
        kind = column["type"]
        types = {
            "INTEGER": "INTEGER",
            "DECIMAL": "DECIMAL(19,4)" if column["sourceType"] == "money" else "DECIMAL(38,18)",
            "STRING": ("NVARCHAR" if engine == "SQL_SERVER" else "VARCHAR")
            + "("
            + str(int(column["size"] or "255"))
            + ")",
            "DATE": "DATE",
            "TIMESTAMP": (
                "DATETIME2(3)"
                if engine == "SQL_SERVER"
                else "DATETIME(3)" if engine == "MYSQL" else "TIMESTAMP(3)"
            ),
        }
        columns.append(
            quote(engine, column["name"])
            + " "
            + types[kind]
            + (" NULL" if column["nullable"] else " NOT NULL")
        )
    columns.append("PRIMARY KEY (" + ",".join(quote(engine, c) for c in table["primaryKey"]) + ")")
    return "CREATE TABLE " + table_name(engine, table["name"]) + " (" + ",".join(columns) + ");"


def provision(engine, rows):
    marker = LOCAL / (engine + "-owned.json")
    exists = {
        "POSTGRESQL": "SELECT COUNT(*) FROM pg_database WHERE datname='" + DATABASE + "';",
        "MYSQL": "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='"
        + DATABASE
        + "';",
        "SQL_SERVER": "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.databases WHERE name=N'"
        + DATABASE
        + "';\nGO\n",
    }
    present = int(
        db.execute(
            engine,
            exists[engine],
            db=(
                "master"
                if engine == "SQL_SERVER"
                else "postgres" if engine == "POSTGRESQL" else None
            ),
        )
    )
    if present:
        if (
            not marker.exists()
            or json.loads(marker.read_text()).get("sourceSha256") != SOURCE["sha256"]
        ):
            raise ValueError(
                "Existing sample database is not owned by this pinned provisioning; refusing mutation."
            )
        state = json.loads(marker.read_text())
    else:
        state = {
            "engine": engine,
            "database": DATABASE,
            "sourceSha256": SOURCE["sha256"],
            "loaded": [],
            "constraints": False,
        }
        persist(marker, state)
        create = "CREATE DATABASE " + quote(engine, DATABASE)
        if engine == "MYSQL":
            create += " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs"
        db.execute(
            engine,
            create + ";" + ("\nGO\n" if engine == "SQL_SERVER" else ""),
            db=(
                "master"
                if engine == "SQL_SERVER"
                else "postgres" if engine == "POSTGRESQL" else None
            ),
        )
    if engine == "POSTGRESQL":
        execute(engine, "CREATE SCHEMA IF NOT EXISTS " + quote(engine, SOURCE["schema"]) + ";")
    elif engine == "SQL_SERVER":
        execute(engine, "IF SCHEMA_ID(N'analytics') IS NULL EXEC(N'CREATE SCHEMA [analytics]');")
    for table in SOURCE["tables"]:
        name = table["name"]
        if name in state["loaded"]:
            continue
        statements = [ddl(engine, table)]
        for offset in range(0, len(rows[name]), 500):
            values = [
                "(" + ",".join(literal(engine, row[c["name"]], c) for c in table["columns"]) + ")"
                for row in rows[name][offset : offset + 500]
            ]
            statements.append(
                "INSERT INTO " + table_name(engine, name) + " VALUES " + ",\n".join(values) + ";"
            )
        # Whole-table DDL/data transaction on PG/MSSQL; MySQL partial failure is explicit.
        sql = (
            ("BEGIN TRANSACTION;\n" if engine == "SQL_SERVER" else "BEGIN;\n")
            + "\n".join(statements)
            + "\nCOMMIT;"
        )
        execute(engine, sql)
        state["loaded"].append(name)
        persist(marker, state)
    if not state["constraints"]:
        statements = []
        for table in SOURCE["tables"]:
            for index, fk in enumerate(table["foreignKeys"]):
                statements.append(
                    "ALTER TABLE "
                    + table_name(engine, table["name"])
                    + " ADD CONSTRAINT "
                    + quote(engine, "fk_" + table["name"] + "_" + str(index))
                    + " FOREIGN KEY ("
                    + quote(engine, fk["column"])
                    + ") REFERENCES "
                    + table_name(engine, fk["referenceTable"])
                    + " ("
                    + quote(engine, fk["referenceColumn"])
                    + ");"
                )
        execute(engine, "\n".join(statements))
        state["constraints"] = True
        persist(marker, state)
    password = credentials()["NLA_SAMPLE_AWDW_" + SUFFIX[engine] + "_PASSWORD"]
    secret = literal(engine, password)
    if engine == "POSTGRESQL":
        found = int(
            db.execute(
                engine,
                "SELECT COUNT(*) FROM pg_roles WHERE rolname='" + READER + "';",
                db="postgres",
            )
        )
        if not found:
            execute(engine, "CREATE ROLE " + READER + " LOGIN PASSWORD " + secret + ";")
        execute(
            engine,
            "GRANT CONNECT ON DATABASE "
            + quote(engine, DATABASE)
            + " TO "
            + READER
            + "; GRANT USAGE ON SCHEMA analytics TO "
            + READER
            + "; GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO "
            + READER
            + ";",
        )
    elif engine == "MYSQL":
        execute(
            engine,
            "CREATE USER IF NOT EXISTS '"
            + READER
            + "'@'%' IDENTIFIED BY "
            + secret
            + "; GRANT SELECT ON "
            + quote(engine, DATABASE)
            + ".* TO '"
            + READER
            + "'@'%';",
        )
    else:
        execute(
            engine,
            "IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name=N'"
            + READER
            + "') CREATE LOGIN "
            + quote(engine, READER)
            + " WITH PASSWORD="
            + secret
            + "; IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name=N'"
            + READER
            + "') CREATE USER "
            + quote(engine, READER)
            + " FOR LOGIN "
            + quote(engine, READER)
            + "; GRANT SELECT ON SCHEMA::analytics TO "
            + quote(engine, READER)
            + "; GRANT VIEW DEFINITION ON SCHEMA::analytics TO "
            + quote(engine, READER)
            + ";",
        )
    state["status"] = "READY"
    persist(marker, state)


def oracle(rows):
    dates = {r["DateKey"]: r for r in rows["DimDate"]}
    territories = {r["SalesTerritoryKey"]: r for r in rows["DimSalesTerritory"]}
    result = {"counts": {name: len(values) for name, values in rows.items()}}
    for fact in ["FactInternetSales", "FactResellerSales"]:
        annual = defaultdict(Decimal)
        countries = defaultdict(Decimal)
        for row in rows[fact]:
            amount = Decimal(row["SalesAmount"])
            annual[dates[row["OrderDateKey"]]["CalendarYear"]] += amount
            countries[territories[row["SalesTerritoryKey"]]["SalesTerritoryCountry"]] += amount
        result[fact] = {
            "totalRevenue": format(
                sum((Decimal(r["SalesAmount"]) for r in rows[fact]), Decimal(0)), ".4f"
            ),
            "totalQuantity": str(sum(int(r["OrderQuantity"]) for r in rows[fact])),
            "annualRevenue": {k: format(v, ".4f") for k, v in sorted(annual.items())},
            "countryRevenue": {k: format(v, ".4f") for k, v in sorted(countries.items())},
        }
    return result


def verify(engine, expected):
    counts = {}
    for table in SOURCE["tables"]:
        counts[table["name"]] = int(
            execute(
                engine,
                "SELECT COUNT(*) FROM " + table_name(engine, table["name"]) + ";",
                reader=True,
            )
        )
    if counts != expected["counts"]:
        raise ValueError("Sample reader counts mismatch")
    analytical = {}
    for fact in ["FactInternetSales", "FactResellerSales"]:
        actual = Decimal(
            execute(
                engine,
                "SELECT SUM("
                + quote(engine, "SalesAmount")
                + ") FROM "
                + table_name(engine, fact)
                + ";",
                reader=True,
            )
        )
        if actual != Decimal(expected[fact]["totalRevenue"]):
            raise ValueError("Sample revenue mismatch")
        quantity = int(
            execute(
                engine,
                "SELECT SUM("
                + quote(engine, "OrderQuantity")
                + ") FROM "
                + table_name(engine, fact)
                + ";",
                reader=True,
            )
        )
        if quantity != int(expected[fact]["totalQuantity"]):
            raise ValueError("Sample quantity mismatch")
        group_results = {}
        for kind, dimension, dimension_key, fact_key, column in [
            ("annualRevenue", "DimDate", "DateKey", "OrderDateKey", "CalendarYear"),
            (
                "countryRevenue",
                "DimSalesTerritory",
                "SalesTerritoryKey",
                "SalesTerritoryKey",
                "SalesTerritoryCountry",
            ),
        ]:
            dimension_column = "d." + quote(engine, column)
            amount = "SUM(f." + quote(engine, "SalesAmount") + ")"
            # One exact, delimiter-separated scalar per group avoids CLI alignment differences.
            output = (
                "CAST("
                + dimension_column
                + " AS VARCHAR(100)) || '|' || CAST("
                + amount
                + " AS VARCHAR(100))"
                if engine == "POSTGRESQL"
                else "CONCAT(" + dimension_column + ",'|'," + amount + ")"
            )
            sql = (
                "SELECT "
                + output
                + " FROM "
                + table_name(engine, fact)
                + " f JOIN "
                + table_name(engine, dimension)
                + " d ON f."
                + quote(engine, fact_key)
                + "=d."
                + quote(engine, dimension_key)
                + " GROUP BY "
                + dimension_column
                + ";"
            )
            observed = {
                key.strip(): Decimal(value.strip())
                for row in execute(engine, sql, reader=True).splitlines()
                if row.strip()
                for key, value in [row.split("|", 1)]
            }
            if observed != {key: Decimal(value) for key, value in expected[fact][kind].items()}:
                raise ValueError("Sample join/aggregate mismatch: " + kind)
            group_results[kind] = {key: str(value) for key, value in sorted(observed.items())}
        analytical[fact] = {
            "revenue": str(actual),
            "quantity": quantity,
            **group_results,
        }
    denied = False
    try:
        execute(
            engine, "DELETE FROM " + table_name(engine, "DimCurrency") + " WHERE 1=0;", reader=True
        )
    except RuntimeError:
        denied = True
    if not denied:
        raise ValueError("Sample reader unexpectedly has write permissions")
    return {
        "status": "PASS",
        "counts": counts,
        "writeDenied": True,
        "sourceSha256": SOURCE["sha256"],
        "analytical": analytical,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("download", "provision", "verify"))
    parser.add_argument("--engine", choices=ENGINES)
    args = parser.parse_args()
    if args.action == "download":
        download()
        print("Pinned sample archive verified")
        return
    rows = source_data()
    expected = oracle(rows)
    persist(LOCAL / "oracle.json", expected)
    engines = [args.engine] if args.engine else ENGINES
    report = {}
    for engine in engines:
        if args.action == "provision":
            provision(engine, rows)
        report[engine] = verify(engine, expected)
        print(engine, "sample READY; counts, exact revenue, read-only grants verified")
    persist(LOCAL / "provision-report.json", report)


if __name__ == "__main__":
    main()
