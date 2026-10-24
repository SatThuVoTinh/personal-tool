import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveGovernedDispatchTarget,
  registerTools,
  resolveCoordinatorHandoffOutcome,
  buildCoordinatorNotificationText,
  runDuplicateApprovalHandoff,
  runFirstApprovalNotification,
  reserveCoordinatorNotificationAttempt,
  isCoordinatorNotificationAttemptInFlight,
  NOTIFICATION_ATTEMPT_TTL_MS,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import { createGovernanceGuard } from "../integrations/openclaw/topology/lib/guard.mjs";
import {
  TOOL_POLICY,
  AGENT_SPAWN_POLICY,
} from "../integrations/openclaw/lib/policy.mjs";

import {
  R2StorageAdapter,
  R2AdapterError,
} from "../zink-tools/adapters/storage/r2-adapter.mjs";
import { executeGovernedDuckDbQuery } from "../zink-tools/sql/duckdb-bridge.mjs";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TASK_ID = "d".repeat(64);

function makeTask(overrides = {}) {
  return {
    primary_coordinator: "o1",
    nodes: [
      { node_id: "node-excel", agent_id: "excel" },
      { node_id: "node-sql", agent_id: "sql" },
    ],
    brief_revision: 1,
    ...overrides,
  };
}

// ===========================================================================
// Domain A: approved-task dispatch target is derived, never defaulted
// ===========================================================================

test("A1: a valid approved task resolves its authoritative coordinator and specialists", () => {
  const dispatch = deriveGovernedDispatchTarget(makeTask());
  assert.equal(dispatch.ok, true);
  assert.equal(dispatch.coordinator, "o1");
  assert.deepEqual(dispatch.requiredCapabilities, ["excel", "sql"]);
});

test("A2: the coordinator is never defaulted to o1 when the task names o2", () => {
  const dispatch = deriveGovernedDispatchTarget(
    makeTask({
      primary_coordinator: "o2",
      nodes: [
        { node_id: "n1", agent_id: "power-bi" },
        { node_id: "n2", agent_id: "python" },
      ],
    }),
  );
  assert.equal(dispatch.ok, true);
  assert.equal(dispatch.coordinator, "o2");
});

test("A3: a non-executable coordinator fails closed instead of defaulting", () => {
  for (const coordinator of [undefined, null, "", "main", "excel", "sql"]) {
    const dispatch = deriveGovernedDispatchTarget(
      makeTask({ primary_coordinator: coordinator }),
    );
    assert.equal(
      dispatch.ok,
      false,
      `coordinator ${String(coordinator)} must not be dispatchable`,
    );
    assert.equal(dispatch.error, "COORDINATOR_NOT_EXECUTABLE");
  }
});

test("A4: an empty DAG fails closed rather than defaulting a specialist set", () => {
  assert.deepEqual(deriveGovernedDispatchTarget(makeTask({ nodes: [] })), {
    ok: false,
    error: "NO_EXECUTABLE_SPECIALIST",
  });
  assert.deepEqual(
    deriveGovernedDispatchTarget(makeTask({ nodes: undefined })),
    {
      ok: false,
      error: "NO_EXECUTABLE_SPECIALIST",
    },
  );
});

test("A5: a DAG naming an agent outside the canonical roster fails closed", () => {
  const dispatch = deriveGovernedDispatchTarget(
    makeTask({
      nodes: [{ node_id: "node-ghost", agent_id: "root" }],
    }),
  );
  assert.deepEqual(dispatch, {
    ok: false,
    error: "UNKNOWN_SPECIALIST_IN_DAG",
  });
});

test("A6: a missing task is reported, never coerced into a dispatch", () => {
  for (const value of [null, undefined, "task", 42]) {
    assert.deepEqual(deriveGovernedDispatchTarget(value), {
      ok: false,
      error: "TASK_NOT_FOUND",
    });
  }
});

// ===========================================================================
// Domain A2: canonical topology containment
// ===========================================================================

test("A7: o1 may reach its canonical specialists", () => {
  const dispatch = deriveGovernedDispatchTarget(
    makeTask({
      primary_coordinator: "o1",
      nodes: [
        { node_id: "n1", agent_id: "excel" },
        { node_id: "n2", agent_id: "sql" },
        { node_id: "n3", agent_id: "python" },
      ],
    }),
  );
  assert.equal(dispatch.ok, true);
  // F-533: the projection is the canonical `projectGovernedCapabilities` order
  // (the capability registry's order), not the brief's node order. The set is
  // what routes work — order carries no meaning — so this pins the canonical
  // owner's output rather than an incidental copy's.
  assert.deepEqual(dispatch.requiredCapabilities, ["excel", "python", "sql"]);
});

test("A8: o2 may reach its canonical specialists", () => {
  const dispatch = deriveGovernedDispatchTarget(
    makeTask({
      primary_coordinator: "o2",
      nodes: [
        { node_id: "n1", agent_id: "power-bi" },
        { node_id: "n2", agent_id: "python" },
      ],
    }),
  );
  assert.equal(dispatch.ok, true);
  assert.deepEqual(dispatch.requiredCapabilities, ["power-bi", "python"]);
});

test("A9: o1 may not reach power-bi, and the graph is not narrowed to hide it", () => {
  const dispatch = deriveGovernedDispatchTarget(
    makeTask({
      primary_coordinator: "o1",
      nodes: [
        { node_id: "n1", agent_id: "excel" },
        { node_id: "n2", agent_id: "power-bi" },
      ],
    }),
  );
  assert.equal(dispatch.ok, false);
  assert.equal(dispatch.error, "SPECIALIST_NOT_REACHABLE_FROM_COORDINATOR");
  // The unreachable specialist is reported, never silently dropped, and the
  // coordinator is never replaced with one that could reach it.
  assert.deepEqual(dispatch.unreachable, ["power-bi"]);
  assert.equal(dispatch.coordinator, "o1");
  assert.equal(dispatch.requiredCapabilities, undefined);
});

test("A10: o2 may not reach sql, and is not swapped for o1", () => {
  const dispatch = deriveGovernedDispatchTarget(
    makeTask({
      primary_coordinator: "o2",
      nodes: [
        { node_id: "n1", agent_id: "power-bi" },
        { node_id: "n2", agent_id: "sql" },
      ],
    }),
  );
  assert.equal(dispatch.ok, false);
  assert.equal(dispatch.error, "SPECIALIST_NOT_REACHABLE_FROM_COORDINATOR");
  assert.deepEqual(dispatch.unreachable, ["sql"]);
  assert.equal(dispatch.coordinator, "o2");
});

test("A11: containment uses the canonical topology table, not a local copy", () => {
  // Every reachable pair in the canonical table must dispatch, and every
  // forbidden pair must block. If the implementation held its own map, changing
  // the canonical table would leave these results stale.
  const forbidden = new Set();
  for (const [coordinator, allowed] of Object.entries(AGENT_SPAWN_POLICY)) {
    if (coordinator !== "o1" && coordinator !== "o2") continue;
    for (const agentId of ["excel", "sql", "python", "power-bi"]) {
      const dispatch = deriveGovernedDispatchTarget(
        makeTask({
          primary_coordinator: coordinator,
          nodes: [{ node_id: "n", agent_id: agentId }],
        }),
      );
      assert.equal(
        dispatch.ok,
        allowed.includes(agentId),
        `${coordinator} -> ${agentId} must follow AGENT_SPAWN_POLICY`,
      );
      if (!allowed.includes(agentId))
        forbidden.add(`${coordinator}->${agentId}`);
    }
  }
  // Sanity: the table really does forbid something, so the loop is meaningful.
  assert.ok(forbidden.size > 0, "canonical topology must forbid some pairs");
});

test("A12: main is never an executable coordinator even with a reachable DAG", () => {
  const dispatch = deriveGovernedDispatchTarget(
    makeTask({
      primary_coordinator: "main",
      nodes: [{ node_id: "n1", agent_id: "o1" }],
    }),
  );
  assert.deepEqual(dispatch, {
    ok: false,
    error: "COORDINATOR_NOT_EXECUTABLE",
  });
});

// ===========================================================================
// Domain B2: handoff semantics — a Discord POST is not a handoff
// ===========================================================================

test("B3: no status claims a handoff was released", () => {
  for (const delivered of [true, false]) {
    for (const preExisting of [
      null,
      { status: "QUEUED" },
      { status: "QUEUED", coordinatorNotification: { delivered: true } },
      { status: "QUEUED", coordinatorNotification: { delivered: false } },
    ]) {
      const outcome = resolveCoordinatorHandoffOutcome({
        preExisting,
        delivered,
      });
      assert.notEqual(
        outcome.status,
        "RELEASED_TO_COORDINATOR",
        "a Discord POST must never be reported as a released handoff",
      );
      assert.equal(outcome.status, "QUEUED");
      assert.notEqual(outcome.handoff, "EXECUTING");
    }
  }
});

test("B4: a first approval that delivers reports AWAITING_COORDINATOR_PICKUP", () => {
  assert.deepEqual(
    resolveCoordinatorHandoffOutcome({ preExisting: null, delivered: true }),
    {
      status: "QUEUED",
      queue_status: "QUEUED",
      handoff: "AWAITING_COORDINATOR_PICKUP",
    },
  );
});

test("B5: a first approval whose delivery fails records the failure explicitly", () => {
  assert.deepEqual(
    resolveCoordinatorHandoffOutcome({ preExisting: null, delivered: false }),
    {
      status: "QUEUED",
      queue_status: "QUEUED",
      handoff: "NOTIFICATION_FAILED",
    },
  );
});

