from __future__ import annotations

import asyncio
import unittest

from app.database import SearchCandidate
from app.reranker import stable_sigmoid
from app.retrieval import (
    SearchCapacityLimiter,
    SearchValidationError,
    fuse_candidates,
    normalize_filters,
    normalize_source_types,
    render_citation,
    render_pdf_citation,
)


def candidate(identifier: str, *, dense: float | None = None, fts: float | None = None) -> SearchCandidate:
    return SearchCandidate(
        id=identifier,
        source_path="01. Knowledge/Data/a.md",
        title="A [title]",
        primary_topic="Data",
        tags=("data",),
        heading_path=("Heading",),
        text="text",
        line_start=2,
        line_end=3,
        indexed_by_run_id="00000000-0000-0000-0000-000000000001",
        dense_distance=dense,
        fts_score=fts,
    )


class RetrievalTests(unittest.IsolatedAsyncioTestCase):
    async def test_capacity_is_immediate_and_release_is_idempotent(self) -> None:
        limiter = SearchCapacityLimiter(2)
        first, second = await limiter.try_acquire(), await limiter.try_acquire()
        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertIsNone(await limiter.try_acquire())
        await first.release()
        await first.release()
        self.assertIsNotNone(await limiter.try_acquire())
        await second.release()

    async def test_cancellation_style_finally_releases_capacity(self) -> None:
        limiter = SearchCapacityLimiter(1)
        lease = await limiter.try_acquire()
        self.assertIsNotNone(lease)
        try:
            raise asyncio.CancelledError
        except asyncio.CancelledError:
            pass
        finally:
            await lease.release()
        self.assertIsNotNone(await limiter.try_acquire())

    def test_rrf_deduplicates_and_uses_defined_tie_breaks(self) -> None:
        fused = fuse_candidates(
            [candidate("b", dense=0.1), candidate("a", dense=0.1)],
            [candidate("a", fts=0.5), candidate("c", fts=0.5)],
        )
        self.assertEqual([item.candidate.id for item in fused], ["a", "b", "c"])
        self.assertEqual(fused[0].best_branch_rank, 1)
        self.assertEqual(fused[0].candidate.fts_score, 0.5)

    def test_rrf_uses_first_rank_and_caps_each_branch_at_40(self) -> None:
        dense = [candidate(f"dense-{index}", dense=float(index)) for index in range(41)]
        dense.insert(1, dense[0])
        fused = fuse_candidates(dense, [])
        identifiers = [item.candidate.id for item in fused]
        self.assertEqual(identifiers.count("dense-0"), 1)
        self.assertNotIn("dense-39", identifiers)
        self.assertNotIn("dense-40", identifiers)
        self.assertEqual(fused[0].dense_rank, 1)

    def test_filters_are_literal_and_citation_is_safe(self) -> None:
        filters = normalize_filters("Data", ["#Tag", "tag"], "foo\\bar%_ Unicode")
        self.assertEqual(filters.tags_all, ("tag",))
        self.assertEqual(filters.path_prefix, "foo/bar%_ Unicode")
        self.assertEqual(
            render_citation("A [title]", "01. Knowledge/50%_#\\.md", 2, 3),
            "[A \\[title\\]](<01.%20Knowledge/50%25_%23%5C.md>) (lines 2-3)",
        )
        with self.assertRaises(SearchValidationError):
            normalize_filters("Data", [], "foo/../bar")

    def test_source_types_and_pdf_citation_are_canonical(self) -> None:
        self.assertEqual(normalize_source_types(None), ("MARKDOWN", "PDF"))
        self.assertEqual(normalize_source_types(["PDF", "PDF"]), ("PDF",))
        self.assertEqual(normalize_source_types(["PDF", "MARKDOWN"]), ("MARKDOWN", "PDF"))
        with self.assertRaises(SearchValidationError):
            normalize_source_types([])
        with self.assertRaises(SearchValidationError):
            normalize_source_types(["UNKNOWN"])
        self.assertEqual(
            render_pdf_citation("A [title]", "02. Books/My #1 (đ).pdf", 3, 4),
            "[A \\[title\\]](<02.%20Books/My%20%231%20%28%C4%91%29.pdf#page=3>) (pages 3-4)",
        )

    def test_a_citation_never_states_a_location_the_row_does_not_have(self) -> None:
        # The only reachable NULL line pair is a PDF row whose page pair is also
        # NULL: markdown ingestion always writes integers
        # (`markdown_adapter.py:505`/`:542`), `001_initial.sql:124-125` permits the
        # NULL pair, and `main.py:443-447` falls through to `render_citation` when a
        # PDF row arrives without pages. This is the row shape that used to render
        # "(lines None-None)" -- a location in an owner-facing citation that no
        # record holds.
        self.assertEqual(
            render_citation("My Book", "02. Books/My Book.pdf", None, None),
            "[My Book](<02.%20Books/My%20Book.pdf>)",
        )
        # Half a pair is the same fabrication and must not print one number.
        self.assertEqual(
            render_citation("My Book", "02. Books/My Book.pdf", 4, None),
            "[My Book](<02.%20Books/My%20Book.pdf>)",
        )
        # The present case keeps the pinned format.
        self.assertEqual(
            render_citation("My Book", "02. Books/My Book.pdf", 4, 7),
            "[My Book](<02.%20Books/My%20Book.pdf>) (lines 4-7)",
        )

    def test_sigmoid_is_finite_at_extremes(self) -> None:
        self.assertGreater(stable_sigmoid(1000), 0.999)
        self.assertLess(stable_sigmoid(-1000), 0.001)
