// M12/T9-R4 - F-536 (legacy R10-T03-1): the topology interpreter treated
// KEYWORDS as an admission list, and `default` - a JSON Schema annotation the
// host engine accepts - was absent. The two published contracts that document
// optional inputs with `default` were therefore unsatisfiable the moment a
// caller sent the field. This gate walks every schema position of every
// tracked contract against KEYWORDS, and proves both published optional inputs
// validate through the tool-call envelope.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  KEYWORDS,
  TOOL_CALL_ENVELOPE_MAX_BYTES,
  validateContractSchema,
} from "../integrations/openclaw/topology/lib/schema.mjs";

const SCHEMA_FILES = execFileSync("git", ["ls-files", "*.schema.json"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((file) => file.trim().length > 0);

/** Schema-valued children, and whether each is a map, array or single node. */
const CHILDREN = Object.freeze({
  $defs: "map",
  properties: "map",
  patternProperties: "map",
  items: "schema-or-array",
  additionalProperties: "schema",
  allOf: "array",
  anyOf: "array",
  oneOf: "array",
  not: "schema",
  if: "schema",
  then: "schema",
  else: "schema",
});

function walkSchema(node, at, unknown) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  for (const key of Object.keys(node)) {
    if (!KEYWORDS.has(key)) unknown.push(`${at}: ${key}`);
  }
  for (const [key, kind] of Object.entries(CHILDREN)) {
    const value = node[key];
    if (value === undefined) continue;
    if (kind === "map" && value && typeof value === "object") {
      for (const [name, child] of Object.entries(value))
        walkSchema(child, `${at}/${key}/${name}`, unknown);
    } else if (kind === "array" && Array.isArray(value)) {
      value.forEach((child, index) =>
        walkSchema(child, `${at}/${key}[${index}]`, unknown),
      );
    } else if (kind === "schema-or-array") {
      if (Array.isArray(value)) {
        value.forEach((child, index) =>
          walkSchema(child, `${at}/${key}[${index}]`, unknown),
        );
      } else {
        walkSchema(value, `${at}/${key}`, unknown);
      }
    } else if (kind === "schema") {
      walkSchema(value, `${at}/${key}`, unknown);
    }
  }
}

test("F-536: every schema position uses only admitted keywords", () => {
  const unknown = [];
  for (const file of SCHEMA_FILES) {
    const schema = JSON.parse(readFileSync(file, "utf8"));
    walkSchema(schema, file, unknown);
  }
  assert.deepEqual(
    unknown,
    [],
    `unknown schema keywords (F-536 was exactly the two 'default' nodes): ${unknown.join(", ")}`,
  );
});

test("F-536: the published optional inputs validate through the tool-call envelope", () => {
  const base = {
    call_id: "00000000-0000-4000-8000-000000000000",
    constraints: {},
    provenance: { task_id: "task", session_key: "session" },
  };
  assert.doesNotThrow(() =>
    validateContractSchema(
      "tool-call",
      {
        ...base,
        specialist: "sql",
        tool_id: "zink_sql",
        input: {
          query: "SELECT 1",
          target_database: "analytics_read",
          max_rows: 10,
        },
      },
      TOOL_CALL_ENVELOPE_MAX_BYTES,
    ),
  );
  assert.doesNotThrow(() =>
    validateContractSchema(
      "tool-call",
      {
        ...base,
        specialist: "main",
        tool_id: "zink_knowledge_search",
        input: {
          action: "search",
          namespace: "core",
          query: "supply chain",
          top_k: 5,
        },
      },
      TOOL_CALL_ENVELOPE_MAX_BYTES,
    ),
  );
});
