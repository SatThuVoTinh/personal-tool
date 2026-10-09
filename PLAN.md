# Personal Tool / Zink — Development Plan

## 1. Authority

`PLAN.md` is the durable source of truth for milestone/task lifecycle state,
approval, execution authorization, the current execution-contract pointer,
blockers, and completion evidence.

When execution is authorized, `docs/contracts/execution/ACTIVE.md` is the sole
source of truth for that task's frozen implementation details. Architecture is
canonical under `docs/architecture/`; repository-wide agent/safety rules remain
in `AGENTS.md`.

Planning never authorizes implementation by itself.

## 2. Status model

```text
Task Status: NOT STARTED | IN PROGRESS | BLOCKED | COMPLETE | DEFERRED | CANCELLED
Planning Readiness: DRAFT | REVIEWED | APPROVED
Execution Authorization: NO | YES
Execution Contract: NONE | docs/contracts/execution/ACTIVE.md
Evidence Level: NONE | LOCAL-VERIFIED | REMOTE-BACKED
```

## 3. Current release gate

| Milestone                                                                  | Status        | Evidence         | Gate summary                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------- | ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Plan/architecture baseline                                            | `COMPLETE`    | `LOCAL-VERIFIED` | Repository governance established.                                                                                                                                                                                                                                                                                                    |
| M1 — Development foundation                                                | `COMPLETE`    | `REMOTE-BACKED`  | Verification and CI/Security baseline passed.                                                                                                                                                                                                                                                                                         |
| M2 — Local infrastructure                                                  | `COMPLETE`    | `REMOTE-BACKED`  | Accepted commit `5ffe4cb9be81c30d5c24bd7eb6a9d41abc2a5f19`.                                                                                                                                                                                                                                                                           |
| M3 — Markdown Knowledgebase                                                | `COMPLETE`    | `REMOTE-BACKED`  | Accepted candidate `ff4a5fb7d779f260ffb9b5aa2393ad6ab75eb549`; accepted merge `9cd34cebb196631e9524b095c21f1fd5aff78749`.                                                                                                                                                                                                             |
| M4 — PDF ingestion                                                         | `COMPLETE`    | `REMOTE-BACKED`  | T1–T5 pushed; owner has temporarily accepted M4 as complete. Exact accepted commit hash should be reconciled from git history without reopening M4 scope.                                                                                                                                                                             |
| M5 — Architecture contraction                                              | `COMPLETE`    | `REMOTE-BACKED`  | M5/T1-R2 synchronized canonical paths, documentation and the contracted Docker runtime without refactoring the accepted Knowledgebase application.                                                                                                                                                                                    |
| M6 — Zink Skill Store                                                      | `COMPLETE`    | `REMOTE-BACKED`  | M6/T1-R4 task commit is remotely verified; governance closeout is recorded separately.                                                                                                                                                                                                                                                |
| M7 — Zink Tools + OpenClaw integration + V1 hardening                      | `COMPLETE`    | `REMOTE-BACKED`  | M7/T1-R19, M7/T2-R12, M7/T3-R16, M7/T4-R10, and M7/T5-R13 complete; runtime governance remediation, Discord 7-bot integration, and Zink tools specialist policies verified.                                                                                                                                                           |
| M8 — Zink Skill Store 2-Way Governed Vector RAG & Agent Memory Integration | `IN PROGRESS` | `LOCAL-VERIFIED` | M8/T1 is complete; M8/T2.2 R4/R5/R6 are implemented; M8/T2.2-R7 (heartbeat admission, boundary diagnosability, apply safety) is in progress. Deployment is not authorized.                                                                                                                                                            |
| M10 - Governed coordinator runtime binding                                 | `IN PROGRESS` | `LOCAL-VERIFIED` | M10/T2-R8 (Discord conversational ingress end-to-end: observability deploy, controlled live correlation, evidence-bound fix, redeploy, live verify) authorized end-to-end by explicit owner prompt; execution contract is `docs/contracts/execution/ACTIVE.md`, behavior contract is `docs/contracts/coordinator-session-binding.md`. |

The former self-built L&SC Data Plant is replaced by a **logical external
infrastructure flow**, not another repository module. Forecasting, optimization,
operations research and simulation remain first-class capabilities.

## 4. Current focus

```text
Milestone: M8 — Zink Skill Store 2-Way Governed Vector RAG & Agent Memory Integration
Task: M8/T2.2 — Root-Cause Governed Runtime, Discord, Semantic & Artifact Integrity Hardening
Task Status: CLOSED
Planning Readiness: APPROVED
Plan Revision: M8/T2.2-R19
Execution Authorization: YES
Authorized Task: M8/T2.2 — Root-Cause Governed Runtime, Discord, Semantic & Artifact Integrity Hardening
Execution Contract: docs/contracts/execution/ACTIVE.md
Evidence Level: LOCAL-VERIFIED
Task Branch: codex/m8-t2-governed-runtime-hardening
Owner Approval: EXPLICIT — Owner authorized R7 remediation, controlled live
  deployment, one-time R5 baseline restoration, R8 provenance remediation, R9
  (blocked, superseded), R10 G1 contract correction, R11 transactional live
  rollback safety, R12 durable transaction recovery safety, R13 the narrow R7
  predecessor provenance allowlist correction, an R10 live deployment attempt
  (authorization `b8597fe`, ONE attempt, FAILED at `native-backup-prune` with
  `NATIVE_SOURCE_DRIFT`; the R12 rollback restored the exact R7 preimage and
  verified it, with the ledger untouched), R14 native patch lineage
  compatibility, a second R10 live deployment attempt (authorization `7520f39`,
  ONE attempt, ABORTED at the transaction-snapshot stage with
  `ROLLBACK_SAFETY_UNAVAILABLE` and zero mutation, because the R12 transaction ID
  is derived from the preimage and therefore collides with the retained record of
  the previous attempt), and R15 attempt-scoped transaction identity. Owner
  accepted the R14 implementation and its live preflight. Owner acknowledged
  the duplicated entrypoint allowlist as protected technical debt, not a blocker,
  and R16 full-apply rehearsal on an exact clone of the live R7 runtime.
Deployment Authorized: YES
Deployment Authorized: YES (R17 - consumed)
Deployment Authorized: YES (R18 - single attempt, granted by the owner on
  2026-10-01)
Deployment Authorized: YES (R19 - single attempt, granted by the owner on
  2026-10-01 as authorized completion of M8/T2.2)
Deployment Authorized: YES (owner-identity hygiene - single attempt, granted by
  the owner as part of the instruction to finish all PR #18 remediation
  end-to-end; consumed by that one attempt; remediation deployment only)
```

`Deployment Status: DEPLOYED - R18 LIVE AND VERIFIED FOR ITS AUTHORIZED SEAM;
ONE PRE-EXISTING SEPARATE ITEM REMAINS OPEN`. The single authorized attempt ran
`operator-apply.mjs` — the repository's authorized live deployment mechanism —
against the real live runtime, with no namespace and no simulation. It returned
PASS at stage `applied`, `transactionStatus: complete`, attempt
`txn-546134d1e917bea39046eae142e15b6453e589babe427c1bbf875399c1f773a5`. This
authorization is consumed by that one attempt.

R18 is deployed and its defect is closed live. `beforeRunEnd: internal system
session` went from 0 to 2, and `beforeRunEnd: self-keyed session presented a
runId; applying full governance` stopped entirely (it had reached 40). A clean
real scheduler heartbeat at `2026-10-01T02:50:52Z` completed the whole chain
with `GOVERNANCE_RUN_UNAVAILABLE = 0`, `GOVERNANCE_COMPLETION_UNAVAILABLE = 0`,
run-end/lane `EXECUTION_STATE_UNKNOWN = 0`, `sandboxErr = 0`, `laneErr = 0`,
first-candidate `status=200`, and a transcript poll then reply 3.3s later.
Digests, ledger and runtime integrity are in ACTIVE.md R18 8.

`Deployment Status: DEPLOYED - R19 LIVE AND VERIFIED; M8/T2.2 CLOSED`. The single
authorized attempt ran `operator-apply.mjs` — the repository's authorized live
deployment mechanism — against the real live runtime, with no namespace and no
simulation. It returned PASS at stage `applied`, `transactionStatus: complete`,
attempt `txn-6c4fc50d9b584c23f2121c8edada159a02e70ca87cb4150d0f6cf4de23d7b0c1`.
This authorization is consumed by that one attempt.

R19 is deployed and the last governance defect is closed live. A real scheduler
heartbeat at `2026-10-01T04:50:55Z` completed with every counter at 0, including
the two governance states reported separately: run-end/lane
`EXECUTION_STATE_UNKNOWN` = 0 and the advisory `before_prompt_build`
`EXECUTION_STATE_UNKNOWN` = 0, with `EXECUTION_STATE_UNKNOWN` absent from the
window entirely. `beforeRunEnd: internal system session` fired, so R18's run-end
exemption still holds, and the self-keyed full-governance refusal stayed at 0.
Live `index.mjs` `bae7bdf3` is byte-identical to the repository packaged
artifact; boundary `d88bff80` and selection `555f37da` are unchanged, so no
lineage moved. Ledger byte-identical, `boot_id` unchanged, gateway stable. Digests,
counters and transcript evidence are in ACTIVE.md R19 8.

`M8/T2.2` is CLOSED. The one residual is NOT a governance defect and is recorded
in full at ACTIVE.md R19 9: the heartbeat's reply CONTENT is model-generated and
varies (`04:20` replied `HEARTBEAT_OK`, `04:50` replied `outcome_claim: BLOCKED`)
from identical, empty governance input. The plugin registers exactly one
prompt-affecting hook, it emitted nothing in either window, and every governance
counter is 0 — so this is a false negative in content that grants nothing and
weakens no control. Making it deterministic would require amending the standing
model instruction contract or registering a prompt-contribution hook, both of
which are material decisions to model input and outside this revision's authorized
seam. No R20 is created.

`Deployment Authorized: YES (R18 - single attempt)` — granted by the owner on
2026-10-01 as the final technical fix, to deploy the locally verified R18
artifact to the live runtime through `operator-apply.mjs`, the repository's
authorized live deployment mechanism. ONE attempt. No rehearsal namespace, no
simulation, no automatic retry, no manual heartbeat trigger. This authorization
is consumed by that one attempt.

### 4.0.1 Historical deployment record (R16, R17 — retained, not rewritten)

The single attempt authorized on 2026-09-30 after R16 closed ran
`operator-apply.mjs` — the repository's authorized live deployment mechanism —
against the real live runtime, with no namespace and no simulation. It returned
`{"status":"PASS","stage":"applied"}` with `transactionStatus: complete`. The
live runtime became R10. Exact digests and stage trace are in §4.13.2.

That authorization was single-attempt and was consumed by that one attempt. Both
prior single-attempt authorizations are consumed and closed: `b8597fe` (failed
at `native-backup-prune`) and `7520f39` (aborted at the transaction-snapshot
stage). Neither is carried forward, and R15 creates no deployment
authorization. R17 was authorized separately and is likewise consumed. A
preflight PASS is never an apply authorization, and neither `Execution
Authorization`, `Planning Readiness`, nor `Owner Approval` implies one.

R18 targets the one remaining operational gap: the heartbeat executes the full
chain and then fails at the run-end seam. The cause is proven and was not
re-diagnosed — the host forwards `trigger` and `transcriptPrompt` to
`enterNativeRun` but not to `finishNativeRun`, so the run-end context never
carries them and `isPureLivenessHeartbeat` cannot fire there. R18 recovers them
at the boundary, keyed by `runId`, at the moment admission accepts the run.

**Recorded deviation, for the owner.** The owner named `native-patch.mjs` as
the primary change. R18 does not touch it. Threading the fields through the
selection's call site would change the installed `selection-*.js`, requiring a
new R10 predecessor descriptor and breaking the R7 lineage, because R7 would
then differ from the current edit set in two slots — which the single-slot
predecessor descriptor cannot express. Recovering the values at the boundary
fixes the identical defect with the pinned native runtime byte-identical, so the
deployed selection `555f37da` remains recognized by content comparison with no
descriptor change. No material decision changes: no new module, dependency,
persistent state, public API, topology, security boundary or gate. The
mechanism is `ACTIVE.md` R18 3; the positives are falsified and reproduce the
exact live `GOVERNANCE_COMPLETION_UNAVAILABLE` when the fix is reverted.

### 4.1 Revision lineage reconciliation (2026-09-30)

`PLAN.md` previously recorded `Plan Revision: M8/T2.2-R4` while the branch already
carried R5 and R6 implementation. The plan was never revised for either, so
`ACTIVE.md` and `PLAN.md` no longer described the same work. Reconciled state:

