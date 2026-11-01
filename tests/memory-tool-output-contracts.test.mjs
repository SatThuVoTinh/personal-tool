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
  test("F-KB-004: index identity, status and ordinal survive into metadata and pass schema", async () => {
    const service = await knowledgeService({
      results: [
        {
          segment_id: "seg-100",
          title: "Architecture",
          text: "chunk body",
          score: 0.88,
          source_path: "01. Knowledge/arch.md",
          source_type: "MARKDOWN",
          citation: "01. Knowledge/arch.md",
          index_id: "idx-999",
          indexed_by_run_id: "run-888",
          index_status: "SUPERSEDED",
          chunk_ordinal: 7,
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

      assert.equal(success.results[0].metadata.index_id, "idx-999");
      assert.equal(success.results[0].metadata.indexed_by_run_id, "run-888");
      assert.equal(success.results[0].metadata.index_status, "SUPERSEDED");
      assert.equal(success.results[0].metadata.chunk_ordinal, 7);
      assertMatchesDeclaredOutput("zink-knowledge", success);
    } finally {
      await service.close();
    }
  });

  test("F-KB-004: ACTIVE status and chunk_ordinal 0 are preserved", async () => {
    const service = await knowledgeService({
      results: [
        {
          segment_id: "seg-101",
          title: "Index Header",
          text: "first chunk body",
          score: 0.95,
          source_path: "01. Knowledge/intro.md",
          source_type: "MARKDOWN",
          citation: "01. Knowledge/intro.md",
          index_id: "idx-001",
          indexed_by_run_id: "run-001",
          index_status: "ACTIVE",
          chunk_ordinal: 0,
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

      assert.equal(success.results[0].metadata.index_status, "ACTIVE");
      assert.equal(success.results[0].metadata.chunk_ordinal, 0);
      assertMatchesDeclaredOutput("zink-knowledge", success);
    } finally {
      await service.close();
    }
  });

  test("F-KB-004: malformed index identity, status and ordinal fall back to null", async () => {
    const service = await knowledgeService({
      results: [
        {
          segment_id: "seg-102",
          title: "Malformed",
          text: "bad data chunk",
          score: 0.7,
          source_path: "01. Knowledge/bad.md",
          source_type: "MARKDOWN",
          citation: "01. Knowledge/bad.md",
          index_id: "",
          indexed_by_run_id: 42,
          index_status: "RETIRED",
          chunk_ordinal: -3,
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

      assert.equal(success.results[0].metadata.index_id, null);
      assert.equal(success.results[0].metadata.indexed_by_run_id, null);
      assert.equal(success.results[0].metadata.index_status, null);
      assert.equal(success.results[0].metadata.chunk_ordinal, null);
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

// ===========================================================================
// F-551 (R10-T06-3) — the governed failure code survives the transport hop
// ===========================================================================
describe("F-551 (R10-T06-3) — an object `detail` reaches the adapter envelope", () => {
  /**
   * The reader was written for FastAPI's `RequestValidationError` ARRAY body and
   * was never reconciled with the hand-raised `HTTPException` OBJECT bodies the
   * same routes produce. Measured at HEAD, `apps/knowledge/app/main.py` raises
   * 44 governed-code refusals; every one of them arrived at the adapter as
   * `HTTP_<status>`, so the governed vocabulary existed only on the producer
   * side of the hop.
   *
   * The vocabulary is READ FROM THE PRODUCER rather than restated here: every
   * refusal site is parsed, and each site resolves to the code(s) it can
   * actually raise — 19 distinct literal codes, the keys of the
   * `GOVERNED_LIFECYCLE_ERRORS` table, the `startup_error_code` values the
   * database layer sets (including the three `MigrationDigestError` codes), the
   * `SearchValidationError` codes, and the seven `ModelProbeError` codes
   * `F-515` (R10-L07-4) taught the embedding arms to carry. A governed code
   * that joins the producer without joining the reader therefore turns this
   * lane red.
   *
   * `F-552` (R10-T06-4) moved two route arms onto `_governed_lifecycle_refusal`,
   * so the producer surface is now the literal `detail={"code" …}` sites plus
   * that helper's raise calls, minus the helper's own literal, which is the sink
   * they share rather than a site of its own. The count still asserts how many
   * refusals the service can raise, not how they happen to be spelled.
   *
   * An expression shape this parser does not know is an ERROR, never a silent
   * skip: a new dynamic arm must be taught to this lane, not waived by it.
   */
  const PRODUCER = path.resolve(
    import.meta.dirname,
    "../apps/knowledge/app/main.py",
  );
  const PROBE = path.resolve(
    import.meta.dirname,
    "../apps/knowledge/app/model_probe.py",
  );
  const DATABASE = path.resolve(
    import.meta.dirname,
    "../apps/knowledge/app/database.py",
  );
  const RETRIEVAL = path.resolve(
    import.meta.dirname,
    "../apps/knowledge/app/retrieval.py",
  );

  function distinctCodes(text, pattern) {
    return [...new Set([...text.matchAll(pattern)].map((match) => match[1]))];
  }

  function producerVocabulary() {
    const source = fs.readFileSync(PRODUCER, "utf8");
    const database = fs.readFileSync(DATABASE, "utf8");
    const retrieval = fs.readFileSync(RETRIEVAL, "utf8");

    const tableCodes = distinctCodes(
      source,
      /"([A-Z][A-Z0-9_]{0,63})": \(\d{3}, (?:True|False)\)/gu,
    );
    const probeCodes = distinctCodes(
      fs.readFileSync(PROBE, "utf8"),
      /\b(EMBEDDING_[A-Z0-9_]{1,63})/gu,
    );
    const startupCodes = [
      ...new Set([
        ...distinctCodes(
          database,
          /startup_error_code = "([A-Z][A-Z0-9_]{0,63})"/gu,
        ),
        ...distinctCodes(
          database,
          /MigrationDigestError\(\s*f?"([A-Z][A-Z0-9_]{0,63})/gu,
        ),
      ]),
    ];
    const searchValidationCodes = distinctCodes(
      retrieval,
      /SearchValidationError\("([A-Z][A-Z0-9_]{0,63})"\)/gu,
    );
    const embeddingCodes = [
      ...new Set([
        ...probeCodes,
        ...tableCodes.filter((code) => code.startsWith("EMBEDDING_")),
      ]),
    ];

    const routes = [];
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
      const match = line.match(/detail=\{"code": ([^}]+)\}/u);
      if (!match) continue;
      if (/\breturn HTTPException\(status_code=status_code,/u.test(line)) {
        // The helper's sink. Its callers are the sites that reach it.
        continue;
      }
      routes.push({ line: index + 1, expression: match[1].trim() });
    }

    const dynamic = {
      'database.startup_error_code or "DATABASE_UNAVAILABLE"': startupCodes,
      code: embeddingCodes,
      "error.code": searchValidationCodes,
    };
    const sites = routes.map((site) => {
      const literal = site.expression.match(/^"([A-Z][A-Z0-9_]{0,63})"$/u);
      const codes = literal ? [literal[1]] : dynamic[site.expression];
      if (!codes || codes.length === 0) {
        throw new Error(
          `unresolved producer expression at main.py:${site.line}: ${site.expression}`,
        );
      }
      return { ...site, codes };
    });
    const helperCalls = (
      source.match(/raise _governed_lifecycle_refusal\(/gu) ?? []
    ).length;
    for (let index = 0; index < helperCalls; index += 1) {
      sites.push({
        expression: "raise _governed_lifecycle_refusal",
        codes: tableCodes,
      });
    }

    return {
      sites,
      siteCount: sites.length,
      detailArgs: (source.match(/detail=/gu) ?? []).length,
      objectSites: (source.match(/detail=\{/gu) ?? []).length,
      literals: distinctCodes(
        source,
        /detail=\{"code": "([A-Z][A-Z0-9_]{0,63})"\}/gu,
      ),
      tableCodes,
      probeCodes,
      startupCodes,
      searchValidationCodes,
      codes: [...new Set(sites.flatMap((site) => site.codes))],
    };
  }

  /**
   * A loopback service that answers the current body at the given status, so one
   * server can replay a whole vocabulary.
   *
   * @param {number} status
   */
  async function failureService(status) {
    const state = { body: "{}" };
    const server = http.createServer((_req, res) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(state.body);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    return {
      endpoint: `http://127.0.0.1:${port}`,
      serve(body) {
        state.body = JSON.stringify(body);
      },
      close: () =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    };
  }

  test("F-551: every governed code the Knowledge service raises reaches the envelope", async () => {
    const {
      sites,
      siteCount,
      detailArgs,
      objectSites,
      literals,
      tableCodes,
      probeCodes,
      startupCodes,
      searchValidationCodes,
      codes,
    } = producerVocabulary();
    assert.equal(
      siteCount,
      44,
      "the register measured 44 governed-code refusal sites; a site added or removed here must be reconciled with the reader",
    );
    assert.equal(
      detailArgs,
      objectSites,
      "every producer detail must be the governed {code} object the reader names",
    );
    assert.ok(
      literals.length >= 19 && probeCodes.length >= 6,
      `the producer vocabulary must be resolvable from source (literals: ${literals.length}, probe codes: ${probeCodes.length})`,
    );
    // The dynamic arms are part of the surface too. If one of these names went
    // away, the resolver above would still produce a set, so pin the members.
    for (const [label, members, resolved] of [
      [
        "the governed lifecycle table",
        [
          "VAULT_UNAVAILABLE",
          "EMBEDDING_FAILED",
          "EMBEDDING_INVALID_DIMENSIONS",
          "EMBEDDING_MODEL_DRIFT",
        ],
        tableCodes,
      ],
      [
        "the boot's startup_error_code",
        [
          "MIGRATION_LOCK_UNAVAILABLE",
          "KNOWLEDGE_MIGRATION_MANIFEST_UNREADABLE",
          "KNOWLEDGE_MIGRATION_DIGEST_MISMATCH",
          "KNOWLEDGE_MIGRATION_DIGEST_ADOPTED_MISMATCH",
        ],
        startupCodes,
      ],
      [
        "SearchValidationError",
        ["INVALID_SEARCH_REQUEST"],
        searchValidationCodes,
      ],
    ]) {
      for (const code of members) {
        assert.ok(
          resolved.includes(code),
          `${label} is a producer of ${code}; the lane must resolve it`,
        );
      }
    }
    // 19 literal codes plus the 14 the dynamic arms add (4 table keys, 4 boot
    // codes, 6 probe codes). Duplicates are collapsed for the replay, but every
    // one of the 44 sites contributes at least one of them.
    assert.equal(
      codes.length,
      33,
      "the distinct producer vocabulary changed; reconcile the reader and this count",
    );
    for (const site of sites) {
      assert.ok(
        site.codes.every((code) => codes.includes(code)),
        `main.py:${site.line} produces a code the replay does not cover`,
      );
    }

    // 409 is not a retryable status, so each code costs one attempt.
    const service = await failureService(409);
    try {
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      for (const code of codes) {
        service.serve({ detail: { code } });
        const result = await adapter.queryKnowledge({
          action: "search",
          namespace: "core",
          query: "governance",
        });
        assert.equal(result.governed_status, "CONTROLLED_FAILURE");
        assert.equal(
          result.error,
          code,
          `the upstream governed code must name the failure, not the status integer: ${code}`,
        );
        assertMatchesDeclaredOutput("zink-knowledge", result);
      }
    } finally {
      await service.close();
    }
  });

  test("F-551: the 503 reranker refusal carries its code and still passes the contract", async () => {
    // The row's production-reachable path: a 503 `RERANKER_UNAVAILABLE` body.
    // A tight call budget keeps the retry path from stretching the gate; the
    // envelope is reached either way.
    const service = await failureService(503);
    try {
      service.serve({ detail: { code: "RERANKER_UNAVAILABLE" } });
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const result = await adapter.queryKnowledge({
        action: "search",
        namespace: "core",
        query: "governance",
        timeout: 400,
      });
      assert.equal(result.governed_status, "CONTROLLED_FAILURE");
      assert.equal(result.error, "RERANKER_UNAVAILABLE");
      assertMatchesDeclaredOutput("zink-knowledge", result);
    } finally {
      await service.close();
    }
  });

  test("F-551: an object detail that is not code-shaped forwards no prose", async () => {
    const service = await failureService(500);
    try {
      service.serve({
        detail: {
          code: "psycopg.errors.UndefinedColumn: embedding_vector",
          msg: "column knowledge_chunks.embedding_vector does not exist",
        },
      });
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const result = await adapter.queryKnowledge({
        action: "search",
        namespace: "core",
        query: "governance",
      });
      assert.equal(
        result.error,
        "HTTP_500",
        "the status constant is the fallback when the body carries no code",
      );
      const rendered = JSON.stringify(result);
      for (const marker of ["psycopg", "embedding_vector", "UndefinedColumn"]) {
        assert.ok(
          !rendered.includes(marker),
          `no upstream prose may be forwarded: ${marker}`,
        );
      }
      assertMatchesDeclaredOutput("zink-knowledge", result);
    } finally {
      await service.close();
    }
  });

  test("F-551: an array detail keeps the existing field projection", async () => {
    const service = await failureService(422);
    try {
      service.serve({
        detail: [
          {
            type: "missing",
            loc: ["body", "query"],
            msg: "Field required",
            input: { query: "governance" },
          },
        ],
      });
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const result = await adapter.queryKnowledge({
        action: "search",
        namespace: "core",
        query: "governance",
      });
      assert.equal(
        result.error,
        "HTTP_422",
        "a validation array carries no governed code, so the status fallback stands",
      );
      assert.match(
        result.message,
        /Rejected fields: body\.query: missing/u,
        "the caller-request field projection is unchanged by the object branch",
      );
      assertMatchesDeclaredOutput("zink-knowledge", result);
    } finally {
      await service.close();
    }
  });
});

// ===========================================================================
// F-571 (R10-T10-2) — pool and page are reported separately at the consumer seam
// ===========================================================================
describe("F-571 (R10-T10-2) — the adapter forwards the service's count signals", () => {
  /**
   * `F-132`/`F-140`/`F-514` corrected the SERVICE: `/v1/search` answers with
   * `total_count` (the matches that EXIST), `returned_count` (the page),
   * `has_more`, `candidate_pool_count` and `truncated`. The adapter builds its
   * envelope independently and set `total_count` to the number of rows it
   * formatted, and the published contract declared one integer with a closed
   * envelope, so the other four signals had nowhere to go. The agent therefore
   * read the pre-F-132 truncated semantics one hop after the service fix.
   */
  const page = [
    {
      segment_id: "seg-1",
      title: "Safety stock",
      text: "Lead time variability drives safety stock.",
      score: 0.91,
      citation: "01. Knowledge/safety.md#L3",
    },
    {
      segment_id: "seg-2",
      title: "Reorder point",
      text: "The reorder point covers the lead time only.",
      score: 0.88,
      citation: "01. Knowledge/safety.md#L9",
    },
  ];

  test("F-571: a truncated page does not report its own length as the total", async () => {
    const service = await knowledgeService({
      results: page,
      total_count: 20,
      returned_count: 2,
      has_more: true,
      candidate_pool_count: 20,
      truncated: true,
    });
    try {
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const result = await adapter.queryKnowledge({
        action: "search",
        namespace: "core",
        query: "safety stock",
      });
      assert.equal(result.governed_status, "SUCCESS");
      assert.equal(
        result.total_count,
        20,
        "the service's total is forwarded, not recomputed from the page",
      );
      assert.ok(
        result.total_count > result.results.length,
        "an envelope whose total equals the page length is the pre-F-132 reading this row removes",
      );
      assert.equal(result.returned_count, 2);
      assert.equal(result.has_more, true);
      assert.equal(result.candidate_pool_count, 20);
      assert.equal(result.truncated, true);
      assertMatchesDeclaredOutput("zink-knowledge", result);
    } finally {
      await service.close();
    }
  });

  test("F-571: a body that carries no count signals still passes its own contract", async () => {
    const service = await knowledgeService({ results: page });
    try {
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const result = await adapter.queryKnowledge({
        action: "search",
        namespace: "core",
        query: "safety stock",
      });
      assert.equal(
        result.total_count,
        2,
        "with nothing from the service the page length remains the only honest count",
      );
      for (const field of [
        "returned_count",
        "has_more",
        "candidate_pool_count",
        "truncated",
      ]) {
        assert.equal(
          field in result,
          false,
          `a signal the service did not carry must not be invented: ${field}`,
        );
      }
      assertMatchesDeclaredOutput("zink-knowledge", result);
    } finally {
      await service.close();
    }
  });
});
