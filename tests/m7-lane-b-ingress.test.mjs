import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  registerTools,
  loadToolContractSchemas,
  getToolRegistryChecksum,
  validateToolOutputEnvelope,
  validateLiveSqlQuery,
  validateLiveArtifactPath,
  deriveTrustedRequester,
  adapterUnavailableResponse,
  isIngressSenderAuthorized,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import { validateSqlQuery } from "../zink-tools/sql/validator.mjs";
import { validateArtifactLogicalPath } from "../zink-tools/common/path-safety.mjs";

const ALL_TOOLS = [
  "zink_skill_search",
  "zink_knowledge_search",
  "zink_skill_propose",
  "zink_excel",
  "zink_n8n",
  "zink_power_bi",
  "zink_python",
  "zink_sql",
];

function captureApi() {
  const tools = [];
  return {
    api: {
      registerTool: (def) => tools.push(def),
      pluginConfig: {},
      logger: {},
    },
    tools,
  };
}

function statusOf(response) {
  return JSON.parse(response.content[0].text);
}

describe("Lane B — tool ingress & contract authority", () => {
  it("M7-050: every callable tool loads its canonical contract", () => {
    const contracts = loadToolContractSchemas();
    assert.deepEqual(contracts.failedContracts, []);
    for (const tool of ALL_TOOLS) {
      assert.ok(contracts[tool]?.parameters, `${tool} has a contract`);
    }
  });

  it("M7-050: a tool without its contract is never registered", () => {
    const { api, tools } = captureApi();
    const contracts = loadToolContractSchemas();
    const sabotaged = { ...contracts };
    delete sabotaged.zink_sql;
    const res = registerTools(api, { toolContracts: sabotaged });
    assert.ok(!tools.some((t) => t.name === "zink_sql"));
    assert.ok(res.skipped.includes("zink_sql"));
    assert.equal(res.registered.length, ALL_TOOLS.length - 1);
  });

  it("M8-059: checksum failure blocks all registration", () => {
    assert.match(getToolRegistryChecksum(), /^[a-f0-9]{64}$/u);
    const { api, tools } = captureApi();
    const res = registerTools(api, { registryChecksum: null });
    assert.equal(tools.length, 0);
    assert.deepEqual(res, { registered: [], skipped: ["*"] });
  });

  it("M8-058: a disabled plugin registers nothing", async () => {
    const plugin = (
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs")
    ).default;
    let registered = 0;
    plugin.register({
      pluginConfig: { enabled: false },
      registerTool: () => {
        registered += 1;
      },
      tools: {
        register: () => {
          registered += 1;
        },
      },
      logger: {},
    });
    assert.equal(registered, 0);
  });

  it("M7-049: wrapper identity is trusted-context-only", async () => {
    const { api, tools } = captureApi();
    registerTools(api);
    const wrapper = tools.find((t) => t.name === "zink_skill_search");
    assert.ok(wrapper);
    const spoof = statusOf(
      await wrapper.execute(
        { agent: "o1" },
        { query: "x", namespace: "excel", requesting_agent: "o2" },
      ),
    );
    assert.equal(spoof.status, "DENIED");
    assert.equal(spoof.code, "IDENTITY_SPOOF");
    const unknown = statusOf(
      await wrapper.execute({}, { query: "x", namespace: "excel" }),
    );
    assert.equal(unknown.status, "DENIED");
    assert.equal(unknown.code, "IDENTITY_REQUIRED");
    const valid = statusOf(
      await wrapper.execute(
        { agent: "o1" },
        { query: "forecast", namespace: "excel" },
      ),
    );
    assert.ok(
      valid.code !== "IDENTITY_REQUIRED" && valid.code !== "IDENTITY_SPOOF",
      `trusted context passes the identity gate (got ${valid.code})`,
    );
  });

  it("M8-061: handler identity derivation ignores payload spoof", () => {
    assert.equal(
      deriveTrustedRequester({ agent: "o1", requesting_agent: "o2" }),
      "o1",
    );
    assert.equal(deriveTrustedRequester({ agentId: "sql" }), "sql");
    assert.equal(deriveTrustedRequester({}), "unknown");
    assert.equal(deriveTrustedRequester(null), "unknown");
  });

  it("M7-071/M8-062: missing backend is UNAVAILABLE, never governed success", () => {
    const res = statusOf(
      adapterUnavailableResponse(
        "zink_skill_search",
        "SKILL_ADAPTER_UNAVAILABLE",
      ),
    );
    assert.equal(res.status, "UNAVAILABLE");
    assert.equal(res.blocked, true);
    assert.equal(res.tool, "zink_skill_search");
    assert.ok(!("params" in res) && !("context" in res));
    assert.ok(!JSON.stringify(res).includes("zink-tools/"));
  });

  it("M7-018: ingress sender identity matrix", () => {
    const owner = "123456789012345678";
    assert.equal(
      isIngressSenderAuthorized({ senderId: owner }, owner).ok,
      true,
    );
    assert.equal(
      isIngressSenderAuthorized({ senderId: "12345678901234567" }, owner).ok,
      false,
    );
    assert.equal(isIngressSenderAuthorized({}, owner).ok, false);
    assert.equal(
      isIngressSenderAuthorized({ senderId: null }, owner).ok,
      false,
    );
    assert.equal(
      isIngressSenderAuthorized({ senderId: owner, isBot: true }, owner).ok,
      false,
    );
    assert.equal(
      isIngressSenderAuthorized(
        { senderId: owner, author: { bot: true } },
        owner,
      ).ok,
      false,
    );
  });

  it("M7-005: live SQL validation equals the canonical validator", async () => {
    const cases = [
      "SELECT a, b FROM t WHERE x = 1",
      "SELECT * FROM t; DROP TABLE t",
      "INSERT INTO t VALUES (1)",
      "UPDATE t SET a = 1",
      "DELETE FROM t",
      "DROP TABLE t",
      "WITH cte AS (SELECT 1) SELECT * FROM cte",
      "SELECT a FROM t UNION SELECT a FROM u",
      "SELECT a FROM t JOIN u ON t.id = u.id",
      "-- leading comment\nSELECT 1",
      "SELECT 1; SELECT 2",
      "NOT SQL AT ALL ((( ",
    ];
    for (const query of cases) {
      let directOk = true;
      try {
        validateSqlQuery(query, []);
      } catch {
        directOk = false;
      }
      const live = await validateLiveSqlQuery(query, []);
      assert.equal(live.ok, directOk, `parity for ${JSON.stringify(query)}`);
      if (!live.ok) {
        assert.ok(
          live.reason === "SQL_MUTATION_NOT_PERMITTED" ||
            live.reason === "SQL_UNSUPPORTED_SYNTAX" ||
            live.reason === "GOVERNANCE_DEPENDENCY_MISSING",
          `explicit reason for ${JSON.stringify(query)}`,
        );
      }
    }
  });

  it("M7-007: live path validation equals the canonical path contract", async () => {
    const cases = [
      "reports/bao_cao.xlsx",
      "artifacts/task-1/result.xlsx",
      "/absolute/path.xlsx",
      "../escape.xlsx",
      "a/../../escape.xlsx",
      "a\\..\\escape.xlsx",
    ];
    for (const p of cases) {
      let directOk = true;
      try {
        validateArtifactLogicalPath(p);
      } catch {
        directOk = false;
      }
      const live = await validateLiveArtifactPath(p);
      assert.equal(live.ok, directOk, `parity for ${JSON.stringify(p)}`);
      if (!live.ok) {
        assert.ok(
          live.reason === "POLICY_DENIED" ||
            live.reason === "GOVERNANCE_DEPENDENCY_MISSING",
        );
      }
    }
  });

  it("M8-060: non-JSON and schema-violating outputs are blocked", () => {
    const contracts = loadToolContractSchemas();
    const sqlContract = contracts.zink_sql;
    assert.ok(sqlContract?.rawSchema?.$defs?.output);
    const nonJson = validateToolOutputEnvelope(
      "zink_sql",
      { content: [{ type: "text", text: "plain string output" }] },
      sqlContract,
    );
    assert.equal(nonJson.ok, false);
    assert.equal(
      JSON.parse(nonJson.response.content[0].text).code,
      "INVALID_OUTPUT_SCHEMA",
    );
    const empty = validateToolOutputEnvelope(
      "zink_sql",
      { content: [{ type: "text", text: "" }] },
      sqlContract,
    );
    assert.equal(empty.ok, false);
    for (const exempt of [
      "ENGINE_NOT_IMPLEMENTED",
      "ERROR",
      "DENIED",
      "BLOCKED",
      "UNAVAILABLE",
    ]) {
      const pass = validateToolOutputEnvelope(
        "zink_sql",
        {
          content: [{ type: "text", text: JSON.stringify({ status: exempt }) }],
        },
        sqlContract,
      );
      assert.equal(pass.ok, true, `${exempt} passes through`);
    }
    const nonCallable = validateToolOutputEnvelope(
      "zink_skill_search",
      { content: [{ type: "text", text: "anything" }] },
      null,
    );
    assert.equal(nonCallable.ok, true);
  });

  it("M7-003: one canonical 7-agent x callable-tool matrix", async () => {
    const { evaluateToolAccess } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { ZINK_TOOLS_ACCESS_MATRIX } =
      await import("../integrations/openclaw/lib/authority.mjs");
    const { TOOL_POLICY } =
      await import("../integrations/openclaw/lib/policy.mjs");
    const agents = ["main", "o1", "o2", "excel", "power-bi", "sql", "python"];
    const tools = [
      "zink_excel",
      "zink_power_bi",
      "zink_sql",
      "zink_python",
      "zink_n8n",
    ];
    // Mechanical equivalence: L3 ⟺ canonically listed. No drift allowed.
    for (const agent of agents) {
      for (const tool of tools) {
        const listed = (TOOL_POLICY[agent] ?? []).includes(tool);
        const level = ZINK_TOOLS_ACCESS_MATRIX[agent]?.[tool];
        assert.equal(
          level === "L3",
          listed,
          `${agent} x ${tool}: L3 must equal canonical listing`,
        );
      }
    }
    // Named denials from the audit.
    assert.equal(evaluateToolAccess("o2", "zink_sql", {}).allowed, false);
    assert.equal(evaluateToolAccess("python", "zink_sql", {}).allowed, false);
    assert.equal(evaluateToolAccess("o1", "zink_sql", {}).allowed, false);
    assert.equal(evaluateToolAccess("excel", "zink_sql", {}).allowed, false);
    assert.equal(evaluateToolAccess("power-bi", "zink_sql", {}).allowed, false);
    // Main never executes specialists directly.
    for (const tool of tools) {
      assert.equal(evaluateToolAccess("main", tool, {}).allowed, false);
    }
    // Contract-only tools are never callable.
    for (const agent of agents) {
      for (const tool of [
        "zink_forecast",
        "zink_optimization",
        "zink_operations_research",
        "zink_simulation",
      ]) {
        assert.equal(evaluateToolAccess(agent, tool, {}).allowed, false);
      }
    }
    // Listed grants still execute.
    assert.equal(evaluateToolAccess("sql", "zink_sql", {}).allowed, true);
    assert.equal(evaluateToolAccess("excel", "zink_excel", {}).allowed, true);
    assert.equal(
      evaluateToolAccess("power-bi", "zink_power_bi", {}).allowed,
      true,
    );
    assert.equal(evaluateToolAccess("python", "zink_python", {}).allowed, true);
    assert.equal(evaluateToolAccess("o2", "zink_n8n", {}).allowed, true);
  });

  it("M7-004: wrapper and canonical resolver reach identical verdicts", async () => {
    const plugin =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { api, tools } = (() => {
      const captured = [];
      return {
        api: {
          registerTool: (def) => captured.push(def),
          pluginConfig: {},
          logger: {},
        },
        tools: captured,
      };
    })();
    plugin.registerTools(api);
    const sqlWrapper = tools.find((t) => t.name === "zink_sql");
    // Canonical deny => wrapper denies before any execution.
    const directDeny = plugin.evaluateToolAccess("o2", "zink_sql", {});
    assert.equal(directDeny.allowed, false);
    const wrappedDeny = JSON.parse(
      (
        await sqlWrapper.execute(
          { agent: "o2" },
          { query: "SELECT 1", target_database: "knowledge" },
        )
      ).content[0].text,
    );
    assert.equal(wrappedDeny.status, "DENIED");
    assert.equal(wrappedDeny.code, directDeny.reason);
    // Canonical allow => wrapper passes authorization (execution may still
    // block on scope — authorization and scope are separate gates).
    const directAllow = plugin.evaluateToolAccess("sql", "zink_sql", {});
    assert.equal(directAllow.allowed, true);
    const wrappedAllow = JSON.parse(
      (
        await sqlWrapper.execute(
          { agent: "sql" },
          { query: "SELECT 1", target_database: "knowledge" },
        )
      ).content[0].text,
    );
    assert.notEqual(wrappedAllow.status, "DENIED");
  });

  it("F-144: a successful zink_excel run satisfies its own output contract", async () => {
    // Measured pre-fix: the excel writer's own success envelope was rejected
    // by the excel contract ? `status`/`tool`/`preview_*` are not declared
    // there and `success` was never emitted ? so every successful workbook
    // came back to the agent as INVALID_OUTPUT_SCHEMA while a failed tool
    // passed the same gate.
    const contracts = loadToolContractSchemas();
    const excelContract = contracts.zink_excel;
    assert.ok(excelContract?.rawSchema?.$defs?.output);
    const { executeExcelOperation } =
      await import("../integrations/openclaw/lib/excel-writer.mjs");
    const dir = mkdtempSync(path.join(tmpdir(), "zink-f144-"));
    try {
      const result = executeExcelOperation(
        {
          operation: "generate",
          file_path: "report.xlsx",
          specification: {
            sheets: [{ name: "S", columns: ["a"], rows: [["x"]] }],
          },
        },
        dir,
      );
      assert.equal(result.status, "success");
      const check = validateToolOutputEnvelope(
        "zink_excel",
        { content: [{ type: "text", text: JSON.stringify(result) }] },
        excelContract,
      );
      assert.equal(
        check.ok,
        true,
        `a successful excel run must not be INVALID_OUTPUT_SCHEMA: ${JSON.stringify(check.response ?? {})}`,
      );

      // The gate is not weakened: an output that really violates the contract
      // is still blocked.
      const blocked = validateToolOutputEnvelope(
        "zink_excel",
        {
          content: [
            {
              type: "text",
              text: JSON.stringify({ operation: "generate", bogus: true }),
            },
          ],
        },
        excelContract,
      );
      assert.equal(blocked.ok, false);
      assert.equal(
        JSON.parse(blocked.response.content[0].text).code,
        "INVALID_OUTPUT_SCHEMA",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// F-470 / R9-T09-1: the registered tool dispatcher is the model-facing sink.
// Its catch paths forwarded `err.message` verbatim and echoed the whole tool
// output (`rawOutput`/`parsedOutput`) into the envelope, so internal failure
// text and unredacted output — a class that carries absolute filesystem paths,
// session keys and digests — reached model context, while the repo's own SQL
// sibling already returns a fixed message plus a symbolic code.
describe("F-470 — dispatcher failure envelopes are symbolic, never raw", () => {
  const BANNED_CLASSES = [
    ["session key", /\bsess-[a-zA-Z0-9_-]{8,}\b/u],
    ["64-hex digest", /\b[a-f0-9]{64}\b/u],
    [
      "filesystem path",
      /(?:[a-zA-Z]:\\[^\s"'<>|]+|\/(?:Users|home|tmp|etc|var|app)\/[^\s"'<>|]+)/u,
    ],
    ["bearer token", /Bearer\s+[A-Za-z0-9._~+/-]+=*/iu],
  ];

  it("the parameter-schema refusal returns fixed text plus a symbolic code", async () => {
    const { api, tools } = captureApi();
    registerTools(api);
    const wrapper = tools.find((t) => t.name === "zink_excel");
    const env = statusOf(await wrapper.execute({ agent: "excel" }, {}));
    assert.equal(env.status, "INVALID_PARAMETERS");
    assert.equal(env.code, "INVALID_PARAMETERS");
    assert.deepEqual(
      env.errors,
      ["INVALID_PARAMETERS: governed tool parameter validation failed closed"],
      "errors must be the fixed canonical text, never the thrown error message",
    );
  });

  it("an output-schema refusal echoes neither the output nor its banned classes", () => {
    const contracts = loadToolContractSchemas();
    const sentinel = {
      status: "success",
      workbook: "C:\\Users\\hoang_vinh\\Documents\\secret-target.xlsx",
      session_key: "sess-a1b2c3d4e5f6g7h8",
      digest: "a".repeat(64),
      authorization: "Bearer super.secret.value",
    };
    const check = validateToolOutputEnvelope(
      "zink_excel",
      { content: [{ type: "text", text: JSON.stringify(sentinel) }] },
      contracts.zink_excel,
    );
    assert.equal(check.ok, false);
    const text = check.response.content[0].text;
    const env = JSON.parse(text);
    assert.equal(env.status, "INVALID_OUTPUT_SCHEMA");
    assert.equal(env.code, "INVALID_OUTPUT_SCHEMA");
    assert.ok(
      !("rawOutput" in env),
      "the model-facing envelope must not carry the tool output",
    );
    assert.ok(
      !("parsedOutput" in env),
      "the model-facing envelope must not carry the parsed tool output",
    );
    assert.deepEqual(
      env.errors,
      [
        "INVALID_OUTPUT_SCHEMA: governed tool output did not satisfy its contract",
      ],
      "errors must be the fixed canonical text, never the thrown error message",
    );
    for (const [label, pattern] of BANNED_CLASSES) {
      assert.ok(
        !pattern.test(text),
        `the envelope leaks the ${label} class: ${text.slice(0, 400)}`,
      );
    }
  });

  it("a non-JSON tool output is refused with a symbolic code and no echoed bytes", () => {
    const contracts = loadToolContractSchemas();
    const raw =
      "fatal: cannot open /home/hoang_vinh/.openclaw-zink/ledger.json";
    const check = validateToolOutputEnvelope(
      "zink_excel",
      { content: [{ type: "text", text: raw }] },
      contracts.zink_excel,
    );
    assert.equal(check.ok, false);
    const text = check.response.content[0].text;
    const env = JSON.parse(text);
    assert.deepEqual(env.errors, ["NON_JSON_OUTPUT"]);
    assert.ok(
      !text.includes("/home/hoang_vinh"),
      "raw output bytes must not echo",
    );
  });

  it("an execute throw returns the fixed sentence plus the symbolic code", async () => {
    const { api, tools } = captureApi();
    const rawMessage =
      "EIO: cannot write C:\\Users\\hoang_vinh\\state\\ledger.json for sess-a1b2c3d4e5f6g7h8";
    registerTools(api, {
      toolRegistry: {
        zink_sql: {
          description: "throwing implementation",
          parameters: { type: "object", properties: {} },
          async execute() {
            throw Object.assign(new Error(rawMessage), {
              code: "DUCKDB_TIMEOUT",
            });
          },
        },
      },
    });
    const wrapper = tools.find((tool) => tool.name === "zink_sql");
    assert.ok(wrapper, "the stub tool must still be registered");
    const text = (await wrapper.execute({ agent: "sql" }, {})).content[0].text;
    const env = JSON.parse(text);
    assert.equal(env.status, "ERROR");
    assert.equal(env.message, "Governed tool execution failed closed.");
    assert.equal(env.code, "DUCKDB_TIMEOUT");
    assert.equal(env.error, "DUCKDB_TIMEOUT");
    assert.ok(!text.includes("EIO"), "the raw message must not echo");
    for (const [label, pattern] of BANNED_CLASSES) {
      assert.ok(
        !pattern.test(text),
        `the envelope leaks the ${label} class: ${text.slice(0, 400)}`,
      );
    }
  });

  it("an uncoded execute throw carries the symbolic fallback, not the message", async () => {
    const { api, tools } = captureApi();
    registerTools(api, {
      toolRegistry: {
        zink_python: {
          description: "throwing implementation",
          parameters: { type: "object", properties: {} },
          async execute() {
            throw new Error(
              "sandbox root /home/hoang_vinh/.openclaw-zink/sandbox is unavailable",
            );
          },
        },
      },
    });
    const wrapper = tools.find((tool) => tool.name === "zink_python");
    const text = (await wrapper.execute({ agent: "python" }, {})).content[0]
      .text;
    const env = JSON.parse(text);
    assert.equal(env.status, "ERROR");
    assert.equal(env.message, "Governed tool execution failed closed.");
    assert.equal(env.code, "TOOL_EXECUTION_FAILED");
    assert.equal(env.error, "TOOL_EXECUTION_FAILED");
    assert.ok(!text.includes("sandbox root"), "the raw message must not echo");
    for (const [label, pattern] of BANNED_CLASSES) {
      assert.ok(
        !pattern.test(text),
        `the envelope leaks the ${label} class: ${text.slice(0, 400)}`,
      );
    }
  });
});
