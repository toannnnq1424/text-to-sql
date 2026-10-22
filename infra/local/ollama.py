#!/usr/bin/env python3
"""Activate a local Ollama profile while preserving the online provider configuration."""

import argparse
import hashlib
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / ".local/compose-app"


def private_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    path.write_text(text)


def configure(model: str, root: Path = ROOT) -> None:
    if (
        not model
        or len(model) > 100
        or any(
            char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:._-/"
            for char in model
        )
    ):
        raise SystemExit("Use an Ollama model identifier, not a URL or shell command.")
    directory = root / ".local/compose-app"
    online = directory / "provider.env"
    before = hashlib.sha256(online.read_bytes()).hexdigest() if online.exists() else None
    private_write(
        directory / "ollama.env",
        "\n".join(
            [
                "LLM_BASE_URL=http://127.0.0.1:11434/v1",
                "LLM_MODEL=" + model,
                "LLM_API_KEY=ollama",
                "LLM_TIMEOUT_MS=55000",
                "LLM_REASONING_EFFORT=none",
                "LLM_MAX_OUTPUT_TOKENS=1536",
                "LLM_STRUCTURED_OUTPUT=true",
                "",
            ]
        ),
    )
    private_write(directory / "llm-profile", "ollama\n")
    after = hashlib.sha256(online.read_bytes()).hexdigest() if online.exists() else None
    if before != after:
        raise SystemExit("Online profile changed unexpectedly; inspect it before continuing.")
    print(
        "Local profile selected. Online provider configuration was preserved. Recreate Python/backend containers to apply it."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("setup", "activate", "online"))
    parser.add_argument("--model", default="qwen3:4b")
    args = parser.parse_args()
    if args.action == "online":
        private_write(LOCAL / "llm-profile", "online\n")
        print("Online profile selected; no provider request was sent.")
        return
    if args.action == "setup":
        executable = shutil.which("ollama")
        if not executable:
            if not shutil.which("brew"):
                raise SystemExit(
                    "Install Ollama from https://ollama.com/download, then rerun setup."
                )
            subprocess.run(["brew", "install", "ollama"], check=True)
        if shutil.which("brew"):
            subprocess.run(["brew", "services", "start", "ollama"], check=True)
        for model in (args.model, "embeddinggemma:300m"):
            subprocess.run(["ollama", "pull", model], check=True)
    configure(args.model)


if __name__ == "__main__":
    main()
