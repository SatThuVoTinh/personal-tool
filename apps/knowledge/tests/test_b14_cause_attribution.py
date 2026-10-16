"""M12/T2.2-R2 B-14 (`4A.9` / `R5-E01-05`): a governed denial must stay explainable.

The Knowledgebase app has no logging channel by design, and its owned structured channel --
``run_errors.SafeRunError`` -- is frozen at ``{code, source_path}`` and re-validated key-set for
key-set on read, so it structurally cannot carry an underlying cause (§3 keeps ``run_errors.py``
read-only). What the 19 request/probe sites in ``main.py`` and ``model_probe.py`` could do was
keep the cause on the exception chain, and every one of them said ``from None`` instead --
leaving a 503 ``DATABASE_UNAVAILABLE`` indistinguishable from a statement timeout, a driver
refusal, or a dropped socket.

Ship shape, as decided by owner answer §0.5-B: preserve the cause. Codes, statuses, messages and
response bodies are untouched, and no new diagnostic channel is introduced.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

os.environ.setdefault("KNOWLEDGE_DATABASE_PASSWORD", "unit-test-only")

_TOKENIZER = os.environ.get("KNOWLEDGE_TOKENIZER_PATH")
if not _TOKENIZER or not Path(_TOKENIZER).is_file():
    pytest.skip(
        "the pinned tokenizer is not provisioned; CI fetches it "
        "(.github/workflows/ci.yml), so this module is NOT RUN rather than passed",
        allow_module_level=True,
    )

from app.config import Settings
from app.main import SearchRequest, create_app
from app.model_probe import ModelProbeError, OllamaModelProbe

DRIVER_TEXT = "connection to server at 10.0.0.9 failed: FATAL private-role detail"


def _settings(vault_root: Path) -> Settings:
    return Settings(
        database_host="unused",
        database_port=5432,
        database_name="unused",
        database_user="unused",
        database_password="unused",
        ollama_url="http://unused",
        embedding_model="bge-m3:latest",
        embedding_dimensions=1024,
        advisory_lock_key=1,
        migration_directory=Path("/app/migrations"),
        vault_root=vault_root,
        tokenizer_path=Path(os.environ["KNOWLEDGE_TOKENIZER_PATH"]),
    )


class CauseErasureIsGoneTests(unittest.TestCase):
    def test_neither_file_suppresses_its_cause_anymore(self) -> None:
        app_directory = Path(__file__).resolve().parents[1] / "app"
        for name in ("main.py", "model_probe.py"):
            body = (app_directory / name).read_text(encoding="utf8")
            self.assertNotIn(
                "from None",
                body,
                f"{name} still erases the cause of a governed failure",
            )


class SearchRouteAttributionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.vault = tempfile.TemporaryDirectory()
        (Path(self.vault.name) / "01. Knowledge").mkdir()
        self.app = create_app(_settings(Path(self.vault.name)))
        self.app.state.database._pool = object()

    async def asyncTearDown(self) -> None:
        await self.app.state.model_probe.close()
        self.vault.cleanup()

    def endpoint(self):
        for route in self.app.routes:
            if getattr(route, "path", None) == "/v1/search":
                return route.endpoint
        self.fail("/v1/search is no longer a route")

    async def test_the_outage_keeps_the_underlying_error_and_leaks_nothing(self) -> None:
        underlying = TimeoutError(DRIVER_TEXT)
        self.app.state.database.get_active_index = AsyncMock(side_effect=underlying)

        with self.assertRaises(HTTPException) as raised:
            await self.endpoint()(SearchRequest(query="topic", rerank=False))

        failure = raised.exception
        # The client-visible pair is exactly what it was before this item.
        self.assertEqual(failure.status_code, 503)
        self.assertEqual(failure.detail, {"code": "DATABASE_UNAVAILABLE"})
        # Attribution is the entire point of the change.
        self.assertIs(failure.__cause__, underlying)
        self.assertNotIn(DRIVER_TEXT, str(failure.detail))


class ModelProbeAttributionTests(unittest.IsolatedAsyncioTestCase):
    async def probe_with(self, handler) -> OllamaModelProbe:
        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        return probe

    async def test_a_permanent_http_failure_names_the_response_that_caused_it(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, text="upstream said this")

        probe = await self.probe_with(handler)
        try:
            with self.assertRaises(ModelProbeError) as raised:
                await probe.resolve("bge-m3:latest")
        finally:
            await probe.close()

        self.assertEqual(raised.exception.args[0], "EMBEDDING_PERMANENT_HTTP")
        self.assertIsInstance(raised.exception.__cause__, httpx.HTTPStatusError)

    async def test_the_exhausted_retry_still_points_at_the_timeout(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("read timed out after 3 seconds", request=request)

        probe = await self.probe_with(handler)
        try:
            with self.assertRaises(ModelProbeError) as raised:
                await probe.resolve("bge-m3:latest")
        finally:
            await probe.close()

        self.assertEqual(raised.exception.args[0], "EMBEDDING_TIMEOUT")
        self.assertIsInstance(raised.exception.__cause__, httpx.ReadTimeout)
