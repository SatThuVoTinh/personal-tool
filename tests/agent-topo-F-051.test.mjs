// M12/T9 F-051 - the logical-artifact-path check was KEYED BY TOOL ID.
//
// The guard validated `zink_excel`'s `file_path` and `zink_python`'s
// `entrypoint` and nothing else, so a path-shaped field on any other governed
// tool was never examined and the block was skipped SILENTLY instead of
// failing closed.
//
// The published tool-call envelope names every governed tool and `$ref`s that
// tool's `$defs.input`, so the field set of every governed tool is derivable
// from the contract the call was already validated against. These lanes prove:
//
//   1. every governed tool in the published envelope has a path-shaped
//      declaration, and every declared field is a real property of that tool's
//      published input contract (the cross-check that fails closed);
//   2. only FILESYSTEM paths are declared: a knowledge `path_prefix` and a
//      power-bi `datasource` are not paths and are never run through the
//      logical-path validator;
//   3. a traversal-bearing path field is refused at ingress.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSpawnProposal } from "../integrations/openclaw/topology/lib/canonical.mjs";
import { loadContractSchema } from "../integrations/openclaw/topology/lib/schema.mjs";
import {
  createGovernanceGuard,
  PATH_SHAPED_INPUT_FIELDS,
} from "../integrations/openclaw/topology/lib/guard.mjs";
import { TOOL_POLICY } from "../integrations/openclaw/lib/policy.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const TASK_ID = "c".repeat(64);

/** The tool ids and input refs the PUBLISHED envelope declares. */
function publishedEnvelopeBranches() {
  const envelope = loadContractSchema("tool-call");
  const branches = envelope?.oneOf;
  assert.ok(Array.isArray(branches) && branches.length > 0);
  return branches.map((branch) => ({
    toolId: branch?.properties?.tool_id?.const,
    ref: branch?.properties?.input?.$ref,
  }));
}

/** Every property name a tool's input contract declares, across its branches. */
function inputPropertyNames(ref) {
  const [file, pointer] = String(ref).split("#");
  const schema = loadContractSchema(file);
  let cursor = schema;
  for (const segment of pointer.split("/").filter(Boolean))
    cursor = cursor?.[segment];
  const names = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node.properties)
      Object.keys(node.properties).forEach((key) => names.add(key));
    for (const keyword of ["oneOf", "anyOf", "allOf"])
      if (node[keyword]) visit(node[keyword]);
  };
  visit(cursor);
  return names;
}

const guardSource = readFileSync(
  path.join(
    REPO_ROOT,
    "integrations",
    "openclaw",
    "topology",
    "lib",
    "guard.mjs",
  ),
  "utf8",
);

test("F-051: the path-shaped scope is derived from the published contracts, not from tool ids", () => {
  // The guard must not carry a tool-id-keyed path check any more.
  assert.equal(
    guardSource.includes(
      "validateArtifactLogicalPath(validatedParams.input.file_path)",
    ),
    false,
    "the path check must not read one tool's field by name",
  );
  assert.equal(
    guardSource.includes(
      "validateArtifactLogicalPath(validatedParams.input.entrypoint)",
    ),
    false,
    "the path check must not read one tool's field by name",
  );
  assert.ok(
    guardSource.includes("PATH_SHAPED_INPUT_FIELDS"),
    "the declaration of the path-shaped fields must exist",
  );
  assert.ok(
    guardSource.includes("GOVERNANCE_PATH_SCOPE_UNDECLARED"),
    "a tool without a declaration must fail closed with a named code",
  );
  assert.ok(
    guardSource.includes("GOVERNANCE_PATH_SCOPE_UNENUMERABLE"),
    "a field set that cannot be enumerated must fail closed with a named code",
  );
});

test("F-051: every governed tool has a declaration and every declared field is real", () => {
  const branches = publishedEnvelopeBranches();
  assert.ok(branches.length >= 8, "the envelope declares every governed tool");
  const declaredMap = new Map(
    Object.entries(PATH_SHAPED_INPUT_FIELDS).map(([toolId, fields]) => [
      toolId,
      [...fields],
    ]),
  );
  assert.equal(Object.isFrozen(PATH_SHAPED_INPUT_FIELDS), true);
  for (const branch of branches) {
    assert.ok(
      declaredMap.has(branch.toolId),
      `${branch.toolId} has no path-shaped declaration, so its scope would be skipped silently`,
    );
    const available = inputPropertyNames(branch.ref);
    for (const field of declaredMap.get(branch.toolId))
      assert.ok(
        available.has(field),
        `${branch.toolId}.${field} is declared path-shaped but the contract does not declare it`,
      );
  }
  // A tool that the envelope names must not be missing from the declaration.
  assert.equal(
    declaredMap.size,
    branches.length,
    "the declaration must cover exactly the governed tools",
  );
});

