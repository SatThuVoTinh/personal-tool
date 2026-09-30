ACTIVE.md — M8/T2.2-R17 Run-End Governance Parity for the Liveness Heartbeat

Task ID: M8/T2.2
Plan Revision: M8/T2.2-R17
Planning Readiness: APPROVED
Execution Authorization: YES
Owner Approval: EXPLICIT — owner authorized R17 on 2026-09-30 as a RED,
  owner-decision change to the run-end governance contract, after live
  observation of the deployed R10 runtime proved the remaining blocker.
Deployment Authorized: YES
Lifecycle: IMPLEMENTED - deployed; the run-end gap is NOT closed
Deployment Status: AUTHORIZED - NOT YET DEPLOYED

R17 is a post-deployment correction. R16 remains the historical deployed
revision and its evidence is not rewritten.

## R17 1. Objective

A heartbeat observed live after the R16 deployment executed the full chain
(poll -> governance admission -> Docker sandbox provisioning -> sandbox
execution -> real model execution) and then failed at run-end with
`GOVERNANCE_COMPLETION_UNAVAILABLE` and `EXECUTION_STATE_UNKNOWN`. R10 fixed
admission; the run-end seam still refused the exemption.

## R17 2. Root cause

Two defects, both proven from the deployed artifact and the journal line
`beforeRunEnd: self-keyed session presented a runId; applying full governance`.

1. `finishNativeRun` built the run-end context with only `agentId`,
   `sessionKey` and `runId`. It dropped `trigger` and `transcriptPrompt`, which
   `enterNativeRun` already forwards at admission. Run-end therefore could not
   recognise a heartbeat even in principle.
2. `classifyInternalRunEnd` refused the internal exemption whenever a `runId`
   was present, unconditionally. R10 deliberately left this seam unmodified, so
   admission and run-end applied different rules to the same run.

## R17 3. The change

`native-boundary.mjs` `finishNativeRun` forwards `trigger` and
`transcriptPrompt` into the run-end context, mirroring `enterNativeRun` exactly.
Read-only, and consulted only by the existing predicate.

`index.mjs` `classifyInternalRunEnd` accepts one new input,
`pureLivenessHeartbeat`, and only skips the `runId` refusal when it is true.
The call site passes the verdict of the pre-existing `isPureLivenessHeartbeat`,
so ONE predicate serves both seams and no second copy of the rule exists.

Ordering is unchanged and still fails closed: a ledger-owned session is refused
before the new input is read, a non-self-keyed run is refused, a run carrying a
message identity is refused, and the new input defaults to `false` so every
pre-existing caller behaves exactly as before. Only a run that independently
satisfies the full heartbeat predicate — host `trigger === "heartbeat"`, no
input provenance, self-keyed session, no Discord provenance, exact liveness
sentinel — is exempted.

## R17 4. Provenance consequence

`native-boundary.mjs` is a provenance-pinned governance asset, so changing it
changes its digest and cascades, exactly as R7 and R10 did. The deployed R10
boundary and entrypoint are therefore added to the asset allowlist as recognized
predecessors, the post-R5 provenance hunks gain an R17 entry so the derived R5
digest still reproduces exactly, and the current-build digest pins move.

## R17 5. Handoff

Single authorized deployment attempt. No sandbox policy change, no host
fallback, no weakening of fail-closed behaviour. R16 evidence untouched. No
automatic R18.

---

## R17 6. Deployed result and the blocker that remains

R17 is deployed and live. `operator-apply.mjs` returned PASS at stage
`applied`, `transactionStatus: complete`, transaction
`txn-ebd6f3b8ded929435d56b9accd13784bf4aff519d23678285f0305578cba21de`. Live:
entrypoint `d01c210b`, boundary and native bridge `4567ce26`, selection
`555f37da` unchanged, native verifier `PATCHED`, ledger 103 events /
`d794d99d` unchanged, gateway stable with `NRestarts=0`.

A first attempt failed at `builder-apply` and rolled back with
`rollbackSucceeded: true` and the exact preimage restored, because the
entrypoint allowlist is duplicated per builder mode and only the preflight
copy carried the outgoing R10 digest. Both copies now carry it. That failure
was R17 own defect and it is fixed; no runtime state was left changed.

**The heartbeat still fails at run-end, and the reason is proven.** With R17
live, a real poll at `2026-10-01T00:20:55` local still logged
`beforeRunEnd: self-keyed session presented a runId; applying full governance`,
`GOVERNANCE_COMPLETION_UNAVAILABLE = 6`, and the run-end exemption never fired
(`internal system session = 0`).

The cause is NOT in the governance contract R17 changed. Reading the live
patched runtime file directly, the two seams are called asymmetrically:

    enterNativeRun(params.config, { ..., trigger: params.trigger,
      transcriptPrompt: params.transcriptPrompt }, params.abortSignal)
    finishNativeRun(params.config, { /*event*/ },
      { agentId, sessionKey, runId });          // no trigger, no prompt

The run-end call site never passes `trigger` or `transcriptPrompt`, so
`isPureLivenessHeartbeat` returns false there no matter what the boundary
forwards. R17 forwarding is correct but has nothing to forward.

That call site lives in the pinned native runtime source, so the remaining fix
is a `native-patch.mjs` edit injecting those two fields into the `finishNativeRun`
context, plus an R10 predecessor descriptor so the deployed `555f37da` selection
is still recognized. That is a change to the NATIVE runtime patch and its
lineage, not to the governance contract, and it exceeds the "exactly one new
revision" R17 was authorized for. It is therefore NOT done here and no R18 was
created.

Everything else the owner authorized is proven and holding:
`GOVERNANCE_RUN_UNAVAILABLE = 0` (R16), sandbox errors `= 0` (Docker
authorization), and the poll now reliably executes every 30 minutes with real
sandbox provisioning and a real model call. The 00:20 run additionally hit
upstream `The AI service is temporarily overloaded`, which is a Google capacity
condition and not a repository defect.

# Historical: M8/T2.2-R16 (closed, deployed)

ACTIVE.md — M8/T2.2-R16 Full Apply Rehearsal on a Live-Runtime Clone

Task ID: M8/T2.2
Plan Revision: M8/T2.2-R16
Planning Readiness: APPROVED
Execution Authorization: YES
Owner Approval: EXPLICIT — owner authorized R16 on 2026-09-30, declining a further
  live deployment and instead requiring the complete corrected apply path to be
  rehearsed against a byte-exact clone of the current live R7 runtime.
Deployment Authorized: YES
Lifecycle: CLOSED - 2026-09-30, as the final revision of `M8/T2.2`
Deployment Status: DEPLOYED

R16 is repository-only and creates no deployment authorization. Both prior
single-attempt authorizations (`b8597fe`, `7520f39`) are consumed and closed.

## 1. Objective

Exercise the COMPLETE corrected R10 deployment path against a byte-exact clone of
the CURRENT LIVE R7 runtime, without mutating the live runtime.

The one operation never yet executed anywhere is the R7 native predecessor WRITE
to R10. R14 proved the transformation is derivable in memory and that preflight
recognizes the R7 host; the write itself has never run, live or cloned.

## 2. Constraints

Every external effect is isolated. The real corrected orchestration code, the real
`configure.mjs`, the real native patcher and the real transaction machinery are
used; only the effects that would touch the host are injected — gateway restart,
systemctl, and process supervision.

