# Phase 1 scan — oc-5

- **Mode:** Audit
- **Scope:** `integrations/openclaw/plugins/zink-governance/index.mjs` — guard, policy projection, spawn authorization, sandbox, provenance
- **Baseline:** Working tree at dispatch, HEAD `85eb094`; pre-existing diffs noted by the coordinator. Source files were not modified.
- **Nested guidance:** No nested `AGENTS.md` applies.
- **Checks:** Static source and register review only. Tests not run.

## Summary

- Critical: 0
- High: 0
- Medium: 1
- Low: 0
- Blockers: none

## Candidates

### CAND-oc-5-01 — stale delegated run can pass specialist message provenance

- **Severity:** Medium
- **Class:** 1 — security / authorization
- **Location:** `integrations/openclaw/plugins/zink-governance/index.mjs:10157-10162`, `:10171-10175`, `:10205-10215`
- **Evidence:** The message hook resolves the task owner using `findSession(snapshot, sessionKey, ctx.runId, true)` (`index.mjs:10157-10162`), explicitly enabling historical run IDs. It passes only the matched delegation's `agent_id` to `evaluateSpecialistProvenance` (`:10171-10175`). That evaluator checks delegation agent equality, `approved_at`, and task-wide `workflow_status` (`index.mjs:876-902`), but does not establish that `ctx.runId` is the delegation's current `native_run_id` or that its attempt is not superseded. When allowed, the live message hook continues past the provenance gate and emits the specialist message (`:10205-10215`).
- **Confirmation outside scope:** `integrations/openclaw/topology/lib/workflow.mjs:337-344` matches `previous_native_run_ids` when `includePrevious` is true. `:426-434` defines superseded attempts, and `:1961-1973` records the old native run ID before replacing it during a continuation. These historical IDs remain resolvable while the task is active.
- **Reproduction:** Static path: on an approved task with an active delegation, let a continuation replace that delegation's `native_run_id` while retaining the earlier ID in `previous_native_run_ids`. If the old run emits a normal Discord message from the same delegated session after the replacement, the hook resolves that old ID through `includePrevious`, sees the same delegation agent and still-active task, and passes provenance. With a canonical destination, it proceeds to return formatted content instead of blocking the message. No runtime probe or test was run.
- **Impact:** A stale or superseded execution can report to the owner as though it still owns the active task. The owner may receive and rely on instructions or status from a run that no longer holds current execution provenance.
- **Other modules touched:** `integrations/openclaw/topology/lib/workflow.mjs` (historical run resolution and continuation state); OpenClaw Discord message delivery.
- **Confidence:** Medium — the authorization gap is directly established by the call chain; delivery depends on the host presenting a late message event from the retained run.
- **Register overlap:** No existing finding found for specialist `message_sending` authorization against historical run IDs. `F-532` covers stale-run result commits at the execution-finished/queue boundary, a distinct path and effect.

## Out-of-scope pointers

- None newly identified. Existing register items concerning other OpenClaw files were not re-reported.