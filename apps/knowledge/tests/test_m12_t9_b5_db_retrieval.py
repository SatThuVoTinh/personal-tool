"""B5 database/retrieval rows that own a provenance or identity projection.

These cases drive the real SQL-issuing methods against a recording fake
connection (the pattern the rest of the Knowledgebase lane uses), so the
contracts hold without Postgres, Ollama, or a tokenizer artifact.

F-512 (R10-L07-1): `knowledge.sources.sha256` holds `sha256(file)` for a
markdown source and the PDF *content identity* for a PDF one, and every reader
projected it as `source_sha256` -- the field the README tells the operator to
re-verify by re-hashing the source. A PDF hit therefore published a value no
re-hash of the PDF could produce.
"""

from __future__ import annotations

import unittest
from pathlib import Path
from uuid import uuid4

from app.database import KnowledgeDatabase


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
    database._pool = connection  # type: ignore[assignment]
    database._owner_connection = connection  # type: ignore[assignment]
    return database


def statements(connection: FakeConnection, verb: str) -> list[str]:
    return [statement for (called, statement, _) in connection.calls if called == verb]


# The value `knowledge.sources.sha256` carries for a PDF: the composite of the
# PDF digest, its sidecar digest and the processing identity.
PDF_CONTENT_IDENTITY = "a" * 64
# The value it carries for markdown, and the PDF build's own `pdf_digest`:
# `sha256` of the bytes the operator re-hashes.
FILE_DIGEST = "b" * 64


def segment_row(**overrides: object) -> dict[str, object]:
    """One `get_segment` row, in the shape the reader selects."""

    row: dict[str, object] = {
        "id": str(uuid4()),
        "index_id": str(uuid4()),
        "source_id": str(uuid4()),
        "source_path": "02. Books/report.pdf",
        "title": "Report",
        "text": "body",
        "heading_path": ["Report"],
        "primary_topic": "books",
        "canonical_topics": ["books"],
        "tags": [],
        "segment_type": "PDF_PASSAGE",
        "chunk_ordinal": 0,
        "index_status": "ACTIVE",
        "line_start": None,
        "line_end": None,
        "page_start": 1,
        "page_end": 1,
        "bbox": None,
        "indexed_by_run_id": str(uuid4()),
        "content_identity_digest": PDF_CONTENT_IDENTITY,
        "pdf_digest": FILE_DIGEST,
        "source_type": "PDF",
        "source_mime_type": "application/pdf",
    }
    row.update(overrides)
    return row