There is NO live gateway restart, NO real systemctl, NO live OpenClaw or WSL
mutation, NO Discord message, NO real heartbeat, and NO production ledger write.
The only writes are inside the isolated rehearsal root.

`operator-apply.mjs` is NOT invoked: it binds hardcoded live absolute paths and a
real `systemctl` restart. The rehearsal drives the same `applyRuntime`
orchestration with the same dependency surface, pointed at the clone, which is the
only way to exercise the real algorithm without the live effects.

## 3. Native write proof

Starting from the cloned R7 state, the rehearsal must prove
`R7 → exact predecessor recognition → R10 derived in memory → R10 written`, and
that no intermediate BASELINE bytes are ever written to the clone. The
predecessor branch is proven to be the one taken, the fresh-patch branch is
proven not to have run, and the resulting bytes must be exactly R10.

## 4. Coverage

Complete apply stage trace; post-apply validation of config, governance, native
digests, plugin state, injection fields, version and transaction completion;
controlled failure injection at every mutation boundary; and the exact historical
repeat-attempt collision scenario driven through the real orchestration.

## 5. Allowed scope

- `tests/**`, `package.json` (test registration only), `PLAN.md`, this contract.

## 6. Excluded scope

No production code change is expected or authorized by R16. The G1, G2, G3, R6,
R13 and R14 contracts and the R15 transaction identity are unchanged and are
asserted unchanged.

## 7. Mandatory stop

R16 ends after the isolated rehearsal. A rehearsal PASS is NOT live deployment
validation and does not authorize a deployment.

## 8. Handoff

Repository only. Do not deploy, do not run live `operator-apply`, do not restart
the gateway, do not mutate WSL, do not send a heartbeat or a Discord message, do
not create a production ledger task, and do not delete or rewrite any
transaction. Commits are local and unpushed.

Lifecycle: R16 is `CLOSED` as the final revision of `M8/T2.2`. `Deployment
Authorized` was `YES` for ONE attempt, granted by the owner on 2026-09-30, and
that attempt has been consumed by the deployment recorded in section 10. The live
runtime is R10. The ledger is byte-identical. No R17 is created.

This live deployment was a separate authorized operation from the R16 rehearsal.
The rehearsal constraints in section 2 — no live gateway restart, no real
systemctl, no live mutation — governed the rehearsal and were superseded for the
one deployment attempt only, by the explicit authorization recorded above. The
rehearsal itself remains immutable evidence and is unchanged.

## 10. Live deployment result

**DEPLOYED.** 2026-09-30, one authorized attempt, run through
`operator-apply.mjs` against the real live runtime with no namespace and no
simulation. Authorization was recorded in both authoritative sources and
committed as `075f46d` before any runtime contact.

The apply returned `{"status":"PASS","stage":"applied","mutationStarted":true,
"rollbackRequired":false,"rollbackAttempted":false,"rollbackSucceeded":false,
"reason":null,"transactionStatus":"complete"}`. All stages ran in order through
`runtime-verify`. No rollback was required or attempted, and success was licensed
by live byte verification rather than by self-report.

The live native write went `R7 → R10` directly: selection
`b4316736…` → `555f37dae8eec1fbbd35e25ae28222dc5e8d6965e383500695a93900e9d8ddf5`,
bridge `33b3feef…` → `50af7d4ae10b519340b8dc13af3e2b219041fb28991e2a777ea815b537d2c7c2`.
The extension entrypoint moved `74582778…` → `e5b220b4…` and the installed
boundary `33b3feef…` → `50af7d4a…`. `openclaw.json` is unchanged at
`5db19403…` because the R7 config was already current. `native-r12` still holds
3 files at its prior mtime, so the baseline-writing branch never ran.

Independently verified after the apply: `checkNativePatch` returns `PATCHED` for
both sources; the live bridge equals the repository R10 boundary; the deployed
extension tree matches `governancePluginFiles()` byte-for-byte across 34 of 34
files; `trigger` and `transcriptPrompt` are present in the written selection;
`GOVERNANCE_VERSION = "m8-t2.3-r5"` with the G1 predicate and the G2 code intact;
three plugins configured. The gateway restarted for real and serves the new code
— `active (running)`, `NRestarts=0`, plugin loaded, http listening, heartbeat
started. `NRestarts` never rose; the repeated stop/start entries in the journal
are distinct WSL instance boots, not a crash loop.

Transaction `txn-1ba7689b6908d601122834e426939541bc72106736b2a5a15b48d539a063a8d4`
is schema v2, `complete`, and snapshot-verified — the R15 random attempt identity,
marked complete only after verification. The retained historical record
`txn-02edeb0bf364e3931fffd9e1e5fe904b` is untouched and still verifies.

Ledger unchanged: `events.jsonl` `d794d99d…`, `snapshot.json` `bbdf3aec…`,
103 events, sequence 103, 37 tasks — byte-identical before and after.
`backups/r12` untouched at 14 files. No quarantine, no rehearsal scratch, no
stray mounts.

`GOVERNANCE_RUN_UNAVAILABLE` after the deployment: **0**. The last occurrence
anywhere was `17:20:53`, hours before the apply. Post-deployment error lines are
Discord WebSocket closes with code `1006` during WSL reboots — 7 after against
22 before — and are unrelated to governance.

Stated limitation: no complete heartbeat cycle has been observed yet, because WSL
restarts roughly every one to two minutes here while the cadence is about thirty
minutes, so the scheduler is restarted before finishing a run. The failure R10
exists to fix has stopped occurring; cadence confirmation needs a longer-lived
WSL instance.

## 9. Result

**PASS.** `tests/m8-t2.13-r16-apply-rehearsal.test.mjs`, 16 tests, run by
`integrations/openclaw/topology/fixtures/runtime-regression/r16-rehearsal.mjs`.

A relocated byte copy was rejected as a clone. `buildConfig` embeds absolute
`stateDir` paths, so identical `openclaw.json` bytes pass at the original path
and fail at any other one with `Policy drift at agents`. The clone is instead a
private mount namespace in which the three live roots are overlayfs-mounted with
the live directories as the LOWER LAYER, so the clone IS the live runtime and
cannot drift from it.

The complete stage trace ran in order. The R7 → R10 native write landed:
`selection` `b4316736` → `555f37da`, `bridge` `33b3feef` → `50af7d4a`, with the
bridge equal to the repository R10 boundary and both native injection fields
present in the written selection. The overlay upper layer — a deterministic
record of writes, because copy-up happens exactly when a lower file is written —
contains exactly those two files and no third, and `native-r12` is byte-identical,
so no baseline was written: the sequence is `R7 → R10`, never `R7 → BASELINE →
R10`.

All eight failure boundaries rolled back to the exact attempt preimage, with
`rollbackSucceeded` set only after live byte verification and
`restoreValidationReason` null. A gateway that never restarts back leaves
`rollbackSucceeded` false even though the bytes are restored, which is the
intended conservative behaviour. Preflight failure mutated nothing and attempted
no rollback. The R15 collision was replayed through the real orchestration: A
fails and rolls back to R7, B then reaches native mutation on the same preimage
with a different attempt ID, an identical `preimageDigest`, and no
`TRANSACTION_ALREADY_EXISTS`. The R10 artifacts regenerate deterministically from
the pinned baseline and are byte-identical to the predecessor route's output.

