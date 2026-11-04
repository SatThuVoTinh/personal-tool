/**
 * M12/T9 F-249 — the id-only verdict is WITHDRAWN.
 *
 * The owner's ruling (2026-10-21): "bỏ nhánh" — withdraw the branch.
 *
 * The reducer compared `payload.result_id` against `task.root_result.result_id`
 * — a field the published root-result contract does not declare, so the
 * compared value could never exist and every id-only verdict failed with
 * RESULT_MISMATCH. The branch is withdrawn rather than left in place: the
 * published contract stops admitting `result_id` in a verdict payload, and the
 * live producer stops sending it.
 *
 * This lane pins:
 *
 *   - the withdrawn branch cannot be revived by a root result that happens to
 *     carry a result id (the reducer must not read a field the contract
 *     forbids);
 *   - an id-only verdict is REFUSED, never silently accepted;
 *   - the digest-only path still works;
 *   - the published contract admits the LEGACY result id as an optional
 *     member (F-376: a contract that refuses its own record makes the ledger
 *     unreadable) and still refuses every member it does not declare;
 *   - the live producer no longer sends `result_id`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";

const ROOT_DIGEST = "1".repeat(64);

function fixture(tag) {
  return mkdtempSync(path.join(os.tmpdir(), `f249-${tag}-`));
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

const ROOT_RESULT = (taskId) => ({
  task_id: taskId,
  brief_revision: 1,
  native_run_id: "root-run",
  agent_id: "main",
  payload_digest: ROOT_DIGEST,
  outcome_status: "COMPLETE",
  reason_code: "NONE",
  governance_hash: governanceHash("main"),
});

const ACCEPT = (taskId, extra = {}) => ({
  task_id: taskId,
  actor: "user",
  channel: "results",
  decision: "ACCEPT",
  ...extra,
});

/** A task parked in RESULT_PENDING_REVIEW by a recorded root result. */
function pendingTask(root) {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const taskId = deriveTaskId(OPENED("x"));
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", OPENED(taskId));
  recordWorkflowEvent(
    paths,
    "WORKFLOW_ROOT_RESULT_RECORDED",
    ROOT_RESULT(taskId),
  );
  return { paths, taskId };
}

describe("F-249 — the id-only verdict is withdrawn", () => {
  it("an id-only verdict is refused, never silently accepted", () => {
    const root = fixture("id-only");
    try {
      const { paths, taskId } = pendingTask(root);
      const state = readSnapshot(paths);
      assert.throws(
        () =>
          applyWorkflowEvent(
            state,
            "WORKFLOW_USER_RESULT_ACCEPTED",
            ACCEPT(taskId, { result_id: "res-1" }),
          ),
        { code: "RESULT_MISMATCH" },
        "a verdict that names only a result id binds to nothing",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the withdrawn branch cannot be revived by a root result carrying an id", () => {
    // The compared field is one the published root-result contract does not
    // declare, so the reducer must not read it at all: a root result that
    // happens to carry a result id must not make an id-only verdict bind.
    const taskId = "f".repeat(64);
    const state = {
      tasks: {
        [taskId]: {
          task_id: taskId,
          workflow_status: "RESULT_PENDING_REVIEW",
          brief_state: "ACTIVE",
          brief_revision: 1,
          revisions_used: 1,
          transitions_used: 0,
          delegated_runs_used: 0,
          nodes: [],
          root_result: {
            task_id: taskId,
            brief_revision: 1,
            native_run_id: "root-run",
            agent_id: "main",
            payload_digest: ROOT_DIGEST,
            outcome_status: "COMPLETE",
            reason_code: "NONE",
            governance_hash: governanceHash("main"),
            result_id: "res-1",
          },
        },
      },
    };
    assert.throws(
      () =>
        applyWorkflowEvent(
          state,
          "WORKFLOW_USER_RESULT_ACCEPTED",
          ACCEPT(taskId, { result_id: "res-1" }),
        ),
      { code: "RESULT_MISMATCH" },
      "the id-only branch must be withdrawn, not merely unreachable",
    );
  });

  it("the digest-only verdict still works", () => {
    const root = fixture("digest");
    try {
      const { paths, taskId } = pendingTask(root);
      const state = readSnapshot(paths);
      const next = applyWorkflowEvent(
        state,
        "WORKFLOW_USER_RESULT_ACCEPTED",
        ACCEPT(taskId, { result_digest: ROOT_DIGEST }),
      );
      assert.equal(next.tasks[taskId].workflow_status, "COMPLETE");
      assert.equal(next.tasks[taskId].brief_state, "CLOSED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the published contract admits the LEGACY result id, and only that one", () => {
    // F-249 withdrew `result_id` from the verdict payload branches. That made
    // the contract refuse the live journal: two verdicts the older build
    // wrote carry it, so the ledger became unreadable and the deploy could
    // not complete.
    //
    // F-376 re-admits it as an OPTIONAL LEGACY member, so the record stays
    // readable. The gate is not weakened: the member is optional, the
    // producer does not send it, and a member the contract does not declare
    // is still refused.
    const root = fixture("contract");
    try {
      const { paths, taskId } = pendingTask(root);
      const lines = readFileSync(paths.events, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const opened = lines.find((event) => event.type === "WORKFLOW_OPENED");
      assert.ok(opened, "the fixture must journal an opener");
      // The opener itself still validates, so the refusal below is about the
      // verdict payload and nothing else.
      validateContract("ledger-event", opened);
      const verdict = {
        ...opened,
        sequence: opened.sequence + 1,
        type: "WORKFLOW_USER_RESULT_ACCEPTED",
        payload: ACCEPT(taskId, { result_id: "res-1" }),
        previous_event_digest: opened.event_digest,
        event_digest: "2".repeat(64),
      };
      // The envelope is well formed and the legacy member is admitted, so the
      // contract validates it.
      validateContract("ledger-event", verdict);
      // A member the contract does NOT declare is still refused: only the
      // named legacy member is admitted.
      assert.throws(
        () =>
          validateContract("ledger-event", {
            ...verdict,
            payload: ACCEPT(taskId, {
              result_id: "res-1",
              unknown_member: "x",
            }),
          }),
        { code: "SCHEMA_VALIDATION_FAILED" },
        "the contract must still refuse what it does not declare",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the live producer no longer sends result_id in a verdict payload", () => {
    const source = readFileSync(
      new URL(
        "../integrations/openclaw/plugins/zink-governance/index.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    assert.equal(
      source.includes("result_id:"),
      false,
      "no verdict payload may carry a result id any more",
    );
    for (const type of [
      "WORKFLOW_USER_RESULT_ACCEPTED",
      "WORKFLOW_USER_RESULT_REJECTED",
      "WORKFLOW_RESULT_REVISION_REQUESTED",
    ]) {
      assert.ok(
        source.includes(`"${type}"`),
        `the producer must still send ${type}`,
      );
    }
  });
});
