# Coordinator Session Binding — Design Contract (implemented) + Execution-Authority Addendum

Status: `IMPLEMENTED` — M10/T2-R1 (identity binding) and M10/T2-R2 (execution
authority). This document is the persistent behavioral contract for M10/T2; the
frozen implementation details for the current revision live in
`docs/contracts/execution/ACTIVE.md`, which `PLAN.md` points to.

> Historical status: sections 1–13 are the RED design package as written and
> approved before implementation. Its header originally read
> `RED / DESIGN ONLY`, `Planning Readiness: DRAFT`, `Execution Authorization: NO`
> and it authorized no implementation by itself. M10/T2-R1 implemented it under
> an explicit owner approval recorded in `PLAN.md`; the design-only restriction
> was discharged by that approval and is retained below as historical evidence
> rather than as a live restriction. Where a design-stage statement was later
> proven incomplete, it is labelled inline as superseded and points at the
> governing section — no historical statement has been silently rewritten.

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

Field rules: `task_id` is the governed task identity — since M12/T1-R1 that is the
12-character code (`ddmmyyyy` + four characters from the task-code alphabet) minted at
admission, and readers additionally accept the legacy 64-hex digest so every record
written before that change still replays; `coordinator` is `o1` or `o2` taken from the
ledger's `primary_coordinator`,
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

> Superseded in part by M10/T2-R2 (§14). This remains true for the BIND event
> itself: a binding records the association and never mints, renews, or
> verifies a lease. What §14 changes is the consequence: the binding alone must
> no longer be treated as sufficient to authorize a later governed mutation. A
> caller-asserted lease is acceptable at bind time, where the pickup holds the
> claim, and insufficient at mutation time, where nothing does.

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
Main/root-agent semantics. All 24 `findSession` consumers must be audited in the
implementation task; the count is derived, not remembered (re-derive it with
`git grep -n 'findSession(' -- '*.mjs' ':!tests'`, which also matches the
definition in `integrations/openclaw/topology/lib/workflow.mjs`; the consumers
are the remaining 24). The minimum known changes:

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
fields are added for it. M10/T2-R2 keeps this exactly: a coordinator run cannot
produce a completion claim or a result, and revoking its lease does not turn its
end into one either.

## 10. Run-end and containment (intended invariants for implementation)

```text
bound coordinator run       → resolvable as coordinator identity
bound coordinator run       ≠ Main/root identity
unbound native run          → remains rejected / contained by the current model
ambiguous identity          → must never suspend unrelated live runs
notification success        → never execution authority
runtime start without binding → no success claim (current fail-closed behavior stays)
```

Implemented and verified by M10/T2-R1 for the resolution and non-completion
invariants, and by M10/T2-R2 for the containment invariant, which R1 did not
establish: see §14.5.

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
4. audit all 24 `findSession` consumers (the count is derived, not remembered)
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

---

## 14. Execution authority (M10/T2-R2)

Task `M10/T2`, revision `M10/T2-R2`. Parent revision `M10/T2-R1`
(implementation commit `64ded50`). This addendum is the behavioral contract for
the residual class the M10/T2 pre-live safety audit proved after R1 was
implemented and tested:

```text
PRE-LIVE SAFETY AUDIT FOUND SAFETY ISSUE
LIVE BLOCKED
```

### 14.1 The three concepts, kept distinct

```text
binding   → historical identity and attribution
attempt   → execution generation / supersession fence
lease     → current execution authority
```

A binding answers "which task/run did this session belong to?". A lease answers
"does this execution still possess current execution authority?". These are
different questions, and the R1 implementation conflated them: every governed
consumer resolved identity from the binding alone, so identity-valid-for-
attribution was silently read as execution-authority.

The required consequence, now normative:

```text
binding exists
    ↓
identity MAY be attributed (history, audit, run-end classification)

lease valid AND attempt current AND task still claimed by that coordinator
    ↓
governed execution MAY be authorized
```

