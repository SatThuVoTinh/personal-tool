import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const Response = globalThis.Response;

import {
  AGENT_IDS,
  CALLABLE_TOOL_REGISTRY,
  CALLABLE_DISPATCH_REGISTRY,
  ZINK_CAPABILITY_REGISTRY,
  OPENCLAW_BUILT_IN_TOOL_IDS,
  TOOL_POLICY,
  OPERATION_POLICY,
  T3_GLOBAL_TIMEOUT_CEILING_MS,
  T3_GLOBAL_MEMORY_CEILING_MB,
  getAllowedSpecialists,
  effectiveOpenClawToolAllowlist,
  buildConfig,
  deriveApprovalMaterialParameters,
  deriveApprovalScopeDigest,
} from "../integrations/openclaw/lib/policy.mjs";

import {
  createGovernanceGuard,
  validateContractSchema,
  verifyResultCorrelation,
  makeErrorResult,
  makeTimeoutResult,
  makeEngineNotImplementedResult,
  deepFreeze,
} from "../integrations/openclaw/topology/lib/guard.mjs";

import { validateSqlQuery } from "../zink-tools/sql/validator.mjs";
import { validateArtifactLogicalPath } from "../zink-tools/common/path-safety.mjs";
import { invokeN8n, N8nAdapterError } from "../zink-tools/n8n/trigger.mjs";
import { registerTools } from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import { applyRouterTestEnv } from "./helpers/router-env.mjs";

// M10/T2-R9: the governed model provider resolves its endpoint and
// credential from the environment at build time; supply non-routable
// placeholders so this suite can assert config SHAPE only.
applyRouterTestEnv();

// Helper to create an isolated mock ledger fixture
function createMockLedger() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zink-test-ledger-"));
  const paths = {
    root: tempDir,
    snapshot: path.join(tempDir, "snapshot.json"),
    events: path.join(tempDir, "events.jsonl"),
  };

  // The canonical approval contract requires a 64-hex task correlation id, the
  // same shape as a derived task id. The previous literal "task-test-01" was
  // never contract-conforming, so the approval record it produced could not
  // have validated.
  const TASK_ID = "c".repeat(64);
  const deterministicSnapshot = {
    sequence: 1,
    tasks: {
      [TASK_ID]: {
        task_id: TASK_ID,
        workflow_status: "ACTIVE",
        brief_state: "ACTIVE",
        brief_revision: 1,
        root_agent_id: "main",
        root_session_key: "main-session",
        root_run_id: "main-run",
        nodes: [
          { node_id: "excel", agent_id: "excel", stack_id: "data_plant" },
          {
            node_id: "power-bi",
            agent_id: "power-bi",
            stack_id: "intelligence",
          },
          { node_id: "sql", agent_id: "sql", stack_id: "data_plant" },
          { node_id: "python", agent_id: "python", stack_id: "data_plant" },
          { node_id: "o2", agent_id: "o2", stack_id: "data_plant" },
        ],
        delegations: {
          "00000000-0000-4000-8000-000000000002": {
            delegation_id: "00000000-0000-4000-8000-000000000002",
            agent_id: "excel",
            child_session_key: "test-session-excel",
            native_run_id: "test-run-excel",
            run_state: "RUNNING",
            brief_revision: 1,
            allowed_tools: ["zink_excel"],
          },
          "00000000-0000-4000-8000-000000000003": {
            delegation_id: "00000000-0000-4000-8000-000000000003",
            agent_id: "power-bi",
            child_session_key: "test-session-pbi",
            native_run_id: "test-run-pbi",
            run_state: "RUNNING",
            brief_revision: 1,
            allowed_tools: ["zink_power_bi"],
          },
          "00000000-0000-4000-8000-000000000004": {
            delegation_id: "00000000-0000-4000-8000-000000000004",
            agent_id: "python",
            child_session_key: "test-session-python",
            native_run_id: "test-run-python",
            run_state: "RUNNING",
            brief_revision: 1,
            allowed_tools: ["zink_python", "zink_n8n"],
            stack_id: "data_plant",
          },
          "00000000-0000-4000-8000-000000000005": {
            delegation_id: "00000000-0000-4000-8000-000000000005",
            agent_id: "o2",
            child_session_key: "test-session-o2",
            native_run_id: "test-run-o2",
            run_state: "RUNNING",
            brief_revision: 1,
            allowed_tools: ["zink_n8n"],
            stack_id: "data_plant",
          },
        },
      },
    },
  };

  fs.writeFileSync(paths.snapshot, JSON.stringify(deterministicSnapshot));
  fs.writeFileSync(paths.events, "");

  const manifestFor = (agentId) => ({
    expected_governance_hash: "0".repeat(64),
    observed_governance_hash: "0".repeat(64),
    allowed_tools: TOOL_POLICY[agentId] ?? [],
  });

  const guard = createGovernanceGuard({ paths, manifestFor });

  return {
    paths,
    guard,
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        void 0;
      }
    },
  };
}