Live environment after: all 15 components and 4 subtrees byte-identical; gateway
`MainPID=98288`, `NRestarts=0`, `ActiveEnterTimestamp` unchanged; ledger 103
events, sequence 103, 37 tasks. NOT DEPLOYED.

Deployment path status after this revision, stated precisely:

- the R7 → R10 native predecessor WRITE is genuinely exercised — real patcher,
  real bytes, on a byte-exact clone of the live runtime;
- the post-apply runtime verification is genuinely exercised — the real
  `verifyLiveRestore(..., { postApply: true })` byte comparison ran and licensed
  the apply, and its failure path rolled back;
- the gateway restart stage is **NOT** exercised. It ran only as an injected
  no-op. No real `systemctl --user restart` and no real `is-active` observation
  has ever executed, on the live runtime or on a clone. Its orchestration
  position, ordering and rollback interaction are proven; its effect is not.

So the deployment path is proven up to, but not including, the restart itself.
The remaining unexercised steps are the real restart and a live deployment, and
a live deployment stays unauthorized.

# Historical: M8/T2.2-R15 (implemented, superseded)

R15's commit `c73173f` stands. Retained as history; R16 does not modify it.

## R15 header

Task ID: M8/T2.2
Plan Revision: M8/T2.2-R15
Planning Readiness: APPROVED
Execution Authorization: YES
Deployment Authorized: NO

## 1. Objective

Branch: codex/m8-t2-governed-runtime-hardening
Predecessor revisions: R3-R6, R7, R8, R10, R11, R12, R13, R14 (Implemented);
  R9 (BLOCKED, superseded). See PLAN.md §4.1.

## 1. Objective

Separate transaction **attempt identity** from **preimage identity**.

R12 keys the transaction directory on the preimage digest. The first deployment
attempt's rollback restored the runtime byte-exactly, so the live runtime still
matches that attempt's retained preimage on all 38 recorded components, the
derived ID is unchanged, and the next apply is permanently refused with
`TRANSACTION_ALREADY_EXISTS`. A completed record from a prior attempt has become
an un-clearable blocker. Orphan detection cannot see it, because the record's
status is `complete`.

That conflates two different questions:

- `preimageDigest` — "which exact runtime state did this attempt start from?"
  Deterministic, and correct as such.
- `attemptId` — "which apply attempt was this?" Unique per attempt.

## 2. Identity model

The transaction directory is keyed by `attemptId`, never by `preimageDigest`.
The record retains the full deterministic preimage evidence: the complete
component manifest, per-file digests, per-file modes, the manifest integrity
binding, the aggregate `preimageDigest`, the creation timestamp, and the attempt
ID.

`attemptId` uses the repository's existing cryptographic convention
(`randomBytes(32).toString("hex")`, as already used for the governance identity
key), so it is collision-resistant, not a timestamp or custom scheme, and safe
for concurrent attempts. The directory is created exclusively, so no existing
transaction can ever be overwritten.

Two attempts against the same preimage are valid and legitimate: each has its
own `attemptId`, its own directory, and its own independently recoverable
snapshot, while both manifests record the identical `preimageDigest`.

## 3. Invariants

- **Attempt identity is unique and random**; preimage identity is deterministic.
  The two are never conflated, and preimage evidence is never replaced by the
  attempt ID.
- **Completed transactions are retained.** They are evidence, not blockers. A
  new attempt never requires deleting or manually resolving an earlier one.
- **Transaction records are immutable.** Only the lifecycle status may transition
  forward.
- **Orphan safety is unchanged.** A transaction left `started` by a process that
  disappeared is still detected, still blocks a new apply, and is never silently
  deleted, resumed or rolled back. A `complete` record is never treated as an
  orphan, and a shared `preimageDigest` is never treated as one either.
- **History is not concurrency.** A completed preimage permits a new attempt; an
  active or mutating transaction remains protected. No broad locking redesign is
  introduced; the existing exclusive-create and orphan gate are preserved and
  verified.
- **Durability order is preserved.** Attempt ID → exclusive directory → manifest
  → snapshot → re-read verification, and only then mutation. A persistence
  failure yields `mutationStarted = false` with the runtime untouched.
- **Rollback targeting is explicit and unchanged in substance.** A rollback
  restores the snapshot of THAT attempt, selected by `currentAttemptId`. It is
  never the repository state, the latest transaction, the r12/T1 baseline,
  another attempt with the same preimage, or whichever record sorts first.

## 4. Historical preservation

The existing completed record `txn-02edeb0bf364e3931fffd9e1e5fe904b` is a valid
historical recovery record and must remain intact. R15 is forward-compatible
with it and does NOT rewrite, rename, migrate or delete it. The attempt-scoped
scheme applies to new transactions only.

## 5. Allowed scope

- `integrations/openclaw/topology/lib/transaction-snapshot.mjs` — attempt
  identity, preimage digest, record shape and the loaders.
- `integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs`
  — only where passing the attempt ID through is required.
- `tests/**`, `package.json` (test registration only), `PLAN.md`, this contract.

## 6. Excluded scope

Unchanged: the R10 G1 contract and `trigger === "heartbeat"`, G2 cause
preservation, G3 advisory behaviour, R6 approval semantics, the R8/R13 asset
allowlists, the R14 native patch lineage, `configure.mjs`, `native-patch.mjs`,
`native-boundary.mjs`, and the production ledger.

R15 must not delete, rewrite or manually resolve any transaction record, add
automatic orphan cleanup, loosen transaction uniqueness, overwrite an existing
transaction, or change retention policy.

## 7. Acceptance criteria

- Two attempts against the same preimage get distinct attempt IDs and distinct
  directories, and neither blocks the other.
- Both manifests record the identical preimage digest, and both snapshots are
  independently recoverable.
- A completed transaction is retained and a later attempt succeeds without any
  manual resolution.
- No existing transaction is ever overwritten; a forced ID collision is refused.
- Orphan detection, orphan blocking, exact-preimage rollback, live restore
  validation and historical recovery separation all still hold.
- `NATIVE_SOURCE_DRIFT`, the G1 contract and the R13 allowlist are untouched.
- Focused and full repository validation pass; `git diff --check` is clean.

## 8. Handoff

Repository remediation only. Do not deploy, do not run live `operator-apply`, do
not clear, delete or rewrite any transaction, do not add R10 allowlist entries,
do not restart OpenClaw, gateway or WSL, and do not write the ledger. Commits
are local and unpushed. R15 is not closed under this contract.

---

# Historical: M8/T2.2-R14 (implemented, work committed)

R14's commit `c41a7a5` stands and is accepted by the owner. Retained below as
history; R15 does not modify it.

## R14 header

Task ID: M8/T2.2
Plan Revision: M8/T2.2-R14
Planning Readiness: APPROVED
Execution Authorization: YES
Deployment Authorized: NO

## 1. Objective

Branch: codex/m8-t2-governed-runtime-hardening
Predecessor revisions: R3-R6, R7, R8, R10, R11, R12, R13 (Implemented); R9
  (BLOCKED, superseded). See PLAN.md §4.1.

## 1. Objective

Repair the native patcher's inability to transition safely from the currently
deployed R7-patched runtime to the R10-patched runtime.

R14 is a repository-remediation and live-preflight revision. **Deployment target:
none.** R14 does not deploy.

