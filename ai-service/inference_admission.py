"""Bound process-local model work and waiters without retaining request data or credentials."""

import asyncio
import os
import threading
from contextlib import asynccontextmanager


class InferenceUnavailable(Exception):
    """Safe overload/configuration signal; never includes environment or request values."""


def admission_configuration() -> tuple[int, float]:
    try:
        limit = int(os.getenv("LLM_MAX_CONCURRENT_REQUESTS", "2"))
        timeout_ms = int(os.getenv("LLM_ADMISSION_TIMEOUT_MS", "250"))
        if not 1 <= limit <= 32 or not 0 <= timeout_ms <= 5000:
            raise ValueError()
    except ValueError:
        raise InferenceUnavailable() from None
    return limit, timeout_ms / 1000


class InferenceAdmission:
    """One gate per worker process, including calls on different event loops/threads.

    The waiting budget is capped at the configured active capacity. A short async
    wait checks the process-wide counters without a blocking thread lock or an
    unbounded collection of futures. No request payload is kept by this gate.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._active = 0
        self._waiting = 0

    @asynccontextmanager
    async def slot(self, limit: int, timeout: float):
        acquired = False
        queued = False
        with self._lock:
            if self._active < limit and self._waiting == 0:
                self._active += 1
                acquired = True
            elif timeout == 0 or self._waiting >= limit:
                raise InferenceUnavailable()
            else:
                self._waiting += 1
                queued = True
        try:
            if queued:
                loop = asyncio.get_running_loop()
                deadline = loop.time() + timeout
                while True:
                    remaining = deadline - loop.time()
                    if remaining <= 0:
                        raise InferenceUnavailable()
                    with self._lock:
                        if self._active < limit:
                            self._waiting -= 1
                            queued = False
                            self._active += 1
                            acquired = True
                            break
                    await asyncio.sleep(min(remaining, 0.01))
            yield
        finally:
            with self._lock:
                if queued:
                    self._waiting -= 1
                if acquired:
                    self._active -= 1


_admission = InferenceAdmission()


@asynccontextmanager
async def inference_slot():
    limit, timeout = admission_configuration()
    async with _admission.slot(limit, timeout):
        yield
