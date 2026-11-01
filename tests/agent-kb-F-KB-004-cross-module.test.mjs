import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import { validateContractSchema } from "../integrations/openclaw/topology/lib/guard.mjs";
import {
  setContractResolutionRoots,
  TOOL_RESULT_ENVELOPE_MAX_BYTES,
} from "../integrations/openclaw/topology/lib/schema.mjs";
import { KnowledgeAdapter } from "../zink-tools/adapters/knowledge/knowledge-adapter.mjs";

let tempRoot = null;
let originalCwd = null;

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zink-kb-f-kb-004-"));
  const toolsDir = path.join(tempRoot, "zink-tools", "contracts", "tools");
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(
    path.join(toolsDir, "zink-knowledge-output.schema.json"),
    JSON.stringify(
      { $ref: "tools/zink-knowledge.schema.json#/$defs/output" },
      null,
      2,
    ),
    "utf8",
  );
  setContractResolutionRoots([tempRoot]);
  originalCwd = process.cwd();
});

after(() => {
  setContractResolutionRoots([]);
  if (originalCwd) process.chdir(originalCwd);
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

/**
 * Validates a value against a tool contract's own declared output schema.
 *
 * @param {string} toolName
 * @param {unknown} value
 * @param {string} [message]
 */
function assertMatchesDeclaredOutput(toolName, value, message) {
  assert.equal(
    validateContractSchema(
      `${toolName}-output`,
      value,
      TOOL_RESULT_ENVELOPE_MAX_BYTES,
    ),
    true,
    message ||
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

/**
 * Isolates the body of a FastAPI route function in Python source text.
 *
 * @param {string} sourceText
 * @param {string} routeDecorator
 * @returns {string}
 */
function isolateRouteBody(sourceText, routeDecorator) {
  const decoratorIndex = sourceText.indexOf(routeDecorator);
  if (decoratorIndex === -1) {
    throw new Error(
      `Route declaration '${routeDecorator}' not found in main.py`,
    );
  }
  const nextDecoratorIndex = sourceText.indexOf(
    "@app.",
    decoratorIndex + routeDecorator.length,
  );
  return nextDecoratorIndex === -1
    ? sourceText.slice(decoratorIndex)
    : sourceText.slice(decoratorIndex, nextDecoratorIndex);
}

describe("F-KB-004 — cross-module chain Knowledge response -> Tools adapter -> declared schema", () => {
  test("Test 1: Knowledge route serializers declare index_status, chunk_ordinal and return top-level index identity", () => {
    const mainPyPath = path.resolve(
      import.meta.dirname,
      "../apps/knowledge/app/main.py",
    );
    const mainPyText = fs.readFileSync(mainPyPath, "utf8");

    const routes = [
      {
        name: "get_chunk",
        decorator: '@app.get("/v1/chunk/{segment_id}"',
      },
      {
        name: "get_citation",
        decorator: '@app.get("/v1/citation/{segment_id}"',
      },
      {
        name: "get_metadata",
        decorator: '@app.get("/v1/metadata/{segment_id}"',
      },
    ];

    for (const route of routes) {
      const body = isolateRouteBody(mainPyText, route.decorator);

      assert.ok(
        body.includes('"index_status": record.index_status'),
        `Route ${route.name} is missing required declaration for key 'index_status'`,
      );
      assert.ok(
        body.includes('"chunk_ordinal": record.chunk_ordinal'),
        `Route ${route.name} is missing required declaration for key 'chunk_ordinal'`,
      );

      const returnMatch = body.match(/return\s*\{[\s\S]*?\}/u);
      assert.ok(
        returnMatch,
        `Route ${route.name} must contain a dictionary return statement`,
      );
      const returnBody = returnMatch[0];
      assert.ok(
        returnBody.includes('"index_id": record.index_id'),
        `Route ${route.name} return statement is missing required top-level key 'index_id'`,
      );
      assert.ok(
        returnBody.includes('"indexed_by_run_id": record.indexed_by_run_id'),
        `Route ${route.name} return statement is missing required top-level key 'indexed_by_run_id'`,
      );
    }
  });

  test("Test 2: end-to-end superseded segment preserves index_status, chunk_ordinal, index_id, indexed_by_run_id and passes schema", async () => {
    const supersededBody = {
      action: "retrieve",
      segment_id: "segment-1",
      index_id: "index-old",
      indexed_by_run_id: "run-old",
      results: [
        {
          segment_id: "segment-1",
          chunk_id: "segment-1",
          index_id: "index-old",
          indexed_by_run_id: "run-old",
          index_status: "SUPERSEDED",
          chunk_ordinal: 7,
          source_id: "source-1",
          source_sha256: "a".repeat(64),
          source_path: "01. Knowledge/notes.md",
          source_type: "MARKDOWN",
          title: "Superseded Architecture Notes",
          text: "Retrieved text from superseded segment.",
          heading_path: ["Architecture", "Overview"],
          line_start: 1,
          line_end: 2,
          page_start: null,
          page_end: null,
          citation: "01. Knowledge/notes.md#L1-L2",
        },
      ],
    };

    const service = await knowledgeService(supersededBody);
    try {
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const response = await adapter.queryKnowledge({
        action: "retrieve",
        chunk_id: "segment-1",
      });

      const explanation =
        "a superseded citation can now be recognised and re-derived after the surrogate segment id is deleted";

      assert.equal(
        response.results[0].metadata.index_status,
        "SUPERSEDED",
        `results[0].metadata.index_status must be 'SUPERSEDED' so that ${explanation}`,
      );
      assert.equal(
        response.results[0].metadata.chunk_ordinal,
        7,
        `results[0].metadata.chunk_ordinal must be 7 so that ${explanation}`,
      );
      assert.equal(
        response.results[0].metadata.index_id,
        "index-old",
        `results[0].metadata.index_id must be 'index-old' so that ${explanation}`,
      );
      assert.equal(
        response.results[0].metadata.indexed_by_run_id,
        "run-old",
        `results[0].metadata.indexed_by_run_id must be 'run-old' so that ${explanation}`,
      );
      assertMatchesDeclaredOutput(
        "zink-knowledge",
        response,
        `the zink-knowledge envelope must pass its declared output schema so that ${explanation}`,
      );
    } finally {
      await service.close();
    }
  });

  test("Test 3: service omitting the four fields defaults to nulls without fabrication or crash and passes schema", async () => {
    const unadornedBody = {
      action: "retrieve",
      segment_id: "segment-1",
      results: [
        {
          segment_id: "segment-1",
          chunk_id: "segment-1",
          source_id: "source-1",
          source_sha256: "a".repeat(64),
          source_path: "01. Knowledge/notes.md",
          source_type: "MARKDOWN",
          title: "Architecture Notes",
          text: "Retrieved text from chunk without index metadata.",
          heading_path: ["Architecture", "Overview"],
          line_start: 1,
          line_end: 2,
          page_start: null,
          page_end: null,
          citation: "01. Knowledge/notes.md#L1-L2",
        },
      ],
    };

    const service = await knowledgeService(unadornedBody);
    try {
      const adapter = new KnowledgeAdapter(service.endpoint, {
        apiKey: "test-key",
      });
      const response = await adapter.queryKnowledge({
        action: "retrieve",
        chunk_id: "segment-1",
      });

      assert.strictEqual(
        response.results[0].metadata.index_status,
        null,
        "results[0].metadata.index_status must be null when omitted upstream",
      );
      assert.strictEqual(
        response.results[0].metadata.chunk_ordinal,
        null,
        "results[0].metadata.chunk_ordinal must be null when omitted upstream",
      );
      assert.strictEqual(
        response.results[0].metadata.index_id,
        null,
        "results[0].metadata.index_id must be null when omitted upstream",
      );
      assert.strictEqual(
        response.results[0].metadata.indexed_by_run_id,
        null,
        "results[0].metadata.indexed_by_run_id must be null when omitted upstream",
      );
      assertMatchesDeclaredOutput("zink-knowledge", response);
    } finally {
      await service.close();
    }
  });
});
