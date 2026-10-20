// M12/T9 F-371 - the canonical delegation id was a 64-hex sha256 digest while
// the published tool-call envelope (`zink-tools/contracts/tool-call.schema.json`,
// `$defs/delegated_provenance.delegation_id`) requires a uuid v4 and the guard
// asserts one before it resolves a delegation.
//
// The consequence was measured: EVERY delegated tool call was refused with
// AUTH_DELEGATION_NOT_FOUND before it could reach a specialist, while the
// ledger keyed the delegation under the very same 64-hex value. The ledger and
// the guard disagreed about one id.
//
// The fix keeps the derivation (the same domain tag over the same inputs) and
// changes only the RENDERING: the digest is formatted as a version-4 UUID, so
// the id stays reproducible from the spawn proposal and satisfies the contract
// the call was already validated against.
//
// The lanes below prove the three facts that matter:
//   1. the id the canonical builder produces is the shape the PUBLISHED
//      envelope requires, and it is deterministic;
//   2. a REAL delegation resolves in the guard instead of being refused;
//   3. the history the operational ledger already recorded - the 64-hex
//      rendering - still replays.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSpawnProposal,
  canonicalHash,
  deriveDelegationId,
  deriveLegacyDelegationId,
  deriveTaskId,
  GOVERNANCE_VERSION,
  SCHEMA_VERSION,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import {
  generateSchemaManifest,
  validateContract,
  verifySchemaManifestChecksums,
} from "../integrations/openclaw/topology/lib/schema.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { createGovernanceGuard } from "../integrations/openclaw/topology/lib/guard.mjs";
import { TOOL_POLICY } from "../integrations/openclaw/lib/policy.mjs";

const TASK_ID = "c".repeat(64);
const SESSION_KEY = "excel-session-1";
const RUN_ID = "excel-run-1";
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The uuid v4 pattern the PUBLISHED envelope declares. It is read from the
 * contract rather than restated, so this lane fails the moment the contract
 * and the derivation disagree.
 */
function publishedUuidV4Pattern() {
  const schema = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, "zink-tools", "contracts", "tool-call.schema.json"),
      "utf8",
    ),
  );
  return schema.$defs.uuid_v4.pattern;
}

function proposalFor(overrides = {}) {
  return buildSpawnProposal({
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
    ...overrides,
  });
}

test("F-371: the canonical delegation id is the uuid v4 the published envelope requires", () => {
  const pattern = new RegExp(publishedUuidV4Pattern(), "u");
  const id = deriveDelegationId({
    task_id: TASK_ID,
    brief_revision: 1,
    node_id: "excel",
    agent_id: "excel",
    attempt: 1,
  });
  assert.match(
    id,
    pattern,
    "the canonical id must satisfy the published uuid_v4 pattern",
  );
  assert.equal(
    id,
    deriveDelegationId({
      task_id: TASK_ID,
      brief_revision: 1,
      node_id: "excel",
      agent_id: "excel",
      attempt: 1,
    }),
    "the id must be reproducible from the spawn proposal",
  );
  assert.notEqual(
    id,
    deriveDelegationId({
      task_id: TASK_ID,
      brief_revision: 1,
      node_id: "excel",
      agent_id: "excel",
      attempt: 2,
    }),
    "a different attempt must derive a different id",
  );
  // The DERIVATION did not change: the legacy rendering is the same digest the
  // operational ledger already recorded, and the uuid is that digest.
  const legacy = deriveLegacyDelegationId({
    task_id: TASK_ID,
    brief_revision: 1,
    node_id: "excel",
    agent_id: "excel",
    attempt: 1,
  });
  assert.match(legacy, /^[a-f0-9]{64}$/u);
  assert.equal(
    legacy,
    canonicalHash("zink-delegation-id-v1", {
      task_id: TASK_ID,
      brief_revision: 1,
      node_id: "excel",
      agent_id: "excel",
      attempt: 1,
    }),
    "the digest itself must be unchanged",
  );
  assert.notEqual(legacy, id);
});

test("F-371: the published contracts accept the id the canonical builder produces", () => {
  const proposal = proposalFor();
  assert.doesNotThrow(
    () =>
      validateContract(
        "delegation-envelope",
        {
          schema_version: SCHEMA_VERSION,
          governance_version: GOVERNANCE_VERSION,
          task_id: TASK_ID,
          brief_revision: 1,
          node_id: "excel",
          delegation_id: proposal.delegation_id,
          attempt: 1,
          parent_agent_id: "o1",
          target_agent_id: "excel",
          target_stack: "data_plant",
          expected_governance_hash: "0".repeat(64),
          inputs: "work",
          input_refs: [],
          constraints: "{}",
          validation_criteria: "[]",
          remaining_task_budget: {
            revisions: 1,
            transitions: 2,
            delegated_runs: 1,
          },
          requested_output_schema: "agent-result-payload.schema.json",
        },
        32768,
      ),
    "the delegation envelope must accept the canonical id",
  );
  const event = {
    schema_version: SCHEMA_VERSION,
    governance_version: GOVERNANCE_VERSION,
    sequence: 1,
    type: "WORKFLOW_SPAWN_RESERVED",
    payload: proposal,
    created_at: "2026-10-20T00:00:00.000Z",
    previous_event_digest: null,
  };
  assert.doesNotThrow(
    () =>
      validateContract("ledger-event", {
        ...event,
        event_digest: canonicalHash("zink-ledger-event-v1", event),
      }),
    "the ledger-event contract must accept the canonical id",
  );
});

