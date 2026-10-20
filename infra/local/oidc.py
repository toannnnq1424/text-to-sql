#!/usr/bin/env python3
"""Create a private local IdP realm and operate its isolated Compose project."""

import argparse
import json
import os
import secrets
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / ".local" / "oidc"
ISSUER = "http://127.0.0.1:8180/realms/nla"
CLIENT_ID = "nla-web"
AUDIENCE = "nla-api"
ROLES = ("VIEWER", "ANALYST", "OPERATOR", "ADMIN")
ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173", "http://127.0.0.1:5175")


def private_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(path, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write(content)
    path.chmod(0o600)


def realm(credentials: dict) -> dict:
    """Public PKCE client; passwords and imported realm stay outside Git."""
    return {
        "realm": "nla",
        "displayName": "Natural Language Analytics",
        "enabled": True,
        "sslRequired": "none",
        "registrationAllowed": False,
        "resetPasswordAllowed": False,
        "bruteForceProtected": True,
        "accessTokenLifespan": 120,
        "ssoSessionIdleTimeout": 1800,
        "roles": {"realm": [{"name": role} for role in ROLES]},
        "clients": [
            {
                "clientId": CLIENT_ID,
                "name": "Analytics web application",
                "enabled": True,
                "protocol": "openid-connect",
                "publicClient": True,
                "standardFlowEnabled": True,
                "implicitFlowEnabled": False,
                "directAccessGrantsEnabled": False,
                "serviceAccountsEnabled": False,
                "redirectUris": [
                    f"{origin}/auth/{callback}"
                    for origin in ORIGINS
                    for callback in ("callback", "silent-callback")
                ],
                "webOrigins": list(ORIGINS),
                "attributes": {
                    "pkce.code.challenge.method": "S256",
                    "post.logout.redirect.uris": "##".join(ORIGINS),
                },
                "defaultClientScopes": ["basic", "web-origins", "profile", "email"],
                "protocolMappers": [
                    {
                        "name": "application-roles",
                        "protocol": "openid-connect",
                        "protocolMapper": "oidc-usermodel-realm-role-mapper",
                        "config": {
                            "claim.name": "roles",
                            "jsonType.label": "String",
                            "multivalued": "true",
                            "access.token.claim": "true",
                            "id.token.claim": "true",
                            "userinfo.token.claim": "true",
                        },
                    },
                    {
                        "name": "application-audience",
                        "protocol": "openid-connect",
                        "protocolMapper": "oidc-audience-mapper",
                        "config": {
                            "included.custom.audience": AUDIENCE,
                            "access.token.claim": "true",
                            "id.token.claim": "false",
                        },
                    },
                ],
            }
        ],
        "users": [
            {
                "username": account["username"],
                "firstName": "Local",
                "lastName": role.title(),
                "email": f"{account['username']}@local.invalid",
                "emailVerified": True,
                "enabled": True,
                "realmRoles": [role],
                "credentials": [
                    {"type": "password", "value": account["password"], "temporary": False}
                ],
            }
            for role, account in credentials["users"].items()
        ],
    }


def initialize() -> None:
    credentials_path = CONFIG / "accounts.json"
    CONFIG.mkdir(parents=True, exist_ok=True, mode=0o700)
    CONFIG.chmod(0o700)
    if credentials_path.exists():
        try:
            credentials = json.loads(credentials_path.read_text())
            accounts = [credentials["admin"], *[credentials["users"][role] for role in ROLES]]
            if not all(
                isinstance(account["username"], str)
                and isinstance(account["password"], str)
                and len(account["password"]) >= 32
                for account in accounts
            ):
                raise ValueError("Invalid local account configuration")
        except (ValueError, KeyError, TypeError) as error:
            raise SystemExit(
                "Local IdP accounts are invalid; restore the private accounts file."
            ) from error
        credentials_path.chmod(0o600)
    else:
        credentials = {
            "admin": {"username": "nla-bootstrap", "password": secrets.token_urlsafe(32)},
            "users": {
                role: {"username": f"nla-{role.lower()}", "password": secrets.token_urlsafe(32)}
                for role in ROLES
            },
        }
        private_write(credentials_path, json.dumps(credentials, indent=2) + "\n")
    private_write(CONFIG / "import" / "nla-realm.json", json.dumps(realm(credentials), indent=2))
    private_write(
        CONFIG / "compose.env",
        f"NLA_IDP_ADMIN_USERNAME={credentials['admin']['username']}\n"
        f"NLA_IDP_ADMIN_PASSWORD={credentials['admin']['password']}\n",
    )
    private_write(
        CONFIG / "runtime.env",
        f"OIDC_ISSUER_URI={ISSUER}\n"
        f"OIDC_AUDIENCE={AUDIENCE}\n"
        f"VITE_OIDC_AUTHORITY={ISSUER}\n"
        f"VITE_OIDC_CLIENT_ID={CLIENT_ID}\n"
        "VITE_OIDC_SCOPE=openid profile email\n"
        "VITE_OIDC_ROLE_CLAIM=roles\n",
    )
    print("OIDC configuration ready under .local/oidc/; existing credentials preserved.")


def discovery() -> dict:
    try:
        with urllib.request.urlopen(f"{ISSUER}/.well-known/openid-configuration", timeout=5) as res:
            document = json.load(res)
        if document.get("issuer") != ISSUER:
            raise ValueError("Issuer mismatch")
        return {"status": "UP", "issuer": ISSUER, "clientId": CLIENT_ID, "audience": AUDIENCE}
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise SystemExit("OIDC discovery is not ready or returned an unexpected issuer.") from error


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("init", "up", "stop", "status", "check"))
    args = parser.parse_args()
    if args.action == "init":
        initialize()
        return
    if not (CONFIG / "compose.env").is_file():
        raise SystemExit("Run python3 infra/local/oidc.py init first.")
    if args.action == "check":
        print(json.dumps(discovery()))
        return
    command = [
        "docker",
        "compose",
        "--env-file",
        str(CONFIG / "compose.env"),
        "-f",
        str(ROOT / "infra" / "compose.auth.yml"),
    ]
    command.extend({"up": ["up", "-d", "--wait"], "stop": ["stop"], "status": ["ps"]}[args.action])
    subprocess.run(command, cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
