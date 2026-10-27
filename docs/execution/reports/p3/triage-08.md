# Phase 3 triage — bucket 08 (loop 1)

- **Scope:** F-OC-005 and F-OC-006; independent adversarial re-read of register evidence, Phase 2 reachability conclusions, production callers, state writers, relevant contracts and tests.
- **Baseline:** coordinated-run baseline is HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a` on `codex/m11-t1-audit-remediation`, with pre-existing dirty worktree (`docs/execution/context.md:21`). Source lines below were re-opened in the working tree. No source was edited and no tests/runtime probes were run.
- **Disposition counts:** CONFIRMED-AS-LATENT 2. Severity: Medium 1, High 1, Low 0, root-cause 0. Other verdicts: 0. Blockers: no in-repository production evidence for a multi-process writer or an external owner-confirmation caller; live multi-process behavior not probed.

---

## F-OC-005 — concurrent conflicting DecisionLedger writes overwrite the same deterministic ID under the writer lock

**Verdict: CONFIRMED-AS-LATENT.** The data-integrity defect in `save()` is real, but the production firing path still requires a second process writing the same configured file; no such caller/topology is established in this repository.

### Adversarial verification

- The key premise survives. `recordDecision()` refreshes and checks `this.decisions` before calling `save()` (`integrations/openclaw/lib/decision-ledger.mjs:579-638`). The default deterministic ID depends on topic, question, scope, and applicable task/domain identity, not decision text (`:596-607`).
- `save()` does acquire the writer lock and reread the durable entries inside it (`decision-ledger.mjs:436-448`), but this is only a merge. Its loop unconditionally performs `durable.set(id, record)` (`:449-450`); there is no same-ID/different-content conflict check under lock. Thus two processes can each refresh an empty map, stage different answers for the same deterministic ID, and serialize saves in which the later record silently replaces the earlier one. The resulting success violates `docs/contracts/decision-ledger.md:44-55`, which requires `DECISION_ID_CONFLICT` for a different decision and at most one active decision per governed key.
- Same-process async handler overlap does not establish that race: the production write segment from `recordDecision()` through synchronous `save()` has no `await`, so one Node event loop completes the read/check/lock/write sequence before another invocation can enter it. A competing process remains necessary for stale independently refreshed instances.
- Production caller search: the only production `recordDecision()` invocation is `index.mjs:1671`, inside exported `handleOwnerDecisionConfirmation` (`:1589-1596`). The function itself is asynchronous around dynamic imports and writes after them (`:1606-1646`), but repository-wide production source contains no call to that export; tests call it. The registered `ASK_USER` path reads the ledger and does not call `recordDecision` (Phase 2 trace `docs/execution/reports/p2/xcheck-oc-gov-topo.md:39`). No external caller is evidenced in repository code/config.
- The configured governance root is explicit and shared by the stores in one plugin registration (`index.mjs:6132-6153`; `integrations/openclaw/lib/policy.mjs:1529-1541`). Deployment docs describe one named `openclaw-gateway-zink.service` (`integrations/openclaw/README.md:277-284`) and require no default gateway on the same port/state (`:322-327`). These establish a single-service deployment shape, not a hard prohibition against a second process sharing storage. Repository comments also acknowledge cross-process limits for other operations (`index.mjs:3357-3380`), but they do not evidence a second production gateway writer for this store.
- Tests do not refute the mechanism: `tests/m7-lane-d-decision.test.mjs:84-113` tests sequential explicit-ID conflicts; `tests/agent-lib-F-002.test.mjs:109-140` tests different IDs; `tests/m12-t9-r4-decision-replay-order.test.mjs:62-78` tests sequential changed-content conflict. None exercises stale same-ID instances.

### Classification and routing

- **Type:** F5 — Data Integrity & Result Correctness (`docs/execution/findings.md:51-66`); the durable active decision can be overwritten contrary to the contract.
- **Severity:** Medium — conditional cross-process conflict can replace the authoritative answer while reporting success; no production multi-writer route is evidenced, so High is unsupported.
- **root_cause_of:** none. **depends_on:** none.
- **Duplicate check:** Not `DUPLICATE-OF` F-404 (`findings.md:668-679`), which is key-order-sensitive replay equality, not stale-writer conflict detection. Not F-433 (`:915-926`), which is lock recovery's read/delete race. F-393–F-398 (`:525-601`) concern workflow result/outcome state and do not share this decision-ledger mechanism.
- **RED:** NO — rechecking the durable record under the existing lock would enforce the current decision-ledger contract (`decision-ledger.md:48,55`) and preserve its documented state semantics; it should retain explicit correction/supersession behavior. No schema, API or topology change is needed.
- **Fixer / files:** `fix-openclaw-governance-library`; `integrations/openclaw/lib/decision-ledger.mjs` and a regression in `tests/m12-t9-r4-decision-replay-order.test.mjs` (or a dedicated decision-ledger concurrency test). Regression should instantiate two stale ledgers, stage differing decisions for the same deterministic key, save sequentially under the lock, and assert the second gets `DECISION_ID_CONFLICT` while the original durable record remains. Coordinate the test-file write with the test owner if assigned separately.

---

## F-OC-006 — concurrent ingress can persist two task IDs for one origin and make their shared run identity ambiguous

**Verdict: CONFIRMED-AS-LATENT.** The reducer invariant gap is real. The proposed same-process ingress race is refuted; a cross-process stale-precheck race is possible in code but no multi-gateway/shared-root production topology is evidenced.

### Adversarial verification

- **Synchronous Discord ingress confirmed.** `beforeRun` is declared async, but the Discord branch directly calls `authenticateIngress(context)` without `await` at `integrations/openclaw/plugins/zink-governance/index.mjs:8017,8071-8088`. `authenticateIngress` is an ordinary synchronous function (`:9399`). From origin lookup (`:9535-9543`), ID mint (`:9544-9556`), duplicate/fallback decision (`:9560-9602`) through `recordWorkflowEvent()` append (`:9619-9626`), this branch has no `await` or other event-loop yield. ID generation and the snapshot reads are synchronous calls.
- `recordWorkflowEvent()` is itself synchronous and holds the writer lock around rereading the snapshot, applying the reducer and appending (`integrations/openclaw/topology/lib/ledger.mjs:1503-1508,1973-2004`). Its serialization prevents concurrent reducer commits, but it cannot repair the earlier plugin precheck if a second process has independently read the old snapshot.
- Model fallback is not an in-call suspension/retry window: a later same-run re-entry finds the already-open task and returns `modelFallbackReentry` without appending another `WORKFLOW_OPENED` (`index.mjs:9562-9590`). Genuine duplicate delivery that finds the task is denied (`:9591-9602`). The non-Discord path's `await awaitSpawnReceipt(...)` at `:8088` is a different branch and occurs instead of Discord ingress; later model resolution awaits happen after `authenticateIngress` returns. No async, retry or model-fallback path makes two same-process Discord handlers interleave between lookup and append.
- **Reducer gap confirmed.** The `WORKFLOW_OPENED` reducer checks lineage only when the incoming `task_id` already exists (`integrations/openclaw/topology/lib/workflow.mjs:631-643`). A distinct task ID is inserted without checking whether another task has the same origin binding (`:645-655`). The lock serializes, but accepts, a second distinct-ID origin. Later `findSession()` collects owners across tasks and throws `EXECUTION_STATE_UNKNOWN` unless exactly one matches (`workflow.mjs:323-358`).
- Consequently, two processes sharing the same root could both read no origin binding, mint distinct IDs, and append in sequence; the second event reaches the reducer after the first and still passes because its ID differs. No repository deployment config establishes multiple gateway services writing the same root: setup documents one named service and no default gateway on the same port/state (`integrations/openclaw/README.md:277-284,322-327`). This is not evidence that a second process is impossible, so retain the conditional mechanism as latent rather than refuting the reducer defect.
- Sequential tests cover a later delivery, not stale concurrent prechecks: `tests/m10-t2-r9-duplicate-runid-observability.test.mjs:188-203` completes the first native run before delivering the second; `tests/m12-t1-task-identity.test.mjs:385-434` tests origin lookup but not two `WORKFLOW_OPENED` events with distinct IDs and the same binding. The candidate's deterministic reducer reproduction remains unrun in this triage.

### Classification and routing

- **Type:** F3 — State & Lifecycle Integrity (`findings.md:51-66`); a duplicate persisted task makes session/run ownership ambiguous.
- **Severity:** Medium — a cross-process writer race can create ambiguous authoritative state and block resolution, but the required production topology is not evidenced. The register's High grade assumes the unproven firing path.
- **root_cause_of:** none. **depends_on:** none.
- **Duplicate check:** Not `DUPLICATE-OF` F-393–F-398 (`findings.md:525-601`), which concern result outcome, surface/verdict bindings and freshness. F-531/F-532 and F-404/F-433 are also separate seams; none enforces origin uniqueness for `WORKFLOW_OPENED`.
- **RED:** YES — adding origin uniqueness in the reducer changes which `WORKFLOW_OPENED` events can be durably accepted/replayed, so it changes durable state semantics and requires the owner decision under AGENTS.md §7. The existing task-ID replay rule must remain intact; the smallest candidate change is a reducer-level duplicate-origin refusal or idempotent resolution, with its event/replay contract decided before implementation.
- **Fixer / files:** `fix-openclaw-topology`; `integrations/openclaw/topology/lib/workflow.mjs` and a reducer regression in `tests/m12-t1-task-identity.test.mjs` (or a dedicated workflow-reducer test). The regression should apply two valid `WORKFLOW_OPENED` events with distinct task IDs and identical origin/principal/message/root identity, then prove the second is rejected or resolves to the existing owner and that `findSession()` remains unique. No plugin precheck change alone addresses the reducer invariant. Coordinate the test-file write with the test owner if assigned separately.

---

## Checks / limits

- Re-read the assigned register blocks, Phase 2 governance/topology report, Phase 2 tests cross-check, relevant production caller/writer code, decision-ledger contract, deployment docs, and related findings/tests cited above.
- Tests and runtime probes: **Not run**; this was a read-only static triage.
- Files changed: only `docs/execution/reports/p3/triage-08.md`.
