from __future__ import annotations

import re
import unittest
from pathlib import Path


def _statements(sql: str) -> list[str]:
    """The migration's statements, with whitespace normalised.

    F-218: the assertion must be about the migration's SHAPE, not about the
    exact characters of its text. A comment reword, a re-indent or a line
    break used to turn this suite red while nothing behavioural changed — and
    a rewording that moved a constraint out of the statement that carries it
    used to leave it green.
    """
    without_comments = re.sub(r"--[^\n]*", "", sql)
    parts = [part.strip() for part in without_comments.split(";")]
    return [re.sub(r"\s+", " ", part) for part in parts if part]


class PdfMigrationContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sql = (Path(__file__).resolve().parents[1] / "migrations" / "002_pdf_ingestion_foundation.sql").read_text(encoding="utf8")
        self.statements = _statements(self.sql)
        self.normalised = " ; ".join(self.statements)

    def test_only_the_approved_additive_tables_are_created(self) -> None:
        created = [
            statement
            for statement in self.statements
            if statement.upper().startswith("CREATE TABLE KNOWLEDGE.")
        ]
        for table in (
            "pdf_content_builds",
            "pdf_content_batches",
            "pdf_content_segments",
            "pdf_source_details",
            "index_run_source_counts",
        ):
            self.assertTrue(
                any(f"knowledge.{table}" in statement for statement in created),
                f"the migration does not create knowledge.{table}",
            )
        self.assertEqual(len(created), 5)
        self.assertFalse(
            any(
                statement.upper().startswith("ALTER TABLE knowledge.sources")
                for statement in self.statements
            ),
            "the migration alters knowledge.sources, which is not additive",
        )
        self.assertNotIn("IF NOT EXISTS", self.normalised)

    def test_content_build_and_batch_state_constraints_are_present(self) -> None:
        for fragment in (
            "status IN ('BUILDING', 'READY', 'FAILED', 'CANCELLED')",
            "status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')",
            "knowledge_pdf_content_builds_one_building_idx",
            "WHERE status IN ('BUILDING', 'READY')",
            "knowledge_pdf_content_builds_one_ready_idx",
            "FOREIGN KEY (batch_id, build_id)",
            "REFERENCES knowledge.pdf_content_batches(id, build_id)",
            "build_status text NOT NULL DEFAULT 'READY'",
            "FOREIGN KEY (build_id, build_status)",
            "REFERENCES knowledge.pdf_content_builds(id, status)",
        ):
            self.assertIn(fragment, self.normalised)

    def test_failed_identity_can_retry_without_an_unconditional_unique_constraint(self) -> None:
        self.assertIn(
            "ON knowledge.pdf_content_builds (content_identity_digest) "
            "WHERE status IN ('BUILDING', 'READY')",
            self.normalised,
        )
        self.assertNotIn("UNIQUE (content_identity_digest)", self.normalised)

    def test_index_run_source_counts_is_relational_not_json(self) -> None:
        self.assertIn("PRIMARY KEY (index_run_id, source_type)", self.normalised)
        self.assertIn("source_type IN ('MARKDOWN', 'PDF')", self.normalised)
        self.assertNotIn("source_counts json", self.normalised)


if __name__ == "__main__":
    unittest.main()
