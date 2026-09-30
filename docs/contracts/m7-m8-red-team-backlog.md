ACTIVE.md — M7/M8 Red-Team Remediation Backlog

Audit date: 2026-09-28
Repository: personal-tool
Branch observed: codex/m8-t2-governed-runtime-hardening
Commit observed: 0e5a899
Scope: M7/M8 OpenClaw integration, topology, workflow reducer, event ledger, authority/policy, QueueManager, DecisionLedger, native boundary, governance plugin, contracts, and M7/M8 tests.
Secrets: ignored. Do not inspect, print, copy, rotate, or modify secrets/tokens/OAuth/.env*/credential stores as part of this remediation.
Mode: remediation plan only. OpenCode may modify code/tests/docs needed to fix the findings, but must not modify secret material or live OpenClaw runtime state.

0. What this audit establishes

The previous review was too narrow. The current M7 implementation is not merely affected by a few isolated defects. It has multiple independent authority paths, multiple policy/state declarations, weak persistence semantics in secondary ledgers, and a substantial gap between source assertions and behavioral evidence.

The most important root problem is authority fragmentation:

integrations/openclaw/lib/policy.mjs contains one policy view.

integrations/openclaw/lib/authority.mjs contains another active policy matrix.

integrations/openclaw/topology/policy/*.json contains additional declarations that are not consumed at runtime.

integrations/openclaw/topology/lib/workflow.mjs contains a workflow reducer with its own lifecycle and some duplicated role/stack logic.

integrations/openclaw/lib/queue-manager.mjs contains a second mutable task lifecycle projection.

integrations/openclaw/lib/decision-ledger.mjs contains a separate user-decision store and is not actually wired as the mandatory pre-clarification authority claimed by its comments.

integrations/openclaw/plugins/zink-governance/index.mjs contains live OpenClaw paths that sometimes bypass the canonical guard and reimplement checks locally.

Therefore the remediation must not be handled as “fix the red tests.” The target is a single authoritative governance path with behavioral proof at every externally reachable seam.

0.1 R4-LOCK-PRIMITIVE — root-cause remediation completed in the audit copy

Historical status: ACCEPTED-RISK
Current audit status: FIXED IN AUDIT COPY — do not reopen the old risk as a separate task

The accepted risk was caused by a migration gap, not by a defect in the shared async primitive itself. Three M7 live writers still contained their own synchronous lock loops:

integrations/openclaw/lib/queue-manager.mjs

integrations/openclaw/topology/lib/ledger.mjs

integrations/openclaw/topology/lib/guard.mjs

Those call sites waited with synchronous filesystem operations plus Atomics.wait, so contention blocked the Node event loop. The shared integrations/openclaw/lib/file-lock.mjs had already been verified, but M7 callers had not migrated because the synchronous APIs were treated as frozen contracts.

Root fix applied in the audit copy:

Added withFileLockSync() to the shared primitive. It performs exactly one atomic mkdir acquisition attempt; contention immediately returns FILE_LOCK_BUSY instead of sleeping.

Migrated QueueManager, workflow ledger writer, and approval-consumption guard to this single primitive.

Preserved the existing synchronous public APIs, so the migration does not create a new async dependency chain.

Centralized lock-path derivation with lockDirFor() to avoid divergent lock-file naming.

Fixed error classification so callback/business errors are propagated unchanged; only lock acquisition failures are translated.

Fixed QueueManager cross-process lost-update behavior by reloading the durable projection under the lock for every mutation.

Fixed plugin packaging exposed by the migration: file-lock.mjs is now materialized with the governance plugin and copied topology imports are rewritten to the installed sibling lib/ tree.

Performance consequence: lock contention no longer monopolizes the event loop for the previous multi-second wait window. A contended synchronous call now fails after one atomic filesystem attempt, so the caller can retry at a higher-level async boundary without freezing Discord/OpenClaw processing. This is the intended M7 compatibility behavior; future APIs should use withFileLock() directly.

Verification: focused and combined M7/M8 governance suites currently pass 266/266 in the audit runtime after the packaging fix. Full repository npm run verify still requires the repository-supported Node 24.x/npm 12.x environment and the local DuckDB executable.

Important: M7-065 below is now historical/closed in the audit copy. OpenCode MUST NOT reintroduce a blocking wait loop while fixing adjacent QueueManager issues.

1. Verification baseline

ENV-001 — Repository engine mismatch in supplied audit runtime

Classification: verification blocker, not a product bug.

Observed:

package.json requires Node >=24.15.0 <25 and npm 12.x.

Audit runtime: Node 22.16.0, npm 10.9.2.

npm test therefore hits the repository engine gate.

node_modules exists in the supplied repository snapshot; the blocker is the Node engine mismatch, not a missing dependency tree.

OpenCode action:

Final validation MUST run under the repository-supported Node/npm versions.

Do not lower the engines range just to pass the current environment.

ENV-002 — M7/T4 DuckDB verification blocker

Classification: verification blocker, not automatically a code bug.

Focused M7/M8 suite executed:

289 tests total.

288 pass.

1 fails because DuckDB executable is unavailable and zink-tools/sql/duckdb-bridge.mjs:268 raises DUCKDB_ENGINE_NOT_AVAILABLE.

OpenCode action:

Re-run T4 under the supported DuckDB installation.

Missing DuckDB must remain an explicit BLOCKED/unavailable outcome; never fake successful query output.

TEST-BASELINE-001 — Green M7/M8 suite is not sufficient proof

Classification: confirmed test-quality defect.

Observed:

tests/m7-t2-openclaw.test.mjs: 31 tests, 17 source-file reads.

tests/m7-t1-openclaw.test.mjs: 20 tests, 18 source-file reads.

tests/m8-t2-governed-runtime-audit.test.mjs: 121 tests, 21 source-file reads and 55 .includes assertions.

Governance plugin coverage is only about 26% line coverage in the focused coverage run.

OpenCode action:

Replace source-presence assertions for governance invariants with behavioral tests.

Source checks may remain as supplementary anti-regression checks but cannot be the closure criterion.

TEST-BASELINE-002 — Critical branch coverage remains weak

Classification: confirmed test gap.

Focused coverage observed approximately:

workflow.mjs: 85% lines / 83% branches.

guard.mjs: 76% lines / 60% branches.

queue-manager.mjs: 81% lines / 56% branches.

decision-ledger.mjs: 86% lines / 63% branches.

governance plugin index.mjs: 26% lines / 46% branches.

OpenCode action:

Add negative tests for every P0/P1 invariant below.

Do not close the task based on aggregate coverage percentage; each authority branch must be exercised.

2. Historical BUG-M8T2-01..12 disposition

The historical .agents/states/findings.md register marks these items resolved. This audit does not accept that status without behavioral evidence.

Historical finding

Current disposition

Why

BUG-M8T2-01

REOPEN — P0

Root-result path can still produce ACTIVE -> COMPLETE directly once current-run prerequisites are satisfied.

BUG-M8T2-02

PARTIAL / REOPEN — P0

Actor/channel validation exists, but core reducer/state binding is not uniformly enforcing the complete approval tuple.

BUG-M8T2-03

PARTIAL / REOPEN — P0/P1

Queue persistence exists, but rebuild, claim, reject, and stale recovery are not fully bound to ledger authority.

BUG-M8T2-04

PARTIAL / REOPEN — P1

Result validation exists but multi-artifact identity is reduced to a single artifact in the execution path.

BUG-M8T2-05

PARTIAL / PROTECT — P1

Lease/native-race hardening exists, but the live OpenClaw event path is not proven by sufficient behavioral tests.

BUG-M8T2-06

REOPEN — P1/P0

DecisionLedger exists but is not wired as the mandatory runtime lookup before clarification; persistence is also fail-open.

BUG-M8T2-07

PARTIAL / REOPEN — P1

Attempt checks exist, but stale result/continuation identity is not universally tied to the current authoritative result/run.

BUG-M8T2-08

PROTECTED — P1 test required

Structured governed-reference code exists; real runtime behavior must still be demonstrated.

BUG-M8T2-09

PROTECTED — P1 test required

Dedup code exists; semantic duplicate/scope tests are insufficiently comprehensive.

BUG-M8T2-10

PROTECTED — P1 test required

Incident lifecycle exists, but terminal and duplicate transition behavior needs end-to-end proof.

BUG-M8T2-11

PARTIAL / REOPEN — P0

Canonical spawn topology exists but live execution paths duplicate and can bypass authority checks.

BUG-M8T2-12

PROTECTED — P1 test required

Preview implementation exists; artifact identity/array semantics remain insufficiently proven.

Important: Do not delete or rewrite these historical findings merely because a test is currently green. Closure requires behavior at the authority boundary.

3. P0 — MUST FIX BEFORE M7/M8 IS CONSIDERED GOVERNANCE-SAFE

M7-001 — Conflicting duplicate WORKFLOW_OPENED is silently accepted

Severity: P0
File: integrations/openclaw/topology/lib/workflow.mjs:115-155

Evidence:

WORKFLOW_OPENED derives/validates task_id but then executes if (Object.hasOwn(next.tasks, payload.task_id)) return next;.

No immutable-lineage comparison is performed on the existing task.

A duplicate carrying a different root session/run/message/principal can therefore be treated as an idempotent replay.

Required behavior:

Exact canonical duplicate => idempotent no-op.

Same task_id + any immutable identity/lineage mismatch => deterministic conflict, state unchanged.

Tests:

identical replay;

changed root run;

changed root session;

changed origin message;

changed origin principal;

changed root agent;

confirm sequence/snapshot do not advance on conflict.

M7-002 — Public raw appendEvent can persist an event without projecting the workflow state

Severity: P0
File: integrations/openclaw/topology/lib/ledger.mjs:378+

Evidence:

Raw event append validates persistence shape but does not guarantee applyWorkflowEvent is used before event+snapshot commit.

This creates a second write path where event log and snapshot may disagree.

Required behavior:

One authoritative commit path: validate -> reduce/project -> append -> snapshot commit.

Raw writer must be private or must itself invoke the canonical reducer.

Tests:

event replay equals stored snapshot;

no event can advance sequence with an unprojected snapshot;

failed transition leaves both event log and snapshot unchanged.

M7-003 — Active tool-policy authority is internally contradictory

Severity: P0
Files:

integrations/openclaw/lib/policy.mjs

integrations/openclaw/lib/authority.mjs:485-535

integrations/openclaw/plugins/zink-governance/index.mjs:952+

Evidence:

authority.mjs grants O2 zink_sql: L3 and Python zink_sql: L3.

The intended callable-tool policy in policy.mjs is narrower.

evaluateToolAccess() in the live plugin relies on the authority matrix.

Required behavior:

One canonical tool-access policy only.

Every runtime projection is generated/validated from it.

If a tool is contract-only or not callable by an agent, active runtime access MUST be denied.

Tests:

exact 7-agent × callable-tool matrix;

O2 SQL denied;

Python SQL denied unless explicitly present in one canonical source;

Main direct specialist execution denied;

contract-only tools always denied.

M7-004 — before_tool_call has a live path that bypasses the canonical guard

Severity: P0
File: integrations/openclaw/plugins/zink-governance/index.mjs:2945-3065

Evidence:

For non-synthetic live calls to zink_excel, zink_power_bi, zink_sql, zink_python, zink_n8n, the plugin calls evaluateToolAccess() and then implements partial local validation.

It does not invoke the same guard.beforeToolCall() path used by the synthetic/governed tool route.

The canonical guard contains additional schema, approval, target, SQL, artifact, delegation, and output-correlation checks.

Impact:

Security/governance behavior differs depending on how the same tool is reached.

Required behavior:

All externally reachable tool calls must pass one canonical guard.

Local plugin logic may normalize OpenClaw payloads, but must not reimplement authorization.

Tests:

same logical tool request through every live route produces identical allow/deny decision;

prove no tool can execute when canonical guard denies it.

M7-005 — Live SQL validation is weaker and semantically different from canonical SQL validation

Severity: P0
File: integrations/openclaw/plugins/zink-governance/index.mjs:3008-3039

Evidence:

Live path only strips comments, checks the first SQL word, and blocks a short mutation keyword list.

Canonical validateSqlQuery() in the guard performs the repository SQL contract validation.

Live path explicitly allows WITH, while canonical validation treats CTE/WITH as restricted.

Required behavior:

Call the canonical SQL validator. Do not maintain a second SQL policy regex.

Tests:

comments;

semicolons/multi-statement;

CTE/WITH;

joins/unions if restricted by current contract;

mutation keywords;

all canonical allowed forms.

M7-006 — Live n8n path can skip the canonical workflow registry/approval/delegation controls

Severity: P0
File: integrations/openclaw/plugins/zink-governance/index.mjs:2945-3065

Evidence:

zink_n8n falls through the simplified live-tool branch.

The canonical guard contains explicit N8N_WORKFLOW_REGISTRY, workflow allowlist, delegation, and approval checks.

The live branch does not execute those checks.

Required behavior:

n8n requests must use the same registry, delegation scope, approval, and target validation as the canonical guard.

Tests:

unknown workflow id denied;

unauthorized agent denied;

wrong coordinator denied;

missing approval denied;

allowed workflow succeeds.

M7-007 — Live file-path validation does not equal the canonical path-safety contract

Severity: P0/P1
File: integrations/openclaw/plugins/zink-governance/index.mjs:2990-3050

Evidence:

Excel/Python live checks mainly look for ../ fragments.

Canonical guard uses validateArtifactLogicalPath and related path policy.

This is not equivalent for absolute paths, alternate separator encodings, or other canonical path constraints.

Required behavior:

One canonical path validator.

Fail closed when the validator is unavailable.

Tests:

relative safe path;

absolute path;

.. traversal in all separator forms;

encoded/normalized traversal according to contract;

symlink/realpath cases if current contract requires them.

M7-008 — Missing canonical guard dependencies can silently become no-op validators

Severity: P0
File: integrations/openclaw/topology/lib/guard.mjs:70-80,148-169

Evidence:

validateArtifactLogicalPath, validateSqlQuery, and invokeN8n have no-op fallback functions when imports are missing.

A missing validator therefore changes a fail-closed condition into an apparent allow path.

Required behavior:

Missing mandatory governance dependency => GOVERNANCE_DEPENDENCY_MISSING / BLOCKED.

No no-op fallback for security/governance validators.

Tests:

intentionally break each dependency import/interface;

assert tool call is blocked;

assert no successful lease is created.

M7-009 — Queue rebuild maps every ACTIVE ledger task to QUEUED

Severity: P0
File: integrations/openclaw/lib/queue-manager.mjs:559-567

Evidence:

The ternary maps ledgerTask.workflow_status === "ACTIVE" to TASK_STATES.QUEUED regardless of approved_at because both branches return QUEUED.

This turns an unapproved authoritative task into an executable queue task during rebuild.

Required behavior:

Only an explicitly approved/execution-ready ledger state may project to QUEUED.

ACTIVE, APPROVAL_PENDING, WAITING_FOR_USER, RESULT_PENDING_REVIEW, terminal, and blocked states must map according to the canonical lifecycle.

Tests:

rebuild unapproved ACTIVE => not executable;

rebuild approved => QUEUED;

rebuild result-pending => result-pending only;

rebuild cancelled/rejected => terminal/non-executable.

M7-010 — Queue claim is not authoritatively bound to task assignment/coordination

Severity: P0
Files: integrations/openclaw/lib/queue-manager.mjs:180-350

Evidence:

claimTask() selects by requiredCapabilities and claimTaskById() mainly checks task existence/state plus agent identity.

There is no ledger-authority check that the claimant is the designated coordinator/execution agent for the current workflow node.

rebuildFromLedger() reconstructs requiredCapabilities: [], making any capability claim path especially weak after rebuild.

Required behavior:

Claim MUST be bound to the authoritative node assignment / allowed agent identity.

Queue capability matching is a routing aid, not the final authorization.

Tests:

wrong agent claim by task ID => deny;

wrong coordinator => deny;

rebuilt task keeps assignment and cannot be claimed by arbitrary agent;

delegated specialist cannot claim coordinator-only work.

M7-011 — Queue rejectTask() is an unrestricted mutation seam

Severity: P0
File: integrations/openclaw/lib/queue-manager.mjs:475-524

Evidence:

rejectTask() accepts any queue item and directly changes status to REJECTED.

There is no actor, ledger state, result review, or approval authority verification.

It can mutate EXECUTING/RESULT_PENDING_REVIEW/other states outside the governed Discord decision path.

Required behavior:

Queue reject/cancel must be performed through the authoritative workflow action path, or require an explicit authorized actor token and source state.

Queue manager must not invent a separate governance transition.

Tests:

reject executing => deny unless current workflow contract explicitly authorizes it;

reject terminal => idempotent/no-op or deny;

arbitrary queue caller => deny;

ledger snapshot must remain authoritative.

M7-012 — Queue completeTask() trusts an arbitrary confirmation reference

Severity: P0/P1
File: integrations/openclaw/lib/queue-manager.mjs:444-473

Evidence:

Completion requires queue state RESULT_PENDING_REVIEW, but userConfirmationRef is just stored as a string.

No verified user principal, current result identity, channel, or ledger decision is checked here.

Required behavior:

Queue completion must only occur from a verified user ACCEPT decision tied to the current result.

Prefer queue projection from the ledger rather than direct completion mutation.

Tests:

fake confirmation reference => deny;

stale result reference => deny;

current user decision => allow;

non-user actor => deny.

M7-013 — WORKFLOW_USER_APPROVAL_DECIDED has no current-state precondition

Severity: P0
File: integrations/openclaw/topology/lib/workflow.mjs:351-384

Evidence:

The reducer validates actor/channel/decision but does not gate on the current workflow state.

Direct reproduction showed APPROVE driving unrelated states (including terminal states) toward QUEUED.

Required behavior:

Define exact source states for APPROVE, REJECT, REQUEST_REVISION.

Reject all invalid and terminal-state approvals.

Tests:

full invalid-state matrix for every action;

duplicate approval;

approval after rejection/cancellation/completion;

exact expected reason codes.

M7-014 — Root result can still close the task without user ACCEPT

Severity: P0
File: integrations/openclaw/topology/lib/workflow.mjs:227-296

Evidence:

Current code has a current-state check, but it still assigns task.workflow_status = payload.outcome_status after the result event.

For an execution outcome of COMPLETE, the task becomes COMPLETE immediately.

This contradicts the intended RESULT_PENDING_REVIEW -> user ACCEPT -> COMPLETE boundary.

Required behavior:

Native/root execution result => RESULT_PENDING_REVIEW or equivalent review state.

COMPLETE only after the authoritative user ACCEPT event.

Tests:

successful root output;

partial/failed output;

no ACCEPT => never COMPLETE;

current result ACCEPT => COMPLETE;

late terminal result cannot reopen/reclose the task.

M7-015 — Task-level WORKFLOW_RESULT_RECORDED lacks source-state gating

Severity: P0
File: integrations/openclaw/topology/lib/workflow.mjs:455-527

Evidence:

The task-level branch can put workflow state into RESULT_PENDING_REVIEW without first requiring the task to be in the exact execution-finished state.

This lets result events be injected into inappropriate lifecycle states.

Required behavior:

Require the exact authoritative source state and result lineage before recording a reviewable result.

Tests:

ACTIVE/QUEUED/WAITING/COMPLETE/CANCELLED/REJECTED result injection => deny;

valid execution-finished result => allow.

M7-016 — Result review actions do not bind to the current result identity

Severity: P0
File: integrations/openclaw/topology/lib/workflow.mjs:298-349

Evidence:

result_id and result_digest are optional event keys.

The reducer does not require them to match the authoritative pending result.

A valid RESULT_PENDING_REVIEW state can be completed without a result identifier.

Required behavior:

ACCEPT/REJECT/REVISION must reference the current authoritative result.

Missing, foreign, and stale result references must fail closed.

M7-017 — DecisionLedger is not a runtime authority before clarification

Severity: P0/P1
File: integrations/openclaw/lib/decision-ledger.mjs plus integrations/openclaw/plugins/zink-governance/index.mjs

Evidence:

defaultDecisionLedger exists, but the runtime clarification path does not demonstrably consult it before asking the user the same question again.

The ledger therefore provides storage without enforcing the stated governance rule.

Required behavior:

Main/O1/O2 clarification path MUST perform a governed decision lookup before asking.

Lookup scope must be explicit.

If ledger is unavailable/corrupt, fail according to the documented governance policy rather than silently acting as if no decision exists.

Tests:

prior global decision prevents duplicate clarification;

task-specific decision does not satisfy another task;

missing/corrupt ledger behavior is explicit and fail-closed where required.

M7-018 — authenticateIngress() has a conditional owner check that is fail-open when sender identity is absent

Severity: P0/P1
File: integrations/openclaw/plugins/zink-governance/index.mjs:3578-3597

Evidence:

Condition is effectively (config.ownerDiscordId && context.senderId && context.senderId !== config.ownerDiscordId).

When senderId is missing, the mismatch branch does not fire.

This permits ingress contexts with missing sender identity to continue to later checks.

Required behavior:

Discord ingress must require a verified sender identity before owner authorization.

Missing sender ID => deny.

Tests:

valid owner => allow;

wrong owner => deny;

missing sender => deny;

bot sender => deny;

wrong agent => deny.

M7-019 — Live sessions_spawn path duplicates governance instead of using one canonical spawn gate

Severity: P0
File: integrations/openclaw/plugins/zink-governance/index.mjs:3068-3399

Evidence:

A dedicated live branch parses the spawn proposal and writes WORKFLOW_SPAWN_RESERVED directly before returning allow.

Canonical guard.beforeToolCall() is only reached outside this branch.

The two paths can therefore diverge in approval/state/lineage enforcement.

Required behavior:

One canonical spawn authorization function.

Live OpenClaw adapter may normalize input and then delegate to that function; it must not make independent policy decisions.

Tests:

same spawn through live and synthetic paths => same decision;

approval absent => both deny;

wrong hierarchy => both deny;

wrong task state => both deny.

M7-020 — Spawn reservation path does not visibly require canonical workflow approval state

Severity: P0/P1
Files: live spawn branch above + workflow.mjs:775+

Evidence:

WORKFLOW_SPAWN_RESERVED enforces lineage, node, dependency, attempt and budget constraints, but does not itself enforce the complete workflow approval state transition contract.

This relies on upstream caller behavior, creating a bypass seam.

Required behavior:

Spawn reservation must assert the canonical current state and approval evidence itself, not merely trust the caller.

Tests:

ACTIVE without approval => deny;

APPROVAL_PENDING without approval => deny;

QUEUED after approved decision => allow;

terminal states => deny.

M7-021 — Queue and ledger use separate default storage roots

Severity: P0/P1
Files: queue-manager.mjs:33-39,621; decision-ledger.mjs:14-23,151; plugin path setup

Evidence:

Queue defaults to ~/.openclaw-zink/task-queue.json.

Decision ledger defaults to ~/.openclaw-zink/decision-ledger.json.

Main workflow ledger uses configured ledgerRoot and is created through different code paths.

Plugin imports defaultQueueManager / defaultDecisionLedger, so configured runtime roots are not necessarily the roots actually governing execution.

Required behavior:

All governance state must resolve from the configured authority root/manifest.

No import-time singleton may silently choose an unrelated default path in production.

Tests:

custom configured root is used by all ledgers;

restart/rebuild reads same authoritative store;

no silent fallback to home directory.

M7-022 — Corrupt DecisionLedger is treated as empty instead of failing closed

Severity: P0/P1
File: integrations/openclaw/lib/decision-ledger.mjs:33-47

Evidence:

Parse/read errors are caught and logged.

The in-memory Map remains empty.

A caller can therefore observe “no prior decision” after persistence corruption.

Required behavior:

Corrupt authoritative decision state => explicit BLOCKED/UNKNOWN condition.

Never silently reinterpret corruption as “no decision exists.”

Tests:

malformed JSON;

missing required record fields;

partial file;

verify clarification/authority path blocks rather than forgetting prior decisions.

M7-023 — DecisionLedger save failure is swallowed

Severity: P0/P1
File: integrations/openclaw/lib/decision-ledger.mjs:49-59

Evidence:

Write errors are caught and only logged.

recordDecision() still returns the record, creating apparent success without durable persistence.

Required behavior:

Persistence failure must surface as an error.

Do not claim a decision is stored unless durable write succeeded.

Tests:

unwritable path;

read-only directory;

injected write error;

record operation fails and does not leave a false-positive state.

M7-024 — Approval-consumption corruption/in-memory fallback is not fail-closed

Severity: P0/P1
Files: governance plugin approval persistence helpers

Evidence:

Corrupt consumed-approval persistence is handled as an empty/usable store in the existing approval path rather than producing an explicit invalid-authority state.

If configured persistence is unavailable, an in-memory fallback can permit replay protection to disappear across restart.

Required behavior:

One-time approvals require authoritative durable storage.

Corrupt/missing storage => reject the approval rather than resetting replay history.

Tests:

corrupt file;

missing directory;

restarted process;

duplicate approval after restart.

M7-025 — Queue stale recovery can resurrect work without ledger-state verification

Severity: P0/P1
File: integrations/openclaw/lib/queue-manager.mjs:486-520

Evidence:

Stale EXECUTING entries are requeued based on heartbeat age.

There is no mandatory authoritative workflow-state check during the recovery mutation.

Required behavior:

Before requeueing a stale item, reconcile against the authoritative workflow ledger.

Cancelled/rejected/result-pending/terminal tasks must not be resurrected.

Tests:

stale executing + ledger cancelled => no requeue;

stale executing + ledger rejected => no requeue;

stale executing + same active generation => requeue with new generation;

zombie old lease => rejected.

M7-026 — Queue reconstruction loses execution assignment and capability constraints

Severity: P0/P1
File: integrations/openclaw/lib/queue-manager.mjs:580-605

Evidence:

Reconstructed items use requiredCapabilities: [] and payload: {}.

claimedBy is restored, but lease/generation detail is dropped.

Required behavior:

Rebuild must preserve the authoritative execution assignment, node identity, attempt/generation, required capability set, and minimum payload needed to resume safely.

If information is missing, rebuild must produce BLOCKED rather than an underconstrained runnable task.

Tests:

rebuild preserves assignment;

missing assignment => blocked;

wrong capability agent cannot claim reconstructed item.

M7-027 — Queue load merges instead of rebuilding the in-memory Map

Severity: P1
File: integrations/openclaw/lib/queue-manager.mjs:93-105

Evidence:

load() inserts items into the existing Map but never clears it first.

If persisted queue shrinks, stale in-memory entries can survive a reload in the same process.

Required behavior:

load() must rebuild the Map from the serialized source atomically.

Missing persisted entries must be removed from memory.

Tests:

persisted task removed between loads;

reload => removed from listTasks/getTask;

no stale task can be claimed after reload.

M7-028 — Queue heartbeat leaseId is optional

Severity: P1
File: integrations/openclaw/lib/queue-manager.mjs:330-382

Evidence:

Lease mismatch is checked only when leaseId != null.

A claimant can refresh a lease without presenting the lease fence.

Required behavior:

Heartbeat MUST require the current leaseId for execution-agent fencing.

Missing leaseId => reject.

Tests:

correct lease => pass;

missing lease => reject;

stale lease => reject.

M7-029 — Queue finish fence is partially optional

Severity: P1
File: integrations/openclaw/lib/queue-manager.mjs:383-443

Evidence:

leaseId and attempt are optional checks.

This weakens zombie/stale execution protection.

Required behavior:

For an executing task, agentId + leaseId + attempt are mandatory and must all match.

Tests:

each missing field;

each mismatched field;

old attempt/old lease after stale recovery;

valid completion.

M7-030 — Claim-by-ID can heartbeat an existing claim without lease verification

Severity: P1
File: integrations/openclaw/lib/queue-manager.mjs:238-253

Evidence:

If task is EXECUTING and claimedBy === agentId, claimTaskById() calls heartbeat without requiring the caller's current leaseId.

Possessing only task ID + agent ID is therefore enough to extend the existing lease.

Required behavior:

Reclaim/renew must require current lease fence.

Tests:

same agent + no lease => deny;

same agent + stale lease => deny;

same agent + current lease => renew.

M7-031 — listActiveTasks() misclassifies terminal states

Severity: P1
File: integrations/openclaw/lib/queue-manager.mjs:526-531

Evidence:

It only excludes COMPLETE and REJECTED.

Workflow terminal states also include FAILED, PARTIAL, CANCELLED.

Required behavior:

Terminal/non-executable state set must be canonical and shared with workflow authority.

Tests:

every terminal state excluded;

RESULT_PENDING_REVIEW included;

active states included.

M7-032 — Queue persistence failure can leave in-memory state mutated

Severity: P1
Files: QueueManager mutators

Evidence:

enqueueTask() explicitly rolls back on save failure.

Other mutators (claim, heartbeat, finish, reject, complete) mutate first and then save without equivalent rollback.

Required behavior:

Durable write failure must not leave process memory ahead of persisted authority.

Use copy-on-write, rollback, or transactional commit semantics.

Tests:

inject save failure into every mutator;

compare in-memory and disk state after failure.

M7-033 — Decision scope is an arbitrary string

Severity: P1
File: integrations/openclaw/lib/decision-ledger.mjs:66-98

Evidence:

scope is lowercased but not constrained to the documented values.

Unknown scope values can enter the authority store.

Required behavior:

Validate against the canonical scope enum.

Task-specific scope must require a task identity/context.

Global/domain scope must not be inferred from arbitrary text.

Tests:

invalid scope;

task-specific without task identity;

domain/global with valid context;

case normalization.

M7-034 — DecisionLedger does not verify the human principal

Severity: P1
File: integrations/openclaw/lib/decision-ledger.mjs:66-98

Evidence:

confirmedBy is validated only for truthiness.

Any arbitrary string can be recorded as the “verified user”.

Required behavior:

Record decisions only from a principal verified by the authoritative Discord identity path.

Store the principal reference bound to the actual governed interaction.

Tests:

fake principal;

missing principal;

wrong guild/channel context;

valid user interaction.

M7-035 — hasDecision() ignores decision scope

Severity: P1
File: integrations/openclaw/lib/decision-ledger.mjs:108-135

Evidence:

queryDecisions() can filter by scope, but hasDecision(topic, query) calls it without scope/task context.

A task-specific decision can therefore satisfy a broad query.

Required behavior:

Decision lookup must always carry explicit scope/context and use a containment rule.

Never allow task-specific decisions to satisfy unrelated tasks.

Tests:

task 1 decision queried from task 2 => no match;

domain decision where domain matches => match;

global decision => allowed global match.

M7-036 — Decision query uses broad substring matching instead of a governed semantic key

Severity: P1/P2
File: integrations/openclaw/lib/decision-ledger.mjs:117-124

Evidence:

Query match is simple text.includes(queryLower) across topic/question/decision/tags.

Short/common words can produce unrelated matches.

Required behavior:

Use a canonical normalized decision key/topic/query digest or the repository’s governed semantic matching contract.

Do not generalize by raw substring.

Tests:

near-collision terms;

same topic but different question;

exact key match;

task/domain/global boundaries.

M7-037 — Duplicate role/stack policy is present in workflow implementation

Severity: P1
Files: workflow.mjs:681+, authority.mjs, policy.mjs

Evidence:

Workflow brief activation uses a local agent->stack mapping.

Canonical AGENT_STACK_POLICY is defined separately.

Duplicated values can drift without a compile/runtime assertion.

Required behavior:

Remove duplicate literals or assert equality against canonical policy at startup/build.

Workflow must consume the canonical policy projection.

Tests:

mutate one canonical policy row in a fixture and verify startup/test fails rather than silently accepting drift.

M7-038 — Local workflow stack projection is narrower than canonical specialist stack policy

Severity: P1
Files: workflow.mjs and authority.mjs

Evidence:

Canonical specialist policy grants semantic/decision access to several specialist agents.

Workflow activation has a narrower hardcoded stack map for some specialist nodes.

Required behavior:

One source of truth for node stack eligibility.

Any accepted brief node must be valid under the canonical agent-stack policy and vice versa.

Tests:

each of 7 agents across all canonical stacks;

reject mismatched stack assignment;

prove no valid canonical assignment is rejected by a duplicate map.

M7-039 — Dormant policy files create a false canonical source-of-truth

Severity: P1
Files:

integrations/openclaw/topology/policy/state-transitions.json

integrations/openclaw/topology/policy/workflow-policy.json

integrations/openclaw/topology/policy/role-capability-manifest.json

Evidence:

Repository search found no runtime .mjs references to these three policy files.

They declare lifecycle/capability semantics different from the richer runtime state model.

Required behavior:

Either make these files genuinely canonical and runtime-consumed, or delete/deprecate them explicitly and generate them as artifacts from one canonical source.

Do not keep “canonical-looking” dead policies.

Tests:

CI/source check that all declared canonical policy artifacts are consumed or generated.

M7-040 — Lifecycle is split across multiple incompatible state enumerations

Severity: P1
Evidence locations: state-transitions.json, execution-brief.schema.json, ledger-snapshot.schema.json, authority.mjs, workflow.mjs

Observed state sets differ materially, including DRAFT/PREFLIGHT/APPROVAL_PENDING/QUEUED/EXECUTING/WAITING_FOR_USER/EXECUTION_FINISHED/VALIDATION_PENDING/RESULT_PENDING_REVIEW/REVISING/REJECTED and reduced schema enums elsewhere.

Required behavior:

One canonical state machine and explicit projection states for external schemas.

Every projection must document how it maps to the canonical lifecycle.

Tests:

state-set consistency check;

every runtime state serializes/validates correctly;

every terminal state is terminal in every projection.

M7-041 — WORKFLOW_USER_QUESTION_RECORDED does not bind question author to the authoritative run owner

Severity: P1
File: workflow.mjs:399+

Evidence:

State check is present, but raw reducer does not fully bind payload.agent_id to the owned delegation/run before recording the question.

Required behavior:

Question event must be attributable to the authorized main/coordinator/run context.

Tests:

foreign agent question => reject;

stale run => reject;

current run => allow.

M7-042 — WORKFLOW_USER_ANSWER_RECORDED accepts weak provenance at raw reducer level

Severity: P1
File: workflow.mjs:409+

Evidence:

Raw event path validates workflow state, but higher-level user-principal/channel binding is not reproduced in the reducer contract itself.

Required behavior:

Raw event must require an authoritative user principal/message/thread reference or be private behind the already-verified ingress path.

Tests:

missing principal;

foreign thread/message;

non-user actor;

valid answer.

M7-043 — Continuation owner-attempt binding is optional

Severity: P1
Evidence: continuation authorization in workflow.mjs:532-620.

Required behavior:

Delegated continuation must require the current attempt/generation identity.

Missing or stale owner attempt => deny.

Tests:

matching attempt;

missing attempt;

stale attempt;

wrong delegated run.

M7-044 — Native-end timestamp field is consumed but excluded from exact-key contract

Severity: P1
File: workflow.mjs:163-206

Evidence:

WORKFLOW_NATIVE_ENDED exact keys exclude recorded_at.

Code later reads payload.recorded_at and uses a 1970 fallback path.

Required behavior:

Align contract and implementation.

Prefer the canonical event timestamp or require validated recorded_at.

Never emit a current failure with synthetic 1970 metadata.

Tests:

valid timestamp;

missing timestamp;

malformed timestamp.

M7-045 — Native child completion handler swallows workflow-write failure

Severity: P1
File: integrations/openclaw/plugins/zink-governance/index.mjs:3706-3739

Evidence:

subagent_ended catches all errors and logs them.

The callback does not propagate a blocking result to the host path.

A lineage/state write failure can therefore leave the native runtime and ledger out of sync.

Required behavior:

On authoritative completion-write failure, mark governance state UNKNOWN/BLOCKED and surface the incident through the approved error path.

Do not silently continue.

Tests:

injected ledger failure;

lineage mismatch;

late duplicate;

valid completion.

M7-046 — Native spawn receipt handler is similarly best-effort

Severity: P1
File: integrations/openclaw/plugins/zink-governance/index.mjs:3740-3780+

Evidence:

Spawn receipt failures are caught and handled as warnings/incident side effects rather than definitively blocking a child that already exists outside the recorded lineage.

Required behavior:

Unknown/mismatched child receipt => authoritative workflow incident + execution blocked/unknown until reconciled.

Tests:

wrong label;

wrong requester session;

unknown child session;

duplicate receipt;

valid receipt.

M7-047 — beforeRunEnd explicitly allows Discord provider errors to bypass normal governance completion checks

Severity: P1
File: integrations/openclaw/plugins/zink-governance/index.mjs:3497-3524

Evidence:

Certain Main Discord turns with provider failure or SCHEMA_INVALID return { allow: true }.

This is intentionally described as conversational accommodation, but it creates a separate completion-policy branch.

Required behavior:

Preserve conversational fallback only if the host contract guarantees that {allow:true} cannot be interpreted as successful task completion.

Otherwise return an explicit non-completion dispatch result.

Tests:

conversational clarification;

provider 503;

execution envelope schema error;

task completion on the same path.

M7-048 — Self-session shortcut bypasses beforeRunEnd governance

Severity: P1
File: integrations/openclaw/plugins/zink-governance/index.mjs:3442-3446

Evidence:

context.sessionKey === agent:${agentId}:${agentId} returns { allow: true } immediately.

This bypasses the normal end-of-run guard.

Required behavior:

If this session type is an internal system session, identify and authenticate it explicitly, then apply a reduced but still governed policy.

Do not bypass because of a string pattern alone.

Tests:

legitimate internal session;

spoofed matching session key;

execution task end;

governance failure.

M7-049 — Tool-wrapper requester identity is caller-controlled

Severity: P1
File: governance plugin tool registration around registerTools() and evaluateToolAccess().

Evidence:

Wrapper logic accepts requester identity from tool parameters/context before checking access.

Missing/unknown requester paths can lead to wrapper-level authorization differences from native context authorization.

Required behavior:

Principal identity must come from trusted OpenClaw context, not tool payload.

Tool payload may carry business metadata, never authority identity.

Tests:

spoof requesting_agent;

omit requester;

context says another agent;

verify wrapper and native decisions agree.

M7-050 — Missing tool contract can fall back to hand-written schema instead of blocking

Severity: P1
Evidence: loadToolContractSchemas() / tool registration in governance plugin.

Evidence:

The registration path uses fallback definitions when canonical contract loading fails.

That allows contract drift or missing schema to become a live callable tool rather than a governance failure.

Required behavior:

Missing canonical tool contract => registration failure or tool unavailable.

Hand-written fallbacks may be used only for non-governance metadata and must not override canonical schema.

Tests:

remove contract file;

malformed contract;

checksum mismatch;

verify tool is not registered/usable.

4. P1 — ADDITIONAL M8 / RESULT / EXECUTION FINDINGS

M8-051 — Multi-artifact execution result is reduced to one artifact in gate/digest plumbing

Severity: P1
Evidence: handleExecutionFinished() and queue/result-card wiring in governance plugin.

Observed:

Execution result accepts/handles an artifact array.

The result gate and some downstream persistence/delivery paths still use singular artifactPath/single-result assumptions.

Required behavior:

Define the canonical artifact set as an ordered, bounded collection with a digest over the whole set.

Validate every artifact, not only the first.

User review must refer to the exact artifact set.

Tests:

zero artifacts;

one artifact;

multiple artifacts;

one invalid artifact among valid ones;

reordered artifact list changes canonical digest if ordering is authoritative.

M8-052 — Queue finish occurs before ledger result recording, allowing split-brain state

Severity: P1
Evidence: handleExecutionFinished() path around queue finishExecution() then recordWorkflowEvent(WORKFLOW_RESULT_RECORDED).

Observed:

Queue is moved to RESULT_PENDING_REVIEW first.

Ledger write can fail afterwards.

No transaction or compensating rollback is guaranteed.

Required behavior:

Use one transactional authority or explicit two-phase state with durable reconciliation.

Never leave queue RESULT_PENDING_REVIEW while ledger still says EXECUTING without an incident/reconciliation marker.

Tests:

force ledger write failure;

force queue write failure;

process restart between phases;

reconcile to one authoritative final state.

M8-053 — Execution idempotency is process-memory only

Severity: P1
Evidence: governance plugin COMPLETED_EXECUTIONS_KEY / in-memory execution dedup.

Observed:

Duplicate completion suppression relies on an in-memory Set.

Process restart loses this state.

Required behavior:

Persist execution idempotency key tied to task + attempt + result digest.

Replay after restart must be deterministically rejected or treated as exact idempotent replay.

Tests:

duplicate same process;

duplicate after restart;

same task new attempt;

same result digest vs conflicting digest.

M8-054 — Execution finish payload digest is passed to queue API that does not enforce it

Severity: P1
Evidence: governance plugin finish path vs QueueManager.finishExecution() signature.

Observed:

Plugin supplies a payload digest in the finish flow.

Queue method does not bind/validate that digest as a fence.

JavaScript silently ignores an unexpected parameter if present in the object.

Required behavior:

Digest must be part of the validated execution fence/result record or not be presented as if authoritative.

Tests:

digest mismatch;

missing digest;

valid digest;

same attempt with conflicting digest.

M8-055 — WORKFLOW_SPAWN_RESERVED depends on caller-generated delegation data that is duplicated in plugin code

Severity: P1
Evidence: plugin live spawn branch + reducer spawn reservation.

Observed:

Delegation ID is generated in the plugin, while the reducer independently derives/validates it.

This is acceptable only if both use exactly the same canonical algorithm and input tuple.

Required behavior:

Export one canonical deriveDelegationId/spawn proposal builder and use it in both paths.

Eliminate duplicate serialization logic.

Tests:

same proposal through both paths produces identical ID;

any field mutation changes the ID;

collision/duplicate attempt is rejected.

M8-056 — Old execution attempts require explicit terminal semantics

Severity: P1
Evidence: continuation/spawn/result paths around attempt checks.

Required behavior:

Every node/attempt tuple is single-use.

Late callbacks from lower attempts can never mutate current task state.

Retry is allowed only for the documented transient-failure class.

Tests:

attempt 1 fails transient -> attempt 2 allowed;

attempt 1 reports after attempt 2 starts -> ignored/rejected;

attempt 1 reports COMPLETE after task moved terminal -> no mutation;

duplicate same attempt -> idempotent/no-op.

M8-057 — Queue requiredCapabilities.some() semantics are ambiguous for multi-capability tasks

Severity: P1 test/contract issue
File: queue-manager.mjs:205-214

Observed:

Claim succeeds when any required capability matches.

The name/usage of requiredCapabilities suggests an AND-style requirement in some callers, but this contract is not explicitly defined.

Required action:

Decide and encode the contract explicitly.

If it means all required capabilities, use all-match.

If it means any eligible capability, rename/document it as such and add tests.

Do not silently let a queue item requiring a coordinator + specialist role be claimed on one partial match.

M8-058 — Plugin registers tools before checking config.enabled

Severity: P1
File: governance plugin initialization around registerTools() and config.enabled check.

Observed:

Tool registration occurs before the disabled-config return.

A disabled governance plugin can therefore still register tool surfaces before exiting.

Required behavior:

Disabled governance integration must not expose governed tools/hooks.

Tests:

config enabled=false => no governance tool registration;

config enabled=true => normal registration.

M8-059 — Tool registry checksum failure is treated as a warning instead of blocking registration

Severity: P1
Evidence: plugin registration path around getToolRegistryChecksum().

Observed:

Checksum failure is logged and registration continues with a null/absent checksum.

Required behavior:

If checksum is part of governance binding, failure => no registration / BLOCKED.

Do not claim integrity verification when checksum generation failed.

Tests:

checksum dependency missing;

malformed registry;

expected checksum mismatch;

valid checksum.

M8-060 — Non-JSON tool output can bypass output-shape validation

Severity: P1
Evidence: governed tool wrapper output parsing in plugin.

Observed:

JSON parsing errors are swallowed for some output validation paths.

Non-JSON output can therefore skip structured result validation.

Required behavior:

If a governed tool contract requires a structured result, non-JSON output is invalid and must be blocked/reported.

Tests:

valid structured JSON;

malformed JSON;

plain string;

empty output.

M8-061 — Memory adapter caller identity is taken from request parameters

Severity: P1
Evidence: memory/vector tool path in governance plugin.

Observed:

requesting_agent can flow from tool parameters into memory access logic.

Required behavior:

Memory authority identity comes from trusted runtime context.

User/tool payload cannot impersonate another agent.

Tests:

parameter spoof;

context mismatch;

omitted parameter;

valid context.

M8-062 — Missing-memory backend can return a governed-looking status instead of unavailable/blocked

Severity: P1
Evidence: synthetic memory backend path in governance plugin.

Observed:

Placeholder/synthetic adapters can return status resembling success/governed availability rather than explicit backend unavailability.

Required behavior:

Missing backend => UNAVAILABLE / BLOCKED, never successful-looking result.

Tests:

backend absent;

backend malformed;

valid backend.

M8-063 — Hard-coded local filesystem fallback paths reduce portability and can select the wrong contract tree

Severity: P2
Files: topology/lib/schema.mjs and related modules.

Observed:

Contract resolver contains absolute WSL/Windows paths specific to one workstation layout.

Required behavior:

Resolve from configured repository root/package-relative paths first.

Machine-specific absolute paths must be removed from governance authority resolution.

Missing path => blocked, not fallback to an unrelated tree.

Tests:

clean machine without absolute path;

configured root;

missing contract;

duplicate contract trees.

5. P2 — DURABILITY / MAINTAINABILITY ISSUES THAT SHOULD NOT BE IGNORED

M7-064 — Queue projection version resets after restart

Severity: P2
File: queue-manager.mjs:41-46,116+

Observed:

_projectionVersion is in-memory and initialized to 0.

Comments say it monotonically increases across saves, but restart resets it.

Required behavior:

Either persist the projection version or define it as process-local explicitly and remove the stronger durability claim.

M7-065 — Queue lock implementation blocks the process while waiting

Severity: P2
Status: FIXED IN AUDIT COPY
Files: integrations/openclaw/lib/file-lock.mjs, integrations/openclaw/lib/queue-manager.mjs, integrations/openclaw/topology/lib/ledger.mjs, integrations/openclaw/topology/lib/guard.mjs

Root cause:

Three live M7 call sites retained duplicated synchronous Atomics.wait lock loops even though the repository had already introduced a verified asynchronous file-lock primitive.

Remediation:

All three call sites now use the shared withFileLockSync() compatibility seam. Contention fails immediately with a deterministic busy code; there is no synchronous wait loop.

Regression:

tests/m7-r4-root-fix.test.mjs proves sub-100ms contention failure and verifies QueueManager, ledger and approval-consumption behavior.

OpenCode MUST treat the root-fix implementation above as protected infrastructure and MUST NOT restore a blocking lock loop in any adjacent task.

M7-066 — Queue fsync does not explicitly fsync the parent directory after rename

Severity: P2
File: queue-manager.mjs:116+

Required behavior:

Decide whether current durability target requires directory fsync after atomic rename.

Document the durability guarantee rather than implying stronger persistence than implemented.

M7-067 — DecisionLedger uses direct overwrite instead of atomic write/rename

Severity: P2
File: decision-ledger.mjs:49-59

Required behavior:

Atomic temp write + fsync + rename, matching the stronger governance ledger durability pattern.

M7-068 — DecisionLedger lacks structural schema validation for stored decisions

Severity: P2
File: decision-ledger.mjs:33-47

Observed:

Parsed records are inserted if the top-level JSON is an array.

Required fields, scope enum, identity shape, and context linkage are not validated on load.

Required behavior:

Validate every stored decision against the canonical contract.

Bad record => quarantine/block, not silent acceptance.

M7-069 — WORKFLOW_SPAWN_RECEIVED can mutate/revive a run under a terminal task

Severity: P0
File: integrations/openclaw/topology/lib/workflow.mjs:423-453

Evidence:

The reducer validates delegation/session/agent lineage but does not reject the event when the task is already terminal.

Direct reproduction with workflow_status=COMPLETE, brief_state=CLOSED, and a SPAWN_UNKNOWN delegation accepted the receipt and changed the child run to RUNNING.

A delayed receipt can therefore mutate a closed task's execution lineage after completion.

Required behavior:

Terminal task => receipt is rejected or exact idempotent no-op with no mutation.

Cancelled/failed/superseded child run => late receipt cannot bind a new native run or session.

Current brief_revision must be part of the authoritative receipt lineage check.

Regression:

Inject late receipt into COMPLETE, FAILED, CANCELLED, REJECTED, and superseded-revision fixtures; assert snapshot is byte-equivalent before/after.

M7-070 — DecisionLedger silently overwrites an existing decisionId with different content

Severity: P1
File: integrations/openclaw/lib/decision-ledger.mjs:85-102

Evidence:

recordDecision() unconditionally executes this.decisions.set(id, record).

Direct reproduction recorded decisionId=D1 twice with different decisions; the second record replaced the first without conflict or revision history.

Atomic persistence would not solve this: the logical ID itself must be immutable.

Required behavior:

Same decisionId + byte-equivalent canonical record => exact idempotent replay.

Same decisionId + any material field difference => DECISION_ID_CONFLICT; original decision remains unchanged.

A replacement requires a new decision ID and explicit supersession metadata.

Regression:

identical replay; changed decision text; changed scope; changed confirmedBy; changed context/tags; verify original remains authoritative.

M7-071 — Missing Skill/Knowledge adapter falls back to a success-looking governed response

Severity: P1
File: integrations/openclaw/plugins/zink-governance/index.mjs:1181-1227,1299-1349,1433-1510

Evidence:

getSkillAdapter() / getKnowledgeAdapter() can return null after import failures.

zink_skill_search, zink_knowledge_search, and zink_skill_propose then return a payload with status: "governed" instead of an explicit unavailable/blocked outcome.

This is a false-success contract: the caller can interpret governance as available even though the backend operation did not execute.

Required behavior:

Adapter missing, malformed, or import-failed => BLOCKED/UNAVAILABLE, never governed success.

The response must identify the unavailable capability without exposing internal paths or exception content.

No fallback may fabricate result context.

Regression:

Mock adapter import failure for all three tools; assert deterministic blocked status and zero backend calls.

M7-072 — Workflow cancellation has a mutation seam without an explicit actor/source binding

Severity: P1
File: integrations/openclaw/topology/lib/workflow.mjs:214-225

Evidence:

WORKFLOW_CANCELLED accepts only task_id + reason_code.

The reducer itself does not carry or verify the authorized actor, channel, message/thread, or decision reference.

Because M7-002 identifies a raw event/write seam, a caller that can reach the reducer can manufacture a cancellation without proving the owner/parent authority.

Required behavior:

Cancellation event must carry the authoritative actor/decision provenance, or be reachable only through an already-authenticated command handler that emits a non-forgeable internal event.

The workflow reducer must enforce its internal-event trust boundary; public callers cannot use the same shape.

Regression:

Attempt owner cancel, parent cancel, specialist cancel, unauthenticated cancel, replay, and cancel-after-terminal; verify only explicitly authorized cases mutate state.

M7-073 — Queue rebuildFromLedger() can reconstruct an invalid coordinator identity

Severity: P1
File: integrations/openclaw/lib/queue-manager.mjs:613-625

Evidence:

Reconstruction sets primaryCoordinator: ledgerTask.root_agent_id || "o1".

The queue contract permits only o1/o2 coordinators for executable work, but this fallback can inject main or an arbitrary stale root-agent value into a queue item.

This creates a projection that looks executable but cannot satisfy the coordinator/assignment contract.

Required behavior:

Rebuild must validate root_agent_id against the canonical queue coordinator policy.

Invalid/missing assignment => explicit non-executable APPROVAL_PENDING/BLOCKED representation, not a guessed coordinator.

Regression:

missing coordinator; main; unknown string; valid o1; valid o2; verify no guessed executable assignment.

M7-074 — Queue rebuild loses execution lease/attempt fencing for an EXECUTING ledger task

Severity: P1
File: integrations/openclaw/lib/queue-manager.mjs:613-635

Evidence:

Reconstructed items force leaseId: null, attempt: 1, lastHeartbeatAt: null, and leaseExpiresAt: null even when the authoritative ledger task says execution has been claimed.

A restart/rebuild can therefore erase the generation/lease fence that protects against zombie completion.

Required behavior:

Rebuild must preserve authoritative claimed_by, attempt/generation and lease metadata, or deliberately transition the task through a documented stale-recovery state that revokes the old lease and increments the generation.

Never silently recreate an executing task with a fresh attempt 1.

Regression:

rebuild active executing task with attempt 3 + old lease; assert exact fence preservation or deterministic stale recovery; late old lease must be rejected.

6. Test-suite remediation — mandatory regression matrix

OpenCode MUST add behavioral tests for the following matrix before closing this ACTIVE:

Workflow state transition matrix

For every event below, test every invalid source state and every terminal state:

WORKFLOW_OPENED

WORKFLOW_USER_APPROVAL_DECIDED

WORKFLOW_BRIEF_ACTIVATED

WORKFLOW_SPAWN_RESERVED

WORKFLOW_SPAWN_RECEIVED

WORKFLOW_NATIVE_ENDED

WORKFLOW_TASK_CLAIMED

WORKFLOW_RESULT_RECORDED

WORKFLOW_ROOT_RESULT_RECORDED

WORKFLOW_USER_RESULT_ACCEPTED

WORKFLOW_USER_RESULT_REJECTED

WORKFLOW_RESULT_REVISION_REQUESTED

WORKFLOW_CONTINUATION_AUTHORIZED

WORKFLOW_CONTINUATION_STARTED

WORKFLOW_CANCELLED

WORKFLOW_USER_QUESTION_RECORDED

WORKFLOW_USER_ANSWER_RECORDED

The test must verify state + event log + sequence + lineage, not just returned values.

Replay/idempotency matrix

Test duplicates and conflicts for:

same event ID;

same task ID with same immutable payload;

same task ID with changed root run/session;

same task + attempt + delegation;

same result digest;

conflicting result digest;

approval replay;

result ACCEPT replay;

component callback replay;

process restart before replay.

Queue lifecycle matrix

Test:

QUEUED -> EXECUTING -> RESULT_PENDING_REVIEW -> COMPLETE

plus every invalid shortcut:

unapproved -> queued;

active -> executing;

executing -> complete;

terminal -> executing;

stale -> resurrected terminal task;

result-pending -> rejected without user decision;

queue state diverges from ledger;

queue file shrinks and reload occurs;

queue persistence fails halfway through mutation.

Identity matrix

For each governed action test:

valid owner;

wrong user;

missing user;

bot user;

wrong agent;

spoofed requesting_agent;

mismatched session key;

mismatched run ID;

mismatched thread/channel;

mismatched guild.

Tool authorization matrix

For each of these tools:

zink_excel

zink_power_bi

zink_sql

zink_python

zink_n8n

run the same logical call through every available tool-ingress path and assert identical policy behavior.

SQL safety matrix

At minimum:

SELECT;

SELECT + trailing semicolon;

multi-statement;

comments;

CTE/WITH;

UNION;

JOIN;

INSERT;

UPDATE;

DELETE;

DROP;

PRAGMA or other engine-specific escape forms if covered by the canonical SQL contract;

malformed SQL.

Persistence-failure matrix

Inject failures for:

main ledger append;

main snapshot write;

queue load;

queue save;

decision-ledger load;

decision-ledger save;

consumed-approval load/save;

registry checksum calculation;

schema contract loading;

artifact validation dependency;

SQL validator dependency;

n8n validator/adapter dependency.

Expected pattern: explicit BLOCKED/UNKNOWN or deterministic error, never fake success and never silent downgrade.

7. Required architecture cleanup

OpenCode must not fix each finding by adding another conditional branch to the plugin.

The intended end state is:

Canonical policy / contracts
        |
        v
Single authority resolver
        |
        +--> ingress authorization
        +--> workflow transition authorization
        +--> tool authorization
        +--> spawn authorization
        +--> result/review authorization
        |
        v
Single workflow reducer / event+projection commit
        |
        +--> Queue projection
        +--> Discord governance UI
        +--> OpenClaw native boundary

Specific architecture rules:

One policy source of truth. Do not keep independent matrices with overlapping authority.

One workflow lifecycle. External schemas may project the lifecycle, but must not invent a contradictory state set.

One semantic write path. Event persistence without reduction is prohibited.

Queue is a projection, not a second authority. Direct queue mutations must be removed or made wrappers around governed workflow events.

DecisionLedger is an authority component, not just a file store. The runtime clarification path must actually call it.

All live OpenClaw events converge on the canonical guard. Adapter code may normalize payload shape only.

Missing governance dependencies fail closed. No-op validator fallbacks are prohibited for mandatory controls.

Restart is part of correctness. Any in-memory replay fence must have a durable equivalent if it protects a governed operation.

8. Do NOT mark these as fixed unless the following evidence exists

A finding is CLOSED only when all applicable conditions are true:

implementation changed;

focused behavioral regression test added;

negative test exists for the bypass case;

state + event log + persistence outcome are asserted where applicable;

M7/M8 focused suites pass;

final suite runs under supported Node/npm;

DuckDB T4 runs with a real supported executable;

restart/replay behavior is tested for durable governance state;

no new duplicate authority path was introduced;

no source-only assertion is being used as the sole proof;

final diff does not contain secret material.

Do not use comments, changelog claims, coverage percentage, or “test count PASS” alone as closure evidence.

9. OpenCode execution protocol — NO BLOCKING DEPENDENCIES

The previous phase order is intentionally replaced. Do not execute this backlog as a dependency chain. A task MUST NOT be marked BLOCKED merely because another task has not been completed.

9.1 Task independence contract

Every remediation task in this ACTIVE is an independent work unit.

For every task, OpenCode MUST:

Start from the current repository state, not from an assumed previous task result.

Re-discover the current symbol/file location before editing; do not rely on stale line numbers.

State the invariant being repaired in one sentence.

Inspect the current implementation and current tests for that invariant.

Make the smallest complete fix for that invariant, including any local adapter/compatibility code needed because another task is not yet merged.

Add a focused behavioral regression test in the same task.

Run that focused test immediately.

Run the nearest existing M7/M8 suite relevant to the changed seam.

Record PASS, FAIL, or UNAVAILABLE with the exact command/result.

Never write BLOCKED: waiting for M7-xxx. If another task is unfinished, the current task must either:

complete independently against the current interface, or

introduce a temporary compatibility seam that is itself tested and can later be removed during consolidation.

Do not revert another task's valid fix merely to make the local test pass. Reconcile both invariants.

If two tasks discover the same root cause, consolidate the implementation but retain separate regression tests for both invariants.

9.2 What counts as a true blocker

Only external/environmental conditions may be UNAVAILABLE/BLOCKED, for example:

supported Node/npm runtime is unavailable;

required DuckDB executable is unavailable;

a required external OpenClaw process is intentionally not running;

a test requires credentials/secret material, which must not be inspected or fabricated;

a test requires a service explicitly outside the repository and cannot be replaced with a deterministic fixture.

A missing function, missing module, stale interface, failing previous task, or conflicting implementation is not an acceptable blocker. That is part of the current task's repair surface.

9.3 Parallel-safe remediation lanes

OpenCode may execute these lanes in any order. They are designed to have no hard dependency on completion of another lane.

Lane A — Workflow/Event Ledger

Owns only workflow state/event authority and its tests:

M7-001

M7-002

M7-013

M7-014

M7-015

M7-016

M7-040

M7-041

M7-042

M7-043

M7-044

M7-045

M7-046

M7-069

M7-072

Independent acceptance:

reducer behavior is correct when called directly;

event and snapshot remain consistent;

invalid source states are rejected;

replay/conflict behavior is deterministic.

This lane MUST NOT wait for QueueManager, DecisionLedger, Discord, or live OpenClaw fixes.

Lane B — Authority / Tool Gate

Owns authorization and live tool-ingress convergence:

M7-003

M7-004

M7-005

M7-006

M7-007

M7-008

M7-018

M7-049

M7-050

M7-071

M8-058

M8-059

M8-060

Independent acceptance:

every externally callable tool path reaches equivalent authorization;

missing validators fail closed;

caller identity is derived from trusted context;

canonical contract loading failure cannot silently allow execution.

This lane MUST NOT wait for workflow/queue fixes. Where workflow approval is not yet hardened, tests MUST use a deterministic governed fixture and assert the gate contract itself.

Lane C — Queue / Persistence

Owns queue projection, claim/lease/recovery and persistence durability:

M7-009

M7-010

M7-011

M7-012

M7-021

M7-024

M7-025

M7-026

M7-027

M7-028

M7-029

M7-030

M7-031

M7-032

M7-064

M7-065

M7-066

M7-073

M7-074

Independent acceptance:

QueueManager can be tested with a synthetic ledger snapshot/event fixture;

it never requires an unfinished DecisionLedger implementation to prove queue invariants;

persistence failure leaves a deterministic state rather than silent divergence.

Queue is treated as a projection. If the canonical workflow API is currently incomplete, the task must use the narrowest existing event/reducer seam or add a local adapter rather than waiting.

Lane D — Decision Ledger / Human Decision Authority

Owns decision storage, scope, principal validation and clarification lookup:

M7-017

M7-022

M7-023

M7-033

M7-034

M7-035

M7-036

M7-067

M7-068

M7-070

M8-061

M8-062

Independent acceptance:

malformed/corrupt storage is not interpreted as “no decision”;

decision queries are exact and scope-bound;

human principal is verified through trusted identity context;

save/load failures are explicit;

clarification lookup can be tested with a deterministic in-process fixture without Discord.

The runtime integration of this lane is separately verified in Lane E; Lane D itself must never wait for Discord/OpenClaw.

Lane E — Spawn / Native OpenClaw Boundary

Owns live native event paths and spawn governance:

M7-019

M7-020

M7-047

M7-048

M8-055

historical BUG-M8T2-05

historical BUG-M8T2-07

historical BUG-M8T2-11

Independent acceptance:

native events normalize into the same governed contract;

errors are not swallowed into apparent success;

self-session shortcuts cannot bypass governance;

spawn cannot escape its local authorization boundary.

This lane MUST use mocked/native adapter fixtures when the live OpenClaw process is unavailable. Live integration is additional evidence, not a prerequisite for the unit-level fix.

Lane F — Result / Artifact / Replay Integrity

Owns result identity, multi-artifact semantics, execution attempts and durable replay protection:

M8-051

M8-052

M8-053

M8-054

M8-056

M8-057

historical BUG-M8T2-01

historical BUG-M8T2-02

historical BUG-M8T2-04

historical BUG-M8T2-06

historical BUG-M8T2-09

historical BUG-M8T2-10

historical BUG-M8T2-12

Independent acceptance:

result correctness can be tested with synthetic artifacts;

current attempt/result identity is explicit;

restart/replay is tested without requiring a live Discord session;

no result event alone can manufacture user acceptance.

Lane G — Policy / State Contract Reconciliation

Owns duplicate declarations and contract drift:

M7-037

M7-038

M7-039

M7-063

plus any newly discovered duplicate authority declaration.

M7-040 is also protected by Lane A's behavioral lifecycle tests.

Independent acceptance:

exactly one canonical policy source exists for each authority decision;

derived projections are mechanically checked against canonical policy;

dormant policy files cannot be mistaken for runtime authority;

state names are reconciled or explicitly documented as external projections.

Lane H — Test Quality / Verification

Owns tests, not production behavior:

TEST-BASELINE-001

TEST-BASELINE-002

the complete regression matrix in §6

replacement of source-string assertions with behavioral assertions.

This lane can run before production fixes and should do so. Failing tests discovered here are evidence, not blockers to other lanes.

9.4 Required per-task format

Every task entry that OpenCode creates/updates in its execution ledger MUST contain:

TASK: <ID>
LANE: <A-H>
INVARIANT: <one sentence>
CURRENT_STATE: <what exists before the fix>
DEPENDENCIES: NONE   # unless an external/environmental dependency exists
CHANGE: <files/symbols changed>
REGRESSION: <focused behavioral test>
LOCAL_VERIFY: <command + result>
NEAREST_SUITE: <command + result>
STATUS: PASS | FAIL | UNAVAILABLE
FOLLOW_UP: <only if a separate invariant remains>

DEPENDENCIES: NONE means no earlier remediation task is required. Shared canonical contracts are repository inputs, not task dependencies.

9.5 Conflict-safe editing rule

If two lanes touch the same file, OpenCode MUST preserve both invariants. It must not resolve a merge/edit conflict by choosing one task and dropping the other.

Preferred pattern:

Keep public compatibility wrapper if needed.

Move common logic into one internal function.

Point both old and new callers to that function.

Add regression tests for both callers.

Remove the compatibility wrapper only during final consolidation after all callers are migrated.

This specifically applies to authority.mjs, guard.mjs, workflow.mjs, queue-manager.mjs, and plugins/zink-governance/index.mjs.

9.6 Historical findings are evidence, not duplicate tasks

Historical BUG-M8T2-* entries MUST NOT be executed as separate remediation tasks when a current M7/M8 task already owns the same invariant. They are traceability references only.

Ownership rule:

The current M7-*/M8-* task owns the implementation and regression test.