## 2. Established defect

The authorized R10 deployment (authorization `b8597fe`, one attempt) failed at
`native-backup-prune` with `NATIVE_SOURCE_DRIFT` raised at `native-patch.mjs:225`.
The R12 transaction rollback restored the exact R7 preimage and verified it
against the live runtime; the ledger was untouched at 103 events / sequence 103
/ 37 tasks.

The patcher recognizes only two native states: the exact upstream baseline, and
the exact patched state generated by *itself*. It classifies a file as patched
only by replacing its own patch string and checking that the inverse hashes to
the pinned baseline. The live host carries the **R7** injection, so the R10
patch string is absent, the inverse fails, and neither branch is reachable.

This is a cross-revision patch-lineage compatibility defect. It is not ledger
corruption, configuration drift, asset-provenance failure, transaction-rollback
failure, heartbeat-contract failure, or R6 failure. No allowlist entry could
have prevented it.

## 3. Lineage model

The runtime is modelled as an explicit, ordered lineage rather than a
baseline/current toggle:

```text
BASELINE ──→ R10
    │
    └──→ R7 ──→ R10
```

Four recognized states:

| State | Meaning | Behaviour |
| --- | --- | --- |
| A `BASELINE` | exact pinned upstream baseline | existing transform to R10 |
| B `PREDECESSOR` | exact recognized prior patch revision | invert in memory, then transform to R10 |
| C `PATCHED` | exact current R10 state | existing idempotent behaviour |
| D `UNKNOWN` | anything else | `NATIVE_SOURCE_DRIFT` |

## 4. Predecessor descriptor

Recognition is provenance-bound, never heuristic. A descriptor binds the revision
identity, the exact source digest, the exact source signature (its patch string),
the inverse transformation, the resulting baseline digest, and the intended
successor revision. A descriptor is bound to the exact artifact it was defined
for: a digest for one artifact never authorizes another.

For R10 the only required predecessor is R7. R5 and R6 are NOT added: the actual
deployment graph requires only R7, and inventing entries for revisions nothing
depends on would widen the recognized surface for no reason.

## 5. Mandatory invariants

- **I1 exact predecessor identity.** Recognition requires exact state identity
  against an explicitly approved descriptor. No heuristic-only recognition.
- **I2 no live intermediate baseline.** The runtime must never go R7 → BASELINE
  → R10. The transition is read R7 → verify R7 → derive R10 in memory → write
  R10. The baseline exists only as an in-memory transformation.
- **I3 unknown fails closed.** Anything not baseline, recognized predecessor, or
  exact current state returns `NATIVE_SOURCE_DRIFT`.
- **I4 byte mutation fails closed.** One-byte changes to R7, BASELINE, or R10
  do not qualify.
- **I5 path specificity.** A digest for one artifact never authorizes another.
- **I6 determinism.** No clock, randomness, or environment-dependent branching
  determines classification.
- **I7 provenance separation.** Asset allowlists and patch lineage remain
  separate controls; neither is weakened by the other.
- **I8 rollback independence.** `backups/r12`, `native-r12`, historical
  rollback, and T1 restoration are never part of normal native transformation.
  Automatic rollback remains transaction-snapshot based.

## 6. Non-goals

R14 must not: deploy R10; modify the live runtime; restart the gateway; modify
WSL; modify the production ledger; modify G1, G2, G3, R6, or the R8/R13 asset
allowlist semantics; redesign the transaction snapshot architecture or retention
policy; add automatic orphan recovery; modify `backups/r12` or `native-r12`;
redesign `configure.mjs`; patch the Discord ingress layer; add `mentions` or
`isBot` to the native patch; bypass `NATIVE_SOURCE_DRIFT`; or accept arbitrary
prior patch versions.

`NATIVE_RUNTIME_PINS` is not changed unless the architecture demonstrably
requires it. No new asset allowlist entry is added as a side effect; if one
becomes necessary, R14 stops and reports it as a separate authorization decision.

## 7. Allowed scope

- `integrations/openclaw/topology/lib/native-patch.mjs` — the predecessor
  descriptor table and the recognition/transform path only.
- `tests/**`, `package.json` (test registration only), `PLAN.md`, this contract.

## 8. Acceptance criteria

- BASELINE → R10 works and is unchanged in behaviour.
- R7 → R10 works, producing byte-identical R10 output, with no live intermediate
  baseline.
- R10 → R10 remains idempotent.
- UNKNOWN, one-byte mutations of any state, mixed R7/R10, wrong-path content,
  and unrelated historical patches all fail with `NATIVE_SOURCE_DRIFT`.
- Falsification F1–F6 all demonstrate the new path is load-bearing.
- G1, G2, G3, R6, R8/R13 and R11/R12 semantics are unchanged and passing.
- Live preflight returns PASS with `installed_mutation: false`, with no runtime
  mutation, no gateway restart, and no ledger mutation.
- `ACTIVE.md` is kept; `Deployment Authorized` stays `NO`; no closeout commit.

## 9. Handoff

Repository remediation and live preflight only. Do not deploy, do not run
`--apply` or `operator-apply`, do not restart OpenClaw, gateway or WSL, do not
run a live heartbeat, do not create a Discord ledger task. Commits are local and
unpushed. R14 is not closed under this contract, and no automatic transition from
R14 to deployment is permitted.

---

# Historical: M8/T2.2-R13 (work committed)

R13's commit `2d8dc54` stands. It added the two R7 predecessor governance-asset
digests and is retained below as history.

## R13 header

Task ID: M8/T2.2
Plan Revision: M8/T2.2-R13
Planning Readiness: APPROVED
Execution Authorization: YES
Deployment Authorized: NO

## 1. Objective

Two objectives only.

1. Make the transaction recovery snapshot durable enough to survive a process
   failure during mutation. R11's snapshot is in-memory, so an apply process
   that disappears after mutation begins leaves no recovery target and no record
   that a mutation was in progress.
2. Put an explicit authorization gate in front of the historical
   `operator-rollback.mjs` path, which installs the 2026-09-11 T1 config, the
   clean native baseline, and no governance extension.

R12 is repository-only. No deployment, no live `operator-apply`, no live
historical rollback, no R10 allowlist entries.

## 2. Owner decision recorded

R11 is accepted as the correction to automatic rollback semantics. The R10
predecessor digests belong to a later revision and are NOT added here.

## 3. Durable transaction lifecycle

```text
BEFORE MUTATION:
  create durable transaction snapshot
  → verify snapshot
  → record transaction ID
  → enter mutation

ON SUCCESS:
  apply completes
  → final runtime verification passes
  → transaction marked complete
  → snapshot may be deleted per the repository retention policy

ON FAILURE:
  mutation started
  → restore transaction snapshot
  → live restore verification
  → rollback success/failure

ON PROCESS CRASH / ABRUPT TERMINATION:
  the transaction snapshot MUST still exist,
  and an orphaned transaction MUST NOT be treated as a successful deployment
```

Storage is a dedicated transaction-state directory under the existing operator
state area. It is never `backups/r12`, never `native-r12`, never historical
quarantine, never the repository checkout, and never an arbitrary temporary
directory that may not survive a process restart.

## 4. Durable transaction record

The record contains: transaction ID, creation timestamp, lifecycle status, the
exact component manifest, per-file digest, per-file mode where contractually
relevant, the snapshot path, and a manifest integrity binding.

