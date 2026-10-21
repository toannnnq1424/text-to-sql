"""Validated, request-scoped generation configuration. Embeddings use separate settings."""

import hashlib
import ipaddress
import json
import os
import re
import unicodedata
from contextlib import contextmanager
from contextvars import ContextVar
from urllib.parse import urlsplit, urlunsplit

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    ValidationError,
    ValidationInfo,
    field_validator,
    model_validator,
)

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "host.docker.internal"})
DEFAULT_HOSTS = LOCAL_HOSTS | frozenset(
    {
        "api.openai.com",
        "api.groq.com",
        "api.mistral.ai",
        "openrouter.ai",
        "api.deepseek.com",
        "generativelanguage.googleapis.com",
        "api.together.xyz",
        "api.fireworks.ai",
    }
)


def has_control(value: str) -> bool:
    return any(unicodedata.category(char).startswith("C") for char in value)


def configured_hosts() -> frozenset[str]:
    """Deployment entries are exact hostnames/IPs, never URL prefixes or wildcards."""
    hosts = frozenset(
        value.strip().lower() for value in os.getenv("NLA_MODEL_PROVIDER_HOSTS", "").split(",")
    ) - {""}
    if any(
        has_control(host)
        or any(char in host for char in "/@?#%*\\")
        or host.startswith(".")
        or host.endswith(".")
        or (":" in host and not is_ipv6(host))
        for host in hosts
    ):
        raise ValueError("Invalid provider host policy")
    return hosts


def is_ipv6(host: str) -> bool:
    try:
        return isinstance(ipaddress.ip_address(host), ipaddress.IPv6Address)
    except ValueError:
        return False


def private_host(host: str) -> bool:
    if host in LOCAL_HOSTS or host.endswith((".local", ".internal")):
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    if address.is_link_local or address.is_unspecified or address.is_multicast:
        return False
    return address.is_loopback or any(
        address in network
        for network in (
            ipaddress.ip_network("10.0.0.0/8"),
            ipaddress.ip_network("172.16.0.0/12"),
            ipaddress.ip_network("192.168.0.0/16"),
            ipaddress.ip_network("fc00::/7"),
        )
        if address.version == network.version
    )


def forbidden_literal(host: str) -> bool:
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return address.is_link_local or address.is_unspecified or address.is_multicast


def normalized_base(value: str) -> str:
    if has_control(value) or any(char.isspace() for char in value):
        raise ValueError("Invalid provider URL")
    if any(char in value for char in "\\%"):
        raise ValueError("Invalid provider URL")
    try:
        parts = urlsplit(value)
        host = parts.hostname
        port = parts.port
    except ValueError:
        raise ValueError("Invalid provider URL") from None
    if (
        parts.scheme not in {"https", "http"}
        or not host
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
        or "?" in value
        or "#" in value
        or host.endswith(".")
        or (port is not None and not 1 <= port <= 65535)
        or "//" in parts.path
        or not re.fullmatch(r"(?:/[A-Za-z0-9._~\-]+)*/?", parts.path)
        or any(segment in {".", ".."} for segment in parts.path.split("/"))
    ):
        raise ValueError("Invalid provider URL")
    try:
        host = host.encode("idna").decode("ascii").lower()
    except UnicodeError:
        raise ValueError("Invalid provider URL") from None
    if not is_ipv6(host) and not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", host):
        raise ValueError("Invalid provider URL")
    authority = f"[{host}]" if is_ipv6(host) else host
    if port is not None:
        authority += f":{port}"
    return urlunsplit((parts.scheme, authority, parts.path.rstrip("/"), "", ""))


def valid_model_name(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,199}", value
    ):
        raise ValueError("Invalid provider model")
    return value


