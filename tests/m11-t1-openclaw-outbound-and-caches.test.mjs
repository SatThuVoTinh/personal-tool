//
// SKIP-FAMILY: symlink
//
// M12/T9 F-197 (R5-E09-03) / H3: this lane may skip, and it declares WHICH
// family it belongs to, so the skip-expectation gate can tell an explained
// skip from an unexplained one. The family-to-lane map is derived from the
// repository's own lane list; the expectation lives in
// `docs/contracts/ci-skip-expectations.json`.
// M11/T1-R1 phase 4 — the OpenClaw governance plugin's outbound attachment
// containment (4.1), its bounded in-process caches (4.2), and per-target
// containment reporting (4.3).
//
// Each test reproduces a defect measured against the pre-fix code. No live
// runtime, no gateway, no operator state: every fixture is a temp directory.
import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import governancePlugin, {
  COMPLETED_EXECUTIONS_LIMIT,
  PENDING_PROPOSALS_LIMIT,
  containOutboundAttachment,
  forgetPendingSkillProposal,
  getPendingSkillProposal,
  handleExecutionFinished,
  handleOwnerSkillApproval,
  handleOwnerSkillRejection,
  registerPendingSkillProposal,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import {
  AGENT_IDS,
  agentInstructions,
  governanceHash,
} from "../integrations/openclaw/lib/policy.mjs";
import { QueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";
import {
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  buildSpawnProposal,
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { SkillAdapter } from "../zink-tools/adapters/skill-store/skill-adapter.mjs";

const OWNER = "32345678901234567";

const PENDING_CACHE = () =>
  globalThis[Symbol.for("zink.governance.pending_skill_proposals")];
const COMPLETED_CACHE = () =>
  globalThis[Symbol.for("zink.governance.completed_executions")];

/**
 * Run `body` against an empty process-global cache and restore the previous
 * contents afterwards.
 *
 * The plugin creates these caches once at module load and never resets them,
 * so every assertion on their absolute contents depended on which earlier
 * test in the file had run: a leftover entry shifts the oldest-first eviction
 * boundary, so `cache.size` and the eviction assertions could pass or fail on
 * test order alone. The cache tests below now measure an isolated cache and
 * leave the shared singleton exactly as they found it.
 */
function withIsolatedCache(cache, body) {
  const isSet = typeof cache.add === "function";
  const saved = isSet ? new Set(cache) : new Map(cache);
  const clear = () => {
    for (const key of [...cache.keys()]) cache.delete(key);
  };
  clear();
  try {
    return body();
  } finally {
    clear();
    if (isSet) {
      for (const value of saved) cache.add(value);
    } else {
      for (const [key, value] of saved) cache.set(key, value);
    }
  }
}

function tempRoot(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Point `os.homedir()` at a temp directory that owns one governed sandbox for
 * agent `main`, exactly the layout `resolveAgentSandboxDir` reads. Only the
 * process-local environment changes, and it is restored on the way out — the
 * developer's real `~/.openclaw-zink` is never touched.
 */
function withGovernedHome(body) {
  const root = tempRoot("m11-t1-p4-home-");
  const home = path.join(root, "home");
  const sandbox = path.join(
    home,
    ".openclaw-zink",
    "sandboxes",
    "agent-main-task1",
  );
  mkdirSync(sandbox, { recursive: true });
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const restore = () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true });
  };
  let result;
  try {
    result = body({ root, home, sandbox });
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === "function") {
    return result.then(
      (value) => {
        restore();
        return value;
      },
      (error) => {
        restore();
        throw error;
      },
    );
  }
  restore();
  return result;
}

// ---------------------------------------------------------------------------
// 4.1 — outbound attachment containment
// ---------------------------------------------------------------------------

test("M11-4.1: an attachment that really lives in the governed sandbox is delivered", () => {
  withGovernedHome(({ sandbox }) => {
    const file = path.join(sandbox, "report.csv");
    writeFileSync(file, "date,revenue\n2026-10-01,1000", "utf8");
    const verdict = containOutboundAttachment(file, "main");
    assert.equal(verdict.contained, true);
    assert.equal(verdict.realPath, realpathSync(file));
  });
});

test("M11-4.1: an outside path, a `..` traversal, a missing file and an absent sandbox root all fail closed", () => {
  withGovernedHome(({ root, sandbox }) => {
    const outside = path.join(root, "host-secret.csv");
    writeFileSync(outside, "do not publish", "utf8");

    const absolute = containOutboundAttachment(outside, "main");
    assert.equal(absolute.contained, false);
    assert.match(absolute.reason, /escapes the governed sandbox root/u);

    // Pre-fix, `existsSync` alone accepted this because the path exists.
    const traversal = containOutboundAttachment(
      path.join(sandbox, "..", "..", "..", path.basename(outside)),
      "main",
    );
    assert.equal(traversal.contained, false);

    const missing = containOutboundAttachment(
      path.join(sandbox, "absent.csv"),
      "main",
    );
    assert.equal(missing.contained, false);

    // No governed root means nothing can be proven contained.
    const noRoot = containOutboundAttachment(outside, "not-a-governed-agent");
    assert.equal(noRoot.contained, false);
    assert.match(noRoot.reason, /no governed sandbox root/u);

    assert.equal(containOutboundAttachment("", "main").contained, false);
  });
});

test("M11-4.1: a symlinked component that leaves the sandbox is refused", (t) => {
  withGovernedHome(({ root, sandbox }) => {
    const secret = path.join(root, "host-secret.csv");
    writeFileSync(secret, "do not publish", "utf8");
    const link = path.join(sandbox, "report.csv");
    try {
      symlinkSync(secret, link, "file");
    } catch {
      t.skip("this platform/account cannot create file symlinks");
      return;
    }
    const verdict = containOutboundAttachment(link, "main");
    assert.equal(verdict.contained, false);
    assert.match(verdict.reason, /escapes the governed sandbox root/u);
  });
});

test("M11-4.1: message_sending blocks an escaping attachment, keeps http(s) pass-through, and logs no file content", async () => {
  const ledgerRoot = tempRoot("m11-t1-p4-ledger-");
  const paths = ledgerPaths(ledgerRoot);
  ensureLedger(paths);
  const { hooks, logs } = registerPlugin(ledgerRoot);
  const hook = hooks.get("message_sending");
  const ctx = {
    channelId: "discord",
    agentId: "main",
    sessionKey: "agent:main:discord:channel:123",
  };
  try {
    await withGovernedHome(async ({ root, sandbox }) => {
      const inside = path.join(sandbox, "report.csv");
      writeFileSync(inside, "date,revenue\n2026-10-01,1000", "utf8");
      const outside = path.join(root, "host-secret.csv");
      writeFileSync(outside, "do-not-publish-marker", "utf8");

      const delivered = await hook(
        { content: "Báo cáo đã xong.", attachments: [{ path: inside }] },
        ctx,
      );
      assert.equal(delivered?.block, undefined);
      assert.match(delivered.content, /Báo cáo đã xong/u);

      const remote = await hook(
        {
          content: "Báo cáo đã xong.",
          attachments: [{ url: "https://example.com/report.png" }],
        },
        ctx,
      );
      assert.equal(remote?.block, undefined, "http(s) keeps passing through");

      const blocked = await hook(
        { content: "Báo cáo đã xong.", attachments: [{ path: outside }] },
        ctx,
      );
      assert.deepEqual(blocked, { block: true, cancel: true });

      const missing = await hook(
        {
          content: "Báo cáo đã xong.",
          attachments: [{ path: path.join(sandbox, "absent.csv") }],
        },
        ctx,
      );
      assert.deepEqual(missing, { block: true, cancel: true });

      const warnings = logs.filter((line) => line.startsWith("warn:"));
      assert.ok(
        warnings.some((line) =>
          /blocked: attachment 'host-secret\.csv'/u.test(line),
        ),
        "the refusal must name the attachment it refused",
      );
      for (const line of warnings) {
        assert.ok(
          !line.includes("do-not-publish-marker"),
          "a warn line may never carry file content",
        );
      }
    });
  } finally {
    rmSync(ledgerRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4.2 — bounded in-process caches
// ---------------------------------------------------------------------------

test("M11-4.2: the pending-proposal cache is capped and evicts the oldest insertion", () => {
  const cache = PENDING_CACHE();
  withIsolatedCache(cache, () => {
    for (let i = 0; i < PENDING_PROPOSALS_LIMIT + 40; i++) {
      registerPendingSkillProposal({ proposal_id: `evict-${i}` });
    }
    assert.equal(cache.size, PENDING_PROPOSALS_LIMIT);
    // Map iteration order is insertion order, so the oldest keys leave first.
    assert.equal(cache.has("evict-0"), false);
    assert.equal(cache.has(`evict-${40 - 1}`), false);
    assert.equal(cache.has(`evict-${40}`), true);
    assert.equal(cache.has(`evict-${PENDING_PROPOSALS_LIMIT + 39}`), true);
  });
});

test("M11-4.2: a terminal proposal state removes it from the pending cache", async () => {
  const { root, base } = await proposedSkill("terminal-approve-skill");
  const cache = PENDING_CACHE();
  try {
    registerPendingSkillProposal({
      approval_id: base.proposalId,
      proposal_id: base.proposalId,
    });
    assert.ok(getPendingSkillProposal(base.proposalId));
    const approval = await handleOwnerSkillApproval({
      ...base,
      decisionRef: "PLAN:M11/T1-R1",
    });
    assert.equal(approval.approval_status, "APPROVED");
    // MATERIALIZED/READY is decided: the durable record owns it, the cache must
    // not keep answering for a proposal that is no longer pending.
    assert.equal(getPendingSkillProposal(base.proposalId), null);
    assert.equal(cache.has(base.proposalId), false);
  } finally {
    cache.delete(base.proposalId);
    rmSync(root, { recursive: true, force: true });
  }
});

test("M11-4.2: a rejection removes the proposal from the pending cache", async () => {
  const { root, base } = await proposedSkill("terminal-reject-skill");
  const cache = PENDING_CACHE();
  try {
    registerPendingSkillProposal({
      approval_id: base.proposalId,
      proposal_id: base.proposalId,
    });
    assert.ok(getPendingSkillProposal(base.proposalId));
    const rejected = await handleOwnerSkillRejection({
      ownerDiscordId: OWNER,
      expectedOwnerId: OWNER,
      proposalId: base.proposalId,
      proposalStorageDir: base.proposalStorageDir,
      skillsRoot: base.skillsRoot,
    });
    assert.equal(rejected.approval_status, "REJECTED");
    assert.equal(getPendingSkillProposal(base.proposalId), null);
    assert.equal(cache.has(base.proposalId), false);
  } finally {
    cache.delete(base.proposalId);
    rmSync(root, { recursive: true, force: true });
  }
});

test("M11-4.2: forgetPendingSkillProposal ignores empty ids", () => {
  const cache = PENDING_CACHE();
  registerPendingSkillProposal({ proposal_id: "kept-entry" });
  try {
    forgetPendingSkillProposal(undefined, null, "", "kept-entry");
    assert.equal(cache.has("kept-entry"), false);
  } finally {
    cache.delete("kept-entry");
  }
});

test("M11-4.2: the completed-execution replay guard is bounded oldest-first", () => {
  const dir = tempRoot("m11-t1-p4-exec-");
  const cache = COMPLETED_CACHE();
  const seeded = [];
  try {
    withIsolatedCache(cache, () => {
      for (let i = 0; i < COMPLETED_EXECUTIONS_LIMIT; i++) {
        const key = `seed-${i}`;
        seeded.push(key);
        cache.add(key);
      }
      const queueManager = new QueueManager({
        storagePath: path.join(dir, "queue.json"),
      });
      queueManager.enqueueTask({
        taskId: "bounded-run",
        primaryCoordinator: "o1",
      });
      const claim = queueManager.claimTaskById({
        taskId: "bounded-run",
        agentId: "o1",
      });
      const artifact = path.join(dir, "out.csv");
      writeFileSync(artifact, "date,revenue\n2026-10-01,1000", "utf8");
      const args = {
        taskId: "bounded-run",
        agentId: "o1",
        leaseId: claim.leaseId,
        attempt: claim.task.attempt,
        artifacts: [artifact],
        technicalConfig: {
          expectedType: "csv",
          expectedFields: ["date", "revenue"],
        },
        businessData: { revenue: 1000 },
        businessConfig: { kpiConstraints: { revenue: { min: 500 } } },
        idempotencyKey: "bounded-execution-1",
        queueManager,
      };
      const first = handleExecutionFinished(args);
      assert.equal(first.status, "READY_FOR_REVIEW");
      assert.equal(
        cache.size,
        COMPLETED_EXECUTIONS_LIMIT,
        "the set stays capped",
      );
      assert.equal(cache.has("seed-0"), false, "the oldest key left first");
      assert.equal(cache.has("seed-1"), true);
      assert.equal(cache.has("bounded-execution-1"), true);
      // Inside the window a replay is still refused.
      assert.equal(handleExecutionFinished(args).status, "ALREADY_COMPLETED");
    });
  } finally {
    for (const key of seeded) cache.delete(key);
    cache.delete("bounded-execution-1");
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4.3 — per-target containment reporting
// ---------------------------------------------------------------------------

/**
 * A brief node must declare a stack its agent actually owns (AGENT_STACK_POLICY),
 * otherwise WORKFLOW_BRIEF_ACTIVATED fails closed with UNAUTHORIZED_TARGET.
 */
function briefNode(nodeId, agentId, stackId) {
  return {
    node_id: nodeId,
    agent_id: agentId,
    stack_id: stackId,
    dependencies: [],
    required: true,
    input_digest: canonicalHash("zink-input-v1", "work"),
    constraints_digest: canonicalHash("zink-constraints-v1", "{}"),
    validation_digest: canonicalHash(
      "zink-validation-v1",
      "agent-result-payload.schema.json",
    ),
  };
}

let snowflake = 91000000000000001n;
const nextMessageId = () => String(snowflake++);

let rootSequence = 0;

/**
 * Open a task and activate a brief carrying every `nodes` entry. Each task owns
 * a distinct root session/run pair: `findSession` requires exactly one owner for
 * an identity, so sharing one root run across tasks would make the second
 * reservation ambiguous before the fixture ever reaches the defect.
 */
function openTask(paths, nodes) {
  rootSequence += 1;
  const root = {
    rootSessionKey: `main-session-${rootSequence}`,
    rootRunId: `main-run-${rootSequence}`,
  };
  const origin = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: nextMessageId(),
  };
  const taskId = deriveTaskId(origin);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...origin,
    task_id: taskId,
    root_agent_id: "main",
    root_session_key: root.rootSessionKey,
    root_run_id: root.rootRunId,
  });
  recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
    task_id: taskId,
    brief_revision: 1,
    semantic_contract_status: "VALID",
    nodes: nodes.map(([node_id, agent_id, stack_id]) =>
      briefNode(node_id, agent_id, stack_id),
    ),
  });
  recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
    task_id: taskId,
    actor: "user",
    channel: "approvals",
    decision: "APPROVE",
  });
  return { taskId, ...root };
}

function reserve(paths, { task, nodeId, agentId, toolCallId, turn }) {
  const proposal = buildSpawnProposal({
    task_id: task.taskId,
    brief_revision: 1,
    node_id: nodeId,
    agent_id: agentId,
    parent_agent_id: "main",
    parent_session_key: task.rootSessionKey,
    parent_run_id: task.rootRunId,
    tool_call_id: toolCallId,
    turn,
    attempt: 1,
    expected_governance_hash: governanceHash(agentId),
  });
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", proposal);
  return proposal;
}

/** Give a reserved delegation its native identity. */
function receive(paths, proposal, nativeRunId, childSessionKey) {
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
    task_id: proposal.task_id,
    delegation_id: proposal.delegation_id,
    native_run_id: nativeRunId,
    child_session_key: childSessionKey,
    agent_id: proposal.agent_id,
    parent_session_key: proposal.parent_session_key,
  });
}

