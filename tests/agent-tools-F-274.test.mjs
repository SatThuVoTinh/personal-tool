// F-274 (R7-C1-04) -- the two published envelopes cover every registered tool
// with matching specialist vocabularies.
//
// The register's acceptance criteria:
//
//   "the two envelopes cover every registered tool with matching specialist
//    vocabularies, or the register records the owner's decision that Knowledge
//    and Skill calls are formally outside the envelope contract and the loader
//    stops treating them as members of the same family."
//
// The envelope branch is the one taken here, and it is checkable:
//
//   1. COVERAGE: every tool id the loader registers has a branch in BOTH the
//      call envelope and the result envelope. The registered set is read from
//      the loader itself (`loadToolContractSchemas`), not from a hand-written
//      list, so a new tool cannot slip past the contract family.
//   2. MATCHING VOCABULARIES: for every tool, the specialist vocabulary the
//      call branch admits equals the one the result branches admit. The two
//      halves used to disagree: the call side admitted all seven agents for
//      every tool, the result side pinned one.
//   3. THE VOCABULARY IS THE POLICY'S: the published vocabulary is the one the
//      canonical policy derives -- `getAllowedSpecialists` for the execution
//      tools, `canAccessMemoryTool` for the Knowledge and Skill tools -- so
//      the two halves cannot agree on a vocabulary no agent may use.
//   4. THE ENVELOPES ARE USABLE: a well-formed call and a well-formed result
//      for every registered tool pass the real validator, and the same call
//      with a specialist the policy does not grant is refused -- so the
//      published vocabulary is enforced, not merely declared.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

function resolveRepositoryRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...Array.from({ length: 6 }, (_v, i) =>
      path.resolve(here, ...Array.from({ length: i + 1 }, () => "..")),
    ),
    process.env.ZINK_REPO,
  ].filter(
    (candidate) => typeof candidate === "string" && candidate.length > 0,
  );
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "zink-tools", "contracts"))) {
      return candidate;
    }
  }
  throw new Error(
    "the repository root could not be resolved: run this lane from tests/ or set ZINK_REPO",
  );
}

const REPO = resolveRepositoryRoot();

// The registered tool set is read from the plugin's OWN two declarations of
// it, read as text: the manifest it ships and the loader map it builds. The
// loader module itself is NOT imported, so a lane that only needs the
// registry does not depend on the whole plugin parsing.
const PLUGIN_MANIFEST = JSON.parse(
  readFileSync(
    path.join(
      REPO,
      "integrations/openclaw/plugins/zink-governance/openclaw.plugin.json",
    ),
    "utf8",
  ),
);
const PLUGIN_SOURCE = readFileSync(
  path.join(REPO, "integrations/openclaw/plugins/zink-governance/index.mjs"),
  "utf8",
);

function loaderSchemaMap() {
  const match = /const toolSchemaMap = \{([\s\S]*?)\n\s*\};/u.exec(
    PLUGIN_SOURCE,
  );
  assert.ok(match, "the loader must publish its tool schema map");
  const entries = new Map();
  for (const entry of match[1].matchAll(
    /^\s*([a-z0-9_]+):\s*"([a-z0-9-]+)",?\s*$/gmu,
  )) {
    entries.set(entry[1], entry[2]);
  }
  return entries;
}
const { AGENT_IDS, getAllowedSpecialists, canAccessMemoryTool } = await import(
  pathToFileURL(path.join(REPO, "integrations/openclaw/lib/policy.mjs")).href
);
const {
  validateContractSchema,
  TOOL_CALL_ENVELOPE_MAX_BYTES,
  TOOL_RESULT_ENVELOPE_MAX_BYTES,
} = await import(
  pathToFileURL(
    path.join(REPO, "integrations/openclaw/topology/lib/schema.mjs"),
  ).href
);

const CALL_SCHEMA = JSON.parse(
  readFileSync(
    path.join(REPO, "zink-tools/contracts/tool-call.schema.json"),
    "utf8",
  ),
);
const RESULT_SCHEMA = JSON.parse(
  readFileSync(
    path.join(REPO, "zink-tools/contracts/tool-result.schema.json"),
    "utf8",
  ),
);

// The tool ids the LOADER registers. This is the authoritative set: the
// acceptance criteria is about the registered tools, not about a list written
// beside the contracts.
const LOADER_MAP = loaderSchemaMap();
const REGISTERED_TOOLS = [...PLUGIN_MANIFEST.contracts.tools].sort();

