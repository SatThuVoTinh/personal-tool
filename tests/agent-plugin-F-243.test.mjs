// M12/T9 F-243 - no production code ever minted a tool-invocation approval
// record, so `bindInvocationApproval` was an inert control that only tests
// could satisfy.
//
// MEASURED AT HEAD: the approval resolver reads four stores - a process
// global map, `approvals.json`, `approvals/<id>.json` and the task's own
// approvals map - and NOTHING in the shipped code wrote any of them; every
// writer was a test fixture. The control therefore had no production
// reachable pass path, and its failure path (every governed call denied) was
// the only real behaviour.
//
// The plugin is the minter: it already owns the owner's approval surface, so
// the record it writes is the PUBLISHED `GovernedInvocationApproval` shape of
// `approval-request.schema.json` - the same shape the guard's resolver
// validates - and it is written under the ledger's writer lock, because the
// guard reads that store under the same lock.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");


const load = async (rel) => import(pathToFileURL(path.join(REPO_ROOT, rel)).href);

const plugin = await load(
  "integrations/openclaw/plugins/zink-governance/index.mjs",
);
const {
  bindInvocationApproval,
  resolveAuthenticatedApproval,
  whenGovernanceDependenciesReady,
} = await load("integrations/openclaw/topology/lib/guard.mjs");
const { validateContract } = await load(
  "integrations/openclaw/topology/lib/schema.mjs",
);

const TASK_ID = "c".repeat(64);
const PRINCIPAL = "b".repeat(64);
const INPUT = {
  operation: "populate",
  file_path: "reports/budget.xlsx",
  data: { values: [1, 2, 3] },
};

function mint(root, overrides = {}) {
  return plugin.mintInvocationApprovalRecord({
    paths: { root },
    taskId: TASK_ID,
    briefRevision: 1,
    toolId: "zink_excel",
    operation: "populate",
    exactTarget: "reports/budget.xlsx",
    input: INPUT,
    ownerPrincipalRef: PRINCIPAL,
    ...overrides,
  });
}

test("F-243: the minter writes one consumable record under the ledger root", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f243-"));
  const minted = mint(root);

  assert.match(
    minted.approvalId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    "the approval id must be a uuid v4, because the resolver accepts only that",
  );
  const recordPath = path.join(root, "approvals", `${minted.approvalId}.json`);
  assert.equal(existsSync(recordPath), true, "the record must be durable");
  const stored = JSON.parse(readFileSync(recordPath, "utf8"));
  assert.deepEqual(stored, minted.record);

  // The PUBLISHED contract is the authority on the record's shape.
  assert.doesNotThrow(() => validateContract("approval-request", stored));
  assert.deepEqual(
    Object.keys(stored).sort(),
    [
      "approval_scope_digest",
      "brief_revision",
      "exact_target",
      "expires_at",
      "operation",
      "owner_principal_ref",
      "task_id",
      "tool_id",
    ],
    "the record must carry exactly the published fields",
  );
});

test("F-243: the guard's own resolver finds the minted record", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f243b-"));
  const minted = mint(root);
  const resolved = resolveAuthenticatedApproval(
    { root },
    minted.approvalId,
  );
  assert.ok(resolved, "the resolver must find the minted record");
  assert.equal(resolved.task_id, TASK_ID);
  assert.equal(resolved.owner_principal_ref, PRINCIPAL);
  assert.equal(resolved.approval_scope_digest, minted.record.approval_scope_digest);
});

test("F-243: the record is consumable exactly once, and the replay is named", async () => {
  await whenGovernanceDependenciesReady();
  const root = mkdtempSync(path.join(os.tmpdir(), "f243c-"));
  const minted = mint(root);
  const base = {
    paths: { root },
    approvalId: minted.approvalId,
    taskId: TASK_ID,
    briefRevision: 1,
    originPrincipalRef: PRINCIPAL,
    toolId: "zink_excel",
    operationName: "populate",
    actualTarget: "reports/budget.xlsx",
    input: INPUT,
    runId: "run-1",
    currentTime: Date.now(),
  };

  const expiry = bindInvocationApproval(base);
  assert.equal(typeof expiry, "number", "the first bind must succeed");

  assert.throws(
    () => bindInvocationApproval({ ...base, currentTime: Date.now() }),
    { message: "AUTH_APPROVAL_REPLAYED" },
    "the second consume must be refused by name",
  );
});

test("F-243: a record whose scope does not match the call is refused", async () => {
  await whenGovernanceDependenciesReady();
  const root = mkdtempSync(path.join(os.tmpdir(), "f243d-"));
  const minted = mint(root);
  assert.throws(
    () =>
      bindInvocationApproval({
        paths: { root },
        approvalId: minted.approvalId,
        taskId: TASK_ID,
        briefRevision: 1,
        originPrincipalRef: PRINCIPAL,
        toolId: "zink_excel",
        operationName: "populate",
        // A DIFFERENT target than the owner approved.
        actualTarget: "reports/other.xlsx",
        input: INPUT,
        runId: "run-1",
        currentTime: Date.now(),
      }),
    { message: "AUTH_APPROVAL_INVALID" },
    "an approval must not authorise a different target",
  );
});

test("F-243: the minter refuses to mint without an owner or a known operation", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f243e-"));
  assert.throws(
    () => mint(root, { ownerPrincipalRef: "" }),
    /APPROVAL_PRINCIPAL_REQUIRED/u,
  );
  assert.throws(
    () => mint(root, { operation: "publish" }),
    /APPROVAL_OPERATION_UNKNOWN/u,
  );
});



