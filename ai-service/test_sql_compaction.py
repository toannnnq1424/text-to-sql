"""Run real native plans for three dialects and compare rows/types independently.

DuckDB is an in-memory test database supplied by the source-kit dependency
closure. These tests do not replace PostgreSQL/MySQL/SQL Server integration.
"""

from copy import deepcopy
from decimal import Decimal

import duckdb
import pytest
import sqlglot
from sqlglot import exp
from wren.engine import WrenEngine
from wren.nla_compaction import compact_generated_models

from semantic_planner import PlanRequest, plan_sql

ENGINES = {"POSTGRESQL": "postgres", "MYSQL": "mysql", "SQL_SERVER": "tsql"}


def payload(engine, sql):
    schema = "dbo" if engine == "SQL_SERVER" else "public"
    source = "mssql" if engine == "SQL_SERVER" else ENGINES[engine]
    ast = sqlglot.parse_one(sql, read="postgres")
    for table in ast.find_all(exp.Table):
        if table.db == "public":
            table.set("db", exp.to_identifier(schema, quoted=True))
    return {
        "correlationId": "native-compaction-test",
        "sqlDialect": engine,
        "sql": ast.sql(dialect=ENGINES[engine]),
        "manifest": {
            "catalog": "nla",
            "schema": "semantic",
            "dataSource": source,
            "models": [
                {
                    "name": "nla_model_3",
                    "tableReference": {"schema": schema, "table": "Employee"},
                    "columns": [
                        {"name": "EmployeeId", "type": "INTEGER"},
                        {"name": "Department", "type": "STRING"},
                        {"name": "Salary", "type": "DECIMAL"},
                        {"name": "HiredAt", "type": "TIMESTAMP"},
                        {"name": "ManagerId", "type": "INTEGER"},
                    ],
                    "primaryKey": "EmployeeId",
                }
            ],
            "relationships": [],
        },
    }


@pytest.fixture
def database():
    with duckdb.connect(":memory:") as connection:
        for schema in ("public", "dbo"):
            connection.execute(f"CREATE SCHEMA {schema}")
            connection.execute(
                f'CREATE TABLE {schema}."Employee" ("EmployeeId" INTEGER, "Department" VARCHAR, '
                '"Salary" DECIMAL(38,10), "HiredAt" TIMESTAMP, "ManagerId" INTEGER)'
            )
            connection.executemany(
                f'INSERT INTO {schema}."Employee" VALUES (?,?,?,?,?)',
                [
                    (1, "North", Decimal("100.1234567890"), "2025-01-01 10:15:30.123456", None),
                    (2, "North", Decimal("200.0000000001"), "2025-01-02 10:15:30.654321", 1),
                    (3, "South", None, "2025-02-01 10:00:00", 1),
                    (4, None, Decimal("-2.0000000001"), None, 2),
                    (5, "North", Decimal("100.1234567890"), "2025-01-01 10:15:30.123456", None),
                ],
            )
        yield connection


CASES = [
    'SELECT COUNT(*) AS record_count FROM public."Employee"',
    'SELECT COUNT("Salary") AS n, COUNT(DISTINCT "Department") AS departments FROM public."Employee"',
    'SELECT SUM("Salary") AS total, MIN("Salary") AS smallest FROM public."Employee"',
    'SELECT COUNT(*) AS n FROM public."Employee" WHERE "Salary" IS NULL',
    'SELECT "Department", COUNT(*) AS n FROM public."Employee" GROUP BY "Department" ORDER BY n DESC, "Department" LIMIT 2',
    'SELECT DISTINCT "Department" FROM public."Employee" ORDER BY "Department" NULLS FIRST LIMIT 3',
    'SELECT COUNT(*) AS n FROM (SELECT DISTINCT "Department" FROM public."Employee") d',
    'WITH totals AS (SELECT "Department", SUM("Salary") AS total FROM public."Employee" GROUP BY "Department") SELECT * FROM totals ORDER BY total',
    'WITH selected AS (SELECT "EmployeeId" FROM public."Employee" ORDER BY "EmployeeId" LIMIT 2) SELECT COUNT(*) AS n FROM selected',
    'WITH selected AS (SELECT "EmployeeId" FROM public."Employee" WHERE "EmployeeId" > 1) SELECT COUNT(*) AS n FROM selected a JOIN selected b ON a."EmployeeId" = b."EmployeeId"',
    'SELECT e."EmployeeId", m."EmployeeId" AS boss FROM public."Employee" e LEFT JOIN public."Employee" m ON e."ManagerId" = m."EmployeeId" WHERE m."EmployeeId" IS NULL ORDER BY e."EmployeeId"',
    'SELECT CAST("HiredAt" AS DATE) AS day, COUNT(*) AS n FROM public."Employee" GROUP BY CAST("HiredAt" AS DATE) ORDER BY day NULLS FIRST',
    'SELECT "EmployeeId", ROW_NUMBER() OVER (PARTITION BY "Department" ORDER BY "EmployeeId") AS position FROM public."Employee" ORDER BY "EmployeeId"',
    'SELECT * FROM public."Employee" ORDER BY "EmployeeId"',
    'WITH totals AS (SELECT COUNT(*) FROM public."Employee") SELECT * FROM totals',
    'WITH selected(id) AS (SELECT "EmployeeId" FROM public."Employee") SELECT id FROM selected ORDER BY id',
    'SELECT q.id FROM (SELECT "EmployeeId" FROM public."Employee") AS q(id) ORDER BY q.id',
    'WITH totals(label, n) AS (SELECT "Department", COUNT(*) FROM public."Employee" GROUP BY "Department") SELECT * FROM totals ORDER BY n, label',
    'WITH selected(id) AS (SELECT "EmployeeId" FROM public."Employee" UNION ALL SELECT "EmployeeId" FROM public."Employee") SELECT id FROM selected ORDER BY id',
    'WITH selected(renamed) AS (SELECT "EmployeeId" AS original_alias FROM public."Employee") SELECT renamed FROM selected ORDER BY renamed',
]


