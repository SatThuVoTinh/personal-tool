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
import inspect
import json
import os
import re
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
from app.main import _embedding_error_code, _reranker_error_code, create_app
from app.model_probe import ModelProbeError, ResolvedEmbeddingModel
from app.reranker import RerankerUnavailableError

EMBEDDING = ResolvedEmbeddingModel("bge-m3:latest", "a" * 64, 1024)
ACTIVE = ActiveIndex("index-1", "bge-m3:latest", "a" * 64, 1024)
DETAIL_TEXT = "upstream body that must not become the response: <!doctype html> 502"

# F-314 (R7-E2-05): the case table was a literal list of five fixtures, so
# the branches the route gained -- the unavailable database, the opt-out
# parameter, the PDF runtime's own codes -- were invisible while the file
# claimed they were covered. The route's own source is the case list now:
# `test_the_case_matrix_covers_every_code_the_route_emits` compares the
# codes the route can emit with the codes this file executes.
COVERED_READYZ_CODES = frozenset(
    {
        "DATABASE_UNAVAILABLE",
        "NO_ACTIVE_INDEX",
        "RERANKER_UNAVAILABLE",
        "EMBEDDING_MODEL_UNAVAILABLE",
        "EMBEDDING_MODEL_DRIFT",
        "INTERNAL_ERROR",
        "PDF_RUNTIME_UNAVAILABLE",
    }
)


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

    async def test_the_mapped_probe_error_is_still_a_503_and_keeps_its_code(self) -> None:
        # F-515 (R10-L07-4): the route used to answer the constant
        # `EMBEDDING_MODEL_UNAVAILABLE` for every probe failure. The status is
        # unchanged; the probe's own code is what the orchestrator reads.
        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.model_probe.resolve = AsyncMock(
            side_effect=ModelProbeError("EMBEDDING_TIMEOUT")
        )

        response = await self.readyz()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "EMBEDDING_TIMEOUT")

    async def test_a_probe_failure_that_carries_no_code_keeps_the_constant(self) -> None:
        """F-515 (R10-L07-4): the fallback still exists, and it is not prose."""

        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.model_probe.resolve = AsyncMock(
            side_effect=httpx.ConnectError("All connection attempts failed")
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

    async def test_the_pdf_identity_memo_follows_the_content_it_hashes(self) -> None:
        """F-091 (R5-E01-02): the memo was keyed on PATHS, not on content.

        The memo promised to be "recomputed only if one of those inputs
        changes", but its key held the three file paths, and a path cannot
        change at runtime. A runtime lock rewritten in place therefore
        replayed the pre-change digest forever, and the probe was checked
        against an identity the run path no longer computes.
        """

        app = self.pdf_enabled_app()
        lock = Path(self.vault.name) / "pdf-runtime.lock"
        identities: list[str] = []

        def identity(*_args, **_kwargs):
            identities.append(f"identity-{len(identities) + 1}")
            return identities[-1]

        app.state.pdf_runtime.probe = AsyncMock()
        try:
            with patch(
                "app.main.processing_identity_for_runtime", side_effect=identity
            ):
                first = await self.readyz(app)
                # The same path, different bytes.
                lock.write_text("a longer lock body than before\n", encoding="utf8")
                second = await self.readyz(app)
        finally:
            await app.state.model_probe.close()

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(
            len(identities),
            2,
            "the identity must be recomputed when the hashed bytes change",
        )
        self.assertEqual(
            app.state.pdf_runtime.probe.await_args.args[0],
            identities[1],
            "the probe must be handed the identity of the CURRENT bytes",
        )

    async def test_the_opt_out_parameter_is_exercised(self) -> None:
        """F-314 (R7-E2-05): the opt-out branch had no executed case.

        The case table was a literal list of five fixtures, and the
        `require_reranker` parameter -- which changes which dependency the
        route requires -- was never varied, so a regression in it was
        invisible.
        """

        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.model_probe.resolve = AsyncMock(return_value=EMBEDDING)
        self.app.state.reranker = None

        transport = httpx.ASGITransport(app=self.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            refused = await client.request("GET", "/readyz")
            waived = await client.request("GET", "/readyz?require_reranker=false")

        self.assertEqual(refused.status_code, 503)
        self.assertEqual(refused.json()["code"], "RERANKER_UNAVAILABLE")
        self.assertEqual(waived.status_code, 200)

    async def test_the_reranker_failure_code_reaches_the_readiness_answer(self) -> None:
        """F-310 (R7-E1-06): one constant cannot name the real cause.

        The bootstrap wrote a single string into a field nothing read, so a
        bad artifact pin and an unusable graph produced the same observable
        state. The code the reranker raised is now carried, and the
        readiness route reads it.
        """

        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.reranker = None
        self.app.state.reranker_error = "RERANKER_ARTIFACT_MISSING"

        response = await self.readyz()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "RERANKER_ARTIFACT_MISSING")

    def test_only_a_code_shaped_reranker_message_is_carried(self) -> None:
        """F-310 (R7-E1-06): the carried value is a code, not free text."""

        self.assertEqual(
            _reranker_error_code(RerankerUnavailableError("RERANKER_GRAPH_INVALID")),
            "RERANKER_GRAPH_INVALID",
        )
        self.assertEqual(
            _reranker_error_code(RerankerUnavailableError("a free-text failure")),
            "RERANKER_UNAVAILABLE",
        )

    def test_only_a_code_shaped_embedding_message_is_carried(self) -> None:
        """F-515 (R10-L07-4): the carried value is a code, not free text."""

        self.assertEqual(
            _embedding_error_code(ModelProbeError("EMBEDDING_PERMANENT_HTTP")),
            "EMBEDDING_PERMANENT_HTTP",
        )
        self.assertEqual(
            _embedding_error_code(ModelProbeError("EMBEDDING_TRANSPORT")),
            "EMBEDDING_TRANSPORT",
        )
        self.assertEqual(
            _embedding_error_code(httpx.ConnectError("upstream said no")),
            "EMBEDDING_MODEL_UNAVAILABLE",
        )

    def _emitted_codes(self) -> set[str]:
        """The codes the readiness route itself can answer with.

        F-515 (R10-L07-4): the embedding arm now carries the probe's code, so
        the constant it can still fall back to moved into the helper that
        computes it. The helper's own literals are part of the route's answer
        set, so they are read here too -- otherwise moving a constant one call
        down would silently retire its coverage requirement.
        """

        route = next(
            item for item in self.app.routes if getattr(item, "path", None) == "/readyz"
        )
        source = inspect.getsource(route.endpoint) + inspect.getsource(
            _embedding_error_code
        )
        return set(re.findall(r'"([A-Z][A-Z0-9_]{3,})"', source))

    async def test_the_case_matrix_covers_every_code_the_route_emits(self) -> None:
        """F-314 (R7-E2-05): the case list is the route's, not a literal five.

        A branch the route gained used to be invisible: the case table was
        a hand-copied list, so nothing compared it with the code the route
        can actually answer. The comparison is made here, so a new mapped
        branch reddens this file until it has an executed case.
        """

        self.assertEqual(self._emitted_codes(), set(COVERED_READYZ_CODES))

    async def test_the_unavailable_database_branch_answers_the_startup_code(self) -> None:
        """F-314 (R7-E2-05): the pre-try branch had no executed case.

        The branch runs before the route's try block and echoes the startup
        code the boot recorded, or a default when it recorded none.
        """

        self.app.state.database._pool = None
        self.app.state.database.startup_error_code = "MIGRATION_FAILED"
        try:
            response = await self.readyz()
        finally:
            self.app.state.database._pool = object()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "MIGRATION_FAILED")

        self.app.state.database._pool = None
        self.app.state.database.startup_error_code = None
        try:
            response = await self.readyz()
        finally:
            self.app.state.database._pool = object()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "DATABASE_UNAVAILABLE")

    async def test_a_missing_pdf_artifact_answers_its_own_code(self) -> None:
        """F-314 (R7-E2-05): the PDF runtime's missing-artifact branch.

        The identity hashes the parent lock, the runtime lock, the manifest
        and the tokenizer; a missing artifact is an unavailable PDF runtime,
        not a fault to hide behind a 500.
        """

        app = self.pdf_enabled_app()
        try:
            with patch(
                "app.main.processing_identity_for_runtime",
                side_effect=OSError("artifact missing"),
            ):
                response = await self.readyz(app)
        finally:
            await app.state.model_probe.close()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "PDF_RUNTIME_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
