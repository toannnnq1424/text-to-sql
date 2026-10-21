"""Private configuration protocol tests. Transport doubles never call an online model."""

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import Input, app
from model_provider import ModelConfig, provider_model, provider_scope, structured_output
from test_app import headers as fixture_headers
from test_app import payload as fixture_payload
from test_candidate_validation import answer, request_body
from test_semantic_assist import envelope as assist_envelope
from test_semantic_assist import proposal

TOKEN = "model-configuration-private-service-token-at-least-32-characters"
SECRET = "distinct-private-profile-key-do-not-echo"
VALID_SQL = (
    "SELECT station, AVG(temperature) AS average_temperature "
    "FROM analytics.observations GROUP BY station"
)


def config(**changes):
    return {
        "kind": "OLLAMA",
        "baseUrl": "http://localhost:11434/v1",
        "model": "profile-model:4b",
        "structuredOutput": True,
        **changes,
    }


def headers(correlation="aggregate-repair", mode="API"):
    return {
        "Authorization": "Bearer " + TOKEN,
        "X-Correlation-ID": correlation,
        "X-Execution-Mode": mode,
    }


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PYTHON_AI_TOKEN", TOKEN)
    monkeypatch.setenv("LLM_BASE_URL", "https://legacy-environment.example.test/v1")
    monkeypatch.setenv("LLM_MODEL", "environment-model")
    monkeypatch.setenv("LLM_API_KEY", "environment-private-secret")
    monkeypatch.setenv("LLM_STRUCTURED_OUTPUT", "false")
    monkeypatch.setenv("KNOWLEDGE_ENABLED", "false")
    monkeypatch.delenv("LLM_PROVIDER_KIND", raising=False)
    monkeypatch.delenv("NLA_MODEL_PROVIDER_HOSTS", raising=False)
    with TestClient(app) as value:
        yield value
    if hasattr(app.state, "provider_transport"):
        delattr(app.state, "provider_transport")


def post(client, selected=None, mode="API"):
    body = request_body()
    if selected is not None:
        body["modelConfig"] = selected
    return client.post("/internal/v1/text-to-sql", json=body, headers=headers(mode=mode))


def status(client, body=None, supplied_headers=None):
    return client.post(
        "/internal/v1/model-provider/status",
        json=body if body is not None else {"correlationId": "provider-status"},
        headers=supplied_headers if supplied_headers is not None else headers("provider-status"),
    )


def test_environment_status_is_safe_stable_and_never_calls_provider(client, monkeypatch, caplog):
    def forbidden(_request):
        pytest.fail("Status must not call a model")

    app.state.provider_transport = httpx.MockTransport(forbidden)
    response = status(client)
    assert response.status_code == 200
    summary = response.json()["provider"]
    assert summary["providerId"] == "environment"
    assert summary["kind"] == "ONLINE" and summary["configured"] is True
    assert summary["hasApiKey"] is True and summary["readOnly"] is True
    assert summary["source"] == "ENVIRONMENT" and summary["updatedAt"] is None
    assert len(summary["revision"]) == 64
    assert set(summary) == {
        "providerId",
        "revision",
        "name",
        "kind",
        "baseUrl",
        "model",
        "hasApiKey",
        "enabled",
        "configured",
        "source",
        "readOnly",
        "updatedAt",
    }
    monkeypatch.setenv("LLM_API_KEY", "rotated-environment-secret")
    assert status(client).json()["provider"]["revision"] == summary["revision"]
    monkeypatch.delenv("LLM_API_KEY")
    missing = status(client).json()["provider"]
    assert missing["configured"] is False and missing["hasApiKey"] is False
    assert missing["revision"] != summary["revision"]
    assert "environment-private-secret" not in response.text + caplog.text


def test_status_infers_ollama_and_handles_absent_or_unsafe_environment(client, monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "http://host.docker.internal:11434/v1")
    monkeypatch.delenv("LLM_API_KEY")
    assert status(client).json()["provider"]["kind"] == "OLLAMA"
    assert status(client).json()["provider"]["configured"] is True
    monkeypatch.setenv("LLM_PROVIDER_KIND", "ONLINE")
    assert status(client).json()["provider"]["configured"] is False
    monkeypatch.setenv("LLM_BASE_URL", "https://user:private-secret@llm.example.test/v1")
    response = status(client)
    assert response.json() == {"provider": None} and "private-secret" not in response.text
    monkeypatch.delenv("LLM_BASE_URL")
    assert status(client).json() == {"provider": None}


