"""Local-only encryption key provisioning, separate from model and warehouse credentials."""

import base64
import binascii
import os
import secrets
from pathlib import Path

DEFAULT_PROVIDER_HOSTS = ",".join(
    (
        "api.openai.com",
        "api.groq.com",
        "api.deepseek.com",
        "openrouter.ai",
        "generativelanguage.googleapis.com",
        "api.mistral.ai",
        "api.together.xyz",
        "api.fireworks.ai",
        "localhost",
        "127.0.0.1",
        "::1",
        "host.docker.internal",
    )
)


def provider_host_environment():
    return {
        "NLA_MODEL_PROVIDER_HOSTS": os.getenv("NLA_MODEL_PROVIDER_HOSTS", DEFAULT_PROVIDER_HOSTS)
    }


def encryption_environment(root: Path):
    """Only the Java process receives this key; preserve it across restarts/backups."""
    value = os.getenv("NLA_MODEL_MASTER_KEY")
    if value is None:
        directory = root / ".local"
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = directory / "model-admin.env"
        if not path.exists():
            try:
                descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                pass
            else:
                encoded = base64.b64encode(secrets.token_bytes(32)).decode()
                with os.fdopen(descriptor, "w") as output:
                    output.write("NLA_MODEL_MASTER_KEY=" + encoded + "\n")
        path.chmod(0o600)
        lines = path.read_text().splitlines()
        if len(lines) != 1 or not lines[0].startswith("NLA_MODEL_MASTER_KEY="):
            raise SystemExit("Invalid local model encryption configuration; restore its backup.")
        value = lines[0].split("=", 1)[1]
    try:
        decoded = base64.b64decode(value, validate=True)
        if len(decoded) != 32:
            raise ValueError()
    except (ValueError, binascii.Error):
        raise SystemExit(
            "Model encryption master key must encode exactly32 random bytes."
        ) from None
    return {"NLA_MODEL_MASTER_KEY": value}
