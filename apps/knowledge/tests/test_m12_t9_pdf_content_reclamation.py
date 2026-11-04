"""M12/T9 band C (`H9`): the reclamation path for a PDF's derived text copy.

The owner's answer `H9` (2026-10-21): the derived text copies that could not
be reclaimed get a reclamation path -- the PDF stays, the derived copy is
reclaimed under the store's OWN writer, and the reclamation is recorded.

These tests drive the real writer method against a recording fake connection
(the pattern established by `test_r24_atomic_incremental_index.py` and
`test_m11_index_hygiene.py`), so the contract holds without Postgres, Ollama
or a tokenizer artifact:

  * the PDF stays: the published source row and its published (searchable)
    segments are never deleted, and the action never touches the file;
  * the derived copy is gone: the extracted text, its provenance and the
    extraction manifest are deleted, and the link that pinned the build's
    status goes with them;
  * the reclamation is recorded: the content build's own terminal lifecycle
    state names the event and the moment it happened;
  * a second reclamation is a no-op that reports so;
  * the reclamation refuses to run outside the store's own writer.

The route-level part needs `app.main`, which builds a real `TokenBudget` at
import time, so it lives behind the tokenizer gate the other API suites use.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

from app.database import (
    AcceptedIndexRun,
    ActiveIndex,
    KnowledgeDatabase,
    PdfContentNotFoundError,
    PdfContentNotReclaimableError,
    PdfContentReclamation,
    StateTransitionError,
)
from app.index_lifecycle import IndexLifecycle, LifecycleDependencies
from app.markdown_adapter import MarkdownScanResult
from app.model_probe import ResolvedEmbeddingModel
from app.pdf_foundation import PdfSidecar


_TOKENIZER = os.environ.get("KNOWLEDGE_TOKENIZER_PATH")
_TOKENIZER_IS_PROVISIONED = bool(_TOKENIZER) and Path(_TOKENIZER).is_file()


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


def executed(connection: FakeConnection) -> list[tuple[str, tuple[object, ...]]]:
    """Every statement the writer executed, in order."""

    return [
        (statement, args)
        for (called, statement, args) in connection.calls
        if called == "execute"
    ]


SOURCE_PATH = "02. Books/Authority/report.pdf"
DIGEST = "a" * 64
PDF_DIGEST = "b" * 64
BUILD_ID = uuid4()

# The derived relations, in the order the writer deletes them.
RECLAIMED_RELATIONS = (
    "DELETE FROM knowledge.pdf_source_details WHERE build_id = $1",
    "DELETE FROM knowledge.pdf_content_segments WHERE build_id = $1",
    "DELETE FROM knowledge.pdf_content_batches WHERE build_id = $1",
)


def source_row() -> dict[str, object]:
    return {"content_identity_digest": DIGEST}


def build_row() -> dict[str, object]:
    return {"id": str(BUILD_ID), "pdf_digest": PDF_DIGEST}


def reclaimed_row() -> dict[str, object]:
    return {"id": str(BUILD_ID), "finished_at": "2026-10-22 09:00:00+00"}


def tombstone_row() -> dict[str, object]:
    """The terminal build that records an earlier reclamation."""

    return {
        "id": str(BUILD_ID),
        "pdf_digest": PDF_DIGEST,
        "finished_at": "2026-10-22 09:00:00+00",
    }


class PdfContentReclamationTests(unittest.IsolatedAsyncioTestCase):
    async def test_the_derived_copy_is_reclaimed_while_the_pdf_stays(self) -> None:
        """H9: the derived copy goes; the PDF stays.

        The derived copy is what the ingestion produced and stored: the
        extracted text and its provenance, the extraction manifest, and the
        link that tied the published source to that build. The PDF itself --
        the published source row, the published (searchable) segments and the
        file in the vault -- is never deleted.
        """

        connection = FakeConnection(
            fetchrows=[source_row(), build_row(), reclaimed_row()],
            fetchvals=[12, 2],
        )
        database = database_with(connection)

        reclamation = await database.reclaim_pdf_content(SOURCE_PATH)

        self.assertEqual(reclamation.build_id, str(BUILD_ID))
        self.assertEqual(reclamation.status, "RECLAIMED")
        self.assertEqual(reclamation.segments_reclaimed, 12)
        self.assertEqual(reclamation.content_identity_digest, DIGEST)
        self.assertEqual(reclamation.pdf_digest, PDF_DIGEST)
        self.assertEqual(reclamation.reclaimed_at, "2026-10-22 09:00:00+00")
        # The derived copy belongs to the CONTENT IDENTITY, so one build can
        # carry more than one source link; the count is REPORTED, so a caller
        # that names one path sees every link that went with it.
        self.assertEqual(reclamation.sources_released, 2)

        statements = executed(connection)
        self.assertEqual(
            [statement for statement, _ in statements], list(RECLAIMED_RELATIONS)
        )
        for _, args in statements:
            self.assertEqual(args, (BUILD_ID,))
        # The PDF stays: nothing deletes the published source row or the
        # published (searchable) segments of that source.
        for statement, _ in statements:
            self.assertNotIn("knowledge.sources", statement)
            self.assertNotIn("knowledge.segments", statement)

    async def test_the_reclamation_is_recorded_on_the_content_build(self) -> None:
        """H9: the reclamation is recorded.

        The record is the content build's own terminal lifecycle state, in the
        shape the Knowledgebase already records lifecycle in: a status, the
        timestamps and the code that names the event.
        """

        connection = FakeConnection(
            fetchrows=[source_row(), build_row(), reclaimed_row()],
            fetchvals=[3, 1],
        )
        database = database_with(connection)

        await database.reclaim_pdf_content(SOURCE_PATH)

        updates = [
            (statement, args)
            for (called, statement, args) in connection.calls
            if called == "fetchrow" and "UPDATE knowledge.pdf_content_builds" in statement
        ]
        self.assertEqual(len(updates), 1)
        statement, args = updates[0]
        self.assertIn("SET status = 'CANCELLED', ready_at = NULL, finished_at = now()", statement)
        self.assertIn("failure_code = $2", statement)
        self.assertIn("status IN ('BUILDING', 'READY')", statement)
        self.assertEqual(args, (BUILD_ID, "PDF_CONTENT_RECLAIMED"))

    async def test_a_second_reclamation_is_a_no_op(self) -> None:
        """H9: reclaiming an already-reclaimed document changes nothing.

        The build is already terminal, so the action finds no derived copy to
        reclaim, writes no statement at all, and reports that the document
        was already reclaimed.

        The terminal build is read by its OWN failure code: a build that was
        cancelled for another reason was never a reclamation, and saying so
        would report a reclamation that never happened.
        """

        connection = FakeConnection(
            fetchrows=[source_row(), None, tombstone_row()],
        )
        database = database_with(connection)

        reclamation = await database.reclaim_pdf_content(SOURCE_PATH)

        self.assertEqual(reclamation.status, "ALREADY_RECLAIMED")
        self.assertEqual(reclamation.build_id, str(BUILD_ID))
        self.assertEqual(reclamation.segments_reclaimed, 0)
        self.assertEqual(reclamation.sources_released, 0)
        self.assertEqual(executed(connection), [])
        terminal_reads = [
            (statement, args)
            for (called, statement, args) in connection.calls
            if called == "fetchrow" and "status = 'CANCELLED'" in statement
        ]
        self.assertEqual(len(terminal_reads), 1)
        statement, args = terminal_reads[0]
        self.assertIn("failure_code = $2", statement)
        self.assertEqual(args, (DIGEST, "PDF_CONTENT_RECLAIMED"))

    async def test_a_build_cancelled_for_another_reason_is_not_a_reclamation(
        self,
    ) -> None:
        """A cancellation that was not a reclamation is not reported as one.

        The terminal build is found by its own failure code, so a build that
        was cancelled for another reason is simply not there: the action
        refuses instead of claiming a reclamation that never happened.
        """

        connection = FakeConnection(
            fetchrows=[source_row(), None, None],
        )
        database = database_with(connection)

        with self.assertRaises(PdfContentNotReclaimableError):
            await database.reclaim_pdf_content(SOURCE_PATH)

        self.assertEqual(executed(connection), [])

    async def test_an_unpublished_document_is_refused(self) -> None:
        connection = FakeConnection(fetchrows=[None])
        database = database_with(connection)

        with self.assertRaises(PdfContentNotFoundError):
            await database.reclaim_pdf_content(SOURCE_PATH)

        self.assertEqual(executed(connection), [])

    async def test_a_document_without_a_derived_copy_is_refused(self) -> None:
        connection = FakeConnection(fetchrows=[source_row(), None, None])
        database = database_with(connection)

        with self.assertRaises(PdfContentNotReclaimableError):
            await database.reclaim_pdf_content(SOURCE_PATH)

        self.assertEqual(executed(connection), [])

    async def test_the_reclamation_refuses_to_run_outside_the_store_writer(self) -> None:
        """H9: the derived copy is reclaimed under the store's OWN writer.

        The write happens inside the mutation transaction that requires the
        pinned advisory-lock owner, so a reclamation can never be written
        outside the writer the rest of the Knowledgebase's writes use.
        """

        database = KnowledgeDatabase(
            "localhost", 5432, "knowledge", "zink", "secret", Path("migrations")
        )
        database._pool = object()  # type: ignore[assignment]

        with self.assertRaises(StateTransitionError):
            await database.reclaim_pdf_content(SOURCE_PATH)


SIDECAR_DIGEST = "c" * 64
OLD_CONTENT_IDENTITY = "d" * 64
NEW_PROCESSING_IDENTITY = "e" * 64
RETENTION_INDEX = ActiveIndex("index-1", "bge-m3:latest", "a" * 64, 1024)


def retention_sidecar() -> PdfSidecar:
    return PdfSidecar(
        sidecar_path="02. Books/Authority/report.md",
        source_path=SOURCE_PATH,
        title="Report",
        canonical_topics=("AI",),
        tags=("ai",),
        pdf_digest=PDF_DIGEST,
        sidecar_digest=SIDECAR_DIGEST,
    )


class PdfRetentionLookupTests(unittest.IsolatedAsyncioTestCase):
    """F-444 (R9-T06-2): the tombstone is keyed by the source pair."""

    async def test_the_reclamation_record_is_found_by_the_source_pair(self) -> None:
        connection = FakeConnection(fetchvals=[True])
        database = database_with(connection)
        database._pool = connection  # type: ignore[assignment]

        reclaimed = await database.pdf_content_is_reclaimed(
            PDF_DIGEST, SIDECAR_DIGEST
        )

        self.assertTrue(reclaimed)
        called, statement, args = connection.calls[-1]
        self.assertEqual(called, "fetchval")
        self.assertIn("pdf_digest = $1", statement)
        self.assertIn("sidecar_digest = $2", statement)
        self.assertIn("status = 'CANCELLED'", statement)
        self.assertIn("failure_code = $3", statement)
        # The identity that embeds the deriving code must not be the key: a
        # byte change to app/pdf_runtime.py re-keys every PDF.
        self.assertNotIn("processing_identity_digest", statement)
        self.assertNotIn("content_identity_digest", statement)
        self.assertEqual(
            args, (PDF_DIGEST, SIDECAR_DIGEST, "PDF_CONTENT_RECLAIMED")
        )


class _EmptyScanner:
    def scan_vault(
        self, _: Path, *, include_valid_sources_on_error: bool = False
    ) -> MarkdownScanResult:
        return MarkdownScanResult(True, 0, 0, (), ())


class _UnusedProbe:
    async def resolve(
        self, _: str, expected_dimensions: int | None = None
    ) -> ResolvedEmbeddingModel:
        return ResolvedEmbeddingModel(
            RETENTION_INDEX.embedding_model_name,
            RETENTION_INDEX.embedding_model_digest,
            RETENTION_INDEX.embedding_dimensions,
        )

    async def embed(self, *_: object, **__: object) -> object:
        raise AssertionError("a reclaimed PDF must not be embedded")


class _RetentionDatabase:
    def __init__(self, reclaimed: bool) -> None:
        self.reclaimed = reclaimed
        self.existing = {SOURCE_PATH: OLD_CONTENT_IDENTITY}
        self.checks: list[tuple[str, str]] = []
        self.completed = False
        self.failures: list[tuple[tuple[object, ...], dict[str, object]]] = []
        self.replaced: list[dict[str, object]] = []

    async def get_index(self, _: str) -> ActiveIndex:
        return RETENTION_INDEX

    async def set_discovered(self, _: str, __: int) -> None:
        return None

    async def source_hashes(self, _: str) -> dict[str, str]:
        return self.existing

    async def get_active_index(self) -> ActiveIndex:
        return RETENTION_INDEX

    async def source_count(self, _: str) -> int:
        return len(self.existing)

    async def pdf_content_is_reclaimed(
        self, pdf_digest: str, sidecar_digest: str
    ) -> bool:
        self.checks.append((pdf_digest, sidecar_digest))
        return self.reclaimed

    async def complete_incremental(self, *_: object) -> list[str]:
        self.completed = True
        return []

    async def publish_full_rebuild(self, *_: object) -> list[str]:
        raise AssertionError("an incremental run must not publish a full rebuild")

    async def fail_run(self, *args: object, **kwargs: object) -> None:
        self.failures.append((args, kwargs))

    async def cleanup_superseded(self, _: list[str]) -> None:
        return None

    async def replace_pdf_source(self, **kwargs: object) -> None:
        self.replaced.append(kwargs)


class _RecordingPdfBuilder:
    def __init__(self) -> None:
        self.calls: list[tuple[PdfSidecar, str]] = []

    async def build(self, sidecar: PdfSidecar, identity: str) -> object:
        self.calls.append((sidecar, identity))
        raise AssertionError("the reclaimed source pair must not be re-derived")

    async def revalidate_identity(self, *_: object) -> None:
        raise AssertionError("the reclaimed source pair must not be revalidated")


class PdfReclamationRetentionTests(unittest.IsolatedAsyncioTestCase):
    """F-444 (R9-T06-2): the owner's reclamation survives a code-digest bump."""

    def lifecycle(
        self, database: _RetentionDatabase, builder: _RecordingPdfBuilder
    ) -> IndexLifecycle:
        return IndexLifecycle(
            LifecycleDependencies(
                database=database,  # type: ignore[arg-type]
                model_probe=_UnusedProbe(),  # type: ignore[arg-type]
                scanner=_EmptyScanner(),  # type: ignore[arg-type]
                vault_root=Path("/vault"),
                embedding_model=RETENTION_INDEX.embedding_model_name,
                embedding_dimensions=RETENTION_INDEX.embedding_dimensions,
                pdf_builder=builder,  # type: ignore[arg-type]
                # The processing identity changed after the reclamation: the
                # digest embeds the bytes of app/pdf_runtime.py.
                pdf_processing_identity=lambda _: NEW_PROCESSING_IDENTITY,
            )
        )

    async def test_a_bumped_processing_identity_does_not_re_publish_a_reclaimed_pdf(
        self,
    ) -> None:
        database = _RetentionDatabase(reclaimed=True)
        builder = _RecordingPdfBuilder()
        instance = self.lifecycle(database, builder)

        with patch(
            "app.index_lifecycle.discover_pdf_sidecars",
            return_value=(retention_sidecar(),),
        ):
            result = await instance.execute(
                AcceptedIndexRun("run-1", RETENTION_INDEX.id, "INCREMENTAL", "RUNNING")
            )

        self.assertEqual(
            database.checks, [(PDF_DIGEST, SIDECAR_DIGEST)]
        )
        self.assertEqual(builder.calls, [])
        self.assertEqual(database.replaced, [])
        self.assertEqual(database.failures, [])
        self.assertTrue(database.completed)
        self.assertEqual(result, [])

    async def test_a_source_pair_without_a_reclamation_record_is_still_rebuilt(
        self,
    ) -> None:
        database = _RetentionDatabase(reclaimed=False)
        builder = _RecordingPdfBuilder()
        instance = self.lifecycle(database, builder)

        with patch(
            "app.index_lifecycle.discover_pdf_sidecars",
            return_value=(retention_sidecar(),),
        ):
            await instance.execute(
                AcceptedIndexRun("run-1", RETENTION_INDEX.id, "INCREMENTAL", "RUNNING")
            )

        self.assertEqual(database.checks, [(PDF_DIGEST, SIDECAR_DIGEST)])
        self.assertEqual(len(builder.calls), 1)
        self.assertEqual(builder.calls[0][0].source_path, SOURCE_PATH)
        # The recording builder refuses the rebuild, so the run keeps the
        # source as a failure instead of silently skipping it.
        self.assertEqual(len(database.failures), 1)


