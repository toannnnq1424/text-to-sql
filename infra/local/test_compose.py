"""Configuration isolation checks; actual containers are verified separately."""

import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "local_compose", Path(__file__).with_name("compose.py")
)
COMPOSE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPOSE)


def configured_files(tmp_path, monkeypatch):
    root = tmp_path / "repository"
    local = root / ".local"
    local.mkdir(parents=True)
    key = local / "mysql-public-key.pem"
    key.write_text("test public RSA key")
    runtime = local / "docker.env"
    runtime.write_text(
        f"NLA_MYSQL_RSA_PUBLIC_KEY={key}\n"
        "NLA_PG_ADMIN_PASSWORD=private-test-admin\n"
        "LOCAL_API_TOKEN=private-test-local-token\n"
        "METADATA_PASSWORD=private-test-metadata\n"
        "NLA_CHINOOK_PG_PASSWORD=private-test-reader\n"
        "NLA_IMPORT_PG_PASSWORD=private-test-import\n"
        "NLA_PIPELINE_PG_PASSWORD=private-test-ingestion\n"
        "PYTHON_AI_TOKEN=old-host-service-token\n"
    )
    monkeypatch.setattr(COMPOSE, "ROOT", root)
    monkeypatch.setattr(COMPOSE, "LOCAL", local / "compose-app")
    monkeypatch.setattr(COMPOSE, "PUBLIC", Path(__file__).parents[1] / "application.env.example")
    for name in ("LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "LLM_TIMEOUT_MS"):
        monkeypatch.delenv(name, raising=False)
    return local / "compose-app"


def test_generated_configuration_separates_ai_readers_and_administrators(tmp_path, monkeypatch):
    local = configured_files(tmp_path, monkeypatch)
    COMPOSE.configure()
    backend = COMPOSE.environment(local / "backend.env")
    ai = COMPOSE.environment(local / "ai.env")
    assert backend["PYTHON_AI_TOKEN"] == ai["PYTHON_AI_TOKEN"]
    assert len(ai["PYTHON_AI_TOKEN"]) >= 32
    assert ai["PYTHON_AI_TOKEN"] != "old-host-service-token"
    assert set(ai) == {"PYTHON_AI_TOKEN"}
    assert "LOCAL_API_TOKEN" not in backend
    assert "NLA_PG_ADMIN_PASSWORD" not in backend
    assert backend["METADATA_JDBC_URL"].endswith("postgres:5432/nla_metadata_compose")
    assert backend["NLA_LOCAL"] == "false"
    assert backend["WAREHOUSE_ALLOWED_HOSTS"] == "postgres,mysql,sqlserver"
    assert backend["OIDC_JWK_SET_URI"].startswith("http://keycloak:8080/")
    for filename in ("backend.env", "ai.env", "public.env"):
        assert (local / filename).stat().st_mode & 0o777 == 0o600
    token = ai["PYTHON_AI_TOKEN"]
    COMPOSE.configure()
    assert COMPOSE.environment(local / "ai.env")["PYTHON_AI_TOKEN"] == token


def test_partial_provider_configuration_is_rejected(tmp_path, monkeypatch):
    configured_files(tmp_path, monkeypatch)
    monkeypatch.setenv("LLM_MODEL", "test-model")
    with pytest.raises(SystemExit, match="Configure provider URL, model and key together"):
        COMPOSE.configure()


def test_public_port_and_multiline_values_fail_closed(tmp_path, monkeypatch):
    local = configured_files(tmp_path, monkeypatch)
    COMPOSE.configure()
    (local / "public.env").write_text("NLA_COMPOSE_API_PORT=80\nNLA_COMPOSE_WEB_PORT=4173\n")
    with pytest.raises(SystemExit, match="public ports"):
        COMPOSE.configure()
    with pytest.raises(SystemExit, match="single-line"):
        COMPOSE.write_environment(local / "forbidden.env", {"VALUE": "first\nsecond"})
