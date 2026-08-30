from __future__ import annotations

import asyncio
from dataclasses import replace
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from app.database import (
    KnowledgeDatabase,
    PdfContentBatch,
    PdfContentBatchState,
    PdfContentBuild,
    PdfContentBuildState,
    StateTransitionError,
)
from app.pdf_foundation import PdfSidecar, content_identity_digest, sha256_file
from app.pdf_pipeline import PdfBuildError, PdfContentBuilder, _sentence_pieces
from app.pdf_runtime import PdfRuntimeError


class _Budget:
    """Small deterministic stand-in; production always uses M3 TokenBudget."""

    def __init__(self, maximum: int) -> None:
        self.maximum = maximum
        self.fit_calls = 0

    def fits(self, text: str) -> bool:
        self.fit_calls += 1
        return len(text) <= self.maximum

    def count(self, text: str) -> int:
        return len(text)

    def offsets(self, text: str) -> tuple[tuple[int, int], ...]:
        return tuple((index, index + 1) for index in range(len(text)))


class PdfSegmentationTests(unittest.TestCase):
    def builder(self, maximum: int = 40) -> PdfContentBuilder:
        instance = object.__new__(PdfContentBuilder)
        instance._token_budget = _Budget(maximum)
        return instance

    @staticmethod
    def batch() -> PdfContentBatch:
        return PdfContentBatch("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", 1, 4)

    def test_sentence_boundary_matches_m3_and_chinese_falls_to_token_offsets(self) -> None:
        self.assertEqual(_sentence_pieces("Một câu. Câu hai。"), ("Một câu.", "Câu hai。"))
        segments = self.builder(14)._segment_batch(
            "T",
            [{
                "kind": "text", "ordinal": 0, "content": "这是一个没有空格的句子用于切分", "page_start": 1,
                "page_end": 1, "bbox": [0.1, 0.1, 0.2, 0.2],
            }],
            self.batch(),
        )
        self.assertGreater(len(segments), 1)
        self.assertTrue(all(segment.bbox is None for segment in segments))

    def test_bbox_is_preserved_only_for_exact_unsplit_item(self) -> None:
        single = self.builder()._segment_batch(
            "T",
            [{
                "kind": "text", "ordinal": 3, "content": "short", "page_start": 1,
                "page_end": 1, "bbox": [0.1, 0.1, 0.2, 0.2],
            }],
            self.batch(),
        )
        self.assertEqual(single[0].bbox, (0.1, 0.1, 0.2, 0.2))
        split = self.builder(16)._segment_batch(
            "T",
            [{
                "kind": "text", "ordinal": 4, "content": "one two three four five six", "page_start": 1,
                "page_end": 1, "bbox": [0.1, 0.1, 0.2, 0.2],
            }],
            self.batch(),
        )
        self.assertGreater(len(split), 1)
        self.assertTrue(all(segment.bbox is None for segment in split))
        self.assertEqual(split, self.builder(16)._segment_batch(
            "T",
            [{
                "kind": "text", "ordinal": 4, "content": "one two three four five six", "page_start": 1,
                "page_end": 1, "bbox": [0.1, 0.1, 0.2, 0.2],
            }],
            self.batch(),
        ))

    def test_fitting_multi_sentence_item_stays_whole_with_exact_bbox(self) -> None:
        segments = self.builder(80)._segment_batch(
            "T",
            [{
                "kind": "text", "ordinal": 5,
                "content": "First sentence. Second sentence.",
                "page_start": 1, "page_end": 1,
                "bbox": [0.1, 0.1, 0.2, 0.2],
            }],
            self.batch(),
        )
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].content, "First sentence. Second sentence.")
        self.assertEqual(segments[0].bbox, (0.1, 0.1, 0.2, 0.2))

    def test_oversized_table_row_splits_without_payload_loss(self) -> None:
        builder = self.builder(52)
        context = "| A | B |\n| --- | --- |"
        row = "| a very long value with exact spacing | another long value |"
        item = {
            "kind": "table", "ordinal": 0,
            "content": f"{context}\n{row}",
            "page_start": 1, "page_end": 1,
            "bbox": [0.1, 0.1, 0.2, 0.2],
        }

        segments = builder._segment_batch("Title", [item], self.batch())

        self.assertGreater(len(segments), 1)
        self.assertEqual(segments, builder._segment_batch("Title", [item], self.batch()))
        self.assertTrue(all(segment.segment_type == "PDF_TABLE" for segment in segments))
        self.assertTrue(all(segment.page_start == segment.page_end == 1 for segment in segments))
        self.assertTrue(all(segment.bbox is None for segment in segments))
        self.assertTrue(all(builder._fits("Title", segment.content) for segment in segments))
        self.assertEqual(
            "".join(segment.content.removeprefix(f"{context}\n") for segment in segments),
            row,
        )

    def test_fitting_table_output_is_unchanged(self) -> None:
        table = "| A | B |\n| --- | --- |\n| a | b |\n| c | d |"
        self.assertEqual(self.builder(100)._split_table("Title", table), (table,))

    def test_oversized_table_context_splits_complete_table_without_loss(self) -> None:
        builder = self.builder(24)
        table = "| A | B |\n| --- | --- |\n| a very long value | b |"
        item = {
            "kind": "table", "ordinal": 0, "content": table,
            "page_start": 1, "page_end": 1, "bbox": [0.1, 0.1, 0.2, 0.2],
        }

        segments = builder._segment_batch("Title", [item], self.batch())
        pieces = tuple(segment.content for segment in segments)

        self.assertGreater(len(pieces), 1)
        self.assertEqual(segments, builder._segment_batch("Title", [item], self.batch()))
        self.assertTrue(all(segment.segment_type == "PDF_TABLE" for segment in segments))
        self.assertTrue(all(segment.page_start == segment.page_end == 1 for segment in segments))
        self.assertTrue(all(segment.bbox is None for segment in segments))
        self.assertTrue(all(builder._fits("Title", piece) for piece in pieces))
        self.assertEqual("".join(pieces), table)

    def test_oversized_short_table_splits_complete_payload_without_loss(self) -> None:
        builder = self.builder(24)
        table = "| a very long unstructured table value |\n| another long value |"

        pieces = builder._split_table("Title", table)

        self.assertGreater(len(pieces), 1)
        self.assertEqual(pieces, builder._split_table("Title", table))
        self.assertTrue(all(builder._fits("Title", piece) for piece in pieces))
        self.assertEqual("".join(pieces), table)

    def test_table_fails_when_one_source_token_cannot_fit_with_title(self) -> None:
        with self.assertRaisesRegex(PdfBuildError, "PDF_TABLE_ROW_TOO_LARGE"):
            self.builder(7)._split_table(
                "Title", "| A | B |\n| --- | --- |\n| value | b |"
            )

    def test_multi_page_item_fails_explicitly(self) -> None:
        with self.assertRaisesRegex(PdfBuildError, "PDF_MULTI_PAGE_ITEM_UNSUPPORTED"):
            self.builder()._segment_batch(
                "T",
                [{
                    "kind": "text", "ordinal": 0, "content": "bad", "page_start": 1,
                    "page_end": 2, "bbox": None,
                }],
                self.batch(),
            )

    def test_large_token_split_uses_bounded_binary_search(self) -> None:
        builder = self.builder(40)
        pieces = builder._split_prose("T", "界" * 4000)
        self.assertGreater(len(pieces), 1)
        self.assertLess(builder._token_budget.fit_calls, 2500)