test("B6: a duplicate approval after a successful notification never re-notifies", () => {
  const already = {
    status: "QUEUED",
    coordinatorNotification: { delivered: true },
  };
  assert.deepEqual(
    resolveCoordinatorHandoffOutcome({ preExisting: already, delivered: true }),
    {
      status: "QUEUED",
      queue_status: "QUEUED",
      handoff: "ALREADY_NOTIFIED",
    },
  );
});

test("B7: a duplicate approval retries an undelivered notification", () => {
  const failed = {
    status: "QUEUED",
    coordinatorNotification: { delivered: false },
  };
  assert.equal(
    resolveCoordinatorHandoffOutcome({ preExisting: failed, delivered: true })
      .handoff,
    "NOTIFIED",
    "a retry that lands must be reported as notified",
  );
  assert.equal(
    resolveCoordinatorHandoffOutcome({ preExisting: failed, delivered: false })
      .handoff,
    "NOTIFICATION_FAILED",
    "a retry that fails again must stay retryable, never become a success",
  );
  // A record with no notification field at all (an older or partially written
  // item) is treated as not yet delivered, so it is still retryable.
  assert.equal(
    resolveCoordinatorHandoffOutcome({
      preExisting: { status: "QUEUED" },
      delivered: true,
    }).handoff,
    "NOTIFIED",
  );
});

test("B8: repeated duplicates converge without ever claiming execution", () => {
  let record = { status: "QUEUED" };
  const seen = [];
  for (let i = 0; i < 5; i += 1) {
    const outcome = resolveCoordinatorHandoffOutcome({
      preExisting: record,
      delivered: true,
    });
    seen.push(outcome.handoff);
    record = {
      ...record,
      coordinatorNotification: { delivered: true },
    };
  }
  // The first duplicate retries, every later one is idempotent.
  assert.deepEqual(seen, [
    "NOTIFIED",
    "ALREADY_NOTIFIED",
    "ALREADY_NOTIFIED",
    "ALREADY_NOTIFIED",
    "ALREADY_NOTIFIED",
  ]);
});

// ===========================================================================
// Domain B3: the notification text is non-authoritative
// ===========================================================================

test("B9: tampering with the message text cannot change the dispatch decision", () => {
  const task = makeTask();
  const authoritative = deriveGovernedDispatchTarget(task);
  assert.equal(authoritative.ok, true);

  // Forge a notification claiming a different coordinator and specialists. The
  // dispatch decision must be unchanged, because it is derived only from the
  // task record.
  const forged = buildCoordinatorNotificationText({
    taskId: TASK_ID,
    dispatch: { coordinator: "o2", requiredCapabilities: ["power-bi"] },
  });
  assert.ok(forged.includes("o2"));
  assert.ok(forged.includes("power-bi"));
  assert.deepEqual(
    deriveGovernedDispatchTarget(task),
    authoritative,
    "authority must not depend on any message",
  );
});

test("B10: the notification text tells the reader it is not authority", () => {
  const text = buildCoordinatorNotificationText({
    taskId: TASK_ID,
    dispatch: { coordinator: "o1", requiredCapabilities: ["excel"] },
  });
  assert.ok(text.includes(TASK_ID));
  // It must not read as a completed handoff or a started execution.
  assert.ok(/CHƯA có chuyên môn nào thực thi/.test(text));
  assert.ok(/KHÔNG phải bằng chứng bàn giao/.test(text));
  assert.equal(/RELEASED_TO_COORDINATOR/.test(text), false);
  assert.equal(/đã thực thi|đã hoàn tất/i.test(text), false);
});

