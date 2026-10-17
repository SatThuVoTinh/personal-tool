import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyRouterTestEnv } from "./helpers/router-env.mjs";

// M10/T2-R9: the governed model provider resolves its endpoint and
// credential from the environment at build time; supply non-routable
// placeholders so this suite can assert config SHAPE only.
applyRouterTestEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadSkillSchema() {
  const raw = readFileSync(
    path.join(
      __dirname,
      "../zink-tools/contracts/tools/zink-skill.schema.json",
    ),
    "utf8",
  );
  return JSON.parse(raw);
}

describe("M8/T3 governed memory learning loop â€” contract parity", () => {
  test("T1: governed_status accepts NO_MATCH alongside SUCCESS and CONTROLLED_FAILURE", () => {
    const schema = loadSkillSchema();
    const allowed = schema.$defs.output.properties.governed_status.enum;
    assert.ok(
      allowed.includes("NO_MATCH"),
      `governed_status enum must include NO_MATCH, got ${JSON.stringify(allowed)}`,
    );
  });
});

describe("M8/T3 canonical Skill Store writer", () => {
  test("T2a: promotes exact approved bytes to ACTIVE with valid catalog", async () => {
    const { promoteApprovedSkill } =
      await import("../zink-skill-store/src/catalog.mjs");
    const { scanCatalog } = await import("../zink-skill-store/src/catalog.mjs");
    const tmp = await mkdtemp(path.join(os.tmpdir(), "zink-writer-"));
    try {
      const content = "# VLOOKUP Guide\n\nUse =VLOOKUP(A1, B:C, 2, FALSE).";
      const res = await promoteApprovedSkill({
        skillsRoot: path.join(tmp, "skills"),
        namespace: ["office"],
        capability: "vlookup-guide",
        version: "1.0.0",
        content,
        requestingActor: "excel",
        decisionRef: "PLAN:M8/T3-R1",
      });
      assert.equal(res.status, "ACTIVE");
      assert.equal(
        res.content_sha256,
        createHash("sha256").update(content, "utf8").digest("hex"),
      );
      const catalog = await scanCatalog(path.join(tmp, "skills"));
      assert.deepEqual(catalog.errors, []);
      assert.equal(catalog.records.length, 1);
      assert.equal(
        catalog.records[0].manifest.lifecycle.at(-1).status,
        "ACTIVE",
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("T2b: identical repeat approval is idempotent, conflicting bytes are denied", async () => {
    const { promoteApprovedSkill } =
      await import("../zink-skill-store/src/catalog.mjs");
    const tmp = await mkdtemp(path.join(os.tmpdir(), "zink-writer-idem-"));
    try {
      const content = "# DAX Tuning\n\nUse KEEPFILTERS.";
      const skillsRoot = path.join(tmp, "skills");
      const first = await promoteApprovedSkill({
        skillsRoot,
        namespace: ["data"],
        capability: "dax-tuning",
        version: "1.0.0",
        content,
        requestingActor: "power-bi",
        decisionRef: "PLAN:M8/T3-R1",
      });
      assert.equal(first.status, "ACTIVE");
      const second = await promoteApprovedSkill({
        skillsRoot,
        namespace: ["data"],
        capability: "dax-tuning",
        version: "1.0.0",
        content,
        requestingActor: "power-bi",
        decisionRef: "PLAN:M8/T3-R1",
      });
      assert.equal(second.status, "ALREADY_ACTIVE");
      await assert.rejects(
        () =>
          promoteApprovedSkill({
            skillsRoot,
            namespace: ["data"],
            capability: "dax-tuning",
            version: "1.0.0",
            content: "# DAX Tuning\n\nUse FILTER instead.",
            requestingActor: "power-bi",
            decisionRef: "PLAN:M8/T3-R1",
          }),
        /SKILL_VERSION_CONFLICT/,
      );
      await assert.rejects(
        () =>
          promoteApprovedSkill({
            skillsRoot,
            namespace: ["data"],
            capability: "dax-tuning",
            version: "2.0.0",
            content: "# DAX Tuning v2\n\nDifferent.",
            requestingActor: "power-bi",
            decisionRef: "PLAN:M8/T3-R1",
          }),
        /SKILL_ACTIVE_CONFLICT/,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("T2c: invalid decision_ref and unsafe identity are rejected", async () => {
    const { promoteApprovedSkill } =
      await import("../zink-skill-store/src/catalog.mjs");
    const tmp = await mkdtemp(path.join(os.tmpdir(), "zink-writer-neg-"));
    try {
      await assert.rejects(
        () =>
          promoteApprovedSkill({
            skillsRoot: path.join(tmp, "skills"),
            namespace: ["office"],
            capability: "bad-ref",
            version: "1.0.0",
            content: "# x",
            requestingActor: "excel",
            decisionRef: "prop-123",
          }),
        /DECISION_REF_INVALID/,
      );
      await assert.rejects(
        () =>
          promoteApprovedSkill({
            skillsRoot: path.join(tmp, "skills"),
            namespace: ["office"],
            capability: "../../escape",
            version: "1.0.0",
            content: "# x",
            requestingActor: "excel",
            decisionRef: "PLAN:M8/T3-R1",
          }),
        /SKILL_IDENTITY_INVALID/,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("T2d: post-approval tampering with canonical bytes is reported as drift", async () => {
    const { promoteApprovedSkill } =
      await import("../zink-skill-store/src/catalog.mjs");
    const { writeFile } = await import("node:fs/promises");
    const tmp = await mkdtemp(path.join(os.tmpdir(), "zink-writer-drift-"));
    const skillsRoot = path.join(tmp, "skills");
    try {
      const content = "# Guide\n\nOriginal bytes.";
      await promoteApprovedSkill({
        skillsRoot,
        namespace: ["office"],
        capability: "drift-watch",
        version: "1.0.0",
        content,
        requestingActor: "excel",
        decisionRef: "PLAN:M8/T3-R1",
      });
      await writeFile(
        path.join(skillsRoot, "office", "drift-watch", "1.0.0", "SKILL.md"),
        "# Guide\n\nTampered bytes.",
        "utf8",
      );
      await assert.rejects(
        () =>
          promoteApprovedSkill({
            skillsRoot,
            namespace: ["office"],
            capability: "drift-watch",
            version: "1.0.0",
            content,
            requestingActor: "excel",
            decisionRef: "PLAN:M8/T3-R1",
          }),
        /SKILL_SOURCE_DRIFT/,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("T2e: a staged pair is validated before it can become canonical", async () => {
    const { validateStagedVersion } =
      await import("../zink-skill-store/src/catalog.mjs");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const tmp = await mkdtemp(path.join(os.tmpdir(), "zink-staged-"));
    try {
      const dir = path.join(tmp, "office", "staged-skill", "1.0.0");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "SKILL.md"), "# Staged\n\nBody.", "utf8");
      await writeFile(
        path.join(dir, "manifest.json"),
        JSON.stringify({
          schema_version: 1,
          identity: {
            namespace: ["office"],
            capability: "staged-skill",
            version: "1.0.0",
          },
          content: { path: "SKILL.md", sha256: "0".repeat(64) },
          provenance: { source_type: "demonstration", references: [] },
          lifecycle: [
            { status: "CANDIDATE", at: "2026-10-01T00:00:00Z", actor: "excel" },
            {
              status: "ACTIVE",
              at: "2026-10-01T00:00:00Z",
              actor: "owner",
              decision_ref: "PLAN:M8/T3-R1",
            },
          ],
        }),
        "utf8",
      );
      const { errors } = await validateStagedVersion(dir, [
        "office",
        "staged-skill",
        "1.0.0",
      ]);
      assert.ok(
        errors.some((e) => e.code === "CONTENT_DIGEST_MISMATCH"),
        "a digest-mismatched pair must never validate",
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("T2f: interrupted publication leaves no ACTIVE skill and heals on retry", async () => {
    const { promoteApprovedSkill, scanCatalog } =
      await import("../zink-skill-store/src/catalog.mjs");
    const { mkdir, writeFile, readdir } = await import("node:fs/promises");
    const tmp = await mkdtemp(path.join(os.tmpdir(), "zink-crash-"));
    const skillsRoot = path.join(tmp, "skills");
    try {
      // Simulate a crash between the SKILL.md and manifest.json writes.
      const partial = path.join(skillsRoot, "office", "crash-skill", "1.0.0");
      await mkdir(partial, { recursive: true });
      await writeFile(
        path.join(partial, "SKILL.md"),
        "# Crash\n\nPartial.",
        "utf8",
      );
      // A stale staging directory from a killed publisher.
      await mkdir(
        path.join(skillsRoot, "office", "crash-skill", "1.0.0.pending-1-1"),
        { recursive: true },
      );
      const before = await scanCatalog(skillsRoot);
      assert.ok(
        before.records.every(
          (r) => r.manifest.lifecycle.at(-1)?.status !== "ACTIVE",
        ),
        "no partial publication may read as ACTIVE",
      );
      const content = "# Crash\n\nComplete bytes.";
      const res = await promoteApprovedSkill({
        skillsRoot,
        namespace: ["office"],
        capability: "crash-skill",
        version: "1.0.0",
        content,
        requestingActor: "excel",
        decisionRef: "PLAN:M8/T3-R1",
      });
      assert.equal(res.status, "ACTIVE");
      const leftovers = await readdir(
        path.join(skillsRoot, "office", "crash-skill"),
      );
      assert.deepEqual(leftovers.sort(), ["1.0.0"]);
      const after = await scanCatalog(skillsRoot);
      assert.deepEqual(after.errors, []);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("T2g: staging residue from a killed promotion of another version does not block this one", async () => {
    const { promoteApprovedSkill, scanCatalog } =
      await import("../zink-skill-store/src/catalog.mjs");
    const { mkdir } = await import("node:fs/promises");
    const tmp = await mkdtemp(path.join(os.tmpdir(), "zink-crash-cross-"));
    const skillsRoot = path.join(tmp, "skills");
    try {
      // A promotion of 2.0.0 was killed after its staging directory was
      // created. The name follows `stagingName()`'s real grammar, because a
      // version-scoped heal only ever recognized the caller's own prefix.
      const capability = path.join(skillsRoot, "office", "cross-crash-skill");
      await mkdir(
        path.join(capability, "2.0.0.pending-4242-1700000000000-deadbeef"),
        {
          recursive: true,
        },
      );
      const before = await scanCatalog(skillsRoot);
      assert.ok(
        before.errors.some((e) => e.code === "DIRECTORY_GRAMMAR_INVALID"),
        "the residue must be the store-wide failure the finding describes",
      );

      const content = "# Cross\n\nComplete bytes under a different version.";
      const res = await promoteApprovedSkill({
        skillsRoot,
        namespace: ["office"],
        capability: "cross-crash-skill",
        version: "1.0.0",
        content,
        requestingActor: "excel",
        decisionRef: "PLAN:M8/T3-R1",
      });
      assert.equal(res.status, "ACTIVE");

      const after = await scanCatalog(skillsRoot);
      assert.deepEqual(
        after.errors,
        [],
        "another version's residue may not null the store for this one",
      );
      assert.deepEqual(
        after.records.map((r) => r.manifest.identity.version),
        ["1.0.0"],
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("T2h: a version directory missing its content is healed, and a real conflict still is not", async () => {
    const { promoteApprovedSkill, scanCatalog } =
      await import("../zink-skill-store/src/catalog.mjs");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const tmp = await mkdtemp(path.join(os.tmpdir(), "zink-torn-"));
    const skillsRoot = path.join(tmp, "skills");
    const versionDir = path.join(skillsRoot, "office", "torn-skill", "1.0.0");
    try {
      // A crash after the manifest rename and before the content rename: the
      // pair is incomplete, so the scanner can never accept it and the writer
      // must not need out-of-band editing to get past its own state.
      await mkdir(versionDir, { recursive: true });
      await writeFile(
        path.join(versionDir, "manifest.json"),
        JSON.stringify({ schema_version: 1 }, null, 2),
        "utf8",
      );

      const content = "# Torn\n\nComplete pair written by the retry.";
      const res = await promoteApprovedSkill({
        skillsRoot,
        namespace: ["office"],
        capability: "torn-skill",
        version: "1.0.0",
        content,
        requestingActor: "excel",
        decisionRef: "PLAN:M8/T3-R1",
      });
      assert.equal(
        res.status,
        "ACTIVE",
        "an incomplete pair must be healed rather than reported as a conflict",
      );
      const after = await scanCatalog(skillsRoot);
      assert.deepEqual(after.errors, []);

      // The boundary of that healing: a COMPLETE pair with different bytes is a
      // genuine conflict and must stay one.
      await assert.rejects(
        () =>
          promoteApprovedSkill({
            skillsRoot,
            namespace: ["office"],
            capability: "torn-skill",
            version: "1.0.0",
            content: "# Torn\n\nDifferent bytes entirely.",
            requestingActor: "excel",
            decisionRef: "PLAN:M8/T3-R1",
          }),
        (error) => {
          assert.equal(error.code, "SKILL_VERSION_CONFLICT");
          return true;
        },
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("T2i: the same bytes under a second owner decision are a conflict, not ALREADY_ACTIVE", async () => {
    const { promoteApprovedSkill, scanCatalog } =
      await import("../zink-skill-store/src/catalog.mjs");
    const tmp = await mkdtemp(path.join(os.tmpdir(), "zink-decision-bind-"));
    const skillsRoot = path.join(tmp, "skills");
    const content = "# Bound\n\nIdentical bytes, two verdicts.";
    const call = (decisionRef) => ({
      skillsRoot,
      namespace: ["office"],
      capability: "bound-skill",
      version: "1.0.0",
      content,
      requestingActor: "excel",
      decisionRef,
    });
    try {
      const first = await promoteApprovedSkill(call("PLAN:M8/T3-R1"));
      assert.equal(first.status, "ACTIVE");

      const replay = await promoteApprovedSkill(call("PLAN:M8/T3-R1"));
      assert.equal(
        replay.status,
        "ALREADY_ACTIVE",
        "an unchanged governed act must stay idempotent",
      );

      await assert.rejects(
        () => promoteApprovedSkill(call("PLAN:M8/T3-R2")),
        (error) => {
          assert.equal(
            error.code,
            "SKILL_VERSION_CONFLICT",
            "a second decision over the same bytes may not report success",
          );
          return true;
        },
      );

      const { readFile } = await import("node:fs/promises");
      const manifest = JSON.parse(
        await readFile(
          path.join(
            skillsRoot,
            "office",
            "bound-skill",
            "1.0.0",
            "manifest.json",
          ),
          "utf8",
        ),
      );
      assert.equal(
        manifest.lifecycle.at(-1).decision_ref,
        "PLAN:M8/T3-R1",
        "the refused decision must not have been written over the first",
      );
      const after = await scanCatalog(skillsRoot);
      assert.deepEqual(after.errors, []);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("T2j: a refusal to promote over a dirty catalog names the diagnostic it found", async () => {
    const { promoteApprovedSkill } =
      await import("../zink-skill-store/src/catalog.mjs");
    const { mkdir } = await import("node:fs/promises");
    const tmp = await mkdtemp(path.join(os.tmpdir(), "zink-named-cause-"));
    const skillsRoot = path.join(tmp, "skills");
    try {
      await mkdir(path.join(skillsRoot, "office", "bad_dir"), {
        recursive: true,
      });
      await assert.rejects(
        () =>
          promoteApprovedSkill({
            skillsRoot,
            namespace: ["office"],
            capability: "named-cause-skill",
            version: "1.0.0",
            content: "# Named\n\nCause.",
            requestingActor: "excel",
            decisionRef: "PLAN:M8/T3-R1",
          }),
        (error) => {
          assert.equal(error.code, "CATALOG_INVALID");
          assert.match(
            error.message,
            /DIRECTORY_GRAMMAR_INVALID/,
            "the refusal must carry the code the scanner actually reported",
          );
          return true;
        },
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("T2k: the writer puts its cause in error.details, not only in prose", async () => {
    const { promoteApprovedSkill } =
      await import("../zink-skill-store/src/catalog.mjs");
    const { mkdir } = await import("node:fs/promises");
    const tmp = await mkdtemp(path.join(os.tmpdir(), "zink-details-"));
    const skillsRoot = path.join(tmp, "skills");
    const base = {
      skillsRoot,
      namespace: ["office"],
      capability: "details-skill",
      version: "1.0.0",
      content: "# Details\n\nCause.",
      requestingActor: "excel",
      decisionRef: "PLAN:M8/T3-R1",
    };
    const refuse = async (overrides) => {
      try {
        await promoteApprovedSkill({ ...base, ...overrides });
      } catch (error) {
        return error;
      }
      throw new Error("expected the writer to refuse");
    };
    try {
      const grammar = await refuse({ namespace: ["Office!"] });
      assert.equal(grammar.code, "SKILL_IDENTITY_INVALID");
      assert.deepEqual(
        grammar.details,
        ["IDENTITY_GRAMMAR"],
        "the identity refusal must name the rule the input broke",
      );

      const empty = await refuse({ content: "" });
      assert.deepEqual(
        empty.details,
        ["CONTENT_EMPTY"],
        "a different identity rule must report a different cause",
      );

      await mkdir(path.join(skillsRoot, "office", "bad_dir"), {
        recursive: true,
      });
      const dirty = await refuse({});
      assert.equal(dirty.code, "CATALOG_INVALID");
      assert.equal(dirty.details[0], "PREEXISTING_CATALOG_ERRORS");
      assert.ok(
        dirty.details.includes("DIRECTORY_GRAMMAR_INVALID"),
        "a poisoned tree must surface the diagnostic it found",
      );

      // The caller's question this item exists to answer: without reading a
      // single word of prose, is the request bad or is the store bad?
      const classify = (error) =>
        error.details[0] === "PREEXISTING_CATALOG_ERRORS" ? "tree" : "input";
      assert.equal(classify(grammar), "input");
      assert.equal(classify(empty), "input");
      assert.equal(classify(dirty), "tree");

      const unwrapped = await refuse({ decisionRef: "not-a-decision" });
      assert.equal(unwrapped.code, "DECISION_REF_INVALID");
      assert.ok(
        Array.isArray(unwrapped.details),
        "details is always an array, so a caller never has to guard it",
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("M8/T3 durable skill proposals", () => {
  test("T3a: proposal persists exact content bytes and ignores model-supplied replay fields", async () => {
    const { SkillAdapter } =
      await import("../zink-tools/adapters/skill-store/skill-adapter.mjs");
    const { readFile } = await import("node:fs/promises");
    const proposalStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "zink-proposals-"),
    );
    try {
      const adapter = new SkillAdapter(undefined, { proposalStorageDir });
      const content = "# Filter Guide\n\nFilter multi criteria.";
      const result = await adapter.querySkillStore({
        action: "propose",
        namespace: "excel",
        capability: "filter-multi-criteria",
        version: "1.0.0",
        content,
        reason: "Optimize filtering",
        requesting_agent: "excel",
        nonce: "attacker-chosen-nonce",
        expires_at: "2999-01-01T00:00:00.000Z",
      });
      assert.equal(result.governed_status, "SUCCESS");
      assert.equal(
        result.proposal.content_sha256,
        createHash("sha256").update(content.trim(), "utf8").digest("hex"),
      );
      // Model-supplied replay boundary is not trusted.
      assert.notEqual(result.proposal.nonce, "attacker-chosen-nonce");
      assert.notEqual(result.proposal.expires_at, "2999-01-01T00:00:00.000Z");
      // Durable record carries the exact bytes the owner will approve.
      const stored = JSON.parse(
        await readFile(
          path.join(proposalStorageDir, `${result.proposal.proposal_id}.json`),
          "utf8",
        ),
      );
      assert.equal(stored.content, content.trim());
      assert.equal(stored.content_sha256, result.proposal.content_sha256);
      assert.equal(stored.status, "CANDIDATE");
    } finally {
      await rm(proposalStorageDir, { recursive: true, force: true });
    }
  });

  test("T3b: legacy namespaces tree cannot yield discoverable skills", async () => {
    const { SkillAdapter } =
      await import("../zink-tools/adapters/skill-store/skill-adapter.mjs");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const root = await mkdtemp(path.join(os.tmpdir(), "zink-legacy-ns-"));
    try {
      await mkdir(path.join(root, "skills"), { recursive: true });
      await mkdir(path.join(root, "namespaces", "shadow-skill"), {
        recursive: true,
      });
      await writeFile(
        path.join(root, "namespaces", "shadow-skill", "manifest.json"),
        JSON.stringify({ status: "ACTIVE", description: "shadow" }),
        "utf8",
      );
      const adapter = new SkillAdapter(root);
      const res = await adapter.querySkillStore({ action: "discover" });
      assert.equal(res.governed_status, "SUCCESS");
      assert.deepEqual(res.skills, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("T3c: identical repeat proposal keeps the same proposal identity", async () => {
    const { SkillAdapter } =
      await import("../zink-tools/adapters/skill-store/skill-adapter.mjs");
    const proposalStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "zink-proposals-idem-"),
    );
    try {
      const adapter = new SkillAdapter(undefined, { proposalStorageDir });
      const input = {
        action: "propose",
        namespace: "sql",
        capability: "slow-query-check",
        version: "1.0.0",
        content: "# Slow queries\n\nCheck EXPLAIN.",
        reason: "Catch slow queries",
        requesting_agent: "sql",
      };
      const first = await adapter.querySkillStore({ ...input });
      const second = await adapter.querySkillStore({ ...input });
      assert.equal(first.proposal.proposal_id, second.proposal.proposal_id);
      assert.equal(
        first.proposal.content_sha256,
        second.proposal.content_sha256,
      );
    } finally {
      await rm(proposalStorageDir, { recursive: true, force: true });
    }
  });
});

describe("M8/T3 skill approval identity", () => {
  test("T4a: skill approval uses dedicated component actions distinct from execution approval", async () => {
    const authority =
      await import("../integrations/openclaw/lib/authority.mjs");
    assert.equal(
      authority.DISCORD_COMPONENT_ACTION_NAMESPACE.SKILL_APPROVE,
      "zink:skill:approve",
    );
    assert.equal(
      authority.DISCORD_COMPONENT_ACTION_NAMESPACE.SKILL_REJECT,
      "zink:skill:reject",
    );
    const customId = authority.buildComponentCustomId(
      "zink:skill:approve",
      "abc123",
      // The real skill path passes a DIGEST PREFIX, not a full 64-hex digest.
      // M10/T2-R12: with the host envelope prefixed, a full 64-char revision
      // would reach 101 chars and exceed Discord's ceiling, which is exactly why
      // the builder now fails closed instead of emitting an undeliverable id.
      "d".repeat(authority.SKILL_BUTTON_DIGEST_PREFIX_LENGTH),
    );
    assert.ok(customId.startsWith("occomp:cid=zink:skill:approve:"), customId);
    assert.ok(customId.length <= 100, `too long: ${customId.length}`);
    const parsed = authority.parseComponentCustomId(customId);
    assert.equal(parsed.actionKey, "SKILL_APPROVE");
    assert.equal(parsed.taskId, "abc123");
    assert.throws(
      () =>
        authority.buildComponentCustomId(
          "zink:skill:approve",
          "abc123",
          "d".repeat(64),
        ),
      /CUSTOM_ID_TOO_LONG/,
    );
  });

  test("T4b: execution-plan and skill-candidate approval subjects are discriminated", async () => {
    const authority =
      await import("../integrations/openclaw/lib/authority.mjs");
    assert.equal(
      authority.APPROVAL_SUBJECT_TYPES.EXECUTION_PLAN_APPROVAL,
      "EXECUTION_PLAN_APPROVAL",
    );
    assert.equal(
      authority.APPROVAL_SUBJECT_TYPES.SKILL_CANDIDATE_APPROVAL,
      "SKILL_CANDIDATE_APPROVAL",
    );
  });
});

describe("M8/T3 skill approval contract", () => {
  test("T5: skill packet carries its own proposal identity and no workflow task", async () => {
    const { validateContract } =
      await import("../integrations/openclaw/topology/lib/schema.mjs");
    const { canonicalHash } =
      await import("../integrations/openclaw/topology/lib/canonical.mjs");
    const content = "# skill";
    const contentDigest = createHash("sha256")
      .update(content, "utf8")
      .digest("hex");
    const packet = {
      schema_version: "1.0.0",
      governance_version: "m8-t2.2-r4",
      subject_type: "SKILL_CANDIDATE_APPROVAL",
      approval_id: "appr-1",
      proposal_id: "prop-1",
      brief_revision: 1,
      exact_target: "skills/excel/filter@1.0.0",
      exact_operation: "SKILL_CANDIDATE_APPROVAL",
      material_parameters: {
        namespace: "excel",
        capability: "filter",
        version: "1.0.0",
        content_sha256: contentDigest,
      },
      impact: "i",
      recovery_proposal: "r",
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      approval_scope_digest: canonicalHash(
        "zink-approval-scope-v1",
        "skills/excel/filter@1.0.0|SKILL_CANDIDATE_APPROVAL|prop-1",
      ),
      publication_status: "pending_owner_post",
      proposal: { proposal_id: "prop-1" },
    };
    assert.doesNotThrow(() => validateContract("approval-request", packet));
    // A manufactured workflow task id on a skill packet is refused.
    assert.throws(
      () =>
        validateContract("approval-request", {
          ...packet,
          task_id: "t".repeat(64),
        }),
      /SCHEMA/,
    );
  });
});

describe("M8/T3 governed skill approval", () => {
  const OWNER = "123456789012345678";

  async function makeProposal(proposalStorageDir, overrides = {}) {
    const { SkillAdapter } =
      await import("../zink-tools/adapters/skill-store/skill-adapter.mjs");
    const adapter = new SkillAdapter(undefined, { proposalStorageDir });
    const result = await adapter.querySkillStore({
      action: "propose",
      namespace: "excel",
      capability: "filter-multi-criteria",
      version: "1.0.0",
      content: "# Filter Guide\n\nFilter multi criteria.",
      reason: "Optimize filtering",
      requesting_agent: "excel",
      ...overrides,
    });
    return result.proposal;
  }

  async function freshDirs() {
    const root = await mkdtemp(path.join(os.tmpdir(), "zink-t6-"));
    return {
      root,
      skillsRoot: path.join(root, "skills"),
      proposalStorageDir: path.join(root, "proposals"),
    };
  }

  test("T6a: fresh-session skill memory â€” propose, approve, restart, retrieve", async () => {
    const { handleOwnerSkillApproval } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { SkillAdapter } =
      await import("../zink-tools/adapters/skill-store/skill-adapter.mjs");
    const dirs = await freshDirs();
    try {
      // Session A: propose durably, then owner approves the exact bytes.
      const proposal = await makeProposal(dirs.proposalStorageDir);
      let syncCalled = 0;
      const approval = await handleOwnerSkillApproval({
        decisionRef: "PLAN:M8/T3-R1",
        ownerDiscordId: OWNER,
        expectedOwnerId: OWNER,
        proposalId: proposal.proposal_id,
        contentSha256: proposal.content_sha256,
        namespace: ["excel"],
        capability: "filter-multi-criteria",
        version: "1.0.0",
        skillsRoot: dirs.skillsRoot,
        proposalStorageDir: dirs.proposalStorageDir,
        options: {
          vectorSyncFn: async () => {
            syncCalled += 1;
            return { status: "READY", synced_count: 1 };
          },
        },
      });
      assert.equal(approval.approval_status, "APPROVED");
      assert.equal(syncCalled, 1);

      // Destroy session state: a fresh adapter with no transcript from A.
      const fresh = new SkillAdapter(undefined, {
        skillsRoot: dirs.skillsRoot,
        embedFn: async () => [new Array(1024).fill(0.02)],
        dbExecutor: async (sql) => {
          assert.match(sql, /c\.status = 'ACTIVE'/);
          assert.match(sql, /c\.sync_status = 'READY'/);
          // The search seam now fails closed unless the same invocation
          // reports a fresh derived index (M11/T1-R1 2.2).
          const freshnessLine =
            "ZINK_FRESHNESS|" + new Date().toISOString() + "\n";
          return (
            freshnessLine +
            JSON.stringify({
              skill_id: "row-1",
              namespace: ["excel"],
              capability: "filter-multi-criteria",
              version: "1.0.0",
              domain: "office",
              primary_topic: "spreadsheet",
              subtopic: null,
              content: proposal.content,
              score: 0.92,
            })
          );
        },
      });
      const read = await fresh.querySkillStore({
        action: "read",
        skill_id: "excel/filter-multi-criteria",
      });
      assert.equal(read.governed_status, "SUCCESS");
      assert.equal(read.skill_content.content, proposal.content);
      const search = await fresh.querySkillStore({
        action: "search",
        query: "how to filter",
        namespace: "excel",
      });
      assert.equal(search.governed_status, "SUCCESS");
      assert.equal(search.results.length, 1);
      assert.equal(search.results[0].content, proposal.content);
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });

  test("T6b: unknown or missing durable proposal fails closed", async () => {
    const { handleOwnerSkillApproval } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const dirs = await freshDirs();
    try {
      await assert.rejects(
        () =>
          handleOwnerSkillApproval({
            decisionRef: "PLAN:M8/T3-R1",
            ownerDiscordId: OWNER,
            expectedOwnerId: OWNER,
            proposalId: "deadbeef".repeat(4).slice(0, 32),
            contentSha256: "a".repeat(64),
            namespace: ["excel"],
            capability: "ghost",
            version: "1.0.0",
            skillsRoot: dirs.skillsRoot,
            proposalStorageDir: dirs.proposalStorageDir,
          }),
        /APPROVAL_UNKNOWN_PROPOSAL/,
      );
      // Durable proposal deleted after restart-equivalent loss.
      const proposal = await makeProposal(dirs.proposalStorageDir);
      const { rm: remove } = await import("node:fs/promises");
      await remove(
        path.join(dirs.proposalStorageDir, `${proposal.proposal_id}.json`),
      );
      await assert.rejects(
        () =>
          handleOwnerSkillApproval({
            decisionRef: "PLAN:M8/T3-R1",
            ownerDiscordId: OWNER,
            expectedOwnerId: OWNER,
            proposalId: proposal.proposal_id,
            contentSha256: proposal.content_sha256,
            namespace: ["excel"],
            capability: "filter-multi-criteria",
            version: "1.0.0",
            skillsRoot: dirs.skillsRoot,
            proposalStorageDir: dirs.proposalStorageDir,
          }),
        /APPROVAL_UNKNOWN_PROPOSAL/,
      );
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });

  test("T6c: expired, mismatched and rejected proposals are denied", async () => {
    const { handleOwnerSkillApproval } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const dirs = await freshDirs();
    try {
      const proposal = await makeProposal(dirs.proposalStorageDir);
      // Content hash mismatch.
      await assert.rejects(
        () =>
          handleOwnerSkillApproval({
            decisionRef: "PLAN:M8/T3-R1",
            ownerDiscordId: OWNER,
            expectedOwnerId: OWNER,
            proposalId: proposal.proposal_id,
            contentSha256: "b".repeat(64),
            namespace: ["excel"],
            capability: "filter-multi-criteria",
            version: "1.0.0",
            skillsRoot: dirs.skillsRoot,
            proposalStorageDir: dirs.proposalStorageDir,
          }),
        /APPROVAL_PROPOSAL_MISMATCH/,
      );
      // Namespace/capability/version mismatch.
      await assert.rejects(
        () =>
          handleOwnerSkillApproval({
            decisionRef: "PLAN:M8/T3-R1",
            ownerDiscordId: OWNER,
            expectedOwnerId: OWNER,
            proposalId: proposal.proposal_id,
            contentSha256: proposal.content_sha256,
            namespace: ["sql"],
            capability: "filter-multi-criteria",
            version: "1.0.0",
            skillsRoot: dirs.skillsRoot,
            proposalStorageDir: dirs.proposalStorageDir,
          }),
        /APPROVAL_PROPOSAL_MISMATCH/,
      );
      // Expired candidate.
      const { readFile, writeFile } = await import("node:fs/promises");
      const proposalPath = path.join(
        dirs.proposalStorageDir,
        `${proposal.proposal_id}.json`,
      );
      const stored = JSON.parse(await readFile(proposalPath, "utf8"));
      stored.expires_at = "2020-01-01T00:00:00.000Z";
      await writeFile(proposalPath, JSON.stringify(stored, null, 2), "utf8");
      await assert.rejects(
        () =>
          handleOwnerSkillApproval({
            decisionRef: "PLAN:M8/T3-R1",
            ownerDiscordId: OWNER,
            expectedOwnerId: OWNER,
            proposalId: proposal.proposal_id,
            contentSha256: proposal.content_sha256,
            namespace: ["excel"],
            capability: "filter-multi-criteria",
            version: "1.0.0",
            skillsRoot: dirs.skillsRoot,
            proposalStorageDir: dirs.proposalStorageDir,
          }),
        /APPROVAL_PROPOSAL_EXPIRED/,
      );
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });

  test("T6d: exact replay is idempotent, conflicting content is denied", async () => {
    const { handleOwnerSkillApproval } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const dirs = await freshDirs();
    try {
      const proposal = await makeProposal(dirs.proposalStorageDir);
      const base = {
        decisionRef: "PLAN:M8/T3-R1",
        ownerDiscordId: OWNER,
        expectedOwnerId: OWNER,
        proposalId: proposal.proposal_id,
        contentSha256: proposal.content_sha256,
        namespace: ["excel"],
        capability: "filter-multi-criteria",
        version: "1.0.0",
        skillsRoot: dirs.skillsRoot,
        proposalStorageDir: dirs.proposalStorageDir,
        options: {
          vectorSyncFn: async () => ({ status: "READY", synced_count: 1 }),
        },
      };
      const first = await handleOwnerSkillApproval({ ...base });
      assert.equal(first.approval_status, "APPROVED");
      const second = await handleOwnerSkillApproval({ ...base });
      assert.equal(second.approval_status, "APPROVED");
      assert.equal(
        second.approval_transaction_id,
        first.approval_transaction_id,
      );
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });

  test("T6e: non-owner and wrong-subject approvals are denied", async () => {
    const { handleOwnerSkillApproval, handleDiscordAction } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const dirs = await freshDirs();
    try {
      const proposal = await makeProposal(dirs.proposalStorageDir);
      await assert.rejects(
        () =>
          handleOwnerSkillApproval({
            decisionRef: "PLAN:M8/T3-R1",
            ownerDiscordId: "999999999999999999",
            expectedOwnerId: OWNER,
            proposalId: proposal.proposal_id,
            contentSha256: proposal.content_sha256,
            namespace: ["excel"],
            capability: "filter-multi-criteria",
            version: "1.0.0",
            skillsRoot: dirs.skillsRoot,
            proposalStorageDir: dirs.proposalStorageDir,
          }),
        /APPROVAL_OWNER_MISMATCH/,
      );
      await assert.rejects(
        () =>
          handleOwnerSkillApproval({
            decisionRef: "PLAN:M8/T3-R1",
            ownerDiscordId: OWNER,
            expectedOwnerId: OWNER,
            proposalId: proposal.proposal_id,
            contentSha256: proposal.content_sha256,
            namespace: ["excel"],
            capability: "filter-multi-criteria",
            version: "1.0.0",
            subjectType: "EXECUTION_PLAN_APPROVAL",
            skillsRoot: dirs.skillsRoot,
            proposalStorageDir: dirs.proposalStorageDir,
          }),
        /APPROVAL_SUBJECT_MISMATCH/,
      );
      // A skill subject must never queue workflow execution.
      const res = handleDiscordAction({
        actor: "user",
        channel: "approvals",
        taskId: proposal.proposal_id,
        action: "APPROVE",
        currentState: "APPROVAL_PENDING",
        data: { approvalSubject: "SKILL_CANDIDATE_APPROVAL" },
      });
      assert.equal(res.allowed, false);
      assert.match(res.reason, /SKILL_APPROVAL_SEPARATE_PATH/);
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });

  test("T6f: vector-sync failure keeps canonical truth and reports derived failure", async () => {
    const { handleOwnerSkillApproval } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { scanCatalog } = await import("../zink-skill-store/src/catalog.mjs");
    const dirs = await freshDirs();
    try {
      const proposal = await makeProposal(dirs.proposalStorageDir);
      const approval = await handleOwnerSkillApproval({
        decisionRef: "PLAN:M8/T3-R1",
        ownerDiscordId: OWNER,
        expectedOwnerId: OWNER,
        proposalId: proposal.proposal_id,
        contentSha256: proposal.content_sha256,
        namespace: ["excel"],
        capability: "filter-multi-criteria",
        version: "1.0.0",
        skillsRoot: dirs.skillsRoot,
        proposalStorageDir: dirs.proposalStorageDir,
        options: {
          vectorSyncFn: async () => {
            throw new Error("PG_UNAVAILABLE");
          },
        },
      });
      assert.equal(approval.approval_status, "APPROVED");
      assert.equal(approval.vector_sync.status, "FAILED");
      // Canonical source of truth is intact despite the derived-index failure.
      const catalog = await scanCatalog(dirs.skillsRoot);
      assert.deepEqual(catalog.errors, []);
      assert.equal(
        catalog.records[0].manifest.lifecycle.at(-1).status,
        "ACTIVE",
      );
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });
});

describe("M8/T3 decision memory", () => {
  const OWNER = "123456789012345678";
  const QUESTION = "Which baseline should forecasts use?";

  async function freshLedger() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zink-decision-"));
    return { dir, storagePath: path.join(dir, "decision-ledger.json") };
  }

  test("T7a: fresh-session decision memory â€” teach, confirm, restart, reuse", async () => {
    const { DecisionLedger, buildDecisionCandidate } =
      await import("../integrations/openclaw/lib/decision-ledger.mjs");
    const { handleOwnerDecisionConfirmation } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { dir, storagePath } = await freshLedger();
    try {
      // Session A: user explicitly teaches; candidate is classified;
      // owner confirms; the ledger persists it.
      const candidate = buildDecisionCandidate({
        topic: "FORECAST",
        question: QUESTION,
        proposedDecision: "Use the 2026 fiscal baseline.",
        scope: "global",
        classification: "preference-decision",
      });
      const confirmed = await handleOwnerDecisionConfirmation({
        senderId: OWNER,
        config: { ownerDiscordId: OWNER },
        candidate,
        ledgerStoragePath: storagePath,
      });
      assert.equal(confirmed.status, "RECORDED");

      // Destroy the session. Session B has no transcript from A.
      const sessionB = new DecisionLedger({ storagePath });
      const reused = sessionB.lookupDecision({
        topic: "FORECAST",
        question: QUESTION,
        scope: "global",
      });
      assert.ok(reused);
      assert.equal(reused.decision, "Use the 2026 fiscal baseline.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("T7b: ambiguous classification and missing confirmation persist nothing", async () => {
    const { DecisionLedger, buildDecisionCandidate } =
      await import("../integrations/openclaw/lib/decision-ledger.mjs");
    const { dir, storagePath } = await freshLedger();
    try {
      assert.throws(
        () =>
          buildDecisionCandidate({
            topic: "FORECAST",
            question: QUESTION,
            proposedDecision: "Maybe use something.",
            scope: "global",
            classification: "ambiguous",
          }),
        /DECISION_CANDIDATE_AMBIGUOUS/,
      );
      const ledger = new DecisionLedger({ storagePath });
      assert.equal(ledger.hasDecision("FORECAST", QUESTION), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("T7c: non-owner confirmation is denied and one-off behavior is never global memory", async () => {
    const { DecisionLedger, buildDecisionCandidate } =
      await import("../integrations/openclaw/lib/decision-ledger.mjs");
    const { handleOwnerDecisionConfirmation } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { dir, storagePath } = await freshLedger();
    try {
      const candidate = buildDecisionCandidate({
        topic: "REPORT",
        question: "Which format for weekly reports?",
        proposedDecision: "Use the compact table.",
        scope: "global",
        classification: "preference-decision",
      });
      await assert.rejects(
        () =>
          handleOwnerDecisionConfirmation({
            senderId: "999999999999999999",
            config: { ownerDiscordId: OWNER },
            candidate,
            ledgerStoragePath: storagePath,
          }),
        /DECISION_OWNER_MISMATCH/,
      );
      // An unverified principal (agent name, observed behavior) cannot author.
      const ledger = new DecisionLedger({ storagePath });
      assert.throws(
        () =>
          ledger.recordDecision({
            topic: "REPORT",
            question: "Which format for weekly reports?",
            decision: "Use the compact table.",
            scope: "global",
            confirmedBy: "excel",
          }),
        /HUMAN_CONFIRMATION_REQUIRED/,
      );
      assert.equal(
        ledger.hasDecision("REPORT", "Which format for weekly reports?"),
        false,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("T7d: scope containment survives the restart", async () => {
    const { DecisionLedger, buildDecisionCandidate } =
      await import("../integrations/openclaw/lib/decision-ledger.mjs");
    const { handleOwnerDecisionConfirmation } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { dir, storagePath } = await freshLedger();
    try {
      const candidate = buildDecisionCandidate({
        topic: "ETL",
        question: "Retry policy for this load?",
        proposedDecision: "Retry twice.",
        scope: "task-specific",
        taskId: "task-aaa",
        classification: "preference-decision",
      });
      await handleOwnerDecisionConfirmation({
        senderId: OWNER,
        config: { ownerDiscordId: OWNER },
        candidate,
        ledgerStoragePath: storagePath,
      });
      const sessionB = new DecisionLedger({ storagePath });
      assert.equal(
        sessionB.hasDecision("ETL", "Retry policy for this load?", {
          scope: "task-specific",
          taskId: "task-aaa",
        }),
        true,
      );
      // A task-specific memory must never leak globally or to another task.
      assert.equal(
        sessionB.hasDecision("ETL", "Retry policy for this load?", {
          scope: "global",
        }),
        false,
      );
      assert.equal(
        sessionB.hasDecision("ETL", "Retry policy for this load?", {
          scope: "task-specific",
          taskId: "task-bbb",
        }),
        false,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("T7e: non-decision classifications never reach the ledger", async () => {
    const { DecisionLedger, buildDecisionCandidate } =
      await import("../integrations/openclaw/lib/decision-ledger.mjs");
    const { handleOwnerDecisionConfirmation } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { dir, storagePath } = await freshLedger();
    try {
      for (const classification of [
        "reusable-procedure",
        "factual-knowledge",
        "operational-state",
      ]) {
        const candidate = buildDecisionCandidate({
          topic: "MISC",
          question: `Question for ${classification}?`,
          proposedDecision: "Some answer.",
          scope: "global",
          classification,
        });
        const routed = await handleOwnerDecisionConfirmation({
          senderId: OWNER,
          config: { ownerDiscordId: OWNER },
          candidate,
          ledgerStoragePath: storagePath,
        });
        assert.equal(routed.status, "ROUTED");
      }
      const ledger = new DecisionLedger({ storagePath });
      assert.deepEqual(ledger.listAll(), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("T7f: explicit owner correction supersedes, never duplicates", async () => {
    const { DecisionLedger, buildDecisionCandidate } =
      await import("../integrations/openclaw/lib/decision-ledger.mjs");
    const { handleOwnerDecisionConfirmation } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { dir, storagePath } = await freshLedger();
    const confirm = (candidate, mode) =>
      handleOwnerDecisionConfirmation({
        senderId: OWNER,
        config: { ownerDiscordId: OWNER },
        candidate,
        ledgerStoragePath: storagePath,
        mode,
      });
    try {
      const candidate = buildDecisionCandidate({
        topic: "FORMAT",
        question: "Which format for weekly reports?",
        proposedDecision: "Use the compact table.",
        scope: "global",
        classification: "preference-decision",
      });
      const first = await confirm(candidate);
      assert.equal(first.status, "RECORDED");
      // Exact repeated confirmation is idempotent.
      const again = await confirm(candidate);
      assert.equal(again.status, "RECORDED");
      assert.equal(again.decision.decisionId, first.decision.decisionId);
      // Explicit owner correction supersedes the old decision.
      const corrected = await confirm(
        buildDecisionCandidate({
          topic: "FORMAT",
          question: "Which format for weekly reports?",
          proposedDecision: "Use the detailed table.",
          scope: "global",
          classification: "preference-decision",
        }),
        "correct",
      );
      assert.equal(corrected.status, "CORRECTED");
      assert.equal(corrected.decision.supersedes, first.decision.decisionId);
      // Fresh process: only the authoritative decision applies.
      const sessionB = new DecisionLedger({ storagePath });
      const active = sessionB.lookupDecision({
        topic: "FORMAT",
        question: "Which format for weekly reports?",
        scope: "global",
      });
      assert.ok(active);
      assert.equal(active.decision, "Use the detailed table.");
      assert.equal(
        sessionB.hasDecision("FORMAT", "Use the compact table."),
        false,
      );
      assert.equal(
        sessionB.hasDecision("FORMAT", "Use the detailed table."),
        true,
      );
      // The audit trail still holds both records.
      assert.equal(sessionB.listAll().length, 2);
      // Re-confirming the authoritative decision after the correction is
      // still idempotent, and never resurrects the superseded record.
      const replay = await confirm(
        buildDecisionCandidate({
          topic: "FORMAT",
          question: "Which format for weekly reports?",
          proposedDecision: "Use the detailed table.",
          scope: "global",
          classification: "preference-decision",
        }),
      );
      assert.equal(replay.status, "RECORDED");
      assert.equal(replay.decision.decisionId, corrected.decision.decisionId);
      assert.equal(sessionB.listAll().length, 2);
      // Re-confirming the superseded value fails closed: changing an
      // authoritative decision is always an explicit correction.
      await assert.rejects(
        () =>
          confirm(
            buildDecisionCandidate({
              topic: "FORMAT",
              question: "Which format for weekly reports?",
              proposedDecision: "Use the compact table.",
              scope: "global",
              classification: "preference-decision",
            }),
          ),
        /DECISION_SUPERSEDED_CORRECTION_REQUIRED/,
      );
      assert.equal(
        sessionB.lookupDecision({
          topic: "FORMAT",
          question: "Which format for weekly reports?",
          scope: "global",
        }).decision,
        "Use the detailed table.",
      );
      // Correcting a question with no existing decision fails closed.
      await assert.rejects(
        () =>
          confirm(
            buildDecisionCandidate({
              topic: "FORMAT",
              question: "Which format for monthly reports?",
              proposedDecision: "Use the detailed table.",
              scope: "global",
              classification: "preference-decision",
            }),
            "correct",
          ),
        /DECISION_NOT_FOUND/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("M8/T3 teaching bridges", () => {
  const OWNER = "123456789012345678";

  test("T9a: user-taught procedure reaches ACTIVE through existing skill infrastructure", async () => {
    const { buildDecisionCandidate } =
      await import("../integrations/openclaw/lib/decision-ledger.mjs");
    const {
      handleOwnerDecisionConfirmation,
      proposeSkillFromTeaching,
      handleOwnerSkillApproval,
    } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { SkillAdapter } =
      await import("../zink-tools/adapters/skill-store/skill-adapter.mjs");
    const root = await mkdtemp(path.join(os.tmpdir(), "zink-teach-"));
    const skillsRoot = path.join(root, "skills");
    const proposalStorageDir = path.join(root, "proposals");
    const ledgerStoragePath = path.join(root, "decisions.json");
    try {
      // USER EXPLICITLY TEACHES A REUSABLE PROCEDURE.
      const teaching = buildDecisionCandidate({
        topic: "PIVOT",
        question: "How should the team build monthly pivot summaries?",
        proposedDecision: "Use the team pivot layout with slicers.",
        scope: "global",
        classification: "reusable-procedure",
      });
      // Classification routes it to the skill path without persisting a decision.
      const routed = await handleOwnerDecisionConfirmation({
        senderId: OWNER,
        config: { ownerDiscordId: OWNER },
        candidate: teaching,
        ledgerStoragePath,
      });
      assert.equal(routed.status, "ROUTED");
      assert.equal(routed.route, "SKILL_PROPOSAL_PATH");
      // The exact taught bytes become a governed skill candidate.
      const content = "# Pivot Summaries\n\nUse the team pivot layout.";
      const proposed = await proposeSkillFromTeaching({
        teaching,
        namespace: ["excel"],
        capability: "pivot-summaries",
        version: "1.0.0",
        content,
        reason: "Team-agreed monthly layout",
        requestingAgent: "excel",
        proposalStorageDir,
      });
      assert.equal(proposed.status, "CANDIDATE_PROPOSED");
      // Owner approval publishes canonically.
      const approval = await handleOwnerSkillApproval({
        decisionRef: "PLAN:M8/T3-R1",
        ownerDiscordId: OWNER,
        expectedOwnerId: OWNER,
        proposalId: proposed.proposal.proposal_id,
        contentSha256: proposed.proposal.content_sha256,
        namespace: ["excel"],
        capability: "pivot-summaries",
        version: "1.0.0",
        skillsRoot,
        proposalStorageDir,
        options: {
          vectorSyncFn: async () => ({ status: "READY", synced_count: 1 }),
        },
      });
      assert.equal(approval.approval_status, "APPROVED");
      // Fresh session reuses the canonical approved procedure.
      const fresh = new SkillAdapter(undefined, { skillsRoot });
      const read = await fresh.querySkillStore({
        action: "read",
        skill_id: "excel/pivot-summaries",
      });
      assert.equal(read.governed_status, "SUCCESS");
      assert.equal(read.skill_content.content, content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("T9b: non-procedure teachings cannot enter the skill path", async () => {
    const { buildDecisionCandidate } =
      await import("../integrations/openclaw/lib/decision-ledger.mjs");
    const { proposeSkillFromTeaching } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const proposalStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "zink-teach-neg-"),
    );
    try {
      const teaching = buildDecisionCandidate({
        topic: "VAT",
        question: "VAT rate to apply?",
        proposedDecision: "Apply 10%.",
        scope: "global",
        classification: "factual-knowledge",
      });
      await assert.rejects(
        () =>
          proposeSkillFromTeaching({
            teaching,
            namespace: ["finance"],
            capability: "vat-rate",
            version: "1.0.0",
            content: "# VAT\n\nApply 10%.",
            proposalStorageDir,
          }),
        /TEACHING_NOT_A_SKILL/,
      );
    } finally {
      await rm(proposalStorageDir, { recursive: true, force: true });
    }
  });

  test("T9c: factual-knowledge routing states the Knowledgebase deferral honestly", async () => {
    const { buildDecisionCandidate } =
      await import("../integrations/openclaw/lib/decision-ledger.mjs");
    const { handleOwnerDecisionConfirmation } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const dir = await mkdtemp(path.join(os.tmpdir(), "zink-teach-kb-"));
    try {
      const routed = await handleOwnerDecisionConfirmation({
        senderId: OWNER,
        config: { ownerDiscordId: OWNER },
        candidate: buildDecisionCandidate({
          topic: "VAT",
          question: "VAT rate to apply?",
          proposedDecision: "Apply 10%.",
          scope: "global",
          classification: "factual-knowledge",
        }),
        ledgerStoragePath: path.join(dir, "decisions.json"),
      });
      assert.equal(routed.status, "ROUTED");
      assert.equal(routed.route, "KNOWLEDGE_GOVERNANCE_PATH");
      assert.equal(routed.persisted, false);
      assert.match(routed.note ?? "", /defer/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("T9d: skill proposal cards carry exact-bound buttons that round-trip to approval", async () => {
    const { buildSkillComponentCustomId, parseComponentCustomId } =
      await import("../integrations/openclaw/lib/authority.mjs");
    const { buildSkillProposalCard, handleSkillDiscordAction } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { buildNativeComponents } =
      await import("../integrations/openclaw/lib/discord-native-send.mjs");
    const { SkillAdapter } =
      await import("../zink-tools/adapters/skill-store/skill-adapter.mjs");
    const root = await mkdtemp(path.join(os.tmpdir(), "zink-t9d-"));
    const skillsRoot = path.join(root, "skills");
    const proposalStorageDir = path.join(root, "proposals");
    try {
      const content = "# Card Skill\n\nExact procedure bytes.";
      const adapter = new SkillAdapter(undefined, { proposalStorageDir });
      const { proposal } = await adapter.querySkillStore({
        action: "propose",
        namespace: "excel",
        capability: "card-skill",
        version: "1.0.0",
        content,
        reason: "Card round-trip",
        requesting_agent: "excel",
      });
      const card = buildSkillProposalCard(proposal);
      assert.ok(typeof card.text === "string" && card.text.length > 0);
      assert.equal(card.buttons.length, 2);
      // Native spec-valid, including the 100-char custom_id ceiling.
      assert.doesNotThrow(() => buildNativeComponents(card.buttons));
      const [approve, reject] = card.buttons;
      const parsedApprove = parseComponentCustomId(approve.customId);
      assert.equal(parsedApprove.actionKey, "SKILL_APPROVE");
      assert.equal(parsedApprove.taskId, proposal.proposal_id);
      assert.ok(
        proposal.content_sha256.startsWith(parsedApprove.revision),
        "the button corroborates the exact approved digest",
      );
      assert.equal(
        parseComponentCustomId(reject.customId).actionKey,
        "SKILL_REJECT",
      );
      // Compact builder pins the binding shape.
      assert.equal(
        buildSkillComponentCustomId(
          "zink:skill:approve",
          proposal.proposal_id,
          proposal.content_sha256,
        ),
        approve.customId,
      );
      // The approve button drives the real approval to canonical ACTIVE.
      const result = await handleSkillDiscordAction({
        decisionRef: "PLAN:M8/T3-R1",
        action: "approve",
        proposalId: parsedApprove.taskId,
        contentSha256: parsedApprove.revision,
        senderId: OWNER,
        config: { ownerDiscordId: OWNER },
        skillsRoot,
        proposalStorageDir,
        options: {
          vectorSyncFn: async () => ({ status: "READY", synced_count: 1 }),
        },
      });
      assert.equal(result.ok, true);
      assert.equal(result.status, "APPROVED");
      assert.equal(
        result.approval.canonical.content_sha256,
        proposal.content_sha256,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("M8/T3 Discord separation and residual guarantees", () => {
  const OWNER = "123456789012345678";

  async function freshDirs() {
    const root = await mkdtemp(path.join(os.tmpdir(), "zink-t8-"));
    return {
      root,
      skillsRoot: path.join(root, "skills"),
      proposalStorageDir: path.join(root, "proposals"),
    };
  }

  async function proposeExcel(proposalStorageDir, content) {
    const { SkillAdapter } =
      await import("../zink-tools/adapters/skill-store/skill-adapter.mjs");
    const adapter = new SkillAdapter(undefined, { proposalStorageDir });
    const result = await adapter.querySkillStore({
      action: "propose",
      namespace: "excel",
      capability: "pivot-mastery",
      version: "1.0.0",
      content,
      reason: "Reuse pivot technique",
      requesting_agent: "excel",
    });
    return result.proposal;
  }

  test("T8a: skill Discord approval materializes via #office, never the execution queue", async () => {
    const { handleSkillDiscordAction } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { scanCatalog } = await import("../zink-skill-store/src/catalog.mjs");
    const dirs = await freshDirs();
    try {
      const proposal = await proposeExcel(
        dirs.proposalStorageDir,
        "# Pivot Mastery\n\nReuse pivot technique.",
      );
      const notices = [];
      const result = await handleSkillDiscordAction({
        decisionRef: "PLAN:M8/T3-R1",
        action: "approve",
        proposalId: proposal.proposal_id,
        contentSha256: proposal.content_sha256,
        senderId: OWNER,
        config: { ownerDiscordId: OWNER },
        skillsRoot: dirs.skillsRoot,
        proposalStorageDir: dirs.proposalStorageDir,
        notify: async (notice) => {
          notices.push(notice);
        },
        options: {
          vectorSyncFn: async () => ({ status: "READY", synced_count: 1 }),
        },
      });
      assert.equal(result.ok, true);
      assert.equal(result.status, "APPROVED");
      assert.equal(notices.length, 1);
      assert.equal(notices[0].channel, "office");
      // No workflow/queue surface exists on this path at all.
      assert.ok(!("nextState" in result));
      assert.ok(!("taskId" in result));
      const catalog = await scanCatalog(dirs.skillsRoot);
      assert.deepEqual(catalog.errors, []);
      assert.equal(
        catalog.records[0].manifest.lifecycle.at(-1).status,
        "ACTIVE",
      );
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });

  test("T8b: rejected candidates can never become ACTIVE", async () => {
    const { handleSkillDiscordAction, handleOwnerSkillApproval } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const dirs = await freshDirs();
    try {
      const proposal = await proposeExcel(
        dirs.proposalStorageDir,
        "# Pivot Mastery\n\nReuse pivot technique.",
      );
      const rejected = await handleSkillDiscordAction({
        action: "reject",
        proposalId: proposal.proposal_id,
        contentSha256: proposal.content_sha256,
        senderId: OWNER,
        config: { ownerDiscordId: OWNER },
        skillsRoot: dirs.skillsRoot,
        proposalStorageDir: dirs.proposalStorageDir,
      });
      assert.equal(rejected.ok, true);
      assert.equal(rejected.status, "REJECTED");
      await assert.rejects(
        () =>
          handleOwnerSkillApproval({
            decisionRef: "PLAN:M8/T3-R1",
            ownerDiscordId: OWNER,
            expectedOwnerId: OWNER,
            proposalId: proposal.proposal_id,
            contentSha256: proposal.content_sha256,
            namespace: ["excel"],
            capability: "pivot-mastery",
            version: "1.0.0",
            skillsRoot: dirs.skillsRoot,
            proposalStorageDir: dirs.proposalStorageDir,
            options: {
              vectorSyncFn: async () => ({ status: "READY" }),
            },
          }),
        /APPROVAL_PROPOSAL_REJECTED/,
      );
      // A non-owner rejection is denied as well.
      const denied = await handleSkillDiscordAction({
        action: "reject",
        proposalId: proposal.proposal_id,
        contentSha256: proposal.content_sha256,
        senderId: "999999999999999999",
        config: { ownerDiscordId: OWNER },
        skillsRoot: dirs.skillsRoot,
        proposalStorageDir: dirs.proposalStorageDir,
      });
      assert.equal(denied.ok, false);
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });

  test("T8c: approval and execution paths share no machinery", async () => {
    const { readFileSync } = await import("node:fs");
    const pluginSource = readFileSync(
      path.join(
        __dirname,
        "../integrations/openclaw/plugins/zink-governance/index.mjs",
      ),
      "utf8",
    );
    const skillStart = pluginSource.indexOf(
      "export async function handleSkillDiscordAction",
    );
    const skillEnd = pluginSource.indexOf("\nexport ", skillStart + 1);
    const skillHandler = pluginSource.slice(
      skillStart,
      skillEnd === -1 ? skillStart + 6000 : skillEnd,
    );
    assert.ok(
      !skillHandler.includes("executeApprovedTask("),
      "skill approval must never trigger workflow execution",
    );
    assert.ok(
      !skillHandler.includes("WORKFLOW_TASK_CLAIMED"),
      "skill approval must never claim a workflow task",
    );
    assert.ok(
      !skillHandler.includes("handleDiscordAction("),
      "skill approval must never route through the execution handler",
    );
    const discordHandler = pluginSource.slice(
      pluginSource.indexOf("export function handleDiscordAction"),
      pluginSource.indexOf("export function handleDiscordAction") + 1200,
    );
    assert.ok(
      !discordHandler.includes("promoteApprovedSkill"),
      "execution approval must never mutate the Skill Store",
    );
  });

  test("T8d: a proposal alone creates no canonical skill", async () => {
    const { scanCatalog } = await import("../zink-skill-store/src/catalog.mjs");
    const dirs = await freshDirs();
    try {
      await proposeExcel(
        dirs.proposalStorageDir,
        "# Pivot Mastery\n\nReuse pivot technique.",
      );
      const catalog = await scanCatalog(dirs.skillsRoot);
      assert.deepEqual(catalog.records, []);
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });

  test("T8e: a different candidate under an ACTIVE identity is a conflict", async () => {
    const { handleOwnerSkillApproval } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const dirs = await freshDirs();
    const syncOk = {
      vectorSyncFn: async () => ({ status: "READY", synced_count: 1 }),
    };
    try {
      const first = await proposeExcel(
        dirs.proposalStorageDir,
        "# Pivot Mastery\n\nReuse pivot technique.",
      );
      const base = {
        decisionRef: "PLAN:M8/T3-R1",
        ownerDiscordId: OWNER,
        expectedOwnerId: OWNER,
        namespace: ["excel"],
        capability: "pivot-mastery",
        version: "1.0.0",
        skillsRoot: dirs.skillsRoot,
        proposalStorageDir: dirs.proposalStorageDir,
        options: syncOk,
      };
      const approved = await handleOwnerSkillApproval({
        ...base,
        proposalId: first.proposal_id,
        contentSha256: first.content_sha256,
      });
      assert.equal(approved.approval_status, "APPROVED");
      const second = await proposeExcel(
        dirs.proposalStorageDir,
        "# Pivot Mastery\n\nA different technique.",
      );
      assert.notEqual(second.proposal_id, first.proposal_id);
      await assert.rejects(
        () =>
          handleOwnerSkillApproval({
            ...base,
            proposalId: second.proposal_id,
            contentSha256: second.content_sha256,
          }),
        /APPROVAL_SKILL_CONFLICT/,
      );
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });

  test("T8f: domain decisions do not leak into another domain", async () => {
    const { DecisionLedger, buildDecisionCandidate } =
      await import("../integrations/openclaw/lib/decision-ledger.mjs");
    const { handleOwnerDecisionConfirmation } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const dir = await mkdtemp(path.join(os.tmpdir(), "zink-decision-dom-"));
    const storagePath = path.join(dir, "decision-ledger.json");
    try {
      await handleOwnerDecisionConfirmation({
        senderId: OWNER,
        config: { ownerDiscordId: OWNER },
        candidate: buildDecisionCandidate({
          topic: "TAX",
          question: "VAT rate to apply?",
          proposedDecision: "Apply 10%.",
          scope: "domain",
          domain: "finance",
          classification: "preference-decision",
        }),
        ledgerStoragePath: storagePath,
      });
      const sessionB = new DecisionLedger({ storagePath });
      assert.equal(
        sessionB.hasDecision("TAX", "VAT rate to apply?", {
          scope: "domain",
          domain: "finance",
        }),
        true,
      );
      assert.equal(
        sessionB.hasDecision("TAX", "VAT rate to apply?", {
          scope: "domain",
          domain: "logistics",
        }),
        false,
      );
      assert.equal(
        sessionB.hasDecision("TAX", "VAT rate to apply?", { scope: "global" }),
        false,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("T8g: proposals resolve from disk alone after a process restart", async () => {
    const { handleOwnerSkillApproval } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const dirs = await freshDirs();
    try {
      const proposal = await proposeExcel(
        dirs.proposalStorageDir,
        "# Pivot Mastery\n\nReuse pivot technique.",
      );
      // Simulate a restart: drop every in-memory index entry.
      const key = Symbol.for("zink.governance.pending_skill_proposals");
      globalThis[key]?.clear?.();
      const approval = await handleOwnerSkillApproval({
        decisionRef: "PLAN:M8/T3-R1",
        ownerDiscordId: OWNER,
        expectedOwnerId: OWNER,
        proposalId: proposal.proposal_id,
        contentSha256: proposal.content_sha256,
        namespace: ["excel"],
        capability: "pivot-mastery",
        version: "1.0.0",
        skillsRoot: dirs.skillsRoot,
        proposalStorageDir: dirs.proposalStorageDir,
        options: {
          vectorSyncFn: async () => ({ status: "READY", synced_count: 1 }),
        },
      });
      assert.equal(approval.approval_status, "APPROVED");
    } finally {
      await rm(dirs.root, { recursive: true, force: true });
    }
  });

  test("T8h: propose tool packet binds the exact raw content digest", async () => {
    const { registerTools } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { validateContract } =
      await import("../integrations/openclaw/topology/lib/schema.mjs");
    const proposalStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "zink-tool-packet-"),
    );
    try {
      let proposeTool = null;
      registerTools(
        {
          pluginConfig: { ledgerRoot: proposalStorageDir },
          registerTool: (tool) => {
            if (tool.id === "zink_skill_propose") proposeTool = tool;
          },
        },
        { proposalStorageDir },
      );
      assert.ok(proposeTool);
      const content = "# Packet Digest\n\nExact bytes.";
      const result = await proposeTool.execute(
        { agent: "excel" },
        {
          namespace: "excel",
          capability: "packet-digest",
          version: "1.0.0",
          content,
          reason: "Digest parity",
        },
      );
      const packet = JSON.parse(result.content[0].text);
      assert.equal(
        packet.material_parameters.content_sha256,
        createHash("sha256").update(content.trim(), "utf8").digest("hex"),
      );
      assert.equal(packet.subject_type, "SKILL_CANDIDATE_APPROVAL");
      assert.equal(packet.proposal_id, packet.proposal.proposal_id);
      assert.ok(!("task_id" in packet));
      assert.doesNotThrow(() => validateContract("approval-request", packet));
    } finally {
      await rm(proposalStorageDir, { recursive: true, force: true });
    }
  });

  test("T8i: OpenClaw native conversational memory remains disabled", async () => {
    const policy = await import("../integrations/openclaw/lib/policy.mjs");
    const config = policy.buildConfig({
      stateDir: path.join(os.tmpdir(), "zink-memcheck"),
      identifiers: {
        discordGuildId: "111111111111111111",
        discordOwnerId: "123456789012345678",
        discordOfficeChannelId: "222222222222222222",
        discordResultsForumId: "333333333333333333",
        discordApprovalsForumId: "444444444444444444",
        discordIncidentsForumId: "555555555555555555",
      },
    });
    assert.equal(config.plugins.slots.memory, "none");
    const instructions = policy.agentInstructions("main");
    assert.match(instructions, /NOT_LINKED/);
  });

  test("T8j: canonical drift after approval is detected, not idempotent success", async () => {
    const { handleOwnerSkillApproval } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { writeFile } = await import("node:fs/promises");
    const root = await mkdtemp(path.join(os.tmpdir(), "zink-t8j-"));
    const skillsRoot = path.join(root, "skills");
    const proposalStorageDir = path.join(root, "proposals");
    try {
      const proposal = await proposeExcel(
        proposalStorageDir,
        "# Pivot Mastery\n\nReuse pivot technique.",
      );
      const base = {
        decisionRef: "PLAN:M8/T3-R1",
        ownerDiscordId: OWNER,
        expectedOwnerId: OWNER,
        proposalId: proposal.proposal_id,
        contentSha256: proposal.content_sha256,
        namespace: ["excel"],
        capability: "pivot-mastery",
        version: "1.0.0",
        skillsRoot,
        proposalStorageDir,
        options: {
          vectorSyncFn: async () => ({ status: "READY", synced_count: 1 }),
        },
      };
      const first = await handleOwnerSkillApproval({ ...base });
      assert.equal(first.approval_status, "APPROVED");
      // Tamper with the canonical bytes after approval.
      await writeFile(
        path.join(skillsRoot, "excel", "pivot-mastery", "1.0.0", "SKILL.md"),
        "# Pivot Mastery\n\nTampered technique.",
        "utf8",
      );
      await assert.rejects(
        () => handleOwnerSkillApproval({ ...base }),
        /APPROVAL_CANONICAL_DRIFT/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("T8k: a search hit leads to canonical approved procedure reuse", async () => {
    const { SkillAdapter } =
      await import("../zink-tools/adapters/skill-store/skill-adapter.mjs");
    const { promoteApprovedSkill } =
      await import("../zink-skill-store/src/catalog.mjs");
    const root = await mkdtemp(path.join(os.tmpdir(), "zink-t8k-"));
    const skillsRoot = path.join(root, "skills");
    const content = "# Reuse Proof\n\nFollow these exact steps.";
    try {
      await promoteApprovedSkill({
        skillsRoot,
        namespace: ["excel"],
        capability: "reuse-proof",
        version: "1.0.0",
        content,
        requestingActor: "excel",
        decisionRef: "PLAN:M8/T3-R1",
      });
      // Fresh adapter: no transcript, stubbed vector transport only.
      const fresh = new SkillAdapter(undefined, {
        skillsRoot,
        embedFn: async () => [new Array(1024).fill(0.02)],
        dbExecutor: async () => {
          const row = {
            skill_id: "row-uuid-1",
            namespace: ["excel"],
            capability: "reuse-proof",
            version: "1.0.0",
            domain: "office",
            primary_topic: "spreadsheet",
            subtopic: null,
            content: "# Reuse Proof\n\nSegment excerpt.",
            score: 0.9,
          };
          // Fresh derived index marker (M11/T1-R1 2.2).
          return (
            "ZINK_FRESHNESS|" +
            new Date().toISOString() +
            "\n" +
            JSON.stringify(row)
          );
        },
      });
      const search = await fresh.querySkillStore({
        action: "search",
        query: "how to reuse",
        namespace: "excel",
      });
      assert.equal(search.governed_status, "SUCCESS");
      assert.equal(search.results.length, 1);
      // The hit carries the canonical reuse identity of the approved skill.
      const canonicalId = search.results[0].canonical_skill_id;
      assert.equal(canonicalId, "excel/reuse-proof");
      // canonical_skill_id resolves through the canonical read boundary.
      const read = await fresh.querySkillStore({
        action: "read",
        skill_id: canonicalId,
      });
      assert.equal(read.governed_status, "SUCCESS");
      assert.equal(read.skill_content.content, content);
      // And through the apply boundary agents actually execute from.
      const applied = await fresh.querySkillStore({
        action: "apply",
        skill_id: canonicalId,
      });
      assert.equal(applied.governed_status, "SUCCESS");
      assert.equal(applied.skill_content.content, content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("T8l: re-proposing approved bytes never regresses the durable record", async () => {
    const { SkillAdapter } =
      await import("../zink-tools/adapters/skill-store/skill-adapter.mjs");
    const { handleOwnerSkillApproval } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { readFile } = await import("node:fs/promises");
    const root = await mkdtemp(path.join(os.tmpdir(), "zink-t8l-"));
    const skillsRoot = path.join(root, "skills");
    const proposalStorageDir = path.join(root, "proposals");
    const content = "# Stable Skill\n\nApproved bytes.";
    try {
      const adapter = new SkillAdapter(undefined, { proposalStorageDir });
      const input = {
        action: "propose",
        namespace: "sql",
        capability: "stable-skill",
        version: "1.0.0",
        content,
        reason: "Stable procedure",
        requesting_agent: "sql",
      };
      const first = await adapter.querySkillStore({ ...input });
      await handleOwnerSkillApproval({
        decisionRef: "PLAN:M8/T3-R1",
        ownerDiscordId: OWNER,
        expectedOwnerId: OWNER,
        proposalId: first.proposal.proposal_id,
        contentSha256: first.proposal.content_sha256,
        namespace: ["sql"],
        capability: "stable-skill",
        version: "1.0.0",
        skillsRoot,
        proposalStorageDir,
        options: {
          vectorSyncFn: async () => ({ status: "READY", synced_count: 1 }),
        },
      });
      const repeat = await adapter.querySkillStore({ ...input });
      assert.equal(repeat.proposal.proposal_id, first.proposal.proposal_id);
      const stored = JSON.parse(
        await readFile(
          path.join(proposalStorageDir, `${first.proposal.proposal_id}.json`),
          "utf8",
        ),
      );
      assert.notEqual(stored.status, "CANDIDATE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