def contains_secret(value, secret: str | None) -> bool:
    """Reject accidental provider echoes without substituting a modified SQL answer."""
    if secret is None or len(secret) < 8:
        return False
    if isinstance(value, str):
        return secret in value
    if isinstance(value, dict):
        return any(
            contains_secret(key, secret) or contains_secret(item, secret)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(contains_secret(item, secret) for item in value)
    return False


class ModelConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    kind: str = Field(pattern=r"^(ONLINE|OLLAMA)$")
    baseUrl: str = Field(min_length=1, max_length=2048)
    model: str = Field(min_length=1, max_length=200)
    apiKey: SecretStr | None = Field(default=None, repr=False)
    structuredOutput: bool

    @field_validator("baseUrl")
    @classmethod
    def valid_base(cls, value: str) -> str:
        return normalized_base(value)

    @field_validator("model")
    @classmethod
    def valid_model(cls, value: str) -> str:
        return valid_model_name(value)

    @field_validator("apiKey")
    @classmethod
    def valid_key(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None:
            raw = value.get_secret_value()
            if not raw or len(raw) > 8192 or has_control(raw) or any(c.isspace() for c in raw):
                raise ValueError("Invalid provider key")
        return value

    @model_validator(mode="after")
    def endpoint_policy(self, info: ValidationInfo):
        parts = urlsplit(self.baseUrl)
        host = parts.hostname
        explicit = configured_hosts()
        allowed = DEFAULT_HOSTS | explicit
        # Environment settings were selected by the deployer. Their destination
        # is trusted only here, never implicitly added to application overrides.
        environment = bool(info.context and info.context.get("environment"))
        if forbidden_literal(host):
            raise ValueError("Provider destination is not permitted")
        if (
            not environment
            and host not in allowed
            and not (self.kind == "OLLAMA" and host in LOCAL_HOSTS)
        ):
            raise ValueError("Provider host is not allowed")
        if self.kind == "OLLAMA" and not private_host(host):
            raise ValueError("Ollama profile requires a private endpoint")
        if parts.scheme == "http":
            if not private_host(host):
                raise ValueError("Provider requires HTTPS")
            if self.kind == "ONLINE" and not environment and host not in explicit:
                raise ValueError("Online HTTP endpoint requires explicit deployment permission")
        if self.apiKey is not None:
            secret = self.apiKey.get_secret_value()
            if len(secret) >= 8 and (secret in self.baseUrl or secret in self.model):
                raise ValueError("Provider key must not be included in public metadata")
        return self


_current: ContextVar[ModelConfig | None] = ContextVar("generation_model_config", default=None)


@contextmanager
def provider_scope(config: ModelConfig | None):
    token = _current.set(config)
    try:
        yield
    finally:
        _current.reset(token)


def provider_model() -> str:
    selected = _current.get()
    return selected.model if selected is not None else os.getenv("LLM_MODEL", "")


def structured_output() -> bool:
    selected = _current.get()
    return (
        selected.structuredOutput
        if selected is not None
        else os.getenv("LLM_STRUCTURED_OUTPUT", "false").lower() == "true"
    )


def environment_config() -> ModelConfig:
    base = os.getenv("LLM_BASE_URL", "")
    parts = urlsplit(normalized_base(base))
    kind = os.getenv("LLM_PROVIDER_KIND", "") or (
        "OLLAMA" if parts.hostname in LOCAL_HOSTS and parts.port == 11434 else "ONLINE"
    )
    return ModelConfig.model_validate(
        {
            "kind": kind,
            "baseUrl": base,
            "model": os.getenv("LLM_MODEL", ""),
            "apiKey": os.getenv("LLM_API_KEY", "") or None,
            "structuredOutput": os.getenv("LLM_STRUCTURED_OUTPUT", "false").lower() == "true",
        },
        context={"environment": True},
    )


def effective_provider() -> ModelConfig:
    selected = _current.get()
    config = selected if selected is not None else environment_config()
    if config.kind == "ONLINE" and config.apiKey is None:
        raise ValueError("Online provider is not configured")
    return config


def environment_summary() -> dict | None:
    try:
        config = environment_config()
    except (ValueError, ValidationError):
        return None
    safe = {
        "kind": config.kind,
        "baseUrl": config.baseUrl,
        "model": config.model,
        "hasApiKey": config.apiKey is not None,
        "structuredOutput": config.structuredOutput,
    }
    revision = hashlib.sha256(
        json.dumps(safe, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "providerId": "environment",
        "revision": revision,
        "name": "Môi trường triển khai",
        "kind": config.kind,
        "baseUrl": config.baseUrl,
        "model": config.model,
        "hasApiKey": config.apiKey is not None,
        "enabled": True,
        "configured": config.kind == "OLLAMA" or config.apiKey is not None,
        "source": "ENVIRONMENT",
        "readOnly": True,
        "updatedAt": None,
    }
