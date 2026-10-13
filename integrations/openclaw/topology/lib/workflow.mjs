import {
  buildSpawnProposal,
  canonicalHash,
  deriveTaskId,
  isTaskCodeForm,
  TASK_CODE_LENGTH,
  TASK_CODE_PATTERN,
  TASK_ID_PATTERN,
} from "./canonical.mjs";
import { validateContract } from "./schema.mjs";
import { outcomeReasonAllowed, workflowAggregate } from "./runtime.mjs";
import { AGENT_STACK_POLICY } from "../../lib/authority.mjs";

// D11-D13: roles must match canonical AGENT_SPAWN_POLICY in policy.mjs.
// main coordinates only through o1/o2; specialists have no spawn targets.
// o1 owns ETL layer: excel/sql/python. o2 owns analytics layer: power-bi/python.
const roles = {
  main: ["o1", "o2"],
  o1: ["excel", "sql", "python"],
  o2: ["power-bi", "python"],
  excel: [],
  "power-bi": [],
  sql: [],
  python: [],
};
const terminal = new Set([
  "COMPLETE",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
  "REJECTED",
]);
// D05: BLOCKED is not an active run — blocked runs must not count as active
// for prerequisite checks (would cause deadlock). BLOCKED requires recovery.
const activeRun = new Set(["PENDING", "SPAWN_UNKNOWN", "RUNNING", "UNKNOWN"]);
// M8-056: the documented transient-failure class. Only these reasons justify a
// retry; every other failure class has no automatic or operator retry path.
const TRANSIENT_FAILURE_CLASS = new Set([
  "TRANSIENT_RUNTIME_FAILURE",
  "RUN_TIMEOUT",
]);
// Pre-verdict-model root-result resolution (option b migration 2026-09-29).
// The operational ledger's root results were journaled while the reducer
// resolved a root result DIRECTLY to its recorded outcome; the owner-verdict
// model (RESULT_PENDING_REVIEW, so the owner's verdict is what closes the task)
// was introduced in m8-t2.2-r4, after that history was written. A single
// event's governance_version stamp cannot discriminate the two eras: the
// live Sep-24/28 writer stamped its events m8-t2.2-r4 while still using direct
// resolution, so seq 26 is r4-stamped yet pre-verdict. An event's own fields
// cannot discriminate either, since that means re-deriving the resolution from
// the very fields being resolved, and the snapshot cannot be consulted because
// it is the value being verified (circular). The JOURNAL as a whole can: a
// journal carrying any pre-R4-stamped event is a legacy-era journal, because
// those stamps are sealed into the digest chain. The verifier derives that
// declaration from the event stream and passes it down, so the resolution is
// chosen from evidence outside the compared value. The deployed build's reducer
// (which reads this ledger 37/37) implements exactly the pre-verdict resolution.
function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function requireCondition(value, code = "INVALID_STATE_TRANSITION") {
  if (!value) fail(code);
}
function exactKeys(value, required, optional = []) {
  requireCondition(
    value && typeof value === "object" && !Array.isArray(value),
    "SCHEMA_INVALID",
  );
  requireCondition(
    required.every((key) => Object.hasOwn(value, key)) &&
      Object.keys(value).every((key) =>
        [...required, ...optional].includes(key),
      ),
    "SCHEMA_INVALID",
  );
}
function identifier(value) {
  requireCondition(
    typeof value === "string" && value.length > 0 && value.length <= 256,
    "LINEAGE_MISMATCH",
  );
}
function digest(value) {
  requireCondition(
    typeof value === "string" && /^[a-f0-9]{64}$/u.test(value),
    "SCHEMA_INVALID",
  );
}
// M12/T1-R1: a task identity is either the 64-hex id the live ledger was built
// with or the 12-character code the owner made authoritative. Readers must accept
// both or the existing events stop replaying; only the new shape is ever minted.
function taskIdentity(value) {
  requireCondition(
    typeof value === "string" && new RegExp(TASK_ID_PATTERN, "u").test(value),
    "SCHEMA_INVALID",
  );
}

export function findSession(
  snapshot,
  sessionKey,
  runId,
  includePrevious = false,
) {
  const matches = [];
  for (const [task_id, task] of Object.entries(snapshot.tasks)) {
    if (
      task.root_session_key === sessionKey &&
      (task.root_run_id === runId ||
        (includePrevious && (task.previous_root_run_ids ?? []).includes(runId)))
    )
      matches.push({ task_id, task });
    for (const delegation of Object.values(task.delegations ?? {}))
      if (
        delegation.child_session_key === sessionKey &&
        (delegation.native_run_id === runId ||
          (includePrevious &&
            (delegation.previous_native_run_ids ?? []).includes(runId)))
      )
        matches.push({ task_id, task, delegation });
    // M10/T2: bound coordinator runs resolve as a THIRD owner shape carrying
    // coordinatorRun and deliberately NO delegation object. Consumers must
    // handle this shape explicitly: falling back to
    // `owner.delegation?.X ?? task.root_Y` would silently authorize a bound
    // coordinator as Main/root, which is never correct.
    for (const coordinatorRun of Object.values(task.coordinator_runs ?? {}))
      if (
        coordinatorRun.session_key === sessionKey &&
        coordinatorRun.run_id === runId
      )
        matches.push({ task_id, task, coordinatorRun });
  }
  requireCondition(matches.length === 1, "EXECUTION_STATE_UNKNOWN");
  return matches[0];
}

/**
 * M10/T2: resolve a gateway-started coordinator run to its ledger binding
 * without requiring delegation lineage. Returns `{ task_id, task,
 * coordinatorRun }` when exactly one binding matches the session/run pair and
 * the bound coordinator equals the observed agent; otherwise null. Unlike
 * findSession, this never throws: hook call sites use it as a recognition
 * probe before deciding between the bound-run path and the existing
 * fail-closed behavior. The agent check is part of recognition (not left to
 * callers) so a session key alone can never attribute one coordinator's run
 * to another agent.
 */
export function findBoundCoordinatorRun(snapshot, sessionKey, runId, agentId) {
  if (
    typeof sessionKey !== "string" ||
    typeof runId !== "string" ||
    typeof agentId !== "string"
  ) {
    return null;
  }
  let matched = null;
  for (const [task_id, task] of Object.entries(snapshot?.tasks ?? {})) {
    for (const coordinatorRun of Object.values(task.coordinator_runs ?? {})) {
      if (
        coordinatorRun.session_key === sessionKey &&
        coordinatorRun.run_id === runId &&
        coordinatorRun.coordinator === agentId
      ) {
        if (matched) return null;
        matched = { task_id, task, coordinatorRun };
      }
    }
  }
  return matched;
}

// D07: ownerRunIds returns only the current run ID by default to prevent
// generation-skip lineage matching. Pass includePrevious=true only when
// explicit continuation history traversal is authorized (findSession does so).
//
// M10/T2: a bound coordinator run is identified by its own gateway-issued
// run_id. It has no previous run identities: attempt isolation means a stale
// run's identity must never satisfy a newer attempt, so there is deliberately
// no previous_native_run_ids list for bindings.
export function ownerRunIds(owner, includePrevious = true) {
  if (!owner.delegation && owner.coordinatorRun) {
    return [owner.coordinatorRun.run_id];
  }
  if (owner.delegation) {
    return includePrevious
      ? [
          owner.delegation.native_run_id,
          ...(owner.delegation.previous_native_run_ids ?? []),
        ]
      : [owner.delegation.native_run_id];
  }
  return includePrevious
    ? [owner.task.root_run_id, ...(owner.task.previous_root_run_ids ?? [])]
    : [owner.task.root_run_id];
}

// M8-056: every node/attempt tuple is single-use, so an attempt is superseded
// the moment a higher attempt exists for the same node and brief revision.
// A late callback from a superseded attempt must not mutate current task state:
// it can neither revive the run, nor mark it complete, nor block the live
// attempt by forcing the task out of its current state.
function isSupersededAttempt(task, run) {
  if (!run) return false;
  return Object.values(task.delegations ?? {}).some(
    (other) =>
      other !== run &&
      other.node_id === run.node_id &&
      other.brief_revision === run.brief_revision &&
      Number(other.attempt) > Number(run.attempt),
  );
}

// M7-041: the agent that owns a run identity. A run is owned by exactly one
// agent, so an event claiming a different agent_id is a lineage violation, not
// a presentation detail.
function ownerRunAgentId(owner, task) {
  return owner.delegation ? owner.delegation.agent_id : task.root_agent_id;
}

