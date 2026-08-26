from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

import asyncpg

from .database import KnowledgeDatabase


class IndexRunAlreadyActiveError(RuntimeError):
    """Raised when the process-wide PostgreSQL advisory lock is held."""


class IndexRunCoordinator:
    """Hold one lifecycle lock through correctness work and owned cleanup."""

    def __init__(self, database: KnowledgeDatabase, advisory_lock_key: int) -> None:
        self._database = database
        self._advisory_lock_key = advisory_lock_key
        self._reservation: asyncpg.Connection | None = None
        self._run_tasks: set[asyncio.Task[None]] = set()

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
        try:
            self._database.bind_owner_connection(connection)
        except Exception:
            await self._database.release_advisory_lock(connection, self._advisory_lock_key)
            raise
        self._reservation = connection

    async def recover_startup(self) -> int:
        """Recover only when this process has proven there is no live owner."""

        try:
            await self.reserve()
        except IndexRunAlreadyActiveError:
            return 0
        try:
            return await self._database.recover_interrupted_runs()
        finally:
            await self.release_reservation()

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
            self._database.unbind_owner_connection(connection)
            await self._database.release_advisory_lock(
                connection, self._advisory_lock_key
            )

    async def stop(self) -> None:
        await self.release_reservation()
        tasks = [*self._run_tasks]
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
        current_task = asyncio.current_task()

        def on_termination(_: asyncpg.Connection) -> None:
            if current_task is not None and not current_task.done():
                current_task.cancel()

        add_listener = getattr(connection, "add_termination_listener", None)
        remove_listener = getattr(connection, "remove_termination_listener", None)
        if callable(add_listener):
            add_listener(on_termination)
        try:
            cleanup_ids = await work()
            if cleanup_ids:
                await cleanup(cleanup_ids)
        finally:
            if callable(remove_listener):
                remove_listener(on_termination)
            self._database.unbind_owner_connection(connection)
            await self._database.release_advisory_lock(
                connection, self._advisory_lock_key
            )