test("F-371: a real delegation RESOLVES in the guard instead of being refused", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f371-guard-"));
  try {
    const paths = {
      root,
      snapshot: path.join(root, "snapshot.json"),
      events: path.join(root, "events.jsonl"),
    };
    const proposal = proposalFor();
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
              child_session_key: SESSION_KEY,
              native_run_id: RUN_ID,
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
    const event = {
      toolName: "zink_excel",
      params: {
        call_id: "00000000-0000-4000-8000-000000000001",
        tool_id: "zink_excel",
        specialist: "excel",
        constraints: { timeout_seconds: 30, max_memory_mb: 512 },
        input: { operation: "load", file_path: "reports/budget.xlsx" },
        provenance: {
          delegation_id: proposal.delegation_id,
          task_id: TASK_ID,
          session_key: SESSION_KEY,
        },
      },
    };
    const context = {
      agentId: "excel",
      sessionKey: SESSION_KEY,
      runId: RUN_ID,
    };
    let thrown = null;
    let decision = null;
    try {
      decision = await guard.beforeToolCall(event, context);
    } catch (error) {
      thrown = error;
    }
    assert.equal(
      thrown?.message ?? null,
      null,
      `the delegated call must not be refused: ${thrown?.message ?? ""}`,
    );
    assert.ok(decision, "the guard must reach a verdict");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-371: the legacy 64-hex delegation id still replays", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f371-legacy-"));
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const origin = {
      origin: "discord",
      origin_principal_ref: "a".repeat(64),
      origin_message_id: "12345678901234567",
    };
    const taskId = deriveTaskId(origin);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
      ...origin,
      task_id: taskId,
      root_agent_id: "main",
      root_session_key: "main-session",
      root_run_id: "main-run",
    });
    recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
      task_id: taskId,
      brief_revision: 1,
      semantic_contract_status: "VALID",
      nodes: [
        {
          node_id: "o1",
          agent_id: "o1",
          stack_id: "data_plant",
          dependencies: [],
          required: true,
          input_digest: canonicalHash("zink-input-v1", "work"),
          constraints_digest: canonicalHash("zink-constraints-v1", "{}"),
          validation_digest: canonicalHash(
            "zink-validation-v1",
            "agent-result-payload.schema.json",
          ),
        },
      ],
    });
    recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
      task_id: taskId,
      actor: "user",
      channel: "approvals",
      decision: "APPROVE",
    });
    const state = readSnapshot(paths);
    // The reserve is made by the ROOT session, which the ledger can resolve.
    const legacy = {
      ...proposalFor({
        task_id: taskId,
        node_id: "o1",
        agent_id: "o1",
        parent_agent_id: "main",
        parent_session_key: "main-session",
        parent_run_id: "main-run",
        expected_governance_hash: "0".repeat(64),
      }),
      delegation_id: deriveLegacyDelegationId({
        task_id: taskId,
        brief_revision: 1,
        node_id: "o1",
        agent_id: "o1",
        attempt: 1,
      }),
    };
    let thrown = null;
    try {
      applyWorkflowEvent(
        state,
        "WORKFLOW_SPAWN_RESERVED",
        legacy,
        null,
        { replayAnchored: true },
      );
    } catch (error) {
      thrown = error;
    }
    assert.equal(
      thrown?.message ?? null,
      null,
      `the legacy delegation id must still replay: ${thrown?.message ?? ""}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-371: the contract manifest checksum is re-pinned for the widened patterns", () => {
  const verdict = verifySchemaManifestChecksums();
  assert.equal(
    verdict.valid,
    true,
    `the committed contract manifest expectation must match: ${JSON.stringify(verdict)}`,
  );
  const manifest = generateSchemaManifest();
  // The two contracts the change touched must PUBLISH their new version, so a
  // silent edit cannot leave the manifest reporting the old one.
  assert.equal(manifest.contracts["ledger-event"].version, "1.1.0");
  assert.equal(manifest.contracts["delegation-envelope"].version, "1.1.0");
});

test("F-371: the digest of the moved contracts is reported, not silently changed", () => {
  const manifest = generateSchemaManifest();
  assert.match(manifest.contracts["ledger-event"].hash, /^[a-f0-9]{64}$/u);
  assert.match(
    manifest.contracts["delegation-envelope"].hash,
    /^[a-f0-9]{64}$/u,
  );
  assert.equal(
    createHash("sha256")
      .update(
        readFileSync(
          path.join(
            REPO_ROOT,
            "integrations",
            "openclaw",
            "topology",
            "contracts",
            "ledger-event.schema.json",
          ),
        ),
      )
      .digest("hex"),
    manifest.contracts["ledger-event"].hash,
  );
});
