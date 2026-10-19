"""R24 regression: incremental indexing is atomic via a shadow index.

A failed incremental run must never touch the live ACTIVE index, and a
successful run must prune stale sources, swap the ACTIVE pointer, and record
cleanup ids in one transaction. These tests drive the real SQL-issuing methods
against a recording fake connection so the contract holds without Postgres.
"""

from __future__ import annotations

import unittest
from pathlib import Path
from uuid import UUID, uuid4

from app.database import (
    AcceptedIndexRun,
    ActiveIndex,
    KnowledgeDatabase,
    StateTransitionError,
)


class _Transaction:
    """A transaction stand-in that RECORDS that it is open.

    F-311 (R7-E2-01): the stand-in entered and exited without recording
    anything, so the property the module docstring names as the point of
    the whole suite -- the stale, superseded, active and cleanup statements
    all committing as one unit -- was unobservable, and replacing the
    production transaction context left the suite green.
    """

    def __init__(self, connection: "FakeConnection") -> None:
        self._connection = connection

    async def __aenter__(self) -> "_Transaction":
        self._connection.transaction_depth += 1
        return self

    async def __aexit__(self, *exc: object) -> bool:
        self._connection.transaction_depth -= 1
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
        # F-311 (R7-E2-01): the transaction depth every call was issued at,
        # recorded beside the call itself.
        self.transaction_depth = 0
        self.call_depths: list[int] = []

    def is_closed(self) -> bool:
        return False

    def transaction(self) -> _Transaction:
        return _Transaction(self)

    def _record(self, verb: str, sql: str, args: tuple[object, ...]) -> None:
        self.calls.append((verb, " ".join(sql.split()), args))
        self.call_depths.append(self.transaction_depth)

    async def execute(self, sql: str, *args: object) -> None:
        self._record("execute", sql, args)

    async def executemany(self, sql: str, values: object) -> None:
        self._record("executemany", sql, (values,))

    async def fetchval(self, sql: str, *args: object) -> object:
        self._record("fetchval", sql, args)
        return self.fetchvals.pop(0)

    async def fetchrow(self, sql: str, *args: object) -> object:
        self._record("fetchrow", sql, args)
        return self.fetchrows.pop(0)

    async def fetch(self, sql: str, *args: object) -> object:
        self._record("fetch", sql, args)
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


def active_index() -> ActiveIndex:
    return ActiveIndex(
        id=str(uuid4()),
        embedding_model_name="bge-m3:latest",
        embedding_model_digest="a" * 64,
        embedding_dimensions=1024,
    )


def sql_for(connection: FakeConnection, verb: str, needle: str) -> list[tuple[str, tuple[object, ...]]]:
    return [
        (statement, args)
        for (called, statement, args) in connection.calls
        if called == verb and needle in statement
    ]


class ShadowAcceptTests(unittest.IsolatedAsyncioTestCase):
    async def test_accept_stages_a_building_shadow_cloned_from_active(self) -> None:
        active = active_index()
        connection = FakeConnection(fetchvals=[active.id])
        database = database_with(connection)

        run = await database.accept_incremental(active)

        self.assertNotEqual(run.index_id, active.id)
        self.assertEqual(run.kind, "INCREMENTAL")
        self.assertEqual(run.status, "RUNNING")
        index_insert = sql_for(connection, "execute", "INSERT INTO knowledge.indexes")
        self.assertTrue(index_insert)
        self.assertIn("'BUILDING'", index_insert[0][0])
        run_insert = sql_for(connection, "execute", "INSERT INTO knowledge.index_runs")
        self.assertIn("'INCREMENTAL'", run_insert[0][0])
        sources_clone = sql_for(connection, "execute", "INSERT INTO knowledge.sources")
        self.assertTrue(sources_clone)
        for needle in ("gen_random_uuid()", "FROM knowledge.sources", "WHERE index_id = $3"):
            self.assertIn(needle, sources_clone[0][0])
        segments_clone = sql_for(connection, "execute", "INSERT INTO knowledge.segments")
        self.assertTrue(segments_clone)
        for needle in (
            "gen_random_uuid()",
            "live.embedding",
            "live.search_vector",
            "staged.source_path = live.source_path",
        ):
            self.assertIn(needle, segments_clone[0][0])
        details_clone = sql_for(
            connection, "execute", "INSERT INTO knowledge.pdf_source_details"
        )
        self.assertTrue(details_clone)
        # Re-stamped provenance: cloned rows carry the shadow run id because the
        # indexed_by_run_id foreign key is index-scoped.
        self.assertEqual(sources_clone[0][1][1], UUID(run.id))
        self.assertEqual(segments_clone[0][1][1], UUID(run.id))

    async def test_accept_fails_closed_when_active_index_moved(self) -> None:
        active = active_index()
        connection = FakeConnection(fetchvals=[str(uuid4())])
        database = database_with(connection)

        with self.assertRaises(StateTransitionError):
            await database.accept_incremental(active)
        self.assertEqual(
            [verb for (verb, _, _) in connection.calls], ["fetchval"]
        )


