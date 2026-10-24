import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import { validateContractSchema } from "../integrations/openclaw/topology/lib/guard.mjs";
import { setContractResolutionRoots } from "../integrations/openclaw/topology/lib/schema.mjs";
import { TOOL_RESULT_ENVELOPE_MAX_BYTES } from "../integrations/openclaw/topology/lib/schema.mjs";
import { SkillAdapter } from "../zink-tools/adapters/skill-store/skill-adapter.mjs";
import { KnowledgeAdapter } from "../zink-tools/adapters/knowledge/knowledge-adapter.mjs";

/**
 * F-125 (R1-A10-03) — the memory-tool output contracts were declared but
 * validated nowhere, and the adapters already emitted out-of-contract values.
 *
 * Measured at HEAD:
 * - `skill-adapter.mjs` returned `governed_status: "FAILED"` with an
 *   `error_code` key, and added a top-level `query` to the search envelope —
 *   none of which the tool's own output contract declares (and that contract
 *   closes the object);
 * - `knowledge-adapter.mjs` returned `governed_status: "NO_MATCH"` and a
 *   `semantic_contract_version` key, and put `error`/`message` in its failure
 *   envelopes — none of which the tool's own output contract declared;
 * - three output objects (`skill_content`, `results.items`, `proposal`) were
 *   open, so an arbitrary key in an item or in content passed.
 *
 * The oracle here is the CONTRACT FILE, checked with the repository's own
 * validator. The repository's schema loader resolves a contract by NAME from
 * the contracts directories, so the `$defs/output` sub-schema is reached
 * through a one-line pointer file that this suite materialises in a temporary
 * tree; the pointer resolves the real contract file, and the repository's
 * dialect implementation does the checking.
 */

const CONTRACTS_DIR = path.resolve(
  import.meta.dirname,
  "../zink-tools/contracts/tools",
);
let tempRoot = null;
let originalCwd = null;

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zink-output-contract-"));
  const toolsDir = path.join(tempRoot, "zink-tools", "contracts", "tools");
  fs.mkdirSync(toolsDir, { recursive: true });
  for (const name of ["zink-skill", "zink-knowledge"]) {
    fs.writeFileSync(
      path.join(toolsDir, `${name}-output.schema.json`),
      JSON.stringify(
        { $ref: `tools/${name}.schema.json#/$defs/output` },
        null,
        2,
      ),
      "utf8",
    );
  }
  // M12/T9 F-303: the pointer tree is DECLARED, not found by accident through
  // the working directory. The contract resolver is repository-relative only,
  // so the suite states where its materialised pointers live.
  setContractResolutionRoots([tempRoot]);
  originalCwd = process.cwd();
});

