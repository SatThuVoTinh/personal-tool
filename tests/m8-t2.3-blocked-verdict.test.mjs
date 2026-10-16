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
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
import {
  canonicalHash,
  deriveTaskId,
  GOVERNANCE_VERSION,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";
import stateTransitions from "../integrations/openclaw/topology/policy/state-transitions.json" with { type: "json" };

const AMBIGUOUS_VERSION = "m8-t2.2-r4";
const LEGACY_STAMP = "m7-t5-r13";
const ROOT_DIGEST = "1".repeat(64);
const SCHEMA_VERSION = "1.0.0";

function fixture(tag) {
  return mkdtempSync(path.join(os.tmpdir(), `r5-blocked-${tag}-`));
}

const OPENED = (taskId) => ({
  origin: "discord",
  origin_principal_ref: "a".repeat(64),
  origin_message_id: "123456789012345678",
  task_id: taskId,
  root_agent_id: "main",
  root_session_key: "root-session",
  root_run_id: "root-run",
});

/** Build a digest-sealed event envelope carrying an explicit writer stamp. */
function sealEvent(type, payload, sequence, previousDigest, stamp, createdAt) {
  const body = {
    schema_version: SCHEMA_VERSION,
    governance_version: stamp,
    sequence,
    type,
    payload,
    created_at: createdAt,
    previous_event_digest: previousDigest,
  };
  return { ...body, event_digest: canonicalHash("zink-ledger-event-v1", body) };
}

/** Write a journal plus the snapshot its events project to, then read it back. */
function writeJournal(paths, events, era) {
  let projection = { tasks: {} };
  for (const event of events) {
    projection = applyWorkflowEvent(
      projection,
      event.type,
      event.payload,
      event.created_at,
      era,
    );
  }
  writeFileSync(
    paths.events,
    `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
  writeFileSync(
    paths.snapshot,
    `${JSON.stringify(
      {
        schema_version: SCHEMA_VERSION,
        governance_version: events[events.length - 1].governance_version,
        sequence: events.length,
        last_event_digest: events[events.length - 1].event_digest,
        ingress_ids: [],
        tasks: projection.tasks,
        updated_at: events[events.length - 1].created_at,
      },
      null,
      2,
    )}\n`,
  );
  return projection;
}

/** A task parked in RESULT_PENDING_REVIEW by a root result, as the verdict model does. */
function pendingTask(root, { outcome = "COMPLETE", reason = "NONE" } = {}) {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const taskId = deriveTaskId(OPENED("x"));
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", OPENED(taskId));
  recordWorkflowEvent(paths, "WORKFLOW_ROOT_RESULT_RECORDED", {
    task_id: taskId,
    brief_revision: 1,
    native_run_id: "root-run",
    agent_id: "main",
    payload_digest: ROOT_DIGEST,
    outcome_status: outcome,
    reason_code: reason,
    governance_hash: governanceHash("main"),
  });
  return { paths, taskId };
}

const BLOCK_VERDICT = (taskId, reasonCode, resultDigest) => ({
  task_id: taskId,
  actor: "user",
  channel: "results",
  decision: "BLOCK",
  reason: "Owner reviewed the result and accepts BLOCKED as the final outcome.",
  // An owner verdict must name the result it rules on, exactly as ACCEPTED and
  // REJECTED do; the identity binding is inherited, not weakened.
  result_digest: resultDigest ?? ROOT_DIGEST,
  ...(reasonCode === undefined ? {} : { reason_code: reasonCode }),
});

describe("Phase C — the owner verdict for BLOCKED", () => {
  it("A1. RESULT_PENDING_REVIEW -> BLOCKED is a declared transition", () => {
    assert.ok(
      stateTransitions.workflow_status.RESULT_PENDING_REVIEW.includes(
        "BLOCKED",
      ),
      "the transition must be declared, not implied",
    );
    for (const edge of ["COMPLETE", "REJECTED", "REVISING", "CANCELLED"]) {
      assert.ok(
        stateTransitions.workflow_status.RESULT_PENDING_REVIEW.includes(edge),
        `${edge} must remain a valid outgoing edge`,
      );
    }
  });

  it("A2. the owner-verdict event produces BLOCKED", () => {
    const root = fixture("produce");
    try {
      const { paths, taskId } = pendingTask(root);
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "RESULT_PENDING_REVIEW",
      );
      recordWorkflowEvent(
        paths,
        "WORKFLOW_USER_RESULT_BLOCKED",
        BLOCK_VERDICT(taskId),
      );
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.workflow_status, "BLOCKED");
      // BLOCKED is recoverable, so the brief is NOT closed.
      assert.equal(task.brief_state, "ACTIVE");
      assert.equal(
        typeof task.user_blocked_at,
        "string",
        "the owner verdict must be attributable in time",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("A3/A4. a blocked root result is faithfully represented, reason preserved", () => {
    const root = fixture("faithful");
    try {
      const { paths, taskId } = pendingTask(root, {
        outcome: "BLOCKED",
        reason: "POLICY_DENIED",
      });
      assert.equal(
        readSnapshot(paths).tasks[taskId].root_result.pending_outcome_status,
        "BLOCKED",
      );
      recordWorkflowEvent(
        paths,
        "WORKFLOW_USER_RESULT_BLOCKED",
        BLOCK_VERDICT(taskId, "POLICY_DENIED"),
      );
      const task = readSnapshot(paths).tasks[taskId];
      // A4: the reason survives verbatim.
      assert.equal(task.reason_code, "POLICY_DENIED");
      assert.equal(task.workflow_status, "BLOCKED");
      // A3: it replays from the journal, not just the snapshot.
      let replayed = { tasks: {} };
      for (const line of readFileSync(paths.events, "utf8")
        .split("\n")
        .filter(Boolean)) {
        const event = JSON.parse(line);
        replayed = applyWorkflowEvent(
          replayed,
          event.type,
          event.payload,
          event.created_at,
        );
      }
      assert.equal(replayed.tasks[taskId].workflow_status, "BLOCKED");
      assert.equal(replayed.tasks[taskId].reason_code, "POLICY_DENIED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("A5. the verdict cannot be reached from an unrelated state", () => {
    const root = fixture("gated");
    const other = fixture("gated-other");
    try {
      const { paths, taskId } = pendingTask(root);
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "RESULT_PENDING_REVIEW",
      );
      // The verdict's own shape is enforced: actor, channel and decision.
      for (const mutation of [
        { actor: "main" },
        { channel: "office" },
        { decision: "ACCEPT" },
        { decision: "REJECT" },
      ]) {
        assert.throws(
          () =>
            recordWorkflowEvent(paths, "WORKFLOW_USER_RESULT_BLOCKED", {
              ...BLOCK_VERDICT(taskId),
              ...mutation,
            }),
          (err) => typeof err.code === "string",
          `payload ${JSON.stringify(mutation)} must be refused`,
        );
      }
      // A verdict naming the wrong result is refused too.
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_USER_RESULT_BLOCKED",
            BLOCK_VERDICT(taskId, undefined, "0".repeat(64)),
          ),
        { code: "RESULT_MISMATCH" },
        "a verdict naming a different result must be refused",
      );
      // A reason outside the published vocabulary is refused instead of becoming durable
      // task state that no attribution rule can explain.
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_USER_RESULT_BLOCKED",
            BLOCK_VERDICT(taskId, "MATRIX_TERMINAL"),
          ),
        { code: "SCHEMA_INVALID" },
        "an undeclared reason_code must be refused",
      );
      // A task that has not reached review cannot be blocked by a verdict.
      const otherPaths = ledgerPaths(other);
      ensureLedger(otherPaths);
      const otherId = deriveTaskId({
        ...OPENED("y"),
        origin_message_id: "1552659746174271520",
      });
      recordWorkflowEvent(otherPaths, "WORKFLOW_OPENED", {
        ...OPENED(otherId),
        origin_message_id: "1552659746174271520",
      });
      assert.throws(
        () =>
          recordWorkflowEvent(
            otherPaths,
            "WORKFLOW_USER_RESULT_BLOCKED",
            BLOCK_VERDICT(otherId),
          ),
        { code: "INVALID_STATE_TRANSITION" },
        "a verdict on a task that is not under review must be refused",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("A6. execution events are not owner verdicts", () => {
    // The distinction the contract draws: an execution event may PRODUCE a
    // blocked condition; only the owner verdict ACCEPTS it as authoritative.
    const root = fixture("distinct");
    try {
      const { paths, taskId } = pendingTask(root, {
        outcome: "BLOCKED",
        reason: "POLICY_DENIED",
      });
      // No verdict yet: the task is under review, not blocked.
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "RESULT_PENDING_REVIEW",
      );
      recordWorkflowEvent(
        paths,
        "WORKFLOW_USER_RESULT_BLOCKED",
        BLOCK_VERDICT(taskId, "POLICY_DENIED"),
      );
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "BLOCKED",
      );
      const lines = readFileSync(paths.events, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      assert.equal(
        lines.filter((e) => e.type === "WORKFLOW_USER_RESULT_BLOCKED").length,
        1,
        "exactly one owner verdict, and no execution event was re-labelled",
      );
      // The verdict is owner-attributable; a produced blocked state is not.
      const verdict = lines.find(
        (e) => e.type === "WORKFLOW_USER_RESULT_BLOCKED",
      );
      assert.equal(verdict.payload.actor, "user");
      assert.equal(verdict.payload.channel, "results");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("B7/B8. 6d4f96cc replays to BLOCKED / POLICY_DENIED, never laundered", () => {
    // Reproduces the real task's recorded history, using the live ledger's own
    // origin so deriveTaskId reproduces the known identity. Its opener carries a
    // pre-verdict stamp and its root result the ambiguous stamp, exactly as the
    // deployed writer left them (seq 25 / seq 26).
    const TID =
      "6d4f96cc0435503585a28ae20c387173819ce004f119e4bf1aa36ceec946eaad";
    const ORIGIN = {
      origin: "discord",
      origin_principal_ref:
        "c2fdf41ac79d8a9a9fbb46654864429856763da30ba537f06ef2efc060f6b6d6",
      origin_message_id: "1552659746174271519",
    };
    assert.equal(
      deriveTaskId({ ...ORIGIN, agent_id: "main" }),
      TID,
      "the fixture must reproduce the known task identity (v2 derivation)",
    );
    const root = fixture("historical");
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);
      const opened = sealEvent(
        "WORKFLOW_OPENED",
        {
          ...ORIGIN,
          task_id: TID,
          root_agent_id: "main",
          root_session_key: "agent:main:discord:channel:1545425766161063937",
          root_run_id: "ca4b9e52-7616-4322-8e24-a71afa39fa80",
        },
        1,
        null,
        LEGACY_STAMP,
        "2026-09-24T12:35:39.054Z",
      );
      const rootResult = sealEvent(
        "WORKFLOW_ROOT_RESULT_RECORDED",
        {
          task_id: TID,
          brief_revision: 1,
          native_run_id: "ca4b9e52-7616-4322-8e24-a71afa39fa80",
          agent_id: "main",
          payload_digest: ROOT_DIGEST,
          outcome_status: "BLOCKED",
          reason_code: "POLICY_DENIED",
          governance_hash: governanceHash("main"),
        },
        2,
        opened.event_digest,
        AMBIGUOUS_VERSION,
        "2026-09-24T12:35:52.406Z",
      );
      const events = [opened, rootResult];
      const projection = writeJournal(paths, events, {
        replayAnchored: true,
        preVerdictRootResult: true,
      });
      // The deployed writer's own reduction must reproduce BLOCKED.
      assert.equal(projection.tasks[TID].workflow_status, "BLOCKED");
      assert.equal(projection.tasks[TID].reason_code, "POLICY_DENIED");
      // B7: the ambiguous legacy stamp still replays to the accepted meaning.
      const read = readSnapshot(paths);
      assert.equal(read.tasks[TID].workflow_status, "BLOCKED");
      assert.equal(read.tasks[TID].reason_code, "POLICY_DENIED");
      // B8: and it cannot be laundered into the review state.
      const laundered = JSON.parse(readFileSync(paths.snapshot, "utf8"));
      laundered.tasks[TID].workflow_status = "RESULT_PENDING_REVIEW";
      writeFileSync(paths.snapshot, `${JSON.stringify(laundered, null, 2)}\n`);
      assert.throws(
        () => readSnapshot(paths),
        (err) => err.code === "EXECUTION_STATE_UNKNOWN",
        "BLOCKED must not be laundered into RESULT_PENDING_REVIEW",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("B9/B10. legacy replay and the ambiguous stamp are unchanged", () => {
    const root = fixture("legacy");
    try {
      const { paths, taskId } = pendingTask(root);
      // Re-seal as the deployed writer stamped its history: a PRE-VERDICT
      // opener plus the AMBIGUOUS root result, which is what engages the
      // compatibility path.
      const opened = sealEvent(
        "WORKFLOW_OPENED",
        OPENED(taskId),
        1,
        null,
        LEGACY_STAMP,
        "2026-09-01T00:00:00.000Z",
      );
      const rootResult = sealEvent(
        "WORKFLOW_ROOT_RESULT_RECORDED",
        {
          task_id: taskId,
          brief_revision: 1,
          native_run_id: "root-run",
          agent_id: "main",
          payload_digest: ROOT_DIGEST,
          outcome_status: "COMPLETE",
          reason_code: "NONE",
          governance_hash: governanceHash("main"),
        },
        2,
        opened.event_digest,
        AMBIGUOUS_VERSION,
        "2026-09-02T00:00:00.000Z",
      );
      const sealed = [opened, rootResult];
      writeJournal(paths, sealed, {
        replayAnchored: true,
        preVerdictRootResult: true,
      });
      // B10: the ambiguous stamp is still supported and still replays.
      const read = readSnapshot(paths);
      assert.equal(
        read.tasks[taskId].workflow_status,
        "COMPLETE",
        "the compatibility path must be unchanged by the new event",
      );
      for (const event of sealed) {
        validateContract("ledger-event", event);
        assert.ok(
          event.governance_version === AMBIGUOUS_VERSION ||
            event.governance_version === LEGACY_STAMP,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the new event is contract-valid and digest-sealed", () => {
    const root = fixture("sealed");
    try {
      const { paths, taskId } = pendingTask(root);
      recordWorkflowEvent(
        paths,
        "WORKFLOW_USER_RESULT_BLOCKED",
        BLOCK_VERDICT(taskId, "POLICY_DENIED"),
      );
      const lines = readFileSync(paths.events, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      const verdict = lines.find(
        (e) => e.type === "WORKFLOW_USER_RESULT_BLOCKED",
      );
      assert.ok(verdict, "the verdict must be journaled");
      assert.equal(verdict.governance_version, GOVERNANCE_VERSION);
      validateContract("ledger-event", verdict);
      const { event_digest, ...unsigned } = verdict;
      assert.equal(
        canonicalHash("zink-ledger-event-v1", unsigned),
        event_digest,
        "the verdict must be digest-sealed",
      );
      assert.throws(
        () =>
          validateContract("ledger-event", {
            ...verdict,
            payload: { task_id: taskId, actor: "user", channel: "results" },
          }),
        (err) => typeof err.code === "string",
        "an incomplete verdict payload must not validate",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
