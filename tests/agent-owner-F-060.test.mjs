/**
 * M12/T9 F-060 — the coordinator-selection rule.
 *
 * The owner's ruling (2026-10-21): "Khi 1 việc được giao, main @Quản Lý làm
 * điều phối chính, riêng phần data sẽ chia nhỏ việc, main giao việc cho @O1
 * Điều phối 1 và @O2 Điều Phối 2. @O2 phụ trách điều phối và làm việc với các
 * agent chuyên môn liên quan đến data visualize, storytelling, @O1 phụ trách
 * điều phối và làm việc với các agent chuyên môn liên quan đến data etl,
 * data labeling".
 *
 * `task.primary_coordinator` was a declared field with NO writer: the dispatch
 * derivation read it and nothing set it, so every task failed with
 * COORDINATOR_NOT_EXECUTABLE and the live pickup loop was inert.
 *
 * This lane pins the derivation and the projection:
 *
 *   - a task whose required node is `sql` is owned by `o1`;
 *   - a task whose required node is `power-bi` is owned by `o2`;
 *   - a task with BOTH is owned by `main` at the ROOT level, and has no
 *     single executing coordinator, so the field stays UNSET and the dispatch
 *     refuses it (never a default, never a guess);
 *   - the STACK decides for `python`, which both o1 and o2 may spawn;
 *   - the reducer writes the derived coordinator onto the task, and the
 *     dispatch derivation resolves it.
 */
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
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";
import { deriveTaskCoordinators } from "../integrations/openclaw/topology/lib/workflow.mjs";
import { deriveGovernedDispatchTarget } from "../integrations/openclaw/lib/policy.mjs";
import { canonicalHash } from "../integrations/openclaw/topology/lib/canonical.mjs";

function fixture(tag) {
  return mkdtempSync(path.join(os.tmpdir(), `f060-${tag}-`));
}

const node = (agentId, stackId, required = true) => ({
  node_id: `node-${agentId}`,
  agent_id: agentId,
  stack_id: stackId,
  dependencies: [],
  required,
  input_digest: canonicalHash("zink-input-v1", "work"),
  constraints_digest: canonicalHash("zink-constraints-v1", "{}"),
  validation_digest: canonicalHash(
    "zink-validation-v1",
    "agent-result-payload.schema.json",
  ),
});

const OPENED = (taskId) => ({
  origin: "discord",
  origin_principal_ref: "a".repeat(64),
  origin_message_id: "123456789012345678",
  task_id: taskId,
  root_agent_id: "main",
  root_session_key: "root-session",
  root_run_id: "root-run",
});

/** A task whose brief carries the given nodes, activated in a real ledger. */
function activatedTask(root, nodes) {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const taskId = deriveTaskId(OPENED("x"));
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", OPENED(taskId));
  recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
    task_id: taskId,
    brief_revision: 1,
    semantic_contract_status: "VALID",
    nodes,
  });
  return { paths, taskId, task: readSnapshot(paths).tasks[taskId] };
}

