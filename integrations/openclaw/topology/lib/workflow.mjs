import { deriveDelegationId, deriveTaskId } from "./canonical.mjs";
import { validateContract } from "./schema.mjs";
import { outcomeReasonAllowed, workflowAggregate } from "./runtime.mjs";

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
  }
  requireCondition(matches.length === 1, "EXECUTION_STATE_UNKNOWN");
  return matches[0];
}

// D07: ownerRunIds returns only the current run ID by default to prevent
// generation-skip lineage matching. Pass includePrevious=true only when
// explicit continuation history traversal is authorized (findSession does so).
export function ownerRunIds(owner, includePrevious = true) {
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

// Pure projection of metadata-only, trusted events. No model output or prompt
// body belongs here; the guard validates semantic work before emitting events.
export function applyWorkflowEvent(snapshot, type, payload, eventTimestamp = null) {
  const next = globalThis.structuredClone(snapshot);
  const eventTime = eventTimestamp || new Date().toISOString();
  if (type === "WORKFLOW_OPENED") {
    exactKeys(payload, [
      "task_id",
      "origin",
      "origin_principal_ref",
      "origin_message_id",
      "root_agent_id",
      "root_session_key",
      "root_run_id",
    ]);
    requireCondition(payload.origin === "discord", "POLICY_DENIED");
    requireCondition(
      /^[1-9][0-9]{16,19}$/u.test(payload.origin_message_id) &&
        typeof payload.origin_message_id === "string",
      "SCHEMA_INVALID",
    );
    digest(payload.origin_principal_ref);
    digest(payload.task_id);
    identifier(payload.root_run_id);
    identifier(payload.root_session_key);
    requireCondition(
      Object.hasOwn(roles, payload.root_agent_id),
      "UNAUTHORIZED_TARGET",
    );
    requireCondition(
      deriveTaskId(payload) === payload.task_id,
      "LINEAGE_MISMATCH",
    );
    if (Object.hasOwn(next.tasks, payload.task_id)) return next;
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
  digest(payload.task_id);
  const task = next.tasks[payload.task_id];
  requireCondition(
    task?.workflow_status && task.brief_state,
    "EXECUTION_STATE_UNKNOWN",
  );
  if (type === "WORKFLOW_NATIVE_ENDED") {
    exactKeys(payload, [
      "task_id",
      "native_run_id",
      "child_session_key",
      "parent_session_key",
      "outcome",
    ]);
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
    run.run_state = "UNKNOWN";
    run.runtime_reason_code =
      payload.outcome === "timeout" ? "RUN_TIMEOUT" : "EXECUTION_STATE_UNKNOWN";
    // D04: Stamp recovery metadata so operators can correlate and act.
    run.recovery_needed_at = payload.recorded_at ?? "1970-01-01T00:00:00.000Z";
    run.recovery_reason = payload.outcome;
    task.workflow_status = "BLOCKED";
    // Run observation and workflow suspension have different meanings: a
    // timeout does not establish terminal failure or safe retry of the task.
    task.reason_code = "EXECUTION_STATE_UNKNOWN";
    return next;
  }
  if (type === "WORKFLOW_CANCELLED") {
    exactKeys(payload, ["task_id", "reason_code"]);
    requireCondition(
      ["OWNER_CANCELLED", "PARENT_CANCELLED"].includes(payload.reason_code),
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
    task.root_result = { ...payload };
    task.workflow_status = payload.outcome_status;
    task.reason_code = payload.reason_code;
    if (terminal.has(task.workflow_status)) task.brief_state = "CLOSED";
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
    task.workflow_status = "REJECTED";
    task.brief_state = "CLOSED";
    task.user_rejected_at = eventTime;
    task.rejection_reason = payload.reason;
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
  if (type === "WORKFLOW_TASK_CLAIMED") {
    // D01/D02: CLAIM is only valid from QUEUED or WAITING_FOR_WORKER.
    // ACTIVE is not a valid pre-claim state — allowing it bypasses the
    // explicit approval gate (APPROVE -> QUEUED -> CLAIM).
    exactKeys(payload, ["task_id", "worker_id"]);
    requireCondition(
      task.workflow_status === "QUEUED" ||
        task.workflow_status === "WAITING_FOR_WORKER",
      "INVALID_STATE_TRANSITION",
    );
    task.workflow_status = "EXECUTING";
    task.claimed_by = payload.worker_id;
    task.claimed_at = eventTime;
    return next;
  }
  if (type === "WORKFLOW_USER_QUESTION_RECORDED") {
    exactKeys(payload, ["task_id", "agent_id", "question"]);
    requireCondition(
      task.workflow_status === "EXECUTING",
      "INVALID_STATE_TRANSITION",
    );
    task.workflow_status = "WAITING_FOR_USER";
    task.waiting_question = payload.question;
    return next;
  }
  if (type === "WORKFLOW_USER_ANSWER_RECORDED") {
    exactKeys(
      payload,
      ["task_id", "answer"],
      ["user_principal_ref", "message_id", "thread_id"],
    );
    requireCondition(
      task.workflow_status === "WAITING_FOR_USER",
      "INVALID_STATE_TRANSITION",
    );
    task.workflow_status = "EXECUTING";
    task.user_answer = payload.answer;
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
    // A delayed receipt supplies identity but cannot revive cancelled work.
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
      if (run.accepted_payload_digest) {
        if (
          run.accepted_payload_digest !== envelope.payload_digest &&
          !terminal.has(task.workflow_status)
        )
          task.workflow_status = "BLOCKED";
        return next;
      }
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
        "worker_id",
        "attempt",
        "payload_digest",
        "technical_status",
        "business_status",
        "artifact_path",
        "recorded_at",
      ],
    );
    task.workflow_status = "RESULT_PENDING_REVIEW";
    task.result_pending_at = payload.recorded_at ?? "1970-01-01T00:00:00.000Z";
    if (payload.payload_digest)
      task.execution_payload_digest = payload.payload_digest;
    return next;
  }
  requireCondition(
    task.workflow_status === "ACTIVE" && task.brief_state === "ACTIVE",
  );
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
    // D09: Validate owner_attempt matches the delegation's recorded attempt.
    if (payload.owner_attempt !== undefined && owner.delegation) {
      requireCondition(
        payload.owner_attempt === owner.delegation.attempt,
        "LINEAGE_MISMATCH",
      );
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
    exactKeys(payload, ["task_id", "brief_revision", "nodes"]);
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
      // be owned by its agent_id per the canonical AGENT_STACK_POLICY.
      // This prevents structurally impossible DAGs (e.g., o1 on semantic stack).
      const agentStacks = {
        main: [
          "infrastructure",
          "data_plant",
          "semantic",
          "intelligence",
          "decision",
        ],
        o1: ["infrastructure", "data_plant"],
        o2: ["semantic", "intelligence", "decision"],
        excel: ["data_plant"],
        "power-bi": ["intelligence"],
        sql: ["infrastructure", "data_plant"],
        python: ["data_plant", "intelligence"],
      };
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
    return next;
  }
  if (type === "WORKFLOW_SPAWN_RESERVED") {
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
    requireCondition(
      parent.task_id === payload.task_id &&
        (parent.delegation?.agent_id ?? task.root_agent_id) ===
          payload.parent_agent_id,
      "LINEAGE_MISMATCH",
    );
    if (parent.delegation)
      requireCondition(
        parent.delegation.run_state === "RUNNING" &&
          parent.delegation.brief_revision === task.brief_revision,
      );
    const node = task.nodes.find((item) => item.node_id === payload.node_id);
    requireCondition(
      node && node.agent_id === payload.agent_id,
      "UNAUTHORIZED_TARGET",
    );
    if (parent.delegation)
      requireCondition(
        node.stack_id === parent.delegation.stack_id,
        "UNAUTHORIZED_TARGET",
      );
    if (payload.parent_agent_id === "main") {
      if (task.current_stack && task.current_stack !== node.stack_id) {
        requireCondition(
          task.transitions_used < 10,
          "WORKFLOW_BUDGET_EXHAUSTED",
        );
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
    const previous = currentRuns.filter(
      (run) => run.node_id === payload.node_id,
    );
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
    requireCondition(
      deriveDelegationId(payload) === payload.delegation_id &&
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
    requireCondition(
      task.delegated_runs_used < 72,
      "WORKFLOW_BUDGET_EXHAUSTED",
    );
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
  fail("EXECUTION_STATE_UNKNOWN");
}
