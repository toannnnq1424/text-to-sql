"""Optional sample reader secrets; never forwarded to Python or frontend."""

import re
from pathlib import Path


def sample_reader_environment(root: Path) -> dict[str, str]:
    path = root / ".local/sample-readers.env"
    if not path.exists():
        return {}
    result = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"NLA_SAMPLE_[A-Z0-9_]+_PASSWORD", key) or not value:
            raise SystemExit("Invalid private sample reader environment configuration.")
        result[key] = value
    return result
