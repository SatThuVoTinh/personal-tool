# Knowledgebase Audit Recheck Report (kb-2)

**Slice ID:** kb-2
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-KB-002** | ALTER-migration replay with missing ledger row blocks startup | **FIXED** | `apps/knowledge/app/database.py` (commit `e14c5ae`) |
| **F-KB-003** | NFC normalization collides two Markdown paths, deletes one document | **LATENT** | Live only inside the uncommitted `F-576` patch |
| **F-576** | Non-NFC source path silently matches nothing | **OPEN** (deferred by owner) | `F-576` register row |

## 2. Detailed Findings Recheck

### F-KB-002 — ALTER migration replay
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** `database.py` now reconciles PostgreSQL error 42701 (`duplicate_column`) with the migration catalog record: `_migration_is_already_applied` treats an empty object set + 42701 as already-applied for the shipped ALTER-only migrations (`004_pdf_build_failure_cause`, `005_schema_migration_digest`), so rebooting does not abort on replay.
- **Test Evidence:** `apps/knowledge/tests/test_m11_index_hygiene.py:494-549` pins the replay path; full `test:knowledge` PASS at the loop-2 tree: 311 passed / 18 skipped (`tests.md:9`). `a9ddced` touched only one trailing-whitespace line of `database.py` afterwards (no logic change).

### F-KB-003 — NFC path collision
- **Verdict:** LATENT (not dispatched; register Phase 3 verdict: live only inside the uncommitted `F-576` patch)
- **Evidence:** no committed NFC-dedup fix; `depends_on: F-576`.

### F-576 — non-NFC prefix filter
- **Verdict:** OPEN (owner deferred the schema/normalization change; production-reachable: a non-NFC path stored by the writer answers no prefix filter)
- **Test Evidence:** no dispatch; no test in the affected list. Stays in queue.

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** `F-576` remains owner-deferred (schema decision), which keeps `F-KB-003` latent per its depends_on.
