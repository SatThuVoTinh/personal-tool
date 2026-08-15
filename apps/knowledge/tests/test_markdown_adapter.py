from __future__ import annotations

import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from app.markdown_adapter import (
    MAX_CHARS,
    MAX_RETRIEVAL_TOKENS,
    PAIR_MAX_TOKENS,
    PAIR_SPECIAL_TOKENS_EXPECTED,
    QUERY_BUDGET_FIXTURE,
    QUERY_MAX_TOKENS,
    TOPIC_TAGS,
    MarkdownVaultScanner,
    TokenBudget,
)


TOKENIZER_PATH = Path(os.environ["KNOWLEDGE_TOKENIZER_PATH"])


class MarkdownAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.budget = TokenBudget(TOKENIZER_PATH)
        cls.scanner = MarkdownVaultScanner(cls.budget)

    def make_vault(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        temporary = tempfile.TemporaryDirectory()
        vault = Path(temporary.name)
        (vault / "01. Knowledge").mkdir()
        return temporary, vault

    @staticmethod
    def write_note(vault: Path, topic: str, name: str, content: str) -> Path:
        folder = vault / "01. Knowledge" / topic
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / name
        path.write_text(content, encoding="utf-8", newline="")
        return path

    def test_all_canonical_topics_are_derived_from_native_tags(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        for index, (topic, tag) in enumerate(TOPIC_TAGS, start=1):
            folder = f"{index}. Personal Collection"
            self.write_note(vault, folder, f"note-{index}.md", f"# {topic}\n\nBody.\n\n{tag}\n")

        result = self.scanner.scan_vault(vault)

        self.assertTrue(result.succeeded)
        self.assertEqual(result.discovered_count, 13)
        self.assertEqual(result.valid_source_count, 13)
        self.assertEqual(
            {source.primary_topic for source in result.sources},
            {topic for topic, _ in TOPIC_TAGS},
        )

    def test_first_canonical_tag_is_primary_and_folder_is_organizational(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "2. Data/SQL",
            "window-functions.md",
            "# Window functions\n\nBody.\n\n#supplychain #data #sql\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertTrue(result.succeeded)
        self.assertEqual(result.sources[0].primary_topic, "Supply Chain")
        self.assertEqual(result.sources[0].canonical_topics, ("Supply Chain", "Data"))
        self.assertEqual(
            result.sources[0].source_path,
            "01. Knowledge/2. Data/SQL/window-functions.md",
        )

    def test_cloud_placeholder_tags_are_not_treated_as_link_targets(self) -> None:
        for reparse_tag in (0x9000001A, 0x9000601A, 0x9000F01A):
            with self.subTest(reparse_tag=hex(reparse_tag)):
                self.assertTrue(
                    self.scanner._is_cloud_placeholder(
                        SimpleNamespace(st_reparse_tag=reparse_tag)
                    )
                )
        self.assertFalse(
            self.scanner._is_cloud_placeholder(
                SimpleNamespace(st_reparse_tag=0xA000000C)
            )
        )

    def test_scan_does_not_publish_partial_sources(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        for index in range(98):
            self.write_note(
                vault,
                "AI",
                f"valid-{index:03d}.md",
                f"# Valid {index}\n\nContent {index}.\n\n#ai\n",
            )
        self.write_note(vault, "AI", "missing-tag.md", "# Missing\n\nContent.\n")
        self.write_note(vault, "3PL", "tagged.md", "# Tagged\n\nContent.\n\n#data\n")

        result = self.scanner.scan_vault(vault)

        self.assertFalse(result.succeeded)
        self.assertEqual(result.discovered_count, 100)
        self.assertEqual(result.valid_source_count, 99)
        self.assertEqual(result.sources, ())
        self.assertEqual(
            [(error.source_path, error.code) for error in result.errors],
            [
                (
                    "01. Knowledge/AI/missing-tag.md",
                    "REQUIRED_TOPIC_TAG_MISSING",
                ),
            ],
        )

    def test_lifecycle_mode_returns_valid_sources_without_marking_scan_successful(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(vault, "AI", "valid.md", "# Valid\n\nContent.\n\n#ai\n")
        self.write_note(vault, "AI", "invalid.md", "# Invalid\n\nContent.\n")

        result = self.scanner.scan_vault(
            vault, include_valid_sources_on_error=True
        )

        self.assertFalse(result.succeeded)
        self.assertEqual(result.discovered_count, 2)
        self.assertEqual(result.valid_source_count, 1)
        self.assertEqual(
            [source.source_path for source in result.sources],
            ["01. Knowledge/AI/valid.md"],
        )

    def test_structural_short_circuit_preserves_error_precedence(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        invalid = vault / "01. Knowledge" / "4PL" / "invalid.md"
        invalid.parent.mkdir(parents=True)
        invalid.write_bytes(b"\xff")

        result = self.scanner.scan_vault(vault)

        self.assertEqual(
            [(error.source_path, error.code) for error in result.errors],
            [("01. Knowledge/4PL/invalid.md", "INVALID_UTF8")],
        )

    def test_required_tag_uses_raw_lowercase_lexeme(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "Machine Learning",
            "case.md",
            "# Case\n\nBody.\n\n#MachineLearning\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertEqual(
            [error.code for error in result.errors],
            ["REQUIRED_TOPIC_TAG_MISSING"],
        )

    def test_metadata_tags_are_nfc_casefolded_deduplicated_and_sorted(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "AI",
            "tags.md",
            "# Tags\n\nBody.\n\n#ai #CAFÉ #cafe\u0301 #zeta\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertTrue(result.succeeded)
        self.assertEqual(result.sources[0].tags, ("ai", "café", "zeta"))

    def test_tag_lexer_rejects_false_positives(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "Machine Learning",
            "lexical.md",
            """# `#machinelearning`

`#machinelearning` ``#machinelearning ` embedded``
\\#machinelearning
https://example.com/#machinelearning
<!--
#machinelearning
## Fake heading
-->
~~~text
#machinelearning
## Fake heading
~~~
Body.
""",
        )

        result = self.scanner.scan_vault(vault)

        self.assertEqual(
            [error.code for error in result.errors],
            ["REQUIRED_TOPIC_TAG_MISSING"],
        )

    def test_inline_code_requires_matching_backtick_run_length(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "AI",
            "inline-runs.md",
            "# Inline runs\n\nBody.\n\n#ai ``#hidden``` still-code`` #visible\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertTrue(result.succeeded)
        self.assertEqual(result.sources[0].tags, ("ai", "visible"))

    def test_frontmatter_must_close_and_parse_to_mapping(self) -> None:
        for content in (
            "---\ntags: [ai]\n# Heading\n",
            "---\ntags: [ai\n---\n# Heading\n",
            "---\n- item\n---\n# Heading\n",
        ):
            with self.subTest(content=content):
                temporary, vault = self.make_vault()
                self.addCleanup(temporary.cleanup)
                self.write_note(vault, "AI", "bad.md", content)
                result = self.scanner.scan_vault(vault)
                self.assertEqual(
                    [error.code for error in result.errors],
                    ["MALFORMED_FRONTMATTER"],
                )

    def test_headings_fences_metadata_and_lines_are_deterministic(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        path = self.write_note(
            vault,
            "01. AI",
            "coordinates.md",
            "\ufeff---\r\ntags: [ignored]\r\n---\r\n# **Knowledge** ###\r\n\r\n"
            "Forecasting\r\n-----------\r\n\r\nFirst paragraph.\r\n\r\n````python\r\n"
            "## Not a heading\r\n```\r\n````\r\n\r\n#ai\r\n",
        )
        raw = path.read_bytes()

        result = self.scanner.scan_vault(vault)

        self.assertTrue(result.succeeded)
        source = result.sources[0]
        self.assertEqual(source.sha256, hashlib.sha256(raw).hexdigest())
        self.assertEqual(source.title, "**Knowledge**")
        self.assertEqual(source.mime_type, "text/markdown")
        self.assertEqual(source.tags, ("ai",))
        self.assertEqual(source.segments[0].heading_path, ("**Knowledge**", "Forecasting"))
        self.assertEqual((source.segments[0].line_start, source.segments[0].line_end), (9, 9))
        self.assertEqual(source.segments[1].heading_text, "Forecasting")
        self.assertEqual((source.segments[1].line_start, source.segments[1].line_end), (11, 14))

    def test_unclosed_fence_extends_to_eof_and_is_not_split(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "AI",
            "unclosed.md",
            "# Fence\n\n#ai\n\n~~~python\n# not a tag\n## not a heading\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertTrue(result.succeeded)
        self.assertEqual(len(result.sources[0].segments), 1)
        self.assertIn("## not a heading", result.sources[0].segments[0].text)

    def test_backtick_in_info_string_is_not_a_commonmark_fence(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "AI",
            "invalid-fence.md",
            "# Invalid fence\n\n```bad`info\nBody.\n\n#ai\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertTrue(result.succeeded)
        self.assertNotIn("Body.", result.sources[0].segments[0].text.splitlines()[0])

    def test_oversized_fenced_block_is_rejected_by_named_hard_cap(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        block = "x" * (MAX_CHARS + 1)
        self.write_note(
            vault,
            "AI",
            "oversized.md",
            f"# Fence\n\n#ai\n\n```text\n{block}\n```\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertEqual(
            [error.code for error in result.errors],
            ["OVERSIZED_FENCED_BLOCK"],
        )

    def test_heading_context_must_leave_retrieval_budget(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        heading = " ".join(["a"] * (MAX_RETRIEVAL_TOKENS + 1))
        self.write_note(
            vault,
            "AI",
            "heading.md",
            f"# {heading}\n\nBody.\n\n#ai\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertEqual(
            [error.code for error in result.errors],
            ["HEADING_CONTEXT_TOO_LARGE"],
        )

    def test_soft_target_is_not_a_hard_limit(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        paragraph = "a " * 800
        self.write_note(vault, "AI", "soft.md", f"# Soft\n\n{paragraph}\n\n#ai\n")

        result = self.scanner.scan_vault(vault)

        self.assertTrue(result.succeeded)
        segment = result.sources[0].segments[0]
        self.assertGreater(len(segment.text), 1500)
        self.assertLessEqual(len(segment.text), MAX_CHARS)

    def test_unbroken_prose_falls_back_to_tokenizer_offsets(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        self.write_note(
            vault,
            "AI",
            "unbroken.md",
            "# Unbroken\n\n#ai\n\n" + ("x" * 6000) + "\n",
        )

        result = self.scanner.scan_vault(vault)

        self.assertTrue(result.succeeded)
        self.assertGreater(len(result.sources[0].segments), 1)
        for segment in result.sources[0].segments:
            self.assertLessEqual(len(segment.text), MAX_CHARS)
            self.assertLessEqual(segment.retrieval_token_count, MAX_RETRIEVAL_TOKENS)
            self.assertLessEqual(
                self.budget.pair_count(segment.retrieval_text),
                PAIR_MAX_TOKENS,
            )

    def test_pair_budget_uses_real_pair_encoding_without_truncation(self) -> None:
        self.assertEqual(self.budget.count(QUERY_BUDGET_FIXTURE), QUERY_MAX_TOKENS)
        retrieval = " ".join(["a"] * MAX_RETRIEVAL_TOKENS)
        self.assertEqual(self.budget.count(retrieval), MAX_RETRIEVAL_TOKENS)
        self.assertEqual(self.budget.pair_count(retrieval), PAIR_MAX_TOKENS)
        oversized = f"{retrieval} a"
        self.assertEqual(self.budget.count(oversized), MAX_RETRIEVAL_TOKENS + 1)
        self.assertGreater(self.budget.pair_count(oversized), PAIR_MAX_TOKENS)

    def test_765_token_prose_is_segmented_before_pair_encoding(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        prose = " ".join(["a"] * (MAX_RETRIEVAL_TOKENS + 1))
        self.write_note(vault, "AI", "pair-split.md", f"# Pair split\n\n{prose}\n\n#ai\n")

        result = self.scanner.scan_vault(vault)

        self.assertTrue(result.succeeded)
        self.assertGreater(len(result.sources[0].segments), 1)
        for segment in result.sources[0].segments:
            self.assertLessEqual(
                self.budget.pair_count(segment.retrieval_text),
                PAIR_MAX_TOKENS,
            )

    def test_tokenizer_sha_mismatch_fails_initialization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mismatched = Path(directory) / "tokenizer.json"
            mismatched.write_bytes(TOKENIZER_PATH.read_bytes() + b"\n")
            with self.assertRaisesRegex(RuntimeError, "TOKENIZER_ARTIFACT_MISMATCH"):
                TokenBudget(mismatched)

    def test_golden_multilingual_token_counts(self) -> None:
        fixtures = {
            "Knowledge retrieval is deterministic.": 8,
            "Truy xuất tri thức phải nhất quán.": 9,
            "知识检索必须保持一致。": 8,
        }
        self.assertEqual(
            {text: self.budget.count(text) for text in fixtures},
            fixtures,
        )

    @unittest.skipUnless(hasattr(os, "symlink"), "symbolic links are unavailable")
    def test_symbolic_link_source_is_rejected_when_runtime_exposes_it(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        target = self.write_note(vault, "AI", "target.md", "# Target\n\nBody.\n\n#ai\n")
        link = target.with_name("linked.md")
        try:
            link.symlink_to(target)
        except OSError as error:
            self.skipTest(f"symbolic links cannot be created: {error}")

        result = self.scanner.scan_vault(vault)

        self.assertFalse(result.succeeded)
        self.assertIn("SOURCE_LINK_NOT_ALLOWED", [error.code for error in result.errors])

    def test_candidate_outside_vault_is_rejected(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        with tempfile.TemporaryDirectory() as outside_directory:
            outside = Path(outside_directory) / "outside.md"
            outside.write_text("# Outside\n\nBody.\n\n#ai\n", encoding="utf-8")

            source, errors = self.scanner._validate_source(
                vault.resolve(),
                (vault / "01. Knowledge").resolve(),
                outside,
            )

        self.assertIsNone(source)
        self.assertEqual([error.code for error in errors], ["SOURCE_PATH_OUTSIDE_VAULT"])

    @unittest.skipUnless(hasattr(os, "symlink"), "symbolic links are unavailable")
    def test_symbolic_link_directory_is_rejected_without_traversal(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        external = Path(temporary.name) / "external"
        external.mkdir()
        (external / "linked.md").write_text(
            "# Linked\n\nBody.\n\n#ai\n", encoding="utf-8"
        )
        link = vault / "01. Knowledge" / "AI"
        try:
            link.symlink_to(external, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"symbolic links cannot be created: {error}")

        result = self.scanner.scan_vault(vault)

        self.assertFalse(result.succeeded)
        self.assertEqual(result.discovered_count, 0)
        self.assertEqual(
            [(error.source_path, error.code) for error in result.errors],
            [("01. Knowledge/AI", "SOURCE_LINK_NOT_ALLOWED")],
        )


if __name__ == "__main__":
    unittest.main()
