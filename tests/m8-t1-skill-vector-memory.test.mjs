import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  readdir,
} from "node:fs/promises";
import os from "node:os";

import {
  deriveSemanticMetadata,
  renderEmbeddingEnvelope,
  prepareQueryEmbedding,
  CANONICAL_DOMAINS,
  KNOWN_TAXONOMY_MAP,
  NAMESPACE_ALIAS_MAP,
  SEMANTIC_CONTRACT_VERSION,
} from "../zink-tools/common/semantic-contract.mjs";

import {
  syncSkillsToVectorStore,
  generateSkillEmbeddings,
  validateOllamaUrl,
  EXPECTED_DIMENSIONS,
} from "../zink-skill-store/src/vector-sync.mjs";

import {
  SkillAdapter,
  deriveProposalId,
} from "../zink-tools/adapters/skill-store/skill-adapter.mjs";

import { KnowledgeAdapter } from "../zink-tools/adapters/knowledge/knowledge-adapter.mjs";

import {
  handleOwnerSkillApproval,
  registerTools,
  getPendingSkillProposal,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";

import {
  formatForDiscord,
  formatGovernedEnvelope,
  formatApprovalNotification,
  formatResultNotification,
  formatIncidentNotification,
} from "../integrations/openclaw/lib/discord-formatter.mjs";

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
  // M12/T2.2-R3 R3-9 — the envelope may not invent the taxonomy it advertises.
  // =========================================================================
  test("R3-9: an envelope without taxonomy raises; a correct one keeps its exact bytes", () => {
    const rawContent = "# VLOOKUP Guide\n\nUse =VLOOKUP(A1, B:C, 2, FALSE).";
    const full = {
      domain: "office",
      primary_topic: "spreadsheet",
      subtopic: "formulas",
      concept: "vlookup optimization",
      secondary_topics: ["excel", "lookup"],
      content: rawContent,
    };
    // The header bytes are pinned in full: any change here would roll
    // embedding_input_sha256 for every stored segment and demand a
    // SEMANTIC_CONTRACT_VERSION bump, which this band does not authorize.
    assert.equal(
      renderEmbeddingEnvelope(full),
      [
        `Semantic-Contract: ${SEMANTIC_CONTRACT_VERSION}`,
        "Domain: office",
        "Primary Topic: spreadsheet",
        "Subtopic: formulas",
        "Concept: vlookup optimization",
        "Secondary Topics: excel, lookup",
        "",
        rawContent.trim(),
      ].join("\n"),
    );

    for (const [label, params] of [
      ["no taxonomy at all", { skillId: "office/s", content: "body" }],
      ["domain only", { domain: "office", content: "body" }],
      ["primary_topic only", { primary_topic: "spreadsheet", content: "body" }],
      [
        "whitespace taxonomy",
        { domain: "   ", primary_topic: "", content: "body" },
      ],
    ]) {
      assert.throws(
        () => renderEmbeddingEnvelope(params),
        /EMBEDDING_ENVELOPE_METADATA_REQUIRED/u,
        `${label}: must raise rather than render a taxonomy nobody resolved`,
      );
    }

    // A non-string body used to die as a bare TypeError inside `.trim()`.
    assert.ok(
      renderEmbeddingEnvelope({ ...full, content: 12345 }).endsWith("12345"),
      "content is coerced, not defaulted and not thrown on",
    );
    assert.doesNotThrow(() => renderEmbeddingEnvelope({ ...full }));
  });

  // =========================================================================
  // Test 2: BUG-02 — Metadata filters are never concatenated into query embedding
  // =========================================================================
  test("BUG-02: prepareQueryEmbedding preserves exact query string without filter contamination", () => {
    // F-008 (R1-A10-06): `secondary_topics` is no longer one of the
    // accepted filters - it is refused by name, because the column it
    // compared against is always empty, so it could only remove rows. The
    // refusal is pinned by the F-008 case below; what this case pins is that
    // no accepted filter leaks into the query text.
    const prepared = prepareQueryEmbedding({
      query: "How to use XLOOKUP?",
      primary_topic: "spreadsheet",
      subtopic: "modern-formulas",
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
    const proposalStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "zink-skill-proposals-"),
    );
    const adapter = new SkillAdapter(undefined, { proposalStorageDir });
    const content =
      "# DAX Performance Tuning\n\nUse KEEPFILTERS instead of FILTER for performance.";
    const contentSha = createHash("sha256")
      .update(content.trim(), "utf8")
      .digest("hex");

    const result = await adapter.querySkillStore({
      action: "propose",
      source_type: "execution",
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
    await rm(proposalStorageDir, { recursive: true, force: true });
  });

  // =========================================================================
  // Test 5: BUG-06 — handleOwnerSkillApproval requires exact owner snowflake and content hash
  // =========================================================================
  test("BUG-06: handleOwnerSkillApproval validates exact owner identity and content binding", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "zink-approval-test-"),
    );
    try {
      const validProposalId = "prop-123456789";
      // The expected principal is bound explicitly rather than defaulted by the
      // implementation. Production source must not carry any account identifier,
      // so the fixture supplies one here; `.gitleaks.toml` allows that in tests.
      const OWNER_SNOWFLAKE = "123456789012345678";
      const validHash = "a".repeat(64);

      // 1. Rejects wrong owner snowflake
      await assert.rejects(
        () =>
          handleOwnerSkillApproval({
            ownerDiscordId: "999999999999999999", // not owner
            proposalId: validProposalId,
            contentSha256: validHash,
            skillsRoot: tempDir,
          }),
        /APPROVAL_OWNER_MISMATCH/,
      );

      // 2. Rejects invalid content hash
      await assert.rejects(
        () =>
          handleOwnerSkillApproval({
            ownerDiscordId: OWNER_SNOWFLAKE,
            expectedOwnerId: OWNER_SNOWFLAKE,
            proposalId: validProposalId,
            contentSha256: "invalid-hash",
            skillsRoot: tempDir,
          }),
        /APPROVAL_CONTENT_HASH_INVALID/,
      );

      // 3. Rejects missing proposal ID
      await assert.rejects(
        () =>
          handleOwnerSkillApproval({
            ownerDiscordId: OWNER_SNOWFLAKE,
            expectedOwnerId: OWNER_SNOWFLAKE,
            proposalId: "",
            contentSha256: validHash,
            skillsRoot: tempDir,
          }),
        /APPROVAL_PROPOSAL_ID_REQUIRED/,
      );

      // 4. Fails closed when no durable proposal exists, even for a valid
      // owner and hash. An unknown proposal is never "probably okay".
      await assert.rejects(
        () =>
          handleOwnerSkillApproval({
            ownerDiscordId: OWNER_SNOWFLAKE,
            expectedOwnerId: OWNER_SNOWFLAKE,
            proposalId: validProposalId,
            contentSha256: validHash,
            decisionRef: "PLAN:M8/T1-R1",
            namespace: ["office"],
            capability: "ghost-skill",
            version: "1.0.0",
            skillsRoot: tempDir,
            proposalStorageDir: path.join(tempDir, "proposals"),
          }),
        /APPROVAL_UNKNOWN_PROPOSAL/,
      );

      // 5. Accepts a valid owner approval bound to the exact durable proposal
      // and materializes the canonical skill.
      const { SkillAdapter: ProposalAdapter } =
        await import("../zink-tools/adapters/skill-store/skill-adapter.mjs");
      const proposalDir = path.join(tempDir, "proposals");
      const proposing = new ProposalAdapter(undefined, {
        proposalStorageDir: proposalDir,
      });
      const content = "# Bug06 Skill\n\nGoverned content.";
      const proposed = await proposing.querySkillStore({
        action: "propose",
        source_type: "execution",
        namespace: ["office"],
        capability: "bug06-skill",
        version: "1.0.0",
        content,
        reason: "BUG-06 governed approval",
        requesting_agent: "excel",
      });
      const approvalResult = await handleOwnerSkillApproval({
        ownerDiscordId: OWNER_SNOWFLAKE,
        expectedOwnerId: OWNER_SNOWFLAKE,
        proposalId: proposed.proposal.proposal_id,
        contentSha256: proposed.proposal.content_sha256,
        decisionRef: "PLAN:M8/T1-R1",
        namespace: ["office"],
        capability: "bug06-skill",
        version: "1.0.0",
        skillsRoot: path.join(tempDir, "skills"),
        proposalStorageDir: proposalDir,
        options: {
          embedFn: async () => [new Array(1024).fill(0.01)],
          dbExecutor: async () => "",
        },
      });

      assert.ok(approvalResult);
      assert.equal(approvalResult.approval_status, "APPROVED");
      assert.equal(approvalResult.provenance.declared_source_type, "execution");
      assert.equal(approvalResult.provenance.approved_source_type, "execution");
      assert.equal(approvalResult.provenance.overridden, false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // F-OC-012 — provenance is declared at proposal time and never defaulted.
  // =========================================================================
  test("F-OC-012: a proposal without source_type is refused by name", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "foc012-missing-"));
    try {
      const adapter = new SkillAdapter(undefined, {
        proposalStorageDir: dir,
      });
      await assert.rejects(
        () =>
          adapter.querySkillStore({
            action: "propose",
            namespace: ["office"],
            capability: "missing-provenance",
            version: "1.0.0",
            content: "# Missing\n\nNo provenance.",
            reason: "F-OC-012 missing provenance",
          }),
        (error) => {
          assert.equal(error.code, "PROVENANCE_SOURCE_TYPE_INVALID");
          assert.match(error.message, /PROVENANCE_SOURCE_TYPE_INVALID/u);
          return true;
        },
      );
      assert.deepEqual(
        await readdir(dir),
        [],
        "a refused proposal writes no durable record",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("F-OC-012: an owner-attested source_type overrides the declaration and is recorded", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "foc012-override-"));
    const ownerDiscordId = "123456789012345678";
    try {
      const proposalDir = path.join(tempDir, "proposals");
      const proposing = new SkillAdapter(undefined, {
        proposalStorageDir: proposalDir,
      });
      const content = "# Override\n\nGoverned content.";
      const proposed = await proposing.querySkillStore({
        action: "propose",
        source_type: "demonstration",
        namespace: ["office"],
        capability: "override-skill",
        version: "1.0.0",
        content,
        reason: "F-OC-012 override",
      });
      const base = {
        ownerDiscordId,
        expectedOwnerId: ownerDiscordId,
        proposalId: proposed.proposal.proposal_id,
        contentSha256: proposed.proposal.content_sha256,
        decisionRef: "PLAN:M12/T9-R5",
        namespace: ["office"],
        capability: "override-skill",
        version: "1.0.0",
        skillsRoot: path.join(tempDir, "skills"),
        proposalStorageDir: proposalDir,
        options: {
          embedFn: async () => [new Array(1024).fill(0.01)],
          dbExecutor: async () => "",
        },
      };
      // An owner override outside the store's vocabulary is refused before
      // any durable attestation or canonical write exists.
      await assert.rejects(
        () => handleOwnerSkillApproval({ ...base, sourceType: "fabricated" }),
        /APPROVAL_SOURCE_TYPE_INVALID/u,
      );

      const approval = await handleOwnerSkillApproval({
        ...base,
        sourceType: "correction",
      });
      assert.equal(approval.provenance.declared_source_type, "demonstration");
      assert.equal(approval.provenance.approved_source_type, "correction");
      assert.equal(approval.provenance.attested_by, "owner-at-approval");
      assert.equal(approval.provenance.overridden, true);

      const manifest = JSON.parse(
        await readFile(
          path.join(
            tempDir,
            "skills",
            "office",
            "override-skill",
            "1.0.0",
            "manifest.json",
          ),
          "utf8",
        ),
      );
      assert.equal(manifest.provenance.source_type, "correction");

      const durable = JSON.parse(
        await readFile(
          path.join(proposalDir, `${proposed.proposal.proposal_id}.json`),
          "utf8",
        ),
      );
      assert.equal(durable.source_type, "correction");
      assert.equal(durable.source_type_attested_by, "owner-at-approval");

      // A replay that attests a different provenance is a different approval,
      // not an idempotent success.
      await assert.rejects(
        () => handleOwnerSkillApproval({ ...base, sourceType: "execution" }),
        /APPROVAL_PROPOSAL_MISMATCH/u,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("F-OC-012: a legacy proposal without source_type needs an explicit owner attestation", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "foc012-legacy-"));
    const ownerDiscordId = "123456789012345678";
    try {
      const proposalDir = path.join(tempDir, "proposals");
      await mkdir(proposalDir, { recursive: true });
      const content = "# Legacy\n\nNo provenance field.";
      const contentSha256 = createHash("sha256")
        .update(content, "utf8")
        .digest("hex");
      const proposalId = "a".repeat(32);
      await writeFile(
        path.join(proposalDir, `${proposalId}.json`),
        JSON.stringify({
          proposal_id: proposalId,
          namespace: ["office"],
          capability: "legacy-skill",
          version: "1.0.0",
          content_sha256: contentSha256,
          content,
          status: "CANDIDATE",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      );
      const base = {
        ownerDiscordId,
        expectedOwnerId: ownerDiscordId,
        proposalId,
        contentSha256,
        decisionRef: "PLAN:M12/T9-R5",
        namespace: ["office"],
        capability: "legacy-skill",
        version: "1.0.0",
        skillsRoot: path.join(tempDir, "skills"),
        proposalStorageDir: proposalDir,
      };
      await assert.rejects(
        () => handleOwnerSkillApproval({ ...base }),
        /APPROVAL_SOURCE_TYPE_REQUIRED/u,
      );
      const approved = await handleOwnerSkillApproval({
        ...base,
        sourceType: "research",
        options: {
          embedFn: async () => [new Array(1024).fill(0.01)],
          dbExecutor: async () => "",
        },
      });
      assert.equal(approved.provenance.declared_source_type, null);
      assert.equal(approved.provenance.approved_source_type, "research");
      assert.equal(approved.provenance.overridden, true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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
          // M12/T2.2-R3 R3-7 (owner grant `q1`, 2026-10-17): this probe reads
          // "no segment row was WRITTEN". The failure statement now deletes
          // segments, so a bare substring match on the table name would count
          // the cleanup as an insert and pass the very regression it guards.
          if (/INSERT INTO skills\.segments/u.test(sql)) dbInserted = true;
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
    assert.throws(() => validateOllamaUrl(""), /OLLAMA_URL_REQUIRED/u);
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

    // Unmapped/unknown namespace: per B05 fix, must NOT silently fall back to "general".
    // Unknown namespace is fail-closed → domain=AMBIGUOUS, primary_topic=AMBIGUOUS.
    const unknownMeta = deriveSemanticMetadata({
      namespace: ["custom-unknown-ns"],
      capability: "my-custom-tool",
    });
    assert.equal(unknownMeta.domain, "AMBIGUOUS");
    assert.equal(unknownMeta.primary_topic, "AMBIGUOUS");
    assert.equal(unknownMeta.subtopic, null);
    assert.equal(unknownMeta.ambiguous, true);
    assert.deepEqual(unknownMeta.unresolved_namespaces, ["custom-unknown-ns"]);
  });

  // =========================================================================
  // M12/T2.2-R3 R3-8 — an ABSENT namespace is not `general`.
  //
  // BUG-11 made an unresolvable namespace fail closed, but the clause that
  // decided it (`resolvedNamespaces.length === 0 && nsList.length > 0`) treated
  // "nothing supplied" as not-applicable, so the empty input resolved to
  // domain `general` — and `general` is inside CANONICAL_DOMAINS, which is the
  // exact test the consumers apply before accepting a proposal. Absence and
  // resolution therefore looked identical to every caller downstream.
  // =========================================================================
  test("R3-8: no absent or empty namespace yields a domain the consumer gate accepts", () => {
    for (const [label, input] of [
      ["omitted", { capability: "no-ns-skill" }],
      ["empty array", { namespace: [], capability: "no-ns-skill" }],
      ["explicit undefined", { namespace: undefined, capability: "s" }],
      ["non-array non-string", { namespace: 42, capability: "s" }],
    ]) {
      const meta = deriveSemanticMetadata(input);
      assert.equal(
        meta.ambiguous,
        true,
        `${label}: an absent namespace must be signalled as AMBIGUOUS`,
      );
      assert.equal(meta.domain, "AMBIGUOUS", `${label}: domain`);
      assert.equal(meta.primary_topic, "AMBIGUOUS", `${label}: primary_topic`);
      assert.ok(
        !CANONICAL_DOMAINS.includes(meta.domain),
        `${label}: domain '${meta.domain}' must not satisfy CANONICAL_DOMAINS, which is what the consumer gate checks`,
      );
    }

    // The resolved and the unresolvable cases keep their BUG-11 verdicts.
    assert.equal(
      deriveSemanticMetadata({ namespace: ["excel"], capability: "v" }).domain,
      "office",
    );
    assert.ok(
      CANONICAL_DOMAINS.includes("general"),
      "`general` stays a legitimate domain for a taxonomy that resolved to it — the defect was reaching it from absence",
    );
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

  // =========================================================================
  // Test 12: Unified message formatting for Approval, #results, and #incidents
  // =========================================================================
  test("Unified message formatting: Approval, Results, and Incidents share the same 5-part layout", () => {
    // 1. Approval Notification
    const approvalText = formatApprovalNotification(
      {
        proposal: {
          proposal_id: "prop-test-12345",
          namespace: ["data", "excel"],
          capability: "xlookup-fallback",
          version: "1.1.0",
          content_sha256: "b".repeat(64),
          requesting_agent: "excel",
          reason: "Hỗ trợ tra cứu nhiều nguồn với fallback an toàn",
          created_at: "2026-09-18T12:00:00Z",
        },
      },
      { agentName: "Excel Specialist" },
    );

    assert.match(approvalText, /^### 🔖 \[PHÊ DUYỆT\]/u);
    assert.match(approvalText, /> \*\*Mục đích:\*\* Phê duyệt/u);
    assert.match(approvalText, /#### 📋 Thông tin Chi tiết \(Details\)/u);
    assert.match(
      approvalText,
      /#### 📝 Nội dung Thực thi \/ Báo cáo \(Content & Deliverables\)/u,
    );
    assert.match(
      approvalText,
      /#### 📦 Tệp đính kèm & Tham chiếu \(Files & Artifacts\)/u,
    );
    assert.match(
      approvalText,
      /#### ⚖️ Đánh giá Tác động & Kiểm định \(Impact & Validation\)/u,
    );
    assert.match(
      approvalText,
      /#### 🔄 Hướng dẫn Xử lý & Phục hồi \(Action & Recovery\)/u,
    );
    assert.match(approvalText, /Duyệt đề xuất: prop-test-12345/u);

    // 2. Result Notification (#results)
    const resultText = formatResultNotification(
      {
        result_id: "res-test-67890",
        workflow_status: "COMPLETE",
        summary: "Hoàn tất phân tích tồn kho Q3",
        deliverables: [
          "Báo cáo tồn kho file:///Users/test/inventory.xlsx",
          "Biểu đồ dashboard.pbix",
        ],
        validation: "VALID",
      },
      { agentName: "PowerBI Specialist" },
    );

    assert.match(resultText, /^### 📋 \[KẾT QUẢ\]/u);
    assert.match(
      resultText,
      /> \*\*Mục đích:\*\* Báo cáo hoàn thành tác vụ phân tích & Bàn giao sản phẩm kết quả kèm file/u,
    );
    assert.match(resultText, /#### 📋 Thông tin Chi tiết \(Details\)/u);
    assert.match(
      resultText,
      /#### 📝 Nội dung Thực thi \/ Báo cáo \(Content & Deliverables\)/u,
    );
    assert.match(
      resultText,
      /#### 📦 Tệp đính kèm & Tham chiếu \(Files & Artifacts\)/u,
    );
    assert.match(
      resultText,
      /#### ⚖️ Đánh giá Tác động & Kiểm định \(Impact & Validation\)/u,
    );
    assert.match(
      resultText,
      /#### 🔄 Hướng dẫn Xử lý & Phục hồi \(Action & Recovery\)/u,
    );
    // Path must be redacted by sanitizeDiscordText
    assert.doesNotMatch(resultText, /file:\/\/\//u);

    // 3. Incident Notification (#incidents)
    const incidentText = formatIncidentNotification(
      {
        incident_id: "inc-test-99999",
        severity: "HIGH",
        category: "CONTRACT_VIOLATION",
        observed_state: "Truy vấn trả về lỗi cú pháp SQL",
        expected_state: "Kết quả truy vấn 100 dòng",
        impact: "Báo cáo bị tạm dừng",
        containment_status: "Đã ngắt kết nối",
        recovery_status: "Chờ khôi phục",
        owner_action_required: true,
      },
      { agentName: "SQL Specialist" },
    );

    assert.match(incidentText, /^### 🚨 \[SỰ CỐ\]/u);
    assert.match(incidentText, /> \*\*Mục đích:\*\* Thông báo sự cố kỹ thuật/u);
    assert.match(incidentText, /#### 📋 Thông tin Chi tiết \(Details\)/u);
    assert.match(
      incidentText,
      /#### 📝 Nội dung Thực thi \/ Báo cáo \(Content & Deliverables\)/u,
    );
    assert.match(
      incidentText,
      /#### 📦 Tệp đính kèm & Tham chiếu \(Files & Artifacts\)/u,
    );
    assert.match(
      incidentText,
      /#### ⚖️ Đánh giá Tác động & Kiểm định \(Impact & Validation\)/u,
    );
    assert.match(
      incidentText,
      /#### 🔄 Hướng dẫn Xử lý & Phục hồi \(Action & Recovery\)/u,
    );
    assert.match(incidentText, /Yêu cầu Owner can thiệp để mở khóa tác vụ/u);

    // 4. Direct formatGovernedEnvelope
    const directText = formatGovernedEnvelope({
      tag: "🔖 [PHÊ DUYỆT]",
      title: "Tác vụ kiểm tra",
      purpose: "Kiểm tra mẫu định dạng thống nhất",
      content: "Nội dung kiểm tra",
    });
    assert.match(directText, /### 🔖 \[PHÊ DUYỆT\] Tác vụ kiểm tra/u);

    // 5. Auto-detection in formatForDiscord
    const detectedApproval = formatForDiscord({
      action: "propose",
      proposal: {
        proposal_id: "prop-auto-detect",
        capability: "auto-detect-skill",
      },
    });
    assert.match(detectedApproval, /### 🔖 \[PHÊ DUYỆT\]/u);

    const detectedIncident = formatForDiscord({
      incident_id: "inc-auto-detect",
      severity: "CRITICAL",
      observed_state: "Kernel panic",
    });
    assert.match(detectedIncident, /### 🚨 \[SỰ CỐ\]/u);

    const detectedResult = formatForDiscord({
      result_id: "res-auto-detect",
      workflow_status: "COMPLETE",
      deliverables: ["Done deal"],
    });
    assert.match(detectedResult, /### 📋 \[KẾT QUẢ\]/u);
  });

  // =========================================================================
  // Test 13: zink_skill_propose connects to Approval Request
  // =========================================================================
  test("zink_skill_propose connects to Approval flow: registers pending proposal and returns Approval Request packet", async () => {
    let proposeTool = null;
    const proposalStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "zink-governance-proposals-"),
    );
    const mockHostApi = {
      pluginConfig: { ledgerRoot: proposalStorageDir },
      registerTool: (t) => {
        if (t.id === "zink_skill_propose") proposeTool = t;
      },
    };

    registerTools(mockHostApi);
    assert.ok(proposeTool, "zink_skill_propose tool must be registered");

    const content = "# Dynamic Array Filter\n\nFilter multi criteria in Excel.";
    // M7-049: tool calls carry the trusted caller identity in context.
    // zink_skill_propose authorizes specialist proposers.
    const proposeResult = await proposeTool.execute(
      { agent: "excel" },
      {
        namespace: "excel",
        capability: "filter-multi-criteria",
        version: "1.0.0",
        content,
        reason: "Optimize filtering on large dataset",
        source_type: "execution",
      },
    );

    assert.ok(proposeResult?.content?.[0]?.text);
    const parsedPacket = JSON.parse(proposeResult.content[0].text);

    assert.equal(parsedPacket.exact_operation, "SKILL_CANDIDATE_APPROVAL");
    assert.equal(
      parsedPacket.material_parameters.source_type,
      "execution",
      "the owner sees the declared provenance on the packet",
    );
    assert.equal(parsedPacket.proposal.source_type, "execution");
    assert.equal(
      parsedPacket.exact_target,
      "skills/excel/filter-multi-criteria@1.0.0",
    );
    assert.equal(parsedPacket.publication_status, "pending_owner_post");
    assert.equal(parsedPacket.proposal.status, "CANDIDATE");
    assert.ok(parsedPacket.approval_id);

    // Verify it is registered in pending proposals store
    const retrieved = getPendingSkillProposal(parsedPacket.approval_id);
    assert.ok(retrieved);
    assert.equal(retrieved.approval_id, parsedPacket.approval_id);

    // Verify formatForDiscord unwraps it into the unified 🔖 [PHÊ DUYỆT] format
    const formattedMessage = formatForDiscord(proposeResult.content[0].text);
    assert.match(
      formattedMessage,
      /### 🔖 \[PHÊ DUYỆT\] Đề xuất Skill: filter-multi-criteria/u,
    );
    assert.match(formattedMessage, /Duyệt đề xuất: /u);
    await rm(proposalStorageDir, { recursive: true, force: true });
  });

  // =========================================================================
  // F-008 (R1-A10-06) — a filter that can only remove rows is withdrawn, and
  // an unrecognized topic is refused by name instead of answering NO_MATCH.
  // =========================================================================
  test("F-008: the secondary_topics filter is refused by name and never reaches SQL", async () => {
    // The contract layer refuses the filter outright. The stored column is
    // always empty (the writer passes `canonicalSecondaryTopics = []`, because
    // a canonical skill manifest carries no metadata key to derive topics
    // from), so the overlap test could only remove rows - and it removed them
    // silently, answering NO_MATCH, which no caller can tell from "no such
    // skill".
    for (const value of [["lookup"], "lookup"]) {
      assert.throws(
        () =>
          prepareQueryEmbedding({
            query: "How to use XLOOKUP?",
            secondary_topics: value,
          }),
        /SECONDARY_TOPICS_FILTER_UNSUPPORTED/u,
      );
    }

    // A filter set the contract still accepts carries no secondary_topics key.
    const prepared = prepareQueryEmbedding({
      query: "How to use XLOOKUP?",
      primary_topic: "spreadsheet",
      subtopic: "modern-formulas",
      capability: "xlookup-guide",
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        prepared.metadataFilters,
        "secondary_topics",
      ),
      false,
      "the withdrawn filter may not be forwarded to the SQL builder",
    );

    // The adapter refuses before it builds a statement, so no predicate that
    // can only remove rows is ever sent to the index.
    let refusedSql = null;
    const refusing = new SkillAdapter(undefined, {
      embedFn: async () => [new Array(1024).fill(0.1)],
      dbExecutor: async (sql) => {
        refusedSql = sql;
        return "";
      },
    });
    const refused = await refusing.querySkillStore({
      action: "search",
      query: "How to use XLOOKUP?",
      secondary_topics: ["lookup"],
    });
    assert.equal(refused.governed_status, "CONTROLLED_FAILURE");
    assert.equal(refused.error, "SECONDARY_TOPICS_FILTER_UNSUPPORTED");
    assert.match(refused.message, /SECONDARY_TOPICS_FILTER_UNSUPPORTED/u);
    assert.equal(
      refusedSql,
      null,
      "a withdrawn filter may not reach the index",
    );

    // A search that does reach the index carries no secondary_topics clause.
    let searchSql = null;
    const searching = new SkillAdapter(undefined, {
      embedFn: async () => [new Array(1024).fill(0.1)],
      dbExecutor: async (sql) => {
        searchSql = sql;
        return `ZINK_FRESHNESS|${new Date().toISOString()}`;
      },
    });
    const found = await searching.querySkillStore({
      action: "search",
      query: "How to use XLOOKUP?",
    });
    assert.equal(found.governed_status, "NO_MATCH");
    assert.ok(searchSql, "the search must reach the index");
    assert.equal(
      /secondary_topics/u.test(searchSql),
      false,
      "the SQL builder must not know the withdrawn predicate",
    );

    // The builder half of the withdrawal is pinned in the source as well: the
    // contract-layer refusal happens before the builder runs, so a clause
    // that was left behind there would be dead code that still answers only
    // with empty rows if it ever woke up.
    const adapterSource = await readFile(
      new URL(
        "../zink-tools/adapters/skill-store/skill-adapter.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    assert.equal(
      adapterSource.includes("c.secondary_topics"),
      false,
      "the SQL builder must not carry the withdrawn predicate",
    );
  });

  test("F-008: an unrecognized primary_topic is refused by name instead of being forwarded to SQL", async () => {
    assert.throws(
      () =>
        prepareQueryEmbedding({
          query: "How to use XLOOKUP?",
          primary_topic: "not-a-topic",
        }),
      /UNKNOWN_PRIMARY_TOPIC_FILTER/u,
    );

    // A topic the index can carry is accepted, canonicalized, and forwarded.
    const prepared = prepareQueryEmbedding({
      query: "How to use XLOOKUP?",
      primary_topic: "  KB-INGESTION  ",
    });
    assert.equal(prepared.metadataFilters.primary_topic, "kb-ingestion");

    let refusedSql = null;
    const adapter = new SkillAdapter(undefined, {
      embedFn: async () => [new Array(1024).fill(0.1)],
      dbExecutor: async (sql) => {
        refusedSql = sql;
        return "";
      },
    });
    const refused = await adapter.querySkillStore({
      action: "search",
      query: "How to use XLOOKUP?",
      primary_topic: "not-a-topic",
    });
    assert.equal(refused.governed_status, "CONTROLLED_FAILURE");
    assert.equal(refused.error, "UNKNOWN_PRIMARY_TOPIC_FILTER");
    assert.match(refused.message, /UNKNOWN_PRIMARY_TOPIC_FILTER/u);
    assert.equal(
      refusedSql,
      null,
      "an unrecognized topic may not reach the index",
    );
  });

  // =========================================================================
  // F-014 (R5-E07-04) — one corpus, one spelling.
  // =========================================================================
  test("F-014: the alias and taxonomy registries are disjoint, so every spelling reaches one canonical namespace", () => {
    const taxonomyKeys = Object.keys(KNOWN_TAXONOMY_MAP);
    for (const [alias, target] of Object.entries(NAMESPACE_ALIAS_MAP)) {
      assert.equal(
        taxonomyKeys.includes(alias),
        false,
        `alias '${alias}' must not shadow a taxonomy key: the taxonomy is consulted first, so the alias would be unreachable`,
      );
      assert.equal(
        taxonomyKeys.includes(target),
        true,
        `alias '${alias}' points at '${target}', which is not a taxonomy key`,
      );
    }

    // Every alias is reachable: it resolves to exactly the canonical namespace
    // it declares.
    for (const [alias, target] of Object.entries(NAMESPACE_ALIAS_MAP)) {
      const meta = deriveSemanticMetadata({ namespace: [alias] });
      assert.deepEqual(
        meta.resolved_namespaces,
        [target],
        `alias '${alias}' must resolve to '${target}'`,
      );
    }

    // The four spellings of the knowledge namespace carry identical metadata,
    // so one corpus is indexed under one primary topic.
    const spellings = ["research", "kb", "knowledge-base", "literature"];
    for (const spelling of spellings) {
      const meta = deriveSemanticMetadata({ namespace: [spelling] });
      assert.deepEqual(
        {
          domain: meta.domain,
          primary_topic: meta.primary_topic,
          subtopic: meta.subtopic,
        },
        {
          domain: "research",
          primary_topic: "kb-ingestion",
          subtopic: "literature-and-provenance",
        },
        `spelling '${spelling}' must carry the knowledge taxonomy`,
      );
    }
  });
});
