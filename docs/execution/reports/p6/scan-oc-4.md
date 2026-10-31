# Recheck Report scan-oc-4 (Phase 6)

**Date:** 2026-10-29
**Finding ID under review:** F-OC-006
**Scope:** integrations/openclaw/topology/** and integrations/openclaw/orchestration/**
**Task identity:** M12/T9-R5 – fix-openclaw-topology (recheck mode)

---

## Finding F-OC-006 — Verification Status: PARTIAL

### Current Code State

**Evidence path:** `integrations/openclaw/topology/lib/workflow.mjs:645-651`

```javascript
for (const existing of Object.values(next.tasks)) {
  if (
    existing.origin === payload.origin &&
    existing.origin_principal_ref === payload.origin_principal_ref &&
    existing.origin_message_id === payload.origin_message_id
  ) {
    requireCondition(false, "ORIGIN_BINDING_CONFLICT");
  }
}
```

**Test coverage:** `integrations/openclaw/topology/lib/workflow-origin-uniqueness.test.mjs` (2 tests passing per `docs/execution/reports/p6/tests.md`)

### Verdict: PARTIAL

**What IS FIXED:**

- The reducer now enforces origin-binding uniqueness in `recordWorkflowEvent(WORKFLOW_OPENED)` at `workflow.mjs:645-651`
- A second `WORKFLOW_OPENED` with distinct `task_id` but identical origin binding throws `ORIGIN_BINDING_CONFLICT`
- Same-task-id replay with same lineage remains idempotent (`workflow.mjs:631-643`)
- Regression test exists and passes: `workflow-origin-uniqueness.test.mjs` (2/2 tests green per `docs/execution/reports/p6/tests.md`)

**What is NOT YET FIXED:**

- `docs/execution/findings.md` row for `F-OC-006` **has not been updated** since Phase 3 triage; it still reads:
  - `Status: CONFIRMED-AS-LATENT` (should be CLOSED or REFUTED)
  - `Root cause: the reducer makes WORKFLOW_OPENED idempotent by task_id only…` (factually incorrect at HEAD)
  - `Acceptance criteria:` section prescribes a fix that has already been applied
- `PLAN.md` §8 records owner decision "`F-OC-006 — Option A now, Option B deferred`" but does not reflect completion
- `CHANGELOG.md` has no entry documenting when/where F-OC-006 was closed

**New defects introduced?** No evidence of new defects inside scope from this fix.

---

## Required Actions Before Closing F-OC-006

1. **Update findings.md:** Change `Status:` from `CONFIRMED-AS-LATENT` to `CLOSED by <task> <commit>`
2. **Update FINDING.row metadata:** Delete or mark obsolete `Root cause` and `Acceptance criteria` sections once closure is recorded
3. **Update CHANGELOG.md:** Add entry `F-OC-006 | origin uniqueness enforced in reducer | <commit> | workflow.mjs:645-651 + workflow-origin-uniqueness.test.mjs`
4. **Update PLAN.md §4.17 disposition:** Mark F-OC-006 as completed with commit pointer
5. **Re-run affected gates:** `npm run verify` (node tests), `repository-policy.mjs`, confirm green before closeout

---

## Out-of-Scope Pointers

- `F-586` (first-spawn approval card SURFACED record anchor) — listed as related in fixes plan but outside topology scope; requires governance plugin edit
- Orchestration patterns (`integrations/openclaw/orchestration/README.md`, `patterns/index.mjs`) — read-only documentation, no code change needed

---

## Summary

**F-OC-006 code fix: VERIFIED** — Origin uniqueness is enforced in reducer at `workflow.mjs:645-651`.
**F-OC-006 register entry: NOT UPDATED** — Still shows stale Phase 3 triage state; requires documentation closeout.
**Tests: PASSING** — 2/2 green in `workflow-origin-uniqueness.test.mjs` per `docs/execution/reports/p6/tests.md`.
**New defects: NONE detected.**

**Final reply (10 lines):**
Report: docs/execution/reports/p6/scan-oc-4.md
Severity: 0 critical, 0 high, 0 medium, 0 low blockers
Finding F-OC-006: PARTIAL — code fixed, register stale
Code verified: workflow.mjs:645-651 (ORIGIN_BINDING_CONFLICT)
Tests: 2/2 green (workflow-origin-uniqueness.test.mjs)
Required: update findings.md status to CLOSED, add CHANGELOG entry, update PLAN.md disposition
Out-of-scope: F-586 (governance plugin), orchestration patterns
No new defects introduced
Awaiting documentation closeout by lead
