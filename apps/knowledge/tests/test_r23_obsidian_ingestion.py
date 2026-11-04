"""M10/T2-R23: regression tests for the Obsidian -> embed ingestion seam.

Two defects, both proven by execution before the fix:

1. Inline code was stripped AFTER HTML comments, so a comment opener inside a
   backtick span was consumed as a real opener and opened a comment state that
   never closed. A note whose third line was "Start `<!--` marker." lost every
   remaining line, body prose AND its topic tag, and -- because the topic tag is
   required -- took the whole index run down with it. The identical defect
   existed in pdf_foundation._visible_markdown, where it made a PDF sidecar
   render to an empty body so the book was never indexed.

2. A markdown source was read with no bound at all. MAX_CHARS bounds a segment,
   not a read, so it bounded nothing about memory; the MemoryError escaped both
   _validate_source and scan_vault and surfaced as an unattributed
   INDEXING_UNEXPECTED_FAILURE.

The comment tests are written to DISCRIMINATE, not merely to pass: each one puts
a decoy topic tag inside the comment and asserts it never reaches the output. An
earlier version of the sidecar test only asserted that discovery succeeded, which
stayed green even when comment removal was completely broken.
"""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pytest

from app.markdown_adapter import (
    MAX_MARKDOWN_SOURCE_BYTES,
    MarkdownVaultScanner,
    TokenBudget,
)
from app.pdf_foundation import _visible_markdown, discover_pdf_sidecars

_TOKENIZER = os.environ.get("KNOWLEDGE_TOKENIZER_PATH")
if not _TOKENIZER or not Path(_TOKENIZER).is_file():
    pytest.skip(
        "the pinned tokenizer is not provisioned; CI fetches it "
        "(.github/workflows/ci.yml), so this module is NOT RUN rather than passed",
        allow_module_level=True,
    )

TOKENIZER_PATH = Path(_TOKENIZER)

OPENER = "<!--"
CLOSER = "-->"

# The tag the note legitimately carries, and the decoy planted inside comments.
REAL_TAG = "#machinelearning"
DECOY_TAG = "#supplychain"


def body(source) -> str:
    """The text that would actually be embedded for a source."""
    return "\n".join(segment.text for segment in source.segments)


