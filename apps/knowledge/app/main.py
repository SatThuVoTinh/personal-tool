from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator, Literal

import asyncpg
import httpx
from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .config import Settings
from .database import AcceptedIndexRun, KnowledgeDatabase, StateTransitionError
from .index_lifecycle import IndexLifecycle, LifecycleError
from .index_runner import IndexRunAlreadyActiveError, IndexRunCoordinator
from .model_probe import ModelProbeError, OllamaModelProbe
from .run_errors import SafeRunError, deserialize_errors


class IndexRunRequest(BaseModel):
    kind: Literal["INCREMENTAL", "FULL_REBUILD"]


class IndexRunAcceptedResponse(BaseModel):
    index_run_id: str
    index_id: str
    status: Literal["RUNNING"]


DATABASE_ERRORS = (
    asyncpg.PostgresError,
    asyncpg.InterfaceError,
    ConnectionError,
    TimeoutError,
)


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
    coordinator = IndexRunCoordinator(database, configured_settings.advisory_lock_key)
    model_probe = OllamaModelProbe(configured_settings.ollama_url)
    lifecycle = IndexLifecycle.from_settings(database, configured_settings, model_probe)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await database.start()
        try:
            yield
        finally:
            await coordinator.stop()
            await model_probe.close()
            await database.stop()

    app = FastAPI(
        title="Personal Tool Knowledge Platform",
        docs_url=None,
        openapi_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.database = database
    app.state.coordinator = coordinator
    app.state.model_probe = model_probe

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz", response_model=None)
    async def readyz() -> JSONResponse | dict[str, object]:
        if not database.available:
            return JSONResponse(status_code=503, content={"status": "not_ready", "code": database.startup_error_code or "DATABASE_UNAVAILABLE"})
        try:
            active_index = await database.get_active_index()
        except DATABASE_ERRORS:
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "code": "DATABASE_UNAVAILABLE"},
            )
        if active_index is None:
            return JSONResponse(status_code=503, content={"status": "not_ready", "code": "NO_ACTIVE_INDEX"})
        try:
            actual_model = await model_probe.resolve(configured_settings.embedding_model)
        except (httpx.HTTPError, ModelProbeError):
            return JSONResponse(status_code=503, content={"status": "not_ready", "code": "EMBEDDING_MODEL_UNAVAILABLE"})
        if (
            active_index.embedding_model_name != configured_settings.embedding_model
            or actual_model.name != active_index.embedding_model_name
            or actual_model.digest != active_index.embedding_model_digest
            or actual_model.dimensions != active_index.embedding_dimensions
            or actual_model.dimensions != configured_settings.embedding_dimensions
        ):
            return JSONResponse(status_code=503, content={"status": "not_ready", "code": "EMBEDDING_MODEL_DRIFT", "expected": {"name": active_index.embedding_model_name, "digest": active_index.embedding_model_digest, "dimensions": active_index.embedding_dimensions}, "actual": {"name": actual_model.name, "digest": actual_model.digest, "dimensions": actual_model.dimensions}})
        return {"status": "ready", "active_index_id": active_index.id, "embedding_model": {"name": actual_model.name, "digest": actual_model.digest, "dimensions": actual_model.dimensions}}

    @app.post("/v1/index-runs", status_code=status.HTTP_202_ACCEPTED, response_model=IndexRunAcceptedResponse)
    async def create_index_run(request: IndexRunRequest) -> IndexRunAcceptedResponse:
        if not database.available:
            raise HTTPException(status_code=503, detail={"code": database.startup_error_code or "DATABASE_UNAVAILABLE"})
        try:
            await coordinator.reserve()
        except IndexRunAlreadyActiveError:
            raise HTTPException(status_code=409, detail={"code": "INDEX_RUN_ALREADY_ACTIVE"}) from None

        accepted: AcceptedIndexRun | None = None
        try:
            lifecycle.preflight_vault()
            active_index = await database.get_active_index()
            if request.kind == "INCREMENTAL":
                if active_index is None:
                    raise HTTPException(status_code=409, detail={"code": "NO_ACTIVE_INDEX"})
                try:
                    await lifecycle.require_identity(active_index)
                except LifecycleError as error:
                    raise HTTPException(status_code=409 if error.code == "EMBEDDING_MODEL_DRIFT" else 503, detail={"code": error.code}) from None
                accepted = await database.accept_incremental(active_index)
            else:
                identity = await lifecycle.resolve_configured_model()
                accepted = await database.accept_full_rebuild(identity.name, identity.digest, identity.dimensions)
            try:
                await coordinator.schedule(
                    lambda: lifecycle.execute(accepted), lifecycle.cleanup
                )
            except Exception as error:
                await database.fail_run(accepted, "SCHEDULING_FAILED", [SafeRunError("SCHEDULING_FAILED")], 0, 0, 0, request.kind == "FULL_REBUILD")
                raise HTTPException(status_code=503, detail={"code": "SCHEDULING_FAILED"}) from error
            return IndexRunAcceptedResponse(index_run_id=accepted.id, index_id=accepted.index_id, status="RUNNING")
        except LifecycleError as error:
            raise HTTPException(status_code=503, detail={"code": error.code}) from None
        except StateTransitionError:
            raise HTTPException(
                status_code=409, detail={"code": "INDEX_STATE_TRANSITION_FAILED"}
            ) from None
        except DATABASE_ERRORS:
            raise HTTPException(
                status_code=503, detail={"code": "DATABASE_UNAVAILABLE"}
            ) from None
        finally:
            await coordinator.release_reservation()

    @app.get("/v1/index-runs/{run_id}")
    async def get_index_run(run_id: str) -> dict[str, object]:
        if not database.available:
            raise HTTPException(
                status_code=503,
                detail={"code": database.startup_error_code or "DATABASE_UNAVAILABLE"},
            )
        try:
            run = await database.get_run(run_id)
        except ValueError:
            run = None
        except DATABASE_ERRORS:
            raise HTTPException(
                status_code=503, detail={"code": "DATABASE_UNAVAILABLE"}
            ) from None
        if run is None:
            raise HTTPException(status_code=404, detail={"code": "INDEX_RUN_NOT_FOUND"})
        return {
            "index_run_id": run.id,
            "index_id": run.index_id,
            "kind": run.kind,
            "status": run.status,
            "started_at": run.started_at,
            "finished_at": run.finished_at,
            "sources_discovered": run.sources_discovered,
            "sources_indexed": run.sources_indexed,
            "sources_failed": run.sources_failed,
            "failure_code": run.failure_code,
            "failure": deserialize_errors(run.failure_detail),
        }

    return app


app = create_app()
