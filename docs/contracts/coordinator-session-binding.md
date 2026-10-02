# Coordinator Session Binding — RED Design Contract

Status: `RED / DESIGN ONLY`
Planning Readiness: `DRAFT`
Execution Authorization: `NO`

This document is a design-authorization package. It authorizes no implementation,
no wiring, no scheduler, no gateway interaction, and no deployment. The owner
must still explicitly authorize implementation after reviewing it.

Authority: `AGENTS.md` §7 (RED — owner decision required: the change would
alter persistent state, security boundary, and session identity authority) and
§9 (architecture invariants: three logical modules, governed Knowledge/Skill
persistence, thin Tools boundary, OpenClaw-owned orchestration). Per §7, the
procedure here is: stop at the smallest safe boundary, record evidence and
impact, recommend the smallest sound alternative, obtain owner decision, and
revise `PLAN.md`/contracts before execution resumes. Silence is not approval.

## 1. Background

Two prior findings are verified and closed as repository work:

1. The coordinator runtime start seam exists on the pinned release
   (`OPENCLAW_RELEASE = 2026.6.34`): `api.runtime.subagent.run(...)` routes
   through the gateway `"agent"` method under a synthetic `operator.write`
   client and returns a server-issued `{ runId }`.
2. The repository-side pickup abstraction (`claimTaskById` fencing, ledger
   authority checks, topology containment) is implemented and tested.

The remaining blocker is governed session binding. A gateway-started
coordinator run owns no ledger session or delegation lineage, so the current
governance cannot treat it as a governed coordinator session: `findSession()`
resolves only root sessions and spawn-bound delegations, and every governed
seam (admission, prompt build, spawn gate, run end, subagent reconciliation)
depends on that resolution.

## 2. Proposed event

`WORKFLOW_COORDINATOR_RUN_BOUND`

Purpose: bind an already-claimed queue task attempt to the real coordinator
runtime identity produced by the OpenClaw gateway, without pretending the run
came from `sessions_spawn`.

It is NOT a spawn event, NOT a delegation event, NOT a parent-child lineage
event, NOT a replacement for `WORKFLOW_SPAWN_RESERVED`, and NOT a replacement
for `WORKFLOW_SPAWN_RECEIVED`.

### 2.1 Authoritative payload

Exact keys, no optional fields:

```js
{
  task_id,
  coordinator,
  attempt,
  lease_id,
  session_key,
  run_id,
}
```

Field rules: `task_id` is the authoritative 64-hex task digest;
`coordinator` is `o1` or `o2` taken from the ledger's `primary_coordinator`,
never defaulted; `attempt` is a safe integer `>= 1` equal to the queue item's
current attempt; `lease_id` is the live fencing lease issued by the atomic
queue claim for that attempt; `session_key` is the deterministic coordinator
key (§4); `run_id` is the server-issued gateway run identity. All string
fields follow the repository identifier rule (non-empty, at most 256
characters). `agentId` is not server-echoed by any plugin-reachable call, so
the contract does not claim it is: the evidence model is
`dispatch.coordinator` → deterministic `session_key` construction →
server-side `sessionKey`/`agentId` agreement validation → server-issued
`run_id`. A contradictory binding would have thrown at start instead of
returning a `run_id`.

### 2.2 Preconditions

All must hold or the event fails closed:

```text
task exists
task.workflow_status === EXECUTING
task.claimed_by === coordinator
attempt equals the queue item's current attempt
lease_id is the queue's live lease for that attempt
session_key is deterministically derived from coordinator/task/attempt (§4)
run_id was issued by the real OpenClaw runtime for that session_key
no conflicting binding exists for the attempt
```

The reducer can verify shape, state gate, and conflict-freedom from ledger
state. Lease liveness itself is queue-owned and therefore caller-asserted:
the pickup path owns the claim result at bind time, so it presents the
authoritative `lease_id`; the binding stores the association but never mints,
renews, or verifies a lease. This separation is deliberate (§7).

### 2.3 Reducer transition

```text
task.coordinator_runs[attempt] = { task_id, coordinator, attempt, lease_id, session_key, run_id }
```

Attempt-keyed map, audit-preserving: a higher attempt never mutates or erases
a prior attempt's identity. Identical replay is a no-op (which the existing
no-change-no-append rule in `recordWorkflowEvent` already turns into a
non-append). A conflicting binding for the same attempt fails
`LINEAGE_MISMATCH`. A binding for a lower attempt while a higher attempt is
bound fails `LINEAGE_MISMATCH` (superseded attempts never rebind).