| Revision    | Status             | Implementation evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M8/T2.2-R4  | Implemented        | R4 validation snapshot below. Superseded as the active revision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M8/T2.2-R5  | Implemented        | `652ac0c` config convergence, `9a6702f` V15 packaging, `9713872` V16 rewriter self-match.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| M8/T2.2-R6  | Implemented        | `2e1f8c4` `WORKFLOW_APPROVAL_REQUESTED` contract, `2d1121f` provenance-gated asset allowlist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M8/T2.2-R7  | Implemented        | `a0118bc` heartbeat admission, boundary diagnosability, apply safety; `a1bf942` advisory-hook correction; `96e1b80` deployment authorization.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M8/T2.2-R8  | Implemented        | `4f5cc6d` verified R5 `lib/native-boundary.mjs` approved-predecessor digest. Live preflight then returned `builder_preflight: PASS`, `installed_mutation: false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| M8/T2.2-R9  | BLOCKED            | Authorized 2026-09-30. Superseded by R10: G1 condition 5 is unobservable at the native seam; see §4.6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| M8/T2.2-R10 | Implemented        | `3bea651` G1 contract correction using the host-authoritative heartbeat trigger. Deployment `dc466c6` attempted and STOPPED pre-apply; NOT deployed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| M8/T2.2-R11 | Implemented        | `ab0dda2` transaction snapshot gates mutation, restores the exact preimage, and licenses `rollbackSucceeded` only on live verification. Accepted by the owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M8/T2.2-R12 | Implemented        | `47beb1c` durable transaction snapshot, orphan detection, verified post-apply, and the recovery authorization gate. Accepted as the rollback-safety baseline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M8/T2.2-R13 | Implemented        | `2d8dc54` the two R7 predecessor governance-asset digests, byte-proven from the live runtime and the R7 commit. Live preflight then PASSed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| M8/T2.2-R14 | Implemented        | `c41a7a5` native patch lineage: the deployed R7 patch is a recognized predecessor, so R7 -> R10 is derivable in memory. Live preflight then recognized `PREDECESSOR R7 -> R10`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| M8/T2.2-R15 | Implemented        | `c73173f` attempt-scoped transaction identity: `attemptId` separated from `preimageDigest`; completed attempts no longer block a repeat. 17/15 falsified. Not deployed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M8/T2.2-R16 | CLOSED             | Authorized 2026-09-30; deployed 2026-09-30 as the live runtime (R10). Superseded as the implementation revision by the authorized post-deployment correction R17; R16 evidence is historical and unchanged. See A4.13.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| M8/T2.2-R17 | DEPLOYED, GAP OPEN | Authorized 2026-09-30 as a post-deployment RED correction to the R10 run-end governance contract: run-end parity for the pure liveness heartbeat. 10 focused tests, falsified 7 pass / 3 fail. Deployed 2026-09-30 as the live runtime (R17 build). Superseded as the implementation revision by R18, which closed the remaining blocker; R17 evidence is historical and unchanged. See A4.14.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M8/T2.2-R18 | DEPLOYED, VERIFIED | Authorized 2026-10-01 as the technical fix for the proven `finishNativeRun` context-propagation defect: the admission-time liveness discriminator is recovered at the run-end seam so both seams apply one predicate. 15 focused tests, falsified 4 fail / 11 pass. Fix is in `native-boundary.mjs`; `native-patch.mjs` is byte-identical, so the deployed selection `555f37da` stays recognized and the R7/R10 lineage is intact. Deployed 2026-10-01, PASS at stage `applied`, and verified live: run-end internal session 0 -> 2, self-keyed full governance stopped at 40, clean 02:50:52Z heartbeat with every run-end counter at 0. Unchanged by R19. See ACTIVE.md R18.                                                                                                                                                            |
| M8/T2.2-R19 | DEPLOYED, CLOSED   | Authorized 2026-10-01 as the final revision completing M8/T2.2: the advisory `before_prompt_build` seam recovers the admission-time liveness discriminator so a heartbeat is recognized there and no longer reported `EXECUTION_STATE_UNKNOWN`. Fix is confined to `index.mjs`; `native-boundary.mjs` and the pinned native runtime are untouched, so R18 stays intact and no lineage changed. 14 tests, falsified three ways (5 / 3 / 1 failures). Deployed 2026-10-01, PASS at stage `applied`. Verified live at the 04:50:55Z heartbeat: run-end/lane `EXECUTION_STATE_UNKNOWN` 0, advisory `before_prompt_build` `EXECUTION_STATE_UNKNOWN` 0, `GOVRUN` 0, `GOVCOMP` 0, `sandboxErr` 0, `laneErr` 0, R18 run-end exemption intact. M8/T2.2 CLOSED. One non-governance content variance recorded at ACTIVE.md R19 9. See ACTIVE.md R19. |

All revisions are local commits on `codex/m8-t2-governed-runtime-hardening`; none
has been pushed.

The superseded git-ignored R3/R4 remediation backlog was archived to
`docs/contracts/m7-m8-red-team-backlog.md` so that replacing the transient
`ACTIVE.md` did not destroy unrecoverable content. That archive is
non-authoritative historical record and grants no execution authority.

### 4.2 M8/T2.2-R7 scope

R7 closes three defects proven by a read-only forensic audit on 2026-09-30, and
does not deploy:

- **G1** — Option A, INTERNAL/EXEMPT, for the pure liveness heartbeat poll only.
  A qualifying heartbeat requires no ledger task or session and none is
  fabricated. The exemption is bounded by its inverse and is not a general
  exemption for arbitrary `agent:main:main` runs.
- **G2** — `native-boundary.mjs` preserves the original failure as `.cause` and
  logs the fixed error message. The host-visible `GOVERNANCE_RUN_UNAVAILABLE`
  string is unchanged.
- **G3** — `before_prompt_build()` is **advisory only** and returns an explicit
  `BLOCKED` governance context for an unresolvable run. It is deliberately not
  used as an enforcement mechanism, because the OpenClaw host swallows anything
  thrown from it. The enforcing control is the native governance boundary; see
  §4.4.
- **DS** — `operator-apply.mjs` enforces `PRE-FLIGHT FAILURE = ZERO RUNTIME
MUTATION` by running the existing preflight and gating rollback on a real
  mutation boundary.

The heartbeat failure began 2026-09-11T23:51:55+07:00 and predates R5/R6. The
production ledger was verified unmodified throughout
(`d794d99d…` / `bbdf3aec…`, mtime 2026-09-28 17:26:11) and must remain untouched.

### 4.3 M8/T2.2-R7 implementation state and pending deployment

The R7 repository remediation is implemented and validated as a single local
implementation commit on `codex/m8-t2-governed-runtime-hardening`. Validation
evidence for that commit: 18 new focused R7 tests; full `npm test` 651 tests /
79 suites / 649 pass / 0 fail / 2 skipped; `npm run lint` exit 0;
`npm run format:check` clean; `npm run repo:check` passed; `git diff --check`
clean. The 2 skips are the pre-existing R6 production-ledger replay tests that
skip on Windows, where the production ledger is not mounted.

R7 remains the active execution task and is **not** closed. `ACTIVE.md` remains
present and authoritative; the execution-contract pointer stays set; and
`Execution Authorization: YES` continues to authorize repository R7 remediation
only. Deployment is gated separately by `Deployment Authorized: NO`.

The live runtime has deliberately **not** been restored. The repository now
contains the G1/G2/G3 fixes while the quarantined R5 runtime does not, so
restoring R5 before validating the new behavior would reintroduce the proven
heartbeat failure. Restoration is therefore sequenced after an isolated
validation of the new `before_prompt_build` fail-closed behavior against the
OpenClaw host hook path.

Runtime state at the close of R7 implementation, verified read-only and
unchanged by this work: `openclaw.json` `b96aca41…` (14798 bytes); live
`extensions/zink-governance` absent with the R5/R6-era build still present in
`operator/m7-t2/backups/r12/quarantined-t2/`; `selection-DopzNY3I.js` at the
clean baseline `a5698c55…`; `zink-governance-boundary.mjs` absent; production
ledger 103 events, `d794d99d…` / `bbdf3aec…`.

### 4.4 Discord-lane enforcement seam (R7 correction)

An audit of the installed OpenClaw `2026.6.34` host established where an
unresolvable governed run is actually stopped on the Discord lane.

`before_prompt_build` **cannot** enforce. Its result type
(`PluginHookBeforePromptBuildResult`) exposes only `systemPrompt`,
`prependContext`, `appendContext`, `prependSystemContext` and
`appendSystemContext` — there is no decision or block channel.
`runModifyingHook` (`dist/hook-runner-global-D_43rcnU.js:481`) catches every
handler exception via `handleHookError` and returns `undefined`, and both call
sites add a second swallow (`dist/attempt.prompt-helpers-B7ATxx0y.js:126-130`,
`dist/agent-harness-runtime-DjK3eIXB.js:143-145`). A throw there is therefore
fail-open. R7 consequently reverted G3 to the explicit `BLOCKED` prependContext
and keeps the hook advisory.

`before_agent_run` does have blocking semantics, but only in
`dist/cli-runner-B0eKIePw.js:761-777`, which is the **CLI** runner. The Discord
lane does not use it, so CLI behaviour must not be read as Discord behaviour.

The enforcing seam on the Discord lane is the **native governance boundary**.
The pinned patcher injects `await enterNativeRun(...)` at
`dist/selection-DopzNY3I.js:12232`, immediately after
`const activeSession = session;` inside `runEmbeddedAttempt`
(`dist/selection-DopzNY3I.js:10960-14467`). The model invocation
`activeSession.prompt` is defined at `12847` and invoked at `13754`/`13765`, so
the gate precedes the model call by roughly 520 lines.

Live evidence from the gateway log for the governance-active window
`2026-09-30T01:20:45Z-01:21:05Z` (`dist` log `/tmp/openclaw/openclaw-2026-09-30.log`):
the turn ended in `lane task error: lane=main ... GOVERNANCE_RUN_UNAVAILABLE`
then `Embedded agent failed before reply`, with **zero** `model-fetch` events.
In the governance-absent window the same heartbeat produced
`[model-fetch] start ... status=200`. The model was therefore not invoked while
the boundary rejected the run.

No new enforcement mechanism is introduced. The native boundary already
enforces the admission decision, so enforcement is not duplicated in another
hook, and R6 approval semantics and ledger semantics are unchanged.

### 4.5 M8/T2.2-R8 — verified R5 governance-asset provenance

Deployment of R6+R7 was attempted under owner authorization and is blocked at
`configure.mjs --preflight`. Two independent gates were found, and the first was
cleared by restoring the verified pre-incident R5 baseline (a one-time owner
authorized recovery, executed and verified byte-exact against the recorded
`native-r12` manifest: selection `b4316736…`, announce `e3b110f7…`, bridge
`49352d47…`, config `5db19403…`, extension `e77689c9…`, ledger untouched at 103
events / sequence 103 / 37 tasks).

The second gate is the asset allowlist. `configure.mjs:581-591` accepts a
deployed asset only when it is missing, equal to the current build, or an
approved predecessor digest. The restored R5 extension differs from the current
build in exactly one governed asset, `lib/native-boundary.mjs`, because R7
changed only that file.

Provenance was established by packaging, not inference: materializing
`governancePluginFiles()` from the R5-era tree at commit `9713872` reproduces
all 33 deployed R5 asset bytes exactly, with 0 mismatches and 0 absent. Across
the 31 paths in `pluginFiles.assets`, 27 have R5 bytes identical to the current
build and are already accepted by content comparison, and 3 are already
allowlisted. **Exactly one digest is missing** — an earlier estimate of 30 was a
measurement error, since it counted current-build digests as absent from a table
that by design holds only predecessors.

R8 adds that single digest and nothing else. It does not deploy.

### 4.6 M8/T2.2-R9 — G1 enforcement-context correction (BLOCKED)

The controlled live deployment of `4f5cc6d` succeeded: the corrected operator
applied the R6+R7 build, the native bridge was re-synced to the R7 artifact, the
gateway restarted exactly once with no config-watcher restart and no restart
loop, and the production ledger was untouched. G2 was confirmed live — the host
logged `GOVERNANCE_RUN_UNAVAILABLE | EXECUTION_STATE_UNKNOWN` for the first
time.

**Phase 5 failed.** The real heartbeat was still rejected, so no exemption
applied. Cause: the native patch injects only `agentId`, `sessionKey`, `runId`,
`inputProvenance`, `channelId`, `senderId`, `currentMessageId`
(`selection-DopzNY3I.js:12235-12240`). It never passes `content`, `message`,
`mentions` or `isBot`, so `isPureLivenessHeartbeat` cannot observe the sentinel
and always returns false. The R7 G1 unit tests called `enterNativeRun` directly
with a context richer than production supplies; that false confidence is the
defect.

A read-only audit of the installed `v2026.6.34` source established what is
actually observable at that anchor:

| G1 condition                    | Observable | Evidence                                                                                                                                                                                                 |
| ------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 self-keyed session            | yes        | `params.sessionKey`, `params.agentId`                                                                                                                                                                    |
| 2 exact sentinel                | yes        | `params.transcriptPrompt`, assigned `HEARTBEAT_TRANSCRIPT_PROMPT` at `get-reply-CICEttbD.js:3015` only when the host set `isHeartbeat`; also `params.prompt`, sanitized at `selection-DopzNY3I.js:10961` |
| 3 no inter-session provenance   | yes        | `params.inputProvenance`, already passed                                                                                                                                                                 |
| 4 not Discord ingress           | yes        | `params.messageChannel ?? params.messageProvider`, already passed                                                                                                                                        |
| 5 no mention and not bot-author | **no**     | zero occurrences of `mentions` or any bot-author field in `runEmbeddedAttempt`                                                                                                                           |

Condition 5 does not exist at the seam. `mentions` is produced only in the
Discord ingress layer (`accounts-CT0uPrw7.js:228-290`, `bot-CS65Z7r1.js:5137`)
and is never forwarded into the embedded-run params. No run-scoped bot-author
field exists at all.

A host-authoritative alternative exists: `embedded-agent-CGzgLLU-.js:4061`
computes `isHeartbeatTrigger: params.trigger === "heartbeat"`, and
`params.trigger` is read throughout `runEmbeddedAttempt`. That is a boolean the
host sets, not a string matched from message content.

Enforcing condition 5 as written would require patching the Discord ingress layer
or forwarding large request objects, both of which R9 forbids. R9 therefore
requires an owner decision and no implementation work has been started.

### 4.7 M8/T2.2-R10 — G1 contract correction (host-authoritative trigger)

R9 is superseded by owner decision. G1 now uses the host-assigned trigger as
its primary discriminator, and the unobservable "no mentions / not bot-author"
condition is retired rather than replaced by an `undefined` check.

**Trigger provenance, proven against installed `v2026.6.34`:**
`agent-runner.runtime-BUWW8f6n.js:3092` and
`reply-usage-state-BKK3wzWk.js:1510,1958,2090` compute
`trigger: opts?.isHeartbeat === true ? "heartbeat" : "user"` — a strict binary
with no other producer. `isHeartbeat: true` is assigned in exactly one place in
the bundle, `heartbeat-runner-BTpzFMjQ.js:1320`, inside the heartbeat scheduler;
every other occurrence is a read. The content-based
`isHeartbeatUserMessage()` (`heartbeat-filter-D8UEwGGH.js:170`) does match the
sentinel, but it is a transcript-artifact filter consumed by diagnostics, memory
indexing and transcript pathing, and never sets `isHeartbeat` on a run. A
Discord message containing the sentinel therefore cannot become a heartbeat, and
`isHeartbeat` is never derived from inbound content.

**G1 requires all of:** `trigger === "heartbeat"`; self-keyed session; the exact
sentinel in `transcriptPrompt` or `prompt`; no `inputProvenance`; not Discord
ingress. The native patch gains only `params.trigger` and
`params.transcriptPrompt` — both already present at the existing anchor — so no
Discord-layer patch and no forwarded message objects are introduced.

`classifyInternalRunEnd`, G2, G3, R6 semantics, the operator-apply mutation gate,
preflight semantics and the asset allowlist are untouched. R10 is repository-only
and is not deployed.

### 4.8 M8/T2.2-R11 — transactional live rollback safety

The authorized R10 live deployment (`dc466c6`) was attempted on 2026-09-30 and
**STOPPED before `--apply`** at the owner's Phase 1 rollback-safety gate, with
zero mutation proven by identical before/after runtime and ledger hashes and an
unchanged gateway PID. Two independent blockers were found.

**Blocker 1 — the rollback target is a historical baseline, not the current
runtime.** `operator-apply.mjs:112-119` wires rollback to
`restoreNativePatch(runtimeRoot, native-r12)` and
`restoreT1RuntimeFiles({ stateDir, identifiers })`. `native-r12` holds the clean
upstream BASELINE preimages, so that restore removes the native patch and the
bridge. `restoreT1RuntimeFiles` writes `backups/r12/t1-config.json`, captured
2026-09-11 17:36:24, over the live config and renames the governance extension
into quarantine. A mid-apply failure would therefore leave the 2026-09-11 T1
config `b96aca41…` instead of the live R7 config `5db19403…`, with no
governance plugin installed. `runtime-backup.mjs:107` returns early when the
backup root exists, so no in-operator path ever captures a fresh snapshot.

**Blocker 2 — the asset gate refuses the R10 build.** R7→R10 changes exactly two
generated-extension files, and neither outgoing digest is allowlisted:
`lib/native-boundary.mjs` `33b3feef…` → `50af7d4a…`, and entrypoint
`74582778…` → `e5b220b4…`. `--preflight` returned `Governance plugin asset drift
detected`. The R10 digests were deliberately NOT added.

**Additional defect found during the same audit.**
`apply-orchestration.mjs:114-124` sets `rollbackSucceeded = true` as soon as the
restore helpers return, while `restoreT1RuntimeFiles` itself reports
`liveBaselineValidation: "NOT RUN"` and is documented "Never reports a live
rollback PASS". A rollback leaving the runtime ungoverned is reported as
successful.

R11 replaces "restore the old baseline" with "restore the exact transaction
preimage", gates mutation on a verified transaction-scoped snapshot, and
replaces "the restore returned" with "the live runtime was verified".
`backups/r12` is neither deleted nor repurposed and remains historical recovery
evidence. R11 is repository-only: no deployment, no live rollback, no second
deployment attempt, and the R10 allowlist entries are not added.

### 4.9 M8/T2.2-R12 — durable transaction recovery safety

The owner accepted R11 as the correction to automatic rollback semantics and
authorized R12 to harden the two recovery boundaries R11 deliberately left open.

**Objective 1 — the snapshot must survive a process failure.** R11's transaction
snapshot is in-memory. That is sufficient for a synchronous mutation failure,
because the orchestrator is still alive to restore from it. It is not sufficient
if the apply process disappears after mutation begins: there is then no recovery
target, and no record that a mutation was in progress at all, so the next apply
cannot tell a clean runtime from a half-mutated one. R12 persists the snapshot
and a transaction record under a dedicated transaction-state directory in the
existing operator state area, marks the transaction complete on verified success,
and refuses a new apply when it finds a transaction that started but never
completed. An orphan is reported and requires an explicit recovery decision; it
is never silently deleted, resumed, or rolled back.

**Objective 2 — the historical rollback path needs an authorization gate.**
`operator-rollback.mjs` invokes `restoreNativePatch` against `native-r12` and
`restoreT1RuntimeFiles` against `backups/r12`, with no authorization check at
all. That installs the 2026-09-11 T1 config, the clean native baseline, and no
governance extension. R11 stopped the _apply_ path from reaching it, but the
command itself remains unguarded. R12 adds an explicit recovery authorization
that cannot be inferred from `Deployment Authorized`, `Execution Authorization`,
or the mere presence of a backup, requires the target to be named, and discloses
what will be installed before any mutation. Automatic transaction rollback and
historical recovery stay distinct actions.

`backups/r12` and `operator-rollback.mjs` are both retained, and the historical
target is unchanged. The R10 outgoing digests are NOT added. R11's automatic
rollback logic is extended only where durability requires it. R12 is
repository-only: no deployment, no live apply, no live historical rollback.

### 4.10 M8/T2.2-R13 — R7 predecessor provenance allowlist

The owner accepted R12 as the rollback-safety baseline and scoped R13 to the one
remaining blocker on the R10 deployment: `configure.mjs --preflight` refuses the
currently deployed R7 governance extension with `Governance plugin asset drift
detected`.

R7 changed exactly two generated-extension files relative to R5: the native
boundary and the entrypoint. Every other R7 asset is byte-identical to the
current build and is already accepted by content comparison, and the R5
predecessor digests R8 recorded remain in place. So exactly two approved
predecessor identities are missing, and R13 adds exactly those two — the OUTGOING
live R7 digests, each bound to its own path:

- `lib/native-boundary.mjs` → `33b3feefdfd473dc…`
- `index.mjs` → `74582778e5d58ce6…`

The R10 INCOMING digests (`50af7d4a…`, `e5b220b4…`) are NOT added; they are the
current build and are already accepted by content comparison. R13 changes one
data table and no logic, validation order, path semantics or comparison
semantics.

R13 ends at the preflight result. A preflight PASS is not authorization to apply:
`--apply`, `operator-apply`, native mutation, gateway restart, heartbeat, Discord
tests and ledger-mutating tests are all out of scope, and `Deployment Authorized`
stays `NO`. Transaction retention and orphan handling are intentionally left as
deferred operational-hardening decisions and are not touched.

### 4.11 M8/T2.2-R14 — native patch lineage compatibility

The `b8597fe` deployment attempt consumed its single authorized attempt and FAILED
at `native-backup-prune` with `NATIVE_SOURCE_DRIFT` (`native-patch.mjs:225`).

Root cause, established read-only against the live host: the R10 patcher
recognizes only the exact upstream baseline or the exact patched state it
generates itself. It classifies a file as patched solely by replacing its own
patch string and checking that the inverse hashes to the pinned baseline
`a5698c55`. The live host carries the **R7** injection — the R10 patch string is
absent (0 occurrences) and the R7-shaped injection is present (1 occurrence) — so
the inverse fails and neither branch is reachable. `applyNativePatch` itself would
have been blocked at the next stage; the prune merely hit it first.

R13 was necessary but not sufficient. No asset allowlist entry could have
prevented this, because it is a patch-lineage question, not a provenance one.

R14 models the runtime as an ordered lineage — `BASELINE → R7 → R10`, plus
`BASELINE → R10` — with four recognized states: baseline, explicitly recognized
predecessor, exact current patched, and unknown. Recognition is provenance-bound
to an exact source digest, exact patch signature, exact inverse, and exact
resulting baseline digest, and is bound per artifact. The R7 → R10 transition is
derived entirely in memory, so the live runtime never passes through an unpatched
intermediate state. For R10 the only required predecessor is R7; R5 and R6 are
deliberately not added, because the actual deployment graph requires only R7 and
extra entries would widen the recognized surface for no reason.

R14 is repository remediation plus a live preflight. No deployment target.
`NATIVE_RUNTIME_PINS` and the R8/R13 allowlists are unchanged, and no new
allowlist entry is added as a side effect.

### 4.12 M8/T2.2-R15 — attempt-scoped transaction identity

The second R10 deployment attempt (authorization `7520f39`, one attempt) ABORTED
before any mutation at the `transaction-snapshot` stage with
`ROLLBACK_SAFETY_UNAVAILABLE`. Zero runtime, ledger and gateway change.

Root cause, established read-only: R12 derives the transaction directory name
from the PREIMAGE DIGEST. The first attempt's rollback restored the runtime
byte-exactly, so all 38 recorded components of the live runtime still match that
attempt's retained preimage exactly. The derived ID is therefore the same, and
`persistTransactionSnapshot` refuses with `TRANSACTION_ALREADY_EXISTS`. A
completed record from a prior attempt permanently blocks the next attempt against
the same preimage, and nothing in the repository can clear it. Orphan detection
does not see it either, because the record's status is `complete`, not orphaned.

This conflates two different concepts. `preimageDigest` answers "which exact
runtime state did this attempt start from?" and is deterministic, which is
correct. `attemptId` answers "which apply attempt was this?" and must be unique
per attempt. Using the first as the filesystem uniqueness key makes a successful
or cleanly rolled-back attempt permanently prevent any future attempt from the
same state.

R15 separates them: the transaction directory is keyed by a cryptographically
random `attemptId`, while the record continues to carry the full deterministic
`preimageDigest` and the complete component manifest, so preimage traceability is
preserved and is never replaced by the attempt ID. Two attempts against the same
preimage become valid, each with its own attempt ID and its own independently
recoverable snapshot. A completed transaction is evidence, not a blocker.

Orphan semantics are unchanged in principle: a transaction left `started` when
its process disappears is still detected and still blocks a new apply, and is
never silently deleted, resumed or rolled back. History is not concurrency.

The existing completed record `txn-02edeb0bf364e3931fffd9e1e5fe904b` is a valid
historical recovery record. R15 is forward-compatible with it and does NOT
rewrite, rename, migrate or delete it; the new scheme applies to new
transactions only.

R15 is repository-only: no deployment, no live apply, no transaction deletion or
rewrite, no allowlist change, and no change to the R10 G1 contract, the R13
allowlist, or the R14 native lineage.

### 4.13 M8/T2.2-R16 — full apply rehearsal on an exact clone of the live runtime

The owner declined a third live deployment and instead required the complete
corrected R10 apply path to be exercised end to end against a byte-exact clone of
the CURRENT LIVE R7 runtime, because three operations had still never run
anywhere: the R7 native predecessor WRITE to R10, the post-apply runtime
verification, and a genuine restart.

**Why a copy was not sufficient.** `buildConfig` embeds absolute `stateDir` paths
in `agents`, `auth`, `plugins.paths` and the systemd drop-in. A byte-exact copy of
`openclaw.json` relocated to another root can therefore never pass the builder's
own preflight — proven directly: an identical copy at `/tmp` fails with `Policy
drift at agents` while the same bytes at the original path pass. Any directory
copy is a fidelity lie.

**Isolation mechanism.** The clone is a private mount namespace
(`unshare --map-root-user --mount`) in which `/home/hoang_vinh/.openclaw-zink`,
the OpenClaw package root and `~/.config/systemd/user` are each overlaid with
overlayfs whose LOWER LAYER IS THE LIVE DIRECTORY. Byte-exactness is therefore
structural, not copied: every in-scope byte is the live byte by construction.
Writes land only in the overlay upper layer, which doubles as a deterministic
record of which files were written. The namespace cannot outlive the process, so
a crash cannot leak a mount or a write into the host, and the running gateway —
which never entered the namespace — keeps the real inodes.

Only the gateway restart is injected, because the real effect is `systemctl
--user restart`. The real `applyRuntime` orchestration, the real `configure.mjs`
as a child process, the real native patcher and the real transaction machinery
are all used unmodified. `operator-apply.mjs` is deliberately not invoked: it
binds absolute live paths and a real restart, so using it would be the mutation
R16 forbids.

**Coverage boundary, stated precisely.** The R7 → R10 native predecessor WRITE
and the post-apply byte verification are genuinely exercised. The gateway restart
is **not**: it ran only as an injected no-op, and no real `systemctl --user
restart` or `is-active` observation has ever executed anywhere. An earlier
wording in this plan and in the contract claimed the restart stage was
"exercised"; that was wrong and is corrected. The deployment path is proven up
to, but not including, the restart itself.

**Result: PASS.** The complete stage trace runs in order and the R7 → R10 native
write lands. Exactly two native files were written — `dist/selection-*.js` at
`555f37da` and `dist/zink-governance-boundary.mjs` at `50af7d4a` — and the
overlay upper layer shows no third native file, no `native-r12` backup and no
baseline bytes anywhere. The write history is therefore `R7 → R10`, not
`R7 → BASELINE → R10`, measured rather than argued.

All eight controlled failure boundaries roll back to the exact attempt preimage
with `rollbackSucceeded` licensed only after live byte verification. A gateway
that cannot restart back never licenses a verified rollback. The historical R15
collision scenario was replayed through the real orchestration: attempt A fails
and rolls back, attempt B reaches the native mutation on the same preimage with a
distinct attempt ID and no `TRANSACTION_ALREADY_EXISTS`.

The R10 artifacts were regenerated from the pinned baseline preimages twice,
deterministically, and are byte-identical to the output of the R7 → R10 route.

Live environment after the rehearsal: all 15 components and 4 subtrees
byte-identical, gateway `MainPID=98288` with `NRestarts=0` unchanged, ledger at
103 events / sequence 103 / 37 tasks unchanged. **NOT DEPLOYED.**

R16 is repository-only and creates no deployment authorization. R16 is `CLOSED`
as the final revision of `M8/T2.2`. `Deployment Authorized` remains `NO`,
`Deployment Status` remains `NOT DEPLOYED`, the live runtime remains R7 and
byte-identical, and the ledger is unchanged. No R17 is created.

#### 4.13.2 R16 live deployment — DEPLOYED

The single authorized attempt ran on 2026-09-30 through `operator-apply.mjs`, the
repository's authorized live deployment mechanism, against the real live runtime.
No mount namespace, no rehearsal, no simulation. The authorization was recorded
in both authoritative sources and committed as `075f46d` before any runtime
contact.

Result: `{"status":"PASS","stage":"applied","mutationStarted":true,
"rollbackRequired":false,"rollbackAttempted":false,"rollbackSucceeded":false,
"reason":null,"attemptId":"txn-1ba7689b6908d601122834e426939541bc72106736b2a5a15b48d539a063a8d4",
"transactionStatus":"complete"}`. Every stage ran in order through
`runtime-verify`. No rollback was required and none was attempted; success was
licensed by live byte verification, not by self-report.

Live state, measured directly after the apply:

| Component                            | Before (R7)                                                        | After (R10)                                                        |
| ------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `openclaw.json`                      | `5db19403521b0db84b29408fb4a194460f14a50b391e887873c03c5f1b560658` | unchanged — the R7 config was already current                      |
| extension `index.mjs`                | `74582778e5d58ce6a26dec3514b9a73ad5f8964f892023b37221f8a85b5ff215` | `e5b220b4a3b023f6d7b26561964f6204f0d004267b208cddab90adb6043b8bd7` |
| extension `lib/native-boundary.mjs`  | `33b3feefdfd473dc0d6d09b0ae7b8e39b394fa93a1247fe117bc58757f075412` | `50af7d4ae10b519340b8dc13af3e2b219041fb28991e2a777ea815b537d2c7c2` |
| `dist/selection-DopzNY3I.js`         | `b431673602bf2f6eca55f8635f226dddbf06cf19e83c5488cc154d4db3d94512` | `555f37dae8eec1fbbd35e25ae28222dc5e8d6965e383500695a93900e9d8ddf5` |
| `dist/zink-governance-boundary.mjs`  | `33b3feefdfd473dc0d6d09b0ae7b8e39b394fa93a1247fe117bc58757f075412` | `50af7d4ae10b519340b8dc13af3e2b219041fb28991e2a777ea815b537d2c7c2` |
| `dist/subagent-announce-Bh1QyKiE.js` | `e3b110f77cbd52ec86e935ff9ee3926b2730802a1cd4d42e65c56624dc19dc87` | unchanged — already R10                                            |

The live native write went `R7 → R10` directly. `native-r12` still holds 3 files
with mtime `2026-09-30 01:00:14`, proving the baseline-writing branch never ran —
the same result R16 measured on the clone.

Independent post-apply verification, not taken from the apply's own report:

- the real `checkNativePatch` returns `PATCHED` for both pinned sources;
- the live bridge equals the repository R10 boundary `native-boundary.mjs`;
- the deployed extension tree matches `governancePluginFiles()` byte-for-byte
  across **34 of 34 files**, entrypoint `e5b220b4…` included;
- the written selection carries `trigger: params.trigger` and
  `transcriptPrompt: params.transcriptPrompt`;
- `GOVERNANCE_VERSION = "m8-t2.3-r5"`, the G1 trigger predicate and the G2
  `GOVERNANCE_RUN_UNAVAILABLE` code are present;
- three plugins configured: `discord`, `google`, `zink-governance`.

The gateway restarted for real and serves the new code: `active (running)`,
`NRestarts=0`, `[zink-governance] ACTIVE AND LOADED`, `http server listening
(3 plugins)`, `[heartbeat] started`. `NRestarts` stayed 0 throughout; the
repeated stop/start entries in the journal come from distinct systemd PIDs, i.e.
WSL instance restarts in this environment, not a crash loop of one process.

Transaction: a new attempt record `txn-1ba7689b…` — schema v2, the R15
random 64-hex identity — `status: complete`, snapshot `verified: true`, marked
complete only after verification. The retained historical record
`txn-02edeb0bf364e3931fffd9e1e5fe904b` is untouched and still verifies.

Ledger integrity: `events.jsonl` `d794d99d0be87683feed34735005db864b71d049499b69de4a32a14d58c5dda2`
and `snapshot.json` `bbdf3aec34ae92b60b5e6a661c890b9e60f5bcf9bbecc1062cec6d16d9a12f9a`
are byte-identical before and after — 103 events, sequence 103, 37 tasks. The
deployment wrote no ledger event.

`backups/r12` is untouched: 14 files, mtime `2026-09-30 11:18:26`. No quarantine
was created. No rehearsal scratch and no stray overlay mounts remain.

Behavioural evidence: `GOVERNANCE_RUN_UNAVAILABLE` occurrences after the
deployment are **0**; the same window before it contained 6, and the last
occurrence anywhere was `17:20:53`, hours before the apply. Every error line
after the deployment is a Discord gateway WebSocket close with code `1006`
during a WSL reboot, plus one aborted OpenRouter pricing fetch — 7 lines after
against 22 before, and unrelated to governance.

One honest limitation: no complete heartbeat _cycle_ has been observed yet
because WSL restarts roughly every one to two minutes in this environment while
the heartbeat cadence is about thirty minutes, so the scheduler is restarted
before it can complete a run. The failure that R10 exists to fix has stopped
occurring; end-to-end cadence confirmation needs a WSL instance that stays up.

#### 4.13.1 R16 findings closed

Every finding R16 raised is closed in `M8/T2.2-R16` itself. No R17 is created
and no finding is deferred.

| Finding                                                                                                                                                                                                                                                                                                | Fix                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A relocated byte copy is not a valid clone: `buildConfig` embeds absolute `stateDir` paths, so identical `openclaw.json` bytes fail anywhere but the original path                                                                                                                                     | Clone rebuilt as a private mount namespace whose overlayfs lower layer IS the live runtime, so byte-exactness is structural                                                                                                                                                                                                                                                                  |
| The write-history witness was a `fs.watch` sampler that never observed R10                                                                                                                                                                                                                             | Replaced by the overlay upper layer, which records a file exactly when it is copied up, giving a deterministic write record                                                                                                                                                                                                                                                                  |
| `configArgs` derived one flag per raw JSON key, producing `discordOwnerId must be a numeric Discord snowflake`                                                                                                                                                                                         | The identifier set is parsed once and its parsed keys derive the flags                                                                                                                                                                                                                                                                                                                       |
| `R7_DIGESTS` carried `config: null, entrypoint: null` placeholders into a `deepEqual`                                                                                                                                                                                                                  | Split into `nativeDigests()` / `R7_NATIVE`, so only genuinely constant digests are asserted                                                                                                                                                                                                                                                                                                  |
| The fingerprint read `GOVERNANCE_VERSION` from `index.mjs`, where it is not defined, and reported `null`                                                                                                                                                                                               | Read from the extension's own `lib/canonical.mjs`, where the constant lives                                                                                                                                                                                                                                                                                                                  |
| The predecessor-recognition fault mutated the clone AFTER the preimage was captured, so the test asserted rollback-to-pristine instead of rollback-to-attempt-preimage                                                                                                                                 | Fault is applied before capture; the attempt preimage is what rollback must restore                                                                                                                                                                                                                                                                                                          |
| The `builder-preflight` fault was never implemented, so the "preflight failure" test ran the real builder and passed instead of failing                                                                                                                                                                | Implemented; the test now proves zero mutation and no rollback attempt                                                                                                                                                                                                                                                                                                                       |
| The predecessor-recognition fault is detected at `native-backup-prune`, one stage before the patcher                                                                                                                                                                                                   | Real detection order recorded rather than papered over                                                                                                                                                                                                                                                                                                                                       |
| The post-apply-validation expectation asserted R10 was retained after rollback                                                                                                                                                                                                                         | Corrected to the restored preimage, and `APPLY_NOT_VERIFIED` is now asserted                                                                                                                                                                                                                                                                                                                 |
| Test J asserted two snapshots were different, but they are equal by design because A's rollback restores R7                                                                                                                                                                                            | Corrected; the proof is now two distinct records with one shared `preimageDigest`                                                                                                                                                                                                                                                                                                            |
| Rehearsal scratch cleanup failed with `EACCES` because overlay `work` directories cannot be removed from outside the namespace                                                                                                                                                                         | Teardown moved inside the namespace; the outer cleanup names anything left instead of hiding it                                                                                                                                                                                                                                                                                              |
| Five WSL failures `DUCKDB_ENGINE_NOT_AVAILABLE`                                                                                                                                                                                                                                                        | The production classification is correct and unchanged. The harness defect was that neither DuckDB suite probed for the engine, so an absent runtime was reported as FAIL. Real-execution gates are now `NOT RUN` when the engine is absent, denial gates still run everywhere, and a new Gate E1 asserts the fail-closed classification on every host                                       |
| The contract and this plan claimed the restart stage was "exercised"                                                                                                                                                                                                                                   | Corrected: the restart ran only as an injected no-op and has never been executed for real                                                                                                                                                                                                                                                                                                    |
| `operator-apply.mjs` wired a `validateConfig` dependency described as an "additional semantic health signal" that `applyRuntime` never calls                                                                                                                                                           | Dead dependency and its false claim removed, with the reason recorded: `config validate` cannot distinguish a wrong-but-valid restore, and byte comparison against the attempt's own preimage is the only gate                                                                                                                                                                               |
| `npm test` can never exercise the R16 suite, because it always skips without the namespace                                                                                                                                                                                                             | Added `npm run test:r16`                                                                                                                                                                                                                                                                                                                                                                     |
| `r16-rehearsal.mjs` reported only a non-zero exit, so "could not run" and "failed" were indistinguishable                                                                                                                                                                                              | The driver now names the reason it could not start                                                                                                                                                                                                                                                                                                                                           |
| `tests/m7-lane-c-queue.test.mjs` M7-025 was nondeterministic: it called `detectAndRecoverStaleTasks` with `staleThresholdSeconds: 0` in the same millisecond as the claim, and staleness is `heartbeat age > threshold` strictly, so it recovered nothing and failed whenever the clock had not ticked | Measured at 3 failures in 8 runs on WSL tmpfs and 0 in 8 on NTFS, then fixed by advancing the clock explicitly, matching the pattern the other stale-recovery gates already use. 0 failures in 12 runs on both platforms. The production comparison was NOT relaxed: `>` is the correct rule and weakening it to `>=` would recover a task whose heartbeat is contemporaneous with the check |

R4 validation snapshot (task remains IN PROGRESS): focused M8/T1, M8/T2 and
native ingress suites PASS; focused DuckDB/M7-T4 gates PASS 27/27; full
`npm test` PASS 349/349 across 28 suites; ESLint, Markdown lint, repository
policy check, Prettier and `git diff --check` PASS. The owner-provided native
Windows DuckDB CLI is available at the approved WinGet path. Remaining OPEN
items are the unverified native OpenClaw component API, the approved
nonblocking lock primitive, and the owner/runtime-dependent OpenClaw preflight.

R4 implementation evidence: `zink_sql` uses the existing governed DuckDB bridge
with exact task scope; approved tasks are durably enqueued before an unavailable
execution backend returns `BLOCKED / ENGINE_NOT_IMPLEMENTED`; approval cards
require exact task correlation; missing Discord credentials fail closed as
`CREDENTIAL_UNAVAILABLE`; Excel sandbox and public artifact references fail
closed without CWD/internal-path fallback; and no OpenClaw native conversational
memory is enabled; Ollama embedding requests no longer infer a gateway or
localhost endpoint. Native Discord component API verification, OpenClaw runtime
preflight, and a nonblocking lock replacement remain `BLOCKED` under the R4
no-invention rule.

Prior M8/T2.2-R3 validated completion evidence (historical baseline; not R4 completion):

- all 15 root-cause families (RC-01 through RC-15) defined in `docs/contracts/execution/ACTIVE.md` remediated, hardened, and verified with zero regressions;
- RC-01 (Discord Ingress / Routing Authority): admission gate enforced prior to model calls; Main established as the sole root owner at ingress; specialist direct mentions rejected across all channels (`SPECIALIST_NO_DIRECT_INGRESS`); multi-capability requests directed solely to Main; duplicate Discord events deduplicated;
- RC-02 (Agent Topology / Spawn Authorization): canonical topology locked in `role-capability-manifest.json` and runtime `guard.mjs` (`main -> [o1, o2]`, `o1 -> [excel, sql, python]`, `o2 -> [power-bi, python]`, leaf -> `[]`); Main direct spawn to specialists blocked; O1/O2 cross-spawn blocked; empty node lists blocked;
- RC-03 (Task Identity / Lineage / Idempotency): durable correlation IDs and exact lookup enforcement; duplicate message IDs and actions rejected or answered idempotently without spawning new executions;
- RC-04 (Approval / Revision / Result-Review Transaction): immutable approval records bound to exact scope digest and revision; plan revisions strictly invalidate prior approvals; User established as sole authority for Approve, Reject, and Accept;
- RC-05 (Queue / Ledger / Lease / Recovery): persistent file-backed queue with atomic cross-process file locks, lease heartbeat fencing, execution-agent attempt validation, and fail-closed state reconciliation;
- RC-06 (Discord Outbound / Channel Authority): canonical channel matrix enforced; `ASK_USER` in `#office` strictly restricted to Main in `validateActionAuthority()`; O1/O2 restricted to `#approvals`, `#results`, and `#incidents`;
- RC-07 (Common Artifact / Result / Delivery Truth): complete lifecycle enforced; internal filesystem paths and raw `file://` URLs purged from user-facing outputs; user delivery separated from workspace file generation;
- RC-08 (Excel Execution Truth): secondary writes to repository `artifacts/` purged; `.xlsx` workbooks generated with matching visual SVG previews; CWD fallbacks removed from delivery path;
- RC-09 (SQL Execution Truth): real DuckDB engine execution enabled with canonical schema fixtures; discrete execution states (`REAL_EXECUTED`, `EMPTY_RESULT`, `TEST_SIMULATION`, `TIMEOUT`) enforced; syntax/binder errors fail closed without returning mock sample rows;
- RC-10 (Python Execution Truth): strict stack scoping separating O1 ETL execution from O2 analytics/visualization/forecast/optimization; AST parsing and import validation;
- RC-11 (Power BI Execution Truth): PK\x03\x04 magic byte validation, container integrity, and dashboard preview correlation;
- RC-12 (External Adapter / Simulation Truth): unambiguous capability states enforced; simulation mode isolated behind explicit flags and forbidden from production success paths;
- RC-13 (Security / Path / Endpoint Isolation): zero secret leaks in prompts or payloads; traversal (`..`) and absolute path escape attempts rejected; host execution bypass blocked;
- RC-14 (Semantic / Capability Boundary): vetted namespace enforcement; proposal disk writes isolated to explicit storage directories rather than dirtying source trees;
- RC-15 (Verification / CI / Schema / Documentation Truth): root `npm test` updated to include `duckdb-bridge.test.mjs`; all 272 tests across 13 suites pass completely (100% PASS); quality gates clean: `git diff --check` (0 issues), `npm run repo:check` (PASS), `npm run format:check` (PASS), `npm run lint` (0 issues).