class PublishedSourceDigestTests(unittest.IsolatedAsyncioTestCase):
    async def test_the_citation_reader_publishes_the_digest_of_the_pdf_bytes(self) -> None:
        """`source_sha256` promises a re-hash the PDF never matched.

        The row carries both values: the identity the source stores and the
        build's own file digest. The published field is the one an operator
        can reproduce with `sha256sum`.
        """

        row = segment_row()
        connection = FakeConnection(fetchrows=[row])
        database = database_with(connection)

        record = await database.get_segment(str(row["id"]))

        self.assertIsNotNone(record)
        self.assertEqual(record.source_sha256, FILE_DIGEST)
        # The digest comes from the build row, not from the column that holds
        # the composite, so a reader must actually select it.
        statement = statements(connection, "fetchrow")[0]
        self.assertIn("knowledge.pdf_content_builds", statement)
        self.assertIn("pdf_digest", statement)

    async def test_a_markdown_segment_keeps_the_digest_its_row_stores(self) -> None:
        row = segment_row(
            segment_type="MARKDOWN_PASSAGE",
            source_type="MARKDOWN",
            source_mime_type="text/markdown",
            source_path="01. Knowledge/note.md",
            content_identity_digest=FILE_DIGEST,
            pdf_digest=None,
        )
        connection = FakeConnection(fetchrows=[row])
        database = database_with(connection)

        record = await database.get_segment(str(row["id"]))

        self.assertIsNotNone(record)
        self.assertEqual(record.source_sha256, FILE_DIGEST)

    async def test_the_search_branch_publishes_the_digest_of_the_pdf_bytes(
        self,
    ) -> None:
        """The search envelope publishes the same field as the citation.

        `_source_digests` is the one extra statement the two branches read
        their identity from, inside the same snapshot (F-072), so the mapping
        it returns is the whole of the search-side provenance.
        """

        source_id = uuid4()
        connection = FakeConnection(
            fetches=[
                [
                    {
                        "id": str(source_id),
                        "content_identity_digest": PDF_CONTENT_IDENTITY,
                        "pdf_digest": FILE_DIGEST,
                    }
                ]
            ]
        )

        digests = await KnowledgeDatabase._source_digests(
            connection, {str(source_id)}
        )

        self.assertEqual(digests, {str(source_id): FILE_DIGEST})
        statement = statements(connection, "fetch")[0]
        self.assertIn("knowledge.pdf_content_builds", statement)

    async def test_a_markdown_source_in_the_search_branch_keeps_its_own_digest(
        self,
    ) -> None:
        source_id = uuid4()
        connection = FakeConnection(
            fetches=[
                [
                    {
                        "id": str(source_id),
                        "content_identity_digest": FILE_DIGEST,
                        "pdf_digest": None,
                    }
                ]
            ]
        )

        digests = await KnowledgeDatabase._source_digests(
            connection, {str(source_id)}
        )

        self.assertEqual(digests, {str(source_id): FILE_DIGEST})

    async def test_an_empty_candidate_set_issues_no_statement(self) -> None:
        connection = FakeConnection()

        digests = await KnowledgeDatabase._source_digests(connection, set())

        self.assertEqual(digests, {})
        self.assertEqual(connection.calls, [])


class CitationIndexLivenessTests(unittest.IsolatedAsyncioTestCase):
    """F-573 (R10-T10-4): a citation says which index it resolves against.

    The search path filters `knowledge.indexes.status = 'ACTIVE'` while the
    citation loader joined only `segments` to `sources`, so a citation issued
    against an index that has since been superseded resolved normally with no
    field saying so, and the payload carried nothing but a surrogate row id --
    which a reindex destroys -- so a caller could not re-derive the segment.
    """

    async def test_the_reader_reports_the_index_status_it_resolved_against(
        self,
    ) -> None:
        row = segment_row(index_status="SUPERSEDED")
        connection = FakeConnection(fetchrows=[row])
        database = database_with(connection)

        record = await database.get_segment(str(row["id"]))

        self.assertIsNotNone(record)
        assert record is not None
        self.assertEqual(record.index_status, "SUPERSEDED")
        statement = statements(connection, "fetchrow")[0]
        self.assertIn("knowledge.indexes", statement)

    async def test_an_active_index_is_reported_as_active(self) -> None:
        row = segment_row(index_status="ACTIVE")
        connection = FakeConnection(fetchrows=[row])
        database = database_with(connection)

        record = await database.get_segment(str(row["id"]))

        assert record is not None
        self.assertEqual(record.index_status, "ACTIVE")

    async def test_the_reader_returns_the_chunk_ordinal_a_reindex_needs(
        self,
    ) -> None:
        """`segment_id` is a surrogate a reindex destroys.

        The identity that survives a reindex is (index, source revision, chunk
        ordinal), so the ordinal has to travel with the citation.
        """

        row = segment_row(chunk_ordinal=7)
        connection = FakeConnection(fetchrows=[row])
        database = database_with(connection)

        record = await database.get_segment(str(row["id"]))

        assert record is not None
        self.assertEqual(record.chunk_ordinal, 7)
        self.assertEqual(record.index_id, row["index_id"])
        self.assertEqual(record.source_sha256, FILE_DIGEST)
        statement = statements(connection, "fetchrow")[0]
        self.assertIn("chunk_ordinal", statement)


if __name__ == "__main__":
    unittest.main()
