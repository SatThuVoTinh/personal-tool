# Recheck Report — kb-1 (Knowledgebase Ingestion, Read-Only Source Vault, Input Trust)

- **Slice:** kb-1 (`apps/knowledge/`)
- **Area:** Knowledgebase Ingestion, Read-Only Source Vault, Input Trust
- **Mode:** Recheck (Phase 6)
- **Rechecked Findings:** `F-KB-001`, `F-KB-003`

## Status Summary

| Finding ID | Title | Status | Severity | Category |
| --- | --- | --- | --- | --- |
| F-KB-001 | An oversized PDF sidecar is silently skipped and its previously indexed PDF is deleted as stale | FIXED | High | F5 |
| F-KB-003 | NFC normalization maps two distinct Markdown paths to one source key and deletes one document | NOT FIXED | Medium | F5 |

---

## Detailed Recheck Results

### F-KB-001 — An oversized PDF sidecar is silently skipped and its previously indexed PDF is deleted as stale

- **Status:** FIXED
- **Category:** F5 — Data Integrity & Result Correctness
- **Severity:** High
- **Affected Modules:** Zink Knowledgebase (`apps/knowledge/`)
- **Fix Verification & Evidence:**
  1. `apps/knowledge/app/pdf_foundation.py:261-266`: Sidecar discovery checks `sidecar.stat().st_size > MAX_SIDECAR_BYTES`. If oversize, it resolves `sidecar_path` relative to `resolved_vault` and raises `PdfFoundationError("PDF_SIDECAR_TOO_LARGE", sidecar_path)`.
  2. `apps/knowledge/app/index_lifecycle.py:150-171,428-437`: `IndexLifecycle.execute` catches `PdfFoundationError` during discovery, records `SafeRunError("PDF_SIDECAR_TOO_LARGE", sidecar_path)` into `errors`, and sets `scan_failed = True`. During incremental or full rebuild execution, non-empty `errors` fails the run with `SCAN_FAILED` or `SOURCE_INDEXING_FAILED` before `complete_incremental` is called. The incomplete manifest is never published and no existing indexed PDF is deleted as stale.
  3. `apps/knowledge/tests/test_index_lifecycle.py:305-337`: Unit test `test_incremental_oversized_sidecar_fails_scan_without_deleting_pdf` verifies that when a sidecar exceeds `MAX_SIDECAR_BYTES`, the run fails with `PDF_SIDECAR_TOO_LARGE`, the database completed state is `False`, and the source PDF on disk remains intact.
- **Test Citation:** As recorded in `docs/execution/reports/p6/tests.md` line 9, `test:knowledge` passed (`311 passed, 18 skipped, 31 subtests passed in 54.67s`).

### F-KB-003 — NFC normalization maps two distinct Markdown paths to one source key and deletes one document

- **Status:** NOT FIXED
- **Category:** F5 — Data Integrity & Result Correctness
- **Severity:** Medium
- **Affected Modules:** Zink Knowledgebase (`apps/knowledge/`)
- **Evidence:**
  - `apps/knowledge/app/index_lifecycle.py:219-228`: Dict construction `manifest = {normalize_source_path(source.source_path): source for source in scan.sources}` maps all source paths to their NFC normalized representation without collision detection or duplicate-key rejection.
  - `apps/knowledge/app/database.py:1995-2024` (`replace_source`): Executes `DELETE FROM knowledge.sources WHERE index_id = $1 AND normalize(source_path, NFC) = $2` before `INSERT`, which silently overwrites and deletes the prior document when two distinct source paths normalize to the same NFC key.
  - No collision detection, pre-publication rejection, or duplicate key handling has been added to `index_lifecycle.py`, `markdown_adapter.py`, or `database.py`.
- **Reason Not Fixed:** `F-KB-003` was classified as `CONFIRMED-AS-LATENT` (Phase 3 triage `docs/execution/reports/p3/triage-04.md:19-26`). It depended on `F-576` and wave ordering, and required owner clarification regarding schema vs pre-publication rejection branches. No fix was assigned or applied for `F-KB-003` during R5 execution.

---

## New Defects Introduced

- **New Defects:** None (0). The fix for `F-KB-001` in `pdf_foundation.py` and `index_lifecycle.py` is clean and properly scoped.

---

## Test Gate Citation

Per lead test report `docs/execution/reports/p6/tests.md`:
- **Knowledgebase tests (`test:knowledge`):** PASS (311 passed, 18 skipped, 31 subtests passed in 54.67s; `uv run --directory apps/knowledge --locked python -m pytest tests -q`)
- **Repository policy (`repository-policy.mjs`):** PASS (1 suite, 1 test passed in 3.15s)
- **Repository check (`repo:check`):** FAIL (Diagnostic failures: trailing whitespace in 7 files; status vocabulary in findings.md; package.json missing 2 new test files)
- **PostgreSQL / Docker real-database lane:** NOT RUN (Host lacks live container daemon / active PostgreSQL instance)
- **POSIX WSL fsync/lock lane:** NOT RUN (Windows host environment)

---

## Summary Counts & Blockers

- **Total Rechecked:** 2
- **FIXED:** 1 (`F-KB-001`)
- **PARTIAL:** 0
- **NOT FIXED:** 1 (`F-KB-003`)
- **NEW DEFECTS:** 0
- **Blockers:** 0
