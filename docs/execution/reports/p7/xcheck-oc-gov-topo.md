# Phase 7 Cross-Module Recheck Report — OpenClaw Governance <-> Topology/Orchestration

- **Boundary:** OpenClaw Governance (plugin + library) <-> Topology / Orchestration
- **Focus:** Spawn authorization vs production graph; task/run identity and state transitions; serialized writes and locking
- **Mode:** Recheck (Phase 7)
- **Target Finding IDs:** `F-OC-004`, `F-OC-005`, `F-OC-006`
- **Reference Reports:** `docs/execution/reports/p2/xcheck-oc-gov-topo.md`, `docs/execution/reports/p6/scan-oc-3.md`, `docs/execution/reports/p6/scan-oc-4.md`, `docs/execution/findings.md:2187-2228`

---

## 1. Finding Rechecks

### F-OC-004 — Shared file-lock release can delete a replacement holder's lock after token check

- **Category:** F3 — State & Lifecycle Integrity
- **Severity:** High
- **Verdict:** **FIXED**

#### Evidence & Verification
- **Code fix (`integrations/openclaw/lib/file-lock.mjs:220-234, 285-288, 321-324`)**:
  - `removalRound(dir, expectedToken)` re-reads `owner.json` on disk immediately prior to unlinking/removing the directory.
  - If `recorded?.token !== expectedToken`, it returns `{ refused: true }`.
  - `release` / `releaseAsync` detects `round.refused`, deletes in-memory token map entries, and throws `FILE_LOCK_NOT_OWNER`.
- **Cross-Boundary & Blast Radius Check**:
  - `file-lock.mjs` is the shared serialization primitive for DecisionLedger (`decision-ledger.mjs`), QueueManager (`queue-manager.mjs`), Topology Ledger (`topology/lib/ledger.mjs`), and Skill Store Catalog (`zink-skill-store/src/catalog.mjs`).
  - Re-reading and validating token immediately before `unlinkSync`/`rmdirSync` prevents stale release callers from unlinking a replacement holder's lock file or directory, protecting critical sections across both Governance and Topology modules.
  - Packaged asset admission SHA pin in `integrations/openclaw/configure.mjs` and test assertion in `tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs` were updated in commit `f5bf41a`.
- **Test Evidence**:
  - `tests/m10-t2-r18-file-lock.test.mjs` (8/8 passed), including test `R18-08: a stale holder cannot release the next holder's lock` which explicitly verifies that a stale holder receives `FILE_LOCK_NOT_OWNER` and does not delete the replacement lock.

---

### F-OC-005 — Concurrent conflicting DecisionLedger writes overwrite same deterministic ID under writer lock

- **Category:** F5 — Data Integrity & Result Correctness
- **Severity:** Medium
- **Verdict:** **FIXED**

#### Evidence & Verification
- **Code fix (`integrations/openclaw/lib/decision-ledger.mjs:446-463`)**:
  - Inside `DecisionLedger.save()` under `withFileLockSync`, after re-reading durable records from disk (`readDurableEntries()`), the ledger compares existing records with incoming records by deterministic ID.
  - If an existing record is present and `canonicalRecordBytes(existing) !== canonicalRecordBytes(record)`, `save()` throws `DECISION_ID_CONFLICT` via `failLedger("DECISION_ID_CONFLICT")`, preserving the existing on-disk record.
- **Cross-Boundary & Blast Radius Check**:
  - OpenClaw Governance plugin handles owner confirmation via `handleOwnerDecisionConfirmation` (`index.mjs:1671`), writing to `decision-ledger.json`.
  - Placing conflict validation inside `DecisionLedger.save` under the file lock ensures concurrent writers or multiple process instances cannot silently overwrite differing decisions for the same question/topic/scope identity.
  - The owner-only gate at `index.mjs:1597-1602` and decision classifications at `:1613-1632` remain untouched.
- **Test Evidence**:
  - `tests/m12-t9-r4-decision-replay-order.test.mjs` (4/4 passed), including test `F-OC-005: concurrent conflicting DecisionLedger save under writer lock is refused with DECISION_ID_CONFLICT`.

---

### F-OC-006 — Concurrent ingress can persist two task IDs for one origin and make shared run identity ambiguous

- **Category:** F3 — State & Lifecycle Integrity
- **Severity:** Medium
- **Verdict:** **FIXED** (Code verified; register row documentation update pending)