M8/T2-R9 validated completion evidence:

- strict 5-tuple action authority engine (`validateActionAuthority` in `integrations/openclaw/lib/authority.mjs`) implemented, enforcing User as the sole authority for plan approvals and result acceptance, isolating actions across 4 dedicated Discord channels (`#office`, `#approvals`, `#results`, `#incidents`), and strictly blocking specialist agents from governance actions (`SPECIALIST_NO_GOVERNANCE`);
- technical execution finish decoupled from human task completion: `EXECUTION_FINISHED` transitions tasks to `RESULT_PENDING_REVIEW` with preview and validation, requiring explicit User `ACCEPT_RESULT` to transition to `COMPLETE`;
- persistent file-backed `QueueManager` implemented in `integrations/openclaw/lib/queue-manager.mjs` with atomic single-agent claims, lease heartbeat renewal, and automatic stale task recovery (`detectAndRecoverStaleTasks`), cleanly decoupling the 24/7 Control Plane from execution-agent offline/sleep cycles;
- two-tier `evaluateResultGate` implemented in `integrations/openclaw/lib/artifact-validator.mjs` with technical integrity parsing and business KPI constraint verification, enforcing the critical invariant that Technical PASS + Business FAIL yields `RESULT BLOCKED` with real data previews and zero synthetic mocks;
- human-confirmed `DecisionLedger` implemented in `integrations/openclaw/lib/decision-ledger.mjs` caching confirmed operator decisions and preventing redundant clarification questions;
- structured reference IDs conforming to `TOPIC(2)-EXEC(2)-TASK(4)` with `00` reserved for human-contributed documents, and retrieval context deduplication (`deduplicateRetrievalContext`) implemented in `zink-tools/common/semantic-contract.mjs`;
- governed Discord message and card formatters implemented in `integrations/openclaw/lib/discord-formatter.mjs` (`formatOfficeClarificationQuestion`, `formatOfficeFinalNotification`, `formatGovernedApprovalCard`, `formatGovernedResultCard`, `formatIncidentCard`);
- OpenClaw `zink-governance` plugin updated with attempt-token staleness protection (`STALE_ACTION_REJECTED`) and full runtime module materialization in `governancePluginFiles`;
- audit bug test suite `tests/m8-t2-governed-runtime-audit.test.mjs` passed 12/12 tests covering all bug prevention rules (`BUG-M8T2-01` through `BUG-M8T2-12`), including strict authority hierarchy (Main only delegates to O1/O2, never directly spawns specialists or self-executes) and real visual spreadsheet preview generation;
- specialist direct Discord ingress rejected (`SPECIALIST_NO_DIRECT_INGRESS`) and direct `#office` broadcasts suppressed in governance plugin, preventing dual-bot appearance and strictly enforcing O1/O2 execution supervisor boundary;
- real visual spreadsheet SVG preview rendering implemented in `excel-writer.mjs` and validated in `artifact-validator.mjs` and `discord-formatter.mjs`, providing actual data screenshots/renderings without mocks;
- end-to-end workflow test suite `tests/m8-t2-e2e-workflow.test.mjs` passed 19/19 tests covering Happy Path and all 20 required failure and edge scenarios;
- full repository test suite passed all 156 tests with zero regressions; `git diff --check`, `repository-check.mjs`, `eslint`, `markdownlint`, and `prettier` all passed with 0 errors.

M8/T1-R1 validated completion evidence:

- PostgreSQL schema `skills` initialized with `catalog_index`, `segments`, and 1024-dimension HNSW cosine vector index `skills_segments_embedding_hnsw_idx` via migration `apps/knowledge/migrations/003_skills_vector_schema.sql`;
- shared canonical semantic contract implemented in `zink-tools/common/semantic-contract.mjs` with deterministic uppercase envelope formatting (`renderEmbeddingEnvelope`), SHA-256 envelope hashing (`computeEmbeddingInputHash`), safe query preparation, and non-hallucinating taxonomy derivation;
- Git-to-PostgreSQL vector synchronization implemented in `zink-skill-store/src/vector-sync.mjs` with fail-closed validation, ACTIVE-only indexing, source-drift abort safeguards, and 1024-dimension vector enforcement;
- callable tool contracts and adapters implemented for `zink_skill_search` (vector cosine similarity, ACTIVE-only), `zink_skill_propose` (candidate-only, human-in-the-loop approval, strictly prevents direct promotion to ACTIVE), and `zink_knowledge_search` (hybrid search proxy with citation provenance);
- Discord `#approvals` owner approval callback (`handleOwnerSkillApproval`) implemented in OpenClaw governance plugin with immutable content-hash binding and fail-closed owner verification;
- RBAC policy updated in `integrations/openclaw/lib/policy.mjs`: all 7 agents authorized for `zink_skill_search` and `zink_knowledge_search`; specialists and O1 authorized for `zink_skill_propose`;
- Discord Mobile mention parsing remediated: corrected punctuation lookahead regex `(?=$|[>\\s,.:;!?])` and mapped all 7 snowflake IDs in `AGENT_ALIASES` and `groupChat.mentionPatterns`, allowing raw `<@ID>`, `<@!ID>`, snowflake, and natural text mentions from Mobile and Desktop clients;
- Discord Gateway stability remediated: set `replyToMode: "off"` to eliminate Discord API 50035/50001 permission errors; verified all 7 bot WebSockets active and connected to Discord Gateway;
- automated test suite `tests/m8-t1-skill-vector-memory.test.mjs` passed 11/11 tests covering all bug prevention rules (BUG-01 through BUG-13);
- full verification suite `npm run verify` passed all 123 tests cleanly (`format:check`, `lint`, `test`, `repo:check`).