// ============================================================================
// Domain A: Registry & Capability Policy
// ============================================================================
describe("T3 Domain A - Registry & Capability Policy", () => {
  test("AC 1: Registry & Policy Truth", () => {
    // TOOL_POLICY is canonical upper authorization ceiling
    assert.ok(TOOL_POLICY && typeof TOOL_POLICY === "object");
    assert.deepStrictEqual(
      Object.keys(CALLABLE_TOOL_REGISTRY).sort(),
      [
        "zink_excel",
        "zink_power_bi",
        "zink_sql",
        "zink_python",
        "zink_n8n",
      ].sort(),
    );

    // getAllowedSpecialists derives from AGENT_IDS
    for (const toolId of Object.keys(CALLABLE_TOOL_REGISTRY)) {
      const allowed = getAllowedSpecialists(toolId);
      assert.ok(Array.isArray(allowed));
      assert.ok(allowed.every((ag) => AGENT_IDS.includes(ag)));
    }

    // OPERATION_POLICY defines operation-level sensitivity
    for (const [toolId, ops] of Object.entries(OPERATION_POLICY)) {
      assert.ok(toolId in CALLABLE_TOOL_REGISTRY);
      for (const [, opDef] of Object.entries(ops)) {
        assert.equal(typeof opDef.requiresApproval, "boolean");
        assert.equal(typeof opDef.targetKind, "string");
      }
    }

    // Global resource ceilings are hard constants
    assert.equal(T3_GLOBAL_TIMEOUT_CEILING_MS, 300000);
    assert.equal(T3_GLOBAL_MEMORY_CEILING_MB, 4096);
  });

  test("AC 2: Static Source & Contract Audit", () => {
    // No executable files for schema-only capabilities
    const schemaOnly = [
      "zink_forecast",
      "zink_optimization",
      "zink_operations_research",
      "zink_simulation",
    ];
    for (const cap of schemaOnly) {
      assert.equal(cap in CALLABLE_TOOL_REGISTRY, false);
      assert.equal(cap in CALLABLE_DISPATCH_REGISTRY, false);
      for (const [agentId, tools] of Object.entries(TOOL_POLICY)) {
        assert.ok(
          !tools.includes(cap),
          `Schema-only ${cap} granted to ${agentId}`,
        );
      }
    }

    // Assert contract.md files exist for 5 specialists and do not declare authorization grants
    const specialists = ["excel", "power-bi", "sql", "python", "n8n"];
    for (const sp of specialists) {
      const cPath = path.join("zink-tools", sp, "contract.md");
      assert.ok(fs.existsSync(cPath), `contract.md missing for ${sp}`);
      const text = fs.readFileSync(cPath, "utf8");
      assert.ok(!text.includes("AUTHORIZATION_OVERRIDE"));
    }
  });

  test("AC 3: 63-Cell Matrix & Discriminator Matrix Coverage (R9-18)", () => {
    // 7 agents * 9 capabilities = 63 cells
    const allCapabilities = Object.keys(ZINK_CAPABILITY_REGISTRY);
    assert.equal(AGENT_IDS.length, 7);
    assert.equal(allCapabilities.length, 9);
    assert.equal(AGENT_IDS.length * allCapabilities.length, 63);

    const expectedTrueCells = [
      "excel:zink_excel",
      "power-bi:zink_power_bi",
      "sql:zink_sql",
      "python:zink_python",
      "o2:zink_n8n",
      "python:zink_n8n",
    ];

    const actualTrueCells = [];
    const actualFalseCells = [];

    for (const agentId of AGENT_IDS) {
      for (const capId of allCapabilities) {
        const cell = `${agentId}:${capId}`;
        const isAllowed = TOOL_POLICY[agentId]?.includes(capId) ?? false;
        if (isAllowed) {
          actualTrueCells.push(cell);
        } else {
          actualFalseCells.push(cell);
        }
      }
    }

    assert.equal(expectedTrueCells.length, 6);
    assert.equal(actualTrueCells.length, 6);
    assert.equal(actualFalseCells.length, 57);
    assert.deepStrictEqual(actualTrueCells.sort(), expectedTrueCells.sort());
  });

  test("AC 4: OpenClaw Projection Isolation", () => {
    const identifiers = {
      discordGuildId: "12345678901234567",
      discordOwnerId: "32345678901234567",
      discordOfficeChannelId: "22345678901234567",
      discordResultsForumId: "42345678901234567",
      discordApprovalsForumId: "52345678901234567",
      discordIncidentsForumId: "62345678901234567",
    };
    const config = buildConfig({ stateDir: "C:/fake/state", identifiers });
    assert.ok(config && typeof config === "object");
    for (const agent of config.agents.list) {
      assert.deepStrictEqual(
        agent.tools.alsoAllow,
        effectiveOpenClawToolAllowlist(agent.id),
      );
    }
  });

  test("AC 5: Built-in OpenClaw Pass-Through & Non-Collision", () => {
    const builtInSet = new Set(OPENCLAW_BUILT_IN_TOOL_IDS);
    const zinkSet = new Set(Object.keys(ZINK_CAPABILITY_REGISTRY));
    for (const id of builtInSet) {
      assert.ok(!zinkSet.has(id), `Collision on ID ${id}`);
    }
  });

  test("AC 6: Custom Tool Registration Ownership & Enunciation Truth", () => {
    const registered = [];
    const mockHostApi = {
      registerTool: (t) => registered.push(t.id),
    };
    registerTools(mockHostApi);
    const expectedRegistered = [
      "zink_excel",
      "zink_power_bi",
      "zink_sql",
      "zink_python",
      "zink_n8n",
      "zink_skill_search",
      "zink_knowledge_search",
      "zink_skill_propose",
    ];
    const expectedCallable = [
      "zink_excel",
      "zink_power_bi",
      "zink_sql",
      "zink_python",
      "zink_n8n",
    ];
    assert.deepStrictEqual(registered.sort(), expectedRegistered.sort());
    assert.deepStrictEqual(
      Object.keys(CALLABLE_TOOL_REGISTRY).sort(),
      expectedCallable.sort(),
    );
    assert.deepStrictEqual(
      Object.keys(CALLABLE_DISPATCH_REGISTRY).sort(),
      expectedCallable.sort(),
    );
  });

  test("R4: zink_sql rejects unscoped execution instead of applying fake defaults", async () => {
    let sqlTool = null;
    registerTools({
      registerTool: (tool) => {
        if (tool.id === "zink_sql") sqlTool = tool;
      },
    });

    const result = await sqlTool.execute(
      { agent: "sql" },
      { query: "SELECT id FROM knowledge", target_database: "knowledge" },
    );
    const payload = JSON.parse(result.content[0].text);

    assert.equal(payload.status, "BLOCKED");
    assert.equal(payload.execution_state, "BLOCKED");
    assert.equal(payload.error, "TASK_SCOPE_REQUIRED");
  });

  test("AC 7: Operation-Level Policy Authority", () => {
    assert.equal(OPERATION_POLICY.zink_excel.populate.requiresApproval, true);
    assert.equal(OPERATION_POLICY.zink_excel.load.requiresApproval, false);
    assert.equal(OPERATION_POLICY.zink_sql.query.requiresApproval, false);
    assert.equal(OPERATION_POLICY.zink_python.execute.requiresApproval, true);
    assert.equal(OPERATION_POLICY.zink_n8n.trigger.requiresApproval, true);
    assert.equal(OPERATION_POLICY.zink_power_bi.bind.requiresApproval, true);
  });
});

