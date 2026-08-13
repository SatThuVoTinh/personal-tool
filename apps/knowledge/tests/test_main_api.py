from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

import httpx

os.environ.setdefault("KNOWLEDGE_DATABASE_PASSWORD", "unit-test-only")

from app.config import Settings
from app.main import app as module_app
from app.main import create_app


class IndexRunApiBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self) -> None:
        await module_app.state.model_probe.close()

    async def test_invalid_schema_returns_422_without_acquiring_lock(self) -> None:
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
            vault_root=Path("/vault"),
            tokenizer_path=Path(os.environ["KNOWLEDGE_TOKENIZER_PATH"]),
        )
        app = create_app(settings)
        reserve = AsyncMock()
        app.state.coordinator.reserve = reserve
        transport = httpx.ASGITransport(app=app)
        try:
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                invalid = await client.post(
                    "/v1/index-runs", json={"kind": "BANANA"}
                )
                unavailable = await client.get("/v1/index-runs/not-a-uuid")
        finally:
            await app.state.model_probe.close()

        self.assertEqual(invalid.status_code, 422)
        reserve.assert_not_awaited()
        self.assertEqual(unavailable.status_code, 503)
        self.assertEqual(unavailable.json()["detail"]["code"], "DATABASE_UNAVAILABLE")

    async def test_database_failure_during_lock_acquisition_returns_503(self) -> None:
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
            vault_root=Path("/vault"),
            tokenizer_path=Path(os.environ["KNOWLEDGE_TOKENIZER_PATH"]),
        )
        app = create_app(settings)
        app.state.database._pool = object()
        app.state.coordinator.reserve = AsyncMock(
            side_effect=ConnectionError("must not escape")
        )
        transport = httpx.ASGITransport(app=app)
        try:
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                response = await client.post(
                    "/v1/index-runs", json={"kind": "INCREMENTAL"}
                )
        finally:
            await app.state.model_probe.close()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "DATABASE_UNAVAILABLE")
