import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AGENT_SPAWN_POLICY,
  GOVERNANCE_PLUGIN_ALLOWLIST,
  OPENCLAW_RELEASE,
  agentInstructions,
  buildConfig,
  governanceHash,
  governanceManifest,
} from "../integrations/openclaw/lib/policy.mjs";
import {
  BUDGETS,
  appendEvent,
  emptySnapshot,
  ledgerPaths,
  readSnapshot,
  reserveBudget,
  reserveBudgetAtomically,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  canonicalHash,
  deriveDelegationId,
  derivePrincipalRef,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import {
  classifyDuplicate,
  createTrustedResultEnvelope,
  reasonEmitterAllowed,
  revisionCanCarryForward,
  sanitizeDelegationText,
  workflowAggregate,
} from "../integrations/openclaw/topology/lib/runtime.mjs";

const identifiers = {
  discordGuildId: "12345678901234567",
  discordOwnerId: "32345678901234567",
  discordOfficeChannelId: "22345678901234567",
  discordResultsForumId: "42345678901234567",
  discordApprovalsForumId: "52345678901234567",
  discordIncidentsForumId: "62345678901234567",
};

test("R11 freezes five-stack topology and exact native tool policy", () => {
  const config = buildConfig({ stateDir: "C:/state", identifiers });
  assert.deepEqual(config.agents.defaults.subagents, {
    maxSpawnDepth: 2,
    maxChildrenPerAgent: 4,
    maxConcurrent: 4,
    runTimeoutSeconds: 300,
    announceTimeoutMs: 120000,
    requireAgentId: true,
  });
  assert.deepEqual(config.tools.subagents, {
    tools: { alsoAllow: ["session_status"] },
  });
  assert.equal(config.tools.agentToAgent.enabled, false);
  assert.equal(config.tools.sessions_spawn.attachments.enabled, false);
  assert.equal(
    config.plugins.entries["zink-governance"].config.ownerDiscordId,
    identifiers.discordOwnerId,
  );
  assert.deepEqual(
    config.agents.list.find((agent) => agent.id === "main").subagents
      .allowAgents,
    AGENT_SPAWN_POLICY.main,
  );
  assert.deepEqual(
    config.agents.list.find((agent) => agent.id === "o1").subagents.allowAgents,
    AGENT_SPAWN_POLICY.o1,
  );
  assert.deepEqual(
    config.agents.list.find((agent) => agent.id === "o2").subagents.allowAgents,
    AGENT_SPAWN_POLICY.o2,
  );
  for (const id of ["excel", "power-bi", "sql", "python"]) {
    const agent = config.agents.list.find((entry) => entry.id === id);
    assert.deepEqual(agent.subagents.allowAgents, []);
    assert.deepEqual(agent.tools, { profile: "minimal" });
  }
  assert.equal(OPENCLAW_RELEASE, "2026.6.34");
  assert.deepEqual(config.plugins.allow, GOVERNANCE_PLUGIN_ALLOWLIST);
});

test("R11 canonical identity and delegation hashes are deterministic and domain separated", () => {
  const identity = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: "12345678901234567",
  };
  assert.equal(
    deriveTaskId(identity),
    deriveTaskId({ ...identity, origin_session_key: "runtime-changed" }),
  );
  assert.notEqual(
    canonicalHash("zink-task-id-v1", identity),
    canonicalHash("zink-delegation-id-v1", identity),
  );
  assert.equal(
    derivePrincipalRef("identity-key", "32345678901234567").length,
    64,
  );
  const delegation = {
    task_id: "b".repeat(64),
    brief_revision: 1,
    node_id: "semantic",
    agent_id: "o1",
    attempt: 1,
  };
  assert.equal(
    deriveDelegationId(delegation),
    deriveDelegationId({ ...delegation }),
  );
});

