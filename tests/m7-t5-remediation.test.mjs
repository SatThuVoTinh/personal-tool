import test, { describe } from "node:test";
import assert from "node:assert/strict";

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
} from "../zink-tools/adapters/knowledge/knowledge-adapter.mjs";

import {
  executeGovernedSkillQuery,
  SkillAdapter,
} from "../zink-tools/adapters/skill-store/skill-adapter.mjs";

import { validateArtifactLogicalPath } from "../zink-tools/common/path-safety.mjs";

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
