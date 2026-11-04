// M12/T9 F-401 (legacy R9-L04-1): detectAndRecoverStaleTasks is the only path
// that returns a dead-owner EXECUTING item to QUEUED, and no production code
// called it — every crash or failed recordClaimed stranded the item for ever,
// because claimTask only considers QUEUED and withExecutionFence refuses an
// expired lease. The production tick must run the sweep.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  createPickupScheduler,
  startCoordinatorPickupLoop,
} from "../integrations/openclaw/lib/coordinator-pickup.mjs";
import { QueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";
import { deriveGovernedDispatchTarget } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

const TASK_ID = "f".repeat(64);
const HEARTBEAT_AGE_MS = 700_000; // above the 600s stale threshold

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function freshQueue() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zink-stale-recovery-"));
  roots.push(root);
  return new QueueManager({ storagePath: path.join(root, "task-queue.json") });
}

// The item a crashed owner leaves behind: EXECUTING, an expired lease, and a
// heartbeat that stopped 700 seconds ago.
function strandedItem() {
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
  assert.equal(claimed.claimed, true);
  queueManager.refresh();
  const item = queueManager.queue.get(TASK_ID);
  item.lastHeartbeatAt = new Date(Date.now() - HEARTBEAT_AGE_MS).toISOString();
  queueManager.save();
  return { queueManager, leaseId: claimed.leaseId };
}

async function tickOnce(queueManager, ledgerTasks, warnings) {
  const loop = startCoordinatorPickupLoop({
    queueManager,
    getLedgerTasks: async () => ledgerTasks,
    deriveTarget: deriveGovernedDispatchTarget,
    recordClaimed: async () => {},
    recordBound: async () => {},
    startCoordinatorRun: async () => {
      throw new Error("the recovered item must not be started by this fixture");
    },
    isRuntimeStartAvailable: () => true,
    intervalMs: 10,
    createPickupScheduler,
    logger: { warn: (line) => warnings.push(line) },
  });
  loop.start();
  await new Promise((resolve) => setTimeout(resolve, 60));
  loop.stop();
  return loop;
}

describe("M12/T9 F-401 - the production pickup tick recovers a dead owner", () => {
  it("a stale EXECUTING item returns to QUEUED with a fresh attempt and no lease", async () => {
    const { queueManager } = strandedItem();
    const warnings = [];
    // The ledger still says EXECUTING, so the pickup pass refuses the item as a
    // stale projection; only the recovery can move it back.
    await tickOnce(
      queueManager,
      { [TASK_ID]: { workflow_status: "EXECUTING" } },
      warnings,
    );
    const recovered = queueManager.getTask(TASK_ID);
    assert.equal(
      recovered.status,
      "QUEUED",
      "the tick must requeue an execution whose owner stopped reporting",
    );
    assert.equal(recovered.leaseExpiresAt, null, "the dead lease is cleared");
    assert.equal(recovered.leaseId, null, "the stale lease id is revoked");
    assert.equal(recovered.attempt, 2, "the attempt is incremented");
    assert.equal(
      warnings.length,
      1,
      "the recovery is reported, not silently applied",
    );
    assert.match(warnings[0], /F-401|stale/iu);
  });

  it("a live EXECUTING item is left alone", async () => {
    const queueManager = freshQueue();
    queueManager.enqueueTask({
      taskId: TASK_ID,
      planVersion: "1.0",
      primaryCoordinator: "o1",
      requiredCapabilities: ["excel"],
      payload: {},
    });
    queueManager.claimTask({ agentId: "o1", capabilities: ["excel"] });
    const warnings = [];
    await tickOnce(
      queueManager,
      { [TASK_ID]: { workflow_status: "EXECUTING" } },
      warnings,
    );
    const live = queueManager.getTask(TASK_ID);
    assert.equal(live.status, "EXECUTING");
    assert.equal(live.attempt, 1);
    assert.notEqual(live.leaseId, null, "a live lease is not revoked");
    assert.deepEqual(warnings, []);
  });
});
