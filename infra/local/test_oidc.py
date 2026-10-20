"""Security properties of the generated local realm and credential files."""

import importlib.util
import json
import stat
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("local_oidc", Path(__file__).with_name("oidc.py"))
OIDC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OIDC)


def test_realm_requires_pkce_and_disables_password_and_implicit_grants():
    accounts = {
        "users": {
            role: {"username": role.lower(), "password": "ephemeral-test-value"}
            for role in OIDC.ROLES
        }
    }
    document = OIDC.realm(accounts)
    client = document["clients"][0]
    assert client["publicClient"]
    assert client["standardFlowEnabled"]
    assert client["attributes"]["pkce.code.challenge.method"] == "S256"
    assert not client["directAccessGrantsEnabled"]
    assert not client["implicitFlowEnabled"]
    assert not client["serviceAccountsEnabled"]
    assert not document["registrationAllowed"]
    assert all("*" not in redirect for redirect in client["redirectUris"])
    assert {user["realmRoles"][0] for user in document["users"]} == set(OIDC.ROLES)


def test_access_and_id_token_role_claims_share_contract():
    client = OIDC.realm({"users": {}})["clients"][0]
    mappers = {mapper["name"]: mapper["config"] for mapper in client["protocolMappers"]}
    assert mappers["application-roles"]["claim.name"] == "roles"
    assert mappers["application-roles"]["multivalued"] == "true"
    assert mappers["application-roles"]["access.token.claim"] == "true"
    assert mappers["application-roles"]["id.token.claim"] == "true"
    assert mappers["application-audience"]["included.custom.audience"] == "nla-api"
    assert mappers["application-audience"]["id.token.claim"] == "false"


def test_initialize_preserves_credentials_and_private_modes(tmp_path, monkeypatch):
    configuration = tmp_path / "oidc"
    monkeypatch.setattr(OIDC, "CONFIG", configuration)
    OIDC.initialize()
    accounts = (configuration / "accounts.json").read_text()
    decoded = json.loads(accounts)
    passwords = [decoded["admin"]["password"]]
    passwords.extend(account["password"] for account in decoded["users"].values())
    assert len(set(passwords)) == 5
    assert all(len(password) >= 32 for password in passwords)
    runtime = (configuration / "runtime.env").read_text()
    assert all(password not in runtime for password in passwords)
    for file in configuration.rglob("*"):
        if file.is_file():
            assert stat.S_IMODE(file.stat().st_mode) == 0o600
    OIDC.initialize()
    assert (configuration / "accounts.json").read_text() == accounts