function registerPlugin(root) {
  const hooks = new Map();
  const logs = [];
  for (const agentId of AGENT_IDS) {
    const folder = path.join(root, "workspaces", agentId);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "AGENTS.md"), agentInstructions(agentId));
  }
  governancePlugin.register({
    pluginConfig: { ledgerRoot: ledgerPaths(root).root, ownerDiscordId: OWNER },
    on: (name, fn) => hooks.set(name, fn),
    registerTool: () => {},
    logger: {
      warn: (message) => logs.push(`warn:${message}`),
      info: (message) => logs.push(`info:${message}`),
      error: (message) => logs.push(`error:${message}`),
    },
  });
  return { hooks, logs };
}

const ghostEnd = (runId, childSessionKey) => ({
  runId,
  targetSessionKey: childSessionKey,
  outcome: "ok",
});
const ghostCtx = (runId, childSessionKey) => ({
  agentId: "o1",
  runId,
  childSessionKey,
});

test("M11-4.3: a fully recorded containment sweep still reports BLOCKED with nothing uncontained", () => {
  const root = tempRoot("m11-t1-p4-clean-");
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const task = openTask(paths, [["n1", "o1", "data_plant"]]);
    receive(
      paths,
      reserve(paths, {
        task,
        nodeId: "n1",
        agentId: "o1",
        toolCallId: "call-1",
        turn: 1,
      }),
      "run-clean",
      "session-clean",
    );
    const { hooks } = registerPlugin(root);
    const decision = hooks.get("subagent_ended")(
      ghostEnd("run-unknown", "session-unknown"),
      ghostCtx("run-unknown", "session-unknown"),
    );
    assert.equal(decision.blocked, true);
    assert.equal(decision.scope, "ALL_LIVE_RUNS");
    assert.equal(decision.governanceState, "BLOCKED");
    assert.equal(decision.ledgerWriteFailed, false);
    assert.deepEqual(decision.uncontainedTasks, []);
    assert.equal(
      readSnapshot(paths).tasks[task.taskId].workflow_status,
      "BLOCKED",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("M11-4.3: one target whose ledger write fails reports UNKNOWN and names the uncontained task", () => {
  const root = tempRoot("m11-t1-p4-partial-");
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);

    // Task A is recorded cleanly.
    const cleanTask = openTask(paths, [["n1", "o1", "data_plant"]]);
    receive(
      paths,
      reserve(paths, {
        task: cleanTask,
        nodeId: "n1",
        agentId: "o1",
        toolCallId: "call-a",
        turn: 1,
      }),
      "run-a",
      "session-a",
    );

    // Task B carries two delegations that share one native identity, so any
    // WORKFLOW_NATIVE_ENDED for it is refused with LINEAGE_MISMATCH: the ledger
    // cannot say which run owns the receipt, so it records nothing.
    const ambiguousTask = openTask(paths, [
      ["n2", "o2", "intelligence"],
      ["n3", "o1", "data_plant"],
    ]);
    const first = reserve(paths, {
      task: ambiguousTask,
      nodeId: "n2",
      agentId: "o2",
      toolCallId: "call-b1",
      turn: 1,
    });
    receive(paths, first, "run-b", "session-b");
    const second = reserve(paths, {
      task: ambiguousTask,
      nodeId: "n3",
      agentId: "o1",
      toolCallId: "call-b2",
      turn: 2,
    });
    receive(paths, second, "run-b", "session-b");

    const { hooks } = registerPlugin(root);
    const decision = hooks.get("subagent_ended")(
      ghostEnd("run-unknown", "session-unknown"),
      ghostCtx("run-unknown", "session-unknown"),
    );

    // Pre-fix this returned BLOCKED with ledgerWriteFailed=false because a
    // single successful write was taken as proof the whole sweep succeeded,
    // while task B kept running with no ledger record of its suspension.
    assert.equal(decision.blocked, true);
    assert.equal(decision.governanceState, "UNKNOWN");
    assert.equal(decision.ledgerWriteFailed, true);
    assert.deepEqual(decision.uncontainedTasks, [ambiguousTask.taskId]);
    assert.match(decision.ledgerError, /LINEAGE_MISMATCH/u);
    assert.equal(
      readSnapshot(paths).tasks[cleanTask.taskId].workflow_status,
      "BLOCKED",
    );
    assert.notEqual(
      readSnapshot(paths).tasks[ambiguousTask.taskId].workflow_status,
      "BLOCKED",
      "the uncontained task must not be reported as suspended",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("M11-4.3: an empty sweep keeps its existing UNKNOWN/failed reporting", () => {
  const root = tempRoot("m11-t1-p4-none-");
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const { hooks } = registerPlugin(root);
    const decision = hooks.get("subagent_ended")(
      ghostEnd("run-unknown", "session-unknown"),
      ghostCtx("run-unknown", "session-unknown"),
    );
    assert.equal(decision.scope, "NONE");
    assert.equal(decision.governanceState, "UNKNOWN");
    assert.equal(decision.ledgerWriteFailed, true);
    assert.deepEqual(decision.uncontainedTasks, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Durable skill-proposal fixture (4.2 terminal states)
// ---------------------------------------------------------------------------

async function proposedSkill(capability) {
  const root = tempRoot("m11-t1-p4-skill-");
  const skillsRoot = path.join(root, "skills");
  const proposalStorageDir = path.join(root, "proposals");
  const proposing = new SkillAdapter(undefined, { proposalStorageDir });
  const content = `# ${capability}\n\nGoverned content.`;
  const proposed = await proposing.querySkillStore({
    action: "propose",
    namespace: ["office"],
    capability,
    version: "1.0.0",
    content,
    reason: "M11/T1 phase 4 cache bounds",
    requesting_agent: "excel",
  });
  return {
    root,
    base: {
      ownerDiscordId: OWNER,
      expectedOwnerId: OWNER,
      proposalId: proposed.proposal.proposal_id,
      contentSha256: proposed.proposal.content_sha256,
      namespace: ["office"],
      capability,
      version: "1.0.0",
      skillsRoot,
      proposalStorageDir,
      options: {
        vectorSyncFn: async () => ({ status: "READY", synced_count: 1 }),
      },
    },
  };
}
