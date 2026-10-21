"""Select a private model profile without editing the online provider file."""

import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


def profile_environment(root: Path, *, container: bool = False) -> dict[str, str]:
    directory = root / ".local/compose-app"
    selected = directory / "llm-profile"
    profile = selected.read_text().strip() if selected.is_file() else "online"
    if profile not in {"online", "ollama"}:
        raise SystemExit("Local LLM profile must be online or ollama.")
    path = directory / ("ollama.env" if profile == "ollama" else "provider.env")
    values = {}
    if path.is_file():
        for line in path.read_text().splitlines():
            if line and not line.startswith("#"):
                key, value = line.split("=", 1)
                if key.startswith("LLM_"):
                    values[key] = value
    if profile == "ollama":
        values["LLM_PROVIDER_KIND"] = "OLLAMA"
        parsed = urlsplit(values.get("LLM_BASE_URL", ""))
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "localhost", "host.docker.internal"}
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise SystemExit("The Ollama profile requires a local endpoint.")
        if container and parsed.hostname in {"127.0.0.1", "localhost"}:
            values["LLM_BASE_URL"] = urlunsplit(
                ("http", "host.docker.internal:" + str(parsed.port or 11434), parsed.path, "", "")
            )
    return values


def knowledge_environment(root: Path, *, container: bool = False) -> dict[str, str]:
    """Keep vector storage and local embeddings private to the Python service."""
    directory = root / ".local/compose-app"
    selected = directory / "llm-profile"
    local_profile = selected.is_file() and selected.read_text().strip() == "ollama"
    host = "host.docker.internal" if container else "127.0.0.1"
    return {
        "KNOWLEDGE_ENABLED": os.getenv("KNOWLEDGE_ENABLED", str(local_profile).lower()),
        "KNOWLEDGE_ROOT": "/var/lib/nla/knowledge" if container else str(root / ".local/knowledge"),
        "KNOWLEDGE_EMBEDDING_URL": f"http://{host}:11434/v1",
        "KNOWLEDGE_EMBEDDING_MODEL": "embeddinggemma:300m",
    }
