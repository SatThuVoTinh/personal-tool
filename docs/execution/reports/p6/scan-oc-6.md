# OpenClaw Setup/Templates Audit Recheck Report (oc-6)

**Slice ID:** oc-6
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-OC-008** | Post-rename fsync failure leaves an untracked hotfix artifact mixture | **FIXED** | `templates/openclaw-gemini-stream-hotfix.mjs:439-440` `changed.push` before `_writeAtomically`; `classifyState :379` (`a9ddced`) |
| **F-542** | Parallel ledger root mints a second empty governance root | **OPEN** (carried) | Register row |
| **F-556–F-564** | Operator rows | **OPEN/LATENT** (carried) | Register rows |
| **F-537 / F-545 / F-546 / F-548 / F-500** | Setup contract rows | **OPEN/LATENT** (carried) | Register rows |

## 2. Detailed Findings Recheck

### F-OC-008 — hotfix rollback accounting
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** `writeTransaction` now enqueues the record into `changed` **before** the write (`changed.push` at `:439` preceding `_writeAtomically` at `:440`), so a post-rename fsync failure at `syncDirectory` can be rolled back — the mixture that previously blocked gateway startup is undone; state detection lives in `classifyState` (`:379`).
- **Test Evidence:** `agent-topo-F-296` 5/5 + `m7-t1-openclaw` 22/22 PASS in the loop-2 W0/W1 rerun (`tests.md:11`). Register row still carries LATENT text (stale) — Phase 8 reconciliation.

### Carried rows
- `F-537` OPEN (digest-pinned contracts, no validation call site), `F-545` OPEN (registry checksum shape test), `F-546` OPEN (packaged copies unreachable), `F-548` OPEN/test-only (pin copies without agreement check), `F-500` LATENT (half-registered surface), `F-556` OPEN (rollback runbook refusal), `F-557` OPEN (r16 sentinel self-compare), `F-558` OPEN (coerced measurements), `F-559` OPEN test-only, `F-560` OPEN (env outranks positional root), `F-561` OPEN (pre-apply recompute), `F-562` OPEN (disjoint guards), `F-563` LATENT (POSIX-shaped preview root), `F-564` OPEN (magic-bytes preview validity). None touched in loop 1/loop 2.

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** None new; template/setup lanes stay scheduled per fix-plan §10 later waves.