const CALL_ID = "00000000-0000-4000-8000-000000000001";
const DELEGATION_ID = "00000000-0000-4000-8000-000000000004";
const DIRECT_PROVENANCE = { task_id: "task-01", session_key: "sess-01" };
const DELEGATED_PROVENANCE = {
  delegation_id: DELEGATION_ID,
  task_id: "task-01",
  session_key: "sess-01",
};

// One minimal, contract-legal call and result per registered tool.
const TOOL_FIXTURES = {
  zink_sql: {
    provenance: DIRECT_PROVENANCE,
    input: { query: "SELECT 1", target_database: "knowledge" },
    output: { row_count: 0, columns: [], rows: [] },
  },
  zink_excel: {
    provenance: DELEGATED_PROVENANCE,
    input: { operation: "load", file_path: "reports/a.xlsx" },
    output: { operation: "load", success: true },
  },
  zink_power_bi: {
    provenance: DELEGATED_PROVENANCE,
    input: { operation: "load", model: "Model" },
    output: { operation: "load", model: "Model", success: true },
  },
  zink_python: {
    provenance: DELEGATED_PROVENANCE,
    input: { entrypoint: "scripts/run.py", stack: "data_plant" },
    output: { exit_code: 0, stdout: "", stderr: "" },
  },
  zink_n8n: {
    provenance: DELEGATED_PROVENANCE,
    input: { workflow_id: "data_plant_sync", payload: { target: "t" } },
    output: {
      workflow_id: "data_plant_sync",
      data: { sync_id: "s", status: "completed" },
    },
  },
  zink_skill_search: {
    provenance: DIRECT_PROVENANCE,
    input: { action: "search", namespace: "business", query: "a skill" },
    output: { action: "search", governed_status: "SUCCESS" },
  },
  zink_knowledge_search: {
    provenance: DIRECT_PROVENANCE,
    input: { action: "search", namespace: "core", query: "a document" },
    output: {
      action: "search",
      namespace: "core",
      results: [],
      total_count: 0,
      governed_status: "NO_MATCH",
    },
  },
  zink_skill_propose: {
    provenance: DELEGATED_PROVENANCE,
    input: {
      action: "propose",
      capability: "example-capability",
      version: "1.0.0",
      content: "# example\n",
      reason: "F-274 fixture",
    },
    output: { action: "propose", governed_status: "SUCCESS" },
  },
};

function branchesOf(schema) {
  return Array.isArray(schema.oneOf) ? schema.oneOf : [];
}

function toolIdOf(branch) {
  const const_ = branch?.properties?.tool_id?.const;
  return typeof const_ === "string" ? const_ : null;
}

function specialistVocabulary(branch) {
  const specialist = branch?.properties?.specialist;
  if (!specialist || typeof specialist !== "object") return null;
  if (typeof specialist.const === "string") return [specialist.const];
  if (Array.isArray(specialist.enum)) return [...specialist.enum];
  return null;
}

function callBranchesFor(toolId) {
  return branchesOf(CALL_SCHEMA).filter(
    (branch) => toolIdOf(branch) === toolId,
  );
}

function resultBranchesFor(toolId) {
  return branchesOf(RESULT_SCHEMA).filter(
    (branch) => toolIdOf(branch) === toolId,
  );
}

/**
 * The vocabulary the canonical policy derives for one tool: the specialists
 * that may call it.
 */
function policyVocabulary(toolId) {
  let execution;
  try {
    execution = [...getAllowedSpecialists(toolId)].sort();
  } catch {
    execution = [];
  }
  if (execution.length > 0) return execution;
  return AGENT_IDS.filter((agentId) =>
    canAccessMemoryTool(agentId, toolId),
  ).sort();
}

test("F-274: the loader registers the tools the envelopes must cover", () => {
  assert.deepEqual(
    REGISTERED_TOOLS,
    [
      "zink_excel",
      "zink_knowledge_search",
      "zink_n8n",
      "zink_power_bi",
      "zink_python",
      "zink_skill_propose",
      "zink_skill_search",
      "zink_sql",
    ],
    "the registered tool set is the denominator of the contract family",
  );
  // The loader's own map and the manifest it ships must name the same tools:
  // the envelope family is measured against BOTH declarations.
  assert.deepEqual(
    [...LOADER_MAP.keys()].sort(),
    REGISTERED_TOOLS,
    "the loader map and the plugin manifest must register the same tools",
  );
  for (const [toolId, schemaName] of LOADER_MAP) {
    assert.ok(
      existsSync(
        path.join(
          REPO,
          "zink-tools",
          "contracts",
          "tools",
          `${schemaName}.schema.json`,
        ),
      ),
      `${toolId} must resolve its canonical contract schema (${schemaName})`,
    );
  }
});

