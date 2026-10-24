//
// SKIP-FAMILY: duckdb
//
// M12/T9 F-384: these cases need the DuckDB ENGINE, and a host without it
// reports NOT RUN instead of a pass. The capability is its own family, so the
// CI runner's expectation is declared once and every host agrees on it.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import {
  GOVERNANCE_VERSION,
  deriveTaskId,
  derivePrincipalRef,
} from "../integrations/openclaw/topology/lib/canonical.mjs";

import {
  validateContract,
  loadContractSchema,
} from "../integrations/openclaw/topology/lib/schema.mjs";

import {
  AGENT_IDS,
  ZINK_CAPABILITY_REGISTRY,
  CALLABLE_TOOL_REGISTRY,
  CALLABLE_DISPATCH_REGISTRY,
  DELEGATION_TABLE,
  resolveMentionedAgents,
  evaluateCapabilityAccess,
  effectiveOpenClawToolAllowlist,
  effectiveZinkCallableTools,
} from "../integrations/openclaw/lib/policy.mjs";

import {
  formatForDiscord,
  formatError,
} from "../integrations/openclaw/lib/discord-formatter.mjs";

import {
  executeGovernedKnowledgeQuery,
  KnowledgeAdapter,
  MAX_KNOWLEDGE_CALL_TIMEOUT_MS,
  resolveKnowledgeCallBudget,
} from "../zink-tools/adapters/knowledge/knowledge-adapter.mjs";

import {
  executeGovernedSkillQuery,
  SkillAdapter,
} from "../zink-tools/adapters/skill-store/skill-adapter.mjs";

import { promoteApprovedSkill } from "../zink-skill-store/src/catalog.mjs";
import { validateArtifactLogicalPath } from "../zink-tools/common/path-safety.mjs";
import { R2StorageAdapter } from "../zink-tools/adapters/storage/r2-adapter.mjs";
import {
  DUCKDB_MAX_STDIO_BYTES,
  DUCKDB_MAX_TIMEOUT_MS,
  ALLOWLISTED_DATABASES,
  bindParameters,
  executeGovernedDuckDbQuery,
} from "../zink-tools/sql/duckdb-bridge.mjs";
import { duckDbSkip } from "./helpers/duckdb-availability.mjs";
import {
  BIGQUERY_DEFAULT_TIMEOUT_MS,
  BIGQUERY_MAX_ROWS,
  BigQueryAdapter,
} from "../zink-tools/adapters/analytics/bigquery-adapter.mjs";
import {
  MOTHERDUCK_DEFAULT_TIMEOUT_MS,
  MOTHERDUCK_MAX_ROWS,
  MOTHERDUCK_MAX_TIMEOUT_MS,
  MotherDuckAdapter,
} from "../zink-tools/adapters/analytics/motherduck-adapter.mjs";