@pytest.mark.parametrize(
    "body,supplied_headers,expected",
    [
        ({"correlationId": "provider-status"}, {}, 401),
        ({"correlationId": "different"}, headers("provider-status"), 400),
        ({"correlationId": "provider-status", "apiKey": SECRET}, headers("provider-status"), 422),
        ({"correlationId": ""}, headers(""), 422),
    ],
)
def test_status_auth_correlation_and_strict_body(client, body, supplied_headers, expected):
    response = status(client, body, supplied_headers)
    assert response.status_code == expected
    assert SECRET not in response.text


@pytest.mark.parametrize(
    "changes",
    [
        {"kind": "unknown"},
        {"baseUrl": "file:///tmp/model"},
        {"baseUrl": "https://user:secret@api.openai.com/v1"},
        {"baseUrl": "https://api.openai.com/v1?key=secret"},
        {"baseUrl": "https://api.openai.com/v1#secret"},
        {"baseUrl": "https://api.openai.com/v1?"},
        {"baseUrl": "https://api.openai.com/v1#"},
        {"baseUrl": "https://api.openai.com/v1/%2e%2e"},
        {"baseUrl": "https://api.openai.com/v1/../private"},
        {"baseUrl": "https://api.openai.com/v1//private"},
        {"baseUrl": "https://api.openai.com./v1"},
        {"baseUrl": "https://api.openai.com.evil.example/v1"},
        {"baseUrl": "https://api.openai.com\\evil.example/v1"},
        {"baseUrl": "https://api.openai.com:0/v1"},
        {"baseUrl": "https://api.openai.com:65536/v1"},
        {"baseUrl": "https://api.openai.com/space value"},
        {"baseUrl": "https://api.openai.com/v1\n"},
        {"baseUrl": "https://legacy-environment.example.test/v1"},
        {"kind": "ONLINE", "baseUrl": "http://localhost:11434/v1", "apiKey": SECRET},
        {"baseUrl": "http://api.openai.com/v1"},
        {"baseUrl": "https://api.openai.com/v1"},
        {"model": ""},
        {"model": "name with whitespace"},
        {"model": "x" * 201},
        {"model": "model\r\nAuthorization: value"},
        {"apiKey": ""},
        {"apiKey": "secret\r\nHeader:value"},
        {"apiKey": "x" * 8193},
        {"apiKey": "white space"},
        {"apiKey": 123},
        {"structuredOutput": "true"},
        {"unexpected": "field"},
        {"apiKey": SECRET, "model": SECRET},
    ],
)
def test_invalid_override_is_rejected_without_outbound_or_echo(client, changes):
    def forbidden(_request):
        pytest.fail("Invalid configuration must not reach a provider")

    app.state.provider_transport = httpx.MockTransport(forbidden)
    response = post(client, config(**changes))
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
    assert SECRET not in response.text


def test_exact_deployment_hosts_and_private_http_permission(client, monkeypatch):
    monkeypatch.setenv("NLA_MODEL_PROVIDER_HOSTS", "model.internal,10.20.30.40,::1")
    for url in ("http://model.internal:8080/v1", "http://10.20.30.40:8080/v1", "http://[::1]/v1"):
        ModelConfig.model_validate(config(kind="ONLINE", baseUrl=url, apiKey=SECRET))
    ModelConfig.model_validate(
        config(kind="ONLINE", baseUrl="https://api.openai.com/v1", apiKey=SECRET)
    )
    for host in ("169.254.169.254", "0.0.0.0", "224.1.1.1", "8.8.8.8"):
        monkeypatch.setenv("NLA_MODEL_PROVIDER_HOSTS", host)
        with pytest.raises(ValidationError):
            ModelConfig.model_validate(
                config(kind="ONLINE", baseUrl=f"http://{host}/v1", apiKey=SECRET)
            )
    monkeypatch.setenv("NLA_MODEL_PROVIDER_HOSTS", "*.example.test")
    with pytest.raises(ValidationError):
        ModelConfig.model_validate(config())


@pytest.mark.parametrize(
    "host", ["169.254.169.254", "0.0.0.0", "224.0.0.1", "::ffff:169.254.169.254"]
)
def test_forbidden_ip_literals_rejected_even_with_https_and_explicit_permission(
    client, monkeypatch, host
):
    monkeypatch.setenv("NLA_MODEL_PROVIDER_HOSTS", host)
    authority = f"[{host}]" if ":" in host else host
    response = post(client, config(kind="ONLINE", baseUrl=f"https://{authority}/v1", apiKey=SECRET))
    assert response.status_code == 422


