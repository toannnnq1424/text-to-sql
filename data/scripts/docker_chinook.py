#!/usr/bin/env python3
"""Pinned native Chinook provisioning inside isolated Compose databases."""

import argparse
import json
import os
import secrets
import subprocess
import sys
import time
from pathlib import Path

from provision_chinook import ROOT, SOURCE, download, ident, literal, payload

LOCAL = ROOT / ".local"
CONFIG = LOCAL / "compose.env"
RUNTIME = LOCAL / "docker.env"


def init():
    LOCAL.mkdir(exist_ok=True, mode=0o700)
    if not CONFIG.exists():
        values = {
            key: "Nla_" + secrets.token_urlsafe(27) + "9!"
            for key in [
                "NLA_PG_ADMIN_PASSWORD",
                "NLA_MYSQL_ADMIN_PASSWORD",
                "NLA_MSSQL_ADMIN_PASSWORD",
                "NLA_CHINOOK_PG_PASSWORD",
                "NLA_CHINOOK_MYSQL_PASSWORD",
                "NLA_CHINOOK_MSSQL_PASSWORD",
                "NLA_IMPORT_PG_PASSWORD",
                "NLA_IMPORT_MYSQL_PASSWORD",
                "NLA_IMPORT_MSSQL_PASSWORD",
                "METADATA_PASSWORD",
                "LOCAL_API_TOKEN",
            ]
        }
        CONFIG.write_text("".join(f"{k}={v}\n" for k, v in values.items()))
        CONFIG.chmod(0o600)
    values = dict(
        line.split("=", 1)
        for line in CONFIG.read_text().splitlines()
        if line and not line.startswith("#")
    )
    missing = [
        key
        for key in (
            "NLA_IMPORT_PG_PASSWORD",
            "NLA_IMPORT_MYSQL_PASSWORD",
            "NLA_IMPORT_MSSQL_PASSWORD",
        )
        if key not in values
    ]
    if missing:
        for key in missing:
            values[key] = "Nla_" + secrets.token_urlsafe(27) + "9!"
        CONFIG.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
        CONFIG.chmod(0o600)
    return values


def compose(*args, sql=None, check=True):
    p = subprocess.run(
        [
            "docker",
            "compose",
            "--env-file",
            str(CONFIG),
            "-f",
            str(ROOT / "infra/compose.databases.yml"),
            *args,
        ],
        input=sql,
        text=True,
        capture_output=True,
    )
    if p.returncode and check:
        raise RuntimeError(
            "Docker database command failed; inspect service health. No credentials or SQL printed."
        )
    return p


def execute(engine, sql, db=None, reader=False, importer=False):
    vals = init()
    if engine == "POSTGRESQL":
        user = "nla_importer" if importer else "nla_reader" if reader else "nla_provisioner"
        password_key = (
            "NLA_IMPORT_PG_PASSWORD"
            if importer
            else "NLA_CHINOOK_PG_PASSWORD" if reader else "NLA_PG_ADMIN_PASSWORD"
        )
        password = vals[password_key]
        args = [
            "exec",
            "-T",
            "-e",
            "PGPASSWORD",
            "postgres",
            "psql",
            "-X",
            "-q",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            user,
            "-d",
            db or "postgres",
            "-At",
        ]
        env = dict(os.environ, PGPASSWORD=password)
    elif engine == "MYSQL":
        user = "nla_importer" if importer else "nla_reader" if reader else "root"
        password_key = (
            "NLA_IMPORT_MYSQL_PASSWORD"
            if importer
            else "NLA_CHINOOK_MYSQL_PASSWORD" if reader else "NLA_MYSQL_ADMIN_PASSWORD"
        )
        password = vals[password_key]
        args = [
            "exec",
            "-T",
            "-e",
            "MYSQL_PWD",
            "mysql",
            "mysql",
            "--batch",
            "--skip-column-names",
            "-u",
            user,
        ] + ([db or "nla_import"] if db or importer else [])
        env = dict(os.environ, MYSQL_PWD=password)
    else:
        user = "nla_importer" if importer else "nla_reader" if reader else "sa"
        password_key = (
            "NLA_IMPORT_MSSQL_PASSWORD"
            if importer
            else "NLA_CHINOOK_MSSQL_PASSWORD" if reader else "NLA_MSSQL_ADMIN_PASSWORD"
        )
        password = vals[password_key]
        args = [
            "exec",
            "-T",
            "-e",
            "SQLCMDPASSWORD",
            "sqlserver",
            "/opt/mssql-tools18/bin/sqlcmd",
            "-S",
            "localhost",
            "-U",
            user,
            "-C",
            "-b",
            "-h",
            "-1",
            "-W",
        ] + (["-d", db] if db else [])
        env = dict(os.environ, SQLCMDPASSWORD=password)
    p = subprocess.run(
        [
            "docker",
            "compose",
            "--env-file",
            str(CONFIG),
            "-f",
            str(ROOT / "infra/compose.databases.yml"),
            *args,
        ],
        input=sql,
        text=True,
        capture_output=True,
        env=env,
    )
    if p.returncode:
        raise RuntimeError(
            f"{engine} database command failed; inspect service/access. Credentials and raw SQL suppressed."
        )
    return p.stdout.strip()


