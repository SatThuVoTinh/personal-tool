import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  buildSpawnProposal,
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";

let snowflake = 95000000000000001n;
const nextMessageId = () => String(snowflake++);

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "m8-t2-anchored-"));
}

function node(agentId) {
  return {
    node_id: agentId,
    agent_id: agentId,
    stack_id: "data_plant",
    dependencies: [],
    required: true,
    input_digest: canonicalHash("zink-input-v1", "work"),
    constraints_digest: canonicalHash("zink-constraints-v1", "{}"),
    validation_digest: canonicalHash(
      "zink-validation-v1",
      "agent-result-payload.schema.json",
    ),
  };
}

function openTask(paths, status = "VALID") {
  const origin = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: nextMessageId(),
  };
  const taskId = deriveTaskId(origin);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...origin,
    task_id: taskId,
    root_agent_id: "main",
    root_session_key: "main-session",
    root_run_id: "main-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
    task_id: taskId,
    brief_revision: 1,
    semantic_contract_status: status,
    nodes: [node("o1")],
  });
  return taskId;
}

function approve(paths, taskId) {
  recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
    task_id: taskId,
    actor: "user",
    channel: "approvals",
    decision: "APPROVE",
  });
}

function proposal(taskId) {
  return buildSpawnProposal({
    task_id: taskId,
    brief_revision: 1,
    node_id: "o1",
    agent_id: "o1",
    parent_agent_id: "main",
    parent_session_key: "main-session",
    parent_run_id: "main-run",
    tool_call_id: "call-0",
    turn: 1,
    attempt: 1,
    expected_governance_hash: governanceHash("o1"),
  });
}

const ANCHORED = { replayAnchored: true };

