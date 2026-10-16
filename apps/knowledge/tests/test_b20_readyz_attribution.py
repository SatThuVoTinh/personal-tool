"""M12/T2.2-R2 B-20 (`found while landing B-18`): /readyz needs a terminal mapper too.

`/readyz` maps `DATABASE_ERRORS`, `httpx.HTTPError`/`ModelProbeError`, `PdfRuntimeError` and `OSError`, and
nothing else. Its probe calls `model_probe.resolve`, which reads a JSON body (`model_probe.py:67`), so a
`json.JSONDecodeError` -- a `ValueError`, and neither of the two types the route catches -- escapes as FastAPI's
default 500 with a plain-text body. That is the route the orchestrator and the operator's own T1 script use to
decide whether the replica serves traffic, and the outage it produces is the one with no code in it.

The status cannot change (an unmapped fault is already a 500), so the whole fix is the body. It follows this
route's own convention -- a flat `{"status", "code"}` JSON, the shape every mapped readiness answer already
uses -- rather than importing the `detail.code` wrapper the request routes use, which would give one probe two
shapes. Every mapped branch is asserted to keep its exact code, and the 200 body is asserted unchanged.
"""

from __future__ import annotations

import asyncio
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch

import httpx
import pytest

os.environ.setdefault("KNOWLEDGE_DATABASE_PASSWORD", "unit-test-only")

_TOKENIZER = os.environ.get("KNOWLEDGE_TOKENIZER_PATH")
if not _TOKENIZER or not Path(_TOKENIZER).is_file():
    pytest.skip(
        "the pinned tokenizer is not provisioned; CI fetches it "
        "(.github/workflows/ci.yml), so this module is NOT RUN rather than passed",
        allow_module_level=True,
    )

from app.config import Settings
from app.database import ActiveIndex
from app.main import create_app
from app.model_probe import ModelProbeError, ResolvedEmbeddingModel

EMBEDDING = ResolvedEmbeddingModel("bge-m3:latest", "a" * 64, 1024)
ACTIVE = ActiveIndex("index-1", "bge-m3:latest", "a" * 64, 1024)
DETAIL_TEXT = "upstream body that must not become the response: <!doctype html> 502"


class ReadyzAttributionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.vault = TemporaryDirectory()
        (Path(self.vault.name) / "01. Knowledge").mkdir()
        self.app = create_app(
            Settings(
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
                vault_root=Path(self.vault.name),
                tokenizer_path=Path(os.environ["KNOWLEDGE_TOKENIZER_PATH"]),
            )
        )
        self.app.state.database._pool = object()  # type: ignore[assignment]
        # The readiness probe only null-checks the reranker, so any object stands in
        # for "the reranker passed provenance".
        self.app.state.reranker = object()

    async def asyncTearDown(self) -> None:
        await self.app.state.model_probe.close()
        self.vault.cleanup()

    async def readyz(self, app=None) -> httpx.Response:
        transport = httpx.ASGITransport(app=app or self.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            return await client.request("GET", "/readyz")

    def pdf_enabled_app(self):
        # The readiness PDF branch hashes the runtime lock, the manifest and the
        # tokenizer before it probes, so all three must be real files for a fault
        # to reach the probe itself rather than the artifact read.
        root = Path(self.vault.name)
        lock = root / "pdf-runtime.lock"
        manifest = root / "pdf-runtime-manifest.json"
        lock.write_text("lock\n", encoding="utf8")
        manifest.write_text("{}\n", encoding="utf8")
        app = create_app(
            Settings(
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
                vault_root=root,
                tokenizer_path=Path(os.environ["KNOWLEDGE_TOKENIZER_PATH"]),
                pdf_runtime_enabled=True,
                pdf_runtime_lock_path=lock,
                pdf_runtime_manifest_path=manifest,
            )
        )
        app.state.database._pool = object()  # type: ignore[assignment]
        app.state.reranker = object()
        app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        app.state.model_probe.resolve = AsyncMock(return_value=EMBEDDING)
        return app

    async def test_a_probe_body_that_is_not_json_answers_a_code_at_500(self) -> None:
        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.model_probe.resolve = AsyncMock(
            side_effect=json.JSONDecodeError(DETAIL_TEXT, "doc", 0)
        )

        response = await self.readyz()

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.json(), {"status": "not_ready", "code": "INTERNAL_ERROR"}
        )
        self.assertNotIn(DETAIL_TEXT, response.text)

    async def test_a_model_probe_fault_that_is_not_http_still_answers_a_code(self) -> None:
        # `ModelProbeError` is mapped; a fault type the probe can also raise -- a
        # key error on a well-formed but unexpected payload -- is not.
        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.model_probe.resolve = AsyncMock(
            side_effect=KeyError("models")
        )

        response = await self.readyz()

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["code"], "INTERNAL_ERROR")

    async def test_every_mapped_readiness_branch_keeps_its_own_code(self) -> None:
        cases = (
            ("database outage", asyncio.TimeoutError(), None, EMBEDDING, "DATABASE_UNAVAILABLE"),
            ("no active index", None, None, EMBEDDING, "NO_ACTIVE_INDEX"),
            (
                "reranker unavailable",
                None,
                ACTIVE,
                EMBEDDING,
                "RERANKER_UNAVAILABLE",
            ),
            (
                "provider outage",
                None,
                ACTIVE,
                httpx.ConnectError("ollama down"),
                "EMBEDDING_MODEL_UNAVAILABLE",
            ),
            (
                "model drift",
                None,
                ACTIVE,
                ResolvedEmbeddingModel("bge-m3:latest", "b" * 64, 1024),
                "EMBEDDING_MODEL_DRIFT",
            ),
        )
        for name, database_fault, index, resolved, expected in cases:
            with self.subTest(name):
                self.app.state.database.get_active_index = (
                    AsyncMock(side_effect=database_fault)
                    if database_fault is not None
                    else AsyncMock(return_value=index)
                )
                self.app.state.reranker = None if expected == "RERANKER_UNAVAILABLE" else object()
                self.app.state.model_probe.resolve = (
                    AsyncMock(side_effect=resolved)
                    if isinstance(resolved, BaseException)
                    else AsyncMock(return_value=resolved)
                )

                response = await self.readyz()

                self.assertEqual(response.status_code, 503, name)
                self.assertEqual(response.json()["code"], expected)

    async def test_the_ready_response_is_unchanged(self) -> None:
        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.model_probe.resolve = AsyncMock(return_value=EMBEDDING)

        response = await self.readyz()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": "ready",
                "active_index_id": "index-1",
                "embedding_model": {
                    "name": "bge-m3:latest",
                    "digest": "a" * 64,
                    "dimensions": 1024,
                },
            },
        )

    async def test_the_mapped_probe_error_is_still_a_503_not_the_new_500(self) -> None:
        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.model_probe.resolve = AsyncMock(
            side_effect=ModelProbeError("EMBEDDING_TIMEOUT")
        )

        response = await self.readyz()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "EMBEDDING_MODEL_UNAVAILABLE")


    async def test_an_unmapped_fault_in_the_pdf_branch_answers_a_code_too(self) -> None:
        app = self.pdf_enabled_app()
        # The identity helper is called inside the branch's own try, and a fault from
        # it is neither a `PdfRuntimeError` nor an `OSError`, so this is the second
        # codeless-500 path on the same route. Patched at the name `main.py` looks up
        # at call time, not at the class.
        with patch(
            "app.main.processing_identity_for_runtime",
            side_effect=RuntimeError("identity exploded"),
        ):
            try:
                response = await self.readyz(app)
            finally:
                await app.state.model_probe.close()

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.json(), {"status": "not_ready", "code": "INTERNAL_ERROR"}
        )


if __name__ == "__main__":
    unittest.main()