// M7-041: the canonical current run owner of a task. Exactly one run may be
// live at a time: the single RUNNING delegation, otherwise the root run. Any
// caller that must name the governing run takes it from here rather than from
// caller-controlled data, and the reducer re-derives the same value.
export function resolveCurrentRunOwner(task) {
  const running = Object.values(task.delegations ?? {}).filter(
    (run) => run.run_state === "RUNNING",
  );
  if (running.length > 1) {
    fail("LINEAGE_MISMATCH");
  }
  if (running.length === 1) {
    const run = running[0];
    return {
      agent_id: run.agent_id,
      session_key: run.child_session_key,
      run_id: run.native_run_id,
      attempt: run.attempt,
    };
  }
  return {
    agent_id: task.root_agent_id,
    session_key: task.root_session_key,
    run_id: task.root_run_id,
    attempt: null,
  };
}

// Pure projection of metadata-only, trusted events. No model output or prompt
// body belongs here; the guard validates semantic work before emitting events.
//
// `options.replayAnchored` is READ-VERIFICATION ONLY (option b of the 2026-09-29
// live-ledger migration): when the canonical reader replays events already
// incorporated into operator-accepted snapshot state (sequence at or below the
// snapshot head), admission-policy preconditions are trusted rather than
// re-litigated. Every event entered the journal through the strict writer path
// under contemporary policy, so re-litigating evolved policy against history
// can only reject legitimate operations — it cannot catch anything the strict
// admission did not already govern. Structure, shapes, digests, chain linkage,
// budget accounting, and the end-state hash compare all still apply; new tail
// events and all writes stay fully strict. There is exactly one lenient caller
// (the anchored loop in readSnapshotLocked); every other caller uses the
// strict default.
export function applyWorkflowEvent(
  snapshot,
  type,
  payload,
  eventTimestamp = null,
  options = null,
) {
  const replayAnchored = options?.replayAnchored === true;
  // Only ever set by the anchored replay loop, and only when the journal
  // declares a pre-R4 era (see PRE_VERDICT_ROOT_RESULT). A caller supplying it
  // on a write is ignored: `replayAnchored` is required for it to be read.
  const preVerdictRootResult =
    replayAnchored && options?.preVerdictRootResult === true;
  const next = globalThis.structuredClone(snapshot);
  const eventTime = eventTimestamp || new Date().toISOString();
  if (type === "WORKFLOW_OPENED") {
    exactKeys(
      payload,
      [
        "task_id",
        "origin",
        "origin_principal_ref",
        "origin_message_id",
        "root_agent_id",
        "root_session_key",
        "root_run_id",
      ],
      // M10/T2-R12: the owner-facing task code, OPTIONAL on purpose — the 48 tasks
      // already in the live ledger predate it, and replaying them must stay
      // byte-identical, so a task without a code is valid and simply has none.
      // Passing this as a REQUIRED key rejects every pre-existing event.
      ["task_code"],
    );
    requireCondition(payload.origin === "discord", "POLICY_DENIED");
    requireCondition(
      /^[1-9][0-9]{16,19}$/u.test(payload.origin_message_id) &&
        typeof payload.origin_message_id === "string",
      "SCHEMA_INVALID",
    );
    digest(payload.origin_principal_ref);
    taskIdentity(payload.task_id);
    identifier(payload.root_run_id);
    identifier(payload.root_session_key);
    requireCondition(
      Object.hasOwn(roles, payload.root_agent_id),
      "UNAUTHORIZED_TARGET",
    );
    // M12/T1-R1: a legacy 64-hex identity is re-derivable from its origin binding,
    // so re-deriving it here is what proves a pre-existing record was not tampered
    // with. The 12-character identity is minted at admission and is deliberately
    // NOT a function of the message, so for it the binding fields themselves are the
    // integrity check — they are the values replay protection now reads.
    if (/^[a-f0-9]{64}$/u.test(payload.task_id)) {
      requireCondition(
        deriveTaskId(payload) === payload.task_id,
        "LINEAGE_MISMATCH",
      );
    }
    // M10/T2-R12: when a code IS supplied it must be exactly the ruled 12
    // characters. Absent is allowed (legacy task); malformed is never allowed,
    // because a code the owner is told to type must never be ambiguous.
    if (payload.task_code !== undefined) {
      requireCondition(
        typeof payload.task_code === "string" &&
          payload.task_code.length === TASK_CODE_LENGTH &&
          new RegExp(TASK_CODE_PATTERN, "u").test(payload.task_code),
        "SCHEMA_INVALID",
      );
      // Two live tasks must never share a code, or an owner approval could be
      // attributed to the wrong task. Checked against every OTHER task.
      requireCondition(
        !Object.entries(next.tasks).some(
          ([otherId, other]) =>
            otherId !== payload.task_id &&
            other.task_code === payload.task_code,
        ),
        "SCHEMA_INVALID",
      );
      // M12/T1-R1: once the code IS the identity, a task must not carry a second
      // owner-visible token. Legacy 64-hex tasks keep an alias, because for them
      // the code and the authority key are genuinely different values.
      requireCondition(
        !isTaskCodeForm(payload.task_id) ||
          payload.task_code === payload.task_id,
        "SCHEMA_INVALID",
      );
    }
    if (Object.hasOwn(next.tasks, payload.task_id)) {
      const existing = next.tasks[payload.task_id];
      const sameLineage =
        existing.origin === payload.origin &&
        existing.origin_principal_ref === payload.origin_principal_ref &&
        existing.origin_message_id === payload.origin_message_id &&
        existing.root_agent_id === payload.root_agent_id &&
        existing.root_session_key === payload.root_session_key &&
        existing.root_run_id === payload.root_run_id;
      requireCondition(sameLineage, "LINEAGE_MISMATCH");
      // A re-delivered OPEN must not rewrite the code: the first writer owns it.
      // Replaying the same lineage keeps the existing task byte-identical.
      return next;
    }
    next.tasks[payload.task_id] = {
      ...payload,
      revisions_used: 1,
      transitions_used: 0,
      delegated_runs_used: 0,
      brief_revision: 1,
      brief_state: "ACTIVE",
      workflow_status: "ACTIVE",
      nodes: [],
      delegations: {},
    };
    return next;
  }
  taskIdentity(payload.task_id);
  const task = next.tasks[payload.task_id];
  requireCondition(
    task?.workflow_status && task.brief_state,
    "EXECUTION_STATE_UNKNOWN",
  );
  if (type === "WORKFLOW_NATIVE_ENDED") {
    // M7-044: recorded_at is an optional observed timestamp. When present it
    // must be a valid ISO instant; otherwise the canonical event timestamp
    // applies. Synthetic 1970 fallbacks are prohibited.
    exactKeys(
      payload,
      [
        "task_id",
        "native_run_id",
        "child_session_key",
        "parent_session_key",
        "outcome",
      ],
      ["recorded_at"],
    );
    const matches = Object.values(task.delegations).filter(
      (run) =>
        run.native_run_id === payload.native_run_id &&
        run.child_session_key === payload.child_session_key &&
        run.parent_session_key === payload.parent_session_key,
    );
    requireCondition(matches.length === 1, "LINEAGE_MISMATCH");
    requireCondition(
      ["ok", "error", "timeout", "killed", "reset", "deleted"].includes(
        payload.outcome,
      ),
      "SCHEMA_INVALID",
    );
    const run = matches[0];
    // M8-056: a superseded attempt's callback is late by definition. It must
    // not block the live attempt by forcing the task out of its state.
    if (isSupersededAttempt(task, run)) return next;
    // Already in a terminal run state — late duplicate receipts are ignored.
    if (
      ["COMPLETE", "FAILED", "CANCELLED"].includes(run.run_state) ||
      terminal.has(task.workflow_status) ||
      run.brief_revision !== task.brief_revision
    )
      return next;
    if (payload.outcome === "ok") {
      // D03: outcome=ok means execution completed — transition run to COMPLETE
      // and wait for mandatory pre-announce acceptance gate (WORKFLOW_RESULT_RECORDED).
      // Without this the run stays RUNNING indefinitely, blocking WORKFLOW_ROOT_RESULT_RECORDED.
      if (run.run_state === "RUNNING") run.run_state = "COMPLETE";
      return next;
    }
    // D04: Native error outcome — transition run to UNKNOWN + task to BLOCKED
    // and stamp a deterministic recovery record so operators can distinguish
    // timeout from error and schedule explicit reconciliation actions.
    // M8-056: every non-ok outcome is an observed runtime failure, so it maps
    // to the documented transient failure class. `EXECUTION_STATE_UNKNOWN` is
    // reserved for state the runtime genuinely cannot classify — it is not
    // reachable from a reported outcome, and inventing it here would make the
    // documented retry class unreachable.
    run.run_state = "UNKNOWN";
    run.runtime_reason_code =
      payload.outcome === "timeout"
        ? "RUN_TIMEOUT"
        : "TRANSIENT_RUNTIME_FAILURE";
    // D04: Stamp recovery metadata so operators can correlate and act.
    if (payload.recorded_at !== undefined) {
      requireCondition(
        typeof payload.recorded_at === "string" &&
          !Number.isNaN(Date.parse(payload.recorded_at)),
        "SCHEMA_INVALID",
      );
    }
    run.recovery_needed_at = payload.recorded_at ?? eventTime;
    run.recovery_reason = payload.outcome;
    // The suspended task status is recorded so a documented transient failure
    // can be reconciled back to the state that was interrupted, rather than to
    // a state the reducer invents at recovery time.
    run.suspended_task_status = task.workflow_status;
    task.workflow_status = "BLOCKED";
    // Run observation and workflow suspension have different meanings: a
    // timeout does not establish terminal failure or safe retry of the task.
    task.reason_code = "BLOCKED";
    return next;
  }
  if (type === "WORKFLOW_TASK_RECONCILED") {
    // M8-056: explicit terminal semantics for an old attempt. A run that failed
    // for a DOCUMENTED transient reason may be reconciled, which stamps the old
    // attempt FAILED (terminal, no longer active) and lifts the block. Any other
    // failure class has no retry path — an operator must escalate instead of
    // the state machine inventing one.
    exactKeys(payload, [
      "task_id",
      "actor",
      "reason_code",
      "node_id",
      "agent_id",
    ]);
    requireCondition(payload.actor === "main", "POLICY_DENIED");
    requireCondition(
      TRANSIENT_FAILURE_CLASS.has(payload.reason_code),
      "POLICY_DENIED",
    );
    requireCondition(
      task.workflow_status === "BLOCKED" && task.reason_code === "BLOCKED",
      "INVALID_STATE_TRANSITION",
    );
    const stale = Object.values(task.delegations).filter(
      (run) =>
        run.node_id === payload.node_id &&
        run.agent_id === payload.agent_id &&
        run.brief_revision === task.brief_revision &&
        run.run_state === "UNKNOWN",
    );
    requireCondition(stale.length === 1, "INVALID_STATE_TRANSITION");
    reconcileTransientAttempt(task, stale[0], eventTime);
    return next;
  }
  if (type === "WORKFLOW_CANCELLED") {
    // M7-072: cancellation carries the authoritative actor provenance.
    // OWNER_CANCELLED is a user/owner decision; PARENT_CANCELLED is a
    // coordinator (main) decision. No anonymous cancellation exists.
    exactKeys(
      payload,
      ["task_id", "reason_code", "actor"],
      ["channel", "message_id"],
    );
    requireCondition(
      ["OWNER_CANCELLED", "PARENT_CANCELLED"].includes(payload.reason_code),
      "POLICY_DENIED",
    );
    requireCondition(
      (payload.reason_code === "OWNER_CANCELLED" && payload.actor === "user") ||
        (payload.reason_code === "PARENT_CANCELLED" &&
          payload.actor === "main"),
      "POLICY_DENIED",
    );
    requireCondition(!terminal.has(task.workflow_status));
    task.workflow_status = "CANCELLED";
    task.brief_state = "CLOSED";
    for (const run of Object.values(task.delegations))
      if (activeRun.has(run.run_state)) run.run_state = "CANCELLED";
    return next;
  }
  if (type === "WORKFLOW_ROOT_RESULT_RECORDED") {
    exactKeys(payload, [
      "task_id",
      "brief_revision",
      "native_run_id",
      "agent_id",
      "payload_digest",
      "outcome_status",
      "reason_code",
      "governance_hash",
    ]);
    requireCondition(
      payload.native_run_id === task.root_run_id &&
        payload.agent_id === task.root_agent_id &&
        payload.brief_revision === task.brief_revision,
      "LINEAGE_MISMATCH",
    );
    digest(payload.payload_digest);
    digest(payload.governance_hash);
    requireCondition(
      outcomeReasonAllowed(payload.outcome_status, payload.reason_code),
      "VALIDATION_FAILED",
    );
    if (terminal.has(task.workflow_status)) return next; // Late output never revives a closed task.
    requireCondition(task.brief_state === "ACTIVE");
    if (task.root_result) {
      if (task.root_result.payload_digest === payload.payload_digest)
        return next;
      task.workflow_status = "BLOCKED";
      task.reason_code = "DUPLICATE_RESULT_CONFLICT";
      return next;
    }
    const current = Object.values(task.delegations).filter(
      (run) => run.brief_revision === task.brief_revision,
    );
    // D18: WORKFLOW_ROOT_RESULT_RECORDED must block while any run for the current
    // brief revision is still RUNNING (or in another active state). This gate
    // ensures no successful native children are abandoned mid-execution.
    requireCondition(
      !current.some((run) => activeRun.has(run.run_state)),
      "MISSING_PREREQUISITE",
    );
    const nodes = task.nodes
      .filter((node) => node.agent_id !== task.root_agent_id)
      .map((node) => ({
        ...node,
        // D19: Sort by attempt descending and deduplicate — only the highest
        // attempt per node determines the accepted outcome. Duplicate attempt
        // numbers are rejected at SPAWN_RESERVED; here we rely on that guard.
        accepted_outcome_status: current
          .filter((run) => run.node_id === node.node_id)
          .sort((a, b) => b.attempt - a.attempt)[0]?.accepted_outcome_status,
      }));
    if (
      payload.outcome_status === "COMPLETE" &&
      nodes.some((node) => node.required)
    )
      requireCondition(
        workflowAggregate(nodes) === "COMPLETE",
        "MISSING_PREREQUISITE",
      );
    requireCondition(
      task.workflow_status === "ACTIVE",
      "INVALID_STATE_TRANSITION",
    );
    // Pre-verdict-model resolution for anchored history (see the
    // PRE_VERDICT_ROOT_RESULT note above). The verifier sets this only when the
    // journal itself declares a legacy era: it contains at least one event
    // stamped with a pre-R4 governance version, whose digests chain-lock the
    // whole journal. That declaration comes from the event stream, not from the
    // snapshot being verified, so selecting the resolution with it is not
    // circular. A journal that contains only current-version events is read
    // under the current verdict model, which is what the current writer
    // produces and what the read-back must reproduce.
    if (replayAnchored && preVerdictRootResult) {
      task.root_result = { ...payload };
      task.workflow_status = payload.outcome_status;
      task.reason_code = payload.reason_code;
      if (terminal.has(task.workflow_status)) task.brief_state = "CLOSED";
      return next;
    }
    task.root_result = {
      ...payload,
      pending_outcome_status: payload.outcome_status,
    };
    task.workflow_status = "RESULT_PENDING_REVIEW";
    task.result_pending_at = eventTime;
    task.reason_code = payload.reason_code;
    return next;
  }
  if (type === "WORKFLOW_USER_RESULT_ACCEPTED") {
    exactKeys(
      payload,
      ["task_id", "actor", "channel", "decision"],
      ["result_id", "result_digest", "message_id", "thread_id"],
    );
    requireCondition(payload.actor === "user", "POLICY_DENIED");
    requireCondition(payload.channel === "results", "CHANNEL_MISMATCH");
    requireCondition(payload.decision === "ACCEPT", "SCHEMA_INVALID");
    requireCondition(
      task.workflow_status === "RESULT_PENDING_REVIEW",
      "INVALID_STATE_TRANSITION",
    );
    requireResultIdentityMatch(task, payload, replayAnchored);
    task.workflow_status = "COMPLETE";
    task.brief_state = "CLOSED";
    task.user_accepted_at = eventTime;
    return next;
  }
  if (type === "WORKFLOW_USER_RESULT_REJECTED") {
    exactKeys(
      payload,
      ["task_id", "actor", "channel", "reason"],
      ["result_id", "result_digest", "message_id", "thread_id"],
    );
    requireCondition(payload.actor === "user", "POLICY_DENIED");
    requireCondition(payload.channel === "results", "CHANNEL_MISMATCH");
    requireCondition(
      task.workflow_status === "RESULT_PENDING_REVIEW",
      "INVALID_STATE_TRANSITION",
    );
    requireResultIdentityMatch(task, payload, replayAnchored);
    task.workflow_status = "REJECTED";
    task.brief_state = "CLOSED";
    task.user_rejected_at = eventTime;
    task.rejection_reason = payload.reason;
    return next;
  }
  if (type === "WORKFLOW_USER_RESULT_BLOCKED") {
    // Owner verdict (Phase C, 2026-09-29): the owner reviewed the result and
    // accepted BLOCKED as the authoritative final outcome. This exists because
    // the verdict model had no way to express that meaning: a root result whose
    // outcome is BLOCKED used to end the task at BLOCKED, and under the verdict
    // model it lands in RESULT_PENDING_REVIEW, from which COMPLETE / REJECTED /
    // REVISING / CANCELLED were the only edges. REJECTED is NOT the same claim
    // (a rejected result is one the owner refused, not one they accepted as
    // blocked), so the gap was closed with its own verdict rather than by
    // borrowing an existing state.
    //
    // It is deliberately distinct from an execution event that merely PRODUCES a
    // blocked condition (WORKFLOW_NATIVE_ENDED transient failure, a duplicate
    // root result, a conflicting delegated result). Those are not owner
    // judgements and must never be expressed as this event.
    exactKeys(
      payload,
      ["task_id", "actor", "channel", "decision", "reason"],
      ["reason_code", "result_id", "result_digest", "message_id", "thread_id"],
    );
    requireCondition(payload.actor === "user", "POLICY_DENIED");
    requireCondition(payload.channel === "results", "CHANNEL_MISMATCH");
    requireCondition(payload.decision === "BLOCK", "SCHEMA_INVALID");
    requireCondition(
      task.workflow_status === "RESULT_PENDING_REVIEW",
      "INVALID_STATE_TRANSITION",
    );
    requireResultIdentityMatch(task, payload, replayAnchored);
    // The brief stays open: BLOCKED is recoverable (the task may be reconciled
    // or cancelled), so the brief is NOT closed here. This matches the state a
    // pre-verdict root result left behind.
    task.workflow_status = "BLOCKED";
    task.user_blocked_at = eventTime;
    task.rejection_reason = payload.reason;
    if (payload.reason_code !== undefined) {
      requireCondition(
        typeof payload.reason_code === "string" &&
          payload.reason_code.length > 0 &&
          payload.reason_code.length <= 128,
        "SCHEMA_INVALID",
      );
      task.reason_code = payload.reason_code;
    }
    return next;
  }
  if (type === "WORKFLOW_RESULT_REVISION_REQUESTED") {
    exactKeys(
      payload,
      ["task_id", "actor", "channel", "feedback"],
      ["result_id", "result_digest"],
    );
    requireCondition(["user", "main"].includes(payload.actor), "POLICY_DENIED");
    requireCondition(payload.channel === "results", "CHANNEL_MISMATCH");
    requireCondition(
      task.workflow_status === "RESULT_PENDING_REVIEW",
      "INVALID_STATE_TRANSITION",
    );
    requireResultIdentityMatch(task, payload, replayAnchored);
    task.workflow_status = "REVISING";
    task.revision_requested_at = eventTime;
    task.revision_feedback = payload.feedback;
    return next;
  }
  if (type === "WORKFLOW_USER_APPROVAL_DECIDED") {
    exactKeys(
      payload,
      ["task_id", "actor", "channel", "decision"],
      ["message_id", "thread_id", "scope_digest", "reason"],
    );
    requireCondition(
      payload.decision === "APPROVE" ||
        payload.decision === "REJECT" ||
        payload.decision === "REQUEST_REVISION",
      "SCHEMA_INVALID",
    );
    if (payload.decision === "APPROVE" || payload.decision === "REJECT") {
      requireCondition(payload.actor === "user", "POLICY_DENIED");
    } else {
      requireCondition(
        ["user", "main"].includes(payload.actor),
        "POLICY_DENIED",
      );
    }
    requireCondition(payload.channel === "approvals", "CHANNEL_MISMATCH");
    requireCondition(
      !terminal.has(task.workflow_status),
      "INVALID_STATE_TRANSITION",
    );
    requireCondition(
      task.workflow_status === "ACTIVE" || task.workflow_status === "REVISING",
      "INVALID_STATE_TRANSITION",
    );
    if (payload.decision === "APPROVE") {
      task.workflow_status = "QUEUED";
      task.approved_at = eventTime;
    } else if (payload.decision === "REJECT") {
      task.workflow_status = "REJECTED";
      task.brief_state = "CLOSED";
      task.rejected_at = eventTime;
    } else {
      task.workflow_status = "REVISING";
      task.revision_requested_at = eventTime;
    }
    return next;
  }
  if (type === "WORKFLOW_APPROVAL_REQUESTED") {
    // R6: the approval REQUEST is its own governed fact, independent of the
    // execution brief. Before this event existed, "approvable" was inferred from
    // `ACTIVE && !approved_at && !claimed_at`, and WORKFLOW_OPENED sets
    // workflow_status to ACTIVE — so every freshly opened task looked
    // approval-pending and the owner could approve a request that was never
    // surfaced. Only a recorded request may create an approval opportunity.
    //
    // workflow_status is deliberately left at ACTIVE. Several guards require
    // ACTIVE, so introducing a real APPROVAL_PENDING status would change the
    // meaning of already-emitted events; "approvable" is instead a predicate
    // over this projection (see isApprovalPending below).
    exactKeys(
      payload,
      ["task_id", "agent_id", "session_key", "run_id"],
      ["brief_revision"],
    );
    identifier(payload.session_key);
    identifier(payload.run_id);
    requireCondition(
      typeof payload.agent_id === "string" && payload.agent_id.length > 0,
      "SCHEMA_INVALID",
    );
    if (payload.brief_revision !== undefined)
      requireCondition(
        Number.isInteger(payload.brief_revision) && payload.brief_revision >= 1,
        "SCHEMA_INVALID",
      );
    requireCondition(
      !terminal.has(task.workflow_status),
      "INVALID_STATE_TRANSITION",
    );
    const revisionCycle = task.workflow_status === "REVISING";
    requireCondition(
      task.workflow_status === "ACTIVE" || revisionCycle,
      "INVALID_STATE_TRANSITION",
    );
    if (task.approval_requested_at && !revisionCycle) {
      // Idempotent retry: the SAME owning run re-requesting is a no-op, so a
      // retry after a failed card post cannot create a second opportunity.
      if (
        task.approval_requested_by === payload.agent_id &&
        task.approval_requested_run_id === payload.run_id
      )
        return next;
      // A DIFFERENT requester while one is already pending would advertise a
      // second approval opportunity for the same task.
      fail("INVALID_STATE_TRANSITION");
    }
    task.approval_requested_at = eventTime;
    task.approval_requested_by = payload.agent_id;
    task.approval_requested_run_id = payload.run_id;
    return next;
  }
  if (type === "WORKFLOW_APPROVAL_SURFACED") {
    // M12/T2-R1: a request the owner was never shown is not an approval he can
    // act on, and a thread nobody recorded is a duplicate waiting to happen. This
    // projects the surfaced thread into the approval_thread_id slot the snapshot
    // schema has declared since M7 with no writer — so "requested but never
    // surfaced" becomes a durable, re-drivable state instead of a lost log line.
    exactKeys(payload, ["task_id", "channel", "thread_id"]);
    requireCondition(payload.channel === "approvals", "CHANNEL_MISMATCH");
    requireCondition(
      typeof payload.thread_id === "string" && payload.thread_id.length > 0,
      "SCHEMA_INVALID",
    );
    requireCondition(
      Boolean(task.approval_requested_at),
      "INVALID_STATE_TRANSITION",
    );
    if (task.approval_thread_id) {
      // A different thread for one recorded request is exactly the duplicate the
      // owner forbade; the first surface keeps the record.
      if (task.approval_thread_id !== payload.thread_id)
        fail("INVALID_STATE_TRANSITION");
      return next;
    }
    task.approval_thread_id = payload.thread_id;
    return next;
  }
  if (type === "WORKFLOW_RESULT_SURFACED") {
    // M12/T2-R1: the results forum had no publish path before this task, so
    // nothing could prove an owner was ever shown the work he is being asked to
    // accept. Idempotent by thread id for the same reason as the approval above.
    exactKeys(payload, ["task_id", "channel", "thread_id"], ["result_digest"]);
    requireCondition(payload.channel === "results", "CHANNEL_MISMATCH");
    requireCondition(
      typeof payload.thread_id === "string" && payload.thread_id.length > 0,
      "SCHEMA_INVALID",
    );
    if (task.results_thread_id) {
      if (task.results_thread_id !== payload.thread_id)
        fail("INVALID_STATE_TRANSITION");
      return next;
    }
    task.results_thread_id = payload.thread_id;
    return next;
  }
  if (type === "WORKFLOW_TASK_CLAIMED") {
    // D01/D02: CLAIM is only valid from the approved QUEUED state.
    // ACTIVE is not a valid pre-claim state — allowing it bypasses the
    // explicit approval gate (APPROVE -> QUEUED -> CLAIM).
    exactKeys(payload, ["task_id", "agent_id"]);
    requireCondition(
      task.workflow_status === "QUEUED",
      "INVALID_STATE_TRANSITION",
    );
    task.workflow_status = "EXECUTING";
    task.claimed_by = payload.agent_id;
    task.claimed_at = eventTime;
    return next;
  }
  if (type === "WORKFLOW_COORDINATOR_RUN_BOUND") {
    // M10/T2: binds a gateway-started coordinator run to an already-claimed
    // queue task attempt. This is NOT a spawn event, NOT a delegation event,
    // and NOT parent-child lineage: a coordinator run has no live parent
    // session, so no parent fields exist on this payload by design. The queue
    // owns lease liveness; this event only records the association the pickup
    // path asserted at bind time (attempt + lease presented by the claim
    // owner), and it never mints, renews, or verifies a lease.
    exactKeys(payload, [
      "task_id",
      "coordinator",
      "attempt",
      "lease_id",
      "session_key",
      "run_id",
    ]);
    // M7-073: only o1/o2 coordinate executable work. main and specialists can
    // never be bound as coordinators. Stated explicitly rather than derived so
    // a topology change cannot silently widen this gate.
    requireCondition(
      payload.coordinator === "o1" || payload.coordinator === "o2",
      "POLICY_DENIED",
    );
    requireCondition(
      Number.isSafeInteger(payload.attempt) && payload.attempt >= 1,
      "SCHEMA_INVALID",
    );
    identifier(payload.lease_id);
    identifier(payload.session_key);
    identifier(payload.run_id);
    requireCondition(
      task.workflow_status === "EXECUTING",
      "INVALID_STATE_TRANSITION",
    );
    requireCondition(task.claimed_by === payload.coordinator, "POLICY_DENIED");
    task.coordinator_runs ??= {};
    const existing = task.coordinator_runs[payload.attempt];
    if (existing) {
      // Identical replay is a no-op (the writer's no-change-no-append rule
      // turns it into a non-append). Any conflicting re-bind for one attempt
      // is a lineage conflict, never a silent overwrite.
      requireCondition(
        existing.task_id === payload.task_id &&
          existing.coordinator === payload.coordinator &&
          existing.attempt === payload.attempt &&
          existing.lease_id === payload.lease_id &&
          existing.session_key === payload.session_key &&
          existing.run_id === payload.run_id,
        "LINEAGE_MISMATCH",
      );
      return next;
    }
    // A superseded attempt never rebinds: once a higher attempt holds a
    // binding, the older generation is audit history only.
    for (const boundAttempt of Object.keys(task.coordinator_runs)) {
      requireCondition(
        Number(boundAttempt) <= payload.attempt,
        "LINEAGE_MISMATCH",
      );
    }
    task.coordinator_runs[payload.attempt] = {
      task_id: payload.task_id,
      coordinator: payload.coordinator,
      attempt: payload.attempt,
      lease_id: payload.lease_id,
      session_key: payload.session_key,
      run_id: payload.run_id,
    };
    return next;
  }
  if (type === "WORKFLOW_USER_QUESTION_RECORDED") {
    // M7-041: the question is attributable to the run that currently owns the
    // task. A session-key string alone is not authority, so the payload must
    // carry the governed run identity and the agent must be the run's owner.
    exactKeys(payload, [
      "task_id",
      "agent_id",
      "question",
      "session_key",
      "run_id",
    ]);
    requireCondition(
      task.workflow_status === "EXECUTING",
      "INVALID_STATE_TRANSITION",
    );
    identifier(payload.session_key);
    identifier(payload.run_id);
    const questionOwner = findSession(
      next,
      payload.session_key,
      payload.run_id,
    );
    requireCondition(
      questionOwner.task_id === payload.task_id,
      "LINEAGE_MISMATCH",
    );
    // A stale or terminal run cannot pose a question for a live task.
    requireCondition(
      !questionOwner.delegation ||
        questionOwner.delegation.run_state === "RUNNING",
      "LINEAGE_MISMATCH",
    );
    requireCondition(
      payload.agent_id === ownerRunAgentId(questionOwner, task),
      "UNAUTHORIZED_TARGET",
    );
    // The named run must BE the canonical current owner. This is what makes a
    // foreign or stale run unnameable rather than merely discouraged.
    const currentOwner = resolveCurrentRunOwner(task);
    requireCondition(
      currentOwner.session_key === payload.session_key &&
        currentOwner.run_id === payload.run_id &&
        currentOwner.agent_id === payload.agent_id,
      "LINEAGE_MISMATCH",
    );
    task.workflow_status = "WAITING_FOR_USER";
    task.waiting_question = payload.question;
    task.waiting_question_agent_id = payload.agent_id;
    task.waiting_question_run_id = payload.run_id;
    task.waiting_question_session_key = payload.session_key;
    return next;
  }
  if (type === "WORKFLOW_USER_ANSWER_RECORDED") {
    // M7-042: the raw reducer is an authority, so the answer must carry the
    // user principal and the originating message itself. Provenance cannot be
    // delegated to a caller-controlled ingress layer.
    exactKeys(
      payload,
      ["task_id", "answer", "actor", "user_principal_ref", "message_id"],
      ["thread_id"],
    );
    requireCondition(
      task.workflow_status === "WAITING_FOR_USER",
      "INVALID_STATE_TRANSITION",
    );
    requireCondition(payload.actor === "user", "POLICY_DENIED");
    requireCondition(
      typeof payload.user_principal_ref === "string" &&
        /^[a-f0-9]{64}$/u.test(payload.user_principal_ref),
      "SCHEMA_INVALID",
    );
    requireCondition(
      task.waiting_question_run_id !== undefined,
      "INVALID_STATE_TRANSITION",
    );
    requireCondition(
      typeof payload.message_id === "string" &&
        /^[1-9][0-9]{16,19}$/u.test(payload.message_id),
      "SCHEMA_INVALID",
    );
    // The answering run must be the run that posed the question, and that run
    // must still be the governed owner of the task.
    const answerOwner = findSession(
      next,
      task.waiting_question_session_key,
      task.waiting_question_run_id,
    );
    requireCondition(
      answerOwner.task_id === payload.task_id,
      "LINEAGE_MISMATCH",
    );
    requireCondition(
      !answerOwner.delegation || answerOwner.delegation.run_state === "RUNNING",
      "LINEAGE_MISMATCH",
    );
    task.workflow_status = "EXECUTING";
    task.user_answer = payload.answer;
    task.user_answer_principal_ref = payload.user_principal_ref;
    task.user_answer_message_id = payload.message_id;
    // The question binding is released by removing it, not by writing an
    // undefined value: a persisted snapshot must never carry an absent field.
    delete task.waiting_question_run_id;
    delete task.waiting_question_session_key;
    return next;
  }
  if (type === "WORKFLOW_SPAWN_RECEIVED") {
    exactKeys(payload, [
      "task_id",
      "delegation_id",
      "native_run_id",
      "child_session_key",
      "agent_id",
      "parent_session_key",
    ]);
    const run = task.delegations[payload.delegation_id];
    identifier(payload.native_run_id);
    identifier(payload.child_session_key);
    requireCondition(
      run &&
        run.agent_id === payload.agent_id &&
        run.parent_session_key === payload.parent_session_key,
      "LINEAGE_MISMATCH",
    );
    if (run.native_run_id) {
      requireCondition(
        run.native_run_id === payload.native_run_id &&
          run.child_session_key === payload.child_session_key,
        "LINEAGE_MISMATCH",
      );
      return next;
    }
    if (terminal.has(task.workflow_status)) return next;
    if (
      run.run_state === "CANCELLED" ||
      run.run_state === "FAILED" ||
      run.run_state === "COMPLETE"
    )
      return next;
    // A delayed receipt supplies identity but cannot revive cancelled work.
    // M8-056: nor can it revive a superseded attempt.
    if (isSupersededAttempt(task, run)) return next;
    run.native_run_id = payload.native_run_id;
    run.child_session_key = payload.child_session_key;
    if (run.run_state === "SPAWN_UNKNOWN") run.run_state = "RUNNING";
    return next;
  }
  if (type === "WORKFLOW_RESULT_RECORDED") {
    if (payload.envelope) {
      exactKeys(payload, ["task_id", "envelope"]);
      const envelope = payload.envelope;
      validateContract("trusted-result-envelope", envelope);
      const run = task.delegations[envelope.delegation_id];
      requireCondition(
        run &&
          run.native_run_id === envelope.native_run_id &&
          run.agent_id === envelope.agent_id &&
          run.node_id === envelope.node_id &&
          run.attempt === envelope.attempt &&
          run.brief_revision === envelope.brief_revision,
        "LINEAGE_MISMATCH",
      );
      requireCondition(
        envelope.task_id === payload.task_id &&
          envelope.stack_id === run.stack_id &&
          envelope.expected_governance_hash === run.expected_governance_hash &&
          envelope.observed_governance_hash === run.expected_governance_hash,
        "GOVERNANCE_HASH_MISMATCH",
      );
      if (envelope.parent_run_id !== undefined)
        requireCondition(
          envelope.parent_run_id === run.parent_run_id,
          "LINEAGE_MISMATCH",
        );
      // M8-056: a superseded attempt's result is a late callback. It must not
      // complete the old run, and it must not satisfy another node's
      // prerequisite on the strength of a result the live attempt supersedes.
      if (isSupersededAttempt(task, run)) return next;
      // A conflicting digest is a security event and is recorded even on a
      // terminal task: two different results for one attempt must be visible
      // to the audit, not silently dropped.
      if (run.accepted_payload_digest) {
        if (
          run.accepted_payload_digest !== envelope.payload_digest &&
          !terminal.has(task.workflow_status)
        ) {
          // Lane H1: a conflicting delegated result suspends the task AND
          // records why. Blocking without a reason code leaves an operator no
          // way to tell a lineage conflict from a runtime failure.
          task.workflow_status = "BLOCKED";
          task.reason_code = "DUPLICATE_RESULT_CONFLICT";
        }
        return next;
      }
      // Lane H1: a terminal task is terminal in EVERY projection. A child that
      // reports for the FIRST time after the task closed must not be able to
      // move the run, because a mutated run in a closed task is a lineage the
      // audit cannot explain.
      if (terminal.has(task.workflow_status)) return next;
      if (
        task.brief_revision !== run.brief_revision ||
        task.brief_state !== "ACTIVE" ||
        run.run_state === "CANCELLED"
      )
        return next;
      requireCondition(run.run_state === "RUNNING");
      requireCondition(
        envelope.result_acceptance === "ACCEPTED" &&
          envelope.verifier_validation === "VALID",
        "VALIDATION_FAILED",
      );
      run.run_state = "COMPLETE";
      run.accepted_payload_digest = envelope.payload_digest;
      run.accepted_received_at = envelope.received_at;
      run.accepted_outcome_status = envelope.accepted_outcome_status;
      run.accepted_reason_code = envelope.accepted_reason_code;
      return next;
    }
    // Task-level execution finished result recorded directly by governance coordinator
    exactKeys(
      payload,
      ["task_id"],
      [
        "agent_id",
        "attempt",
        "payload_digest",
        "technical_status",
        "business_status",
        "artifact_path",
        "artifacts",
        "artifact_set_digest",
        "recorded_at",
      ],
    );
    requireCondition(
      task.workflow_status === "EXECUTING",
      "INVALID_STATE_TRANSITION",
    );
    // M8-051: the canonical artifact set is an ordered, bounded collection
    // with one digest over the whole set. The set is authoritative: a
    // singular artifact_path alone may not stand in for a delivered set.
    if (payload.artifacts != null) {
      requireCondition(
        Array.isArray(payload.artifacts) && payload.artifacts.length <= 10,
        "SCHEMA_INVALID",
      );
      const setDigest = canonicalHash("zink-artifact-set-v1", {
        artifacts: payload.artifacts.map((artifact) => ({
          logical_path: artifact.logical_path,
          sha256: artifact.sha256,
        })),
      });
      requireCondition(
        payload.artifact_set_digest === setDigest,
        "RESULT_MISMATCH",
      );
      task.result_artifacts = payload.artifacts.map((artifact) => ({
        ...artifact,
      }));
      task.artifact_set_digest = setDigest;
    }
    task.workflow_status = "RESULT_PENDING_REVIEW";
    task.result_pending_at = payload.recorded_at ?? eventTime;
    if (payload.payload_digest)
      task.execution_payload_digest = payload.payload_digest;
    return next;
  }
  // M7-020: a spawn reservation creates governed work, so it is a
  // POST-approval event and asserts the approval state itself. It must not
  // trust that some upstream caller already approved the work: a task with no
  // approval evidence can never have a delegation reserved.
  if (type === "WORKFLOW_SPAWN_RESERVED") {
    // M8-056: a documented transient failure is reconciled as part of the retry
    // reservation. The task is BLOCKED at this point, so the post-approval gate
    // below is evaluated against the restored state.
    reconcileForRetry(task, payload.node_id, eventTime);
    // Option (b) migration: anchored replay trusts admission (see above).
    if (!replayAnchored) requirePostApprovalState(task);
    return applySpawnReserved(next, task, payload, replayAnchored);
  }
  // A continuation continues approved work, so it is post-approval too.
  if (
    type === "WORKFLOW_CONTINUATION_AUTHORIZED" ||
    type === "WORKFLOW_CONTINUATION_STARTED"
  ) {
    // Option (b) migration: anchored replay trusts admission (see above).
    if (!replayAnchored) requirePostApprovalState(task);
  } else {
    requireCondition(
      task.workflow_status === "ACTIVE" && task.brief_state === "ACTIVE",
    );
  }
  if (type === "WORKFLOW_CONTINUATION_AUTHORIZED") {
    // D09: Bind continuation authorization to lease+attempt tuple (not just run ID/session)
    // by requiring the owning delegation's attempt to be recorded with the continuation.
    exactKeys(
      payload,
      [
        "task_id",
        "brief_revision",
        "session_key",
        "previous_run_id",
        "next_run_id",
        "source_session_key",
        "trigger_run_id",
      ],
      ["owner_attempt"],
    );
    for (const field of [
      "session_key",
      "previous_run_id",
      "next_run_id",
      "source_session_key",
      "trigger_run_id",
    ])
      identifier(payload[field]);
    requireCondition(
      payload.brief_revision === task.brief_revision,
      "SUPERSEDED_REVISION",
    );
    const owner = findSession(
      next,
      payload.session_key,
      payload.previous_run_id,
    );
    requireCondition(owner.task_id === payload.task_id, "LINEAGE_MISMATCH");
    if (owner.delegation)
      requireCondition(owner.delegation.run_state === "RUNNING");
    // D09 / M7-043: the owner attempt binding ties a continuation to the
    // generation it claims to continue. A present-but-stale attempt is denied
    // in every mode. Presence itself is required on strict paths (writes,
    // tail): the writer emits owner_attempt whenever the owner is a
    // delegation, so an omission on a new write is hand-built, not
    // writer-produced. Anchored replay tolerates absence (option b
    // migration): continuations journaled before the field existed carry
    // none, and the Sep-28 live build validates exactly this way.
    if (owner.delegation) {
      if (!replayAnchored) {
        requireCondition(
          payload.owner_attempt !== undefined &&
            Number.isInteger(payload.owner_attempt) &&
            payload.owner_attempt >= 1,
          "LINEAGE_MISMATCH",
        );
      }
      if (payload.owner_attempt !== undefined) {
        requireCondition(
          payload.owner_attempt === owner.delegation.attempt,
          "LINEAGE_MISMATCH",
        );
      }
    }
    const trigger = Object.values(task.delegations).find(
      (run) => run.native_run_id === payload.trigger_run_id,
    );
    requireCondition(trigger, "LINEAGE_MISMATCH");
    if (payload.source_session_key === payload.session_key) {
      requireCondition(trigger === owner.delegation, "LINEAGE_MISMATCH");
      const children = Object.values(task.delegations).filter((run) =>
        ownerRunIds(owner).includes(run.parent_run_id),
      );
      requireCondition(
        children.length > 0 &&
          children.every(
            (run) =>
              run.run_state === "COMPLETE" && run.accepted_payload_digest,
          ),
        "MISSING_PREREQUISITE",
      );
    } else {
      requireCondition(
        trigger.child_session_key === payload.source_session_key &&
          trigger.parent_session_key === payload.session_key &&
          trigger.run_state === "COMPLETE" &&
          trigger.accepted_payload_digest,
        "LINEAGE_MISMATCH",
      );
    }
    task.continuations ??= {};
    const previous = task.continuations[payload.next_run_id];
    if (previous) {
      requireCondition(
        Object.keys(payload).every((key) => previous[key] === payload[key]),
        "LINEAGE_MISMATCH",
      );
      return next;
    }
    requireCondition(
      !Object.values(task.continuations).some(
        (item) =>
          item.trigger_run_id === payload.trigger_run_id &&
          item.source_session_key === payload.source_session_key,
      ),
      "LINEAGE_MISMATCH",
    );
    task.continuations[payload.next_run_id] = { ...payload, started: false };
    return next;
  }
  if (type === "WORKFLOW_CONTINUATION_STARTED") {
    exactKeys(payload, [
      "task_id",
      "next_run_id",
      "session_key",
      "source_session_key",
      "agent_id",
    ]);
    const entry = task.continuations?.[payload.next_run_id];
    requireCondition(
      entry &&
        !entry.started &&
        entry.brief_revision === task.brief_revision &&
        entry.session_key === payload.session_key &&
        entry.source_session_key === payload.source_session_key,
      "LINEAGE_MISMATCH",
    );
    // Concurrent accepted children may authorize against the same parent
    // invocation. Earlier trusted continuations do not invalidate later ones.
    const candidates = [];
    if (
      task.root_session_key === entry.session_key &&
      ownerRunIds({ task }).includes(entry.previous_run_id)
    )
      candidates.push({ task });
    for (const delegation of Object.values(task.delegations))
      if (
        delegation.child_session_key === entry.session_key &&
        ownerRunIds({ task, delegation }).includes(entry.previous_run_id)
      )
        candidates.push({ task, delegation });
    requireCondition(candidates.length === 1, "LINEAGE_MISMATCH");
    const owner = candidates[0];
    requireCondition(
      (owner.delegation?.agent_id ?? task.root_agent_id) === payload.agent_id,
      "UNAUTHORIZED_TARGET",
    );
    if (owner.delegation) {
      requireCondition(owner.delegation.run_state === "RUNNING");
      owner.delegation.previous_native_run_ids ??= [];
      if (
        !owner.delegation.previous_native_run_ids.includes(
          owner.delegation.native_run_id,
        )
      ) {
        owner.delegation.previous_native_run_ids.push(
          owner.delegation.native_run_id,
        );
      }
      owner.delegation.native_run_id = payload.next_run_id;
    } else {
      task.previous_root_run_ids ??= [];
      if (!task.previous_root_run_ids.includes(task.root_run_id)) {
        task.previous_root_run_ids.push(task.root_run_id);
      }
      task.root_run_id = payload.next_run_id;
    }
    entry.started = true;
    return next;
  }
  if (type === "WORKFLOW_BRIEF_ACTIVATED") {
    // M7-016: the brief's semantic contract status is REQUIRED on new writes,
    // because execution-brief.schema.json requires it and the guard authorizes
    // a specialist only when the TASK records a VALID semantic contract. The
    // event previously did not carry it, so the task could never record it and
    // every governed specialist was refused MISSING_PREREQUISITE.
    //
    // R4 readability: briefs activated before the field existed carry no
    // status. Replaying them must not throw, or the operational ledger becomes
    // unreadable. An absent status is preserved as-is (absent): the canonical
    // hash drops undefined-valued keys, so replayed tasks stay hash-identical
    // to snapshot tasks that predate the field. The guard authorizes only an
    // explicit VALID, so an absent status authorizes nothing — fail-closed is
    // preserved exactly as if the field were MISSING.
    exactKeys(
      payload,
      ["task_id", "brief_revision", "nodes"],
      ["semantic_contract_status"],
    );
    if (payload.semantic_contract_status !== undefined) {
      requireCondition(
        ["VALID", "MISSING", "AMBIGUOUS"].includes(
          payload.semantic_contract_status,
        ),
        "SCHEMA_INVALID",
      );
    }
    requireCondition(
      Array.isArray(payload.nodes) &&
        payload.nodes.length > 0 &&
        payload.nodes.length <= 72,
      "SCHEMA_INVALID",
    );
    const nodeMap = new Map();
    for (const node of payload.nodes) {
      exactKeys(node, [
        "node_id",
        "stack_id",
        "agent_id",
        "dependencies",
        "required",
        "input_digest",
        "constraints_digest",
        "validation_digest",
      ]);
      requireCondition(
        /^[a-z][a-z0-9_-]{0,63}$/u.test(node.node_id) &&
          !nodeMap.has(node.node_id),
        "SCHEMA_INVALID",
      );
      requireCondition(
        Object.hasOwn(roles, node.agent_id) &&
          [
            "infrastructure",
            "data_plant",
            "semantic",
            "intelligence",
            "decision",
          ].includes(node.stack_id),
        "UNAUTHORIZED_TARGET",
      );
      requireCondition(
        Array.isArray(node.dependencies) &&
          node.dependencies.length <= 72 &&
          new Set(node.dependencies).size === node.dependencies.length &&
          typeof node.required === "boolean",
        "SCHEMA_INVALID",
      );
      // D10: Validate cross-agent stack topology — each node's stack_id must
      // be owned by its agent_id per the canonical AGENT_STACK_POLICY
      // (M7-037/M7-038: single source of truth, no duplicate literals).
      const agentStacks = AGENT_STACK_POLICY;
      requireCondition(
        (agentStacks[node.agent_id] ?? []).includes(node.stack_id),
        "UNAUTHORIZED_TARGET",
      );
      digest(node.input_digest);
      digest(node.constraints_digest);
      digest(node.validation_digest);
      nodeMap.set(node.node_id, node);
    }
    const visiting = new Set(),
      visited = new Set();
    const visit = (id) => {
      requireCondition(nodeMap.has(id), "MISSING_PREREQUISITE");
      requireCondition(!visiting.has(id), "DEPENDENCY_CYCLE");
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of nodeMap.get(id).dependencies) visit(dependency);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of nodeMap.keys()) visit(id);
    if (task.nodes.length === 0) requireCondition(payload.brief_revision === 1);
    else {
      requireCondition(payload.brief_revision === task.brief_revision + 1);
      requireCondition(task.revisions_used < 16, "WORKFLOW_BUDGET_EXHAUSTED");
      task.revisions_used++;
      for (const run of Object.values(task.delegations))
        if (activeRun.has(run.run_state)) run.run_state = "CANCELLED";
    }
    task.brief_revision = payload.brief_revision;
    task.nodes = payload.nodes;
    // M7-016: the task mirrors the activated brief's semantic contract status,
    // so the guard authorizes a specialist against recorded task state rather
    // than a caller-supplied brief document. Pre-R4 briefs carry no status:
    // the key is left ABSENT (not set to undefined — the contract validator
    // sees own-properties regardless of value, so an undefined-valued key
    // would fail additionalProperties). Absence stays hash-identical to
    // snapshot tasks that predate the field, and the guard authorizes only an
    // explicit VALID, so fail-closed is preserved.
    if (payload.semantic_contract_status !== undefined) {
      task.semantic_contract_status = payload.semantic_contract_status;
    }
    return next;
  }
  fail("EXECUTION_STATE_UNKNOWN");
}

