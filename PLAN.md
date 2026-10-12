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
| M10 - Governed coordinator runtime binding                                 | `COMPLETE` | `LOCAL-VERIFIED` | M10/T2 closed by explicit owner decision 2026-10-11 (R26 records the final remediation; R8 closed live with zero-outbound proven). Deferred follow-ups are NOT closed under M10 and require separate authorization: live gateway/knowledge restart or deployment, M10 ingress card/tag redesign (new Plan Revision), coordinator result ingestion, and the WSL/CI Python gate run. |
| M11 - Cross-module audit remediation                                       | `IN PROGRESS` | `REMOTE-BACKED` | M11/T1 is CLOSED (R1 four phases + R2 live admission and deployment, 2026-10-12; build DEPLOYED AND VERIFIED on the live WSL gateway, evidence in §4/§8). M11/T2-R1 is CLOSED with CI evidence the same day: four Skill Store suites are portable, `python-quality` is SUCCESS (`188 passed, 27 subtests`) and `secret-scan` is SUCCESS — but its acceptance criterion 5 is only PARTIAL because those fixes unmasked A-08 (`CI / quality-gate` dies at `uv: not found`, root cause `1a36c52`). M11/T2-R2 (owner Option B: make `python-quality` the sole owner of the Python stage) is PROPOSED and NOT approved; `Execution Authorization: NO`. NOT closed under M11: `verify.mjs` (`NOT RUN`, operator-side), the pre-existing model-router `GOVERNANCE_COMPLETION_UNAVAILABLE` failures, the pre-existing `duplicate plugin id` warning, the pre-existing 5-high `npm audit` failure, `M11-06` in CI (no Postgres service), and the owner-excluded items (per-document quarantine, incremental-publish redesign, manifest schema extension, zink-tools drift cluster, zink-tools lint-glob gap). |

The former self-built L&SC Data Plant is replaced by a **logical external
infrastructure flow**, not another repository module. Forecasting, optimization,
operations research and simulation remain first-class capabilities.

## 4. Current focus

```text
Milestone: M11 — Cross-module audit remediation
Task: M11/T2 — make the repository gates runnable on any host (portable test roots, CI Python job toolchain, gitleaks fingerprints, one owner for the Python stage)
Task Status: IN PROGRESS (M11/T1 CLOSED 2026-10-12; M11/T2-R1 CLOSED 2026-10-12 with
  the A-08 gap disclosed; M11/T2-R2 executing)
Planning Readiness: APPROVED
Plan Revision: M11/T2-R2
Execution Authorization: YES
Authorized Task: M11/T2-R2 — apply the owner's Option B for A-08: take
  `npm run test:knowledge` out of the `verify` composition, rewrite
  `REQUIRED_VERIFY_STAGES` and its comment to the four Node stages, add a new
  repository-policy rule that the Knowledgebase Python stage is executed exactly once
  in CI and only by `python-quality`, re-express (not delete) the policy tests that
  guarded the old contract, document the host instruction in README and
  `docs/development/conventions.md`, then prove `CI / quality-gate` SUCCESS and
  `python-quality` SUCCESS by `workflow_dispatch`.
  (Closed in this task: M11/T2-R1 — portable `REPO` roots in four Skill Store suites,
  the `python-quality` Node toolchain, and two `.gitleaksignore` fingerprints;
  record in §8, commit `2bc8ddf`, CI runs `38199387584` / `38199389639`.)
Execution Contract: docs/contracts/execution/ACTIVE.md
Evidence Level: REMOTE-BACKED (task branch pushed; CI run `38199387584` and Security
  run `38199389639` read from the remote, `python-quality` and `secret-scan` SUCCESS)
Task Branch: codex/m11-t1-audit-remediation
Owner Approval: EXPLICIT — owner approved the presented plan on 2026-10-11 with
  scope "3 clusters + OpenClaw security", single Active Task with four ordered
  phases, close-and-replace of the stale M10/T2-R8 ACTIVE.md, and H7 as
  mitigation-only (no incremental-publish redesign). On 2026-10-12 the owner
  additionally approved Option A, the bounded Phase 2 scope extension for the
  deployment-snapshot digest pins. M11/T2-R1 was approved the same day as Option A
  of the OWNER DECISION REQUIRED block issued from the Batch A CI/Security dispatch
  evidence (three scope items: portable test roots, `python-quality` Node toolchain,
  two gitleaks fingerprints; the 5-high `npm audit` finding was explicitly excluded).
  On 2026-10-12, in answer to the OWNER DECISION REQUIRED block for the A-08
  `quality-gate` defect that R1's fixes unmasked, the owner chose **Option B**
  (make `python-quality` the single owner of the Knowledgebase Python stage and drop
  that stage from `verify`). That is a decision on the approach and on opening
  M11/T2-R2; it is NOT yet approval of the R2 execution plan, which is presented in §8.
Deployment Authorized: NO for M11/T2 (R1 closed, R2 proposed) — neither the closed R1
  nor the proposed R2 mutates a live runtime or authorizes an operator command; the
  grant recorded immediately below belongs to the closed M11/T1-R1/R2 round.
Prior deployment record — Deployment Authorized: YES (M11/T1-R1 build — ONE attempt,
  owner grant 2026-10-12)
  — scoped exactly to: read-only `configure.mjs --preflight`, then one
  `configure.mjs --apply`, then `systemctl --user restart` of the single live unit
  `openclaw-gateway-zink.service`, all executed inside WSL Ubuntu against the live
  state directory `~/.openclaw-zink`. Nothing else: no `main` merge, no force-push,
  no PR/release, no other service, no `--revert`/historical recovery (that needs its
  own distinct authorization), no ledger mutation. The preceding `NO` gate is
  consumed by this grant, and the grant is consumed by the single apply recorded
  below; no further deploy is authorized without a new owner decision.
Deployment Status: DEPLOYED AND VERIFIED (2026-10-12, WSL Ubuntu, ONE `--apply`
  attempt; grant consumed). Executed operator-side because the CLI requires the
  live Discord identifiers and `ZINK_ROUTER_*` values, which this session's
  permission classifier refuses to load (no workaround attempted). Evidence:
  `--preflight` PASS with `installedMutation: false`; live digests after apply are
  `index.mjs = e8f084ab…` and `lib/file-lock.mjs = 22d7411a…`, both equal to the
  repository's packaged current build, written `2026-10-12T02:02:36Z`;
  `openclaw.json` untouched (mtime `2026-10-09`, so no config rewrite was needed);
  ledger untouched (mtime `2026-10-09`; 128 events == snapshot sequence 128,
  51 tasks); unit `active`, `MainPID=17047`, `NRestarts=0`, zero error-class lines
  from the new PID.
  Explicitly NOT part of this evidence: `verify.mjs` (non-live and `--live`) was
  not run — operator-side, `NOT RUN`; `configure.mjs --apply` creates no
  `transactions/` record (that wrapper belongs to `operator-apply.mjs`), so the
  newest transaction directory is still `2026-10-10`. Two pre-existing runtime
  conditions were observed and are NOT closed here: on the PREVIOUS PID 16583 at
  08:56–08:59 the model router aborted after ~100 s across the whole fallback
  chain, surfacing as `GOVERNANCE_COMPLETION_UNAVAILABLE` (predates this
  deployment, unrelated to it, needs its own diagnosis), and the long-standing
  `duplicate plugin id` config warning (272 journal occurrences) remains open.

Prior focus: M8/T2.2 CLOSED (R19 live-verified) and M10/T2 CLOSED by owner
  decision 2026-10-11; their durable records live in §8 and the history below.
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

### M10/T2-R13 - Per-attempt model ceiling (owner-authorized 2026-10-09)

Owner decision: set the router per-attempt ceiling to **100s**, after being shown
that a single model request had waited 9,374,777 ms (2h36m).

Owner authorization: explicit, in session, covering the code change, the
preflight+apply, and the gateway restart.

Root cause, proven by reading the installed runtime (not inferred):

- `buildGuardedModelFetch(model)` is invoked at every transport call site
  WITHOUT an explicit `timeoutMs`, so the only available deadline source is
  `model.requestTimeoutMs`;
- `applyConfiguredProviderOverrides` derives `model.requestTimeoutMs` from
  `providerConfig.timeoutSeconds` via `resolveProviderRequestTimeoutMs`;
- with no `timeoutSeconds`, `resolveModelRequestTimeoutMs` returns `undefined`
  and `buildModelRequestSignal` returns the caller's signal unchanged, i.e. no
  deadline at all. Every `model-fetch` log line recorded `timeoutMs=undefined`.

Live evidence (the defect): a `3.8-flash` turn started 09:28:31 was still
waiting at 12:04:46 (`elapsedMs=9374777`, `AbortError`) and only ended when the
host's stuck-session sweeper intervened; the owner received nothing for the
whole window. Failover then ran correctly (R9-C admitted the re-entry at
12:04:49), but the reply could not be delivered because Discord was wedged in
the same window.

Correction to an earlier wrong report: `requestTimeoutMs` was previously named
as the key to set. It is NOT in the model schema at all — it exists only in
`McpServerSchema`. That is why the earlier attempt made the gateway refuse to
start, and it was the wrong layer, not a bad key name.

Schema proof BEFORE touching live (the rule recorded in `policy.mjs`), using
`openclaw config validate` on scratch copies of the real config:

| mutation                                              | result                       |
| ----------------------------------------------------- | ---------------------------- |
| `timeoutSeconds: 100` on the provider entry            | `{"valid":true}`, exit 0      |
| `requestTimeoutMs` on the provider entry               | `{"valid":false}`, exit 1     |
| `requestTimeoutMs` on a model array entry              | `{"valid":false}`, exit 1     |
| an unknown key on the provider entry                   | `{"valid":false}`, exit 1     |

The unknown-key control is what makes the positive result meaningful: the
validator is genuinely strict, not permissive. Key name AND layer are both
load-bearing.

Change: `models.providers.router.timeoutSeconds = 100` in
`integrations/openclaw/lib/policy.mjs`, plus the assertion in
`tests/m7-t1-openclaw.test.mjs`. The stale comment claiming no timeout can
exist was corrected rather than left to mislead the next reader.

Deployment: `operator-preflight.mjs` PASS (`installed_mutation:false`), then
`operator-apply.mjs` PASS. Preflight initially FAILED and correctly caught a
second drifted asset — `lib/canonical.mjs`, carrying review finding
R12-REVIEW-01, which was committed in `7d92211` but never deployed. Both
predecessor digests were taken with `sha256sum` on the installed bytes (never
transcribed by hand) and added to the allowlist with their reasons. After
apply, all 33 deployed assets match the build byte-for-byte.

Gates on the final state: `npm test` 1244 tests / 1200 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean.

Known limitation, stated honestly: the ceiling is PROVEN in schema and code,
but not yet proven on a live `model-fetch` line. That requires one real owner
turn, which this agent must not fabricate.

Residual risk, owner-acknowledged: a legitimate attempt slower than 100s is cut
over to the next model. One observed `3.7-flash` attempt took 255s and would be
cut. Slowest governed model observed otherwise: `3.8-flash` at 70.6s. Raising
the number is a one-line change.

### Unrelated incident observed the same day (not part of R13)

Discord intermittently unreachable from this host: repeated websocket closes
(1006/1005) with `ECONNRESET` and `EAI_AGAIN`, and
`[fetch-timeout] fetch timeout after 2500ms url=https://discord.com/api/v10/users/@me`,
with no `READY` in the affected windows. Independent probes recovered
(`discord.com/api` HTTP 401 in ~0.7s, TCP 443 OK), so the cause is the host's
network path to Discord, not the R13 config change. This is the same wedge
recorded earlier on 2026-10-09 morning; it has no task and needs an
owner-scoped durable fix. Two counting mistakes were made and corrected during
this diagnosis: a `READY` grep that matched the control-plane `[ws]` channel
rather than the Discord gateway, and a rolling `-3 min` window that made
healthy client startups look like a decaying connection.

