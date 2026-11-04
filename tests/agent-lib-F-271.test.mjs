// M12/T9 F-271 (R7-C1-01): the approval scope digest for `zink_power_bi bind`
// was derived from input keys its own closed contract forbids, so the approved
// datasource was not bound.
//
// The material-scope reader read `source_table`/`target_table` and
// `prompt`/`template` - keys the published `bind` and `generate` branches never
// declare. Every validated call has already passed the closed schema, so those
// keys were undefined by construction: the derived material set was always
// empty and ONE digest covered every datasource.
//
// RED NOTE FOR THE OWNER: the reader change alters `approval_scope_digest` for
// every existing power-bi bind and excel generate approval. Durable approval
// records minted with the OLD material set stop validating and must be
// re-minted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  deriveApprovalMaterialParameters,
  deriveApprovalScopeDigest,
} from "../integrations/openclaw/lib/policy.mjs";

const CONTRACT_DIR = new URL("../zink-tools/contracts/tools/", import.meta.url);

function readContract(name) {
  return JSON.parse(
    readFileSync(new URL(`${name}.schema.json`, CONTRACT_DIR), "utf8"),
  );
}

/**
 * The keys every governed tool-operation pair declares.
 *
 * `excel` and `power-bi` declare one branch per operation (`oneOf`); `python`
 * and `sql` declare a single input object; `n8n` declares one branch per
 * workflow, and every branch declares `payload`.
 */
const GOVERNED_PAIRS = Object.freeze([
  {
    tool: "zink_excel",
    operation: "populate",
    declared: ["operation", "file_path", "template_path", "data"],
  },
  {
    tool: "zink_excel",
    operation: "generate",
    declared: ["operation", "file_path", "specification"],
  },
  {
    tool: "zink_power_bi",
    operation: "bind",
    declared: ["operation", "model", "datasource", "tables"],
  },
  {
    tool: "zink_power_bi",
    operation: "update",
    declared: ["operation", "model", "changes"],
  },
  {
    tool: "zink_python",
    operation: "execute",
    declared: ["entrypoint", "args", "stack"],
  },
  {
    tool: "zink_n8n",
    operation: "trigger",
    declared: ["workflow_id", "payload"],
  },
  {
    tool: "zink_sql",
    operation: "query",
    declared: ["query", "target_database", "max_rows", "parameters"],
  },
]);

/**
 * A probe input that carries EVERY key any governed reader could read, with a
 * distinct sentinel per key, so a reader that copies an undeclared key shows
 * up in the material set.
 */
function probeInput() {
  const input = {};
  for (const key of [
    "operation",
    "model",
    "datasource",
    "tables",
    "source_table",
    "target_table",
    "changes",
    "file_path",
    "template_path",
    "data",
    "prompt",
    "template",
    "specification",
    "entrypoint",
    "args",
    "stack",
    "workflow_id",
    "payload",
    "query",
    "target_database",
    "max_rows",
    "parameters",
  ]) {
    input[key] = `probe-${key}`;
  }
  return input;
}

test("F-271: the material reader and the published input branch declare the same key set", () => {
  const probe = probeInput();
  for (const pair of GOVERNED_PAIRS) {
    const material = deriveApprovalMaterialParameters(
      pair.tool,
      pair.operation,
      probe,
    );
    const undeclared = Object.keys(material).filter(
      (key) => !pair.declared.includes(key),
    );
    assert.deepEqual(
      undeclared,
      [],
      `${pair.tool}/${pair.operation}: the reader reads keys the contract does not declare: ${undeclared.join(", ")}`,
    );
  }
});

test("F-271: the contract branch a governed pair names really declares those keys", () => {
  // The lane above is only as good as the declared set it compares against, so
  // the declared set is read back from the published contract itself.
  const excel = readContract("zink-excel");
  const powerBi = readContract("zink-power-bi");
  const branch = (contract, operation) =>
    contract.$defs.input.oneOf.find(
      (candidate) => candidate.properties.operation?.const === operation,
    );
  assert.deepEqual(
    Object.keys(branch(excel, "generate").properties).sort(),
    [
      ...GOVERNED_PAIRS.find(
        (p) => p.tool === "zink_excel" && p.operation === "generate",
      ).declared,
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(branch(powerBi, "bind").properties).sort(),
    [
      ...GOVERNED_PAIRS.find(
        (p) => p.tool === "zink_power_bi" && p.operation === "bind",
      ).declared,
    ].sort(),
  );
});

test("F-271: two binds differing only in datasource produce different approval scope digests", () => {
  const digestFor = (input) =>
    deriveApprovalScopeDigest({
      task_id: "task-1",
      brief_revision: 1,
      tool_id: "zink_power_bi",
      operation: "bind",
      exact_target: "model-M",
      material_parameters: deriveApprovalMaterialParameters(
        "zink_power_bi",
        "bind",
        input,
      ),
      expires_at: "2030-01-01T00:00:00.000Z",
    });
  const first = digestFor({ operation: "bind", model: "M", datasource: "A" });
  const second = digestFor({ operation: "bind", model: "M", datasource: "B" });
  assert.notEqual(
    first,
    second,
    "an approval for one datasource must not authorize another",
  );
});

test("F-271: two binds differing only in tables produce different approval scope digests", () => {
  const digestFor = (input) =>
    deriveApprovalScopeDigest({
      task_id: "task-1",
      brief_revision: 1,
      tool_id: "zink_power_bi",
      operation: "bind",
      exact_target: "model-M",
      material_parameters: deriveApprovalMaterialParameters(
        "zink_power_bi",
        "bind",
        input,
      ),
      expires_at: "2030-01-01T00:00:00.000Z",
    });
  const first = digestFor({
    operation: "bind",
    model: "M",
    datasource: "A",
    tables: ["T1"],
  });
  const second = digestFor({
    operation: "bind",
    model: "M",
    datasource: "A",
    tables: ["T2"],
  });
  assert.notEqual(first, second);
});

test("F-271: the excel generate material set is the declared specification, and the exact target is not a material parameter", () => {
  const material = deriveApprovalMaterialParameters("zink_excel", "generate", {
    operation: "generate",
    file_path: "data/out.xlsx",
    specification: { sheets: ["one"] },
  });
  assert.deepEqual(material, { specification: { sheets: ["one"] } });
  assert.equal(
    Object.hasOwn(material, "file_path"),
    false,
    "file_path is the exact target, and the digest already binds it",
  );
});
