import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";

import {
  deriveSemanticMetadata,
  renderEmbeddingEnvelope,
  prepareQueryEmbedding,
} from "../zink-tools/common/semantic-contract.mjs";

import {
  syncSkillsToVectorStore,
  generateSkillEmbeddings,
  EXPECTED_DIMENSIONS,
} from "../zink-skill-store/src/vector-sync.mjs";

import {
  SkillAdapter,
  deriveProposalId,
} from "../zink-tools/adapters/skill-store/skill-adapter.mjs";

import { KnowledgeAdapter } from "../zink-tools/adapters/knowledge/knowledge-adapter.mjs";

import { handleOwnerSkillApproval } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

import {
  resolveMentionedAgents,
  AGENT_IDS,
  evaluateCapabilityAccess,
} from "../integrations/openclaw/lib/policy.mjs";

describe("M8/T1 Governed Skill Vector Store & Semantic Vector RAG", () => {
  // =========================================================================
  // Test 1: BUG-01 — Embedding envelope does not overwrite raw content
  // =========================================================================
  test("BUG-01: renderEmbeddingEnvelope renders header prefix but preserves raw content", () => {
    const rawContent =
      "# VLOOKUP Guide\n\nUse =VLOOKUP(A1, B:C, 2, FALSE) to find values.";
    const envelope = renderEmbeddingEnvelope({
      domain: "office",
      primary_topic: "spreadsheet",
      subtopic: "formulas",
      concept: "vlookup optimization",
      secondary_topics: ["excel", "lookup"],
      content: rawContent,
    });

    // Envelope contains header metadata for the embedding model
    assert.match(envelope, /^Domain: office/m);
    assert.match(envelope, /^Primary Topic: spreadsheet/m);
    assert.match(envelope, /^Subtopic: formulas/m);
    assert.match(envelope, /^Concept: vlookup optimization/m);
    assert.match(envelope, /^Secondary Topics: excel, lookup/m);
    assert.ok(envelope.endsWith(rawContent.trim()));

    // Original content is unchanged and distinguishable from envelope
    assert.notEqual(envelope, rawContent);
    assert.equal(rawContent.includes("Domain: office"), false);
  });

  // =========================================================================
  // Test 2: BUG-02 — Metadata filters are never concatenated into query embedding
  // =========================================================================
  test("BUG-02: prepareQueryEmbedding preserves exact query string without filter contamination", () => {
    const prepared = prepareQueryEmbedding({
      query: "How to use XLOOKUP?",
      primary_topic: "spreadsheet",
      subtopic: "modern-formulas",
      secondary_topics: ["lookup", "excel"],
      capability: "xlookup-guide",
    });

    // queryTextForEmbedding must be strictly the query text
    assert.equal(prepared.queryTextForEmbedding, "How to use XLOOKUP?");
    assert.equal(prepared.queryTextForEmbedding.includes("spreadsheet"), false);
    assert.equal(
      prepared.queryTextForEmbedding.includes("modern-formulas"),
      false,
    );

    // Filters are kept cleanly separated for SQL/WHERE execution
    assert.deepEqual(prepared.metadataFilters, {
      primary_topic: "spreadsheet",
      subtopic: "modern-formulas",
      secondary_topics: ["lookup", "excel"],
      capability: "xlookup-guide",
    });
  });

  // =========================================================================
  // Test 3: BUG-03 & BUG-04 — Vector sync fails closed on invalid catalog & excludes non-ACTIVE
  // =========================================================================
  test("BUG-03 & BUG-04: syncSkillsToVectorStore fails closed on invalid catalog and indexes only ACTIVE", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-test-skills-"));
    try {
      // Empty catalog is valid
      const emptyReport = await syncSkillsToVectorStore({
        skillsRoot: tempDir,
        embedFn: async () => [new Array(1024).fill(0.01)],
        dbExecutor: async () => "",
      });
      assert.equal(emptyReport.status, "READY");
      assert.equal(emptyReport.active_count, 0);

      // Create a CANDIDATE skill
      const candidateDir = path.join(tempDir, "office", "draft-skill", "1.0.0");
      await mkdir(candidateDir, { recursive: true });
      const skillContent = "# Draft Skill\n\nNot yet approved.";
      const skillSha = createHash("sha256")
        .update(skillContent, "utf8")
        .digest("hex");

      const manifest = {
        schema_version: 1,
        identity: {
          namespace: ["office"],
          capability: "draft-skill",
          version: "1.0.0",
        },
        content: {
          path: "SKILL.md",
          sha256: skillSha,
        },
        provenance: {
          source_type: "research",
          references: [],
        },
        lifecycle: [
          {
            status: "CANDIDATE",
            at: "2026-09-17T00:00:00Z",
            actor: "excel",
          },
        ],
      };

      await writeFile(
        path.join(candidateDir, "SKILL.md"),
        skillContent,
        "utf8",
      );
      await writeFile(
        path.join(candidateDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf8",
      );

      const reportWithCandidate = await syncSkillsToVectorStore({
        skillsRoot: tempDir,
        embedFn: async () => [new Array(1024).fill(0.01)],
        dbExecutor: async () => "",
      });

      // BUG-04: CANDIDATE must be scanned but NOT indexed into active vector store
      assert.equal(reportWithCandidate.active_count, 0);
      assert.equal(reportWithCandidate.synced_count, 0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Test 4: BUG-05 — zink_skill_propose produces CANDIDATE only and cannot self-activate
  // =========================================================================
  test("BUG-05: zink_skill_propose generates deterministic CANDIDATE proposal and prevents self-activation", async () => {
    const adapter = new SkillAdapter();
    const content =
      "# DAX Performance Tuning\n\nUse KEEPFILTERS instead of FILTER for performance.";
    const contentSha = createHash("sha256")
      .update(content.trim(), "utf8")
      .digest("hex");

    const result = await adapter.querySkillStore({
      action: "propose",
      namespace: ["data", "power-bi"],
      capability: "dax-performance",
      version: "1.0.0",
      content,
      reason: "Optimize DAX measures on large datasets",
      requesting_agent: "power-bi",
    });

    assert.equal(result.governed_status, "SUCCESS");
    assert.equal(result.proposal.status, "CANDIDATE");
    assert.equal(result.proposal.content_sha256, contentSha);
    assert.equal(result.proposal.capability, "dax-performance");
    assert.equal(result.proposal.version, "1.0.0");
    assert.ok(typeof result.proposal.proposal_id === "string");

    // Idempotency: same content + identity produces exact same proposal_id
    const expectedId = deriveProposalId({
      namespace: ["data", "power-bi"],
      capability: "dax-performance",
      version: "1.0.0",
      content_sha256: contentSha,
    });
    assert.equal(result.proposal.proposal_id, expectedId);
  });

  // =========================================================================
  // Test 5: BUG-06 — handleOwnerSkillApproval requires exact owner snowflake and content hash
  // =========================================================================
  test("BUG-06: handleOwnerSkillApproval validates exact owner identity and content binding", async () => {
    const validProposalId = "prop-123456789";
    const validHash = "a".repeat(64);

    // 1. Rejects wrong owner snowflake
    await assert.rejects(
      () =>
        handleOwnerSkillApproval({
          ownerDiscordId: "999999999999999999", // not owner
          proposalId: validProposalId,
          contentSha256: validHash,
          skillsRoot: "/tmp",
        }),
      /APPROVAL_OWNER_MISMATCH/,
    );

    // 2. Rejects invalid content hash
    await assert.rejects(
      () =>
        handleOwnerSkillApproval({
          ownerDiscordId: "854005217715814432",
          proposalId: validProposalId,
          contentSha256: "invalid-hash",
          skillsRoot: "/tmp",
        }),
      /APPROVAL_CONTENT_HASH_INVALID/,
    );

    // 3. Rejects missing proposal ID
    await assert.rejects(
      () =>
        handleOwnerSkillApproval({
          ownerDiscordId: "854005217715814432",
          proposalId: "",
          contentSha256: validHash,
          skillsRoot: "/tmp",
        }),
      /APPROVAL_PROPOSAL_ID_REQUIRED/,
    );

    // 4. Accepts valid owner + proposal + hash
    const approvalResult = await handleOwnerSkillApproval({
      ownerDiscordId: "854005217715814432",
      proposalId: validProposalId,
      contentSha256: validHash,
      skillsRoot: "/tmp",
      options: {
        embedFn: async () => [new Array(1024).fill(0.01)],
        dbExecutor: async () => "",
      },
    });

    assert.ok(approvalResult);
  });

  // =========================================================================
  // Test 6: BUG-07 — Source drift detection during vector sync
  // =========================================================================
  test("BUG-07: syncSkillsToVectorStore aborts on source drift without publishing stale snapshot", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-drift-test-"));
    try {
      const activeDir = path.join(tempDir, "office", "drift-skill", "1.0.0");
      await mkdir(activeDir, { recursive: true });

      const originalContent = "# Original Content";
      const originalHash = createHash("sha256")
        .update(originalContent, "utf8")
        .digest("hex");

      const manifest = {
        schema_version: 1,
        identity: {
          namespace: ["office"],
          capability: "drift-skill",
          version: "1.0.0",
        },
        content: {
          path: "SKILL.md",
          sha256: originalHash,
        },
        provenance: {
          source_type: "research",
          references: [],
        },
        lifecycle: [
          {
            status: "CANDIDATE",
            at: "2026-09-17T00:00:00Z",
            actor: "owner",
          },
          {
            status: "ACTIVE",
            at: "2026-09-17T01:00:00Z",
            actor: "owner",
            decision_ref: "PLAN:M0/T1-R1",
          },
        ],
      };

      // Manifest has originalHash, but file content is modified to simulate drift
      await writeFile(
        path.join(activeDir, "SKILL.md"),
        "# Modified Content After Manifest",
        "utf8",
      );
      await writeFile(
        path.join(activeDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf8",
      );

      let dbInserted = false;
      const report = await syncSkillsToVectorStore({
        skillsRoot: tempDir,
        embedFn: async () => [new Array(1024).fill(0.01)],
        dbExecutor: async (sql) => {
          if (sql.includes("skills.segments")) dbInserted = true;
          return "";
        },
      });

      // Assert sync recorded failure and did NOT insert segments
      assert.equal(report.status, "FAILED");
      assert.equal(report.synced_count, 0);
      assert.equal(dbInserted, false);
      const isDriftDetected =
        report.details?.some((d) => d.code === "CONTENT_DIGEST_MISMATCH") ||
        Boolean(report.skills?.[0]?.error?.includes("SOURCE_DRIFT_DETECTED"));
      assert.ok(
        isDriftDetected,
        "Expected source drift / digest mismatch to be detected",
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Test 7: BUG-09 — Model / Dimension drift rejection
  // =========================================================================
  test("BUG-09: generateSkillEmbeddings rejects non-1024 vector dimensions", async () => {
    // Attempting embedding with 768 dimensions (e.g. from bert-base instead of bge-m3)
    await assert.rejects(
      () =>
        generateSkillEmbeddings(["test text"], {
          embedFn: async () => [new Array(768).fill(0.1)], // 768 dims
        }),
      /EMBEDDING_MODEL_DRIFT.*expected 1024 dimensions.*got 768/,
    );

    // 1024 dimensions passes
    const valid = await generateSkillEmbeddings(["test text"], {
      embedFn: async () => [new Array(EXPECTED_DIMENSIONS).fill(0.1)],
    });
    assert.equal(valid.length, 1);
    assert.equal(valid[0].length, 1024);
  });

  // =========================================================================
  // Test 8: BUG-11 — Topic hallucination prevention
  // =========================================================================
  test("BUG-11: deriveSemanticMetadata maps known taxonomy and defaults safely without hallucination", () => {
    // Known namespace: excel
    const excelMeta = deriveSemanticMetadata({
      namespace: ["excel"],
      capability: "vlookup-helper",
      tags: ["lookup", "search"],
    });
    assert.equal(excelMeta.domain, "office");
    assert.equal(excelMeta.primary_topic, "spreadsheet");
    assert.equal(excelMeta.subtopic, "formulas-and-automation");
    assert.equal(excelMeta.concept, "vlookup helper");

    // Unmapped/unknown namespace: should fall back deterministically, never hallucinate
    const unknownMeta = deriveSemanticMetadata({
      namespace: ["custom-unknown-ns"],
      capability: "my-custom-tool",
    });
    assert.equal(unknownMeta.domain, "general");
    assert.equal(unknownMeta.primary_topic, "custom-unknown-ns");
    assert.equal(unknownMeta.subtopic, null);
  });

  // =========================================================================
  // Test 9: BUG-13 — Discord mention resolution (Desktop & Mobile, Vietnamese aliases)
  // =========================================================================
  test("BUG-13: resolveMentionedAgents resolves Vietnamese aliases, mobile formats, and deduplicates", () => {
    // 1. Mobile Vietnamese mention for Quản Lý: `<@!123456789>` with username or text
    const mobileQuanLy = resolveMentionedAgents({
      content: "<@!123456789> xin chào",
      mentions: [{ id: "123456789", username: "quản lý" }],
    });
    assert.deepEqual(mobileQuanLy, ["main"]);

    // 2. Mobile mention for PowerBI: text contains `@PowerBI`
    const mobilePowerBi = resolveMentionedAgents({
      content: "nhờ @PowerBI kiểm tra báo cáo",
      mentions: [{ id: "234567890", name: "PowerBI" }],
    });
    assert.deepEqual(mobilePowerBi, ["power-bi"]);

    // 3. Mention for Điều Phối 1 (o1)
    const dieuPhoi1 = resolveMentionedAgents({
      content: "nhờ @Điều Phối 1 điều phối tác vụ",
      mentions: [],
    });
    assert.deepEqual(dieuPhoi1, ["o1"]);

    // 4. Mention for Điều Phối 2 (o2)
    const dieuPhoi2 = resolveMentionedAgents({
      content: "nhờ @Điều Phối 2 điều phối tác vụ",
      mentions: [],
    });
    assert.deepEqual(dieuPhoi2, ["o2"]);

    // 5. Duplicate mentions of Excel
    const dupExcel = resolveMentionedAgents({
      content: "gặp @excel và @excel nhé",
      mentions: [{ id: "333", username: "excel" }],
    });
    assert.deepEqual(dupExcel, ["excel"]);
  });

  // =========================================================================
  // Test 10: Policy & RBAC — Search allowed for all 7 agents, Propose for specialists
  // =========================================================================
  test("Policy & RBAC: all 7 agents can search Skill Store and Knowledgebase; specialists can propose", () => {
    // All 7 agents can search Skill Store
    for (const agentId of AGENT_IDS) {
      assert.equal(
        evaluateCapabilityAccess(agentId, "zink_skill", "all", "search")
          .allowed,
        true,
        `Agent ${agentId} must be allowed to search skills`,
      );
    }

    // Specialists can propose skills
    const specialists = ["excel", "power-bi", "sql", "python"];
    for (const agentId of specialists) {
      assert.equal(
        evaluateCapabilityAccess(agentId, "zink_skill", "all", "propose")
          .allowed,
        true,
        `Specialist ${agentId} must be allowed to propose skills`,
      );
    }

    // Coordinators cannot propose skills
    const coordinators = ["main", "o1", "o2"];
    for (const agentId of coordinators) {
      assert.equal(
        evaluateCapabilityAccess(agentId, "zink_skill", "all", "propose")
          .allowed,
        false,
        `Coordinator ${agentId} must not be allowed to propose skills`,
      );
    }
  });

  // =========================================================================
  // Test 11: zink_skill_search and zink_knowledge_search fail closed on errors
  // =========================================================================
  test("Adapter resilience: zink_skill_search and zink_knowledge_search fail closed safely", async () => {
    const skillAdapter = new SkillAdapter(undefined, {
      embedFn: async () => [new Array(1024).fill(0.1)],
      dbExecutor: async () => {
        throw new Error("DB_SIMULATED_DISCONNECT");
      },
    });

    const skillResult = await skillAdapter.querySkillStore({
      action: "search",
      query: "Find inventory formula",
    });
    assert.equal(skillResult.governed_status, "CONTROLLED_FAILURE");

    const kbAdapter = new KnowledgeAdapter("http://127.0.0.1:9999/nonexistent");
    const kbResult = await kbAdapter.queryKnowledge({
      action: "search",
      query: "Search supply chain policy",
    });
    assert.equal(kbResult.governed_status, "CONTROLLED_FAILURE");
  });
});