### Secret-handling incident (self-reported)

While searching for non-secret Discord identifiers, this agent dumped the
contents of `~/.openclaw-zink/identity/` and printed
`device-auth.json` → `tokens.operator.token` and `device.json` →
`privateKeyPem` into the session log. That is a violation of the repository
safety invariants (never expose secrets). No secret was written to the
repository — a diff-wide scan for credential patterns returned zero hits — but
both values are now present in a chat log and should be rotated by the owner.
Root cause: reading a whole directory and printing it without masking.

### M10/T2-R14 - Full-repo defect sweep (owner-authorized 2026-10-09)

Owner instruction: sweep the whole repository for remaining defects and fix
them.

Method: two independent read-only review passes over the governance plugin and
the authorization layer, then **every finding re-verified by this agent against
the real code before any edit**. Several candidate findings were discarded
because no concrete failing scenario could be constructed. Findings that were
real but unreachable (prototype-key drift on a dead validator, dead enum
divergences, mention-regex differences between a used and an unused path) were
recorded and deliberately left alone.

Eight defects fixed:

1. **Text approval could approve a task and never dispatch it (high).**
   `index.mjs`, text-approval path: `await sendNativePayload(...)` ran BEFORE
   `executeApprovedTask`, while the button path fired the same send without
   awaiting. `sendNativePayload` throws `NATIVE_OUTBOUND_UNAVAILABLE` when the
   host runtime config is unresolved (already documented in that file), the
   enclosing catch only warns, so dispatch never happened — and a retry could
   not recover, because the task was already `QUEUED` and therefore no longer
   matched the `ACTIVE || APPROVAL_PENDING` candidate filter. Net effect:
   durable approval, no execution, no error surfaced. This is the exact class of
   symptom reported as "the bot accepted my command and did nothing".
   Fixed by making the two paths identical: dispatch first, confirmation
   best-effort with a warn.

2. **Capability authorization honoured inherited keys (high, security-shaped).**
   `evaluateCapabilityAccess` used a truthiness lookup
   (`MATRIX[agentId]?.[capability]`). Plain-object rows inherit
   `Object.prototype`, so `constructor`, `toString`, `valueOf`,
   `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable` and
   `toLocaleString` all resolved to a truthy value and — matching none of
   `"L0"`/`"delegate"`/`"L2"` — fell through to `return { allowed: true }`.
   Proven by execution, not inference: `evaluateCapabilityAccess("main",
   "constructor", null, "execute")` returned `{allowed: true, reason:
   "AUTHORIZED"}` while a real unknown capability returned
   `UNKNOWN_CAPABILITY`. `authority.mjs` already asks the same question with
   `Object.hasOwn`, so this was one rule encoded twice with different logic.
   Fixed with an own-property test.

3. **An activated brief was committed before its spawn target was authorized
   (medium).** `guard.mjs` `admitInitialBrief` journaled
   `WORKFLOW_BRIEF_ACTIVATED` and only ~120 lines later did `beforeToolCall`
   check `AGENT_SPAWN_POLICY`. The reducer pins `brief_revision` to 1 whenever
   `task.nodes` is empty, so a brief naming an agent the caller may not spawn
   (Main naming `excel`, while `AGENT_SPAWN_POLICY.main` is `["o1","o2"]`)
   committed a task that could never be dispatched and had no revision path out:
   every retry re-matched the same node and was denied `UNAUTHORIZED_TARGET`
   again. Fixed by asserting the same canonical allowlist BEFORE the write, so
   the verdict lands ahead of the irreversible effect. This grants nothing new;
   it moves an existing check earlier.

4. **A failed queue completion was published as a success (medium).** Both the
   button and text accept paths reduced a `completeTask` failure to a `warn` and
   then posted "Tác vụ đã hoàn tất xuất sắc" to the public office channel
   unconditionally. Fixed: the failure is logged at error level and the public
   notice is gated on the write having actually landed.

5. **Owner gates compared two possibly-undefined values (low, security-shaped).**
   Two of the five owner checks wrote `sender !== ownerId` while the other three
   wrote `!ownerId || sender !== ownerId`. `undefined !== undefined` is false,
   and `resolveOwnerDiscordId` returns `undefined` for any id that is not 17-19
   digits while the config gate admits 20-digit ids, so that combination is
   reachable and would have let an event with no sender field past the owner
   check. Both sites now guard the unresolved owner explicitly.

6. **`safeReason` was truncated by characters while its siblings were truncated
   by bytes (low).** `ledger-event.schema.json` bounds `reason` with
   `maxLength: 4096`, which `schema.mjs` measures in UTF-8 bytes. ~1400
   multi-byte characters passed `.slice(0, 2000)` untouched and were then
   rejected by the contract, failing the write. The three sibling fields were
   already byte-budgeted; this one was not.

7. **The internal-run classifier was told the session was never ledger-owned
   (low).** `beforeRun` passed a hardcoded `ownedByLedger: false`, so the
   ownership test the adjacent comment relies on was never evaluated and the
   admission and end-of-run seams classified the same session differently by
   construction. Now answered for real — and the snapshot is read only when the
   cheap preconditions for the internal verdict already hold, so the ordinary
   governed path pays no extra read.

8. **The release-compatibility validator demanded a key that must not exist
   (low).** `validateOpenClawReleaseCompatibility` required a top-level `auth`,
   which R9 deliberately removed and `validateConfig` forbids adding, so it could
   never pass on a config this repository produces. Its only test hand-built a
   config containing `auth: {}`, hiding the contradiction. The impossible
   requirement was removed; the check still rejects a genuinely missing key.

Regression tests added: `tests/m10-t2-r14-review-defects.test.mjs`, three
tests, each written to fail on the pre-fix code. Two existing digest pins were
moved because packaged bytes legitimately changed; every new digest was computed
with `sha256sum`/`governancePluginFiles()` by script, never transcribed, and each
outgoing digest was admitted as a predecessor in BOTH per-mode allowlists so the
two modes cannot diverge.

Gates on the final state: `npm test` 1247 tests / 1203 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; secret scan of the diff 0 hits; `operator-preflight.mjs`
PASS with `installed_mutation: false`.

Two process notes recorded honestly: the new test file was initially absent from
the explicit `npm test` list, so the first "all green" run silently did not
execute it — caught by noticing the total was unchanged at 1244; and two edits
left a `try` without its `catch`, which the suite caught as a parse error
immediately.

### M10/T2-R15 - Second sweep: the critical-path and byte-budget defect families

Owner instruction: still bugs remain; fix them thoroughly.

This sweep worked by hunting **defect families already proven** rather than
guessing. Two families were known from R13/R14: "a cosmetic await gates a
governance effect" and "a character-count bound feeds a byte-measured
contract". Three further real defects came out of them.

1. **The result path rejected the agent's own output (high).**
   `agent-result-payload.schema.json` bounds `output` at `maxLength: 16384` and
   `agent_self_validation` at 4096, and `schema.mjs` measures `maxLength` with
   `Buffer.byteLength`. `guard.mjs` truncated both by CHARACTERS. Measured on
   the real validator, with a payload that passes at baseline:

   | input                              | bytes  | verdict                        |
   | ---------------------------------- | ------ | ------------------------------ |
   | output = 16384 ASCII               | 16384  | accepted                       |
   | output = 16384 Vietnamese          | 32768  | **rejected**                   |
   | output = 16384 CJK                 | 49152  | **rejected**                   |
   | output = 12000 Vietnamese          | 24000  | **rejected**                   |
   | agent_self_validation = 4096 Viet. | 8192   | **rejected**                   |

   So the guard's own truncation produced values its own contract refused, and
   because the same slice runs on every retry there was no recovery. `assumptions`
   and `limitations` were worse: never bounded at all, while the contract caps
   each item at 4096 bytes, so one long assumption failed the entire result.

   Root cause of the drift: `truncateUtf8` existed only as a private copy inside
   the plugin entrypoint, so the guard could not use it and kept counting
   characters. It now lives in `topology/lib/runtime.mjs` beside the validator
   that defines the byte rule, exported once, and imported by both.

2. **The button path could approve a task and never dispatch it (high) — R14 was
   incomplete.** R14 fixed the text path but missed the
   `await ctx.respond.followUp(...)` sitting directly above
   `executeApprovedTask` in the button path. An expired Discord interaction token
   — routine, since interactions have a ~15 minute lifetime — makes that reject,
   the enclosing catch only warns, and the approval stays durably recorded while
   the task never runs, with the same unrecoverable retry as finding 1 of R14.
   This is the PRIMARY path: the owner clicking Approve. The acknowledgement is
   now wrapped in its own try/catch; order is unchanged, so it still goes out
   first whenever it can.

3. **A failed error report could terminate the gateway (medium).** The
   interactive handler's `catch` awaited a fallback reply with no guard. That
   rejection escapes the handler with nothing left to catch it, and Node's
   default unhandled-rejection behaviour terminates the process — so one
   interaction whose primary failure AND whose error reply both fail would take
   the runtime down. Now nested in its own try/catch.

Because point 1 and 2 were the third and fourth instances of the same two
shapes, they are now pinned by **structural invariants** rather than only by
point assertions, in `tests/m10-t2-r15-critical-path-invariants.test.mjs`:
every awaited send must be inside a try with a catch; no dispatch may be
preceded by an unguarded interaction ack; the interactive catch must nest its
own guard; and the public completion notice must be gated on the queue write.

These invariants were **mutation-tested**, not merely written: deleting the ack
guard makes R15-07 fail, and removing the completion gate makes R15-09 fail. A
test that cannot fail is a hidden defect, so both were proven to bite.

