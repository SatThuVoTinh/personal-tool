// M12/T9-R4 F-407 (legacy R9-T02-4).
//
// Execution authority is a lease with an end. Only `withExecutionFence`
// compared `leaseExpiresAt` against the clock; `finishExecution`, the
// heartbeat and the `claimTaskById` reclaim renewed the identity fields that
// all still matched after expiry, and the heartbeat even rewrote
// `leaseExpiresAt` forward, so a lapsed owner kept a valid-looking lease and
// could finish work. These tests age a claimed lease past its expiry and
// require every mutator to refuse it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { QueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";

const TASK_ID = "a".repeat(64);
const EXPIRED_AT = new Date(Date.now() - 600_000).toISOString();

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function freshQueue() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zink-lease-expiry-"));
  roots.push(root);
  return new QueueManager({ storagePath: path.join(root, "task-queue.json") });
}

function claimedFixture() {
  const queueManager = freshQueue();
  queueManager.enqueueTask({
    taskId: TASK_ID,
    planVersion: "1.0",
    primaryCoordinator: "o1",
    requiredCapabilities: ["excel"],
    payload: {},
  });
  const claimed = queueManager.claimTask({
    agentId: "o1",
    capabilities: ["excel"],
  });
  assert.equal(claimed.claimed, true, "the fixture must own a live lease");
  return { queueManager, leaseId: claimed.leaseId };
}

// The lease a crashed owner leaves behind: EXECUTING, identity fields intact,
// and both timestamps older than the lease window.
function expiredFixture() {
  const fixture = claimedFixture();
  const item = fixture.queueManager.getTask(TASK_ID);
  item.lastHeartbeatAt = EXPIRED_AT;
  item.leaseExpiresAt = EXPIRED_AT;
  fixture.queueManager.save();
  return { ...fixture, attempt: item.attempt };
}

describe("M12/T9 F-407 - a lapsed lease is not authority", () => {
  it("finishExecution refuses an expired lease instead of recording a result", () => {
    const { queueManager, leaseId, attempt } = expiredFixture();

    assert.throws(
      () =>
        queueManager.finishExecution({
          taskId: TASK_ID,
          agentId: "o1",
          leaseId,
          attempt,
        }),
      { message: /EXECUTION_FENCE_EXPIRED/ },
      "a lapsed owner must not be able to finish",
    );

    const after = queueManager.getTask(TASK_ID);
    assert.equal(
      after.status,
      "EXECUTING",
      "the refusal must be durable, not only thrown",
    );
    assert.equal(after.executionFinishedAt, undefined);
    assert.equal(after.resultDigest, undefined);
    assert.ok(
      after.history.every((entry) => entry.status !== "RESULT_PENDING_REVIEW"),
      "no finish transition may be recorded",
    );
  });

  it("the claimTaskById reclaim refuses an expired lease and does not extend it", () => {
    const { queueManager, leaseId } = expiredFixture();

    assert.throws(
      () =>
        queueManager.claimTaskById({
          taskId: TASK_ID,
          agentId: "o1",
          leaseId,
        }),
      { message: /EXECUTION_FENCE_EXPIRED/ },
      "reclaiming must not renew a lease that already lapsed",
    );

    const after = queueManager.getTask(TASK_ID);
    assert.equal(
      after.leaseExpiresAt,
      EXPIRED_AT,
      "the lapsed expiry must not be rewritten forward",
    );
    assert.equal(after.leaseId, leaseId);
    assert.equal(after.status, "EXECUTING");
  });

  it("the heartbeat refuses an expired lease and does not extend it", () => {
    const { queueManager, leaseId } = expiredFixture();

    assert.throws(
      () => queueManager.heartbeat({ taskId: TASK_ID, agentId: "o1", leaseId }),
      { message: /EXECUTION_FENCE_EXPIRED/ },
      "a heartbeat must not resurrect authority the clock already ended",
    );

    const after = queueManager.getTask(TASK_ID);
    assert.equal(after.leaseExpiresAt, EXPIRED_AT);
    assert.equal(after.lastHeartbeatAt, EXPIRED_AT);
  });

  it("a live lease still finishes and still renews through the reclaim", async () => {
    const { queueManager, leaseId } = claimedFixture();
    const live = queueManager.getTask(TASK_ID);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const renewed = queueManager.claimTaskById({
      taskId: TASK_ID,
      agentId: "o1",
      leaseId,
    });
    assert.equal(renewed.success, true, "a live reclaim still succeeds");
    assert.ok(
      Date.parse(renewed.leaseExpiresAt) > Date.parse(live.leaseExpiresAt),
      "a live reclaim still extends the lease",
    );

    const finished = queueManager.finishExecution({
      taskId: TASK_ID,
      agentId: "o1",
      leaseId,
      attempt: live.attempt,
    });
    assert.equal(finished.status, "RESULT_PENDING_REVIEW");
  });
});
