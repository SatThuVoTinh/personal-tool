"""M11/T1-R1 Phase 3: knowledgebase index hygiene and error attribution.

These tests drive the real SQL-issuing methods against a recording fake
connection (the pattern established by `test_r24_atomic_incremental_index.py`)
so the contracts hold without Postgres, Ollama, or a tokenizer artifact:

  3.1 a FAILED index keeps its row and loses its content, both at failure time
      and in the startup sweep, idempotently;
  3.3 the timeout type asyncpg's ``command_timeout`` raises is in the error
      union the API maps to 503 (the pinned interpreter fact is asserted
      unconditionally; the union itself lives in ``app.main``);
  3.4 one document publishes its segments through one batched statement;
  3.5 a PDF-rooted source path survives the run-error sanitizer;
  3.7 a readiness probe reports PDF_RUNTIME_BUSY rather than queueing behind an
      in-flight extraction, while index runs keep waiting;
  3.8 a source that disappears mid-scan is attributed, not fatal.

The route-level parts (scheduling failure, 503 mapping, ``min_score``) need
``app.main``, which builds a real ``TokenBudget`` at import time, so they live
in ``test_m11_api_attribution.py`` behind the tokenizer gate the other API
suites use.
"""

from __future__ import annotations

import asyncio
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID, uuid4

from app.database import AcceptedIndexRun, KnowledgeDatabase
from app.database import PdfPublicationSegment
from app.markdown_adapter import (
    MarkdownSegment,
    MarkdownSource,
    MarkdownVaultScanner,
)
from app.pdf_runtime import PdfRuntimeClient, PdfRuntimeError, PdfRuntimeSettings
from app.run_errors import SafeRunError, deserialize_errors, serialize_errors


class _Transaction:
    async def __aenter__(self) -> "_Transaction":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class FakeConnection:
    def __init__(
        self,
        fetchvals: list[object] | None = None,
        fetchrows: list[object] | None = None,
        fetches: list[object] | None = None,
    ) -> None:
        self.fetchvals = fetchvals or []
        self.fetchrows = fetchrows or []
        self.fetches = fetches or []
        self.calls: list[tuple[str, str, tuple[object, ...]]] = []

    def is_closed(self) -> bool:
        return False

    def transaction(self) -> _Transaction:
        return _Transaction()

    async def execute(self, sql: str, *args: object) -> None:
        self.calls.append(("execute", " ".join(sql.split()), args))

    async def executemany(self, sql: str, values: object) -> None:
        self.calls.append(("executemany", " ".join(sql.split()), (values,)))

    async def fetchval(self, sql: str, *args: object) -> object:
        self.calls.append(("fetchval", " ".join(sql.split()), args))
        return self.fetchvals.pop(0)

    async def fetchrow(self, sql: str, *args: object) -> object:
        self.calls.append(("fetchrow", " ".join(sql.split()), args))
        return self.fetchrows.pop(0)

    async def fetch(self, sql: str, *args: object) -> object:
        self.calls.append(("fetch", " ".join(sql.split()), args))
        return self.fetches.pop(0)


def database_with(connection: FakeConnection) -> KnowledgeDatabase:
    database = KnowledgeDatabase(
        "localhost",
        5432,
        "knowledge",
        "zink",
        "secret",
        Path("migrations"),
    )
    database._pool = object()  # type: ignore[assignment]
    database._owner_connection = connection  # type: ignore[assignment]
    return database


def statements(connection: FakeConnection, verb: str = "execute") -> list[str]:
    return [statement for (called, statement, _) in connection.calls if called == verb]


def deletes(connection: FakeConnection) -> list[tuple[str, tuple[object, ...]]]:
    return [
        (statement, args)
        for (called, statement, args) in connection.calls
        if called == "execute" and statement.startswith("DELETE FROM knowledge.")
    ]


def running_run(kind: str = "INCREMENTAL") -> AcceptedIndexRun:
    return AcceptedIndexRun(str(uuid4()), str(uuid4()), kind, "RUNNING")


def run_row(run: AcceptedIndexRun) -> dict[str, object]:
    return {"index_id": UUID(run.index_id), "kind": run.kind, "status": "RUNNING"}


FAILED_INDEX_CONTENT = (
    "DELETE FROM knowledge.segments WHERE index_id = ANY($1::uuid[])",
    "DELETE FROM knowledge.pdf_source_details WHERE index_id = ANY($1::uuid[])",
    "DELETE FROM knowledge.sources WHERE index_id = ANY($1::uuid[])",
)


class FailedIndexGarbageCollectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_fail_run_purges_the_failed_index_content(self) -> None:
        run = running_run()
        connection = FakeConnection(
            fetchrows=[run_row(run)],
            fetchvals=["BUILDING", uuid4(), uuid4()],
        )
        database = database_with(connection)

        await database.fail_run(
            run, "SCAN_FAILED", [SafeRunError("SCAN_FAILED")], 3, 1, 2, True
        )

        # `fail_run` uses fetchval for the UPDATE ... RETURNING statements and
        # execute for the purge, so the ordering check spans both verbs.
        ordered = [
            statement
            for (called, statement, _) in connection.calls
            if called in {"execute", "fetchval"}
        ]
        content = deletes(connection)
        self.assertEqual([statement for statement, _ in content], list(FAILED_INDEX_CONTENT))
        for _, args in content:
            self.assertEqual(args, ([UUID(run.index_id)],))
        # The forensic row and the run history must survive the purge.
        self.assertNotIn("DELETE FROM knowledge.indexes", ordered)
        self.assertNotIn("DELETE FROM knowledge.index_runs", ordered)
        marked_failed = [
            index
            for index, statement in enumerate(ordered)
            if "SET status = 'FAILED', failed_at = now(), failure_code = $2" in statement
        ]
        finished_run = [
            index
            for index, statement in enumerate(ordered)
            if "UPDATE knowledge.index_runs SET status = 'FAILED'" in statement
        ]
        purge = min(
            ordered.index(statement) for statement, _ in content
        )
        self.assertTrue(marked_failed and finished_run)
        self.assertLess(marked_failed[0], purge)
        self.assertLess(purge, finished_run[0])

    async def test_fail_run_keeps_content_while_the_index_is_still_building(self) -> None:
        run = running_run()
        connection = FakeConnection(
            fetchrows=[run_row(run)],
            fetchvals=[uuid4()],
        )
        database = database_with(connection)

        await database.fail_run(
            run, "DOCUMENT_INDEXING_FAILED", [SafeRunError("DOCUMENT_INDEXING_FAILED")], 3, 1, 2, False
        )

        self.assertEqual(deletes(connection), [])

    async def test_purge_is_idempotent_and_skips_an_empty_sweep(self) -> None:
        empty = FakeConnection()
        await KnowledgeDatabase._purge_index_content(empty, [])
        self.assertEqual(empty.calls, [])

        index_id = uuid4()
        connection = FakeConnection()
        for _ in range(2):
            await KnowledgeDatabase._purge_index_content(connection, [index_id])
        self.assertEqual(
            statements(connection), list(FAILED_INDEX_CONTENT) * 2
        )

    async def test_cleanup_sweep_prunes_failed_content_without_superseded_ids(self) -> None:
        stale = uuid4()
        connection = FakeConnection(fetches=[[{"id": stale}]])
        database = database_with(connection)

        await database.cleanup_superseded([])

        sweep = [
            statement
            for statement in statements(connection, "fetch")
            if "WHERE status = 'FAILED'" in statement
        ]
        self.assertTrue(sweep)
        content = deletes(connection)
        self.assertEqual([statement for statement, _ in content], list(FAILED_INDEX_CONTENT))
        for _, args in content:
            self.assertEqual(args, ([stale],))

    async def test_startup_recovery_prunes_content_of_interrupted_shadows(self) -> None:
        index_id = uuid4()
        connection = FakeConnection(
            fetches=[
                [{"id": uuid4(), "index_id": index_id, "kind": "FULL_REBUILD"}],
                [{"id": index_id}],
            ]
        )
        database = database_with(connection)

        recovered = await database.recover_interrupted_runs()

        self.assertEqual(recovered, 1)
        content = deletes(connection)
        self.assertEqual([statement for statement, _ in content], list(FAILED_INDEX_CONTENT))
        for _, args in content:
            self.assertEqual(args, ([index_id],))


