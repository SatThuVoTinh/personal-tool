"""M11/T1-R1 Phase 3: API-level attribution and scoring contracts.

These are the route-level halves of the Phase 3 fixes; they need the real
``app.main`` application, so they carry the same tokenizer gate as
``test_main_api.py`` (the pinned image provides ``/app/artifacts/tokenizer.json``).

  3.2 a run that never reached the scheduler fails its shadow index for every
      kind, not FULL_REBUILD only;
  3.3 a statement timeout is a database outage to the API, never a raw 500;
  3.5 a PDF-rooted failure keeps its ``source_path`` through the index-run
      route;
  3.6 ``min_score`` thresholds reranker scores only, and reports without
      filtering on the RRF path;
  B-13 (M12/T2.2-R2) the search request model bounds the query, so an oversized
      body is refused before it can take a capacity slot or be tokenized.

No database, Ollama, or PDF runtime is contacted: every external seam is
patched on the app's own state objects.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock

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
from app.database import (
    AcceptedIndexRun,
    ActiveIndex,
    IndexRunState,
    SearchCandidate,
    SegmentRecord,
)
from app.main import (
    QUERY_EMBEDDING_TIMEOUT_SECONDS,
    SEARCH_CAPACITY_RETRY_AFTER_SECONDS,
    SEARCH_QUERY_MAX_CHARS,
    create_app,
)
from app.markdown_adapter import QUERY_BUDGET_FIXTURE, QUERY_MAX_TOKENS
from app.model_probe import ResolvedEmbeddingModel
from app.run_errors import SafeRunError, serialize_errors

EMBEDDING = ResolvedEmbeddingModel("bge-m3:latest", "a" * 64, 1024)
ACTIVE = ActiveIndex("index-1", "bge-m3:latest", "a" * 64, 1024)


def candidate(identifier: str) -> SearchCandidate:
    return SearchCandidate(
        id=identifier,
        source_path=f"01. Knowledge/AI/{identifier}.md",
        title=identifier,
        primary_topic="AI",
        tags=("ai",),
        heading_path=("Title",),
        text="body",
        line_start=1,
        line_end=2,
        indexed_by_run_id="run-1",
        dense_distance=0.1,
        fts_score=1.0,
        # F-072 (R5-E02-02): the immutable source identity travels with every
        # candidate.
        source_id="source-1",
        source_sha256="a" * 64,
        canonical_topics=("AI",),
    )


class FakeReranker:
    def __init__(self, logits: list[float]) -> None:
        self.logits = logits
        self.requests: list[list[tuple[str, str]]] = []

    async def predict(self, pairs: list[tuple[str, str]]) -> list[float]:
        self.requests.append(pairs)
        return self.logits


class ApiAttributionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.vault = TemporaryDirectory()
        (Path(self.vault.name) / "01. Knowledge").mkdir()
        self.settings = Settings(
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
        self.app = create_app(self.settings)
        self.app.state.database._pool = object()  # type: ignore[assignment]
        self.app.state.model_probe.resolve = AsyncMock(return_value=EMBEDDING)
        self.app.state.model_probe.embed = AsyncMock(return_value=[[0.0] * 1024])
        self.app.state.coordinator.reserve = AsyncMock()
        self.app.state.coordinator.release_reservation = AsyncMock()

    async def asyncTearDown(self) -> None:
        await self.app.state.model_probe.close()
        self.vault.cleanup()

    async def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        transport = httpx.ASGITransport(app=self.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, url, **kwargs)

    async def test_incremental_scheduling_failure_fails_its_shadow_index(self) -> None:
        accepted = AcceptedIndexRun("run-1", "shadow-1", "INCREMENTAL", "RUNNING")
        database = self.app.state.database
        database.get_active_index = AsyncMock(return_value=ACTIVE)
        database.accept_incremental = AsyncMock(return_value=accepted)
        database.fail_run = AsyncMock()
        self.app.state.coordinator.schedule = AsyncMock(
            side_effect=RuntimeError("scheduler is closed")
        )

        response = await self.request(
            "POST", "/v1/index-runs", json={"kind": "INCREMENTAL"}
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "SCHEDULING_FAILED")
        # M11/T1-R1 3.2 (K-09): INCREMENTAL runs in a shadow BUILDING index too,
        # so leaving that index BUILDING with cloned content and no owner is no
        # longer possible.
        # fail_run(accepted, code, errors, discovered, indexed, failed,
        # fail_index) — the seventh positional argument is the flag.
        self.assertTrue(database.fail_run.await_args.args[6])

    async def test_statement_timeout_is_reported_as_a_database_outage(self) -> None:
        database = self.app.state.database
        database.get_active_index = AsyncMock(side_effect=asyncio.TimeoutError())

        response = await self.request(
            "POST", "/v1/index-runs", json={"kind": "FULL_REBUILD"}
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "DATABASE_UNAVAILABLE")

    async def test_index_run_route_keeps_pdf_source_attribution(self) -> None:
        detail = serialize_errors(
            [SafeRunError("DOCUMENT_INDEXING_FAILED", "02. Books/Authority/report.pdf")]
        )
        self.app.state.database.get_run = AsyncMock(
            return_value=IndexRunState(
                id="run-1",
                index_id="index-1",
                kind="INCREMENTAL",
                status="FAILED",
                started_at="2026-10-12T00:00:00Z",
                finished_at="2026-10-12T00:01:00Z",
                sources_discovered=2,
                sources_indexed=0,
                sources_failed=1,
                failure_code="DOCUMENT_INDEXING_FAILED",
                failure_detail=detail,
            )
        )
        self.app.state.database.get_run_source_counts = AsyncMock(return_value=[])

        response = await self.request("GET", "/v1/index-runs/run-1")

        self.assertEqual(response.status_code, 200)
        errors = response.json()["failure"]["errors"]
        self.assertEqual(
            [entry["source_path"] for entry in errors],
            ["02. Books/Authority/report.pdf"],
        )

    async def test_the_three_advertised_actions_resolve_to_a_route(self) -> None:
        """F-071 (R1-A16-07): three advertised actions had no server route.

        `retrieve`, `citation` and `metadata` are advertised to the model,
        so the citation round trip ended in an HTTP 404 and the surviving
        citations could not be tied to the run that produced them.
        """

        record = SegmentRecord(
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
        self.app.state.database.get_segment = AsyncMock(return_value=record)

        for path, action in (
            ("/v1/chunk/segment-1", "retrieve"),
            ("/v1/citation/segment-1", "citation"),
            ("/v1/metadata/segment-1", "metadata"),
        ):
            with self.subTest(action=action):
                response = await self.request("GET", path)

                self.assertEqual(response.status_code, 200)
                body = response.json()
                self.assertEqual(body["action"], action)
                self.assertEqual(body["index_id"], "index-1")
                self.assertEqual(body["indexed_by_run_id"], "run-1")
                row = body["results"][0]
                self.assertEqual(row["segment_id"], "segment-1")
                self.assertEqual(row["source_id"], "source-1")
                self.assertEqual(row["source_sha256"], "a" * 64)
                self.assertTrue(row["citation"])

    async def test_an_unknown_segment_is_refused_with_a_named_code(self) -> None:
        """F-071 (R1-A16-07): a missing chunk is named, not a bare 404."""

        self.app.state.database.get_segment = AsyncMock(return_value=None)

        response = await self.request("GET", "/v1/chunk/segment-1")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"]["code"], "SEGMENT_NOT_FOUND")

    async def test_every_search_result_carries_the_immutable_source_identity(
        self,
    ) -> None:
        """F-072 (R5-E02-02): a path is not an identity.

        A file can be moved or edited and keep its path, and an index run
        covers thousands of files, so neither identifies the revision an
        answer was produced from.
        """

        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.database.search_candidates = AsyncMock(
            return_value=([candidate("a")], [])
        )

        response = await self.request(
            "POST", "/v1/search", json={"query": "topic", "rerank": False}
        )

        self.assertEqual(response.status_code, 200)
        item = response.json()["results"][0]
        self.assertEqual(item["source_id"], "source-1")
        self.assertEqual(item["source_sha256"], "a" * 64)
        self.assertEqual(item["citation"]["source_sha256"], "a" * 64)
        self.assertEqual(item["citation"]["source_id"], "source-1")

    async def test_a_failed_startup_sweep_is_named_and_does_not_stop_the_service(
        self,
    ) -> None:
        """F-092 (R5-E03-03) and F-101 (R5-E01-05).

        The startup sweep deletes the published content of indexes that are
        already FAILED. A sweep that fails must be NAMED and must not stop
        the service from becoming ready; the next attempt repeats it,
        because deleting the same rows again is a no-op.
        """

        class _Pool:
            async def close(self) -> None:
                return None

        database = self.app.state.database
        database.start = AsyncMock()
        database._pool = _Pool()  # type: ignore[assignment]
        self.app.state.coordinator.recover_startup = AsyncMock(
            side_effect=RuntimeError("sweep failed")
        )

        with self.assertLogs("app.main", level="ERROR") as captured:
            async with self.app.router.lifespan_context(self.app):
                pass

        joined = "\n".join(captured.output)
        self.assertIn("STARTUP_RECOVERY_INCOMPLETE", joined)

    async def test_the_documented_response_keys_exist(self) -> None:
        """F-357 (R7-OC2-02): the walkthrough read fields the service never returns.

        The operator walkthrough was written against an assumed response
        shape: `$status.state`, `$results.hits`, `$hit.document_title` and
        `$hit.score` are not keys any handler returns, so a reader who copied
        it enumerated a null collection and printed nothing.
        """

        readme = (Path(__file__).resolve().parents[1] / "README.md").read_text(
            encoding="utf-8"
        )
        documented = sorted(set(re.findall(r"\$(\w+)\.(\w+)", readme)))
        self.assertTrue(documented, "the walkthrough must read something")

        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.database.search_candidates = AsyncMock(
            return_value=([candidate("a")], [])
        )
        search = await self.request(
            "POST", "/v1/search", json={"query": "topic", "rerank": False}
        )
        body = search.json()
        allowed = (
            set(body)
            | set(body["results"][0])
            | set(body["results"][0]["citation"])
        )
        detail = serialize_errors([SafeRunError("SCAN_FAILED")])
        self.app.state.database.get_run = AsyncMock(
            return_value=IndexRunState(
                id="run-1",
                index_id="index-1",
                kind="INCREMENTAL",
                status="FAILED",
                started_at="2026-10-12T00:00:00Z",
                finished_at="2026-10-12T00:01:00Z",
                sources_discovered=2,
                sources_indexed=0,
                sources_failed=1,
                failure_code="SCAN_FAILED",
                failure_detail=detail,
            )
        )
        self.app.state.database.get_run_source_counts = AsyncMock(return_value=[])
        run = await self.request("GET", "/v1/index-runs/run-1")
        allowed |= set(run.json())

        for variable, key in documented:
            with self.subTest(variable=variable, key=key):
                self.assertIn(
                    key,
                    allowed,
                    f"the walkthrough reads ${variable}.{key}, which no handler returns",
                )

    async def test_min_score_on_the_rrf_path_is_refused(self) -> None:
        """F-012 (R5-E02-03): a threshold that cannot be enforced is refused.

        The M11/T1-R1 fix kept `min_score` off the RRF path by gating the
        filter on `reranked`, but the same branch reported the fused RRF rank
        score under the name `rerank_score`. The caller therefore received
        200 with two hits and every `rerank_score` far below the threshold it
        had asked to enforce -- an unenforceable threshold that read as
        enforced.
        """

        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.database.search_candidates = AsyncMock(
            return_value=([candidate("a"), candidate("b")], [])
        )

        response = await self.request(
            "POST",
            "/v1/search",
            json={"query": "topic", "rerank": False, "min_score": 0.5},
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.json(), {"detail": {"code": "INVALID_SEARCH_REQUEST"}}
        )

    async def test_the_rrf_path_does_not_label_a_fused_score_as_a_rerank_score(
        self,
    ) -> None:
        """F-012 (R5-E02-03): only a reranker produces a rerank score."""

        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.database.search_candidates = AsyncMock(
            return_value=([candidate("a"), candidate("b")], [])
        )

        response = await self.request(
            "POST", "/v1/search", json={"query": "topic", "rerank": False}
        )

        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        self.assertEqual([item["segment_id"] for item in results], ["a", "b"])
        self.assertTrue(all(item["rerank_score"] < 0.5 for item in results))

    async def test_min_score_still_filters_reranked_results(self) -> None:
        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.database.search_candidates = AsyncMock(
            return_value=([candidate("a"), candidate("b")], [])
        )
        self.app.state.reranker = FakeReranker([-5.0, 5.0])

        unfiltered = await self.request("POST", "/v1/search", json={"query": "topic"})
        filtered = await self.request(
            "POST", "/v1/search", json={"query": "topic", "min_score": 0.5}
        )

        self.assertEqual(unfiltered.status_code, 200)
        self.assertEqual(
            [item["segment_id"] for item in unfiltered.json()["results"]], ["b", "a"]
        )
        self.assertEqual(
            [item["segment_id"] for item in filtered.json()["results"]], ["b"]
        )

    async def test_oversized_query_is_refused_before_a_slot_or_the_tokenizer(
        self,
    ) -> None:
        """M12/T2.2-R2 B-13 (4A.14 / R5-E01-03).

        ``/v1/search`` acquires a ``SearchCapacityLimiter`` slot as its first
        act and only counts tokens afterwards, so the 256-token ceiling bounded
        the OUTCOME of an arbitrarily large body while the event loop paid to
        tokenize it. The request model now refuses the size outright.
        """
        self.stub_search_route()
        counts: list[str] = []
        budget = self.app.state.token_budget
        original_count = budget.count
        budget.count = lambda text: (counts.append(text), original_count(text))[1]
        acquired: list[bool] = []
        original_acquire = self.app.state.search_limiter.try_acquire

        async def spy_acquire():
            acquired.append(True)
            return await original_acquire()

        self.app.state.search_limiter.try_acquire = spy_acquire

        response = await self.request(
            "POST", "/v1/search", json={"query": "a" * (SEARCH_QUERY_MAX_CHARS + 1)}
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.json(), {"detail": {"code": "INVALID_SEARCH_REQUEST"}}
        )
        self.assertEqual(
            counts, [], "the tokenizer must never be handed a body validation refused"
        )
        self.assertEqual(
            acquired,
            [],
            "a body rejected at validation must not consume one of two capacity slots",
        )

    async def test_queries_at_and_under_the_bound_still_reach_the_token_ceiling(
        self,
    ) -> None:
        self.stub_search_route()

        # The field bounds the WORK, not the semantic ceiling: the longest
        # accepted body is the bound itself, and the 511-character fixture is
        # exactly QUERY_MAX_TOKENS, so the existing check stays the authority.
        for query in ("a" * SEARCH_QUERY_MAX_CHARS, QUERY_BUDGET_FIXTURE):
            with self.subTest(length=len(query)):
                response = await self.request(
                    "POST", "/v1/search", json={"query": query, "rerank": False}
                )
                self.assertEqual(response.status_code, 200)

        self.assertEqual(
            self.app.state.token_budget.count(QUERY_BUDGET_FIXTURE),
            QUERY_MAX_TOKENS,
            "the ceiling this item must not move",
        )

    def stub_search_route(self) -> None:
        database = self.app.state.database
        database.get_active_index = AsyncMock(return_value=ACTIVE)
        database.search_candidates = AsyncMock(return_value=([candidate("a")], []))
        # A live reranker, so an oversized body would reach the tokenizer if the
        # request model let it through. Without this the `counts` witness above
        # would pass for the wrong reason: the route stops at RERANKER_UNAVAILABLE.
        self.app.state.reranker = FakeReranker([5.0])


if __name__ == "__main__":
    unittest.main()
