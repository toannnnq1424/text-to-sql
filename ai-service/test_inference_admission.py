"""Admission/failure tests use controlled transports and never call an online provider."""

import asyncio
import json
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

import inference_admission
from app import app
from inference_admission import (
    InferenceAdmission,
    InferenceUnavailable,
    admission_configuration,
)
from test_app import payload as offline_payload
from test_candidate_validation import answer, request_body
from test_semantic_assist import envelope as assist_payload
from test_semantic_assist import proposal
from test_semantic_planner import request as planning_payload
from test_workbench import envelope as business_payload

TOKEN = "inference-admission-service-token-at-least-32-characters"
VALID_SQL = (
    "SELECT station, AVG(temperature) AS average_temperature "
    "FROM analytics.observations GROUP BY station"
)
INVALID_GRAIN = (
    "SELECT station, AVG(temperature) AS average_temperature FROM analytics.observations"
)


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("PYTHON_AI_TOKEN", TOKEN)
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setenv("LLM_MODEL", "admission-test-model")
    monkeypatch.setenv("LLM_API_KEY", "admission-test-secret-never-log")
    monkeypatch.setenv("LLM_MAX_CONCURRENT_REQUESTS", "1")
    monkeypatch.setenv("LLM_ADMISSION_TIMEOUT_MS", "0")
    monkeypatch.setenv("LLM_TIMEOUT_MS", "30000")
    monkeypatch.setenv("KNOWLEDGE_ENABLED", "false")
    gate = InferenceAdmission()
    monkeypatch.setattr(inference_admission, "_admission", gate)
    yield gate
    if hasattr(app.state, "provider_transport"):
        delattr(app.state, "provider_transport")
    assert gate._active == 0 and gate._waiting == 0


def headers(body, mode="API"):
    return {
        "Authorization": "Bearer " + TOKEN,
        "X-Correlation-ID": body["correlationId"],
        "X-Execution-Mode": mode,
    }


async def send(client, body=None, *, assist=False, mode="API"):
    body = body or (assist_payload() if assist else request_body())
    return await client.post(
        "/internal/v1/semantic-assist" if assist else "/internal/v1/text-to-sql",
        json=body,
        headers=headers(body, mode),
    )


def assert_overload(response):
    assert response.status_code == 503, response.text
    error = response.json()["error"]
    assert error["code"] == "PROVIDER_UNAVAILABLE" and error["retryable"] is True
    assert "capacity" in error["message"]
    assert "admission-test-secret" not in response.text
    assert "LLM_" not in response.text and error["details"] == {}


def test_default_and_extreme_valid_configuration(monkeypatch):
    monkeypatch.delenv("LLM_MAX_CONCURRENT_REQUESTS", raising=False)
    monkeypatch.delenv("LLM_ADMISSION_TIMEOUT_MS", raising=False)
    assert admission_configuration() == (2, 0.25)
    monkeypatch.setenv("LLM_MAX_CONCURRENT_REQUESTS", "32")
    monkeypatch.setenv("LLM_ADMISSION_TIMEOUT_MS", "5000")
    assert admission_configuration() == (32, 5.0)


@pytest.mark.parametrize(
    "field,value",
    [
        ("LLM_MAX_CONCURRENT_REQUESTS", "0"),
        ("LLM_MAX_CONCURRENT_REQUESTS", "33"),
        ("LLM_MAX_CONCURRENT_REQUESTS", "-1"),
        ("LLM_MAX_CONCURRENT_REQUESTS", "1.5"),
        ("LLM_MAX_CONCURRENT_REQUESTS", "not-a-number-secret"),
        ("LLM_ADMISSION_TIMEOUT_MS", "-1"),
        ("LLM_ADMISSION_TIMEOUT_MS", "5001"),
        ("LLM_ADMISSION_TIMEOUT_MS", "nan"),
    ],
)
def test_invalid_configuration_rejects_generation_and_assistance_before_transport(
    configured, monkeypatch, field, value
):
    monkeypatch.setenv(field, value)
    app.state.provider_transport = httpx.MockTransport(
        lambda _request: pytest.fail("Invalid admission config must not invoke a provider")
    )

    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            assert_overload(await send(client))
            assert_overload(await send(client, assist=True))

    asyncio.run(scenario())


def test_active_and_waiting_work_are_both_bounded_and_waiter_enters_after_release():
    gate = InferenceAdmission()

    async def scenario():
        entered = asyncio.Event()
        release = asyncio.Event()
        second_entered = asyncio.Event()

        async def first():
            async with gate.slot(1, 1):
                entered.set()
                await release.wait()

        async def second():
            async with gate.slot(1, 1):
                second_entered.set()

        task = asyncio.create_task(first())
        await entered.wait()
        waiting = asyncio.create_task(second())
        await asyncio.sleep(0)
        assert gate._active == 1 and gate._waiting == 1
        with pytest.raises(InferenceUnavailable):
            async with gate.slot(1, 1):
                pytest.fail("The bounded waiting capacity is already occupied")
        assert not second_entered.is_set()
        release.set()
        await asyncio.gather(task, waiting)
        assert second_entered.is_set()
        assert gate._active == 0 and gate._waiting == 0

    asyncio.run(scenario())


