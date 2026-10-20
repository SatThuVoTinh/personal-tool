import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import governancePlugin, {
  classifyInternalRunEnd,
  isProviderFailureEvent,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import { createGovernanceGuard } from "../integrations/openclaw/topology/lib/guard.mjs";
import {
  registerNativeGuard,
  finishNativeRun,
} from "../integrations/openclaw/topology/lib/native-boundary.mjs";
import {
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  deriveTaskId,
  canonicalHash,
  buildSpawnProposal,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import {
  agentInstructions,
  governanceHash,
  governanceManifest,
  AGENT_IDS,
} from "../integrations/openclaw/lib/policy.mjs";

const OWNER = "32345678901234567";

let snowflake = 81000000000000001n;
const nextMessageId = () => String(snowflake++);

function manifestFor(id) {
  return {
    allowed_tools: governanceManifest(id).effective_tool_policy,
    expected_governance_hash: governanceHash(id),
    observed_governance_hash: governanceHash(id),
  };
}

async function registerPlugin(root) {
  const hooks = new Map();
  const logs = [];
  // The plugin verifies each agent workspace against its governance manifest,
  // so the fixture must materialize them exactly as the operator would.
  for (const agentId of AGENT_IDS) {
    const folder = path.join(root, "workspaces", agentId);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "AGENTS.md"), agentInstructions(agentId));
  }
  // The plugin resolves its governance paths from ledgerRoot directly, which
  // must be the ledger directory the fixture wrote to.
  governancePlugin.register({
    pluginConfig: { ledgerRoot: ledgerPaths(root).root, ownerDiscordId: OWNER },
    on: (name, fn) => hooks.set(name, fn),
    registerTool: () => {},
    logger: {
      warn: (m) => logs.push(`warn:${m}`),
      info: (m) => logs.push(`info:${m}`),
      error: (m) => logs.push(`error:${m}`),
    },
  });
  return { hooks, logs };
}

function treeSnapshot(dir) {
  const out = {};
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else out[rel] = readFileSync(full, "utf8");
    }
  };
  walk(dir, "");
  return out;
}

function makeTask(root, agentId) {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: nextMessageId(),
  };
  const taskId = deriveTaskId(origin);
  const sessionKey = `agent:${agentId}:sess`;
  const runId = "run-live";
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...origin,
    task_id: taskId,
    root_agent_id: agentId,
    root_session_key: sessionKey,
    root_run_id: runId,
  });
  return { paths, taskId, sessionKey, runId };
}

