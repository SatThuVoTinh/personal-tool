from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from .database import KnowledgeDatabase


class IndexRunAlreadyActiveError(RuntimeError):
    """Raised when the process-wide PostgreSQL advisory lock is held."""


class IndexRunCoordinator:
    """Owns the single in-process background task foundation for M3 indexing.

    M3/T3 supplies the source-scan work function. Keeping the lock connection
    alive until that function exits prevents a second process from accepting a
    concurrent run while PostgreSQL remains the coordination authority.
    """

    def __init__(self, database: KnowledgeDatabase, advisory_lock_key: int) -> None:
        self._database = database
        self._advisory_lock_key = advisory_lock_key
        self._task: asyncio.Task[None] | None = None
        self._lock_connection = None

    @property
    def active(self) -> bool:
        return self._task is not None and not self._task.done()

    async def reserve(self) -> None:
        """Reserve the cross-process lock before persistent run acceptance."""
        if self.active or self._lock_connection is not None or not self._database.available:
            raise IndexRunAlreadyActiveError("INDEX_RUN_ALREADY_ACTIVE")

        connection = await self._database.acquire_advisory_lock(self._advisory_lock_key)
        if connection is None:
            raise IndexRunAlreadyActiveError("INDEX_RUN_ALREADY_ACTIVE")
        self._lock_connection = connection

    async def schedule(
        self,
        work: Callable[[], Awaitable[None]],
    ) -> None:
        if self.active or self._lock_connection is None:
            raise IndexRunAlreadyActiveError("INDEX_RUN_ALREADY_ACTIVE")
        self._task = asyncio.create_task(self._run(work))

    async def release_reservation(self) -> None:
        if self._task is None:
            await self._release_lock()

    async def stop(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self, work: Callable[[], Awaitable[None]]) -> None:
        try:
            await work()
        finally:
            await self._release_lock()

    async def _release_lock(self) -> None:
        connection = self._lock_connection
        self._lock_connection = None
        if connection is None:
            return
        await self._database.release_advisory_lock(connection, self._advisory_lock_key)
