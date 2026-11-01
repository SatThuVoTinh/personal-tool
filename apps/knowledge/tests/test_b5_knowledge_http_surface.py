"""M12/T9-R4 B5: the Knowledge HTTP surface, executed on any host.

``test_main_api.py``, ``test_m11_api_attribution.py`` and
``test_b20_readyz_attribution.py`` skip at import when the pinned tokenizer is
not provisioned, so on a host without the artifact the route behaviour they
describe is NOT RUN. The only reason they need it is ``TokenBudget``, which
hashes the pinned file in its constructor; every other dependency is already
stubbed by those modules.

This module builds the same real ``create_app`` application and replaces only
``TokenBudget``, so the route bodies execute everywhere. Each case names the
register row it pins:

  F-514 (R10-L07-3) a pool saturated at ``MAX_RERANK_CANDIDATES`` with
      ``limit`` at its ceiling must not read as a complete answer;
  F-515 (R10-L07-4) the 503 of an embedding failure carries the raised
      ``ModelProbeError`` code, and the search route records it;
  F-570 (R10-T10-1) the published result item carries the provenance the
      agent needs to re-verify a citation.
"""

from __future__ import annotations

import hashlib
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

os.environ.setdefault("KNOWLEDGE_DATABASE_PASSWORD", "unit-test-only")

import app.main as main_module
import app.pdf_runtime as pdf_runtime_module
from app.config import Settings
from app.database import ActiveIndex, SearchCandidate, SegmentRecord
from app.main import ProcessingIdentityInputs, _file_content_evidence, create_app
from app.model_probe import ModelProbeError, ResolvedEmbeddingModel
from app.retrieval import MAX_RERANK_CANDIDATES

EMBEDDING = ResolvedEmbeddingModel("bge-m3:latest", "a" * 64, 1024)
ACTIVE = ActiveIndex("index-1", "bge-m3:latest", "a" * 64, 1024)


class _Budget:
    """The only dependency that reads the pinned tokenizer artifact.

    ``TokenBudget.__init__`` hashes the artifact and refuses a mismatch, so a
    host without the file cannot construct the application at all. The route
    only needs ``count`` (the query ceiling) and the reranker's pair encoder,
    which no case here reaches.
    """

    def __init__(self, _tokenizer_path: Path) -> None:
        self.tokenizer_path = _tokenizer_path

    def count(self, _text: str) -> int:
        return 1

    def encode_pair(self, _query: str, _retrieval_text: str) -> Any:
        raise AssertionError("no case here reaches the reranker pair encoder")

    def pair_count_for_query(self, _query: str, _retrieval_text: str) -> int:
        raise AssertionError("no case here reaches the reranker pair encoder")


def _candidate(identifier: str, **overrides: Any) -> SearchCandidate:
    values: dict[str, Any] = {
        "id": identifier,
        "source_path": f"01. Knowledge/AI/{identifier}.md",
        "title": identifier,
        "primary_topic": "AI",
        "tags": ("ai",),
        "heading_path": ("Title",),
        "text": "body",
        "line_start": 3,
        "line_end": 4,
        "indexed_by_run_id": "run-1",
        "dense_distance": 0.1,
        "fts_score": 1.0,
        "source_id": "source-1",
        "source_sha256": "a" * 64,
        "canonical_topics": ("AI",),
    }
    values.update(overrides)
    return SearchCandidate(**values)