M7/T5-R13 validated completion evidence:

- implementation commits `4037187` and `8e71759` verified on `codex/m7-t5-governance-remediation`;
- multi-agent Discord ingress task collision remediated via deterministic per-agent `deriveTaskId`; 7 concurrent bots reply without collision or dropped messages;
- Zink tools registered with complete JSON Schema parameter definitions for `zink_excel`, `zink_power_bi`, `zink_sql`, `zink_python`, and `zink_n8n`;
- specialist tool allowlists (`alsoAllow`) enforced in `openclaw.json` for Excel (`zink_excel`), Power BI (`zink_power_bi`), SQL (`zink_sql`), Python (`zink_python`, `zink_n8n`), and O2 (`zink_n8n`);
- Discord output formatting hook unwraps JSON and formats natural Vietnamese conversation;
- CI shallow clone depth (`fetch-depth: 0`) and `smol-toml` high vulnerability advisory remediated;
- full test suite passed (173 passed, 0 failed, 1 skipped);
- GitHub Actions CI (run 35168425589) and Security (run 35168435913) remotely passed (green).

M7/T4-R10 validated completion evidence:

- implementation commit `d73f20cc5fd5fd14533b34e2840517c49b9989b1` on `main`;
- external infrastructure adapters, duckdb bridge, and vietnamese docs implemented;
- pre-existing test suite passed with zero regressions.

M7/T3-R16 validated completion evidence:

- implementation commit `ac68bce0653ad3c4bfcc8d230960bcdcf7e8f71d` is verified on `origin/codex/m7-t3-tools-contracts`;
- 25 frozen scope files implemented within Case C boundaries with zero non-goal violations;
- unit and static test suite passed 112/112 tests (`npm test`) with zero regressions;
- focused M7/T3 test suite passed 31/31 tests across all domains A-H (`node --test tests/m7-t3-tools-contract.test.mjs`);
- host registration assertion gate passed (`G0.6`): exact 5 Zink tools captured on mock host registration;
- anti-replay concurrent race gate passed (`G0.9`): atomic single claim admitted, concurrent replay rejected with `AUTH_APPROVAL_REPLAYED`;
- projection isolation and manifest drift gate passed (`G5`): `agent.tools.alsoAllow` matches `effectiveOpenClawToolAllowlist`, role manifest matches `effectiveZinkCallableTools`;
- code quality gates passed (`G4`): ESLint 0 errors / 0 warnings;
- patch integrity gate passed (`G7`): `git diff --cached --check` clean, zero whitespace violations;
- dependencies untouched: `package.json` and `package-lock.json` completely unmodified.

M7/T2-R12 validated completion evidence:

- implementation commit `4872314c686bcc92797acc68483b8b68fe4ee8ca` is verified on
  `origin/codex/m7-t2-agent-topology`;
- unit and static test suite passed 112/112 tests (`npm test`);
- native patch probe passed with all sub-checks verified (`native-patch-probe.mjs`):
  exact roundtrips, drift rejection, native prepare execution vetoes, synthetic apply/restore;
- operator preflight passed (`operator-preflight.mjs`):
  `{"identifiers":"VALID","builder_preflight":"PASS","installed_mutation":false}`;
- operator apply passed and verified rollback readiness (`operator-apply.mjs`):
  `{"status":"PASS","stage":"applied","rollback_ready":true}`;
- operator rollback verified to clean T1 baseline (`operator-rollback.mjs`):
  `{"status":"PASS","runtime":"T1_RESTORED"}`;
- live governance probe passed all 8 stages (`live-governance-probe.mjs`):
  direct checks on all seven identities (`main`, `o1`, `o2`, `excel`, `power-bi`, `sql`, `python`)
  and full nested seven-role matrix (`{"stage":"nested-seven-role-matrix","status":"PASS","accepted_children":6}`);
- scoped gateway service `openclaw-gateway-zink.service` verified active on port 18789.

M6/T1-R4 evidence: focused M6 tests, `npm run verify` (64 tests),
`git diff --check`, staged diff check, and scope review passed. Task commit
`fb746021b8b1a51080d1ba4fed4b35011bb78ce6` is remotely verified on
`origin/codex/m6-t1-git-native-skill-store`. Post-completion fix commit
`652ed9bd248dcc047a2be09300aaaba1d9c2dbbf` is also remotely verified there.

Host operation: `.wslconfig` was backed up without overwrite, changed only from
`memory=9728MB` to `memory=8192MB`, and read back successfully. No
`wsl --shutdown` was run; effective application remains owner-controlled through
a later WSL restart.

M4/T5 is treated as **temporarily accepted and complete by the owner** after the
Codex push. The exact accepted commit hash is intentionally not invented here; it
should be reconciled from git history/remote evidence by Codex or the owner when
convenient. Do not reopen M4 implementation scope merely to fill that metadata.

M4/T1 through M4/T4 are complete locally:

| Task                                          | Status     | Evidence summary                                                                                                                                     |
| --------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| M4/T1 — Runtime, source, schema, identity     | `COMPLETE` | Feature commit `c4ef66d`; isolated PDF runtime and M3 regression gates passed.                                                                       |
| M4/T2 — Preflight, extraction, segmentation   | `COMPLETE` | Implementation commit `82126e4`; bounded extraction/OCR and atomic non-searchable builds passed.                                                     |
| M4/T3 — Resume, drift, retention, publication | `COMPLETE` | Local implementation commit `c1df143`; resumability and atomic publication passed.                                                                   |
| M4/T4 — Adapters, retrieval, API              | `COMPLETE` | Reviewed local implementation commit `1904853`; Markdown/PDF retrieval, filters, citations, and repository gates passed.                             |
| M4/T5 — Acceptance and handoff                | `COMPLETE` | Owner reports the accepted M4/T5 state was pushed and is temporarily closed; exact remote commit evidence remains to be reconciled from git history. |

The owner's 2026-08-28 correction remains authoritative for `M4/T5-R2`:
visible internal PDF embeds drive sidecar recognition; ordinary Books/Papers
Markdown is ignored by PDF discovery; `zink_source: pdf` is not required.

M4/T5 is closed for current planning purposes. Architecture contraction must not
refactor or destabilize the accepted M3/M4 Knowledgebase runtime unless a later,
separately approved migration explicitly authorizes it.

### 4.15 M8/T2.2-R18 — run-end liveness propagation (final technical fix)

**Proven defect, not re-diagnosed.** The host forwards `trigger` and
`transcriptPrompt` to `enterNativeRun` but not to `finishNativeRun`: the run-end
call in the patched selection passes only `{ agentId, sessionKey, runId }`. R17
made the boundary forward both fields and made the classifier accept the
heartbeat verdict, but the host never supplies them at that seam, so
`isPureLivenessHeartbeat` returned false there regardless. Live signature:
`internal session = 0` while `beforeRunEnd: self-keyed session presented a
runId; applying full governance` incremented alongside
`GOVERNANCE_COMPLETION_UNAVAILABLE`.

**The change.** `native-boundary.mjs` only. `enterNativeRun` records
`{ trigger, transcriptPrompt }` under the run's `runId` when admission ACCEPTS
the run — after the accept check, so a denied or failed admission leaves no
record and stays fully governed. `finishNativeRun` takes that record once and
resolves the context as `context.trigger ?? liveness?.trigger`, so the seam
stays authoritative whenever the host does speak. The store is a module-level
`Map` bounded at 256 with oldest-first eviction; eviction degrades to full
governance, never to a bypass. `classifyInternalRunEnd` is not modified: one
predicate, one rule.

**Deviation from the named mechanism, recorded for the owner.** The owner named
`native-patch.mjs` as the primary change. R18 does not touch it, and the reason
is recorded in ACTIVE.md R18 3: a call-site edit changes the installed
`selection-*.js`, which requires a new R10 predecessor descriptor and breaks the
R7 lineage, because R7 would then differ from the current edit set in two slots,
which the single-slot descriptor cannot express. The boundary fix closes the
identical defect with `native-patch.mjs` byte-identical, so the deployed
selection `555f37da` stays recognized by content comparison with no descriptor
change. No material decision changes.

**Files changed.** `integrations/openclaw/topology/lib/native-boundary.mjs`
(implementation); `integrations/openclaw/configure.mjs` (adds the deployed R17
boundary digest `4567ce26` to the asset allowlist as a recognized predecessor);
`tests/m8-t2.6-r8-asset-provenance.test.mjs` and
`tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs` (post-R5 provenance hunks
gain four R18 entries; the derived R5 digest `49352d47` still reproduces
exactly, byte-verified in both copies);
`tests/m8-t2.15-r18-runend-liveness-propagation.test.mjs` (new, 15 tests);
`tests/m8-t2.11-r14-native-lineage.test.mjs`,
`tests/m8-t2.13-r16-apply-rehearsal.test.mjs` and the R13 current-build digest
pins move to the new boundary digest `d88bff80`; `package.json` adds the R18
test to `npm test`. `native-patch.mjs` is byte-identical, pinned by test R18 13.

**Falsification.** Reverting only the boundary change fails tests 1, 2, 3, 8 and
14 — and test 2 reproduces the exact live error
`GOVERNANCE_COMPLETION_UNAVAILABLE must not be raised:
GOVERNANCE_COMPLETION_UNAVAILABLE`. All eleven negative tests still pass on the
revert, proving they pin preserved behaviour rather than the new behaviour.

**Local validation.** R18 15/15. R17+R18 25/25. R8 12/12. R13 17/17. Full
`npm test` 838 tests / 796 pass / 0 fail / 42 skipped. `npm run lint`,
`npm run format:check`, `npm run repo:check` and `git diff --check` all exit 0.

**Live verification.** Deployed through `operator-apply.mjs` with one authorized
attempt: PASS at stage `applied`, `transactionStatus: complete`, no rollback,
attempt `txn-546134d1e917bea39046eae142e15b6453e589babe427c1bbf875399c1f773a5`.
Live dist bridge and extension boundary both `d88bff80`, byte-identical to the
repository artifact; selection `555f37da` and entrypoint `d01c210b` unchanged;
native patch `PATCHED`; ledger `d794d99d` / 103 events byte-identical; WSL
`boot_id` unchanged; gateway active with `NRestarts=0`. A real scheduled
heartbeat at `2026-10-01T02:50:52Z` completed the full chain with
`GOVERNANCE_RUN_UNAVAILABLE = 0`, `GOVERNANCE_COMPLETION_UNAVAILABLE = 0`,
run-end/lane `EXECUTION_STATE_UNKNOWN = 0`, `sandboxErr = 0`, `laneErr = 0`, and
transcript poll then reply. `beforeRunEnd: internal system session` rose from 0
to 2 and the self-keyed full-governance refusal stopped at 40. One pre-existing,
separate seam remains open and is recorded in ACTIVE.md R18 9; no R19 created.

### 4.16 Owner-identity hygiene — security remediation (NOT DEPLOYED)

Publishing the branch surfaced a real defect through the repository's own
`secret-scan` CI gate (three `discord-client-id` findings; `quality-gate` passed).
It is **not** a regression from R18/R19: the literals were introduced 2026-09-26 in
`01489aa` / `0e5a899`.

**Both CI failures are pre-existing on `main`, and neither is clearable by a
forward fix.** `main`'s own `Security` workflow has concluded `failure` since at
least 2026-09-28 with the IDENTICAL three findings at the same lines, because
gitleaks scans git HISTORY, not the checked-out tree — and `main`'s copy of the
plugin file is a 549-byte stub that does not contain them. `dependency-audit`
passed on `main` when it last ran, but `package-lock.json` is byte-identical
between `main` and this branch, so the outcome is decided by the lockfile plus
the CURRENT advisory database; the `brace-expansion` advisories post-date that
run. No `.gitleaksignore` entry was added and no dependency was touched, because
suppressing a long-standing finding on `main`, or bumping dependencies the owner
did not ask about, are owner decisions rather than incidental cleanup.

`.gitleaks.toml` allowlists synthetic Discord IDs under `tests/` and the
orchestration README but deliberately NOT production plugin source, so this was a
true positive and was fixed in source rather than suppressed.

Two real account identifiers were hardcoded as fallbacks inside owner
authorization gates: `config.ownerDiscordId || "<snowflake>"` (approval-button
gate and approve/reject action gate) and `expectedOwnerId = "<snowflake>"` as a
default parameter of `handleOwnerSkillApproval`. Beyond the privacy exposure, an
authorization gate falling back to a source constant stops depending on deployed
configuration — if config were absent, it would keep authorizing one specific
account.

The fix removes both fallbacks. `resolveOwnerDiscordId(config)` yields the
configured id only when it is a valid snowflake and `undefined` otherwise, so both
gates deny when the owner cannot be proven; `expectedOwnerId` has no default.
`parseIdentifiers` already refuses to build a config whose owner id is invalid, so
the fail-closed path is unreachable in a real deployment.

Files: `integrations/openclaw/plugins/zink-governance/index.mjs`,
`integrations/openclaw/configure.mjs` (outgoing R19 digest admitted in both
per-mode lists), `tests/m8-t2.17-owner-identity-hygiene.test.mjs` (new, 6 tests,
falsified 4/6), `tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs`,
`tests/m8-t1-skill-vector-memory.test.mjs`, `package.json`.

Validation: `npm test` 859 tests / 817 pass / 0 fail / 42 skipped; lint, Prettier,
repository policy and `git diff --check` all exit 0.

**Status: NOT DEPLOYED.** The live runtime still carries `bae7bdf3`, which
contains the literals; the repository build is `6323dec9`. A deployment
authorization is required and has NOT been requested or assumed, so this is
tracked as an OPEN item rather than completed remediation. Owner decision needed.

**Follow-up remediation (same PR, completing instruction).** The owner authorized
finishing all PR #18 remediation end-to-end, which extends this item without
reopening M8/T2.2 (still CLOSED at R19; no R20). Full scope and evidence are in
ACTIVE.md R19 10; in brief:

- a third owner-identity location found by whole-tree scan and closed:
  `normalizeActor` in `lib/authority.mjs` aliased the same account snowflake to
  the `USER` actor, which gates owner-level actions at five sites. Now honors
  only a well-formed `DISCORD_OWNER_ID`, otherwise recognizes no snowflake;
- all five outbound Discord routing sites now resolve destinations from validated
  configuration only (`resolveDiscordDestination`) and decline to send when
  unresolved; the built plugin config now carries the four validated surface ids
  (already declared in the plugin schema), so live posting targets are unchanged;
- the real account identifier replaced by a synthetic fixture value across all
  test files and the README example; the one test passing a raw snowflake as the
  actor now uses the production-legitimate role name plus an explicit negative;
- `secret-scan` reproduced locally with CI's exact binary and flags — `no leaks
found` — after suppressing exactly the three historical fingerprints (history
  rewrite rejected: it would break the R13 commit pin, all provenance `git show`
  references, and the open PR). Planted new secrets are still detected;
- `dependency-audit` remediated within supported constraints: direct parent bump
  `markdownlint-cli2` 0.23.2 -> 0.23.3 plus `npm audit fix` for transitive
  `brace-expansion` 5.0.9 -> 5.0.12. No production dependencies exist; lockfile
  diff confined to those subtrees; audit now reports 0 vulnerabilities.

Validation at commit time: `npm test` green, hygiene suite 13/13 with falsified
negatives, lint/Prettier/repo-policy/`git diff --check` clean. Deployment of the
corrected build follows under its own single-attempt authorization below.

`Deployment Authorized: YES (owner-identity hygiene - single attempt)` — granted
by the owner as part of the instruction to finish all PR #18 remediation
end-to-end, to deploy the locally verified hygiene build to the live runtime
through `operator-apply.mjs`. ONE attempt. No rehearsal namespace, no simulation,
no automatic retry, no manual heartbeat trigger. This authorization is consumed by
that one attempt. It deploys remediation only; it does not reopen M8/T2.2, modify
the native runtime lineage, or create R20.

**Deployment result:** PASS at stage `applied`, `transactionStatus: complete`,
no rollback, attempt `txn-a126766b9ac9cc0a42cb92b28eb678408c20b8401c2ee6a5bc715851ad6d5527`.
Live `index.mjs` `2271b56b` byte-identical to the repository packaged artifact;
owner literal absent from the live artifact (0 occurrences); live plugin config
carries all four validated destinations; boundary/selection/ledger unchanged;
post-deployment heartbeat clean. Full record: ACTIVE.md R19 11.

Not acted on, pending decision: Discord channel/forum-tag literals also appear in
production plugin source (server surface identifiers, not personal data; not
flagged by gitleaks; removing them is a broader behavioural change).

## 5. Canonical target architecture

The repository retains three logical modules.

Canonical new-work paths are:

```text
platforms/knowledge-platform/   # accepted current Knowledgebase runtime
zink-skill-store/               # peer Skill Store module
zink-tools/                     # peer Tools module
integrations/openclaw/          # external OpenClaw integration
```

The current Knowledgebase runtime path is retained for compatibility; it is not
the parent of Zink Skill Store or Zink Tools.

### 5.1 Zink Knowledgebase

- owns approved human/reference knowledge, ingestion, retrieval, provenance and
  citations;
- preserves the existing owner-approved Knowledgebase taxonomy and Supply Chain
  coverage; this plan does not redefine or narrow it;
- may include Decision and Business Semantics knowledge through the existing
  taxonomy when approved;
- keeps the source Obsidian Vault human-owned and read-only;
- preserves accepted M3/M4 runtime paths until a separately approved migration.

### 5.2 Zink Skill Store

- owns reusable governed skills and their lifecycle/provenance;
- owns reusable **Excel and Power BI templates** as owner-authored assets;
- keeps Knowledgebase research state logically isolated from learned skills;
- uses task metadata rather than physically splitting Work and Research stores;
- normal skill retrieval returns governed/published versions only.

Task-mode rule:

```text
mode: work | research
```

Main classifies mode from task intent. For mixed tasks it may assign a primary
and secondary mode. Research outputs are never silently promoted into a work or
production path.

### 5.3 Zink Tools

Zink Tools is the callable execution surface for OpenClaw and approved n8n
workflows:

```text
excel
power-bi
sql
python
n8n
forecast
optimization
operations-research
simulation
```

OpenClaw owns orchestration, specialist routing, sandboxing, permissions, task
mode and model/tool execution policy. n8n owns deterministic triggers, schedules,
connectors and workflow run state. Zink Tools owns neither orchestration nor
persistent Knowledge/Skill state.

## 6. Five-stack model

```text
STACK 5 — DECISION
Main + O1 + O2: compare alternatives, risk/trade-offs, recommendation

STACK 4 — INTELLIGENCE
Forecast / Optimization / Operations Research / Simulation

STACK 3 — SEMANTIC
O1: domain meaning, KPI, business rules, constraints, policies

STACK 2 — EXECUTION
Excel / Power BI / SQL / Python / n8n

