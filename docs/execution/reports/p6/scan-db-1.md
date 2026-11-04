# Database Audit Recheck Report (db-1) — schema, migrations, docker contracts

**Slice ID:** db-1
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-DB-001** | Restore gate certifies an archive without segment data | **FIXED (committed)** | `knowledge-t5-live.ps1:288-331` segment verification (commit `35c0192`) |
| **F-INFRA-004** (cross-boundary) | T5 drivers reject the shipped migration set | **FIXED** | 3 drivers accept `001/002/004/005` (`a9ddced`) |
| **F-576** | Non-NFC path prefix filter | **OPEN** (deferred by owner) | Register row |
| **F-493** | pdf-runtime contract tests executed by nothing | **OPEN** (carried, test-only) | Register row |

## 2. Detailed Findings Recheck

### F-DB-001 — restore digest/verification covers segments
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** the live restore verification now requires `segments` in the expected table set for the 001-era schema and extends the required/critical table lists with the PDF segment family (`pdf_content_builds`, `pdf_content_batches`, `pdf_content_segments`, `pdf_source_details`, `index_run_source_counts`) whenever `002_pdf_ingestion_foundation.sql` shipped (`knowledge-t5-live.ps1:288-331`); the digest/verification no longer certifies a segment-less archive.
- **Test Evidence:** `m3-t5-contract` 8/8 PASS in the loop-2 W0/W1 rerun (`tests.md:11`); the Docker/PostgreSQL lane is `NOT RUN` (`tests.md:13`) so the live-restore execution is pending.

### F-INFRA-004 — driver migration expectations
- **Verdict:** FIXED (cross-boundary evidence, verified at HEAD)
- **Evidence:** all three drivers (`knowledge-t5.ps1:178,244`, `knowledge-t5-live.ps1:451,474`, `knowledge-t5-common.ps1:355`) accept the full shipped set `001/002/004/005`; loop-2 commit `a9ddced`.
- **Test Evidence:** `m3-t5-contract` 8/8 + parse errors = 0 (loop-2 `tests.md:11` and `a9ddced`).

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** Live restore execution still requires the Docker/PostgreSQL lane (`NOT RUN`); register rows for `F-DB-001`/`F-INFRA-004` carry stale Phase-3 texts — Phase 8 reconciliation.
