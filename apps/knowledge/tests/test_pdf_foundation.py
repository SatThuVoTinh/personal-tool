from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from app.pdf_foundation import (
    PDF_CONTENT_DOMAIN,
    PdfFoundationError,
    canonical_json_bytes,
    content_identity_digest,
    discover_pdf_sidecars,
    parse_pdf_sidecar,
    processing_identity_digest,
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
            PDF_CONTENT_DOMAIN
            + (32).to_bytes(4, "big")
            + bytes.fromhex(pdf)
            + (32).to_bytes(4, "big")
            + bytes.fromhex(sidecar)
            + (32).to_bytes(4, "big")
            + bytes.fromhex(processing)
        ).hexdigest()
        self.assertEqual(content_identity_digest(pdf, sidecar, processing), expected)
        self.assertNotEqual(content_identity_digest(pdf, sidecar, processing), content_identity_digest(pdf, sidecar, "44" * 32))

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

    def test_discovery_fails_closed_for_malformed_embed_driven_sidecar(self) -> None:
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
        with self.assertRaisesRegex(PdfFoundationError, "PDF_SIDECAR_EMBED_INVALID"):
            discover_pdf_sidecars(vault)

    def test_sidecar_rejects_alias_fragment_and_path_escape(self) -> None:
        temporary, vault = self.make_vault()
        self.addCleanup(temporary.cleanup)
        (vault / "02. Books" / "supply" / "book.pdf").write_bytes(b"%PDF-test")
        for index, target in enumerate(("02. Books/supply/book.pdf|alias", "02. Books/supply/book.pdf#page=2", "../book.pdf")):
            path = self.write_sidecar(vault, f"bad-{index}.md", target)
            with self.assertRaisesRegex(PdfFoundationError, "PDF_SIDECAR_EMBED_INVALID|PDF_SOURCE_PATH_INVALID"):
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
