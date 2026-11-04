// M12/T9 - F-275 (R7-C1-05): the four schema-only capability contracts are
// validated by NO lane.
//
// MEASURED AT HEAD: `SCHEMA_ONLY_CAPABILITIES` (four ids) is consulted only
// by `isExecutableTool`, and no lane anywhere validates a payload against
// `zink-forecast`, `zink-operations-research`, `zink-simulation` or
// `zink-optimization`. Because no payload was ever checked, two contradictions
// in these four files stayed invisible:
//
//   1. an open `parameters` object that the directory's own published rule
//      (`zink-tools/contracts/README.md`: every object sets
//      `additionalProperties: false`) forbids;
//   2. a required list thin enough that an EMPTY model conforms - a
//      network-flow model with no nodes and no edges, and an optimization
//      with no variables and no constraints.
//
// This file closes (2) with the two smallest schema changes the finding
// names - `minItems` on the model structure - and it pins (1) as a measured
// inventory: every open object node in every tracked contract file is
// enumerated with a reason, so a NEW open object anywhere in the directory
// reddens this lane.
//
// (1) is reported PARTIAL: closing the free-form model-parameter bags and
// the live-surface bags (excel, power-bi, n8n) needs an owner vocabulary
// decision - a schema decision this band may not take - and the live-surface
// bags would narrow a callable tool's accepted input.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateContractSchema } from "../integrations/openclaw/topology/lib/schema.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS_DIR = path.join(REPO, "zink-tools", "contracts");

/**
 * Every object node of a schema that does NOT set `additionalProperties:
 * false` - the shape the directory README forbids.
 *
 * @param {unknown} node
 * @param {string} pointer
 * @param {string[]} [found]
 * @returns {string[]}
 */
function openObjectNodes(node, pointer = "$", found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((entry, index) =>
      openObjectNodes(entry, `${pointer}[${index}]`, found),
    );
    return found;
  }
  const type = node.type;
  const declaresObject =
    type === "object" || (Array.isArray(type) && type.includes("object"));
  const isObjectNode =
    declaresObject ||
    node.properties !== undefined ||
    node.patternProperties !== undefined ||
    node.additionalProperties !== undefined;
  if (isObjectNode && node.additionalProperties !== false) {
    found.push(`${pointer}`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "properties" ||
      key === "$defs" ||
      key === "patternProperties"
    ) {
      for (const [name, sub] of Object.entries(value ?? {})) {
        openObjectNodes(sub, `${pointer}.${key}.${name}`, found);
      }
    } else if (
      key === "items" ||
      key === "additionalProperties" ||
      key === "if" ||
      key === "then" ||
      key === "else" ||
      key === "not"
    ) {
      if (value && typeof value === "object") {
        openObjectNodes(value, `${pointer}.${key}`, found);
      }
    } else if (key === "allOf" || key === "anyOf" || key === "oneOf") {
      (Array.isArray(value) ? value : [value]).forEach((sub, index) =>
        openObjectNodes(sub, `${pointer}.${key}[${index}]`, found),
      );
    }
  }
  return found;
}

/** Every tracked contract file, relative to the contracts directory. */
function contractFiles() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.name.endsWith(".json")) out.push(rel);
    }
  };
  walk(CONTRACTS_DIR, "");
  return out.sort();
}

/**
 * The measured inventory of open object nodes, with the reason each one is
 * still open. A node that is NOT in this list is a NEW violation of the
 * directory's published closed-object rule, and this lane says so.
 */
const OPEN_OBJECT_NODES = [
  [
    "tool-call.schema.json#$.$defs.json_value.oneOf[5]",
    "generic JSON value union",
  ],
  [
    "tools/zink-excel.schema.json#$.$defs.input.oneOf[1].properties.data",
    "live-surface bag - owner decision",
  ],
  [
    "tools/zink-excel.schema.json#$.$defs.input.oneOf[3].properties.specification",
    "live-surface bag - owner decision",
  ],
  [
    "tools/zink-excel.schema.json#$.$defs.output.properties.summary",
    "live-surface bag - owner decision",
  ],
  [
    "tools/zink-forecast.schema.json#$.properties.parameters",
    "free-form model-parameter bag - owner decision",
  ],
  [
    "tools/zink-n8n.schema.json#$.$defs.data_plant_ingest_payload.properties.options",
    "live-surface bag - owner decision",
  ],
  [
    "tools/zink-operations-research.schema.json#$.properties.parameters",
    "free-form model-parameter bag - owner decision",
  ],
  [
    "tools/zink-power-bi.schema.json#$.$defs.input.oneOf[2].properties.changes",
    "live-surface bag - owner decision",
  ],
  [
    "tools/zink-power-bi.schema.json#$.$defs.output.properties.details",
    "live-surface bag - owner decision",
  ],
  [
    "tools/zink-simulation.schema.json#$.properties.distributions",
    "typed map - distribution catalogue",
  ],
  [
    "tools/zink-simulation.schema.json#$.properties.distributions.additionalProperties.properties.parameters",
    "typed map - distribution parameters",
  ],
  [
    "tools/zink-sql.schema.json#$.$defs.parameter.oneOf[0]",
    "SQL parameter branch",
  ],
  [
    "tools/zink-sql.schema.json#$.$defs.parameter.oneOf[1]",
    "SQL parameter branch",
  ],
  [
    "tools/zink-sql.schema.json#$.$defs.parameter.oneOf[2]",
    "SQL parameter branch",
  ],
  [
    "tools/zink-sql.schema.json#$.$defs.parameter.oneOf[3]",
    "SQL parameter branch",
  ],
  [
    "tools/zink-sql.schema.json#$.$defs.parameter.oneOf[4]",
    "SQL parameter branch",
  ],
  [
    "tools/zink-sql.schema.json#$.$defs.output.properties.rows.items",
    "result row - column to value map",
  ],
];

