from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, Literal

import asyncpg
import httpx
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .config import Settings
from .database import (
    AcceptedIndexRun,
    ActiveIndex,
    ActiveIndexChangedError,
    KnowledgeDatabase,
    StateTransitionError,
)
from .index_lifecycle import IndexLifecycle, LifecycleError
from .index_runner import IndexRunAlreadyActiveError, IndexRunCoordinator
from .markdown_adapter import QUERY_MAX_TOKENS, TokenBudget, render_retrieval_text
from .model_probe import ModelProbeError, OllamaModelProbe
from .pdf_foundation import sha256_file
from .pdf_pipeline import PdfContentBuilder
from .pdf_runtime import (
    PdfRuntimeClient,
    PdfRuntimeError,
    PdfRuntimeSettings,
    processing_identity_for_runtime,
)
from .reranker import (
    OnnxReranker,
    PairTokenBudgetError,
    RerankerUnavailableError,
    stable_sigmoid,
)
from .retrieval import (
    MAX_RERANK_CANDIDATES,
    SearchCapacityLimiter,
    SearchValidationError,
    fuse_candidates,
    normalize_filters,
    normalize_source_types,
    render_citation,
    render_pdf_citation,
)
from .run_errors import SafeRunError, deserialize_errors


class IndexRunRequest(BaseModel):
    kind: Literal["INCREMENTAL", "FULL_REBUILD"]


class IndexRunAcceptedResponse(BaseModel):
    index_run_id: str
    index_id: str
    status: Literal["RUNNING"]


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str
    limit: int = Field(default=10, ge=1, le=20)
    primary_topic: str | None = None
    tags_all: list[str] | None = None
    path_prefix: str | None = None
    source_types: list[Literal["MARKDOWN", "PDF"]] | None = None
    rerank: bool = True
    namespace: str | None = None
    subtopic: str | None = None
    secondary_topics: list[str] | None = None
    capability: str | None = None
    min_score: float | None = None


DATABASE_ERRORS = (
    asyncpg.PostgresError,
    asyncpg.InterfaceError,
    ConnectionError,
    # M11/T1-R1 3.3 (H7 mitigation): asyncpg's `command_timeout` raises
    # `asyncio.TimeoutError`, and `asyncio.TimeoutError is TimeoutError` from
    # Python 3.11 onward (this image pins >=3.13,<3.14). Listing the builtin
    # therefore already routes every statement timeout — including a timeout on
    # the incremental shadow clone — to the 503 arms below instead of a raw
    # 500. `test_m11_index_hygiene` pins that alias identity so an interpreter
    # or union change cannot silently reopen the path.
    TimeoutError,
)
DATABASE_RESERVATION_ERRORS = DATABASE_ERRORS + (RuntimeError,)
# M11/T1-R1 3.7: how long /readyz will wait for the PDF invocation lock before
# it reports busy rather than queueing behind an in-flight extraction.
PDF_READY_LOCK_TIMEOUT_SECONDS = 2.0


