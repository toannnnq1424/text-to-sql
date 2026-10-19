#!/usr/bin/env python3
"""Provision dedicated writer and staging/mart tables; never alters Chinook source tables."""

import json
import secrets

from docker_chinook import CONFIG, LOCAL, ROOT, RUNTIME, execute, init, literal


def provision():
    values = init()
    for engine, suffix in [("POSTGRESQL", "PG"), ("MYSQL", "MYSQL"), ("SQL_SERVER", "MSSQL")]:
        marker = LOCAL / f"pipeline-{engine}.json"
        key = f"NLA_PIPELINE_{suffix}_PASSWORD"
        if key not in values:
            values[key] = "Nla_" + secrets.token_urlsafe(27) + "9!"
            CONFIG.write_text("".join(f"{k}={v}\n" for k, v in values.items()))
            CONFIG.chmod(0o600)
        if not marker.exists():
            password = literal(values[key])
            names = ["nla_stage_sales", "nla_mart_sales"]
            if engine == "POSTGRESQL":
                ddl = (
                    ";\n".join(
                        f"CREATE TABLE public.{n}(country varchar(100) PRIMARY KEY,total decimal(18,2) NOT NULL)"
                        for n in names
                    )
                    + ";"
                )
                execute(engine, ddl, "nla_chinook")
                execute(
                    engine,
                    f"""CREATE ROLE nla_writer LOGIN PASSWORD {password} NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE nla_chinook TO nla_writer;""",
                )
                execute(
                    engine,
                    """GRANT USAGE ON SCHEMA public TO nla_writer;
GRANT SELECT ON public.invoice TO nla_writer;
GRANT SELECT, INSERT, DELETE ON public.nla_stage_sales, public.nla_mart_sales TO nla_writer;""",
                    "nla_chinook",
                )
            elif engine == "MYSQL":
                execute(
                    engine,
                    ";\n".join(
                        f"CREATE TABLE `{n}`(country varchar(100) PRIMARY KEY,total decimal(18,2) NOT NULL)"
                        for n in names
                    )
                    + ";",
                    "nla_chinook",
                )
                execute(
                    engine,
                    f"""CREATE USER 'nla_writer'@'%' IDENTIFIED BY {password};
GRANT SELECT ON nla_chinook.Invoice TO 'nla_writer'@'%';
"""
                    + ";\n".join(
                        f"GRANT SELECT,INSERT,DELETE ON nla_chinook.{n} TO 'nla_writer'@'%'"
                        for n in names
                    )
                    + ";",
                )
            else:
                execute(
                    engine,
                    ";\n".join(
                        f"CREATE TABLE dbo.[{n}](country nvarchar(100) PRIMARY KEY,total decimal(18,2) NOT NULL)"
                        for n in names
                    )
                    + ";\nGO\n",
                    "nla_chinook",
                )
                execute(
                    engine,
                    f"CREATE LOGIN nla_writer WITH PASSWORD={password},CHECK_POLICY=ON;\nGO\n",
                )
                execute(
                    engine,
                    """CREATE USER nla_writer FOR LOGIN nla_writer;
GRANT SELECT ON dbo.Invoice TO nla_writer;
GRANT SELECT, INSERT, DELETE ON dbo.nla_stage_sales TO nla_writer;
GRANT SELECT, INSERT, DELETE ON dbo.nla_mart_sales TO nla_writer;
GO
""",
                    "nla_chinook",
                )
            marker.write_text(
                json.dumps({"engine": engine, "writer": "nla_writer", "tables": names}) + "\n"
            )
    runtime = dict(line.split("=", 1) for line in RUNTIME.read_text().splitlines())
    for k, v in values.items():
        runtime[k] = v
    RUNTIME.write_text("".join(f"{k}={v}\n" for k, v in runtime.items()))
    RUNTIME.chmod(0o600)
    print("Provisioned dedicated pipeline writers and staging/mart tables on all three engines.")


if __name__ == "__main__":
    provision()
