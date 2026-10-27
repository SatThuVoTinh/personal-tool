from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
import logging
from pathlib import Path

import httpx

from .database import (
    AcceptedIndexRun,
    ActiveIndex,
    KnowledgeDatabase,
    StateTransitionError,
    normalize_source_path,
)
from .markdown_adapter import MarkdownSource, MarkdownVaultScanner, TokenBudget
from .model_probe import ModelProbeError, OllamaModelProbe, ResolvedEmbeddingModel
from .pdf_foundation import PdfFoundationError, PdfSidecar, discover_pdf_sidecars
from .pdf_pipeline import PdfBuildError, PdfContentBuilder
from .run_errors import SafeRunError

# F-101 (R5-E01-05): the module had no logging facility at all.
logger = logging.getLogger(__name__)


class LifecycleError(RuntimeError):
    def __init__(self, code: str, source_path: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.source_path = source_path


@dataclass(frozen=True)
class LifecycleDependencies:
    database: KnowledgeDatabase
    model_probe: OllamaModelProbe
    scanner: MarkdownVaultScanner
    vault_root: Path
    embedding_model: str
    embedding_dimensions: int
    pdf_builder: PdfContentBuilder | None = None
    pdf_processing_identity: Callable[[ActiveIndex], str] | None = None


class IndexLifecycle:
    def __init__(self, dependencies: LifecycleDependencies) -> None:
        self._database = dependencies.database
        self._model_probe = dependencies.model_probe
        self._scanner = dependencies.scanner
        self._vault_root = dependencies.vault_root
        self._embedding_model = dependencies.embedding_model
        self._embedding_dimensions = dependencies.embedding_dimensions
        self._pdf_builder = dependencies.pdf_builder
        self._pdf_processing_identity = dependencies.pdf_processing_identity
        self._run_source_counts: dict[str, list[int]] | None = None

    @classmethod
    def from_settings(
        cls,
        database: KnowledgeDatabase,
        settings,
        model_probe: OllamaModelProbe,
        token_budget: TokenBudget,
        pdf_builder: PdfContentBuilder | None = None,
        pdf_processing_identity: Callable[[ActiveIndex], str] | None = None,
    ) -> "IndexLifecycle":
        return cls(
            LifecycleDependencies(
                database=database,
                model_probe=model_probe,
                scanner=MarkdownVaultScanner(token_budget),
                vault_root=settings.vault_root,
                embedding_model=settings.embedding_model,
                embedding_dimensions=settings.embedding_dimensions,
                pdf_builder=pdf_builder,
                pdf_processing_identity=pdf_processing_identity,
            )
        )

    def preflight_vault(self) -> None:
        try:
            if not self._vault_root.is_dir() or not (self._vault_root / "01. Knowledge").is_dir():
                raise OSError
            # A read operation distinguishes an inaccessible mount from an empty one.
            next((self._vault_root / "01. Knowledge").iterdir(), None)
        except OSError as error:
            raise LifecycleError("VAULT_UNAVAILABLE") from error

    async def resolve_configured_model(self) -> ResolvedEmbeddingModel:
        try:
            resolved = await self._model_probe.resolve(self._embedding_model)
        except (httpx.HTTPError, ModelProbeError) as error:
            raise LifecycleError("EMBEDDING_MODEL_UNAVAILABLE") from error
        if resolved.dimensions != self._embedding_dimensions:
            raise LifecycleError("EMBEDDING_MODEL_UNAVAILABLE")
        return resolved

    @staticmethod
    def matches(expected: ActiveIndex, actual: ResolvedEmbeddingModel) -> bool:
        return (
            actual.name == expected.embedding_model_name
            and actual.digest == expected.embedding_model_digest
            and actual.dimensions == expected.embedding_dimensions
        )

    async def require_identity(self, expected: ActiveIndex) -> None:
        """Refuse to work against a model that is not the indexed one.

        F-263 (R7-D10B-01): the resolution used to issue an embedding
        preflight on every call, so one `/v1/search` paid two model-list
        round trips and three embedding round trips. The index already knows
        the vector width, and every caller checks the width of the vectors it
        received, so the width is passed in and the redundant embedding call
        is not made. The digest comparison -- the part that can actually fail
        -- is unchanged.
        """

        try:
            actual = await self._model_probe.resolve(
                expected.embedding_model_name,
                expected_dimensions=expected.embedding_dimensions,
            )
        except (httpx.HTTPError, ModelProbeError) as error:
            raise LifecycleError("EMBEDDING_MODEL_UNAVAILABLE") from error
        if not self.matches(expected, actual):
            raise LifecycleError("EMBEDDING_MODEL_DRIFT")

    async def execute(self, run: AcceptedIndexRun) -> list[str]:
        """Run the non-transactional work; database methods own state transitions."""
        expected = await self._database.get_index(run.index_id)
        if expected is None:
            await self._fail(run, "INDEX_NOT_FOUND", [], 0, 0, 0)
            return []
        discovered = indexed = failed = 0
        errors: list[SafeRunError] = []
        scan_failed = False
        try:
            scan = await asyncio.to_thread(
                self._scanner.scan_vault,
                self._vault_root,
                include_valid_sources_on_error=True,
            )
            pdf_sidecars: tuple[PdfSidecar, ...] = ()
            pdf_discovery_error: PdfFoundationError | None = None
            if self._pdf_builder is not None:
                try:
                    pdf_sidecars = await asyncio.to_thread(discover_pdf_sidecars, self._vault_root)
                except PdfFoundationError as error:
                    pdf_discovery_error = error
            discovered = scan.discovered_count + len(pdf_sidecars)
            self._run_source_counts = {
                "MARKDOWN": [scan.discovered_count, 0, 0],
                "PDF": [len(pdf_sidecars), 0, 0],
            }
            await self._database.set_discovered(run.id, discovered)
            if pdf_discovery_error is not None:
                scan_failed = True
                errors.append(SafeRunError(pdf_discovery_error.code))
                if run.kind == "FULL_REBUILD":
                    await self._fail(run, "SCAN_FAILED", errors, discovered, indexed, failed)
                    return []
            if not scan.succeeded:
                scan_failed = True
                # F-307 (R7-E1-02): the per-source COUNT still counts only
                # the errors that name a specific markdown file, but the
                # error keeps its LOCATION. A directory-scoped read failure
                # used to have its path nulled, so the class of errors that
                # most needs locating was the class that lost its location
                # -- and, with the path nulled, two of them collapsed into
                # one reported error.
                source_error_paths = {
                    error.source_path
                    for error in scan.errors
                    if error.source_path.endswith(".md")
                }
                errors.extend(
                    SafeRunError(error.code, error.source_path)
                    for error in scan.errors
                )
                failed = len(source_error_paths)
                self._run_source_counts["MARKDOWN"][2] = failed
                if run.kind == "FULL_REBUILD" or not scan.sources:
                    await self._fail(
                        run, "SCAN_FAILED", errors, discovered, indexed, failed
                    )
                    return []

            existing = await self._database.source_hashes(run.index_id)
            active_before = await self._database.get_active_index()
            active_source_count = (
                await self._database.source_count(active_before.id) if active_before else 0
            )
            if scan.succeeded and not scan.sources and not pdf_sidecars and active_source_count > 0:
                await self._fail(
                    run,
                    "EMPTY_SNAPSHOT_DELETION_BLOCKED",
                    [SafeRunError("EMPTY_SNAPSHOT_DELETION_BLOCKED")],
                    discovered,
                    indexed,
                    failed,
                )
                return []

            # F-576 (R10-T10-7): the hash map is keyed by the stored form, so a
            # decomposed scan path has to be compared in that same form; the
            # stale set is derived from the same keys, which is what keeps an
            # unchanged source from being deleted after it was skipped.
            manifest = {
                normalize_source_path(source.source_path): source
                for source in scan.sources
            }
            manifest.update(
                {
                    normalize_source_path(sidecar.source_path): sidecar
                    for sidecar in pdf_sidecars
                }
            )
            for source in scan.sources:
                if run.kind == "INCREMENTAL" and existing.get(
                    normalize_source_path(source.source_path)
                ) == source.sha256:
                    continue
                try:
                    embeddings = await self._embed_source(expected, source)
                    # M11/T1-R1 3.4: the second probe per document was the
                    # pre-embed one. The post-embed check still brackets every
                    # source and runs BEFORE replace_source, so a drifted model
                    # can never publish embeddings; the run keeps its initial
                    # check at the API boundary.
                    await self.require_identity(expected)
                    await self._database.replace_source(run, source, embeddings)
                    indexed += 1
                    self._run_source_counts["MARKDOWN"][1] += 1
                except LifecycleError as error:
                    is_run_level = error.code in {
                        "EMBEDDING_MODEL_DRIFT",
                        "EMBEDDING_MODEL_UNAVAILABLE",
                    }
                    errors.append(
                        SafeRunError(error.code, None if is_run_level else source.source_path)
                    )
                    if not is_run_level:
                        failed += 1
                        self._run_source_counts["MARKDOWN"][2] += 1
                    if is_run_level or run.kind == "FULL_REBUILD":
                        await self._fail(run, error.code, errors, discovered, indexed, failed)
                        return []
                except StateTransitionError:
                    await self._fail(
                        run,
                        "INDEX_STATE_TRANSITION_FAILED",
                        [SafeRunError("INDEX_STATE_TRANSITION_FAILED")],
                        discovered,
                        indexed,
                        failed,
                    )
                    return []
                except Exception:
                    errors.append(
                        SafeRunError("DOCUMENT_INDEXING_FAILED", source.source_path)
                    )
                    failed += 1
                    self._run_source_counts["MARKDOWN"][2] += 1
                    if run.kind == "FULL_REBUILD":
                        await self._fail(
                            run,
                            "DOCUMENT_INDEXING_FAILED",
                            errors,
                            discovered,
                            indexed,
                            failed,
                        )
                        return []

            if pdf_sidecars:
                if self._pdf_processing_identity is None:
                    await self._fail(
                        run,
                        "PDF_RUNTIME_UNAVAILABLE",
                        [*errors, SafeRunError("PDF_RUNTIME_UNAVAILABLE")],
                        discovered,
                        indexed,
                        failed,
                    )
                    return []
                try:
                    # M11/T1-R1 3.7: the identity hashes the lock/manifest files
                    # synchronously; off the loop it would stall every run.
                    pdf_processing_identity = await asyncio.to_thread(
                        self._pdf_processing_identity, expected
                    )
                except Exception:
                    await self._fail(
                        run,
                        "PDF_RUNTIME_UNAVAILABLE",
                        [*errors, SafeRunError("PDF_RUNTIME_UNAVAILABLE")],
                        discovered,
                        indexed,
                        failed,
                    )
                    return []
                for sidecar in pdf_sidecars:
                    try:
                        # F-444 (R9-T06-2): the publish skip below compares a
                        # content identity that embeds the digest of
                        # app/pdf_runtime.py. A byte change to the deriving
                        # code re-keys every PDF, so the owner's reclamation
                        # record must be consulted by the stable source pair
                        # BEFORE the build re-derives the reclaimed copy.
                        if (
                            run.kind == "INCREMENTAL"
                            and await self._database.pdf_content_is_reclaimed(
                                sidecar.pdf_digest, sidecar.sidecar_digest
                            )
                        ):
                            continue
                        result = await self._pdf_builder.build(sidecar, pdf_processing_identity)
                        if existing.get(
                            normalize_source_path(sidecar.source_path)
                        ) == result.content_identity_digest:
                            continue
                        await self.require_identity(expected)
                        await self._pdf_builder.revalidate_identity(
                            sidecar, pdf_processing_identity, result.content_identity_digest
                        )
                        segments = await self._database.pdf_publication_segments(result.build_id)
                        embeddings = await self._embed_pdf_segments(expected, sidecar, segments)
                        await self.require_identity(expected)
                        await self._pdf_builder.revalidate_identity(
                            sidecar, pdf_processing_identity, result.content_identity_digest
                        )
                        await self._database.replace_pdf_source(
                            run,
                            source_path=sidecar.source_path,
                            content_identity_digest=result.content_identity_digest,
                            title=sidecar.title,
                            canonical_topics=sidecar.canonical_topics,
                            tags=sidecar.tags,
                            build_id=result.build_id,
                            segments=segments,
                            embeddings=embeddings,
                            validate_before_publish=lambda: self._pdf_builder.revalidate_identity(
                                sidecar, pdf_processing_identity, result.content_identity_digest
                            ),
                        )
                        indexed += 1
                        self._run_source_counts["PDF"][1] += 1
                    except PdfBuildError as error:
                        # F-550 (R10-T06-2): the child's bounded summary is
                        # recorded beside the code, so an OOM kill and a missing
                        # artifact no longer persist as one indistinguishable
                        # PDF_RUNTIME_FAILED row.
                        errors.append(
                            SafeRunError(error.code, sidecar.source_path, error.cause)
                        )
                        failed += 1
                        self._run_source_counts["PDF"][2] += 1
                        if run.kind == "FULL_REBUILD":
                            await self._fail(
                                run, error.code, errors, discovered, indexed, failed
                            )
                            return []
                    except StateTransitionError:
                        # F-550 (R10-T06-2): a state the store refused is not a
                        # runtime failure; naming it runtime sent the operator
                        # to the child for a row the database declined. No cause
                        # rides along — this fault's message is internal, and the
                        # run row has always refused internal messages.
                        errors.append(
                            SafeRunError("PDF_BUILD_STATE_INVALID", sidecar.source_path)
                        )
                        failed += 1
                        self._run_source_counts["PDF"][2] += 1
                        if run.kind == "FULL_REBUILD":
                            await self._fail(
                                run,
                                "PDF_BUILD_STATE_INVALID",
                                errors,
                                discovered,
                                indexed,
                                failed,
                            )
                            return []
                    except LifecycleError as error:
                        errors.append(SafeRunError(error.code, sidecar.source_path))
                        failed += 1
                        self._run_source_counts["PDF"][2] += 1
                        if run.kind == "FULL_REBUILD":
                            await self._fail(run, error.code, errors, discovered, indexed, failed)
                            return []
                    except Exception:
                        errors.append(SafeRunError("DOCUMENT_INDEXING_FAILED", sidecar.source_path))
                        failed += 1
                        self._run_source_counts["PDF"][2] += 1
                        if run.kind == "FULL_REBUILD":
                            await self._fail(
                                run, "DOCUMENT_INDEXING_FAILED", errors, discovered, indexed, failed
                            )
                            return []

            # A final gate covers unchanged and empty snapshots as well as the
            # window immediately before deletion/publication.
            try:
                await self.require_identity(expected)
            except LifecycleError as error:
                await self._fail(
                    run,
                    error.code,
                    [*errors, SafeRunError(error.code)],
                    discovered,
                    indexed,
                    failed,
                )
                return []

            if run.kind == "INCREMENTAL":
                if errors:
                    await self._fail(
                        run,
                        "SCAN_FAILED" if scan_failed else "SOURCE_INDEXING_FAILED",
                        errors,
                        discovered,
                        indexed,
                        failed,
                    )
                    return []
                return await self._database.complete_incremental(
                    run,
                    discovered,
                    indexed,
                    set(existing).difference(manifest),
                    self._source_counts(),
                )

            return await self._database.publish_full_rebuild(
                run, discovered, indexed, self._source_counts()
            )
        except LifecycleError as error:
            await self._fail(run, error.code, [SafeRunError(error.code, error.source_path)], discovered, indexed, failed)
            return []
        except asyncio.CancelledError:
            # F-253 (R7-D10A-01): the owner-connection termination handler
            # cancels the run task, and `asyncio.CancelledError` derives from
            # `BaseException`, so the `except Exception` arm below never ran
            # and the run row stayed RUNNING. The partial unique index then
            # refused every later run and the violation surfaced as a 503
            # "database unavailable" until the process restarted. The run is
            # marked terminal here, inside the same process, and the
            # cancellation is re-raised.
            try:
                await asyncio.shield(
                    self._fail(
                        run,
                        "INDEX_RUN_INTERRUPTED",
                        [SafeRunError("INDEX_RUN_INTERRUPTED")],
                        discovered,
                        indexed,
                        failed,
                    )
                )
            except Exception as error:
                logger.error(
                    "knowledge.run_interrupt_unrecorded code=%s run_id=%s error=%s",
                    "INDEX_RUN_INTERRUPTED",
                    run.id,
                    error,
                    exc_info=True,
                )
            raise
        except Exception:
            await self._fail(
                run,
                "INDEXING_UNEXPECTED_FAILURE",
                [SafeRunError("INDEXING_UNEXPECTED_FAILURE")],
                discovered,
                indexed,
                failed,
            )
            return []
        finally:
            self._run_source_counts = None

    async def _embed_source(self, expected: ActiveIndex, source: MarkdownSource) -> list[list[float]]:
        try:
            embeddings = await self._model_probe.embed(
                expected.embedding_model_name,
                [segment.retrieval_text for segment in source.segments],
            )
        except (httpx.HTTPError, ModelProbeError) as error:
            raise LifecycleError("EMBEDDING_FAILED", source.source_path) from error
        if any(len(vector) != expected.embedding_dimensions for vector in embeddings):
            raise LifecycleError("EMBEDDING_INVALID_DIMENSIONS", source.source_path)
        return embeddings

    async def _embed_pdf_segments(
        self, expected: ActiveIndex, sidecar: PdfSidecar, segments
    ) -> list[list[float]]:
        try:
            embeddings = await self._model_probe.embed(
                expected.embedding_model_name,
                [f"{sidecar.title}\n\n{segment.content}" for segment in segments],
            )
        except (httpx.HTTPError, ModelProbeError) as error:
            raise LifecycleError("EMBEDDING_FAILED", sidecar.source_path) from error
        if len(embeddings) != len(segments) or any(
            len(vector) != expected.embedding_dimensions for vector in embeddings
        ):
            raise LifecycleError("EMBEDDING_INVALID_DIMENSIONS", sidecar.source_path)
        return embeddings

    async def _fail(
        self,
        run: AcceptedIndexRun,
        code: str,
        errors: list[SafeRunError],
        discovered: int,
        indexed: int,
        failed: int,
    ) -> None:
        await self._database.fail_run(
            run,
            code,
            errors or [SafeRunError(code)],
            discovered,
            indexed,
            failed,
            # Both kinds now target a BUILDING index: incremental stages in a
            # shadow index, so failure must mark that shadow FAILED and leave
            # the live ACTIVE index untouched.
            fail_index=True,
            source_counts=self._source_counts(),
        )

    def _source_counts(self) -> dict[str, tuple[int, int, int]] | None:
        if self._run_source_counts is None:
            return None
        return {
            source_type: (values[0], values[1], values[2])
            for source_type, values in self._run_source_counts.items()
        }

    async def cleanup(self, index_ids: list[str]) -> None:
        try:
            await self._database.cleanup_superseded(index_ids)
        except Exception as error:
            # F-101 (R5-E01-05): the module had no logging facility at all,
            # so a failed cleanup left nothing behind: the owner saw silent
            # Postgres growth and an unattributable 500. The failure is now a
            # record that names the code and the identifiers it is about.
            # Cleanup stays outside the correctness lifecycle -- the run has
            # already been published -- so the failure is recorded, not
            # raised.
            logger.error(
                "knowledge.cleanup_failed code=%s index_ids=%s error=%s",
                "CLEANUP_FAILED",
                ",".join(index_ids),
                error,
                exc_info=True,
            )
            return