Candidates investigated and DISCARDED, recorded so they are not re-raised:
`tasks[taskId]` lookups cannot be poisoned by a prototype key because
`task_id` is pattern-constrained to `^[a-f0-9]{64}$`; the ledger snapshot writer
already does validate → temp `wx` → write → fsync → chmod → rename → directory
fsync; `queue-manager.save()` matches that guarantee and fails closed on an
unreadable store; its `finally` preserves the original write failure.

Gates on the final state: `npm test` 1256 tests / 1212 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; secret scan of the diff 0 hits; `operator-preflight.mjs`
PASS with `installed_mutation: false`.

### M10/T2-R16 - Remove the duplication that caused the defects

Owner instruction: fix until no defects remain, then apply and restart; the
code had become too dirty.

The dirty-code observation was correct and measurable, so it was treated as a
finding rather than as a preference. Two measurements:

- of the 344 lines added so far, 233 (68%) were comment and only 110 were code;
- the owner post-decision logic existed as two near-identical copies
  ("Post-action execution trigger" appeared twice, ~240 lines apart).

That duplication was not merely untidy, it was the **cause** of two of the
defects already fixed: R14 had to patch the text copy's awaited send, and R15
then found the button copy's awaited ack. Both were the same divergence between
two copies that had to stay in sync by hand with nothing enforcing it.

Fix: one `applyOwnerDecisionEffect` helper now owns the dispatch and the
acceptance effect, and both entry points pass only their identity inputs
(`taskId`, `userPrincipalRef`, `userConfirmationRef`, `threadId`). The
dispatch decision logic is now identical by construction rather than by
discipline. Net effect on the entrypoint: **+199 / -149 = net +50 lines**, and
the duplicated public completion notice dropped from two copies to one.

Comments were also compressed. The evidence each fix rests on is kept, but
paragraphs that restated a neighbouring comment were cut, which is most of why
the earlier 68% comment ratio fell.

ESLint caught a genuine leftover during this pass — a useless
`queueCompletionRecorded = false` in the catch block, since the flag is already
false — and it was removed rather than suppressed.

Structural invariants added in `tests/m10-t2-r15-critical-path-invariants.test.mjs`
now include R15-10, which pins the de-duplication itself: exactly one definition
of the shared effect, exactly two call sites, and `executeApprovedTask` invoked
only from the helper. If the duplication returns, the suite fails.

Investigated and DISCARDED this pass, recorded so they are not re-raised:
Discord's `custom_id` ceiling of 100 is a CHARACTER limit, so
`customId.length > 100` in `discord-native-send.mjs` is correct and not an
instance of the byte/character defect class; the coordinator pickup timer and
the 10s outbound abort timer are both already covered by existing single-flight
and error-routing tests.

Gates on the final state: `npm test` 1257 tests / 1213 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; secret scan of the diff 0 hits; `operator-preflight.mjs`
PASS with `installed_mutation: false`.

### M10/T2-R17 - Durability parity, and removing a silent-default trap

Owner instruction: find more defects; the code is still too dirty.

**1. Two durability writers did not fsync their parent directory (medium).**
A scanner over every writer that publishes via `renameSync` showed the guarantee
was declared in one place and implemented in others:

| writer | dir fsync after rename |
| --- | --- |
| `topology/lib/ledger.mjs` | yes |
| `lib/queue-manager.mjs` | yes (M7-066, comment states the intent) |
| `lib/decision-ledger.mjs` | **no** |
| `lib/artifact-validator.mjs` | **no** |

fsyncing the FILE makes its bytes durable but does not make the rename durable;
on a crash the pre-rename file can be restored. For `decision-ledger` that means
losing the owner's most recent CONFIRMED decision (it sits on the
"classification -> OWNER CONFIRMS -> DecisionLedger persists" path), and for
`artifact-validator` a published artifact can disappear. Both now do the same
win32-tolerant directory fsync the other two already do.

`native-patch.mjs`, `runtime-backup.mjs` and the gemini hotfix template also lack
it and were deliberately LEFT ALONE: they are deploy-time patchers, backups and
templates, not governance durability stores, so the guarantee does not apply to
them. That distinction is recorded rather than silently applied.

**2. A silent-default trap in the owner-action label (low, latent).** The button
and text approval paths each carried their own `actionLabel` and had drifted: the
button copy enumerated five actions with a real `REJECT_RESULT` fallback, the
text copy had four and let its DEFAULT mean ACCEPT.

This was investigated and is explicitly **NOT a live defect**: the text path can
only ever produce APPROVE / REJECT_APPROVAL / REQUEST_REVISION_APPROVAL /
ACCEPT_RESULT, so its default branch is only ever reached for ACCEPT and the
label is correct. Reporting it as a bug would have been wrong.

It is still a trap, because any future text verb would be reported to the owner
as "nghiệm thu (ACCEPT)". Both paths now call one `describeOwnerAction`, and an
unrecognised action reports itself as unknown rather than as an acceptance.

**Dirtiness.** A duplicate-block scan confirms R16 worked: 12-line duplicate
blocks went from present to zero, and the remaining 8-line duplicate in the
approval handlers was this label block, now gone (8-line duplicates 4 -> 3).
The entrypoint still has two large functions — `authenticateIngress` at 234 lines
and `maybePublishDiscordCard` at 225 — recorded here as the next decomposition
candidates rather than split blindly, because neither has produced a defect and
splitting them mid-session would add risk without evidence.

New invariants R15-11 (durability parity across the four governance writers) and
R15-12 (single label definition, explicit unknown-action fallback). R15-11 was
mutation-tested: removing the directory fsync from `decision-ledger.mjs` makes it
fail, and restoring it makes it pass again.

Gates on the final state: `npm test` 1259 tests / 1215 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; secret scan of the diff 0 hits; `operator-preflight.mjs`
PASS with `installed_mutation: false`.

### M10/T2-R18 - file-lock: a committed write could be reported as failed

Owner instruction: keep hunting; still many defects.

`integrations/openclaw/lib/file-lock.mjs` is the cross-process concurrency
primitive behind the ledger, the queue manager and the decision ledger, so a
defect here corrupts durable state. It had not been reviewed.

**1. A failing release destroyed the guarded call's outcome (high).** Both seams
were written as `try { return fn() } finally { release(dir) }`. In JavaScript a
`finally` that throws **replaces** the pending return value, so when
`rmdirSync` failed — routine on Windows, where a just-created directory can
briefly refuse removal while a sync client or scanner holds a handle, and
`rmdirSync` gets no retry budget — an event that had already been appended and
fsynced was reported to the caller as a failure. The ledger, the queue and the
decision ledger would then treat a durable commit as rejected, and the natural
response to that is to repeat work that already landed.

Worse, when `fn` itself threw a business error (`"Stale ledger snapshot"`), the
release error replaced it, destroying the one diagnostic that says whether a
commit partially applied.

Fixed with explicit semantics: if `fn` threw, that error is re-thrown and the
release error is attached as `cause`; if `fn` succeeded, its result is returned.
A stranded lock is not silent — the next acquirer fails loudly with
FILE_LOCK_BUSY, which is the documented operator-recovery path — whereas
converting a committed write into a thrown error is strictly worse.

**2. `release` had no retry (medium).** `rmdirSync` takes no retry budget of its
own. Now bounded to 5 attempts and only for `EPERM`/`EACCES`/`EBUSY`, never for a
genuine permission fault.

**3. Non-contention failures were relabelled as contention (medium).**
`acquire` caught every non-`EEXIST` errno, broke the retry loop and threw
`FILE_LOCK_TIMEOUT` **with no `.code`**, while `withFileLockSync` correctly set
`busy.code = "FILE_LOCK_BUSY"`. Every caller classifies on
`err?.code === "FILE_LOCK_BUSY"`, so a permanent fault such as `ENOSPC` or
`EACCES` was indistinguishable from transient contention. Non-`EEXIST` errors now
propagate unchanged, and the timeout carries `code: "FILE_LOCK_TIMEOUT"`.

ESLint removed a redundant `try/catch` that only rethrew, and an unused test
import; both were fixed rather than suppressed.

**A process hazard was found and NOT changed.** `release` deletes whatever
directory sits at the lock path and has no owner token, so if an operator
removes a lock held by a *live* process, that process's `finally` deletes the
*next* holder's lock and two writers can enter the critical section, forking
`events.jsonl` and making every later read fail the digest chain. This is
reachable only through operator procedure, and preventing it means changing the
lock format (an owner token inside the lock directory), which is a design change
to a concurrency primitive. It is therefore surfaced for an OWNER DECISION
rather than taken unilaterally; the correct procedure — only remove a lock whose
holder is dead — remains the mitigation.

Tests: `tests/m10-t2-r18-file-lock.test.mjs`, 5 tests. The first version of these
tests **passed against the buggy code**, because a release failure was never
actually forced — a vacuous test. They were rewritten so `fn` leaves a file
inside the lock directory, making `rmdirSync` genuinely fail. R18-02 is now
mutation-tested: flipping one line so the release error replaces `fn`'s error
makes it fail, and restoring makes it pass.

Gates on the final state: `npm test` 1264 tests / 1220 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; secret scan of the diff 0 hits.

### M10/T2-R19 - A governed tool could write outside the agent sandbox

Owner instruction: keep hunting; still defects.

**1. Sandbox escape in the Excel tool (high, security).** `executeExcelOperation`
built its target with `path.resolve(effectiveBase, normalizedPath)` and never
checked the result was inside `effectiveBase`. `path.resolve` silently
normalises `..` away, and `file_path` is model-supplied (`string`, maxLength 512,
no pattern) while the base is the agent sandbox.

Proven by execution against the real module, with
`file_path: "../outside/proof.xlsx"`:

- the tool returned `status: "success"`;
- the sandbox directory was **never created** — nothing stayed inside it;
- the workbook, the SVG preview and the PNG preview were all written one level
  above the sandbox;
- the returned `file_path` was only `path.basename(targetPath)`, so the escape was
  invisible to the model, to the operator and to the log.

An absolute `file_path` was accepted outright with the same result. Both are now
refused with `ARTIFACT_PATH_ESCAPE`; the check uses `path.relative`, which also
catches a different Windows drive.

**2. Spreadsheet column references were a modulo, not a base conversion
(medium).** `String.fromCharCode(65 + (cIdx % 26))` wraps back to "A" at index
26, so a 27-column row emitted a SECOND `<c r="A1">` and every column from 27 on
was mislabelled in every row. That is invalid SpreadsheetML — Excel refuses the
workbook. Replaced with a real base-26 conversion (0=A..25=Z, 26=AA..51=AZ,
52=BA..701=ZZ, 702=AAA).

**3. The coordinator message exceeded its own byte ceiling (medium).** This is
the THIRD instance of the byte-vs-character class in this codebase. The ceiling
`COORDINATOR_MESSAGE_MAX_BYTES = 4096` was checked with `Buffer.byteLength` but
truncated with `body.slice(0, MAX - 64)`, which counts UTF-16 units. Measured on
the real function: a 6000-character Vietnamese brief produced an **11721-byte**
body — 286% of the declared ceiling — and emoji produced 7885 bytes **and a lone
surrogate**, because slicing at an arbitrary index can split a pair in half. Now
byte-budgeted, code-point by code-point; all three glyph classes land at
<=4095 bytes with no lone surrogate.

