from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

import asyncpg

from .database import KnowledgeDatabase


class IndexRunAlreadyActiveError(RuntimeError):
    """Raised when the process-wide PostgreSQL advisory lock is held."""


class IndexRunCoordinator:
    """Reserve the lifecycle lock, run correctness work, then detach cleanup."""

    def __init__(self, database: KnowledgeDatabase, advisory_lock_key: int) -> None:
        self._database = database
        self._advisory_lock_key = advisory_lock_key
        self._reservation: asyncpg.Connection | None = None
        self._run_tasks: set[asyncio.Task[None]] = set()
        self._cleanup_tasks: set[asyncio.Task[None]] = set()

    @property
    def active(self) -> bool:
        return self._reservation is not None or bool(self._run_tasks)

    async def reserve(self) -> None:
        """Acquire the cross-process lock before persistent run acceptance."""
        if self._reservation is not None:
            raise IndexRunAlreadyActiveError("INDEX_RUN_ALREADY_ACTIVE")
        if not self._database.available:
            raise RuntimeError("Database pool is unavailable.")
        connection = await self._database.acquire_advisory_lock(self._advisory_lock_key)
        if connection is None:
            raise IndexRunAlreadyActiveError("INDEX_RUN_ALREADY_ACTIVE")
        self._reservation = connection

    async def schedule(
        self,
        work: Callable[[], Awaitable[list[str]]],
        cleanup: Callable[[list[str]], Awaitable[None]],
    ) -> None:
        connection = self._reservation
        if connection is None:
            raise IndexRunAlreadyActiveError("INDEX_RUN_ALREADY_ACTIVE")
        task = asyncio.create_task(self._run(work, cleanup, connection))
        self._reservation = None
        self._run_tasks.add(task)
        task.add_done_callback(self._run_tasks.discard)

    async def release_reservation(self) -> None:
        connection = self._reservation
        self._reservation = None
        if connection is not None:
            await self._database.release_advisory_lock(
                connection, self._advisory_lock_key
            )

    async def stop(self) -> None:
        await self.release_reservation()
        tasks = [*self._run_tasks, *self._cleanup_tasks]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _run(
        self,
        work: Callable[[], Awaitable[list[str]]],
        cleanup: Callable[[list[str]], Awaitable[None]],
        connection: asyncpg.Connection,
    ) -> None:
        cleanup_ids: list[str] = []
        try:
            cleanup_ids = await work()
        finally:
            await self._database.release_advisory_lock(
                connection, self._advisory_lock_key
            )
        if cleanup_ids:
            task = asyncio.create_task(cleanup(cleanup_ids))
            self._cleanup_tasks.add(task)
            task.add_done_callback(self._cleanup_tasks.discard)