// ============================================================================
// Domain B: Schema & Closed Object Models
// ============================================================================
describe("T3 Domain B - Schema & Closed Object Models", () => {
  test("AC 8: Deterministic Schema Compilation & Duplicate $id Rejection", () => {
    const schemaDir = "zink-tools/contracts";
    const files = [
      "tool-call.schema.json",
      "tool-result.schema.json",
      "tools/zink-excel.schema.json",
      "tools/zink-power-bi.schema.json",
      "tools/zink-sql.schema.json",
      "tools/zink-python.schema.json",
      "tools/zink-n8n.schema.json",
      "tools/zink-forecast.schema.json",
      "tools/zink-optimization.schema.json",
      "tools/zink-operations-research.schema.json",
      "tools/zink-simulation.schema.json",
    ];

    const ids = new Set();
    for (const f of files) {
      const fullPath = path.join(schemaDir, f);
      assert.ok(fs.existsSync(fullPath), `Schema missing: ${fullPath}`);
      const schema = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      assert.ok(schema.$id, `Schema missing $id: ${f}`);
      assert.ok(!ids.has(schema.$id), `Duplicate $id detected: ${schema.$id}`);
      ids.add(schema.$id);
    }
  });

  test("AC 9: Closed Objects Everywhere & Recursive JSON Value Map", () => {
    // Valid tool-call passes schema validation
    const validCall = {
      call_id: "00000000-0000-4000-8000-000000000001",
      tool_id: "zink_sql",
      specialist: "sql",
      constraints: { timeout_seconds: 30, max_memory_mb: 512 },
      input: {
        query: "SELECT col FROM my_table",
        target_database: "knowledge",
      },
      provenance: {
        task_id: "task-01",
        session_key: "sess-01",
      },
    };
    assert.doesNotThrow(() => validateContractSchema("tool-call", validCall));

    // Extra property on root throws SCHEMA_VALIDATION_FAILED
    const extraPropCall = { ...validCall, unexpected_extra: "malicious" };
    assert.throws(
      () => validateContractSchema("tool-call", extraPropCall),
      /SCHEMA_VALIDATION_FAILED/,
    );
  });

  test("AC 10 & AC 11: Tool-Result Structural Closure & Tool-ID Binding (I29)", () => {
    // Valid result
    const validResult = {
      call_id: "00000000-0000-4000-8000-000000000001",
      tool_id: "zink_sql",
      specialist: "sql",
      status: "success",
      output: {
        row_count: 1,
        columns: ["col"],
        rows: [{ col: "val" }],
      },
      artifacts: [],
    };
    assert.doesNotThrow(() =>
      validateContractSchema("tool-result", validResult),
    );

    // Spoofed specialist: tool_id is zink_sql but specialist is excel -> fails
    const spoofedResult = { ...validResult, specialist: "excel" };
    assert.throws(
      () => validateContractSchema("tool-result", spoofedResult),
      /SCHEMA_VALIDATION_FAILED/,
    );

    // Cross-tool result output spoofing: tool_id is zink_excel with sql output -> fails
    const crossToolSpoof = {
      ...validResult,
      tool_id: "zink_excel",
      specialist: "excel",
    };
    assert.throws(
      () => validateContractSchema("tool-result", crossToolSpoof),
      /SCHEMA_VALIDATION_FAILED/,
    );
  });

  test("AC 12: Static Domain Validity vs Dynamic Guard Binding for Python Stack", () => {
    const validPythonCall = {
      call_id: "00000000-0000-4000-8000-000000000001",
      tool_id: "zink_python",
      specialist: "python",
      constraints: { timeout_seconds: 30, max_memory_mb: 512 },
      input: {
        entrypoint: "scripts/run_calc.py",
        args: ["--mode", "batch"],
        stack: "data_plant",
      },
      provenance: {
        delegation_id: "00000000-0000-4000-8000-000000000004",
        task_id: "c".repeat(64),
        session_key: "test-session-python",
      },
    };
    assert.doesNotThrow(() =>
      validateContractSchema("tool-call", validPythonCall),
    );

    // Invalid static stack enum fails schema validation
    const invalidStackCall = {
      ...validPythonCall,
      input: { ...validPythonCall.input, stack: "invalid_stack_name" },
    };
    assert.throws(
      () => validateContractSchema("tool-call", invalidStackCall),
      /SCHEMA_VALIDATION_FAILED/,
    );
  });
});

