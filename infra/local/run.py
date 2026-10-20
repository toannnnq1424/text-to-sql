#!/usr/bin/env python3
"""Launch a local service with ignored credentials loaded into its environment."""

import argparse
import os
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]


def load_environment(path: Path, target: dict[str, str]) -> None:
    if not path.is_file():
        raise SystemExit(f"Missing {path.relative_to(ROOT)}; follow README Quick Start first.")
    for line in path.read_text().splitlines():
        if line and not line.startswith("#"):
            key, value = line.split("=", 1)
            target[key] = value


def launch() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("service", choices=("backend", "ai", "frontend"))
    parser.add_argument("--auth", choices=("local", "oidc"), default="local")
    parser.add_argument("--port", type=int)
    parser.add_argument("--api-url", help="Loopback Java URL used by the frontend Vite proxy")
    args = parser.parse_args()
    if args.port is not None and not 1024 <= args.port <= 65535:
        parser.error("--port must be between 1024 and 65535.")
    if args.api_url:
        parsed = urlparse(args.api_url)
        if parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1"):
            parser.error("--api-url must be a loopback HTTP URL.")
    env = dict(os.environ)
    load_environment(ROOT / ".local" / "docker.env", env)
    if args.auth == "oidc":
        load_environment(ROOT / ".local" / "oidc" / "runtime.env", env)
        env["SPRING_PROFILES_ACTIVE"] = "oidc-local"
        env["VITE_LOCAL_AUTH"] = "false"
        env["VITE_ALLOW_ANONYMOUS_DEV"] = "false"
    elif args.service == "frontend":
        env["VITE_LOCAL_AUTH"] = "true"
        env["VITE_ALLOW_ANONYMOUS_DEV"] = "true"
    if args.service == "backend":
        jdk = Path("/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home")
        if jdk.exists():
            env["JAVA_HOME"] = str(jdk)
        if args.port is not None:
            env["SERVER_PORT"] = str(args.port)
        command = ["mvn", "-q", "spring-boot:run"]
        directory = ROOT / "backend"
    elif args.service == "ai":
        command = [
            str(ROOT / "ai-service" / ".venv" / "bin" / "python"),
            "-m",
            "uvicorn",
            "app:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(args.port or 8000),
            "--no-access-log",
        ]
        directory = ROOT / "ai-service"
    else:
        command = ["npm", "run", "dev"]
        if args.port is not None:
            command.extend(["--", "--port", str(args.port)])
        if args.api_url:
            env["API_PROXY_TARGET"] = args.api_url
        directory = ROOT / "frontend"
    os.chdir(directory)
    os.execvpe(command[0], command, env)


if __name__ == "__main__":
    launch()