def provision(engine):
    vals = init()
    marker = LOCAL / f"chinook-{engine}.json"
    db = "nla_chinook"
    if not marker.exists():
        check = {
            "POSTGRESQL": "SELECT count(*) FROM pg_database WHERE datname='nla_chinook';",
            "MYSQL": "SELECT count(*) FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME='nla_chinook';",
            "SQL_SERVER": "SET NOCOUNT ON; SELECT count(*) FROM sys.databases WHERE name='nla_chinook';\nGO\n",
        }[engine]
        if int(execute(engine, check)) != 0:
            raise RuntimeError(
                f"Refusing to overwrite existing {engine} database without provenance marker."
            )
        native = payload(engine, download(engine))
        if engine == "POSTGRESQL":
            execute(engine, "CREATE DATABASE nla_chinook;")
            execute(engine, native, db)
            execute(
                engine,
                f"""CREATE ROLE nla_reader LOGIN PASSWORD {literal(vals['NLA_CHINOOK_PG_PASSWORD'])} NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE nla_app LOGIN PASSWORD {literal(vals['METADATA_PASSWORD'])} NOSUPERUSER NOCREATEDB NOCREATEROLE;""",
            )
            execute(engine, "CREATE DATABASE nla_metadata OWNER nla_app;")
            execute(
                engine,
                "REVOKE ALL ON DATABASE nla_chinook FROM PUBLIC; GRANT CONNECT ON DATABASE nla_chinook TO nla_reader;",
            )
            execute(
                engine,
                """REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nla_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO nla_reader;
ALTER ROLE nla_reader SET default_transaction_read_only = on;
ALTER ROLE nla_reader SET statement_timeout = '15s';""",
                db,
            )
        elif engine == "MYSQL":
            execute(engine, "CREATE DATABASE `nla_chinook` CHARACTER SET utf8mb4;")
            execute(engine, native, db)
            execute(
                engine,
                f"""CREATE USER 'nla_reader'@'%' IDENTIFIED BY {literal(vals['NLA_CHINOOK_MYSQL_PASSWORD'])};
GRANT SELECT, SHOW VIEW ON nla_chinook.* TO 'nla_reader'@'%';""",
            )
        else:
            execute(engine, "CREATE DATABASE [nla_chinook];\nGO\n")
            execute(engine, native, db)
            execute(
                engine,
                f"CREATE LOGIN [nla_reader] WITH PASSWORD={literal(vals['NLA_CHINOOK_MSSQL_PASSWORD'])}, CHECK_POLICY=ON;\nGO\n",
            )
            execute(
                engine,
                """CREATE USER [nla_reader] FOR LOGIN [nla_reader];
GRANT SELECT TO [nla_reader];
GRANT VIEW DEFINITION TO [nla_reader];
DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER TO [nla_reader];
GO
""",
                db,
            )
        # Persist provenance before verification so a failed verification can be retried without destructive re-import.
        marker.write_text(
            json.dumps(
                {"engine": engine, "release": SOURCE["release"], "status": "IMPORTED_UNVERIFIED"},
                indent=2,
            )
            + "\n"
        )
    provision_import_namespace(engine, vals)
    counts = {}
    names = {
        "invoice_line": "InvoiceLine",
        "media_type": "MediaType",
        "playlist_track": "PlaylistTrack",
    }
    for canonical, expected in SOURCE["expectedCounts"].items():
        name = canonical if engine == "POSTGRESQL" else names.get(canonical, canonical.title())
        quote = (
            '"' + name + '"'
            if engine == "POSTGRESQL"
            else "`" + name + "`" if engine == "MYSQL" else "[dbo].[" + name + "]"
        )
        query = f"SELECT COUNT(*) FROM {quote};"
        if engine == "SQL_SERVER":
            query = "SET NOCOUNT ON; " + query + "\nGO\n"
        n = int(execute(engine, query, db, reader=True))
        counts[canonical] = n
        if n != expected:
            raise RuntimeError(f"{engine}: row count mismatch for {canonical}: {n} != {expected}")
    # Test writes with a no-op update; no sample data can be changed even if privileges are wrong.
    name = "track" if engine == "POSTGRESQL" else "Track"
    col = "name" if engine == "POSTGRESQL" else "Name"
    write = f"UPDATE {name} SET {col}={col} WHERE 1=0;"
    if engine == "SQL_SERVER":
        write += "\nGO\n"
    try:
        execute(engine, write, db, reader=True)
    except RuntimeError:
        denied = True
    else:
        denied = False
    if not denied:
        raise RuntimeError(f"{engine}: reader unexpectedly permits writes")
    report = {
        "engine": engine,
        "database": db,
        "release": SOURCE["release"],
        "sha256": SOURCE["files"][engine]["sha256"],
        "counts": counts,
        "readerWriteDenied": True,
        "status": "VERIFIED",
    }
    marker.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    runtime = {
        **vals,
        "METADATA_JDBC_URL": "jdbc:postgresql://127.0.0.1:55432/nla_metadata",
        "METADATA_USERNAME": "nla_app",
        "SPRING_PROFILES_ACTIVE": "local",
        "WAREHOUSE_ALLOWED_HOSTS": "127.0.0.1,localhost",
        "CHINOOK_DOCKER": "true",
    }
    if engine == "MYSQL":
        public_key = compose("exec", "-T", "mysql", "cat", "/var/lib/mysql/public_key.pem").stdout
        keyfile = LOCAL / "mysql-public-key.pem"
        keyfile.write_text(public_key)
        keyfile.chmod(0o600)
        runtime["NLA_MYSQL_RSA_PUBLIC_KEY"] = str(keyfile.resolve())
    elif RUNTIME.exists():
        old = dict(line.split("=", 1) for line in RUNTIME.read_text().splitlines() if line)
        if "NLA_MYSQL_RSA_PUBLIC_KEY" in old:
            runtime["NLA_MYSQL_RSA_PUBLIC_KEY"] = old["NLA_MYSQL_RSA_PUBLIC_KEY"]
    runtime["PYTHON_AI_TOKEN"] = vals.get("PYTHON_AI_TOKEN", "")
    runtime["PYTHON_AI_URL"] = "http://127.0.0.1:8000"
    RUNTIME.write_text("".join(f"{k}={v}\n" for k, v in runtime.items()))
    RUNTIME.chmod(0o600)