The shared `truncateUtf8` in `topology/lib/runtime.mjs` cannot be imported here:
only `lib/` and `contracts/` are deployed into the installed extension, so a
`../topology/...` import would fail at runtime. The rule is therefore duplicated
deliberately and R19-07 pins every deployed module against reintroducing a
character slice on a byte-budgeted bound.

**4. A post-start binding failure was unattributable (low).** `recordBound` runs
after the irreversible coordinator start and is the only durable link from
`run_id`/`session_key` to that run. It is unrecoverable by the loop: once the
queue item is EXECUTING, authority check 2 reports STALE_PROJECTION on every
later tick. A throw there aborted the tick with a generic message, leaving a
live run with no binding record and no clue which one. It is now caught and
logged at error level with the task, run, session and coordinator. It is NOT
retried on purpose: `recordBound` appends a ledger event, so a blind retry could
duplicate the record when the first attempt actually landed.

Investigated and DISCARDED: `quota-telemetry.mjs` (thresholds and freshness
window match their documented contracts), `runtime-backup.mjs` (reads validated
before mutation), `discord-formatter.mjs` (the two observations are
transport-level, not this module's contract).

Tests: `tests/m10-t2-r19-artifact-and-message-limits.test.mjs`, 7 tests, including
an end-to-end check that reads the real `sheet1.xml` back out of the built `.xlsx`
archive rather than re-implementing the emitter. The containment check was
mutation-tested: removing it fails R19-01 and R19-02, and restoring it passes.

Gate change worth recording: `excel-writer.mjs` and `coordinator-pickup.mjs` had
NO predecessor entries, because until now every revision of each was also the
current build and was accepted by content comparison — so any change to them was
undeployable until its outgoing digest was admitted. Both now have their first
entry.

Gates on the final state: `npm test` 1271 tests / 1227 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; `operator-preflight.mjs` PASS; all 33 deployed assets match
the build byte-for-byte; gateway healthy after restart (7/7 Discord clients, 0
websocket closes, 0 network errors, 0 ERROR lines).

### M10/T2-R20 - A rejected skill catalog degraded to a permissive walk; the tombstone key was unstorable

Owner instruction: keep hunting; still defects.

**1. Discovery failed OPEN when the skill catalog was invalid (high).**
`scanCatalog` returns `records: []` whenever `errors` is non-empty
(`catalog.mjs:732`). The skill adapter tested
`catalog.records.length > 0`, so ONE invalid skill made that false and the
adapter fell through to a **direct disk walk** that re-read the very same files
with no content-digest and no manifest validation, then answered
`governed_status: "SUCCESS"` and listed the tampered skill as discoverable.
Proven by execution: a skill whose `SKILL.md` no longer matched its manifest
digest still came back discoverable, readable AND applicable, carrying the
tampered content, while `validate` correctly raised `SKILL_SOURCE_DRIFT`.

The same scan has three consumers and only this one degraded:

| consumer | behaviour on `errors` |
| --- | --- |
| `catalog.mjs:738` `getActiveSkill` | fails closed |
| `vector-sync.mjs:358` | fails closed |
| `skill-adapter.mjs` discover | **failed open** |

Discovery now fails closed with `governed_status: "FAILED"` and
`error_code: "SKILL_CATALOG_INVALID"`, matching the other two. The comment in
that file already stated "There is no fallback" — the code contradicted it.

**2. The tombstone composite key was unstorable and incomparable (high).** Two
defects compounded in one statement:

- The key joined with `U+0000`. PostgreSQL `text` cannot store a NUL byte, so the
  statement aborted; the catch turned every sync into
  `VECTOR_TOMBSTONE_SYNC_FAILED` and **ingestion was never reached**. The skill
  identity rules forbid control characters in a skill path anyway
  (`path-safety.mjs` rejects `/[\0\x01-\x1F\x7F]/`).
- The two sides of `NOT IN` were structurally incomparable even ignoring the NUL:
  the left side was `namespace::text || capability || version`, where
  `namespace::text` renders a `text[]` as `{a,b}` — braces and no separators —
  concatenated with nothing between the parts. The predicate could never match,
  so had the NUL not aborted it first, the statement would have **DEPRECATED
  every ACTIVE row**, including live ones.

Both sides now build the identical string: JS
`namespace.join("/")||"|"| capability ||"|"|| version` against SQL
`array_to_string(namespace,'/') || '|' || capability || '|' || version`. `|` is
provably unambiguous because every component is a skill path segment restricted
to `/^[a-zA-Z0-9_.-]+$/u` and cannot contain it. Verified that the two sides
render `office/ops|s|1.0.0` identically.

Investigated and DISCARDED: `reconcileVectorSync` also builds an `activeKeys`
with `/` and `@` separators, but only `activeKeys.size` escapes that function, so
its key format is never compared to anything — not a defect. Also discarded
after checking the code: `path-safety.mjs` (traversal, absolute/UNC/drive forms,
Windows reserved names, control characters), `validateSqlQuery`/`escapeSqlLiteral`
/`toPostgresArrayLiteral` (mutation keywords, comments, semicolons, quoted
identifiers, positional params all rejected before interpolation), and
`generateSkillEmbeddings` (rejects non-1024-dim and non-finite elements).

Tests: `tests/m10-t2-r20-skill-catalog-and-sql.test.mjs`, 6 tests. Building them
surfaced three mistakes in my own test code that are worth recording: an anchor
matched an error-message string instead of the section comment; a `[^)]*` regex
body stopped inside `array_to_string(...)`; and counting `||` to verify the
separator is meaningless because `||` is also SQL's concatenation operator. Each
was fixed by narrowing to a literal, not by loosening the assertion.

Gates on the final state: `npm test` 1277 tests / 1233 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean.

### M10/T2-R21 - Skill Store, Zink Tools and Knowledgebase

Owner instruction: continue fixing, specifically in Zink memory (Skill Store),
Zink Tools and the Knowledgebase.

**1. The skill chunker had no length bound, so a valid skill could never be
indexed (medium).** `chunkSkillContent`'s own docstring claimed it split "by
headings **or length bounds**" — it had no length branch at all, only heading
matching. A catalog-valid single-section skill above the embedding ceiling
produced one oversized segment, and `renderEmbeddingEnvelope` throws above its
hard 32 KiB limit, so the skill was permanently un-indexable and every
subsequent sync failed identically. Proven by execution: a 42,013-byte
single-section skill produced 1 segment and raised
`EMBEDDING_INPUT_TOO_LARGE`.

Now split by a 16 KiB per-segment content budget, measured in BYTES, with a
flush-BEFORE-push rule and a byte-budgeted splitter for a single line longer
than the whole budget. 16 KiB is half the envelope ceiling because the envelope
adds variable header lines (domain, topic, subtopic, concept, secondary topics)
whose size is unknown at the chunker. Verified across ASCII, Vietnamese, CJK,
emoji, a 250 KB single line, 200 sections and a normal small skill: no segment
exceeds the ceiling, no content is lost, ordinals stay dense, and no lone
surrogate is produced. The first version of the fix still failed two of those
cases — it flushed AFTER each piece, letting two full pieces accumulate to
exactly 32767 bytes — which the verification script caught.

**2. The Knowledge result text ceiling was enforced in characters (medium).**
`MAX_RESULT_TEXT_BYTES` is named and documented as a 64KB ceiling (M15) but was
checked with `.length`, which counts UTF-16 units. Measured: a 65,536-character
Vietnamese result is 196,608 UTF-8 bytes, so 3x the declared ceiling was
forwarded untouched. This is the FOURTH defect of the byte-vs-character class
in this codebase. Now byte-budgeted, code-point by code-point.

**3. The Knowledge rerank pool was clamped to the page size (high).**
`candidate_limit = min(MAX_RERANK_CANDIDATES, request.limit)` is ALWAYS
`request.limit`, because `MAX_RERANK_CANDIDATES` is 20 and `limit` is capped at
`le=20`. The constant was dead. Consequences: the reranker only ever scored the
page it was about to return, making it a pure reorderer that can never improve
recall; and the `min_score` filter ran AFTER the pool had been cut to the page
size — filter-after-limit. A query with `min_score=0.8` whose top 10 all scored
below 0.8 returned an empty page while ranks 11-20, never scored, could have
satisfied it. Both branches now use `MAX_RERANK_CANDIDATES`.

**4. `/readyz` was more permissive than the default search (medium).**
`SearchRequest.rerank` defaults to `True` and a missing reranker makes every
default search 503, but `require_reranker` defaulted to `False`. An image whose
reranker failed provenance verification — leaving `app.state.reranker = None` —
still answered `/readyz` with 200, so the orchestrator marked the replica
healthy while 100% of default traffic failed. The probe now defaults to `True`,
matching the request it stands for; callers that genuinely run without
reranking can still pass `?require_reranker=false`.

**5. Sidecar reads were unbounded before allocation (low).**
`parse_pdf_sidecar` checked the 64 KiB cap AFTER `read_bytes()`, so the cap
bounded nothing about memory, and `discover_pdf_sidecars` had no check at all —
one large `.md` in the vault was read whole into the service process during an
index run. Both now `stat()` first, mirroring the PDF path which already checks
`before_pdf.size` before hashing. Discovery skips rather than raises, so one bad
file cannot abort discovery of every other sidecar.

Investigated and DISCARDED across the Knowledgebase after checking the code: SQL
injection (all values are asyncpg `$N` parameters; the interpolated `common`
fragment contains only placeholders), path injection (`canonical_vault_path` and
`runner._safe_source_path` reject absolute/drive/`..`/empty parts and re-verify
link-freeness plus `relative_to(root)`), the embedding handler (rejects empty,
mismatched-count and non-finite vectors; dimensions are checked on the search
path and constrained by a `CHECK` column), unbounded loops (every `while` has
provable progress), and unit confusion (`MAX_CHARS` uses characters, `*_BYTES`
use `st_size`, `*_TOKENS` use the tokenizer).

Test note, recorded because it has now happened three times in this work: a
source assertion tripped on the explanatory COMMENT quoting the old expression.
`R21-05` and `R21-06` now assert against Python source with `#` comment lines
removed.

Deployment: none of these files are gateway assets — the plugin loads
`vector-sync.mjs`, `knowledge-adapter.mjs` and `skill-adapter.mjs` by dynamic
import from the repository root, not from the deployed extension. So no operator
apply was needed; a gateway restart was, so the modules reload from the new
source. `apps/knowledge` is a separate FastAPI service and needs its own restart,
which is outside this repository's gateway flow and is left to the owner.

Gates on the final state: `npm test` 1284 tests / 1240 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; all 33 deployed gateway assets still match the build; after
restart 7/7 Discord clients, 0 websocket closes, 0 network errors, 0 ERROR lines
and no module import failures.

### M10/T2-R22 - Publish durability, and two corrections recorded against myself

**1. The skill publish path made the file bytes durable but not the directory
entries (medium).** `writeFileAtomic` fsynced each file's BYTES and the publish
path fsynced `parentDir` after the rename, which makes the RENAME durable. What
neither did is persist the two directory entries inside the staging directory. So
a crash after the rename could leave a canonical version directory that exists
and is named correctly, yet is missing `SKILL.md` or `manifest.json` - a
published skill the catalog rejects, and one whose incompleteness is silent
because the directory itself is present. `fsyncDirectoryBestEffort(stagingDir)`
is now called immediately before the rename. Both halves are required; neither
alone is sufficient.

**2. The backup subprocess was bounded in output but not in time (low).**
`createRuntimeBackup` runs `git show` with `maxBuffer` but no `timeout`, on the
synchronous `configure.mjs --apply` critical path. `maxBuffer` caps what git may
RETURN; it does nothing about git never returning, so a `git show` blocked on a
slow filesystem or a held index lock hangs the apply indefinitely with no error.
Now bounded at 30s, matching the idiom already used by `operator-preflight.mjs`
(30s), `operator-apply.mjs` (60s), `native-patch-probe.mjs` (10s) and the
`verify.mjs` `execFileBounded` helper.

**Correction 1, recorded because my first conclusion this round was wrong.** I
opened by adding a second directory-fsync helper to `catalog.mjs` on the claim
that the publish path lacked one. That claim was false. `git diff` showed
`fsyncDirectoryBestEffort` was pre-existing and already called on the parent
directory immediately after the rename; I had duplicated an existing mechanism,
which the repository contract forbids. The helper and its `node:os` import were
removed, and the change narrowed to the single call that was genuinely missing.

**Correction 2, a subagent finding rejected with the evidence that rejected it.**
A review reported the `PREDECESSOR` upgrade branch of `applyNativePatch` as a
high-severity non-atomic apply: no `try/catch`, no `ensureNativeBackup`, so a
mid-loop failure leaves a half-patched runtime with no restore target. The
structural facts are real - that branch genuinely lacks the `try/catch` +
`restoreNativePatch` the BASELINE/PATCHED branch has. The conclusion is not, on
three counts:

- `operator-apply.mjs` passes `nativeRoots` whose `runtimeRoot` is the same
  variable it hands to `createTransactionSnapshot`, and
  `nativePatchedRuntimeRelatives()` seeds its set with `NATIVE_BRIDGE_RELATIVE`
  before deriving the rest from the pins. The transaction snapshot therefore
  covers every byte that branch can write, including the bridge.
- The apply orchestrator takes and persists that snapshot before mutating, and on
  any failure restores it, licensing success only after `verifyLiveRestore`
  confirms the live bytes match.
- The proposed fix would have been actively harmful. For a `PREDECESSOR` entry,
  `entry.before` is the baseline reconstructed in memory, NOT the live file
  content. Writing it as a backup preimage would make `restoreNativePatch` revert
  a predecessor host to the unpatched upstream baseline, which is exactly what
  that branch's design comment exists to prevent.

`R22-04` and `R22-05` now pin the invariant that produced that rejection: the
tracked set must equal exactly the mutated set, the bridge included.

**Knowledgebase internals reviewed clean.** `database.py`, `retrieval.py`,
`markdown_adapter.py`, `reranker.py`, `model_probe.py`, `index_lifecycle.py`,
`index_runner.py`, `pdf_pipeline.py`, `ocr.py` and `config.py` were reviewed
against the seven failure classes and none survived. Every `except` either fails
closed or is documented as outside the correctness lifecycle; every index status
transition is enforced by DB CHECK constraints plus a raise on a lost-update
race; every search filter is applied inside the `WHERE` before `LIMIT 40`, with
`hnsw.iterative_scan = strict_order` preventing the ANN scan from truncating a
selective filter; `SET LOCAL` scopes settings to the transaction rather than the
pooled connection; the advisory lock makes check-and-act atomic on the owner
connection; every subprocess and read is bounded; and non-finite or
wrong-dimension embeddings are rejected at three independent layers.

**Tests.** `tests/m10-t2-r22-publish-durability-and-bounded-backup.test.mjs` (5):
durability ordering in both directions, a behavioural publish producing a
complete version directory with byte-identical content and no staging residue,
the subprocess time bound, and the two tracking invariants above. All five were
mutation-tested: removing the staging fsync, removing the git timeout, and
dropping the bridge from the tracked set each turn the suite red, and every
mutation was reverted with the original bytes restored, `native-patch.mjs`
confirmed untouched afterwards by `git diff --quiet`.

**Deployment.** `catalog.mjs` is loaded by the plugin through `loadRepoModule`,
i.e. dynamically from the repository root rather than from the deployed extension,
so no operator apply was needed and the 33 deployed assets still match the build.
A gateway restart was needed. `runtime-backup.mjs` is not a gateway asset at all:
it is operator tooling that runs in a fresh process per invocation.

Gates on the final state: `npm test` 1289 tests / 1245 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed; after restart
7/7 Discord clients, 0 websocket closes, 0 network errors, 0 ERROR lines and no
module import failures.
### M10/T2-R23 - Obsidian to embed ingestion seam

Owner instruction: continue fixing, focused on memory and the embedding system
from Obsidian. This round covers the vault ingestion seam - the path where a note
becomes an indexable, embedded segment - plus the rest of the Knowledgebase
internals and the remaining core modules.

**1. An HTML comment opener inside an inline-code span erased the rest of the
note (high).** `markdown_adapter._parse_blocks` stripped HTML comments BEFORE
stripping inline code. A comment opener sitting inside backticks was therefore
consumed as a real opener and opened a comment state that never closed, and that
state persisted to end of file.

Proven by execution on the production functions, not inferred. A note whose
third line was `` Start `<!--` marker. `` rendered to `'Start '` and then
destroyed every following line: body prose AND its `#supplychain` topic tag. The
identical note without the backtick pair survived intact, so the pair alone is
the cause. The downstream consequence is worse than one lost note: because the
canonical topic tag is required, `_validate_source` raises
`REQUIRED_TOPIC_TAG_MISSING`, and since `scan_vault` returns `ok=False` on any
error, ONE such note takes down the entire index run. The fence check is
correctly ordered ahead of both strippers, which shows the ordering was
deliberate for fences and simply missed here.

The same ordering defect existed in `pdf_foundation._visible_markdown`. There a
sidecar rendered to an empty body, `_visible_pdf_embeds` returned `[]`, and the
PDF was never indexed - and the failure presented as "no embed found", pointing
at the sidecar rather than at the content that caused it.

Both now strip inline code first. This cannot weaken real comment removal,
because a genuine comment's opener is outside any code span; the tests assert
both directions.

**2. A markdown source was read with no bound at all (medium).**
`MAX_CHARS` bounds a single SEGMENT, so it bounded nothing about the read.
`candidate.read_bytes()` had no ceiling, and the file was materialised three
times over (raw bytes, decoded str, splitlines) before any limit was evaluated.
A pathological note - a pasted dataset, a base64 export, or a OneDrive
placeholder that has not hydrated - could exhaust the service process. The
MemoryError escaped `_validate_source` (no except) and `scan_vault` (no except)
and landed in `index_lifecycle`'s blanket handler as
`INDEXING_UNEXPECTED_FAILURE` with NO source path, so one file aborted the whole
run and the operator could not tell which one. Now stat-ed before the read, with
a dedicated `SOURCE_TOO_LARGE` that names the offending path.

The ceiling is 16 MiB and is the one judgement call in this round. The vault is
not reachable from this machine, so it could not be measured against real
content; it is a single constant. It is deliberately far above any hand-written
note - the sidecar ceiling is 64 KiB - while still being a real memory bound.
The alternative, a tighter ceiling, risks failing the owner's real index run,
which is why this is flagged rather than chosen silently.

**Corrections recorded against myself.**

- My first fix for defect 1 was itself broken. I bound `without_code` before the
  comment strip and then pointed tag extraction at it, so the variable still
  carried comment text. The existing `test_tag_lexer_rejects_false_positives`
  caught it by going red with an unexpected
  `REQUIRED_TOPIC_TAG_MISSING`. Tag extraction now reads `visible`, the fully
  stripped line.
- My first version of the sidecar comment test asserted only that discovery
  succeeded. It stayed GREEN under a mutation that removed multi-line comment
  handling entirely, because comment leakage does not change whether the embed
  is found. The tests were rewritten to discriminate: each plants a decoy topic
  tag inside the comment and asserts it never reaches `tags` or
  `canonical_topics`. This is the second time in this work that a passing test
  turned out to prove nothing; it is now the standing rule that a regression
  test must be mutation-verified or it does not count.
- One mutation was also mis-designed by me: removing inline-code stripping was
  labelled as testing comment removal, which it does not. It was replaced with
  one that genuinely weakens comment removal.

**Tests.** `apps/knowledge/tests/test_r23_obsidian_ingestion.py` (13). All four
mutations bite: restoring the original order in markdown_adapter, dropping the
pre-read size bound, restoring the original order in pdf_foundation, and
removing multi-line comment state. Every mutation was reverted and the original
bytes restored. The size bound is exercised by lowering the constant rather
than writing 16 MiB, which proves the ORDER and the attribution rather than just
the comparison; a second test proves a file exactly at the ceiling is still read.

**Environment note, because it changes what could be verified.** The Knowledge
Python suite could not run in this environment at all: `tokenizers` was absent,
then `asyncpg`. Both are declared project dependencies and were installed to
make the suite runnable, and `KNOWLEDGE_TOKENIZER_PATH` now points at the
existing `temp/knowledge-test/tokenizer.json` fixture. Before this the suite
reported nothing; after it, the whole suite runs.

**Reviewed clean, with the mechanisms named.** `markdown_adapter` segmentation
and offsets, heading-path assignment, PDF table splitting, frontmatter handling,
`ocr` pipe draining and reaping, path escape in `pdf_foundation` (absolute
paths, drive letters, drive-relative `C:x`, UNC, `..`, symlinks, and the
extension check all precede the read), and the unreachable `RuntimeError` at
`markdown_adapter.py:787`, which needs a single token spanning more than 2000
characters that the pinned SentencePiece cannot produce.

**Gates.** Knowledge Python suite 144 passed / 4 skipped / 0 failed, 15
subtests. `npm test` 1289 tests / 1245 pass / 0 fail / 44 skipped. lint 0
issues; `format:check` clean; `repo:check` passed; `diff-check` clean; no secrets
in the diff.

**Deployment.** Every R23 change is a Python file under `apps/knowledge/`, which
is the separate FastAPI service, not a gateway asset and not loaded by the
plugin. No operator apply and no gateway restart were required. The service
still needs its own restart to pick these up, which is outside this repository's
gateway flow.
### M10/T2-R24 - The PDF runtime trust boundary

Owner instruction: keep fixing in knowledge; the 512 MB ceiling is the owner's
setting and must not be changed; only restart knowledge once the errors are
exhausted. No restart was performed this round.

**Owner's setting confirmed untouched.** `MAX_PDF_BYTES = 512 * 1024 * 1024`
in `pdf_pipeline.py`. `git diff --quiet` confirms this file was never modified by
this work, and it remains so. The full inventory of every ceiling in
`apps/knowledge` was recorded so the owner's value is explicit and auditable.

**1. The response validator could raise something that was not a
`PdfRuntimeError` (medium).** `_validate_response` performed its byte-exactness
round trip OUTSIDE the try/except above it. `json.loads` accepts the
non-standard `NaN` / `Infinity` / `-Infinity` literals and out-of-range exponents
such as `1e400` as ordinary Python floats without raising, and a lone surrogate
survives decoding. Those then reached `json.dumps(..., allow_nan=False)`, which
raises `ValueError`, or `.encode("utf-8")`, which raises `UnicodeEncodeError`.
`PdfRuntimeError` derives from `RuntimeError`, not `ValueError`, so neither was
converted.

Proven by execution: `{"x": NaN}`, `{"x": Infinity}`, `{"x": -Infinity}`,
`{"x": 1e400}` and a lone surrogate each escaped the validator as `ValueError` or
`UnicodeEncodeError`, while `issubclass(PdfRuntimeError, ValueError)` is `False`.

The consequence differed by call site, which is what makes this more than
cosmetic. `pdf_pipeline` catches only `PdfRuntimeError` in the preflight path,
so the `ValueError` escaped `build()` entirely and surfaced upstream as an
unattributed document-indexing failure. In the batch path a blanket `except
Exception` did catch it, but reported a generic `PDF_RUNTIME_FAILED`, hiding the
fact that the child had violated the protocol. A protocol violation was not
being reported as one. The round trip is now inside a try that converts to the
typed error, and the byte-exactness check itself is unchanged and still tested.

**2. The stderr cap destroyed a healthy invocation (medium).** The cap existed
to bound memory, but exceeding it raised `_OutputCapExceeded`, which terminated
the child and reported `PDF_RUNTIME_OUTPUT_LIMIT` - even though the response
cap had not been touched and the response was about to be valid. The stderr
bytes were discarded at the call site anyway, so the parent destroyed a
successful run on the strength of data it then threw away. Proven by execution
against the real client: a child returning a valid probe was killed when ~1.8 MiB
of per-page `UserWarning` text preceded it on stderr.

Stderr is now drained to EOF while retaining only the first `MAX_STDERR_BYTES`,
which keeps the memory bound AND keeps the pipe drained so a chatty child can
never block on a full stderr buffer. The overall deadline still bounds a child
that spews indefinitely, and the response cap is untouched and still fatal.

**3. Every child-side catastrophe was unattributable (low).** Both the exit
code and the stderr text were in hand and both discarded, and the module logs
nothing, so an OOM kill (`exit -9`) and a missing model artifact (`exit 1`)
produced byte-identical `PDF_RUNTIME_FAILED` with no diagnostic. `PdfRuntimeError`
now carries an optional bounded, single-line `detail`. The stable `code` that
every caller switches on is unchanged, so no call site changes behaviour.

**Correction recorded.** My first version of the retaining reader stopped
retaining as soon as a whole block pushed the total over the cap, which retained
**nothing** whenever a single block was larger than the cap - making the
retained excerpt useless on exactly the streams most likely to overflow. The
test caught it. It now retains exactly the first `cap` bytes, slicing the
straddling block.

**Tests.** `apps/knowledge/tests/test_r24_pdf_runtime_boundary.py` (14).
All five mutations bite and were reverted with the original bytes restored:
restoring the pre-fix validation order, restoring the aborting stderr cap,
stopping the retention, never aborting on overflow, and dropping the child
detail again. The stderr test drives a real child process that floods stderr
and then returns a valid probe; the oversized-response test drives a real child
that emits 80 MiB and must still be rejected.

**Escalated, NOT fixed - owner decision required (RED).** A review reported
that an INCREMENTAL run mutates the live ACTIVE index through many independent
per-source transactions, so a mid-run failure leaves the ACTIVE index holding
new rows for the sources that succeeded, stale rows for the one that failed, and
no deletion of removed sources, because the stale-path deletion is only reached
on the all-succeeded branch. The structural facts check out.

It is deliberately not fixed here. Deleting stale sources on a failed run would
be WRONG, because a failed run's manifest is untrustworthy, so the current
skip is the safer half. The genuine fix is to make incremental indexing atomic -
stage into a shadow index and swap the ACTIVE pointer only on success - which
changes index lifecycle semantics and the read path. That is an architectural
change and needs its own task and its own approval. Raising it rather than
silently re-planning it.

**Gates.** Knowledge Python suite 158 passed / 4 skipped / 0 failed, 20
subtests. `npm test` 1289 tests / 1245 pass / 0 fail / 44 skipped. lint 0
issues; `format:check` clean; `repo:check` passed; `diff-check` clean; no secrets
in the diff.

**Deployment.** All R24 changes are Python files under `apps/knowledge/`, the
separate FastAPI service. Not a gateway asset, not loaded by the plugin, so no
operator apply and no gateway restart. The service restart the owner asked to
defer is still deferred; this round makes no live change at all.
### M10/T2-R25 - The skill read/apply boundary

Owner instruction: scan knowledge and memory. Owner's 512 MB PDF ceiling
re-confirmed untouched (`MAX_PDF_BYTES`, `git diff --quiet` clean). The knowledge
service restart stays deferred at the owner's instruction.

Knowledge side of this sweep came back clean: `index_runner.py` end to end and
the `pdf_pipeline.py` build/batch region were both reviewed and neither yielded
a defect, with the deadline computation (once per PDF, never per batch), the
segment assembly, the fixed page-range batching and the per-call transaction
scoping all named as the reasons.

This round is the memory side. Three governance defects in the skill read and
apply boundary, all proven by execution against the real `SkillAdapter` driving a
real catalog before the fix.

**1. A qualified skill id was resolved by its last path segment (high).** The
matcher was a single disjunction mixing a whole-id comparison with a bare-slug
comparison, so `ns/capability` was satisfied by either, and
`fullId.endsWith(targetSkillId)` additionally matched any id by suffix. With a
catalog holding both `automation/data-clean` and `research/data-clean`, a read of
`research/data-clean` returned AUTOMATION's SKILL.md - the reproduction returned
the literal body `rm -rf everything` - while the response still echoed
`skill_id: "research/data-clean"` and `governed_status: "SUCCESS"`. Which skill
won depended on filesystem enumeration order.

A qualified id is now matched whole; only the deliberate bare-capability
shorthand may fall back to the slug. Directory enumeration is also sorted, so a
tree with any residual duplicate resolves deterministically rather than by
filesystem order.

**2. The two actions that feed an agent skipped the only integrity anchor
(high).** The content digest check was gated on `action === "validate"`, so
`read` and `apply` returned the bytes unchecked, and `apply` then stamped them
`verified-provenance`. Proven by execution with an unambiguous id and an in-place
edit of SKILL.md: `validate` threw `SKILL_SOURCE_DRIFT` while `read` and `apply`
both returned `SUCCESS` serving the drifted content.

Two compounding facts made this worse than a single missing check. Because
`manifest.verification` is not part of the canonical schema (the catalog enforces
exactKeys on `content` and `provenance`), the old
`manifest.verification?.signature || "verified-provenance"` fallback emitted that
constant for EVERY skill, verified or not - it asserted nothing at all. And the
defect in finding 1 compounded it: the collision meant the drifted file was not
even the file being read, so the drift check could not have caught it.

Both actions now go through one `loadVerifiedRecord` helper that resolves, reads
and verifies in a single pass - which also removed the duplicated read logic and
the redundant catalog walk the apply path was doing. The digest comparison runs
for every action. The signature is now `sha256:<digest of the bytes actually
served>`, which is what was just proved equal to the approved content. A record
with no `content.sha256` now fails closed with
`SKILL_PROVENANCE_UNVERIFIED` rather than being served unverified.

**3. The search row budget was in the wrong unit (medium).** The SQL `LIMIT` is a
limit on segment rows, but the caller asks for skills and the loop deduplicates
to skills. With `limit * 4`, three long skills at 16 segments each consumed the
entire 40-row budget for a request of 10, and seven further qualifying skills
never appeared at all - silently, with `governed_status: "SUCCESS"` and nothing
signalling truncation.

The multiplier is now derived rather than guessed:
`MAX_SEGMENTS_PER_SKILL_VERSION = ceil(262_144 / (16 * 1024))`. The catalog
refuses a SKILL.md above 262,144 bytes on both write and scan, and the chunker
emits at most one segment per 16,384 bytes, so 16 is a hard maximum and a budget
of `limit * 16` provably still yields `limit` distinct skills. The test
recomputes both ceilings from source and asserts they still agree, so changing
either ceiling without this one fails the suite.

**4. The catalog size ceilings bounded nothing (low).** `readRegularFile` did
`lstat` then `readFile` with no size bound, and the ceilings were only checked
against `bytes.length` afterwards - so the whole file was buffered first. Since
`scanCatalog` runs on every discover, `getActiveSkill` and
`syncSkillsToVectorStore`, peak resident size scaled with whatever was on disk,
and above Node's buffer limit the read threw and the catch relabelled it
`MISSING_REQUIRED_FILE`, pointing the operator at a missing file rather than an
oversized one. Both ceilings are now passed into the reader and enforced by
stat before the read; the post-read length check is kept as a second line of
defence, because the file can grow between the stat and the read.

**Tests.** `tests/m10-t2-r25-skill-read-apply-integrity.test.mjs` (13). All five
mutations bite and were reverted with the original bytes restored: restoring the
bare-slug matcher, disabling the digest comparison, restoring the constant
signature literal, restoring the segment-unit budget, and dropping the pre-read
size bound.

**Corrections recorded against myself.** My first mutation for the drift finding
added a dead variable and disabled nothing, so the suite stayed green - the green
was correct and the mutation was meaningless. Separately, my first version of
`R25-04` asserted that `cap === targetSlug` must never appear, which would have
forbidden the legitimate bare-capability shorthand; it was rewritten to check the
structure instead. And the apply path initially kept its own `findSkillRecordOnDisk`
call alongside the new loader, walking the whole catalog twice; that is now a
single pass.

**Gates.** `npm test` 1302 tests / 1258 pass / 0 fail / 44 skipped. Knowledge
Python suite 158 passed / 4 skipped / 0 failed, 20 subtests. lint 0 issues;
`format:check` clean; `repo:check` passed; `diff-check` clean.

**Deployment - restart deliberately NOT performed.** `skill-adapter.mjs` and
`catalog.mjs` are loaded by the plugin through `loadRepoModule`, dynamically from
the repository root rather than from the deployed extension, so no operator apply
is needed - but a gateway restart is required for the plugin to pick up R25. The
owner deferred restarts until the sweep is exhausted, so none was performed and
no live system changed this round.

### M10/T2-R26 — owner-authorized remediation of the open escalations (2026-10-11)

The owner authorized committing the R13-R25 sweep and fixing the escalated open
items without creating new tasks ("fix what is fixable"). This round records
that execution. Read-only gates were re-run against the working tree before
each commit.

1. **Sweep committed.** The complete uncommitted R13-R25 defect sweep (39 fixed
   defects, 26 modified + 11 new test files) was committed as `ea84a5a` after
   `npm test` 1302 / 0 fail / 44 pre-existing skips, lint 0 issues,
   `format:check` clean, and `repo:check` passed. A diff-wide secret-pattern
   scan returned zero hits. The working tree had been dirty since R25; the
   handoff note claiming a clean tree was stale and is corrected.
2. **R24 RED escalation CLOSED — incremental indexing is now atomic**
   (`fd70bf6`). Acceptance (`accept_incremental`) stages a shadow BUILDING index
   cloned from ACTIVE (sources, segments and PDF details copied verbatim, no
   re-embedding; rows re-stamped to the shadow run because the
   `indexed_by_run_id` foreign key is index-scoped). Success
   (`complete_incremental`) prunes stale sources, swaps the ACTIVE pointer,
   supersedes the prior index and completes the run in one transaction.
   Failure marks only the shadow FAILED (`fail_index=True` for both run kinds);
   the live ACTIVE index is never mutated mid-run, closing the partial-index
   data-integrity defect. Orphaned shadows are reclaimed by the existing
   `recover_interrupted_runs` BUILDING sweep. Tests:
   `apps/knowledge/tests/test_r24_atomic_incremental_index.py` (4, fake-
   connection SQL-contract level) plus two lifecycle tests; the Python gate
   remains `NOT RUN` on the Windows host (env-gated collection) and must be run
   in WSL/CI before closeout.
3. **R18 owner decision taken — file-lock release is owner-token bound**
   (`d773856`). Acquisitions write `owner.json` (random per-acquisition token +
   pid) inside the lock directory; `release` refuses any lock whose on-disk
   token is absent or foreign, so a stale holder can no longer delete the next
   holder's lock after an operator removes a live lock — the exact sequence
   that forked `events.jsonl` past digest-chain recovery. Operator recovery of
   an orphaned lock is now explicit directory removal, not `release`
   (test updated: `m8-t2-file-lock` crashed-holder case). New tests R18-06 to
   R18-08 reproduce the hazard against a second module instance as holder B.
   The deployed pre-R18 build digest was already allowlisted as a predecessor;
   no `configure.mjs` change was needed.
4. **Discord network wedge adjudicated host-scoped, not repo-fixable.** The
   wedged fetch (`[fetch-timeout] ... users/@me`, 2500 ms) originates in the
   host OpenClaw runtime; no repository module performs that call. Per the
   owner's instruction the durable fix stays owner-scoped (host network path /
   DNS); no repo change was made.