/**
 * M8-056: the ONE reconcile action. A documented transient failure gets an
 * explicit terminal state, so it can never be revived, and the task returns to
 * the state the failure suspended — never to a state chosen at recovery time.
 * Shared by the explicit WORKFLOW_TASK_RECONCILED event and by the retry
 * reservation, so a reconciled attempt is identical whichever path reached it.
 */
function reconcileTransientAttempt(task, run, eventTime) {
  run.run_state = "FAILED";
  run.runtime_reason_code = TRANSIENT_FAILURE_CLASS.has(run.runtime_reason_code)
    ? run.runtime_reason_code
    : "TRANSIENT_RUNTIME_FAILURE";
  run.reconciled_at = eventTime;
  run.superseded_at = eventTime;
  task.workflow_status = run.suspended_task_status ?? "ACTIVE";
  delete task.reason_code;
  task.reconciled_attempts = (task.reconciled_attempts ?? 0) + 1;
}

/**
 * M8-056: a retry reservation IS the reconcile trigger. Reserving a fresh attempt
 * for a node whose previous attempt is stuck in the documented transient class
 * reconciles that attempt in the same atomic event. Without this the retry class
 * was unreachable in production: a transient failure suspends the task to
 * BLOCKED, a spawn requires a post-approval state, and no runtime emitted
 * WORKFLOW_TASK_RECONCILED, so a transiently-failed task could never be retried
 * or recovered at all. Only a DOCUMENTED transient reason qualifies; any other
 * failure class still has no retry path and must be escalated.
 *
 * Returns true when an attempt was reconciled.
 */
