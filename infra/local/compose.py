#!/usr/bin/env python3
"""Build and run the actual Docker application stack with private local configuration."""

import argparse
import importlib.util
import json
import os
import secrets
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from llm_profile import knowledge_environment, profile_environment

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / ".local" / "compose-app"
PUBLIC = ROOT / "infra" / "application.env.example"
API = "http://127.0.0.1:8085/api/v1"
IDP = "http://127.0.0.1:8180"
ISSUER = IDP + "/realms/nla"
ENGINES = (
    ("pg", "POSTGRESQL", "postgres", 5432, "public", "postgresql", "PG"),
    ("mysql", "MYSQL", "mysql", 3306, "nla_chinook", "mysql", "MYSQL"),
    ("mssql", "SQL_SERVER", "sqlserver", 1433, "dbo", "mssql", "MSSQL"),
)


def environment(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise SystemExit(
            f"Missing {path.relative_to(ROOT)}; run the documented provisioning first."
        )
    return {
        key: value
        for line in path.read_text().splitlines()
        if line.strip() and not line.startswith("#")
        for key, value in [line.split("=", 1)]
    }


def private_write(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(path, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write(value)
    path.chmod(0o600)


def write_environment(path: Path, values: dict[str, str]) -> None:
    if any("\n" in str(value) or "\r" in str(value) for value in values.values()):
        raise SystemExit("Deployment environment values must be single-line strings.")
    private_write(path, "".join(f"{key}={value}\n" for key, value in values.items()))


def run_python(script: str, *args: str) -> None:
    subprocess.run([sys.executable, str(ROOT / script), *args], cwd=ROOT, check=True)


def compose(*args: str) -> None:
    subprocess.run(
        [
            "docker",
            "compose",
            "--env-file",
            str(ROOT / ".local" / "compose.env"),
            "--env-file",
            str(LOCAL / "public.env"),
            "-f",
            str(ROOT / "infra" / "compose.databases.yml"),
            "-f",
            str(ROOT / "infra" / "compose.application.yml"),
            *args,
        ],
        cwd=ROOT,
        check=True,
    )


def metadata_database() -> None:
    sys.path.insert(0, str(ROOT / "data" / "scripts"))
    spec = importlib.util.spec_from_file_location(
        "compose_database_provisioner", ROOT / "data" / "scripts" / "docker_chinook.py"
    )
    provisioner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(provisioner)
    exists = provisioner.execute(
        "POSTGRESQL", "SELECT count(*) FROM pg_database WHERE datname='nla_metadata_compose';"
    )
    if int(exists) == 0:
        provisioner.execute("POSTGRESQL", "CREATE DATABASE nla_metadata_compose OWNER nla_app;")
    print("Dedicated Compose metadata database is ready; host registry was preserved.")


def configure() -> None:
    runtime = environment(ROOT / ".local" / "docker.env")
    LOCAL.mkdir(parents=True, exist_ok=True, mode=0o700)
    LOCAL.chmod(0o700)
    if not (LOCAL / "public.env").exists():
        private_write(LOCAL / "public.env", PUBLIC.read_text())
    public = environment(LOCAL / "public.env")
    for key in ("NLA_COMPOSE_API_PORT", "NLA_COMPOSE_WEB_PORT"):
        if not public[key].isdigit() or not 1024 <= int(public[key]) <= 65535:
            raise SystemExit("Compose public ports must be between 1024 and 65535.")
    global API
    API = f"http://127.0.0.1:{int(public['NLA_COMPOSE_API_PORT'])}/api/v1"
    if public["OIDC_ISSUER_URI"] != ISSUER:
        raise SystemExit("Local Compose setup requires the documented loopback IdP issuer.")
    if not (LOCAL / "ai.env").exists():
        write_environment(LOCAL / "ai.env", {"PYTHON_AI_TOKEN": secrets.token_urlsafe(48)})
    ai = environment(LOCAL / "ai.env")
    if len(ai.get("PYTHON_AI_TOKEN", "")) < 32:
        raise SystemExit("Private AI service token is missing or too short.")
    provider = profile_environment(ROOT, container=True)
    for key in (
        "LLM_BASE_URL",
        "LLM_MODEL",
        "LLM_API_KEY",
        "LLM_TIMEOUT_MS",
        "LLM_REASONING_EFFORT",
        "LLM_MAX_OUTPUT_TOKENS",
        "LLM_STRUCTURED_OUTPUT",
    ):
        value = provider.get(key, os.getenv(key, ""))
        if value:
            ai[key] = value
        else:
            ai.pop(key, None)
    configured = [bool(ai.get(key)) for key in ("LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY")]
    if any(configured) and not all(configured):
        raise SystemExit(
            "Configure provider URL, model and key together in the private provider.env."
        )
    ai.update(knowledge_environment(ROOT, container=True))
    write_environment(LOCAL / "ai.env", ai)
    for filename, token_name in (
        ("data-runtime.env", "DATA_TOOL_RUNTIME_TOKEN"),
        ("file-service.env", "FILE_SERVICE_TOKEN"),
    ):
        private_path = LOCAL / filename
        existing = environment(private_path) if private_path.exists() else {}
        private = {token_name: existing.get(token_name, secrets.token_urlsafe(48))}
        if len(private[token_name]) < 32:
            raise SystemExit("Private worker service token is missing or too short.")
        if token_name == "DATA_TOOL_RUNTIME_TOKEN":
            private["WAREHOUSE_ALLOWED_HOSTS"] = "postgres,mysql,sqlserver"
            private["DATA_TOOL_MYSQL_PUBLIC_KEY"] = "/run/nla/mysql-public-key.pem"
        write_environment(private_path, private)
    data_runtime = environment(LOCAL / "data-runtime.env")
    file_service = environment(LOCAL / "file-service.env")
    backend = {
        key: value
        for key, value in runtime.items()
        if key.startswith(("NLA_CHINOOK_", "NLA_IMPORT_", "NLA_PIPELINE_"))
        and key.endswith("_PASSWORD")
    }
    backend.update(
        {
            "METADATA_JDBC_URL": "jdbc:postgresql://postgres:5432/nla_metadata_compose",
            "METADATA_USERNAME": "nla_app",
            "METADATA_PASSWORD": runtime["METADATA_PASSWORD"],
            "SERVER_ADDRESS": "0.0.0.0",
            "SERVER_PORT": "8080",
            "NLA_LOCAL": "false",
            "NLA_WAREHOUSE_TLS": "false",
            "WAREHOUSE_ALLOWED_HOSTS": "postgres,mysql,sqlserver",
            "OIDC_ISSUER_URI": public["OIDC_ISSUER_URI"],
            "OIDC_AUDIENCE": "nla-api",
            "OIDC_JWK_SET_URI": public["OIDC_JWK_SET_URI"],
            "SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI": public["OIDC_ISSUER_URI"],
            "SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_JWK_SET_URI": public["OIDC_JWK_SET_URI"],
            "SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_AUDIENCES": "nla-api",
            "DATA_TOOL_RUNTIME_URL": "http://data-tool-runtime:8090",
            "DATA_TOOL_RUNTIME_TOKEN": data_runtime["DATA_TOOL_RUNTIME_TOKEN"],
            "FILE_SERVICE_URL": "http://file-service:8011",
            "FILE_SERVICE_TOKEN": file_service["FILE_SERVICE_TOKEN"],
            "FILE_UPLOAD_DIRECTORY": "/var/lib/nla/uploads",
            "SPRING_SERVLET_MULTIPART_MAX_FILE_SIZE": "25MB",
            "SPRING_SERVLET_MULTIPART_MAX_REQUEST_SIZE": "27MB",
            "PYTHON_AI_URL": "http://python-ai:8000",
            "PYTHON_AI_TOKEN": ai["PYTHON_AI_TOKEN"],
            "NLA_MYSQL_RSA_PUBLIC_KEY": "/run/nla/mysql-public-key.pem",
        }
    )
    if ai.get("LLM_MODEL"):
        backend["LLM_MODEL"] = ai["LLM_MODEL"]
    write_environment(LOCAL / "backend.env", backend)
    key = runtime.get("NLA_MYSQL_RSA_PUBLIC_KEY")
    if not key or not Path(key).is_file():
        raise SystemExit("MySQL public key is missing; rerun trusted database provisioning.")
    shutil.copyfile(key, LOCAL / "mysql-public-key.pem")
    (LOCAL / "mysql-public-key.pem").chmod(0o644)
    print(
        "Generated private app configuration; no administrative DB credentials enter app containers."
    )


def request(url: str, token=None, body=None, method=None, form=None):
    headers = {"Accept": "application/json"}
    data = None
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    if form is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        data = urllib.parse.urlencode(form).encode()
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, data=data, headers=headers, method=method), timeout=65
        ) as response:
            value = response.read()
            return json.loads(value) if value else None
    except urllib.error.HTTPError as error:
        raise SystemExit(
            f"Deployment API operation failed with HTTP {error.code}; no payload logged."
        ) from None
    except urllib.error.URLError:
        raise SystemExit("Deployment service is unreachable; inspect Compose health.") from None


def service_token() -> str:
    accounts = json.loads((ROOT / ".local" / "oidc" / "accounts.json").read_text())
    admin = request(
        IDP + "/realms/master/protocol/openid-connect/token",
        form={"client_id": "admin-cli", "grant_type": "password", **accounts["admin"]},
    )["access_token"]
    collection = IDP + "/admin/realms/nla/clients"
    web_clients = request(collection + "?clientId=nla-web", token=admin)
    if len(web_clients) != 1 or not web_clients[0].get("publicClient"):
        raise SystemExit("Expected the configured public nla-web OIDC client.")
    web_client = web_clients[0]
    origin = "http://127.0.0.1:" + environment(LOCAL / "public.env")["NLA_COMPOSE_WEB_PORT"]
    for callback in ("callback", "silent-callback"):
        uri = origin + "/auth/" + callback
        if uri not in web_client["redirectUris"]:
            web_client["redirectUris"].append(uri)
    if origin not in web_client["webOrigins"]:
        web_client["webOrigins"].append(origin)
    logout_origins = web_client["attributes"].get("post.logout.redirect.uris", "").split("##")
    if origin not in logout_origins:
        logout_origins.append(origin)
    web_client["attributes"]["post.logout.redirect.uris"] = "##".join(logout_origins)
    request(collection + "/" + web_client["id"], token=admin, body=web_client, method="PUT")
    client_id = "nla-compose-provisioner"
    clients = request(collection + "?clientId=" + client_id, token=admin)
    if not clients:
        realm = json.loads((ROOT / ".local" / "oidc" / "import" / "nla-realm.json").read_text())
        client = realm["clients"][0]
        client.update(
            {
                "clientId": client_id,
                "name": "Local Compose registry administrator",
                "publicClient": False,
                "standardFlowEnabled": False,
                "serviceAccountsEnabled": True,
                "fullScopeAllowed": True,
                "redirectUris": [],
                "webOrigins": [],
                "attributes": {"nla.managed-by": "compose.py"},
                "secret": secrets.token_urlsafe(48),
            }
        )
        request(collection, token=admin, body=client)
        clients = request(collection + "?clientId=" + client_id, token=admin)
    client = clients[0]
    if client.get("attributes", {}).get("nla.managed-by") != "compose.py":
        raise SystemExit("Refusing to reuse an unmanaged IdP provisioning client.")
    resource = collection + "/" + client["id"]
    role = request(IDP + "/admin/realms/nla/roles/ADMIN", token=admin)
    account = request(resource + "/service-account-user", token=admin)
    request(
        IDP + "/admin/realms/nla/users/" + account["id"] + "/role-mappings/realm",
        token=admin,
        body=[role],
    )
    secret = request(resource + "/client-secret", token=admin)["value"]
    private_write(LOCAL / "provisioner.json", json.dumps({"clientId": client_id, "secret": secret}))
    return request(
        ISSUER + "/protocol/openid-connect/token",
        form={"client_id": client_id, "client_secret": secret, "grant_type": "client_credentials"},
    )["access_token"]


def register_samples() -> None:
    token = service_token()
    existing = request(API + "/warehouses?pageSize=100", token=token)["items"]
    datasets = request(API + "/datasets?pageSize=100", token=token)["items"]
    registered = []
    for suffix, engine, host, port, schema, filename, reference in ENGINES:
        matches = [
            warehouse
            for warehouse in existing
            if warehouse.get("engine") == engine
            and warehouse.get("host") == host
            and warehouse.get("database") == "nla_chinook"
        ]
        if len(matches) > 1:
            raise SystemExit("Multiple matching sample registry entries; resolve them in the app.")
        warehouse = (
            matches[0]
            if matches
            else request(
                API + "/warehouses",
                token=token,
                body={
                    "name": "Chinook / " + engine + " / Compose",
                    "engine": engine,
                    "host": host,
                    "port": port,
                    "database": "nla_chinook",
                    "defaultSchema": schema,
                    "username": "nla_reader",
                    "credentialReference": f"env:NLA_CHINOOK_{reference}_PASSWORD",
                    "importUsername": "nla_importer",
                    "importCredentialReference": f"env:NLA_IMPORT_{reference}_PASSWORD",
                    "ingestionUsername": "nla_writer",
                    "ingestionCredentialReference": f"env:NLA_PIPELINE_{reference}_PASSWORD",
                },
            )
        )
        warehouse_id = warehouse["warehouseId"]
        result = request(API + f"/warehouses/{warehouse_id}/test", token=token, body={})
        if not result["reachable"]:
            raise SystemExit(f"Sample {engine} connection test failed.")
        discovery = request(API + f"/warehouses/{warehouse_id}/discover", token=token, body={})
        if discovery["status"] != "SUCCESS":
            raise SystemExit(f"Sample {engine} metadata discovery failed.")
        tables = [
            table
            for discovered in discovery["metadata"]["schemas"]
            if discovered["name"] == schema
            for table in discovered["tables"]
            if not table["name"].startswith("nla_")
        ]
        semantic = json.loads((ROOT / "data" / "chinook" / f"semantic-{filename}.json").read_text())
        dataset_name = "Chinook / " + engine
        found = [
            dataset
            for dataset in datasets
            if dataset["warehouseId"] == warehouse_id and dataset["name"] == dataset_name
        ]
        if len(found) > 1:
            raise SystemExit("Multiple matching sample datasets; resolve them in the app.")
        dataset = (
            found[0]
            if found
            else request(
                API + "/datasets",
                token=token,
                body={
                    "warehouseId": warehouse_id,
                    "name": dataset_name,
                    "description": f"Chinook sample: {len(tables)} discovered tables on {engine}.",
                    "allowedSchemas": [schema],
                    "allowedTables": [
                        {"schema": schema, "name": table["name"]} for table in tables
                    ],
                    "semanticVersion": semantic["semanticVersion"],
                    "schemaVersion": semantic["schemaVersion"],
                },
            )
        )
        dataset_id = dataset["datasetId"]
        request(
            API + f"/datasets/{dataset_id}/semantic-model", token=token, body=semantic, method="PUT"
        )
        registered.append({"engine": engine, "warehouseId": warehouse_id, "datasetId": dataset_id})
    settings = request(API + "/settings", token=token)
    request(
        API + "/settings",
        token=token,
        method="PATCH",
        body={
            "locale": settings["locale"],
            "timezone": settings["timezone"],
            "limits": settings["limits"],
            "defaultQueryMode": (
                "AUTO" if environment(LOCAL / "ai.env").get("LLM_MODEL") else "DETERMINISTIC"
            ),
        },
    )
    private_write(LOCAL / "registry.json", json.dumps(registered, indent=2) + "\n")
    print("Registered three real warehouse connections/datasets through Java API.")


def verify() -> None:
    token = service_token()
    registry = json.loads((LOCAL / "registry.json").read_text())
    report = {"mocked": False, "engines": {}}
    for entry in registry:
        query = request(
            API + "/query",
            token=token,
            body={
                "warehouseId": entry["warehouseId"],
                "datasetId": entry["datasetId"],
                "question": "How many tracks are in the catalog?",
                "mode": "DETERMINISTIC",
            },
        )
        if query.get("status") != "SUCCESS":
            raise SystemExit(f"{entry['engine']} real query verification failed.")
        rows = query.get("result", {}).get("rows", [])
        if len(rows) != 1 or str(rows[0].get("track_count")) != "3503":
            raise SystemExit(f"{entry['engine']} sample integrity result did not match provenance.")
        catalog = request(API + f"/datasets/{entry['datasetId']}/catalog", token=token)
        if catalog.get("tableCount") != 11:
            raise SystemExit(f"{entry['engine']} source table count did not match provenance.")
        report["engines"][entry["engine"]] = {"query": "PASS", "tableCount": 11, "trackCount": 3503}
    if set(report["engines"]) != {"POSTGRESQL", "MYSQL", "SQL_SERVER"}:
        raise SystemExit("Three-engine verification requires all registered samples.")
    private_write(LOCAL / "query-report.json", json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action", choices=("up", "build", "configure", "register", "verify", "status", "stop")
    )
    args = parser.parse_args()
    if args.action == "up":
        for action in ("init", "up", "provision", "provision-import"):
            run_python("data/scripts/docker_chinook.py", action)
        run_python("infra/local/oidc.py", "init")
        run_python("infra/local/oidc.py", "up")
        configure()
        metadata_database()
        compose("up", "-d", "--build", "--wait")
        register_samples()
    elif args.action == "configure":
        configure()
    elif args.action == "build":
        configure()
        compose("build", "backend", "python-ai", "data-tool-runtime", "file-service", "frontend")
    elif args.action == "register":
        configure()
        register_samples()
    elif args.action == "verify":
        configure()
        verify()
    elif args.action == "status":
        compose("ps")
    elif args.action == "stop":
        compose("stop", "frontend", "backend", "python-ai", "data-tool-runtime", "file-service")


if __name__ == "__main__":
    main()