Snapshot files contain only the runtime preimage required for exact recovery.
No secrets beyond the files already required for an exact restore, no unrelated
filesystem content, and no broad recursive system snapshot. Permissions are
restrictive: the record is written `0o600` inside a `0o700` directory.

## 5. Orphaned transaction safety

A new apply is refused automatically when a transaction is `started` but not
marked complete. The orphaned transaction ID is reported. An explicit recovery
decision is required. The snapshot is never silently deleted, never silently
resumed, and never automatically rolled back. A crash therefore cannot produce
an ambiguous second deployment.

## 6. Historical rollback authorization model

Automatic apply rollback and historical operator rollback are different actions
and are never equivalent:

- Automatic apply rollback restores the exact current transaction preimage.
- Historical operator rollback is an explicit, separately authorized recovery
  action that installs the r12/T1 baseline.

`operator-rollback.mjs` must fail closed unless all four hold:

1. an explicit recovery authorization is recorded;
2. the requested recovery target is explicitly identified;
3. the operator confirms the destructive recovery;
4. the command reports exactly what target it will install before any mutation.

Authorization is never inferred from `Deployment Authorized`,
`Execution Authorization`, or the mere presence of a backup.

`backups/r12` and `operator-rollback.mjs` are both retained, and the historical
target is not silently changed.

## 7. Allowed scope

- `integrations/openclaw/topology/lib/transaction-snapshot.mjs` — durable
  persistence, the transaction record, integrity binding and orphan detection.
- `integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs`
  — persist before mutation, mark complete on success, detect orphans.
- `integrations/openclaw/topology/fixtures/runtime-regression/operator-apply.mjs`
  — wiring only.
- `integrations/openclaw/topology/fixtures/runtime-regression/operator-rollback.mjs`
  — the authorization gate and pre-mutation target disclosure. Its historical
  target is unchanged.
- `tests/**`, `package.json`, `PLAN.md`, this contract.

## 8. Excluded scope

Unchanged: the R10 G1 contract and `trigger === "heartbeat"` semantics, G2 cause
preservation, G3 advisory BLOCKED behaviour, R6 approval semantics, the R8
allowlist, and `configure.mjs` asset comparison semantics.

R11's automatic rollback logic is extended only where persisting the transaction
snapshot requires it. The logic itself is unchanged.

The R10 outgoing digests `lib/native-boundary.mjs = 33b3feef…` and
`index.mjs = 74582778…` are NOT added. `backups/r12` is not deleted or
repurposed. `ACTIVE.md` is kept.

## 9. Acceptance criteria

- The transaction snapshot is written durably and survives orchestrator
  reconstruction.
- Mutation begins only after durable verification.
- A successful apply marks the transaction complete.
- An incomplete transaction is detected, reported, and blocks a new apply.
- A corrupted snapshot, a digest mismatch, and a path traversal are all refused.
- The exact preimage is restored after a mutation failure, and the restore is
  independently verified.
- An orphaned transaction is never silently deleted.
- Historical rollback is rejected without an explicit recovery authorization,
  and rejected when only a generic deployment authorization exists.
- Historical rollback names its target as historical recovery, never as
  transaction rollback.
- The transaction rollback path never invokes `operator-rollback.mjs`.
- `backups/r12` remains untouched.
- Focused and full repository validation pass; `git diff --check` is clean.

## 10. Handoff

Repository remediation only. Do not deploy, do not run live `operator-apply`,
do not run historical `operator-rollback`, do not restart OpenClaw, gateway or
WSL, do not run a live heartbeat, do not create a Discord ledger task, and do not
add the R10 allowlist entries. Commits are local and unpushed. R12 is not closed
under this contract.

---

# Historical: M8/T2.2-R11 (accepted, work committed)

R11's commit `ab0dda2` stands. Its automatic rollback semantics are accepted and
retained in force. It is kept below unchanged as history.

## R11 header

Task ID: M8/T2.2
Plan Revision: M8/T2.2-R11
Planning Readiness: APPROVED
Execution Authorization: YES
Deployment Authorized: NO

## 1. Objective

Make a live apply transactionally reversible. The current rollback restores a
historical T1/r12 baseline rather than the runtime state that existed
immediately before the apply, and the orchestration reports
`rollbackSucceeded: true` without proving the live runtime was restored.

R11 replaces "restore the old baseline" with "restore the exact transaction
preimage", and replaces "the restore function returned" with "the live runtime
was verified".

## 2. Phase 1 audit of the current rollback contract

Traced by source inspection and read-only measurement on 2026-09-30.

**Which operations mutate runtime.** `configure.mjs --apply` writes, in order:
`stateDir`, the ledger directory, the runtime backup, `openclaw.json`, the seven
agent workspaces, the auth plan, the governance extension assets, the manifest,
the package, the entrypoint, `identity.key`, the auth-order plan, the pass
resolver, the Gemini hotfix, and the systemd drop-in. `operator-apply.mjs` then
mutates the native `dist` selection and announce artifacts, writes the bridge,
and restarts the scoped gateway. `pruneQuarantine` and `pruneStaleNativeBackup`
additionally `rmSync` a quarantine directory and the native backup root.

**Which state is captured before mutation.** `createRuntimeBackup` at
`configure.mjs:677` — but only on its first ever run. It captures
`openclaw.json`, the workspaces and the extension, and builds `t1-config.json`
from the T1 policy at `T1_SHA`. Its manifest records `t1_config_digest` and
`intended_config_digest`; it never records the live native artifacts.

**Which backup is used for rollback.** `operator-apply.mjs:112-119` wires
`restoreNativePatch(runtimeRoot, operator/m7-t2/native-r12)` and
`restoreT1RuntimeFiles({ stateDir, identifiers })`.

**Whether that backup is the current live runtime.** It is not.

- `native-r12` holds clean upstream BASELINE preimages — selection `a5698c55…`
  against a live patched `b4316736…`, announce `764e6ffa…` against live
  `e3b110f7…`. The manifest is written once and never refreshed, and
  `restoreNativePatch:536` unlinks the bridge, so a rollback DE-PATCHES the
  runtime and removes the boundary.
- `backups/r12/t1-config.json` is `b96aca41…` against a live config
  `5db19403…`, captured 2026-09-11 17:36:24 — 19 days stale.
- `runtime-backup.mjs:107` returns early when the backup root exists, so no
  in-operator path ever captures a fresh snapshot.

**What each restore helper actually guarantees.**

- `restoreNativePatch` guarantees the pinned dist sources return to BASELINE and
  the bridge is removed. It does not restore the patched state, and it validates
  only that the current file is one of the two known digests.
- `restoreT1RuntimeFiles` guarantees the 2026-09-11 T1 config is installed and
  the live extension and workspaces are RENAMED into `quarantined-t2`. It
  returns `liveBaselineValidation: "NOT RUN"` and is documented "Never reports a
  live rollback PASS".

**What `rollbackSucceeded` currently means.** `apply-orchestration.mjs:114-124`
sets it to `true` as soon as the four restore calls return. No live byte
comparison occurs. A restore to the WRONG state is reported as success, because
nothing checks the result.

**Whether live state is verified after rollback.** No. The only post-restore
check is `openclaw config validate`, which validates the installed config
against the current policy. It cannot detect that the config is a superseded
baseline, and it says nothing about the native artifacts or the plugin roster.

