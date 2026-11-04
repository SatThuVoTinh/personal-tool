# OpenClaw Topology Audit Recheck Report (oc-4)

**Slice ID:** oc-4
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-OC-006** | Concurrent ingress persists two task IDs for one origin | **FIXED** | `workflow.mjs:645-651` reducer `ORIGIN_BINDING_CONFLICT` (commit `24e0c2e`, owner Option A) |
| **F-586** | First-spawn approval card delivered without durable SURFACED record | **FIXED** | REST producer refuses; `APPROVAL_SURFACE_UNRECORDED` (loop-2 commit `a9ddced`) |
| **F-423 / F-424 / F-425 / F-426** | Operator root/backup rows | **OPEN** (carried) | Register rows |
| **F-489 / F-490** | Operator state-root rows | **OPEN** (carried) | Register rows |

## 2. Detailed Findings Recheck

### F-OC-006 — origin-binding uniqueness (owner Option A)
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** the reducer's `recordWorkflowEvent(WORKFLOW_OPENED)` scans existing tasks and throws `ORIGIN_BINDING_CONFLICT` for a second distinct task with identical `origin`+`origin_principal_ref`+`origin_message_id` (`workflow.mjs:645-651`); the payload fields are validated at `:550-573`; same-task-id replay stays idempotent (`:631-643`).
- **Test Evidence:** `workflow-origin-uniqueness` 2/2 PASS in the loop-2 W0/W1 rerun (`tests.md:11`).

### F-586 — SURFACED anchor
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** in the first-spawn REST producer, when the durable `WORKFLOW_APPROVAL_SURFACED` journal record cannot be verified, publish refuses and returns `{status:"BLOCKED", error:"APPROVAL_SURFACE_UNRECORDED"}` instead of reporting PUBLISHED (governance plugin `index.mjs`; loop-2 commit message names F-586).
- **Test Evidence:** `m12-t9-r4-f529-approval-surface-record` 4/4 PASS in the loop-2 rerun (`tests.md:11`).

### Carried open rows
- `F-423` (runtime-root literal frozen into transactions) OPEN; `F-424` (backup sets diverge) OPEN; `F-425` (quarantine renames unpreimaged) OPEN; `F-426` (`installed_mutation:true` unconditional) OPEN; `F-489`/`F-490` (state-root env/refusal) OPEN. No loop lane touched them.

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** Register/CHANGELOG closure history for `F-OC-006` (loop-1 fix) is incomplete — Phase 8 must record the CLOSED-by task/commit reference before removing the row (§0.5).