describe("F-060 — the coordinator-selection rule", () => {
  it("a task whose required node is sql is owned by o1", () => {
    const derived = deriveTaskCoordinators([node("sql", "data_plant")]);
    assert.equal(derived.root, "o1");
    assert.equal(derived.primary, "o1");
    assert.deepEqual(derived.owners, ["o1"]);
  });

  it("a task whose required node is power-bi is owned by o2", () => {
    // The DASHBOARD is recognised by its CRAFT: `power-bi` builds it wherever
    // the plan puts it - here on the `semantic` stack, the KPI and metric
    // meaning behind the report - and @O1 cannot spawn `power-bi` at all, so
    // the step is @O2's whatever the stack label says.
    const derived = deriveTaskCoordinators([node("power-bi", "semantic")]);
    assert.equal(derived.root, "o2");
    assert.equal(derived.primary, "o2");
    assert.deepEqual(derived.owners, ["o2"]);
  });

  it("the SEMANTIC layer is data work, so a semantic step is owned by o1", () => {
    // The owner's restatement (2026-10-21): EVERY work step that works WITH
    // DATA belongs to @O1, EXCEPT the dashboard and the data-visualization
    // work. `semantic` is the layer where meaning is added (KPI, metric,
    // business rules) - data work, so it is @O1's. Before the restatement the
    // `semantic` stack belonged to @O2, so Excel's and SQL's semantic steps
    // were refused (the owner @O2 cannot spawn Excel or SQL).
    for (const agentId of ["excel", "sql"]) {
      const derived = deriveTaskCoordinators([node(agentId, "semantic")]);
      assert.equal(derived.root, "o1", `${agentId}/semantic is @O1's work`);
      assert.equal(derived.primary, "o1");
      assert.deepEqual(derived.owners, ["o1"]);
    }
  });

  it("a task with BOTH is owned by main, and has no executing coordinator", () => {
    const derived = deriveTaskCoordinators([
      node("sql", "data_plant"),
      node("power-bi", "semantic"),
    ]);
    assert.equal(
      derived.root,
      "main",
      "main is the only agent that can spawn both o1 and o2",
    );
    assert.equal(
      derived.primary,
      null,
      "main coordinates; it does not execute, so the field stays unset",
    );
    assert.deepEqual(derived.owners, ["o1", "o2"]);
  });

  it("the STACK decides for python, which both o1 and o2 may spawn", () => {
    const etl = deriveTaskCoordinators([node("python", "data_plant")]);
    assert.equal(etl.root, "o1");
    assert.equal(etl.primary, "o1");
    const storytelling = deriveTaskCoordinators([
      node("python", "intelligence"),
    ]);
    assert.equal(storytelling.root, "o2");
    assert.equal(storytelling.primary, "o2");
  });

  it("a node whose stack no coordinator owns has no owner", () => {
    const derived = deriveTaskCoordinators([
      { ...node("sql", "data_plant"), stack_id: "not-a-stack" },
    ]);
    assert.deepEqual(derived.owners, [null]);
    assert.equal(derived.primary, null);
  });

  it("the reducer projects the derived coordinator onto the task", () => {
    const root = fixture("sql");
    try {
      const { task } = activatedTask(root, [node("sql", "data_plant")]);
      assert.equal(task.primary_coordinator, "o1");
      const dispatch = deriveGovernedDispatchTarget(task);
      assert.equal(dispatch.ok, true, JSON.stringify(dispatch));
      assert.equal(dispatch.coordinator, "o1");
      assert.deepEqual(dispatch.requiredCapabilities, ["sql"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the reducer projects o2 for a visualize brief", () => {
    const root = fixture("power-bi");
    try {
      const { task } = activatedTask(root, [node("power-bi", "semantic")]);
      assert.equal(task.primary_coordinator, "o2");
      const dispatch = deriveGovernedDispatchTarget(task);
      assert.equal(dispatch.ok, true, JSON.stringify(dispatch));
      assert.equal(dispatch.coordinator, "o2");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a semantic data-work step reaches its specialist through o1", () => {
    const root = fixture("semantic");
    try {
      const { task } = activatedTask(root, [node("excel", "semantic")]);
      assert.equal(task.primary_coordinator, "o1");
      const dispatch = deriveGovernedDispatchTarget(task);
      assert.equal(dispatch.ok, true, JSON.stringify(dispatch));
      assert.equal(dispatch.coordinator, "o1");
      assert.deepEqual(dispatch.requiredCapabilities, ["excel"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a task that spans both coordinators carries no coordinator and is refused", () => {
    const root = fixture("both");
    try {
      const { task } = activatedTask(root, [
        node("sql", "data_plant"),
        node("power-bi", "semantic"),
      ]);
      assert.equal(
        "primary_coordinator" in task,
        false,
        "the field must stay unset, never defaulted",
      );
      const dispatch = deriveGovernedDispatchTarget(task);
      assert.equal(dispatch.ok, false);
      assert.equal(dispatch.error, "COORDINATOR_NOT_EXECUTABLE");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a task with no brief carries no coordinator and is never defaulted", () => {
    const root = fixture("no-brief");
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);
      const taskId = deriveTaskId(OPENED("x"));
      recordWorkflowEvent(paths, "WORKFLOW_OPENED", OPENED(taskId));
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal("primary_coordinator" in task, false);
      const dispatch = deriveGovernedDispatchTarget(task);
      assert.equal(dispatch.ok, false);
      assert.equal(dispatch.error, "COORDINATOR_NOT_EXECUTABLE");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