test("F-274: every registered tool has a branch in BOTH envelopes", () => {
  for (const toolId of REGISTERED_TOOLS) {
    const calls = callBranchesFor(toolId);
    assert.equal(
      calls.length,
      1,
      `${toolId} must have exactly one call-envelope branch (found ${calls.length})`,
    );
    const results = resultBranchesFor(toolId);
    assert.ok(
      results.length > 0,
      `${toolId} must have at least one result-envelope branch`,
    );
    const statuses = new Set(
      results.map((branch) => branch?.properties?.status?.const),
    );
    assert.deepEqual(
      [...statuses].sort(),
      ["cancelled", "error", "success", "timeout"],
      `${toolId} must publish a result branch for every envelope status`,
    );
  }
});

test("F-274: the call and result envelopes admit the SAME specialists for every tool", () => {
  for (const toolId of REGISTERED_TOOLS) {
    const callVocabulary = specialistVocabulary(callBranchesFor(toolId)[0]);
    assert.ok(
      callVocabulary !== null,
      `${toolId} must declare a specialist vocabulary in the call envelope`,
    );
    for (const branch of resultBranchesFor(toolId)) {
      const resultVocabulary = specialistVocabulary(branch);
      assert.ok(
        resultVocabulary !== null,
        `${toolId} must declare a specialist vocabulary in the result envelope`,
      );
      assert.deepEqual(
        [...resultVocabulary].sort(),
        [...callVocabulary].sort(),
        `${toolId}: the call envelope admits [${callVocabulary.join(", ")}] but the result envelope admits [${resultVocabulary.join(", ")}]`,
      );
    }
  }
});

test("F-274: the published specialist vocabulary is the one the policy derives", () => {
  for (const toolId of REGISTERED_TOOLS) {
    const expected = policyVocabulary(toolId);
    assert.ok(
      expected.length > 0,
      `${toolId} must have a policy-derived specialist vocabulary`,
    );
    const published = specialistVocabulary(callBranchesFor(toolId)[0]);
    assert.deepEqual(
      [...published].sort(),
      expected,
      `${toolId}: the envelope admits [${published.join(", ")}] but the canonical policy allows [${expected.join(", ")}]`,
    );
  }
});

test("F-274: every registered tool has a call and a result that validate", () => {
  for (const toolId of REGISTERED_TOOLS) {
    const fixture = TOOL_FIXTURES[toolId];
    assert.ok(fixture, `${toolId} must have a fixture in this lane`);
    const vocabulary = policyVocabulary(toolId);
    const call = {
      call_id: CALL_ID,
      tool_id: toolId,
      specialist: vocabulary[0],
      constraints: { timeout_seconds: 30, max_memory_mb: 512 },
      input: fixture.input,
      provenance: fixture.provenance,
    };
    assert.doesNotThrow(
      () =>
        validateContractSchema("tool-call", call, TOOL_CALL_ENVELOPE_MAX_BYTES),
      `${toolId}: a governed call must validate against the call envelope`,
    );
    const result = {
      call_id: CALL_ID,
      tool_id: toolId,
      specialist: vocabulary[0],
      status: "success",
      output: fixture.output,
      artifacts: [],
    };
    assert.doesNotThrow(
      () =>
        validateContractSchema(
          "tool-result",
          result,
          TOOL_RESULT_ENVELOPE_MAX_BYTES,
        ),
      `${toolId}: a governed result must validate against the result envelope`,
    );
  }
});

test("F-274: a specialist the policy does not grant is refused by the call envelope", () => {
  for (const toolId of REGISTERED_TOOLS) {
    const vocabulary = policyVocabulary(toolId);
    const forbidden = AGENT_IDS.find(
      (agentId) => !vocabulary.includes(agentId),
    );
    if (forbidden === undefined) {
      // The policy grants this tool to every agent, so there is no forbidden
      // specialist to try: the vocabulary itself is the whole roster.
      assert.deepEqual(
        [...vocabulary].sort(),
        [...AGENT_IDS].sort(),
        `${toolId} is granted to every agent, so its vocabulary is the whole roster`,
      );
      continue;
    }
    const fixture = TOOL_FIXTURES[toolId];
    const call = {
      call_id: CALL_ID,
      tool_id: toolId,
      specialist: forbidden,
      constraints: { timeout_seconds: 30, max_memory_mb: 512 },
      input: fixture.input,
      provenance: fixture.provenance,
    };
    assert.throws(
      () =>
        validateContractSchema("tool-call", call, TOOL_CALL_ENVELOPE_MAX_BYTES),
      /SCHEMA_VALIDATION_FAILED/u,
      `${toolId}: the call envelope must refuse the specialist '${forbidden}'`,
    );
  }
});