def provision_import_namespace(engine, values):
    password_key = {
        "POSTGRESQL": "NLA_IMPORT_PG_PASSWORD",
        "MYSQL": "NLA_IMPORT_MYSQL_PASSWORD",
        "SQL_SERVER": "NLA_IMPORT_MSSQL_PASSWORD",
    }[engine]
    password = literal(values[password_key])
    if engine == "POSTGRESQL":
        exists = execute(engine, "SELECT count(*) FROM pg_roles WHERE rolname='nla_importer';")
        if exists == "0":
            execute(
                engine,
                f"CREATE ROLE nla_importer LOGIN PASSWORD {password} "
                "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;",
            )
        else:
            execute(engine, f"ALTER ROLE nla_importer WITH PASSWORD {password};")
        schema_exists = execute(
            engine,
            "SELECT count(*) FROM information_schema.schemata " "WHERE schema_name='nla_import';",
            "nla_chinook",
        )
        if schema_exists == "0":
            execute(engine, "CREATE SCHEMA nla_import;", "nla_chinook")
        execute(
            engine,
            "GRANT CONNECT ON DATABASE nla_chinook TO nla_importer;",
        )
        execute(
            engine,
            "GRANT USAGE, CREATE ON SCHEMA nla_import TO nla_importer;",
            "nla_chinook",
        )
        return
    if engine == "MYSQL":
        execute(engine, "CREATE DATABASE IF NOT EXISTS `nla_import` CHARACTER SET utf8mb4;")
        user_exists = execute(
            engine,
            "SELECT COUNT(*) FROM mysql.user WHERE user='nla_importer' AND host='%';",
        )
        if user_exists == "0":
            execute(
                engine,
                f"CREATE USER 'nla_importer'@'%' IDENTIFIED BY {password};",
            )
        else:
            execute(
                engine,
                f"ALTER USER 'nla_importer'@'%' IDENTIFIED BY {password};",
            )
        execute(
            engine,
            "GRANT CREATE, INSERT, SELECT ON nla_import.* TO 'nla_importer'@'%';",
        )
        return
    login_exists = execute(
        engine,
        "SELECT COUNT(*) FROM sys.sql_logins WHERE name='nla_importer';",
    )
    if login_exists == "0":
        execute(
            engine,
            f"CREATE LOGIN [nla_importer] WITH PASSWORD={password},CHECK_POLICY=ON;\nGO\n",
        )
    else:
        execute(
            engine,
            f"ALTER LOGIN [nla_importer] WITH PASSWORD={password};\nGO\n",
        )
    schema_exists = execute(
        engine,
        "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.schemas WHERE name='nla_import';\nGO\n",
        "nla_chinook",
    )
    if schema_exists == "0":
        execute(engine, "CREATE SCHEMA [nla_import] AUTHORIZATION [dbo];\nGO\n", "nla_chinook")
    user_exists = execute(
        engine,
        "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.database_principals "
        "WHERE name='nla_importer';\nGO\n",
        "nla_chinook",
    )
    if user_exists == "0":
        execute(
            engine,
            "CREATE USER [nla_importer] FOR LOGIN [nla_importer];\nGO\n",
            "nla_chinook",
        )
    execute(
        engine,
        "GRANT CREATE TABLE TO [nla_importer];\n"
        "GRANT ALTER, SELECT, INSERT ON SCHEMA::[nla_import] TO [nla_importer];\nGO\n",
        "nla_chinook",
    )


