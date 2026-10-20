"""Bounded reuse of native semantic sessions; SQL and results are never cached."""

# Adapted from wren/src/wren/mdl/__init__.py in the supplied Wren Engine snapshot.
# Copyright 2024 Canner, Inc. Licensed under Apache-2.0; see LICENSE in this folder.
# Changes: finite cache, large-manifest bypass, synchronized creation and per-session
# leases. A request-scoped CTERewriter is still created for every SQL statement.

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from functools import lru_cache
from threading import Lock
from typing import Iterator

import wren_core

MAX_CACHED_MANIFEST_BYTES = 65536
_FACTORY_LOCK = Lock()


@dataclass
class _Session:
    context: wren_core.SessionContext
    lock: Lock = field(default_factory=Lock)


def _create(manifest_str: str, data_source: str) -> _Session:
    return _Session(wren_core.SessionContext(manifest_str, None, None, data_source))


# Keys contain the complete authorized manifest and dialect, never query text,
# principal tokens, credentials, result rows or provider messages.
@lru_cache(maxsize=8)
def _cached(manifest_str: str, data_source: str) -> _Session:
    return _create(manifest_str, data_source)


@contextmanager
def session_context(manifest_str: str, data_source: str) -> Iterator[wren_core.SessionContext]:
    if len(manifest_str.encode("utf-8")) > MAX_CACHED_MANIFEST_BYTES:
        yield _create(manifest_str, data_source).context
        return
    # lru_cache permits duplicate creation on concurrent misses; serialize the
    # small factory so concurrent requests for one manifest share one context.
    with _FACTORY_LOCK:
        session = _cached(manifest_str, data_source)
    # Native context thread-safety is not assumed. Different manifests keep
    # independent locks; no SQL AST or rewriter state is shared across requests.
    with session.lock:
        yield session.context
