# Recheck Report: Slice kb-2 (Knowledgebase Indexing, Embeddings, Storage & Migrations)

**Slice:** `kb-2`  
**Phase:** Phase 6 (Recheck Mode)  
**Target Finding ID:** `F-KB-002`  
**Report File:** `docs/execution/reports/p6/scan-kb-2.md`  

---

## 1. Finding Recheck Summary

| Finding ID | Title / Short Description | Status | Evidence (Path & Line) |
| --- | --- | --- | --- |
| **F-KB-002** | Replaying applied ALTER migration with missing ledger row blocks Knowledgebase startup | **FIXED** | `apps/knowledge/app/database.py:131,2908-2909`, `apps/knowledge/tests/test_m11_index_hygiene.py:494-549` |

---

## 2. Detailed Evidence & Analysis

### F-KB-002 — Replaying applied ALTER migration with missing ledger row blocks Knowledgebase startup

- **Status:** **FIXED**
- **Defect Description:** Migrations `004_pdf_build_failure_cause.sql` and `005_schema_migration_digest.sql` use `ALTER TABLE ... ADD COLUMN`. Replaying these migrations when their ledger row in `knowledge.schema_migrations` was missing caused PostgreSQL to return `42701` (`duplicate_column`). `_migration_is_already_applied()` previously checked only `CREATE` objects (`_migration_objects()`), returning an empty list for `ALTER` migrations and raising an unhandled exception that aborted Knowledgebase startup with `DATABASE_UNAVAILABLE`.
- **Fix Verification:**
  1. `apps/knowledge/app/database.py:131`: SQLSTATE `"42701"` (`duplicate_column`) is included in `_MIGRATION_DUPLICATE_SQLSTATES`.
  2. `apps/knowledge/app/database.py:2908-2909`: `_migration_is_already_applied()` inspects `objects = _migration_objects(sql)`. When `not objects` (no `CREATE` objects in `ALTER` migrations), it checks if `getattr(error, "sqlstate", None) == "42701"`. If true, it recognizes the migration as already applied, logs `knowledge.migration_replay_ignored`, and repairs the missing `knowledge.schema_migrations` ledger row at `database.py:2826-2829`.
  3. `apps/knowledge/tests/test_m11_index_hygiene.py:494-549`: Three comprehensive unit tests verify that:
     - `test_an_alter_migration_replay_with_duplicate_column_is_recorded`: Replaying migration 004 on `42701` duplicate column records the ledger version without aborting.
     - `test_an_alter_migration_005_replay_with_duplicate_column_is_recorded`: Replaying migration 005 on `42701` duplicate column records the ledger version.
     - `test_an_alter_migration_failing_with_other_error_still_aborts_boot`: Non-duplicate errors on `ALTER` migrations properly raise and abort boot.
- **Test Citation:** As recorded in `docs/execution/reports/p6/tests.md` line 9, `test:knowledge` passed (`311 passed, 18 skipped, 31 subtests passed in 54.67s`).
- **Minor Observations:**
  - `apps/knowledge/app/database.py:146-149`: `_MIGRATION_ALTER_PATTERN` is compiled but unreferenced elsewhere in the file. It is inert and harmless dead code.

---

## 3. New Defects Introduced

- **New Defects Found:** None (0).

---

## 4. Summary Counts & Blockers

- **Rechecked Findings:** 1 (`F-KB-002`)
- **Fixed:** 1 (`F-KB-002`)
- **Partial:** 0
- **Not Fixed:** 0
- **New Defects:** 0
- **Blockers:** 0
