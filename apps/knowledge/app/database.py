from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
from typing import Any, AsyncIterator, Mapping, Sequence
from uuid import UUID, uuid4

import asyncpg

from .markdown_adapter import MarkdownSource
from .run_errors import SafeRunError, serialize_errors


class StateTransitionError(RuntimeError):
    """Raised when a lifecycle transaction no longer owns its expected state."""


class PdfContentIdentityExistsError(RuntimeError):
    """An in-progress or READY build already owns this content identity."""


class PdfSchemaContractError(RuntimeError):
    """The installed schema cannot support the frozen M4/T2 lifecycle."""


_PDF_CONTENT_IDENTITY_INDEXES = {
    "knowledge_pdf_content_builds_one_building_idx",
    "knowledge_pdf_content_builds_one_ready_idx",
}
_PDF_SEGMENT_TYPES = {
    "PDF_PASSAGE",
    "PDF_TABLE",
    "PDF_FIGURE_TEXT",
}
_SEARCHABLE_SEGMENT_TYPES = {"MARKDOWN_PASSAGE", *_PDF_SEGMENT_TYPES}


@dataclass(frozen=True)
class PdfContentBuild:
    id: str
    content_identity_digest: str


@dataclass(frozen=True)
class PdfContentBatch:
    id: str
    build_id: str
    page_start: int
    page_end: int


@dataclass(frozen=True)
class PdfContentBatchState:
    batch: PdfContentBatch
    status: str


@dataclass(frozen=True)
class PdfContentBuildState:
    build: PdfContentBuild
    pdf_digest: str
    sidecar_digest: str
    processing_identity_digest: str
    status: str
    batches: tuple[PdfContentBatchState, ...]
    segment_count: int


@dataclass(frozen=True)
class PdfContentSegment:
    ordinal: int
    segment_type: str
    content: str
    page_start: int
    page_end: int
    bbox: tuple[float, float, float, float] | None
    provenance: Mapping[str, Any]


@dataclass(frozen=True)
class PdfPublicationSegment:
    chunk_ordinal: int
    segment_type: str
    content: str
    page_start: int
    page_end: int
    bbox: tuple[float, float, float, float] | None


@dataclass(frozen=True)
class ActiveIndex:
    id: str
    embedding_model_name: str
    embedding_model_digest: str
    embedding_dimensions: int


@dataclass(frozen=True)
class AcceptedIndexRun:
    id: str
    index_id: str
    kind: str
    status: str


@dataclass(frozen=True)
class IndexRunState:
    id: str
    index_id: str
    kind: str
    status: str
    started_at: str
    finished_at: str | None
    sources_discovered: int
    sources_indexed: int
    sources_failed: int
    failure_code: str | None
    failure_detail: str | None


@dataclass(frozen=True)
class SearchCandidate:
    id: str
    source_path: str
    title: str
    primary_topic: str
    tags: tuple[str, ...]
    heading_path: tuple[str, ...]
    text: str
    line_start: int | None
    line_end: int | None
    indexed_by_run_id: str
    dense_distance: float | None = None
    fts_score: float | None = None
    source_type: str = "MARKDOWN"
    page_start: int | None = None
    page_end: int | None = None
    bbox: tuple[float, float, float, float] | None = None


class ActiveIndexChangedError(RuntimeError):
    """The immutable ACTIVE index selected by search was replaced."""


