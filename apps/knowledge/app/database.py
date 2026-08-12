from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import asyncpg


@dataclass(frozen=True)
class ActiveIndex:
    id: str
    embedding_model_name: str
    embedding_model_digest: str
    embedding_dimensions: int


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
                max_size=2,
                timeout=10,
                command_timeout=10,
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
        if self._pool is None:
            return None

        row = await self._pool.fetchrow(
            """
            SELECT id, embedding_model_name, embedding_model_digest, embedding_dimensions
            FROM knowledge.indexes
            WHERE status = 'ACTIVE'
            """
        )
        if row is None:
            return None

        return ActiveIndex(
            id=str(row["id"]),
            embedding_model_name=row["embedding_model_name"],
            embedding_model_digest=row["embedding_model_digest"],
            embedding_dimensions=row["embedding_dimensions"],
        )

    async def recover_interrupted_runs(self) -> int:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")

        result = await self._pool.execute(
            """
            UPDATE knowledge.index_runs
            SET status = 'INTERRUPTED',
                finished_at = now(),
                failure_code = 'PROCESS_RESTART',
                failure_detail = 'The service restarted before this run completed.'
            WHERE status = 'RUNNING'
            """
        )
        return int(result.removeprefix("UPDATE "))

    async def acquire_advisory_lock(self, lock_key: int) -> asyncpg.Connection | None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")

        connection = await self._pool.acquire()
        lock_acquired = await connection.fetchval(
            "SELECT pg_try_advisory_lock($1)", lock_key
        )
        if lock_acquired:
            return connection

        await self._pool.release(connection)
        return None

    async def release_advisory_lock(
        self, connection: asyncpg.Connection, lock_key: int
    ) -> None:
        if self._pool is None:
            return

        try:
            await connection.execute("SELECT pg_advisory_unlock($1)", lock_key)
        finally:
            await self._pool.release(connection)

    async def _apply_migrations(self) -> None:
        if self._pool is None:
            raise RuntimeError("Database pool is unavailable.")

        migrations = sorted(self._migration_directory.glob("*.sql"))
        if not migrations:
            raise RuntimeError("No Knowledge Platform migrations were found.")

        async with self._pool.acquire() as connection:
            await connection.execute("CREATE SCHEMA IF NOT EXISTS knowledge")
            await connection.execute(
                """
                CREATE TABLE IF NOT EXISTS knowledge.schema_migrations (
                    version text PRIMARY KEY,
                    applied_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )

            for migration_path in migrations:
                version = migration_path.name
                already_applied = await connection.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM knowledge.schema_migrations WHERE version = $1)",
                    version,
                )
                if already_applied:
                    continue

                async with connection.transaction():
                    await connection.execute(migration_path.read_text(encoding="utf-8"))
                    await connection.execute(
                        "INSERT INTO knowledge.schema_migrations (version) VALUES ($1)",
                        version,
                    )