describe("M8/T2.2-R4 option (b) — anchored replay trusts admission", () => {
  it("an unapproved reserve replays anchored but is refused everywhere strict", () => {
    // The live ledger journals reserves admitted under a mode that approved
    // via Discord outside the journal. Re-reading them must succeed; writing
    // or re-deciding them must stay refused.
    const root = fixture();
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);
      const taskId = openTask(paths);
      const state = readSnapshot(paths);
      // Strict (default): the writer path refuses ...
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_SPAWN_RESERVED",
            proposal(taskId),
          ),
        { code: "AUTH_APPROVAL_REQUIRED" },
      );
      // ... and so does a direct strict apply.
      assert.throws(
        () =>
          applyWorkflowEvent(
            state,
            "WORKFLOW_SPAWN_RESERVED",
            proposal(taskId),
          ),
        { code: "AUTH_APPROVAL_REQUIRED" },
      );
      // Anchored replay trusts the admission and applies the transition.
      const next = applyWorkflowEvent(
        state,
        "WORKFLOW_SPAWN_RESERVED",
        proposal(taskId),
        null,
        ANCHORED,
      );
      const runs = Object.values(next.tasks[taskId].delegations);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].node_id, "o1");
      assert.equal(next.tasks[taskId].delegated_runs_used, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a digest-less anchored verdict replays; digests still bind in both modes", () => {
    // Pre-R4 verdicts name a result id with a null digest and no journaled
    // root result to bind it to. The id linkage is trusted for anchored
    // history; digest equality still binds whenever a digest is supplied.
    const root = fixture();
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);
      const taskId = openTask(paths);
      approve(paths, taskId);
      recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
        task_id: taskId,
        agent_id: "o1",
      });
      recordWorkflowEvent(paths, "WORKFLOW_RESULT_RECORDED", {
        task_id: taskId,
        attempt: 1,
        payload_digest: "d".repeat(64),
        technical_status: "PASS",
        business_status: "PASS",
      });
      const verdict = {
        task_id: taskId,
        actor: "user",
        channel: "results",
        decision: "ACCEPT",
        result_id: "7",
        result_digest: null,
      };
      const state = readSnapshot(paths);
      assert.throws(
        () =>
          applyWorkflowEvent(state, "WORKFLOW_USER_RESULT_ACCEPTED", verdict),
        { code: "RESULT_MISMATCH" },
      );
      const next = applyWorkflowEvent(
        state,
        "WORKFLOW_USER_RESULT_ACCEPTED",
        verdict,
        null,
        ANCHORED,
      );
      assert.equal(next.tasks[taskId].workflow_status, "COMPLETE");
      // A supplied digest that does not match still fails anchored too.
      assert.throws(
        () =>
          applyWorkflowEvent(
            state,
            "WORKFLOW_USER_RESULT_ACCEPTED",
            { ...verdict, result_digest: "0".repeat(64) },
            null,
            ANCHORED,
          ),
        { code: "RESULT_MISMATCH" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a re-serialized request digest is trusted anchored; delegation identity is not", () => {
    // The request-digest serialization changed in R4 while the delegation
    // identity derivation did not. Anchored replay keeps verifying the
    // stable binding and trusts only the version-fragile serialization.
    const root = fixture();
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);
      const taskId = openTask(paths);
      approve(paths, taskId);
      const state = readSnapshot(paths);
      const good = proposal(taskId);
      const tamperedDigest = {
        ...good,
        request_digest: "e".repeat(64),
      };
      assert.throws(
        () =>
          applyWorkflowEvent(state, "WORKFLOW_SPAWN_RESERVED", tamperedDigest),
        { code: "LINEAGE_MISMATCH" },
      );
      const next = applyWorkflowEvent(
        state,
        "WORKFLOW_SPAWN_RESERVED",
        tamperedDigest,
        null,
        ANCHORED,
      );
      assert.equal(
        Object.values(next.tasks[taskId].delegations)[0].delegation_id,
        good.delegation_id,
      );
      // A tampered delegation identity fails in BOTH modes: that derivation
      // is stable, so there is nothing version-fragile to trust.
      const tamperedId = { ...good, delegation_id: "f".repeat(64) };
      assert.throws(
        () => applyWorkflowEvent(state, "WORKFLOW_SPAWN_RESERVED", tamperedId),
        { code: "LINEAGE_MISMATCH" },
      );
      assert.throws(
        () =>
          applyWorkflowEvent(
            state,
            "WORKFLOW_SPAWN_RESERVED",
            tamperedId,
            null,
            ANCHORED,
          ),
        { code: "LINEAGE_MISMATCH" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an absent owner attempt replays anchored; strict paths still demand it", () => {
    // Continuations journaled before the attempt-binding field existed carry
    // none. Strict paths (writes, tail, direct applies) demand it — the writer
    // emits it whenever the owner is a delegation, so an omission there is
    // hand-built. Anchored replay tolerates absence (option b migration). A
    // present-but-stale attempt is denied in every mode.
    const taskId = "d".repeat(64);
    const state = {
      tasks: {
        [taskId]: {
          task_id: taskId,
          workflow_status: "QUEUED",
          brief_state: "ACTIVE",
          brief_revision: 1,
          approved_at: "2026-09-01T00:00:00.000Z",
          root_agent_id: "main",
          root_session_key: "root-session",
          root_run_id: "root-run",
          revisions_used: 1,
          transitions_used: 0,
          delegated_runs_used: 1,
          nodes: [],
          continuations: {},
          delegations: {
            dOwn: {
              delegation_id: "d-own",
              child_session_key: "sk-child",
              native_run_id: "run-child",
              parent_session_key: "sk-parent",
              agent_id: "o1",
              node_id: "n1",
              attempt: 1,
              run_state: "RUNNING",
              brief_revision: 1,
              stack_id: "data_plant",
              expected_governance_hash: "e".repeat(64),
            },
            dTrig: {
              delegation_id: "d-trig",
              child_session_key: "sk-src",
              native_run_id: "run-trig",
              parent_session_key: "sk-child",
              agent_id: "python",
              node_id: "n2",
              attempt: 1,
              run_state: "COMPLETE",
              accepted_payload_digest: "f".repeat(64),
              brief_revision: 1,
              stack_id: "data_plant",
              expected_governance_hash: "e".repeat(64),
            },
          },
        },
      },
    };
    const continuation = {
      task_id: taskId,
      brief_revision: 1,
      session_key: "sk-child",
      previous_run_id: "run-child",
      next_run_id: "run-next",
      source_session_key: "sk-src",
      trigger_run_id: "run-trig",
    };
    const next = applyWorkflowEvent(
      state,
      "WORKFLOW_CONTINUATION_AUTHORIZED",
      continuation,
      null,
      ANCHORED,
    );
    assert.equal(next.tasks[taskId].continuations["run-next"].started, false);
    // Strict (default): absence is denied, exactly as the d2 lane pins for
    // new writes.
    assert.throws(
      () =>
        applyWorkflowEvent(
          state,
          "WORKFLOW_CONTINUATION_AUTHORIZED",
          continuation,
        ),
      { code: "LINEAGE_MISMATCH" },
    );
    assert.throws(
      () =>
        applyWorkflowEvent(state, "WORKFLOW_CONTINUATION_AUTHORIZED", {
          ...continuation,
          owner_attempt: 999,
        }),
      { code: "LINEAGE_MISMATCH" },
    );
    assert.throws(
      () =>
        applyWorkflowEvent(
          state,
          "WORKFLOW_CONTINUATION_AUTHORIZED",
          { ...continuation, owner_attempt: 999 },
          null,
          ANCHORED,
        ),
      { code: "LINEAGE_MISMATCH" },
    );
  });
});
