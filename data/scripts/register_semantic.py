#!/usr/bin/env python3
"""Update registered Chinook semantic metadata through the authenticated Java API."""

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
values = dict(line.split("=", 1) for line in (ROOT / ".local/docker.env").read_text().splitlines())
for suffix, file in [("pg", "postgresql"), ("mysql", "mysql"), ("mssql", "mssql")]:
    payload = (ROOT / f"data/chinook/semantic-{file}.json").read_bytes()
    request = urllib.request.Request(
        f"http://127.0.0.1:8080/api/v1/datasets/ds-chinook-{suffix}/semantic-model",
        data=payload,
        method="PUT",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + values["LOCAL_API_TOKEN"],
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        doc = json.load(response)
    print(doc["datasetId"], doc["status"], doc["semanticVersion"])