class R23IngestionSeamTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.budget = TokenBudget(TOKENIZER_PATH)
        cls.scanner = MarkdownVaultScanner(cls.budget)

    def make_vault(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        temporary = tempfile.TemporaryDirectory()
        vault = Path(temporary.name) / "vault"
        (vault / "01. Knowledge").mkdir(parents=True)
        (vault / "02. Books" / "supply").mkdir(parents=True)
        return temporary, vault

    @staticmethod
    def write_note(vault: Path, topic: str, name: str, content: str) -> Path:
        folder = vault / "01. Knowledge" / topic
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / name
        path.write_text(content, encoding="utf-8", newline="")
        return path

    def write_sidecar(self, vault: Path, name: str, content: str) -> None:
        (vault / "02. Books" / "supply" / name).write_text(
            content, encoding="utf-8", newline=""
        )
        (vault / "02. Books" / "supply" / "book.pdf").write_bytes(b"%PDF-test")

    # ------------------------------------------------- 1. the ordering defect

    def test_comment_opener_inside_inline_code_does_not_swallow_the_note(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "AI",
            "opener-in-code.md",
            "# Resilience Review\n\n"
            "Start `" + OPENER + "` marker.\n\n"
            "This prose paragraph should be indexed.\n\n"
            + REAL_TAG
            + "\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertEqual([error.code for error in result.errors], [])
        self.assertTrue(result.succeeded)
        self.assertEqual(result.valid_source_count, 1)
        source = result.sources[0]
        self.assertIn("This prose paragraph should be indexed.", body(source))
        self.assertEqual(source.primary_topic, "Machine Learning")

    def test_a_lone_backtick_pair_is_the_whole_difference(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "AI",
            "control.md",
            "# Resilience Review\n\nStart a marker.\n\nProse stays.\n\n"
            + REAL_TAG
            + "\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertEqual([error.code for error in result.errors], [])
        self.assertIn("Prose stays.", body(result.sources[0]))

    def test_a_decoy_tag_inside_a_real_comment_is_not_a_topic(self) -> None:
        # Discriminating: the decoy tag must never become a canonical topic, so
        # a stripper that only handles same-line open/close cannot pass this.
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "AI",
            "decoy.md",
            "# Title\n\n"
            + OPENER + " private notes\n"
            + DECOY_TAG + "\n"
            "## Fake heading\n"
            + CLOSER + "\n\n"
            "Real prose survives.\n\n"
            + REAL_TAG
            + "\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertEqual([error.code for error in result.errors], [])
        source = result.sources[0]
        self.assertEqual(source.primary_topic, "Machine Learning")
        self.assertNotIn(DECOY_TAG, source.tags)
        text = body(source)
        self.assertNotIn("private notes", text)
        self.assertNotIn("Fake heading", text)
        self.assertIn("Real prose survives.", text)

    def test_a_real_comment_on_one_line_is_still_stripped(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "AI",
            "one-line-comment.md",
            "# Title\n\n"
            "before "
            + OPENER
            + " hidden "
            + DECOY_TAG
            + " "
            + CLOSER
            + " after\n\n"
            + REAL_TAG
            + "\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertEqual([error.code for error in result.errors], [])
        source = result.sources[0]
        self.assertNotIn(DECOY_TAG, source.tags)
        text = body(source)
        self.assertNotIn("hidden", text)
        self.assertIn("before", text)
        self.assertIn("after", text)

    def test_a_fenced_block_is_still_carried_verbatim(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "AI",
            "fenced.md",
            "# Title\n\n```html\n"
            + OPENER + " not a comment " + CLOSER + "\n```\n\n"
            + REAL_TAG
            + "\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertEqual([error.code for error in result.errors], [])
        self.assertIn(OPENER + " not a comment " + CLOSER, body(result.sources[0]))

    def test_several_openers_in_one_note_still_do_not_spread(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "AI",
            "several.md",
            "# Title\n\n"
            "one `" + OPENER + "` two\n\n"
            "middle prose\n\n"
            "three `" + OPENER + "` four\n\n"
            "last prose\n\n"
            + REAL_TAG
            + "\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertEqual([error.code for error in result.errors], [])
        text = body(result.sources[0])
        self.assertIn("middle prose", text)
        self.assertIn("last prose", text)

    # ------------------------------------------- pdf sidecar: same ordering

    def test_visible_markdown_keeps_content_after_an_inline_opener(self) -> None:
        # The unit under test, directly. Everything after the opener must survive
        # and no comment state may persist.
        rendered = _visible_markdown(
            "Start `" + OPENER + "` marker.\n\n![[book.pdf]]\n\n" + REAL_TAG + "\n"
        )

        self.assertIn("![[book.pdf]]", rendered)
        self.assertIn(REAL_TAG, rendered)
        self.assertNotIn(OPENER, rendered)

    def test_visible_markdown_removes_a_multiline_comment(self) -> None:
        # Discriminating: the decoy tag sits on its own line inside the comment,
        # so a stripper that forgets to carry state across lines leaks it.
        rendered = _visible_markdown(
            "# Head\n\n"
            + OPENER + " private notes\n"
            + DECOY_TAG + "\n"
            "## Fake heading\n"
            + CLOSER + "\n\n![[book.pdf]]\n\n"
            + REAL_TAG
            + "\n"
        )

        self.assertNotIn("private notes", rendered)
        self.assertNotIn(DECOY_TAG, rendered)
        self.assertNotIn("Fake heading", rendered)
        self.assertIn("![[book.pdf]]", rendered)
        self.assertIn(REAL_TAG, rendered)

    def test_sidecar_opener_inside_inline_code_still_shows_its_embed(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_sidecar(
            vault,
            "book.md",
            "Start `" + OPENER + "` marker.\n\n![[book.pdf]]\n\n" + REAL_TAG + "\n",
        )

        result = discover_pdf_sidecars(vault)

        self.assertEqual(
            [item.source_path for item in result],
            ["02. Books/supply/book.pdf"],
            "the embed must survive an inline code comment opener",
        )
        self.assertEqual(result[0].tags, (REAL_TAG.lstrip("#"),))

    def test_sidecar_comment_decoy_tag_never_becomes_a_topic(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_sidecar(
            vault,
            "book.md",
            "# Head\n\n"
            + OPENER + " private notes\n"
            + DECOY_TAG + "\n"
            + CLOSER + "\n\n![[book.pdf]]\n\n"
            + REAL_TAG
            + "\n",
        )

        result = discover_pdf_sidecars(vault)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].tags, (REAL_TAG.lstrip("#"),))
        self.assertEqual(result[0].canonical_topics, ("Machine Learning",))

    # ----------------------------------------------------- 2. the read bound

    def test_oversized_source_is_rejected_before_it_is_read(self) -> None:
        # The ceiling is exercised by lowering it rather than writing 16 MiB, so
        # this proves the ORDER (stat before read) and the attribution, not just
        # the comparison.
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault, "AI", "too-big.md", "# Title\n\nBody.\n\n" + REAL_TAG + "\n"
        )

        real_read = Path.read_bytes
        reads: list[Path] = []

        def tracking_read(self: Path) -> bytes:
            reads.append(self)
            return real_read(self)

        with (
            mock.patch(
                "app.markdown_adapter.MAX_MARKDOWN_SOURCE_BYTES", 8, create=True
            ),
            mock.patch.object(Path, "read_bytes", tracking_read),
        ):
            result = self.scanner.scan_vault(vault)

        self.assertEqual(
            [error.code for error in result.errors],
            ["SOURCE_TOO_LARGE"],
            "an oversize source must fail with the dedicated code",
        )
        self.assertEqual(
            [error.source_path for error in result.errors],
            ["01. Knowledge/AI/too-big.md"],
            "the failure must name the offending file",
        )
        self.assertEqual(
            [p.name for p in reads],
            [],
            "the oversize source must never be read into memory",
        )

    def test_a_source_at_the_ceiling_is_still_read(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        note = "# Title\n\nBody.\n\n" + REAL_TAG + "\n"
        self.write_note(vault, "AI", "at-limit.md", note)

        with mock.patch(
            "app.markdown_adapter.MAX_MARKDOWN_SOURCE_BYTES",
            len(note.encode("utf-8")),
            create=True,
        ):
            result = self.scanner.scan_vault(vault)

        self.assertEqual([error.code for error in result.errors], [])
        self.assertEqual(result.valid_source_count, 1)

    def test_the_ceiling_is_a_memory_bound_not_a_segment_bound(self) -> None:
        # Guards against someone answering a future size complaint by reusing
        # MAX_CHARS, which bounds a segment and not a read.
        self.assertGreater(MAX_MARKDOWN_SOURCE_BYTES, 1024 * 1024)
        self.assertNotEqual(MAX_MARKDOWN_SOURCE_BYTES, 2000)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()