describe("M7/T5 Runtime Governance Remediation Comprehensive Test Suite", () => {
  const sampleMessage = {
    origin: "discord",
    origin_principal_ref: "princ-1234567890abcdef",
    origin_message_id: "123456789012345678",
  };

  // =========================================================================
  // T5.2 — Identity / Concurrency / State (BUG-01, BUG-11, BUG-15)
  // =========================================================================
  describe("T5.2 — Identity & Concurrency Isolation (BUG-01, BUG-11, BUG-15)", () => {
    test("BUG-01: deriveTaskId produces different task_ids for different agents on the same message", () => {
      const taskMain = deriveTaskId({ ...sampleMessage, agent_id: "main" });
      const taskO1 = deriveTaskId({ ...sampleMessage, agent_id: "o1" });
      const taskExcel = deriveTaskId({ ...sampleMessage, agent_id: "excel" });

      assert.notEqual(
        taskMain,
        taskO1,
        "main and o1 must have distinct task_ids",
      );
      assert.notEqual(
        taskMain,
        taskExcel,
        "main and excel must have distinct task_ids",
      );
      assert.notEqual(
        taskO1,
        taskExcel,
        "o1 and excel must have distinct task_ids",
      );

      // Idempotency: same message + same agent => same task_id
      const taskMainReplay = deriveTaskId({
        ...sampleMessage,
        agent_id: "main",
      });
      assert.equal(
        taskMain,
        taskMainReplay,
        "same agent + same message must be idempotent",
      );
    });

    test("BUG-11: 7 concurrent agents produce 7 distinct task_ids for 1 message", () => {
      const taskIds = new Set(
        AGENT_IDS.map((agent_id) =>
          deriveTaskId({ ...sampleMessage, agent_id }),
        ),
      );
      assert.equal(
        taskIds.size,
        7,
        "7 agents must produce 7 distinct task IDs",
      );
    });

    test("BUG-15: deriveTaskId rejects forged or missing parameters", () => {
      assert.throws(
        () => deriveTaskId({ ...sampleMessage, agent_id: 1234 }),
        /agent_id must be a string/u,
      );
    });
  });

  // =========================================================================
  // T5.3 — Discord Ingress / Output (BUG-12, BUG-13, BUG-14)
  // =========================================================================
  describe("T5.3 — Discord Ingress Resolution & Output Sanitization (BUG-12, BUG-13, BUG-14)", () => {
    test("BUG-12: Discord mention resolution handles single, duplicate, multiple and @everyone", () => {
      // Single direct mention
      const single = resolveMentionedAgents({
        content: "help <@123>",
        mentions: [{ id: "123", username: "excel" }],
      });
      assert.deepEqual(single, ["excel"]);

      // Duplicate mention is deduplicated
      const duplicate = resolveMentionedAgents({
        content: "test",
        mentions: [
          { id: "123", username: "excel" },
          { id: "123", username: "excel" },
        ],
      });
      assert.deepEqual(duplicate, ["excel"]);

      // Multiple mentions
      const multiple = resolveMentionedAgents({
        content: "run sql and python",
        mentions: [
          { id: "1", username: "sql" },
          { id: "2", username: "python" },
        ],
      });
      assert.deepEqual(multiple, ["sql", "python"]);

      // @everyone resolves all 7 governed agents
      const everyone = resolveMentionedAgents({
        content: "@everyone hello all",
        mentions: [],
      });
      assert.deepEqual(everyone, [
        "main",
        "o1",
        "o2",
        "excel",
        "power-bi",
        "sql",
        "python",
      ]);

      // No mention with requireMention: true resolves to []
      const none = resolveMentionedAgents(
        { content: "hello nobody", mentions: [] },
        { requireMention: true },
      );
      assert.deepEqual(none, []);
    });

    test("BUG-13: formatForDiscord strips all 11 banned patterns and redacts internal metadata", () => {
      const internalLeak = JSON.stringify({
        jsonrpc: "2.0",
        task_id: "a".repeat(64),
        session_key: "sess-1234567890",
        run_id: "run-9876543210",
        path: "C:\\Users\\HOANG VINH\\secret\\data.json",
        auth: "Bearer secret_api_token_value_12345",
        payload: {
          output: "Clean user result with findings.",
          assumptions: ["Data is refreshed"],
          limitations: ["Read only query"],
        },
      });

      const formatted = formatForDiscord(internalLeak, {
        agentName: "SQL Specialist",
      });

      // Must NOT contain internal task IDs, session keys, run IDs, bearer tokens, or local paths
      assert.ok(
        !formatted.includes("a".repeat(64)),
        "64-hex task ID must be redacted",
      );
      assert.ok(
        !formatted.includes("sess-1234567890"),
        "Session key must be redacted",
      );
      assert.ok(
        !formatted.includes("run-9876543210"),
        "Run ID must be redacted",
      );
      assert.ok(
        !formatted.includes("secret_api_token"),
        "Bearer tokens must be redacted",
      );
      assert.ok(
        !formatted.includes("C:\\Users"),
        "Local paths must be redacted",
      );

      // Must contain clean user text
      assert.ok(formatted.includes("Clean user result with findings."));
      assert.ok(formatted.includes("Data is refreshed"));
      assert.ok(formatted.includes("Read only query"));
    });

    test("BUG-13: formatError produces human-safe controlled failure messages", () => {
      const err = new Error(
        "Database timeout at line 42\n    at query (C:\\Users\\app\\db.mjs:42:10)",
      );
      const formatted = formatError(err, { agentName: "SQL Bot" });

      assert.ok(
        !formatted.includes("at query"),
        "Stack trace must be stripped",
      );
      assert.ok(!formatted.includes("C:\\Users"), "Path must be stripped");
      assert.ok(formatted.includes("SQL Bot"), "Agent name must be identified");
      assert.ok(
        formatted.includes("Database timeout"),
        "Error summary preserved",
      );
    });

    test("formatForDiscord: unwraps markdown code fences and agent-result-payload correctly", () => {
      const fencedPayload =
        "```json\n" +
        JSON.stringify({
          schema_version: "1.0.0",
          governance_version: "m7-t5-r13",
          outcome_claim: "COMPLETE",
          reason_claim: "NONE",
          output: "Xin chào sếp, em đã sẵn sàng hỗ trợ.",
          assumptions: ["Hệ thống ổn định"],
          limitations: ["Không ghi đè dữ liệu"],
        }) +
        "\n```";

      const formatted = formatForDiscord(fencedPayload, { agentName: "Excel" });
      assert.ok(
        !formatted.startsWith("```"),
        "Must not start with code fences",
      );
      assert.ok(formatted.includes("Xin chào sếp, em đã sẵn sàng hỗ trợ."));
      assert.ok(formatted.includes("**Giả định:**\n• Hệ thống ổn định"));
      assert.ok(formatted.includes("**Hạn chế:**\n• Không ghi đè dữ liệu"));
    });

    test("formatForDiscord: formats natural Vietnamese conversation correctly", () => {
      const naturalText =
        "Dạ chào anh, theo hợp đồng quản trị và cấu hình hiện tại của em (Agent Python, stack data_plant), em đã sẵn sàng hỗ trợ.";
      const formatted = formatForDiscord(naturalText, { agentName: "Python" });
      assert.ok(formatted.includes("Dạ chào anh, theo hợp đồng quản trị"));
      assert.ok(!formatted.includes("```"));
    });
  });

  // =========================================================================
  // T5.5 — Governance Version Synchronization (BUG-02)
  // =========================================================================
  describe("T5.5 — Governance Version Synchronization (BUG-02)", () => {
    test("BUG-02: Canonical GOVERNANCE_VERSION is the active revision", () => {
      // Phase B (gap A), 2026-09-29: the active version is m8-t2.3-r5, the
      // first whose writer semantics are unambiguous. m8-t2.2-r4 is RETAINED
      // in every contract enum because the deployed writer emitted it and
      // dropping it would make those ledgers permanently unreadable.
      assert.equal(GOVERNANCE_VERSION, "m8-t2.3-r5");
    });

    test("BUG-02: every retired governance version stays readable", () => {
      // The version bump must APPEND to the vocabulary, never replace it. A
      // replaced version makes every ledger written under it unreadable, which
      // is exactly the defect this repository already fixed once (the r3 -> r4
      // enum replacement).
      for (const contract of [
        "agent-result-payload",
        "approval-request",
        "delegation-envelope",
        "delegation-proposal",
        "execution-brief",
        "governance-manifest",
        "governed-reference",
        "incident",
        "ledger-event",
        "ledger-snapshot",
        "result",
        "trusted-result-envelope",
      ]) {
        const schema = loadContractSchema(contract);
        const found = findVersionEnum(schema);
        assert.ok(found, `${contract}: must declare a governance_version enum`);
        for (const historical of [
          "m7-t2-r12",
          "m7-t5-r13",
          "m8-t2-r9",
          "m8-t2.1-r3",
          "m8-t2.2-r4",
          "m8-t2.3-r5",
        ]) {
          assert.ok(
            found.includes(historical),
            `${contract}: ${historical} must remain a valid governance_version`,
          );
        }
      }
    });

    /** Find the governance_version enum anywhere in a contract. */
    function findVersionEnum(node) {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node.enum) && node.enum.includes("m8-t2.3-r5"))
        return node.enum;
      for (const value of Object.values(node)) {
        const found = findVersionEnum(value);
        if (found) return found;
      }
      return null;
    }

    test("BUG-02: Schemas accept both historical m7-t2-r12 and current m7-t5-r13", () => {
      const validT5 = {
        schema_version: "1.0.0",
        governance_version: "m7-t5-r13",
        outcome_claim: "COMPLETE",
        reason_claim: "NONE",
        output: "valid t5 payload",
        assumptions: [],
        limitations: [],
        requested_prerequisites: [],
        agent_self_validation: "Validated",
      };
      assert.equal(validateContract("agent-result-payload", validT5), true);

      const validT2 = { ...validT5, governance_version: "m7-t2-r12" };
      assert.equal(validateContract("agent-result-payload", validT2), true);

      const invalidVersion = { ...validT5, governance_version: "m7-t9-r99" };
      assert.throws(
        () => validateContract("agent-result-payload", invalidVersion),
        /SCHEMA_INVALID|SCHEMA_VALIDATION_FAILED/u,
      );
    });
  });

  // =========================================================================
  // T5.6 — Capability Governance Core & Matrices (BUG-03, BUG-09, BUG-16)
  // =========================================================================
  describe("T5.6 — Authoritative Access Matrices & Fine-Grained RBAC (BUG-03, BUG-09, BUG-16)", () => {
    test("BUG-03 & BUG-09: Knowledgebase Matrix evaluates agent and namespace access accurately", () => {
      // main has L2 on core and governance
      assert.equal(
        evaluateCapabilityAccess("main", "zink_knowledge", "core", "read")
          .allowed,
        true,
      );
      assert.equal(
        evaluateCapabilityAccess("main", "zink_knowledge", "governance", "read")
          .allowed,
        true,
      );

      // excel has L2 on excel and SC/Logistics, but L0 on bi-semantic
      assert.equal(
        evaluateCapabilityAccess("excel", "zink_knowledge", "excel", "read")
          .allowed,
        true,
      );
      assert.equal(
        evaluateCapabilityAccess(
          "excel",
          "zink_knowledge",
          "SC/Logistics",
          "read",
        ).allowed,
        true,
      );
      assert.equal(
        evaluateCapabilityAccess(
          "excel",
          "zink_knowledge",
          "bi-semantic",
          "read",
        ).allowed,
        false,
      );

      // Mutating actions are universally denied per KB action policy
      assert.equal(
        evaluateCapabilityAccess("main", "zink_knowledge", "core", "ingestion")
          .allowed,
        false,
      );
      assert.equal(
        evaluateCapabilityAccess("o1", "zink_knowledge", "core", "update")
          .allowed,
        false,
      );
      assert.equal(
        evaluateCapabilityAccess("o2", "zink_knowledge", "core", "delete")
          .allowed,
        false,
      );
      assert.equal(
        evaluateCapabilityAccess("python", "zink_knowledge", "core", "admin")
          .allowed,
        false,
      );
    });

    test("BUG-08: Skill Store Matrix evaluates discover/read/apply and forbids admin/publish", () => {
      // Specialists can discover, read and apply their approved skills
      assert.equal(
        evaluateCapabilityAccess("excel", "zink_skill", "excel", "discover")
          .allowed,
        true,
      );
      assert.equal(
        evaluateCapabilityAccess("excel", "zink_skill", "excel", "read")
          .allowed,
        true,
      );
      assert.equal(
        evaluateCapabilityAccess("excel", "zink_skill", "excel", "apply")
          .allowed,
        true,
      );

      // Publishing and admin are universally DENIED to all agents per ACTIVE.md §9
      for (const agentId of AGENT_IDS) {
        assert.equal(
          evaluateCapabilityAccess(agentId, "zink_skill", "all", "publish")
            .allowed,
          false,
        );
        assert.equal(
          evaluateCapabilityAccess(agentId, "zink_skill", "all", "deprecate")
            .allowed,
          false,
        );
        assert.equal(
          evaluateCapabilityAccess(agentId, "zink_skill", "all", "admin")
            .allowed,
          false,
        );
      }
    });

    test("BUG-09 & BUG-16: Zink Tools Matrix enforces specialist execution vs coordinator delegation", () => {
      // excel has L3 on zink_excel
      assert.equal(
        evaluateCapabilityAccess("excel", "zink_excel", null, "execute").level,
        "L3",
      );
      // main requires delegation for zink_excel
      assert.equal(
        evaluateCapabilityAccess("main", "zink_excel", null, "execute").level,
        "delegate",
      );
      // power-bi is L0 (denied) for zink_excel
      assert.equal(
        evaluateCapabilityAccess("power-bi", "zink_excel", null, "execute")
          .allowed,
        false,
      );
    });

    test("BUG-10: OpenClaw projection does not expand capabilities beyond policy", () => {
      // OpenClaw built-in allowlist contains only minimal/coordinator tools
      assert.deepEqual(effectiveOpenClawToolAllowlist("excel"), []);
      assert.deepEqual(effectiveOpenClawToolAllowlist("sql"), []);
      assert.deepEqual(effectiveOpenClawToolAllowlist("power-bi"), []);

      // Effective callable tools for specialists match TOOL_POLICY exactly
      assert.deepEqual(effectiveZinkCallableTools("excel"), ["zink_excel"]);
      assert.deepEqual(effectiveZinkCallableTools("sql"), ["zink_sql"]);
      assert.deepEqual(effectiveZinkCallableTools("power-bi"), [
        "zink_power_bi",
      ]);
    });
  });

  // =========================================================================
  // T5.7 & T5.8 — Governed Adapters (BUG-07, BUG-08)
  // =========================================================================
  describe("T5.7 & T5.8 — Governed Runtime Adapters (BUG-07, BUG-08)", () => {
    test("BUG-07: executeGovernedKnowledgeQuery returns CONTROLLED_FAILURE when backend is unavailable", async () => {
      // Target localhost:8000 (confirmed down during preflight)
      const res = await executeGovernedKnowledgeQuery({
        action: "search",
        namespace: "core",
        query: "governance guidelines",
      });

      assert.equal(res.governed_status, "CONTROLLED_FAILURE");
      assert.equal(res.error, "KNOWLEDGE_SERVICE_UNAVAILABLE");
      assert.deepEqual(res.results, [], "Must not fabricate synthetic results");
    });

    // T2.1-3 (R5-E06-03): the non-2xx path used to copy the first 300 bytes of
    // the upstream body into the model-visible `message`. Truncation is not
    // sanitization, so a FastAPI 422 dump — the adapter's own request echo,
    // upstream module paths, database column names — reached the ledger and the
    // cards. Driven against a stub service so the body is real bytes.
    test("BUG-07: a Knowledge service failure forwards no response bytes", async () => {
      const validationDump = JSON.stringify({
        detail: [
          {
            type: "missing",
            loc: ["body", "query"],
            msg: "Field required",
            input: { query: "governance guidelines" },
          },
          {
            type: "int_parsing",
            loc: ["body", "limit"],
            msg: "Input should be a valid integer, unable to parse string as an integer",
            input: "many",
          },
        ],
        internal:
          "psycopg.errors.UndefinedColumn: column knowledge_chunks.embedding_vector does not exist",
        traceback: 'File "/app/app/retrieval.py", line 161, in search',
      });
      const htmlDump =
        "<html><head><title>502 Bad Gateway</title></head><body>" +
        "nginx/1.27.0 upstream knowledge-api:8000</body></html>";
      let served = 0;
      const server = http.createServer((_req, res) => {
        served += 1;
        if (served === 1) {
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(validationDump);
          return;
        }
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(htmlDump);
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const endpoint = `http://127.0.0.1:${server.address().port}`;
      try {
        const rejected = await executeGovernedKnowledgeQuery(
          {
            action: "search",
            namespace: "core",
            query: "governance guidelines",
          },
          {},
          { endpoint },
        );
        assert.equal(rejected.governed_status, "CONTROLLED_FAILURE");
        assert.equal(rejected.error, "HTTP_422");
        const rendered = JSON.stringify(rejected);
        for (const marker of [
          "psycopg",
          "embedding_vector",
          "/app/app/retrieval.py",
          "unable to parse",
          "Field required",
          "governance guidelines",
        ]) {
          assert.ok(
            !rendered.includes(marker),
            `the result must not carry upstream body content: ${marker}`,
          );
        }
        // What the caller keeps is the projection of its OWN request: which
        // field was rejected and by which schema rule.
        assert.match(rejected.message, /HTTP 422/u);
        assert.match(rejected.message, /body\.query: missing/u);
        assert.match(rejected.message, /body\.limit: int_parsing/u);

        const collapsed = await executeGovernedKnowledgeQuery(
          {
            action: "search",
            namespace: "core",
            query: "governance guidelines",
          },
          {},
          { endpoint },
        );
        assert.equal(collapsed.error, "HTTP_500");
        assert.ok(
          !JSON.stringify(collapsed).includes("nginx"),
          "a non-JSON upstream body must be dropped whole, not sliced",
        );
        assert.match(collapsed.message, /HTTP 500/u);
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    });

    test("BUG-07: executeGovernedKnowledgeQuery forbids ingestion and mutation actions", async () => {
      await assert.rejects(
        () =>
          executeGovernedKnowledgeQuery({
            action: "ingestion",
            namespace: "core",
          }),
        /strictly forbidden/u,
      );
      await assert.rejects(
        () =>
          executeGovernedKnowledgeQuery({
            action: "delete",
            namespace: "core",
          }),
        /strictly forbidden/u,
      );
    });

    test("BUG-08: executeGovernedSkillQuery allows discover and fails closed for missing skills", async () => {
      const discoverRes = await executeGovernedSkillQuery({
        action: "discover",
        namespace: "all",
      });
      assert.equal(discoverRes.governed_status, "SUCCESS");
      assert.ok(Array.isArray(discoverRes.skills));

      await assert.rejects(
        () =>
          executeGovernedSkillQuery({
            action: "read",
            skill_id: "skill-excel",
          }),
        /SKILL_NOT_FOUND/u,
      );

      await assert.rejects(
        () =>
          executeGovernedSkillQuery({
            action: "publish",
            skill_id: "skill-test",
          }),
        /strictly forbidden/u,
      );
      await assert.rejects(
        () =>
          executeGovernedSkillQuery({
            action: "admin",
            skill_id: "skill-test",
          }),
        /strictly forbidden/u,
      );
    });
  });

  // =========================================================================
  // ACTIVE.md §17 — 14 Required Negative Security Scenarios
  // =========================================================================
  describe("ACTIVE.md §17 — 14 Mandatory Negative Security Tests", () => {
    test("1. Specialist unauthorized tool is denied", () => {
      const res = evaluateCapabilityAccess(
        "excel",
        "zink_sql",
        null,
        "execute",
      );
      assert.equal(res.allowed, false);
      assert.equal(res.level, "L2");
      assert.equal(res.reason, "READ_ONLY_ACCESS");
      assert.equal(
        evaluateCapabilityAccess("excel", "zink_python", null, "execute")
          .allowed,
        false,
      );
      assert.equal(
        evaluateCapabilityAccess("sql", "zink_excel", null, "execute").allowed,
        false,
      );
    });

    test("2. Unauthorized KB namespace is denied", () => {
      const res = evaluateCapabilityAccess(
        "excel",
        "zink_knowledge",
        "bi-semantic",
        "read",
      );
      assert.equal(res.allowed, false);
      assert.equal(res.reason, "DISCOVER_ONLY_ACCESS");

      const unknownRes = evaluateCapabilityAccess(
        "excel",
        "zink_knowledge",
        "non_existent_ns",
        "read",
      );
      assert.equal(unknownRes.allowed, false);
      assert.equal(unknownRes.reason, "NAMESPACE_ACCESS_DENIED");
    });

    test("3. Unauthorized Skill namespace / action is denied", () => {
      const res = evaluateCapabilityAccess(
        "excel",
        "zink_skill",
        "governance",
        "admin",
      );
      assert.equal(res.allowed, false);
    });

    test("4. Arbitrary filesystem access is rejected (path traversal / absolute escape)", () => {
      assert.throws(
        () => validateArtifactLogicalPath("../../../etc/passwd"),
        /SCHEMA_VALIDATION_FAILED|INVALID_PATH|PATH_SECURITY_VIOLATION/u,
      );
      assert.throws(
        () => validateArtifactLogicalPath("C:\\Windows\\System32\\cmd.exe"),
        /SCHEMA_VALIDATION_FAILED|INVALID_PATH|PATH_SECURITY_VIOLATION/u,
      );
    });

    test("5. Arbitrary process execution is denied (schema validation rejects non-contract tools)", () => {
      assert.throws(
        () => validateContract("non-existent-tool-schema", { cmd: "rm -rf /" }),
        /SCHEMA_INVALID|SCHEMA_VALIDATION_FAILED/u,
      );
    });

    test("6. Direct adapter bypass without governance validation is denied", async () => {
      const adapter = new KnowledgeAdapter("http://localhost:8000");
      await assert.rejects(
        () => adapter.queryKnowledge({ action: "unknown_bypass_action" }),
        /Unknown Knowledgebase action/u,
      );
    });

    test("7. Forged agent identity is denied", () => {
      const res = evaluateCapabilityAccess(
        "malicious_agent",
        "zink_sql",
        null,
        "read",
      );
      assert.equal(res.allowed, false);
      assert.equal(res.reason, "UNKNOWN_AGENT");
    });

    test("8. Forged session identity is denied by task derivation", () => {
      assert.throws(
        () => derivePrincipalRef("invalid-key", "invalid-snowflake-id"),
        /Discord identity must be a snowflake string/u,
      );
    });

    test("9. Forged run ID / schema parameters rejected by validateContract", () => {
      assert.throws(
        () =>
          validateContract("agent-result-payload", {
            schema_version: "1.0.0",
            governance_version: GOVERNANCE_VERSION,
            outcome_claim: "INVALID_CLAIM",
          }),
        /SCHEMA_INVALID|SCHEMA_VALIDATION_FAILED/u,
      );
    });

    test("10. Forged governance version is denied", () => {
      assert.throws(
        () =>
          validateContract("agent-result-payload", {
            schema_version: "1.0.0",
            governance_version: "m7-t0-fake",
            outcome_claim: "COMPLETE",
            output: "ok",
          }),
        /SCHEMA_INVALID|SCHEMA_VALIDATION_FAILED/u,
      );
    });

    test("11. OpenClaw allowlist bypass is prevented by strict allowlist projection", () => {
      const allowlist = effectiveOpenClawToolAllowlist("excel");
      assert.ok(!allowlist.includes("bash"));
      assert.ok(!allowlist.includes("exec"));
      assert.ok(!allowlist.includes("fs_write"));
    });

    test("12. Delegation privilege escalation is denied per DELEGATION_TABLE", () => {
      // main can only delegate zink_excel to o1 or o2, not directly to excel
      const mainTargets = DELEGATION_TABLE.main.zink_excel;
      assert.deepEqual(mainTargets, ["o1"]);
      assert.ok(
        !mainTargets.includes("excel"),
        "main must not escalate directly to specialist excel",
      );

      // o1 can delegate zink_excel to excel, but not to o2 or python
      const o1Targets = DELEGATION_TABLE.o1.zink_excel;
      assert.deepEqual(o1Targets, ["excel"]);
      assert.ok(!o1Targets.includes("python"));
    });

    test("13. Unapproved or deprecated skill execution is denied", async () => {
      const adapter = new SkillAdapter();
      await assert.rejects(
        () => adapter.querySkillStore({ action: "deprecate", skill_id: "s1" }),
        /strictly forbidden/u,
      );
    });

    test("14. Schema-only tools are strictly non-callable", () => {
      const schemaOnly = [
        "zink_forecast",
        "zink_optimization",
        "zink_operations_research",
        "zink_simulation",
      ];
      for (const toolId of schemaOnly) {
        assert.equal(toolId in CALLABLE_TOOL_REGISTRY, false);
        assert.equal(toolId in CALLABLE_DISPATCH_REGISTRY, false);
        assert.equal(ZINK_CAPABILITY_REGISTRY[toolId].status, "schema_only");
      }
    });
  });
});
// ===========================================================================
// F-010 (R1-A16-08) - the durable skill proposal records the trusted requester,
// never the model-supplied claim and never a substitute constant.
// ===========================================================================
describe("F-010 (R1-A16-08) - a skill proposal's identity is trusted-context only", () => {
  const trustedContext = {
    sessionKey: "sess-f010",
    runId: "run-f010",
    taskId: "task-f010",
    requestingAgent: "o1",
  };

  test("F-010: a model-supplied requesting_agent never becomes the recorded proposer", async () => {
    const proposalStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "zink-f010-proposals-"),
    );
    try {
      const result = await executeGovernedSkillQuery(
        {
          action: "propose",
          namespace: ["office"],
          capability: "f010-trusted-identity",
          version: "1.0.0",
          content: "# Trusted identity\n\nThe proposer comes from context.",
          reason: "F-010 trusted identity probe",
          requesting_agent: "excel",
        },
        trustedContext,
        { proposalStorageDir },
      );

      assert.equal(result.governed_status, "SUCCESS");
      assert.equal(result.proposal.requesting_agent, "o1");

      const durable = JSON.parse(
        fs.readFileSync(
          path.join(proposalStorageDir, `${result.proposal.proposal_id}.json`),
          "utf8",
        ),
      );
      assert.equal(durable.requesting_agent, "o1");
    } finally {
      await rm(proposalStorageDir, { recursive: true, force: true });
    }
  });

  test("F-010: with no trusted identity the record substitutes no constant", async () => {
    const proposalStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "zink-f010-proposals-"),
    );
    try {
      const result = await executeGovernedSkillQuery(
        {
          action: "propose",
          namespace: ["office"],
          capability: "f010-unbound-identity",
          version: "1.0.0",
          content: "# Unbound identity\n\nNo trusted requester in context.",
          reason: "F-010 no-context-identity probe",
        },
        { sessionKey: "sess-f010", runId: "run-f010", taskId: "task-f010" },
        { proposalStorageDir },
      );

      assert.equal(result.governed_status, "SUCCESS");
      assert.notEqual(result.proposal.requesting_agent, "specialist");
      assert.notEqual(result.proposal.requesting_agent, "unknown");
      assert.equal(
        Object.hasOwn(result.proposal, "requesting_agent"),
        false,
        "an unbound proposal must omit the field rather than invent an actor",
      );
    } finally {
      await rm(proposalStorageDir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// F-073 (R5-E06-01) - an upstream Retry-After must not hold the shared search
// permit, and the wait it commands is clamped by a repo-owned ceiling.
// ===========================================================================
describe("F-073 (R5-E06-01) - the search permit is never held across a retry wait", () => {
  test("F-073: two 429-retrying searches do not block two queued searches", async () => {
    const arrivals = [];
    const server = http.createServer((_req, res) => {
      arrivals.push(Date.now());
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": "1",
      });
      res.end("{}");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const call = (query) =>
      executeGovernedKnowledgeQuery(
        { action: "search", namespace: "core", query },
        {},
        { endpoint, deterministicRetry: true },
      );
    try {
      const first = call("a");
      const second = call("b");
      // Both slots of the process-wide 2-slot search semaphore are busy with
      // searches that answered 429 and are waiting out Retry-After.
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(
        arrivals.length,
        2,
        "the first two searches must be in flight",
      );

      const third = call("c");
      const fourth = call("d");
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.ok(
        arrivals.length >= 4,
        `a queued search must not wait for an upstream Retry-After (arrivals: ${arrivals.length})`,
      );

      const settled = await Promise.all([first, second, third, fourth]);
      for (const result of settled) {
        assert.equal(result.governed_status, "CONTROLLED_FAILURE");
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("F-073: the honoured Retry-After wait is clamped by an exported ceiling", async () => {
    const { MAX_KNOWLEDGE_RETRY_AFTER_MS: ceiling } =
      await import("../zink-tools/adapters/knowledge/knowledge-adapter.mjs");
    assert.equal(typeof ceiling, "number");
    assert.ok(ceiling > 0, "the ceiling must be a positive number");
    assert.ok(
      ceiling <= 60_000,
      "an upstream Retry-After must not command an unbounded wait",
    );

    const source = fs.readFileSync(
      "zink-tools/adapters/knowledge/knowledge-adapter.mjs",
      "utf8",
    );
    assert.match(
      source,
      /Math\.min\(\s*seconds \* 1000,\s*MAX_KNOWLEDGE_RETRY_AFTER_MS,?\s*\)/u,
      "the Retry-After seconds must be clamped by the exported ceiling",
    );
  });
});

// ===========================================================================
// F-145 (R1-A14-08) - a service fault must not forward exception text, and a
// row whose provenance had to be invented is not evidence.
// ===========================================================================
describe("F-145 (R1-A14-08) - failure envelopes and invented provenance", () => {
  async function withServer(handler, run) {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    try {
      return await run((input) =>
        executeGovernedKnowledgeQuery(input, {}, { endpoint }),
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }

  test("F-145: a non-JSON 2xx body never reaches the caller as exception text", async () => {
    const body =
      "psycopg.errors.UndefinedColumn: column knowledge_chunks.embedding_vector does not exist";
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
      },
      async (call) => {
        const result = await call({
          action: "search",
          namespace: "core",
          query: "x",
        });
        assert.equal(result.governed_status, "CONTROLLED_FAILURE");
        assert.equal(result.error, "KNOWLEDGE_SERVICE_UNAVAILABLE");
        assert.equal(
          result.message,
          "Knowledgebase service is unavailable.",
          "a non-adapter fault must yield the fixed sentence, not the exception",
        );
        const rendered = JSON.stringify(result);
        for (const marker of [
          "psycopg",
          "embedding_vector",
          "not valid JSON",
          "Unexpected token",
        ]) {
          assert.ok(
            !rendered.includes(marker),
            `no upstream or exception text may be forwarded: ${marker}`,
          );
        }
      },
    );
  });

  test("F-145: an identity-less row is refused instead of counted as evidence", async () => {
    const responses = [
      { results: [{ text: "row with no identity at all" }] },
      { results: [] },
      {
        results: [
          {
            segment_id: "segment-1",
            title: "Real row",
            text: "cited evidence",
            source_path: "docs/real.md",
            dense_score: 0.5,
          },
        ],
      },
    ];
    let served = 0;
    await withServer(
      (_req, res) => {
        const payload = responses[Math.min(served, responses.length - 1)];
        served += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      },
      async (call) => {
        const invented = await call({
          action: "search",
          namespace: "core",
          query: "invented",
        });
        assert.notEqual(
          invented.governed_status,
          "SUCCESS",
          "invented provenance must not be returned as SUCCESS",
        );
        assert.equal(invented.total_count, 0);
        assert.deepEqual(invented.results, []);
        assert.equal(invented.error, "KNOWLEDGE_PROVENANCE_MISSING");

        const noMatch = await call({
          action: "search",
          namespace: "core",
          query: "empty",
        });
        assert.equal(noMatch.governed_status, "NO_MATCH");
        const differing = new Set(
          [
            ...new Set([...Object.keys(noMatch), ...Object.keys(invented)]),
          ].filter(
            (key) =>
              JSON.stringify(noMatch[key]) !== JSON.stringify(invented[key]),
          ),
        );
        assert.ok(
          differing.size > 1,
          `NO_MATCH must differ from CONTROLLED_FAILURE by more than one field (differs by: ${[...differing].join(", ")})`,
        );

        const provenanceBacked = await call({
          action: "search",
          namespace: "core",
          query: "real",
        });
        assert.equal(provenanceBacked.governed_status, "SUCCESS");
        assert.equal(provenanceBacked.total_count, 1);
        assert.equal(
          provenanceBacked.results[0].chunk_id,
          "segment-1",
          "a real row keeps its own identity",
        );
        assert.equal(provenanceBacked.results[0].title, "Real row");
        assert.equal(provenanceBacked.results[0].citation, "docs/real.md");
      },
    );
  });
});
// ===========================================================================
// F-170 (R5-E06-02) - the response accumulator must measure bytes, and a
// multi-byte character split across two chunks must survive intact.
// ===========================================================================
describe("F-170 (R5-E06-02) - byte-accurate accumulation of the upstream body", () => {
  test("F-170: a character split across two flushed chunks survives intact", async () => {
    const character = "\u1EBF"; // 3 UTF-8 bytes, the owner's own alphabet
    const text = `cau tra loi: ${character}`;
    const payload = JSON.stringify({
      results: [
        {
          segment_id: "segment-f170",
          title: "Cau tra loi",
          source_path: "docs/vi.md",
          text,
        },
      ],
    });
    const bytes = Buffer.from(payload, "utf8");
    const at = bytes.indexOf(Buffer.from(character, "utf8"));
    assert.ok(at > 0, "the fixture must contain the multi-byte character");
    const split = at + 1;

    const server = http.createServer(async (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.write(bytes.subarray(0, split));
      await new Promise((resolve) => setTimeout(resolve, 30));
      res.write(bytes.subarray(split));
      res.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    try {
      const result = await executeGovernedKnowledgeQuery(
        { action: "search", namespace: "core", query: "x" },
        {},
        { endpoint },
      );
      assert.equal(result.governed_status, "SUCCESS");
      const forwarded = result.results[0].text;
      assert.ok(
        !forwarded.includes("\uFFFD"),
        "the adapter must not introduce a replacement character",
      );
      assert.equal(forwarded, text, "the retrieved text must be byte-exact");
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("F-170: the accumulator measures bytes, not UTF-16 code units", () => {
    const source = fs.readFileSync(
      "zink-tools/adapters/knowledge/knowledge-adapter.mjs",
      "utf8",
    );
    assert.ok(
      !source.includes("data += chunk;"),
      "chunks must not be appended as independently decoded strings",
    );
    assert.match(
      source,
      /Buffer\.concat\(/u,
      "the bounded body must be accumulated as bytes",
    );
    assert.match(
      source,
      /receivedBytes \+= buffer\.length;/u,
      "the byte count must be the buffer byte length, not a decoded length",
    );
    assert.match(
      source,
      /receivedBytes > MAX_KNOWLEDGE_RESPONSE_BYTES/u,
      "the byte ceiling must be compared against a byte count",
    );
  });
});
// ===========================================================================
// F-053 (R1-A03-06) - the SSRF allowlist has no blanket off switch: a host is
// always checked against an explicit allowlist, and an admitted non-local
// endpoint is announced instead of being used invisibly.
// ===========================================================================
describe("F-053 (R1-A03-06) - the SSRF allowlist has no blanket off switch", () => {
  test("F-053: allowRemote alone cannot admit a host that is not explicitly allowlisted", async () => {
    const adapter = new KnowledgeAdapter(
      "http://knowledge-bad.example.invalid:8000",
      { allowRemote: true },
    );
    await assert.rejects(
      () => adapter.queryKnowledge({ action: "search", query: "x" }),
      (error) => {
        assert.equal(error.name, "KnowledgeAdapterError");
        assert.equal(error.code, "KNOWLEDGE_ENDPOINT_FORBIDDEN");
        return true;
      },
      "allowRemote must not be a blanket off switch for the host check",
    );
  });

  test("F-053: an allowlisted non-local host is refused until allowRemote acknowledges it", async () => {
    const endpoint = "http://knowledge-bad.example.invalid:8000";
    await assert.rejects(
      () =>
        new KnowledgeAdapter(endpoint, {
          allowedHosts: ["knowledge-bad.example.invalid"],
        }).queryKnowledge({ action: "search", query: "x" }),
      (error) => {
        assert.equal(error.code, "KNOWLEDGE_ENDPOINT_FORBIDDEN");
        assert.match(error.message, /allowRemote/u);
        return true;
      },
      "the acknowledgement is load-bearing, not decorative",
    );
  });

  test("F-053: an admitted non-local endpoint is announced once, then called", async () => {
    const announced = [];
    const logged = [];
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: [] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.2", resolve));
    const endpoint = `http://127.0.0.2:${server.address().port}`;
    const adapter = new KnowledgeAdapter(endpoint, {
      allowRemote: true,
      allowedHosts: ["127.0.0.2"],
      onRemoteEndpoint: (host) => announced.push(host),
      logger: { warn: (line) => logged.push(line) },
    });
    try {
      const result = await adapter.queryKnowledge({
        action: "search",
        query: "x",
      });
      assert.equal(result.governed_status, "NO_MATCH");
      assert.deepEqual(announced, ["127.0.0.2"]);
      assert.equal(logged.length, 1);
      assert.match(logged[0], /KNOWLEDGE_ENDPOINT_REMOTE/u);
      assert.equal(adapter.announcedRemoteEndpoint, "127.0.0.2");

      await adapter.queryKnowledge({ action: "search", query: "x" });
      assert.equal(announced.length, 1, "the notice is once per adapter");
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("F-053: a built-in trusted host needs no acknowledgement and is not announced", async () => {
    const announced = [];
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: [] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const adapter = new KnowledgeAdapter(
      `http://127.0.0.1:${server.address().port}`,
      { onRemoteEndpoint: (host) => announced.push(host) },
    );
    try {
      const result = await adapter.queryKnowledge({
        action: "search",
        query: "x",
      });
      assert.equal(result.governed_status, "NO_MATCH");
      assert.deepEqual(announced, []);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
// ===========================================================================
// F-103 (R2-B01-02) - a governed knowledge call carries the identity the
// runtime derived, and a task id the caller's own payload named is never
// forwarded as the task this call is attributed to.
// ===========================================================================
describe("F-103 (R2-B01-02) - governed knowledge calls send a derived identity", () => {
  const liveContext = (taskId) => ({
    sessionKey: "sess-1",
    runId: "run-1",
    taskId,
    requestingAgent: "o1",
  });

  test("F-103: the trusted identity is forwarded and the payload's task id is not", async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: [] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    try {
      await executeGovernedKnowledgeQuery(
        {
          action: "search",
          namespace: "core",
          query: "x",
          task_id: "attacker-chosen-task",
        },
        liveContext("attacker-chosen-task"),
        { endpoint },
      );
      assert.equal(seen.length, 1);
      assert.equal(
        seen[0]["x-agent-id"],
        "o1",
        "the derived identity must reach the service",
      );
      assert.equal(
        seen[0]["x-task-id"],
        undefined,
        "a model-named task id must not be forwarded as bare correlation",
      );
      assert.equal(seen[0]["x-attempt-token"], undefined);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("F-103: a task id the payload did not name is still forwarded for correlation", async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: [] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    try {
      await executeGovernedKnowledgeQuery(
        { action: "search", namespace: "core", query: "x" },
        liveContext("task-from-ledger"),
        { endpoint },
      );
      assert.equal(seen[0]["x-agent-id"], "o1");
      assert.equal(seen[0]["x-task-id"], "task-from-ledger");
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("F-103: no identity is invented when the runtime supplied none", async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: [] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    try {
      await executeGovernedKnowledgeQuery(
        { action: "search", namespace: "core", query: "x" },
        { sessionKey: "s", runId: "r", taskId: "t" },
        { endpoint },
      );
      assert.equal(seen[0]["x-agent-id"], undefined);
      assert.equal(seen[0]["x-task-id"], "t");
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
// ===========================================================================
// F-184 (R1-A14-07) - the deadline is per CALL, and a transport error is
// retried like any other transient failure.
// ===========================================================================
describe("F-184 (R1-A14-07) - a knowledge call cannot outlive its budget", () => {
  test("F-184: a transport error is retried instead of ending the call", async () => {
    let attempts = 0;
    const server = http.createServer((req, res) => {
      attempts += 1;
      if (attempts === 1) {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: [] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    try {
      const result = await executeGovernedKnowledgeQuery(
        { action: "search", namespace: "core", query: "x" },
        {},
        { endpoint, jitterFn: () => 0 },
      );
      assert.equal(attempts, 2, "a reset socket must be retried");
      assert.equal(result.governed_status, "NO_MATCH");
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("F-184: the per-call budget is clamped to this module's ceiling", () => {
    assert.equal(MAX_KNOWLEDGE_CALL_TIMEOUT_MS, 240_000);
    assert.ok(
      MAX_KNOWLEDGE_CALL_TIMEOUT_MS < 300_000,
      "the ceiling must leave room inside runTimeoutSeconds: 300",
    );
    assert.equal(
      resolveKnowledgeCallBudget(120_000, { timeout: 10_000_000 }, {}),
      MAX_KNOWLEDGE_CALL_TIMEOUT_MS,
      "a caller-supplied timeout must not exceed the ceiling",
    );
    assert.equal(
      resolveKnowledgeCallBudget(120_000, { timeout: 1_000 }, {}),
      1_000,
    );
    assert.equal(
      resolveKnowledgeCallBudget(120_000, {}, { timeout: 5_000 }),
      5_000,
    );
    assert.equal(
      resolveKnowledgeCallBudget(120_000, {}, { timeout: "not-a-number" }),
      120_000,
    );
  });

  test("F-184: the whole call stops at its budget instead of retrying past it", async () => {
    let attempts = 0;
    const server = http.createServer((_req, res) => {
      attempts += 1;
      if (attempts === 1) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end("{}");
        return;
      }
      // Never answer: only the call budget can end this.
      setTimeout(() => res.end("{}"), 30_000).unref();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const startedAt = Date.now();
    try {
      const result = await executeGovernedKnowledgeQuery(
        { action: "search", namespace: "core", query: "x", timeout: 1_500 },
        {},
        { endpoint, jitterFn: () => 0 },
      );
      const elapsed = Date.now() - startedAt;
      assert.equal(
        result.error,
        "HTTP_503",
        "the call must end on its budget, not on a hung attempt",
      );
      assert.ok(
        elapsed < 2_500,
        `the 1500ms budget must bound the call, took ${elapsed}ms`,
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
// ===========================================================================
// F-052 (R5-E15-02) + F-171 (R5-E06-09) - the storage key is assembled only
// from a validated logical identifier, so no second spelling can address one
// object and the zone invariants cannot be aliased.
// ===========================================================================
describe("F-052 (R5-E15-02) / F-171 (R5-E06-09) - storage keys are logical identifiers", () => {
  const traversalIds = [
    "../../silver/orders/v1",
    "../silver/x",
    "..",
    "a/../b",
    "a\\b",
    "a//b",
    "landing/orders",
    "silver/orders",
    "C:\\evil",
    "NUL",
    "con.txt",
    ".",
    "a..b",
  ];

  test("F-052/F-171: every entry point refuses a traversal-shaped artifact_id", async () => {
    for (const artifact_id of traversalIds) {
      const adapter = new R2StorageAdapter();
      await assert.rejects(
        () =>
          adapter.putLandingArtifact({
            task_id: "task-1",
            run_id: "run-1",
            artifact_id,
            data: "payload",
          }),
        (error) => {
          assert.equal(error.name, "R2AdapterError");
          assert.equal(error.code, "R2_INVALID_ARTIFACT_ID");
          return true;
        },
        `putLandingArtifact must refuse ${JSON.stringify(artifact_id)}`,
      );
      await assert.rejects(
        () =>
          adapter.promoteToSilver({
            task_id: "task-1",
            run_id: "run-1",
            artifact_id,
            version: 1,
            data: "payload",
          }),
        (error) => error.code === "R2_INVALID_ARTIFACT_ID",
        `promoteToSilver must refuse ${JSON.stringify(artifact_id)}`,
      );
      await assert.rejects(
        () => adapter.getArtifact("landing", artifact_id),
        (error) => error.code === "R2_INVALID_ARTIFACT_ID",
        `getArtifact must refuse ${JSON.stringify(artifact_id)}`,
      );
    }
  });

  test("F-052/F-171: an alias cannot bypass the landing-immutability check", async () => {
    const adapter = new R2StorageAdapter();
    await adapter.putLandingArtifact({
      task_id: "task-1",
      run_id: "run-1",
      artifact_id: "orders",
      data: "first",
    });
    await assert.rejects(
      () =>
        adapter.putLandingArtifact({
          task_id: "task-1",
          run_id: "run-1",
          artifact_id: "../landing/orders",
          data: "overwrite",
        }),
      (error) => error.code === "R2_INVALID_ARTIFACT_ID",
    );
    assert.equal(
      (await adapter.getArtifact("landing", "orders")).data.toString("utf8"),
      "first",
    );
  });

  test("F-052/F-171: a logical identifier still round-trips through both zones", async () => {
    const adapter = new R2StorageAdapter();
    const landing = await adapter.putLandingArtifact({
      task_id: "task-1",
      run_id: "run-1",
      artifact_id: "landing-job-wf-1-run-1.json",
      data: JSON.stringify({ ok: true }),
    });
    assert.equal(landing.bucket, "landing");
    const promoted = await adapter.promoteToSilver({
      task_id: "task-1",
      run_id: "run-1",
      artifact_id: "silver-landing-job-wf-1-run-1.json",
      version: 1,
      data: "cleaned",
    });
    assert.equal(promoted.bucket, "silver");
    assert.equal(
      (
        await adapter.getArtifact(
          "silver",
          "silver-landing-job-wf-1-run-1.json",
          1,
        )
      ).data.toString("utf8"),
      "cleaned",
    );
  });
});
// ===========================================================================
// F-187 (R5-E06-08) - an unavailable skills root is not an empty catalog.
// ===========================================================================
describe("F-187 (R5-E06-08) - an unavailable skills root is not an empty catalog", () => {
  test("F-187: discover fails closed when the skills root does not exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "f187-missing-"));
    try {
      const adapter = new SkillAdapter(undefined, {
        skillsRoot: path.join(root, "skills"),
      });
      const res = await adapter.querySkillStore({
        action: "discover",
        namespace: "all",
      });
      assert.equal(res.governed_status, "FAILED");
      assert.equal(res.error_code, "SKILL_ROOT_UNAVAILABLE");
      assert.deepEqual(res.skills, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("F-187: a file where the root should be fails closed too", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "f187-file-"));
    try {
      const skillsRoot = path.join(root, "skills");
      fs.writeFileSync(skillsRoot, "not a directory", "utf8");
      const adapter = new SkillAdapter(undefined, { skillsRoot });
      const res = await adapter.querySkillStore({
        action: "discover",
        namespace: "all",
      });
      assert.equal(res.governed_status, "FAILED");
      assert.equal(res.error_code, "SKILL_ROOT_UNAVAILABLE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("F-187: an existing but empty skills root is still a successful empty catalog", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "f187-empty-"));
    try {
      const skillsRoot = path.join(root, "skills");
      fs.mkdirSync(skillsRoot, { recursive: true });
      const adapter = new SkillAdapter(undefined, { skillsRoot });
      const res = await adapter.querySkillStore({
        action: "discover",
        namespace: "all",
      });
      assert.equal(res.governed_status, "SUCCESS");
      assert.deepEqual(res.skills, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
// ===========================================================================
// F-117 (R5-E06-05) - declared parameters must reach the engine, instead of
// being validated and then discarded.
// ===========================================================================
describe("F-117 (R5-E06-05) - declared parameters reach the engine", () => {
  test(
    "F-117: a contract-valid parameterized call returns rows",
    { skip: duckDbSkip() },
    async () => {
      const result = await executeGovernedDuckDbQuery(
        { agent_id: "sql", task_id: "task-f117" },
        {
          target_database: "knowledge",
          query: "SELECT id, name FROM knowledge WHERE category = :category",
          parameters: [{ name: "category", type: "string", value: "silver" }],
        },
      );
      assert.equal(result.provider, "duckdb");
      assert.equal(result.execution_state, "FIXTURE_CONTRACT_EXECUTED");
      assert.equal(result.row_count, 2);
      assert.deepEqual(result.columns, ["id", "name"]);
    },
  );

  test("F-117: a bound value cannot terminate its own literal", () => {
    assert.equal(
      bindParameters("SELECT 1 WHERE name = :v", [
        { name: "v", type: "string", value: "O'Brien" },
      ]),
      "SELECT 1 WHERE name = 'O''Brien'",
    );
    assert.equal(
      bindParameters("SELECT 1 WHERE n = :n", [
        { name: "n", type: "integer", value: 42 },
      ]),
      "SELECT 1 WHERE n = 42",
    );
    assert.equal(
      bindParameters("SELECT 1 WHERE b = :b", [
        { name: "b", type: "null", value: null },
      ]),
      "SELECT 1 WHERE b = NULL",
    );
    assert.equal(
      bindParameters("SELECT 1 WHERE b = :b", [
        { name: "b", type: "boolean", value: true },
      ]),
      "SELECT 1 WHERE b = TRUE",
    );
  });

  test("F-117: a placeholder spelling inside a string literal is data", () => {
    assert.equal(
      bindParameters(
        "SELECT ':category' AS literal_label, id FROM knowledge WHERE category = :category",
        [{ name: "category", type: "string", value: "silver" }],
      ),
      "SELECT ':category' AS literal_label, id FROM knowledge WHERE category = 'silver'",
    );
  });
});
// ===========================================================================
// F-186 (R5-E06-06) - a bounded result must say what bound it hit.
// ===========================================================================
describe("F-186 (R5-E06-06) - a bounded result must say what bound it hit", () => {
  const f186Context = { agent_id: "sql", task_id: "task-f186" };

  // Measured at HEAD: the bridge passed no maxBuffer, so the bound on the
  // engine's stdout was Node's 1 MiB default and a wide result surfaced as
  // spawnSync's ENOBUFS, which the generic branch reported as
  // DUCKDB_EXECUTION_ERROR - the engine blamed for a plumbing limit. The
  // ceiling is now an explicit repo-owned value above that default.
  test("F-186: the engine stdio ceiling is repo-owned, not Node's default", () => {
    assert.ok(
      DUCKDB_MAX_STDIO_BYTES > 1024 * 1024,
      "the engine stdio bound must be an explicit choice, not Node's 1 MiB default",
    );
  });

  test(
    "F-186: exceeding the stdio ceiling is not blamed on the engine",
    { skip: duckDbSkip() },
    async () => {
      const err = await executeGovernedDuckDbQuery(
        f186Context,
        {
          query: "SELECT id, name FROM knowledge",
          target_database: "knowledge",
        },
        { maxBuffer: 16 },
      ).then(
        () => null,
        (error) => error,
      );
      assert.equal(
        err?.code,
        "DUCKDB_RESULT_TOO_LARGE",
        "a stdio-buffer overrun is a plumbing limit, not an engine failure",
      );
    },
  );

  // Measured at HEAD: `parsedRows.slice(0, maxRows)` returned the first
  // max_rows rows with `row_count` equal to the page, so the caller could not
  // tell "2 rows total" from "1 of 2 shown" and the model asserted the page was
  // the table.
  test(
    "F-186: rows above max_rows are reported, not silently sliced away",
    { skip: duckDbSkip() },
    async () => {
      const err = await executeGovernedDuckDbQuery(f186Context, {
        query: "SELECT id, name FROM knowledge",
        target_database: "knowledge",
        max_rows: 1,
      }).then(
        () => null,
        (error) => error,
      );
      assert.equal(err?.code, "DUCKDB_RESULT_LIMIT_EXCEEDED");
      assert.match(err.message, /2 rows/u);
      assert.match(err.message, /max_rows 1/u);
    },
  );

  // The ceiling may not become an over-rejection: a result inside max_rows is
  // still returned whole, with row_count equal to the rows actually returned.
  test(
    "F-186: a result inside the ceiling is returned whole",
    { skip: duckDbSkip() },
    async () => {
      const res = await executeGovernedDuckDbQuery(f186Context, {
        query: "SELECT id, name FROM knowledge",
        target_database: "knowledge",
        max_rows: 2,
      });
      assert.equal(res.row_count, 2);
      assert.equal(res.rows.length, 2);
    },
  );
});
// ===========================================================================
// F-204 (R1-A10-07) - the shapes the zink-tools lint/format gap hid.
// ===========================================================================
describe("F-204 (R1-A10-07) - the shapes the zink-tools lint gap hid", () => {
  const f204Fixture = async () => {
    const skillsRoot = await mkdtemp(path.join(os.tmpdir(), "f204-"));
    await promoteApprovedSkill({
      skillsRoot,
      namespace: ["automation"],
      capability: "data-clean",
      version: "1.0.0",
      content: "# AUTOMATION\nclean the table\n",
      decisionRef: "PLAN:M12/T9-R1",
    });
    return skillsRoot;
  };

  // Measured at HEAD: `apply` stamped `lifecycle_state: "active"` while
  // `discover` stamped "ACTIVE" and `read` refused anything that was not
  // "ACTIVE", so one store state carried two spellings depending on the action.
  test("F-204: one store state does not carry two lifecycle spellings", async () => {
    const skillsRoot = await f204Fixture();
    try {
      const adapter = new SkillAdapter(skillsRoot, { skillsRoot });
      const applied = await adapter.querySkillStore({
        action: "apply",
        skill_id: "automation/data-clean",
      });
      const read = await adapter.querySkillStore({
        action: "read",
        skill_id: "automation/data-clean",
      });
      assert.equal(read.skill_content.lifecycle_state, "ACTIVE");
      assert.equal(
        applied.skill_content.lifecycle_state,
        read.skill_content.lifecycle_state,
        "apply and read must spell the same store state identically",
      );
    } finally {
      await rm(skillsRoot, { recursive: true, force: true });
    }
  });

  // Measured at HEAD: the dispatch body ended in a second `Unsupported action`
  // throw that no input could reach - the pre-dispatch check already rejects
  // every action outside ALLOWED_ACTIONS - so the invalid-action rejection
  // looked like it lived where it could never fire.
  test("F-204: an invalid action has exactly one rejection point", async () => {
    const adapter = new SkillAdapter(undefined, { skillsRoot: os.tmpdir() });
    await assert.rejects(
      () => adapter.querySkillStore({ action: "not_an_action" }),
      (error) => error.code === "SKILL_ACTION_INVALID",
    );
    await assert.rejects(
      () => adapter.querySkillStore({ action: "publish" }),
      (error) => error.code === "SKILL_ACTION_FORBIDDEN",
    );
    const dispatch = fs
      .readFileSync(
        new URL(
          "../zink-tools/adapters/skill-store/skill-adapter.mjs",
          import.meta.url,
        ),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .split("\n")
      .map((line) => line.replace(/(^|\s)\/\/.*$/u, "$1"))
      .join("\n");
    assert.equal(
      (dispatch.match(/SKILL_ACTION_INVALID/gu) || []).length,
      1,
      "the pre-dispatch check must be the single invalid-action rejection",
    );
  });
});

// ===========================================================================
// F-280 (R7-C2-05) - the analytics adapters must enforce the same resource
// allowlist the shared SQL bridge enforces, and must never echo a resource
// identifier of their own invention.
// ===========================================================================
describe("F-280 (R7-C2-05) - analytics adapters and the resource allowlist", () => {
  const f280Context = { agent_id: "sql" };
  const contractEnum = JSON.parse(
    fs.readFileSync(
      new URL(
        "../zink-tools/contracts/tools/zink-sql.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).$defs.input.properties.target_database.enum;

  // Measured at HEAD: both adapters resolved with the caller's resource echoed
  // back even when the value was not a member of the published enum, so a
  // governed caller received a resource identifier no contract admits.
  test("F-280: an out-of-enum target database is refused with the shared code", async () => {
    await assert.rejects(
      () =>
        new BigQueryAdapter().executeQuery(f280Context, {
          query: "SELECT 1",
          target_database: "cloud_analytics_lake",
        }),
      { code: "DUCKDB_UNAUTHORIZED_RESOURCE" },
      "bigquery must raise the resource code the shared bridge raises",
    );
    await assert.rejects(
      () =>
        new MotherDuckAdapter().executeQuery(f280Context, {
          query: "SELECT id FROM knowledge",
          target_database: "gold",
        }),
      { code: "DUCKDB_UNAUTHORIZED_RESOURCE" },
      "motherduck must raise the resource code the shared bridge raises",
    );
  });

  // Measured at HEAD: an absent target_database produced a success envelope
  // naming a dataset the contract does not enumerate, because each adapter
  // substituted a fallback of its own. The input contract requires the field,
  // so an absent resource is refused and no fallback can reach a result.
  test("F-280: no adapter substitutes an invented resource for an absent one", async () => {
    await assert.rejects(
      () =>
        new BigQueryAdapter().executeQuery(f280Context, { query: "SELECT 1" }),
      { code: "DUCKDB_UNAUTHORIZED_RESOURCE" },
    );
    await assert.rejects(
      () =>
        new MotherDuckAdapter().executeQuery(f280Context, {
          query: "SELECT id FROM knowledge",
        }),
      { code: "DUCKDB_UNAUTHORIZED_RESOURCE" },
    );
    // An empty resource is refused as well: the value each adapter used to
    // substitute is gone, so nothing stands in for a resource the caller did
    // not name.
    await assert.rejects(
      () =>
        new BigQueryAdapter().executeQuery(f280Context, {
          query: "SELECT 1",
          target_database: "",
        }),
      { code: "DUCKDB_UNAUTHORIZED_RESOURCE" },
    );
    await assert.rejects(
      () =>
        new MotherDuckAdapter().executeQuery(f280Context, {
          query: "SELECT id FROM knowledge",
          target_database: "",
        }),
      { code: "DUCKDB_UNAUTHORIZED_RESOURCE" },
    );
  });

  // Anti-over-rejection control: an allowlisted resource is still served, is
  // echoed verbatim, and the adapter allowlist equals the contract enum.
  test("F-280: an allowlisted resource is served and stays inside the enum", async () => {
    assert.deepEqual([...ALLOWLISTED_DATABASES], contractEnum);
    const bigquery = await new BigQueryAdapter().executeQuery(f280Context, {
      query: "SELECT 1",
      target_database: "analytics_read",
    });
    assert.equal(bigquery.dataset, "analytics_read");
    assert.ok(contractEnum.includes(bigquery.dataset));
    const motherduck = await new MotherDuckAdapter().executeQuery(f280Context, {
      query: "SELECT id FROM knowledge",
      target_database: "knowledge",
    });
    assert.equal(motherduck.target_database, "knowledge");
    assert.ok(contractEnum.includes(motherduck.target_database));
  });
});

// ===========================================================================
// F-281 (R7-C2-06) - a declared ceiling must bind a real bounding site.
// ===========================================================================
describe("F-281 (R7-C2-06) - declared ceilings bind a bounding site", () => {
  const f281Context = { agent_id: "sql" };
  const contractMaxRows = JSON.parse(
    fs.readFileSync(
      new URL(
        "../zink-tools/contracts/tools/zink-sql.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).$defs.input.properties.max_rows.maximum;

  // Measured at HEAD: max_rows of -3 computed a negative bound, sliced every
  // canned row away and still returned a success envelope with row_count 0,
  // while the sibling bridge clamps the same input to its floor of one row.
  test("F-281: a non-positive row limit is clamped to the sibling's floor", async () => {
    const bigquery = await new BigQueryAdapter().executeQuery(f281Context, {
      query: "SELECT 1",
      target_database: "analytics_read",
      max_rows: -3,
    });
    assert.equal(bigquery.row_count, 1);
    assert.equal(bigquery.rows.length, 1);
    const motherduck = await new MotherDuckAdapter().executeQuery(f281Context, {
      query: "SELECT id FROM knowledge",
      target_database: "knowledge",
      max_rows: -3,
    });
    assert.equal(motherduck.row_count, 1);
    assert.equal(motherduck.rows.length, 1);
  });

  // Anti-over-rejection control: the declared row ceilings are the contract's
  // maximum, and an oversized request is still served inside them.
  test("F-281: an oversized row limit is still served inside the declared ceiling", async () => {
    assert.equal(BIGQUERY_MAX_ROWS, contractMaxRows);
    assert.equal(MOTHERDUCK_MAX_ROWS, contractMaxRows);
    const bigquery = await new BigQueryAdapter().executeQuery(f281Context, {
      query: "SELECT 1",
      target_database: "analytics_read",
      max_rows: BIGQUERY_MAX_ROWS * 5,
    });
    assert.ok(bigquery.row_count <= BIGQUERY_MAX_ROWS);
    assert.equal(bigquery.row_count, bigquery.rows.length);
    const motherduck = await new MotherDuckAdapter().executeQuery(f281Context, {
      query: "SELECT id FROM knowledge",
      target_database: "knowledge",
      max_rows: MOTHERDUCK_MAX_ROWS * 5,
    });
    assert.ok(motherduck.row_count <= MOTHERDUCK_MAX_ROWS);
    assert.equal(motherduck.row_count, motherduck.rows.length);
  });

  // Measured at HEAD: MOTHERDUCK_MAX_TIMEOUT_MS was exported and consulted
  // nowhere, and the timeout message echoed whatever the caller passed, so the
  // caller's own option reached the error surface as if it were the bound.
  test("F-281: the declared timeout ceilings bound the effective timeout", async () => {
    assert.equal(MOTHERDUCK_MAX_TIMEOUT_MS, 60000);
    await assert.rejects(
      () =>
        new MotherDuckAdapter().executeQuery(
          f281Context,
          { query: "SELECT id FROM knowledge", target_database: "knowledge" },
          { simulateTimeout: true, timeoutMs: 10_000_000 },
        ),
      (error) =>
        error.code === "MOTHERDUCK_TIMEOUT" &&
        error.message.includes(`${MOTHERDUCK_MAX_TIMEOUT_MS}ms`),
    );
    await assert.rejects(
      () =>
        new BigQueryAdapter().executeQuery(
          f281Context,
          { query: "SELECT 1", target_database: "analytics_read" },
          { simulateTimeout: true, timeoutMs: 10_000_000 },
        ),
      (error) =>
        error.code === "BIGQUERY_TIMEOUT" &&
        error.message.includes(`${DUCKDB_MAX_TIMEOUT_MS}ms`),
    );
    // Controls: an in-range value is not clamped away, and the declared default
    // still applies when the caller names no timeout.
    await assert.rejects(
      () =>
        new MotherDuckAdapter().executeQuery(
          f281Context,
          { query: "SELECT id FROM knowledge", target_database: "knowledge" },
          { simulateTimeout: true, timeoutMs: 2500 },
        ),
      (error) =>
        error.code === "MOTHERDUCK_TIMEOUT" && error.message.includes("2500ms"),
    );
    await assert.rejects(
      () =>
        new MotherDuckAdapter().executeQuery(
          f281Context,
          { query: "SELECT id FROM knowledge", target_database: "knowledge" },
          { simulateTimeout: true },
        ),
      (error) =>
        error.code === "MOTHERDUCK_TIMEOUT" &&
        error.message.includes(`${MOTHERDUCK_DEFAULT_TIMEOUT_MS}ms`),
    );
    await assert.rejects(
      () =>
        new BigQueryAdapter().executeQuery(
          f281Context,
          { query: "SELECT 1", target_database: "analytics_read" },
          { simulateTimeout: true },
        ),
      (error) =>
        error.code === "BIGQUERY_TIMEOUT" &&
        error.message.includes(`${BIGQUERY_DEFAULT_TIMEOUT_MS}ms`),
    );
  });
});
