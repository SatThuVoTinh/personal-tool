# OpenClaw Governance-Library Audit Recheck Report (oc-3) — authority, policy, ledger, lock, queue

**Slice ID:** oc-3
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-OC-004** | File-lock release can delete a replacement holder's lock after token check | **FIXED** | `file-lock.mjs:216-220` `removalRound()` (commit `f5bf41a`) |
| **F-OC-005** | Concurrent conflicting DecisionLedger writes overwrite the same deterministic ID | **FIXED** | `decision-ledger.mjs:454-459` inside writer lock (commit `565f203`) |
| **F-401 / F-402 / F-403** | Queue rows | **OPEN** (carried) | Register rows |
| **F-404** | Ledger derived id vs replay key-order | **LATENT** (carried) | Register row |
| **F-577 / F-578** | Ledger/apply-ceremony rows | **OPEN** (carried) | Register rows |
| **F-579** | Budget re-derivation at replay | **LATENT** (carried) | `ledger.mjs:1363` |
| **F-581** | Wall-clock budgets vs monotonic | **OPEN** (needs fault injection) | Register row |

## 2. Detailed Findings Recheck

### F-OC-004 — compare-and-remove release
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** `removalRound(dir, expectedToken)` verifies the owner token immediately before every unlink/rmdir and throws `FILE_LOCK_NOT_OWNER` on mismatch; the replace/remove interleave no longer deletes a replacement holder's live lock (call sites `:284`, `:320`).
- **Test Evidence:** `m10-t2-r18-file-lock` 8/8 PASS in the loop-2 W0/W1 rerun (`tests.md:11`), including the R18-08 mutation comparison from loop 1 (`f5bf41a`).

### F-OC-005 — DECISION_ID_CONFLICT under the writer lock
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** the conflict detection runs inside the lock on save — an honest replay whose JSON.stringify drifted no longer overwrites the same-ID record; `DECISION_ID_CONFLICT` is raised at the guarded site (`decision-ledger.mjs:454-459`, surfaced at `:555`, `:647`).
- **Test Evidence:** `m12-t9-r4-decision-replay-order` 4/4 PASS in the loop-2 rerun (`tests.md:11`).

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** Queue/ledger rows above stay awaiting their scheduled waves; all are authorized, non-RED or already-decided rows except none newly blocked.
