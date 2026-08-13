from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

import httpx

from .database import (
    AcceptedIndexRun,
    ActiveIndex,
    KnowledgeDatabase,
    StateTransitionError,
)
from .markdown_adapter import MarkdownSource, MarkdownVaultScanner, TokenBudget
from .model_probe import ModelProbeError, OllamaModelProbe, ResolvedEmbeddingModel
from .run_errors import SafeRunError


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


class IndexLifecycle:
    def __init__(self, dependencies: LifecycleDependencies) -> None:
        self._database = dependencies.database
        self._model_probe = dependencies.model_probe
        self._scanner = dependencies.scanner
        self._vault_root = dependencies.vault_root
        self._embedding_model = dependencies.embedding_model
        self._embedding_dimensions = dependencies.embedding_dimensions

    @classmethod
    def from_settings(cls, database: KnowledgeDatabase, settings, model_probe: OllamaModelProbe) -> "IndexLifecycle":
        return cls(
            LifecycleDependencies(
                database=database,
                model_probe=model_probe,
                scanner=MarkdownVaultScanner(TokenBudget(settings.tokenizer_path)),
                vault_root=settings.vault_root,
                embedding_model=settings.embedding_model,
                embedding_dimensions=settings.embedding_dimensions,
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
        try:
            actual = await self._model_probe.resolve(expected.embedding_model_name)
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
            discovered = scan.discovered_count
            await self._database.set_discovered(run.id, discovered)
            if not scan.succeeded:
                scan_failed = True
                source_error_paths = {
                    error.source_path
                    for error in scan.errors
                    if error.source_path.endswith(".md")
                }
                errors.extend(
                    SafeRunError(
                        error.code,
                        error.source_path if error.source_path in source_error_paths else None,
                    )
                    for error in scan.errors
                )
                failed = len(source_error_paths)
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
            if scan.succeeded and not scan.sources and active_source_count > 0:
                await self._fail(
                    run,
                    "EMPTY_SNAPSHOT_DELETION_BLOCKED",
                    [SafeRunError("EMPTY_SNAPSHOT_DELETION_BLOCKED")],
                    discovered,
                    indexed,
                    failed,
                )
                return []

            manifest = {source.source_path: source for source in scan.sources}
            for source in scan.sources:
                if run.kind == "INCREMENTAL" and existing.get(source.source_path) == source.sha256:
                    continue
                try:
                    await self.require_identity(expected)
                    embeddings = await self._embed_source(expected, source)
                    await self.require_identity(expected)
                    await self._database.replace_source(run, source, embeddings)
                    indexed += 1
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
                await self._database.complete_incremental(
                    run, discovered, indexed, set(existing).difference(manifest)
                )
                return []

            return await self._database.publish_full_rebuild(run, discovered, indexed)
        except LifecycleError as error:
            await self._fail(run, error.code, [SafeRunError(error.code, error.source_path)], discovered, indexed, failed)
            return []
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
            fail_index=run.kind == "FULL_REBUILD",
        )

    async def cleanup(self, index_ids: list[str]) -> None:
        try:
            await self._database.cleanup_superseded(index_ids)
        except Exception:
            # Cleanup is explicitly outside the correctness lifecycle.
            return
