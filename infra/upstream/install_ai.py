#!/usr/bin/env python3
"""Install the app AI dependencies and the repository-owned semantic SDK source."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", type=Path, default=ROOT / "ai-service/.venv/bin/python")
    args = parser.parse_args()
    # Preserve the venv executable path: resolving its symlink selects the base
    # Python and would install packages outside the requested virtual environment.
    python = args.python.absolute()
    if not python.is_file():
        parser.error("Create ai-service/.venv with Python3.11+ first, or pass --python.")
    subprocess.run([str(python), str(ROOT / "ai-service/prepare_memory_runtime.py")], check=True)
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "-r",
            str(ROOT / "ai-service/requirements.txt"),
            "-r",
            str(ROOT / "ai-service/sdk-requirements.txt"),
        ],
        check=True,
    )
    subprocess.run([str(python), str(ROOT / "ai-service/fix_lancedb_compat.py")], check=True)
    subprocess.run([str(python), str(ROOT / "ai-service/check_memory_runtime.py")], check=True)
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--no-deps",
            "--editable",
            str(ROOT / "vendor/upstream/semantic-engine/wren"),
        ],
        check=True,
    )
    subprocess.run([str(python), "-m", "pip", "check"], check=True)


if __name__ == "__main__":
    main()
