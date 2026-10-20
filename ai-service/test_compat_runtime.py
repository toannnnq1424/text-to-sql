"""The native compatibility repair must remain exact, narrow and repeatable."""

import importlib.util
from pathlib import Path

import pytest

from fix_lancedb_compat import ORIGINAL, REPLACEMENT, patched_bytes


def source():
    path = Path(importlib.util.find_spec("lancedb").origin)
    return path.read_bytes().replace(REPLACEMENT, ORIGINAL, 1)


def test_pinned_metadata_patch_is_narrow_and_idempotent():
    original = source()
    patched = patched_bytes(original)
    assert patched != original
    assert patched.replace(REPLACEMENT, ORIGINAL, 1) == original
    assert patched_bytes(patched) == patched


def test_pinned_metadata_patch_refuses_unknown_source():
    with pytest.raises(RuntimeError, match="Unreviewed"):
        patched_bytes(source() + b"\n# unknown source alteration")


@pytest.mark.parametrize(
    "system,machine,installed,expected",
    [
        ("Linux", "x86_64", {"lancedb"}, ["lancedb"]),
        ("Linux", "x86_64", {"lancedb", "lancedb-compat"}, ["lancedb", "lancedb-compat"]),
        ("Linux", "x86_64", {"lancedb-compat"}, []),
        ("Linux", "x86_64", set(), []),
        ("Linux", "aarch64", {"lancedb"}, []),
        ("Darwin", "arm64", {"lancedb"}, []),
        ("Windows", "AMD64", {"lancedb"}, []),
    ],
)
def test_distribution_migration_is_specific_and_predictable(system, machine, installed, expected):
    from prepare_memory_runtime import packages_to_remove

    assert packages_to_remove(system, machine, installed) == expected


def test_migration_refuses_system_python_before_any_mutation(monkeypatch):
    import prepare_memory_runtime

    monkeypatch.setattr(prepare_memory_runtime.sys, "prefix", "/system")
    monkeypatch.setattr(prepare_memory_runtime.sys, "base_prefix", "/system")
    monkeypatch.setattr(
        prepare_memory_runtime.subprocess,
        "run",
        lambda *args, **kwargs: pytest.fail("System pip mutation"),
    )
    with pytest.raises(RuntimeError, match="virtual environment"):
        prepare_memory_runtime.prepare()