def test_wait_timeout_waiter_cancellation_and_active_failure_release_capacity():
    gate = InferenceAdmission()

    async def scenario():
        async with gate.slot(1, 0):
            with pytest.raises(InferenceUnavailable):
                async with gate.slot(1, 0.02):
                    pytest.fail("Full gate cannot admit before wait timeout")
            assert gate._active == 1 and gate._waiting == 0

            async def queued():
                async with gate.slot(1, 1):
                    pytest.fail("Cancelled waiter must not enter")

            task = asyncio.create_task(queued())
            await asyncio.sleep(0)
            assert gate._waiting == 1
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert gate._waiting == 0 and gate._active == 1
        with pytest.raises(RuntimeError):
            async with gate.slot(1, 0):
                raise RuntimeError("intentional test failure")
        async with gate.slot(1, 0):
            assert gate._active == 1
        assert gate._active == 0 and gate._waiting == 0

    asyncio.run(scenario())


def test_gate_capacity_is_shared_between_event_loops_and_threads():
    gate = InferenceAdmission()
    held = threading.Event()
    release = threading.Event()

    def first_loop():
        async def work():
            async with gate.slot(1, 0):
                held.set()
                await asyncio.to_thread(release.wait, 2)

        asyncio.run(work())

    def second_loop():
        async def work():
            with pytest.raises(InferenceUnavailable):
                async with gate.slot(1, 0):
                    pytest.fail("A separate event loop cannot bypass process capacity")

        asyncio.run(work())

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(first_loop)
        try:
            assert held.wait(2)
            pool.submit(second_loop).result(timeout=2)
        finally:
            release.set()
        first.result(timeout=2)
    assert gate._active == 0


def test_generation_and_semantic_assistance_share_slots_without_provider_retry(configured):
    calls = []

    async def scenario():
        started = asyncio.Event()
        release = asyncio.Event()

        async def respond(request):
            body = json.loads(request.content)
            calls.append(body)
            if len(calls) == 1:
                started.set()
                await release.wait()
                return httpx.Response(200, json=answer(VALID_SQL))
            return httpx.Response(
                200, json={"choices": [{"message": {"content": json.dumps(proposal())}}]}
            )

        app.state.provider_transport = httpx.MockTransport(respond)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            active = asyncio.create_task(send(client))
            await started.wait()
            assert_overload(await send(client, assist=True))
            assert_overload(await send(client))
            assert len(calls) == 1
            release.set()
            assert (await active).status_code == 200
            assert (await send(client, assist=True)).status_code == 200
            assert len(calls) == 2

    asyncio.run(scenario())


def test_correction_retains_slot_and_total_generation_budget(configured):
    calls = []

    async def scenario():
        correction_started = asyncio.Event()
        release_correction = asyncio.Event()

        async def respond(request):
            calls.append(json.loads(request.content))
            assert configured._active == 1
            if len(calls) == 1:
                return httpx.Response(200, json=answer(INVALID_GRAIN))
            correction_started.set()
            await release_correction.wait()
            return httpx.Response(200, json=answer(VALID_SQL))

        app.state.provider_transport = httpx.MockTransport(respond)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            first = asyncio.create_task(send(client))
            await asyncio.wait_for(correction_started.wait(), 2)
            assert_overload(await send(client, assist=True))
            assert_overload(await send(client))
            assert len(calls) == 2 and len(calls[1]["messages"]) == 4
            release_correction.set()
            result = await first
            assert result.status_code == 200 and result.json()["sql"] == VALID_SQL
            assert len(calls) == 2

    asyncio.run(scenario())


@pytest.mark.parametrize("assist", [False, True])
def test_provider_wall_timeout_releases_slot_for_next_request(configured, monkeypatch, assist):
    monkeypatch.setenv("LLM_TIMEOUT_MS", "100")
    calls = []

    async def scenario():
        blocked = asyncio.Event()

        async def respond(request):
            calls.append(request)
            if len(calls) == 1:
                await blocked.wait()
            if assist:
                return httpx.Response(
                    200,
                    json={"choices": [{"message": {"content": json.dumps(proposal())}}]},
                )
            return httpx.Response(200, json=answer(VALID_SQL))

        app.state.provider_transport = httpx.MockTransport(respond)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            timed_out = await send(client, assist=assist)
            assert timed_out.status_code == 504
            assert timed_out.json()["error"]["code"] == "PROVIDER_TIMEOUT"
            assert configured._active == 0
            assert (await send(client, assist=assist)).status_code == 200
            assert len(calls) == 2

    asyncio.run(scenario())