def _write_pdf_manifest(manifest: Path, lock: Path) -> None:
    """A manifest the identity loader accepts, bound to `lock`'s bytes."""

    manifest.write_text(
        json.dumps(
            {
                "artifact_digests": {},
                "distribution_versions": {},
                "locked_distribution_hashes": {},
                "hashed_requirements_digest": "0" * 64,
                "model_artifact_revisions": {},
                "pdf_runtime_lock_digest": hashlib.sha256(lock.read_bytes()).hexdigest(),
                "protocol_version": "zink:pdf-runtime-protocol:v1",
                "runner_code_digest": "0" * 64,
                "tesseract_version": "5",
                "tessdata_source_revision": "0" * 40,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ),
        encoding="utf8",
    )


class KnowledgeHttpSurface(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.vault = TemporaryDirectory()
        (Path(self.vault.name) / "01. Knowledge").mkdir()
        # `TokenBudget` is patched for the CONSTRUCTION only: the application
        # keeps the instance, and no route re-reads the artifact.
        with patch("app.main.TokenBudget", _Budget):
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
                    tokenizer_path=Path("unprovisioned-tokenizer.json"),
                )
            )
        self.app.state.database._pool = object()  # type: ignore[assignment]
        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.model_probe.resolve = AsyncMock(return_value=EMBEDDING)
        self.app.state.model_probe.embed = AsyncMock(return_value=[[0.0] * 1024])

    async def asyncTearDown(self) -> None:
        await self.app.state.model_probe.close()
        self.vault.cleanup()

    async def request(
        self, method: str, url: str, app: Any = None, **kwargs: Any
    ) -> httpx.Response:
        transport = httpx.ASGITransport(app=app or self.app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            return await client.request(method, url, **kwargs)

    def stub_candidates(self, count: int) -> None:
        self.app.state.database.search_candidates = AsyncMock(
            return_value=([_candidate(f"c{index}") for index in range(count)], [])
        )

    async def search(self, **body: Any) -> dict[str, Any]:
        payload = {"query": "topic", "rerank": False, **body}
        response = await self.request("POST", "/v1/search", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()


class SearchCompletenessTests(KnowledgeHttpSurface):
    """F-514 (R10-L07-3): a capped pool is not a complete answer."""

    async def test_a_pool_at_the_ceiling_does_not_read_as_a_complete_answer(
        self,
    ) -> None:
        self.stub_candidates(MAX_RERANK_CANDIDATES)

        body = await self.search(limit=MAX_RERANK_CANDIDATES)

        # The two page fields cannot carry the fact at this limit: the page is
        # the whole retained pool, so `has_more` is false either way.
        self.assertEqual(body["total_count"], MAX_RERANK_CANDIDATES)
        self.assertEqual(body["returned_count"], MAX_RERANK_CANDIDATES)
        self.assertFalse(body["has_more"])
        self.assertTrue(
            body.get("truncated"),
            "a pool at MAX_RERANK_CANDIDATES with limit at its ceiling states "
            "no ceiling, so a cut answer and a complete one are identical",
        )

    async def test_a_page_cut_below_the_ceiling_is_marked_truncated(self) -> None:
        self.stub_candidates(MAX_RERANK_CANDIDATES)

        body = await self.search(limit=5)

        self.assertTrue(body["has_more"])
        self.assertTrue(body["truncated"])

    async def test_a_pool_below_the_ceiling_is_not_marked_truncated(self) -> None:
        # One short of the ceiling: the cut is a comparison, not a constant.
        self.stub_candidates(MAX_RERANK_CANDIDATES - 1)

        body = await self.search(limit=MAX_RERANK_CANDIDATES)

        self.assertEqual(body["candidate_pool_count"], MAX_RERANK_CANDIDATES - 1)
        self.assertFalse(body["has_more"])
        self.assertFalse(body["truncated"])

    async def test_an_answer_below_every_ceiling_is_not_truncated(self) -> None:
        self.stub_candidates(2)

        body = await self.search(limit=MAX_RERANK_CANDIDATES)

        self.assertFalse(body["has_more"])
        self.assertFalse(
            body["truncated"],
            "a complete answer must not be reported as truncated",
        )


class EmbeddingFailureAttributionTests(KnowledgeHttpSurface):
    """F-515 (R10-L07-4): one constant cannot name an embedding failure."""

    async def search_failure(self, error: BaseException) -> httpx.Response:
        self.app.state.model_probe.embed = AsyncMock(side_effect=error)
        return await self.request(
            "POST", "/v1/search", json={"query": "topic", "rerank": False}
        )

    async def readyz_failure(self, error: BaseException) -> httpx.Response:
        self.app.state.reranker = object()
        self.app.state.model_probe.resolve = AsyncMock(side_effect=error)
        return await self.request("GET", "/readyz")

    async def test_a_permanent_provider_refusal_is_distinguishable_from_a_timeout(
        self,
    ) -> None:
        with self.assertLogs("app.main", level="ERROR") as captured:
            permanent = await self.search_failure(
                ModelProbeError("EMBEDDING_PERMANENT_HTTP")
            )
        transient = await self.search_failure(ModelProbeError("EMBEDDING_TIMEOUT"))

        self.assertEqual(permanent.status_code, 503)
        self.assertEqual(transient.status_code, 503)
        self.assertEqual(
            permanent.json()["detail"]["code"], "EMBEDDING_PERMANENT_HTTP"
        )
        self.assertEqual(transient.json()["detail"]["code"], "EMBEDDING_TIMEOUT")
        self.assertIn(
            "code=EMBEDDING_PERMANENT_HTTP",
            "\n".join(captured.output),
            "the search route must record the code the probe raised",
        )

    async def test_a_transport_failure_keeps_its_own_code(self) -> None:
        response = await self.search_failure(ModelProbeError("EMBEDDING_TRANSPORT"))

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "EMBEDDING_TRANSPORT")

    async def test_an_error_that_carries_no_code_falls_back_to_the_constant(
        self,
    ) -> None:
        # The 503 body never echoes a free-text transport message.
        response = await self.search_failure(
            httpx.ConnectError("upstream body that must not reach the caller")
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json(), {"detail": {"code": "EMBEDDING_MODEL_UNAVAILABLE"}}
        )

    async def test_readiness_answers_the_raised_embedding_code(self) -> None:
        response = await self.readyz_failure(
            ModelProbeError("EMBEDDING_PERMANENT_HTTP")
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json(), {"status": "not_ready", "code": "EMBEDDING_PERMANENT_HTTP"}
        )

    async def test_readiness_still_answers_its_generic_embedding_code(
        self,
    ) -> None:
        response = await self.readyz_failure(httpx.ConnectError("ollama down"))

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json(), {"status": "not_ready", "code": "EMBEDDING_MODEL_UNAVAILABLE"}
        )