The historical finding is attached as evidence and must be re-verified by that task.

Do not implement the same fix twice under both IDs.

If the historical finding exposes a genuinely different invariant, create a new task with a new ID rather than silently expanding an existing task.

This prevents parallel lanes from editing the same seam twice and prevents a later task from being “blocked” because an earlier historical finding was handled differently.

9.7 Failure containment rule

A failing task must not poison unrelated tasks. OpenCode MUST:

leave the repository in a buildable/testable state after each task where technically possible;

never disable a failing test merely to unblock another task;

never weaken a policy or validator to accommodate an unfinished neighboring task;

if a temporary compatibility adapter is required, isolate it behind a named function and add a removal note;

report the failing invariant separately from environmental UNAVAILABLE conditions;

continue with independent lanes even when another lane has FAIL status.

A task may depend on a repository contract, but never on another task's completion.

9.8 Consolidation is the only intentional dependency point

There is exactly one final consolidation stage. It is NOT a prerequisite for any individual fix.

Consolidation MUST:

remove duplicate authority implementations created before canonicalization;

remove temporary compatibility adapters that are no longer needed;

regenerate derived policy projections;

run the complete regression matrix;

run restart/replay tests;

run supported-runtime integration tests.

If consolidation exposes a conflict, repair the conflict as a new task; do not mark unrelated remediation tasks blocked.

10. Final acceptance gate

The repository may be considered M7/M8 operationally ready only if all statements below are true:

No agent can bypass Main-only Discord ingress.

No agent can call a tool outside its canonical permission matrix.

No live tool path bypasses the canonical guard.

No spawn can happen without canonical approval/topology/lineage state.

No execution result can directly complete a task.

No result ACCEPT can complete a task without binding to the current authoritative result.

No stale/foreign attempt can mutate current workflow state.

No queue item can become executable merely because it exists in a queue file.

Queue state cannot silently diverge from ledger authority.

Corrupt/missing governance persistence cannot turn into fake success or “empty history.”

Decision scope cannot leak from task-specific to global.

A process restart cannot erase a governance-critical replay fence.

All 7 agent identities and all callable tools have one canonical authorization matrix.

All M7/M8 tests that claim governance invariants are behavioral.

Full supported-runtime validation is green.

No source file contains an M7 lock wait loop (Atomics.wait) on the live QueueManager/ledger/guard paths.

Any external dependency unavailable at runtime is represented explicitly as BLOCKED/UNAVAILABLE, never as success.

End state: one canonical authority, one workflow lifecycle, one event+projection commit path, durable governance state, and behavioral tests proving every bypass boundary is closed.