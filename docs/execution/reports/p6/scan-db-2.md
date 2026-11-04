# Database Audit Recheck Report (db-2) — backup, restore, recovery, concurrency

**Slice ID:** db-2
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-DB-002** | n8n backup excludes the decryption key | **LATENT** (carried; depends_on `F-558` OPEN) | Register row |
| **F-431** | Migration ledger INSERT unlocked, no ON CONFLICT | **OPEN** (carried) | Register row |
| **F-419 / F-420 / F-424 / F-558** | Restore/backup concurrency rows | **OPEN/LATENT** (carried) | Register rows |

## 2. Detailed Findings Recheck

- No loop-1 or loop-2 commit touched the backup/restore arm of this slice; every verdict carries forward at register status.
- **F-419** OPEN (post-apply verdict derives solely from the caller-declared expected list; `changed` computed and discarded); **F-420** LATENT (historical recovery ordering with a present-but-failing T1 backup); **F-424** OPEN (backup sets diverge — seven AGENTS.md rewrites without preimage); **F-558** OPEN (absent measurement coerced to positive certification).
- Standing loop-2 gates (`tests.md:9-14`) measure none of these mechanisms; the Docker/PostgreSQL lane is `NOT RUN` (`tests.md:13`), which is the only lane that could execute a live restore/backup probe.

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** `F-DB-002` requires an owner decision (key is hosted config, not repo data) and `F-558`; no concurrency lane has run yet.
