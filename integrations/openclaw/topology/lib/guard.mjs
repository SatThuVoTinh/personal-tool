import { Buffer } from "node:buffer";
import { canonicalHash, deriveDelegationId } from "./canonical.mjs";
import { readSnapshot, recordWorkflowEvent } from "./ledger.mjs";
import { findSession, ownerRunIds } from "./workflow.mjs";
import { validateContract } from "./schema.mjs";
import {
  createTrustedResultEnvelope,
  payloadDigest,
  sanitizeDelegationText,
  validateAgentClaim,
  normalizeAgentOutcome,
} from "./runtime.mjs";

function fail(code) {
  throw new Error(code);
}
function assert(value, code) {
  if (!value) fail(code);
}
const activeRun = new Set([
  "PENDING",
  "SPAWN_UNKNOWN",
  "RUNNING",
  "UNKNOWN",
  "BLOCKED",
]);
const nativeSpawnKeys = new Set([
  "task",
  "agentId",
  "runtime",
  "mode",
  "thread",
  "context",
  "sandbox",
  "cleanup",
  "taskName",
]);

// manifestFor is supplied by trusted builder/plugin code, never the model.
// It must return observed and expected hashes after workspace/tool validation.
export function createGovernanceGuard({ paths, manifestFor }) {
  function admitInitialBrief(owner, context, text) {
    assert(
      !owner.delegation && context.agentId === owner.task.root_agent_id,
      "UNAUTHORIZED_TARGET",
    );
    assert(
      typeof text === "string" && Buffer.byteLength(text, "utf8") <= 32768,
      "SCHEMA_INVALID",
    );
    let brief;
    try {
      brief = JSON.parse(text);
    } catch {
      fail("MISSING_PREREQUISITE");
    }
    validateContract("execution-brief", brief, 32768);
    // Admission facts are claims until matched to trusted state; a planner may
    // not skip Semantic/Data Plant by asserting VALID in its own brief.
    if (brief.semantic_contract_status === "VALID")
      assert(
        owner.task.semantic_contract_status === "VALID",
        "MISSING_PREREQUISITE",
      );
    if (brief.dataset_validation_status === "VALID")
      assert(
        owner.task.dataset_validation_status === "VALID",
        "MISSING_PREREQUISITE",
      );
    assert(
      brief.task_id === owner.task_id &&
        brief.brief_revision === 1 &&
        brief.brief_state === "ACTIVE" &&
        brief.workflow_status === "ACTIVE",
      "LINEAGE_MISMATCH",
    );
    for (const key of ["origin", "origin_principal_ref", "origin_message_id"])
      assert(brief[key] === owner.task[key], "LINEAGE_MISMATCH");
    assert(
      brief.input_refs.length === 0 &&
        brief.mandatory_decision_evidence.length === 0,
      "REFERENCE_INVALID",
    );
    assert(
      sanitizeDelegationText(brief.inputs) === brief.inputs,
      "POLICY_DENIED",
    );
    if (context.agentId !== "main") {
      const permitted =
        context.agentId === "o1"
          ? ["semantic", "intelligence", "decision"]
          : context.agentId === "o2"
            ? ["infrastructure", "data_plant"]
            : [];
      assert(
        new Set(brief.nodes.map((node) => node.stack_id)).size === 1 &&
          brief.nodes.every((node) => permitted.includes(node.stack_id)),
        "UNAUTHORIZED_TARGET",
      );
    }
    const nodes = brief.nodes.map((node) => {
      for (const field of ["inputs", "constraints", "validation_criteria"])
        assert(
          sanitizeDelegationText(node[field]) === node[field],
          "POLICY_DENIED",
        );
      if (node.stack_id === "decision")
        assert(node.agent_id === "main", "UNAUTHORIZED_TARGET");
      const dependencies = node.dependencies.map((id) =>
        brief.nodes.find((item) => item.node_id === id),
      );
      assert(dependencies.every(Boolean), "MISSING_PREREQUISITE");
      if (
        node.stack_id === "data_plant" &&
        brief.semantic_contract_status !== "VALID"
      )
        assert(
          dependencies.some((item) => item.stack_id === "semantic"),
          "MISSING_PREREQUISITE",
        );
      if (
        node.stack_id === "intelligence" &&
        brief.dataset_validation_status !== "VALID"
      )
        assert(
          dependencies.some((item) => item.stack_id === "data_plant"),
          "MISSING_PREREQUISITE",
        );
      return {
        node_id: node.node_id,
        agent_id: node.agent_id,
        stack_id: node.stack_id,
        dependencies: node.dependencies,
        required: node.required,
        input_digest: canonicalHash("zink-input-v1", node.inputs),
        constraints_digest: canonicalHash(
          "zink-constraints-v1",
          node.constraints,
        ),
        validation_digest: canonicalHash(
          "zink-validation-v1",
          node.validation_criteria,
        ),
      };
    });
    recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
      task_id: owner.task_id,
      brief_revision: 1,
      nodes,
    });
  }
  function manifest(agentId) {
    const value = manifestFor(agentId);
    assert(
      value &&
        /^[a-f0-9]{64}$/u.test(value.expected_governance_hash) &&
        value.expected_governance_hash === value.observed_governance_hash,
      "GOVERNANCE_HASH_MISMATCH",
    );
    return value;
  }
  return {
    beforeRunEnd(event, context) {
      const owner = findSession(
        readSnapshot(paths),
        context.sessionKey,
        context.runId,
      );
      assert(
        (owner.delegation?.agent_id ?? owner.task.root_agent_id) ===
          context.agentId,
        "LINEAGE_MISMATCH",
      );
      // Delegated completion is accepted on the pre-announce path, never twice.
      if (owner.delegation || event.yielded === true) return { allow: true };
      assert(event.success === true, "EXECUTION_STATE_UNKNOWN");
      assert(
        owner.task.workflow_status === "ACTIVE" &&
          owner.task.brief_state === "ACTIVE",
        "INVALID_STATE_TRANSITION",
      );
      const message = event.lastAssistant;
      assert(
        message?.role === "assistant" && Array.isArray(message.content),
        "SCHEMA_INVALID",
      );
      // Valid-looking JSON in an errored/truncated provider response is not a
      // successful terminal response. Native execution booleans alone do not
      // establish the provider's terminal stop reason.
      assert(message.stopReason === "stop", "VALIDATION_FAILED");
      assert(
        message.content.every((part) =>
          ["text", "thinking"].includes(part?.type),
        ),
        "SCHEMA_INVALID",
      );
      let text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text.startsWith("```json")) {
        text = text.slice(7);
        if (text.endsWith("```")) text = text.slice(0, -3);
        text = text.trim();
      } else if (text.startsWith("```")) {
        text = text.slice(3);
        if (text.endsWith("```")) text = text.slice(0, -3);
        text = text.trim();
      }
      assert(Buffer.byteLength(text, "utf8") <= 65536, "SCHEMA_INVALID");
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        fail("SCHEMA_INVALID");
      }
      validateAgentClaim(payload);
      for (const field of [
        payload.output,
        payload.agent_self_validation,
        ...payload.assumptions,
        ...payload.limitations,
        ...payload.requested_prerequisites.map((item) => item.requirement),
      ])
        assert(sanitizeDelegationText(field) === field, "POLICY_DENIED");
      assert(
        (payload.claimed_artifact_refs ?? []).length === 0,
        "REFERENCE_INVALID",
      );
      const accepted = normalizeAgentOutcome(payload);
      recordWorkflowEvent(paths, "WORKFLOW_ROOT_RESULT_RECORDED", {
        task_id: owner.task_id,
        brief_revision: owner.task.brief_revision,
        native_run_id: context.runId,
        agent_id: context.agentId,
        payload_digest: payloadDigest(payload),
        outcome_status: accepted.outcome,
        reason_code: accepted.reason,
        governance_hash: manifest(context.agentId).expected_governance_hash,
      });
      return { allow: true };
    },
    beforeRun(_event, context) {
      const snapshot = readSnapshot(paths);
      let owner;
      try {
        owner = findSession(snapshot, context.sessionKey, context.runId);
      } catch {
        const candidates = Object.entries(snapshot.tasks).filter(([, task]) => {
          const entry = task.continuations?.[context.runId];
          return (
            entry && !entry.started && entry.session_key === context.sessionKey
          );
        });
        assert(candidates.length === 1, "EXECUTION_STATE_UNKNOWN");
        const [task_id] = candidates[0];
        assert(
          context.inputProvenance?.kind === "inter_session" &&
            context.inputProvenance.sourceTool === "subagent_announce",
          "LINEAGE_MISMATCH",
        );
        const next = recordWorkflowEvent(
          paths,
          "WORKFLOW_CONTINUATION_STARTED",
          {
            task_id,
            next_run_id: context.runId,
            session_key: context.sessionKey,
            source_session_key: context.inputProvenance.sourceSessionKey,
            agent_id: context.agentId,
          },
        );
        owner = findSession(next, context.sessionKey, context.runId);
      }
      assert(
        owner.task.workflow_status === "ACTIVE" &&
          owner.task.brief_state === "ACTIVE" &&
          (owner.delegation?.agent_id ?? owner.task.root_agent_id) ===
            context.agentId &&
          (!owner.delegation || owner.delegation.run_state === "RUNNING"),
        "INVALID_STATE_TRANSITION",
      );
      manifest(context.agentId);
      return { allow: true };
    },
    beforeToolCall(event, context, signal) {
      assert(!signal?.aborted, "EXECUTION_STATE_UNKNOWN");
      let snapshot = readSnapshot(paths);
      let owner = findSession(snapshot, context.sessionKey, context.runId);
      if (
        event.toolName === "sessions_spawn" &&
        owner.task.nodes.length === 0
      ) {
        admitInitialBrief(owner, context, event.assistantText);
        snapshot = readSnapshot(paths);
        owner = findSession(snapshot, context.sessionKey, context.runId);
      }
      const task = owner.task;
      assert(
        (owner.delegation?.agent_id ?? task.root_agent_id) === context.agentId,
        "LINEAGE_MISMATCH",
      );
      assert(
        task.workflow_status === "ACTIVE" && task.brief_state === "ACTIVE",
        "INVALID_STATE_TRANSITION",
      );
      if (owner.delegation)
        assert(
          owner.delegation.run_state === "RUNNING" &&
            owner.delegation.brief_revision === task.brief_revision,
          "SUPERSEDED_REVISION",
        );
      const governance = manifest(context.agentId);
      assert(
        governance.allowed_tools?.includes(event.toolName),
        "RUNTIME_CAPABILITY_MISMATCH",
      );
      if (event.toolName === "sessions_yield") {
        assert(
          event.batchToolNames.length === 1 &&
            ["main", "o1", "o2"].includes(context.agentId),
          "POLICY_DENIED",
        );
        const children = Object.values(task.delegations).filter(
          (run) =>
            ownerRunIds(owner).includes(run.parent_run_id) &&
            run.parent_session_key === context.sessionKey &&
            run.brief_revision === task.brief_revision &&
            activeRun.has(run.run_state),
        );
        assert(
          children.length > 0 &&
            children.every(
              (run) =>
                run.run_state === "RUNNING" &&
                run.native_run_id &&
                (run.parent_run_id !== context.runId || run.turn < event.turn),
            ),
          "SPAWN_UNKNOWN",
        );
        return { allow: true };
      }
      if (event.toolName !== "sessions_spawn") {
        assert(
          ["session_status", "agents_list"].includes(event.toolName),
          "POLICY_DENIED",
        );
        // No arbitrary cross-session inspection or model override through status.
        assert(
          !event.params ||
            Object.keys(event.params).length === 0 ||
            (event.toolName === "session_status" &&
              (event.params.sessionKey === undefined ||
                event.params.sessionKey === "current" ||
                event.params.sessionKey === context.sessionKey)),
          "POLICY_DENIED",
        );
        return { allow: true };
      }
      const params = event.params;
      assert(
        params &&
          Object.keys(params).every((key) => nativeSpawnKeys.has(key)) &&
          (params.runtime === "subagent" || params.runtime === undefined) &&
          (params.mode === "run" || params.mode === undefined) &&
          (params.thread === false || params.thread === undefined) &&
          params.context === "isolated" &&
          params.sandbox === "require" &&
          (params.cleanup === "keep" || params.cleanup === undefined) &&
          (params.taskName === undefined ||
            typeof params.taskName === "string") &&
          typeof params.agentId === "string" &&
          typeof params.task === "string",
        "UNAUTHORIZED_TARGET",
      );
      assert(Buffer.byteLength(params.task, "utf8") <= 32768, "SCHEMA_INVALID");
      let proposal;
      try {
        proposal = JSON.parse(params.task);
      } catch {
        fail("SCHEMA_INVALID");
      }
      validateContract("delegation-proposal", proposal, 32768);
      const node = task.nodes.find((item) => item.node_id === proposal.node_id);
      assert(node && node.agent_id === params.agentId, "UNAUTHORIZED_TARGET");
      if (owner.delegation)
        assert(
          node.stack_id === owner.delegation.stack_id,
          "UNAUTHORIZED_TARGET",
        );
      const handoff = {
        ...proposal,
        task_id: owner.task_id,
        brief_revision: task.brief_revision,
        parent_agent_id: context.agentId,
        target_agent_id: params.agentId,
        target_stack: node.stack_id,
        expected_governance_hash: manifest(params.agentId)
          .expected_governance_hash,
        attempt:
          Object.values(task.delegations).filter(
            (item) =>
              item.brief_revision === task.brief_revision &&
              item.node_id === node.node_id,
          ).length + 1,
        remaining_task_budget: {
          revisions: 16 - task.revisions_used,
          transitions:
            10 -
            task.transitions_used -
            (context.agentId === "main" &&
            task.current_stack &&
            task.current_stack !== node.stack_id
              ? 1
              : 0),
          delegated_runs: 71 - task.delegated_runs_used,
        },
        requested_output_schema: "agent-result-payload.schema.json",
      };
      handoff.delegation_id = deriveDelegationId({
        ...handoff,
        agent_id: params.agentId,
      });
      assert(
        Object.values(handoff.remaining_task_budget).every(
          (value) => value >= 0,
        ),
        "WORKFLOW_BUDGET_EXHAUSTED",
      );
      validateContract("delegation-envelope", handoff, 32768);
      for (const field of ["inputs", "constraints", "validation_criteria"])
        assert(
          sanitizeDelegationText(handoff[field]) === handoff[field],
          "POLICY_DENIED",
        );
      assert(
        canonicalHash("zink-input-v1", handoff.inputs) === node.input_digest &&
          canonicalHash("zink-constraints-v1", handoff.constraints) ===
            node.constraints_digest &&
          canonicalHash("zink-validation-v1", handoff.validation_criteria) ===
            node.validation_digest,
        "LINEAGE_MISMATCH",
      );
      // T2 references must already have a trusted acceptance record. A model's
      // VALID field alone never authorizes consuming an artifact.
      for (const ref of handoff.input_refs)
        assert(
          task.accepted_reference_digests?.[ref.ref_id] ===
            canonicalHash("zink-reference-v1", ref),
          "REFERENCE_INVALID",
        );
      const spec = {
        task_id: owner.task_id,
        brief_revision: task.brief_revision,
        node_id: node.node_id,
        agent_id: params.agentId,
        parent_agent_id: context.agentId,
        parent_session_key: context.sessionKey,
        parent_run_id: context.runId,
        tool_call_id: event.toolCallId,
        turn: event.turn,
        attempt: handoff.attempt,
        delegation_id: handoff.delegation_id,
        expected_governance_hash: handoff.expected_governance_hash,
        request_digest: canonicalHash("zink-delegation-id-v1", handoff),
      };
      assert(
        deriveDelegationId(spec) === spec.delegation_id,
        "LINEAGE_MISMATCH",
      );
      recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", spec);
      return {
        allow: true,
        spawnLabel: spec.delegation_id,
        spawnTask: JSON.stringify(handoff),
      };
    },
    beforeAnnounce(event) {
      const snapshot = readSnapshot(paths);
      const owner = findSession(
        snapshot,
        event.childSessionKey,
        event.childRunId,
        true,
      );
      const run = owner.delegation;
      assert(
        run && run.parent_session_key === event.requesterSessionKey,
        "LINEAGE_MISMATCH",
      );
      if (
        run.run_state === "CANCELLED" ||
        run.brief_revision !== owner.task.brief_revision ||
        owner.task.brief_state !== "ACTIVE"
      )
        return { action: "discard" };
      // Native wake IDs are derived by the pinned runtime, not the model.
      // Only committed child acceptance can authorize a continuation.
      if (event.phase === "descendant_wake") {
        const children = Object.values(owner.task.delegations).filter((item) =>
          ownerRunIds(owner).includes(item.parent_run_id),
        );
        assert(
          children.length > 0 &&
            children.every(
              (item) =>
                item.run_state === "COMPLETE" && item.accepted_payload_digest,
            ),
          "MISSING_PREREQUISITE",
        );
        recordWorkflowEvent(paths, "WORKFLOW_CONTINUATION_AUTHORIZED", {
          task_id: owner.task_id,
          brief_revision: owner.task.brief_revision,
          session_key: run.child_session_key,
          previous_run_id: run.native_run_id,
          next_run_id: event.nextRunId,
          source_session_key: run.child_session_key,
          trigger_run_id: run.native_run_id,
        });
        return {
          action: "deliver",
          receipt: JSON.stringify({
            task_id: owner.task_id,
            brief_revision: owner.task.brief_revision,
            accepted_children: children.map((item) => ({
              node_id: item.node_id,
              native_run_id: item.native_run_id,
              payload_digest: item.accepted_payload_digest,
              outcome_status: item.accepted_outcome_status,
            })),
          }),
        };
      }
      assert(event.phase === "completion", "EXECUTION_STATE_UNKNOWN");
      assert(
        typeof event.findings === "string" &&
          Buffer.byteLength(event.findings, "utf8") <= 65536,
        "SCHEMA_INVALID",
      );
      let findingsText = event.findings.trim();
      if (findingsText.startsWith("```json")) {
        findingsText = findingsText.slice(7);
        if (findingsText.endsWith("```")) findingsText = findingsText.slice(0, -3);
        findingsText = findingsText.trim();
      } else if (findingsText.startsWith("```")) {
        findingsText = findingsText.slice(3);
        if (findingsText.endsWith("```")) findingsText = findingsText.slice(0, -3);
        findingsText = findingsText.trim();
      }
      let payload;
      try {
        payload = JSON.parse(findingsText);
      } catch {
        fail("SCHEMA_INVALID");
      }
      validateAgentClaim(payload);
      const digest = payloadDigest(payload);
      const duplicate = run.accepted_payload_digest === digest;
      if (duplicate && !event.nextRunId) return { action: "discard" };
      const governance = manifest(run.agent_id);
      assert(
        governance.expected_governance_hash === run.expected_governance_hash,
        "GOVERNANCE_HASH_MISMATCH",
      );
      assert(event.outcome?.status === "ok", "VALIDATION_FAILED");
      assert(
        sanitizeDelegationText(payload.output) === payload.output,
        "POLICY_DENIED",
      );
      assert(
        (payload.claimed_artifact_refs ?? []).length === 0,
        "REFERENCE_INVALID",
      );
      // Explicit schema validation is evidence, never agent_self_validation.
      // Tasks with extra semantic checks must supply trusted validation evidence.
      const node = owner.task.nodes.find(
        (item) => item.node_id === run.node_id,
      );
      assert(
        node?.validation_digest ===
          canonicalHash(
            "zink-validation-v1",
            "agent-result-payload.schema.json",
          ),
        "VALIDATION_FAILED",
      );
      const children = Object.values(owner.task.delegations).filter((item) =>
        [run.native_run_id, ...(run.previous_native_run_ids ?? [])].includes(
          item.parent_run_id,
        ),
      );
      assert(
        !children.some((item) => activeRun.has(item.run_state)),
        "MISSING_PREREQUISITE",
      );
      if (payload.outcome_claim === "COMPLETE")
        assert(
          children.every(
            (item) =>
              !owner.task.nodes.find(
                (candidate) => candidate.node_id === item.node_id,
              )?.required || item.accepted_outcome_status === "COMPLETE",
          ),
          "MISSING_PREREQUISITE",
        );
      const envelope = createTrustedResultEnvelope({
        payload,
        lineage: { ...run, native_run_id: run.native_run_id },
        governance,
        runState: "COMPLETE",
        verifierValidation: "VALID",
        resultAcceptance: "ACCEPTED",
        ...(duplicate ? { receivedAt: run.accepted_received_at } : {}),
      });
      const accepted = duplicate
        ? snapshot
        : recordWorkflowEvent(paths, "WORKFLOW_RESULT_RECORDED", {
            task_id: owner.task_id,
            envelope,
          });
      if (run.accepted_payload_digest && run.accepted_payload_digest !== digest)
        fail("DUPLICATE_RESULT_CONFLICT");
      assert(
        accepted.tasks[owner.task_id].delegations[run.delegation_id]
          .accepted_payload_digest === digest,
        "EXECUTION_STATE_UNKNOWN",
      );
      if (event.nextRunId) {
        const task = accepted.tasks[owner.task_id];
        const existingContinuation = task.continuations?.[event.nextRunId];
        if (existingContinuation) {
          assert(
            existingContinuation.trigger_run_id === run.native_run_id &&
              existingContinuation.source_session_key ===
                run.child_session_key &&
              existingContinuation.session_key === run.parent_session_key,
            "LINEAGE_MISMATCH",
          );
        } else {
          const parent =
            task.root_session_key === run.parent_session_key
              ? { native_run_id: task.root_run_id }
              : Object.values(task.delegations).find(
                  (item) =>
                    item.child_session_key === run.parent_session_key &&
                    item.run_state === "RUNNING",
                );
          assert(parent, "LINEAGE_MISMATCH");
          recordWorkflowEvent(paths, "WORKFLOW_CONTINUATION_AUTHORIZED", {
            task_id: owner.task_id,
            brief_revision: task.brief_revision,
            session_key: run.parent_session_key,
            previous_run_id: parent.native_run_id,
            next_run_id: event.nextRunId,
            source_session_key: run.child_session_key,
            trigger_run_id: run.native_run_id,
          });
        }
      }
      return {
        action: "deliver",
        receipt: JSON.stringify({
          envelope,
          output: payload.output,
          assumptions: payload.assumptions,
          limitations: payload.limitations,
        }),
      };
    },
  };
}
