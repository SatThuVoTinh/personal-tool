"""F-575 (R10-T10-6): a segment's citation columns are reported from the canonical source row.

``knowledge.segments`` re-declares ``source_path``, ``title``, ``primary_topic``,
``canonical_topics`` and ``tags`` for retrieval speed. The schema declares no
trigger, no CHECK and no per-segment content digest -- ``grep -c -i "create
trigger" apps/knowledge/migrations/001_initial.sql`` is 0 and ``sha256`` appears
once, on ``knowledge.sources`` -- so the copies agree with the canonical row by
writer convention only, while the citation and search reads projected the copies
and took the digest from ``sources`` in a different statement. Search therefore
reported a derived copy against a canonical digest nothing ties it to.

These cases pin the two controls that close the gap: the readers project the
citation fields through the existing FK, and the boot runs a `segments`-to-`sources`
agreement assertion beside the existing ``assert_searchable_segment_type_domain``.
They drive the real SQL-issuing methods against a recording fake, so they run in
the non-skippable Knowledgebase Python lane -- not in the may-skip Postgres lane
F-481 covers.
"""

from __future__ import annotations

import unittest
from pathlib import Path
from uuid import uuid4

from app.database import KnowledgeDatabase, StateTransitionError

CITATION_COLUMNS = (
    "source_path",
    "title",
    "primary_topic",
    "canonical_topics",
    "tags",
)

MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations" / "001_initial.sql"
).read_text(encoding="utf-8")


class _Transaction:
    def __init__(self, *_args: object, **_kwargs: object) -> None:
        pass

    async def __aenter__(self) -> "_Transaction":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _Entered:
    def __init__(self, connection: "_Connection") -> None:
        self.connection = connection

    async def __aenter__(self) -> "_Connection":
        return self.connection

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _Connection:
    """The connection surface `KnowledgeDatabase` reads through, recorded."""

    def __init__(self, fetches: list[object] | None = None) -> None:
        self.fetches: list[object] = list(fetches or [])
        self.calls: list[tuple[str, str]] = []

    def is_closed(self) -> bool:
        return False

    def transaction(self, *_args: object, **_kwargs: object) -> _Transaction:
        return _Transaction()

    async def execute(self, sql: str, *args: object) -> None:
        self.calls.append(("execute", " ".join(sql.split())))

    async def fetchval(self, sql: str, *args: object) -> object:
        self.calls.append(("fetchval", " ".join(sql.split())))
        return self.fetches.pop(0)

    async def fetchrow(self, sql: str, *args: object) -> object:
        self.calls.append(("fetchrow", " ".join(sql.split())))
        return self.fetches.pop(0)

    async def fetch(self, sql: str, *args: object) -> object:
        self.calls.append(("fetch", " ".join(sql.split())))
        return self.fetches.pop(0)


class _Pool:
    def __init__(self, connection: _Connection) -> None:
        self.connection = connection

    def acquire(self) -> _Entered:
        return _Entered(self.connection)

    async def fetch(self, sql: str, *args: object) -> object:
        return await self.connection.fetch(sql, *args)

    async def fetchval(self, sql: str, *args: object) -> object:
        return await self.connection.fetchval(sql, *args)

    async def fetchrow(self, sql: str, *args: object) -> object:
        return await self.connection.fetchrow(sql, *args)


def database_with(connection: _Connection) -> KnowledgeDatabase:
    database = KnowledgeDatabase(
        "localhost", 5432, "knowledge", "zink", "secret", Path("migrations")
    )
    pool = _Pool(connection)
    database._pool = pool  # type: ignore[assignment]
    return database


def statements(connection: _Connection, verb: str) -> list[str]:
    return [sql for (called, sql) in connection.calls if called == verb]


def search_row(segment_id: str, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "id": segment_id,
        "index_id": str(uuid4()),
        "source_id": str(uuid4()),
        "source_path": "01. Knowledge/AI/note.md",
        "title": "Note",
        "primary_topic": "AI",
        "canonical_topics": ["AI"],
        "tags": ["ai"],
        "heading_path": ["Note"],
        "text": "body",
        "line_start": 3,
        "line_end": 4,
        "page_start": None,
        "page_end": None,
        "bbox": None,
        "segment_type": "MARKDOWN_PASSAGE",
        "chunk_ordinal": 0,
        "indexed_by_run_id": str(uuid4()),
        "dense_distance": 0.1,
        "fts_score": 1.0,
        "content_identity_digest": "b" * 64,
        "pdf_digest": None,
        "source_type": "MARKDOWN",
        "source_mime_type": "text/markdown",
        "index_status": "ACTIVE",
    }
    row.update(overrides)
    return row


def drive_search_candidates(connection: _Connection, index_id: str, segment_id: str):
    connection.fetches = [
        index_id,  # the ACTIVE check inside the snapshot
        [search_row(segment_id)],  # dense branch
        [search_row(segment_id)],  # fts branch
        [],  # _source_digests
        index_id,  # the ACTIVE check after the snapshot
    ]
    database = database_with(connection)
    return database.search_candidates(index_id, [0.0] * 1024, "topic", None, (), None)


class CitationProjectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_the_citation_reader_projects_every_citation_field_from_sources(
        self,
    ) -> None:
        segment_id = str(uuid4())
        connection = _Connection([search_row(segment_id)])
        database = database_with(connection)

        await database.get_segment(segment_id)

        statement = statements(connection, "fetchrow")[0]
        for column in CITATION_COLUMNS:
            self.assertIn(
                f"sources.{column}",
                statement,
                f"the citation read still projects {column} from the copy",
            )
            self.assertNotIn(
                f"segments.{column}",
                statement,
                f"the citation read still projects the denormalised {column}",
            )

    async def test_the_search_branches_project_every_citation_field_from_sources(
        self,
    ) -> None:
        index_id = str(uuid4())
        segment_id = str(uuid4())
        connection = _Connection()
        await drive_search_candidates(connection, index_id, segment_id)

        dense, fts = statements(connection, "fetch")[:2]
        for statement, label in ((dense, "dense"), (fts, "fts")):
            self.assertIn(
                "knowledge.sources",
                statement,
                f"the {label} branch does not reach the canonical source row",
            )
            for column in CITATION_COLUMNS:
                self.assertIn(
                    f"sources.{column}",
                    statement,
                    f"the {label} branch still projects the copied {column}",
                )
        self.assertNotIn(
            "SELECT id, source_path, title, primary_topic, tags",
            dense,
            "the ANN branch still projects the copied columns inside the scan",
        )
        # F-072 (R5-E02-02) is preserved: the ANN scan stays alone in the
        # materialised CTE, so the join cannot move the HNSW scan around.
        self.assertIn("WITH ann AS MATERIALIZED", dense)
        self.assertLess(
            dense.index("knowledge.sources"),
            dense.index("ORDER BY dense_distance"),
            "the projection join must sit outside the ANN scan",
        )

class SegmentSourceAgreementAssertTests(unittest.IsolatedAsyncioTestCase):
    async def test_the_agreement_assert_compares_every_citation_column(
        self,
    ) -> None:
        connection = _Connection([[]])
        database = database_with(connection)

        await database.assert_segments_agree_with_sources()

        statement = statements(connection, "fetch")[0]
        self.assertIn("knowledge.segments", statement)
        self.assertIn("knowledge.sources", statement)
        for column in CITATION_COLUMNS:
            self.assertIn(
                f"segments.{column}",
                statement,
                f"the agreement assert does not compare {column}",
            )
            self.assertIn(
                f"sources.{column}",
                statement,
                f"the agreement assert does not compare {column}",
            )

    async def test_a_disagreement_between_the_copies_and_the_canonical_row_fails_closed(
        self,
    ) -> None:
        connection = _Connection([{"segment_id": str(uuid4())}])
        database = database_with(connection)

        with self.assertRaises(StateTransitionError):
            await database.assert_segments_agree_with_sources()

    async def test_the_boot_runs_the_agreement_assert_beside_the_domain_assert(
        self,
    ) -> None:
        """Both members of the invariant family run on every boot arm.

        A boot that stops running one of them must not stay green.
        """

        connection = _Connection([True, True])
        database = KnowledgeDatabase(
            "localhost", 5432, "knowledge", "zink", "secret", Path("migrations")
        )
        database._pool = _Pool(connection)  # type: ignore[assignment]
        ran: list[str] = []

        async def record_domain() -> None:
            ran.append("domain")

        async def record_agreement() -> None:
            ran.append("agreement")

        async def acquire_migration_lock(_key: int) -> _Connection:
            return connection

        async def release_advisory_lock(*_args: object) -> None:
            return None

        async def apply_migrations(*_args: object) -> None:
            ran.append("migrations")

        database.assert_searchable_segment_type_domain = record_domain  # type: ignore[method-assign]
        database.assert_segments_agree_with_sources = record_agreement  # type: ignore[method-assign]
        database.acquire_migration_lock = acquire_migration_lock  # type: ignore[method-assign]
        database.release_advisory_lock = release_advisory_lock  # type: ignore[method-assign]
        database._apply_migrations = apply_migrations  # type: ignore[method-assign]

        await database._apply_startup_schema()

        self.assertEqual(ran, ["migrations", "domain", "agreement"])


class SchemaFactTests(unittest.TestCase):
    """The premise the row rests on, re-measured every lane run."""

    def test_the_schema_still_declares_no_trigger_and_no_segment_digest(self) -> None:
        """The gap is the constraint, not a reachable wrong citation.

        No trigger rewrites the copies, and the segments table itself carries no
        digest, so nothing in the schema ties a segment row to its source.
        """

        self.assertEqual(MIGRATION.lower().count("create trigger"), 0)
        start = MIGRATION.index("CREATE TABLE IF NOT EXISTS knowledge.segments (")
        body = MIGRATION[start : MIGRATION.index("CREATE INDEX", start)]
        self.assertNotIn("sha256", body)


if __name__ == "__main__":
    unittest.main()
