"""F-443 (R9-T06-1): a FAILED content build carries text no sweep can reach.

Retention is a lifecycle status on a content-addressed row, and both cleanup
paths named their candidate builds from `knowledge.pdf_source_details`. A row
in that table can only exist for a READY build -- the foreign key is
`(build_id, build_status)` with `build_status = 'READY'` -- so a build that
ended FAILED never entered it, and the ONLY handle every sweep takes is that
table. One incremental run over a PDF whose previous build ended FAILED
commits a fresh BUILDING-to-FAILED build plus its whole batch set that no path
can name again: the identity is legal to build again the moment it is
terminal, because `002` makes the uniqueness partial over
`('BUILDING', 'READY')`.

These cases record the writer's statements (the pattern the rest of the lane
uses) and pin:
  - the sweep that retires terminal builds by lifecycle state and absence of
    a link, without consulting the table that cannot see them;
  - that it runs at both sweep entry points a long-lived process reaches
    (post-run cleanup and startup recovery);
  - that it never retires a CANCELLED build, because that row is the owner's
    reclamation RECORD (F-444 reads it back), not residue.
"""

from __future__ import annotations

import unittest
from pathlib import Path
from uuid import uuid4

from app.database import KnowledgeDatabase

# F-443: the statement the sweep issues. Keyed by lifecycle state, guarded by
# the absence of a link so a build another index still publishes can never be
# taken.
TERMINAL_PDF_BUILD_SWEEP = (
    "DELETE FROM knowledge.pdf_content_builds b WHERE b.status = 'FAILED' "
    "AND NOT EXISTS (SELECT 1 FROM knowledge.pdf_source_details d "
    "WHERE d.build_id = b.id)"
)


class _Transaction:
    async def __aenter__(self) -> "_Transaction":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class FakeConnection:
    """The connection surface `KnowledgeDatabase` uses, recorded."""

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
        "localhost", 5432, "knowledge", "zink", "secret", Path("migrations")
    )
    database._pool = object()  # type: ignore[assignment]
    database._owner_connection = connection  # type: ignore[assignment]
    return database


def build_sweeps(connection: FakeConnection) -> list[str]:
    """Every delete this writer issued against the content-build table."""

    return [
        statement
        for (called, statement, _) in connection.calls
        if called == "execute"
        and statement.startswith("DELETE FROM knowledge.pdf_content_builds")
    ]


class TerminalPdfBuildSweepTests(unittest.IsolatedAsyncioTestCase):
    async def test_post_run_cleanup_retires_terminal_builds_the_links_cannot_name(
        self,
    ) -> None:
        """The per-run sweep is where a long-lived process can reach them.

        Nothing else in the process runs on a schedule: the only two sweep
        entry points are the cleanup after a published run and the startup
        recovery.
        """

        connection = FakeConnection(fetches=[[]])
        database = database_with(connection)

        await database.cleanup_superseded([])

        sweeps = build_sweeps(connection)
        self.assertEqual(sweeps, [TERMINAL_PDF_BUILD_SWEEP])

    async def test_startup_recovery_retires_terminal_builds(self) -> None:
        connection = FakeConnection(fetches=[[], []])
        database = database_with(connection)

        await database.recover_interrupted_runs()

        self.assertEqual(build_sweeps(connection), [TERMINAL_PDF_BUILD_SWEEP])

    async def test_the_sweep_keeps_the_reclamation_record(self) -> None:
        """A CANCELLED build IS the owner's retention decision (F-444).

        `pdf_content_is_reclaimed` reads the terminal CANCELLED build back to
        decide that a reclaimed PDF must not be derived again. A sweep that
        treated "terminal" as one class would delete that record and let the
        next incremental run re-extract the copy the owner reclaimed.
        """

        connection = FakeConnection(fetches=[[]])
        database = database_with(connection)

        await database.cleanup_superseded([])

        (statement,) = build_sweeps(connection)
        self.assertIn("status = 'FAILED'", statement)
        self.assertNotIn("CANCELLED", statement)
        # The guard, not the state alone, is what keeps a published build:
        # a FAILED build can never be linked (the detail FK demands READY),
        # so the absence of a link is the residue test.
        self.assertIn("knowledge.pdf_source_details", statement)

    async def test_the_sweep_is_not_bound_to_a_superseded_index(self) -> None:
        """The residue belongs to no index, so no index id may gate it.

        The build that accumulates was created for a PDF whose run FAILED; the
        index it named was marked FAILED with it, and its content purged. A
        sweep keyed by index id would need the very id the failed index no
        longer carries a link for.
        """

        superseded = uuid4()
        connection = FakeConnection(fetches=[[{"build_id": uuid4()}], []])
        database = database_with(connection)

        await database.cleanup_superseded([str(superseded)])

        sweeps = build_sweeps(connection)
        self.assertEqual(len(sweeps), 2, sweeps)
        self.assertEqual(sweeps[-1], TERMINAL_PDF_BUILD_SWEEP)


if __name__ == "__main__":
    unittest.main()
