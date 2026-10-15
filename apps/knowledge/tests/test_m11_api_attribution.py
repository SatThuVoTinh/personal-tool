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
      filtering on the RRF path.

No database, Ollama, or PDF runtime is contacted: every external seam is
patched on the app's own state objects.
"""

from __future__ import annotations

import asyncio
import os
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
)
from app.main import create_app
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

    async def test_min_score_does_not_filter_the_rrf_path(self) -> None:
        self.app.state.database.get_active_index = AsyncMock(return_value=ACTIVE)
        self.app.state.database.search_candidates = AsyncMock(
            return_value=([candidate("a"), candidate("b")], [])
        )

        response = await self.request(
            "POST",
            "/v1/search",
            json={"query": "topic", "rerank": False, "min_score": 0.5},
        )

        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        # RRF scores are order 1e-2, so thresholding them with a reranker score
        # used to empty every page. The field is still reported.
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


if __name__ == "__main__":
    unittest.main()