### 2.4 Failure semantics

Any violated precondition throws the existing vocabulary
(`INVALID_STATE_TRANSITION`, `POLICY_DENIED`, `LINEAGE_MISMATCH`,
`SCHEMA_INVALID`); no partial write occurs because the reducer clones before
mutating. A failed bind leaves queue, lease, and task state exactly as they
were, so stale recovery remains the only path forward.

### 2.5 Stale-recovery interaction

Stale recovery requeues with `attempt + 1` and a revoked lease. The old
binding stays as history under its own attempt key and can never satisfy a new
attempt: a late `subagent_ended` for a superseded attempt carries a different
`session_key`/`run_id` pair and therefore cannot match the new binding.
Recovery never reuses old runtime identity.

### 2.6 Run-end interaction

`subagent_ended` (and `subagent_spawned`, if the host emits it for direct runs)
must match `(session_key, run_id)` against `task.coordinator_runs` values
before falling through to the existing unreconciled-run containment. A match
attributes the event to exactly one task attempt; a mismatch or a match
against a superseded attempt must not suspend unrelated live runs. The current
`blockUnreconciledNativeRun` behavior for genuinely unbound runs is unchanged.

## 3. Identity model

```text
task                authoritative business/governance state (workflow ledger)
queue attempt       execution generation (queue projection; attempt N+1 supersedes N)
lease               live claim fencing for one attempt (queue owns leases)
session_key         deterministic intended runtime identity (§4)
run_id              server-issued actual runtime identity (gateway owns issuance)
coordinator         designated agent (ledger primary_coordinator; server-enforced
                    via sessionKey/agentId agreement at start)
```

Relations without fabricated lineage: the task owns attempts; the queue claim
owns the lease for the current attempt; the binding associates
`lease_id ↔ session_key ↔ run_id` for exactly one attempt; the gateway owns
`run_id` issuance. There is no parent session, no parent run, and no tool
call behind a coordinator run, and the contract records none.

## 4. Session identity contract

Exact format (unchanged by this package):

```text
agent:{coordinator}:coordinator:{taskId}:attempt-{attempt}
```

It is used because the coordinator comes only from authoritative dispatch, the
task and attempt are explicit, the `coordinator:` namespace avoids
Main/global/chat-run session semantics (including the `bestEffortDeliver`
default that applies to main/global sessions), it contains no task description
or secret, and it yields one intended runtime identity per queue attempt:
same task + same attempt + same lease → same identity; a new attempt → a
distinct identity.

`lease_id` is deliberately NOT embedded in the key. The binding payload
(§2.1) is the authoritative place where `lease_id ↔ session_key ↔ run_id`
is associated; embedding the lease in the key would churn session identity on
every re-claim and break the one-attempt-one-identity invariant.

## 5. Idempotency contract

Three separate layers; none is claimed to be more than it is:

```text
queue-claim fencing    one live lease per attempt (existing QueueManager)
gateway idempotency    same idempotencyKey replays the accepted run instead of
                       starting a second run (gateway-owned entry lifetime)
ledger binding         identical re-bind is a no-op; conflicting re-bind fails
```

No cross-process exactly-once delivery is claimed: neither the repository nor
the gateway provides it across processes. The in-process notification
reservation and the single-flight scheduler remain the only concurrency
controls, with the documented limitation that they are per-process.

## 6. Forbidden lineage

The binding event and every consumer MUST NOT fabricate, infer, or require:

```text
parent_session_key
parent_run_id
tool_call_id
delegation_id
synthetic parent lineage
fake sessions_spawn provenance
```

`WORKFLOW_SPAWN_RESERVED` and `WORKFLOW_SPAWN_RECEIVED` are not weakened to
accommodate coordinator runs: their live-parent requirements stay exactly as
they are. A coordinator run is bound as what it is — a gateway-started run
attached to a queue claim — never as something it is not.

## 7. Consumer impact (implementation scope, not implemented here)

`findSession()` needs a third match arm returning
`{ task_id, task, coordinatorRun }` with deliberately NO `delegation` object.
Every existing consumer assumes the two-shape model (`owner.delegation?.X ??
task.root_Y`), under which a bound coordinator would silently inherit
Main/root-agent semantics. All 18 sites must be audited in the implementation
task; the minimum known changes:

