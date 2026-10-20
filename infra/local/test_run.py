"""Local launchers must not distribute warehouse credentials to AI or browser builds."""

import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("local_run", Path(__file__).with_name("run.py"))
RUN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUN)


@pytest.fixture
def configured(tmp_path, monkeypatch):
    monkeypatch.setattr(RUN, "ROOT", tmp_path)
    local = tmp_path / ".local"
    (local / "compose-app").mkdir(parents=True)
    (local / "oidc").mkdir()
    (local / "docker.env").write_text(
        "NLA_PG_ADMIN_PASSWORD=admin-test-value\n"
        "NLA_CHINOOK_PG_PASSWORD=reader-test-value\n"
        "METADATA_PASSWORD=metadata-test-value\n"
        "LOCAL_API_TOKEN=local-test-value\n"
        "PYTHON_AI_TOKEN=service-test-value\n"
        "PYTHON_AI_URL=http://127.0.0.1:8000\n"
        "VITE_API_BASE_URL=/api/v1\n"
    )
    (local / "compose-app" / "provider.env").write_text(
        "LLM_BASE_URL=https://provider.invalid/v1\n"
        "LLM_MODEL=configured-model\n"
        "LLM_API_KEY=private-test-value=with-equals\n"
    )
    (local / "oidc" / "runtime.env").write_text(
        "OIDC_ISSUER_URI=http://127.0.0.1:8180/realms/nla\n"
        "VITE_OIDC_AUTHORITY=http://127.0.0.1:8180/realms/nla\n"
    )
    return local


@pytest.mark.parametrize("service", ["ai", "backend", "frontend"])
def test_private_credentials_are_limited_to_their_consumer(configured, service):
    env = RUN.service_environment(service, "local")
    assert "NLA_PG_ADMIN_PASSWORD" not in env
    if service == "ai":
        assert env["PYTHON_AI_TOKEN"] == "service-test-value"
        assert env["LLM_API_KEY"] == "private-test-value=with-equals"
        assert "NLA_CHINOOK_PG_PASSWORD" not in env
        assert "METADATA_PASSWORD" not in env
        assert "LOCAL_API_TOKEN" not in env
    elif service == "backend":
        assert env["METADATA_PASSWORD"] == "metadata-test-value"
        assert env["NLA_CHINOOK_PG_PASSWORD"] == "reader-test-value"
        assert env["LLM_MODEL"] == "configured-model"
        assert "LLM_API_KEY" not in env
    else:
        assert env["VITE_API_BASE_URL"] == "/api/v1"
        assert not any(key.startswith("LLM_") for key in env)
        assert "PYTHON_AI_TOKEN" not in env
        assert "LOCAL_API_TOKEN" not in env


def test_oidc_host_configuration_keeps_the_same_issuer(configured):
    backend = RUN.service_environment("backend", "oidc")
    frontend = RUN.service_environment("frontend", "oidc")
    assert backend["SPRING_PROFILES_ACTIVE"] == "oidc-local"
    assert backend["OIDC_ISSUER_URI"] == frontend["VITE_OIDC_AUTHORITY"]
    assert frontend["VITE_ALLOW_ANONYMOUS_DEV"] == "false"
    assert "OIDC_ISSUER_URI" not in frontend


def test_provider_is_optional_until_the_owner_supplies_a_key(configured):
    (configured / "compose-app" / "provider.env").unlink()
    assert "LLM_API_KEY" not in RUN.service_environment("ai", "local")


@pytest.mark.parametrize("service", ["ai", "backend", "frontend"])
def test_inherited_application_secrets_obey_the_same_boundary(configured, monkeypatch, service):
    monkeypatch.setenv("NLA_PG_ADMIN_PASSWORD", "exported-admin-test")
    monkeypatch.setenv("METADATA_PASSWORD", "exported-metadata-test")
    monkeypatch.setenv("LLM_API_KEY", "exported-provider-test")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "exported-idp-test")
    monkeypatch.setenv("PATH", "/test/ordinary/path")
    env = RUN.service_environment(service, "local")
    assert env["PATH"] == "/test/ordinary/path"
    assert "NLA_PG_ADMIN_PASSWORD" not in env
    if service == "ai":
        assert "METADATA_PASSWORD" not in env
        assert "OIDC_CLIENT_SECRET" not in env
        assert env["LLM_API_KEY"] == "private-test-value=with-equals"
    elif service == "backend":
        assert "LLM_API_KEY" not in env
    else:
        assert "METADATA_PASSWORD" not in env
        assert "LLM_API_KEY" not in env
        assert "OIDC_CLIENT_SECRET" not in env
