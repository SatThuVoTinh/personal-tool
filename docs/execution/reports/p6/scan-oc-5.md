# OpenClaw Governance-Plugin Audit Recheck Report (oc-5)

**Slice ID:** oc-5
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-OC-007** | Superseded delegated run passes specialist provenance and publishes | **FIXED** | `evaluateSpecialistProvenance` `index.mjs:10194` + run check `:9790` (`54633d7`, final hook `a9ddced`) |
| **F-OC-009** | Any thread metadata proves a canonical Discord surface | **FIXED** | `isCanonical` vs `CANONICAL_DISCORD_SURFACE_IDS` `index.mjs:10266-10292` (`54633d7`) |
| **F-OC-010** | Native Excel ERROR envelope violates the published output schema | **FIXED (committed)** | `registerTools` catch emits schema-compliant envelope `index.mjs:5338-5353` (`54633d7`); owner RED memo still pending |
| **F-392–F-398** | Approval/result binding rows | **OPEN** (carried) | Register rows |
| **F-529 / F-530 / F-531 / F-532 / F-535** | Plan-binding / cancellation / fence rows | **OPEN** (carried) | Register rows |
| **F-534** | `execution_finished` producer unknown | **BLOCKED** (carried) | Host fact missing |

## 2. Detailed Findings Recheck

### F-OC-007 — superseded provenance
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** the specialist provenance evaluation (`evaluateSpecialistProvenance`, `index.mjs:10194`) now carries the SUPERSEDED_RUN denial into the publish gate, enforced again at the outbound run check (`:9790`).
- **Test Evidence:** `m7-t1-openclaw` 22/22 PASS in the loop-2 W0/W1 rerun (`tests.md:11`).

### F-OC-009 — canonical surface predicate
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** `isCanonical` compares the destination channel ID (and thread parent) against `CANONICAL_DISCORD_SURFACE_IDS` instead of short-circuiting on mere presence of thread metadata (`index.mjs:10266-10292`).
- **Test Evidence:** `m12-t2-governed-surface` 44 passed (commit `54633d7` evidence); plugin coverage stands green at loop 2 via `m7-t1-openclaw` 22/22.

### F-OC-010 — error envelope
- **Verdict:** FIXED (committed; owner memo still outstanding)
- **Evidence:** the `registerTools` catch block emits only schema-compliant shapes — `{operation, success:false, error_code, error_message}` with the fixed canonical message and no forbidden extra properties — replacing the generic `{status:"ERROR", tool, error, message, code}` (`index.mjs:5338-5353`).
- **Test Evidence:** `m12-t2-governed-surface` 44 passed (`54633d7`). Note: the register row is RED pending the owner memo; the committed fix does not close the row — the owner must confirm the re-scoped acceptance (truthful status via `success:false` + symbolic code).

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** Owner RED memos still missing for `F-OC-010` (reconciliation) and `F-OC-011`; `F-534` stays BLOCKED on the host fact.
