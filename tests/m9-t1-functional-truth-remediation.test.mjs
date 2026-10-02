import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveGovernedDispatchTarget,
  registerTools,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import { createGovernanceGuard } from "../integrations/openclaw/topology/lib/guard.mjs";
import { TOOL_POLICY } from "../integrations/openclaw/lib/policy.mjs";

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
    makeTask({ primary_coordinator: "o2" }),
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