test("B11: the plugin source cannot derive identity from Discord text", () => {
  const source = fs.readFileSync(
    new URL(
      "../integrations/openclaw/plugins/zink-governance/index.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const start = source.indexOf("async function executeApprovedTask(");
  const end = source.indexOf("const unregister = registerNativeGuard", start);
  const body = source.slice(start, end);
  // No parsing of a message payload to recover a coordinator or a DAG.
  assert.equal(
    /JSON\.parse\([^)]*text/.test(body),
    false,
    "execution must not parse message text to recover authority",
  );
  // The coordinator always comes from the derived dispatch, never from config.
  assert.equal(
    /coordinator\s*[:=]\s*(config|originThreadId)/.test(body),
    false,
  );
});

// ===========================================================================
// Domain B: the hardcoded demo execution path is gone
// ===========================================================================

test("B1: the governance plugin contains no hardcoded revenue/KPI demo execution", () => {
  const source = fs.readFileSync(
    new URL(
      "../integrations/openclaw/plugins/zink-governance/index.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  for (const literal of [
    "bao_cao_doanh_thu_kpi",
    "Doanh Thu (VND)",
    "Chi Phí (VND)",
    "Lợi Nhuận (VND)",
    "resolveVerifiedExecutionBackend",
  ]) {
    assert.equal(
      source.includes(literal),
      false,
      `legacy demo literal must not survive: ${literal}`,
    );
  }
});

test("B2: an approved task does not claim the queue itself and never fabricates a result", () => {
  const source = fs.readFileSync(
    new URL(
      "../integrations/openclaw/plugins/zink-governance/index.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const start = source.indexOf("async function executeApprovedTask(");
  assert.ok(start > 0, "executeApprovedTask must exist");
  const end = source.indexOf("const unregister = registerNativeGuard", start);
  const body = source.slice(start, end);
  // The plugin must not claim the queue item (that is the coordinator's job
  // through the guard) and must not validate a fabricated artifact.
  assert.equal(body.includes("claimTaskById"), false);
  assert.equal(body.includes("handleExecutionFinished("), false);
  assert.equal(body.includes("READY_FOR_REVIEW"), false);
});

// ===========================================================================
// Domain C: Power BI and Python fail closed, never fake success
// ===========================================================================

function collectTools() {
  const registered = new Map();
  registerTools(
    {
      registerTool: (definition) => {
        if (definition?.name) registered.set(definition.name, definition);
      },
      pluginConfig: {},
    },
    {},
  );
  return registered;
}

test("C1: zink_power_bi reports BLOCKED and never claims a result", async () => {
  const tool = collectTools().get("zink_power_bi");
  assert.ok(tool, "zink_power_bi must be registered");
  const res = await tool.execute(
    { agent: "power-bi" },
    {
      operation: "load",
      model: "DefaultModel",
    },
  );
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.status, "BLOCKED");
  assert.equal(payload.execution_state, "BLOCKED");
  assert.equal(payload.error, "ENGINE_NOT_IMPLEMENTED");
  assert.equal(payload.implemented, false);
});

test("C2: zink_python reports BLOCKED and never claims a result", async () => {
  const tool = collectTools().get("zink_python");
  assert.ok(tool, "zink_python must be registered");
  const res = await tool.execute(
    { agent: "python" },
    {
      entrypoint: "scripts/report.py",
      stack: "data_plant",
    },
  );
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.status, "BLOCKED");
  assert.equal(payload.error, "ENGINE_NOT_IMPLEMENTED");
  assert.equal(payload.implemented, false);
});

test("C3: no not-implemented capability reports a success-shaped envelope", async () => {
  const tools = collectTools();
  const cases = [
    ["zink_power_bi", { agent: "power-bi" }, { operation: "load", model: "M" }],
    [
      "zink_python",
      { agent: "python" },
      { entrypoint: "scripts/x.py", stack: "data_plant" },
    ],
    [
      "zink_n8n",
      { agent: "o2" },
      { workflow_id: "pipeline_notify", payload: { delivered: true } },
    ],
  ];
  for (const [name, id, params] of cases) {
    const res = await tools.get(name).execute(id, params);
    const payload = JSON.parse(res.content[0].text);
    // The invariant is that a not-implemented capability can never produce a
    // success-shaped envelope. Any fail-closed status is acceptable; "success"
    // is not.
    assert.notEqual(
      payload.status,
      "success",
      `${name} must never report a success status`,
    );
    assert.notEqual(
      payload.status,
      "SUCCESS",
      `${name} must never report a success status`,
    );
    assert.equal(payload.success, undefined, `${name} must not claim success`);
    assert.equal(
      payload.output,
      undefined,
      `${name} must not present an output as if work happened`,
    );
  }
});

test("C4: a not-implemented capability is unreachable without a trusted identity", async () => {
  // The engine stub is irrelevant if the tool refuses to run at all without
  // trusted runtime identity, so the identity gate is checked first.
  const tool = collectTools().get("zink_python");
  const res = await tool.execute("not-an-object", {
    entrypoint: "scripts/x.py",
    stack: "data_plant",
  });
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.status, "DENIED");
  assert.equal(payload.code, "IDENTITY_REQUIRED");
});

// ===========================================================================
// Domain D: n8n is dispatched through the canonical governed seam
// ===========================================================================

test("D1: the model-visible n8n tool no longer claims the engine is absent", () => {
  const source = fs.readFileSync(
    new URL(
      "../integrations/openclaw/plugins/zink-governance/index.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const start = source.indexOf("zink_n8n: {");
  const slice = source.slice(start, start + 4000);
  assert.equal(
    /status:\s*"ENGINE_NOT_IMPLEMENTED"/.test(slice),
    false,
    "zink_n8n must not report ENGINE_NOT_IMPLEMENTED while a real adapter exists",
  );
});

test("D2: the live n8n path dispatches through the canonical guard seam", () => {
  const source = fs.readFileSync(
    new URL(
      "../integrations/openclaw/plugins/zink-governance/index.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const start = source.indexOf('event.toolName === "zink_n8n"');
  const slice = source.slice(start, start + 6000);
  assert.ok(
    slice.includes("guard.beforeToolCall("),
    "the governed n8n path must delegate to the canonical guard seam",
  );
});

test("D3: n8n keeps its canonical dispatch target so the real adapter is reachable", () => {
  // zink_n8n is the only capability whose dispatch target is the real adapter;
  // that is exactly why reporting ENGINE_NOT_IMPLEMENTED was a false claim.
  assert.equal(TOOL_POLICY.o2.includes("zink_n8n"), true);
  assert.equal(TOOL_POLICY.python.includes("zink_n8n"), true);
  assert.equal(TOOL_POLICY.excel.includes("zink_n8n"), false);
});

test("D4: the guard denies an unknown n8n workflow and an unauthorized caller", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zink-n8n-"));
  const paths = {
    root: tempDir,
    events: path.join(tempDir, "events.jsonl"),
    snapshot: path.join(tempDir, "snapshot.json"),
  };
  const snapshot = {
    tasks: {
      [TASK_ID]: {
        task_id: TASK_ID,
        brief_revision: 1,
        brief_state: "ACTIVE",
        workflow_status: "EXECUTING",
        origin: "discord",
        root_agent_id: "main",
        root_run_id: "main-run",
        origin_principal_ref: "p".repeat(64),
        nodes: [
          { node_id: "node-python", agent_id: "python" },
          { node_id: "node-sql", agent_id: "sql" },
        ],
        delegations: {
          "00000000-0000-4000-8000-0000000000aa": {
            delegation_id: "00000000-0000-4000-8000-0000000000aa",
            agent_id: "python",
            child_session_key: "sess-python",
            native_run_id: "run-python",
            run_state: "RUNNING",
            brief_revision: 1,
            allowed_tools: ["zink_python", "zink_n8n"],
          },
        },
      },
    },
  };
  fs.writeFileSync(paths.snapshot, JSON.stringify(snapshot));
  fs.writeFileSync(paths.events, "");
  const manifestFor = (agentId) => ({
    expected_governance_hash: "0".repeat(64),
    observed_governance_hash: "0".repeat(64),
    allowed_tools: TOOL_POLICY[agentId] ?? [],
  });
  const guard = createGovernanceGuard({ paths, manifestFor });
  const baseParams = {
    call_id: "00000000-0000-4000-8000-0000000000bb",
    tool_id: "zink_n8n",
    specialist: "python",
    constraints: { timeout_seconds: 10, max_memory_mb: 256 },
    provenance: { task_id: TASK_ID, session_key: "sess-python" },
  };
  try {
    // A registered-but-unknown workflow id must never reach the adapter.
    await assert.rejects(
      () =>
        guard.beforeToolCall(
          {
            toolName: "zink_n8n",
            params: {
              ...baseParams,
              input: {
                workflow_id: "not_a_registered_workflow",
                payload: {},
              },
            },
          },
          {
            agentId: "python",
            sessionKey: "sess-python",
            runId: "run-python",
          },
        ),
      /SCHEMA_VALIDATION_FAILED|RUNTIME_CAPABILITY_MISMATCH/,
    );

    // A registered workflow whose payload violates its own closed schema is
    // refused before any transport rather than forwarded upstream.
    await assert.rejects(
      () =>
        guard.beforeToolCall(
          {
            toolName: "zink_n8n",
            params: {
              ...baseParams,
              call_id: "00000000-0000-4000-8000-0000000000cc",
              input: { workflow_id: "pipeline_notify", payload: {} },
            },
          },
          {
            agentId: "python",
            sessionKey: "sess-python",
            runId: "run-python",
          },
        ),
      /SCHEMA_VALIDATION_FAILED/,
    );

    // A caller whose delegation does not carry zink_n8n is denied, never
    // attempted. Whatever the denial class, a success envelope is impossible.
    await assert.rejects(
      () =>
        guard.beforeToolCall(
          {
            toolName: "zink_n8n",
            params: {
              ...baseParams,
              call_id: "00000000-0000-4000-8000-0000000000dd",
              specialist: "sql",
              input: {
                workflow_id: "pipeline_notify",
                payload: { delivered: true },
              },
            },
          },
          {
            agentId: "sql",
            sessionKey: "sess-python",
            runId: "run-python",
          },
        ),
      (error) => {
        assert.notEqual(error.message, "undefined");
        return true;
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D5: the real n8n adapter is reachable and enforces its own governed contract", async () => {
  // Proves the implementation the model-visible path is now wired to is a real
  // governed adapter rather than a stub: it validates caller authority from the
  // frozen decision context and refuses an unknown workflow.
  const { invokeN8n, N8nAdapterError } =
    await import("../zink-tools/n8n/trigger.mjs");
  const decisionContext = {
    scope: { common: { toolId: "zink_n8n", agentId: "o2" } },
    correlation: { call_id: "n8n-live-1" },
    effective_constraints: { timeout_ms: 5000 },
  };
  await assert.rejects(
    () =>
      invokeN8n(decisionContext, {
        workflow_id: "not_registered",
        payload: {},
      }),
    (error) => {
      assert.ok(error instanceof N8nAdapterError);
      assert.equal(error.code, "RUNTIME_CAPABILITY_MISMATCH");
      return true;
    },
  );
  // A caller outside the workflow allowlist is refused before any transport.
  await assert.rejects(
    () =>
      invokeN8n(
        {
          ...decisionContext,
          scope: { common: { toolId: "zink_n8n", agentId: "excel" } },
        },
        { workflow_id: "pipeline_notify", payload: {} },
      ),
    (error) => {
      assert.equal(error.code, "AUTH_POLICY_DENIED");
      return true;
    },
  );
});

// ===========================================================================
// Domain E: SQL cannot present a contract fixture as a real datasource
// ===========================================================================

test("E1: DuckDB never reports a real datasource from fixture data", async () => {
  const res = await executeGovernedDuckDbQuery(
    { agent_id: "sql", task_id: TASK_ID },
    {
      query: "SELECT * FROM knowledge",
      target_database: "knowledge",
      max_rows: 10,
    },
  ).catch((error) => ({ error }));
  if (res.error) {
    // No DuckDB engine on this host is NOT RUN, never a fabricated pass.
    assert.equal(res.error.code, "DUCKDB_ENGINE_NOT_AVAILABLE");
    return;
  }
  assert.notEqual(
    res.execution_state,
    "REAL_EXECUTED",
    "fixture rows must never be reported as real execution",
  );
  assert.equal(res.execution_state, "FIXTURE_CONTRACT_EXECUTED");
  assert.equal(res.data_source, "contract_fixture");
});

test("E2: the simulation mode is explicitly labelled and never claims a datasource", async () => {
  const res = await executeGovernedDuckDbQuery(
    { agent_id: "sql", task_id: TASK_ID },
    {
      query: "SELECT id, name, value FROM knowledge",
      target_database: "knowledge",
    },
    { simulationMode: true },
  );
  assert.equal(res.execution_state, "TEST_SIMULATION");
  assert.equal(res.data_source, "in_process_simulation");
});

// ===========================================================================
// Domain F: R2 bucket and version validation fail closed
// ===========================================================================

test("F1: an unknown bucket never silently resolves to landing", async () => {
  const adapter = new R2StorageAdapter();
  const landing = await adapter.putLandingArtifact({
    task_id: TASK_ID,
    run_id: "run-1",
    artifact_id: "raw-orders",
    data: JSON.stringify([{ id: 1 }]),
  });
  assert.equal(landing.bucket, "landing");

  for (const bucket of [
    "gold",
    "Bronze",
    "Silver",
    "LANDING",
    "",
    null,
    undefined,
    42,
    "../landing",
  ]) {
    await assert.rejects(
      () => adapter.getArtifact(bucket, "raw-orders"),
      (error) => {
        assert.ok(error instanceof R2AdapterError);
        assert.equal(error.code, "R2_INVALID_BUCKET");
        return true;
      },
      `bucket ${String(bucket)} must fail closed`,
    );
  }
});

test("F2: a valid bucket still reads its own zone", async () => {
  const adapter = new R2StorageAdapter();
  await adapter.putLandingArtifact({
    task_id: TASK_ID,
    run_id: "run-1",
    artifact_id: "raw-orders",
    data: "payload",
  });
  const found = await adapter.getArtifact("landing", "raw-orders");
  assert.equal(found.bucket, "landing");
  await assert.rejects(
    () => adapter.getArtifact("silver", "raw-orders"),
    (error) => error.code === "R2_INVALID_SILVER_VERSION",
  );
  await assert.rejects(
    () => adapter.getArtifact("landing", "absent"),
    (error) => error.code === "R2_ARTIFACT_NOT_FOUND",
  );
});

test("F3: a non-positive, fractional, or injected Silver version fails closed", async () => {
  const adapter = new R2StorageAdapter();
  for (const version of [
    0,
    -1,
    -100,
    1.5,
    "1",
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "../../landing/orders",
    1e9,
  ]) {
    await assert.rejects(
      () =>
        adapter.promoteToSilver({
          task_id: TASK_ID,
          run_id: "run-1",
          artifact_id: "clean-orders",
          version,
          data: "payload",
        }),
      (error) => {
        assert.ok(error instanceof R2AdapterError);
        assert.equal(error.code, "R2_INVALID_SILVER_VERSION");
        return true;
      },
      `version ${String(version)} must fail closed`,
    );
  }
});

test("F4: a valid Silver promotion still works and still collides", async () => {
  const adapter = new R2StorageAdapter();
  const promoted = await adapter.promoteToSilver({
    task_id: TASK_ID,
    run_id: "run-1",
    artifact_id: "clean-orders",
    version: 1,
    data: "payload",
  });
  assert.equal(promoted.bucket, "silver");
  assert.equal(promoted.version, 1);
  await assert.rejects(
    () =>
      adapter.promoteToSilver({
        task_id: TASK_ID,
        run_id: "run-1",
        artifact_id: "clean-orders",
        version: 1,
        data: "payload",
      }),
    (error) => error.code === "R2_SILVER_VERSION_COLLISION",
  );
});

// ===========================================================================
// Domain G: external adapters are labelled as simulations, not integrations
// ===========================================================================

test("G1: every external infrastructure adapter declares it is a simulation", () => {
  const adapters = [
    "analytics/bigquery-adapter.mjs",
    "analytics/motherduck-adapter.mjs",
    "compute/databricks-adapter.mjs",
    "compute/kaggle-adapter.mjs",
    "mlops/mlflow-adapter.mjs",
    "mlops/dagshub-adapter.mjs",
    "mlops/huggingface-adapter.mjs",
    "app/streamlit-adapter.mjs",
  ];
  for (const rel of adapters) {
    const source = fs.readFileSync(
      new URL(`../zink-tools/adapters/${rel}`, import.meta.url),
      "utf8",
    );
    assert.ok(
      source.includes("SIMULATION_CONTRACT"),
      `${rel} must declare that it is a contract test double`,
    );
  }
});

test("G2: the R2 adapter declares that it is not a provider integration", () => {
  const source = fs.readFileSync(
    new URL("../zink-tools/adapters/storage/r2-adapter.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("NOT A PROVIDER INTEGRATION"));
  assert.ok(source.includes("R2_ALLOWED_BUCKETS"));
});

test("G3: no external adapter performs a provider network call", () => {
  const adapters = [
    "analytics/bigquery-adapter.mjs",
    "analytics/motherduck-adapter.mjs",
    "compute/databricks-adapter.mjs",
    "compute/kaggle-adapter.mjs",
    "mlops/mlflow-adapter.mjs",
    "mlops/dagshub-adapter.mjs",
    "mlops/huggingface-adapter.mjs",
    "app/streamlit-adapter.mjs",
    "storage/r2-adapter.mjs",
  ];
  for (const rel of adapters) {
    const source = fs.readFileSync(
      new URL(`../zink-tools/adapters/${rel}`, import.meta.url),
      "utf8",
    );
    assert.equal(
      /\b(fetch|https?\.|XMLHttpRequest|WebSocket)\b/.test(
        source.replace(/https?:\/\/[^\s"')]*/gu, ""),
      ),
      false,
      `${rel} must not contain a provider network call`,
    );
    assert.equal(
      /from "node:(http|https|net)"|require\("node:(http|https|net)"\)/.test(
        source,
      ),
      false,
      `${rel} must not import an HTTP client`,
    );
  }
});

// ===========================================================================
// Domain H: documentation may not call a canned result a real integration
// ===========================================================================

test("H1: the adapters README classifies each adapter instead of implying it is live", () => {
  const readme = fs.readFileSync(
    new URL("../zink-tools/adapters/README.md", import.meta.url),
    "utf8",
  );
  assert.ok(
    /simulation|test double|contract test double|NOT IMPLEMENTED/i.test(readme),
    "the adapters README must classify adapter status explicitly",
  );
});

test("H2: the tools README does not advertise the simulators as live backends", () => {
  const readme = fs.readFileSync(
    new URL("../zink-tools/README.md", import.meta.url),
    "utf8",
  );
  for (const provider of [
    "BigQuery",
    "MotherDuck",
    "Databricks",
    "Kaggle",
    "Streamlit",
    "Hugging Face",
    "DagsHub",
  ]) {
    const at = readme.indexOf(provider);
    if (at < 0) continue;
    const window = readme.slice(Math.max(0, at - 400), at + 400);
    assert.ok(
      /simulation|test double|not implemented|không phải|chưa triển khai|contract/i.test(
        window,
      ),
      `${provider} must be described as simulation/not-implemented, not live`,
    );
  }
});

test("H3: the contracts README field list uses the real lowercase envelope statuses", () => {
  const readme = fs.readFileSync(
    new URL("../zink-tools/contracts/README.md", import.meta.url),
    "utf8",
  );
  // Only the field list is asserted. The README also carries a historical note
  // that deliberately quotes the old uppercase spelling, which is correct
  // documentation of the correction rather than a live contract claim.
  const statusField = readme
    .split("\n")
    .find((line) => line.trimStart().startsWith("- `status`:"));
  assert.ok(statusField, "the envelope status field must be documented");
  assert.ok(
    statusField.includes('`"success"`'),
    "the documented status must be the real lowercase value",
  );
  assert.ok(statusField.includes('`"error"`'));
  assert.ok(statusField.includes('`"timeout"`'));
  assert.ok(statusField.includes('`"cancelled"`'));
  assert.equal(
    /^\s*-\s*`status`:\s*`"SUCCESS"`/u.test(statusField),
    false,
    "the status field must not document the stale uppercase value",
  );
  // The schema is the source of truth and must remain lowercase.
  const schema = JSON.parse(
    fs.readFileSync(
      new URL(
        "../zink-tools/contracts/tool-result.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const statuses = new Set();
  const walk = (node) => {
    if (node && typeof node === "object") {
      if (node.status && typeof node.status.const === "string") {
        statuses.add(node.status.const);
      }
      for (const value of Object.values(node)) walk(value);
    }
  };
  walk(schema);
  assert.deepEqual(
    [...statuses].sort(),
    ["cancelled", "error", "success", "timeout"],
    "the schema statuses are the contract truth",
  );
});

// ===========================================================================
// Domain I: queue/release consistency in the shipped execution path
// ===========================================================================

function readExecutionPath() {
  return fs.readFileSync(
    new URL(
      "../integrations/openclaw/plugins/zink-governance/index.mjs",
      import.meta.url,
    ),
    "utf8",
  );
}

function sliceExecuteApprovedTask() {
  const source = readExecutionPath();
  const start = source.indexOf("async function executeApprovedTask(");
  const end = source.indexOf("const unregister = registerNativeGuard", start);
  assert.ok(start > 0 && end > start, "executeApprovedTask must exist");
  return { source, body: source.slice(start, end) };
}

test("I1: the destination is preflighted BEFORE the durable queue write", () => {
  const { body } = sliceExecuteApprovedTask();
  const preflight = body.indexOf(
    "const destination = resolveCoordinatorDestination(",
  );
  const enqueue = body.indexOf(
    "queueStatus = enqueueApprovedTaskForExecution(",
  );
  assert.ok(preflight > 0, "destination preflight must exist");
  assert.ok(enqueue > 0, "enqueue must exist");
  assert.ok(
    preflight < enqueue,
    "an unresolvable destination must be refused before anything is queued, " +
      "otherwise a task can be stranded in QUEUED with no way to notify anyone",
  );
  // The preflight failure path must report NOT_QUEUED so no caller can read the
  // refusal as a queued task. The NOT_QUEUED marker must sit BEFORE the enqueue
  // call, which is what proves the refusal is genuinely a pre-write refusal.
  const notQueued = body.indexOf('queue_status: "NOT_QUEUED"');
  assert.ok(notQueued > 0, "the preflight refusals must report NOT_QUEUED");
  assert.ok(
    notQueued < enqueue,
    "NOT_QUEUED must be reported before any durable queue write",
  );
  // The destination error is surfaced verbatim from the resolver.
  assert.ok(
    body.includes("error: destination.error"),
    "the unresolved destination must be surfaced, not swallowed",
  );
});

test("I2: no durable queue write happens before the dispatch target is valid", () => {
  const { body } = sliceExecuteApprovedTask();
  const derived = body.indexOf("deriveGovernedDispatchTarget(task)");
  const enqueue = body.indexOf(
    "queueStatus = enqueueApprovedTaskForExecution(",
  );
  assert.ok(derived >= 0);
  assert.ok(derived < enqueue, "the dispatch target must be derived first");
  // The invalid-target refusal must precede the write too, and it must surface
  // the precise reason (including topology containment) rather than a generic
  // message.
  const notQueued = body.indexOf('queue_status: "NOT_QUEUED"');
  assert.ok(
    notQueued < enqueue,
    "an invalid dispatch target must not be queued",
  );
  assert.ok(
    body.includes("error: dispatch.error"),
    "the precise dispatch error must be surfaced",
  );
  assert.ok(
    body.includes("[zink-governance] approved task not dispatched"),
    "an undispatchable task must be logged as such",
  );
});

test("I3: the plugin never claims the queue or starts execution", () => {
  const { body } = sliceExecuteApprovedTask();
  for (const forbidden of [
    "claimTaskById",
    "claimTask(",
    "sessions_spawn",
    "handleExecutionFinished(",
    "READY_FOR_REVIEW",
  ]) {
    assert.equal(
      body.includes(forbidden),
      false,
      `the post-approval path must not use ${forbidden}`,
    );
  }
});

test("I4: the delivered-notification outcome comes from the shared pure policy", () => {
  const { body } = sliceExecuteApprovedTask();
  // The first-approval path must consult the same pure policy the duplicate
  // path uses, so the two cannot drift into disagreeing semantics.
  assert.ok(
    body.includes("runFirstApprovalNotification("),
    "the execution path must use the shared notification attempt owner",
  );
  // And a notification outcome is durably recorded so a failed handoff is
  // observable and retryable instead of implicit.
  assert.ok(
    body.includes("recordCoordinatorNotification("),
    "the notification outcome must be recorded durably",
  );
});

test("I5: recording a notification never advances the authoritative task state", () => {
  const source = readExecutionPath();
  const start = source.indexOf("function recordCoordinatorNotification(");
  const end = source.indexOf("async function executeApprovedTask(", start);
  // Strip comments first: the function documents that it does NOT touch
  // workflow_status, and asserting on prose would prove nothing.
  const body = source
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  // It may annotate the queue projection, but it must not touch the ledger.
  assert.equal(
    /recordWorkflowEvent/.test(body),
    false,
    "the notification record must not write a workflow event",
  );
  assert.equal(
    /workflow_status/.test(body),
    false,
    "the notification record must not change the authoritative workflow state",
  );
  assert.equal(
    /EXECUTING|claim/.test(body),
    false,
    "the notification record must not claim or begin an execution",
  );
  // It annotates only the queue projection, and persists it.
  assert.ok(body.includes("coordinatorNotification"));
  assert.ok(body.includes("defaultQueueManager.save()"));
});

// ===========================================================================
// Domain J: duplicate approval performs no redundant side effect
// ===========================================================================
//
// These exercise runDuplicateApprovalHandoff, which is the branch the shipped
// post-approval path actually calls. The earlier defect was exactly here: the
// transport was invoked before the outcome was resolved, so a duplicate sent a
// second Discord message even though it reported ALREADY_NOTIFIED. Asserting
// only on resolveCoordinatorHandoffOutcome would not have caught that, so every
// case below spies on the transport.

function spyTransport(result = { delivered: true }) {
  const calls = [];
  const notify = async () => {
    calls.push({ at: calls.length });
    if (result instanceof Error) throw result;
    return result;
  };
  notify.calls = calls;
  return notify;
}

function spyPersist() {
  const writes = [];
  const persist = (value) => {
    writes.push(value);
    return { ok: true };
  };
  persist.writes = writes;
  return persist;
}

/** A persistence spy that returns a caller-chosen result, for failure paths. */
function spyPersistReturning(result) {
  const writes = [];
  const persist = (value) => {
    writes.push(value);
    return result;
  };
  persist.writes = writes;
  return persist;
}

test("J1: a duplicate after a delivered notification emits ZERO messages", async () => {
  const notify = spyTransport();
  const persist = spyPersist();
  const preExisting = Object.freeze({
    status: "QUEUED",
    coordinatorNotification: { delivered: true },
  });

  const outcome = await runDuplicateApprovalHandoff({
    preExisting,
    notify,
    persist,
  });

  assert.equal(
    notify.calls.length,
    0,
    "a delivered notification must not be sent again",
  );
  assert.equal(persist.writes.length, 0, "the record must not be rewritten");
  assert.equal(outcome.handoff, "ALREADY_NOTIFIED");
  assert.equal(outcome.status, "QUEUED");
  assert.notEqual(outcome.status, "RELEASED_TO_COORDINATOR");
  assert.notEqual(outcome.handoff, "EXECUTING");
  assert.equal(outcome.notified, false);
  // The frozen record is untouched.
  assert.deepEqual(preExisting.coordinatorNotification, { delivered: true });
});

test("J2: a duplicate with delivered:false retries the transport exactly once", async () => {
  const notify = spyTransport({ delivered: true });
  const persist = spyPersist();
  const outcome = await runDuplicateApprovalHandoff({
    preExisting: {
      status: "QUEUED",
      coordinatorNotification: { delivered: false },
    },
    notify,
    persist,
  });

  assert.equal(
    notify.calls.length,
    1,
    "an undelivered record must be retried once",
  );
  assert.equal(persist.writes.length, 1, "the retry outcome must be persisted");
  assert.deepEqual(
    persist.writes[0],
    { delivered: true, error: undefined, evidence: null },
    "the durable record must carry the delivery-evidence slot",
  );
  assert.equal(outcome.handoff, "NOTIFIED");
  assert.equal(outcome.notified, true);
  assert.equal(outcome.persisted, true);
});

test("J3: a failed retry stays retryable and never claims success", async () => {
  const notify = spyTransport({
    delivered: false,
    error: "COORDINATOR_NOTIFICATION_FAILED: boom",
  });
  const persist = spyPersist();
  const outcome = await runDuplicateApprovalHandoff({
    preExisting: {
      status: "QUEUED",
      coordinatorNotification: { delivered: false },
    },
    notify,
    persist,
  });

  assert.equal(notify.calls.length, 1);
  assert.equal(outcome.handoff, "NOTIFICATION_FAILED");
  assert.equal(outcome.status, "QUEUED");
  assert.match(outcome.error, /COORDINATOR_NOTIFICATION_FAILED/);
});

test("J4: an existing item with no notification record is retried once", async () => {
  const notify = spyTransport({ delivered: true });
  const persist = spyPersist();
  const outcome = await runDuplicateApprovalHandoff({
    preExisting: { status: "QUEUED" },
    notify,
    persist,
  });

  assert.equal(notify.calls.length, 1, "a missing record must be retried once");
  assert.equal(persist.writes.length, 1);
  assert.equal(outcome.handoff, "NOTIFIED");
});

test("J5: repeated duplicates converge to exactly one notification", async () => {
  // Sequence: the FIRST approval delivers (one transport call), then three
  // duplicate approvals arrive. Total transport calls must be exactly one.
  const notify = spyTransport({ delivered: true });
  const persist = spyPersist();

  // First approval delivery.
  const first = await notify();
  persist({ delivered: first.delivered, error: first.error });
  assert.equal(notify.calls.length, 1);

  let record = {
    status: "QUEUED",
    coordinatorNotification: { delivered: true },
  };
  const handoffs = [];
  for (let i = 0; i < 3; i += 1) {
    const outcome = await runDuplicateApprovalHandoff({
      preExisting: record,
      notify,
      persist,
    });
    handoffs.push(outcome.handoff);
    // Model the real persistence: a delivered notification stays delivered, and
    // an untouched record is left exactly as it was. A duplicate that is not
    // notified must NOT downgrade the stored record to "not delivered".
    if (outcome.notified) {
      record = {
        ...record,
        coordinatorNotification: { delivered: outcome.handoff === "NOTIFIED" },
      };
    }
  }

  assert.equal(
    notify.calls.length,
    1,
    "three duplicates must not add a single transport call",
  );
  assert.equal(persist.writes.length, 1);
  assert.deepEqual(handoffs, [
    "ALREADY_NOTIFIED",
    "ALREADY_NOTIFIED",
    "ALREADY_NOTIFIED",
  ]);
});

test("J6: an EXECUTING item is left completely alone", async () => {
  const notify = spyTransport();
  const persist = spyPersist();
  const preExisting = {
    status: "EXECUTING",
    claimedBy: "o1",
    leaseId: "lease-abc",
    coordinatorNotification: { delivered: true },
  };

  const outcome = await runDuplicateApprovalHandoff({
    preExisting,
    notify,
    persist,
  });

  assert.equal(notify.calls.length, 0, "EXECUTING must not be notified");
  assert.equal(persist.writes.length, 0, "EXECUTING must not be rewritten");
  // The authoritative state is preserved verbatim, never restated as QUEUED.
  assert.equal(outcome.status, "EXECUTING");
  assert.equal(outcome.queue_status, "EXECUTING");
  assert.equal(outcome.handoff, "ALREADY_PROCESSED");
  assert.notEqual(outcome.status, "QUEUED");
  // The record is untouched, so a claim and lease cannot be disturbed.
  assert.deepEqual(preExisting, {
    status: "EXECUTING",
    claimedBy: "o1",
    leaseId: "lease-abc",
    coordinatorNotification: { delivered: true },
  });
});

test("J7: terminal queue states are left alone and keep their own status", async () => {
  for (const status of [
    "COMPLETE",
    "PARTIAL",
    "FAILED",
    "CANCELLED",
    "REJECTED",
  ]) {
    const notify = spyTransport();
    const persist = spyPersist();
    const outcome = await runDuplicateApprovalHandoff({
      preExisting: { status },
      notify,
      persist,
    });
    assert.equal(notify.calls.length, 0, `${status} must not be notified`);
    assert.equal(persist.writes.length, 0, `${status} must not be rewritten`);
    assert.equal(outcome.status, status, `${status} must be preserved`);
    assert.equal(outcome.handoff, "ALREADY_PROCESSED");
  }
});

test("J8: no duplicate outcome is ever RELEASED_TO_COORDINATOR", async () => {
  const states = [
    { status: "QUEUED", coordinatorNotification: { delivered: true } },
    { status: "QUEUED", coordinatorNotification: { delivered: false } },
    { status: "QUEUED" },
    { status: "EXECUTING" },
    { status: "COMPLETE" },
  ];
  for (const delivered of [true, false]) {
    for (const preExisting of states) {
      const outcome = await runDuplicateApprovalHandoff({
        preExisting,
        notify: spyTransport({ delivered }),
        persist: spyPersist(),
      });
      assert.notEqual(
        outcome.status,
        "RELEASED_TO_COORDINATOR",
        `${preExisting.status} must never report a released handoff`,
      );
    }
  }
});

test("J9: the shipped path calls the tested branch and cannot notify twice", () => {
  // Structural proof that the branch under test IS the one that runs, and that
  // no unconditional notification call remains in the duplicate arm.
  const source = fs.readFileSync(
    new URL(
      "../integrations/openclaw/plugins/zink-governance/index.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const start = source.indexOf("async function executeApprovedTask(");
  const end = source.indexOf("const unregister = registerNativeGuard", start);
  const body = source.slice(start, end);

  assert.ok(
    body.includes("runDuplicateApprovalHandoff("),
    "the execution path must delegate to the tested duplicate branch",
  );

  const dupStart = body.indexOf(
    "const preExisting = defaultQueueManager.getTask(",
  );
  const dupEnd = body.indexOf("let queueStatus;");
  assert.ok(dupStart >= 0 && dupEnd > dupStart, "the duplicate arm must exist");
  const duplicateArm = body.slice(dupStart, dupEnd);

  // The transport may only appear as the INJECTED notify callback, never as a
  // direct call in the duplicate arm. That indirection is what makes the
  // already-delivered short circuit possible.
  assert.equal(
    (duplicateArm.match(/deliverCoordinatorNotification[(]/g) ?? []).length,
    1,
    "the duplicate arm must reference the transport exactly once, as an injection",
  );
  assert.ok(
    /notify:\s*\(\)\s*=>\s*deliverCoordinatorNotification[(]/.test(
      duplicateArm,
    ),
    "the transport must be passed as the injected notify callback",
  );
  // The queue write may likewise only appear as the injected persist callback.
  assert.equal(
    (duplicateArm.match(/recordCoordinatorNotification[(]/g) ?? []).length,
    1,
    "the duplicate arm must reference the queue write exactly once, as an injection",
  );
  assert.ok(
    /persist:\s*\(\{[\s\S]{0,80}?\}\)\s*=>\s*recordCoordinatorNotification[(]/.test(
      duplicateArm,
    ),
    "the queue write must be passed as the injected persist callback",
  );
  // And it must not claim, execute or enqueue.
  for (const forbidden of [
    "claimTaskById",
    "claimTask(",
    "enqueueTask(",
    "sessions_spawn",
  ]) {
    assert.equal(
      duplicateArm.includes(forbidden),
      false,
      `the duplicate arm must not ${forbidden}`,
    );
  }
});

// ===========================================================================
// Domain K: notification persistence truth and concurrency
// ===========================================================================
//
// J1..J9 fixed the delivered-duplicate side effect. Two boundaries remained:
// a persistence failure after a successful send could be reported as a durable
// success, and nothing stopped two overlapping duplicates from both sending.
// The tests below drive the shipped branch for both.

const TASK = "e".repeat(64);

function makeRegistry() {
  return new Map();
}

test("K1/J10: a successful send whose record fails to persist is NOT reported as durable", async () => {
  const notify = spyTransport({
    delivered: true,
    evidence: { message_id: "1234567890", channel_id: "9876543210" },
  });
  const persist = spyPersistReturning({
    ok: false,
    error: "QUEUE_STORAGE_WRITE_FAILED",
  });

  const outcome = await runDuplicateApprovalHandoff({
    taskId: TASK,
    preExisting: {
      status: "QUEUED",
      coordinatorNotification: { delivered: false },
    },
    notify,
    persist,
  });

  assert.equal(notify.calls.length, 1, "the transport ran exactly once");
  assert.equal(
    persist.writes.length,
    1,
    "persistence was attempted exactly once",
  );

  // It must NOT claim the durable record was written.
  assert.notEqual(
    outcome.persisted,
    true,
    "a failed write must never be reported as persisted",
  );
  assert.equal(outcome.persisted, false);

  // It must NOT claim NOTIFIED, because NOTIFIED implies future duplicates
  // short-circuit, which requires the durable record to exist.
  assert.notEqual(
    outcome.handoff,
    "NOTIFIED",
    "NOTIFIED would claim an idempotency the repository does not have",
  );
  assert.equal(outcome.handoff, "NOTIFICATION_STATE_UNCERTAIN");
  assert.match(outcome.error, /QUEUE_STORAGE_WRITE_FAILED|PERSIST_FAILED/);

  // The transport evidence must survive so an operator can reconcile it, because
  // the message genuinely exists.
  assert.deepEqual(outcome.delivery_evidence, {
    message_id: "1234567890",
    channel_id: "9876543210",
  });
  // And it must not mean "nothing was sent".
  assert.equal(outcome.notified, true);
  assert.notEqual(outcome.status, "RELEASED_TO_COORDINATOR");
});

test("K2/J11: { ok: false } is never coerced into persisted:true", async () => {
  // The original bug was Boolean(record), and { ok: false } is a truthy object.
  // Exercise several shapes a persistence implementation might return.
  for (const returned of [
    { ok: false },
    { ok: false, error: "QUEUE_STORAGE_WRITE_FAILED" },
    undefined,
    null,
    {},
  ]) {
    const persist = spyPersistReturning(returned);
    const outcome = await runDuplicateApprovalHandoff({
      taskId: TASK,
      preExisting: {
        status: "QUEUED",
        coordinatorNotification: { delivered: false },
      },
      notify: spyTransport({ delivered: true }),
      persist,
    });
    assert.equal(
      outcome.persisted,
      false,
      `${JSON.stringify(returned)} must not yield persisted:true`,
    );
    assert.equal(
      outcome.handoff,
      "NOTIFICATION_STATE_UNCERTAIN",
      "an unwritten record must be reported as uncertain, not notified",
    );
  }
});

test("K3/J12: a delivered duplicate still emits nothing at all", async () => {
  const notify = spyTransport();
  const persist = spyPersist();
  const preExisting = Object.freeze({
    status: "QUEUED",
    coordinatorNotification: { delivered: true },
  });

  const outcome = await runDuplicateApprovalHandoff({
    taskId: TASK,
    preExisting,
    notify,
    persist,
  });

  assert.equal(notify.calls.length, 0, "no transport call");
  assert.equal(persist.writes.length, 0, "no persistence write");
  assert.equal(outcome.handoff, "ALREADY_NOTIFIED");
  assert.equal(outcome.persisted, false);
  assert.deepEqual(preExisting.coordinatorNotification, { delivered: true });
});

test("K4/J13: overlapping duplicate approvals produce at most one send", async () => {
  // The two invocations are deliberately synchronised so they BOTH reach the
  // reservation step before either sends. Without the reservation, the second
  // observes the same undelivered record and sends as well.
  const registry = makeRegistry();
  let arrive;
  const bothArrived = new Promise((resolve) => {
    arrive = resolve;
  });
  let arrivals = 0;

  const notify = async () => {
    arrivals += 1;
    if (arrivals === 2) arrive();
    // Hold the first send open until the second invocation has had its chance to
    // observe the record, which is the race the reservation must close.
    await Promise.race([
      bothArrived,
      new Promise((resolve) => setTimeout(resolve, 200)),
    ]);
    return {
      delivered: true,
      evidence: { message_id: "m-1", channel_id: "c-1" },
    };
  };
  let calls = 0;
  const counted = () => {
    calls += 1;
    return notify();
  };

  const preExisting = {
    status: "QUEUED",
    coordinatorNotification: { delivered: false },
  };
  const results = await Promise.all([
    runDuplicateApprovalHandoff({
      taskId: TASK,
      preExisting,
      notify: counted,
      persist: spyPersistReturning({ ok: true }),
      reserve: (id) => reserveCoordinatorNotificationAttempt(id, { registry }),
    }),
    runDuplicateApprovalHandoff({
      taskId: TASK,
      preExisting,
      notify: counted,
      persist: spyPersistReturning({ ok: true }),
      reserve: (id) => reserveCoordinatorNotificationAttempt(id, { registry }),
    }),
  ]);

  assert.equal(
    calls,
    1,
    "two overlapping duplicates must produce at most one notification attempt",
  );
  const handoffs = results.map((r) => r.handoff).sort();
  assert.deepEqual(handoffs, ["NOTIFICATION_IN_PROGRESS", "NOTIFIED"]);
  // The loser must not claim a send or a durable record.
  const loser = results.find((r) => r.handoff === "NOTIFICATION_IN_PROGRESS");
  assert.equal(loser.notified, false);
  assert.equal(loser.persisted, false);
  assert.notEqual(loser.status, "RELEASED_TO_COORDINATOR");
});

test("K5: five overlapping duplicates still yield a single send", async () => {
  const registry = makeRegistry();
  let calls = 0;
  const preExisting = {
    status: "QUEUED",
    coordinatorNotification: { delivered: false },
  };
  const run = () =>
    runDuplicateApprovalHandoff({
      taskId: TASK,
      preExisting,
      notify: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          delivered: true,
          evidence: { message_id: "m", channel_id: "c" },
        };
      },
      persist: spyPersistReturning({ ok: true }),
      reserve: (id) => reserveCoordinatorNotificationAttempt(id, { registry }),
    });
  const results = await Promise.all([run(), run(), run(), run(), run()]);
  assert.equal(calls, 1, "at most one notification for one logical attempt");
  assert.equal(
    results.filter((r) => r.handoff === "NOTIFIED").length,
    1,
    "exactly one caller may report a successful notification",
  );
  assert.equal(
    results.filter((r) => r.handoff === "NOTIFICATION_IN_PROGRESS").length,
    4,
  );
});

test("K6/J14: a concurrent failed notification stays retryable and claims nothing", async () => {
  const registry = makeRegistry();
  let calls = 0;
  const preExisting = {
    status: "QUEUED",
    coordinatorNotification: { delivered: false },
  };
  const run = () =>
    runDuplicateApprovalHandoff({
      taskId: TASK,
      preExisting,
      notify: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          delivered: false,
          error: "COORDINATOR_NOTIFICATION_FAILED: down",
        };
      },
      persist: spyPersistReturning({ ok: true }),
      reserve: (id) => reserveCoordinatorNotificationAttempt(id, { registry }),
    });
  const results = await Promise.all([run(), run()]);

  assert.equal(calls, 1, "only one attempt is made while one is in flight");
  for (const result of results) {
    assert.notEqual(
      result.handoff,
      "NOTIFIED",
      "a failure must never be reported as notified",
    );
    assert.notEqual(result.handoff, "AWAITING_COORDINATOR_PICKUP");
    assert.equal(
      result.persisted,
      false,
      "a failed send with a written failure record is not a persisted success",
    );
    assert.notEqual(result.status, "RELEASED_TO_COORDINATOR");
  }
  // The loser is told an attempt is in flight, and the winner reports failure.
  const handoffs = results.map((r) => r.handoff).sort();
  assert.deepEqual(handoffs, [
    "NOTIFICATION_FAILED",
    "NOTIFICATION_IN_PROGRESS",
  ]);

  // The durable failure record leaves the task retryable: a later, separate
  // invocation (after the reservation is released) can still notify.
  const retry = await runDuplicateApprovalHandoff({
    taskId: TASK,
    preExisting: {
      status: "QUEUED",
      coordinatorNotification: { delivered: false },
    },
    notify: spyTransport({ delivered: true }),
    persist: spyPersistReturning({ ok: true }),
    reserve: (id) => reserveCoordinatorNotificationAttempt(id, { registry }),
  });
  assert.equal(
    retry.handoff,
    "NOTIFIED",
    "a failed attempt must remain retryable",
  );
});

test("K7/J15: a released reservation does not make a failed persistence look safe", async () => {
  // The uncertain case must NOT short-circuit a future duplicate, because the
  // durable record does not know the message exists.
  const notify = spyTransport({
    delivered: true,
    evidence: { message_id: "m-9", channel_id: "c-9" },
  });
  const persist = spyPersistReturning({
    ok: false,
    error: "QUEUE_STORAGE_WRITE_FAILED",
  });
  const registry = makeRegistry();

  const first = await runDuplicateApprovalHandoff({
    taskId: TASK,
    preExisting: {
      status: "QUEUED",
      coordinatorNotification: { delivered: false },
    },
    notify,
    persist,
    reserve: (id) => reserveCoordinatorNotificationAttempt(id, { registry }),
  });
  assert.equal(first.handoff, "NOTIFICATION_STATE_UNCERTAIN");

  // The reservation was released, so a later duplicate is allowed to try again.
  assert.equal(
    isCoordinatorNotificationAttemptInFlight(TASK, { registry }),
    false,
    "the reservation must be released on every path",
  );

  // Because the record was not written, the duplicate still sees an undelivered
  // state. That is the honest, documented consequence: at-least-once across an
  // external transport with a failed durable write, never a false success.
  const second = await runDuplicateApprovalHandoff({
    taskId: TASK,
    preExisting: {
      status: "QUEUED",
      coordinatorNotification: { delivered: false },
    },
    notify,
    persist: spyPersistReturning({ ok: true }),
    reserve: (id) => reserveCoordinatorNotificationAttempt(id, { registry }),
  });
  assert.equal(second.handoff, "NOTIFIED");
  assert.equal(notify.calls.length, 2);
  // The uncertainty was visible, not silent.
  assert.match(first.error, /QUEUE_STORAGE_WRITE_FAILED|PERSIST_FAILED/);
  assert.ok(first.delivery_evidence.message_id);
});

test("K8: the reservation expires after its TTL so a crashed send cannot wedge the task", () => {
  const registry = makeRegistry();
  const t0 = 1_000_000;
  const release = reserveCoordinatorNotificationAttempt(TASK, {
    now: t0,
    registry,
  });
  assert.ok(release, "the first attempt claims the reservation");
  assert.equal(
    reserveCoordinatorNotificationAttempt(TASK, { now: t0, registry }),
    null,
    "a second attempt inside the window is refused",
  );
  assert.equal(
    isCoordinatorNotificationAttemptInFlight(TASK, { now: t0, registry }),
    true,
  );
  // Inside the window but not expired.
  assert.equal(
    reserveCoordinatorNotificationAttempt(TASK, {
      now: t0 + NOTIFICATION_ATTEMPT_TTL_MS,
      registry,
    }),
    null,
  );
  // Past the window the reservation is reclaimable, which is what makes a crashed
  // or wedged send recoverable rather than permanently stuck.
  const after = reserveCoordinatorNotificationAttempt(TASK, {
    now: t0 + NOTIFICATION_ATTEMPT_TTL_MS + 1,
    registry,
  });
  assert.ok(after, "an expired reservation must be reclaimable");
  release();
});

test("K9: a throwing transport still releases the reservation", async () => {
  const registry = makeRegistry();
  await assert.rejects(
    () =>
      runDuplicateApprovalHandoff({
        taskId: TASK,
        preExisting: {
          status: "QUEUED",
          coordinatorNotification: { delivered: false },
        },
        notify: async () => {
          throw new Error("transport exploded");
        },
        persist: spyPersist(),
        reserve: (id) =>
          reserveCoordinatorNotificationAttempt(id, { registry }),
      }),
    /transport exploded/,
  );
  assert.equal(
    isCoordinatorNotificationAttemptInFlight(TASK, { registry }),
    false,
    "a throwing transport must not leak the reservation",
  );
});

test("K10: the shipped path supplies a reservation and the real primitive", () => {
  const source = fs.readFileSync(
    new URL(
      "../integrations/openclaw/plugins/zink-governance/index.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const start = source.indexOf("async function executeApprovedTask(");
  const end = source.indexOf("const unregister = registerNativeGuard", start);
  const body = source.slice(start, end);
  assert.ok(
    body.includes("reserve: reserveCoordinatorNotificationAttempt"),
    "the shipped duplicate path must install the reservation primitive",
  );
  // The limitation must be documented rather than implied. Compare against
  // whitespace-normalised source with comment markers stripped, so a comment
  // re-wrap cannot silently satisfy or break the assertion.
  const flattened = source.replace(/^\s*\*(?!\/)/gm, " ").replace(/\s+/g, " ");
  assert.ok(
    flattened.includes(
      "it does NOT provide cross-process exactly-once delivery",
    ),
    "the cross-process limitation must be stated in the code",
  );
  assert.ok(
    flattened.includes("at most one notification attempt per task per process"),
    "the actual guarantee must be stated, not just the limitation",
  );
  // Persistence evidence must be threaded to the durable record.
  assert.ok(body.includes("evidence"));
});

// ===========================================================================
// Domain L: first approval and duplicate share ONE notification guard
// ===========================================================================
//
// The reservation previously protected duplicate-vs-duplicate only. The first
// approval sent inline with no reservation, so a duplicate arriving while the
// transport was still awaiting could claim the reservation and send a second
// message.
//
// These drive runFirstApprovalNotification, which is what executeApprovedTask
// actually calls for a first approval, overlapped against the real duplicate
// branch across the async network boundary with a genuine barrier. An earlier
// draft called runNotificationAttempt directly and therefore still reserved
// inside the helper, so it passed even with the first-path defect present; these
// assertions are written against the shipped first-approval function precisely so
// that defect cannot hide.

const L_TASK = "f".repeat(64);

/** A transport that blocks until open() is called, or timeoutMs elapses. */
function blockingTransport({ result, timeoutMs = 500 } = {}) {
  let open;
  const opened = new Promise((resolve) => {
    open = resolve;
  });
  const calls = [];
  const notify = async () => {
    calls.push({ at: calls.length });
    await Promise.race([
      opened,
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    return (
      result ?? {
        delivered: true,
        evidence: { message_id: "m-1", channel_id: "c-1" },
      }
    );
  };
  notify.calls = calls;
  notify.open = open;
  return notify;
}

const firstApprovalCall = ({ notify, persist, reserve }) =>
  runFirstApprovalNotification({
    taskId: L_TASK,
    coordinator: "o1",
    requiredCapabilities: ["excel"],
    notify,
    persist,
    reserve,
  });

test("L1/K11: a duplicate arriving while the FIRST send is in flight does not send", async () => {
  const registry = makeRegistry();
  const notify = blockingTransport();
  const persist = spyPersistReturning({ ok: true });
  const reserve = (id) =>
    reserveCoordinatorNotificationAttempt(id, { registry });

  // First approval: the queue write has happened, so the shipped first-approval
  // segment starts and its transport blocks across the await.
  const firstPromise = firstApprovalCall({ notify, persist, reserve });

  // Let the first attempt claim the reservation and enter the send.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    isCoordinatorNotificationAttemptInFlight(L_TASK, { registry }),
    true,
    "the first attempt must hold the reservation while its transport is in flight",
  );

  // Second approval arrives while the first is blocked. It observes the existing
  // QUEUED item and enters the duplicate branch.
  const second = await runDuplicateApprovalHandoff({
    taskId: L_TASK,
    preExisting: {
      status: "QUEUED",
      coordinatorNotification: { delivered: false },
    },
    notify,
    persist,
    reserve,
  });

  assert.equal(
    second.handoff,
    "NOTIFICATION_IN_PROGRESS",
    "the duplicate must not send while the first attempt is in flight",
  );
  assert.equal(second.notified, false);
  assert.equal(second.persisted, false);
  assert.notEqual(second.status, "RELEASED_TO_COORDINATOR");

  // Let the first send finish.
  notify.open();
  const first = await firstPromise;
  assert.equal(first.handoff, "AWAITING_COORDINATOR_PICKUP");

  assert.equal(
    notify.calls.length,
    1,
    "only the first approval may emit a notification for this task",
  );
});

test("L2/K12: one first approval plus four overlapping duplicates yields one send", async () => {
  const registry = makeRegistry();
  const notify = blockingTransport();
  const persist = spyPersistReturning({ ok: true });
  const reserve = (id) =>
    reserveCoordinatorNotificationAttempt(id, { registry });

  const firstPromise = firstApprovalCall({ notify, persist, reserve });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const existing = {
    status: "QUEUED",
    coordinatorNotification: { delivered: false },
  };
  const duplicates = await Promise.all(
    [0, 1, 2, 3].map(() =>
      runDuplicateApprovalHandoff({
        taskId: L_TASK,
        preExisting: existing,
        notify,
        persist,
        reserve,
      }),
    ),
  );

  for (const duplicate of duplicates) {
    assert.equal(
      duplicate.handoff,
      "NOTIFICATION_IN_PROGRESS",
      "no duplicate may send while the first attempt holds the reservation",
    );
    assert.equal(duplicate.notified, false);
    assert.notEqual(duplicate.status, "RELEASED_TO_COORDINATOR");
  }

  notify.open();
  const first = await firstPromise;

  assert.equal(first.handoff, "AWAITING_COORDINATOR_PICKUP");
  assert.equal(
    notify.calls.length,
    1,
    "exactly one caller may own the notification attempt",
  );
  assert.equal(
    duplicates.filter((d) => d.handoff === "NOTIFICATION_IN_PROGRESS").length,
    4,
  );
});

test("L3/K13: a failed first notification releases the reservation for a later retry", async () => {
  const registry = makeRegistry();
  const persist = spyPersistReturning({ ok: true });
  const reserve = (id) =>
    reserveCoordinatorNotificationAttempt(id, { registry });

  const first = await firstApprovalCall({
    notify: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        delivered: false,
        error: "COORDINATOR_NOTIFICATION_FAILED: down",
      };
    },
    persist,
    reserve,
  });

  assert.equal(first.handoff, "NOTIFICATION_FAILED");
  assert.equal(
    isCoordinatorNotificationAttemptInFlight(L_TASK, { registry }),
    false,
    "a failed first notification must not leak the reservation",
  );

  // A later duplicate must be allowed to retry.
  let retried = 0;
  const retry = await runDuplicateApprovalHandoff({
    taskId: L_TASK,
    preExisting: {
      status: "QUEUED",
      coordinatorNotification: { delivered: false },
    },
    notify: async () => {
      retried += 1;
      return {
        delivered: true,
        evidence: { message_id: "m-2", channel_id: "c-2" },
      };
    },
    persist,
    reserve,
  });

  assert.equal(retried, 1, "the later duplicate must be able to retry");
  assert.equal(retry.handoff, "NOTIFIED");
  assert.equal(retry.persisted, true);
});

test("L4/K14: a first notification whose record fails to persist releases the reservation", async () => {
  const registry = makeRegistry();
  const reserve = (id) =>
    reserveCoordinatorNotificationAttempt(id, { registry });

  const first = await firstApprovalCall({
    notify: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        delivered: true,
        evidence: { message_id: "m-uncertain", channel_id: "c" },
      };
    },
    persist: spyPersistReturning({
      ok: false,
      error: "QUEUE_STORAGE_WRITE_FAILED",
    }),
    reserve,
  });

  // The message exists; the durable record does not. Reported as uncertainty,
  // never as a safe success and never as "nothing was sent".
  assert.equal(first.handoff, "NOTIFICATION_STATE_UNCERTAIN");
  assert.equal(first.persisted, false);
  assert.equal(first.notified, true);
  assert.deepEqual(first.delivery_evidence, {
    message_id: "m-uncertain",
    channel_id: "c",
  });
  assert.equal(
    isCoordinatorNotificationAttemptInFlight(L_TASK, { registry }),
    false,
    "a failed persistence must still release the reservation",
  );
  // The persistence diagnostic must survive to the caller rather than being
  // replaced by a generic message.
  assert.match(first.error, /QUEUE_STORAGE_WRITE_FAILED/);

  // A later duplicate is allowed to retry, because the record never landed.
  let retried = 0;
  const retry = await runDuplicateApprovalHandoff({
    taskId: L_TASK,
    preExisting: {
      status: "QUEUED",
      coordinatorNotification: { delivered: false },
    },
    notify: async () => {
      retried += 1;
      return {
        delivered: true,
        evidence: { message_id: "m-3", channel_id: "c-3" },
      };
    },
    persist: spyPersistReturning({ ok: true }),
    reserve,
  });
  assert.equal(retried, 1, "the later duplicate must be allowed to retry");
  assert.equal(retry.handoff, "NOTIFIED");
});

test("L5: neither path double-reserves the same attempt", async () => {
  const registry = makeRegistry();
  let reserveCalls = 0;
  const reserve = (id) => {
    reserveCalls += 1;
    return reserveCoordinatorNotificationAttempt(id, { registry });
  };
  const notify = spyTransport({
    delivered: true,
    evidence: { message_id: "m", channel_id: "c" },
  });

  await firstApprovalCall({
    notify,
    persist: spyPersistReturning({ ok: true }),
    reserve,
  });
  assert.equal(reserveCalls, 1, "one reservation per first-approval attempt");

  reserveCalls = 0;
  await runDuplicateApprovalHandoff({
    taskId: L_TASK,
    preExisting: {
      status: "QUEUED",
      coordinatorNotification: { delivered: false },
    },
    notify,
    persist: spyPersistReturning({ ok: true }),
    reserve,
  });
  assert.equal(reserveCalls, 1, "one reservation per duplicate attempt");
});

test("L6: the shipped execution path routes both callers through the shared owner", () => {
  const source = fs.readFileSync(
    new URL(
      "../integrations/openclaw/plugins/zink-governance/index.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const start = source.indexOf("async function executeApprovedTask(");
  const end = source.indexOf("const unregister = registerNativeGuard", start);
  const body = source.slice(start, end);
  const flattened = body.replace(/\s+/g, " ");

  assert.ok(
    body.includes("runFirstApprovalNotification("),
    "the first approval must use the shipped first-approval segment",
  );
  assert.ok(
    body.includes("runDuplicateApprovalHandoff("),
    "the duplicate must use the duplicate branch",
  );
  assert.ok(
    body.includes("reserve: reserveCoordinatorNotificationAttempt"),
    "both must install the reservation primitive",
  );
  assert.equal(
    (body.match(/reserve: reserveCoordinatorNotificationAttempt/g) ?? [])
      .length,
    2,
    "both callers must install the reservation",
  );
  // Neither caller may send inline: the transport only appears as an injected
  // callback to the shared owner.
  assert.equal(
    (body.match(/deliverCoordinatorNotification[(]/g) ?? []).length,
    2,
    "the transport must only appear inside the two injected notify callbacks",
  );
  assert.equal(
    (flattened.match(/await deliverCoordinatorNotification[(]/g) ?? []).length,
    0,
    "neither caller may await the transport directly",
  );
  assert.ok(flattened.includes("AWAITING_COORDINATOR_PICKUP"));
});

// M12/T9 F-346: a durable contract counted the code it audits and both counts
// were wrong (it claimed 18 consumers and 18 cases; the measured populations
// are 24 and 19). The contract now states a derived count with its measurement
// command, and this re-derives both numbers, so a change in the population
// cannot pass unnoticed.
function findSessionConsumers() {
  let matches = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      if (!entry.name.endsWith(".mjs")) continue;
      const body = fs.readFileSync(child, "utf8");
      matches += (body.match(/findSession\(/gu) ?? []).length;
    }
  };
  walk(path.resolve("integrations", "openclaw"));
  // The definition itself is not a consumer.
  return matches - 1;
}

test("F-346: the contract's audited-population counts are the measured ones", () => {
  const contract = fs.readFileSync(
    path.resolve("docs", "contracts", "coordinator-session-binding.md"),
    "utf8",
  );
  const consumers = findSessionConsumers();
  const stated = contract.match(/All (\d+) `findSession` consumers/u);
  const statedAudit = contract.match(
    /audit all (\d+) `findSession` consumers/u,
  );
  const statedCases = contract.match(
    /coordinator-execution-authority\.test\.mjs` \((\d+) cases\)/u,
  );
  assert.ok(stated, "the contract must state the audited population");
  assert.ok(statedAudit, "the contract must state the audited population");
  assert.ok(statedCases, "the contract must state the regression-suite size");
  assert.equal(
    Number(stated[1]),
    consumers,
    "the contract's audited population is stale; re-derive it and update the contract",
  );
  assert.equal(
    Number(statedAudit[1]),
    consumers,
    "the two statements of the audited population must agree",
  );
  const suite = fs.readFileSync(
    path.resolve("tests", "m10-t2-r2-coordinator-execution-authority.test.mjs"),
    "utf8",
  );
  const cases = (suite.match(/^test\(/gmu) ?? []).length;
  assert.equal(
    Number(statedCases[1]),
    cases,
    "the contract's regression-suite size is stale; re-derive it and update the contract",
  );
});