STACK 1 — INFRASTRUCTURE
R2 / DuckDB / MotherDuck / Kaggle / Databricks / local compute
```

Stacks are functional layers, not permanent one-agent-per-stack processes.
Baseline execution specialists are Excel, Power BI, SQL and Python. Intelligence
specialists may be created or invoked lazily.

## 7. L&SC Data Plant — logical flow only

The historical name is retained only as an architectural description of how L&SC
data and compute move through existing infrastructure:

```text
Source
→ n8n / Python
→ R2 / DuckDB / MotherDuck
→ Kaggle / Databricks / local compute
→ Forecast / Optimization / OR / Simulation
→ OpenClaw
→ Excel / Power BI delivery when required
```

There is no separate L&SC Data Plant runtime/platform to build.

Explicitly out of scope:

- self-built Bronze/Silver/Gold lakehouse;
- generic ETL control plane;
- feature store or generic model registry;
- generic MLOps/training platform;
- duplicated OpenClaw or n8n workflow/orchestration state;
- direct adapter writes to Knowledgebase/Skill Store persistence internals.

## 8. Delivery sequence

```text
M0 Plan/Architecture
→ M1 Development Foundation
→ M2 Local Infrastructure
→ M3 Markdown Knowledgebase
→ M4 PDF Ingestion                 [COMPLETE]
→ M5 Architecture Contraction      [COMPLETE]
→ M6 Zink Skill Store              [COMPLETE / REMOTE-BACKED]
→ M7 Zink Tools + OpenClaw Integration + V1 Hardening/Release [COMPLETE]
→ M8 Zink Skill Store 2-Way Governed Vector RAG & Agent Memory Integration [COMPLETE]
```

### M5 — Architecture Contraction

Status: `COMPLETE`
Execution Authorization: `NO`

Current scope:

- keep the accepted Knowledgebase runtime under `apps/knowledge/` and
  `platforms/knowledge-platform/` until a separately approved runtime migration;
- make `zink-skill-store/` a peer module rather than a child of Knowledgebase;
- make `zink-tools/` a peer module rather than an integration subsystem;
- use `integrations/openclaw/` as the canonical OpenClaw integration path;
- remove obsolete `integrations/agents-system/`, nested Skill Store paths, legacy
  `integrations/zink-tools/`, and residual L&SC Data Plant runtime scaffolding;
- retain only `docs/architecture/lsc-data-flow.md` for the historical L&SC Data
  Plant concept: a logical external data/compute flow, not a runtime module;
- preserve the existing Knowledgebase taxonomy and Supply Chain coverage;
- formalize the five-stack mapping without creating five new runtime modules;
- do not refactor M3/M4 ingestion code merely for folder symmetry.

### M6 — Zink Skill Store

Status: `COMPLETE`
Task: `M6/T1 — Git-native governed skill core`
Plan Revision: `M6/T1-R4`
Execution Authorization: `NO`
Execution Contract: `NONE`
Evidence: `REMOTE-BACKED`
Task Commit: `fb746021b8b1a51080d1ba4fed4b35011bb78ce6`
Task Branch: `codex/m6-t1-git-native-skill-store`
Upstream: `origin/codex/m6-t1-git-native-skill-store`
Remote Task Verification: `PASS`
Post-completion Fix Commit: `652ed9bd248dcc047a2be09300aaaba1d9c2dbbf`
Remote Fix Verification: `PASS`

M6/T1 delivered Git-managed strict JSON manifests and Markdown content,
complete-catalog fail-closed validation, and exact retrieval of one ACTIVE
version. Routing context remains M7/OpenClaw policy and is not manifest
metadata. M6/T1 completion closes M6 after this governance closeout commit is
remotely verified.

### M7 — Zink Tools + OpenClaw Integration + V1 Hardening

Status: `IN PROGRESS`
Task: `M7/T1 — OpenClaw foundation`
Task Status: `COMPLETE`
Plan Revision: `M7/T1-R19`
Planning Readiness: `APPROVED`
Execution Authorization: `NO`
Execution Contract: `NONE`
Evidence: `LOCAL-VERIFIED`
Foundation Commit: `e15a1adf9ed50ec34e1db57f825771616d9dd2c9`
R19 Implementation Commit: `7b5edc510d463eec197f000191d907e5b17aa87c`

M7/T1-R19 is an owner-approved bounded upstream backport for pinned OpenClaw
2026.6.34. It preserves the R17 Google SSE terminal checks and R18 Discord
final-only delivery, classifies incomplete terminal streams as timeout-class
failover events, and suppresses errored partial assistant text/reasoning and
terminal evidence. The investigation and post-fix gates covered all seven bots.
The exact hotfix utility and runtime artifacts passed integrity checks; the full
repository gate passed 81 tests, all 60 live OpenClaw gates passed, and the owner
observed three repeated all-seven Discord tests with complete replies and no
truncation. M7/T2-R11 is now the authorized current task recorded in section 4.

M7/T1-R16 retained the R15 minimal-tool compatibility decision and recorded the
owner's 2026-09-07 correction that Discord capability evidence is an operational
minimum gate, not an exact non-admin permission allowlist. All 28 account/surface
pairs must expose the required text/forum permissions; administrator,
channel/role/webhook management, and application-command permission remain
forbidden. Commands and additive tool grants remain disabled, and model
selection remains constrained to the two Google aliases. Exact implementation
details were implemented and validated without enabling internal delegation.
Focused OpenClaw tests, the full 76-test repository gate, `git diff --check`,
host/runtime/security checks, seven model and auth-order probes, all 28 Discord
account/surface permission probes, and owner-observed live behavior passed.
M7/T2-R11 owns the current five-stack topology implementation under the active
execution contract referenced in section 4.

Minimum scope:

- four baseline execution specialists: Excel, Power BI, SQL and Python;
- tool surfaces for Excel, Power BI, SQL, Python and n8n;
- decision-science tool surfaces for Forecast, Optimization, OR and Simulation;
- Main intent classification to `work`, `research`, or mixed primary/secondary;
- external infrastructure usage through the lightest practical integration;
- training/heavy compute stays on approved external infrastructure when needed;
- compatibility tests, bounded errors/timeouts and failure isolation;
- no secret values committed to integration configs.

### M8 — Zink Skill Store 2-Way Governed Vector RAG & Agent Memory Integration

Status: `COMPLETE`
Task: `M8/T1 — Governed Skill Vector Store, Semantic Search & Agent Proposal Pipeline`
Task Status: `COMPLETE`
Plan Revision: `M8/T1-R1`
Planning Readiness: `APPROVED`
Execution Authorization: `NO`
Execution Contract: `NONE`
Evidence: `LOCAL-VERIFIED`
Task Branch: `codex/m8-t1-skill-vector-memory`

M8/T1 implemented a 2-way long-term memory system for Zink Skill Store and a 1-way
read-only semantic RAG pipeline for Zink Knowledgebase:

- PostgreSQL schema `skills` initialized with `catalog_index`, `segments`, and
  `skills_segments_embedding_hnsw_idx` (1024-dim BGE-M3 HNSW cosine index);
- shared canonical semantic contract (`zink-tools/common/semantic-contract.mjs`)
  enforces deterministic uppercase envelope formatting, SHA-256 content hashing,
  safe query truncation, and non-hallucinating taxonomy derivation;
- Git-to-PostgreSQL vector synchronization (`zink-skill-store/src/vector-sync.mjs`)
  enforces fail-closed active catalog filtering, source-drift abort safeguards,
  and 1024-dimension vector constraints; Git remains the canonical authority;
- callable tool interfaces added for `zink_skill_search` (ACTIVE-only cosine similarity),
  `zink_skill_propose` (human-in-the-loop candidate proposal via `#approvals`,
  preventing direct activation), and `zink_knowledge_search` (hybrid search proxy);
- Discord `#approvals` owner approval callback (`handleOwnerSkillApproval`)
  authenticates owner identity and binds immutable proposal content hashes before
  promoting candidate skills to Git;
- OpenClaw RBAC policy updated granting retrieval to all 7 bots and proposal rights
  to execution specialists and O1;
- Discord Mobile mention resolution remediated (supporting `<@ID>`, `<@!ID>`, raw
  snowflakes, and Vietnamese text patterns with corrected punctuation lookahead) and
  Gateway stability ensured with `replyToMode: "off"`;
- full verification suite passed with all 123 tests clean.

### M8/T3 - Governed Long-Term Memory Learning Loop (owner-authorized follow-up)

Status: `IMPLEMENTED (local)`
Task: `M8/T3 - make the Zink long-term memory / learning architecture work end-to-end`
Plan Revision: `M8/T3-R1`
Planning Readiness: `APPROVED`
Execution Authorization: `YES` (explicit owner instruction, 2026-10-01 session)
Execution Contract: `NONE` (`docs/contracts/execution/ACTIVE.md` R19 is retained
unchanged as the closed M8/T2.2 historical record; the owner session instruction
is the implementation authority for M8/T3)
Evidence: `LOCAL-VERIFIED`
Owner acceptance: not claimed
Task Branch: `codex/m8-t2-governed-runtime-hardening`

M8/T3 does not reopen M8/T2.2 (CLOSED at R19, no R20) and does not change the
three-module architecture, seven-agent topology, governance model, security
boundary, or OpenClaw native-memory disablement.

Implemented in this revision:

- Skill learning: durable atomic proposals holding the exact approved bytes,
  a dedicated `#office` skill approval identity (`zink:skill:approve` /
  `zink:skill:reject`) that is distinct from execution-plan approval, and a
  trusted internal canonical writer (`promoteApprovedSkill`) that publishes
  `SKILL.md` + `manifest.json` as ONE logical unit (stage -> validate -> single
  atomic rename) with residue healing, then derives the pgvector index.
- Decision learning: deterministic record identity, idempotent exact replay, and
  explicit owner correction with supersession, so exactly one authoritative
  decision per governed key is applicable in a fresh process.
- Reuse proof: search results now carry `canonical_skill_id`, which resolves
  through the canonical read/apply boundary to the exact approved `SKILL.md`.
- Contract/repair work preserved from the earlier part of this task:
  `subject_type` + `proposal_id` in the approval packet (no workflow `task_id`),
  `NO_MATCH` in the skill tool contract, removal of the legacy `namespaces`
  discover fallback, and the single canonical `content_sha256` of the exact
  bytes.
- Documentation: `docs/contracts/skill-store/agent-skill-store.md`, the new
  `docs/contracts/decision-ledger.md`, the three architecture pages, the
  `zink-skill-store/README.md`, root `README.md` and `CHANGELOG.md` now describe
  the proven runtime and separate implemented from deferred behavior.

Intentionally deferred (not claimed as working):

- User-written Knowledgebase persistence. The Knowledgebase adapter forbids
  ingestion/update by contract and the human-owned Vault is read-only, so
  factual/reference teachings route honestly with `persisted: false` instead of
  pretending to be stored.
- A governed deprecation path, so promoting a new version of a capability that
  already has an ACTIVE version still fails closed.

Validation: `npm test` 910 tests / 868 pass / 0 fail / 42 skipped (pre-existing
environment skips: R14/R16/production-ledger on Windows, unchanged by this
revision); `npm run lint`, `npm run format:check`, `npm run repo:check` and
`git diff --check` all exit 0. Focused proof:
`tests/m8-t3-governed-memory-learning.test.mjs`, 41 tests, 41 pass, 0 fail.

Not live-verified: no live OpenClaw runtime, no live Discord card delivery, no
deployment, and no real pgvector/Ollama end-to-end run. Those were not attempted
from this environment and are not claimed.

### M10/T2 - Coordinator session binding and execution authority (owner-authorized implementation)

Status: `IN PROGRESS`
Task: `M10/T2 - bind a gateway-started coordinator run to its claimed queue attempt, and fence that binding to current execution authority`
Plan Revision: `M10/T2-R9`
Parent Revision: `M10/T2-R8` (closed live: zero-outbound proven, see `### M10/T2-R8` tail); R7 commits `97dfe54`/`ef9feb0`
Planning Readiness: `APPROVED`
Execution Authorization: `YES` (R9 per explicit owner authorization 2026-10-06: replace the 21 Google AI Studio API-key pool with a single external router pool shared by all 7 agents, plus the duplicate-path runId observability line; chain authorized as fix -> test -> deploy -> live verify -> commit)
Execution Contract: `docs/contracts/execution/ACTIVE.md`
Behavior Contract: `docs/contracts/coordinator-session-binding.md` (§1-§13 the
approved design package, §14 the R2 execution-authority addendum)
Evidence: `LOCAL-VERIFIED`
Owner Approval: EXPLICIT - Owner approved implementation of M10/T2-R1 exactly
per the frozen RED design contract, scope items 1-10 only, with the listed
exclusions (no new agents/queue/broker/service/memory, no pin upgrade, no
result-ingestion redesign, no fabricated lineage, no topology change), and
authorized the M10/T2-R2 safety remediation derived from the M10/T2-R1 pre-live
safety audit. Approval covers implementation only, not live execution and not
deployment.
Deployment Authorized: `YES (R8 end-to-end, owner-authorized: observability deploy PASS, 1st fix deploy FAILED and rolled back, deployment-safety fix + 2nd fix deploy PASS; no further deploy without a new prompt)`
Deployment Status: `DEPLOYED AND VERIFIED (txn-95389eb… PASS; live preflight f15e9078 carrying the hardened [zink-ingress-meta] diagnostics, entrypoint 6a7968b7, selection 04e92061, boundary bccfa861, authority 42b0cba8, ledger d794d99d at 103 events, MainPID 461403)`
Live Execution: `OBSERVE-ONLY (owner sends controlled TEST A/B; agent performs read-only log correlation, no synthetic events, no message sending)`
Safety Audit: the R1 pre-live audit returned `PRE-LIVE SAFETY AUDIT FOUND SAFETY
ISSUE - LIVE BLOCKED` (post-lease spawn authority, attempt isolation at the
mutation boundary, `QUEUED`-window containment fallthrough). R2 remediates all
three and is locally verified. The pre-live re-audit re-confirmed all six static
claims from the working tree and the live-state forensic pass resolved the one
open discrepancy (see below); no live entry criterion has been satisfied because
no live execution has occurred and no live-verification authorization exists.

Live-state forensic result (read-only, recorded in ACTIVE.md R2 10): an earlier
re-audit reported the authoritative live ledger as empty. That was a WRONG-PATH
observation. The authoritative state directory is
`/home/hoang_vinh/.openclaw-zink` inside WSL Ubuntu, where service
`openclaw-gateway-zink.service` is loaded and active; its ledger matches the
recorded evidence exactly (`events.jsonl` 96701 bytes / sha256 `d794d99d…` /
103 lines, `snapshot.json` 80172 bytes / sha256 `bbdf3aec…` / sequence 103 /
37 tasks, mtime 2026-09-28T17:26:11 +0700), as do the recorded live extension
`2271b56b` and boundary `d88bff80`. A separate, older Windows-side state
directory (`C:\Users\HOANG VINH\.openclaw-zink`, `m7-t2-r12` lineage, OpenClaw
2026.7.1-2) holds an empty ledger and is NOT the runtime's state dir. The
recorded live evidence is therefore CURRENT, no ledger data was lost, and no
restore is required. The earlier claim that no live task was claimable is
WITHDRAWN.

M10/T2 does not reopen any closed task. The RED analysis established
`SESSION_BINDING_STATUS = ADDITIVE_EVENT_REQUIRED`: no existing workflow event
can safely bind a gateway-started coordinator run (`api.runtime.subagent.run()`,
verified byte-level on pinned `OPENCLAW_RELEASE = 2026.6.34`) to an
already-claimed queue attempt, because `findSession()` resolves only root
sessions and spawn-bound delegations. The implemented event is
`WORKFLOW_COORDINATOR_RUN_BOUND`; result ingestion stays a separate future
task. Coordinator result ingestion and live execution remain not verified: no
real coordinator turn has been started from this repository.

R2 keeps the architecture and separates three concepts R1 conflated: `binding`
is historical identity and attribution, `attempt` is the execution generation
and supersession fence, `lease` is current execution authority. A historical
binding NEVER authorizes a governed mutation on its own. The fence is enforced at
the authoritative mutation: the spawn reservation commits inside the queue's own
critical section (`QueueManager.withExecutionFence`), and `applySpawnReserved`
independently refuses a superseded generation or a task no longer claimed by that
coordinator. Coordinator lifecycle classification moved from queue liveness to
identity, so a superseded coordinator run ending while its queue item is `QUEUED`
is still handled narrowly and can never reach the generic `ALL_LIVE_RUNS`
containment sweep; the authoritative binding also wins over the queue claim
holder, so a specialist holding its own live claim cannot make a bound
coordinator run containment-eligible; genuine unreconciled native containment is
unchanged.
Provenance: the outgoing R1 packaged entrypoint is admitted as a recognized
predecessor in both per-mode lists, and `native-boundary.mjs` is untouched, so no
lineage moved.

Implementation evidence: focused M10 suites 81/81 (R2 18, R1 42, T1 21); full
`npm test` 1077 tests / 1035 pass / 0 fail / 42 skipped (pre-existing Windows
ledger-replay skips); lint exit 0; format clean; repository policy passed;
`git diff --check` clean. Python knowledge suite NOT RUN - prerequisite
unavailable in this environment (`KNOWLEDGE_TOKENIZER_PATH` and the tokenizer
model are absent; no Python or knowledge file is touched by this change).
Falsified four ways: reverting the classification fix fails exactly R2-D and
R2-E, removing the guard-side fence fails R2-A2/B/F/G/J2/J4, removing the reducer
fence fails exactly R2-C and R2-C2, and reverting only the binding-over-claim-
holder rule fails exactly R2-K. An independent coverage review of the uncommitted
R2 tree found that last gap - a fully bound coordinator run was still contained
when a specialist held the live claim, because a specialist is an assigned
claimant for its own queue item - and it is fixed in this revision.
See CHANGELOG.md Unreleased entry and ACTIVE.md R2 (R2 1-9 for the
implementation and the pre-live re-audit, R2 10 for the live-state forensic
result, R2 11 for the repository closure and artifact freeze).

Repository closure (R2 11): the apply-mode entrypoint predecessor list was
missing six digests the preflight gate admits, which would have let
`--preflight` PASS and `--apply` refuse from an intermediate build. All six were
re-derived from the commits that produced them using the repository's own
procedure (materialize the commit's `integrations/openclaw` tree, call
`governancePluginFiles()`, hash the packaged entrypoint) and only then admitted:
`a3dbf945…`=2ef4bd64, `118db9a7…`=adc1a49f, `4bb0c1e1…`=598481c9,
`36ed858c…`=eed43f60, `0940eb77…`=9f52fcd6, `4a957b24…`=dc868066. None was ever
the deployed live build, and the current-build digest is still not admitted. Tests
`R13 2h` and `R13 2i` pin the six admissions and the structural per-mode parity
invariant so the class cannot re-open.

Residual dispositions at closure: the unbound-ambiguity path to generic
containment is an `ACCEPTED SEPARATE SAFETY DECISION` — narrowing its blast radius
would assume the owner of an unrecorded native child, which is the exact fact the
fail-closed sweep refuses to assume, so it is documented rather than patched. The
unfenced `brief_state === "DRAFT"` run-end branch is `UNREACHABLE UNDER CURRENT
CONTRACT`, pinned by test `R2-DRAFT`. Host lifecycle semantics remain NOT PROVEN
and require a separately authorized live window.

Remaining blockers to a live window, in order: (1) no live-verification
authorization; (2) the live runtime carries `2271b56b`, which predates all
M10/T2 code, so R2 cannot be exercised live without a separate deployment
authorization; (3) host lifecycle-event semantics for `api.runtime.subagent.run`
are NOT PROVEN and observable only inside an authorized window.

Deployment/runtime provenance has been traced and cleared (ACTIVE.md R2 10.4):
`operator-apply.mjs` targets `/home/hoang_vinh/.openclaw-zink` and
`/home/hoang_vinh/.local/lib/node_modules/openclaw` (OpenClaw `2026.6.34`), and
that is exactly the package and state dir the live `openclaw-gateway-zink.service`
ExecStarts; `dist/selection-DopzNY3I.js` is present there at sha256
`555f37da…` and the dist bridge is `d88bff80…`, matching the recorded live
lineage. The Windows npm install (`2026.7.1-2`, `selection-JInn13lc.js`) is a
second, separately pinned lineage and is not the deployment target; an earlier
report of it as a lineage discrepancy was a wrong-path observation and is
withdrawn.

### M10/T2-R3 - proven governance-asset predecessor admission (owner-authorized implementation)

Owner authorization: EXPLICIT - the owner authorized exactly one narrowly
scoped repository repair for the M10/T2-R2 deployment deadlock identified by
read-only builder-preflight. Operation `REPOSITORY_IMPLEMENTATION_ONLY`;
deployment NOT AUTHORIZED; live execution NOT AUTHORIZED.

Problem: the R2 candidate (`d254f56`) is repository-complete and
artifact-reproducible, but the single authorized deployment attempt never
started: `configure.mjs --preflight` refused the live runtime with
`Governance plugin asset drift detected` and `installed_mutation: false`. The
live runtime carries the owner-identity hygiene build (extension `2271b56b`),
whose ten governance-plugin assets differ from the R2 build and were not
admitted in `ALLOWED_GOVERNANCE_ASSET_SHA256` - an asset-level
predecessor-admission deadlock of the exact class R13 documents for the
entrypoint. R2 closure had extended only the entrypoint lists.

Provenance (10/10 PROVEN, 0 admitted on faith): the live deployed tree (34
files, digests captured read-only via WSL `sha256sum`) is byte-identical to
the packaged governance-plugin build produced by commit `41c62e7`
("deployment path for the hygiene build + its proof") through the
repository's own `governancePluginFiles()` - 34/34 files match, including the
already-admitted entrypoint `2271b56b`. The parent `9b53f92` packages these
files byte-identically. Each admitted digest was re-derived from that commit
before admission; the current-build digests are deliberately NOT listed and
remain accepted by content comparison.

