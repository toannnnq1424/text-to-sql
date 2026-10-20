"""Tests for source-controlled Chinook pipeline definitions."""

from copy import deepcopy
from pathlib import Path

import pytest

from pipeline_config import load_sample_pipeline_configs, validate_config
from provision_pipeline import table_statement

ROOT = Path(__file__).resolve().parents[2]


def test_three_engine_sample_configs_are_valid_and_equivalent():
    configs = load_sample_pipeline_configs(ROOT)

    assert set(configs) == {"POSTGRESQL", "MYSQL", "SQL_SERVER"}
    assert {tuple(config["columns"]) for config in configs.values()} == {("country", "total")}
    assert {config["maxRows"] for config in configs.values()} == {1000}
    assert {tuple(config["requiredColumns"]) for config in configs.values()} == {
        ("country", "total")
    }
    assert {tuple(config["columnTypes"].items()) for config in configs.values()} == {
        (("country", "STRING"), ("total", "DECIMAL"))
    }
    assert all(
        config["sourceWarehouseId"] == config["warehouseId"]
        and config["sourceDatasetId"] == config["datasetId"]
        for config in configs.values()
    )


def test_pipeline_configuration_is_not_bound_to_the_chinook_sample():
    config = deepcopy(load_sample_pipeline_configs(ROOT)["POSTGRESQL"])
    config.update(
        {
            "sourceId": "market-price-daily-mart",
            "name": "Daily market prices",
            "warehouseId": "wh-analytics-target",
            "datasetId": "ds-market-mart",
            "sourceWarehouseId": "wh-market-source",
            "sourceDatasetId": "ds-market-price",
            "readSql": "SELECT observed_at, average_price FROM market.daily_prices",
            "sourceObjects": [{"schema": "market", "name": "daily_prices"}],
            "stage": {"schema": "analytics", "name": "stg_daily_prices"},
            "mart": {"schema": "analytics", "name": "daily_prices"},
            "columns": ["observed_at", "average_price"],
            "columnTypes": {"observed_at": "TIMESTAMP", "average_price": "DECIMAL"},
            "requiredColumns": ["observed_at", "average_price"],
            "maxStringLengths": {},
        }
    )

    validated = validate_config(config, "POSTGRESQL")

    assert validated["sourceDatasetId"] == "ds-market-price"
    assert validated["datasetId"] == "ds-market-mart"
    assert validated["columns"] == ["observed_at", "average_price"]


@pytest.mark.parametrize(
    ("engine", "expected_types"),
    [
        (
            "POSTGRESQL",
            [
                '"label" varchar(100) NOT NULL',
                '"count_value" bigint NOT NULL',
                '"amount" decimal(38,10) NOT NULL',
                '"enabled" boolean NOT NULL',
                '"as_of" date NOT NULL',
                '"observed_at" timestamp NOT NULL',
            ],
        ),
        (
            "MYSQL",
            [
                "`label` varchar(100) NOT NULL",
                "`count_value` bigint NOT NULL",
                "`amount` decimal(38,10) NOT NULL",
                "`enabled` boolean NOT NULL",
                "`as_of` date NOT NULL",
                "`observed_at` datetime(6) NOT NULL",
            ],
        ),
        (
            "SQL_SERVER",
            [
                "[label] nvarchar(100) NOT NULL",
                "[count_value] bigint NOT NULL",
                "[amount] decimal(38,10) NOT NULL",
                "[enabled] bit NOT NULL",
                "[as_of] date NOT NULL",
                "[observed_at] datetime2(7) NOT NULL",
            ],
        ),
    ],
)
def test_pipeline_schema_maps_all_logical_types_for_each_engine(engine, expected_types):
    config = load_sample_pipeline_configs(ROOT)[engine]
    config["columns"] = ["label", "count_value", "amount", "enabled", "as_of", "observed_at"]
    config["columnTypes"] = {
        "label": "STRING",
        "count_value": "INTEGER",
        "amount": "DECIMAL",
        "enabled": "BOOLEAN",
        "as_of": "DATE",
        "observed_at": "TIMESTAMP",
    }
    config["requiredColumns"] = list(config["columns"])
    config["maxStringLengths"] = {"label": 100}
    sql = table_statement(engine, config["stage"], config)

    assert all(expected_type in sql for expected_type in expected_types)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("columns", ["country", "country"]),
        ("columns", ["country); DROP TABLE invoice;--"]),
        ("columnTypes", {"country": "STRING"}),
        ("columnTypes", {"country": "VARCHAR(100)", "total": "DECIMAL"}),
        ("sourceWarehouseId", " "),
        ("sourceObjects", [{"schema": "dbo", "name": "invoice; DROP TABLE"}]),
        ("requiredColumns", ["not_selected"]),
        ("maxRows", 10001),
        ("timeoutSeconds", True),
        ("credentialReference", "postgres://user:secret@example/db"),
    ],
)
def test_rejects_unsafe_or_inconsistent_pipeline_configuration(field, value):
    config = deepcopy(load_sample_pipeline_configs(ROOT)["POSTGRESQL"])
    config[field] = value

    with pytest.raises(ValueError):
        validate_config(config, "POSTGRESQL")
