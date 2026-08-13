from __future__ import annotations

import asyncio
import unittest
from pathlib import Path

from app.database import AcceptedIndexRun, ActiveIndex
from app.index_lifecycle import IndexLifecycle, LifecycleDependencies
from app.index_runner import IndexRunCoordinator
from app.markdown_adapter import (
    MarkdownScanResult,
    MarkdownSegment,
    MarkdownSource,
    MarkdownValidationError,
)
from app.model_probe import ResolvedEmbeddingModel


EXPECTED = ActiveIndex("index-1", "bge-m3:latest", "a" * 64, 1024)
DRIFTED = ResolvedEmbeddingModel("bge-m3:latest", "b" * 64, 1024)
MATCHING = ResolvedEmbeddingModel("bge-m3:latest", "a" * 64, 1024)


def source(name: str, digest: str) -> MarkdownSource:
    segment = MarkdownSegment(0, "body", "Title", ("Title",), "Title\n\nbody", 1, 2, 1, 2)
    return MarkdownSource(
        f"01. Knowledge/AI/{name}.md",
        digest,
        "text/markdown",
        name,
        "AI",
        ("AI",),
        ("ai",),
        (segment,),
    )


class FakeScanner:
    def __init__(self, *sources: MarkdownSource) -> None:
        self.result = MarkdownScanResult(True, len(sources), len(sources), sources, ())

    def scan_vault(
        self, _: Path, *, include_valid_sources_on_error: bool = False
    ) -> MarkdownScanResult:
        return self.result


class FakeProbe:
    def __init__(self, identities: list[ResolvedEmbeddingModel]) -> None:
        self.identities = identities
        self.resolve_calls = 0
        self.embed_calls = 0

    async def resolve(self, _: str) -> ResolvedEmbeddingModel:
        identity = self.identities[min(self.resolve_calls, len(self.identities) - 1)]
        self.resolve_calls += 1
        return identity

    async def embed(self, _: str, texts: list[str]) -> list[list[float]]:
        self.embed_calls += 1
        return [[0.0] * 1024 for _ in texts]


class FakeDatabase:
    def __init__(self, existing: dict[str, str] | None = None) -> None:
        self.existing = existing or {}
        self.replaced: list[str] = []
        self.fail_replace_for: set[str] = set()
        self.failures: list[tuple[tuple[object, ...], dict[str, object]]] = []
        self.completed = False
        self.published = False

    async def get_index(self, _: str) -> ActiveIndex:
        return EXPECTED

    async def set_discovered(self, _: str, __: int) -> None:
        return None

    async def source_hashes(self, _: str) -> dict[str, str]:
        return self.existing

    async def get_active_index(self) -> ActiveIndex:
        return EXPECTED

    async def source_count(self, _: str) -> int:
        return len(self.existing)

    async def replace_source(
        self, _: AcceptedIndexRun, item: MarkdownSource, __: list[list[float]]
    ) -> None:
        if item.source_path in self.fail_replace_for:
            raise RuntimeError("database detail must not escape")
        self.replaced.append(item.source_path)

    async def complete_incremental(self, *_: object) -> None:
        self.completed = True

    async def publish_full_rebuild(self, *_: object) -> list[str]:
        self.published = True
        return ["old-index"]

    async def fail_run(self, *args: object, **kwargs: object) -> None:
        self.failures.append((args, kwargs))

    async def cleanup_superseded(self, _: list[str]) -> None:
        return None


def lifecycle(database: FakeDatabase, probe: FakeProbe, scanner: FakeScanner) -> IndexLifecycle:
    return IndexLifecycle(
        LifecycleDependencies(
            database=database,  # type: ignore[arg-type]
            model_probe=probe,  # type: ignore[arg-type]
            scanner=scanner,  # type: ignore[arg-type]
            vault_root=Path("/vault"),
            embedding_model="bge-m3:latest",
            embedding_dimensions=1024,
        )
    )


class IndexLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_incremental_model_drift_after_embedding_stops_the_run(self) -> None:
        item = source("drift", "new")
        database = FakeDatabase()
        probe = FakeProbe([MATCHING, DRIFTED])

        result = await lifecycle(database, probe, FakeScanner(item)).execute(
            AcceptedIndexRun("run-1", EXPECTED.id, "INCREMENTAL", "RUNNING")
        )

        self.assertEqual(result, [])
        self.assertFalse(database.completed)
        self.assertEqual(database.failures[0][0][1], "EMBEDDING_MODEL_DRIFT")
        self.assertEqual(database.failures[0][0][5], 0)
        self.assertIsNone(database.failures[0][0][2][0].source_path)

    async def test_document_database_failure_keeps_processing_but_defers_deletion(self) -> None:
        broken = source("broken", "new-1")
        healthy = source("healthy", "new-2")
        old_path = "01. Knowledge/AI/moved.md"
        database = FakeDatabase({old_path: "old"})
        database.fail_replace_for.add(broken.source_path)

        await lifecycle(database, FakeProbe([MATCHING]), FakeScanner(broken, healthy)).execute(
            AcceptedIndexRun("run-1", EXPECTED.id, "INCREMENTAL", "RUNNING")
        )

        self.assertEqual(database.replaced, [healthy.source_path])
        self.assertFalse(database.completed)
        self.assertEqual(database.failures[0][0][1], "SOURCE_INDEXING_FAILED")
        self.assertEqual(database.failures[0][0][4], 1)
        self.assertEqual(database.failures[0][0][5], 1)

    async def test_unchanged_incremental_still_runs_final_identity_gate(self) -> None:
        item = source("unchanged", "same")
        database = FakeDatabase({item.source_path: item.sha256})
        probe = FakeProbe([DRIFTED])

        await lifecycle(database, probe, FakeScanner(item)).execute(
            AcceptedIndexRun("run-1", EXPECTED.id, "INCREMENTAL", "RUNNING")
        )

        self.assertEqual(probe.embed_calls, 0)
        self.assertFalse(database.completed)
        self.assertEqual(database.failures[0][0][1], "EMBEDDING_MODEL_DRIFT")

    async def test_incremental_commits_valid_sources_but_defers_deletion_on_parse_error(self) -> None:
        healthy = source("healthy", "new")
        scanner = FakeScanner(healthy)
        scanner.result = MarkdownScanResult(
            False,
            2,
            1,
            (healthy,),
            (
                MarkdownValidationError(
                    "01. Knowledge/AI/broken.md",
                    "MALFORMED_FRONTMATTER",
                    "must never enter failure_detail",
                ),
            ),
        )
        database = FakeDatabase({"01. Knowledge/AI/old.md": "old"})

        await lifecycle(database, FakeProbe([MATCHING]), scanner).execute(
            AcceptedIndexRun("run-1", EXPECTED.id, "INCREMENTAL", "RUNNING")
        )

        self.assertEqual(database.replaced, [healthy.source_path])
        self.assertFalse(database.completed)
        self.assertEqual(database.failures[0][0][1], "SCAN_FAILED")
        self.assertEqual(database.failures[0][0][4], 1)
        self.assertEqual(database.failures[0][0][5], 1)

    async def test_full_rebuild_document_failure_fails_building_index(self) -> None:
        item = source("broken", "new")
        database = FakeDatabase()
        database.fail_replace_for.add(item.source_path)

        await lifecycle(database, FakeProbe([MATCHING]), FakeScanner(item)).execute(
            AcceptedIndexRun("run-1", EXPECTED.id, "FULL_REBUILD", "RUNNING")
        )

        self.assertFalse(database.published)
        self.assertEqual(database.failures[0][0][1], "DOCUMENT_INDEXING_FAILED")
        self.assertTrue(database.failures[0][1]["fail_index"])

    async def test_final_identity_drift_blocks_full_rebuild_publication(self) -> None:
        item = source("valid", "new")
        database = FakeDatabase()

        await lifecycle(
            database,
            FakeProbe([MATCHING, MATCHING, DRIFTED]),
            FakeScanner(item),
        ).execute(AcceptedIndexRun("run-1", EXPECTED.id, "FULL_REBUILD", "RUNNING"))

        self.assertEqual(database.replaced, [item.source_path])
        self.assertFalse(database.published)
        self.assertEqual(database.failures[0][0][1], "EMBEDDING_MODEL_DRIFT")
        self.assertTrue(database.failures[0][1]["fail_index"])

    async def test_empty_full_rebuild_still_runs_final_identity_gate(self) -> None:
        database = FakeDatabase()

        await lifecycle(database, FakeProbe([DRIFTED]), FakeScanner()).execute(
            AcceptedIndexRun("run-1", EXPECTED.id, "FULL_REBUILD", "RUNNING")
        )

        self.assertFalse(database.published)
        self.assertEqual(database.failures[0][0][1], "EMBEDDING_MODEL_DRIFT")
        self.assertTrue(database.failures[0][1]["fail_index"])


class FakeCoordinatorDatabase:
    available = True

    def __init__(self) -> None:
        self.events: list[str] = []

    async def acquire_advisory_lock(self, _: int) -> object:
        return object()

    async def release_advisory_lock(self, _: object, __: int) -> None:
        self.events.append("release")


class IndexRunCoordinatorTests(unittest.IsolatedAsyncioTestCase):
    async def test_cleanup_starts_only_after_advisory_lock_release(self) -> None:
        database = FakeCoordinatorDatabase()
        coordinator = IndexRunCoordinator(database, 7)  # type: ignore[arg-type]
        cleanup_done = asyncio.Event()

        async def work() -> list[str]:
            database.events.append("terminal-commit")
            return ["old-index"]

        async def cleanup(_: list[str]) -> None:
            database.events.append("cleanup")
            cleanup_done.set()

        await coordinator.reserve()
        await coordinator.schedule(work, cleanup)
        await asyncio.wait_for(cleanup_done.wait(), timeout=1)
        await coordinator.stop()

        self.assertEqual(database.events, ["terminal-commit", "release", "cleanup"])