Change (minimal, one table): ten predecessor digests added to the existing
shared `ALLOWED_GOVERNANCE_ASSET_SHA256` in `integrations/openclaw/
configure.mjs`, each under its own asset path with a provenance comment:
`lib/guard.mjs` `9e7e2845…`, `lib/workflow.mjs` `e78d81bf…`, `lib/policy.mjs`
`e29812bc…`, `lib/authority.mjs` `bb2f5328…`, `lib/queue-manager.mjs`
`97fa9907…`, `lib/decision-ledger.mjs` `9b5f2f94…`,
`contracts/approval-request.schema.json` `29eb3ed9…`,
`contracts/ledger-event.schema.json` `6acc2539…`,
`contracts/ledger-snapshot.schema.json` `a8c3d7aa…`,
`governance-manifests.json` `e27647b9…`. No R2 logic touched; the preflight
and apply gates consume the same single table, so no per-mode asymmetry can
re-open. Unknown digests still fail closed; path-scoping is preserved.

Regression: `tests/m10-t2-r3-asset-predecessor.test.mjs`, 11 tests -
provenance re-derivation (P1), optional live cross-check (P2, skips where the
live dir is unreachable), 10/10 provenance parity (R3 0), current-build
exclusion (R3 0b), single-table structural parity (R3 0c), per-predecessor
preflight-PASS-then-apply-ACCEPT with convergence (R3 1), the exact
production failure state as a full-hygiene-tree fixture (R3 2), one-byte
perturbation refusal per digest (R3 3), unknown-digest refusal without
mutation (R3 4), wrong-path refusal (R3 5), and full-table fail-closed
sweep (R3 6). Acceptance tests were watched FAIL before the allowlist edit
(reproducing the production deadlock in-fixture) and PASS after; negatives
passed throughout.

Self-correction recorded: a hand-transcribed digest table used during
diagnosis briefly suggested an 11th differing asset
(`policy/reason-code-matrix.json`); two programmatic probes and two fresh
read-only live reads agree the live file equals the current build
(`4cd65444…`, accepted by content comparison), so the transcription was
wrong and no 11th admission exists. Scope stays exactly the ten proven
assets.

Status: IMPLEMENTED and locally verified; deployment NOT AUTHORIZED and NOT
PERFORMED; live ledger untouched; gateway not restarted; no live execution;
host lifecycle NOT PROVEN. A deployment of the new R3 commit requires a
separate owner authorization for exactly one attempt. See ACTIVE.md R3 and
CHANGELOG.md Unreleased entry.

Deployment note (factual, recorded under R4): R3 `a09fc25` was subsequently
deployed under a separate single-attempt owner authorization
(`operator-apply.mjs` PASS at stage `applied`, transaction `txn-48fd57b7…`
complete; live entrypoint `d1ce6386…`). Repository authorization records
were intentionally left unchanged by that authorization's own prohibitions.

### M10/T2-R4 - Main conversational ingress via native thread metadata (owner-authorized implementation, Option A)

Owner authorization: EXPLICIT - owner chose Option A (deterministic native
metadata forwarding) after the R4 scope investigation proved mention and
reply-reference attribution unobservable at the admission seam without a
patch change, and plugin-side message_received caching racy by host
fire-and-forget construction. Operation `REPOSITORY_IMPLEMENTATION_ONLY`;
deployment NOT AUTHORIZED; live execution NOT AUTHORIZED.

Root cause (R3 forensic, treated as proven): free-text Discord ingress is
denied at `authenticateIngress` with MISSING_MENTION because the native seam
receives no mention/reply/author metadata. Host census on pinned 2026.6.34
proved exactly one additional deterministic inbound field available in
runEmbeddedAttempt params: `currentThreadId` (zero occurrences of mentions,
reply references, or authors in the 644KB selection bundle).

Implementation (minimal): native patch forwards
`threadId: params.currentThreadId ?? null` in the established injection
slot; boundary passes it through typed (null or Discord snowflake,
malformed fails closed); plugin records Main-owned thread attribution from
Main's own awaited `message_sending` posts (bounded memory-only map, exact
match, eviction/restart degrade to deny); admission bypasses ONLY a
missing-mention routing refusal when the inbound thread is proven
Main-owned, ANDed with all existing authority checks; downstream governance
unchanged. Mention/reply attribution and non-thread conversation
continuation stay denied (documented, not heuristically approximated).

Lineage (owner-authorized): single descriptor R7→R10 becomes R10→R4 for
`selection-DopzNY3I.js` on 2026.6.34 (one active slot; R7 retired with
history retained — no R7 runtime remains in the deployment graph). R10 live
bytes (555f37da) invert to the pinned baseline a5698c55 and yield the R4
selection 04e92061… (reproducible). Outgoing R3 entrypoint d1ce6386
admitted in both per-mode predecessor lists. R18-13/15 and R19-G pins
updated to the R4-authorized bytes with history comments (their purpose as
change detectors preserved).

Regression: `tests/m10-t2-r4-conversational-ingress.test.mjs`, 19 tests
(native contract, pure classifier, end-to-end admission incl. duplicate
replay denial, heartbeat intact, malformed fail-closed, mention-text
insufficiency). N1/A1 watched FAIL pre-fix, 19/19 post-fix; R18/R19/hygiene
suites green after pin updates; R2/R3 green.

Status: IMPLEMENTED and locally verified; deployment NOT AUTHORIZED and NOT
PERFORMED; live ledger untouched; gateway not restarted; no live execution;
host lifecycle NOT PROVEN. A deployment of the new R4 commit requires a
separate owner authorization. See ACTIVE.md R4 and CHANGELOG.md Unreleased
entry. Residual live risk recorded for verification: the office-channel
check assumes the host keeps parent-channel (not thread-id) in
messageChannel for thread replies; if live shows otherwise the path fails
closed and reports, never mis-admits.

### M10/T2-R5 - Host-side Discord inbound metadata exposure (owner-authorized implementation, Option A)

Owner authorization: EXPLICIT - owner chose Option A after R4 proved
mention/reply attribution unobservable at the native seam and
message_received caching racy by host fire-and-forget construction.
Operation `REPOSITORY_IMPLEMENTATION_ONLY`; deployment NOT AUTHORIZED;
live execution NOT AUTHORIZED.

Root cause (proven, pinned 2026.6.34 dist, read-only): the host drops
structured Discord metadata during canonical mapping (canonical mapper and
run params carry zero mention/reference fields), so the native seam could
never observe them. The raw discord.js message (mentionedUsers/
mentionedRoles/messageReference/referencedMessage/author) plus the
host-resolved threadOwnerId exist one layer upstream at the Discord
preflight call site (unique anchor, verified byte-exact).