class PublishedProvenanceTests(KnowledgeHttpSurface):
    """F-570 (R10-T10-1): the item carries what a citation needs to be checked.

    The provenance existed only inside the `citation` object, so a consumer
    that rebuilds its own item -- the governed adapter does -- had nothing to
    forward but the rendered string. A moved or edited source then produced an
    identical agent-visible citation with no digest and no span anywhere.
    """

    async def test_a_markdown_result_publishes_its_source_identity_and_line_span(
        self,
    ) -> None:
        self.stub_candidates(1)

        item = (await self.search(limit=5))["results"][0]

        self.assertEqual(item["source_id"], "source-1")
        self.assertEqual(item["source_sha256"], "a" * 64)
        self.assertEqual(item["line_start"], 3)
        self.assertEqual(item["line_end"], 4)

    async def test_a_pdf_result_publishes_its_page_span(self) -> None:
        self.app.state.database.search_candidates = AsyncMock(
            return_value=(
                [
                    _candidate(
                        "d1",
                        source_type="PDF",
                        source_path="02. Books/Authority/report.pdf",
                        line_start=None,
                        line_end=None,
                        page_start=2,
                        page_end=3,
                    )
                ],
                [],
            )
        )

        item = (await self.search(limit=5))["results"][0]

        self.assertEqual(item["source_type"], "PDF")
        self.assertEqual(item["page_start"], 2)
        self.assertEqual(item["page_end"], 3)
        self.assertIsNone(item["line_start"])
        self.assertIsNone(item["line_end"])


    async def test_the_retrieve_and_citation_items_publish_the_span_too(self) -> None:
        """A governed agent's other actions rebuild the item the same way."""

        self.app.state.database.get_segment = AsyncMock(
            return_value=SegmentRecord(
                id="segment-1",
                index_id="index-1",
                source_id="source-1",
                source_sha256="a" * 64,
                source_path="01. Knowledge/AI/note.md",
                source_type="MARKDOWN",
                source_mime_type="text/markdown",
                title="Note",
                text="body",
                heading_path=("Title",),
                primary_topic="AI",
                canonical_topics=("AI",),
                tags=("ai",),
                line_start=1,
                line_end=2,
                page_start=None,
                page_end=None,
                bbox=None,
                indexed_by_run_id="run-1",
            )
        )

        for path in ("/v1/chunk/segment-1", "/v1/citation/segment-1"):
            with self.subTest(path=path):
                response = await self.request("GET", path)

                self.assertEqual(response.status_code, 200)
                row = response.json()["results"][0]
                self.assertEqual(row["source_sha256"], "a" * 64)
                self.assertEqual(row["line_start"], 1)
                self.assertEqual(row["line_end"], 2)


