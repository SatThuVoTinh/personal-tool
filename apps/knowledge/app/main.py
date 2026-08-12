from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .config import Settings
from .database import KnowledgeDatabase
from .index_runner import IndexRunCoordinator
from .model_probe import ModelProbeError, OllamaModelProbe


def create_app(settings: Settings | None = None) -> FastAPI:
    configured_settings = settings or Settings.from_environment()
    database = KnowledgeDatabase(
        configured_settings.database_host,
        configured_settings.database_port,
        configured_settings.database_name,
        configured_settings.database_user,
        configured_settings.database_password,
        configured_settings.migration_directory,
    )
    index_run_coordinator = IndexRunCoordinator(
        database, configured_settings.advisory_lock_key
    )
    model_probe = OllamaModelProbe(configured_settings.ollama_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await database.start()
        try:
            yield
        finally:
            await index_run_coordinator.stop()
            await database.stop()

    app = FastAPI(
        title="Personal Tool Knowledge Platform",
        docs_url=None,
        openapi_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz", response_model=None)
    async def readyz() -> JSONResponse | dict[str, object]:
        if not database.available:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "not_ready",
                    "code": database.startup_error_code or "DATABASE_UNAVAILABLE",
                },
            )

        active_index = await database.get_active_index()
        if active_index is None:
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "code": "NO_ACTIVE_INDEX"},
            )

        try:
            actual_model = await model_probe.resolve(
                configured_settings.embedding_model
            )
        except (httpx.HTTPError, ModelProbeError):
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "code": "EMBEDDING_MODEL_UNAVAILABLE"},
            )

        if (
            active_index.embedding_model_name
            != configured_settings.embedding_model
            or actual_model.name != active_index.embedding_model_name
            or actual_model.digest != active_index.embedding_model_digest
            or actual_model.dimensions != active_index.embedding_dimensions
            or actual_model.dimensions != configured_settings.embedding_dimensions
        ):
            return JSONResponse(
                status_code=503,
                content={
                    "status": "not_ready",
                    "code": "EMBEDDING_MODEL_DRIFT",
                    "expected": {
                        "name": active_index.embedding_model_name,
                        "digest": active_index.embedding_model_digest,
                        "dimensions": active_index.embedding_dimensions,
                    },
                    "actual": {
                        "name": actual_model.name,
                        "digest": actual_model.digest,
                        "dimensions": actual_model.dimensions,
                    },
                },
            )

        return {
            "status": "ready",
            "active_index_id": active_index.id,
            "embedding_model": {
                "name": actual_model.name,
                "digest": actual_model.digest,
                "dimensions": actual_model.dimensions,
            },
        }

    return app


app = create_app()