def test_local_override_never_inherits_environment_key_and_config_is_excluded(client, caplog):
    captured = []

    def provider(request):
        captured.append(request)
        return httpx.Response(200, json=answer(VALID_SQL))

    app.state.provider_transport = httpx.MockTransport(provider)
    selected = config()
    body = request_body()
    body["modelConfig"] = selected
    parsed = Input.model_validate(body)
    assert "modelConfig" not in parsed.model_dump()
    response = post(client, selected)
    assert response.status_code == 200, response.text
    assert response.json()["model"] == selected["model"]
    assert "authorization" not in captured[0].headers
    sent = json.loads(captured[0].content)
    assert sent["model"] == selected["model"]
    assert sent["response_format"]["type"] == "json_schema"
    assert "modelConfig" not in captured[0].content.decode()
    assert (
        "environment-private-secret"
        not in captured[0].content.decode() + response.text + caplog.text
    )


def test_online_override_uses_own_key_and_actual_envelope_model(client, caplog):
    def provider(request):
        assert request.url.host == "api.openai.com"
        assert request.headers["authorization"] == "Bearer " + SECRET
        sent = json.loads(request.content)
        assert sent["model"] == "requested-alias"
        assert sent["response_format"]["type"] == "json_object"
        assert SECRET not in request.content.decode()
        return httpx.Response(200, json={**answer(VALID_SQL), "model": "actual-model-2026-10-21"})

    app.state.provider_transport = httpx.MockTransport(provider)
    response = post(
        client,
        config(
            kind="ONLINE",
            baseUrl="https://api.openai.com/v1",
            model="requested-alias",
            apiKey=SECRET,
            structuredOutput=False,
        ),
    )
    assert response.status_code == 200, response.text
    assert response.json()["model"] == "actual-model-2026-10-21"
    assert SECRET not in response.text + caplog.text


@pytest.mark.parametrize("actual_model", [None, "", "model\nsecret", "x" * 201, 123, SECRET])
def test_invalid_actual_model_or_secret_echo_never_reaches_response(client, actual_model, caplog):
    app.state.provider_transport = httpx.MockTransport(
        lambda _: httpx.Response(200, json={**answer(VALID_SQL), "model": actual_model})
    )
    response = post(client, config(apiKey=SECRET))
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "INVALID_MODEL_RESPONSE"
    assert SECRET not in response.text + caplog.text


@pytest.mark.parametrize("field", ["sql", "explanation", "assumptions", "model"])
def test_secret_in_candidate_is_rejected_rather_than_redacted(client, field):
    response = answer(VALID_SQL)
    candidate = json.loads(response["choices"][0]["message"]["content"])
    candidate[field] = [SECRET] if field == "assumptions" else SECRET
    response["choices"][0]["message"]["content"] = json.dumps(candidate)
    app.state.provider_transport = httpx.MockTransport(lambda _: httpx.Response(200, json=response))
    result = post(client, config(apiKey=SECRET))
    assert result.status_code == 502 and SECRET not in result.text


@pytest.mark.parametrize("failure", ["timeout", "redirect", "upstream", "malformed"])
def test_failures_are_sanitized_and_scope_resets_before_environment_request(client, failure):
    captured = []

    def provider(request):
        captured.append(request)
        if len(captured) == 1:
            if failure == "timeout":
                raise httpx.ReadTimeout(SECRET, request=request)
            if failure == "redirect":
                return httpx.Response(302, headers={"Location": "https://evil.example/" + SECRET})
            if failure == "upstream":
                return httpx.Response(401, text=SECRET)
            return httpx.Response(200, text=SECRET)
        return httpx.Response(200, json=answer(VALID_SQL))

    app.state.provider_transport = httpx.MockTransport(provider)
    failed = post(client, config(apiKey=SECRET))
    assert failed.status_code in {502, 503, 504}
    assert SECRET not in failed.text
    fallback = post(client)
    assert fallback.status_code == 200, fallback.text
    assert fallback.json()["model"] == "environment-model"
    assert len(captured) == 2
    assert captured[1].url.host == "legacy-environment.example.test"
    assert captured[1].headers["authorization"] == "Bearer environment-private-secret"