function reconcileForRetry(task, nodeId, eventTime) {
  if (task.workflow_status !== "BLOCKED" || task.reason_code !== "BLOCKED") {
    return false;
  }
  const stale = Object.values(task.delegations ?? {}).filter(
    (run) =>
      run.node_id === nodeId &&
      run.brief_revision === task.brief_revision &&
      run.run_state === "UNKNOWN" &&
      TRANSIENT_FAILURE_CLASS.has(run.runtime_reason_code),
  );
  if (stale.length !== 1) return false;
  reconcileTransientAttempt(task, stale[0], eventTime);
  return true;
}

/**
 * M7-062: the ONE result-identity binding. A user verdict (accept, reject, or
 * request a revision) must name the exact result it applies to, otherwise a
 * verdict recorded against result A could be replayed against result B. The
 * digest is authoritative; the legacy result id is accepted only when the
 * digest is absent, and an unbound verdict is refused.
 */
function requireResultIdentityMatch(task, payload, replayAnchored = false) {
  const currentDigest =
    task.root_result?.payload_digest ?? task.execution_payload_digest;
  requireCondition(typeof currentDigest === "string", "RESULT_MISMATCH");
  // `null` and `undefined` both mean "no digest supplied": a verdict naming no
  // result could apply to any, so it must still fall through to the result-id
  // binding rather than compare null against a string. Treating null as a
  // supplied digest made EVERY verdict fail and wedged the task in review.
  const suppliedDigest = payload.result_digest ?? undefined;
  if (suppliedDigest !== undefined) {
    requireCondition(suppliedDigest === currentDigest, "RESULT_MISMATCH");
    return;
  }
  // Option (b) migration: pre-R4 verdicts name a result id with no digest and
  // no journaled root result to bind it to (the binding is an R4 admission
  // rule). For anchored history the acceptance itself is operator-accepted —
  // the user decision in Discord, reflected in the snapshot — so the id
  // linkage is trusted rather than re-litigated. The task-status gate above
  // (RESULT_PENDING_REVIEW) and the digest comparison when a digest IS
  // supplied both still apply, and new verdicts stay fully bound.
  if (replayAnchored) return;
  if (payload.result_id === undefined) fail("RESULT_MISMATCH");
  requireCondition(
    task.root_result?.result_id !== undefined &&
      payload.result_id === task.root_result.result_id,
    "RESULT_MISMATCH",
  );
}