**Consequence.** A mid-apply failure today yields a runtime carrying the
2026-09-11 T1 config, no governance extension, and an unpatched native runtime
— reported as `rollbackSucceeded: true`. This is the incident class, reproduced
by design.

## 3. Transaction snapshot contract

A transaction-scoped pre-mutation snapshot represents the EXACT live runtime
state immediately before this apply. It is never the r12/T1 baseline, the
repository checkout, a generic historical backup, or a stale quarantine copy.

`backups/r12` is neither deleted nor repurposed. It remains available as
historical recovery evidence and is still written by `createRuntimeBackup`.

The snapshot covers every component the apply can mutate:

- `openclaw.json` (bytes and mode);
- every governance extension file the apply may replace (bytes and mode);
- the native selection artifact;
- the native bridge artifact, including the absent case;
- the native announce artifact;
- per-file digests, plus a manifest binding the whole set.

`backups/r12` is never a rollback target for the transaction path.

## 4. Mutation gate

The apply MUST NOT enter mutation unless the transaction snapshot has been
created, fully materialized, hashed, internally consistent, and independently
re-readable. Snapshot creation or verification failure stops BEFORE mutation: no
`--apply`, no native mutation, no quarantine move, no gateway restart, and a
classified failure stating that rollback safety could not be established.

The snapshot stays recoverable until apply success is confirmed.

## 5. Rollback state machine

```text
PRECHECK
→ TRANSACTION SNAPSHOT VERIFIED
→ MUTATION STARTED
→ APPLY
→ SUCCESS
```

or

```text
PRECHECK
→ TRANSACTION SNAPSHOT VERIFIED
→ MUTATION STARTED
→ APPLY FAILURE
→ ROLLBACK TRANSACTION PREIMAGE
→ LIVE RESTORE VALIDATION
→ ROLLBACK SUCCESS / ROLLBACK FAILURE
```

Rollback is never marked successful merely because the restore function
returned.

## 6. Live restore validation

After rollback the actual live runtime is verified. At minimum: `openclaw.json`
hash, governance extension hashes, native selection hash, native bridge hash,
plugin configuration, governance plugin presence, expected plugin roster, and
relevant runtime metadata.

Byte identity is the contract wherever the snapshot recorded bytes. Where byte
identity is not sufficient, an explicit semantic health check is used.

Only after every check passes may `rollbackSucceeded = true` be emitted. If any
verification fails, `rollbackSucceeded = false` and the result preserves the
original apply error, the rollback error, and the restore-validation error
independently. They are never collapsed into one message.

## 7. Gateway / config watcher

A completed config restore is not treated as a restored runtime. The rollback
validator observes the resulting gateway state after any watcher or supervisor
restart. No unnecessary restart is introduced.

## 8. Test architecture

Correctness is proven through an injectable orchestration seam, without live
WSL. The suite covers snapshot creation, snapshot-failure and
snapshot-verification-failure both blocking mutation, snapshot retention until
success, first/middle/native/config mutation failures, gateway restart failure,
restore-returns-but-validation-fails, all-hashes-match success, independent
preservation of original and rollback errors, deterministic repeated rollback,
`backups/r12` remaining untouched, and no destructive operation when mutation
never started.

## 9. Falsification

The incident defect is recreated: with an R7-shaped pre-apply runtime, the old
T1/r12 rollback target does NOT satisfy the transaction contract, and the exact
R7 preimage is restored instead. The false positive is falsified directly —
restore helper returns while the live runtime differs, so
`rollbackSucceeded = false`.

## 10. Allowed scope

- `integrations/openclaw/topology/lib/transaction-snapshot.mjs` (new) — the
  transaction snapshot create/verify/restore/validate operations.
- `integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs`
  — the state machine, mutation gate and rollback validation wiring.
- `integrations/openclaw/topology/fixtures/runtime-regression/operator-apply.mjs`
  — dependency injection and wiring of the transaction snapshot.
- `integrations/openclaw/topology/lib/runtime-backup.mjs` — only where required
  to keep `backups/r12` intact and non-repurposed.
- `tests/**`, `package.json`, `PLAN.md`, this contract.

## 11. Excluded scope

R11 is repository-only. No deployment, no live `operator-apply`, no live
rollback, no second deployment attempt.

Unchanged: the R10 G1 contract, G2 cause preservation, G3 advisory BLOCKED
behaviour, R6 approval semantics, R8 provenance allowlist semantics,
`configure.mjs` asset comparison semantics, and production ledger semantics.

The two R10 predecessor allowlist digests are NOT added in R11.
`backups/r12` is neither deleted nor repurposed. `ACTIVE.md` is kept.

## 12. Acceptance criteria

- The apply cannot enter mutation without a verified transaction snapshot.
- A snapshot failure or verification failure yields zero mutation and a
  classified rollback-safety failure.
- Rollback restores the exact transaction preimage, not the T1/r12 baseline.
- `rollbackSucceeded` is emitted only after live restore validation passes.
- A restore that returns while the live runtime differs yields
  `rollbackSucceeded = false`.
- Original, rollback, and restore-validation errors are preserved separately.
- `backups/r12` is untouched by the transaction path.
- No destructive operation runs when mutation never started.
- Focused and full repository validation pass; `git diff --check` is clean.

## 13. Handoff

Repository remediation only. Do not deploy, do not run live `operator-apply`,
do not restart OpenClaw, gateway or WSL, do not run a live heartbeat, do not
create a Discord ledger task, and do not add the R10 allowlist entries. Commits
are local and unpushed. R11 is not closed under this contract.

---

# Historical: M8/T2.2-R10 (superseded as the active revision, work committed)

R10's commit `3bea651` stands and its G1 contract remains in force. It is
retained below unchanged as history.

## R10 header

Task ID: M8/T2.2
Plan Revision: M8/T2.2-R10
Planning Readiness: APPROVED
Execution Authorization: YES
Deployment Authorized: NO

## 1. Objective

Make the G1 pure-liveness heartbeat exemption observable and enforceable at the
real seam, `enterNativeRun`, using only data the host already provides there. No
Discord-layer patch, no forwarded message objects, no synthesized fields.

## 2. Owner decision recorded

G1 uses the **host-authoritative heartbeat trigger** as its primary
discriminator. The previous content-only predicate is retired because it is
inert in production: the native patch never passed `content` or `message`.

## 3. G1 contract

A run qualifies as a pure-liveness heartbeat only when ALL hold:

1. `trigger === "heartbeat"` — the host-assigned discriminator.
2. Self-keyed session: `sessionKey === "agent:" + agentId + ":" + agentId`.
3. The exact sentinel `[OpenClaw heartbeat poll]` is present in the canonical
   host-provided heartbeat input representation (`transcriptPrompt`, or `prompt`).
4. No `inputProvenance` — not an inter-session or continuation run.
5. Not Discord ingress — no `:discord:` in the session key and no `discord`
   channel in `channelId` / `channel` / `messageChannel` / `messageProvider`.

**Retired:** the former conditions "no mentions" and "not bot-author". Those
fields do not exist at the native admission anchor — `mentions` is produced only
in the Discord ingress layer (`accounts-CT0uPrw7.js:228-290`,
`bot-CS65Z7r1.js:5137`) and no run-scoped bot-author field exists at all. They
are NOT replaced by `mentions === undefined` or `isBot === undefined`, which
would recreate the false confidence of R9.

