"""F-576 (R10-T10-7): one path form on both sides of the source-path seam.

The read seam normalises the operator's prefix to NFC, while the stored column
carried the writer's raw bytes: a decomposed (NFD) source path was therefore
returned by no prefix filter even though the row was indexed. The cases here
drive the real SQL-issuing methods against a recording fake connection, so the
form agreement is observable without Postgres, Ollama or a tokenizer artifact.
"""

from __future__ import annotations

import unicodedata
import unittest
from pathlib import Path
from uuid import uuid4

from app.database import (
    AcceptedIndexRun,
    ActiveIndex,
    KnowledgeDatabase,
    PdfPublicationSegment,
)
from app.index_lifecycle import IndexLifecycle, LifecycleDependencies
from app.markdown_adapter import (
    MarkdownScanResult,
    MarkdownSegment,
    MarkdownSource,
)
from app.model_probe import ResolvedEmbeddingModel
from app.retrieval import _normalize_path_prefix

NFC_PATH = "01. Knowledge/Caf\u00e9/note.md"
NFD_PATH = unicodedata.normalize("NFD", NFC_PATH)
NFC_PREFIX = "01. Knowledge/Caf\u00e9"
NFD_PREFIX = unicodedata.normalize("NFD", NFC_PREFIX)


class _Transaction:
    async def __aenter__(self) -> "_Transaction":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _Acquire:
    def __init__(self, connection: "FakeConnection") -> None:
        self._connection = connection

    async def __aenter__(self) -> "FakeConnection":
        return self._connection

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

    def transaction(self, **_kwargs: object) -> _Transaction:
        return _Transaction()

    def acquire(self) -> _Acquire:
        return _Acquire(self)

    def _record(self, verb: str, sql: str, args: tuple[object, ...]) -> None:
        self.calls.append((verb, " ".join(sql.split()), args))

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
        "localhost", 5432, "knowledge", "zink", "secret", Path("migrations")
    )
    database._pool = connection  # type: ignore[assignment]
    database._owner_connection = connection  # type: ignore[assignment]
    return database


def statements(connection: FakeConnection, verb: str) -> list[str]:
    return [statement for (called, statement, _) in connection.calls if called == verb]


def run_row(run: AcceptedIndexRun) -> dict[str, str]:
    return {"index_id": run.index_id, "kind": run.kind, "status": "RUNNING"}


def markdown_source(source_path: str, digest: str = "d" * 64) -> MarkdownSource:
    segment = MarkdownSegment(
        0, "body", "Title", ("Title",), "Title\n\nbody", 1, 2, 1, 2
    )
    return MarkdownSource(
        source_path, digest, "text/markdown", "Title", "Cafe", ("Cafe",), ("cafe",),
        (segment,),
    )