class ReadyzIdentityMemoTests(KnowledgeHttpSurface):
    """F-516 (R10-L07-5): the memo key must be the identity's own input set.

    `/readyz` memoises the PDF processing identity so the probe does not rehash
    the lock, the manifest and the tokenizer on every call. The identity also
    hashes the PARENT `uv.lock` and `app/pdf_runtime.py`, and the memo key held
    only the three files that happened to appear in it, so an in-place change to
    either of the other two replayed the pre-change identity forever.
    """

    def pdf_app(self):
        root = Path(self.vault.name)
        lock = root / "pdf-runtime.lock"
        manifest = root / "pdf-runtime-manifest.json"
        tokenizer = root / "tokenizer.json"
        lock.write_text("lock\n", encoding="utf8")
        tokenizer.write_text("{}\n", encoding="utf8")
        _write_pdf_manifest(manifest, lock)
        with patch("app.main.TokenBudget", _Budget):
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
                    tokenizer_path=tokenizer,
                    pdf_runtime_enabled=True,
                    pdf_runtime_lock_path=lock,
                    pdf_runtime_manifest_path=manifest,
                )
            )
        app.state.database._pool = object()  # type: ignore[assignment]
        app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        app.state.model_probe.resolve = AsyncMock(return_value=EMBEDDING)
        app.state.reranker = object()
        app.state.pdf_runtime.probe = AsyncMock()
        return app

    async def test_the_memo_key_covers_every_file_the_identity_hashes(self) -> None:
        app = self.pdf_app()
        recorded: list[Path] = []
        original = _file_content_evidence

        def recording(path: Path) -> tuple[str, int, int]:
            recorded.append(Path(path))
            return original(path)

        try:
            with patch("app.main._file_content_evidence", recording):
                response = await self.request("GET", "/readyz", app=app)
        finally:
            await app.state.model_probe.close()

        self.assertEqual(response.status_code, 200)
        evidence_paths = {path.resolve() for path in recorded}
        # The identity hashes `Path(__file__).resolve().parents[1] / "uv.lock"`
        # and `Path(app/pdf_runtime.py)`. A key that omits either replays a stale
        # identity after an in-place change to it.
        self.assertIn(
            (Path(main_module.__file__).resolve().parents[1] / "uv.lock"),
            evidence_paths,
            "the memo key must carry evidence for the parent lock the identity hashes",
        )
        self.assertIn(
            Path(pdf_runtime_module.__file__).resolve(),
            evidence_paths,
            "the memo key must carry evidence for the client code the identity hashes",
        )