def test_cancelled_generation_releases_slot_and_does_not_retry(configured):
    calls = []

    async def scenario():
        started = asyncio.Event()

        async def respond(request):
            calls.append(request)
            if len(calls) == 1:
                started.set()
                await asyncio.Event().wait()
            return httpx.Response(200, json=answer(VALID_SQL))

        app.state.provider_transport = httpx.MockTransport(respond)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            first = asyncio.create_task(send(client))
            await started.wait()
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first
            assert configured._active == 0 and configured._waiting == 0
            assert (await send(client)).status_code == 200
            assert len(calls) == 2

    asyncio.run(scenario())


@pytest.mark.parametrize("status", [401, 429, 500])
def test_failed_provider_releases_capacity_and_never_retries(configured, status):
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(status, json={"message": "upstream-private-error"})

    app.state.provider_transport = httpx.MockTransport(respond)

    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            for expected_calls in [1, 2]:
                result = await send(client)
                assert result.status_code == 503
                assert result.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"
                assert "upstream-private-error" not in result.text
                assert len(calls) == expected_calls and configured._active == 0

    asyncio.run(scenario())


def test_offline_bypasses_full_admission_and_invalid_admission_configuration(
    configured, monkeypatch
):
    monkeypatch.setenv("LLM_MAX_CONCURRENT_REQUESTS", "bad-config")
    app.state.provider_transport = httpx.MockTransport(
        lambda _request: pytest.fail("Deterministic mode must not call a model")
    )

    async def scenario():
        async with configured.slot(1, 0):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                body = offline_payload()
                body["question"] = body["semanticContext"]["examples"][0]["question"]
                result = await send(client, body, mode="DETERMINISTIC")
                assert result.status_code == 200, result.text
                assert result.json()["model"] == "deterministic-semantic-examples"
                assert configured._active == 1

    asyncio.run(scenario())


@pytest.mark.parametrize("assist", [False, True])
def test_admission_wait_is_inside_wall_budget_and_never_calls_provider_after_timeout(
    configured, monkeypatch, assist
):
    monkeypatch.setenv("LLM_TIMEOUT_MS", "100")
    monkeypatch.setenv("LLM_ADMISSION_TIMEOUT_MS", "5000")
    app.state.provider_transport = httpx.MockTransport(
        lambda _request: pytest.fail("Expired queued request must not reach the provider")
    )

    async def scenario():
        async with configured.slot(1, 0):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                result = await send(client, assist=assist)
                assert result.status_code == 504
                assert result.json()["error"]["code"] == "PROVIDER_TIMEOUT"
                assert configured._active == 1 and configured._waiting == 0

    asyncio.run(scenario())


def test_cancelling_correction_releases_original_slot_without_third_provider_call(configured):
    calls = []

    async def scenario():
        correction = asyncio.Event()

        async def respond(request):
            calls.append(request)
            if len(calls) == 1:
                return httpx.Response(200, json=answer(INVALID_GRAIN))
            correction.set()
            await asyncio.Event().wait()

        app.state.provider_transport = httpx.MockTransport(respond)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            pending = asyncio.create_task(send(client))
            await asyncio.wait_for(correction.wait(), 2)
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await pending
            assert configured._active == 0 and configured._waiting == 0
            assert len(calls) == 2

    asyncio.run(scenario())


@pytest.mark.parametrize("dialect", ["POSTGRESQL", "MYSQL", "SQL_SERVER"])
def test_native_planner_and_business_compiler_bypass_full_model_gate(
    configured, monkeypatch, dialect
):
    monkeypatch.setenv("LLM_MAX_CONCURRENT_REQUESTS", "invalid")
    app.state.provider_transport = httpx.MockTransport(
        lambda _request: pytest.fail("Compilers must not call an inference provider")
    )

    async def scenario():
        async with configured.slot(1, 0):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                body = planning_payload(dialect)
                result = await client.post(
                    "/internal/v1/semantic-plan", json=body, headers=headers(body)
                )
                assert result.status_code == 200, result.text
                assert result.json()["plannerVersion"] == "wren-core-py/0.4.0"
                body = {
                    **business_payload(dialect),
                    "selection": {"metrics": ["total_value"], "dimensions": ["channel"]},
                }
                result = await client.post(
                    "/internal/v1/business-plan", json=body, headers=headers(body)
                )
                assert result.status_code == 200, result.text
                assert result.json()["model"] == "semantic-compiler"
                assert configured._active == 1

    asyncio.run(scenario())
