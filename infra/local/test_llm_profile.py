"""Local model activation cannot rewrite or leak the separate online profile."""

from pathlib import Path

import pytest
from llm_profile import knowledge_environment, profile_environment
from ollama import configure


def directory(tmp_path: Path) -> Path:
    result = tmp_path / ".local/compose-app"
    result.mkdir(parents=True)
    return result


def test_default_online_profile_remains_optional(tmp_path):
    local = directory(tmp_path)
    assert profile_environment(tmp_path) == {}
    online = "LLM_BASE_URL=https://online.invalid/v1\nLLM_MODEL=original\nLLM_API_KEY=unchanged\n"
    (local / "provider.env").write_text(online)
    assert profile_environment(tmp_path)["LLM_MODEL"] == "original"
    assert (local / "provider.env").read_text() == online


def test_local_activation_maps_host_only_for_container_and_preserves_online(tmp_path):
    local = directory(tmp_path)
    online = b"LLM_API_KEY=original-secret\n"
    (local / "provider.env").write_bytes(online)
    (local / "llm-profile").write_text("ollama\n")
    (local / "ollama.env").write_text(
        "LLM_BASE_URL=http://127.0.0.1:11434/v1\nLLM_MODEL=qwen3:4b\n"
        "LLM_API_KEY=ollama\nMETADATA_PASSWORD=must-not-leak\n"
    )
    assert profile_environment(tmp_path)["LLM_BASE_URL"] == "http://127.0.0.1:11434/v1"
    assert (
        profile_environment(tmp_path, container=True)["LLM_BASE_URL"]
        == "http://host.docker.internal:11434/v1"
    )
    assert "METADATA_PASSWORD" not in profile_environment(tmp_path)
    assert knowledge_environment(tmp_path, container=True)["KNOWLEDGE_ENABLED"] == "true"
    assert (local / "provider.env").read_bytes() == online


def test_local_profile_allows_slow_inference_and_keeps_online_profile(tmp_path):
    local = directory(tmp_path)
    online = b"LLM_API_KEY=original-secret\n"
    (local / "provider.env").write_bytes(online)

    configure("qwen3:4b", tmp_path)

    values = dict(
        line.split("=", 1)
        for line in (local / "ollama.env").read_text().splitlines()
        if line and not line.startswith("#")
    )
    assert values["LLM_TIMEOUT_MS"] == "55000"
    assert (local / "provider.env").read_bytes() == online


@pytest.mark.parametrize(
    "url",
    [
        "https://online.invalid/v1",
        "http://127.0.0.1:11434@evil.invalid/v1",
        "file:///tmp/model",
        "http://localhost:11434/v1?redirect=remote",
    ],
)
def test_local_profile_refuses_nonlocal_or_ambiguous_endpoints(tmp_path, url):
    local = directory(tmp_path)
    (local / "llm-profile").write_text("ollama")
    (local / "ollama.env").write_text(f"LLM_BASE_URL={url}\n")
    with pytest.raises(SystemExit, match="local endpoint"):
        profile_environment(tmp_path)


def test_unknown_profile_fails_closed(tmp_path):
    local = directory(tmp_path)
    (local / "llm-profile").write_text("unrecognized")
    with pytest.raises(SystemExit, match="online or ollama"):
        profile_environment(tmp_path)