5. **Live state unchanged.** The gateway and knowledge service still run the
   pre-R19 builds; deployment/restart remains owner-authorized separately.
   `docs/contracts/execution/ACTIVE.md` remains INVALID for new work (declares
   R8 while PLAN is at R26); it must be replaced or deleted at the next
   materialized plan revision.
6. **R26 post-commit regression found and fixed by the full gate.** The first
   full-suite run after `d773856` failed 247 tests: `withFileLockSync` acquired
   with an inline `mkdirSync` instead of `tryAcquire`, so sync-seam locks carried
   no owner token and every `release` was refused and silently stranded the lock
   directory. The seam now routes through `tryAcquire`; release retries unlink +
   rmdir as one unit with a bounded 15 ms geometric backoff, and `ENOTEMPTY`
   joins the retryable set (Windows keeps a just-unlinked file's directory in
   pending-delete). Final gates on the R26 tree: `npm test` 1305 tests / 1261
   pass / 0 fail / 44 pre-existing skips; lint 0 issues; `format:check` clean;
   `repo:check` passed; collectible Python suites 126 passed / 2 skipped
   (`test:knowledge` env-gated files remain NOT RUN on the Windows host and must
   run in WSL/CI at closeout).

### M10/T2 — Closeout (owner decision 2026-10-11)