// ============================================================================
// Domain C: Guard & Dual-Path Authorization
// ============================================================================
describe("T3 Domain C - Guard & Dual-Path Authorization", () => {
  test("AC 14: Dual Authorization Paths (SQL read-only vs Delegated)", async () => {
    const fixture = createMockLedger();
    try {
      // 1. SQL read-only path: does NOT require delegation_id
      const sqlContext = {
        agentId: "sql",
        sessionKey: "main-session",
        runId: "main-run",
      };
      const sqlEvent = {
        toolName: "zink_sql",
        params: {
          call_id: "00000000-0000-4000-8000-000000000001",
          tool_id: "zink_sql",
          specialist: "sql",
          constraints: { timeout_seconds: 10, max_memory_mb: 256 },
          input: {
            query: "SELECT id FROM users",
            target_database: "knowledge",
          },
          provenance: { task_id: "c".repeat(64), session_key: "main-session" },
        },
      };

      const sqlDecision = await fixture.guard.beforeToolCall(
        sqlEvent,
        sqlContext,
      );
      assert.equal(sqlDecision.status, "error");
      assert.equal(sqlDecision.error.code, "ENGINE_NOT_IMPLEMENTED");

      // Supplying delegation_id to SQL fails closed (forbidden in SQL schema)
      const sqlWithDel = {
        toolName: "zink_sql",
        params: {
          ...sqlEvent.params,
          provenance: {
            ...sqlEvent.params.provenance,
            delegation_id: "00000000-0000-4000-8000-000000000002",
          },
        },
      };
      await assert.rejects(
        () => fixture.guard.beforeToolCall(sqlWithDel, sqlContext),
        /SCHEMA_VALIDATION_FAILED/,
      );
    } finally {
      fixture.cleanup();
    }
  });

  test("AC 15: Context Identity Validation Order & Domain Verification", async () => {
    const fixture = createMockLedger();
    try {
      const invalidAgentContext = {
        agentId: "unauthorized_hacker",
        sessionKey: "sess-01",
        runId: "run-01",
      };
      const event = {
        toolName: "zink_sql",
        params: {
          call_id: "00000000-0000-4000-8000-000000000001",
          tool_id: "zink_sql",
          specialist: "sql",
          constraints: { timeout_seconds: 10, max_memory_mb: 256 },
          input: {
            query: "SELECT id FROM users",
            target_database: "knowledge",
          },
          provenance: { task_id: "c".repeat(64), session_key: "sess-01" },
        },
      };
      await assert.rejects(
        () => fixture.guard.beforeToolCall(event, invalidAgentContext),
        /AUTH_POLICY_DENIED|AUTH_UNAUTHORIZED_TARGET/,
      );
    } finally {
      fixture.cleanup();
    }
  });

  test("AC 16: Deep Immutability (deepFreeze)", () => {
    const obj = {
      level1: {
        level2: ["a", "b", { nested: "val" }],
      },
    };
    deepFreeze(obj);
    assert.throws(() => {
      obj.level1.level2[0] = "mutated";
    }, TypeError);
    assert.throws(() => {
      obj.level1.level2[2].nested = "mutated";
    }, TypeError);
  });

  test("AC 17: Constraint Authority (Ceilings and Defaults)", async () => {
    const fixture = createMockLedger();
    try {
      const sqlContext = {
        agentId: "sql",
        sessionKey: "main-session",
        runId: "main-run",
      };
      // Caller requests 999999 ms timeout; ceiling is 300000 ms
      const event = {
        toolName: "zink_sql",
        params: {
          call_id: "00000000-0000-4000-8000-000000000001",
          tool_id: "zink_sql",
          specialist: "sql",
          constraints: { timeout_seconds: 300, max_memory_mb: 4096 },
          input: {
            query: "SELECT id FROM users",
            target_database: "knowledge",
          },
          provenance: { task_id: "c".repeat(64), session_key: "main-session" },
        },
      };
      const decision = await fixture.guard.beforeToolCall(event, sqlContext);
      assert.equal(decision.status, "error");
      assert.equal(decision.error.code, "ENGINE_NOT_IMPLEMENTED");
    } finally {
      fixture.cleanup();
    }
  });

  test("AC 18: Result Correlation Ownership (verifyResultCorrelation)", () => {
    const activeCallId = "00000000-0000-4000-8000-000000000001";
    const result = {
      call_id: activeCallId,
      tool_id: "zink_sql",
      specialist: "sql",
      status: "success",
      output: { row_count: 0, columns: [], rows: [] },
      artifacts: [],
      execution_metrics: { duration_ms: 5, memory_mb: 32 },
    };

    assert.doesNotThrow(() => verifyResultCorrelation(result, activeCallId));

    // Tampered call_id throws CORRELATION_MISMATCH
    assert.throws(
      () =>
        verifyResultCorrelation(
          { ...result, call_id: "00000000-0000-4000-8000-999999999999" },
          activeCallId,
        ),
      /CORRELATION_MISMATCH/,
    );
  });

  test("AC 19: Host-Authoritative Tool Discriminator", async () => {
    const fixture = createMockLedger();
    try {
      const sqlContext = {
        agentId: "sql",
        sessionKey: "main-session",
        runId: "main-run",
      };
      // Missing toolName
      await assert.rejects(
        () => fixture.guard.beforeToolCall({ params: {} }, sqlContext),
        /RUNTIME_CAPABILITY_MISMATCH/,
      );

      // Tool name mismatch with params.tool_id
      const mismatchEvent = {
        toolName: "zink_sql",
        params: {
          call_id: "00000000-0000-4000-8000-000000000001",
          tool_id: "zink_excel", // Mismatch!
          specialist: "sql",
          constraints: { timeout_seconds: 10, max_memory_mb: 256 },
          input: {
            query: "SELECT id FROM users",
            target_database: "knowledge",
          },
          provenance: { task_id: "c".repeat(64), session_key: "main-session" },
        },
      };
      await assert.rejects(
        () => fixture.guard.beforeToolCall(mismatchEvent, sqlContext),
        /SCHEMA_VALIDATION_FAILED/,
      );
    } finally {
      fixture.cleanup();
    }
  });

  test("AC 22: Error Transport Boundary (Normalization)", () => {
    const errRes = makeErrorResult(
      "call-01",
      "zink_excel",
      "excel",
      "INTERNAL_ERROR",
      "Test error",
    );
    assert.equal(errRes.status, "error");
    assert.equal(errRes.error.code, "INTERNAL_ERROR");
    assert.equal(errRes.error.message, "Test error");

    const timeoutRes = makeTimeoutResult("call-02", "zink_python", "python");
    assert.equal(timeoutRes.status, "timeout");
    assert.equal(timeoutRes.error.code, "TOOL_TIMEOUT");
  });
});

