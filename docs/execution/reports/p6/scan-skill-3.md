# Skill Store Audit Recheck Report (skill-3)

**Slice ID:** skill-3
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-508** | Orphan-lock recovery runs destructive unlink/rmdir outside every error path | **OPEN** (carried) | Register row |
| **F-580** | Failed re-validation + failed rollback strands a canonical directory | **PARTIAL** | Stranded half closed `a7c8239` (`quarantineInvalidVersion`) |
| **F-509 / F-574** | Legacy isolation rows | **not in register** (closed upstream) | findings.md history |

## 2. Detailed Findings Recheck

### F-508 — no JSON record on mid-delete failure
- **Verdict:** OPEN (carried; production-reachable via the same interleaving that makes `rmdirSync` throw `ENOTEMPTY` — the mechanism named by sibling row `F-433`, which is also OPEN)
- **Evidence:** the two recovery drivers still print a raw stack with the absolute lock path when the destructive step throws; no loop-2 lane touched them.

### F-580 — stranded canonical directory
- **Verdict:** PARTIAL (carried)
- **Evidence:** the stranded-state half is closed by `a7c8239` — `quarantineInvalidVersion` renames a canonical pair that fails validation into the residue group so reads are no longer taken dark; the remaining half (rollback-removal failure path) stays open.

### Isolation/backup adjacency
- `F-572` OPEN (embedding identity column one-sided) and `F-576` OPEN (non-NFC prefix filter) — both owner-deferred schema changes; untouched.

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** None new; F-572/F-576 wait on owner schema decisions.