test("R11 ledger reserves monotonic task-global budgets and chains events", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r11-ledger-"));
  try {
    const paths = ledgerPaths(root);
    let snapshot = emptySnapshot();
    snapshot = appendEvent(paths, snapshot, "TASK_CREATED", {
      task_id: "a".repeat(64),
    });
    snapshot = reserveBudgetAtomically(
      paths,
      snapshot,
      "a".repeat(64),
      "delegated_runs",
      1,
    );
    snapshot = appendEvent(paths, snapshot, "DELEGATION_RESERVED", {
      task_id: "a".repeat(64),
    });
    assert.equal(readSnapshot(paths).sequence, snapshot.sequence);
    assert.equal(snapshot.sequence, 3);
    assert.equal(
      readFileSync(paths.events, "utf8").trim().split("\n").length,
      3,
    );
    assert.throws(
      () =>
        reserveBudget(
          {
            ...snapshot,
            tasks: {
              ["a".repeat(64)]: {
                revisions_used: 1,
                transitions_used: 0,
                delegated_runs_used: BUDGETS.maxTotalDelegatedRunsPerTask,
              },
            },
          },
          "a".repeat(64),
          "delegated_runs",
        ),
      /budget exhausted/u,
    );
    const corrupted = readFileSync(paths.events, "utf8").replace(
      "DELEGATION_RESERVED",
      "CORRUPTED",
    );
    writeFileSync(paths.events, corrupted, "utf8");
    assert.throws(() => readSnapshot(paths), /Ledger corruption/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R11 governance manifests are role-specific and injected into every workspace contract", () => {
  assert.notEqual(governanceHash("main"), governanceHash("python"));
  assert.equal(governanceManifest("python").runtime_version, "2026.6.34");
  assert.match(agentInstructions("main"), /sessions_yield is allowed only/u);
  assert.match(
    agentInstructions("python"),
    /sessions_yield and sessions_spawn are unavailable/u,
  );
});

test("R11 separates agent claims from trusted result acceptance and redacts handoffs", () => {
  const payload = {
    outcome_claim: "COMPLETE",
    reason_claim: "NONE",
    output: "validated",
  };
  const envelope = createTrustedResultEnvelope({
    payload,
    lineage: {
      task_id: "a".repeat(64),
      brief_revision: 1,
      node_id: "python",
      agent_id: "python",
      stack_id: "intelligence",
      attempt: 1,
      native_run_id: "run-1",
    },
    governance: {
      expected_governance_hash: "b".repeat(64),
      observed_governance_hash: "b".repeat(64),
    },
    runState: "COMPLETE",
  });
  assert.equal(envelope.accepted_outcome_status, "COMPLETE");
  assert.equal(envelope.run_state, "COMPLETE");
  assert.equal(reasonEmitterAllowed("RUN_TIMEOUT", "agent"), false);
  assert.equal(reasonEmitterAllowed("RUN_TIMEOUT", "runtime"), true);
  assert.match(
    sanitizeDelegationText("token=real-secret /home/private/data.csv"),
    /REDACTED_SECRET/u,
  );
  assert.doesNotMatch(
    sanitizeDelegationText("token=real-secret /home/private/data.csv"),
    /real-secret|\/home\/private/u,
  );
});

test("R11 duplicate, aggregation and supersession rules are deterministic", () => {
  const base = {
    delegation_id: "d".repeat(64),
    native_run_id: "run-1",
    payload_digest: "p".repeat(64),
  };
  assert.equal(classifyDuplicate(base, base), "IDEMPOTENT_DUPLICATE");
  assert.equal(
    classifyDuplicate(base, { ...base, payload_digest: "q".repeat(64) }),
    "CONFLICT_REJECTED",
  );
  assert.equal(
    workflowAggregate([
      { required: true, outcome_status: "COMPLETE" },
      { required: false, outcome_status: "FAILED" },
    ]),
    "COMPLETE",
  );
  assert.equal(
    workflowAggregate([{ required: true, outcome_status: "PARTIAL" }]),
    "PARTIAL",
  );
  assert.equal(
    revisionCanCarryForward({
      producerStatus: "COMPLETE",
      referenceStatus: "VALID",
      dependencyDigestsMatch: true,
      constraintsUnchanged: true,
    }),
    true,
  );
  assert.equal(
    revisionCanCarryForward({
      producerStatus: "COMPLETE",
      referenceStatus: "VALID",
      dependencyDigestsMatch: false,
      constraintsUnchanged: true,
    }),
    false,
  );
});