class _Database:
    def __init__(self) -> None:
        self.created = False
        self.started: list[PdfContentBatch] = []
        self.completed: list[tuple[PdfContentBatch, tuple]] = []
        self.failures: list[tuple[str, str]] = []
        self.ready = False
        self.after_complete = None
        self.state: PdfContentBuildState | None = None
        self.recovered = False
        self.recovery_error = False

    async def assert_pdf_content_identity_schema(self) -> None:
        return None

    async def get_pdf_content_build_state(self, _identity):
        return self.state

    async def recover_pdf_content_build(self, state, expected_page_count):
        self.recovered = True
        if self.recovery_error:
            raise StateTransitionError("failed recovery")
        KnowledgeDatabase._validate_pdf_batch_topology(
            state.batches, expected_page_count
        )
        return replace(state, status="READY")

    async def create_pdf_content_build(self, **values):
        self.created = True
        build = PdfContentBuild(
            "00000000-0000-0000-0000-000000000010",
            values["content_identity_digest"],
        )
        batches = tuple(
            PdfContentBatch(
                f"00000000-0000-0000-0000-{start:012d}",
                build.id,
                start,
                min(start + values["batch_size"] - 1, values["page_count"]),
            )
            for start in range(1, values["page_count"] + 1, values["batch_size"])
        )
        return build, batches

    async def start_pdf_content_batch(self, batch: PdfContentBatch) -> None:
        self.started.append(batch)

    async def complete_pdf_content_batch(self, batch, segments) -> None:
        self.completed.append((batch, segments))
        if self.after_complete:
            self.after_complete()

    async def fail_pdf_content_batch_and_build(self, batch, code: str) -> None:
        self.failures.append((batch.id, code))

    async def fail_pdf_content_build(self, build, code: str) -> None:
        self.failures.append((build.id, code))

    async def complete_pdf_content_build(self, build) -> None:
        self.ready = True