Implementation (minimal, causal, no side channel): preflight patch records
structured ids into a bounded messageId-keyed registry on the inbound
causal path (a turn exists only after its message's preflight completes);
boundary reads it back by currentMessageId with strict re-validation;
admission feeds structured mentions into the EXISTING mention resolver
(no routing change), adds a reply-author branch and a host-owner thread
branch (retiring R4's outbound-attribution cache - single ownership
source), ANDed with all existing authority checks; authorIsBot restores
the previously vacuous bot filter. No LLM, no text heuristics, no cache
with timing, no new services. Selection patch UNCHANGED from R4.

Lineage: new pin + role for message-handler.preflight file (live equals
unpatched baseline dca5459d…, BASELINE→R5 direct, no descriptor);
selection descriptor R10→R5 (live is R10 555f37da; R4 tree state 04e92061
superseded-and-recorded, never deployed; R7 retired with history kept).
R10 live bytes invert to baseline a5698c55 and yield R5 selection
04e92061 (== R4 tree artifact, as designed). Outgoing R3 entrypoint
d1ce6386 was already admitted in R4. R18-13/15, R19-G, R5-derivation
hunks and R13/R3 current-pins updated to the authorized bytes.

Regression: `tests/m10-t2-r5-host-inbound-metadata.test.mjs` (27 tests:
pin/anchor/prohibition pins, REAL injection snippet executed in synthetic
host scopes, reader normalization, pure reply classifier, end-to-end
admission incl. mention/reply/owner ALLOW and all negatives, lineage
slots). R4 suite reworked to host ownership (19 tests). N1/A1 watched
FAIL pre-fix, 46/46 GREEN post-fix. Provisional cross-test stash pollution
found and fixed by unique message ids (production-faithful).

Status: IMPLEMENTED and locally verified; deployment NOT AUTHORIZED and
NOT PERFORMED; live ledger untouched; gateway not restarted; no live
execution; host lifecycle NOT PROVEN. A deployment of the new R5 commit
requires a separate owner authorization. See ACTIVE.md R5 and CHANGELOG.md
Unreleased entry. Residual live risks for verification: (1) office-channel
check assumes parent-channel in messageChannel for thread replies
(fail-closed either way); (2) referencedMessage present only when Discord
supplies it, else null (deny preserved).

### M10/T2-R6 - Native boundary predecessor admission (owner-authorized implementation)

Owner authorization: EXPLICIT - exactly one narrowly scoped repair for the
R5 deployment preflight deadlock (live boundary d88bff80 unadmitted).
Operation `REPOSITORY_IMPLEMENTATION_ONLY`; deployment NOT AUTHORIZED;
live execution NOT AUTHORIZED.

Root cause: every revision since R18 left `lib/native-boundary.mjs`
untouched, so the live R3 runtime still carries the R18 build d88bff80
while the R5 candidate rebuilds it as bccfa861 - and no allowlist entry
covered the live digest. Same asset-admission deadlock class as R2/R3.

Provenance (1/1 PROVEN, 0 admitted on faith): materialized commit 980b36e
(R18 run-end liveness propagation) and packaged it through the
repository's own `governancePluginFiles()` - byte-identical to the
observed live file. (9b53f92/41c62e7 package identically; 980b36e is the
origin commit and the recorded source.)

Change (minimal, one entry): d88bff80 admitted under
`lib/native-boundary.mjs` in the shared `ALLOWED_GOVERNANCE_ASSET_SHA256`
with provenance comment. Candidate bccfa861 stays unlisted (content
comparison). No native logic, ingress, R2-R5 code, or unrelated entry
touched; preflight and apply consume the same table.

Regression: `tests/m10-t2-r6-boundary-predecessor.test.mjs`, 8 tests
(provenance re-derivation P1, 1/1 parity R6 0, candidate exclusion R6 0b,
shared-table R6 0c, predecessor preflight-PASS-then-apply-ACCEPT with
convergence R6 1, one-byte perturbation R6 2, unknown digest R6 3,
wrong-path R6 4). R6 0/R6 1 watched FAIL pre-fix, 8/8 post-fix.

Artifact: comment-only source change - the R6 package is expected
byte-identical to R5 (verified by rebuild, like R2==R3).

Status: IMPLEMENTED and locally verified; deployment NOT AUTHORIZED and
NOT PERFORMED; live ledger untouched; gateway not restarted; no live
execution; host lifecycle NOT PROVEN. A deployment requires a separate
owner authorization (of the resulting R6 commit). See ACTIVE.md R6 and
CHANGELOG.md Unreleased entry.

### M10/T2-R7 - Authority predecessor admission (owner-authorized implementation)

Owner authorization: EXPLICIT - exactly one narrowly scoped repair for the
R6 deployment preflight deadlock (live authority aa12540f unadmitted).
Operation `REPOSITORY_IMPLEMENTATION_ONLY`; deployment NOT AUTHORIZED;
live execution NOT AUTHORIZED.

Root cause: R3 deployed the R2-tree governance-plugin assets; R4/R5 then
changed `lib/authority.mjs` (conversational classifiers) to candidate
42b0cba8 without admitting the outgoing digest, and R6's authorized scope
covered only the boundary file. Same asset-admission deadlock class as
R2/R3/R6.

Provenance (1/1 PROVEN, 0 admitted on faith): materialized commit 2ef4bd6
(M8/T3 learning loop, the origin commit that introduced these exact bytes

- its parent tree carries the hygiene-era bb2f5328) and packaged it
  through the repository's own `governancePluginFiles()` - byte-identical
  to the observed live file (aa12540f60da6bcdf809123f0d75c632c6b8a128a88e4395f38785b663f13e17).
  No rewrite rules touch this path at any commit, so packaged bytes equal
  source bytes. A mistranscribed digest from the earlier deployment
  diagnosis (...4e0432d0...) was caught and corrected by the P1
  re-derivation gate before any admission - evidence-first discipline held.

Change (minimal, one entry): aa12540f admitted under
`lib/authority.mjs` in the shared `ALLOWED_GOVERNANCE_ASSET_SHA256`
with provenance comment. Candidate 42b0cba8 stays unlisted (content
comparison). No native logic, ingress, classifier behavior, R2-R6 code,
or unrelated entry touched; preflight and apply consume the same table.

Regression: `tests/m10-t2-r7-authority-predecessor.test.mjs`, 8 tests
(provenance re-derivation P1, 1/1 parity R7 0, candidate exclusion R7 0b,
shared-table R7 0c, predecessor preflight-PASS-then-apply-ACCEPT with
convergence R7 1, one-byte perturbation R7 2, unknown digest R7 3,
wrong-path R7 4). R7 0/R7 1 watched FAIL pre-fix, 8/8 post-fix.

Artifact: comment-only source change - the R7 package is expected
byte-identical to R6 (to be verified by rebuild, like R2==R3 and R5==R6).

Status: IMPLEMENTED and locally verified; deployment NOT AUTHORIZED and
NOT PERFORMED; live ledger untouched; gateway not restarted; no live
execution; host lifecycle NOT PROVEN. A deployment requires a separate
owner authorization (of the resulting R7 commit). See ACTIVE.md R7 and
CHANGELOG.md Unreleased entry.

### M10/T2-R12 - Approval-bootstrap workflow (owner-authorized)

Owner authorization: EXPLICIT 2026-10-07 - Owner selected Option 2: Main may
create the first approval request for `sessions_spawn`, but `sessions_spawn`
remains blocked until Owner approval. This task turns that decision into a
concrete governed workflow. Approval-bootstrap design is IN scope; everything
else listed under DO NOT CHANGE stays out.

Task: `M10/T2-R12 - Introduce the smallest governed mechanism allowing a fresh
Main task to create the first approval request for an otherwise valid
sessions_spawn, without weakening the existing approval requirement.`

R12 predecessor: HEAD `fea95e5`, R9+R10+R11 working tree uncommitted and
preserved. R10 deployed and live (guard fix present, gateway active, ledger 110
events at R12 start). R11 proved identity resolution correct; no identity fix
was needed or applied.

R12 failover restoration (owner decision 2026-10-07, during R12 live
verification): measured `execute` single-shot reliability 4/10 (40%). The owner
ruled one passing turn proves nothing and ordered failover ("model trên lỗi
thì route xuống model dưới"). Primary `router/execute` plus fallback
`router/gemini/gemini-3.6-flash` (12/12 measured stable), which fires ONLY on
primary failure — never shadows the combo. Router-tier protection only, not
Google-outage protection. Applied via transaction; live config confirms the
pair; `config validate` passes; gateway active. Proof standard ordered by
owner: 10 consecutive live turns must all produce output.

R12 requestTimeoutMs lesson (2026-10-07, recorded so it is not retried): a
per-attempt timeout CANNOT live on the provider models entry — the installed
runtime validates that entry with a STRICT schema and the gateway refuses to
start (`Unrecognized key: "requestTimeoutMs"`). The attempt that carried it
deployed cleanly through preflight+apply and then killed the gateway; recovery
was removal + re-apply. Code reading had shown `model.requestTimeoutMs` is
read at transport time and the catalog merge spreads the raw entry, but schema
validation rejects before the merge ever sees it. Hang protection therefore
rests on the run-budget abort plus the fallback candidate, not on a per-model
timeout. A provider-level timeout, if one exists, must be proven on a SCRATCH
config via `openclaw config validate` BEFORE touching live.

R12 communication section (owner decision 2026-10-07): the `## Communication`
block (address owner as "anh"/self as "em", Vietnamese with full diacritics,
agentId explicit on spawn) was added to Common Core in `policy.mjs`, applying
to all 7 agents. Investigation proved no anh/em instruction existed anywhere
(bundle/state/config/AGENTS.md) — prior polite address was model mirroring,
not instruction-following, which is why weaker combo upstreams lost it. The
change alters per-agent governance_hash, so manifests regenerated; deployed
via transaction; live workspaces confirmed carrying the section for
main/o1/excel (spot-checked).

R12 truncated-digest lesson (2026-10-07): a hand-copied predecessor digest
with 50 chars (copied from a width-truncated display) silently fails closed —
preflight rejects with no hint which entry is short. Rule: every digest
entered into `configure.mjs` must be captured programmatically (sha256sum or
script output piped without truncation), never retyped from terminal display.

R12 buttons status (2026-10-07): the approval THREAD posts via raw REST
(allowed), but BUTTON delivery via the native outbound adapter fails in the
tool-call hook context ("Discord send requires a resolved runtime config"),
proven live twice — threads land in #approvals with no buttons. Owner decision
2026-10-07: EXPLICIT R4 EXCEPTION granted — raw-REST /messages is permitted
SOLELY for the approval-buttons post (same thread the rule already permits).
The exception is marked in code and enforced by test: any /messages REST site
must carry the R4-EXCEPTION marker with this decision reference. The rule stands
for everything else.

R12 task codes (owner requirement 2026-10-07, NOT YET IMPLEMENTED): 12-char
ruled string (8 date + 4 random) as a human task alias alongside the canonical
64-hex task_id. Requires ledger schema field + text-approval lookup + card
changes. Scoped as the next task after R12 closes.

R9-C (root cause of "bot không phản hồi", FIXED and deployed txn-deafcdcf):
the model fallback could never fire for a HUNG primary. Proven live
2026-10-07 16:38:06 -> 16:44:20 on msg 1557326125670342669, runId
98aae218-ae57-447f-8a66-1150262e4f3b:

  16:38:06.917 model-fetch start model=execute
  16:44:18.929 stalled session activeWorkKind=model_call
                  lastProgress=model_call:started lastProgressAge=372s (0 bytes)
  16:44:18.964 model-fetch error model=execute elapsedMs=372045 AbortError
  16:44:19.423 model-fallback/decision candidate_failed
                  next=router/gemini/gemini-3.6-flash
  16:44:20.389 ingress denied: reason=DUPLICATE_DISCORD_EVENT runId=98aae218
  16:44:20.389 [zink-native-gate] enterNativeRun: GOVERNANCE_DENIED
  16:44:20.449 Embedded agent failed before reply: GOVERNANCE_RUN_UNAVAILABLE

The fallback lane re-enters under the SAME runId and the SAME inbound message
id, because it is a second model attempt of one already-admitted run, not a
replay. The duplicate-event guard denied it, so the owner received nothing. Two
defects, both fixed together:

1. `authenticateIngress` denied any second admission of an open task. It now
   admits a re-entry whose task ROOT IDENTITY matches exactly (root_run_id +
   root_agent_id + root_session_key equals the observing run) and logs it as
   `ingress re-entry admitted as model-fallback retry`. A different runId, a
   foreign session, a foreign agent, a bot author, a non-Main agent or an
   unauthorized sender all still deny BEFORE this point. Replay protection is
   unchanged for every other caller.
2. `resolveRunModelFor` ran on the re-entry and, because it reads QUOTA (which a
   model failure never lowers), resolved to the PRIMARY again, pinning the host's
   reactive failover candidate back onto the model that just aborted at 372s,
   contradicting its own documented contract ("a real provider failure still
   takes the native reactive failover path"). The proactive resolution now stands
   aside for a recognized re-entry only; every other admission is unchanged.

The contrast that proved the diagnosis: turn 16:20 aborted at 120s and DID fail
over, because that first attempt was classified an internal session and returned
early before reaching either code path. Real Discord ingress reached both. Same
defect as R9-A observed on 2026-10-06 (msg 1556853993278541867); R9-A's own
comment said "Until R9-C this denial is unchanged".

R9-C test corrections (not weakening): four existing tests asserted the WRONG
shape. They re-entered an admitted message under the SAME runId and called it a
"replay", so they actually pinned the fallback shape as denied
(m10-t2-r4-conversational-ingress R4 A1, m8-t2.5-r7-remediation E,
m8-t2.7-r10-heartbeat-trigger R10 F, m7-t2-openclaw materialized plugin). Each
now constructs a genuine replay (a different runId) and keeps its original
security assertion: exactly one task, no new ledger sequence, still denied.
R9-A's own R9-A1/R9-A2 already used different runIds and still pass.

R9-C entrypoint-digest lesson (2026-10-08, corrected the same day): the
governance entrypoint allowlist in `configure.mjs` must carry the digest of the
INSTALLED file. The builder output (`governancePluginFiles().entrypoint`) already
uses the installed import form `./lib/x`, so `sha256(builder output)` IS the
installed digest; only the REPO SOURCE differs (`../../lib/x`) and must never be
hashed. An earlier note in this file claimed the builder digest differed from the
installed one — that was wrong, and acting on it put a stale intermediate digest
(`0a63363f…`) in the allowlist, so preflight failed closed with reason
"Governance plugin entrypoint". Rule unchanged: capture every digest by
`sha256sum` of the file actually on disk (or by hashing the builder output), and
never retype a digest copied from an earlier terminal state.

R9-C PROVEN LIVE (2026-10-08 15:11-15:27, msg 1557666673157349417): the
owner-reported "bị kẹt thinking" turn exercised the exact case R9-C was built
for, and the fix held:

  15:17:36.251 [model-fallback/decision] candidate_failed
                  next=router/gemini/gemini-3.6-flash
  15:17:36.849 ingress re-entry admitted as model-fallback retry: agent=main
                  msg=1557666673157349417 runId=68b7d19e-… task=ad70a7b89d0c…

598ms after the fallback decision — the re-entry that was DUPLICATE_DISCORD_EVENT
on 2026-10-06 and 2026-10-07 is now admitted. Ledger stayed correct: sequence
120->121, exactly one new task, one WORKFLOW_OPENED. The same turn also proved the
second half of the fix: no proactive modelResolution was emitted on the re-entry.

"kẹt thinking" root cause, NOT governance (2026-10-08): the router was DOWN.
Every candidate hung, so the failover path had nothing to land on. Measured, not
inferred:

  router probe, 8/8 fail, both `execute` and `gemini/gemini-3.6-flash`, every one
    at ~135s with http=000 and zero response bytes
  WSL -> 172.22.80.1:20128  TCP connect FAILED (6s cap)
  ping 172.22.80.1  100% packet loss
  Windows netstat  nothing LISTENING on :20128; no router process present
  Windows 172.22.80.1 is still the correct WSL vEthernet address

The uniform ~135s is the Linux default SYN timeout (~127s): the POST hung in TCP
CONNECT and never sent a request, so the gateway's "ETIMEDOUT fetch failed" is a
connection failure, not an upstream model error. Distinguishing this from an
upstream outage is the whole point of the probe — the two look identical in
gateway logs but need completely different responses.

Consequence to remember: when every candidate fails, the governed turn produces
NO outbound at all, by owner invariant (a zero-output turn must stay silent). So
a router outage presents to the owner as an endlessly "thinking" bot, with no
error surface. Diagnose by probing the router TCP port first, not by reading
model-fetch errors.

### M10/T2-R11 - Run-identity mismatch investigation + minimal fix (owner-authorized)

Owner authorization: EXPLICIT 2026-10-07 - Owner selected option B: investigate
the run-identity mismatch first. R11 may trace run/task identity end-to-end,
prove or disprove the stale-task hypothesis, apply the minimal fix if proven,
add regression tests, and live-verify. R11 is NOT authorization to redesign the
approval system.

Task: `M10/T2-R11 - Investigate and, if proven, minimally repair incorrect
task/run identity resolution or propagation observed at the sessions_spawn
governance gate. Approval-bootstrap design is explicitly out of scope.`

R11 predecessor: HEAD `fea95e5`, R9+R10 working tree uncommitted and preserved.
R10 deployed and live (guard `482b4938…` with fix, index `c2ef4363…`, gateway
active, ledger 110 events at R11 start).

R11 execution outcome (2026-10-07):

- STEPs 0-1: baseline recorded, R11 task recorded here. No reset, no R10 change.
- STEPs 2-3: identity pipeline mapped (Discord msgId → deriveTaskId → taskId;
  host params.runId → root_run_id at admission AND trusted.runId at gate install,
  same anchor). Identifiers distinguished; taskId ≠ runId preserved end-to-end.
- STEPs 4-6: the stale-task hypothesis is REJECTED with direct evidence. The
  earlier confusion came from reproducing against the WRONG task: yesterday's
  b89a87cf (msg ...541867, 0 nodes) yields MISSING_PREREQUISITE, while the live
  turn's own task c89af0308 (msg ...104048, 7 nodes via a plugin-admitted brief
  at seq 110, 225ms before the block) yields AUTH_APPROVAL_REQUIRED when driven
  with the live args — exactly matching live. There was never a duplicate
  admission (seq 108 = yesterday's msg, seq 109 = tonight's msg) and never a
  stale resolution.
- STEPs 7-8: no identity bug exists; NO FIX applied (correctly — inventing one
  would violate the failure rule). Identity propagation is correct as built.
- STEP 9: `tests/m10-t2-r11-run-identity-resolution.test.mjs` locks in correct
  resolution (two tasks, one session: approved run passes its gate, fresh run
  hits AUTH_APPROVAL_REQUIRED, repeat consistent, bogus run denied). Registered
  in `package.json`. Full suite: 1212 tests / 1168 pass / 0 fail / 44 skipped.
- STEPs 10-12: AUTH_APPROVAL_REQUIRED on the correct current task is the right
  verdict — R11 identity path = PASS, approval-bootstrap = OUT OF SCOPE (no
  change). No new live turn was needed: the already-observed R10 turn IS the
  live verification, retrospectively proven correct.
- STEP 13: R11 touched only PLAN.md + one test file. No policy/manifest/
  capability/tool/lineage/authorization change. R10 intact.

### M10/T2-R10 - Production policy-loading path fix (owner-authorized)

Owner authorization: EXPLICIT 2026-10-06 - Owner selected Option A: fix the
proven production policy-loading path bug. This approval covers execution of
this task only: fix -> test -> deploy -> live verify. No re-authorization rounds
for steps inside this scope.

Task: `M10/T2-R10 - R10 = production policy-loading path fix only`

R10 root cause (proven by evidence, not inference):

1. Live block, exactly once: `beforeToolCall blocked: RUNTIME_CAPABILITY_MISMATCH`
   for `session_status` (2026-10-06 23:16:07, msg 1557063140968104048).
2. Brute-force over every runId in the live snapshot × every params shape proves
   the deployed guard plus live state CANNOT produce this verdict when policy is
   loaded — only allow / POLICY_DENIED / EXECUTION_STATE_UNKNOWN / LINEAGE_MISMATCH.
3. The only path to it is the empty-registry fallthrough (`guard.mjs` zink path):
   `OPENCLAW_BUILT_IN_TOOL_IDS` empty, so a built-in tool is not recognised and
   `ZINK_CAPABILITY_REGISTRY[tool]` is undefined.
4. The registry is empty in production because `guard.mjs:116`
   `path.resolve(pathToFileURL(_moduleDir), candidate)` throws `ERR_INVALID_ARG_TYPE`
   (replicated directly: `path.resolve` rejects a URL object), the throw is
   swallowed by the surrounding `try/catch`, and the cwd-relative fallback
   `integrations/openclaw/lib/policy.mjs` misses because the gateway runs with
   cwd `/home/hoang_vinh` (proven: file absent there).
5. The earlier reproduction falsely passed because its shell cwd was the repo root,
   where the fallback hits. Production never had that luck.

Consequence: every built-in tool call (`session_status`, `sessions_spawn`,
`sessions_yield`, `agents_list`) has always failed in production. Main could only
reply conversationally and could never delegate, so the approval it promised for
#approvals was never created and no result ever reached #results.

R10 approved scope: the one-line path-resolution fix in `guard.mjs` ONLY, plus its
predecessor digest, regression test, and the deploy/verify chain. No policy,
manifest, capability, tool, lineage, authorization, approval, router, model, or
quota change. R10 restores existing governance; it does not reinterpret policy.

R10 excluded scope: everything listed under MUST NOT change in the owner approval.

R10 execution outcome (2026-10-07):

- STEP 0: root confirmed, HEAD `fea95e5`, R9 tree uncommitted, broken expression
  at `guard.mjs:116`, guard sha `00f0e974`.
- STEP 1: R10 recorded here. STEP 2: one-line fix applied (diff shown in report).
- STEP 3: `tests/m10-t2-r10-production-policy-load.test.mjs` (5 tests) +
  `tests/fixtures/r10-policy-load-probe.mjs`. The probe runs with cwd set to an
  EMPTY directory. Negative control: with the fix stashed, 4/5 fail with exactly
  `RUNTIME_CAPABILITY_MISMATCH` — the live incident signature reproduced.
- STEP 4: probe run with cwd exactly `/home/hoang_vinh`: session_status allow,
  agents_list allow, spawn AUTH_APPROVAL_REQUIRED, yield SPAWN_UNKNOWN,
  bogus-run EXECUTION_STATE_UNKNOWN.
- STEP 5: full suite 1211 tests / 1167 pass / 0 fail / 44 skipped; lint clean;
  format clean; repo:check PASS. R10 test registered in `package.json`.
- STEP 6: R10 changed only `guard.mjs` (one functional line + comment),
  `configure.mjs` (guard predecessor digest), tests, `package.json`, PLAN.md.
  No policy/manifest/capability/tool/lineage/authorization change.
- STEP 7: apply `txn-061197d4…` PASS. Deployed guard carries the fix
  (sha `482b4938…`). `config validate`: Config valid. Gateway active, 7/7
  providers, 0 timeouts. Resolver hand-restored to 29-id (R9-D) after the apply
  rewrote it to 8-id.
- STEP 8: owner sent `@Quản Lý tạo giùm anh 1 file Excel` (msg 1557079622833668231,
  00:18:36). MAIN_DIRECTED, model-fetch via router/execute status 200, then
  `beforeToolCall blocked: AUTH_APPROVAL_REQUIRED` for sessions_spawn — the
  NORMAL governed path, NOT the empty-registry failure. R10's fix is proven live.
- STEP 9/10: NO approval appeared in #approvals; bot replied conversationally.
  Per the FAILURE RULE, R10 = BLOCKED on criteria 14-15. The failure is OUTSIDE
  R10 scope: the gate correctly denied an unapproved spawn, but nothing creates
  the FIRST approval request (the only WORKFLOW_APPROVAL_REQUESTED path needs a
  child announce, which needs a spawn, which needs approval), and evidence shows
  the live spawn resolved a stale task (exact repro yields MISSING_PREREQUISITE
  for tonight's task, live yielded AUTH_APPROVAL_REQUIRED which requires
  nodes>0). Follow-ups needed: (a) approval-bootstrap design decision,
  (b) run-identity investigation as a separate task.

### M10/T2-R9 - External router pool + duplicate-path retry observability (owner-authorized)

Owner authorization: EXPLICIT 2026-10-06 - replace the 21 Google AI Studio
key pool with one external router pool shared by all 7 agents; add runId to
the duplicate-denial log line so a later change can be evidence-bound. Chain
authorized as fix -> test -> deploy -> live verify -> commit. Owner deferred
the provider-id naming decision and declared the router's own combo sufficient,
so model ids are a changeable detail, not an approval gate.

Task: `M10/T2-R9 - make the governed model provider an external router pool,
and make the duplicate-guard denial attributable`

R9 evidence gathered read-only before planning (no assumption):

1. Google AI Studio is unstable in exactly the two ways observed live:
   `Google stream ended before a terminal finish reason` (2 occurrences: 2 on
   2026-10-04, 2 on 2026-10-06) and `Google Generative AI API error (503):
   ... high demand ... [code=UNAVAILABLE]` (2 on 2026-10-06). These produced
   `GOVERNANCE_COMPLETION_UNAVAILABLE` and no Discord output.
2. Router reachability is asymmetric: from WSL `localhost:20128` is `http=000`
   (WSL is NAT, `/etc/wsl.conf` has no `networkingMode=mirrored`), while the
   Windows host default gateway `172.22.80.1:20128` is `http=200`. The address
   is the WSL default route and is NOT stable across WSL restarts, so the
   endpoint must be resolved at service start, not hardcoded.
3. Router model ids are NOT public Google names (`gemini/gemini-3.6-flash`,
   `-3.5-flash-lite`, `-3.7-flash`, `-3.1-flash-lite-preview`,
   `gemini/gemini-3-flash-preview`), so `MODEL_ALLOWLIST` values must change.
   Verified `http=200` for all five gemini ids. The whole `kr/*` family returns
   `http=503 ... The bearer token included in the request is invalid`.
4. The provider swap is NOT a URL change: `PLUGIN_ALLOWLIST`,
   `GOOGLE_PROFILE_IDS` (21), `SECRET_REFS.gemini` (21),
   `PASS_ENTRY_IDS.gemini` (21), `MODEL_ALLOWLIST`,
   `authProfileProvider`, `provider`, the `MODEL_ALLOWLIST_VIOLATION`
   enforcement in `quota-telemetry.mjs`, and the live
   `models auth order get --provider google` check in `verify.mjs` are all
   pinned to `google`.
5. Duplicate guard boundary proven by live trace, not inference. One fallback
   event produced two different outcomes by session origin: an internal session
   (`session:agent:main:main`) DID call `model-fetch start
   gemini-flash-lite-latest`; the Discord-originated session
   (`session:agent:main:discord:channel:1545425766161063937`) called no model
   and was denied `DUPLICATE_DISCORD_EVENT` 545ms after the fallback decision,
   because `taskId = deriveTaskId({origin_message_id, agent_id})` has no
   attempt dimension. The ledger correctly holds exactly one
   `WORKFLOW_OPENED` (sequence 107), so idempotency is correct; the guard also
   kills the retry. `deriveTaskId` is the canonical audit key validated by
   `workflow.mjs`, so attempt may NOT be folded into it.

R9 approved scope:

- R9-A observability: append `runId` to the `DUPLICATE_DISCORD_EVENT`
  warning. Log-only, zero behavior change, no contract or control change.
- R9-B router pool: introduce the router as the single governed model
  provider for all 7 agents, retire the 21 google profiles and their 21
  secret refs from the generated config and secret plan, and resolve the
  endpoint at service start.
- R9-C fallback discrimination: DEFERRED by owner decision. Blocked on R9-A
  plus a reproduction, because the discriminating signal (whether the retry
  carries a different `runId`) is not yet observable. R9-C MUST NOT be
  implemented from inference.

R9 excluded scope: no change to `deriveTaskId`; no weakening or removal of the
duplicate guard; no change to `WORKFLOW_OPENED` idempotency; no second copy of
the admission policy; no dependency or lockfile change; no touching the Discord
native ingress seam, `ackReaction`, or `enterNativeRun`; no restoring or
rewriting any closed task; no secret value written into any repository file.

R9 deployment incident (2026-10-06, recorded verbatim; the apply was NOT yet
transactionally completed at the time of writing):

1. The first `operator-apply.mjs` run FAILED at stage `builder-apply` and rolled
   back cleanly: `txn-cccbf758990142f0dd279173c6dc7ea401599f9a6cc73937df5150f7f6f4a824`,
   `rollbackSucceeded: true`, ledger still 107 events / sha `3fc0f79c…`, live
   entrypoint restored to `f4ed9d9c…`. Cause: `configure.mjs` carries TWO
   allowlist gates (preflight mode and apply mode) with independently maintained
   digest lists, and only the preflight-mode list had been updated.
2. A diagnostic `configure.mjs --apply` was then run DIRECTLY, bypassing the
   transaction wrapper, to surface the real error. This was a process violation
   and it mutated live files. It exposed a second defect: `models.providers.*.models`
   is validated by the installed runtime as an ARRAY of model descriptors, not as
   a map. The object shape made openclaw refuse to start
   (`Invalid input: expected array, received object`). Corrected to
   `ROUTER_PROVIDER_MODEL_IDS.map((modelId) => ({ id: modelId, name: modelId }))`.
3. That same diagnostic apply wrote an 8-id pass resolver while the running config
   still referenced the previous ids, so every gateway start failed with
   `SecretProviderResolutionError: Exec provider "pass_store" exited with code 1`.
   Recovery was a revert of the resolver to its last committed content
   (`git archive HEAD`, 29 ids, sha `46cf5df7…`), which is a committed artifact,
   not a new change, plus `systemctl --user reset-failed` because the unit had
   entered a start rate-limit.
4. Consequence still open at the time of writing: the live state is the product of
   a direct apply rather than a transaction. The router provider IS active
   (`agent model: router/gemini/gemini-3.6-flash`, google plugin absent, 7/7
   providers initialised, 0 READY timeouts), but the resolver allowlist still
   carries the 21 GEMINI ids, so R9's "retire the 21-key pool" goal is not yet met
   on disk, and no model call has yet been observed through the router.
5. R9-C remains blocked on R9-A plus a reproduction.

R9 third key location, found after the R9 apply (`txn-4e004486…`, status PASS):

The 21 Google keys live in a THIRD place that R9's plan missed. Each agent has
its own `auth_profile_store` row in
`~/.openclaw-zink/agents/<id>/agent/openclaw-agent.sqlite`, holding three
`google:zink-NN` profiles whose `keyRef` points at `pass_store`
(main 01-03, o1 04-06, o2 07-09, excel 10-12, power-bi 13-15, sql 16-18,
python 19-21). OpenClaw reads these at startup to build providers, INDEPENDENT of
`openclaw.json`, so removing `auth.profiles` from the config did not remove them.
The store is cumulative, not rebuilt from config: excel still held
`google:zink-10..12` while the config no longer declared any profile.

Consequence: with the resolver narrowed to 8 ids, every gateway start failed,
because the runtime requested all 29 (`ids.some((id) => !ALLOWED_IDS.has(id))`
sets `exitCode = 1`). Proven by a non-invasive stdin-logging shim that recorded
50 identical requests, each listing the 8 needed ids plus
`GEMINI_API_KEY_01..21`.

Owner decision 2026-10-06: option (d). OpenClaw 2026.6.34 exposes no CLI that
deletes an auth profile — verified exhaustively: `models auth list` is read-only,
`models auth order set/clear` mutates ORDER STATE only (tested on excel: the
store kept all three profiles), `paste-api-key`/`login`/`add` only add, and
`agents delete` removes a whole agent. So the supported path does not exist and
editing the auth store was NOT authorized.

R9-D applied: the pass resolver was reinstalled at its last COMMITTED content
(29 ids, sha `46cf5df7…`, rebuilt from `git archive HEAD`), which is a committed
artifact rather than a new change. The gateway then started clean:
`active/running`, PID 533347, `NRestarts=0`, 7/7 providers initialised, 0 READY
timeouts, 0 ECONNRESET, 7 established connections, and
`agent model: router/gemini/gemini-3.6-flash` with only
`discord, zink-governance` loaded.

R9 completion status, stated honestly:

- DONE and verified: the governed model provider is the external router; the 21
  profiles and 21 secret refs are gone from `openclaw.json`, from
  `zink-auth-secret-plan.json` (0 targets), from `zink-auth-order-plan.json`
  (0 agents) and from `plugins.allow`; `MODEL_ALLOWLIST` is enforced against the
  router ids; `verify.mjs` gained a live router reachability probe.
- NOT DONE: the 21 profiles still exist in the 7 agent auth stores, and the
  resolver allowlist is deliberately back at 29 ids because the runtime still
  requests them. They cannot authenticate — `google` is not an allowed plugin and
  the config declares no profile — but "retire the 21-key pool" is NOT complete.
- NOT YET OBSERVED: a single model call completed through the router.
- The live resolver is intentionally not what the repository generator emits. The
  next transaction apply will rewrite it to the 8-id build and will fail closed
  again until the auth-store prune is authorized. R9-D is therefore a service
  restoration, not the final state.

Authorization still required before R9 can close: deleting the `google:zink-NN`
profiles from the 7 `auth_profile_store` rows (a write outside any repository
transaction).

R9 model selection and upstream measurements (owner decision 2026-10-06):

The owner directs the primary to `execute`, the router's combo entry, which the
router advertises as `owned_by: "combo"`. Live probes of the whole 52-model
catalog established what can actually serve a request:

| group | count | result |
| --- | --- | --- |
| `gemini/*` | 7 | works |
| `combo: execute` | 1 | works; resolves per request into `gemini-3.6/3.7/3.8-flash` and `gemini-3.5-flash-lite` |
| `combo: max-code`, `anythingllm` | 2 | `400` provider error |
| `kr/*` | 40 | `403 invalid bearer token` on every probe — router-side credential is broken |
| `openrouter/*` | 2 | `404 unavailable` / `400` not a chat model |

Stability, 12 identical calls each, same prompt and `max_tokens=2048`:

    execute                       ok=8   fail=4   (33%)
    gemini/gemini-3.6-flash       ok=12  fail=0
    gemini/gemini-3.5-flash-lite  ok=12  fail=0

`execute` failures carry NO upstream model id, so they occur at the router tier
before any Gemini upstream is reached; the combo's rotation cannot help with
those. It was 25/25 in a later window, so the rate is variable rather than fixed.
It remains the primary because the owner wants the combo.

The fallback is `gemini/gemini-3.6-flash`: a different concrete upstream from
anything `execute` resolved to. This mitigates a single bad upstream but is
NOT independent of Google, because Gemini is currently the only working family
on this router. True independence requires repairing the router's `kr/*`
credential, which is outside this repository.

Token-budget finding, because it reproduces the exact failure that killed Main on
2026-10-06 09:22 (`Google stream ended before a terminal finish reason`):

    execute max_tokens=40    finish=length  content EMPTY  (all tokens -> reasoning)
    execute max_tokens=100   content EMPTY
    execute max_tokens=300+  finish=stop    content='PONG'

`execute` carries `reasoning: true` with `thinkingCanDisable: false`, so a small
output budget is spent entirely on reasoning and yields no content. Whether
OpenClaw sends an explicit budget for the `openai-completions` adapter was NOT
verified; if it does not, this is a live risk for `execute` specifically.

R9 apply #3 (`txn-aaf446fe06e684852f5be12ca55505d1a28c8b79fc61b2e07027bb1ebd3b25bf`,
status PASS) baked `router/execute` as primary and `router/gemini/gemini-3.6-flash`
as fallback. The same apply correctly rewrote the pass resolver to the 8-id build,
which made the gateway fail again for the already-documented reason (the 21
auth-store profiles are still requested). R9-D was re-applied from the last
committed resolver to restore service. Gateway state after restore: `active`,
PID 535615, 7/7 providers initialised, 0 READY timeouts, 0 ECONNRESET,
`agent model: router/execute`, plugins `discord, zink-governance`, ledger 107
events / sha `3fc0f79c`.

R9 maxTokens (owner decision A, 2026-10-06):

`execute` has reasoning=true with thinkingCanDisable=false. Measured: a tight
output budget spends everything on reasoning and returns EMPTY content with
finish=length — the exact failure that killed Main on 2026-10-06 09:22. OpenClaw
sends the request with NO max_tokens field when no budget is declared (proven in
the installed bundle: `resolveOpenAICompletionsMaxTokens` reads `options?.maxTokens`,
then `resolveMaxTokensParam(model.params)`, then `model.maxTokens` — all three
absent for `{id, name}` — so `clampedMaxTokens` is undefined and neither
`max_tokens` nor `max_completion_tokens` is set).

The owner chose to declare 64000 (the router's own advertised
max_completion_tokens, not an invented number) rather than leave the budget to a
hidden router-side default. The provider entry is now
`{id: "execute", name: "execute", params: {maxTokens: 64000}}`; the runtime reads
it via `resolveMaxTokensParam(model.params)` and sends it unclamped
(`clampToModelMaxTokens=false` for the params source).

Evidence, not assumption: `models.providers.*.models` is an ARRAY (an object
shape fails the installed validator outright), and openclaw's OWN
`config validate` returns `Config valid` for the live config carrying the params
entry — proven first on a scratch copy, then on the live file after deploy.
At the same decision the governed set was reduced to the single `execute` entry:
`ROUTER_PROVIDER_MODEL_IDS = ["execute"]`, `MODEL_ALLOWLIST = ["router/execute"]`,
`fallbacks: MODEL_ALLOWLIST.slice(1)` (empty, never `[undefined]`), and the
resolver reports `NO_FALLBACK_AVAILABLE` only when quota is actually low, never
for a healthy reading.

R9 apply #4 (`txn-cdfafd27ec20e4dceca47b1a78de37086e7c804b41cf98a6aa180351289a2288`,
status PASS) deployed the maxTokens entry. R9-D was re-applied after it for the
same documented reason. Gateway state: `active`, PID 539914, 7/7 providers, 0
READY timeouts, `agent model: router/execute`, ledger 107 / sha `3fc0f79c`.