def verify_import_writer(engine):
    table = {
        "POSTGRESQL": '"nla_import"."__nla_privilege_probe"',
        "MYSQL": "`nla_import`.`__nla_privilege_probe`",
        "SQL_SERVER": "[nla_import].[__nla_privilege_probe]",
    }[engine]
    database = "nla_import" if engine == "MYSQL" else "nla_chinook"
    execute(engine, f"DROP TABLE IF EXISTS {table};", database)
    if engine == "SQL_SERVER":
        create = f"CREATE TABLE {table} ([id] int NOT NULL);\nGO\n"
        insert = f"INSERT INTO {table} ([id]) VALUES (1);\nGO\n"
        count = f"SET NOCOUNT ON; SELECT COUNT(*) FROM {table};\nGO\n"
        denied_scope = "CREATE TABLE [dbo].[__nla_privilege_probe] ([id] int);\nGO\n"
        outside_table = "[dbo].[__nla_privilege_probe]"
    else:
        create = f"CREATE TABLE {table} (id int NOT NULL);"
        insert = f"INSERT INTO {table} (id) VALUES (1);"
        count = f"SELECT COUNT(*) FROM {table};"
        denied_scope = {
            "POSTGRESQL": 'CREATE TABLE public."__nla_privilege_probe" (id int);',
            "MYSQL": "CREATE TABLE nla_chinook.__nla_privilege_probe (id int);",
        }[engine]
        outside_table = {
            "POSTGRESQL": '"public"."__nla_privilege_probe"',
            "MYSQL": "`nla_chinook`.`__nla_privilege_probe`",
        }[engine]
    execute(engine, create, database, importer=True)
    execute(engine, insert, database, importer=True)
    if execute(engine, count, database, importer=True) != "1":
        raise RuntimeError(f"{engine}: import writer cannot write/read its target namespace")
    try:
        execute(engine, denied_scope, "nla_chinook", importer=True)
    except RuntimeError:
        denied = True
    else:
        denied = False
        execute(engine, f"DROP TABLE IF EXISTS {outside_table};", "nla_chinook")
    execute(engine, f"DROP TABLE {table};", database)
    if not denied:
        raise RuntimeError(f"{engine}: import writer can create objects outside its namespace")


def main():
    p = argparse.ArgumentParser()
    p.add_argument(
        "action",
        choices=["init", "up", "provision", "provision-import", "verify", "status"],
    )
    p.add_argument("--engine", choices=SOURCE["files"])
    a = p.parse_args()
    init()
    if a.action == "init":
        print("Generated private local credentials; no secrets printed.")
        return
    if a.action == "up":
        result = compose("up", "-d", check=False)
        if result.returncode:
            print(result.stderr[-1500:], file=sys.stderr)
            sys.exit(result.returncode)
        print("Database services started. Use status, then provision.")
        return
    if a.action == "status":
        print(compose("ps").stdout)
        return
    if a.action == "provision-import":
        values = init()
        for engine in ([a.engine] if a.engine else SOURCE["files"]):
            provision_import_namespace(engine, values)
            verify_import_writer(engine)
        runtime = (
            dict(line.split("=", 1) for line in RUNTIME.read_text().splitlines() if line)
            if RUNTIME.exists()
            else {}
        )
        runtime.update(values)
        runtime.update(
            {
                "METADATA_JDBC_URL": "jdbc:postgresql://127.0.0.1:55432/nla_metadata",
                "METADATA_USERNAME": "nla_app",
                "SPRING_PROFILES_ACTIVE": "local",
                "WAREHOUSE_ALLOWED_HOSTS": "127.0.0.1,localhost",
                "CHINOOK_DOCKER": "true",
            }
        )
        RUNTIME.write_text("".join(f"{key}={value}\n" for key, value in runtime.items()))
        RUNTIME.chmod(0o600)
        print("Dedicated import writers verified for requested engine(s).")
        return
    for engine in ([a.engine] if a.engine else SOURCE["files"]):
        provision(engine)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