Task Status: `CLOSED`. Planning Readiness: `APPROVED`. Execution Authorization:
`NO`. Execution Contract: `NONE` (the stale R8 `ACTIVE.md` was replaced by the
M11/T1-R1 contract on 2026-10-11, as directed by R26 item 5). Evidence:
`LOCAL-VERIFIED` for the committed remediation; the R8 live closure evidence
(transaction ids, digests, counters, transcript) is recorded in the R8/R26
entries above.

Owner-closed with these items explicitly NOT closed under M10 (each requires
separate future authorization): live gateway/knowledge service restart or
deployment (pre-R19 builds still running; V13 deployed-asset-drift gate); M10
ingress card/tag redesign (new Plan Revision); coordinator result ingestion;
the WSL/CI run of the env-gated Python `test:knowledge` files.

### M11/T1-R1 — Cross-module audit remediation (owner-approved 2026-10-11)

Task: `M11/T1 — Skill-store vector SQL correctness, skill-store governance,
knowledgebase index hygiene/attribution, OpenClaw outbound containment and
cache/ledger safety`
Plan Revision: `M11/T1-R1` · Planning Readiness: `APPROVED` · Execution
Authorization: `NO` (consumed at closeout) · Execution Contract: `NONE` ·
Evidence: `LOCAL-VERIFIED` ·
Task Branch: `codex/m11-t1-audit-remediation`

