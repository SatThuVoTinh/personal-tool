"""M4/T2's bounded, non-searchable PDF content-build pipeline."""

from __future__ import annotations

import asyncio
import re
import unicodedata
from bisect import bisect_right
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from .database import (
    KnowledgeDatabase,
    PdfContentBatch,
    PdfContentBuild,
    PdfContentIdentityExistsError,
    PdfContentSegment,
)
from .markdown_adapter import (
    MAX_CHARS,
    MAX_RETRIEVAL_TOKENS,
    TokenBudget,
    _SENTENCE_BOUNDARY,
    render_retrieval_text,
)
from .pdf_foundation import (
    PdfFoundationError,
    PdfSidecar,
    content_identity_digest,
    sha256_file,
    validated_vault_regular_file,
)
from .pdf_runtime import PdfRuntimeClient, PdfRuntimeError

MAX_PDF_BYTES = 512 * 1024 * 1024
MAX_PDF_PAGES = 2000
PAGES_PER_BATCH = 4
OPERATION_TIMEOUT_SECONDS = 15 * 60
BUILD_TIMEOUT_SECONDS = 24 * 60 * 60


class PdfBuildError(RuntimeError):
    """A stable, outward-safe PDF build failure."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class PdfLightweightIdentity:
    size: int
    mtime_ns: int
    device: int | None
    inode: int | None


@dataclass(frozen=True)
class PdfBuildResult:
    build_id: str
    content_identity_digest: str
    page_count: int
    segment_count: int


@dataclass(frozen=True)
class _SourceSnapshot:
    pdf_identity: PdfLightweightIdentity
    sidecar_identity: PdfLightweightIdentity
    pdf_digest: str
    sidecar_digest: str


class PdfContentBuilder:
    """Build PDF content with one sequential isolated child invocation at a time."""

    def __init__(
        self,
        *,
        database: KnowledgeDatabase,
        runtime: PdfRuntimeClient,
        vault_root: Path,
        token_budget: TokenBudget,
    ) -> None:
        self._database = database
        self._runtime = runtime
        self._vault_root = vault_root
        self._token_budget = token_budget

    async def build(
        self, sidecar: PdfSidecar, expected_processing_identity_digest: str
    ) -> PdfBuildResult:
        loop = asyncio.get_running_loop()
        cumulative_deadline = loop.time() + BUILD_TIMEOUT_SECONDS
        await self._database.assert_pdf_content_identity_schema()
        baseline = await asyncio.to_thread(self._initial_snapshot, sidecar)
        self._require_before_commit_deadline(cumulative_deadline)
        if not self._fits(sidecar.title, "x"):
            raise PdfBuildError("PDF_TITLE_TOKEN_BUDGET_EXCEEDED")

        preflight_started = loop.time()
        preflight_deadline, timeout_code = self._operation_deadline(
            preflight_started, cumulative_deadline
        )
        self._assert_baseline(sidecar, baseline)
        try:
            preflight = await self._runtime.preflight(
                sidecar.source_path, expected_processing_identity_digest, preflight_deadline
            )
        except PdfRuntimeError as error:
            raise PdfBuildError(timeout_code if error.code == "PDF_RUNTIME_TIMEOUT" else error.code) from error
        self._assert_baseline(sidecar, baseline)
        self._require_before_commit_deadline(cumulative_deadline)
        page_count = preflight["page_count"]
        if page_count > MAX_PDF_PAGES:
            raise PdfBuildError("PDF_PAGE_LIMIT_EXCEEDED")

        identity = content_identity_digest(
            baseline.pdf_digest, baseline.sidecar_digest, expected_processing_identity_digest
        )
        try:
            build, batches = await self._database.create_pdf_content_build(
                content_identity_digest=identity,
                pdf_digest=baseline.pdf_digest,
                sidecar_digest=baseline.sidecar_digest,
                processing_identity_digest=expected_processing_identity_digest,
                page_count=page_count,
                batch_size=PAGES_PER_BATCH,
            )
        except PdfContentIdentityExistsError as error:
            raise PdfBuildError("PDF_CONTENT_IDENTITY_EXISTS") from error

        segment_count = 0
        try:
            for batch in batches:
                await self._require_after_commit_deadline(cumulative_deadline, build)
                await self._assert_baseline_or_fail(sidecar, baseline, build)
                await self._database.start_pdf_content_batch(batch)
                try:
                    batch_started = loop.time()
                    deadline, timeout_code = self._operation_deadline(
                        batch_started, cumulative_deadline
                    )
                    response = await self._runtime.extract_range(
                        sidecar.source_path,
                        batch.page_start,
                        batch.page_end,
                        expected_processing_identity_digest,
                        deadline,
                    )
                    self._raise_if_cumulative_expired(cumulative_deadline)
                    self._assert_baseline(sidecar, baseline)
                    segments = await asyncio.to_thread(
                        self._segment_batch, sidecar.title, response["items"], batch
                    )
                    self._raise_if_cumulative_expired(cumulative_deadline)
                    await self._database.complete_pdf_content_batch(batch, segments)
                    segment_count += len(segments)
                except PdfRuntimeError as error:
                    code = timeout_code if error.code == "PDF_RUNTIME_TIMEOUT" else error.code
                    await self._database.fail_pdf_content_batch_and_build(batch, code)
                    raise PdfBuildError(code) from error
                except PdfBuildError as error:
                    await self._database.fail_pdf_content_batch_and_build(batch, error.code)
                    raise
                except Exception as error:
                    await self._database.fail_pdf_content_batch_and_build(
                        batch, "PDF_RUNTIME_FAILED"
                    )
                    raise PdfBuildError("PDF_RUNTIME_FAILED") from error

            await self._require_after_commit_deadline(cumulative_deadline, build)
            try:
                await asyncio.to_thread(self._final_snapshot, sidecar, baseline)
                self._raise_if_cumulative_expired(cumulative_deadline)
            except PdfBuildError as error:
                await self._database.fail_pdf_content_build(build, error.code)
                raise
            if segment_count == 0:
                await self._database.fail_pdf_content_build(build, "PDF_NO_EXTRACTABLE_CONTENT")
                raise PdfBuildError("PDF_NO_EXTRACTABLE_CONTENT")
            await self._database.complete_pdf_content_build(build)
        except PdfBuildError:
            raise
        return PdfBuildResult(build.id, identity, page_count, segment_count)

    def _initial_snapshot(self, sidecar: PdfSidecar) -> _SourceSnapshot:
        pdf_path, sidecar_path = self._safe_paths(sidecar)
        try:
            before_pdf, before_sidecar = _identity(pdf_path), _identity(sidecar_path)
        except OSError as error:
            raise PdfBuildError("PDF_SOURCE_DRIFT") from error
        if before_pdf.size > MAX_PDF_BYTES:
            raise PdfBuildError("PDF_FILE_TOO_LARGE")
        try:
            pdf_digest, sidecar_digest = sha256_file(pdf_path), sha256_file(sidecar_path)
        except OSError as error:
            raise PdfBuildError("PDF_SOURCE_DRIFT") from error
        pdf_path, sidecar_path = self._safe_paths(sidecar)
        try:
            after_pdf, after_sidecar = _identity(pdf_path), _identity(sidecar_path)
        except OSError as error:
            raise PdfBuildError("PDF_SOURCE_DRIFT") from error
        if (before_pdf, before_sidecar) != (after_pdf, after_sidecar):
            raise PdfBuildError("PDF_SOURCE_DRIFT")
        return _SourceSnapshot(after_pdf, after_sidecar, pdf_digest, sidecar_digest)

    def _final_snapshot(self, sidecar: PdfSidecar, baseline: _SourceSnapshot) -> None:
        self._assert_baseline(sidecar, baseline)
        pdf_path, sidecar_path = self._safe_paths(sidecar)
        try:
            pdf_digest, sidecar_digest = sha256_file(pdf_path), sha256_file(sidecar_path)
        except OSError as error:
            raise PdfBuildError("PDF_SOURCE_DRIFT") from error
        self._assert_baseline(sidecar, baseline)
        if (pdf_digest, sidecar_digest) != (baseline.pdf_digest, baseline.sidecar_digest):
            raise PdfBuildError("PDF_SOURCE_DRIFT")

    async def _assert_baseline_or_fail(
        self, sidecar: PdfSidecar, baseline: _SourceSnapshot, build: PdfContentBuild
    ) -> None:
        try:
            self._assert_baseline(sidecar, baseline)
        except PdfBuildError as error:
            # This checkpoint is between batches, so every later range remains PENDING.
            await self._database.fail_pdf_content_build(build, error.code)
            raise

    def _assert_baseline(self, sidecar: PdfSidecar, baseline: _SourceSnapshot) -> None:
        pdf_path, sidecar_path = self._safe_paths(sidecar)
        try:
            current_pdf, current_sidecar = _identity(pdf_path), _identity(sidecar_path)
        except OSError as error:
            raise PdfBuildError("PDF_SOURCE_DRIFT") from error
        if current_pdf != baseline.pdf_identity or current_sidecar != baseline.sidecar_identity:
            raise PdfBuildError("PDF_SOURCE_DRIFT")

    def _safe_paths(self, sidecar: PdfSidecar) -> tuple[Path, Path]:
        try:
            pdf_path = validated_vault_regular_file(
                self._vault_root, sidecar.source_path, require_pdf=True
            )
            sidecar_path = validated_vault_regular_file(self._vault_root, sidecar.sidecar_path)
        except (OSError, PdfFoundationError) as error:
            raise PdfBuildError("PDF_SOURCE_DRIFT") from error
        return pdf_path, sidecar_path

    @staticmethod
    def _operation_deadline(started: float, cumulative_deadline: float) -> tuple[float, str]:
        local_deadline = started + OPERATION_TIMEOUT_SECONDS
        if cumulative_deadline <= local_deadline:
            return cumulative_deadline, "PDF_BUILD_TIMEOUT"
        return local_deadline, "PDF_RUNTIME_TIMEOUT"

    @staticmethod
    def _require_before_commit_deadline(cumulative_deadline: float) -> None:
        if asyncio.get_running_loop().time() >= cumulative_deadline:
            raise PdfBuildError("PDF_BUILD_TIMEOUT")

    @staticmethod
    def _raise_if_cumulative_expired(cumulative_deadline: float) -> None:
        if asyncio.get_running_loop().time() >= cumulative_deadline:
            raise PdfBuildError("PDF_BUILD_TIMEOUT")

    async def _require_after_commit_deadline(
        self, cumulative_deadline: float, build: PdfContentBuild
    ) -> None:
        if asyncio.get_running_loop().time() >= cumulative_deadline:
            await self._database.fail_pdf_content_build(build, "PDF_BUILD_TIMEOUT")
            raise PdfBuildError("PDF_BUILD_TIMEOUT")

    def _segment_batch(
        self, title: str, items: Sequence[Mapping[str, Any]], batch: PdfContentBatch
    ) -> tuple[PdfContentSegment, ...]:
        segments: list[PdfContentSegment] = []
        for item in items:
            page_start, page_end = item["page_start"], item["page_end"]
            if page_start != page_end:
                raise PdfBuildError("PDF_MULTI_PAGE_ITEM_UNSUPPORTED")
            if not (batch.page_start <= page_start <= batch.page_end):
                raise PdfBuildError("PDF_RUNTIME_OUTPUT_INVALID")
            content = _normalize_content(item["content"])
            if not content:
                continue
            if item["kind"] == "table":
                pieces = self._split_table(title, content)
                segment_type = "PDF_TABLE"
            else:
                pieces = self._split_prose(title, content)
                segment_type = "PDF_FIGURE_TEXT" if item["kind"] == "figure_text" else "PDF_PASSAGE"
            exact_bbox = item["bbox"] if len(pieces) == 1 else None
            for split_ordinal, piece in enumerate(pieces):
                retrieval_text = render_retrieval_text((title,), piece)
                segments.append(
                    PdfContentSegment(
                        ordinal=len(segments),
                        segment_type=segment_type,
                        content=piece,
                        page_start=page_start,
                        page_end=page_end,
                        bbox=tuple(exact_bbox) if exact_bbox is not None else None,
                        provenance={
                            "item_kind": item["kind"],
                            "item_ordinal": item["ordinal"],
                            "split_ordinal": split_ordinal,
                            "content_token_count": self._token_budget.count(piece),
                            "retrieval_token_count": self._token_budget.count(retrieval_text),
                        },
                    )
                )
        return tuple(segments)

    def _split_prose(self, title: str, text: str) -> tuple[str, ...]:
        if self._fits(title, text):
            return (text,)
        sentences = _sentence_pieces(text)
        output: list[str] = []
        for sentence in sentences:
            if self._fits(title, sentence):
                output.append(sentence)
            elif re.search(r"\s", sentence):
                output.extend(self._split_whitespace(title, sentence))
            else:
                output.extend(self._split_token_offsets(title, sentence, "PDF_RUNTIME_OUTPUT_INVALID"))
        return tuple(output)

    def _split_whitespace(self, title: str, text: str) -> tuple[str, ...]:
        words = list(re.finditer(r"\S+", text))
        word_ends = [word.end() for word in words]
        output: list[str] = []
        start = 0
        while start < len(words):
            best: str | None = None
            best_end = start
            character_start = words[start].start()
            low = start
            high = bisect_right(word_ends, character_start + MAX_CHARS) - 1
            while low <= high:
                end = (low + high) // 2
                candidate = text[character_start : words[end].end()]
                if self._fits(title, candidate):
                    best, best_end = candidate, end + 1
                    low = end + 1
                else:
                    high = end - 1
            if best is None:
                word = words[start].group(0)
                output.extend(self._split_token_offsets(title, word, "PDF_RUNTIME_OUTPUT_INVALID"))
                start += 1
            else:
                output.append(best)
                start = best_end
        return tuple(output)

    def _split_token_offsets(self, title: str, text: str, failure: str) -> tuple[str, ...]:
        offsets = self._token_budget.offsets(text)
        if not offsets:
            raise PdfBuildError(failure)
        output: list[str] = []
        start = 0
        while start < len(offsets):
            best: str | None = None
            best_end = start
            low = start + 1
            high = min(start + MAX_RETRIEVAL_TOKENS, len(offsets))
            while low <= high:
                end = (low + high) // 2
                candidate = text[offsets[start][0] : offsets[end - 1][1]]
                if self._fits(title, candidate):
                    best, best_end = candidate, end
                    low = end + 1
                else:
                    high = end - 1
            if best is None:
                raise PdfBuildError(failure)
            output.append(best)
            start = best_end
        return tuple(output)

    def _split_table(self, title: str, text: str) -> tuple[str, ...]:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        if len(lines) < 3:
            if not self._fits(title, text):
                raise PdfBuildError("PDF_TABLE_ROW_TOO_LARGE")
            return (text,)
        header, separator, *rows = lines
        output: list[str] = []
        current: list[str] = []
        for row in rows:
            one_row = "\n".join((header, separator, row))
            if not self._fits(title, one_row):
                raise PdfBuildError("PDF_TABLE_ROW_TOO_LARGE")
            candidate = "\n".join((header, separator, *current, row))
            if current and not self._fits(title, candidate):
                output.append("\n".join((header, separator, *current)))
                current = [row]
            else:
                current.append(row)
        if current:
            output.append("\n".join((header, separator, *current)))
        return tuple(output)

    def _fits(self, title: str, text: str) -> bool:
        return len(text) <= MAX_CHARS and self._token_budget.fits(
            render_retrieval_text((title,), text)
        )


def _identity(path: Path) -> PdfLightweightIdentity:
    info = path.stat()
    return PdfLightweightIdentity(
        size=info.st_size,
        mtime_ns=info.st_mtime_ns,
        device=info.st_dev or None,
        inode=info.st_ino or None,
    )


def _normalize_content(value: str) -> str:
    return unicodedata.normalize("NFC", value).replace("\r\n", "\n").replace("\r", "\n").strip()


def _sentence_pieces(text: str) -> tuple[str, ...]:
    pieces: list[str] = []
    start = 0
    for match in _SENTENCE_BOUNDARY.finditer(text):
        piece = text[start : match.start()].strip()
        if piece:
            pieces.append(piece)
        start = match.end()
    final = text[start:].strip()
    if final:
        pieces.append(final)
    return tuple(pieces)