class ShadowPublishTests(unittest.IsolatedAsyncioTestCase):
    def _run(self) -> AcceptedIndexRun:
        return AcceptedIndexRun(str(uuid4()), str(uuid4()), "INCREMENTAL", "RUNNING")

    def _state_row(self, run: AcceptedIndexRun) -> dict[str, object]:
        return {
            "index_id": UUID(run.index_id),
            "kind": "INCREMENTAL",
            "status": "RUNNING",
        }

    async def test_publish_prunes_swaps_and_returns_superseded_ids(self) -> None:
        run = self._run()
        superseded = uuid4()
        stale = "01. Knowledge/AI/removed.md"
        connection = FakeConnection(
            fetchvals=["BUILDING", uuid4(), superseded],
            fetchrows=[self._state_row(run)],
            fetches=[[], [{"id": superseded}]],
        )
        database = database_with(connection)

        cleanup_ids = await database.complete_incremental(run, 3, 2, {stale})

        self.assertEqual(cleanup_ids, [str(superseded)])
        delete = sql_for(connection, "execute", "DELETE FROM knowledge.sources")
        self.assertEqual(delete[0][1], (UUID(run.index_id), [stale]))
        statements = [statement for (_, statement, _) in connection.calls]
        order = [i for i, s in enumerate(statements) if "SET status = 'SUPERSEDED'" in s]
        activation = [
            i for i, s in enumerate(statements) if "SET status = 'ACTIVE', activated_at" in s
        ]
        self.assertTrue(order and activation)
        self.assertLess(order[0], activation[0])
        lock = sql_for(connection, "fetch", "WHERE status = 'ACTIVE' FOR UPDATE")
        self.assertTrue(lock)
        activate = sql_for(connection, "fetchval", "WHERE id = $1 AND status = 'BUILDING'")
        self.assertEqual(activate[0][1], (UUID(run.index_id),))

    async def test_every_statement_of_the_swap_ran_inside_the_transaction(self) -> None:
        """F-311 (R7-E2-01): the atomicity property must be observable.

        The fake recorded no transaction event, so replacing the production
        transaction context with a plain connection left the suite green:
        a crash between the supersede and the active write could leave two
        active indexes.
        """

        run = self._run()
        superseded = uuid4()
        connection = FakeConnection(
            fetchvals=["BUILDING", uuid4(), superseded],
            fetchrows=[self._state_row(run)],
            fetches=[[], [{"id": superseded}]],
        )
        database = database_with(connection)

        await database.complete_incremental(run, 3, 2, {"01. Knowledge/AI/removed.md"})

        self.assertTrue(connection.calls)
        for depth in connection.call_depths:
            self.assertGreater(
                depth, 0, "every statement of the swap must run inside the transaction"
            )

    async def test_publish_aborts_when_shadow_cannot_activate(self) -> None:
        run = self._run()
        connection = FakeConnection(
            fetchvals=["BUILDING", uuid4(), None],
            fetchrows=[self._state_row(run)],
            fetches=[[]],
        )
        database = database_with(connection)

        with self.assertRaises(StateTransitionError):
            await database.complete_incremental(run, 3, 2, set())

    async def test_publish_requires_building_shadow_not_active(self) -> None:
        run = self._run()
        connection = FakeConnection(
            fetchvals=["ACTIVE"],
            fetchrows=[self._state_row(run)],
        )
        database = database_with(connection)

        with self.assertRaises(StateTransitionError):
            await database.complete_incremental(run, 3, 2, set())


if __name__ == "__main__":
    unittest.main()