Origin: owner-requested read-only full-repo audit on 2026-10-11 (five parallel
domain audits, spot-verified against source). The frozen implementation
details, ordered steps, acceptance criteria and gates lived only in the
matching `ACTIVE.md`, deleted at this closeout. Out-of-scope escalations
recorded for future owner decisions:
per-document ingestion quarantine, incremental-publish redesign (no full-corpus
clone), manifest schema extension (`metadata`/`verification` fields), the
zink-tools contract-drift cluster, and the zink-tools lint/format glob gap.

Commits: `45e0ee7` Phase 1 (derived-index SQL), `3810f67` Phase 2 (governance),
`01e5d07` Phase 3 (Knowledgebase hygiene and attribution), `6cba090` Phase 4
(OpenClaw outbound containment, bounded caches, per-target containment),
`94e9444` the current-build entrypoint re-pin Phase 4 required.

**Gates, all run against the final state on 2026-10-12.** `npm test`: 1336 tests,
1291 pass, 0 fail, 45 skipped — the 44 pre-existing skips plus the new Windows
symlink-privilege skip, exactly the approved Definition of Done.
`tests/m11-t1-postgres-sql-gate.test.mjs` M11-06 executed the generated
statements against a real PostgreSQL container and PASSED (not skipped).
`npm run lint` (eslint + markdownlint) 0 issues; `npm run format:check` clean;
`npm run repo:check` "Repository policy check passed"; `git diff --check` clean.
Knowledgebase Python suite (`npm run test:knowledge`) 184 passed / 4 skipped / 27
subtests, with `KNOWLEDGE_TOKENIZER_PATH` pointed at the existing
`temp/knowledge-test/tokenizer.json` fixture; all four skips are platform cases
(three symlink-creation privilege skips, one Linux-only process-group test).

**Reported as NOT RUN, not as a pass.** The authoritative secret scan is gitleaks
in `.github/workflows/security.yml` over full history; gitleaks is not installed
on this host, so that gate is `NOT RUN` here. Its local equivalent — a
secret-pattern scan of the complete task diff — returned zero candidates. The
WSL/CI run of the env-gated Python files is carried forward, as it was for M10.

**Deviations and disclosures (bounded; no approved behavior weakened).**

- Phase 1 (P1-06): schema 003's `CHECK` constraints made `DEPRECATED` and
  `TOMBSTONED` vector rows unwritable, so the tombstone became a `DELETE` after
  verifying that every consumer already filters
  `status='ACTIVE' AND sync_status='READY'`.
- Phase 2 (owner Option A, 2026-10-12): the authorized approval-path edits moved
  the packaged entrypoint digest, so the deployment-snapshot pins were re-pinned
  and the outgoing `230f3c79…` digest was admitted into both per-mode predecessor
  lists of `configure.mjs`, with provenance re-derived from `45e0ee7` through the
  repository's own generator. Phase 4 moved the entrypoint again, so the
  current-build constant was re-pinned once more (`94e9444`); no additional
  predecessor was admitted, because under `Deployment Authorized: NO` Phase 2's
  build was never installed anywhere.
- Phase 2: §2.3's `withFileLockSync` seam became the existing async
  `withFileLock`, because a sync seam would release the lock while the async
  promote is still in flight and the writer lock is not reentrant; the
  writer-lock directory is `<parent>/<basename>.writer.lock` so sibling catalogs
  cannot contend on one lock; `decisionRef` is threaded from operator
  configuration rather than hard-coded.
- Phase 3: §3.3 needed no new `DATABASE_ERRORS` member (`asyncio.TimeoutError is
  TimeoutError` on the pinned interpreter), so it was implemented as the
  diagnostic it is — an explicit pin plus a route test proving the 503 mapping;
  §3.7's 2-second bound applies to the lock acquisition only, not the whole
  readiness probe, because each probe cold-starts a subprocess and a call-level
  bound would report `PDF_RUNTIME_BUSY` for a healthy-but-busy runtime; `/readyz`
  reuses the run-side `pdf_processing_identity` helper instead of duplicating the
  identity recipe; `test_m11_api_attribution.py` carries the tokenizer gate, so a
  host without a tokenizer artifact has four env-gated files rather than three;
  the `test_index_lifecycle.py` drift scenarios changed shape, not strength.
- Phase 4: §4.1's "the governed artifact root used by the internal tool path"
  resolves to `resolveAgentSandboxDir`'s per-agent sandbox, because
  `validateLiveArtifactPath` validates a logical path and takes no filesystem
  argument; containment reuses that root and the repository's existing
  `path.relative` idiom, with no new dependency and no parallel path policy.
  Windows refused symlink creation for this account, so the symlink-escape case
  self-skips and that specific escape is proven by test only on platforms that
  permit link creation.

### M11/T1-R2 — live asset-predecessor admission and deployment (owner-approved 2026-10-12)