**Why this is sufficiently attributable.** `trigger` is host-assigned, never
content-derived, and single-sourced: `agent-runner.runtime-BUWW8f6n.js:3092` and
`reply-usage-state-BKK3wzWk.js:1510,1958,2090` compute
`trigger: opts?.isHeartbeat === true ? "heartbeat" : "user"`, a strict binary.
`isHeartbeat: true` is assigned in exactly one place in the installed
`v2026.6.34` bundle — `heartbeat-runner-BTpzFMjQ.js:1320`, inside the heartbeat
scheduler. Every other occurrence is a read. The content-based
`isHeartbeatUserMessage()` (`heartbeat-filter-D8UEwGGH.js:170`) does match the
sentinel, but it is a transcript-artifact filter used by diagnostics, memory
indexing and transcript pathing; it never sets `isHeartbeat` on a run. Therefore
a Discord message containing the sentinel cannot become a heartbeat, and an
arbitrary self-keyed internal run cannot qualify merely by carrying a `runId`.

Discord ingress remains independently required, so a heartbeat-shaped run that
also arrived over Discord is still refused.

## 4. Allowed scope

- `integrations/openclaw/topology/lib/native-boundary.mjs` — forward `trigger`
  and `transcriptPrompt` in the governance context.
- `integrations/openclaw/topology/lib/native-patch.mjs` — pass
  `params.trigger` and `params.transcriptPrompt` at the existing anchor. No new
  upstream fields, no Discord-layer patch.
- `integrations/openclaw/plugins/zink-governance/index.mjs` — the G1 predicate
  and its two call sites.
- `tests/**`, `package.json`, `PLAN.md`, this contract.

## 5. Excluded scope

`classifyInternalRunEnd` is not modified. No new ledger abstraction. G2, G3
advisory behaviour, native-boundary enforcement, R6 approval semantics, the
operator-apply mutation gate, preflight semantics and the asset allowlist are
all unchanged. No deployment, no live test, no ledger write.

## 6. Acceptance criteria

- The real heartbeat qualifies and is admitted with `{ allow: true }`.
- A self-keyed run with `trigger !== "heartbeat"` does not qualify.
- A Discord or user message containing the sentinel does not qualify.
- An inter-session run with a heartbeat-shaped payload does not qualify.
- A missing or alternative trigger does not qualify.
- Removing the trigger, the sentinel, or the self-keyed session each alone
  revokes the exemption.
- At least one test enters through the production injection contract.
- G2, G3, R6 and deployment-safety suites unchanged and passing.

## 7. Handoff

Repository remediation only. Do not deploy, do not run live `operator-apply`,
do not restart OpenClaw, gateway or WSL, do not run a live heartbeat, and do not
create a Discord ledger task. Commits are local and unpushed.



## 1. Objective

Close the single verified provenance gap that stops `configure.mjs --preflight`
from recognizing the restored pre-incident R5 governance extension, and prove
the preflight deadlock is removed.

R8 is repository-only: no deployment, no `--apply`, no native mutation, no
gateway restart, no ledger write. A passing preflight is the terminal condition.

## 2. Proven root cause

`configure.mjs:581-591` accepts a deployed asset only when it is missing, equal
to the current build, or an approved predecessor digest. The restored R5
extension differs from the current build in exactly one governed asset:

- `lib/native-boundary.mjs` — R5 `49352d47ac88798cc…` vs current `33b3feef…`

R7 changed only that file, so no approved-predecessor entry exists for it and
the preflight refuses with `Governance plugin asset drift detected`.

Established by packaging, not inference: materializing `governancePluginFiles()`
from the R5-era tree at commit `9713872` reproduces all 33 deployed R5 asset
bytes exactly (0 mismatches, 0 absent). Of the 31 paths in `pluginFiles.assets`,
27 have R5 bytes identical to the current build and are already accepted by
content comparison, and 3 are already allowlisted. Exactly one digest is missing.

`index.mjs` and `package.json` are governed by their own assertions and are
deliberately not added to this table.

## 3. Allowed scope

- `integrations/openclaw/configure.mjs` — the `ALLOWED_GOVERNANCE_ASSET_SHA256`
  data table only. No logic, ordering, path-semantics or validation-order change.
- `tests/**` and `package.json` (test registration only).
- `PLAN.md` and this contract.

## 4. Excluded scope

- Preflight semantics, validation order, digest-comparison strength and runtime
  config semantics: unchanged.
- R6 approval semantics, `WORKFLOW_APPROVAL_REQUESTED`, canonical version,
  reducer semantics and historical event interpretation: unchanged.
- G1 heartbeat exemption, G2 cause preservation, G3 advisory BLOCKED context and
  the operator-apply mutation gate: unchanged.
- Live `openclaw.json`, WSL, gateway, native runtime artifacts, the production
  ledger and the quarantined runtime: untouched.

## 5. Acceptance criteria

- Exactly one digest is added, byte-exact against the verified R5 artifact.
- Every existing approved predecessor and the current-build acceptance path are
  preserved.
- An unknown asset, a one-byte-modified R5 asset, and the R5 digest at a wrong
  path are all still rejected.
- `configure.mjs --preflight` against the restored R5 runtime returns
  `builder_preflight: PASS` with `installed_mutation: false`.
- No `--apply`, no operator-apply, no gateway restart, no ledger write.

## 6. Required validation gates

```text
node --test tests/m8-t2.6-r8-asset-provenance.test.mjs tests/m7-t1-openclaw.test.mjs
npm test
npm run lint
npm run format:check
npm run repo:check
git diff --check
```

## 7. Handoff / transition rules

- **R8 does not deploy.** Do not run `--apply`, `operator-apply.mjs`,
  `apply-r5.sh`, any native mutation, any gateway restart, or any live test.
- Commits are local. Nothing is pushed.
- R7 is not closed and this contract is not deleted under R8.

---

# Historical: M8/T2.2-R7 (superseded as the active revision, work committed)

R7 remains valid history and its commits stand. It is retained below unchanged.

## 1. Objective

Close three independently proven defects, without deploying:

- **G1** — an OpenClaw heartbeat poll has no valid governance admission model, so
  every heartbeat has failed closed since 2026-09-11T23:51:55+07:00.
- **G2** — `native-boundary.mjs` discards the original failure, so 2 397 log
  lines across 19 days reported one undiagnosable string.
- **G3** — `before_prompt_build()` converts an unresolvable governed run into a
  degraded prompt context and lets it proceed as though governance had completed.
- **DS** — `operator-apply.mjs` runs a full destructive rollback after a
  preflight failure that mutated nothing.

Prerequisite: the forensic audit of 2026-09-30 (read-only) is accepted evidence.

## 2. Proven root causes

