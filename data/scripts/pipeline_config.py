"""Load and validate the checked-in Chinook pipeline definitions."""

import json
import re
from pathlib import Path
from typing import Any

IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
CONFIGS = {
    "pg": "POSTGRESQL",
    "mysql": "MYSQL",
    "mssql": "SQL_SERVER",
}


def validate_config(config: dict[str, Any], engine: str) -> dict[str, Any]:
    """Validate sample pipeline metadata before provisioning writer permissions."""
    required = {
        "sourceId",
        "name",
        "type",
        "engine",
        "warehouseId",
        "datasetId",
        "readSql",
        "stage",
        "mart",
        "columns",
        "requiredColumns",
        "maxStringLengths",
        "maxRows",
        "maxBytes",
        "timeoutSeconds",
        "credentialReference",
    }
    if set(config) != required:
        raise ValueError("Pipeline configuration has missing or unknown fields.")
    if config["engine"] != engine or config["type"] != "REGISTERED_ELT":
        raise ValueError("Pipeline engine or type does not match its registry entry.")
    for key in ("sourceId", "name", "warehouseId", "datasetId"):
        if not isinstance(config[key], str) or not config[key].strip():
            raise ValueError(f"Pipeline field {key} must be a non-empty string.")
    if not isinstance(config["readSql"], str) or not config["readSql"].strip():
        raise ValueError("Pipeline readSql must be a non-empty SELECT candidate.")

    columns = config["columns"]
    if (
        not isinstance(columns, list)
        or not 1 <= len(columns) <= 100
        or any(not isinstance(name, str) or not IDENTIFIER.fullmatch(name) for name in columns)
        or len({name.lower() for name in columns}) != len(columns)
    ):
        raise ValueError("Pipeline output columns must be unique safe identifiers.")
    required_columns = config["requiredColumns"]
    if (
        not isinstance(required_columns, list)
        or any(name not in columns for name in required_columns)
        or len(set(required_columns)) != len(required_columns)
    ):
        raise ValueError("Pipeline requiredColumns must be unique output columns.")
    limits = config["maxStringLengths"]
    if not isinstance(limits, dict) or any(
        name not in columns
        or not isinstance(maximum, int)
        or isinstance(maximum, bool)
        or not 1 <= maximum <= 10000
        for name, maximum in limits.items()
    ):
        raise ValueError("Pipeline maxStringLengths must be bounded output columns.")
    bounds = {
        "maxRows": (1, 10000),
        "maxBytes": (1024, 52428800),
        "timeoutSeconds": (1, 60),
    }
    for key, (minimum, maximum) in bounds.items():
        value = config[key]
        if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
            raise ValueError(f"Pipeline {key} is outside its supported bounds.")

    for target_name in ("stage", "mart"):
        target = config[target_name]
        if (
            not isinstance(target, dict)
            or set(target) != {"schema", "name"}
            or any(
                not isinstance(value, str) or not IDENTIFIER.fullmatch(value)
                for value in target.values()
            )
        ):
            raise ValueError(
                f"Pipeline {target_name} target must use safe schema/table identifiers."
            )
    reference = config["credentialReference"]
    if not isinstance(reference, str) or not re.fullmatch(r"env:[A-Z][A-Z0-9_]{2,100}", reference):
        raise ValueError("Pipeline credentials must use an environment reference.")
    return config


def load_sample_pipeline_configs(root: Path) -> dict[str, dict[str, Any]]:
    """Read the three versioned Chinook examples; never discovers user warehouses here."""
    directory = root / "data" / "chinook"
    loaded = {}
    for suffix, engine in CONFIGS.items():
        path = directory / f"pipeline-{suffix}.json"
        try:
            config = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(f"Cannot load sample pipeline definition {path.name}.") from error
        loaded[engine] = validate_config(config, engine)
    return loaded