#### Evidence & Verification
- **Code fix (`integrations/openclaw/topology/lib/workflow.mjs:645-653`)**:
  - Inside the topology event reducer for `WORKFLOW_OPENED`, before adding a new task ID to `next.tasks`, the reducer iterates over existing tasks (`Object.values(next.tasks)`).
  - If another task already matches the origin tuple (`origin`, `origin_principal_ref`, `origin_message_id`), it throws `ORIGIN_BINDING_CONFLICT`.
  - Same-task ID replay with identical lineage remains idempotent (`workflow.mjs:631-643`).
- **Cross-Boundary & Blast Radius Check**:
  - OpenClaw Governance plugin ingress (`index.mjs:9535-9555`) mints task IDs and records `WORKFLOW_OPENED` events via the topology ledger.
  - Enforcing origin uniqueness inside the topology reducer ensures that topology state remains the sole authoritative source of truth for workflow state and task bindings (`docs/contracts/coordinator-session-binding.md`).
  - The fix is strictly contained within the reducer, preventing ambiguous `findSession` lookups without modifying spawn policies (`AGENT_SPAWN_POLICY`), dispatch targets, or plugin ingress handlers.
- **Test Evidence**:
  - `integrations/openclaw/topology/lib/workflow-origin-uniqueness.test.mjs` (2/2 passed), verifying idempotency for same task ID replay and `ORIGIN_BINDING_CONFLICT` for duplicate origin bindings under a different task ID.

---

## 2. Cross-Boundary Integration & Boundary Verification

### 2.1 Spawn Authorization vs Production Graph
- **Policy Alignment**: `AGENT_SPAWN_POLICY` in `integrations/openclaw/lib/policy.mjs:815-833` (`main -> [o1, o2]`, `o1 -> [excel, sql, python]`, `o2 -> [power-bi, python]`) is consistently respected by `deriveGovernedDispatchTarget` (`policy.mjs:926-947`), topology guard (`topology/lib/guard.mjs:1696-1704`), and plugin session spawn adapter (`plugins/zink-governance/index.mjs:8801-8810`).
- No drift or contract shape violation was introduced between Governance spawn authorization and Topology dispatch targets.

### 2.2 Task Identity & State Transitions
- **Monotonic State Transitions**: `WORKFLOW_OPENED` event processing in Topology reducer enforces task ID lineage equality on replay and origin binding uniqueness on new task creation (`workflow.mjs:631-653`).
- **Resolution Safety**: `findSession` resolution relies on unambiguous task-to-session mappings; preventing duplicate task creation per origin binding guarantees `findSession` does not throw `EXECUTION_STATE_UNKNOWN` due to duplicate task records.

### 2.3 Error Semantics & Ownership Leaks
- **Error Enums**:
  - `FILE_LOCK_NOT_OWNER` is consistently thrown on lock release token mismatch.
  - `DECISION_ID_CONFLICT` is consistently thrown on DecisionLedger conflicting writes.
  - `ORIGIN_BINDING_CONFLICT` is consistently thrown by topology reducer on origin collision.
- **Ownership Isolation**:
  - Neither Governance plugin nor Topology library mutates private state of the other directly.
  - Shared lock primitive in `file-lock.mjs` operates cleanly across both modules and Zink Skill Store without leaking ownership assumptions.

### 2.4 Standalone Module Operation
- **OpenClaw Governance**: Operates standalone with verified decision ledger conflict protection and file lock compare-and-remove semantics.
- **Topology / Orchestration**: Operates standalone with verified workflow origin binding uniqueness in reducer and atomic ledger write serialization.

---

## 3. Summary & Conclusion

| Finding ID | Category | Severity | Verdict | Cross-Module Impact | Standalone Impact |
| --- | --- | --- | --- | --- | --- |
| `F-OC-004` | F3 | High | **FIXED** | Lock release compare-and-remove protects critical sections across Governance, Topology, and Skill Store | Standalone lock operations correctly reject stale token releases |
| `F-OC-005` | F5 | Medium | **FIXED** | DecisionLedger `save` revalidates under writer lock, preventing multi-process decision overwrites | DecisionLedger standalone writes correctly enforce `DECISION_ID_CONFLICT` |
| `F-OC-006` | F3 | Medium | **FIXED** | Topology reducer enforces origin-binding uniqueness, preserving `findSession` identity resolution for Governance ingress | Topology reducer standalone event application rejects duplicate origin bindings |

- **Total findings rechecked:** 3
- **Fixed:** 3 (`F-OC-004`, `F-OC-005`, `F-OC-006`)
- **Partial:** 0
- **Not Fixed:** 0
- **Blockers:** None across the OpenClaw Governance <-> Topology/Orchestration boundary.