@unittest.skipUnless(
    _TOKENIZER_IS_PROVISIONED,
    "the pinned tokenizer is not provisioned; CI fetches it, so this case is "
    "NOT RUN rather than passed",
)
class PdfContentReclamationRouteTests(unittest.IsolatedAsyncioTestCase):
    """The governed action, and the file the PDF is.

    The route is the only supported way in: it takes the store's own writer
    (the advisory lock an index run takes), so a reclamation can never race a
    run and can never be done by hand.
    """

    def build_app(self, vault_root: Path):  # type: ignore[no-untyped-def]
        import httpx

        from app.config import Settings
        from app.main import create_app

        settings = Settings(
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
            vault_root=vault_root,
            tokenizer_path=Path(os.environ["KNOWLEDGE_TOKENIZER_PATH"]),
        )
        app = create_app(settings)
        app.state.database._pool = object()  # type: ignore[assignment]
        reserve = AsyncMock()
        release = AsyncMock()
        app.state.coordinator.reserve = reserve
        app.state.coordinator.release_reservation = release
        return app, httpx, reserve, release

    async def test_the_action_is_governed_and_the_pdf_file_stays(self) -> None:
        with TemporaryDirectory() as directory:
            vault = Path(directory)
            pdf = vault / "02. Books" / "Authority" / "report.pdf"
            pdf.parent.mkdir(parents=True)
            pdf.write_bytes(b"%PDF-1.7 the source document")
            before = pdf.read_bytes()
            app, httpx, reserve, release = self.build_app(vault)
            app.state.database.reclaim_pdf_content = AsyncMock(  # type: ignore[assignment]
                return_value=PdfContentReclamation(
                    build_id=str(BUILD_ID),
                    source_path=SOURCE_PATH,
                    content_identity_digest=DIGEST,
                    pdf_digest=PDF_DIGEST,
                    status="RECLAIMED",
                    segments_reclaimed=12,
                    sources_released=1,
                    reclaimed_at="2026-10-22 09:00:00+00",
                )
            )
            transport = httpx.ASGITransport(app=app)
            try:
                async with httpx.AsyncClient(
                    transport=transport, base_url="http://test"
                ) as client:
                    response = await client.post(
                        "/v1/pdf-content-reclamations", json={"source_path": SOURCE_PATH}
                    )
            finally:
                await app.state.model_probe.close()

            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["status"], "RECLAIMED")
            self.assertEqual(body["reclamation_id"], str(BUILD_ID))
            self.assertEqual(body["segments_reclaimed"], 12)
            # The action is governed: it takes the store's own writer and
            # gives it back.
            reserve.assert_awaited_once()
            release.assert_awaited_once()
            # The PDF stays: the file is untouched.
            self.assertTrue(pdf.is_file())
            self.assertEqual(pdf.read_bytes(), before)

    async def test_an_unknown_document_is_refused_with_a_named_code(self) -> None:
        with TemporaryDirectory() as directory:
            vault = Path(directory)
            app, httpx, _, _ = self.build_app(vault)
            app.state.database.reclaim_pdf_content = AsyncMock(  # type: ignore[assignment]
                side_effect=PdfContentNotFoundError("PDF_SOURCE_NOT_FOUND")
            )
            transport = httpx.ASGITransport(app=app)
            try:
                async with httpx.AsyncClient(
                    transport=transport, base_url="http://test"
                ) as client:
                    response = await client.post(
                        "/v1/pdf-content-reclamations", json={"source_path": SOURCE_PATH}
                    )
            finally:
                await app.state.model_probe.close()

            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json()["detail"]["code"], "PDF_SOURCE_NOT_FOUND")

    async def test_a_document_without_a_derived_copy_is_refused(self) -> None:
        """A refusal the operator can act on: the code names the reason."""

        with TemporaryDirectory() as directory:
            vault = Path(directory)
            app, httpx, _, _ = self.build_app(vault)
            app.state.database.reclaim_pdf_content = AsyncMock(  # type: ignore[assignment]
                side_effect=PdfContentNotReclaimableError("PDF_CONTENT_NOT_RECLAIMABLE")
            )
            transport = httpx.ASGITransport(app=app)
            try:
                async with httpx.AsyncClient(
                    transport=transport, base_url="http://test"
                ) as client:
                    response = await client.post(
                        "/v1/pdf-content-reclamations", json={"source_path": SOURCE_PATH}
                    )
            finally:
                await app.state.model_probe.close()

            self.assertEqual(response.status_code, 409)
            self.assertEqual(
                response.json()["detail"]["code"], "PDF_CONTENT_NOT_RECLAIMABLE"
            )

    async def test_a_build_that_changed_under_the_action_is_refused(self) -> None:
        """The state transition that failed is a CONFLICT, and it is named."""

        with TemporaryDirectory() as directory:
            vault = Path(directory)
            app, httpx, _, _ = self.build_app(vault)
            app.state.database.reclaim_pdf_content = AsyncMock(  # type: ignore[assignment]
                side_effect=StateTransitionError(
                    "PDF content build changed during reclamation."
                )
            )
            transport = httpx.ASGITransport(app=app)
            try:
                async with httpx.AsyncClient(
                    transport=transport, base_url="http://test"
                ) as client:
                    response = await client.post(
                        "/v1/pdf-content-reclamations", json={"source_path": SOURCE_PATH}
                    )
            finally:
                await app.state.model_probe.close()

            self.assertEqual(response.status_code, 409)
            self.assertEqual(
                response.json()["detail"]["code"], "PDF_CONTENT_RECLAMATION_FAILED"
            )


if __name__ == "__main__":
    unittest.main()