Authorization: `YES` during the round, `NO (consumed at closeout)` now. Commits:
`14c4b90` (admission + gate). Owner decisions this round: (1) `Deployment
Authorized: YES (one real apply attempt; the earlier fail-closed preflight does not
consume the grant)`, and (2) Option A — open a bounded R2 to admit the one proven
live asset predecessor instead of leaving the runtime undeployable or hand-editing
live state (Option C was refused on principle: it disables the integrity control).

- Trigger: the granted `--preflight` failed closed with
  `Governance plugin asset drift detected: …/lib/file-lock.mjs`. A read-only 33-file
  scan of the live tree proved a single gap — 31 assets byte-equal to the current
  build, `index.mjs` (`230f3c79…`) already admitted in both per-mode entrypoint
  lists, and only `lib/file-lock.mjs` unadmitted.
- Root cause: R1's Phase-2 scope extension re-pinned and admitted the **entrypoint**
  digest only, while `d773856` and `8b5c9e0` also moved the packaged
  `lib/file-lock.mjs` asset. `ALLOWED_GOVERNANCE_ASSET_SHA256` is one table consumed
  by both modes (`configure.mjs:1033`, `:1346`), so the per-mode deadlock could not
  re-open at the asset layer; the gap was simply never admitted.
- Provenance: the live runtime **is** the `ea84a5a` packaged build — `R2 P1`
  re-packages that commit through the repository's own `governancePluginFiles()` and
  asserts the live entrypoint digest, the live asset digest, and that the two builds
  differ in exactly `lib/file-lock.mjs` outside the entrypoint. Admission is bounded:
  `d773856`'s intermediate (`0e533f10…`), which was never installed anywhere, is
  deliberately unlisted and `R2 3` proves both modes still refuse it.
- Gates against the final state: `node --test
  tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs` 7/7; the two existing
  deployment-snapshot suites 42/42 (no admission regression); `npm test`
  1343 tests / 1298 pass / 0 fail / 45 skipped; `npm run lint` 0 issues;
  `npm run format:check` clean; `npm run repo:check` passed; `git diff --check`
  clean.
- Live result (operator-executed): preflight PASS, one apply, unit restarted;
  live `index.mjs = e8f084ab…` and `lib/file-lock.mjs = 22d7411a…`, `openclaw.json`
  and the ledger untouched, `MainPID=17047`, `NRestarts=0`, zero error-class lines
  from the new PID. Details in §4.
- Disclosed deviations/limits: `R2 P2`'s live cross-check is a silent skip on this
  Windows host (the established R13 P1 / R3 P2 precedent) — the byte-exact proof is
  `R2 P1` and the live values were confirmed separately over `wsl.exe`; `verify.mjs`
  stays `NOT RUN`; `configure.mjs --apply` records no `transactions/` entry (that
  wrapper belongs to `operator-apply.mjs`); the pre-existing router
  `GOVERNANCE_COMPLETION_UNAVAILABLE` failures and the `duplicate plugin id` warning
  are open items outside this round.

### M11/T2-R1 — gates made host-independent (owner-approved 2026-10-12, CLOSED same day)

Task: M11/T2-R1 · Plan Revision: `M11/T2-R1` · Owner approval: Option A of the Batch A
OWNER DECISION block (three scope items; the 5-high `npm audit` finding explicitly
excluded). Commits: `2bc8ddf` (all three fixes). Execution contract deleted at
closeout. Evidence level: `REMOTE-BACKED`.

- Trigger: no CI run had executed on this branch between 2026-10-01 and the Batch A
  `workflow_dispatch`, so three gates were believed merely "unproven on this host" and
  were in fact **bound to this machine or structurally unable to run**.
- Fix 1 (portable test roots, A-01). `tests/m10-t2-r20-skill-catalog-and-sql.test.mjs`,
  `…r21-skill-chunking-and-text-budgets…`, `…r22-publish-durability-and-bounded-backup…`
  and `…r25-skill-read-apply-integrity…` read production sources through a hardcoded
  `const ROOT = "C:/Users/HOANG VINH/…"` and `ENOENT`-ed on any other host. All four now
  derive the root with the repository's own idiom
  (`path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")`, already used by
  `m10-t2-r11:30-31`) and load modules through `pathToFileURL(…).href`. Not one
  assertion, expected value, test name, subtest, fixture or skip condition changed —
  `npm test` totals are identical to the M11/T1-R2 closeout (1343 tests / 1298 pass /
  0 fail / 45 skipped), which is the proof nothing was weakened.
  `grep -rn "C:/Users/HOANG VINH" tests/*.mjs` now returns only
  `tests/m7-lane-g-policy.test.mjs`, the guard that forbids such paths.
- Fix 2 (`python-quality` Node toolchain, A-02). The job installed Python 3.13 and
  `uv==0.12.5` but no Node, and `package.json` pins `devEngines.runtime`
  `>=24.15.0 <25` with `onFail: "error"`, so `npm run test:knowledge` died in npm
  (`EBADDEVENGINES … v22.23.3`) before pytest collected anything. The job now carries
  the same three steps `quality-gate` uses (SHA-pinned `actions/setup-node` at
  `24.15.0` with `package-manager-cache: false`, npm `12.0.2` bootstrapped from
  `${{ runner.temp }}`, exact-version assertions), keeping the policy-enforced
  `uv sync --locked` → `npm run test:knowledge` order.
- Fix 3 (gitleaks fingerprints, A-04). `secret-scan` in full-history
  `workflow_dispatch` mode reported 2 leaks: rule `generic-api-key` on the sha256
  **digest constants** `PREVIOUS_AUTH_SECRET_PLAN_SHA256` /
  `PREVIOUS_AUTH_ORDER_PLAN_SHA256` (`integrations/openclaw/configure.mjs:62,64`,
  first committed `7d92211`). They are provenance pins, not credentials, and the log
  values were redacted. Remediated with the repository's existing mechanism — two
  `commit:path:ruleID:line` lines in `.gitleaksignore` — leaving `.gitleaks.toml`,
  the scanner flags and `configure.mjs` untouched.
- CI evidence (read from the remote, not local): CI run `38199387584`
  @ `2bc8ddf` — `python-quality` **SUCCESS**, `188 passed, 27 subtests passed in
  10.50s`, tokenizer `…/knowledge-artifacts/tokenizer.json: OK` against the pinned
  sha256; the 188 = the 184 that pass on this host plus the 4 that Windows
  privilege-skips, so those four platform-bound cases are now proven on Linux
  (closes the A-07 caveat). Security run `38199389639` @ `2bc8ddf` — `secret-scan`
  **SUCCESS** (`No leaks detected`). Local final-state gates: `npm test`
  1343/1298/0/45, `npm run test:knowledge` `184 passed, 4 skipped, 27 subtests passed
  in 39.79s`, `npm run lint` 0 issues, `npm run format:check` clean,
  `npm run repo:check` passed (it validates the edited real `ci.yml`),
  `git diff --check` clean.
- Acceptance record, stated exactly: criteria 1, 2, 3, 4 and 6 are **PASS**.
  Criterion 5 is **PARTIAL**: the `python-quality` half (pytest collects and reports a
  nonzero passed count, no `EBADDEVENGINES`) is PASS, the `quality-gate` half is
  **FAIL** — see A-08 below. `dependency-audit` stays **FAIL** as the pre-existing
  5-high baseline (identical to scheduled `main` run `37280863207`) and is reported as
  a baseline failure, never as a pass. `M11-06`'s real-PostgreSQL statement gate
  remains `NOT RUN` in CI (no Postgres service there); it passed locally in M11/T1
  Phase 1.
- A-08, the defect these fixes unmasked (open, drives M11/T2-R2): `quality-gate` now
  clears `npm test` with `fail 0` and dies one stage later at
  `sh: 1: uv: not found` (exit 127), because `verify` contains
  `npm run test:knowledge` = `uv run --directory apps/knowledge --locked python -m
  pytest tests -q` while that job provisions Node only. Root cause is commit
  `1a36c52` (2026-10-02), which inserted the Python stage into `verify` and pinned it in
  `REQUIRED_VERIFY_STAGES` (`scripts/repository-policy.mjs:33-39`) but attached the
  Python toolchain solely to `python-quality`. Since then `CI / quality-gate` has not
  been runnable on any branch carrying that commit (`main` is green only because its
  `verify` still has four stages), and merging this branch line as-is would turn
  `main`'s CI red. Fixing it is outside R1's contract (§4 of the deleted ACTIVE.md
  excluded the `quality-gate` job, `package.json` and the policy scripts), so R1
  stopped at that boundary and asked.

### M11/T2-R2 — PROPOSED, NOT APPROVED — one owner for the Knowledgebase Python stage

Owner direction on 2026-10-12: **Option B**. The revised plan below has no authority
until the owner approves it and a matching `ACTIVE.md` is materialized; `Execution
Authorization` remains `NO`.

- Objective: make `CI / quality-gate` pass again by removing the stage it cannot
  execute, and let `python-quality` be the single CI owner of the Knowledgebase Python
  suite — the topology `docs/development/conventions.md:83` already documents
  ("`CI / python-quality` is a blocking job. It provisions … `uv sync --locked` … and
  runs `npm run test:knowledge`").
- Scope (to be frozen on approval): `package.json` `verify` →
  `npm run format:check && npm run lint && npm test && npm run repo:check`;
  `scripts/repository-policy.mjs` `REQUIRED_VERIFY_STAGES` + its ordering comment;
  `tests/repository-policy.test.mjs` (the "rejects a verify gate that omits the
  Knowledgebase Python stage" case must be re-expressed as the correct new rule:
  `verify` must equal the four documented stages **and** `python-quality` must remain
  the sole `npm run test:knowledge` executor — the guard is not to be deleted);
  `README.md`, `docs/development/conventions.md`, `CHANGELOG.md` for the host
  instruction to run `npm run test:knowledge` (or `make test-knowledge`) explicitly;
  `PLAN.md` lifecycle/evidence.
- Explicitly NOT in scope: `python-quality`'s steps, the `.github/workflows` Node
  toolchain pins, any dependency or lockfile change, the 5-high `npm audit` findings,
  `verify.mjs`, live runtime mutation or deployment.
- Acceptance to be frozen: `npm run repo:check` and
  `node --test tests/repository-policy.test.mjs` PASS on the new contract; full
  `npm test` totals unchanged; a `workflow_dispatch` CI run shows `quality-gate`
  **SUCCESS** and `python-quality` **SUCCESS**; `npm run verify` passes on this host
  without the tokenizer env being required (the Python stage is separately proven by
  `npm run test:knowledge`).
- Trade-off to disclose to the owner in the approval ask: after B, the single command
  `npm run verify` no longer covers the Knowledgebase Python tier on a host; that tier
  is covered by `npm run test:knowledge` plus the blocking CI job. If the owner wants
  one-command host coverage instead, Option A (duplicate the Python toolchain into
  `quality-gate`) is the alternative and costs a second Python run per CI invocation.

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
