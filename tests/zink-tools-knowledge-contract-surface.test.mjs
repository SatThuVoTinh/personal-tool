// M12/T9 - F-234 (R7-D1-04): the published knowledge input schema and the
// live registration seam must describe the SAME surface.
//
// MEASURED AT HEAD: the plugin builds the `zink_knowledge_search` parameter
// object by hand and reads some of its property shapes OUT OF the contract
// (`query`, `namespace`, and - because the contract did not declare them -
// the `limit` / `primary_topic` fallbacks), but the contract's `$defs.input`
// never declared `limit`, `primary_topic`, `path_prefix`, `rerank`,
// `task_id`, `session_key` or `run_id`. The published contract therefore
// FORBIDDEN seven properties the live seam accepts, and the two shapes
// disagreed.
//
// The defect this file closes: the published contract no longer forbids
// anything the live registry declares, and the two shapes are compared
// mechanically - property by property, and payload by payload.
//
// The OTHER half of the finding - the registration seam must VALIDATE the
// published `$defs.input` instead of a hand-built registry object - lives in
// `integrations/openclaw/plugins/zink-governance/index.mjs` (the
// `def.parameters || toolContracts[toolId]?.parameters` preference and the
// hand-built registry object). This band assigns that file to another agent;
// it is reported, not fixed here.
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerTools,
  loadToolContractSchemas,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import {
  validateContractSchema,
  setContractResolutionRoots,
} from "../integrations/openclaw/topology/lib/schema.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS_DIR = path.join(REPO, "zink-tools", "contracts", "tools");

/**
 * The correlation identity the TRUSTED runtime context owns. These are never
 * model-fillable (M12/T9 F-041), so the published input contract does not
 * declare them; the live registry stopped declaring them in the same band.
 */
const TRUSTED_CORRELATION_FIELDS = ["task_id", "session_key", "run_id"];

/** The properties the live registry declares for the knowledge tool. */
function captureRegistryParameters() {
  const tools = [];
  const api = {
    registerTool: (def) => tools.push(def),
    pluginConfig: {},
    logger: {},
  };
  const contracts = loadToolContractSchemas();
  registerTools(api, { toolContracts: contracts });
  const knowledge = tools.find((tool) => tool.name === "zink_knowledge_search");
  assert.ok(knowledge, "the knowledge tool must be registered");
  assert.ok(knowledge.parameters, "the knowledge tool must publish a shape");
  return knowledge.parameters;
}

function contractInput() {
  const raw = JSON.parse(
    fs.readFileSync(
      path.join(CONTRACTS_DIR, "zink-knowledge.schema.json"),
      "utf8",
    ),
  );
  return raw.$defs.input;
}

// The contract validator resolves a contract by NAME, and the tool contracts
// live in `zink-tools/contracts/tools/`. A pointer file in a materialised
// tree is how this repository reaches a named contract's `$defs.input`
// (the idiom `tests/memory-tool-output-contracts.test.mjs` uses for
// `$defs.output`).
let tempRoot = null;
before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zink-knowledge-input-"));
  const toolsDir = path.join(tempRoot, "zink-tools", "contracts", "tools");
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(
    path.join(toolsDir, "zink-knowledge-input.schema.json"),
    JSON.stringify(
      { $ref: "tools/zink-knowledge.schema.json#/$defs/input" },
      null,
      2,
    ),
    "utf8",
  );
  setContractResolutionRoots([tempRoot]);
});
after(() => {
  setContractResolutionRoots([]);
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

/** Validates a payload against the published `$defs.input`. */
function acceptsInput(payload) {
  try {
    validateContractSchema("zink-knowledge-input", payload, 65536);
    return true;
  } catch {
    return false;
  }
}

describe("F-234: the published knowledge input schema and the live registry agree", () => {
  it("every property the live registry declares is declared by the published contract", () => {
    const registry = captureRegistryParameters();
    const contract = contractInput();
    const declared = new Set(Object.keys(contract.properties ?? {}));
    const missing = Object.keys(registry.properties ?? {}).filter(
      (key) => !declared.has(key) && !TRUSTED_CORRELATION_FIELDS.includes(key),
    );
    assert.deepEqual(
      missing,
      [],
      "the published contract must not forbid a property the live seam accepts",
    );
  });

  it("the trusted-runtime correlation fields are not model-fillable inputs", () => {
    // M12/T9 F-041: `task_id`, `session_key` and `run_id` are the trusted
    // runtime context's correlation identity. The published input contract
    // closes its objects, so a contract that declared them would advertise
    // them as model-fillable - which is exactly what F-041 removed from the
    // live registry.
    const contract = contractInput();
    for (const key of TRUSTED_CORRELATION_FIELDS) {
      assert.equal(
        Object.hasOwn(contract.properties ?? {}, key),
        false,
        `${key} must not be a model-fillable input`,
      );
    }
  });

  it("the contract declares exactly the registry's properties plus the two the adapter needs", () => {
    const registry = captureRegistryParameters();
    const contract = contractInput();
    const registryKeys = new Set(Object.keys(registry.properties ?? {}));
    const extra = Object.keys(contract.properties ?? {}).filter(
      (key) => !registryKeys.has(key),
    );
    // `chunk_id` (the retrieve/citation/metadata identity) and `top_k` (the
    // limit alias) are read by the knowledge adapter and are simply missing
    // from the registry object. The contract is the superset; the registry's
    // omission of these two is reported, not silently accepted.
    assert.deepEqual(extra.sort(), ["chunk_id", "top_k"]);
  });

  it("the contract's required keys are declared properties", () => {
    const contract = contractInput();
    for (const key of contract.required ?? []) {
      assert.ok(
        Object.hasOwn(contract.properties ?? {}, key),
        `the required key '${key}' must be a declared property`,
      );
    }
    assert.equal(contract.additionalProperties, false);
  });

  it("a payload carrying every property the live seam accepts passes the published contract", () => {
    const registry = captureRegistryParameters();
    const payload = { action: "search", namespace: "core" };
    for (const [key, shape] of Object.entries(registry.properties ?? {})) {
      if (key in payload) continue;
      // The trusted-runtime correlation fields are not model-fillable
      // (M12/T9 F-041), so they are not part of the accepted surface.
      if (TRUSTED_CORRELATION_FIELDS.includes(key)) continue;
      if (Array.isArray(shape?.enum) && shape.enum.length > 0)
        payload[key] = shape.enum[0];
      else if (shape?.type === "integer") payload[key] = 5;
      else if (shape?.type === "boolean") payload[key] = true;
      else payload[key] = "core";
    }
    assert.ok(
      acceptsInput(payload),
      "the live accepted surface must satisfy the published contract",
    );
  });

  it("the published contract still refuses an undeclared property", () => {
    assert.equal(
      acceptsInput({
        action: "search",
        namespace: "core",
        not_a_governed_property: "x",
      }),
      false,
      "the closed-object rule must keep biting",
    );
  });
});
