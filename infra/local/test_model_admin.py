"""Check key durability/isolation without running any model or exposing secrets."""

import base64
import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "model_admin", Path(__file__).with_name("model_admin.py")
)
ADMIN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADMIN)


def test_generated_key_survives_repeated_configuration_and_is_private(tmp_path, monkeypatch):
    monkeypatch.delenv("NLA_MODEL_MASTER_KEY", raising=False)
    before = ADMIN.encryption_environment(tmp_path)
    assert len(base64.b64decode(before["NLA_MODEL_MASTER_KEY"], validate=True)) == 32
    assert before == ADMIN.encryption_environment(tmp_path)
    path = tmp_path / ".local/model-admin.env"
    assert path.stat().st_mode & 0o777 == 0o600
    assert path.parent.stat().st_mode & 0o777 == 0o700


@pytest.mark.parametrize("value", ["", "not-base64", "YQ==", "AAAA\n"])
def test_bad_external_key_fails_without_overwriting_local_state(tmp_path, monkeypatch, value):
    monkeypatch.setenv("NLA_MODEL_MASTER_KEY", value)
    with pytest.raises(SystemExit, match="exactly32"):
        ADMIN.encryption_environment(tmp_path)
    assert not (tmp_path / ".local/model-admin.env").exists()


def test_external_key_takes_priority_without_writing_another_copy(tmp_path, monkeypatch):
    value = base64.b64encode(bytes(range(32))).decode()
    monkeypatch.setenv("NLA_MODEL_MASTER_KEY", value)
    assert ADMIN.encryption_environment(tmp_path) == {"NLA_MODEL_MASTER_KEY": value}
    assert not (tmp_path / ".local").exists()


def test_corrupt_local_configuration_is_not_silently_regenerated(tmp_path, monkeypatch):
    monkeypatch.delenv("NLA_MODEL_MASTER_KEY", raising=False)
    path = tmp_path / ".local/model-admin.env"
    path.parent.mkdir()
    path.write_text("unexpected=data\n")
    with pytest.raises(SystemExit, match="restore its backup"):
        ADMIN.encryption_environment(tmp_path)
    assert path.read_text() == "unexpected=data\n"