/** Validates a payload against a named canonical contract. */
function accepts(contractName, payload) {
  try {
    validateContractSchema(contractName, payload, 65536);
    return true;
  } catch {
    return false;
  }
}

describe("F-275: the schema-only capability contracts are validated by a lane", () => {
  it("a conforming forecast specification is accepted", () => {
    assert.equal(
      accepts("zink-forecast", {
        problem_type: "univariate_time_series",
        horizon: 7,
        granularity: "daily",
        target_series: "SKU-WH01-DEMAND",
        exogenous_features: ["promotion"],
      }),
      true,
    );
  });

  it("a forecast specification with an impossible horizon is refused", () => {
    assert.equal(
      accepts("zink-forecast", {
        problem_type: "univariate_time_series",
        horizon: 0,
        granularity: "daily",
        target_series: "SKU-WH01-DEMAND",
      }),
      false,
    );
  });

  it("a network-flow model with nodes and edges is accepted", () => {
    assert.equal(
      accepts("zink-operations-research", {
        model_type: "network_flow",
        nodes: [{ id: "plant_01" }, { id: "market_01" }],
        edges: [{ source: "plant_01", target: "market_01", cost: 3.5 }],
      }),
      true,
    );
  });

  it("a network-flow model with no nodes and no edges is refused", () => {
    assert.equal(
      accepts("zink-operations-research", { model_type: "network_flow" }),
      false,
      "an empty model must not be a conforming specification",
    );
  });

  it("a conforming simulation specification is accepted", () => {
    assert.equal(
      accepts("zink-simulation", {
        simulation_type: "monte_carlo",
        iterations: 1000,
        random_seed: 42,
        distributions: {
          lead_time: { type: "normal", parameters: { mean: 10, std_dev: 2 } },
        },
      }),
      true,
    );
  });

  it("a simulation specification with zero iterations is refused", () => {
    assert.equal(
      accepts("zink-simulation", {
        simulation_type: "monte_carlo",
        iterations: 0,
      }),
      false,
    );
  });

  it("a conforming optimization specification is accepted", () => {
    assert.equal(
      accepts("zink-optimization", {
        problem_class: "linear_programming",
        objective: { sense: "minimize", expression: "x + 2y" },
        variables: [{ name: "x", type: "continuous" }],
        constraints: [{ name: "budget", expression: "x + 2y <= 100" }],
      }),
      true,
    );
  });

  it("an optimization with no variables and no constraints is refused", () => {
    assert.equal(
      accepts("zink-optimization", {
        problem_class: "linear_programming",
        objective: { sense: "minimize", expression: "x + 2y" },
        variables: [],
        constraints: [],
      }),
      false,
      "an empty model must not be a conforming specification",
    );
  });

  it("every open object node in every tracked contract file is inventoried", () => {
    const found = [];
    for (const rel of contractFiles()) {
      const doc = JSON.parse(
        fs.readFileSync(path.join(CONTRACTS_DIR, rel), "utf8"),
      );
      for (const pointer of openObjectNodes(doc)) {
        found.push(`${rel}#${pointer}`);
      }
    }
    const expected = OPEN_OBJECT_NODES.map(([pointer]) => pointer).sort();
    assert.deepEqual(
      found.sort(),
      expected,
      `the open-object inventory changed. Measured now:\n${found.sort().join("\n")}`,
    );
  });

  it("every inventoried open object carries a reason", () => {
    for (const [pointer, reason] of OPEN_OBJECT_NODES) {
      assert.ok(
        typeof reason === "string" && reason.length > 0,
        `${pointer} must carry a reason`,
      );
    }
  });
});