| ID | Location | Fault |
| --- | --- | --- |
| G1 | `plugins/zink-governance/index.mjs:3592` → `guard.mjs:979` | `classifyInternalRunEnd` refuses the internal exemption when a `runId` is present; the heartbeat is not Discord ingress; `awaitSpawnReceipt` returns without a ledger match; `guard.beforeRun` then asserts `candidates.length === 1` with 0 candidates and throws `EXECUTION_STATE_UNKNOWN`. The ledger contains zero records addressable by `agent:main:main`. |
| G2 | `topology/lib/native-boundary.mjs:315` | Bare `catch {}` replaces both `GOVERNANCE_DENIED` and genuine faults with `GOVERNANCE_RUN_UNAVAILABLE`, destroying `.message` and `.cause`. |
| G3 | `plugins/zink-governance/index.mjs:4619-4627` | Catch returns `prependContext` "… report BLOCKED" and the run continues. |
| DS | `topology/fixtures/runtime-regression/operator-apply.mjs:138` | Rollback is gated on `if (identifiers)`, which is assigned at line 106 *before* the builder runs. It is a read-succeeded flag, not a mutation-started flag. |

DS is provably zero-mutation on preflight failure: `configure.mjs:664-669`
returns for `mode === "preflight"` before the first mutating call at
`configure.mjs:670`, and all validation (including every `Policy drift` assert at
`lib/policy.mjs:1233`) runs at lines ≤ 662 identically in both modes.

## 3. G1 contract decision — Option A, INTERNAL / EXEMPT

The owner selected Option A. Contract text:

> A pure liveness heartbeat poll is an internal, governance-exempt run. It
> requires no ledger task and no ledger session, and no ledger task or session is
> fabricated for it. Admission for a qualifying run returns `{ allow: true }`.

Exact scope of the exemption — a run qualifies only when **all** hold:

1. `sessionKey === "agent:" + agentId + ":" + agentId` (self-keyed); and
2. the inbound content is exactly the sentinel `[OpenClaw heartbeat poll]`; and
3. there is no `inputProvenance` (not an inter-session or continuation run); and
4. the run is not Discord ingress (no `:discord:` in `sessionKey`, and no
   `discord` channel id in `channelId` / `channel` / `messageChannel` /
   `messageProvider`); and
5. it presents no `mentions` and is not `isBot`.

The exemption is bounded by its inverse. A run that does not satisfy every clause
above receives no exemption and continues through the existing governed path. In
particular an arbitrary `agent:main:main` run, a self-keyed run carrying user
work, tool calls, artifact production or channel delivery, and any Discord
ingress run are all unaffected.

No new ledger abstraction is introduced for heartbeat liveness.

## 4. Allowed scope

- `integrations/openclaw/topology/lib/native-boundary.mjs` — G2.
- `integrations/openclaw/plugins/zink-governance/index.mjs` — G1, G3.
- `integrations/openclaw/topology/fixtures/runtime-regression/operator-apply.mjs` — DS.
- `integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs`
  — new, only to give DS an injectable seam.
- `tests/**` and `package.json` (test registration only).
- `PLAN.md` and this contract.

## 5. Excluded scope

- R6 semantics: `WORKFLOW_APPROVAL_REQUESTED`, `GOVERNANCE_VERSION` and canonical
  version semantics, ledger meaning, reducer semantics, and the interpretation of
  historical events are unchanged unless a test proves a direct dependency.
- `classifyInternalRunEnd` is not modified.
- No change to `guard.mjs`, `workflow.mjs`, `native-patch.mjs`,
  `runtime-backup.mjs`, `configure.mjs`, or `openclaw.json`.
- No dependency or lockfile change.
- No deployment architecture redesign beyond the DS seam.

## 6. Change impact

- Heartbeat admission changes from unconditional rejection to unconditional
  allowance for the exact sentinel only.
- `before_prompt_build` changes from fail-open-with-degraded-context to
  fail-closed for unresolvable governed runs.
- `enterNativeRun` host-visible message is unchanged; `.cause` is added.
- Apply failure reporting gains structured fields; the CLI JSON shape changes.

## 7. Required context / persistent contracts

- `AGENTS.md` — repository authority, safety, decision boundary.
- `docs/contracts/execution/README.md` — execution contract protocol.
- `integrations/openclaw/topology/policy/reason-code-matrix.json` —
  `EXECUTION_STATE_UNKNOWN` is a `BLOCKED` outcome reason, not a fault class.
- The archived pre-R7 findings backlog:
  `docs/contracts/m7-m8-red-team-backlog.md` (non-authoritative; retained so the
  superseded git-ignored backlog is not lost).

## 8. Implementation details / ordered steps

1. Archive the superseded backlog; materialize this contract; synchronize `PLAN.md`.
2. G2: in `enterNativeRun`, attach `cause` to `GOVERNANCE_RUN_UNAVAILABLE` and log
   the fixed error message via the existing `[zink-native-gate]` pattern. Log
   `err.message` only — never `err.stack`, context objects, message content, or
   session identifiers.
3. G1: add one narrowly scoped predicate and consult it in the plugin `beforeRun`
   before the `classifyInternalRunEnd` branch. Return `{ allow: true }` on a
   qualifying heartbeat. Change nothing else in that hook.
4. G3: in `before_prompt_build`, exempt a qualifying heartbeat from the ledger
   read, and fail closed for every other unresolvable run instead of returning a
   degraded context.
5. DS: run the existing `configure.mjs --preflight` before `--apply`; replace the
   `identifiers` gate with a real `mutationStarted` flag; emit the structured
   failure fields, classifying through the existing `operator-preflight.mjs`
   allowlist so no raw child stderr is disclosed.
6. Register any new test file in `package.json` `scripts.test`.

## 9. Acceptance criteria / Definition of Done

- A qualifying heartbeat poll is admitted with `{ allow: true }` and writes
  nothing to the ledger.
- A self-keyed `agent:main:main` run that is not the sentinel is NOT exempt and
  fails closed.
- A Discord ingress run behaves exactly as before.
- A genuinely governed run still receives its receipt from `before_prompt_build`.
- An unresolvable governed run no longer receives a degraded prepend context.
- `enterNativeRun` rejects with `message === "GOVERNANCE_RUN_UNAVAILABLE"` and a
  `.cause` that distinguishes `GOVERNANCE_DENIED` from `EXECUTION_STATE_UNKNOWN`.
- A preflight failure performs no rollback, no native restore, no runtime-file
  restore, no quarantine move, no gateway restart, and no config replacement.
- A failure after mutation begins still rolls back, and a rollback failure is
  reported alongside the original failure.
- Focused tests and the full repository gate pass; `git diff --check` is clean.

## 10. Required validation gates

```text
node --test <focused suites>
npm test
npm run lint
npm run format:check
npm run repo:check
git diff --check
```

A required gate that cannot run is reported `NOT RUN`, never as a pass.

## 11. Documentation requirements

Synchronize only `PLAN.md` (lifecycle state) and this contract. `CHANGELOG.md`
records validated completed history only and is not updated by this contract.
`README.md` is unchanged: no user- or operator-visible behavior changes.

## 12. Handoff / transition rules

- **Deployment is NOT authorized.** Do not run `apply-r5.sh`, do not invoke
  `operator-apply.mjs` against the live runtime, do not start, stop or restart
  OpenClaw, the gateway, or WSL, do not modify live `openclaw.json`, and do not
  restore, migrate, or write the production ledger.
- Commits are local. Nothing is pushed under this contract.
- On completion: Codex validates, then updates `PLAN.md`, sets
  `Execution Authorization: NO`, sets `Execution Contract: NONE`, deletes this
  file, and leaves a clean working tree.
- The quarantined runtime and the r12 backup are left exactly as found. Any
  future restoration is a separate owner decision.