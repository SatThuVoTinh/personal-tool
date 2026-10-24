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
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import asyncpg
from asyncpg.exceptions import DuplicateTableError

from app.database import AcceptedIndexRun, KnowledgeDatabase
from app.database import PdfPublicationSegment
from app.database import StateTransitionError
from app.index_runner import IndexRunCoordinator
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

# F-093 (R5-E03-04): the content build carries the whole extracted text and
# its provenance jsonb, and no cascade reaches it, so a build whose last
# published source detail is gone was pure retention. The statement is
# separate from the per-index deletes because it is keyed by BUILD id, not by
# index id: it must never reclaim a build another index still publishes.
RETIRED_PDF_BUILD_STATEMENT = (
    "DELETE FROM knowledge.pdf_content_builds b WHERE b.id = ANY($1::uuid[]) "
    "AND NOT EXISTS (SELECT 1 FROM knowledge.pdf_source_details d WHERE d.build_id = b.id)"
)


# F-443 (R9-T06-1): the sweep that retires FAILED builds is not keyed by index
# id either -- the residue belongs to an identity whose run failed, so no
# surviving index id names it. It is separated from the per-index deletes for
# the same reason as the build retirement above.
TERMINAL_PDF_BUILD_SWEEP = (
    "DELETE FROM knowledge.pdf_content_builds b WHERE b.status = 'FAILED' "
    "AND NOT EXISTS (SELECT 1 FROM knowledge.pdf_source_details d "
    "WHERE d.build_id = b.id)"
)

BUILD_RETENTION_STATEMENTS = frozenset(
    {RETIRED_PDF_BUILD_STATEMENT, TERMINAL_PDF_BUILD_SWEEP}
)


def index_deletes(connection: FakeConnection) -> list[tuple[str, tuple[object, ...]]]:
    """The per-index deletes, without the build-retention sweeps."""

    return [
        (statement, args)
        for (statement, args) in deletes(connection)
        if statement not in BUILD_RETENTION_STATEMENTS
    ]


class FailedIndexGarbageCollectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_fail_run_purges_the_failed_index_content(self) -> None:
        run = running_run()
        build_id = uuid4()
        connection = FakeConnection(
            fetchrows=[run_row(run)],
            fetchvals=["BUILDING", uuid4(), uuid4()],
            fetches=[[{"build_id": build_id}]],
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
        content = index_deletes(connection)
        self.assertEqual([statement for statement, _ in content], list(FAILED_INDEX_CONTENT))
        for _, args in content:
            self.assertEqual(args, ([UUID(run.index_id)],))
        # F-093 (R5-E03-04): the content build the failed index published is
        # reclaimed with its extracted text, and it is keyed by build id.
        retired = [
            args
            for (statement, args) in deletes(connection)
            if statement == RETIRED_PDF_BUILD_STATEMENT
        ]
        self.assertEqual(retired, [([build_id],)])
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
        build_id = uuid4()
        connection = FakeConnection(fetches=[[{"build_id": build_id}], [{"build_id": build_id}]])
        for _ in range(2):
            await KnowledgeDatabase._purge_index_content(connection, [index_id])
        self.assertEqual(
            [statement for statement, _ in index_deletes(connection)],
            list(FAILED_INDEX_CONTENT) * 2,
        )
        retired = [
            args
            for (statement, args) in deletes(connection)
            if statement == RETIRED_PDF_BUILD_STATEMENT
        ]
        self.assertEqual(retired, [([build_id],), ([build_id],)])

    async def test_cleanup_sweep_prunes_failed_content_without_superseded_ids(self) -> None:
        stale = uuid4()
        build_id = uuid4()
        connection = FakeConnection(
            fetches=[[{"id": stale}], [{"build_id": build_id}]]
        )
        database = database_with(connection)

        await database.cleanup_superseded([])

        sweep = [
            statement
            for statement in statements(connection, "fetch")
            if "WHERE status = 'FAILED'" in statement
        ]
        self.assertTrue(sweep)
        content = index_deletes(connection)
        self.assertEqual([statement for statement, _ in content], list(FAILED_INDEX_CONTENT))
        for _, args in content:
            self.assertEqual(args, ([stale],))

    async def test_a_publish_reclaims_the_retired_content_build(self) -> None:
        """F-093 (R5-E03-04): the retired build kept its whole extracted text.

        A PDF that was edited or removed leaves the previous content build
        behind: its row carries every extracted segment and its provenance
        jsonb, and the foreign key from `pdf_source_details` forbids any
        cascade from reaching it. The publish that supersedes the old index
        is where that build is released, and the delete is guarded so a build
        another index still publishes is never reclaimed.
        """

        superseded = uuid4()
        build_id = uuid4()
        connection = FakeConnection(fetches=[[{"build_id": build_id}], []])
        database = database_with(connection)

        await database.cleanup_superseded([str(superseded)])

        retired = [
            (statement, args)
            for (statement, args) in deletes(connection)
            if statement == RETIRED_PDF_BUILD_STATEMENT
        ]
        self.assertEqual(retired, [(RETIRED_PDF_BUILD_STATEMENT, ([build_id],))])
        # The guard is the whole safety of the delete: a build that another
        # index still publishes must survive the reclamation of this one.
        self.assertIn("NOT EXISTS", RETIRED_PDF_BUILD_STATEMENT)
        self.assertIn("knowledge.pdf_source_details", RETIRED_PDF_BUILD_STATEMENT)

    async def test_startup_recovery_prunes_content_of_interrupted_shadows(self) -> None:
        index_id = uuid4()
        build_id = uuid4()
        connection = FakeConnection(
            fetches=[
                [{"id": uuid4(), "index_id": index_id, "kind": "FULL_REBUILD"}],
                [{"id": index_id}],
                [{"build_id": build_id}],
            ]
        )
        database = database_with(connection)

        recovered = await database.recover_interrupted_runs()

        self.assertEqual(recovered, 1)
        content = index_deletes(connection)
        self.assertEqual([statement for statement, _ in content], list(FAILED_INDEX_CONTENT))
        for _, args in content:
            self.assertEqual(args, ([index_id],))


class OwnerGenerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_stale_run_cannot_write_inside_a_newer_owners_session(self) -> None:
        """F-255 (R7-D10A-03): the owner slot is mutable.

        Every lifecycle mutation resolved the owner connection from
        `self._owner_connection` at CALL time, so a run whose own owner had
        been released opened its transaction on the connection a NEWER
        generation had bound and interleaved its writes with that
        generation's. The run is now pinned to the connection it was
        scheduled with, and a run whose owner is no longer the bound one
        refuses before it executes a single statement.
        """

        database = KnowledgeDatabase(
            "localhost", 5432, "knowledge", "zink", "secret", Path("migrations")
        )
        database._pool = FakePool(FakeConnection())  # type: ignore[assignment]
        first = FakeConnection()
        second = FakeConnection()
        coordinator = IndexRunCoordinator(database, 7)
        database.bind_owner_connection(first)
        coordinator._reservation = first  # type: ignore[assignment]

        started = asyncio.Event()
        release = asyncio.Event()
        failures: list[BaseException] = []

        async def work() -> list[str]:
            started.set()
            await release.wait()
            try:
                await database.set_discovered(str(uuid4()), 1)
            except BaseException as error:  # noqa: BLE001 - the outcome is asserted
                failures.append(error)
            return []

        async def cleanup(_: list[str]) -> None:
            return None

        await coordinator.schedule(work, cleanup)
        await asyncio.wait_for(started.wait(), timeout=1)
        # A newer generation reserves the lock and binds its own connection
        # while the older run is still scheduled.
        database.unbind_owner_connection(first)
        database.bind_owner_connection(second)
        release.set()
        for task in list(coordinator._run_tasks):
            await asyncio.wait_for(asyncio.shield(task), timeout=1)

        self.assertEqual(len(failures), 1)
        self.assertIsInstance(failures[0], StateTransitionError)
        self.assertEqual(str(failures[0]), "Index ownership connection was lost.")
        # Nothing was written on either connection: the refusal happens
        # before the first statement. The only statement the first
        # connection sees is the advisory unlock the coordinator issues when
        # the run ends.
        writes = [
            call for call in first.calls if call[1] != "SELECT pg_advisory_unlock($1)"
        ]
        self.assertEqual(writes, [])
        self.assertEqual(second.calls, [])
        await coordinator.stop()


class ReplayMigrationConnection:
    """A connection whose migration execution fails with duplicate_table.

    F-166 (R5-E03-01): the catalog answers the existence questions the
    runner asks with the `existing` set, so the case under test is the
    replay of a migration the catalog already owns.
    """

    def __init__(self, existing: set[str]) -> None:
        self.existing = existing
        self.calls: list[tuple[str, str, tuple[object, ...]]] = []
        self.versions: list[str] = []

    def is_closed(self) -> bool:
        return False

    def transaction(self) -> _Transaction:
        return _Transaction()

    async def execute(self, sql: str, *args: object) -> None:
        normalized = " ".join(sql.split())
        self.calls.append(("execute", normalized, args))
        if normalized.startswith("INSERT INTO knowledge.schema_migrations"):
            self.versions.append(str(args[0]))
            return
        if normalized.startswith("CREATE SCHEMA") or "knowledge.schema_migrations (" in normalized:
            return
        raise DuplicateTableError("relation already exists")

    async def fetchval(self, sql: str, *args: object) -> object:
        normalized = " ".join(sql.split())
        self.calls.append(("fetchval", normalized, args))
        if "knowledge.schema_migrations WHERE version" in normalized:
            return False
        return str(args[-1]) in self.existing


class MigrationReplayTests(unittest.IsolatedAsyncioTestCase):
    MIGRATION = (
        "CREATE TABLE knowledge.widgets (id uuid PRIMARY KEY);\n"
        "CREATE UNIQUE INDEX knowledge_widgets_idx ON knowledge.widgets (id);\n"
    )

    def database(self, directory: str) -> KnowledgeDatabase:
        database = KnowledgeDatabase(
            "localhost", 5432, "knowledge", "zink", "secret", Path(directory)
        )
        database._pool = object()  # type: ignore[assignment]
        return database

    async def test_a_replayed_migration_is_recorded_instead_of_aborting_the_boot(self) -> None:
        """F-166 (R5-E03-01): the replay aborted on duplicate_table.

        The `schema_migrations` row is the only record that a migration ran,
        so a repaired version row, a dump that excluded the table or a
        renamed file replayed the set against a catalog that already owned
        its objects. `002` creates its tables and indexes without
        `IF NOT EXISTS`, the whole migration transaction rolled back and the
        boot reported DATABASE_UNAVAILABLE. The listed migration files may
        not be edited in place, so the RUNNER recognises the replay.
        """

        with TemporaryDirectory() as directory:
            Path(directory, "001_widgets.sql").write_text(self.MIGRATION, encoding="utf-8")
            database = self.database(directory)
            connection = ReplayMigrationConnection({"widgets", "knowledge_widgets_idx"})

            await database._apply_migrations(owner_connection=connection)  # type: ignore[arg-type]

            self.assertEqual(connection.versions, ["001_widgets.sql"])

    async def test_a_migration_whose_objects_are_missing_still_aborts_the_boot(self) -> None:
        """F-166 (R5-E03-01): a partial catalog is a fault, not a replay.

        The replay is only recognised when EVERY object the file creates is
        already in the catalog. A schema that owns one of the two objects
        is drifted, and swallowing that would leave the boot claiming a
        migration ran when it did not.
        """

        with TemporaryDirectory() as directory:
            Path(directory, "001_widgets.sql").write_text(self.MIGRATION, encoding="utf-8")
            database = self.database(directory)
            connection = ReplayMigrationConnection({"widgets"})

            with self.assertRaises(asyncpg.PostgresError):
                await database._apply_migrations(owner_connection=connection)  # type: ignore[arg-type]

            self.assertEqual(connection.versions, [])


class FakePool:
    """The pool surface `KnowledgeDatabase` uses, recorded."""

    def __init__(self, connection: FakeConnection) -> None:
        self.connection = connection
        self.acquired = 0
        self.released: list[FakeConnection] = []
        self.closed = False

    async def acquire(self) -> FakeConnection:
        self.acquired += 1
        return self.connection

    async def release(self, connection: FakeConnection) -> None:
        self.released.append(connection)

    async def close(self) -> None:
        self.closed = True

    async def fetch(self, sql: str, *args: object) -> object:
        return await self.connection.fetch(sql, *args)

    async def fetchrow(self, sql: str, *args: object) -> object:
        return await self.connection.fetchrow(sql, *args)

    async def fetchval(self, sql: str, *args: object) -> object:
        return await self.connection.fetchval(sql, *args)


class StartupSweepAndLockTests(unittest.IsolatedAsyncioTestCase):
    async def test_the_startup_sweep_is_chunked(self) -> None:
        """F-092 (R5-E03-03): one statement carried every failed index id.

        The pool runs every statement under a 30 s `command_timeout`, so a
        full-corpus shadow put thousands of ids into one DELETE and the
        whole sweep either finished or aborted with no partial progress.
        """

        ids = [uuid4() for _ in range(1200)]
        connection = FakeConnection(
            fetches=[[{"build_id": uuid4()}] for _ in range(3)]
        )

        await KnowledgeDatabase._purge_index_content(connection, ids)

        content = index_deletes(connection)
        self.assertEqual(len(content), 9)
        for statement, args in content:
            self.assertLessEqual(len(args[0]), 500)
        covered = {value for _, args in content for value in args[0]}
        self.assertEqual(covered, set(ids))
        retired = [
            args
            for (statement, args) in deletes(connection)
            if statement == RETIRED_PDF_BUILD_STATEMENT
        ]
        self.assertEqual(len(retired), 3)

    async def test_the_schema_is_applied_under_the_advisory_lock(self) -> None:
        """F-149 (R5-E03-02): the DDL used to run unserialized.

        Two replicas booting together ran CREATE EXTENSION and CREATE TYPE
        against one catalog; the loser raised duplicate_object and the
        operator read it as "the database is down".
        """

        connection = FakeConnection(fetchvals=[True, True, True], fetches=[[]])
        pool = FakePool(connection)
        database = KnowledgeDatabase(
            "localhost", 5432, "knowledge", "zink", "secret", Path("migrations")
        )
        with patch("app.database.asyncpg.create_pool", new=AsyncMock(return_value=pool)):
            await database.start()

        self.assertIsNone(database.startup_error_code)
        ordered = [statement for (called, statement, _) in connection.calls if called == "execute"]
        lock = next(
            index for index, statement in enumerate(ordered) if "pg_advisory_lock" in statement
        )
        schema = next(
            index for index, statement in enumerate(ordered) if "CREATE SCHEMA" in statement
        )
        self.assertLess(lock, schema, "the DDL must run under the lock")
        self.assertTrue(
            any("pg_advisory_unlock" in statement for statement in ordered)
        )

    async def test_a_failed_boot_re_attempts_and_runs_the_recovery(self) -> None:
        """F-164 (R5-E01-04): the failure used to be a process-lifetime flag.

        The pool was nulled, nothing reopened it, and the interrupted-run
        recovery -- the repair the operator most needs -- was skipped for the
        life of the process, so the service answered 503 until an external
        restart.
        """

        connection = FakeConnection(fetchvals=[True, True, True], fetches=[[]])
        pool = FakePool(connection)
        database = KnowledgeDatabase(
            "localhost", 5432, "knowledge", "zink", "secret", Path("migrations")
        )
        recovered: list[str] = []

        async def recovery() -> None:
            recovered.append("recovered")

        database.set_recovery_callback(recovery)
        attempts: list[int] = []

        async def create_pool(*_args: object, **_kwargs: object) -> FakePool:
            attempts.append(1)
            if len(attempts) == 1:
                raise RuntimeError("postgres is not up yet")
            return pool

        with patch(
            "app.database.asyncpg.create_pool",
            new=AsyncMock(side_effect=create_pool),
        ), patch("app.database.RECONNECT_INTERVAL_SECONDS", 0.01):
            await database.start()
            self.assertEqual(database.startup_error_code, "DATABASE_UNAVAILABLE")
            for _ in range(100):
                if database.available:
                    break
                await asyncio.sleep(0.02)
            was_available = database.available
            error_code = database.startup_error_code
            await database.stop()

        self.assertGreaterEqual(len(attempts), 2)
        self.assertTrue(was_available)
        self.assertEqual(recovered, ["recovered"])
        self.assertIsNone(error_code)

    async def test_a_schema_lock_timeout_is_named_not_reported_as_an_outage(
        self,
    ) -> None:
        """F-149 (R5-E03-02): a schema race is not "the database is down"."""

        connection = FakeConnection()
        original_execute = connection.execute

        async def failing_execute(sql: str, *args: object) -> None:
            await original_execute(sql, *args)
            if "pg_advisory_lock" in sql:
                raise asyncio.TimeoutError()

        connection.execute = failing_execute  # type: ignore[method-assign]
        pool = FakePool(connection)
        database = KnowledgeDatabase(
            "localhost", 5432, "knowledge", "zink", "secret", Path("migrations")
        )
        with patch("app.database.asyncpg.create_pool", new=AsyncMock(return_value=pool)):
            await database.start()
            self.assertEqual(database.startup_error_code, "MIGRATION_LOCK_UNAVAILABLE")
            self.assertNotEqual(database.startup_error_code, "DATABASE_UNAVAILABLE")
            # F-412 (R9-L08-2): the lock arm now schedules a re-attempt, so the
            # case must retire the task it started instead of leaking it.
            await database.stop()

    async def test_a_boot_that_loses_the_schema_lock_re_attempts(self) -> None:
        """F-412 (R9-L08-2): the lock arm aborted without a re-attempt.

        The generic arm started the reconnect loop; the `MigrationLockError`
        arm only set its code and aborted, so a replica that lost the
        advisory-lock race to an index run answered 503 for the life of the
        process even after the lock (held for seconds) was released.
        """

        connection = FakeConnection(fetchvals=[True, True])
        original_execute = connection.execute
        lock_attempts: list[int] = []

        async def failing_execute(sql: str, *args: object) -> None:
            await original_execute(sql, *args)
            if "pg_advisory_lock" in sql:
                lock_attempts.append(1)
                if len(lock_attempts) == 1:
                    raise asyncio.TimeoutError()

        connection.execute = failing_execute  # type: ignore[method-assign]
        pool = FakePool(connection)
        database = KnowledgeDatabase(
            "localhost", 5432, "knowledge", "zink", "secret", Path("migrations")
        )
        pool_attempts: list[int] = []

        async def create_pool(*_args: object, **_kwargs: object) -> FakePool:
            pool_attempts.append(1)
            return pool

        with patch(
            "app.database.asyncpg.create_pool",
            new=AsyncMock(side_effect=create_pool),
        ), patch("app.database.RECONNECT_INTERVAL_SECONDS", 0.01):
            await database.start()
            self.assertEqual(database.startup_error_code, "MIGRATION_LOCK_UNAVAILABLE")
            for _ in range(100):
                if database.startup_error_code is None:
                    break
                await asyncio.sleep(0.02)
            was_available = database.available
            error_code = database.startup_error_code
            await database.stop()

        self.assertGreaterEqual(
            len(lock_attempts),
            2,
            "the lock arm must re-enter the schema lock the generic arm re-acquires",
        )
        self.assertGreaterEqual(len(pool_attempts), 2)
        self.assertTrue(was_available)
        self.assertIsNone(error_code)

    async def test_a_failed_recovery_is_retried_until_it_succeeds(self) -> None:
        """F-413 (R9-L08-3): the sweep failure was logged and dropped.

        The interrupted RUNNING row survives a failed sweep, and the unique
        one-running index refuses every later run while `readyz` stays
        healthy. The sweep is idempotent, so the loop repeats it.
        """

        connection = FakeConnection(fetchvals=[True, True], fetches=[[]])
        pool = FakePool(connection)
        database = KnowledgeDatabase(
            "localhost", 5432, "knowledge", "zink", "secret", Path("migrations")
        )
        recoveries: list[int] = []

        async def recovery() -> None:
            recoveries.append(1)
            if len(recoveries) == 1:
                raise RuntimeError("the sweep aborted on a database error")

        database.set_recovery_callback(recovery)
        attempts: list[int] = []

        async def create_pool(*_args: object, **_kwargs: object) -> FakePool:
            attempts.append(1)
            if len(attempts) == 1:
                raise RuntimeError("postgres is not up yet")
            return pool

        with patch(
            "app.database.asyncpg.create_pool",
            new=AsyncMock(side_effect=create_pool),
        ), patch("app.database.RECONNECT_INTERVAL_SECONDS", 0.01):
            await database.start()
            for _ in range(200):
                if len(recoveries) >= 2:
                    break
                await asyncio.sleep(0.02)
            was_available = database.available
            error_code = database.startup_error_code
            await database.stop()

        self.assertEqual(
            len(recoveries),
            2,
            "a failed sweep must be re-attempted, not logged and dropped",
        )
        self.assertTrue(was_available)
        self.assertIsNone(error_code)

    async def test_a_failed_lock_query_releases_the_connection(self) -> None:
        """F-254 (R7-D10A-02): four leaks exhausted the pool."""

        connection = FakeConnection()

        async def failing_fetchval(sql: str, *args: object) -> object:
            raise RuntimeError("dead backend")

        connection.fetchval = failing_fetchval  # type: ignore[method-assign]
        pool = FakePool(connection)
        database = KnowledgeDatabase(
            "localhost", 5432, "knowledge", "zink", "secret", Path("migrations")
        )
        database._pool = pool  # type: ignore[assignment]

        with self.assertRaises(RuntimeError):
            await database.acquire_advisory_lock(1)

        self.assertEqual(len(pool.released), 1)
        self.assertEqual(pool.acquired, 1)

    async def test_the_barrier_poll_runs_off_the_event_loop(self) -> None:
        """F-189 (R5-E16-04): the barrier blocked the loop that serves /search.

        The continuation poll ran its file operations synchronously inside
        an `async def`, up to ten times a second for up to ten minutes.
        """

        with TemporaryDirectory() as directory:
            resolved = Path(directory)
            token = "a" * 64
            (resolved / "continue").write_text(token, encoding="ascii")
            database = KnowledgeDatabase(
                "localhost", 5432, "knowledge", "zink", "secret", Path("migrations")
            )
            dispatched: list[str] = []
            original = asyncio.to_thread

            async def spy(func, /, *args, **kwargs):
                dispatched.append(getattr(func, "__name__", str(func)))
                return await original(func, *args, **kwargs)

            with patch("asyncio.to_thread", side_effect=spy):
                await database._await_backup_barrier_continuation(
                    resolved, token, asyncio.get_running_loop().time() + 5
                )

            self.assertIn("exists", dispatched)
            self.assertIn("read_text", dispatched)
            self.assertTrue((resolved / "completed").is_file())

    async def test_the_pdf_publish_uses_one_batched_statement(self) -> None:
        """F-257 (R7-D10A-05): the PDF path inserted one row per segment."""

        run = running_run()
        connection = FakeConnection(
            fetchrows=[run_row(run)],
            fetchvals=["BUILDING", uuid4()],
        )
        database = database_with(connection)
        segments = [
            PdfPublicationSegment(0, "PDF_PASSAGE", "first", 1, 1, None),
            PdfPublicationSegment(1, "PDF_PASSAGE", "second", 2, 2, None),
        ]
        embeddings = [[0.0] * 1024, [0.0] * 1024]

        await database.replace_pdf_source(
            run,
            source_path="02. Books/report.pdf",
            content_identity_digest="a" * 64,
            title="Report",
            canonical_topics=("AI",),
            tags=("ai",),
            build_id=str(uuid4()),
            segments=segments,
            embeddings=embeddings,
        )

        inserts = [
            call
            for call in connection.calls
            if call[0] == "executemany" and "INSERT INTO knowledge.segments" in call[1]
        ]
        self.assertEqual(len(inserts), 1)
        self.assertEqual(len(inserts[0][2][0]), 2)


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