class KnowledgeDatabase:
    def __init__(
        self,
        database_host: str,
        database_port: int,
        database_name: str,
        database_user: str,
        database_password: str,
        migration_directory: Path,
        advisory_lock_key: int = 741212391041002,
        acceptance_backup_barrier_dir: Path | None = None,
    ) -> None:
        self._database_host = database_host
        self._database_port = database_port
        self._database_name = database_name
        self._database_user = database_user
        self._database_password = database_password
        self._migration_directory = migration_directory
        self._advisory_lock_key = advisory_lock_key
        self._acceptance_backup_barrier_dir = acceptance_backup_barrier_dir
        self._pool: asyncpg.Pool | None = None
        self._owner_connection: asyncpg.Connection | None = None
        self._startup_owner_connection: asyncpg.Connection | None = None
        self.startup_error_code: str | None = None

    @property
    def available(self) -> bool:
        return self._pool is not None

    async def start(self) -> None:
        try:
            self._pool = await asyncpg.create_pool(
                host=self._database_host,
                port=self._database_port,
                database=self._database_name,
                user=self._database_user,
                password=self._database_password,
                min_size=1,
                max_size=4,
                timeout=10,
                command_timeout=30,
            )
            barrier_completed = self._acceptance_barrier_is_completed()
            if self._acceptance_backup_barrier_dir is None or barrier_completed:
                await self._apply_migrations()
            else:
                connection = await self.acquire_advisory_lock(self._advisory_lock_key)
                if connection is None:
                    raise RuntimeError("INDEX_RUN_ALREADY_ACTIVE")
                self.bind_owner_connection(connection)
                try:
                    await self._acceptance_backup_barrier(connection)
                    await self._apply_migrations(connection)
                    self._startup_owner_connection = connection
                except Exception:
                    self.unbind_owner_connection(connection)
                    await self.release_advisory_lock(connection, self._advisory_lock_key)
                    raise
            await self.assert_searchable_segment_type_domain()
        except Exception:
            self.startup_error_code = "DATABASE_UNAVAILABLE"
            if self._startup_owner_connection is not None:
                connection = self._startup_owner_connection
                self._startup_owner_connection = None
                self.unbind_owner_connection(connection)
                await self.release_advisory_lock(connection, self._advisory_lock_key)
            if self._pool is not None:
                await self._pool.close()
                self._pool = None

    async def stop(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    def take_startup_owner_connection(self) -> asyncpg.Connection | None:
        connection = self._startup_owner_connection
        self._startup_owner_connection = None
        return connection

    def _acceptance_barrier_is_completed(self) -> bool:
        directory = self._acceptance_backup_barrier_dir
        if directory is None:
            return False
        if str(directory) != "/acceptance-backup-barrier" or directory.is_symlink():
            raise RuntimeError("Invalid acceptance backup barrier directory.")
        resolved = directory.resolve(strict=True)
        if not resolved.is_dir() or str(resolved) != "/acceptance-backup-barrier":
            raise RuntimeError("Invalid acceptance backup barrier directory.")
        request_path = resolved / "request"
        completed_path = resolved / "completed"
        if not completed_path.exists():
            return False
        if request_path.is_symlink() or completed_path.is_symlink():
            raise RuntimeError("Invalid acceptance backup barrier completion state.")
        token = request_path.read_text(encoding="ascii").strip()
        completed = completed_path.read_text(encoding="ascii").strip()
        if not re.fullmatch(r"[a-f0-9]{64}", token) or completed != token:
            raise RuntimeError("Invalid acceptance backup barrier completion state.")
        return True

    async def _acceptance_backup_barrier(
        self, connection: asyncpg.Connection
    ) -> None:
        """Export a pre-migration snapshot without releasing index ownership."""

        directory = self._acceptance_backup_barrier_dir
        if directory is None:
            return
        if str(directory) != "/acceptance-backup-barrier" or directory.is_symlink():
            raise RuntimeError("Invalid acceptance backup barrier directory.")
        resolved = directory.resolve(strict=True)
        if not resolved.is_dir() or str(resolved) != "/acceptance-backup-barrier":
            raise RuntimeError("Invalid acceptance backup barrier directory.")
        request_path = resolved / "request"
        if request_path.is_symlink() or not request_path.is_file():
            raise RuntimeError("Invalid acceptance backup barrier request.")
        token = request_path.read_text(encoding="ascii").strip()
        if not re.fullmatch(r"[a-f0-9]{64}", token):
            raise RuntimeError("Invalid acceptance backup barrier request.")
        snapshot_path = resolved / "snapshot.json"
        continue_path = resolved / "continue"
        if snapshot_path.exists() or continue_path.exists():
            raise RuntimeError("Acceptance backup barrier state is not clean.")

        async with connection.transaction(isolation="repeatable_read", readonly=True):
            schema_ready = await connection.fetchval(
                """
                SELECT to_regclass('knowledge.schema_migrations') IS NOT NULL
                   AND to_regclass('knowledge.indexes') IS NOT NULL
                """
            )
            if not schema_ready:
                raise RuntimeError("M4 live acceptance requires the recoverable M3 schema.")
            snapshot_id = await connection.fetchval("SELECT pg_export_snapshot()")
            active_ids = [
                str(row["id"])
                for row in await connection.fetch(
                    "SELECT id FROM knowledge.indexes WHERE status = 'ACTIVE' ORDER BY id"
                )
            ]
            migration_versions = [
                row["version"]
                for row in await connection.fetch(
                    "SELECT version FROM knowledge.schema_migrations ORDER BY version"
                )
            ]
            database_identity = await connection.fetchrow(
                """
                SELECT current_database() AS database_name,
                       current_setting('server_version_num') AS server_version_num,
                       current_setting('server_encoding') AS server_encoding,
                       current_setting('lc_collate') AS lc_collate,
                       current_setting('lc_ctype') AS lc_ctype
                """
            )
            extensions = [
                {"name": row["extname"], "version": row["extversion"]}
                for row in await connection.fetch(
                    "SELECT extname, extversion FROM pg_extension ORDER BY extname"
                )
            ]
            payload = {
                "schema_version": 1,
                "token": token,
                "snapshot_id": snapshot_id,
                "prior_active_ids": active_ids,
                "migration_versions": migration_versions,
                "database": dict(database_identity),
                "extensions": extensions,
            }
            descriptor = os.open(
                snapshot_path,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                0o600,
            )
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                    json.dump(payload, stream, sort_keys=True, separators=(",", ":"))
                    stream.flush()
                    os.fsync(stream.fileno())
            finally:
                if not snapshot_path.exists():
                    raise RuntimeError("Acceptance backup snapshot was not persisted.")

            deadline = asyncio.get_running_loop().time() + 600
            while True:
                if continue_path.exists():
                    if continue_path.is_symlink() or not continue_path.is_file():
                        raise RuntimeError("Invalid acceptance backup continuation state.")
                    if continue_path.read_text(encoding="ascii").strip() != token:
                        raise RuntimeError("Invalid acceptance backup continuation token.")
                    completed_path = resolved / "completed"
                    descriptor = os.open(
                        completed_path,
                        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                        0o600,
                    )
                    with os.fdopen(descriptor, "w", encoding="ascii") as stream:
                        stream.write(token)
                        stream.flush()
                        os.fsync(stream.fileno())
                    break
                if asyncio.get_running_loop().time() >= deadline:
                    raise TimeoutError("Acceptance backup barrier timed out.")
                await asyncio.sleep(0.1)

    def bind_owner_connection(self, connection: asyncpg.Connection) -> None:
        """Route run-state mutations through the session that owns the lock."""

        if self._owner_connection is not None:
            raise StateTransitionError("An index owner session is already bound.")
        self._owner_connection = connection

    def unbind_owner_connection(self, connection: asyncpg.Connection) -> None:
        if self._owner_connection is connection:
            self._owner_connection = None

    @asynccontextmanager
    async def _mutation_transaction(self) -> AsyncIterator[asyncpg.Connection]:
        """Require the pinned advisory-lock owner for lifecycle mutation."""

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        connection = self._owner_connection
        if connection is None:
            raise StateTransitionError("Index ownership connection is not bound.")
        if connection.is_closed():
            raise StateTransitionError("Index ownership connection was lost.")
        async with connection.transaction():
            yield connection

    async def assert_pdf_content_identity_schema(self) -> None:
        """Reject schema drift; T2 must never repair migration 002 at runtime."""

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        rows = await self._pool.fetch(
            """
            SELECT indexdef
            FROM pg_indexes
            WHERE schemaname = 'knowledge' AND tablename = 'pdf_content_builds'
            """
        )
        definitions = [str(row["indexdef"]).upper() for row in rows]
        required = any(
            "UNIQUE INDEX" in definition
            and "CONTENT_IDENTITY_DIGEST" in definition
            and "WHERE" in definition
            and "BUILDING" in definition
            and "READY" in definition
            for definition in definitions
        )
        constraints = await self._pool.fetch(
            """
            SELECT pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
            WHERE conrelid = 'knowledge.pdf_content_builds'::regclass AND contype = 'u'
            """
        )
        unconditional = any(
            "CONTENT_IDENTITY_DIGEST" in str(row["definition"]).upper()
            for row in constraints
        )
        if not required or unconditional:
            raise PdfSchemaContractError("PDF_CONTENT_IDENTITY_SCHEMA_INVALID")

    async def assert_searchable_segment_type_domain(self) -> None:
        """Fail closed if a currently searchable segment cannot be typed."""

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        rows = await self._pool.fetch(
            """
            SELECT DISTINCT segments.segment_type
            FROM knowledge.segments
            JOIN knowledge.indexes ON knowledge.indexes.id = knowledge.segments.index_id
            WHERE knowledge.indexes.status IN ('ACTIVE', 'BUILDING')
            """
        )
        unknown = {row["segment_type"] for row in rows}.difference(
            _SEARCHABLE_SEGMENT_TYPES
        )
        if unknown:
            raise StateTransitionError("Searchable segment-type domain is incompatible.")

    async def create_pdf_content_build(
        self,
        *,
        content_identity_digest: str,
        pdf_digest: str,
        sidecar_digest: str,
        processing_identity_digest: str,
        page_count: int,
        batch_size: int,
    ) -> tuple[PdfContentBuild, tuple[PdfContentBatch, ...]]:
        """Atomically create a BUILDING row and its immutable PENDING ranges."""

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        if page_count < 1 or batch_size < 1:
            raise ValueError("PDF build page range is invalid.")
        build_id = uuid4()
        batches = tuple(
            PdfContentBatch(str(uuid4()), str(build_id), start, min(start + batch_size - 1, page_count))
            for start in range(1, page_count + 1, batch_size)
        )
        try:
            async with self._mutation_transaction() as connection:
                    await connection.execute(
                        """
                        INSERT INTO knowledge.pdf_content_builds
                            (id, content_identity_digest, pdf_digest, sidecar_digest,
                             processing_identity_digest, status)
                        VALUES ($1, $2, $3, $4, $5, 'BUILDING')
                        """,
                        build_id,
                        content_identity_digest,
                        pdf_digest,
                        sidecar_digest,
                        processing_identity_digest,
                    )
                    await connection.executemany(
                        """
                        INSERT INTO knowledge.pdf_content_batches
                            (id, build_id, page_start, page_end, status)
                        VALUES ($1, $2, $3, $4, 'PENDING')
                        """,
                        [
                            (UUID(batch.id), build_id, batch.page_start, batch.page_end)
                            for batch in batches
                        ],
                    )
        except asyncpg.UniqueViolationError as error:
            if getattr(error, "constraint_name", None) in _PDF_CONTENT_IDENTITY_INDEXES:
                raise PdfContentIdentityExistsError("PDF_CONTENT_IDENTITY_EXISTS") from error
            raise
        return PdfContentBuild(str(build_id), content_identity_digest), batches

    async def get_pdf_content_build_state(
        self, content_identity_digest: str
    ) -> PdfContentBuildState | None:
        """Read the one resumable BUILDING/READY identity, if it exists."""

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        row = await self._pool.fetchrow(
            """
            SELECT id::text, pdf_digest, sidecar_digest, processing_identity_digest,
                   status, content_identity_digest
            FROM knowledge.pdf_content_builds
            WHERE content_identity_digest = $1 AND status IN ('BUILDING', 'READY')
            """,
            content_identity_digest,
        )
        if row is None:
            return None
        batches = await self._pool.fetch(
            """
            SELECT id::text, build_id::text, page_start, page_end, status
            FROM knowledge.pdf_content_batches
            WHERE build_id = $1
            ORDER BY page_start, page_end, id
            """,
            UUID(row["id"]),
        )
        segment_count = await self._pool.fetchval(
            "SELECT count(*) FROM knowledge.pdf_content_segments WHERE build_id = $1",
            UUID(row["id"]),
        )
        return PdfContentBuildState(
            build=PdfContentBuild(str(row["id"]), row["content_identity_digest"]),
            pdf_digest=row["pdf_digest"],
            sidecar_digest=row["sidecar_digest"],
            processing_identity_digest=row["processing_identity_digest"],
            status=row["status"],
            batches=tuple(
                PdfContentBatchState(
                    PdfContentBatch(
                        str(batch["id"]),
                        str(batch["build_id"]),
                        int(batch["page_start"]),
                        int(batch["page_end"]),
                    ),
                    batch["status"],
                )
                for batch in batches
            ),
            segment_count=int(segment_count),
        )

    async def recover_pdf_content_build(
        self, state: PdfContentBuildState, expected_page_count: int
    ) -> PdfContentBuildState:
        """Reconcile a matching build after ownership is established.

        The global session lock proves no prior execution owner remains live.
        Only under that proof can a RUNNING child be returned to PENDING.
        """

        if state.status == "READY":
            self._validate_pdf_batch_topology(state.batches, expected_page_count)
            if (
                any(batch.status != "SUCCEEDED" for batch in state.batches)
                or state.segment_count < 1
            ):
                raise StateTransitionError("READY PDF build is incomplete.")
            return state
        recovery_failure = False
        async with self._mutation_transaction() as connection:
            build = await connection.fetchrow(
                """
                SELECT id::text, pdf_digest, sidecar_digest, processing_identity_digest,
                       status, content_identity_digest
                FROM knowledge.pdf_content_builds
                WHERE id = $1 FOR UPDATE
                """,
                UUID(state.build.id),
            )
            if build is None or build["status"] != "BUILDING":
                raise StateTransitionError("PDF content build changed during recovery.")
            batches = await connection.fetch(
                """
                SELECT id::text, build_id::text, page_start, page_end, status
                FROM knowledge.pdf_content_batches
                WHERE build_id = $1
                ORDER BY page_start, page_end, id FOR UPDATE
                """,
                UUID(state.build.id),
            )
            batch_states = tuple(
                PdfContentBatchState(
                    PdfContentBatch(
                        str(batch["id"]), str(batch["build_id"]),
                        int(batch["page_start"]), int(batch["page_end"]),
                    ),
                    batch["status"],
                )
                for batch in batches
            )
            self._validate_pdf_batch_topology(batch_states, expected_page_count)
            if any(batch.status == "FAILED" for batch in batch_states):
                await self._fail_pdf_build_locked(connection, state.build.id, "PDF_RUNTIME_FAILED")
                recovery_failure = True
            elif all(batch.status == "SUCCEEDED" for batch in batch_states):
                segment_count = await connection.fetchval(
                    "SELECT count(*) FROM knowledge.pdf_content_segments WHERE build_id = $1",
                    UUID(state.build.id),
                )
                if int(segment_count) < 1:
                    await self._fail_pdf_build_locked(connection, state.build.id, "PDF_RUNTIME_FAILED")
                    recovery_failure = True
                else:
                    updated = await connection.fetchval(
                        """
                        UPDATE knowledge.pdf_content_builds
                        SET status = 'READY', ready_at = now(), finished_at = now()
                        WHERE id = $1 AND status = 'BUILDING'
                        RETURNING id
                        """,
                        UUID(state.build.id),
                    )
                    if updated is None:
                        raise StateTransitionError("PDF completed build changed during recovery.")
            elif any(batch.status == "RUNNING" for batch in batch_states):
                await connection.execute(
                    """
                    UPDATE knowledge.pdf_content_batches
                    SET status = 'PENDING', started_at = NULL
                    WHERE build_id = $1 AND status = 'RUNNING'
                    """,
                    UUID(state.build.id),
                )

        if recovery_failure:
            raise StateTransitionError("PDF build was finalized FAILED during recovery.")
        recovered = await self.get_pdf_content_build_state(state.build.content_identity_digest)
        if recovered is None:
            raise StateTransitionError("PDF content build disappeared during recovery.")
        return recovered

    async def start_pdf_content_batch(self, batch: PdfContentBatch) -> None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        async with self._mutation_transaction() as connection:
                await self._require_pdf_building(connection, batch.build_id)
                updated = await connection.fetchval(
                    """
                    UPDATE knowledge.pdf_content_batches
                    SET status = 'RUNNING', started_at = now()
                    WHERE id = $1 AND build_id = $2 AND status = 'PENDING'
                    RETURNING id
                    """,
                    UUID(batch.id),
                    UUID(batch.build_id),
                )
                if updated is None:
                    raise StateTransitionError("PDF batch is no longer PENDING.")

    async def complete_pdf_content_batch(
        self, batch: PdfContentBatch, segments: Sequence[PdfContentSegment]
    ) -> None:
        """Insert all batch output and mark success in one short transaction."""

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        async with self._mutation_transaction() as connection:
                await self._require_pdf_building(connection, batch.build_id)
                state = await connection.fetchval(
                    """
                    SELECT status FROM knowledge.pdf_content_batches
                    WHERE id = $1 AND build_id = $2 FOR UPDATE
                    """,
                    UUID(batch.id), UUID(batch.build_id),
                )
                if state != "RUNNING":
                    raise StateTransitionError("PDF batch is no longer RUNNING.")
                if segments:
                    await connection.executemany(
                        """
                        INSERT INTO knowledge.pdf_content_segments
                            (id, build_id, batch_id, ordinal, segment_type, content,
                             page_start, page_end, bbox, provenance)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
                        """,
                        [
                            (
                                uuid4(),
                                UUID(batch.build_id),
                                UUID(batch.id),
                                segment.ordinal,
                                segment.segment_type,
                                segment.content,
                                segment.page_start,
                                segment.page_end,
                                list(segment.bbox) if segment.bbox is not None else None,
                                json.dumps(
                                    segment.provenance,
                                    sort_keys=True,
                                    separators=(",", ":"),
                                ),
                            )
                            for segment in segments
                        ],
                    )
                updated = await connection.fetchval(
                    """
                    UPDATE knowledge.pdf_content_batches
                    SET status = 'SUCCEEDED', finished_at = now()
                    WHERE id = $1 AND build_id = $2 AND status = 'RUNNING'
                    RETURNING id
                    """,
                    UUID(batch.id), UUID(batch.build_id),
                )
                if updated is None:
                    raise StateTransitionError("PDF batch did not reach SUCCEEDED.")

    async def fail_pdf_content_batch_and_build(self, batch: PdfContentBatch, code: str) -> None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        async with self._mutation_transaction() as connection:
                await self._require_pdf_building(connection, batch.build_id)
                failed_batch = await connection.fetchval(
                    """
                    UPDATE knowledge.pdf_content_batches
                    SET status = 'FAILED', failure_code = $3, finished_at = now()
                    WHERE id = $1 AND build_id = $2 AND status = 'RUNNING'
                    RETURNING id
                    """,
                    UUID(batch.id), UUID(batch.build_id), code,
                )
                if failed_batch is None:
                    raise StateTransitionError("PDF batch did not reach FAILED.")
                await self._fail_pdf_build_locked(connection, batch.build_id, code)

    async def fail_pdf_content_build(self, build: PdfContentBuild, code: str) -> None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        async with self._mutation_transaction() as connection:
                await self._require_pdf_building(connection, build.id)
                await self._fail_pdf_build_locked(connection, build.id, code)

    async def complete_pdf_content_build(self, build: PdfContentBuild) -> None:
        """Make a build READY only after every range and all output are present."""

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        async with self._mutation_transaction() as connection:
                await self._require_pdf_building(connection, build.id)
                batch_states = await connection.fetch(
                    "SELECT status FROM knowledge.pdf_content_batches WHERE build_id = $1 FOR UPDATE",
                    UUID(build.id),
                )
                if not batch_states or any(row["status"] != "SUCCEEDED" for row in batch_states):
                    raise StateTransitionError("PDF build has incomplete batches.")
                segment_count = await connection.fetchval(
                    "SELECT count(*) FROM knowledge.pdf_content_segments WHERE build_id = $1",
                    UUID(build.id),
                )
                if segment_count < 1:
                    raise StateTransitionError("PDF build has no extractable content.")
                updated = await connection.fetchval(
                    """
                    UPDATE knowledge.pdf_content_builds
                    SET status = 'READY', ready_at = now(), finished_at = now()
                    WHERE id = $1 AND status = 'BUILDING'
                    RETURNING id
                    """,
                    UUID(build.id),
                )
                if updated is None:
                    raise StateTransitionError("PDF build did not reach READY.")

    async def pdf_publication_segments(
        self, build_id: str
    ) -> tuple[PdfPublicationSegment, ...]:
        """Read READY build output in deterministic global publication order."""

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        rows = await self._pool.fetch(
            """
            SELECT segment_type, content, pdf_content_segments.page_start,
                   pdf_content_segments.page_end, bbox
            FROM knowledge.pdf_content_segments
            JOIN knowledge.pdf_content_batches
              ON pdf_content_batches.id = pdf_content_segments.batch_id
             AND pdf_content_batches.build_id = pdf_content_segments.build_id
            JOIN knowledge.pdf_content_builds
              ON pdf_content_builds.id = pdf_content_segments.build_id
            WHERE pdf_content_segments.build_id = $1
              AND pdf_content_builds.status = 'READY'
              AND pdf_content_batches.status = 'SUCCEEDED'
            ORDER BY pdf_content_batches.page_start, pdf_content_batches.page_end,
                     pdf_content_segments.ordinal
            """,
            UUID(build_id),
        )
        segments = tuple(
            PdfPublicationSegment(
                chunk_ordinal=ordinal,
                segment_type=row["segment_type"],
                content=row["content"],
                page_start=int(row["page_start"]),
                page_end=int(row["page_end"]),
                bbox=(tuple(float(value) for value in row["bbox"]) if row["bbox"] is not None else None),
            )
            for ordinal, row in enumerate(rows)
        )
        if not segments:
            raise StateTransitionError("READY PDF content build has no segments.")
        return segments

    async def get_active_index(self) -> ActiveIndex | None:
        return await self.get_index_by_status("ACTIVE")

    async def get_index(self, index_id: str) -> ActiveIndex | None:
        if self._pool is None:
            return None
        row = await self._pool.fetchrow(
            """
            SELECT id, embedding_model_name, embedding_model_digest, embedding_dimensions
            FROM knowledge.indexes WHERE id = $1
            """,
            UUID(index_id),
        )
        return self._index_from_row(row)

    async def get_index_by_status(self, status: str) -> ActiveIndex | None:
        if self._pool is None:
            return None
        row = await self._pool.fetchrow(
            """
            SELECT id, embedding_model_name, embedding_model_digest, embedding_dimensions
            FROM knowledge.indexes WHERE status = $1::knowledge.index_status
            """,
            status,
        )
        return self._index_from_row(row)

    @staticmethod
    def _index_from_row(row: asyncpg.Record | None) -> ActiveIndex | None:
        if row is None:
            return None
        return ActiveIndex(
            id=str(row["id"]),
            embedding_model_name=row["embedding_model_name"],
            embedding_model_digest=row["embedding_model_digest"],
            embedding_dimensions=row["embedding_dimensions"],
        )

    async def get_run(self, run_id: str) -> IndexRunState | None:
        if self._pool is None:
            return None
        row = await self._pool.fetchrow(
            """
            SELECT id::text, index_id::text, kind::text, status::text, started_at::text,
                   finished_at::text, sources_discovered, sources_indexed,
                   sources_failed, failure_code, failure_detail
            FROM knowledge.index_runs WHERE id = $1
            """,
            UUID(run_id),
        )
        if row is None:
            return None
        return IndexRunState(**dict(row))

    async def get_run_source_counts(self, run_id: str) -> list[dict[str, int | str]]:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        rows = await self._pool.fetch(
            """
            SELECT source_type, discovered_count, indexed_count, failed_count
            FROM knowledge.index_run_source_counts
            WHERE index_run_id = $1
            ORDER BY CASE source_type WHEN 'MARKDOWN' THEN 1 WHEN 'PDF' THEN 2 END
            """,
            UUID(run_id),
        )
        return [dict(row) for row in rows]

    async def accept_incremental(self, active_index: ActiveIndex) -> AcceptedIndexRun:
        return await self._accept_run("INCREMENTAL", active_index.id)

    async def accept_full_rebuild(
        self, model_name: str, model_digest: str, dimensions: int
    ) -> AcceptedIndexRun:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        index_id, run_id = uuid4(), uuid4()
        async with self._mutation_transaction() as connection:
                await connection.execute(
                    """
                    INSERT INTO knowledge.indexes
                      (id, status, embedding_model_name, embedding_model_digest, embedding_dimensions)
                    VALUES ($1, 'BUILDING', $2, $3, $4)
                    """,
                    index_id,
                    model_name,
                    model_digest,
                    dimensions,
                )
                await connection.execute(
                    """
                    INSERT INTO knowledge.index_runs (id, index_id, kind, status)
                    VALUES ($1, $2, 'FULL_REBUILD', 'RUNNING')
                    """,
                    run_id,
                    index_id,
                )
        return AcceptedIndexRun(str(run_id), str(index_id), "FULL_REBUILD", "RUNNING")

    async def _accept_run(self, kind: str, index_id: str) -> AcceptedIndexRun:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        run_id = uuid4()
        index_uuid = UUID(index_id)
        async with self._mutation_transaction() as connection:
                index_status = await connection.fetchval(
                    "SELECT status::text FROM knowledge.indexes WHERE id = $1 FOR UPDATE",
                    index_uuid,
                )
                if index_status != "ACTIVE":
                    raise StateTransitionError("Incremental target is no longer ACTIVE.")
                await connection.execute(
                    """
                    INSERT INTO knowledge.index_runs (id, index_id, kind, status)
                    VALUES ($1, $2, $3::knowledge.index_run_kind, 'RUNNING')
                    """,
                    run_id,
                    index_uuid,
                    kind,
                )
        return AcceptedIndexRun(str(run_id), index_id, kind, "RUNNING")

    async def source_hashes(self, index_id: str) -> dict[str, str]:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        rows = await self._pool.fetch(
            "SELECT source_path, sha256 FROM knowledge.sources WHERE index_id = $1",
            UUID(index_id),
        )
        return {row["source_path"]: row["sha256"] for row in rows}

    async def source_count(self, index_id: str) -> int:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        return int(
            await self._pool.fetchval(
                "SELECT count(*) FROM knowledge.sources WHERE index_id = $1", UUID(index_id)
            )
        )

    async def search_candidates(
        self,
        index_id: str,
        query_embedding: list[float],
        query: str,
        primary_topic: str | None,
        tags_all: tuple[str, ...],
        path_prefix: str | None,
        segment_types: tuple[str, ...] = ("MARKDOWN_PASSAGE",),
    ) -> tuple[list[SearchCandidate], list[SearchCandidate]]:
        """Read both branches from one repeatable-read ACTIVE-index snapshot."""
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        vector = "[" + ",".join(format(value, ".17g") for value in query_embedding) + "]"
        tags = list(tags_all) if tags_all else None
        async with self._pool.acquire() as connection:
            async with connection.transaction(isolation="repeatable_read", readonly=True):
                active = await connection.fetchval(
                    "SELECT id::text FROM knowledge.indexes WHERE status = 'ACTIVE'"
                )
                if active != index_id:
                    raise ActiveIndexChangedError("ACTIVE index changed.")
                # These query-scoped settings must be issued on exactly the
                # connection used by the ANN SELECT.
                await connection.execute("SET LOCAL hnsw.iterative_scan = strict_order")
                await connection.execute("SET LOCAL hnsw.ef_search = 100")
                await connection.execute("SET LOCAL hnsw.max_scan_tuples = 20000")
                await connection.execute("SET LOCAL hnsw.scan_mem_multiplier = 1")
                common = """
                    index_id = $1::uuid
                    AND segment_type = ANY($6::text[])
                    AND ($3::text IS NULL OR primary_topic = $3)
                    AND ($4::text[] IS NULL OR tags @> $4::text[])
                    AND ($5::text IS NULL OR source_path = $5
                         OR left(source_path, char_length($5) + 1) = $5 || '/')
                """
                # The inner query intentionally has only the pgvector distance
                # operator in ascending order plus LIMIT, which permits HNSW.
                dense_rows = await connection.fetch(
                    f"""
                    WITH ann AS MATERIALIZED (
                      SELECT id, source_path, title, primary_topic, tags, heading_path,
                             text, line_start, line_end, page_start, page_end, bbox,
                             segment_type, indexed_by_run_id,
                             embedding <=> $2::vector AS dense_distance
                      FROM knowledge.segments
                      WHERE {common}
                      ORDER BY embedding <=> $2::vector ASC
                      LIMIT 40
                    )
                    SELECT * FROM ann ORDER BY dense_distance ASC, id ASC
                    """,
                    UUID(index_id), vector, primary_topic, tags, path_prefix, list(segment_types),
                )
                fts_rows = await connection.fetch(
                    f"""
                    WITH parsed AS (
                      SELECT websearch_to_tsquery('simple', $2) AS value
                    )
                    SELECT segments.id, source_path, title, primary_topic, tags,
                           heading_path, text, line_start, line_end, page_start, page_end, bbox,
                           segment_type, indexed_by_run_id,
                           ts_rank_cd('{{0.1,0.2,0.4,1.0}}', search_vector,
                                      parsed.value, 0) AS fts_score
                    FROM knowledge.segments, parsed
                    WHERE {common} AND search_vector @@ parsed.value
                    ORDER BY fts_score DESC, segments.id ASC
                    LIMIT 40
                    """,
                    UUID(index_id), query, primary_topic, tags, path_prefix, list(segment_types),
                )
        active_after = await self._pool.fetchval(
            "SELECT id::text FROM knowledge.indexes WHERE status = 'ACTIVE'"
        )
        if active_after != index_id:
            raise ActiveIndexChangedError("ACTIVE index changed.")
        return (
            [self._candidate_from_row(row, "dense_distance") for row in dense_rows],
            [self._candidate_from_row(row, "fts_score") for row in fts_rows],
        )

    @staticmethod
    def _candidate_from_row(row: asyncpg.Record, score_name: str) -> SearchCandidate:
        segment_type = str(row["segment_type"])
        if segment_type == "MARKDOWN_PASSAGE":
            source_type = "MARKDOWN"
        elif segment_type in {"PDF_PASSAGE", "PDF_TABLE", "PDF_FIGURE_TEXT"}:
            source_type = "PDF"
        else:
            raise StateTransitionError("Search result has an unknown segment type.")
        return SearchCandidate(
            id=str(row["id"]),
            source_path=row["source_path"],
            title=row["title"],
            primary_topic=row["primary_topic"],
            tags=tuple(row["tags"]),
            heading_path=tuple(row["heading_path"]),
            text=row["text"],
            line_start=int(row["line_start"]) if row["line_start"] is not None else None,
            line_end=int(row["line_end"]) if row["line_end"] is not None else None,
            indexed_by_run_id=str(row["indexed_by_run_id"]),
            dense_distance=float(row[score_name]) if score_name == "dense_distance" else None,
            fts_score=float(row[score_name]) if score_name == "fts_score" else None,
            source_type=source_type,
            page_start=int(row["page_start"]) if row["page_start"] is not None else None,
            page_end=int(row["page_end"]) if row["page_end"] is not None else None,
            bbox=tuple(float(value) for value in row["bbox"]) if row["bbox"] is not None else None,
        )

    async def set_discovered(self, run_id: str, discovered: int) -> None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        async with self._mutation_transaction() as connection:
            updated = await connection.fetchval(
                """
                UPDATE knowledge.index_runs SET sources_discovered = $2
                WHERE id = $1 AND status = 'RUNNING' RETURNING id
                """,
                UUID(run_id),
                discovered,
            )
        if updated is None:
            raise StateTransitionError("Index run is no longer RUNNING.")

    async def replace_source(
        self,
        run: AcceptedIndexRun,
        source: MarkdownSource,
        embeddings: list[list[float]],
    ) -> None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        if len(embeddings) != len(source.segments):
            raise ValueError("Embedding count does not match source segments.")
        source_id = uuid4()
        async with self._mutation_transaction() as connection:
                await self._require_run_and_index_state(connection, run)
                await connection.execute(
                    "DELETE FROM knowledge.sources WHERE index_id = $1 AND source_path = $2",
                    UUID(run.index_id),
                    source.source_path,
                )
                await connection.execute(
                    """
                    INSERT INTO knowledge.sources (
                      id, index_id, source_type, source_path, sha256, mime_type, title,
                      primary_topic, canonical_topics, tags, indexed_by_run_id
                    ) VALUES ($1, $2, 'MARKDOWN', $3, $4, $5, $6, $7, $8, $9, $10)
                    """,
                    source_id,
                    UUID(run.index_id),
                    source.source_path,
                    source.sha256,
                    source.mime_type,
                    source.title,
                    source.primary_topic,
                    list(source.canonical_topics),
                    list(source.tags),
                    UUID(run.id),
                )
                for segment, embedding in zip(source.segments, embeddings, strict=True):
                    vector = "[" + ",".join(format(value, ".17g") for value in embedding) + "]"
                    await connection.execute(
                        """
                        INSERT INTO knowledge.segments (
                          id, index_id, source_id, segment_type, chunk_ordinal, source_path,
                          title, primary_topic, canonical_topics, tags, heading_path,
                          heading_text, text, line_start, line_end, embedding, search_vector,
                          indexed_by_run_id
                        ) VALUES (
                          $1, $2, $3, 'MARKDOWN_PASSAGE', $4, $5, $6, $7, $8, $9,
                          $10, $11, $12, $13, $14, $15::vector,
                          setweight(to_tsvector('simple', $6), 'A') ||
                          setweight(to_tsvector('simple', array_to_string($9::text[], ' ')), 'A') ||
                          setweight(to_tsvector('simple', $11), 'B') ||
                          setweight(to_tsvector('simple', $12), 'D'),
                          $16
                        )
                        """,
                        uuid4(),
                        UUID(run.index_id),
                        source_id,
                        segment.chunk_ordinal,
                        source.source_path,
                        source.title,
                        source.primary_topic,
                        list(source.canonical_topics),
                        list(source.tags),
                        list(segment.heading_path),
                        segment.heading_text,
                        segment.text,
                        segment.line_start,
                        segment.line_end,
                        vector,
                        UUID(run.id),
                    )

    async def replace_pdf_source(
        self,
        run: AcceptedIndexRun,
        *,
        source_path: str,
        content_identity_digest: str,
        title: str,
        canonical_topics: tuple[str, ...],
        tags: tuple[str, ...],
        build_id: str,
        segments: Sequence[PdfPublicationSegment],
        embeddings: Sequence[Sequence[float]],
        validate_before_publish: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        """Atomically replace one PDF source with deterministic READY content."""

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        if not segments or len(segments) != len(embeddings) or not canonical_topics:
            raise ValueError("PDF publication payload is invalid.")
        if any(segment.segment_type not in _PDF_SEGMENT_TYPES for segment in segments):
            raise ValueError("PDF publication contains an unknown segment type.")
        source_id = uuid4()
        async with self._mutation_transaction() as connection:
                await self._require_run_and_index_state(connection, run)
                ready = await connection.fetchval(
                    """
                    SELECT id FROM knowledge.pdf_content_builds
                    WHERE id = $1 AND status = 'READY'
                    """,
                    UUID(build_id),
                )
                if ready is None:
                    raise StateTransitionError("PDF content build is no longer READY.")
                if validate_before_publish is not None:
                    await validate_before_publish()
                await connection.execute(
                    "DELETE FROM knowledge.sources WHERE index_id = $1 AND source_path = $2",
                    UUID(run.index_id), source_path,
                )
                await connection.execute(
                    """
                    INSERT INTO knowledge.sources (
                      id, index_id, source_type, source_path, sha256, mime_type, title,
                      primary_topic, canonical_topics, tags, indexed_by_run_id
                    ) VALUES ($1, $2, 'PDF', $3, $4, 'application/pdf', $5, $6, $7, $8, $9)
                    """,
                    source_id, UUID(run.index_id), source_path, content_identity_digest,
                    title, canonical_topics[0], list(canonical_topics), list(tags), UUID(run.id),
                )
                await connection.execute(
                    """
                    INSERT INTO knowledge.pdf_source_details (index_id, source_id, build_id)
                    VALUES ($1, $2, $3)
                    """,
                    UUID(run.index_id), source_id, UUID(build_id),
                )
                for segment, embedding in zip(segments, embeddings, strict=True):
                    vector = "[" + ",".join(format(value, ".17g") for value in embedding) + "]"
                    await connection.execute(
                        """
                        INSERT INTO knowledge.segments (
                          id, index_id, source_id, segment_type, chunk_ordinal, source_path,
                          title, primary_topic, canonical_topics, tags, heading_path,
                          heading_text, text, page_start, page_end, bbox, embedding,
                          search_vector, indexed_by_run_id
                        ) VALUES (
                          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                          $14, $15, $16, $17::vector,
                          setweight(to_tsvector('simple', $7), 'A') ||
                          setweight(to_tsvector('simple', array_to_string($9::text[], ' ')), 'A') ||
                          setweight(to_tsvector('simple', $12), 'B') ||
                          setweight(to_tsvector('simple', $13), 'D'),
                          $18
                        )
                        """,
                        uuid4(), UUID(run.index_id), source_id, segment.segment_type,
                        segment.chunk_ordinal, source_path, title, canonical_topics[0],
                        list(canonical_topics), list(tags), [title], title, segment.content,
                        segment.page_start, segment.page_end,
                        list(segment.bbox) if segment.bbox is not None else None,
                        vector, UUID(run.id),
                    )

    async def complete_incremental(
        self,
        run: AcceptedIndexRun,
        discovered: int,
        indexed: int,
        stale_paths: set[str],
        source_counts: Mapping[str, tuple[int, int, int]] | None = None,
    ) -> None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        async with self._mutation_transaction() as connection:
                await self._require_run_and_index_state(connection, run)
                if stale_paths:
                    await connection.execute(
                        "DELETE FROM knowledge.sources WHERE index_id = $1 AND source_path = ANY($2::text[])",
                        UUID(run.index_id),
                        sorted(stale_paths),
                    )
                await self._upsert_source_counts_locked(connection, run.id, source_counts)
                updated_run = await connection.fetchval(
                    """
                    UPDATE knowledge.index_runs
                    SET status = 'SUCCEEDED', finished_at = now(), sources_discovered = $2,
                        sources_indexed = $3, sources_failed = 0
                    WHERE id = $1 AND status = 'RUNNING'
                    RETURNING id
                    """,
                    UUID(run.id),
                    discovered,
                    indexed,
                )
                if updated_run is None:
                    raise StateTransitionError("Incremental run did not reach SUCCEEDED.")

    async def publish_full_rebuild(
        self,
        run: AcceptedIndexRun,
        discovered: int,
        indexed: int,
        source_counts: Mapping[str, tuple[int, int, int]] | None = None,
    ) -> list[str]:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        async with self._mutation_transaction() as connection:
                await self._require_run_and_index_state(connection, run)
                await connection.fetch(
                    "SELECT id FROM knowledge.indexes WHERE status = 'ACTIVE' FOR UPDATE"
                )
                await connection.execute(
                    """
                    UPDATE knowledge.indexes SET status = 'SUPERSEDED', superseded_at = now()
                    WHERE status = 'ACTIVE'
                    """
                )
                activated = await connection.fetchval(
                    """
                    UPDATE knowledge.indexes SET status = 'ACTIVE', activated_at = now()
                    WHERE id = $1 AND status = 'BUILDING'
                    RETURNING id
                    """,
                    UUID(run.index_id),
                )
                if activated is None:
                    raise StateTransitionError("BUILDING index did not reach ACTIVE.")
                await self._upsert_source_counts_locked(connection, run.id, source_counts)
                completed_run = await connection.fetchval(
                    """
                    UPDATE knowledge.index_runs
                    SET status = 'SUCCEEDED', finished_at = now(), sources_discovered = $2,
                        sources_indexed = $3, sources_failed = 0
                    WHERE id = $1 AND status = 'RUNNING'
                    RETURNING id
                    """,
                    UUID(run.id),
                    discovered,
                    indexed,
                )
                if completed_run is None:
                    raise StateTransitionError("Full-rebuild run did not reach SUCCEEDED.")
                cleanup_rows = await connection.fetch(
                    "SELECT id FROM knowledge.indexes WHERE status = 'SUPERSEDED'"
                )
                cleanup_ids = [str(row["id"]) for row in cleanup_rows]
        return cleanup_ids

    async def fail_run(
        self,
        run: AcceptedIndexRun,
        code: str,
        errors: list[SafeRunError],
        discovered: int,
        indexed: int,
        failed: int,
        fail_index: bool,
        source_counts: Mapping[str, tuple[int, int, int]] | None = None,
    ) -> None:
        if self._pool is None:
            return
        detail = serialize_errors(errors or [SafeRunError(code)])
        async with self._mutation_transaction() as connection:
                run_row = await connection.fetchrow(
                    """
                    SELECT index_id, kind::text, status::text
                    FROM knowledge.index_runs WHERE id = $1 FOR UPDATE
                    """,
                    UUID(run.id),
                )
                if run_row is None:
                    raise StateTransitionError("Index run does not exist.")
                if run_row["status"] != "RUNNING":
                    return
                if str(run_row["index_id"]) != run.index_id or run_row["kind"] != run.kind:
                    raise StateTransitionError("Index run identity changed unexpectedly.")
                await self._upsert_source_counts_locked(connection, run.id, source_counts)
                if fail_index:
                    index_status = await connection.fetchval(
                        "SELECT status::text FROM knowledge.indexes WHERE id = $1 FOR UPDATE",
                        UUID(run.index_id),
                    )
                    if index_status != "BUILDING":
                        raise StateTransitionError("Full-rebuild target is no longer BUILDING.")
                    failed_index = await connection.fetchval(
                        """
                        UPDATE knowledge.indexes
                        SET status = 'FAILED', failed_at = now(), failure_code = $2,
                            failure_detail = $3
                        WHERE id = $1 AND status = 'BUILDING'
                        RETURNING id
                        """,
                        UUID(run.index_id),
                        code,
                        detail,
                    )
                    if failed_index is None:
                        raise StateTransitionError("BUILDING index did not reach FAILED.")
                failed_run = await connection.fetchval(
                    """
                    UPDATE knowledge.index_runs
                    SET status = 'FAILED', finished_at = now(), sources_discovered = $2,
                        sources_indexed = $3, sources_failed = $4, failure_code = $5,
                        failure_detail = $6
                    WHERE id = $1 AND status = 'RUNNING'
                    RETURNING id
                    """,
                    UUID(run.id),
                    discovered,
                    indexed,
                    failed,
                    code,
                    detail,
                )
                if failed_run is None:
                    raise StateTransitionError("Index run did not reach FAILED.")

    async def cleanup_superseded(self, index_ids: list[str]) -> None:
        if not index_ids or self._pool is None:
            return
        async with self._mutation_transaction() as connection:
            await connection.execute(
                """
                DELETE FROM knowledge.sources
                WHERE index_id = ANY($1::uuid[])
                  AND EXISTS (
                    SELECT 1 FROM knowledge.indexes
                    WHERE knowledge.indexes.id = knowledge.sources.index_id
                      AND knowledge.indexes.status = 'SUPERSEDED'
                  )
                """,
                [UUID(index_id) for index_id in index_ids],
            )

    async def recover_interrupted_runs(self) -> int:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        async with self._mutation_transaction() as connection:
                rows = await connection.fetch(
                    "SELECT id, index_id, kind::text FROM knowledge.index_runs WHERE status = 'RUNNING' FOR UPDATE"
                )
                await connection.execute(
                    """
                    UPDATE knowledge.index_runs
                    SET status = 'INTERRUPTED', finished_at = now(), failure_code = 'PROCESS_RESTART',
                        failure_detail = $1
                    WHERE status = 'RUNNING'
                    """,
                    serialize_errors([SafeRunError("PROCESS_RESTART")]),
                )
                full_rebuild_ids = [row["index_id"] for row in rows if row["kind"] == "FULL_REBUILD"]
                if full_rebuild_ids:
                    await connection.execute(
                        """
                        UPDATE knowledge.indexes
                        SET status = 'FAILED', failed_at = now(), failure_code = 'PROCESS_RESTART',
                            failure_detail = $1
                        WHERE id = ANY($2::uuid[]) AND status = 'BUILDING'
                        """,
                        serialize_errors([SafeRunError("PROCESS_RESTART")]),
                        full_rebuild_ids,
                    )
                await connection.execute(
                    """
                    UPDATE knowledge.indexes
                    SET status = 'FAILED', failed_at = now(), failure_code = 'ORPHANED_BUILDING_INDEX',
                        failure_detail = $1
                    WHERE status = 'BUILDING'
                    """,
                    serialize_errors([SafeRunError("ORPHANED_BUILDING_INDEX")]),
                )
        return len(rows)

    async def acquire_advisory_lock(self, lock_key: int) -> asyncpg.Connection | None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        connection = await self._pool.acquire()
        if await connection.fetchval("SELECT pg_try_advisory_lock($1)", lock_key):
            return connection
        await self._pool.release(connection)
        return None

    async def release_advisory_lock(self, connection: asyncpg.Connection, lock_key: int) -> None:
        if self._pool is None:
            return
        try:
            if not connection.is_closed():
                await connection.execute("SELECT pg_advisory_unlock($1)", lock_key)
        except (asyncpg.PostgresError, asyncpg.InterfaceError, ConnectionError):
            # PostgreSQL releases a session advisory lock with a lost connection.
            pass
        finally:
            await self._pool.release(connection)

    @staticmethod
    async def _require_pdf_building(connection: asyncpg.Connection, build_id: str) -> None:
        status = await connection.fetchval(
            "SELECT status FROM knowledge.pdf_content_builds WHERE id = $1 FOR UPDATE",
            UUID(build_id),
        )
        if status != "BUILDING":
            raise StateTransitionError("PDF content build is no longer BUILDING.")

    @staticmethod
    async def _upsert_source_counts_locked(
        connection: asyncpg.Connection,
        run_id: str,
        source_counts: Mapping[str, tuple[int, int, int]] | None,
    ) -> None:
        if source_counts is None:
            return
        if set(source_counts) != {"MARKDOWN", "PDF"}:
            raise ValueError("Source counts must contain MARKDOWN and PDF only.")
        values: list[tuple[UUID, str, int, int, int]] = []
        for source_type in ("MARKDOWN", "PDF"):
            discovered, indexed, failed = source_counts[source_type]
            if min(discovered, indexed, failed) < 0:
                raise ValueError("Source counts cannot be negative.")
            values.append((UUID(run_id), source_type, discovered, indexed, failed))
        await connection.executemany(
            """
            INSERT INTO knowledge.index_run_source_counts
              (index_run_id, source_type, discovered_count, indexed_count, failed_count)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (index_run_id, source_type) DO UPDATE
              SET discovered_count = EXCLUDED.discovered_count,
                  indexed_count = EXCLUDED.indexed_count,
                  failed_count = EXCLUDED.failed_count
            """,
            values,
        )

    @staticmethod
    def _validate_pdf_batch_topology(
        batches: Sequence[PdfContentBatchState], expected_page_count: int
    ) -> None:
        """Reject a corrupted or incomplete expected-batch manifest."""

        if expected_page_count < 1 or not batches:
            raise StateTransitionError("PDF content build has no batch manifest.")
        expected_start = 1
        for state in batches:
            batch = state.batch
            if (
                batch.page_start != expected_start
                or batch.page_end < batch.page_start
                or state.status not in {"PENDING", "RUNNING", "SUCCEEDED", "FAILED"}
            ):
                raise StateTransitionError("PDF content batch topology is invalid.")
            expected_start = batch.page_end + 1
        if expected_start != expected_page_count + 1:
            raise StateTransitionError("PDF content batch manifest is incomplete.")

    @staticmethod
    async def _fail_pdf_build_locked(
        connection: asyncpg.Connection, build_id: str, code: str
    ) -> None:
        updated = await connection.fetchval(
            """
            UPDATE knowledge.pdf_content_builds
            SET status = 'FAILED', failure_code = $2, finished_at = now()
            WHERE id = $1 AND status = 'BUILDING'
            RETURNING id
            """,
            UUID(build_id), code,
        )
        if updated is None:
            raise StateTransitionError("PDF build did not reach FAILED.")

    @staticmethod
    async def _require_run_and_index_state(
        connection: asyncpg.Connection, run: AcceptedIndexRun
    ) -> None:
        run_row = await connection.fetchrow(
            """
            SELECT index_id, kind::text, status::text
            FROM knowledge.index_runs WHERE id = $1 FOR UPDATE
            """,
            UUID(run.id),
        )
        if run_row is None or run_row["status"] != "RUNNING":
            raise StateTransitionError("Index run is no longer RUNNING.")
        if str(run_row["index_id"]) != run.index_id or run_row["kind"] != run.kind:
            raise StateTransitionError("Index run identity changed unexpectedly.")
        expected_index_status = "ACTIVE" if run.kind == "INCREMENTAL" else "BUILDING"
        index_status = await connection.fetchval(
            "SELECT status::text FROM knowledge.indexes WHERE id = $1 FOR UPDATE",
            UUID(run.index_id),
        )
        if index_status != expected_index_status:
            raise StateTransitionError(
                f"Target index is no longer {expected_index_status}."
            )

    async def _apply_migrations(
        self, owner_connection: asyncpg.Connection | None = None
    ) -> None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        migrations = sorted(self._migration_directory.glob("*.sql"))
        if not migrations:
            raise RuntimeError("No Knowledge Platform migrations were found.")
        async def apply(connection: asyncpg.Connection) -> None:
            await connection.execute("CREATE SCHEMA IF NOT EXISTS knowledge")
            await connection.execute(
                "CREATE TABLE IF NOT EXISTS knowledge.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
            )
            for migration_path in migrations:
                version = migration_path.name
                if await connection.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM knowledge.schema_migrations WHERE version = $1)", version
                ):
                    continue
                async with connection.transaction():
                    await connection.execute(migration_path.read_text(encoding="utf-8"))
                    await connection.execute(
                        "INSERT INTO knowledge.schema_migrations (version) VALUES ($1)", version
                    )
        if owner_connection is not None:
            await apply(owner_connection)
        else:
            async with self._pool.acquire() as connection:
                await apply(connection)