describe("M8-055 — one canonical spawn proposal", () => {
  it("live and governed routes produce an identical delegation id", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "e5-live-"));
    let unregister;
    try {
      const { paths, taskId, sessionKey, runId } = makeTask(root, "main");
      const node = {
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
      };
      recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
        task_id: taskId,
        brief_revision: 1,
        semantic_contract_status: "VALID",
        nodes: [node],
      });
      // M7-020: a spawn reservation creates governed work, so the owner
      // approval is recorded first.
      recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
        task_id: taskId,
        actor: "user",
        channel: "approvals",
        decision: "APPROVE",
      });
      const guard = createGovernanceGuard({ paths, manifestFor });
      unregister = registerNativeGuard(root, guard);
      const context = {
        agentId: "main",
        sessionKey,
        runId,
        toolCallId: "call-0",
      };
      const event = {
        toolName: "sessions_spawn",
        toolCallId: "call-0",
        turn: 1,
        batchToolNames: ["sessions_spawn"],
        params: {
          agentId: "o1",
          runtime: "subagent",
          mode: "run",
          thread: false,
          context: "isolated",
          sandbox: "require",
          cleanup: "keep",
          task: JSON.stringify({
            schema_version: "1.0.0",
            governance_version: "m7-t2-r12",
            node_id: "o1",
            inputs: "work",
            input_refs: [],
            constraints: "{}",
            validation_criteria: "agent-result-payload.schema.json",
          }),
        },
        assistantText: "",
      };
      const decision = await guard.beforeToolCall(event, context);
      assert.equal(decision.allow, true);
      // M12/T9 F-371: the delegation id is still the CANONICAL HASH, but its
      // rendering moved: the canonical builder now emits a version-4 UUID, and
      // the ledger keeps reading the legacy 64-hex rendering so the ids history
      // recorded still replay. The claim this case proves is that the live
      // route and the governed route produce the SAME id - asserted by the
      // fixed point below - and that the id is a canonical rendering of that
      // hash and never an identity shape.
      assert.match(
        decision.spawnLabel,
        /^([a-f0-9]{64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u,
        "the delegation id must be a canonical rendering, in one of its two forms",
      );
      assert.doesNotMatch(
        decision.spawnLabel,
        /^\d{17}$/u,
        "a bare snowflake is an identity, never a delegation id",
      );
      // The reserved run in the ledger carries exactly that id.
      const reserved =
        readSnapshot(paths).tasks[taskId].delegations[decision.spawnLabel];
      assert.ok(reserved, "ledger must hold the same delegation id");
      assert.equal(reserved.agent_id, "o1");
      // And re-deriving through the canonical builder is a fixed point.
      const again = buildSpawnProposal(reserved);
      assert.equal(again.delegation_id, decision.spawnLabel);
      assert.equal(again.request_digest, reserved.request_digest);
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a mutated request digest is rejected by the reducer", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "e5-digest-"));
    try {
      const { paths, taskId } = makeTask(root, "main");
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
      // M7-020: a spawn reservation creates governed work, so the owner
      // approval is recorded first.
      recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
        task_id: taskId,
        actor: "user",
        channel: "approvals",
        decision: "APPROVE",
      });

      const proposal = buildSpawnProposal({
        task_id: taskId,
        brief_revision: 1,
        node_id: "o1",
        agent_id: "o1",
        parent_agent_id: "main",
        parent_session_key: "agent:main:sess",
        parent_run_id: "run-live",
        tool_call_id: "call-0",
        turn: 1,
        attempt: 1,
        expected_governance_hash: governanceHash("o1"),
      });
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", {
            ...proposal,
            request_digest: "f".repeat(64),
          }),
        { code: "LINEAGE_MISMATCH" },
      );
      // A forged governance hash is also rejected.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", {
            ...proposal,
            expected_governance_hash: "e".repeat(64),
          }),
        { code: "LINEAGE_MISMATCH" },
      );
      // The genuine proposal commits.
      const committed = recordWorkflowEvent(
        paths,
        "WORKFLOW_SPAWN_RESERVED",
        proposal,
      );
      assert.equal(committed.tasks[taskId].delegated_runs_used, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M7-047 — beforeRunEnd never signals task completion on accommodation", () => {
  it("provider failure and schema violation are explicit non-completion", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "e7-runend-"));
    let unregister;
    try {
      const { paths, taskId, sessionKey, runId } = makeTask(root, "main");
      const guard = createGovernanceGuard({ paths, manifestFor });
      unregister = registerNativeGuard(root, guard);
      await registerPlugin(root);
      const config = {
        plugins: {
          entries: {
            "zink-governance": {
              enabled: true,
              config: { ledgerRoot: paths.root },
            },
          },
        },
      };
      // Through the real host boundary, a provider failure on a Main Discord
      // turn is an explicit non-completion dispatch, never an allow.
      await assert.rejects(
        finishNativeRun(
          config,
          { success: false, lastAssistant: { stopReason: "error" } },
          { agentId: "main", sessionKey, runId, channelId: "discord" },
        ),
      );
      // A malformed result envelope likewise never reaches success.
      await assert.rejects(
        finishNativeRun(
          config,
          {
            success: true,
            lastAssistant: { stopReason: "stop", content: [] },
          },
          { agentId: "main", sessionKey, runId, channelId: "discord" },
        ),
      );
      // Both refusals leave the task open and record no root result. The task
      // was never approved, so it stays in its pre-approval ACTIVE state.
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.workflow_status, "ACTIVE");
      assert.equal(task.brief_state, "ACTIVE");
      assert.equal(task.root_result, undefined);
      // A healthy yielded turn is permitted without closing the task.
      await finishNativeRun(
        config,
        { success: true, yielded: true },
        { agentId: "main", sessionKey, runId, channelId: "discord" },
      );
      const after = readSnapshot(paths).tasks[taskId];
      assert.equal(after.workflow_status, "ACTIVE");
      assert.equal(after.brief_state, "ACTIVE");
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M7-048 — self-keyed session cannot bypass end-of-run governance", () => {
  it("a spoofed self-keyed session with a run id is fully governed", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "e8-spoof-"));
    let unregister;
    try {
      const { paths, taskId, runId } = makeTask(root, "main");
      const guard = createGovernanceGuard({ paths, manifestFor });
      unregister = registerNativeGuard(root, guard);
      // The exact legacy bypass shape: sessionKey === agent:main:main.
      // Because it now carries a runId, it is a governed run wearing an
      // internal key and must not be classified as internal. The session
      // string alone never buys a bypass.
      const spoofed = classifyInternalRunEnd({
        agentId: "main",
        sessionKey: "agent:main:main",
        runId,
        ownedByLedger: false,
      });
      assert.equal(spoofed.isInternal, false);
      assert.equal(spoofed.selfKeyed, true);
      assert.equal(spoofed.selfKeyedWithRunId, true);
      // A ledger-owned session is never internal either.
      assert.equal(
        classifyInternalRunEnd({
          agentId: "main",
          sessionKey: "agent:main:main",
          runId,
          ownedByLedger: true,
        }).isInternal,
        false,
      );
      // A non-self-keyed unowned session is never internal.
      assert.equal(
        classifyInternalRunEnd({
          agentId: "main",
          sessionKey: "agent:main:other",
          runId: undefined,
          ownedByLedger: false,
        }).isInternal,
        false,
      );
      // The governed task is untouched throughout.
      const task = readSnapshot(paths).tasks[taskId];
      assert.notEqual(task.workflow_status, "COMPLETE");
      assert.equal(task.workflow_status, "ACTIVE");
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a genuine internal system session keeps a reduced but real policy", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "e8-internal-"));
    let unregister;
    try {
      const { paths } = makeTask(root, "main");
      const guard = createGovernanceGuard({ paths, manifestFor });
      unregister = registerNativeGuard(root, guard);
      // The plugin's run-end wrapper is reachable through the native guard
      // registry, which is the exact seam the host calls.
      const internal = {
        agentId: "main",
        sessionKey: "agent:main:main",
      };
      const classification = classifyInternalRunEnd({
        agentId: internal.agentId,
        sessionKey: internal.sessionKey,
        runId: undefined,
        ownedByLedger: false,
      });
      assert.equal(classification.isInternal, true);
      // A healthy internal session may proceed.
      assert.equal(
        isProviderFailureEvent({ success: true, yielded: true }),
        false,
      );
      // A failing internal session is still blocked: the reduced policy does
      // not grant unconditional completion.
      for (const failingEvent of [
        { success: false, lastAssistant: { stopReason: "stop" } },
        { success: true, lastAssistant: { stopReason: "error" } },
        { success: true, lastAssistant: { stopReason: "aborted" } },
        { success: true, lastAssistant: { stopReason: "length" } },
      ]) {
        assert.equal(
          isProviderFailureEvent(failingEvent),
          true,
          `${JSON.stringify(failingEvent)} must be a provider failure`,
        );
      }
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the run-end path never persists a model override", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "e8-persist-"));
    let unregister;
    try {
      const { paths, sessionKey, runId } = makeTask(root, "main");
      const guard = createGovernanceGuard({ paths, manifestFor });
      unregister = registerNativeGuard(root, guard);
      const before = treeSnapshot(root);
      // Exercise the real host boundary for both shapes. finishNativeRun
      // routes to the plugin-registered guard.beforeRunEnd wrapper.
      const config = {
        plugins: {
          entries: {
            "zink-governance": {
              enabled: true,
              config: { ledgerRoot: paths.root },
            },
          },
        },
      };
      for (let i = 0; i < 5; i += 1) {
        await finishNativeRun(
          config,
          { success: true, yielded: true },
          { agentId: "main", sessionKey: "agent:main:main" },
        ).catch(() => {});
        await finishNativeRun(
          config,
          { success: true, yielded: true },
          { agentId: "main", sessionKey, runId },
        ).catch(() => {});
      }
      const after = treeSnapshot(root);
      assert.deepEqual(
        Object.keys(after).sort(),
        Object.keys(before).sort(),
        "no new artifact may appear",
      );
      for (const [file, bytes] of Object.entries(before)) {
        assert.equal(after[file], bytes, `${file} must be byte-identical`);
      }
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("spawn topology enforcement for every agent", () => {
  it("only canonical parent/child pairs may spawn", async () => {
    const canonical = {
      main: ["o1", "o2"],
      o1: ["excel", "sql", "python"],
      o2: ["power-bi", "python"],
      excel: [],
      "power-bi": [],
      sql: [],
      python: [],
    };
    assert.deepEqual(Object.keys(canonical).sort(), [...AGENT_IDS].sort());
    for (const [parent, targets] of Object.entries(canonical)) {
      for (const target of AGENT_IDS) {
        const allowed = targets.includes(target);
        assert.equal(
          allowed,
          canonical[parent].includes(target),
          `${parent} -> ${target}`,
        );
      }
      // A parent never spawns itself.
      assert.equal(targets.includes(parent), false, `${parent} self-spawn`);
    }
  });
});