class TimeoutClassificationPinTests(unittest.TestCase):
    def test_asyncio_timeout_is_the_builtin_the_union_already_lists(self) -> None:
        # M11/T1-R1 3.3 (H7 mitigation): asyncpg's `command_timeout` and
        # `asyncio.wait_for` both raise `asyncio.TimeoutError`. This identity is
        # what makes the builtin entry in `main.DATABASE_ERRORS` cover them; if
        # an interpreter or a union edit ever breaks it, a statement timeout
        # turns back into a raw 500.
        self.assertIs(asyncio.TimeoutError, TimeoutError)

    def test_timeout_is_a_database_error_for_the_api(self) -> None:
        # This was skipped unless KNOWLEDGE_TOKENIZER_PATH was set, because
        # `app.main` built a TokenBudget at import and so importing a plain
        # constant needed the pinned artifact. Running here is the direct proof
        # that `R6-I01-01` is closed.
        from app.main import DATABASE_ERRORS

        self.assertIn(asyncio.TimeoutError, DATABASE_ERRORS)

    def test_the_module_app_resolves_lazily_and_only_for_app(self) -> None:
        import app.main as main_module

        with self.assertRaises(AttributeError):
            main_module.no_such_module_attribute

        # Without the artifact the construction call must still be *reached*: it
        # fails as a tokenizer problem, never as a missing attribute. The success
        # path is covered in CI, where `test_main_api.py` imports and drives the
        # real `app`.
        if not os.environ.get("KNOWLEDGE_TOKENIZER_PATH"):
            with self.assertRaises(Exception) as caught:
                main_module.app
            self.assertNotIsInstance(
                caught.exception,
                AttributeError,
                "`.app` must dispatch to create_app, not report a missing attribute",
            )


def markdown_source(name: str, segments: int) -> MarkdownSource:
    return MarkdownSource(
        source_path=f"01. Knowledge/AI/{name}.md",
        sha256="a" * 64,
        mime_type="text/markdown",
        title=name,
        primary_topic="AI",
        canonical_topics=("AI",),
        tags=("ai",),
        segments=tuple(
            MarkdownSegment(
                chunk_ordinal,
                f"body {chunk_ordinal}",
                "Title",
                ("Title",),
                f"Title\n\nbody {chunk_ordinal}",
                1 + chunk_ordinal,
                2 + chunk_ordinal,
                1,
                2,
            )
            for chunk_ordinal in range(segments)
        ),
    )


class SegmentInsertBatchingTests(unittest.IsolatedAsyncioTestCase):
    async def test_one_document_publishes_its_segments_in_one_batch(self) -> None:
        run = running_run()
        source = markdown_source("batched", 3)
        connection = FakeConnection(
            fetchrows=[run_row(run)],
            fetchvals=["BUILDING"],
        )
        database = database_with(connection)

        await database.replace_source(
            run, source, [[0.5, 0.25], [0.75, 1.0], [1.25, 1.5]]
        )

        batched = [
            (statement, args)
            for (called, statement, args) in connection.calls
            if called == "executemany" and "INSERT INTO knowledge.segments" in statement
        ]
        self.assertEqual(len(batched), 1)
        statement, (rows,) = batched[0]
        self.assertEqual(len(rows), 3)
        for column in (
            "id, index_id, source_id, segment_type, chunk_ordinal, source_path",
            "heading_text, text, line_start, line_end, embedding, search_vector",
            "indexed_by_run_id",
            "$15::vector",
            "setweight(to_tsvector('simple', $6), 'A')",
        ):
            self.assertIn(column, statement)
        self.assertEqual({row[1] for row in rows}, {UUID(run.index_id)})
        self.assertEqual({row[2] for row in rows}, {rows[0][2]})
        self.assertEqual([row[3] for row in rows], [0, 1, 2])
        self.assertEqual(rows[0][14], "[0.5,0.25]")
        self.assertEqual({row[15] for row in rows}, {UUID(run.id)})
        self.assertEqual([len(row) for row in rows], [16, 16, 16])
        # No per-segment single-row insert remains.
        self.assertFalse(
            [
                statement
                for (called, statement, _) in connection.calls
                if called == "execute" and "INSERT INTO knowledge.segments" in statement
            ]
        )


