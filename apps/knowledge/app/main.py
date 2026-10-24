from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import logging
from pathlib import Path
import re
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
    PdfContentNotFoundError,
    PdfContentNotReclaimableError,
    SegmentRecord,
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
    refuse_unhonourable_scope,
    render_citation,
    render_pdf_citation,
)
from .run_errors import SafeRunError, deserialize_errors

# F-101 (R5-E01-05): the module had no logging facility at all, so every
# 500 was unattributable after the fact and a failed cleanup left no record
# the owner could read. The logger is the module's own; the record names the
# code and the identifier it is about.
logger = logging.getLogger(__name__)


class IndexRunRequest(BaseModel):
    kind: Literal["INCREMENTAL", "FULL_REBUILD"]


class IndexRunAcceptedResponse(BaseModel):
    index_run_id: str
    index_id: str
    status: Literal["RUNNING"]


class PdfContentReclamationRequest(BaseModel):
    """The governed reclamation of one ingested PDF's derived text copy.

    H9: the owner approved reclaiming the derived text copies; the PDF
    itself stays. The document is named by the path the corpus already
    publishes it under, so the action never has to guess which file the
    caller means.
    """

    model_config = ConfigDict(extra="forbid")

    source_path: str = Field(min_length=1, max_length=1024)


# M12/T2.2-R2 B-13 (4A.14 / R5-E01-03): the token ceiling in `/v1/search` is the
# semantic bound and stays the final authority, but it is applied INSIDE the
# handler — after a `SearchCapacityLimiter` slot is taken and after the whole
# body has been tokenized on the event loop. This bounds the work instead, with
# margin: `QUERY_BUDGET_FIXTURE` proves 511 characters is exactly
# `QUERY_MAX_TOKENS` tokens for the pinned tokenizer, so a compliant query cannot
# reach this number.
SEARCH_QUERY_MAX_CHARS = 1024

# F-165 (R5-E02-06): the query embedding used to inherit the probe client's
# 90 s read timeout, and the single retry added another 90 s plus a second of
# backoff, so one slow provider held one of the two search slots for roughly
# 181 s. Two slow responses closed `/v1/search` to every other caller. The
# attempt is now bounded well below the client default.
QUERY_EMBEDDING_TIMEOUT_SECONDS = 30.0

# F-165 (R5-E02-06): the limiter is a two-slot, no-queue limiter, so the
# refusal has to tell the caller when to come back. Without a `Retry-After`
# the caller could not back off correctly and the 429 read as "no results".
SEARCH_CAPACITY_RETRY_AFTER_SECONDS = 1


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(max_length=SEARCH_QUERY_MAX_CHARS)
    limit: int = Field(default=10, ge=1, le=20)
    primary_topic: str | None = None
    tags_all: list[str] | None = None
    path_prefix: str | None = None
    source_types: list[Literal["MARKDOWN", "PDF"]] | None = None
    rerank: bool = True
    min_score: float | None = None
    # F-116 (R5-E02-01): these four were DECLARED, accepted under
    # `extra="forbid"` and then ignored by every query, so an answer scoped
    # to a namespace was really corpus-wide. `namespace` and
    # `secondary_topics` are now honoured as scopes over the corpus's own
    # canonical topics. `subtopic` and `capability` name dimensions this
    # service does not have, so they are refused instead of silently
    # answered with the whole corpus.
    namespace: str | None = None
    subtopic: str | None = None
    secondary_topics: list[str] | None = None
    capability: str | None = None


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


def _code_shaped(error: BaseException) -> str | None:
    """The code an internal failure carries, when its message is one."""

    message = str(error).strip()
    if re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", message):
        return message
    return None


def _reranker_error_code(error: BaseException) -> str:
    """The code a reranker failure carries, when it is one.

    F-310 (R7-E1-06): the reranker raises a fixed vocabulary of codes
    (`RERANKER_MANIFEST_INVALID`, `RERANKER_ARTIFACT_MISSING`, …). The
    bootstrap used to throw that vocabulary away and write one constant, so
    the operator could not tell a bad artifact pin from a corrupted image or
    an unusable graph. Only a code-shaped message is carried; anything else
    is the generic name.
    """

    return _code_shaped(error) or "RERANKER_UNAVAILABLE"


