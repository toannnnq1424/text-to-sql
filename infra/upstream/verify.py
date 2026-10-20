#!/usr/bin/env python3
"""Verify imported sources and the exact reviewed integration patches."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INVENTORY = ROOT / "docs/integrations/full-source-inventory.json"
PATCHES = ROOT / "docs/integrations/full-source-patches.json"


def verify() -> dict:
    inventory = json.loads(INVENTORY.read_text())
    patches = json.loads(PATCHES.read_text())["patches"]
    expected_patches = {patch["path"]: patch for patch in patches}
    seen = set()
    reports = []
    for project in inventory["projects"]:
        directory = ROOT / project["destination"]
        for item in project["files"]:
            path = directory / item["path"]
            relative = path.relative_to(ROOT).as_posix()
            if item.get("type") == "symlink":
                if not path.is_symlink() or path.readlink().as_posix() != item["target"]:
                    raise ValueError(f"Imported symlink differs: {relative}")
                # Imported links are references only; never stage external contents.
                continue
            data = path.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            patch = expected_patches.get(relative)
            if patch:
                if patch["upstreamSha256"] != item["sha256"] or patch["runtimeSha256"] != digest:
                    raise ValueError(f"Reviewed patch differs: {relative}")
                seen.add(relative)
            elif item["sha256"] != digest:
                raise ValueError(f"Unreviewed source modification: {relative}")
        reports.append(
            {
                "source": project["role"],
                "entries": len(project["files"]),
                "codeLines": project["codeLines"],
                "status": "PASS",
            }
        )
    if seen != set(expected_patches):
        for relative in set(expected_patches) - seen:
            patch = expected_patches[relative]
            if patch.get("kind") != "added" or patch.get("upstreamSha256") is not None:
                raise ValueError("A modified-source patch has no original snapshot entry.")
            path = ROOT / relative
            if hashlib.sha256(path.read_bytes()).hexdigest() != patch["runtimeSha256"]:
                raise ValueError(f"Project fork extension differs: {relative}")
            seen.add(relative)
    return {"projects": reports, "patches": len(seen), "status": "PASS"}


if __name__ == "__main__":
    print(json.dumps(verify()))