def create_app(settings: Settings | None = None) -> FastAPI:
    configured_settings = settings or Settings.from_environment()
    database = KnowledgeDatabase(
        configured_settings.database_host,
        configured_settings.database_port,
        configured_settings.database_name,
        configured_settings.database_user,
        configured_settings.database_password,
        configured_settings.migration_directory,
        configured_settings.advisory_lock_key,
        configured_settings.acceptance_backup_barrier_dir,
    )
    coordinator = IndexRunCoordinator(database, configured_settings.advisory_lock_key)
    model_probe = OllamaModelProbe(configured_settings.ollama_url)
    token_budget = TokenBudget(configured_settings.tokenizer_path)
    pdf_runtime = PdfRuntimeClient(
        PdfRuntimeSettings(
            python=configured_settings.pdf_runtime_python,
            module="zink_pdf_runtime",
            vault_root=configured_settings.vault_root,
            artifacts_root=configured_settings.pdf_runtime_artifacts_path,
            manifest_path=configured_settings.pdf_runtime_manifest_path,
            lock_path=configured_settings.pdf_runtime_lock_path,
            tesseract_binary=configured_settings.pdf_tesseract_binary,
            tessdata_path=configured_settings.pdf_tessdata_path,
            temp_root=configured_settings.pdf_runtime_temp_root,
        )
    )
    pdf_builder = (
        PdfContentBuilder(
            database=database,
            runtime=pdf_runtime,
            vault_root=configured_settings.vault_root,
            token_budget=token_budget,
        )
        if configured_settings.pdf_runtime_enabled
        else None
    )

    def pdf_processing_identity(expected: ActiveIndex) -> str:
        return processing_identity_for_runtime(
            Path(__file__).resolve().parents[1] / "uv.lock",
            configured_settings.pdf_runtime_lock_path,
            configured_settings.pdf_runtime_manifest_path,
            {
                "tokenizer_identity": sha256_file(configured_settings.tokenizer_path),
                "retrieval_token_budget_version": 1,
                "embedding_identity": {
                    "name": expected.embedding_model_name,
                    "digest": expected.embedding_model_digest,
                    "dimensions": expected.embedding_dimensions,
                },
            },
        )

    lifecycle = IndexLifecycle.from_settings(
        database,
        configured_settings,
        model_probe,
        token_budget,
        pdf_builder,
        pdf_processing_identity if pdf_builder is not None else None,
    )
    search_limiter = SearchCapacityLimiter(capacity=2)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await database.start()
        if database.available:
            startup_owner = database.take_startup_owner_connection()
            if startup_owner is None:
                await coordinator.recover_startup()
            else:
                coordinator.adopt_startup_reservation(startup_owner)
                await database.recover_interrupted_runs()
        reranker: OnnxReranker | None = None
        reranker_error: str | None = None
        try:
            reranker = OnnxReranker(
                configured_settings.reranker_model_path,
                configured_settings.reranker_manifest_path,
                token_budget,
            )
        except RerankerUnavailableError:
            reranker_error = "RERANKER_UNAVAILABLE"
        app.state.reranker = reranker
        app.state.reranker_error = reranker_error
        try:
            yield
        finally:
            if reranker is not None:
                await reranker.close()
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
    app.state.token_budget = token_budget
    app.state.search_limiter = search_limiter
    app.state.reranker = None
    app.state.reranker_error = "RERANKER_UNAVAILABLE"
    app.state.pdf_runtime = pdf_runtime

    @app.exception_handler(RequestValidationError)
    async def invalid_request(
        request: Request, error: RequestValidationError
    ) -> JSONResponse:
        if request.url.path == "/v1/search":
            return JSONResponse(
                status_code=422,
                content={"detail": {"code": "INVALID_SEARCH_REQUEST"}},
            )
        return await request_validation_exception_handler(request, error)

    @app.get("/healthz", response_model=None)
    async def healthz() -> JSONResponse | dict[str, str]:
        if not database.available:
            return JSONResponse(
                status_code=503,
                content={"status": "unhealthy", "code": database.startup_error_code or "DATABASE_UNAVAILABLE"},
            )
        return {"status": "ok"}

    # M11/T1-R1 3.7: the readiness probe is polled continuously and the PDF
    # processing identity hashes the lock, runtime lock and manifest files on
    # every call. The digest is a pure function of those config paths plus the
    # embedding identity, so it is computed once and recomputed only if one of
    # those inputs changes. A single slot keeps the cache bounded by design.
    readyz_pdf_identity: tuple[tuple[object, ...], str] | None = None

    @app.get("/readyz", response_model=None)
    async def readyz(require_reranker: bool = True) -> JSONResponse | dict[str, object]:
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
        if require_reranker and app.state.reranker is None:
            # M10/T2-R21: `require_reranker` now defaults to True, matching
            # `SearchRequest.rerank` (also True). It used to default to False, so
            # an image whose reranker failed provenance verification — leaving
            # `app.state.reranker = None` — still answered /readyz with 200 and
            # the orchestrator marked the replica healthy, while EVERY default
            # search returned 503 RERANKER_UNAVAILABLE. A readiness probe must be
            # at least as strict as the default request it stands for; callers
            # that genuinely run without reranking can still pass
            # `?require_reranker=false`.
            return JSONResponse(status_code=503, content={"status": "not_ready", "code": "RERANKER_UNAVAILABLE"})
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
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "code": "EMBEDDING_MODEL_DRIFT"},
            )
        if configured_settings.pdf_runtime_enabled:
            nonlocal readyz_pdf_identity
            # The drift check above already proved active_index, the configured
            # model and this probe agree, so the run-side identity helper can be
            # reused verbatim.
            cache_key = (
                active_index.embedding_model_name,
                active_index.embedding_model_digest,
                active_index.embedding_dimensions,
                str(configured_settings.pdf_runtime_lock_path),
                str(configured_settings.pdf_runtime_manifest_path),
                str(configured_settings.tokenizer_path),
            )
            try:
                if readyz_pdf_identity is None or readyz_pdf_identity[0] != cache_key:
                    readyz_pdf_identity = (
                        cache_key,
                        await asyncio.to_thread(pdf_processing_identity, active_index),
                    )
                # M11/T1-R1 3.7: bound only the wait for the PDF invocation
                # lock, never the job. An extraction holds that lock for up to
                # its own deadline, and a readiness probe used to queue behind
                # it, which made /readyz unusable and the replica look stuck.
                await pdf_runtime.probe(
                    readyz_pdf_identity[1],
                    asyncio.get_running_loop().time() + 15,
                    lock_timeout=PDF_READY_LOCK_TIMEOUT_SECONDS,
                )
            except PdfRuntimeError as error:
                return JSONResponse(
                    status_code=503,
                    content={"status": "not_ready", "code": error.code},
                )
            except OSError:
                # The identity hashes the parent lock, the runtime lock, the
                # manifest and the tokenizer; a missing artifact is an
                # unavailable PDF runtime, not a fault to hide behind a 500.
                return JSONResponse(
                    status_code=503,
                    content={"status": "not_ready", "code": "PDF_RUNTIME_UNAVAILABLE"},
                )
        return {"status": "ready", "active_index_id": active_index.id, "embedding_model": {"name": actual_model.name, "digest": actual_model.digest, "dimensions": actual_model.dimensions}}

    @app.post("/v1/search")
    async def search(request: SearchRequest) -> dict[str, object]:
        lease = await search_limiter.try_acquire()
        if lease is None:
            raise HTTPException(status_code=429, detail={"code": "SEARCH_CAPACITY_EXCEEDED"})
        try:
            if not database.available:
                raise HTTPException(
                    status_code=503,
                    detail={"code": database.startup_error_code or "DATABASE_UNAVAILABLE"},
                )
            if request.rerank and app.state.reranker is None:
                raise HTTPException(status_code=503, detail={"code": "RERANKER_UNAVAILABLE"})
            query = request.query.strip()
            if not query:
                raise HTTPException(status_code=422, detail={"code": "INVALID_SEARCH_REQUEST"})
            if token_budget.count(query) > QUERY_MAX_TOKENS:
                raise HTTPException(status_code=422, detail={"code": "QUERY_TOKEN_LIMIT_EXCEEDED"})
            filters = normalize_filters(request.primary_topic, request.tags_all, request.path_prefix)
            source_types = normalize_source_types(request.source_types)
            segment_types = tuple(
                segment_type
                for source_type in source_types
                for segment_type in (
                    ("MARKDOWN_PASSAGE",) if source_type == "MARKDOWN"
                    else ("PDF_PASSAGE", "PDF_TABLE", "PDF_FIGURE_TEXT")
                )
            )
            for attempt in range(2):
                active_index = await database.get_active_index()
                if active_index is None:
                    raise HTTPException(status_code=503, detail={"code": "ACTIVE_INDEX_UNAVAILABLE"})
                try:
                    await lifecycle.require_identity(active_index)
                    query_embedding = await model_probe.embed(active_index.embedding_model_name, [query])
                    # The model can be swapped while the embedding request is
                    # in flight.  Check the immutable index identity again
                    # before entering the repeatable-read retrieval snapshot.
                    await lifecycle.require_identity(active_index)
                except LifecycleError as error:
                    code = error.code if error.code == "EMBEDDING_MODEL_DRIFT" else "EMBEDDING_MODEL_UNAVAILABLE"
                    raise HTTPException(status_code=503, detail={"code": code}) from None
                except (httpx.HTTPError, ModelProbeError):
                    raise HTTPException(status_code=503, detail={"code": "EMBEDDING_MODEL_UNAVAILABLE"}) from None
                if len(query_embedding) != 1 or len(query_embedding[0]) != active_index.embedding_dimensions:
                    raise HTTPException(status_code=503, detail={"code": "EMBEDDING_MODEL_UNAVAILABLE"})
                try:
                    dense, fts = await database.search_candidates(
                        active_index.id,
                        query_embedding[0],
                        query,
                        filters.primary_topic,
                        filters.tags_all,
                        filters.path_prefix,
                        segment_types,
                    )
                except ActiveIndexChangedError:
                    if attempt == 0:
                        continue
                    raise HTTPException(status_code=503, detail={"code": "ACTIVE_INDEX_CHANGED"}) from None
                reranked = request.rerank and app.state.reranker is not None
                if reranked:
                    # M10/T2-R21: the pool is MAX_RERANK_CANDIDATES, not the
                    # page size. `min(MAX_RERANK_CANDIDATES, request.limit)` was
                    # always equal to `request.limit`, because MAX_RERANK_CANDIDATES
                    # is 20 and `limit` is capped at le=20 — so the constant was
                    # dead and the reranker only ever scored the very page it was
                    # about to return. That makes it a pure reorderer: it can
                    # never improve recall, and the `min_score` filter below ran
                    # AFTER the pool had already been cut to the page size, i.e.
                    # filter-after-limit. A query with min_score=0.8 whose top 10
                    # all scored below 0.8 returned an empty page while ranks
                    # 11-20, never scored, could have satisfied it.
                    candidate_limit = MAX_RERANK_CANDIDATES
                    fused_candidates = fuse_candidates(dense, fts)[:candidate_limit]
                    pairs = [
                        (query, render_retrieval_text(item.candidate.heading_path, item.candidate.text))
                        for item in fused_candidates
                    ]
                    try:
                        logits = await app.state.reranker.predict(pairs)
                    except PairTokenBudgetError:
                        raise HTTPException(status_code=422, detail={"code": "PAIR_TOKEN_BUDGET_EXCEEDED"}) from None
                    except RerankerUnavailableError:
                        raise HTTPException(status_code=503, detail={"code": "RERANKER_UNAVAILABLE"}) from None
                    raw_scores = [stable_sigmoid(logit) for logit in logits]
                else:
                    # M10/T2-R21: same correction as the reranked branch — the
                    # candidate pool must be wider than the page so that
                    # `min_score` filters a pool rather than the final page.
                    candidate_limit = MAX_RERANK_CANDIDATES
                    fused_candidates = fuse_candidates(dense, fts)[:candidate_limit]
                    raw_scores = [item.rrf_score for item in fused_candidates]

                results = []
                for item, raw_score in zip(fused_candidates, raw_scores, strict=True):
                    candidate = item.candidate
                    results.append(
                        {
                            "segment_id": candidate.id,
                            "source_path": candidate.source_path,
                            "title": candidate.title,
                            "text": candidate.text,
                            "heading_path": list(candidate.heading_path),
                            "indexed_by_run_id": candidate.indexed_by_run_id,
                            "dense_score": None if candidate.dense_distance is None else 1.0 - candidate.dense_distance,
                            "fts_score": candidate.fts_score,
                            "rrf_score": item.rrf_score,
                            "rerank_score": raw_score,
                            "source_type": candidate.source_type,
                            "citation": {
                                "source_path": candidate.source_path,
                                "line_start": candidate.line_start,
                                "line_end": candidate.line_end,
                                "page_start": candidate.page_start,
                                "page_end": candidate.page_end,
                                "bbox": (
                                    list(candidate.bbox)
                                    if candidate.bbox is not None
                                    else None
                                ),
                                "markdown": (
                                    render_pdf_citation(candidate.title, candidate.source_path, candidate.page_start, candidate.page_end)
                                    if candidate.source_type == "PDF" and candidate.page_start is not None and candidate.page_end is not None
                                    else render_citation(candidate.title, candidate.source_path, candidate.line_start, candidate.line_end)
                                ),
                            },
                        }
                    )
                if reranked and request.min_score is not None:
                    # M11/T1-R1 3.6 (M2): min_score is a reranker-score
                    # threshold. On the RRF path `rerank_score` carries the fused
                    # rank score (order 1e-2), so the same filter silently
                    # emptied every page. The field stays reported unchanged.
                    results = [r for r in results if r.get("rerank_score", 0) >= request.min_score]
                results.sort(key=lambda item: (-item["rerank_score"], -item["rrf_score"], item["segment_id"]))
                bounded_results = results[:request.limit]
                return {
                    "index_id": active_index.id,
                    "query": query,
                    "semantic_contract_version": "zink-semantic-v2",
                    "total_count": len(bounded_results),
                    "results": bounded_results,
                }
            raise HTTPException(status_code=503, detail={"code": "ACTIVE_INDEX_CHANGED"})
        except SearchValidationError as error:
            raise HTTPException(status_code=422, detail={"code": error.code}) from None
        except HTTPException:
            raise
        except DATABASE_ERRORS:
            raise HTTPException(status_code=503, detail={"code": "DATABASE_UNAVAILABLE"}) from None
        except Exception:
            raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR"}) from None
        finally:
            await lease.release()

    @app.post("/v1/index-runs", status_code=status.HTTP_202_ACCEPTED, response_model=IndexRunAcceptedResponse)
    async def create_index_run(request: IndexRunRequest) -> IndexRunAcceptedResponse:
        if not database.available:
            raise HTTPException(status_code=503, detail={"code": database.startup_error_code or "DATABASE_UNAVAILABLE"})
        try:
            await coordinator.reserve()
        except IndexRunAlreadyActiveError:
            raise HTTPException(status_code=409, detail={"code": "INDEX_RUN_ALREADY_ACTIVE"}) from None
        except DATABASE_RESERVATION_ERRORS:
            raise HTTPException(
                status_code=503, detail={"code": "DATABASE_UNAVAILABLE"}
            ) from None

        accepted: AcceptedIndexRun | None = None
        try:
            # M11/T1-R1 3.7: a vault preflight is synchronous directory I/O on
            # a possibly networked mount; it must not block the loop.
            await asyncio.to_thread(lifecycle.preflight_vault)
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
                # M11/T1-R1 3.2 (K-09): every kind now runs inside a shadow
                # BUILDING index, so a run that never reached the scheduler has
                # to fail its index too. FULL_REBUILD-only left an INCREMENTAL
                # shadow index BUILDING with cloned content and no owner.
                await database.fail_run(
                    accepted,
                    "SCHEDULING_FAILED",
                    [SafeRunError("SCHEDULING_FAILED")],
                    0,
                    0,
                    0,
                    True,
                )
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
            source_counts = [] if run is None else await database.get_run_source_counts(run.id)
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
            "source_counts": source_counts,
        }

    return app


_module_app: FastAPI | None = None


def __getattr__(name: str) -> FastAPI:
    # PEP 562. `create_app()` hashes the pinned tokenizer off disk, so building the
    # application at import turned that artifact into a dependency of *importing*
    # this module: any test that imported it for a plain constant died at
    # collection on every host CI does not provision (`R6-I01-01`).
    #
    # `uvicorn app.main:app` resolves this attribute at startup, so a missing or
    # wrong artifact still fails the boot loudly instead of mid-request, and
    # `from app.main import app` keeps working and keeps one shared instance.
    if name != "app":
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    global _module_app
    if _module_app is None:
        _module_app = create_app()
    return _module_app