class ProcessingIdentityInputsTests(unittest.IsolatedAsyncioTestCase):
    """F-516 (R10-L07-5): the key is derived from the identity's input set."""

    def setUp(self) -> None:
        self.directory = TemporaryDirectory()
        root = Path(self.directory.name)
        self.lock = root / "pdf-runtime.lock"
        self.manifest = root / "manifest.json"
        self.tokenizer = root / "tokenizer.json"
        self.parent_lock = root / "uv.lock"
        self.client_code = root / "pdf_runtime.py"
        for path in (self.lock, self.tokenizer, self.parent_lock, self.client_code):
            path.write_text("initial\n", encoding="utf8")
        _write_pdf_manifest(self.manifest, self.lock)
        self.inputs = ProcessingIdentityInputs(
            parent_lock_path=self.parent_lock,
            runtime_lock_path=self.lock,
            manifest_path=self.manifest,
            tokenizer_path=self.tokenizer,
            client_code_path=self.client_code,
        )
    def tearDown(self) -> None:
        self.directory.cleanup()

    async def test_every_input_the_identity_uses_is_evidence_in_the_key(self) -> None:
        for path in self.inputs.paths:
            with self.subTest(path=path.name):
                before = self.inputs.evidence(ACTIVE)
                # The same path, different bytes.
                path.write_text("a shorter body\n", encoding="utf8")
                self.assertNotEqual(
                    self.inputs.evidence(ACTIVE),
                    before,
                    f"a rewrite of {path.name} must change the memo key",
                )

    async def test_the_key_moves_whenever_the_identity_value_moves(self) -> None:
        """The parent lock is the input that replayed a stale identity."""

        identity_before = self.inputs.identity(ACTIVE)
        key_before = self.inputs.evidence(ACTIVE)
        self.parent_lock.write_text("a shorter body\n", encoding="utf8")

        self.assertNotEqual(self.inputs.identity(ACTIVE), identity_before)
        self.assertNotEqual(self.inputs.evidence(ACTIVE), key_before)

    async def test_the_client_code_input_is_the_module_the_identity_hashes(
        self,
    ) -> None:
        # The default names `app/pdf_runtime.py`, which is what
        # `processing_identity_for_runtime` hashes as `Path(__file__)`.
        default_inputs = ProcessingIdentityInputs(
            parent_lock_path=self.parent_lock,
            runtime_lock_path=self.lock,
            manifest_path=self.manifest,
            tokenizer_path=self.tokenizer,
        )

        self.assertEqual(
            default_inputs.client_code_path, Path(pdf_runtime_module.__file__).resolve()
        )
        self.assertIn(default_inputs.client_code_path, default_inputs.paths)

    async def test_the_embedding_identity_is_still_part_of_the_key(self) -> None:
        other = ActiveIndex("index-1", "bge-m3:latest", "b" * 64, 1024)

        self.assertNotEqual(
            self.inputs.evidence(ACTIVE), self.inputs.evidence(other)
        )


class SegmentIdentityFieldsTests(KnowledgeHttpSurface):
    """F-KB-004: /v1/chunk, /v1/citation and /v1/metadata publish index_status and chunk_ordinal."""

    async def test_chunk_citation_and_metadata_routes_publish_index_status_and_ordinal(
        self,
    ) -> None:
        self.app.state.database.get_segment = AsyncMock(
            return_value=SegmentRecord(
                id="segment-1",
                index_id="index-1",
                source_id="source-1",
                source_sha256="a" * 64,
                source_path="01. Knowledge/AI/note.md",
                source_type="MARKDOWN",
                source_mime_type="text/markdown",
                title="Note",
                text="body",
                heading_path=("Title",),
                primary_topic="AI",
                canonical_topics=("AI",),
                tags=("ai",),
                line_start=1,
                line_end=2,
                page_start=None,
                page_end=None,
                bbox=None,
                indexed_by_run_id="run-1",
                index_status="SUPERSEDED",
                chunk_ordinal=7,
            )
        )

        for path in ("/v1/chunk/segment-1", "/v1/citation/segment-1", "/v1/metadata/segment-1"):
            with self.subTest(path=path):
                response = await self.request("GET", path)
                self.assertEqual(response.status_code, 200)
                row = response.json()["results"][0]
                self.assertEqual(row["index_status"], "SUPERSEDED")
                self.assertEqual(row["chunk_ordinal"], 7)

    async def test_zero_ordinal_and_active_status_are_retained_on_item(self) -> None:
        """0 must not be dropped as falsy."""
        self.app.state.database.get_segment = AsyncMock(
            return_value=SegmentRecord(
                id="segment-2",
                index_id="index-2",
                source_id="source-2",
                source_sha256="b" * 64,
                source_path="01. Knowledge/AI/note2.md",
                source_type="MARKDOWN",
                source_mime_type="text/markdown",
                title="Note 2",
                text="body 2",
                heading_path=("Title",),
                primary_topic="AI",
                canonical_topics=("AI",),
                tags=("ai",),
                line_start=1,
                line_end=2,
                page_start=None,
                page_end=None,
                bbox=None,
                indexed_by_run_id="run-2",
                index_status="ACTIVE",
                chunk_ordinal=0,
            )
        )

        for path in ("/v1/chunk/segment-2", "/v1/citation/segment-2", "/v1/metadata/segment-2"):
            with self.subTest(path=path):
                response = await self.request("GET", path)
                self.assertEqual(response.status_code, 200)
                row = response.json()["results"][0]
                self.assertEqual(row["index_status"], "ACTIVE")
                self.assertEqual(row["chunk_ordinal"], 0)


if __name__ == "__main__":
    unittest.main()