A historical binding NEVER authorizes a governed mutation on its own. History
is never deleted to achieve this: the binding stays, and its attempt stays
readable through `findSession` and `findBoundCoordinatorRun` forever.

### 14.2 Lease revocation loses authority; the binding survives

```text
attempt N, lease L1, coordinator run A binds
        ↓ stale recovery
queue item: status QUEUED, claimedBy null, leaseId null, attempt N+1
        ↓
findSession(A session, A run)      → still resolves (attribution preserved)
A attempts a governed mutation     → DENIED (authority gone)
A's binding under attempt N        → preserved as audit history
new pickup: attempt N+1, lease L2  → binds its own identity, works normally
A's later run-end event            → narrow coordinator handling, never containment
```

### 14.3 The fence is enforced AT the authoritative mutation

A caller-side pre-check is a TOCTOU hole: recovery could revoke the lease
between the check and the write. The fence therefore lives where the mutation is
committed.

Two complementary halves, neither of which alone is sufficient:

1. **Queue half — current execution authority at the commit.**
   `QueueManager.withExecutionFence(fence, operation)` runs the caller's
   authoritative commit inside the queue's own critical section, the same lock
   `claimTaskById` and `detectAndRecoverStaleTasks` hold, after re-deriving from
   the DURABLE projection: task present, status `EXECUTING`, claimant is the
   bound coordinator, presented lease is the queue's live lease, the presented
   attempt is the queue's current generation, and the lease has not elapsed.
   A revocation therefore either precedes the whole fenced commit or follows it;
   it can never interleave with it. Every failure mode denies, and lock
   contention surfaces as the pre-existing `QUEUE_LOCK_TIMEOUT`, which is also a
   denial. Lock ordering is queue-then-ledger; no path takes the ledger writer
   lock and then the queue lock, so the ordering has no cycle.

2. **Ledger half — attempt isolation at the authoritative commit path.**
   `applySpawnReserved` refuses a coordinator parent whose binding is not the
   highest bound attempt (`SUPERSEDED_REVISION`) or whose task is no longer
   claimed by that coordinator (`POLICY_DENIED`). The reducer cannot see queue
   state — the queue is a separate store behind its own lock — so this half is
   not a duplicate of 1: it survives any caller that bypassed the queue seam,
   and it is evaluated inside the ledger writer lock against freshly read state.
   The denial throws inside the cloned projection, so a refused reservation
   commits nothing at all.

The seam is injected into the guard as `queueExecutionFence` so the topology
layer keeps no dependency edge to the queue projection, and so a guard built
without it fails closed: an unestablished fence is `EXECUTION_STATE_UNKNOWN`,
exactly like every other unresolvable governed state. Delegation and root
parents keep their existing unfenced path; their pre-approval, topology, budget
and lineage rules are unchanged by this addendum.

Coordinator-originated task mutations are exactly two in the current
architecture — the spawn reservation, and the brief activation the live spawn
path may record for a task with no nodes — and both are fenced. Main/root and
delegation parents are unaffected.

### 14.4 Admission is not authority

A revoked coordinator may still pass `guard.beforeRun`, because admission grants
no authority and the binding is what makes attribution possible at all. It
cannot reserve, activate, or otherwise mutate. Refusing admission would destroy
history without adding any protection, so the fence is deliberately at the
mutation.

### 14.5 Coordinator lifecycle classification is on IDENTITY, not liveness

R1 recognised a coordinator run only while its queue item was `EXECUTING` and
claimed by that coordinator. In the window between stale recovery and the next
pickup the item is `QUEUED`, so a superseded coordinator run ending there was
classified as unrecognizable: `findSession` matched the historical binding, the
binding owner is not a delegation, and the hook fell into the generic
unreconciled-native-run containment, which scans DELEGATIONS only, finds no
identity match, and suspends every live run in the ledger
(`scope: ALL_LIVE_RUNS`). That is a classification defect, not a containment
defect, and the generic model is unchanged.

Normative:

