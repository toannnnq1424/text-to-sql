"""Tests for source-controlled Chinook pipeline definitions."""

from copy import deepcopy
from pathlib import Path

import pytest

from pipeline_config import load_sample_pipeline_configs, validate_config

ROOT = Path(__file__).resolve().parents[2]


def test_three_engine_sample_configs_are_valid_and_equivalent():
    configs = load_sample_pipeline_configs(ROOT)

    assert set(configs) == {"POSTGRESQL", "MYSQL", "SQL_SERVER"}
    assert {tuple(config["columns"]) for config in configs.values()} == {("country", "total")}
    assert {config["maxRows"] for config in configs.values()} == {1000}
    assert {tuple(config["requiredColumns"]) for config in configs.values()} == {
        ("country", "total")
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("columns", ["country", "country"]),
        ("columns", ["country); DROP TABLE invoice;--"]),
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