def test_deterministic_has_no_provider_configuration_or_outbound(client, monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "invalid://credential-value")
    monkeypatch.setenv("LLM_REASONING_EFFORT", "invalid-provider-setting")
    monkeypatch.setenv("LLM_MAX_OUTPUT_TOKENS", "invalid-provider-setting")
    app.state.provider_transport = httpx.MockTransport(
        lambda _: pytest.fail("Offline called model")
    )
    body = fixture_payload()
    private_headers = {**fixture_headers(), "Authorization": "Bearer " + TOKEN}
    response = client.post("/internal/v1/text-to-sql", json=body, headers=private_headers)
    assert response.status_code == 200, response.text
    assert response.json()["model"] == "deterministic-semantic-examples"
    body["modelConfig"] = config()
    rejected = client.post("/internal/v1/text-to-sql", json=body, headers=private_headers)
    assert rejected.status_code == 422


def test_semantic_assist_honors_private_override_without_prompting_credentials(client):
    captured = []

    def provider(request):
        captured.append(request)
        return httpx.Response(
            200,
            json={
                "model": "actual-assist-model",
                "choices": [{"message": {"content": json.dumps(proposal())}}],
            },
        )

    app.state.provider_transport = httpx.MockTransport(provider)
    body = assist_envelope()
    body["modelConfig"] = config(apiKey=SECRET, model="assist-model", structuredOutput=False)
    response = client.post(
        "/internal/v1/semantic-assist", json=body, headers=headers("assist-test")
    )
    assert response.status_code == 200, response.text
    assert response.json()["model"] == "actual-assist-model"
    sent = json.loads(captured[0].content)
    assert sent["model"] == "assist-model"
    assert sent["response_format"]["type"] == "json_object"
    assert SECRET not in captured[0].content.decode() + response.text
    assert "modelConfig" not in captured[0].content.decode()


def test_concurrent_requests_keep_destination_key_model_and_structured_output_isolated(client):
    async def execute():
        entered = asyncio.Event()
        captured = []

        async def provider(request):
            captured.append(request)
            if len(captured) == 2:
                entered.set()
            await asyncio.wait_for(entered.wait(), timeout=2)
            await asyncio.sleep(0)
            return httpx.Response(200, json=answer(VALID_SQL))

        app.state.provider_transport = httpx.MockTransport(provider)
        selections = [
            config(
                kind="ONLINE",
                baseUrl="https://api.openai.com/v1",
                model="concurrent-online",
                apiKey=SECRET,
                structuredOutput=False,
            ),
            config(
                baseUrl="http://127.0.0.1:11434/v1", model="concurrent-local", structuredOutput=True
            ),
        ]
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://private-service"
        ) as caller:
            results = await asyncio.gather(
                *(
                    caller.post(
                        "/internal/v1/text-to-sql",
                        json={**request_body(), "modelConfig": selected},
                        headers=headers(),
                    )
                    for selected in selections
                )
            )
        assert all(result.status_code == 200 for result in results), [
            result.text for result in results
        ]
        assert [result.json()["model"] for result in results] == [
            item["model"] for item in selections
        ]
        by_model = {json.loads(request.content)["model"]: request for request in captured}
        online = by_model["concurrent-online"]
        local = by_model["concurrent-local"]
        assert online.url.host == "api.openai.com"
        assert online.headers["authorization"] == "Bearer " + SECRET
        assert json.loads(online.content)["response_format"]["type"] == "json_object"
        assert local.url.host == "127.0.0.1" and "authorization" not in local.headers
        assert json.loads(local.content)["response_format"]["type"] == "json_schema"
        assert provider_model() == "environment-model" and structured_output() is False

    asyncio.run(execute())


def test_scope_resets_on_cancellation_and_nested_failure(client):
    async def execute():
        ready = asyncio.Event()

        async def cancelled():
            with provider_scope(ModelConfig.model_validate(config(model="cancelled-model"))):
                ready.set()
                await asyncio.Event().wait()

        task = asyncio.create_task(cancelled())
        await ready.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        with provider_scope(ModelConfig.model_validate(config(model="outer-model"))):
            with pytest.raises(RuntimeError):
                with provider_scope(ModelConfig.model_validate(config(model="inner-model"))):
                    raise RuntimeError("controlled failure")
            assert provider_model() == "outer-model"
        assert provider_model() == "environment-model"

    asyncio.run(execute())
