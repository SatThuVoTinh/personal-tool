// M12/T9 F-533 (legacy `R10-T02-2`) — one owner for the dispatch derivation.
//
// The finding: the plugin carried a never-fixed COPY of
// `deriveGovernedDispatchTarget`. The canonical copy in `lib/policy.mjs`
// exempts a node that names the coordinator itself (the F-112 rule: an agent
// reaches itself, so `o1 -> [o1, excel]` is the DAG the live spawn gate
// commits), while the plugin copy filtered every node id through
// `AGENT_SPAWN_POLICY`, which by contract never contains a coordinator. The
// production dispatch therefore refused the shape every approved brief
// actually carries, with SPECIALIST_NOT_REACHABLE_FROM_COORDINATOR, before any
// durable queue write (`queue_status: NOT_QUEUED`).
//
// These lanes prove the two halves the row's acceptance criteria name:
//   1. ONE function, ONE owner: the plugin re-exports the very function object
//      `lib/policy.mjs` owns, so a future edit cannot land in one copy only;
//   2. a plugin-driven APPROVE of a coordinator-named brief reaches the queue
//      write, with the capability projection of the same nodes.
import assert from "node:assert/strict";
import test from "node:test";

import * as policy from "../integrations/openclaw/lib/policy.mjs";
import { deriveGovernedDispatchTarget } from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import { defaultQueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";
import { readSnapshot } from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  APPROVAL_THREAD_ID,
  COORDINATOR_NAMED_NODES,
  TASK_ID,
  registerGovernancePlugin,
  seedGovernedTask,
  sendOwnerText,
  waitForQueueTask,
  withGovernanceState,
} from "./helpers/governance-plugin-flow.mjs";

test("F-533: the plugin binds the canonical dispatch derivation, not a copy", () => {
  assert.equal(
    typeof policy.deriveGovernedDispatchTarget,
    "function",
    "lib/policy.mjs must own the derivation",
  );
  assert.equal(
    deriveGovernedDispatchTarget,
    policy.deriveGovernedDispatchTarget,
    "the plugin must re-export the ONE owned function, so an edit can never land in a copy only",
  );
});

test("F-533: a coordinator-named node is dispatchable and projects its capabilities", () => {
  const dispatch = deriveGovernedDispatchTarget({
    primary_coordinator: "o1",
    nodes: [{ agent_id: "o1" }, { agent_id: "excel" }],
  });
  assert.deepEqual(
    dispatch,
    { ok: true, coordinator: "o1", requiredCapabilities: ["excel"] },
    "a node that names the coordinator is the assignment, not an unreachable specialist",
  );
});

test("F-533: a plugin-driven APPROVE of a coordinator-named brief reaches the queue write", async () => {
  await withGovernanceState("f533", async ({ paths }) => {
    const { taskId } = seedGovernedTask(paths, {
      nodes: COORDINATOR_NAMED_NODES,
    });
    assert.equal(taskId, TASK_ID);
    assert.equal(
      readSnapshot(paths).tasks[taskId].primary_coordinator,
      "o1",
      "the activated brief must name o1 as the executing coordinator",
    );

    const { hooks, logs } = registerGovernancePlugin(paths);
    await sendOwnerText(hooks, { text: `APPROVE ${taskId}` });

    const queueItem = await waitForQueueTask(taskId);
    assert.ok(
      queueItem,
      `the approved task must be queued; the plugin logged ${JSON.stringify(logs)}`,
    );
    assert.equal(queueItem.status, "QUEUED");
    assert.equal(queueItem.primaryCoordinator, "o1");
    assert.deepEqual(
      queueItem.requiredCapabilities,
      ["excel"],
      "the queue must carry the same capability projection the dispatch target named",
    );
    // The enqueue is the durable write the old copy refused to reach.
    assert.equal(defaultQueueManager.getTask(taskId)?.status, "QUEUED");
    assert.equal(
      readSnapshot(paths).tasks[taskId].workflow_status,
      "QUEUED",
      "the ledger verdict is the authority the queue was projected from",
    );
    // The card's thread is the one the approval was recorded against, so the
    // lane fails loudly if the fixture ever drifts.
    assert.equal(
      readSnapshot(paths).tasks[taskId].approval_thread_id,
      APPROVAL_THREAD_ID,
    );
  });
});