class SourcePathWriteFormTests(unittest.IsolatedAsyncioTestCase):
    async def test_markdown_ingest_stores_the_nfc_form(self) -> None:
        run = AcceptedIndexRun(str(uuid4()), str(uuid4()), "FULL_REBUILD", "RUNNING")
        connection = FakeConnection(
            fetchrows=[run_row(run)], fetchvals=["BUILDING"]
        )
        database = database_with(connection)

        await database.replace_source(
            run, markdown_source(NFD_PATH), [[0.0] * 1024]
        )

        insert = [
            statement
            for statement in statements(connection, "execute")
            if "INSERT INTO knowledge.sources" in statement
        ]
        self.assertTrue(insert)
        args = next(
            args
            for (verb, statement, args) in connection.calls
            if verb == "execute" and "INSERT INTO knowledge.sources" in statement
        )
        self.assertEqual(args[2], NFC_PATH)
        self.assertNotEqual(args[2], NFD_PATH)
        segment_values = next(
            args[0]
            for (verb, statement, args) in connection.calls
            if verb == "executemany" and "INSERT INTO knowledge.segments" in statement
        )
        self.assertEqual(segment_values[0][4], NFC_PATH)

    async def test_pdf_ingest_stores_the_nfc_form(self) -> None:
        run = AcceptedIndexRun(str(uuid4()), str(uuid4()), "FULL_REBUILD", "RUNNING")
        connection = FakeConnection(
            fetchrows=[run_row(run)],
            fetchvals=["BUILDING", "build-id"],
        )
        database = database_with(connection)

        await database.replace_pdf_source(
            run,
            source_path=NFD_PATH,
            content_identity_digest="a" * 64,
            title="Title",
            canonical_topics=("Cafe",),
            tags=("cafe",),
            build_id=str(uuid4()),
            segments=(
                PdfPublicationSegment(0, "PDF_PASSAGE", "body", 1, 1, None),
            ),
            embeddings=[[0.0] * 1024],
        )

        args = next(
            args
            for (verb, statement, args) in connection.calls
            if verb == "execute" and "INSERT INTO knowledge.sources" in statement
        )
        self.assertEqual(args[2], NFC_PATH)

    async def test_the_prefix_filter_compares_the_nfc_form_of_both_sides(self) -> None:
        run = AcceptedIndexRun(str(uuid4()), str(uuid4()), "FULL_REBUILD", "RUNNING")
        connection = FakeConnection(
            fetchrows=[run_row(run)], fetchvals=["BUILDING"]
        )
        database = database_with(connection)

        await database.replace_source(
            run, markdown_source(NFD_PATH), [[0.0] * 1024]
        )

        delete = [
            statement
            for statement in statements(connection, "execute")
            if statement.startswith("DELETE FROM knowledge.sources")
        ]
        self.assertTrue(delete)
        self.assertIn("normalize(source_path, NFC) = $2", delete[0])


class SourcePathReadFormTests(unittest.IsolatedAsyncioTestCase):
    async def test_the_search_prefix_is_normalised_to_nfc(self) -> None:
        self.assertEqual(_normalize_path_prefix(NFD_PREFIX), NFC_PREFIX)

    async def test_the_search_sql_compares_the_stored_path_in_nfc(self) -> None:
        active_id = str(uuid4())
        # The active pointer is read before and after the snapshot.
        connection = FakeConnection(fetchvals=[active_id, active_id], fetches=[[], []])
        database = database_with(connection)

        await database.search_candidates(
            active_id,
            [0.0] * 1024,
            "query",
            None,
            (),
            _normalize_path_prefix(NFD_PREFIX),
        )

        dense = next(
            statement
            for statement in statements(connection, "fetch")
            if "WITH ann AS MATERIALIZED" in statement
        )
        self.assertIn("normalize(segments.source_path, NFC) = $5", dense)
        self.assertIn(
            "left(normalize(segments.source_path, NFC), char_length($5) + 1) = $5 || '/'",
            dense,
        )
        # The FTS branch shares the same `{common}` predicate, so the NFC
        # comparison has to reach it too.
        fts = next(
            statement
            for statement in statements(connection, "fetch")
            if "WITH parsed AS" in statement
        )
        self.assertIn("normalize(segments.source_path, NFC) = $5", fts)
        # The whole chain in one case: the operator typed the decomposed
        # prefix, `_normalize_path_prefix` composed it, and the value bound to
        # `$5` is the composed form the normalised column is compared against.
        dense_args = next(
            args
            for (verb, statement, args) in connection.calls
            if verb == "fetch" and "WITH ann AS MATERIALIZED" in statement
        )
        self.assertEqual(dense_args[4], NFC_PREFIX)
        self.assertNotEqual(dense_args[4], NFD_PREFIX)

    async def test_a_legacy_decomposed_row_is_visible_to_the_nfc_prefix(self) -> None:
        """The predicate the SQL now applies, evaluated over the row form.

        A row written before this fix carries the decomposed form. The raw
        column comparison misses it; the normalised comparison the SQL now
        performs reaches it.
        """

        self.assertFalse(NFD_PATH.startswith(NFC_PREFIX + "/"))
        self.assertTrue(
            unicodedata.normalize("NFC", NFD_PATH).startswith(NFC_PREFIX + "/")
        )

    async def test_the_reclamation_lookup_compares_the_nfc_form(self) -> None:
        connection = FakeConnection(fetchrows=[None])
        database = database_with(connection)

        from app.database import PdfContentNotFoundError

        with self.assertRaises(PdfContentNotFoundError):
            await database.reclaim_pdf_content(NFD_PATH)

        lookup = next(
            statement
            for statement in statements(connection, "fetchrow")
            if "FROM knowledge.sources s" in statement
        )
        self.assertIn("normalize(s.source_path, NFC) = $1", lookup)
        args = next(
            args
            for (verb, statement, args) in connection.calls
            if verb == "fetchrow" and "FROM knowledge.sources s" in statement
        )
        self.assertEqual(args[0], NFC_PATH)