def rows(connection, sql, dialect):
    translated = sqlglot.transpile(sql, read=dialect, write="duckdb")[0]
    result = connection.execute(translated)
    types = [description[1] for description in result.description]
    labels = [description[0] for description in result.description]
    return result.fetchall(), types, labels


@pytest.mark.parametrize("engine", ENGINES)
@pytest.mark.parametrize("sql", CASES)
def test_native_compaction_preserves_rows_nulls_precision_and_operation_boundaries(
    database, engine, sql
):
    request = payload(engine, sql)
    original = deepcopy(request)
    planned = plan_sql(PlanRequest.model_validate(request))
    assert request == original
    expected_rows, expected_types, expected_labels = rows(database, request["sql"], ENGINES[engine])
    actual_rows, actual_types, actual_labels = rows(database, planned.sql, ENGINES[engine])
    assert actual_rows == expected_rows
    assert actual_types == expected_types
    assert actual_labels == expected_labels
    assert "nla_model_3" not in planned.sql
    assert planned.sourceModels == ["nla_model_3"]
    if sql.startswith("WITH"):
        # The native model is removed, not the caller's meaningful SQL boundary.
        assert sqlglot.parse_one(planned.sql, read=ENGINES[engine]).args.get("with_")


@pytest.mark.parametrize("engine", ENGINES)
def test_count_executes_native_engine_and_returns_short_exact_statement(monkeypatch, engine):
    calls = []
    original = WrenEngine.dry_plan

    def traced(self, sql, properties=None):
        rewritten = original(self, sql, properties)
        calls.append(rewritten)
        return rewritten

    monkeypatch.setattr(WrenEngine, "dry_plan", traced)
    request = payload(engine, CASES[0])
    planned = plan_sql(PlanRequest.model_validate(request))
    assert len(calls) == 1
    assert "WITH" in calls[0].upper()
    assert len(planned.sql) < len(calls[0]) / 3
    assert "WITH" not in planned.sql.upper()
    assert "record_count" in planned.sql


@pytest.mark.parametrize(
    "body",
    [
        "SELECT DISTINCT id FROM physical_table",
        "SELECT id FROM physical_table LIMIT 2",
        "SELECT id FROM physical_table WHERE id > 1",
        "SELECT CAST(id AS VARCHAR) AS id FROM physical_table",
        "SELECT SUM(id) AS id FROM physical_table",
        "SELECT id, ROW_NUMBER() OVER () AS r FROM physical_table",
        "SELECT RANDOM() AS id FROM physical_table",
    ],
)
def test_nonidentity_generated_model_is_never_unsafely_inlined(body):
    ast = sqlglot.parse_one("WITH nla_model_0 AS (" + body + ") SELECT COUNT(*) FROM nla_model_0")
    compacted = compact_generated_models(ast, {"nla_model_0"}, set())
    assert compacted.args.get("with_")
    assert compacted.args["with_"].expressions[0].this == ast.args["with_"].expressions[0].this


def test_caller_cte_with_model_like_name_stays_protected():
    ast = sqlglot.parse_one(
        "WITH nla_model_0 AS (SELECT id FROM physical_table) SELECT id FROM nla_model_0"
    )
    compacted = compact_generated_models(ast, {"nla_model_0"}, {"nla_model_0"})
    assert compacted.args.get("with_")


@pytest.mark.parametrize("engine", ENGINES)
def test_final_physical_columns_match_authorized_case_and_output_aliases(engine):
    request = payload(
        engine,
        'SELECT "Department" AS "GroupLabel", SUM("Salary") AS "MeasureTotal" '
        'FROM public."Employee" GROUP BY "Department" ORDER BY "MeasureTotal" DESC',
    )
    if engine == "SQL_SERVER":
        request["sql"] = (
            request["sql"].replace("[Department]", "[department]").replace("[Salary]", "[salary]")
        )
    planned = plan_sql(PlanRequest.model_validate(request))
    ast = sqlglot.parse_one(planned.sql, read=ENGINES[engine])
    assert ast.named_selects == ["GroupLabel", "MeasureTotal"]
    physical_columns = [column.name for column in ast.find_all(exp.Column) if column.table]
    assert set(physical_columns) == {"Department", "Salary"}
    assert any(column.name == "MeasureTotal" for column in ast.args["order"].find_all(exp.Column))


def test_sql_server_derived_cte_labels_match_exact_qualified_outer_references(database):
    request = payload(
        "SQL_SERVER",
        'WITH summary("GroupLabel", "MeasureTotal") AS ('
        'SELECT "Department", SUM("Salary") FROM public."Employee" GROUP BY "Department") '
        'SELECT summary."GroupLabel", summary."MeasureTotal" FROM summary ORDER BY summary."GroupLabel"',
    )
    planned = plan_sql(PlanRequest.model_validate(request))
    expected = rows(database, request["sql"], "tsql")
    actual = rows(database, planned.sql, "tsql")
    assert actual == expected
    ast = sqlglot.parse_one(planned.sql, read="tsql")
    assert {column.name for column in ast.find_all(exp.Column) if column.table == "summary"} == {
        "GroupLabel",
        "MeasureTotal",
    }