after(() => {
  setContractResolutionRoots([]);
  if (originalCwd) process.chdir(originalCwd);
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

after(() => {
  if (originalCwd) process.chdir(originalCwd);
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

/**
 * Validates a value against a tool contract's own declared output schema.
 *
 * @param {string} toolName
 * @param {unknown} value
 */
function assertMatchesDeclaredOutput(toolName, value) {
  assert.equal(
    validateContractSchema(
      `${toolName}-output`,
      value,
      TOOL_RESULT_ENVELOPE_MAX_BYTES,
    ),
    true,
    `the ${toolName} envelope must pass its own declared output schema`,
  );
}

/**
 * A loopback knowledge service that answers with the given body.
 *
 * @param {unknown} body
 * @param {number} [status]
 * @returns {Promise<{endpoint: string, close: () => Promise<void>}>}
 */
async function knowledgeService(body, status = 200) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    endpoint: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe("F-125 (R1-A10-03) — the memory-tool envelopes pass their own contracts", () => {
  test("F-125: the skill discovery envelopes pass the skill output contract", async () => {
    const missingRoot = new SkillAdapter("/nonexistent/skills-root", {
      skillsRoot: "/nonexistent/skills-root",
    });
    const failure = await missingRoot.querySkillStore({
      action: "discover",
      namespace: "office",
    });
    assert.equal(failure.governed_status, "FAILED");
    assert.equal(failure.error_code, "SKILL_ROOT_UNAVAILABLE");
    assertMatchesDeclaredOutput("zink-skill", failure);

    const emptyRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "zink-empty-store-"),
    );
    try {
      const empty = new SkillAdapter(emptyRoot, { skillsRoot: emptyRoot });
      const success = await empty.querySkillStore({
        action: "discover",
        namespace: "office",
      });
      assert.equal(success.governed_status, "SUCCESS");
      assertMatchesDeclaredOutput("zink-skill", success);
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  test("F-125: the knowledge envelopes pass the knowledge output contract", async () => {
    const service = await knowledgeService({
      semantic_contract_version: "zink-semantic-v2",
      results: [
        {
          segment_id: "seg-1",
          title: "A title",
          text: "Some retrieved text.",
          dense_score: 0.5,
          source_path: "notes/a.md",
          heading_path: ["A", "B"],
          source_type: "markdown",
          page_start: null,
          page_end: null,
        },
      ],
    });
    try {
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const success = await adapter.queryKnowledge({
        action: "search",
        namespace: "core",
        query: "governance",
      });
      assert.equal(success.governed_status, "SUCCESS");
      assertMatchesDeclaredOutput("zink-knowledge", success);
    } finally {
      await service.close();
    }
  });

  test("F-125: an empty result set is NO_MATCH and still passes the contract", async () => {
    const service = await knowledgeService({ results: [] });
    try {
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const noMatch = await adapter.queryKnowledge({
        action: "search",
        namespace: "core",
        query: "nothing",
      });
      assert.equal(noMatch.governed_status, "NO_MATCH");
      assertMatchesDeclaredOutput("zink-knowledge", noMatch);
    } finally {
      await service.close();
    }
  });

  test("F-125: the knowledge failure envelope passes the contract", async () => {
    const service = await knowledgeService({ error: "upstream" }, 500);
    try {
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const failure = await adapter.queryKnowledge({
        action: "search",
        namespace: "core",
        query: "governance",
      });
      assert.equal(failure.governed_status, "CONTROLLED_FAILURE");
      assertMatchesDeclaredOutput("zink-knowledge", failure);
    } finally {
      await service.close();
    }
  });

  test("F-125: an uncited row is refused and the refusal passes the contract", async () => {
    const service = await knowledgeService({
      results: [{ segment_id: "seg-1", text: "no citation here" }],
    });
    try {
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const refused = await adapter.queryKnowledge({
        action: "search",
        namespace: "core",
        query: "governance",
      });
      assert.equal(refused.governed_status, "CONTROLLED_FAILURE");
      assertMatchesDeclaredOutput("zink-knowledge", refused);
    } finally {
      await service.close();
    }
  });

  test("F-125: a numeric upstream chunk id still passes the contract", async () => {
    const service = await knowledgeService({
      results: [
        {
          segment_id: 42,
          title: "A title",
          text: "Some retrieved text.",
          citation: "notes/a.md#L1",
        },
      ],
    });
    try {
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const success = await adapter.queryKnowledge({
        action: "search",
        namespace: "core",
        query: "governance",
      });
      assert.equal(success.results[0].chunk_id, "42");
      assertMatchesDeclaredOutput("zink-knowledge", success);
    } finally {
      await service.close();
    }
  });

  test("F-570: the identity the service publishes survives into the agent's item", async () => {
    /**
     * F-570 (R10-T10-1): the Knowledgebase publishes `source_id`,
     * `source_sha256` and the span on the RESULT ITEM, but the tool contract
     * closed the item and the five-key metadata object, and the adapter rebuilt
     * each item from scratch. A governed agent therefore could not re-verify a
     * citation it had just been given: a moved or edited source produced an
     * identical citation string with no digest anywhere in the envelope.
     */
    const digest = "a".repeat(64);
    const service = await knowledgeService({
      results: [
        {
          segment_id: "seg-1",
          title: "Authority",
          text: "retrieved body",
          score: 0.91,
          source_path: "02. Books/Authority/report.pdf",
          source_type: "PDF",
          source_id: "src-1",
          source_sha256: digest,
          line_start: null,
          line_end: null,
          page_start: 2,
          page_end: 3,
          citation: "02. Books/Authority/report.pdf#page=2",
        },
      ],
    });
    try {
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const success = await adapter.queryKnowledge({
        action: "search",
        namespace: "core",
        query: "governance",
      });

      assert.equal(success.results[0].metadata.source_sha256, digest);
      assert.equal(success.results[0].metadata.source_id, "src-1");
      assert.equal(success.results[0].metadata.line_start, null);
      assert.equal(success.results[0].metadata.page_end, 3);
      assertMatchesDeclaredOutput("zink-knowledge", success);
    } finally {
      await service.close();
    }
  });

  test("F-570: a markdown line span survives, and a malformed digest is refused", async () => {
    const service = await knowledgeService({
      results: [
        {
          segment_id: "seg-2",
          title: "Note",
          text: "a body",
          score: 0.5,
          source_path: "01. Knowledge/AI/note.md",
          source_type: "MARKDOWN",
          source_id: "src-2",
          source_sha256: "not-a-digest",
          line_start: 7,
          line_end: 9,
          citation: "01. Knowledge/AI/note.md#L7-L9",
        },
      ],
    });
    try {
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const success = await adapter.queryKnowledge({
        action: "search",
        namespace: "core",
        query: "governance",
      });

      assert.equal(success.results[0].metadata.line_start, 7);
      assert.equal(success.results[0].metadata.line_end, 9);
      // The declared pattern is the guard: the envelope carries the identity or
      // carries nothing, never an upstream sentence in a digest's place.
      assert.equal(success.results[0].metadata.source_sha256, null);
      assertMatchesDeclaredOutput("zink-knowledge", success);
    } finally {
      await service.close();
    }
  });
  test("F-125: the search envelope carries no undeclared top-level key", () => {
    // The search path needs an embedding endpoint and a live index, so this
    // case is a source assertion in the repository's own idiom rather than an
    // executed call: the top-level `query` key was outside the closed output
    // object, so the search envelope could not pass its own contract.
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../zink-tools/adapters/skill-store/skill-adapter.mjs",
      ),
      "utf8",
    );
    assert.equal(
      /\n\s*query:\s*queryTextForEmbedding/u.test(source),
      false,
      "the search envelope must not carry a top-level query key",
    );
  });

  test("F-029: a model-supplied api_key never reaches the outbound request", async () => {
    // F-029 (R1-A10-04): the bearer token was resolved as
    // `this.options.apiKey || input.api_key || env`, so a payload-supplied
    // `api_key` became the credential on the only outbound internal-service
    // call this adapter makes.
    let seenAuthorization = null;
    const server = http.createServer((req, res) => {
      seenAuthorization = req.headers.authorization ?? null;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ results: [] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const previousKey = process.env.KNOWLEDGE_API_KEY;
    delete process.env.KNOWLEDGE_API_KEY;
    try {
      const adapter = new KnowledgeAdapter(`http://127.0.0.1:${port}`, {});
      await adapter.queryKnowledge({
        action: "search",
        namespace: "core",
        query: "governance",
        api_key: "model-supplied-secret",
      });
      assert.notEqual(
        seenAuthorization,
        "Bearer model-supplied-secret",
        "a payload-supplied credential must never be sent",
      );
    } finally {
      if (previousKey === undefined) delete process.env.KNOWLEDGE_API_KEY;
      else process.env.KNOWLEDGE_API_KEY = previousKey;
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("F-125: the three open output objects are closed", () => {
    const skill = JSON.parse(
      fs.readFileSync(
        path.join(CONTRACTS_DIR, "zink-skill.schema.json"),
        "utf8",
      ),
    );
    assert.equal(
      skill.$defs.output.properties.skill_content.additionalProperties,
      false,
    );
    assert.equal(
      skill.$defs.output.properties.results.items.additionalProperties,
      false,
    );
    assert.equal(
      skill.$defs.output.properties.proposal.additionalProperties,
      false,
    );
    const knowledge = JSON.parse(
      fs.readFileSync(
        path.join(CONTRACTS_DIR, "zink-knowledge.schema.json"),
        "utf8",
      ),
    );
    assert.equal(
      knowledge.$defs.output.properties.results.items.additionalProperties,
      false,
    );
  });
});
