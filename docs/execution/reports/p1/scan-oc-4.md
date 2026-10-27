# Phase 1 audit — oc-4

- **Scope:** `integrations/openclaw/topology/**`, `integrations/openclaw/orchestration/**`
- **Angle:** production spawn graph; task/run identity; state transitions
- **Baseline:** Dispatch-time working tree, HEAD `85eb094` per coordinator context; pre-existing diffs were present.
- **Outcome:** 1 new candidate (High); no blockers. Static source inspection only; tests not run. The shell status command was denied, so the dispatch context is the baseline record.

## Findings

### CAND-oc-4-01 — Concurrent duplicate ingress can create two tasks for one origin and make their shared run identity unresolvable

- **Severity:** High
- **Class:** 3 — defect can stop the component from starting or running
- **Path:** `integrations/openclaw/topology/lib/workflow.mjs:631-643`
- **Evidence:** On `WORKFLOW_OPENED`, the reducer enters its idempotency check only when `next.tasks` already contains the *same* `payload.task_id` (`:631-632`). It checks same-lineage fields only for that key (`:633-640`); for a different task ID with the same `origin`, `origin_principal_ref`, `origin_message_id`, `root_agent_id`, `root_session_key` and `root_run_id`, it creates a second task (`:645-655`) without checking whether another task already has that origin binding. `findSession` collects matches across every task and throws `EXECUTION_STATE_UNKNOWN` unless there is exactly one (`:329-357`), so two such records sharing session/run identity make ordinary session resolution fail. The production ingress caller performs a snapshot lookup before minting a fresh ID (`integrations/openclaw/plugins/zink-governance/index.mjs:9535-9555`) and appends later (`:9619-9627`); those steps are not one ledger transaction. `recordWorkflowEvent` serializes each individual event under the writer lock (`integrations/openclaw/topology/lib/ledger.mjs:1973-2004`, lock at `:1503-1508`), but the reducer has no second origin-binding uniqueness check inside that serialized commit.
- **Concrete reproduction:** Start two concurrent ingress handlers for the same admitted Discord message, principal and agent while the snapshot contains no matching task. Both read the empty snapshot at `index.mjs:9535`, both `findTaskByOriginBinding` calls return null, and both mint distinct task codes at `:9544-9555`. Let each append its `WORKFLOW_OPENED` event. The writer lock serializes the appends, but each distinct task ID passes the reducer branch at `workflow.mjs:631-643`; with the same root session/run, a subsequent `findSession(snapshot, sessionKey, runId)` has two matches and throws `EXECUTION_STATE_UNKNOWN` at `:357`. The duplicate tasks also leave owner-visible identity and any later work attached to an ambiguous origin.
- **Impact:** A duplicate delivery or concurrent ingress retry can permanently create multiple durable tasks for one origin message. Session/run resolution then fails closed for the duplicated identity, preventing governed task execution or follow-up for that run.
- **Other modules touched:** `integrations/openclaw/plugins/zink-governance/index.mjs` (ingress snapshot lookup, ID mint and event producer; caller evidence only).
- **Confidence:** High.
- **Register check:** No matching origin-binding race or reducer-side duplicate-origin check finding found in `docs/execution/findings.md`. Existing task identity/replay tests cover sequential lookup (`tests/m12-t1-task-identity.test.mjs:385-434`), not concurrent ingress across the lookup/append boundary.

## Other inspected scope

- The canonical spawn table in `integrations/openclaw/lib/policy.mjs:825-833` matches the assigned graph: `main -> [o1,o2]`, `o1 -> [excel,sql,python]`, and `o2 -> [power-bi,python]`; the reducer reads that table for coordinator derivation (`workflow.mjs:109-129,185-244`).
- No additional new defect was confirmed in the scoped state-transition paths. Existing register rows cover result outcome persistence, cancellation production, and run-state vocabulary/projection (`F-393`–`F-398`, `F-531`, `F-540`); these were not duplicated.
- `integrations/openclaw/orchestration/README.md` documents a missing `patterns/index.mjs` implementation already captured by `F-497`; not duplicated.

## Out-of-scope pointers

- None. The ingress caller is cited only to confirm reachability of the reducer-side uniqueness gap.
