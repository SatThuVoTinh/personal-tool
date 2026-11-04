from __future__ import annotations

import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.pdf_foundation import (
    MAX_PDF_BYTES,
    PDF_CONTENT_DOMAIN,
    PdfFoundationError,
    canonical_json_bytes,
    content_identity_digest,
    discover_pdf_sidecars,
    parse_pdf_sidecar,
    processing_identity_digest,
)
from app.pdf_pipeline import MAX_PDF_BYTES as BUILD_PATH_PDF_CEILING

# F-332 (R7-F2-01): the domain bytes and the digest they produce are pinned
# HERE as DATA. The suite used to import the constant from the module under
# test and rebuild the expected digest from that import, so changing the
# domain re-keyed every stored content identity -- and every READY build
# would re-extract -- while the suite stayed green. A golden digest recorded
# once is the independent pin.
EXPECTED_PDF_CONTENT_DOMAIN = b"zink:knowledge:pdf-content:v1"
GOLDEN_CONTENT_IDENTITY_DIGEST = (
    "b404b4a30e9428fbaf151f56eb8562a641ab88bf31aa24905b9d535bfd50204a"
)


class PdfFoundationTests(unittest.TestCase):
    def make_vault(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        temporary = tempfile.TemporaryDirectory()
        vault = Path(temporary.name) / "vault"
        (vault / "02. Books" / "supply").mkdir(parents=True)
        return temporary, vault

    def write_sidecar(self, vault: Path, name: str, target: str, extra: str = "") -> Path:
        path = vault / "02. Books" / "supply" / name
        path.write_text(
            "# PDF title\n\n"
            f"![[{target}]]\n\n#supplychain #english\n{extra}",
            encoding="utf-8",
        )
        return path

    def test_content_identity_uses_raw_digests_and_big_endian_lengths(self) -> None:
        pdf, sidecar, processing = ("11" * 32, "22" * 32, "33" * 32)
        expected = hashlib.sha256(
            EXPECTED_PDF_CONTENT_DOMAIN
            + (32).to_bytes(4, "big")
            + bytes.fromhex(pdf)
            + (32).to_bytes(4, "big")
            + bytes.fromhex(sidecar)
            + (32).to_bytes(4, "big")
            + bytes.fromhex(processing)
        ).hexdigest()
        self.assertEqual(content_identity_digest(pdf, sidecar, processing), expected)
        self.assertNotEqual(content_identity_digest(pdf, sidecar, processing), content_identity_digest(pdf, sidecar, "44" * 32))

    def test_the_content_identity_domain_is_pinned_as_data(self) -> None:
        """F-332 (R7-F2-01): the persisted lookup key needs an independent pin.

        The domain bytes namespace the digest that joins the persisted
        `knowledge.pdf_content_builds` rows. A change to them re-keys every
        stored identity, so the literal is asserted here as data and the
        digest it produces is asserted verbatim.
        """

        self.assertEqual(PDF_CONTENT_DOMAIN, EXPECTED_PDF_CONTENT_DOMAIN)
        self.assertEqual(
            content_identity_digest("11" * 32, "22" * 32, "33" * 32),
            GOLDEN_CONTENT_IDENTITY_DIGEST,
        )

    def test_processing_identity_is_canonical_and_rejects_float(self) -> None:
        left = {"schema_version": 1, "paths": ["artifacts/model"], "runtime": {"python": "3.13"}}
        right = {"runtime": {"python": "3.13"}, "paths": ["artifacts/model"], "schema_version": 1}
        self.assertEqual(canonical_json_bytes(left), canonical_json_bytes(right))
        self.assertEqual(processing_identity_digest(left), processing_identity_digest(right))
        with self.assertRaisesRegex(PdfFoundationError, "PDF_IDENTITY_INVALID"):
            canonical_json_bytes({"schema_version": 1, "ratio": 1.0})

    def test_sidecar_discovery_is_limited_and_duplicate_targets_fail_before_mutation(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        pdf = vault / "02. Books" / "supply" / "book.pdf"
        pdf.write_bytes(b"%PDF-test")
        self.write_sidecar(vault, "one.md", "02. Books/supply/book.pdf")
        item = discover_pdf_sidecars(vault)[0]
        self.assertEqual(item.source_path, "02. Books/supply/book.pdf")
        self.assertEqual(item.canonical_topics, ("Supply Chain", "English"))
        self.assertEqual(item.tags, ("english", "supplychain"))
        self.write_sidecar(vault, "two.md", "02. Books/supply/book.pdf")
        with self.assertRaisesRegex(PdfFoundationError, "PDF_DUPLICATE_TARGET"):
            discover_pdf_sidecars(vault)

    def test_an_oversized_pdf_is_refused_before_it_is_hashed(self) -> None:
        """F-440 (R9-L09-4): the ceiling must bound the work, not follow it."""

        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        pdf = vault / "02. Books" / "supply" / "book.pdf"
        pdf.write_bytes(b"%PDF-" + b"0" * 64)
        self.write_sidecar(vault, "one.md", "02. Books/supply/book.pdf")
        with patch("app.pdf_foundation.MAX_PDF_BYTES", 16), patch(
            "app.pdf_foundation.sha256_file",
            side_effect=AssertionError("the oversized PDF must not be hashed"),
        ):
            with self.assertRaisesRegex(PdfFoundationError, "PDF_FILE_TOO_LARGE"):
                discover_pdf_sidecars(vault)

    def test_the_discovery_ceiling_is_the_build_path_ceiling(self) -> None:
        """F-440 (R9-L09-4): one ceiling, so discovery cannot drift from it."""

        self.assertEqual(MAX_PDF_BYTES, BUILD_PATH_PDF_CEILING)

    def test_discovery_ignores_ordinary_markdown_without_visible_pdf_embed(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        ordinary = vault / "02. Books" / "supply" / "notes.md"
        ordinary.write_text(
            "---\nzink_source: pdf\n---\n\n# Reading notes\n\nNo PDF sidecar here.\n",
            encoding="utf-8",
        )
        hidden = vault / "02. Books" / "supply" / "example.md"
        hidden.write_text(
            "# Example\n\n```md\n![[02. Books/supply/book.pdf]]\n```\n",
            encoding="utf-8",
        )
        self.assertEqual(discover_pdf_sidecars(vault), ())

    def test_discovery_ignores_ambiguous_multi_pdf_markdown(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        (vault / "02. Books" / "supply" / "one.pdf").write_bytes(b"%PDF-one")
        (vault / "02. Books" / "supply" / "two.pdf").write_bytes(b"%PDF-two")
        path = vault / "02. Books" / "supply" / "bad.md"
        path.write_text(
            "# PDF title\n\n![[02. Books/supply/one.pdf]]\n"
            "![[02. Books/supply/two.pdf]]\n#english\n",
            encoding="utf-8",
        )
        self.assertEqual(discover_pdf_sidecars(vault), ())
        with self.assertRaisesRegex(PdfFoundationError, "PDF_SIDECAR_EMBED_INVALID"):
            parse_pdf_sidecar(vault, path)

    def test_missing_h1_uses_nfc_normalized_sidecar_filename(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        (vault / "02. Books" / "supply" / "book.pdf").write_bytes(b"%PDF-test")
        path = vault / "02. Books" / "supply" / "Cafe\u0301.md"
        path.write_text(
            "![[02. Books/supply/book.pdf]]\n\n#supplychain #english\n",
            encoding="utf-8",
        )
        item = discover_pdf_sidecars(vault)[0]
        self.assertEqual(item.title, "Caf\u00e9")

    def test_multiple_h1_headings_still_fail_closed(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        (vault / "02. Books" / "supply" / "book.pdf").write_bytes(b"%PDF-test")
        path = self.write_sidecar(
            vault,
            "multiple-headings.md",
            "02. Books/supply/book.pdf",
            extra="# Another title\n",
        )
        with self.assertRaisesRegex(PdfFoundationError, "PDF_SIDECAR_H1_INVALID"):
            discover_pdf_sidecars(vault)

    def test_sidecar_rejects_alias_fragment_and_path_escape(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        (vault / "02. Books" / "supply" / "book.pdf").write_bytes(b"%PDF-test")
        for index, target in enumerate(("02. Books/supply/book.pdf|alias", "02. Books/supply/book.pdf#page=2", "../book.pdf")):
            path = self.write_sidecar(vault, f"bad-{index}.md", target)
            with self.assertRaisesRegex(PdfFoundationError, "PDF_SIDECAR_EMBED_INVALID|PDF_SOURCE_PATH_INVALID"):
                parse_pdf_sidecar(vault, path)

    def test_unique_basename_embed_resolves_anywhere_inside_vault(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        (vault / "Attachments").mkdir()
        (vault / "Attachments" / "book.pdf").write_bytes(b"%PDF-test")
        path = self.write_sidecar(vault, "basename.md", "book.pdf")
        self.assertEqual(
            parse_pdf_sidecar(vault, path).source_path,
            "Attachments/book.pdf",
        )

    def test_explicit_target_outside_existing_approved_roots_still_fails(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        (vault / "Attachments").mkdir()
        (vault / "Attachments" / "book.pdf").write_bytes(b"%PDF-test")
        path = self.write_sidecar(vault, "explicit.md", "Attachments/book.pdf")
        with self.assertRaisesRegex(PdfFoundationError, "PDF_SIDECAR_EMBED_INVALID"):
            parse_pdf_sidecar(vault, path)

    def test_missing_or_ambiguous_basename_embed_fails_closed(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        (vault / "03. Papers").mkdir()
        (vault / "Archives").mkdir()
        missing = self.write_sidecar(vault, "missing.md", "missing.pdf")
        with self.assertRaisesRegex(PdfFoundationError, "PDF_SOURCE_PATH_INVALID"):
            parse_pdf_sidecar(vault, missing)
        (vault / "03. Papers" / "duplicate.pdf").write_bytes(b"%PDF-one")
        (vault / "Archives" / "duplicate.pdf").write_bytes(b"%PDF-two")
        ambiguous = self.write_sidecar(vault, "ambiguous.md", "duplicate.pdf")
        with self.assertRaisesRegex(PdfFoundationError, "PDF_SOURCE_PATH_INVALID"):
            parse_pdf_sidecar(vault, ambiguous)

    def test_pdf_named_directory_is_not_a_valid_basename_target(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        (vault / "Attachments" / "directory.pdf").mkdir(parents=True)
        path = self.write_sidecar(vault, "directory.md", "directory.pdf")
        with self.assertRaisesRegex(PdfFoundationError, "PDF_SOURCE_PATH_INVALID"):
            parse_pdf_sidecar(vault, path)

    @unittest.skipUnless(hasattr(os, "symlink"), "symbolic links are unavailable")
    def test_basename_scan_does_not_traverse_linked_directory(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        outside = Path(temporary.name) / "outside"
        outside.mkdir()
        (outside / "linked.pdf").write_bytes(b"%PDF-outside")
        try:
            os.symlink(outside, vault / "linked", target_is_directory=True)
        except OSError as error:
            # Windows requires SeCreateSymbolicLinkPrivilege for this. The
            # production rejection of linked directories is still covered by the
            # file-level link test; only the directory-link case is unrunnable.
            self.skipTest(f"directory symlinks cannot be created: {error}")
        path = self.write_sidecar(vault, "linked.md", "linked.pdf")
        with self.assertRaisesRegex(PdfFoundationError, "PDF_SOURCE_PATH_INVALID"):
            parse_pdf_sidecar(vault, path)

    def test_archives_is_allowed_only_as_target_not_discovery_root(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        (vault / "Archives").mkdir()
        (vault / "Archives" / "book.pdf").write_bytes(b"%PDF-test")
        self.write_sidecar(vault, "archived.md", "Archives/book.pdf")
        (vault / "Archives" / "undiscovered.md").write_text(
            "# ignored\n![[Archives/book.pdf]]\n#english",
            encoding="utf-8",
        )
        result = discover_pdf_sidecars(vault)
        self.assertEqual([item.sidecar_path for item in result], ["02. Books/supply/archived.md"])

    def test_non_pdf_embed_does_not_change_the_exact_pdf_embed_count(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        (vault / "02. Books" / "supply" / "book.pdf").write_bytes(b"%PDF-test")
        path = self.write_sidecar(
            vault,
            "with-cover.md",
            "02. Books/supply/book.pdf",
            extra="![[02. Books/supply/cover.png]]\n",
        )
        (vault / "02. Books" / "supply" / "cover.png").write_bytes(b"png")
        self.assertEqual(
            parse_pdf_sidecar(vault, path).source_path,
            "02. Books/supply/book.pdf",
        )

    def test_embed_and_topic_inside_code_or_comment_do_not_satisfy_contract(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        (vault / "02. Books" / "supply" / "book.pdf").write_bytes(b"%PDF-test")
        path = vault / "02. Books" / "supply" / "code-only.md"
        path.write_text(
            "# PDF title\n\n"
            "```md\n![[02. Books/supply/book.pdf]]\n#english\n```\n"
            "<!-- ![[02. Books/supply/book.pdf]] #supplychain -->\n",
            encoding="utf-8",
        )
        with self.assertRaisesRegex(PdfFoundationError, "PDF_SIDECAR_EMBED_INVALID"):
            parse_pdf_sidecar(vault, path)


if __name__ == "__main__":
    unittest.main()