```text
topology/lib/guard.mjs
  selfQuotaReceipt        self-scoped by agentId; confirm no delegation assumption
  beforeRun               admission fallback for bound sessions (continuation shape
                          does not fit; needs an explicit bound-session rule)
  beforeRunEnd            completion-claim governance must not treat a coordinator
                          end as a task-completion claim
  beforeToolCall          spawn gate: bound coordinator may spawn exactly its
                          AGENT_SPAWN_POLICY targets; approval/topology still enforced
  delegation-scoped tool path   must keep rejecting (bound ≠ delegated)
  beforeAnnounce          attribution must not read a binding as a delegation

plugins/zink-governance/index.mjs
  awaitSpawnReceipt       must not wait on, or be satisfied by, binding records
  maybePublishDiscordCard result correlation must not treat a binding as evidence
  executeApprovedTask / approval dispatch reads (ledger task shape gains
                          coordinator_runs; reads must tolerate its absence)
  beforeRunEnd wrapper    must route coordinator ends to the bound-run rule, never
                          to completion-claim governance or to fail-closed denial
                          of a legitimate end
  before_prompt_build     bound sessions need coordinator context, never the
                          unresolvable-run BLOCKED advisory and never a fabricated receipt
  subagent_spawned        recognize bound sessions; do not demand a delegation receipt
  subagent_ended          match (session_key, run_id) against bindings first; on a
                          match, attribute narrowly; on any doubt, keep current
                          containment behavior
```

## 8. Spawn authority

A bound coordinator run is a coordinator runtime, not Main. It inherits no
root-agent permission. It may spawn only targets allowed by the existing
canonical `AGENT_SPAWN_POLICY` (`o1 → excel/sql/python`, `o2 → power-bi/python`)
through the existing `guard.beforeToolCall` gate, subject to the existing
approval-state and topology-containment checks. No new topology policy is
introduced; the existing authority is referenced, not duplicated. The
`deriveGovernedDispatchTarget()` containment check remains mandatory before any
claim.

## 9. Result gap (explicitly out of scope)

`WORKFLOW_COORDINATOR_RUN_BOUND` establishes runtime identity only. It does
NOT make the run eligible for `WORKFLOW_RESULT_RECORDED`, which requires
delegation-bound provenance (`task.delegations[envelope.delegation_id]` plus
parent-run, governance-hash, node/attempt/revision lineage and
`ACCEPTED`+`VALID` verdicts). Result ingestion is a separate future design and
implementation task. No result envelope is created here and no speculative
fields are added for it.

## 10. Run-end and containment (intended invariants for implementation)

```text
bound coordinator run       → resolvable as coordinator identity
bound coordinator run       ≠ Main/root identity
unbound native run          → remains rejected / contained by the current model
ambiguous identity          → must never suspend unrelated live runs
notification success        → never execution authority
runtime start without binding → no success claim (current fail-closed behavior stays)
```

## 11. Open design points (documented, not decided)

- `lease_id` validation depth: the repository identifier rule (non-empty,
  ≤256 chars) vs a stricter UUID shape. Decision deferred to implementation;
  either way the queue remains the lease authority.
- Whether the binding should also record `bound_at` (event time already
  exists on every journal entry; duplication needs justification).
- Whether the binding should carry a message digest of the coordinator brief
  for later result correlation. Deferred to the result-ingestion design; no
  speculative fields are added now.

## 12. RED decision statement

```text
RED DECISION:

The existing event model has no safe event that can bind a gateway-started
coordinator run to an already claimed queue task attempt.

A new additive event WORKFLOW_COORDINATOR_RUN_BOUND is therefore required.

Implementing it changes shared session identity authority because findSession()
and its consumers must distinguish bound coordinator identity from Main/root
identity.

This change requires explicit owner authorization under AGENTS.md §7 and the
repository's governance/architecture authority rules.

No implementation is authorized by this design package itself.
```

## 13. Authorization scope (for owner review)

A future implementation task, if authorized, covers ONLY:

```text
1. add WORKFLOW_COORDINATOR_RUN_BOUND
2. update workflow reducer
3. update findSession identity resolution
4. audit all 18 findSession consumers
5. add bound-coordinator spawn rule using existing AGENT_SPAWN_POLICY
6. update beforeRun / beforeRunEnd / subagent_ended consumers as required
7. wire existing coordinator-pickup runtime seam
8. preserve queue lease fencing and existing notification behavior
```

Explicitly EXCLUDED:

```text
new agents
new queue
new broker
new service
new memory system
OpenClaw pin upgrade
result ingestion redesign
fabricated delegation lineage
fake parent sessions
new topology policy
replacement of existing governance architecture
```

This package is a DESIGN AUTHORIZATION PACKAGE. It is not an implementation
authorization. The owner must still explicitly authorize implementation after
reviewing it. Silence is not approval.
