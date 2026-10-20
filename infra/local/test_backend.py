#!/usr/bin/env python3
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
env = dict(os.environ, NLA_INTEGRATION="true", NLA_TESTCONTAINERS="true")
for line in (ROOT / ".local/docker.env").read_text().splitlines():
    if line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v
env["JAVA_HOME"] = os.environ.get(
    "JAVA_HOME", "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
)
raise SystemExit(
    subprocess.call(
        ["mvn", "-q", "-Dapi.version=1.44", "test", *sys.argv[1:]], cwd=ROOT / "backend", env=env
    )
)