class IncrementalPathAgreementTests(unittest.IsolatedAsyncioTestCase):
    """The lifecycle compares scan paths to stored hashes in one form.

    Without the agreement, the unchanged NFD source is re-embedded and then the
    stale calculation deletes the source it just republished.
    """

    async def test_an_nfd_scan_matches_an_nfc_stored_path_without_a_stale_delete(
        self,
    ) -> None:
        stored = {NFC_PATH: "d" * 64}
        replacements: list[str] = []
        stale: set[str] = set()

        class FakeScanner:
            def scan_vault(
                self, _: Path, *, include_valid_sources_on_error: bool = False
            ) -> MarkdownScanResult:
                return MarkdownScanResult(True, 1, 1, (markdown_source(NFD_PATH),), ())

        class FakeProbe:
            async def resolve(
                self, _: str, expected_dimensions: int | None = None
            ) -> ResolvedEmbeddingModel:
                return ResolvedEmbeddingModel("bge-m3:latest", "a" * 64, 1024)

            async def embed(self, _: str, texts: list[str]) -> list[list[float]]:
                return [[0.0] * 1024 for _ in texts]

        class FakeDatabase:
            async def get_index(self, _: str) -> ActiveIndex:
                return ActiveIndex("index-1", "bge-m3:latest", "a" * 64, 1024)

            async def set_discovered(self, _: str, __: int) -> None:
                return None

            async def source_hashes(self, _: str) -> dict[str, str]:
                return stored

            async def get_active_index(self) -> ActiveIndex:
                return ActiveIndex("index-1", "bge-m3:latest", "a" * 64, 1024)

            async def source_count(self, _: str) -> int:
                return 1

            async def replace_source(self, *args: object) -> None:
                replacements.append(args[1].source_path)

            async def complete_incremental(
                self, *args: object, **kwargs: object
            ) -> list[str]:
                stale.update(args[3])  # type: ignore[arg-type]
                return []

            async def publish_full_rebuild(self, *_: object) -> list[str]:
                return []

            async def fail_run(self, *args: object, **kwargs: object) -> None:
                return None

            async def cleanup_superseded(self, _: list[str]) -> None:
                return None

        lifecycle = IndexLifecycle(
            LifecycleDependencies(
                database=FakeDatabase(),  # type: ignore[arg-type]
                model_probe=FakeProbe(),  # type: ignore[arg-type]
                scanner=FakeScanner(),  # type: ignore[arg-type]
                vault_root=Path("/vault"),
                embedding_model="bge-m3:latest",
                embedding_dimensions=1024,
            )
        )

        await lifecycle.execute(
            AcceptedIndexRun("run-1", "index-1", "INCREMENTAL", "RUNNING")
        )

        self.assertEqual(replacements, [])
        self.assertEqual(stale, set())


if __name__ == "__main__":
    unittest.main()
