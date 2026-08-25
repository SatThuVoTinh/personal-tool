from __future__ import annotations

import unittest
from pathlib import Path


class PdfMigrationContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sql = (Path(__file__).resolve().parents[1] / "migrations" / "002_pdf_ingestion_foundation.sql").read_text(encoding="utf-8")

    def test_only_the_approved_additive_tables_are_created(self) -> None:
        for table in (
            "pdf_content_builds",
            "pdf_content_batches",
            "pdf_content_segments",
            "pdf_source_details",
            "index_run_source_counts",
        ):
            self.assertIn(f"CREATE TABLE knowledge.{table}", self.sql)
        self.assertEqual(self.sql.count("CREATE TABLE knowledge."), 5)
        self.assertNotIn("ALTER TABLE knowledge.sources", self.sql)
        self.assertNotIn("IF NOT EXISTS", self.sql)

    def test_content_build_and_batch_state_constraints_are_present(self) -> None:
        self.assertIn("status IN ('BUILDING', 'READY', 'FAILED', 'CANCELLED')", self.sql)
        self.assertIn("status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')", self.sql)
        self.assertIn("knowledge_pdf_content_builds_one_building_idx", self.sql)
        self.assertIn("WHERE status IN ('BUILDING', 'READY')", self.sql)
        self.assertIn("knowledge_pdf_content_builds_one_ready_idx", self.sql)
        self.assertIn("FOREIGN KEY (batch_id, build_id)", self.sql)
        self.assertIn("REFERENCES knowledge.pdf_content_batches(id, build_id)", self.sql)
        self.assertIn("build_status text NOT NULL DEFAULT 'READY'", self.sql)
        self.assertIn("FOREIGN KEY (build_id, build_status)", self.sql)
        self.assertIn("REFERENCES knowledge.pdf_content_builds(id, status)", self.sql)

    def test_failed_identity_can_retry_without_an_unconditional_unique_constraint(self) -> None:
        self.assertIn(
            "ON knowledge.pdf_content_builds (content_identity_digest)\n  WHERE status IN ('BUILDING', 'READY')",
            self.sql,
        )
        self.assertNotIn("UNIQUE (content_identity_digest)", self.sql)

    def test_index_run_source_counts_is_relational_not_json(self) -> None:
        self.assertIn("PRIMARY KEY (index_run_id, source_type)", self.sql)
        self.assertIn("source_type IN ('MARKDOWN', 'PDF')", self.sql)
        self.assertNotIn("source_counts json", self.sql)


if __name__ == "__main__":
    unittest.main()
