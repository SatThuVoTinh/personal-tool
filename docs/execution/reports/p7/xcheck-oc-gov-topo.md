# Cross-Check Recheck Report — xcheck-oc-gov-topo

**Boundary:** governance plugin ↔ topology/orchestration (workflow reducer, queue, ledger, lock)
**Phase:** Phase 7 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Fixed IDs on this boundary:** `F-OC-004`, `F-OC-005`, `F-OC-006`, `F-586`; carried `F-533` (closed upstream, absent)

---

## 1. Boundary Verdicts

| ID | Cross-check question | Verdict | Evidence |
| --- | --- | --- | --- |
| `F-OC-004` | Compare-and-remove release used consistently by queue/ledger consumers of the file lock | **FIXED — consistent** | `removalRound(dir, expectedToken)` at `file-lock.mjs:216-220` (call sites `:284`, `:320`); `m10-t2-r18-file-lock` 8/8 (`tests.md:11`) |
| `F-OC-005` | Ledger conflict check inside the writer lock does not break replay idempotency | **FIXED — consistent** | Honest replay with key-order drift no longer overwrites; `m12-t9-r4-decision-replay-order` 4/4 (`tests.md:11`) |
| `F-OC-006` | Reducer origin uniqueness (owner Option A) accepted by both topology callers and plugin producers | **FIXED — consistent** | `ORIGIN_BINDING_CONFLICT` at `workflow.mjs:645-651`; `workflow-origin-uniqueness` 2/2 (`tests.md:11`) |
| `F-586` | Plugin publish path refuses without the durable SURFACED anchor recorded by topology's journal | **FIXED — consistent** | REST producer returns `{status:"BLOCKED", error:"APPROVAL_SURFACE_UNRECORDED"}`; `m12-t9-r4-f529-approval-surface-record` 4/4 (`tests.md:11`) |

## 2. Interaction Findings

- **Lock seam:** the writer lock's refusal codes (`FILE_LOCK_NOT_OWNER`) propagate unchanged through queue/ledger callers; no consumer assumed the old last-write-wins release semantics after `f5bf41a`.
- **Ledger seam:** `F-404` (derived id vs replay key-order) remains LATENT separately from the fixed conflict guard — the new check runs on save, so `F-579` (budget re-derivation) and `F-577` (journal-before-snapshot) keep their existing OPEN/LATENT statuses with no interaction regression.
- **Approval seam:** `F-586`'s refusal is the plugin-side enforcement of the same anchor `F-529` describes; `F-529`–`F-532` remain OPEN (plan-binding/fence rows), untouched.
- **Register/CHANGELOG:** the `F-OC-006` (loop-1 fix) and `F-586` (loop-2 fix) closure history entries are incomplete in the register/PLAN — Phase 8 reconciliation, no code conflict.

## 3. Blockers

- None new on this boundary.