test("F-051: only filesystem paths are path-shaped", () => {
  const declared = JSON.stringify(PATH_SHAPED_INPUT_FIELDS);
  const excel = inputPropertyNames("tools/zink-excel.schema.json#/$defs/input");
  const python = inputPropertyNames(
    "tools/zink-python.schema.json#/$defs/input",
  );
  const knowledge = inputPropertyNames(
    "tools/zink-knowledge.schema.json#/$defs/input",
  );
  const powerBi = inputPropertyNames(
    "tools/zink-power-bi.schema.json#/$defs/input",
  );
  assert.ok(excel.has("file_path") && excel.has("template_path"));
  assert.ok(python.has("entrypoint"));
  // The two fields that LOOK like paths but are not filesystem paths.
  assert.ok(knowledge.has("path_prefix"));
  assert.ok(powerBi.has("datasource"));
  assert.equal(
    declared.includes("path_prefix"),
    false,
    "a knowledge path_prefix is not a filesystem path",
  );
  assert.equal(
    declared.includes("datasource"),
    false,
    "a power-bi datasource is not a filesystem path",
  );
});

test("F-051: a traversal-bearing path field is refused at ingress", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f051-guard-"));
  try {
    const paths = {
      root,
      snapshot: path.join(root, "snapshot.json"),
      events: path.join(root, "events.jsonl"),
    };
    const proposal = buildSpawnProposal({
      task_id: TASK_ID,
      brief_revision: 1,
      node_id: "excel",
      agent_id: "excel",
      parent_agent_id: "o1",
      parent_session_key: "o1-session-1",
      parent_run_id: "o1-run-1",
      tool_call_id: "call-0",
      turn: 1,
      attempt: 1,
      expected_governance_hash: "0".repeat(64),
    });
    const snapshot = {
      sequence: 1,
      tasks: {
        [TASK_ID]: {
          task_id: TASK_ID,
          workflow_status: "EXECUTING",
          brief_state: "ACTIVE",
          brief_revision: 1,
          origin_principal_ref: "b".repeat(64),
          root_agent_id: "main",
          root_session_key: "main-session",
          root_run_id: "main-run",
          nodes: [
            { node_id: "excel", agent_id: "excel", stack_id: "data_plant" },
          ],
          delegations: {
            [proposal.delegation_id]: {
              ...proposal,
              agent_id: "excel",
              child_session_key: "excel-session-1",
              native_run_id: "excel-run-1",
              run_state: "RUNNING",
              stack_id: "data_plant",
              brief_revision: 1,
            },
          },
        },
      },
    };
    writeFileSync(paths.snapshot, JSON.stringify(snapshot));
    writeFileSync(paths.events, "");
    const guard = createGovernanceGuard({
      paths,
      manifestFor: (agentId) => ({
        expected_governance_hash: "0".repeat(64),
        observed_governance_hash: "0".repeat(64),
        allowed_tools: TOOL_POLICY[agentId] ?? [],
      }),
    });
    const context = {
      agentId: "excel",
      sessionKey: "excel-session-1",
      runId: "excel-run-1",
    };
    const call = (filePath) => ({
      toolName: "zink_excel",
      params: {
        call_id: "00000000-0000-4000-8000-000000000001",
        tool_id: "zink_excel",
        specialist: "excel",
        constraints: { timeout_seconds: 30, max_memory_mb: 512 },
        input: { operation: "load", file_path: filePath },
        provenance: {
          delegation_id: proposal.delegation_id,
          task_id: TASK_ID,
          session_key: "excel-session-1",
        },
      },
    });
    let traversal = null;
    try {
      await guard.beforeToolCall(call("../etc/passwd"), context);
    } catch (error) {
      traversal = error;
    }
    assert.equal(
      traversal?.message ?? null,
      "SCHEMA_VALIDATION_FAILED",
      "a traversal-bearing path field must be refused at ingress",
    );
    // The same call with a legitimate path is NOT refused by the path check.
    let legitimate = null;
    try {
      await guard.beforeToolCall(call("reports/budget.xlsx"), context);
    } catch (error) {
      legitimate = error;
    }
    assert.notEqual(
      legitimate?.message ?? null,
      "SCHEMA_VALIDATION_FAILED",
      "a legitimate logical path must not be refused by the path check",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