def _embedding_error_code(error: BaseException) -> str:
    """The code an embedding failure carries, when it is one.

    F-515 (R10-L07-4): both embedding arms named the error they caught and
    then wrote the constant `EMBEDDING_MODEL_UNAVAILABLE`, so a permanent
    provider refusal, a timeout, a dropped socket and a mis-shaped body were
    one answer. The probe's vocabulary is already code-shaped
    (`EMBEDDING_PERMANENT_HTTP`, `EMBEDDING_TRANSPORT`, `EMBEDDING_TIMEOUT`,
    `EMBEDDING_TRANSIENT_HTTP`, `EMBEDDING_MODEL_INVALID_RESPONSE`,
    `EMBEDDING_INVALID_RESPONSE`); it is carried the same way the reranker's is
    above. A transport fault whose message is not a code keeps the constant,
    so the 503 body never echoes an upstream sentence.
    """

    return _code_shaped(error) or "EMBEDDING_MODEL_UNAVAILABLE"


def _search_report(
    retained_count: int,
    returned_count: int,
    candidate_pool_count: int,
    pool_at_ceiling: bool,
) -> dict[str, bool | int]:
    """The completeness fields of a `/v1/search` answer.

    F-132 (R5-E02-04) and F-140 (R5-E01-06): `total_count` used to be the
    LENGTH OF THE PAGE, so a 20-candidate pool cut to `limit=5` read as "only 5
    matches exist" and an agent concluded the corpus held nothing more. It is
    the number of matching results that EXIST, and `has_more` /
    `candidate_pool_count` say whether the page was truncated.

    F-514 (R10-L07-3): `has_more` compares the retained pool with the page, and
    both are capped at `MAX_RERANK_CANDIDATES` -- the same constant `limit` is
    capped at. At `limit == MAX_RERANK_CANDIDATES` a pool that FILLED that
    ceiling left no field differing from a complete answer, so a cut answer was
    indistinguishable from an exhausted one. `truncated` states that a ceiling
    was applied: true when the fused pool reached `MAX_RERANK_CANDIDATES`
    (equality included -- a pool that filled the ceiling cannot claim there was
    nothing more) or when the page dropped results the pool did hold. No
    ceiling moves: the pool is still `MAX_RERANK_CANDIDATES`, the page is still
    `limit`.
    """

    return {
        "total_count": retained_count,
        "returned_count": returned_count,
        "has_more": retained_count > returned_count,
        "candidate_pool_count": candidate_pool_count,
        "truncated": pool_at_ceiling or retained_count > returned_count,
    }


