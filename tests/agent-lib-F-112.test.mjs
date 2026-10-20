// M12/T9 F-112 (R1-A16-02): a second dead end in the same hop. The dispatch
// capabilities included the coordinator, while the spawn policy never does, so
// every approved task was unreachable.
//
// The coordinator-only DAG is the shape the live spawn gate commits: a root
// agent may only name the agents it may spawn, and no coordinator may spawn
// another coordinator. Such a DAG has NO specialist, so its capability set is
// EMPTY - and the pickup's start seam used to refuse an empty set, so the task
// was claimed and then never started.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_SPAWN_POLICY,
  deriveGovernedDispatchTarget,
  projectGovernedCapabilities,
} from "../integrations/openclaw/lib/policy.mjs";
import { createCoordinatorRuntimeStart } from "../integrations/openclaw/lib/coordinator-pickup.mjs";

test("F-112: a coordinator among the node agent ids is never reported unreachable", () => {
  const dispatch = deriveGovernedDispatchTarget({
    primary_coordinator: "o1",
    nodes: [
      { node_id: "n1", agent_id: "o1" },
      { node_id: "n2", agent_id: "excel" },
    ],
  });
  assert.equal(dispatch.ok, true, JSON.stringify(dispatch));
  assert.equal(dispatch.coordinator, "o1");
  assert.deepEqual(dispatch.requiredCapabilities, ["excel"]);
});

test("F-112: the dispatch capabilities equal the queue's projection of the same nodes", () => {
  const nodes = [
    { node_id: "n1", agent_id: "o1" },
    { node_id: "n2", agent_id: "excel" },
    { node_id: "n3", agent_id: "sql" },
  ];
  const dispatch = deriveGovernedDispatchTarget({
    primary_coordinator: "o1",
    nodes,
  });
  assert.equal(dispatch.ok, true, JSON.stringify(dispatch));
  assert.deepEqual(
    dispatch.requiredCapabilities,
    projectGovernedCapabilities(nodes),
    "the dispatch target and the queue projection must not drift",
  );
});

test("F-112: AGENT_SPAWN_POLICY is never required to contain a coordinator", () => {
  for (const coordinator of ["o1", "o2"]) {
    for (const node of ["o1", "o2"]) {
      const dispatch = deriveGovernedDispatchTarget({
        primary_coordinator: coordinator,
        nodes: [
          { node_id: "n1", agent_id: node },
          { node_id: "n2", agent_id: "python" },
        ],
      });
      assert.equal(
        dispatch.ok,
        true,
        `${coordinator} -> ${node} must be dispatchable: ${JSON.stringify(dispatch)}`,
      );
      assert.equal(
        AGENT_SPAWN_POLICY[coordinator].includes(node),
        false,
        "the spawn policy must never have to name a coordinator",
      );
    }
  }
});

test("F-112: the pickup start seam accepts a coordinator-only capability set", async () => {
  const started = [];
  const api = {
    runtime: {
      subagent: {
        run: async (request) => {
          started.push(request);
          return { runId: "run-1" };
        },
      },
    },
  };
  const start = createCoordinatorRuntimeStart({ api });
  const result = await start.startCoordinatorRun({
    taskId: "t-coordinator-only",
    coordinator: "o1",
    requiredCapabilities: [],
    payload: {},
    planVersion: "1.0",
    leaseId: "lease-1",
    attempt: 1,
  });
  assert.equal(result.runId, "run-1");
  assert.equal(started.length, 1, "the run must actually be started");

  // Only a MALFORMED capability set is refused.
  await assert.rejects(
    () =>
      start.startCoordinatorRun({
        taskId: "t-coordinator-only",
        coordinator: "o1",
        requiredCapabilities: "excel",
        payload: {},
        planVersion: "1.0",
        leaseId: "lease-1",
        attempt: 1,
      }),
    /COORDINATOR_CAPABILITIES_INVALID/u,
  );
});
