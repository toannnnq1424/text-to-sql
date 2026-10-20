"""Repair the pinned compat wheel's distribution-name lookup at install time.

The official compat wheel installs lancedb/ but still asks for metadata belonging
only to the separate standard wheel. Keep exactly one official native binary;
read the actual compat distribution's version instead. No runtime monkeypatch.
"""

import hashlib
import importlib.metadata
from pathlib import Path

VERSION = "0.40.0"
ORIGINAL_SHA256 = "4c82a8bec2c215c6307e3e0b6607d0be4cd7dc1333804bb547ba22e0ae592162"
ORIGINAL = b'__version__ = importlib.metadata.version("lancedb")'
REPLACEMENT = b'__version__ = importlib.metadata.version("lancedb-compat")'


def patched_bytes(contents: bytes) -> bytes:
    restored = contents.replace(REPLACEMENT, ORIGINAL, 1)
    if hashlib.sha256(restored).hexdigest() != ORIGINAL_SHA256:
        raise RuntimeError("Unreviewed LanceDB compat source; refusing to modify it.")
    if contents.count(ORIGINAL) + contents.count(REPLACEMENT) != 1:
        raise RuntimeError("The LanceDB compat metadata lookup is not unique.")
    return contents.replace(ORIGINAL, REPLACEMENT, 1)


def apply():
    try:
        distribution = importlib.metadata.distribution("lancedb-compat")
    except importlib.metadata.PackageNotFoundError:
        return
    if distribution.version != VERSION:
        raise RuntimeError("Unreviewed LanceDB compat release; refusing to modify it.")
    try:
        importlib.metadata.distribution("lancedb")
    except importlib.metadata.PackageNotFoundError:
        pass
    else:
        raise RuntimeError("Install exactly one LanceDB distribution; native files overlap.")
    path = Path(distribution.locate_file("lancedb/__init__.py"))
    before = path.read_bytes()
    after = patched_bytes(before)
    if after != before:
        path.write_bytes(after)


if __name__ == "__main__":
    apply()