class _Runtime:
    def __init__(
        self,
        page_count: int,
        *,
        failure: str | None = None,
        failure_start: int | None = None,
        empty: bool = False,
        delay: float = 0,
    ) -> None:
        self.page_count = page_count
        self.failure = failure
        self.failure_start = failure_start
        self.empty = empty
        self.delay = delay
        self.ranges: list[tuple[int, int]] = []
        self.after_extract = None

    async def preflight(self, *_args):
        return {"page_count": self.page_count}

    async def extract_range(self, _path, start, end, _identity, _deadline):
        self.ranges.append((start, end))
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.failure and (self.failure_start is None or self.failure_start == start):
            raise PdfRuntimeError(self.failure)
        if self.after_extract:
            self.after_extract()
        return {
            "items": []
            if self.empty
            else [{
                    "kind": "text",
                    "ordinal": 0,
                    "content": f"page {start}",
                    "page_start": start,
                    "page_end": start,
                    "bbox": None,
                }]
        }


class PdfBuildLifecycleTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.pdf = self.root / "book.pdf"
        self.markdown = self.root / "book.md"
        self.pdf.write_bytes(b"pdf fixture")
        self.markdown.write_text("sidecar", encoding="utf-8")
        self.sidecar = PdfSidecar(
            sidecar_path="book.md",
            source_path="book.pdf",
            title="Title",
            canonical_topics=("Logistics",),
            tags=("#logistics",),
            pdf_digest="0" * 64,
            sidecar_digest="0" * 64,
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def builder(self, database: _Database, runtime: _Runtime) -> PdfContentBuilder:
        return PdfContentBuilder(
            database=database,
            runtime=runtime,
            vault_root=self.root,
            token_budget=_Budget(200),
        )

    async def test_build_uses_fixed_four_page_ranges_and_reaches_ready(self) -> None:
        database, runtime = _Database(), _Runtime(9)
        result = await self.builder(database, runtime).build(self.sidecar, "a" * 64)
        self.assertEqual(runtime.ranges, [(1, 4), (5, 8), (9, 9)])
        self.assertEqual(result.segment_count, 3)
        self.assertTrue(database.ready)
        self.assertFalse(database.failures)

    async def test_matching_ready_build_is_reused_after_source_revalidation(self) -> None:
        database, runtime = _Database(), _Runtime(9)
        identity = "a" * 64
        database.state = PdfContentBuildState(
            build=PdfContentBuild("00000000-0000-0000-0000-000000000099", "b" * 64),
            pdf_digest=sha256_file(self.pdf),
            sidecar_digest=sha256_file(self.markdown),
            processing_identity_digest=identity,
            status="READY",
            batches=(
                PdfContentBatchState(
                    PdfContentBatch(
                        "00000000-0000-0000-0000-000000000098",
                        "00000000-0000-0000-0000-000000000099",
                        1,
                        4,
                    ),
                    "SUCCEEDED",
                ),
                PdfContentBatchState(
                    PdfContentBatch(
                        "00000000-0000-0000-0000-000000000097",
                        "00000000-0000-0000-0000-000000000099",
                        5,
                        8,
                    ),
                    "SUCCEEDED",
                ),
                PdfContentBatchState(
                    PdfContentBatch(
                        "00000000-0000-0000-0000-000000000096",
                        "00000000-0000-0000-0000-000000000099",
                        9,
                        9,
                    ),
                    "SUCCEEDED",
                ),
            ),
            segment_count=4,
        )

        result = await self.builder(database, runtime).build(self.sidecar, identity)

        self.assertEqual(result.build_id, database.state.build.id)
        self.assertEqual(result.segment_count, 4)
        self.assertEqual(runtime.ranges, [])
        self.assertTrue(database.recovered)

    async def test_incomplete_ready_manifest_is_rejected(self) -> None:
        database, runtime = _Database(), _Runtime(9)
        identity = "a" * 64
        database.state = PdfContentBuildState(
            build=PdfContentBuild(
                "00000000-0000-0000-0000-000000000099", "b" * 64
            ),
            pdf_digest=sha256_file(self.pdf),
            sidecar_digest=sha256_file(self.markdown),
            processing_identity_digest=identity,
            status="READY",
            batches=(
                PdfContentBatchState(
                    PdfContentBatch(
                        "00000000-0000-0000-0000-000000000098",
                        "00000000-0000-0000-0000-000000000099",
                        1,
                        4,
                    ),
                    "SUCCEEDED",
                ),
            ),
            segment_count=1,
        )

        with self.assertRaisesRegex(PdfBuildError, "PDF_RUNTIME_FAILED"):
            await self.builder(database, runtime).build(self.sidecar, identity)
        self.assertEqual(runtime.ranges, [])

    async def test_all_succeeded_build_recovers_to_ready_without_a_child(self) -> None:
        database, runtime = _Database(), _Runtime(1)
        identity = "a" * 64
        database.state = PdfContentBuildState(
            build=PdfContentBuild("00000000-0000-0000-0000-000000000099", "b" * 64),
            pdf_digest=sha256_file(self.pdf),
            sidecar_digest=sha256_file(self.markdown),
            processing_identity_digest=identity,
            status="BUILDING",
            batches=(
                PdfContentBatchState(
                    PdfContentBatch(
                        "00000000-0000-0000-0000-000000000098",
                        "00000000-0000-0000-0000-000000000099",
                        1,
                        1,
                    ),
                    "SUCCEEDED",
                ),
            ),
            segment_count=1,
        )

        result = await self.builder(database, runtime).build(self.sidecar, identity)

        self.assertEqual(result.segment_count, 1)
        self.assertTrue(database.recovered)
        self.assertEqual(runtime.ranges, [])

    async def test_failed_build_recovery_is_fail_closed(self) -> None:
        database, runtime = _Database(), _Runtime(1)
        identity = "a" * 64
        database.state = PdfContentBuildState(
            build=PdfContentBuild("00000000-0000-0000-0000-000000000099", "b" * 64),
            pdf_digest=sha256_file(self.pdf),
            sidecar_digest=sha256_file(self.markdown),
            processing_identity_digest=identity,
            status="BUILDING",
            batches=(
                PdfContentBatchState(
                    PdfContentBatch(
                        "00000000-0000-0000-0000-000000000098",
                        "00000000-0000-0000-0000-000000000099",
                        1,
                        1,
                    ),
                    "FAILED",
                ),
            ),
            segment_count=0,
        )
        database.recovery_error = True

        with self.assertRaisesRegex(PdfBuildError, "PDF_RUNTIME_FAILED"):
            await self.builder(database, runtime).build(self.sidecar, identity)
        self.assertTrue(database.recovered)
        self.assertEqual(runtime.ranges, [])

    async def test_publication_bracket_revalidates_full_content_identity(self) -> None:
        database, runtime = _Database(), _Runtime(1)
        builder = self.builder(database, runtime)
        baseline = await asyncio.to_thread(builder._initial_snapshot, self.sidecar)
        identity = content_identity_digest(baseline.pdf_digest, baseline.sidecar_digest, "a" * 64)
        self.pdf.write_bytes(b"changed fixture")

        with self.assertRaisesRegex(PdfBuildError, "PDF_SOURCE_DRIFT"):
            await builder.revalidate_identity(self.sidecar, "a" * 64, identity)

    async def test_prebuild_cumulative_timeout_creates_no_rows(self) -> None:
        database, runtime = _Database(), _Runtime(1)
        with patch("app.pdf_pipeline.BUILD_TIMEOUT_SECONDS", 0):
            with self.assertRaisesRegex(PdfBuildError, "PDF_BUILD_TIMEOUT"):
                await self.builder(database, runtime).build(self.sidecar, "a" * 64)
        self.assertFalse(database.created)

    async def test_oversized_pdf_creates_no_rows(self) -> None:
        database, runtime = _Database(), _Runtime(1)
        with patch("app.pdf_pipeline.MAX_PDF_BYTES", 1):
            with self.assertRaisesRegex(PdfBuildError, "PDF_FILE_TOO_LARGE"):
                await self.builder(database, runtime).build(self.sidecar, "a" * 64)
        self.assertFalse(database.created)
        self.assertEqual(runtime.ranges, [])

    async def test_page_limit_creates_no_rows(self) -> None:
        database, runtime = _Database(), _Runtime(2001)
        with self.assertRaisesRegex(PdfBuildError, "PDF_PAGE_LIMIT_EXCEEDED"):
            await self.builder(database, runtime).build(self.sidecar, "a" * 64)
        self.assertFalse(database.created)
        self.assertEqual(runtime.ranges, [])

    async def test_initial_hash_bracket_detects_drift_and_creates_no_rows(self) -> None:
        database, runtime = _Database(), _Runtime(1)
        changed = False

        def changing_hash(path: Path) -> str:
            nonlocal changed
            digest = sha256_file(path)
            if path == self.pdf and not changed:
                self.pdf.write_bytes(b"changed fixture")
                changed = True
            return digest

        with patch("app.pdf_pipeline.sha256_file", side_effect=changing_hash):
            with self.assertRaisesRegex(PdfBuildError, "PDF_SOURCE_DRIFT"):
                await self.builder(database, runtime).build(self.sidecar, "a" * 64)
        self.assertFalse(database.created)
        self.assertEqual(runtime.ranges, [])

    async def test_post_child_source_drift_fails_running_batch(self) -> None:
        database, runtime = _Database(), _Runtime(2)
        runtime.after_extract = lambda: self.pdf.write_bytes(b"changed")
        with self.assertRaisesRegex(PdfBuildError, "PDF_SOURCE_DRIFT"):
            await self.builder(database, runtime).build(self.sidecar, "a" * 64)
        self.assertEqual(database.failures[0][1], "PDF_SOURCE_DRIFT")
        self.assertFalse(database.ready)

    async def test_final_hash_detects_same_identity_content_drift(self) -> None:
        database, runtime = _Database(), _Runtime(1)
        original_stat = self.pdf.stat()

        def replace_after_batch() -> None:
            self.pdf.write_bytes(b"PDF fixture")
            os.utime(
                self.pdf,
                ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns),
            )

        database.after_complete = replace_after_batch
        with self.assertRaisesRegex(PdfBuildError, "PDF_SOURCE_DRIFT"):
            await self.builder(database, runtime).build(self.sidecar, "a" * 64)
        self.assertEqual(database.failures[-1][1], "PDF_SOURCE_DRIFT")
        self.assertFalse(database.ready)

    async def test_local_child_timeout_keeps_runtime_timeout_code(self) -> None:
        database, runtime = _Database(), _Runtime(1, failure="PDF_RUNTIME_TIMEOUT")
        with self.assertRaisesRegex(PdfBuildError, "PDF_RUNTIME_TIMEOUT"):
            await self.builder(database, runtime).build(self.sidecar, "a" * 64)
        self.assertEqual(database.failures[0][1], "PDF_RUNTIME_TIMEOUT")

    async def test_cumulative_timeout_after_commit_fails_running_batch_and_build(self) -> None:
        database, runtime = _Database(), _Runtime(5, delay=0.2)
        with patch("app.pdf_pipeline.BUILD_TIMEOUT_SECONDS", 0.1):
            with self.assertRaisesRegex(PdfBuildError, "PDF_BUILD_TIMEOUT"):
                await self.builder(database, runtime).build(self.sidecar, "a" * 64)
        self.assertTrue(database.created)
        self.assertEqual(runtime.ranges, [(1, 4)])
        self.assertEqual(database.failures[0][1], "PDF_BUILD_TIMEOUT")

    async def test_first_failed_batch_never_starts_later_pending_ranges(self) -> None:
        database = _Database()
        runtime = _Runtime(10, failure="PDF_RUNTIME_FAILED", failure_start=5)
        with self.assertRaisesRegex(PdfBuildError, "PDF_RUNTIME_FAILED"):
            await self.builder(database, runtime).build(self.sidecar, "a" * 64)
        self.assertEqual(runtime.ranges, [(1, 4), (5, 8)])
        self.assertEqual([(batch.page_start, batch.page_end) for batch in database.started], [(1, 4), (5, 8)])
        self.assertEqual(database.failures[0][1], "PDF_RUNTIME_FAILED")

    async def test_hashing_is_offloaded_from_the_event_loop(self) -> None:
        database, runtime = _Database(), _Runtime(1)
        builder = self.builder(database, runtime)
        original = builder._initial_snapshot

        def delayed_snapshot(sidecar):
            time.sleep(0.05)
            return original(sidecar)

        with patch.object(builder, "_initial_snapshot", side_effect=delayed_snapshot):
            task = asyncio.create_task(builder.build(self.sidecar, "a" * 64))
            await asyncio.sleep(0.01)
            self.assertFalse(task.done())
            await task

    async def test_segmentation_is_offloaded_from_the_event_loop(self) -> None:
        database, runtime = _Database(), _Runtime(1)
        builder = self.builder(database, runtime)
        original = builder._segment_batch

        def delayed_segmentation(*args):
            time.sleep(0.05)
            return original(*args)

        with patch.object(builder, "_segment_batch", side_effect=delayed_segmentation):
            task = asyncio.create_task(builder.build(self.sidecar, "a" * 64))
            await asyncio.sleep(0.01)
            self.assertFalse(task.done())
            await task

    async def test_zero_segment_build_fails_after_all_batches(self) -> None:
        database, runtime = _Database(), _Runtime(5, empty=True)
        with self.assertRaisesRegex(PdfBuildError, "PDF_NO_EXTRACTABLE_CONTENT"):
            await self.builder(database, runtime).build(self.sidecar, "a" * 64)
        self.assertEqual(runtime.ranges, [(1, 4), (5, 5)])
        self.assertEqual(database.failures[-1][1], "PDF_NO_EXTRACTABLE_CONTENT")
        self.assertFalse(database.ready)

    async def test_title_that_consumes_budget_creates_no_rows(self) -> None:
        database, runtime = _Database(), _Runtime(1)
        sidecar = PdfSidecar(
            **{**self.sidecar.__dict__, "title": "x" * 300}
        )
        with self.assertRaisesRegex(PdfBuildError, "PDF_TITLE_TOKEN_BUDGET_EXCEEDED"):
            await self.builder(database, runtime).build(sidecar, "a" * 64)
        self.assertFalse(database.created)


if __name__ == "__main__":
    unittest.main()