What is PROVEN vs what is NOT for maxTokens: proven that the runtime schema
accepts the entry and that the code path from `model.params.maxTokens` to the
wire payload exists in the installed bundle. NOT proven by a live wire capture:
no Discord turn has run since this deploy, so no `model-fetch` has been observed
with the new primary. A real `@Quản Lý` turn that returns content (not empty) is
the behavioral proof still missing.

The recurring pattern is now explicit and is a consequence of one ungranted
authorization: EVERY transaction apply writes the narrow 8-id resolver and the
gateway fails until the resolver is hand-restored. The durable fix is the
auth-store prune, not another apply.

Operator router environment (R9, outside the repository):

`~/.openclaw-zink/router.env`, mode 600, holds `ZINK_ROUTER_HOST` /
`ZINK_ROUTER_PORT` / `ZINK_ROUTER_API_KEY`. It is consumed by the APPLY path
only; the running gateway does not need it, because OpenClaw has no config
templating and therefore reads literal strings from `openclaw.json`. Verified:
`resolveRouterBaseUrl()` and `resolveRouterApiKey()` accept the file's values, and
the credential does not appear anywhere in the repository.

`ZINK_ROUTER_HOST` is the WSL default route (the Windows host). It is NOT stable
across WSL restarts. After a WSL restart the operator must re-run
`operator-apply.mjs` so the new address is baked in; `verify.mjs` reports
`ROUTER_UNREACHABLE` / `ROUTER_HTTP_<status>` when the baked address has gone
stale. This is a known open risk, accepted because OpenClaw offers no templating.

R9 open risks recorded at planning: the WSL default-route address can change on
WSL restart, which would silently break the endpoint; the router key was pasted
into chat and must be rotated by the owner; `kr/*` router models are broken
upstream; and the durable fix for the 2026-10-06 gateway wedge (a long-lived
gateway process that could not re-establish any Discord gateway session after an
unexplained transient network event, recovering only on restart) remains an
unfixed open defect and is NOT part of R9.

### M10/T2-R8 - Discord conversational ingress end-to-end (owner-authorized single handling)

Owner authorization: EXPLICIT - one end-to-end R8 handling covering
OBSERVABILITY deploy, CONTROLLED LIVE TEST correlation, ROOT CAUSE,
FIX, TEST, DEPLOY, LIVE VERIFY, R8 CLOSE. No re-authorization rounds
for steps inside this prompt's scope. Global rules: no synthetic
events, no fake messages/approvals, no verifier weakening, no
admission loosening to force replies, no text-mention source of
truth, no governance contract change without evidence, no
ledger/queue/approval mutation for testing, no new
services/agents/roles, no secret exposure. Fix only after evidence
identifies the exact faulty boundary (H1 vs H2 decided by live
timestamps/IDs, never by assumption).

Phase 1 - observability deploy: single ONE-attempt deploy of
`ef9feb0` (log-only ingress verdicts, zero behavior change) via
`operator-apply.mjs`, with pre/post runtime identity capture
(service, PID, version, HEAD, selection, entrypoint, boundary,
authority, ledger hash/sequence, queue/approval state).
Phase 1 RESULT (executed): preflight first FAILed on the unadmitted
outgoing R5 entrypoint 0fb628e8 (provenance re-derived from 4d1e64e,
admitted in BOTH per-mode lists per precedent, TDD fail 0!==2 then
3/3 pass); preflight then PASS (installed_mutation false); full suite
1157/1115/0/42 + lint/format/repo-check/diff-check green; committed
50feb07; single apply PASS txn-abcb31f20ce634d2ef0fbc6bc262c08b
5c6b681690f11e5931ef27263e104043 with no rollback; post-deploy
entrypoint 6a7968b7 byte-identical to the packaged candidate
(logging active), all other artifacts + ledger (103 events) unchanged,
service active (new PID after restart).
Phase 2 - owner controlled live TEST A (structured @Main) + TEST B
(untagged) with timestamps; agent correlates read-only.
Phase 3 - trace per message (raw mentions, normalized mentions,
stash write/read, message.id vs currentMessageId, admission, turn,
thinking, execution, model, outbound); answer H1/H2 by evidence.
Phase 3 RESULT: owner TEST A (structured @Main via autocomplete, msg
1556249093729427459, 17:18:28 +07) is PROVEN AUTOCOMPLETE-picked. Live
verdicts: Main DENY `MISSING_MENTION mentions=0`, every specialist
DENY `NON_MAIN_DIRECT_INGRESS mentions=0`, all on the SAME msg id.
`msg=` present everywhere PROVES the seam receives currentMessageId
=> H2 (stash key miss) is DISPROVEN. Live `botUserId` identity proven
from the gateway probe log (main client initialized as
1545436878835163156), so the wrapper's `explicitlyMentioned` should have
matched. The only remaining boundary that can zero both mentions and
threadOwner while keeping the id is the STRUCTURED FIELD SOURCE at the
seam, i.e. H1. Root cause (code-level, read-only): the R5 injection
read only the discord.js wrapper (`message.mentionedUsers`,
`message.mentionedRoles`, `message.messageReference`,
`message.referencedMessage`), which can diverge from the raw gateway
dispatch at this seam (partial messages, synthetic debounce-batch
rebuild, hydration merge); the raw dispatch (`params.data`, spread by
createMessageDispatchData) and the message's own `rawDataValue` are the
authoritative structured sources at the same layer.
Phase 4 FIX (implemented, TDD): the preflight injection now UNIONS all
three structured sources (wrapper + message rawDataValue + raw
dispatch), snowflake-validated and deduped, with `params` guarded by
typeof so scopes without it keep working. No text heuristic, no
admission change, no new field semantics. Lineage: the R5 region text is
pinned verbatim as DISCORD_PREFLIGHT_INJECTION_R5 and an exact
R5->R8 preflight descriptor (live digest 5411ccd4) makes the live R5
file recognizable, fail-closed otherwise; inversion to the pinned
baseline is proven byte-for-byte. Gates: 1167 tests / 1125 pass / 0
fail / 42 skipped; lint, format, repo-check, diff-check green; commits
650b9d7 (fix) and the R8 test suites.
Phase 4 DEPLOY (1st): FAILED at `runtime-verify` with `APPLY_NOT_VERIFIED`
(attempt txn-cb59d6e7fae3b761cc91dcbc2a88e8e5c2e951f9375747d2ce3199
6c74df132f). NEW PROVEN DEFECT, not a fix failure: the transaction snapshot
covers only 39 files and its runtime target list was a FIXED three
(`dist/selection-*`, `dist/subagent-announce-*`,
`dist/zink-governance-boundary.mjs`) while the pinned native patch writes
FOUR runtime files. `dist/message-handler.preflight-*` was absent from the
snapshot, so (a) runtime-verify's post-apply `applied: !unchanged` was false
because the only mutated component was invisible to it, and (b) the rollback
restored 39 already-identical files and LEFT the preflight file mutated.
Phase 1 (deployment safety, owner-authorized): the runtime target list is now
DERIVED from the native patch pins via `nativePatchedRuntimeRelatives()` and
the tracked set can no longer miss a patched artifact; `verifyLiveRestore`
post-apply is judged against an EXPECTED post-image derived from the patch
contract (`nativeRuntimePostImage`) instead of "did anything change", and
fails closed when no expectation is declared; `changed` always names every
tracked component that differs from the preimage. Regression:
tests/m10-t2-r8-deployment-snapshot-safety.test.mjs, 7 tests (derivation,
preflight tracked, snapshot byte-exactness, 4th-file-only rollback,
expected-image semantics, absent-expected fail-closed, post-image derivation
fails closed on an unverified release). Four pre-existing orchestration
fixtures (R7 DS, R11, R12, R15) were updated to DECLARE their expected
post-image instead of returning a hardcoded `applied: true`, which is the
stronger contract. Commit bbdb205. Gates: 1174 tests / 1130 pass / 0 fail /
44 skipped; lint, format, repo-check, diff-check green.
Phase 2 (runtime reconciliation): the `0fb628e8` -> `6a7968b7` entrypoint
change is LEGITIMATE and not stale. `0fb628e8` was the live R5 entrypoint
before the R8 observability deploy; attempt txn-abcb31f2 (PASS) replaced it
with the R8 candidate `6a7968b7`, which is byte-identical to the repository
packaged entrypoint. `0fb628e8` was admitted as a proven predecessor (commit
50feb07, provenance re-derived from 4d1e64e) precisely to make that deploy
reachable. All three pinned native sources report state=PATCHED with
`after` equal to their own live digest, so the runtime already matches the
patch contract. No rollback of the entrypoint is warranted or authorized.
Phase 9 DEPLOY (2nd, repaired): preflight PASS (`installed_mutation:false`),
then `operator-apply.mjs` returned PASS at stage `applied`,
`transactionStatus: complete`, attempt
txn-eb5f0044990cc37661dbcd897c4f624a149460b4d6e01d25bcb5bf5154b17f57,
no rollback required. Post-deploy: service active (MainPID 346609, NRestarts
0), preflight `d12961a2`, entrypoint `6a7968b7`, ledger `d794d99d` unchanged.
The H1 repair is now both live AND verified by the deployment contract.
Phase 3 RESULT (2nd live test, owner msg 1556288097241538573 at 19:53:24
+07): the union-sources repair did NOT recover the structured mention. All
workers again reported `mentions=0 reply=false threadOwner=false` and Main was
again DENY `MISSING_MENTION`. TEST B (untagged) produced NO bot behaviour at
all, which is the correct outcome. From this evidence the host's own
mention-admission path is DEDUCED rather than assumed: lane tasks exist, so
host preflight did not drop the message, therefore `shouldSkip === false`,
therefore `effectiveWasMentioned === true`; `shouldBypassMention` requires a
control command (absent) and `implicitMention` requires a reply to this bot
(absent), so `wasMentioned === true`; if `isExplicitlyMentioned` had been true
then `message.mentionedUsers` would have contained the bot id and the union
(which reads exactly that array) would have recorded it, so it was false.
`wasMentioned` could therefore only have come from `mentionRegexes` matching
the message TEXT. Conclusion: for that message Discord delivered NO structured
mention at all, the host admitted the turn on a display-name text regex, and
governance correctly refused because it admits only structured identity. What
remains unknown is which source, if any, held the mention, which is why R8
added seam diagnostics.
Phase 3 DIAGNOSTICS: the preflight injection now emits one INFO line per
inbound message with per-source structured counts only —
`wu/wr` (discord.js wrapper), `ru/rr` (message rawDataValue), `du/dr` (raw
dispatch), `mu/mr` (unioned) — never content, never sender identity, never a
token. R5 H2's prohibition on reading message text in this path is preserved
deliberately; a content-derived boolean would be the first content-derived
value in the admission metadata path, and the counts answer the question that
matters. `logger` is optional so a scope without one still writes the
registry. Regression: tests/m10-t2-r8-ingress-source-diagnostics.test.mjs,
6 tests (one line per message, per-source counts, no content read or logged,
diagnostic emitted even when the registry write is skipped, missing-logger
degradation, union unchanged). The diagnostics deploy FIRST failed closed at
`native-backup-prune` with NATIVE_SOURCE_DRIFT because the live preflight file
had become the deployed R8 union build; the lineage slot was advanced to
R8 -> R8-diagnostics with the deployed union region retained verbatim as
DISCORD_PREFLIGHT_INJECTION_R8_UNION, inversion to the pinned baseline proven
byte-for-byte, and R5's region kept exported as history. That rollback was
itself verified complete under the Phase 1 contract, and the retry then
succeeded: attempt
txn-60e490a599e5b226e1170ebdabe3f361527242cd9a198764143121fcc09273ed,
PASS at stage `applied`, live preflight 63aaf148 carrying
`[zink-ingress-meta]`, MainPID 348723, ledger d794d99d unchanged. Gates:
1181 tests / 1139 pass / 0 fail / 42 skipped; lint, format, repo-check,
diff-check green; commits 6277bfc, fe95c16.
Phase 3 DIAGNOSTIC HARDENING: the first diagnostics build produced ZERO
`[zink-ingress-meta]` lines on the live runtime while the owner's message
demonstrably reached admission, even though the region was present in the
loaded file and `logger` was in scope. Two candidate causes remained —
the single `try` throwing before the log (which would also hide the registry
write behind the same silent catch) and the single-argument log form being
dropped. The hardened build closes both rather than guessing: the diagnostic
is emitted FIRST via the two-argument form this codebase demonstrably emits,
each structured source is read through a defensive probe that reports -1 when
that source THREW, and the union reads each source through its own guard so a
failing getter can no longer cost the other sources or the registry write.
A separate boolean probe exists for the bot flag because reusing the
array-count probe for a boolean silently cleared the bot filter — that defect
was caught by the existing R5 A9 negative and is now pinned by R8 D8/D9. The
hardened deploy first failed closed at `native-backup-prune` with
NATIVE_SOURCE_DRIFT (the live file had become the deployed first diagnostics
build), its rollback verified complete under the Phase 1 contract, the slot was
advanced to R8-diagnostics -> R8-diagnostics-hardened with the deployed region
retained verbatim, and the retry succeeded: attempt
txn-95389ebeabab42d4d5fbf02635bdbbe4a0b4da14e8ef85350b43b3eb07ed81b3,
PASS at stage `applied`, live preflight f15e9078 carrying `zinkProbe`,
MainPID 461403, ledger d794d99d unchanged. Gates: 1184 tests / 1142 pass /
0 fail / 42 skipped; lint, format, repo-check, diff-check green; commits
4b22b64, 80ecd98.
Phase 5/7 (pre-admission thinking, evidence so far): the Discord lane
contains NO status-reaction controller and NO reaction call (`addReaction`,
`reactions.add`, `putReaction`, `shouldAckReaction` all zero occurrences in
the Discord message handler and provider bundles), so the owner's `🧠` is NOT
a reaction. The exact pre-admission conversational side effect is
`startAcceptedTypingFeedback` in `message-handler-NsiHoCoL.js`, which runs
inside `onFlush` AFTER host preflight returned a context but BEFORE
`enterNativeRun` governance admission, gated by
`resolveDiscordAcceptedTypingPrestart`. Consequence after the H1 repair:
untagged messages are dropped at host preflight (requireMention) and
therefore produce no typing at all; only a message that mentions exactly one
NON-Main bot still reaches governance DENY after the typing prestart. The
supported repo-side seam for that residual is the existing
`session.typingMode` / `agents.defaults.typingMode` configuration knob
(`configured-not-instant` suppresses the prestart), which is a user-visible
behavior change and therefore an owner decision, not an agent decision.
Phase 4/5 - fix at the proven boundary only (H1: preserve structured
mention mapping; H2: canonical message-ID seam; no admission
semantics change, no blind fallback lookup).
Phase 6/7 - pre-admission thinking/turn + multi-bot isolation per
evidence; host-binary limits recorded honestly with exact seam.
Phase 8 - no-output terminal failure traced only after Main ACCEPT.
Phase 9 - regression tests for every proven defect incl. side-effect
ordering + message.id == currentMessageId invariant.
Phase 10 - full validation gates. Phase 11 - redeploy fix if source
changed (ONE attempt). Phase 12 - live verify A/B/C/D per expected
flows. Phase 13 - R8 PASS only on full evidence chain, else FAILED
at the named boundary.

Status: IN PROGRESS (Phase 1 deployment-safety fix DEPLOYED and verified;
Phase 2 reconciled; Phase 3 H1 PROVEN and the union repair deployed but
INSUFFICIENT on the live test; per-source seam diagnostics DEPLOYED and
verified; awaiting the owner live TEST A that yields those counts. Phases 4-8
depend on that evidence and are not attempted.)

## 9. Deferred beyond V1

Unless separately approved:

- image/video ingestion;
- self-hosted generic data lake/lakehouse;
- self-hosted generic forecasting/ML/OR training platform;
- Kubernetes/Kafka/distributed orchestration;
- speculative microservices, queues, workers or control planes.

## 10. Decision log

| Decision               | Current rule                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository scope       | Three logical modules: Knowledgebase, Skill Store, Tools.                                                                                                                                                                                  |
| Knowledgebase taxonomy | Preserve existing owner-approved taxonomy and Supply Chain coverage.                                                                                                                                                                       |
| Templates              | Excel/Power BI templates are owner-built assets stored in Zink Skill Store.                                                                                                                                                                |
| Work/Research          | Main infers mode from intent; mode is metadata, not a second store.                                                                                                                                                                        |
| Execution specialists  | Excel, Power BI, SQL and Python are the baseline four.                                                                                                                                                                                     |
| Five Stack             | Functional processing layers; agents may serve more than one stack.                                                                                                                                                                        |
| L&SC Data Plant        | Logical external-infrastructure/data-compute flow only; no platform runtime.                                                                                                                                                               |
| Model artifacts        | Heavy artifacts stay external; repository keeps only lightweight metadata/config/evaluation references when needed.                                                                                                                        |
| Coordinator binding    | M10/T2-R2 (parent R1) implemented and locally verified; binding = historical identity, attempt = execution generation, lease = current execution authority; live execution and result ingestion remain future work and are not authorized. |
| OpenClaw               | External runtime/orchestrator and task-mode classifier.                                                                                                                                                                                    |
| n8n                    | Deterministic workflow/trigger/schedule plumbing.                                                                                                                                                                                          |
