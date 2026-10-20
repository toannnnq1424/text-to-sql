"""Migrate an explicitly selected Linux x86_64 venv to the compat distribution."""

import importlib.metadata
import platform
import subprocess
import sys


def packages_to_remove(system: str, machine: str, installed: set[str]) -> list[str]:
    if system != "Linux" or machine != "x86_64" or "lancedb" not in installed:
        return []
    # Both distributions own the same files. Remove both when an earlier
    # overlapping install exists so the following pinned install is complete.
    return [name for name in ("lancedb", "lancedb-compat") if name in installed]


def prepare():
    if sys.prefix == sys.base_prefix:
        raise RuntimeError("Select an isolated virtual environment; system Python is refused.")
    installed = set()
    for name in ("lancedb", "lancedb-compat"):
        try:
            importlib.metadata.distribution(name)
        except importlib.metadata.PackageNotFoundError:
            continue
        installed.add(name)
    remove = packages_to_remove(platform.system(), platform.machine(), installed)
    if remove:
        subprocess.run([sys.executable, "-m", "pip", "uninstall", "--yes", *remove], check=True)


if __name__ == "__main__":
    prepare()
