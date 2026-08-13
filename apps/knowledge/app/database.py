from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg

from .markdown_adapter import MarkdownSource
from .run_errors import SafeRunError, serialize_errors


class StateTransitionError(RuntimeError):
    """Raised when a lifecycle transaction no longer owns its expected state."""


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


class KnowledgeDatabase:
    def __init__(
        self,
        database_host: str,
        database_port: int,
        database_name: str,
        database_user: str,
        database_password: str,
        migration_directory: Path,
    ) -> None:
        self._database_host = database_host
        self._database_port = database_port
        self._database_name = database_name
        self._database_user = database_user
        self._database_password = database_password
        self._migration_directory = migration_directory
        self._pool: asyncpg.Pool | None = None
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
            await self._apply_migrations()
            await self.recover_interrupted_runs()
        except Exception:
            self.startup_error_code = "DATABASE_UNAVAILABLE"
            if self._pool is not None:
                await self._pool.close()
                self._pool = None

    async def stop(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

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
            SELECT id, index_id, kind::text, status::text, started_at::text,
                   finished_at::text, sources_discovered, sources_indexed,
                   sources_failed, failure_code, failure_detail
            FROM knowledge.index_runs WHERE id = $1
            """,
            UUID(run_id),
        )
        if row is None:
            return None
        return IndexRunState(**dict(row))

    async def accept_incremental(self, active_index: ActiveIndex) -> AcceptedIndexRun:
        return await self._accept_run("INCREMENTAL", active_index.id)

    async def accept_full_rebuild(
        self, model_name: str, model_digest: str, dimensions: int
    ) -> AcceptedIndexRun:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        index_id, run_id = uuid4(), uuid4()
        async with self._pool.acquire() as connection:
            async with connection.transaction():
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
        async with self._pool.acquire() as connection:
            async with connection.transaction():
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

    async def set_discovered(self, run_id: str, discovered: int) -> None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        updated = await self._pool.fetchval(
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
        async with self._pool.acquire() as connection:
            async with connection.transaction():
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

    async def complete_incremental(
        self, run: AcceptedIndexRun, discovered: int, indexed: int, stale_paths: set[str]
    ) -> None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        async with self._pool.acquire() as connection:
            async with connection.transaction():
                await self._require_run_and_index_state(connection, run)
                if stale_paths:
                    await connection.execute(
                        "DELETE FROM knowledge.sources WHERE index_id = $1 AND source_path = ANY($2::text[])",
                        UUID(run.index_id),
                        sorted(stale_paths),
                    )
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
        self, run: AcceptedIndexRun, discovered: int, indexed: int
    ) -> list[str]:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        async with self._pool.acquire() as connection:
            async with connection.transaction():
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
    ) -> None:
        if self._pool is None:
            return
        detail = serialize_errors(errors or [SafeRunError(code)])
        async with self._pool.acquire() as connection:
            async with connection.transaction():
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
        await self._pool.execute(
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
        async with self._pool.acquire() as connection:
            async with connection.transaction():
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
            await connection.execute("SELECT pg_advisory_unlock($1)", lock_key)
        finally:
            await self._pool.release(connection)

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

    async def _apply_migrations(self) -> None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")
        migrations = sorted(self._migration_directory.glob("*.sql"))
        if not migrations:
            raise RuntimeError("No Knowledge Platform migrations were found.")
        async with self._pool.acquire() as connection:
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