def _file_content_evidence(path: Path) -> tuple[str, int, int]:
    """Cheap evidence that a hashed file's CONTENT changed.

    F-091 (R5-E01-02): the `/readyz` processing-identity memo was keyed on the
    three file PATHS, so a file rewritten in place at the same path replayed
    the pre-change digest forever. The memo now keys on the modification time
    and the size of the bytes that are hashed, which is the cheap evidence
    the acceptance criteria name, and a rewrite at the same path is a
    different key. A missing file is its own evidence, so a path that
    appears later is also a different key.
    """

    try:
        metadata = path.stat()
    except OSError:
        return (str(path), -1, -1)
    return (str(path), metadata.st_mtime_ns, metadata.st_size)


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

    async def recover_interrupted_state() -> None:
        """Repair the state a crashed or late database left behind.

        F-092 (R5-E03-03): the sweep is chunked and idempotent, so it can be
        repeated. F-164 (R5-E01-04): it also runs when a re-attempted
        connection succeeds, because the state it repairs is exactly the
        state a boot that failed before the sweep skipped. A sweep that
        fails is NAMED, and it does not stop the service from becoming
        ready: the rows it would delete belong to indexes that are already
        FAILED, and the next attempt repeats the sweep.
        """

        if not database.available:
            return
        try:
            startup_owner = database.take_startup_owner_connection()
            if startup_owner is None:
                await coordinator.recover_startup()
            else:
                coordinator.adopt_startup_reservation(startup_owner)
                await database.recover_interrupted_runs()
        except Exception as error:
            logger.error(
                "knowledge.startup_recovery_incomplete code=%s error=%s",
                "STARTUP_RECOVERY_INCOMPLETE",
                error,
                exc_info=True,
            )

    database.set_recovery_callback(recover_interrupted_state)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await database.start()
        await recover_interrupted_state()
        reranker: OnnxReranker | None = None
        reranker_error: str | None = None
        try:
            reranker = OnnxReranker(
                configured_settings.reranker_model_path,
                configured_settings.reranker_manifest_path,
                token_budget,
            )
        except RerankerUnavailableError as error:
            # F-310 (R7-E1-06): the bootstrap caught the typed error without
            # binding it and wrote one constant, so the only surviving
            # identity of a failed start-up was a string that cannot tell a
            # bad artifact pin from a corrupted image or an unusable graph.
            # The code the reranker raised is kept, and it is READ by the
            # readiness route below.
            reranker_error = _reranker_error_code(error)
            logger.error(
                "knowledge.reranker_unavailable code=%s", reranker_error, exc_info=True
            )
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
            # F-310 (R7-E1-06): the code is the one the reranker raised, so
            # an artifact problem and a graph problem are distinguishable.
            return JSONResponse(
                status_code=503,
                content={
                    "status": "not_ready",
                    "code": app.state.reranker_error or "RERANKER_UNAVAILABLE",
                },
            )
        try:
            actual_model = await model_probe.resolve(configured_settings.embedding_model)
        except (httpx.HTTPError, ModelProbeError) as error:
            # F-515 (R10-L07-4): the same flattening as the search arm. The
            # readiness answer is the one an orchestrator reads, so a permanent
            # refusal and a timeout must not be the same string here either.
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "code": _embedding_error_code(error)},
            )
        except Exception:
            # M12/T2.2-R2 B-20 (found while landing B-18): `resolve` parses a JSON body, and a
            # decode or shape fault is neither of the two types above, so it escaped as the
            # default 500 with a plain-text body on the route the orchestrator uses to decide
            # replica health. Status cannot change; the answer is this route's own coded shape.
            return JSONResponse(
                status_code=500,
                content={"status": "not_ready", "code": "INTERNAL_ERROR"},
            )
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
                *_file_content_evidence(configured_settings.pdf_runtime_lock_path),
                *_file_content_evidence(configured_settings.pdf_runtime_manifest_path),
                *_file_content_evidence(configured_settings.tokenizer_path),
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
            except Exception:
                # B-20's second half: the same route, the other call site. A fault
                # that is neither a runtime error nor a missing artifact must not
                # leave the probe with a codeless 500 either.
                return JSONResponse(
                    status_code=500,
                    content={"status": "not_ready", "code": "INTERNAL_ERROR"},
                )
        return {"status": "ready", "active_index_id": active_index.id, "embedding_model": {"name": actual_model.name, "digest": actual_model.digest, "dimensions": actual_model.dimensions}}

    @app.post("/v1/search")
    async def search(request: SearchRequest) -> dict[str, object]:
        lease = await search_limiter.try_acquire()
        if lease is None:
            raise HTTPException(
                status_code=429,
                detail={"code": "SEARCH_CAPACITY_EXCEEDED"},
                headers={"Retry-After": str(SEARCH_CAPACITY_RETRY_AFTER_SECONDS)},
            )
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
            filters = normalize_filters(
                request.primary_topic,
                request.tags_all,
                request.path_prefix,
                request.namespace,
                request.secondary_topics,
            )
            # F-116 (R5-E02-01): a scope this service cannot honour is
            # refused, not answered with the whole corpus.
            refuse_unhonourable_scope(request.subtopic, request.capability)
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
                    query_embedding = await model_probe.embed(
                        active_index.embedding_model_name,
                        [query],
                        timeout=QUERY_EMBEDDING_TIMEOUT_SECONDS,
                    )
                    # The model can be swapped while the embedding request is
                    # in flight.  Check the immutable index identity again
                    # before entering the repeatable-read retrieval snapshot.
                    await lifecycle.require_identity(active_index)
                except LifecycleError as error:
                    code = error.code if error.code == "EMBEDDING_MODEL_DRIFT" else "EMBEDDING_MODEL_UNAVAILABLE"
                    raise HTTPException(status_code=503, detail={"code": code}) from error
                except (httpx.HTTPError, ModelProbeError) as error:
                    # F-515 (R10-L07-4): the arm bound the error and then threw
                    # its code away, and this route logs only inside its generic
                    # arm -- which `except HTTPException: raise` never reaches --
                    # so neither the caller nor the operator could tell a
                    # permanent refusal from a timeout. The code is carried into
                    # the body AND recorded, because the two answer different
                    # questions.
                    code = _embedding_error_code(error)
                    logger.error("knowledge.search_embedding_failed code=%s", code)
                    raise HTTPException(status_code=503, detail={"code": code}) from error
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
                        # F-116 (R5-E02-01): the scope the caller asked for
                        # reaches the query, so a namespace-scoped answer is
                        # scoped instead of corpus-wide.
                        filters.namespace_topic,
                        filters.canonical_topics_all,
                    )
                except ActiveIndexChangedError as error:
                    if attempt == 0:
                        continue
                    raise HTTPException(status_code=503, detail={"code": "ACTIVE_INDEX_CHANGED"}) from error
                reranked = request.rerank and app.state.reranker is not None
                if not reranked and request.min_score is not None:
                    # F-012 (R5-E02-03): `min_score` is a reranker-score
                    # threshold. On the RRF path no reranker ran, so there is no
                    # reranker score for it to compare against. The M11/T1-R1
                    # fix kept the field but made it carry the fused RRF rank
                    # score (order 1e-2), so the threshold was never enforced
                    # and every number the caller was told was a "rerank score"
                    # was a different quantity. A threshold that cannot be
                    # enforced is refused instead of silently ignored.
                    raise HTTPException(
                        status_code=422, detail={"code": "INVALID_SEARCH_REQUEST"}
                    )
                # F-514 (R10-L07-3): fuse the branches once, before the ceiling
                # is applied. `pool_at_ceiling` is the operand `has_more` cannot
                # carry at the top of the legal `limit` range: a pool that
                # filled the ceiling means at least this many results matched,
                # not exactly this many.
                fused_pool = fuse_candidates(dense, fts)
                candidate_limit = MAX_RERANK_CANDIDATES
                pool_at_ceiling = len(fused_pool) >= candidate_limit
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
                    #
                    # F-514 (R10-L07-3): the cut itself is measured once, over
                    # the whole fused set, so the answer can say that a ceiling
                    # was applied even when the page and the pool are the same
                    # size.
                    fused_candidates = fused_pool[:candidate_limit]
                    pairs = [
                        (query, render_retrieval_text(item.candidate.heading_path, item.candidate.text))
                        for item in fused_candidates
                    ]
                    try:
                        logits = await app.state.reranker.predict(pairs)
                    except PairTokenBudgetError as error:
                        raise HTTPException(status_code=422, detail={"code": "PAIR_TOKEN_BUDGET_EXCEEDED"}) from error
                    except RerankerUnavailableError as error:
                        raise HTTPException(status_code=503, detail={"code": "RERANKER_UNAVAILABLE"}) from error
                    raw_scores = [stable_sigmoid(logit) for logit in logits]
                else:
                    # M10/T2-R21: same correction as the reranked branch — the
                    # candidate pool must be wider than the page so that
                    # `min_score` filters a pool rather than the final page.
                    fused_candidates = fused_pool[:candidate_limit]
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
                            # F-072 (R5-E02-02): the immutable source
                            # identity. A path can be reused by different
                            # bytes and an index run covers thousands of
                            # files, so neither identifies the revision the
                            # answer was produced from.
                            "source_id": candidate.source_id,
                            "source_sha256": candidate.source_sha256,
                            # F-570 (R10-T10-1): the span of the source this
                            # result quotes, on the ITEM. The same values live
                            # inside `citation` below, but a consumer that
                            # rebuilds its own item from scratch can only carry
                            # what the item declares -- so the identity that
                            # makes a citation re-verifiable was unreachable
                            # one hop after this route published it. Both are
                            # nullable: a PDF row has pages and no lines.
                            "line_end": candidate.line_end,
                            "line_start": candidate.line_start,
                            "page_start": candidate.page_start,
                            "page_end": candidate.page_end,
                            "canonical_topics": list(candidate.canonical_topics),
                            "dense_score": None if candidate.dense_distance is None else 1.0 - candidate.dense_distance,
                            "fts_score": candidate.fts_score,
                            "rrf_score": item.rrf_score,
                            # F-012 (R5-E02-03): only a reranker produces a
                            # rerank score. On the RRF path the field is null,
                            # never a fused rank score wearing the name.
                            "rerank_score": raw_score if reranked else None,
                            "source_type": candidate.source_type,
                            "citation": {
                                "source_path": candidate.source_path,
                                # F-072 (R5-E02-02): the identity travels with
                                # the citation, so a surfaced citation can be
                                # re-verified by re-hashing the source.
                                "source_id": candidate.source_id,
                                "source_sha256": candidate.source_sha256,
                                    "line_end": candidate.line_end,
                                "line_start": candidate.line_start,
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
                if reranked:
                    results.sort(
                        key=lambda item: (
                            -item["rerank_score"],
                            -item["rrf_score"],
                            item["segment_id"],
                        )
                    )
                else:
                    results.sort(
                        key=lambda item: (-item["rrf_score"], item["segment_id"])
                    )
                bounded_results = results[:request.limit]
                return {
                    "index_id": active_index.id,
                    "query": query,
                    "semantic_contract_version": "zink-semantic-v2",
                    **_search_report(
                        len(results),
                        len(bounded_results),
                        len(fused_candidates),
                        pool_at_ceiling,
                    ),
                    "results": bounded_results,
                }
            raise HTTPException(status_code=503, detail={"code": "ACTIVE_INDEX_CHANGED"})
        except SearchValidationError as error:
            raise HTTPException(status_code=422, detail={"code": error.code}) from error
        except HTTPException:
            raise
        except DATABASE_ERRORS as error:
            raise HTTPException(status_code=503, detail={"code": "DATABASE_UNAVAILABLE"}) from error
        except Exception as error:
            # F-101 (R5-E01-05): the record names the code. The query text
            # is NOT logged: it is user content, and the traceback already
            # carries the cause.
            logger.error(
                "knowledge.search_failed code=%s",
                "INTERNAL_ERROR",
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR"}) from error
        finally:
            await lease.release()

    def _citation_markdown(
        title: str,
        source_path: str,
        line_start: int | None,
        line_end: int | None,
        page_start: int | None,
        page_end: int | None,
        source_type: str,
    ) -> str:
        if source_type == "PDF" and page_start is not None and page_end is not None:
            return render_pdf_citation(title, source_path, page_start, page_end)
        return render_citation(title, source_path, line_start, line_end)

    async def _read_segment(segment_id: str) -> SegmentRecord:
        """Read one indexed segment, or refuse with a named code.

        F-071 (R1-A16-07): `retrieve`, `citation` and `metadata` were
        advertised to the model but had no route, so the citation round trip
        ended in an HTTP 404 and the surviving citations could not be tied
        to the run that produced them.
        """

        if not database.available:
            raise HTTPException(
                status_code=503,
                detail={"code": database.startup_error_code or "DATABASE_UNAVAILABLE"},
            )
        try:
            record = await database.get_segment(segment_id)
        except ValueError:
            # A malformed identifier is a segment that does not exist.
            record = None
        except DATABASE_ERRORS as error:
            raise HTTPException(
                status_code=503, detail={"code": "DATABASE_UNAVAILABLE"}
            ) from error
        except Exception as error:
            raise HTTPException(
                status_code=500, detail={"code": "INTERNAL_ERROR"}
            ) from error
        if record is None:
            raise HTTPException(status_code=404, detail={"code": "SEGMENT_NOT_FOUND"})
        return record

    @app.get("/v1/chunk/{segment_id}", response_model=None)
    async def get_chunk(segment_id: str) -> dict[str, object]:
        record = await _read_segment(segment_id)
        citation = _citation_markdown(
            record.title,
            record.source_path,
            record.line_start,
            record.line_end,
            record.page_start,
            record.page_end,
            record.source_type,
        )
        row = {
            "segment_id": record.id,
            "chunk_id": record.id,
            "index_id": record.index_id,
            "indexed_by_run_id": record.indexed_by_run_id,
            "source_id": record.source_id,
            "source_sha256": record.source_sha256,
            "source_path": record.source_path,
            "source_type": record.source_type,
            "title": record.title,
            "text": record.text,
            "heading_path": list(record.heading_path),
            # F-570 (R10-T10-1): the span, on the item, so a consumer that
            # rebuilds the item can forward it.
            "line_start": record.line_start,
            "line_end": record.line_end,
            "page_start": record.page_start,
            "page_end": record.page_end,
            "citation": citation,
        }
        return {
            "action": "retrieve",
            "segment_id": record.id,
            "index_id": record.index_id,
            "indexed_by_run_id": record.indexed_by_run_id,
            "results": [row],
        }

    @app.get("/v1/citation/{segment_id}", response_model=None)
    async def get_citation(segment_id: str) -> dict[str, object]:
        record = await _read_segment(segment_id)
        citation = _citation_markdown(
            record.title,
            record.source_path,
            record.line_start,
            record.line_end,
            record.page_start,
            record.page_end,
            record.source_type,
        )
        row = {
            "segment_id": record.id,
            "chunk_id": record.id,
            "index_id": record.index_id,
            "indexed_by_run_id": record.indexed_by_run_id,
            "source_id": record.source_id,
            "source_sha256": record.source_sha256,
            "source_path": record.source_path,
            "source_type": record.source_type,
            "title": record.title,
            "text": record.text,
            # F-570 (R10-T10-1): the citation route publishes the same span on
            # its item, not only inside `citation_block`.
            "line_start": record.line_start,
            "line_end": record.line_end,
            "page_start": record.page_start,
            "page_end": record.page_end,
            "citation": citation,
            "citation_block": {
                "source_path": record.source_path,
                "source_id": record.source_id,
                "source_sha256": record.source_sha256,
                "line_start": record.line_start,
                "line_end": record.line_end,
                "page_start": record.page_start,
                "page_end": record.page_end,
                "bbox": list(record.bbox) if record.bbox is not None else None,
                "markdown": citation,
            },
        }
        return {
            "action": "citation",
            "segment_id": record.id,
            "index_id": record.index_id,
            "indexed_by_run_id": record.indexed_by_run_id,
            "results": [row],
        }

    @app.get("/v1/metadata/{segment_id}", response_model=None)
    async def get_metadata(segment_id: str) -> dict[str, object]:
        record = await _read_segment(segment_id)
        row = {
            "segment_id": record.id,
            "chunk_id": record.id,
            "index_id": record.index_id,
            "indexed_by_run_id": record.indexed_by_run_id,
            "source_id": record.source_id,
            "source_sha256": record.source_sha256,
            "source_path": record.source_path,
            "source_type": record.source_type,
            "source_mime_type": record.source_mime_type,
            "title": record.title,
            "primary_topic": record.primary_topic,
            "canonical_topics": list(record.canonical_topics),
            "tags": list(record.tags),
            "heading_path": list(record.heading_path),
            "line_start": record.line_start,
            "line_end": record.line_end,
            "page_start": record.page_start,
            "page_end": record.page_end,
            "bbox": list(record.bbox) if record.bbox is not None else None,
            "citation": _citation_markdown(
                record.title,
                record.source_path,
                record.line_start,
                record.line_end,
                record.page_start,
                record.page_end,
                record.source_type,
            ),
        }
        return {
            "action": "metadata",
            "segment_id": record.id,
            "index_id": record.index_id,
            "indexed_by_run_id": record.indexed_by_run_id,
            "results": [row],
        }

    @app.post("/v1/index-runs", status_code=status.HTTP_202_ACCEPTED, response_model=IndexRunAcceptedResponse)
    async def create_index_run(request: IndexRunRequest) -> IndexRunAcceptedResponse:
        if not database.available:
            raise HTTPException(status_code=503, detail={"code": database.startup_error_code or "DATABASE_UNAVAILABLE"})
        try:
            await coordinator.reserve()
        except IndexRunAlreadyActiveError as error:
            raise HTTPException(status_code=409, detail={"code": "INDEX_RUN_ALREADY_ACTIVE"}) from error
        except DATABASE_RESERVATION_ERRORS as error:
            raise HTTPException(
                status_code=503, detail={"code": "DATABASE_UNAVAILABLE"}
            ) from error

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
                    raise HTTPException(status_code=409 if error.code == "EMBEDDING_MODEL_DRIFT" else 503, detail={"code": error.code}) from error
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
            raise HTTPException(status_code=503, detail={"code": error.code}) from error
        except StateTransitionError as error:
            raise HTTPException(
                status_code=409, detail={"code": "INDEX_STATE_TRANSITION_FAILED"}
            ) from error
        except DATABASE_ERRORS as error:
            raise HTTPException(
                status_code=503, detail={"code": "DATABASE_UNAVAILABLE"}
            ) from error
        except HTTPException:
            # The body below raises HTTPException itself (NO_ACTIVE_INDEX, and
            # the scheduler's SCHEDULING_FAILED). Without this passthrough a
            # terminal mapper would rewrite a documented 409/503 as a 500.
            raise
        except Exception as error:
            # M12/T2.2-R2 B-18 (`R6-V03-02`): `/v1/search` already answers an
            # unmapped fault this way. Left unmapped here, FastAPI's default 500
            # reached the adapter with an empty body and the code flattened to
            # HTTP_500, so the outage was unattributable.
            raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR"}) from error
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
        except DATABASE_ERRORS as error:
            raise HTTPException(
                status_code=503, detail={"code": "DATABASE_UNAVAILABLE"}
            ) from error
        except Exception as error:
            # B-18's sibling mapper above. A run whose lookup faulted must not
            # be a codeless 500. F-101: the record names the run.
            logger.error(
                "knowledge.index_run_lookup_failed code=%s run_id=%s",
                "INTERNAL_ERROR",
                run_id,
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR"}) from error
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

    @app.post("/v1/pdf-content-reclamations")
    async def create_pdf_content_reclamation(
        request: PdfContentReclamationRequest,
    ) -> dict[str, object]:
        """Reclaim the derived text copy of one ingested PDF.

        H9: this is a governed action, so the reclamation is never a hand
        edit of the tree or of the database. It takes the store's OWN writer
        -- the same advisory lock an index run takes -- so it can never race
        a run, and the write itself happens inside that writer's transaction.

        The PDF stays: the source row, its published segments and the file in
        the vault are never touched. The action is idempotent: reclaiming an
        already-reclaimed document writes nothing and reports so.
        """

        if not database.available:
            raise HTTPException(
                status_code=503,
                detail={"code": database.startup_error_code or "DATABASE_UNAVAILABLE"},
            )
        try:
            await coordinator.reserve()
        except IndexRunAlreadyActiveError as error:
            raise HTTPException(
                status_code=409, detail={"code": "INDEX_RUN_ALREADY_ACTIVE"}
            ) from error
        except StateTransitionError as error:
            # The owner session is already bound: a run holds it. That is a
            # CONFLICT, not an unavailable database.
            raise HTTPException(
                status_code=409, detail={"code": "INDEX_RUN_ALREADY_ACTIVE"}
            ) from error
        except DATABASE_RESERVATION_ERRORS as error:
            raise HTTPException(
                status_code=503, detail={"code": "DATABASE_UNAVAILABLE"}
            ) from error
        try:
            reclamation = await database.reclaim_pdf_content(request.source_path)
        except PdfContentNotFoundError as error:
            raise HTTPException(
                status_code=404, detail={"code": "PDF_SOURCE_NOT_FOUND"}
            ) from error
        except PdfContentNotReclaimableError as error:
            raise HTTPException(
                status_code=409, detail={"code": "PDF_CONTENT_NOT_RECLAIMABLE"}
            ) from error
        except StateTransitionError as error:
            raise HTTPException(
                status_code=409, detail={"code": "PDF_CONTENT_RECLAMATION_FAILED"}
            ) from error
        except DATABASE_ERRORS as error:
            raise HTTPException(
                status_code=503, detail={"code": "DATABASE_UNAVAILABLE"}
            ) from error
        except Exception as error:
            # F-101: the record names the code and the document it is about.
            # The path is caller-supplied, so it is logged escaped: a newline
            # in it must not be able to forge a log line.
            logger.error(
                "knowledge.pdf_content_reclamation_failed code=%s source_path=%r",
                "INTERNAL_ERROR",
                request.source_path,
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR"}) from error
        finally:
            await coordinator.release_reservation()
        return {
            "reclamation_id": reclamation.build_id,
            "source_path": reclamation.source_path,
            "content_identity_digest": reclamation.content_identity_digest,
            "pdf_digest": reclamation.pdf_digest,
            "status": reclamation.status,
            "segments_reclaimed": reclamation.segments_reclaimed,
            "sources_released": reclamation.sources_released,
            "reclaimed_at": reclamation.reclaimed_at,
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