/**
 * M7-020: the canonical post-approval state assertion. Work that creates a
 * delegation or continues a run is only admissible once the owner has approved
 * it and the task has not reached a terminal state. The assertion lives in the
 * reducer, so no caller can assert approval on the owner's behalf.
 */
function requirePostApprovalState(task) {
  requireCondition(
    typeof task.approved_at === "string" &&
      !Number.isNaN(Date.parse(task.approved_at)),
    "AUTH_APPROVAL_REQUIRED",
  );
  requireCondition(
    ["QUEUED", "EXECUTING"].includes(task.workflow_status),
    "INVALID_STATE_TRANSITION",
  );
  requireCondition(task.brief_state === "ACTIVE", "SUPERSEDED_REVISION");
}

/** M7-020: the canonical spawn reservation, applied after the state gate. */
function applySpawnReserved(next, task, payload, replayAnchored = false) {
  exactKeys(payload, [
    "task_id",
    "brief_revision",
    "node_id",
    "agent_id",
    "parent_agent_id",
    "parent_session_key",
    "parent_run_id",
    "tool_call_id",
    "turn",
    "attempt",
    "delegation_id",
    "expected_governance_hash",
    "request_digest",
  ]);
  requireCondition(
    payload.brief_revision === task.brief_revision,
    "SUPERSEDED_REVISION",
  );
  digest(payload.expected_governance_hash);
  digest(payload.request_digest);
  identifier(payload.parent_run_id);
  identifier(payload.parent_session_key);
  identifier(payload.tool_call_id);
  requireCondition(
    Number.isSafeInteger(payload.turn) && payload.turn > 0,
    "SCHEMA_INVALID",
  );
  requireCondition(
    roles[payload.parent_agent_id]?.includes(payload.agent_id),
    "UNAUTHORIZED_TARGET",
  );
  const parent = findSession(
    next,
    payload.parent_session_key,
    payload.parent_run_id,
  );
  // M10/T2: same load-bearing fallback order as admission — a bound
  // coordinator parent resolves to its bound coordinator identity, never to
  // Main/root. The parent session/run themselves are real (the coordinator's
  // live gateway run); only delegation lineage is absent, by design.
  requireCondition(
    parent.task_id === payload.task_id &&
      (parent.delegation?.agent_id ??
        parent.coordinatorRun?.coordinator ??
        task.root_agent_id) === payload.parent_agent_id,
    "LINEAGE_MISMATCH",
  );
  if (parent.delegation)
    requireCondition(
      parent.delegation.run_state === "RUNNING" &&
        parent.delegation.brief_revision === task.brief_revision,
    );
  // M10/T2-R2: a bound coordinator parent is fenced by EXECUTION GENERATION.
  //
  // A coordinator has no delegation run_state, so liveness cannot be read from
  // the delegation projection — and the historical binding deliberately
  // survives stale recovery as audit history. Therefore a superseded generation
  // must be refused here, at the authoritative commit path, and the task must
  // still be claimed by that coordinator.
  //
  // Lease liveness itself is queue-owned and is NOT re-derived in the reducer:
  // the queue is a separate store behind its own lock, so the ledger cannot see
  // a revocation atomically. That half of the fence is enforced one level up, at
  // the mutation seam (QueueManager.withExecutionFence), which holds the queue
  // critical section across this same commit. The two halves are complementary:
  // this one survives any caller that bypassed the queue seam, and the queue one
  // closes the revocation window.
  //
  // This throws inside the cloned projection, so a denied coordinator
  // reservation commits nothing at all — including the retry reconciliation
  // performed by the caller before this function ran.
  if (parent.coordinatorRun) {
    const boundAttempts = Object.keys(task.coordinator_runs ?? {})
      .map((key) => Number(key))
      .filter((value) => Number.isSafeInteger(value) && value >= 1);
    requireCondition(boundAttempts.length > 0, "LINEAGE_MISMATCH");
    // A superseded attempt never reserves again: once a higher attempt holds a
    // binding, the older generation is history only.
    requireCondition(
      Math.max(...boundAttempts) === parent.coordinatorRun.attempt,
      "SUPERSEDED_REVISION",
    );
    requireCondition(
      task.claimed_by === parent.coordinatorRun.coordinator,
      "POLICY_DENIED",
    );
  }
  const node = task.nodes.find((item) => item.node_id === payload.node_id);
  requireCondition(
    node && node.agent_id === payload.agent_id,
    "UNAUTHORIZED_TARGET",
  );
  // M10/T2: same root-like treatment as the guard: a bound coordinator parent
  // carries no parent-stack constraint. Target containment is enforced by the
  // canonical spawn-policy allowlist, checked by the caller before reserving.
  if (parent.delegation)
    requireCondition(
      node.stack_id === parent.delegation.stack_id,
      "UNAUTHORIZED_TARGET",
    );
  if (payload.parent_agent_id === "main") {
    if (task.current_stack && task.current_stack !== node.stack_id) {
      requireCondition(task.transitions_used < 10, "WORKFLOW_BUDGET_EXHAUSTED");
      task.transitions_used++;
    }
    // This authorization is journaled with the reservation, before native
    // dispatch. Failure/lost receipt cannot refund a committed transition.
    task.current_stack = node.stack_id;
  }
  const runs = Object.values(task.delegations);
  const currentRuns = runs.filter(
    (run) => run.brief_revision === task.brief_revision,
  );
  requireCondition(
    node.dependencies.every((id) =>
      currentRuns.some(
        (run) =>
          run.node_id === id && run.accepted_outcome_status === "COMPLETE",
      ),
    ),
    "MISSING_PREREQUISITE",
  );
  const previous = currentRuns.filter((run) => run.node_id === payload.node_id);
  requireCondition(
    !previous.some(
      (run) =>
        activeRun.has(run.run_state) ||
        run.accepted_outcome_status === "COMPLETE",
    ),
    "SPAWN_UNKNOWN",
  );
  // D19/D20: Enforce strict monotone attempt numbering — the attempt MUST be
  // exactly previous.length + 1. This prevents duplicate attempt numbers and
  // ensures exactly one authoritative run per node/attempt tuple.
  requireCondition(
    payload.attempt === previous.length + 1 && payload.attempt <= 3,
    "RETRY_EXHAUSTED",
  );
  // D20: Reject if any existing delegation already has this exact attempt number
  // for this node — guarantees one authoritative run per node/attempt.
  requireCondition(
    !previous.some((run) => run.attempt === payload.attempt),
    "SPAWN_UNKNOWN",
  );
  if (previous.length > 0) {
    const latest = previous.reduce((a, b) => (a.attempt > b.attempt ? a : b));
    // A model-reported missing prerequisite/approval is not a retryable run
    // failure. Only trusted transient execution evidence authorizes an
    // unchanged-contract retry; corrections require governed revision work.
    requireCondition(
      latest.run_state === "FAILED" &&
        latest.runtime_reason_code === "TRANSIENT_RUNTIME_FAILURE",
      "OWNER_DECISION_REQUIRED",
    );
  }
  // M8-055: re-derive through the same canonical builder the live adapter
  // used, so both paths validate an identical serialization. The delegation
  // identity derivation is stable across versions (it re-derives cleanly for
  // every pre-R4 reserve in the operational ledger), so it keeps binding
  // lineage on replay. The request-digest serialization changed in R4, so
  // anchored replay (option b migration) trusts the journaled digest: the
  // event digest plus the hash chain already bind those bytes against
  // tampering, and re-litigating an evolved serialization can only reject
  // legitimate history. New writes and tail replay stay exact.
  const rederived = buildSpawnProposal(payload);
  requireCondition(
    rederived.delegation_id === payload.delegation_id &&
      (replayAnchored || rederived.request_digest === payload.request_digest) &&
      !task.delegations[payload.delegation_id],
    "LINEAGE_MISMATCH",
  );
  requireCondition(
    !runs.some(
      (run) =>
        run.parent_run_id === payload.parent_run_id &&
        run.tool_call_id === payload.tool_call_id,
    ),
    "SPAWN_UNKNOWN",
  );
  requireCondition(task.delegated_runs_used < 72, "WORKFLOW_BUDGET_EXHAUSTED");
  requireCondition(
    runs.filter(
      (run) =>
        activeRun.has(run.run_state) &&
        run.parent_session_key === payload.parent_session_key,
    ).length < 4,
    "RUNTIME_CAPABILITY_MISMATCH",
  );
  task.delegated_runs_used++;
  task.delegations[payload.delegation_id] = {
    ...payload,
    stack_id: node.stack_id,
    run_state: "SPAWN_UNKNOWN",
  };
  return next;
}