```text
coordinator-shaped key + agent agreement
  + (exact ledger binding for that attempt OR a live queue claim by that coordinator)
    → classified as a coordinator run, at any queue status, under ANY claim holder

EXECUTING item claimed by a DIFFERENT agent AND no binding → not a coordinator run
no binding and no live claim                              → not a coordinator run
ambiguous or unresolvable identity                        → existing containment behavior
```

The binding is the authoritative identity record and it wins over the claim
holder. §2.6 already requires an exact `(session_key, run_id)` binding match to
attribute the event _before_ any fallthrough to generic containment, and that
must hold whatever the queue says. A specialist is itself an assigned claimant
for its own queue item (M7-010: the designated coordinator _or_ a listed required
capability), so `claimedBy` legitimately differing from the coordinator is a
normal state — not evidence of a foreign run — and must not make a reconciled
coordinator run containment-eligible. Corrected in R2 after an independent
coverage review found the earlier wording and the first implementation both
refused recognition in that state and reached `ALL_LIVE_RUNS`.

A coordinator lifecycle event therefore never:

```text
writes WORKFLOW_NATIVE_ENDED against an unrelated delegation
targets ALL_LIVE_RUNS
creates WORKFLOW_RESULT_RECORDED or any result lineage
marks another attempt complete or pending review
```

Two stricter options are kept where they are warranted: the run-end completion
bypass requires the binding (`requireBinding`), and prompt build requires a LIVE
claim BY THAT COORDINATOR (`requireLiveClaim`) so a superseded run is never
served stale coordinator context even when it is still bound.

Accepted residual, deliberately unchanged: a coordinator-shaped identity with NO
binding and NO live claim is still classified as unreconciled and still reaches
the existing containment, including `ALL_LIVE_RUNS`.

**Status: ACCEPTED SEPARATE SAFETY DECISION.** The R2 closure pass re-examined
whether this residual can be narrowed without weakening the guarantee, and
concluded that it cannot.

- the sweep exists because a native child that matches NO recorded run proves
  that at least one live run's identity is in doubt (M7-045/46). Reducing the
  blast radius would assume an owner of the unrecorded child, which is precisely
  the fact the containment refuses to assume;
- the R2 repair did not need to touch it: the defect it fixed was
  MISclassification of a _bound_ identity, and binding-based recognition now keeps
  every coordinator lifecycle event out of this path without weakening it;
- narrowing it is therefore a material change to a fail-closed safety guarantee,
  which under `AGENTS.md` §7 is an owner decision, not a remediation detail.

It is documented, not fixed, and must not be described as fixed.

### 14.6 Idempotency is unchanged

```text
queue-claim fencing    one live lease per attempt; recovery revokes and re-generates
gateway idempotency    {taskId}:attempt-{attempt}:{leaseId}; a new attempt/lease mints a new run
ledger binding         identical re-bind is a no-op; conflicting re-bind fails LINEAGE_MISMATCH
```

Cross-process exactly-once is still not claimed and must not be claimed.

### 14.7 Evidence and status

`tests/m10-t2-r2-coordinator-execution-authority.test.mjs` (19 cases) is the
regression suite, including the fencing/race evidence. The case count is
derived, not remembered (re-derive it with
`grep -c '^test(' tests/m10-t2-r2-coordinator-execution-authority.test.mjs`). Repository-local
validation only: `npm test`, lint, format, repository policy. No gateway
control, no deployment, no `.openclaw-zink` mutation, no live runtime
verification. Deployment Authorized: NO. Deployment Status: NOT DEPLOYED. Live
Execution: NO. The live-verification window remains blocked on owner
authorization; this addendum makes the window safe to request, not authorized.

A later read-only forensic pass established that the authoritative live state
directory is `/home/hoang_vinh/.openclaw-zink` (WSL) and that its ledger matches
the recorded evidence exactly, so the "empty live ledger" premise that
originally appeared in the pre-live re-audit is withdrawn as a wrong-path
observation. See `docs/contracts/execution/ACTIVE.md` R2 10. This changes no
semantic clause above.
