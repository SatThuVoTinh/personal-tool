from __future__ import annotations

import asyncio
import contextvars
import hashlib
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
import json
import logging
import os
from pathlib import Path
import re
from typing import Any, AsyncIterator, Mapping, Sequence
from uuid import UUID, uuid4

import asyncpg

from .markdown_adapter import MarkdownSource
from .run_errors import SafeRunError, sanitize_cause, serialize_errors

_CURRENT_OWNER_CONNECTION: contextvars.ContextVar["asyncpg.Connection | None"] = contextvars.ContextVar(
    "current_owner_connection", default=None
)

# F-101 (R5-E01-05): the module had no logging facility at all, so a
# failure that nothing else recorded left no attributable record.
logger = logging.getLogger(__name__)


class StateTransitionError(RuntimeError):
    """Raised when a lifecycle transaction no longer owns its expected state."""


class MigrationDigestError(RuntimeError):
    """Raised when a migration's bytes are not the ones published for it.

    F-547 / F-541 (R10-T05-4, R10-T03-6): the ledger recorded only the
    filename, so editing an applied .sql in place was a silent no-op on every
    database that had adopted it, while the two published JSONs were read by no
    runner at all -- only by a repo test that a matching JSON edit satisfies.
    The apply seam now refuses a listed file whose bytes are not the published
    ones before applying anything, and the database's own ledger row is bound to
    those bytes so a rolled manifest cannot re-legitimise an edited migration.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        # The message is "<CODE> <version>", so the code is what the boot
        # reports and what the operator's runbook switches on.
        self.code = message.split(" ", 1)[0]


class MigrationLockError(RuntimeError):
    """Raised when the schema lock could not be taken within its budget.

    F-149 (R5-E03-02): the schema was applied on an unserialized pool
    connection, so two replicas racing at boot ran the same DDL against one
    catalog. The loser now waits for the lock; a wait that runs out of
    budget is THIS, and never the "database is down" the operator used to
    read for a schema race.
    """


class PdfContentIdentityExistsError(RuntimeError):
    """An in-progress or READY build already owns this content identity."""


class PdfSchemaContractError(RuntimeError):
    """The installed schema cannot support the frozen M4/T2 lifecycle."""


class PdfContentNotFoundError(RuntimeError):
    """The named document is not a published PDF of the live corpus."""


class PdfContentNotReclaimableError(RuntimeError):
    """The document holds no derived copy that could be reclaimed."""


# H9: the owner approved reclaiming the DERIVED text copies of an ingested
# PDF. The code is the vocabulary of the Knowledgebase's own lifecycle
# records, so a reader can tell a reclamation from any other terminal state
# of a content build.
PDF_CONTENT_RECLAIMED = "PDF_CONTENT_RECLAIMED"


_PDF_CONTENT_IDENTITY_INDEXES = {
    "knowledge_pdf_content_builds_one_building_idx",
    "knowledge_pdf_content_builds_one_ready_idx",
}
# F-092 (R5-E03-03): the pool runs every statement under a 30 s
# `command_timeout`, and the startup sweep used to hand EVERY failed index id
# to one `DELETE ... WHERE index_id = ANY($1::uuid[])`. A full-corpus shadow
# therefore put thousands of ids in a single statement with a single
# timeout. The sweep is chunked: the same rows are deleted, one bounded
# statement at a time.
PURGE_CHUNK_SIZE = 500
# F-164 (R5-E01-04): how long the process waits before re-attempting a
# connection that failed at boot. The pool is re-created, the schema is
# applied and the interrupted-run recovery runs as soon as the database
# answers, instead of leaving the process permanently "unavailable".
RECONNECT_INTERVAL_SECONDS = 5.0
_PDF_SEGMENT_TYPES = {
    "PDF_PASSAGE",
    "PDF_TABLE",
    "PDF_FIGURE_TEXT",
}
_SEARCHABLE_SEGMENT_TYPES = {"MARKDOWN_PASSAGE", *_PDF_SEGMENT_TYPES}
# F-166 (R5-E03-01): the PostgreSQL SQLSTATEs that mean "the object this
# statement creates is already there". A migration replayed against a schema
# that already owns its objects raises one of these; anything else is a real
# fault and must abort the boot.
_MIGRATION_DUPLICATE_SQLSTATES = frozenset(
    {
        "42P06",  # duplicate_schema
        "42P07",  # duplicate_table
        "42701",  # duplicate_column
        "42710",  # duplicate_object
    }
)
# F-166 (R5-E03-01): every object a migration file creates, read from the
# file itself so a new migration needs no second list to keep in step.
_MIGRATION_OBJECT_PATTERN = re.compile(
    r"CREATE\s+(?P<kind>UNIQUE\s+INDEX|INDEX|TABLE|TYPE|SCHEMA|EXTENSION)\s+"
    r"(?:IF\s+NOT\s+EXISTS\s+)?"
    r"(?:(?P<schema>[a-z_][a-z0-9_]*)\.)?(?P<name>[a-z_][a-z0-9_]*)",
    re.IGNORECASE,
)


def _migration_objects(sql: str) -> list[tuple[str | None, str, str]]:
    """The (schema, name, kind) of every object a migration file creates."""

    objects: list[tuple[str | None, str, str]] = []
    for match in _MIGRATION_OBJECT_PATTERN.finditer(sql):
        kind = " ".join(match.group("kind").upper().split())
        if kind == "UNIQUE INDEX":
            kind = "INDEX"
        schema = match.group("schema")
        objects.append((schema, match.group("name"), kind))
    return objects


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
class PdfContentReclamation:
    """The record of one reclaimed PDF content build.

    H9: the reclamation is a durable record of WHAT was reclaimed (the build
    and the content identity it carried) and WHEN (the build's terminal
    timestamp), in the same shape as the other Knowledgebase lifecycle
    records (`index_runs`, `pdf_content_builds`): an id, a status, timestamps
    and a code.
    """

    build_id: str
    source_path: str
    content_identity_digest: str
    pdf_digest: str
    status: str
    segments_reclaimed: int
    sources_released: int
    reclaimed_at: str


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
    # F-072 (R5-E02-02): the immutable identity of the SOURCE this chunk
    # came from. A path is mutable -- a file can be moved or edited and keep
    # its path -- and an index-run id covers thousands of files, so neither
    # identifies the revision an answer was produced from.
    source_id: str | None = None
    source_sha256: str | None = None
    canonical_topics: tuple[str, ...] = ()


@dataclass(frozen=True)
class SegmentRecord:
    """One indexed segment, with the identity of the source it came from."""

    id: str
    index_id: str
    source_id: str
    source_sha256: str
    source_path: str
    source_type: str
    source_mime_type: str
    title: str
    text: str
    heading_path: tuple[str, ...]
    primary_topic: str
    canonical_topics: tuple[str, ...]
    tags: tuple[str, ...]
    line_start: int | None
    line_end: int | None
    page_start: int | None
    page_end: int | None
    bbox: tuple[float, float, float, float] | None
    indexed_by_run_id: str
    # F-573 (R10-T10-4): the index this citation resolved against, and the
    # ordinal that survives a reindex. `id` is a surrogate the source row's
    # ON DELETE CASCADE destroys, so (index, source revision, ordinal) is the
    # identity a caller can re-derive a segment from.
    index_status: str | None = None
    chunk_ordinal: int | None = None


class ActiveIndexChangedError(RuntimeError):
    """The immutable ACTIVE index selected by search was replaced."""


# F-547: the runner resolves its expected digests from the published manifest, so
# the path is the module's OWN carrier -- `apps/knowledge/contracts/` -- and not
# `docs/contracts/`, because the Knowledgebase image copies apps/knowledge/ and
# cannot reach the repository's docs/. `tests/m12-t2.2-a4-migration-digest.test.mjs`
# pins both carriers to one byte-identical document.
MIGRATION_DIGEST_MANIFEST = (
    Path(__file__).resolve().parents[1]
    / "contracts"
    / "knowledgebase-migration-digests.json"
)


def published_migration_digests(
    manifest_path: Path = MIGRATION_DIGEST_MANIFEST,
) -> dict[str, str]:
    """The digests the repository publishes for each migration file.

    F-547: an unreadable manifest is a refusal, not an empty table — a boot that
    silently lost the published values would adopt whatever bytes it found.
    """

    try:
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise MigrationDigestError(
            "KNOWLEDGE_MIGRATION_MANIFEST_UNREADABLE"
        ) from error
    entries = document.get("migrations") if isinstance(document, dict) else None
    if not isinstance(entries, list):
        raise MigrationDigestError("KNOWLEDGE_MIGRATION_MANIFEST_UNREADABLE")
    published: dict[str, str] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise MigrationDigestError("KNOWLEDGE_MIGRATION_MANIFEST_UNREADABLE")
        name = entry.get("file")
        digest = entry.get("sha256")
        if not isinstance(name, str) or not isinstance(digest, str):
            continue
        published[name] = digest
    return published


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
        self._reconnect_task: asyncio.Task[None] | None = None
        self._recovery_callback: Callable[[], Awaitable[None]] | None = None
        self.startup_error_code: str | None = None

    @property
    def available(self) -> bool:
        return self._pool is not None

    def set_recovery_callback(
        self, callback: Callable[[], Awaitable[None]] | None
    ) -> None:
        """Register the recovery the process must run once the database returns.

        F-164 (R5-E01-04): the interrupted-run recovery lived in the
        application's lifespan, so a boot that failed before it ran skipped
        the repair for the life of the process. The database now calls this
        callback when a re-attempted connection succeeds.
        """

        self._recovery_callback = callback

    async def _apply_startup_schema(self) -> None:
        """Apply the schema the one way a boot may, for both start arms.

        F-149 (R5-E03-02): the schema used to be applied on a plain pool
        connection, so two replicas racing at boot ran CREATE EXTENSION /
        CREATE TYPE against the same catalog and the loser raised
        duplicate_object. The DDL now runs under the same advisory lock that
        guards a run, and the loser WAITS for it instead of racing.

        F-513 (R10-L07-2): the reconnect path was written as a copy of the
        lock-and-migrate half only, so a retried boot skipped the acceptance
        backup barrier -- migrating the live schema with no restore point --
        and skipped the segment-type domain assertion. Both arms now run this
        method, so the invariants cannot diverge again.
        """

        barrier_completed = self._acceptance_barrier_is_completed()
        if self._acceptance_backup_barrier_dir is None or barrier_completed:
            connection = await self.acquire_migration_lock(self._advisory_lock_key)
            try:
                await self._apply_migrations(connection)
            finally:
                await self.release_advisory_lock(connection, self._advisory_lock_key)
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
            await self._apply_startup_schema()
        except MigrationDigestError as error:
            # F-547 / F-541: an applied migration whose bytes are no longer the
            # published ones is not a connectivity fault either. Naming it keeps
            # the boot from answering "the database is down" for a schema the
            # store refuses to trust.
            self.startup_error_code = error.code
            await self._abort_startup()
        except MigrationLockError:
            # F-149: a schema race is not "the database is down". The refusal
            # is named, so the operator can tell the two apart.
            self.startup_error_code = "MIGRATION_LOCK_UNAVAILABLE"
            await self._abort_startup()
            # F-412 (R9-L08-2): the lock is transient by nature -- an index run
            # holds it for seconds -- but this arm only aborted, so a replica
            # that lost the race answered 503 for the life of the process while
            # `readyz` stayed healthy. The re-attempt is the same one the
            # generic arm starts, and it re-acquires this very lock (F-149).
            self._start_reconnect_loop()
        except Exception:
            self.startup_error_code = "DATABASE_UNAVAILABLE"
            await self._abort_startup()
            # F-164 (R5-E01-04): the failure used to be a sticky, process
            # lifetime flag: the pool was nulled, nothing reopened it, and
            # the interrupted-run recovery that repairs the state the
            # operator most needs was skipped for the life of the process.
            # The process now re-attempts the connection and runs the
            # recovery as soon as the database answers.
            self._start_reconnect_loop()

    async def _abort_startup(self) -> None:
        if self._startup_owner_connection is not None:
            connection = self._startup_owner_connection
            self._startup_owner_connection = None
            self.unbind_owner_connection(connection)
            await self.release_advisory_lock(connection, self._advisory_lock_key)
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    def _start_reconnect_loop(self) -> None:
        if self._reconnect_task is not None:
            return
        try:
            self._reconnect_task = asyncio.get_running_loop().create_task(
                self._reconnect_loop()
            )
        except RuntimeError:
            # No running loop: the caller drives `start()` outside the event
            # loop, so there is nothing to re-attempt from.
            self._reconnect_task = None

    async def _reconnect_loop(self) -> None:
        if self._pool is not None:
            return
        while True:
            await asyncio.sleep(RECONNECT_INTERVAL_SECONDS)
            if self._pool is None:
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
                    # F-513 (R10-L07-2): the retry runs the whole boot path --
                    # the barrier branch and the domain assertion included --
                    # not the lock-and-migrate half the copy kept.
                    await self._apply_startup_schema()
                except MigrationDigestError as error:
                    # F-547 / F-541: the published bytes are the fact the retry
                    # cannot repair, so the loop records the named refusal and
                    # ends instead of polling behind a schema it will not accept.
                    self.startup_error_code = error.code
                    if self._pool is not None:
                        await self._pool.close()
                        self._pool = None
                    return
                except MigrationLockError:
                    # F-513: the named refusal must survive the retry instead
                    # of being replaced by whatever failed first.
                    self.startup_error_code = "MIGRATION_LOCK_UNAVAILABLE"
                    if self._pool is not None:
                        await self._pool.close()
                        self._pool = None
                    continue
                except Exception:
                    # The database is still unreachable. The next attempt repeats
                    # the connect and the schema application.
                    if self._pool is not None:
                        await self._pool.close()
                        self._pool = None
                    continue
                self.startup_error_code = None
            if self._recovery_callback is None:
                return
            try:
                await self._recovery_callback()
            except Exception as error:
                # F-413 (R9-L08-3): the database is back but the recovery it
                # repairs failed, leaving the interrupted RUNNING row that the
                # unique one-running index turns into a 503 for every later
                # run. The sweep is idempotent, so the failure is named and
                # the loop re-attempts it instead of dropping it.
                logger.error(
                    "knowledge.reconnect_recovery_incomplete code=%s error=%s",
                    "STARTUP_RECOVERY_INCOMPLETE",
                    error,
                    exc_info=True,
                )
                continue
            return

    async def stop(self) -> None:
        if self._reconnect_task is not None:
            self._reconnect_task.cancel()
            self._reconnect_task = None
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
        # F-189 (R5-E16-04): the barrier polled its continuation file with
        # SYNCHRONOUS reads inside an `async def`, up to ten times a second
        # for up to ten minutes, on the one event loop that also serves
        # `/search`. Every file operation is now off the loop, so a barrier in
        # flight leaves the loop free to serve a request.
        token = await asyncio.to_thread(request_path.read_text, encoding="ascii")
        token = token.strip()
        if not re.fullmatch(r"[a-f0-9]{64}", token):
            raise RuntimeError("Invalid acceptance backup barrier request.")
        snapshot_path = resolved / "snapshot.json"
        continue_path = resolved / "continue"
        completed_path = resolved / "completed"
        if await asyncio.to_thread(snapshot_path.exists) or await asyncio.to_thread(
            continue_path.exists
        ):
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
            await asyncio.to_thread(
                self._write_barrier_snapshot, snapshot_path, payload
            )

            deadline = asyncio.get_running_loop().time() + 600
            await self._await_backup_barrier_continuation(resolved, token, deadline)

    async def _await_backup_barrier_continuation(
        self, resolved: Path, token: str, deadline: float
    ) -> None:
        """Wait for the continuation file, off the event loop.

        F-189 (R5-E16-04): the wait polled the continuation file with
        SYNCHRONOUS reads inside an `async def`, up to ten times a second
        for up to ten minutes, on the one event loop that also serves
        `/search`. Every file operation is dispatched to a worker thread,
        so a barrier in flight leaves the loop free to serve a request.
        """

        continue_path = resolved / "continue"
        completed_path = resolved / "completed"
        while True:
            if await asyncio.to_thread(continue_path.exists):
                if await asyncio.to_thread(
                    continue_path.is_symlink
                ) or not await asyncio.to_thread(continue_path.is_file):
                    raise RuntimeError("Invalid acceptance backup continuation state.")
                continuation = await asyncio.to_thread(
                    continue_path.read_text, encoding="ascii"
                )
                if continuation.strip() != token:
                    raise RuntimeError("Invalid acceptance backup continuation token.")
                await asyncio.to_thread(
                    self._write_barrier_completion, completed_path, token
                )
                return
            if asyncio.get_running_loop().time() >= deadline:
                raise TimeoutError("Acceptance backup barrier timed out.")
            await asyncio.sleep(0.1)

    @staticmethod
    def _write_barrier_snapshot(snapshot_path: Path, payload: dict[str, object]) -> None:
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

    @staticmethod
    def _write_barrier_completion(completed_path: Path, token: str) -> None:
        descriptor = os.open(
            completed_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        with os.fdopen(descriptor, "w", encoding="ascii") as stream:
            stream.write(token)
            stream.flush()
            os.fsync(stream.fileno())

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
        # F-255 (R7-D10A-03): the owner slot is MUTABLE, so resolving it at
        # call time let a run whose own owner had been released open its
        # transaction on the connection a newer generation had bound. The
        # run is pinned to the connection it was scheduled with, and a run
        # whose owner is no longer the bound one refuses before it executes
        # a single statement.
        run_owner = _CURRENT_OWNER_CONNECTION.get()
        if run_owner is None:
            run_owner = self._owner_connection
        if run_owner is None:
            raise StateTransitionError("Index ownership connection is not bound.")
        if run_owner is not self._owner_connection:
            raise StateTransitionError("Index ownership connection was lost.")
        if run_owner.is_closed():
            raise StateTransitionError("Index ownership connection was lost.")
        async with run_owner.transaction():
            yield run_owner

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

    async def fail_pdf_content_batch_and_build(
        self, batch: PdfContentBatch, code: str, cause: str | None = None
    ) -> None:
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
                await self._fail_pdf_build_locked(
                    connection, batch.build_id, code, cause
                )

    async def fail_pdf_content_build(
        self, build: PdfContentBuild, code: str, cause: str | None = None
    ) -> None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        async with self._mutation_transaction() as connection:
                await self._require_pdf_building(connection, build.id)
                await self._fail_pdf_build_locked(
                    connection, build.id, code, cause
                )

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

    async def pdf_content_is_reclaimed(
        self, pdf_digest: str, sidecar_digest: str
    ) -> bool:
        """Whether the owner's reclamation record covers this source pair.

        F-444 (R9-T06-2): the only durable record of a reclamation is the
        terminal build keyed by ``content_identity_digest``, and that identity
        embeds the digest of ``app/pdf_runtime.py``.  Any byte change to the
        deriving code therefore re-keys every PDF and the incremental skip no
        longer sees the reclaimed copy.  The source pair -- the PDF bytes and
        the sidecar bytes -- does not change when the deriving code changes,
        so the retention decision is looked up by that pair instead.
        """

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        return bool(
            await self._pool.fetchval(
                """
                SELECT EXISTS (
                  SELECT 1
                  FROM knowledge.pdf_content_builds
                  WHERE pdf_digest = $1
                    AND sidecar_digest = $2
                    AND status = 'CANCELLED'
                    AND failure_code = $3
                )
                """,
                pdf_digest,
                sidecar_digest,
                PDF_CONTENT_RECLAIMED,
            )
        )

    async def reclaim_pdf_content(self, source_path: str) -> PdfContentReclamation:
        """Reclaim the DERIVED text copy of one ingested PDF. Idempotent.

        H9: the owner approved a reclamation path for the derived text copies
        that could not be reclaimed before. The PDF itself stays: the source
        row, its published (searchable) segments and the file in the vault are
        never touched. What goes is the DERIVED copy the ingestion produced --
        the extracted text and its provenance (`pdf_content_segments`), the
        extraction manifest (`pdf_content_batches`) and the link that tied the
        published source to that build (`pdf_source_details`).

        The reclamation runs under the store's OWN writer: the same advisory
        lock owner and the same transaction the rest of the Knowledgebase's
        writes use, so it can never race an index run.

        The RECORD is the content build's own terminal lifecycle state, in the
        shape the Knowledgebase already records lifecycle in (`status`,
        `ready_at`/`finished_at`, `failure_code`): the build becomes
        `CANCELLED` with `failure_code = 'PDF_CONTENT_RECLAIMED'`, so a
        reader can see WHAT was reclaimed (the build and the content identity
        it carried) and WHEN (its `finished_at`).

        Reclaiming an already-reclaimed document changes nothing: the build is
        already terminal, so the action reports `ALREADY_RECLAIMED` and writes
        no statement at all.
        """

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        if not source_path:
            raise ValueError("PDF source path is invalid.")
        async with self._mutation_transaction() as connection:
                source = await connection.fetchrow(
                    """
                    SELECT s.sha256 AS content_identity_digest
                    FROM knowledge.sources s
                    JOIN knowledge.indexes i ON i.id = s.index_id
                    WHERE s.source_path = $1 AND s.source_type = 'PDF'
                      AND i.status = 'ACTIVE'
                    """,
                    source_path,
                )
                if source is None:
                    raise PdfContentNotFoundError("PDF_SOURCE_NOT_FOUND")
                digest = str(source["content_identity_digest"])
                build = await connection.fetchrow(
                    """
                    SELECT id::text, pdf_digest
                    FROM knowledge.pdf_content_builds
                    WHERE content_identity_digest = $1
                      AND status IN ('BUILDING', 'READY')
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    digest,
                )
                if build is None:
                    # Nothing holds the derived copy any more. The terminal
                    # build of the same identity is the record of the earlier
                    # reclamation, so the answer is a no-op that says so.
                    recorded = await connection.fetchrow(
                        """
                        SELECT id::text, pdf_digest, finished_at::text
                        FROM knowledge.pdf_content_builds
                        WHERE content_identity_digest = $1
                          AND status = 'CANCELLED'
                          AND failure_code = $2
                        ORDER BY finished_at DESC
                        LIMIT 1
                        """,
                        digest,
                        PDF_CONTENT_RECLAIMED,
                    )
                    if recorded is None:
                        raise PdfContentNotReclaimableError(
                            "PDF_CONTENT_NOT_RECLAIMABLE"
                        )
                    return PdfContentReclamation(
                        build_id=str(recorded["id"]),
                        source_path=source_path,
                        content_identity_digest=digest,
                        pdf_digest=str(recorded["pdf_digest"]),
                        status="ALREADY_RECLAIMED",
                        segments_reclaimed=0,
                        sources_released=0,
                        reclaimed_at=str(recorded["finished_at"]),
                    )
                build_id = UUID(str(build["id"]))
                segments = await connection.fetchval(
                    "SELECT count(*) FROM knowledge.pdf_content_segments WHERE build_id = $1",
                    build_id,
                )
                # The link goes FIRST: it pins the build's status to READY,
                # and the reclaimed build leaves that state. The derived copy
                # belongs to the CONTENT IDENTITY, so one build can carry more
                # than one source link (the same PDF carried into another
                # index); the count is reported, so a caller that names one
                # path sees every link that went with it.
                sources_released = await connection.fetchval(
                    "SELECT count(*) FROM knowledge.pdf_source_details WHERE build_id = $1",
                    build_id,
                )
                await connection.execute(
                    "DELETE FROM knowledge.pdf_source_details WHERE build_id = $1",
                    build_id,
                )
                # Each derived relation is deleted explicitly, so each one's
                # cleanup is separately verifiable.
                await connection.execute(
                    "DELETE FROM knowledge.pdf_content_segments WHERE build_id = $1",
                    build_id,
                )
                await connection.execute(
                    "DELETE FROM knowledge.pdf_content_batches WHERE build_id = $1",
                    build_id,
                )
                reclaimed = await connection.fetchrow(
                    """
                    UPDATE knowledge.pdf_content_builds
                    SET status = 'CANCELLED', ready_at = NULL, finished_at = now(),
                        failure_code = $2
                    WHERE id = $1 AND status IN ('BUILDING', 'READY')
                    RETURNING id::text, finished_at::text
                    """,
                    build_id,
                    PDF_CONTENT_RECLAIMED,
                )
                if reclaimed is None:
                    raise StateTransitionError(
                        "PDF content build changed during reclamation."
                    )
                return PdfContentReclamation(
                    build_id=str(reclaimed["id"]),
                    source_path=source_path,
                    content_identity_digest=digest,
                    pdf_digest=str(build["pdf_digest"]),
                    status="RECLAIMED",
                    segments_reclaimed=int(segments or 0),
                    sources_released=int(sources_released or 0),
                    reclaimed_at=str(reclaimed["finished_at"]),
                )

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
        """Stage the run in a shadow BUILDING index cloned from ACTIVE.

        Incremental runs never mutate the live ACTIVE index; unchanged rows are
        copied verbatim (no re-embedding) and the ACTIVE pointer only swaps in
        ``complete_incremental`` when the whole run succeeded. Cloned rows are
        re-stamped to the shadow run because the ``indexed_by_run_id`` foreign
        key is index-scoped.
        """

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        index_id, run_id = uuid4(), uuid4()
        active_id = UUID(active_index.id)
        async with self._mutation_transaction() as connection:
            current_active = await connection.fetchval(
                "SELECT id::text FROM knowledge.indexes WHERE status = 'ACTIVE' FOR UPDATE"
            )
            if current_active != active_index.id:
                raise StateTransitionError("Incremental target is no longer ACTIVE.")
            await connection.execute(
                """
                INSERT INTO knowledge.indexes
                  (id, status, embedding_model_name, embedding_model_digest, embedding_dimensions)
                VALUES ($1, 'BUILDING', $2, $3, $4)
                """,
                index_id,
                active_index.embedding_model_name,
                active_index.embedding_model_digest,
                active_index.embedding_dimensions,
            )
            await connection.execute(
                """
                INSERT INTO knowledge.index_runs (id, index_id, kind, status)
                VALUES ($1, $2, 'INCREMENTAL', 'RUNNING')
                """,
                run_id,
                index_id,
            )
            await connection.execute(
                """
                INSERT INTO knowledge.sources
                  (id, index_id, source_type, source_path, sha256, mime_type, title,
                   primary_topic, canonical_topics, tags, indexed_by_run_id)
                SELECT gen_random_uuid(), $1, source_type, source_path, sha256,
                       mime_type, title, primary_topic, canonical_topics, tags, $2
                FROM knowledge.sources
                WHERE index_id = $3
                """,
                index_id,
                run_id,
                active_id,
            )
            await connection.execute(
                """
                INSERT INTO knowledge.segments
                  (id, index_id, source_id, segment_type, chunk_ordinal, source_path,
                   title, primary_topic, canonical_topics, tags, heading_path,
                   heading_text, text, line_start, line_end, page_start, page_end,
                   bbox, time_start_ms, time_end_ms, embedding, search_vector,
                   indexed_by_run_id)
                SELECT gen_random_uuid(), $1, staged.id, live.segment_type,
                       live.chunk_ordinal, live.source_path, live.title,
                       live.primary_topic, live.canonical_topics, live.tags,
                       live.heading_path, live.heading_text, live.text,
                       live.line_start, live.line_end, live.page_start, live.page_end,
                       live.bbox, live.time_start_ms, live.time_end_ms,
                       live.embedding, live.search_vector, $2
                FROM knowledge.segments live
                JOIN knowledge.sources staged
                  ON staged.index_id = $1 AND staged.source_path = live.source_path
                WHERE live.index_id = $3
                """,
                index_id,
                run_id,
                active_id,
            )
            await connection.execute(
                """
                INSERT INTO knowledge.source_sidecars
                  (index_id, source_id, sidecar_path, relation_type, created_at)
                SELECT $1, staged.id, live.sidecar_path, live.relation_type, live.created_at
                FROM knowledge.source_sidecars live
                JOIN knowledge.sources original
                  ON original.id = live.source_id AND original.index_id = live.index_id
                JOIN knowledge.sources staged
                  ON staged.index_id = $1 AND staged.source_path = original.source_path
                WHERE live.index_id = $3
                """,
                index_id,
                run_id,
                active_id,
            )
            await connection.execute(
                """
                INSERT INTO knowledge.pdf_source_details (index_id, source_id, build_id)
                SELECT $1, staged.id, live.build_id
                FROM knowledge.pdf_source_details live
                JOIN knowledge.sources original
                  ON original.id = live.source_id AND original.index_id = live.index_id
                JOIN knowledge.sources staged
                  ON staged.index_id = $1 AND staged.source_path = original.source_path
                WHERE live.index_id = $3
                """,
                index_id,
                run_id,
                active_id,
            )
        return AcceptedIndexRun(str(run_id), str(index_id), "INCREMENTAL", "RUNNING")

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
        namespace_topic: str | None = None,
        canonical_topics_all: tuple[str, ...] = (),
    ) -> tuple[list[SearchCandidate], list[SearchCandidate]]:
        """Read both branches from one repeatable-read ACTIVE-index snapshot.

        F-116 (R5-E02-01): `namespace_topic` and `canonical_topics_all` are
        the scope the caller asked for, expressed in the corpus's own
        canonical topics. A NULL parameter means "no scope"; the empty topic
        means "a scope the corpus does not carry", which matches nothing.
        """
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
                    AND ($7::text IS NULL OR canonical_topics @> ARRAY[$7::text])
                    AND ($8::text[] IS NULL
                         OR (cardinality($8::text[]) > 0
                             AND canonical_topics @> $8::text[]))
                """
                # The inner query intentionally has only the pgvector distance
                # operator in ascending order plus LIMIT, which permits HNSW.
                dense_rows = await connection.fetch(
                    f"""
                    WITH ann AS MATERIALIZED (
                      SELECT id, source_path, title, primary_topic, tags, heading_path,
                             text, line_start, line_end, page_start, page_end, bbox,
                             segment_type, indexed_by_run_id, source_id, canonical_topics,
                             embedding <=> $2::vector AS dense_distance
                      FROM knowledge.segments
                      WHERE {common}
                      ORDER BY embedding <=> $2::vector ASC
                      LIMIT 40
                    )
                    SELECT * FROM ann ORDER BY dense_distance ASC, id ASC
                    """,
                    UUID(index_id), vector, primary_topic, tags, path_prefix, list(segment_types),
                    namespace_topic,
                    list(canonical_topics_all) if canonical_topics_all else None,
                )
                fts_rows = await connection.fetch(
                    f"""
                    WITH parsed AS (
                      SELECT websearch_to_tsquery('simple', $2) AS value
                    )
                    SELECT segments.id, source_path, title, primary_topic, tags,
                           heading_path, text, line_start, line_end, page_start, page_end, bbox,
                           segment_type, indexed_by_run_id, source_id, canonical_topics,
                           ts_rank_cd('{{0.1,0.2,0.4,1.0}}', search_vector,
                                      parsed.value, 0) AS fts_score
                    FROM knowledge.segments, parsed
                    WHERE {common} AND search_vector @@ parsed.value
                    ORDER BY fts_score DESC, segments.id ASC
                    LIMIT 40
                    """,
                    UUID(index_id), query, primary_topic, tags, path_prefix, list(segment_types),
                    namespace_topic,
                    list(canonical_topics_all) if canonical_topics_all else None,
                )
                # F-072 (R5-E02-02): the immutable source identity is read in
                # ONE extra statement, inside the same snapshot, instead of a
                # join -- a join on the ANN branch would put the HNSW scan at
                # the planner's discretion.
                source_digests = await self._source_digests(
                    connection,
                    {str(row["source_id"]) for row in (*dense_rows, *fts_rows)},
                )
        active_after = await self._pool.fetchval(
            "SELECT id::text FROM knowledge.indexes WHERE status = 'ACTIVE'"
        )
        if active_after != index_id:
            raise ActiveIndexChangedError("ACTIVE index changed.")
        return (
            [
                self._candidate_from_row(row, "dense_distance", source_digests)
                for row in dense_rows
            ],
            [
                self._candidate_from_row(row, "fts_score", source_digests)
                for row in fts_rows
            ],
        )

    @staticmethod
    async def _source_digests(
        connection: asyncpg.Connection, source_ids: set[str]
    ) -> dict[str, str]:
        """The identity a caller re-verifies, as the bytes of the file itself.

        F-512 (R10-L07-1): `knowledge.sources.sha256` holds the PDF CONTENT
        IDENTITY -- the composite of the PDF digest, its sidecar digest and the
        processing identity -- while the same column holds `sha256(file)` for a
        markdown source. Every reader projected that one column as
        `source_sha256`, and the citation promises a digest that "can be
        re-verified by re-hashing the source", so a PDF hit published a value
        no re-hash of the PDF could ever produce.

        The file digest is the build's own `pdf_digest`. The join is on the
        identity the source row already carries, not on the publish link, so it
        also covers a build whose link was reclaimed: the identity encodes the
        file digest, so every build of one identity carries the same
        `pdf_digest`.
        """

        if not source_ids:
            return {}
        rows = await connection.fetch(
            """
            SELECT sources.id::text AS id,
                   sources.sha256 AS content_identity_digest,
                   builds.pdf_digest AS pdf_digest
            FROM knowledge.sources sources
            LEFT JOIN knowledge.pdf_content_builds builds
              ON builds.content_identity_digest = sources.sha256
             AND sources.source_type = 'PDF'
            WHERE sources.id = ANY($1::uuid[])
            """,
            [UUID(source_id) for source_id in sorted(source_ids)],
        )
        return {
            str(row["id"]): str(
                row["pdf_digest"] or row["content_identity_digest"]
            )
            for row in rows
        }

    @staticmethod
    def _candidate_from_row(
        row: asyncpg.Record,
        score_name: str,
        source_digests: Mapping[str, str] | None = None,
    ) -> SearchCandidate:
        segment_type = str(row["segment_type"])
        if segment_type == "MARKDOWN_PASSAGE":
            source_type = "MARKDOWN"
        elif segment_type in {"PDF_PASSAGE", "PDF_TABLE", "PDF_FIGURE_TEXT"}:
            source_type = "PDF"
        else:
            raise StateTransitionError("Search result has an unknown segment type.")
        source_id = str(row["source_id"]) if row["source_id"] is not None else None
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
            source_id=source_id,
            source_sha256=(source_digests or {}).get(source_id),
            canonical_topics=tuple(row["canonical_topics"]),
        )

    async def get_segment(self, segment_id: str) -> SegmentRecord | None:
        """Read one indexed segment with the identity of its source.

        F-071 (R1-A16-07): three advertised actions (`retrieve`, `citation`,
        `metadata`) had no route at all, so the citation round trip ended in
        an HTTP 404 and the surviving citations could not be tied to the
        index run that produced them.
        """

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        row = await self._pool.fetchrow(
            """
            SELECT segments.id::text, segments.index_id::text, segments.source_id::text,
                   segments.source_path, segments.title, segments.text, segments.heading_path,
                   segments.primary_topic, segments.canonical_topics, segments.tags,
                   segments.segment_type, segments.chunk_ordinal,
                   segments.line_start, segments.line_end,
                   segments.page_start, segments.page_end, segments.bbox,
                   segments.indexed_by_run_id::text,
                   sources.sha256 AS content_identity_digest,
                   builds.pdf_digest AS pdf_digest,
                   sources.source_type AS source_type,
                   sources.mime_type AS source_mime_type,
                   indexes.status AS index_status
            FROM knowledge.segments
            JOIN knowledge.sources
              ON knowledge.sources.id = segments.source_id
             AND knowledge.sources.index_id = segments.index_id
            JOIN knowledge.indexes
              ON knowledge.indexes.id = segments.index_id
            LEFT JOIN knowledge.pdf_content_builds builds
              ON builds.content_identity_digest = sources.sha256
             AND sources.source_type = 'PDF'
            WHERE segments.id = $1
            """,
            UUID(segment_id),
        )
        if row is None:
            return None
        segment_type = str(row["segment_type"])
        if segment_type == "MARKDOWN_PASSAGE":
            source_type = "MARKDOWN"
        elif segment_type in {"PDF_PASSAGE", "PDF_TABLE", "PDF_FIGURE_TEXT"}:
            source_type = "PDF"
        else:
            raise StateTransitionError("Indexed segment has an unknown segment type.")
        return SegmentRecord(
            id=str(row["id"]),
            index_id=str(row["index_id"]),
            source_id=str(row["source_id"]),
            # F-512 (R10-L07-1): the published digest is the file digest, not
            # the composite `sources.sha256` holds for a PDF row.
            source_sha256=str(row["pdf_digest"] or row["content_identity_digest"]),
            source_path=str(row["source_path"]),
            source_type=source_type,
            source_mime_type=str(row["source_mime_type"]),
            title=str(row["title"]),
            text=str(row["text"]),
            heading_path=tuple(row["heading_path"]),
            primary_topic=str(row["primary_topic"]),
            canonical_topics=tuple(row["canonical_topics"]),
            tags=tuple(row["tags"]),
            line_start=int(row["line_start"]) if row["line_start"] is not None else None,
            line_end=int(row["line_end"]) if row["line_end"] is not None else None,
            page_start=int(row["page_start"]) if row["page_start"] is not None else None,
            page_end=int(row["page_end"]) if row["page_end"] is not None else None,
            bbox=(
                tuple(float(value) for value in row["bbox"])
                if row["bbox"] is not None
                else None
            ),
            indexed_by_run_id=str(row["indexed_by_run_id"]),
            # F-573 (R10-T10-4): a superseded index still resolves -- the
            # citation is already durable -- but the reader now says which
            # index it resolved against instead of leaving the caller to
            # assume it is the live one.
            index_status=str(row["index_status"]),
            chunk_ordinal=int(row["chunk_ordinal"]),
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
                # M11/T1-R1 3.4: one prepared statement for the whole document
                # instead of a round trip per segment. The column contract,
                # including the search_vector expression, is unchanged.
                segment_rows: list[tuple[Any, ...]] = []
                for segment, embedding in zip(source.segments, embeddings, strict=True):
                    vector = "[" + ",".join(format(value, ".17g") for value in embedding) + "]"
                    segment_rows.append(
                        (
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
                    )
                await connection.executemany(
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
                    segment_rows,
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
                # F-257 (R7-D10A-05): the markdown sibling publishes a whole
                # document through ONE prepared statement. The PDF path used
                # to issue one INSERT per segment, so the round trips scaled
                # with the segment count and consumed the command timeout of
                # the enclosing transaction, which aborted the publish while
                # the READY build and its extracted text stayed on disk.
                segment_rows: list[tuple[Any, ...]] = []
                for segment, embedding in zip(segments, embeddings, strict=True):
                    vector = "[" + ",".join(format(value, ".17g") for value in embedding) + "]"
                    segment_rows.append(
                        (
                            uuid4(),
                            UUID(run.index_id),
                            source_id,
                            segment.segment_type,
                            segment.chunk_ordinal,
                            source_path,
                            title,
                            canonical_topics[0],
                            list(canonical_topics),
                            list(tags),
                            [title],
                            title,
                            segment.content,
                            segment.page_start,
                            segment.page_end,
                            list(segment.bbox) if segment.bbox is not None else None,
                            vector,
                            UUID(run.id),
                        )
                    )
                await connection.executemany(
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
                    segment_rows,
                )

    async def complete_incremental(
        self,
        run: AcceptedIndexRun,
        discovered: int,
        indexed: int,
        stale_paths: set[str],
        source_counts: Mapping[str, tuple[int, int, int]] | None = None,
    ) -> list[str]:
        """Atomically publish the shadow index.

        Stale deletion, the ACTIVE-pointer swap, and run completion commit in
        one transaction, so a failed incremental never touched the live index.
        Returns the SUPERSEDED ids for owned cleanup.
        """

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
                    raise StateTransitionError("Incremental shadow index did not reach ACTIVE.")
                cleanup_rows = await connection.fetch(
                    "SELECT id FROM knowledge.indexes WHERE status = 'SUPERSEDED'"
                )
                cleanup_ids = [str(row["id"]) for row in cleanup_rows]
        return cleanup_ids

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
                    # M11/T1-R1 3.1 (H6): a FAILED index keeps its row for
                    # forensics and loses its published content in this same
                    # transaction. Without this the shadow's segments/sources
                    # persisted forever and no later path could reclaim them.
                    await self._purge_index_content(connection, [UUID(run.index_id)])
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
        if self._pool is None:
            return
        async with self._mutation_transaction() as connection:
            if index_ids:
                superseded = [UUID(index_id) for index_id in index_ids]
                # F-093 (R5-E03-04): the builds the superseded index published
                # are read before its sources go, so the content they carry can
                # be reclaimed once nothing references them any more. This is
                # the path an edited or removed PDF takes: the retired build
                # keeps its whole extracted text until the publish that
                # supersedes the index releases it.
                retired_builds = await self._pdf_build_ids_for_indexes(
                    connection, superseded
                )
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
                    superseded,
                )
                await self._retire_pdf_content_builds(connection, retired_builds)
            # M11/T1-R1 3.1: sweep FAILED indexes that were published before
            # this garbage collection existed, so a first post-upgrade startup
            # leaves zero content rows behind for them.
            stale_failed_ids = await connection.fetch(
                "SELECT id FROM knowledge.indexes WHERE status = 'FAILED'"
            )
            await self._purge_index_content(
                connection, [row["id"] for row in stale_failed_ids]
            )
            await self._retire_terminal_pdf_content_builds(connection)

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
                # M11/T1-R1 3.1: the interrupted runs above left their shadow
                # indexes FAILED with published content and no owner. This
                # startup sweep purges that content so it cannot accumulate.
                failed_ids = await connection.fetch(
                    "SELECT id FROM knowledge.indexes WHERE status = 'FAILED'"
                )
                await self._purge_index_content(
                    connection, [row["id"] for row in failed_ids]
                )
                await self._retire_terminal_pdf_content_builds(connection)
        return len(rows)

    async def acquire_advisory_lock(self, lock_key: int) -> asyncpg.Connection | None:
        """Take the run lock, or report that another session holds it.

        F-254 (R7-D10A-02): the connection was acquired before any `try`, and
        only the negative result released it. A lock query that raised (a
        dead backend handed out by the pool, a server restart, a statement
        timeout) therefore left the connection checked out forever, and four
        such leaks exhausted the pool: every later call, search included,
        blocked until the pool timeout and answered "database unavailable".
        """

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        connection = await self._pool.acquire()
        try:
            locked = await connection.fetchval("SELECT pg_try_advisory_lock($1)", lock_key)
        except BaseException:
            await self._release_quietly(connection)
            raise
        if locked:
            return connection
        await self._pool.release(connection)
        return None

    async def acquire_migration_lock(self, lock_key: int) -> asyncpg.Connection:
        """Take the schema lock, WAITING for the session that holds it.

        F-149 (R5-E03-02): the DDL used to run on an unserialized pool
        connection, so two replicas booting together raced `CREATE EXTENSION`
        and `CREATE TYPE` against one catalog and the loser raised
        `duplicate_object` -- reported to the operator as "the database is
        down". The loser now waits for the lock and converges.
        """

        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        connection = await self._pool.acquire()
        try:
            await connection.execute("SELECT pg_advisory_lock($1)", lock_key)
        except (asyncio.TimeoutError, TimeoutError) as error:
            await self._release_quietly(connection)
            raise MigrationLockError("MIGRATION_LOCK_TIMEOUT") from error
        except BaseException:
            await self._release_quietly(connection)
            raise
        return connection

    async def _release_quietly(self, connection: asyncpg.Connection) -> None:
        """Return a connection to the pool without masking the original fault."""

        if self._pool is None:
            return
        try:
            await self._pool.release(connection)
        except Exception:
            pass

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
    async def _purge_index_content(
        connection: asyncpg.Connection, index_ids: Sequence[UUID]
    ) -> None:
        """Delete the published content of the given indexes, keeping the
        `indexes` rows and every `index_runs` FK intact.

        `segments` and `pdf_source_details` also cascade from `sources`; they
        are deleted explicitly so each relation's cleanup is separately
        verifiable. Idempotent: an already-purged index matches zero rows.

        F-092 (R5-E03-03): the id list is CHUNKED. One statement carrying
        every failed index id ran under the pool's 30 s `command_timeout`,
        so a full-corpus shadow either finished or aborted the whole sweep
        with no partial progress and no name. Each chunk is a bounded
        statement, and a chunk that fails propagates so the caller can name
        the sweep; the next attempt repeats it, because deleting the same
        rows again is a no-op.
        """
        if not index_ids:
            return
        ids = list(index_ids)
        for offset in range(0, len(ids), PURGE_CHUNK_SIZE):
            chunk = ids[offset : offset + PURGE_CHUNK_SIZE]
            # F-093 (R5-E03-04): the content builds this index backed are read
            # BEFORE the source details go, because the delete that reclaims
            # them runs after it and the foreign key refuses a build that is
            # still referenced.
            retired_builds = await KnowledgeDatabase._pdf_build_ids_for_indexes(
                connection, chunk
            )
            for statement in (
                "DELETE FROM knowledge.segments WHERE index_id = ANY($1::uuid[])",
                "DELETE FROM knowledge.pdf_source_details WHERE index_id = ANY($1::uuid[])",
                # Removing the source rows also cascades `source_sidecars`.
                "DELETE FROM knowledge.sources WHERE index_id = ANY($1::uuid[])",
            ):
                await connection.execute(statement, chunk)
            # F-093: a build nothing references any more keeps its whole
            # extracted text and provenance forever, so an edited or removed
            # PDF grew the corpus and every backup with a second copy of
            # itself. Only the builds THIS index backed are candidates: a
            # build that is ready but not published yet belongs to a run in
            # flight and must never be reclaimed by another index's purge.
            await KnowledgeDatabase._retire_pdf_content_builds(
                connection, retired_builds
            )

    @staticmethod
    async def _pdf_build_ids_for_indexes(
        connection: asyncpg.Connection, index_ids: Sequence[UUID]
    ) -> list[UUID]:
        """The content builds the given indexes published, if any."""

        if not index_ids:
            return []
        rows = await connection.fetch(
            "SELECT DISTINCT build_id FROM knowledge.pdf_source_details "
            "WHERE index_id = ANY($1::uuid[])",
            list(index_ids),
        )
        return [row["build_id"] for row in rows]

    @staticmethod
    async def _retire_pdf_content_builds(
        connection: asyncpg.Connection, build_ids: Sequence[UUID]
    ) -> None:
        """Delete the named content builds that nothing references any more.

        F-093 (R5-E03-04): the build row carries the whole extracted text
        (`pdf_content_segments`) and its provenance jsonb, and the FK from
        `pdf_source_details` forbids any cascade from reaching it. A build
        whose last published source detail is gone is therefore pure
        retention, and the delete cascades to its batches and segments.
        """

        if not build_ids:
            return
        await connection.execute(
            "DELETE FROM knowledge.pdf_content_builds b "
            "WHERE b.id = ANY($1::uuid[]) AND NOT EXISTS ("
            "SELECT 1 FROM knowledge.pdf_source_details d WHERE d.build_id = b.id)",
            list(build_ids),
        )

    @staticmethod
    async def _retire_terminal_pdf_content_builds(
        connection: asyncpg.Connection,
    ) -> None:
        """Delete FAILED content builds, which no link can ever enumerate.

        F-443 (R9-T06-1): retention is a lifecycle status on a content-
        addressed row, and every cleanup path above names its candidates from
        `knowledge.pdf_source_details`. A detail row can only exist for a
        READY build -- its foreign key is `(build_id, build_status)` with
        `build_status = 'READY'` -- so a build that ended FAILED carries a
        whole batch set that no sweep can name: the only handle the sweep takes
        is the table the build never entered. `002` makes the identity
        uniqueness partial over `('BUILDING', 'READY')`, so a second build of
        the same identity is legal the moment the first is terminal, and each
        incremental run over a changed PDF commits one more.

        The residue is retired by lifecycle state plus the absence of a link,
        so a build another index still publishes is never taken. CANCELLED is
        NOT residue: it is the owner's reclamation RECORD, which
        `pdf_content_is_reclaimed` reads back to keep a reclaimed copy from
        being derived again (F-444), so the predicate names FAILED alone.
        """

        await connection.execute(
            "DELETE FROM knowledge.pdf_content_builds b "
            "WHERE b.status = 'FAILED' AND NOT EXISTS ("
            "SELECT 1 FROM knowledge.pdf_source_details d WHERE d.build_id = b.id)"
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
        connection: asyncpg.Connection,
        build_id: str,
        code: str,
        cause: str | None = None,
    ) -> None:
        # F-550 (R10-T06-2): the cause rides into the row it belongs to, through
        # the same bound and scrub the run-error record uses, so a build marked
        # FAILED names WHY and not only WHICH class of failure.
        updated = await connection.fetchval(
            """
            UPDATE knowledge.pdf_content_builds
            SET status = 'FAILED', failure_code = $2, failure_cause = $3, finished_at = now()
            WHERE id = $1 AND status = 'BUILDING'
            RETURNING id
            """,
            UUID(build_id),
            code,
            sanitize_cause(cause),
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
        expected_index_status = "BUILDING"
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
            published = published_migration_digests()
            # The digest is of the file's BYTES, exactly as the repo comparator
            # hashes them: a text-mode read would let a line-ending translation
            # change what the runner trusts without changing the file.
            file_digests = {
                migration_path.name: hashlib.sha256(
                    migration_path.read_bytes()
                ).hexdigest()
                for migration_path in migrations
            }
            # F-547 / F-541: the published JSON is read at the apply seam, so an
            # in-place edit of a listed migration is refused BEFORE anything is
            # applied. A file the JSON does not name is the forward migration the
            # manifest's own `purpose` text allows, so it carries no expectation.
            for version, file_digest in sorted(file_digests.items()):
                expected = published.get(version)
                if expected is not None and expected != file_digest:
                    raise MigrationDigestError(
                        f"KNOWLEDGE_MIGRATION_DIGEST_MISMATCH {version}"
                    )
            for migration_path in migrations:
                version = migration_path.name
                if await connection.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM knowledge.schema_migrations WHERE version = $1)", version
                ):
                    continue
                sql = migration_path.read_text(encoding="utf-8")
                try:
                    async with connection.transaction():
                        await connection.execute(sql)
                except asyncpg.PostgresError as error:
                    # F-166 (R5-E03-01): a migration is replayed whenever the
                    # `schema_migrations` row is missing -- a repaired version
                    # row, a dump that excluded the table, a renamed file.
                    # The listed migration files may not be edited in place
                    # (the digest manifest forbids it), and `002` creates its
                    # tables and indexes without `IF NOT EXISTS`, so the
                    # replay aborted on duplicate_table, the whole migration
                    # transaction rolled back and the boot reported
                    # DATABASE_UNAVAILABLE. The runner recognises a migration
                    # whose objects are ALL already in the catalog and records
                    # it as applied; anything else re-raises.
                    if not await self._migration_is_already_applied(
                        connection, migration_path, sql, error
                    ):
                        raise
                await connection.execute(
                    "INSERT INTO knowledge.schema_migrations (version) VALUES ($1)",
                    version,
                )
            # The digest column is created by migration 005, so the ledger cannot
            # be read by that name until the set has been applied.
            await self._bind_ledger_to_published_digests(
                connection, file_digests, published
            )

        if owner_connection is not None:
            await apply(owner_connection)
        else:
            async with self._pool.acquire() as connection:
                await apply(connection)

    @staticmethod
    async def _bind_ledger_to_published_digests(
        connection: asyncpg.Connection,
        file_digests: dict[str, str],
        published: dict[str, str],
    ) -> None:
        """Bind the database's own ledger to the bytes the repository publishes.

        F-547 / F-541 (R10-T05-4, R10-T03-6): the JSON pin can be re-legitimised
        by the same edit that mutates a migration, so the database carries the
        second witness. A row that recorded a digest must agree with the
        published value, or the boot refuses a schema whose history it cannot
        trust; a row that predates the column is bound to the bytes now on disk
        and so becomes a witness from this boot forward.
        """

        rows = await connection.fetch(
            "SELECT version, digest FROM knowledge.schema_migrations ORDER BY version"
        )
        for row in rows:
            version = row["version"]
            file_digest = file_digests.get(version)
            if file_digest is None:
                # The ledger names a migration the repository no longer ships.
                # Deleting an applied file is the A-4 lane's refusal; this run
                # cannot bind a digest to bytes that are gone.
                continue
            expected = published.get(version)
            stored = row["digest"]
            if stored is None:
                await connection.execute(
                    "UPDATE knowledge.schema_migrations SET digest = $2 "
                    "WHERE version = $1 AND digest IS NULL",
                    version,
                    file_digest,
                )
            elif expected is not None and stored != expected:
                raise MigrationDigestError(
                    f"KNOWLEDGE_MIGRATION_DIGEST_ADOPTED_MISMATCH {version}"
                )

    @staticmethod
    async def _migration_is_already_applied(
        connection: asyncpg.Connection,
        migration_path: Path,
        sql: str,
        error: asyncpg.PostgresError,
    ) -> bool:
        """Is this a replay of a migration the catalog already owns?

        F-166 (R5-E03-01): the answer is only true when the failure is a
        duplicate-object failure AND every object the file creates is already
        in the catalog. A partial catalog therefore still aborts the boot,
        which is the behaviour a drifted schema needs.
        """

        if getattr(error, "sqlstate", None) not in _MIGRATION_DUPLICATE_SQLSTATES:
            return False
        objects = _migration_objects(sql)
        if not objects:
            return False
        for schema, name, kind in objects:
            if not await KnowledgeDatabase._migration_object_exists(
                connection, schema, name, kind
            ):
                return False
        logger.info(
            "knowledge.migration_replay_ignored file=%s", migration_path.name
        )
        return True

    @staticmethod
    async def _migration_object_exists(
        connection: asyncpg.Connection, schema: str | None, name: str, kind: str
    ) -> bool:
        """Does the catalog already own this object?"""

        if kind == "EXTENSION":
            return bool(
                await connection.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = $1)",
                    name,
                )
            )
        if kind == "SCHEMA":
            return bool(
                await connection.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = $1)",
                    name,
                )
            )
        if kind == "TYPE":
            if schema:
                return bool(
                    await connection.fetchval(
                        "SELECT EXISTS(SELECT 1 FROM pg_type t "
                        "JOIN pg_namespace n ON n.oid = t.typnamespace "
                        "WHERE n.nspname = $1 AND t.typname = $2)",
                        schema,
                        name,
                    )
                )
            return bool(
                await connection.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname = $1)", name
                )
            )
        # A table and an index are both relations.
        if schema:
            return bool(
                await connection.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM pg_class c "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = $1 AND c.relname = $2)",
                    schema,
                    name,
                )
            )
        # An unqualified index is created in the schema of its table, so the
        # name is looked up in every schema.
        return bool(
            await connection.fetchval(
                "SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname = $1)", name
            )
        )
