import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function node(agentId, required = true) {
  return {
    node_id: agentId,
    agent_id: agentId,
    stack_id: "data_plant",
    dependencies: [],
    // The operational ledger's root-result briefs carry no REQUIRED nodes, so
    // the aggregate gate (COMPLETE outcome + a required node => aggregate
    // COMPLETE) does not gate a root result for a non-root agent.
    required,
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
    nodes: [node("o1", false)],
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
// What the verifier passes for a journal it has declared legacy-era.
const LEGACY = { replayAnchored: true, preVerdictRootResult: true };

const LEGACY_VERSION = "m7-t5-r13";

/**
 * Rewrite the fixture journal as a pre-R4 ledger: every event re-stamped with
 * the legacy governance version, the root result appended and projected under
 * the pre-verdict model, and the chain plus snapshot re-sealed together so the
 * journal is internally consistent — exactly like a real historical ledger.
 * The canonical writer path refuses raw workflow events (M7-002), so a fixture
 * modelling a pre-R4 writer seals the lines itself. No real data is involved.
 */
function writeLegacyJournal(paths, rootResultPayload) {
  const existing = readFileSync(paths.events, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const createdAt = "2026-09-01T00:00:00.000Z";
  // The legacy journal is rebuilt from an empty projection so the snapshot
  // records the same states the events describe, under the legacy version.
  const legacyOptions = LEGACY;
  // The journal is re-sealed below, so each event's existing digest is
  // recomputed; drop it rather than carrying a stale value.
  const unsigned = existing.map((event) => {
    const body = { ...event, governance_version: LEGACY_VERSION };
    delete body.event_digest;
    body.previous_event_digest = null;
    return body;
  });
  const rootResult = {
    schema_version: "1.0.0",
    governance_version: LEGACY_VERSION,
    sequence: unsigned.length + 1,
    type: "WORKFLOW_ROOT_RESULT_RECORDED",
    payload: rootResultPayload,
    created_at: createdAt,
    previous_event_digest: null,
  };
  const bodies = [...unsigned, rootResult];

  // Seal the chain, projecting effects in order so the anchored replay the
  // verifier performs reproduces exactly these states.
  // The journal projection starts as the empty budget ledger, exactly as the
  // verifier's own anchored replay does.
  let projection = { tasks: {} };
  let previous = null;
  const lines = bodies.map((body) => {
    const signed = { ...body, previous_event_digest: previous };
    const event_digest = canonicalHash("zink-ledger-event-v1", signed);
    previous = event_digest;
    projection = applyWorkflowEvent(
      projection,
      signed.type,
      signed.payload,
      signed.created_at,
      legacyOptions,
    );
    return JSON.stringify({ ...signed, event_digest });
  });
  writeFileSync(paths.events, `${lines.join("\n")}\n`);
  const snapshot = {
    schema_version: "1.0.0",
    governance_version: LEGACY_VERSION,
    sequence: bodies.length,
    last_event_digest: previous,
    ingress_ids: [],
    tasks: projection.tasks,
    updated_at: createdAt,
  };
  writeFileSync(paths.snapshot, `${JSON.stringify(snapshot, null, 2)}\n`);
  return { snapshot, events: bodies.length };
}

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

  it("a root result resolves to its recorded outcome anchored; strict paths hold for review", () => {
    // Every root result in the operational ledger was journaled while the
    // reducer resolved it DIRECTLY to its recorded outcome. The owner-verdict
    // model was introduced in m8-t2.2-r4. Anchored replay reproduces the
    // transition the deployed build performed; new writes still require the
    // owner's verdict. The journal's governance_version stamp cannot
    // discriminate the two eras (the live writer stamped m8-t2.2-r4 while
    // using direct resolution), so the replay trust boundary is the
    // discriminator — and it is non-circular.
    const root = fixture();
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);
      for (const [outcome, expected, closesBrief] of [
        ["COMPLETE", "COMPLETE", "CLOSED"],
        ["BLOCKED", "BLOCKED", "ACTIVE"],
      ]) {
        const taskId = openTask(paths);
        const event = {
          task_id: taskId,
          brief_revision: 1,
          native_run_id: "main-run",
          agent_id: "main",
          payload_digest: "1".repeat(64),
          outcome_status: outcome,
          reason_code: outcome === "COMPLETE" ? "NONE" : "POLICY_DENIED",
          governance_hash: governanceHash("main"),
        };
        // Strict (default): the owner verdict is what closes the task.
        const strict = applyWorkflowEvent(
          readSnapshot(paths),
          "WORKFLOW_ROOT_RESULT_RECORDED",
          event,
        );
        assert.equal(
          strict.tasks[taskId].workflow_status,
          "RESULT_PENDING_REVIEW",
        );
        assert.equal(
          "pending_outcome_status" in strict.tasks[taskId].root_result,
          true,
        );
        assert.equal("result_pending_at" in strict.tasks[taskId], true);
        // Anchored replay: the recorded outcome, as the deployed build applied
        // it, but ONLY when the verifier declares a legacy-era journal. The
        // declaration is derived from the event stream, so a current-version
        // journal is never re-resolved into the legacy model.
        const anchored = applyWorkflowEvent(
          readSnapshot(paths),
          "WORKFLOW_ROOT_RESULT_RECORDED",
          event,
          null,
          LEGACY,
        );
        assert.equal(anchored.tasks[taskId].workflow_status, expected);
        assert.equal(anchored.tasks[taskId].brief_state, closesBrief);
        assert.equal(
          "result_pending_at" in anchored.tasks[taskId],
          false,
          "pre-verdict history has no pending timestamp",
        );
        assert.equal(
          "pending_outcome_status" in anchored.tasks[taskId].root_result,
          false,
          "pre-verdict history records the outcome, not a pending projection",
        );
        // The root result is byte-identical to the journaled payload in the
        // anchored projection, so the recorded outcome is preserved verbatim.
        assert.equal(
          canonicalHash(
            "zink-ledger-event-v1",
            anchored.tasks[taskId].root_result,
          ),
          canonicalHash("zink-ledger-event-v1", event),
        );

        // An anchored event in a CURRENT-version journal keeps the verdict
        // model, so a fresh ledger's root result is not re-resolved into the
        // legacy model by its own read-back.
        const currentEra = applyWorkflowEvent(
          readSnapshot(paths),
          "WORKFLOW_ROOT_RESULT_RECORDED",
          event,
          null,
          ANCHORED,
        );
        assert.equal(
          currentEra.tasks[taskId].workflow_status,
          "RESULT_PENDING_REVIEW",
          "a current-version journal must replay under the current model",
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the verifier reads a legacy-era journal and a current-era journal correctly", () => {
    // End-to-end coverage of the READ path, which is the only place the era
    // declaration is derived. A journal carrying any pre-R4-stamped event is
    // legacy-era; the verifier must read it, and must read a current-era
    // journal under the current model. This is what distinguishes the fix from
    // one that merely widens the reducer: a mutation that erases the
    // declaration is caught here, not only in the unit test above.
    const legacy = fixture();
    try {
      const paths = ledgerPaths(legacy);
      ensureLedger(paths);
      const taskId = openTask(paths);
      const event = {
        task_id: taskId,
        brief_revision: 1,
        native_run_id: "main-run",
        agent_id: "main",
        payload_digest: "1".repeat(64),
        outcome_status: "COMPLETE",
        reason_code: "NONE",
        governance_hash: governanceHash("main"),
      };
      // The root result is then recorded the way the deployed build recorded
      // it: pre-R4 stamps, pre-verdict end state, everything re-sealed into one
      // digest-linked journal whose snapshot records that same end state. This
      // is the exact shape the operational ledger is in.
      const committed = writeLegacyJournal(paths, event);
      assert.equal(
        committed.snapshot.tasks[taskId].workflow_status,
        "COMPLETE",
      );
      // The verifier accepts the journal as-is: it must not be re-resolved
      // into the verdict model.
      const read = readSnapshot(paths);
      assert.equal(read.tasks[taskId].workflow_status, "COMPLETE");
      assert.equal(
        "result_pending_at" in read.tasks[taskId],
        false,
        "a legacy-era journal must not gain verdict-model fields",
      );
    } finally {
      rmSync(legacy, { recursive: true, force: true });
    }
  });

  it("a current-era journal is read back under the current model", () => {
    // The other half of the era boundary: a journal with no pre-R4 stamp is
    // read under the verdict model, so the root result a current writer records
    // survives its own read-back. Without this the fix would rewrite the state
    // of every ledger written from now on.
    const current = fixture();
    try {
      const paths = ledgerPaths(current);
      ensureLedger(paths);
      const taskId = openTask(paths);
      recordWorkflowEvent(paths, "WORKFLOW_ROOT_RESULT_RECORDED", {
        task_id: taskId,
        brief_revision: 1,
        native_run_id: "main-run",
        agent_id: "main",
        payload_digest: "1".repeat(64),
        outcome_status: "COMPLETE",
        reason_code: "NONE",
        governance_hash: governanceHash("main"),
      });
      const read = readSnapshot(paths);
      assert.equal(
        read.tasks[taskId].workflow_status,
        "RESULT_PENDING_REVIEW",
        "a current-era root result must stay pending review across a read",
      );
      assert.equal(
        read.tasks[taskId].root_result.pending_outcome_status,
        "COMPLETE",
      );
    } finally {
      rmSync(current, { recursive: true, force: true });
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