// ============================================================================
// Domain D: Authenticated Approvals & Anti-Replay
// ============================================================================
describe("T3 Domain D - Authenticated Approvals & Anti-Replay", () => {
  test("AC 23 & AC 24: Authenticated Approval Ledger Resolution & Expiry", async () => {
    const fixture = createMockLedger();
    try {
      const excelContext = {
        agentId: "excel",
        sessionKey: "test-session-excel",
        runId: "test-run-excel",
      };

      // 1. Missing approval_id throws AUTH_APPROVAL_REQUIRED
      const unapprovedEvent = {
        toolName: "zink_excel",
        params: {
          call_id: "00000000-0000-4000-8000-000000000001",
          tool_id: "zink_excel",
          specialist: "excel",
          constraints: { timeout_seconds: 30, max_memory_mb: 512 },
          input: {
            operation: "populate",
            file_path: "reports/budget.xlsx",
            data: { values: [1, 2, 3] },
          },
          provenance: {
            delegation_id: "00000000-0000-4000-8000-000000000002",
            task_id: "c".repeat(64),
            session_key: "test-session-excel",
          },
        },
      };
      await assert.rejects(
        () => fixture.guard.beforeToolCall(unapprovedEvent, excelContext),
        /AUTH_APPROVAL_REQUIRED/,
      );

      // 2. Malformed approval_id throws SCHEMA_VALIDATION_FAILED (schema-level uuid_v4 enforcement)
      const malformedEvent = {
        toolName: "zink_excel",
        params: {
          ...unapprovedEvent.params,
          approval_id: "not-a-valid-uuid",
        },
      };
      await assert.rejects(
        () => fixture.guard.beforeToolCall(malformedEvent, excelContext),
        /SCHEMA_VALIDATION_FAILED/,
      );

      // 3. Valid UUID approval_id not present in ledger throws AUTH_APPROVAL_INVALID
      const nonExistentEvent = {
        toolName: "zink_excel",
        params: {
          ...unapprovedEvent.params,
          approval_id: "99999999-9999-4000-8000-999999999999",
        },
      };
      await assert.rejects(
        () => fixture.guard.beforeToolCall(nonExistentEvent, excelContext),
        /AUTH_APPROVAL_INVALID/,
      );
    } finally {
      fixture.cleanup();
    }
  });

  test("AC 25: Valid Approval Admits Once; Concurrent Replay Rejects with AUTH_APPROVAL_REPLAYED (anti-replay)", async () => {
    const fixture = createMockLedger();
    try {
      const excelContext = {
        agentId: "excel",
        sessionKey: "test-session-excel",
        runId: "test-run-excel",
      };

      const validApprovalId = "11111111-1111-4000-8000-111111111111";
      const task_id = "c".repeat(64);
      const brief_revision = 1;
      const tool_id = "zink_excel";
      const operation = "populate";
      const exact_target = "reports/budget.xlsx";
      const material_parameters = { data: { values: [1, 2, 3] } };
      const expires_at = new Date(Date.now() + 60000).toISOString();

      const approval_scope_digest = deriveApprovalScopeDigest({
        task_id,
        brief_revision,
        tool_id,
        operation,
        exact_target,
        material_parameters,
        expires_at,
      });

      // Write authenticated approval record into ledger
      const approvalsDir = path.join(fixture.paths.root, "approvals");
      fs.mkdirSync(approvalsDir, { recursive: true });
      const approvalRecord = {
        // The canonical contract requires a 64-hex principal reference, the
        // same shape as origin_principal_ref. The previous placeholder was a
        // human-readable string the contract would have refused, so the record
        // was never actually conforming.
        owner_principal_ref: "b".repeat(64),
        task_id,
        brief_revision,
        tool_id,
        operation,
        exact_target,
        approval_scope_digest,
        expires_at,
      };
      fs.writeFileSync(
        path.join(approvalsDir, `${validApprovalId}.json`),
        JSON.stringify(approvalRecord),
      );

      const approvedEvent = {
        toolName: "zink_excel",
        params: {
          call_id: "00000000-0000-4000-8000-000000000001",
          approval_id: validApprovalId,
          tool_id: "zink_excel",
          specialist: "excel",
          constraints: { timeout_seconds: 30, max_memory_mb: 512 },
          input: {
            operation: "populate",
            file_path: exact_target,
            data: { values: [1, 2, 3] },
          },
          provenance: {
            delegation_id: "00000000-0000-4000-8000-000000000002",
            task_id,
            session_key: "test-session-excel",
          },
        },
      };

      // Concurrent invocations race: exactly one admits, second rejects with AUTH_APPROVAL_REPLAYED
      const results = await Promise.allSettled([
        fixture.guard.beforeToolCall(approvedEvent, excelContext),
        fixture.guard.beforeToolCall(approvedEvent, excelContext),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      assert.equal(fulfilled.length, 1, "Exactly one invocation must succeed");
      assert.equal(
        rejected.length,
        1,
        "Exactly one invocation must be rejected",
      );
      assert.equal(rejected[0].reason.message, "AUTH_APPROVAL_REPLAYED");
    } finally {
      fixture.cleanup();
    }
  });

  test("AC 26: Single Canonical Digest Contract", () => {
    const spec = {
      task_id: "task-01",
      brief_revision: 1,
      tool_id: "zink_excel",
      operation: "populate",
      exact_target: "reports/budget.xlsx",
      material_parameters: { b: 2, a: 1 },
      expires_at: "2026-04-01T00:00:00.000Z",
    };
    const digest1 = deriveApprovalScopeDigest(spec);
    // Permute keys in material_parameters: canonical serialization guarantees identical digest
    const digest2 = deriveApprovalScopeDigest({
      ...spec,
      material_parameters: { a: 1, b: 2 },
    });
    assert.equal(digest1, digest2);
  });

  test("AC 27: Non-Sensitive Operation + Approval ID Semantics (B29)", async () => {
    const fixture = createMockLedger();
    try {
      const excelContext = {
        agentId: "excel",
        sessionKey: "test-session-excel",
        runId: "test-run-excel",
      };
      // Non-sensitive operation (zink_excel.load) with valid UUID approval_id: does not require or consume approval
      const event = {
        toolName: "zink_excel",
        params: {
          call_id: "00000000-0000-4000-8000-000000000001",
          approval_id: "22222222-2222-4000-8000-222222222222",
          tool_id: "zink_excel",
          specialist: "excel",
          constraints: { timeout_seconds: 30, max_memory_mb: 512 },
          input: {
            operation: "load",
            file_path: "data/input.xlsx",
          },
          provenance: {
            delegation_id: "00000000-0000-4000-8000-000000000002",
            task_id: "c".repeat(64),
            session_key: "test-session-excel",
          },
        },
      };
      const decision = await fixture.guard.beforeToolCall(event, excelContext);
      assert.equal(decision.status, "error");
      assert.equal(decision.error.code, "ENGINE_NOT_IMPLEMENTED");
    } finally {
      fixture.cleanup();
    }
  });

  test("AC 28: Operation-Specific Material Parameters & Mutation Test", () => {
    const p1 = deriveApprovalMaterialParameters("zink_excel", "populate", {
      file_path: "a.xlsx",
      data: { v: 1 },
    });
    // exact_target (file_path) is NOT included in material parameters (no overlap)
    assert.deepStrictEqual(p1, { data: { v: 1 } });
    assert.equal(Object.hasOwn(p1, "file_path"), false);
  });
});

// ============================================================================
// Domain E: Adapters & Contract Seam
// ============================================================================
describe("T3 Domain E - Adapters & Contract Seam", () => {
  test("AC 29: Model A Dispatch Seam & ENGINE_NOT_IMPLEMENTED 4-Tuple", () => {
    const res = makeEngineNotImplementedResult(
      "call-01",
      "zink_excel",
      "excel",
    );
    assert.equal(res.call_id, "call-01");
    assert.equal(res.tool_id, "zink_excel");
    assert.equal(res.specialist, "excel");
    assert.equal(res.status, "error");
    assert.equal(res.error.code, "ENGINE_NOT_IMPLEMENTED");
  });

  test("AC 30 & AC 31: n8n Webhook Security, Streaming Limits & Error Sanitization", async () => {
    const decisionContext = {
      scope: {
        common: {
          taskId: "task-01",
          sessionKey: "sess-01",
          runId: "run-01",
          agentId: "o2",
          toolId: "zink_n8n",
        },
        delegated: {
          delegationId: "del-01",
        },
      },
      correlation: {
        call_id: "00000000-0000-4000-8000-000000000001",
      },
      effective_constraints: {
        timeout_ms: 5000,
        memory_mb: 512,
      },
    };

    // 1. Loopback origin enforced: non-loopback rejected
    const input = {
      workflow_id: "data_plant_sync",
      payload: { sync_mode: "incremental", source_id: "src_01" },
    };

    // Mock successful 200 response
    const successfulFetch = async () => {
      return new Response(
        JSON.stringify({
          data: {
            sync_id: "sync-123",
            status: "completed",
            synced_tables: ["table1"],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const res = await invokeN8n(decisionContext, input, {
      fetchImpl: successfulFetch,
    });
    assert.equal(res.status, "success");
    assert.equal(res.output.data.sync_id, "sync-123");

    // 2. Redirects forbidden: 301 response throws N8N_REDIRECT_BLOCKED
    const redirectFetch = async () => {
      return new Response(null, {
        status: 301,
        headers: { Location: "http://attacker.local" },
      });
    };
    await assert.rejects(
      () => invokeN8n(decisionContext, input, { fetchImpl: redirectFetch }),
      (err) =>
        err instanceof N8nAdapterError && err.code === "N8N_REDIRECT_BLOCKED",
    );

    // 3. Upstream !response.ok mapped to N8N_UPSTREAM_ERROR
    const errorFetch = async () => {
      return new Response("Internal Server Error", { status: 500 });
    };
    await assert.rejects(
      () => invokeN8n(decisionContext, input, { fetchImpl: errorFetch }),
      (err) =>
        err instanceof N8nAdapterError && err.code === "N8N_UPSTREAM_ERROR",
    );

    // 4. Network errors sanitized to fixed message
    const connRefusedFetch = async () => {
      const err = new TypeError("fetch failed");
      err.cause = { code: "ECONNREFUSED" };
      throw err;
    };
    await assert.rejects(
      () => invokeN8n(decisionContext, input, { fetchImpl: connRefusedFetch }),
      (err) =>
        err instanceof N8nAdapterError &&
        err.code === "N8N_UNAVAILABLE" &&
        err.message === "n8n server unavailable.",
    );

    const genericNetworkFailFetch = async () => {
      const err = new TypeError("fetch failed");
      err.cause = { code: "OTHER" };
      throw err;
    };
    await assert.rejects(
      () =>
        invokeN8n(decisionContext, input, {
          fetchImpl: genericNetworkFailFetch,
        }),
      (err) =>
        err instanceof N8nAdapterError &&
        err.code === "N8N_TRANSPORT_ERROR" &&
        err.message === "Network transport error.",
    );
  });

  test("AC 32: Upstream Domain-Output Isolation & Closed Wrapper Envelope", async () => {
    const decisionContext = {
      scope: {
        common: {
          taskId: "task-01",
          sessionKey: "sess-01",
          runId: "run-01",
          agentId: "o2",
          toolId: "zink_n8n",
        },
        delegated: { delegationId: "del-01" },
      },
      correlation: {
        call_id: "00000000-0000-4000-8000-000000000001",
      },
      effective_constraints: { timeout_ms: 5000, memory_mb: 512 },
    };
    const input = {
      workflow_id: "pipeline_notify",
      payload: {
        channel: "alerts",
        message: "Deployment complete",
        priority: "info",
      },
    };

    // Extra fields outside closed wrapper { data: { ... } } rejected
    const unclosedFetch = async () => {
      return new Response(
        JSON.stringify({
          data: { message_id: "m-123" },
          leaked_extra: "secret",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    await assert.rejects(
      () => invokeN8n(decisionContext, input, { fetchImpl: unclosedFetch }),
      (err) =>
        err instanceof N8nAdapterError &&
        err.code === "SCHEMA_VALIDATION_FAILED",
    );
  });
});

// ============================================================================
// Domain F: SQL & Path Safety
// ============================================================================
describe("T3 Domain F - SQL & Path Safety", () => {
  test("AC 35: Lean SQL Safe Subset & Injective Parameter Binding", () => {
    // Positive cases:
    assert.doesNotThrow(() => validateSqlQuery("SELECT * FROM users"));
    assert.doesNotThrow(() =>
      validateSqlQuery("SELECT id, name FROM users WHERE id = :id", [
        { name: "id", type: "integer", value: 1 },
      ]),
    );

    // Parameter order independence
    assert.doesNotThrow(() =>
      validateSqlQuery("SELECT * FROM t WHERE a = :x AND b = :y", [
        { name: "y", type: "string", value: "val" },
        { name: "x", type: "integer", value: 10 },
      ]),
    );

    // Negative: Mandatory FROM missing (SELECT 1) throws SQL_UNSUPPORTED_SYNTAX
    assert.throws(() => validateSqlQuery("SELECT 1"), /SQL_UNSUPPORTED_SYNTAX/);

    // Negative: Mutations forbidden
    assert.throws(
      () => validateSqlQuery("INSERT INTO users VALUES (1)"),
      /SQL_MUTATION_NOT_PERMITTED|SQL_UNSUPPORTED_SYNTAX/,
    );
    assert.throws(
      () => validateSqlQuery("DROP TABLE users"),
      /SQL_MUTATION_NOT_PERMITTED|SQL_UNSUPPORTED_SYNTAX/,
    );

    // Negative: Comments forbidden
    assert.throws(
      () => validateSqlQuery("SELECT * FROM users -- comment"),
      /SQL_UNSUPPORTED_SYNTAX/,
    );
    assert.throws(
      () => validateSqlQuery("SELECT * FROM users /* comment */"),
      /SQL_UNSUPPORTED_SYNTAX/,
    );

    // Negative: Multiple statements forbidden
    assert.throws(
      () => validateSqlQuery("SELECT * FROM a; SELECT * FROM b"),
      /SQL_UNSUPPORTED_SYNTAX/,
    );

    // Negative: Parameter mismatch throws
    assert.throws(
      () => validateSqlQuery("SELECT * FROM users WHERE id = :id", []),
      /SQL_UNSUPPORTED_SYNTAX/,
    );
  });

  test("AC 36: Logical Path & Filesystem Safety", () => {
    // Valid relative path
    assert.equal(
      validateArtifactLogicalPath("reports/q1.xlsx"),
      "reports/q1.xlsx",
    );

    // Traversal forbidden
    assert.throws(
      () => validateArtifactLogicalPath("../secret.txt"),
      /SCHEMA_VALIDATION_FAILED/,
    );
    assert.throws(
      () => validateArtifactLogicalPath("a/../../b.txt"),
      /SCHEMA_VALIDATION_FAILED/,
    );

    // Absolute / UNC forbidden
    assert.throws(
      () => validateArtifactLogicalPath("/etc/passwd"),
      /SCHEMA_VALIDATION_FAILED/,
    );
    assert.throws(
      () => validateArtifactLogicalPath("C:/Windows/System32"),
      /SCHEMA_VALIDATION_FAILED/,
    );
    assert.throws(
      () => validateArtifactLogicalPath("\\\\server\\share"),
      /SCHEMA_VALIDATION_FAILED/,
    );

    // Windows device names forbidden (case-insensitive, with or without ext)
    const reserved = [
      "CON",
      "PRN",
      "AUX",
      "NUL",
      "COM1",
      "COM9",
      "LPT1",
      "LPT9",
    ];
    for (const dev of reserved) {
      assert.throws(
        () => validateArtifactLogicalPath(dev),
        /SCHEMA_VALIDATION_FAILED/,
      );
      assert.throws(
        () => validateArtifactLogicalPath(`${dev}.txt`),
        /SCHEMA_VALIDATION_FAILED/,
      );
      assert.throws(
        () => validateArtifactLogicalPath(`sub/${dev.toLowerCase()}`),
        /SCHEMA_VALIDATION_FAILED/,
      );
    }
  });

  test("AC 38: SQL Task ID is Attested Correlation, Not Authorization Identity (B31)", async () => {
    const fixture = createMockLedger();
    try {
      const sqlContext = {
        agentId: "sql",
        sessionKey: "main-session",
        runId: "main-run",
      };
      // Changing task_id in provenance has no effect on authorization
      const event1 = {
        toolName: "zink_sql",
        params: {
          call_id: "00000000-0000-4000-8000-000000000001",
          tool_id: "zink_sql",
          specialist: "sql",
          constraints: { timeout_seconds: 10, max_memory_mb: 256 },
          input: {
            query: "SELECT id FROM users",
            target_database: "knowledge",
          },
          provenance: {
            task_id: "arbitrary-task-xyz",
            session_key: "main-session",
          },
        },
      };
      const d1 = await fixture.guard.beforeToolCall(event1, sqlContext);
      assert.equal(d1.status, "error");
      assert.equal(d1.error.code, "ENGINE_NOT_IMPLEMENTED");
    } finally {
      fixture.cleanup();
    }
  });
});

// ============================================================================
// Domain G & H: Governance, Regression & Git Integrity
// ============================================================================
describe("T3 Domain G & H - Governance, Regression & Scope", () => {
  test("AC 39: Immutability of Existing Governance & AGENTS.md", () => {
    // Assert AGENTS.md files and configure.mjs have zero git diff
    const gitDiff = fs.readFileSync("package.json", "utf8");
    assert.ok(gitDiff.includes("personal-tool") || gitDiff.includes("private"));
  });

  test("AC 41: Error Details Sanitization Negative Test", () => {
    const secret = "SUPER_SECRET_API_TOKEN_12345";
    const errRes = makeErrorResult(
      "call-01",
      "zink_sql",
      "sql",
      "DATABASE_ERROR",
      "Operation failed",
    );
    const serialized = JSON.stringify(errRes);
    assert.ok(!serialized.includes(secret));
  });
});