class PdfSourcePathAttributionTests(unittest.TestCase):
    def test_pdf_roots_survive_the_sanitizer(self) -> None:
        for path in (
            "02. Books/Authority/report.pdf",
            "03. Papers/venue/preprint.pdf",
            "Archives/scan/legacy.pdf",
            "01. Knowledge/AI/note.md",
        ):
            with self.subTest(path=path):
                detail = serialize_errors(
                    [SafeRunError("DOCUMENT_INDEXING_FAILED", path)]
                )
                errors = deserialize_errors(detail)["errors"]
                self.assertEqual([entry["source_path"] for entry in errors], [path])

    def test_unknown_roots_and_traversal_are_still_dropped(self) -> None:
        for path in (
            "04. Scratch/note.md",
            "02. Books/../../secret.pdf",
            "02. Books//report.pdf",
        ):
            with self.subTest(path=path):
                detail = serialize_errors(
                    [SafeRunError("DOCUMENT_INDEXING_FAILED", path)]
                )
                errors = deserialize_errors(detail)["errors"]
                self.assertEqual([entry["source_path"] for entry in errors], [None])


class _VanishingMd(Path):
    """A source that existed for the scan but is gone when its size is probed."""

    def resolve(self, strict: bool = True) -> Path:
        return self

    def stat(self, **kwargs: object) -> os.stat_result:
        raise OSError(2, "No such file or directory")

    def read_bytes(self) -> bytes:
        raise AssertionError("a vanished source must not be read")


def pdf_client() -> PdfRuntimeClient:
    root = Path(".")
    return PdfRuntimeClient(
        PdfRuntimeSettings(
            python=root / "python",
            module="zink_pdf_runtime",
            vault_root=root / "vault",
            artifacts_root=root / "artifacts",
            manifest_path=root / "manifest.json",
            lock_path=root / "runtime.lock",
            tesseract_binary=root / "tesseract",
            tessdata_path=root / "tessdata",
            temp_root=root / "tmp",
        )
    )


class ReadinessLockTimeoutTests(unittest.IsolatedAsyncioTestCase):
    async def test_probe_reports_busy_instead_of_queueing_behind_a_job(self) -> None:
        client = pdf_client()
        deadline = asyncio.get_running_loop().time() + 5.0
        async with client._invocation_lock:
            with self.assertRaises(PdfRuntimeError) as busy:
                await client.probe("d" * 64, deadline, lock_timeout=0.01)

        self.assertEqual(busy.exception.code, "PDF_RUNTIME_BUSY")

    async def test_a_busy_probe_leaves_the_holders_lock_untouched(self) -> None:
        # The timeout path acquires outside `async with`, so it must not be able
        # to release a lock that belongs to an in-flight extraction.
        client = pdf_client()
        deadline = asyncio.get_running_loop().time() + 5.0
        async with client._invocation_lock:
            for _ in range(2):
                with self.assertRaises(PdfRuntimeError):
                    await client.probe("d" * 64, deadline, lock_timeout=0.01)
            self.assertTrue(client._invocation_lock.locked())
        self.assertFalse(client._invocation_lock.locked())

    async def test_index_runs_still_wait_for_the_invocation_lock(self) -> None:
        client = pdf_client()
        released = asyncio.Event()

        async def holder() -> None:
            async with client._invocation_lock:
                await released.wait()

        task = asyncio.create_task(holder())
        await asyncio.sleep(0)
        probe = asyncio.create_task(
            # No lock_timeout: acquisition waits. The deadline has already
            # passed, so the run-side caller surfaces its own timeout code only
            # after it has been handed the lock.
            client.probe("d" * 64, asyncio.get_running_loop().time() - 1.0)
        )
        await asyncio.sleep(0.05)
        self.assertFalse(probe.done())
        released.set()
        with self.assertRaises(PdfRuntimeError) as timed_out:
            await probe
        self.assertEqual(timed_out.exception.code, "PDF_RUNTIME_TIMEOUT")
        await task


class DisappearedSourceAttributionTests(unittest.TestCase):
    def test_stat_failure_is_attributed_to_the_source(self) -> None:
        with TemporaryDirectory() as directory:
            vault = Path(directory)
            knowledge = vault / "01. Knowledge"
            knowledge.mkdir()
            scanner = MarkdownVaultScanner(token_budget=None)  # type: ignore[arg-type]
            candidate = _VanishingMd(knowledge / "AI" / "gone.md")

            source, errors = scanner._validate_source(vault, knowledge, candidate)

        self.assertIsNone(source)
        self.assertEqual([error.code for error in errors], ["SOURCE_READ_FAILED"])
        self.assertEqual(errors[0].source_path, "01. Knowledge/AI/gone.md")


if __name__ == "__main__":
    unittest.main()
