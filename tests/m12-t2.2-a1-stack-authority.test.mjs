// M12/T2.2-R1 A-1 — one coordinator→stack source of truth (`R1-A04-01`).
//
// guard.mjs `admitInitialBrief` used to hold a hand copy of the coordinator→stack
// mapping plus a brief-wide "exactly one distinct stack" predicate. The copy had
// drifted to the inverse of `AGENT_STACK_POLICY` for o1/o2, so the reducer
// (workflow.mjs, which validates PER NODE against the table) admitted a node the
// copy then refused: an admitted-then-refused brief wedges the task, because the
// reducer pins `brief_revision` to 1 while `task.nodes` is empty and every retry
// re-matches the same node and is refused again.
//
// These tests drive the real guard over a real ledger, so the load-bearing
// question is not only "which code is returned" but "was WORKFLOW_BRIEF_ACTIVATED
// written". Every assertion below is on the durable effect.
process.env.ZINK_ROUTER_HOST ||= "router.invalid";
process.env.ZINK_ROUTER_PORT ||= "1";
process.env.ZINK_ROUTER_API_KEY ||= "test-router-key-not-a-credential";

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createGovernanceGuard } from "../integrations/openclaw/topology/lib/guard.mjs";
import {
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";
// The guard reads the table through policy.mjs, the same seam it already used for
// AGENT_SPAWN_POLICY; these tests read it the same way so a broken re-export is
// caught rather than assumed.
import { AGENT_STACK_POLICY } from "../integrations/openclaw/lib/policy.mjs";

const GUARD_SOURCE = fs.readFileSync(
  new URL("../integrations/openclaw/topology/lib/guard.mjs", import.meta.url),
  "utf8",
);

const MANIFEST_HASH = "0".repeat(64);

function manifestFor() {
  return {
    expected_governance_hash: MANIFEST_HASH,
    observed_governance_hash: MANIFEST_HASH,
    allowed_tools: ["sessions_spawn", "sessions_yield"],
  };
}

function nodeDef(nodeId, agentId, stackId, dependencies = []) {
  return {
    node_id: nodeId,
    agent_id: agentId,
    stack_id: stackId,
    dependencies,
    required: true,
    inputs: `A-1 probe input for ${nodeId}`,
    constraints: "{}",
    validation_criteria: "agent-result-payload.schema.json",
  };
}

// A first brief cannot declare `semantic_contract_status: VALID`: the task status
// is a projection of the brief, so line 814-818 of the guard refuses a brief that
// claims a status the task does not have yet. The consequence for these fixtures
// is that a `data_plant` node needs a `semantic` dependency, which is why the
// admitted plans below carry one.
function briefText(taskId, origin, nodes) {
  return JSON.stringify({
    schema_version: "1.0.0",
    governance_version: "m8-t2-r9",
    task_id: taskId,
    brief_revision: 1,
    brief_state: "ACTIVE",
    workflow_status: "ACTIVE",
    origin: origin.origin,
    origin_principal_ref: origin.origin_principal_ref,
    origin_message_id: origin.origin_message_id,
    inputs: "A-1 stack authority fixture brief",
    input_refs: [],
    nodes,
    semantic_contract_status: "MISSING",
    dataset_validation_status: "MISSING",
    mandatory_decision_evidence: [],
  });
}

// Built as a string: a 17-digit snowflake-shaped id exceeds Number.MAX_SAFE_INTEGER,
// so counting it as a number would silently repeat a task identity, and each
// fixture needs its own (deriveTaskId hashes these origin binding fields).
let messageCounter = 0;

function nextMessageId() {
  return `523456789012345${String(++messageCounter).padStart(2, "0")}`;
}

/**
 * Open a task whose ROOT session is the authoring agent. `admitInitialBrief`
 * requires `context.agentId === owner.task.root_agent_id` and no delegation, so a
 * non-main author can only exist as a task root — that is the shape that makes
 * the o1/o2 stack question reachable through the guard at all.
 */
function authoringLedger(rootAgentId) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a1-stack-"));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: nextMessageId(),
  };
  const payload = {
    ...origin,
    root_agent_id: rootAgentId,
    root_session_key: `agent:${rootAgentId}:sess-a1`,
    root_run_id: `run-a1-${rootAgentId}`,
  };
  const taskId = deriveTaskId(payload);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...payload,
    task_id: taskId,
  });
  const guard = createGovernanceGuard({ paths, manifestFor });
  return { root, paths, guard, taskId, payload, origin };
}

/**
 * Run one initial-brief admission through the governed gate. The brief rides in
 * `assistantText` on a `sessions_spawn` against a task with no nodes, which is
 * the only production path into `admitInitialBrief`.
 *
 * Returns the refusal code (null when nothing threw) plus the ledger facts,
 * because a passing guard decision is not the assertion: the durable write is.
 */
async function admit(nodes, rootAgentId) {
  const fixture = authoringLedger(rootAgentId);
  try {
    const eventsBefore = fs.readFileSync(fixture.paths.events, "utf8");
    let code = null;
    try {
      await fixture.guard.beforeToolCall(
        {
          toolName: "sessions_spawn",
          toolCallId: "call-a1-1",
          turn: 1,
          batchToolNames: ["sessions_spawn"],
          assistantText: briefText(fixture.taskId, fixture.origin, nodes),
          params: {
            agentId: nodes[0].agent_id,
            runtime: "subagent",
            mode: "run",
            thread: false,
            context: "isolated",
            sandbox: "require",
            cleanup: "keep",
            task: JSON.stringify({}),
          },
        },
        {
          agentId: rootAgentId,
          sessionKey: fixture.payload.root_session_key,
          runId: fixture.payload.root_run_id,
        },
      );
    } catch (error) {
      code = error?.code ?? error?.message ?? "UNKNOWN";
    }
    const snapshot = readSnapshot(fixture.paths);
    return {
      code,
      activated: snapshot.tasks[fixture.taskId].nodes.map((node) =>
        [node.agent_id, node.stack_id].join("/"),
      ),
      eventsAppended:
        fs.readFileSync(fixture.paths.events, "utf8") !== eventsBefore,
      briefWriteEvents: fs
        .readFileSync(fixture.paths.events, "utf8")
        .split("\n")
        .filter((line) => line.includes("WORKFLOW_BRIEF_ACTIVATED")).length,
    };
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

// ===========================================================================
// The flip: the inverted copy refused exactly this shape
// ===========================================================================

test("A-1 flip: a non-main o1 root authoring a data_plant node is admitted", async () => {
  // o1 owns infrastructure/data_plant in AGENT_STACK_POLICY. The hand copy said
  // o1 meant semantic/intelligence/decision, so it refused this plan even though
  // the reducer accepted it. This is R1-A04-01.
  const result = await admit(
    [
      nodeDef("n-sem", "excel", "semantic"),
      nodeDef("n-dp", "excel", "data_plant", ["n-sem"]),
    ],
    "o1",
  );
  assert.deepEqual(
    result.activated,
    ["excel/semantic", "excel/data_plant"],
    `o1 must be able to author its own stacks, got ${JSON.stringify(result)}`,
  );
  assert.equal(result.briefWriteEvents, 1);
});

test("A-1 flip mirror: the same o1 root still cannot author o2's stacks", async () => {
  // The flip is a correction, not a widening: o1 gains data_plant/infrastructure
  // and keeps NOT having semantic of its own… (excel does own semantic), so the
  // probe uses a stack no member of o1's spawn set owns.
  const result = await admit([nodeDef("n-in", "sql", "infrastructure")], "o1");
  assert.equal(result.code, "UNAUTHORIZED_TARGET");
  assert.deepEqual(result.activated, []);
  assert.equal(result.briefWriteEvents, 0);
});

// ===========================================================================
// Refusal before the durable write
// ===========================================================================

test("A-1: a node whose agent does not own its stack is refused with the ledger untouched", async () => {
  // power-bi owns semantic/intelligence/decision, never data_plant. Pre-fix this
  // plan reached the structural `data_plant needs a semantic dependency` rule and
  // failed there (MISSING_PREREQUISITE); the stack rule must fire first, because
  // a refusal that lands after WORKFLOW_BRIEF_ACTIVATED is the wedge.
  const result = await admit([nodeDef("n-dp", "power-bi", "data_plant")], "o2");
  assert.equal(result.code, "UNAUTHORIZED_TARGET");
  assert.deepEqual(result.activated, [], "no node may be committed");
  assert.equal(
    result.briefWriteEvents,
    0,
    "the refusal must precede the durable write",
  );
  assert.equal(result.eventsAppended, false, "the ledger must not have grown");
});

// ===========================================================================
// The mixed plan the deferred M12/T3 split-and-merge needs
// ===========================================================================

test("A-1 mixed plan: a main-authored brief spanning o1/data_plant and o2/semantic is admitted", async () => {
  const result = await admit(
    [
      nodeDef("n-sem", "o2", "semantic"),
      nodeDef("n-dp", "o1", "data_plant", ["n-sem"]),
    ],
    "main",
  );
  assert.deepEqual(
    result.activated,
    ["o2/semantic", "o1/data_plant"],
    `a plan may span stacks when each node owns its own, got ${JSON.stringify(result)}`,
  );
});

test("A-1: the KEPT spawn-target rule still refuses a main-owned node in a first brief", async () => {
  // Recorded deliberately, not worked around: `decision` nodes must be main-owned
  // (guard.mjs:877-878) while AGENT_SPAWN_POLICY.main is ["o1","o2"]
  // (guard.mjs:865-870). The two kept rules therefore make a main-owned decision
  // node unreachable through admitInitialBrief, so the "split-and-merge in one
  // brief" shape the owner deferred to M12/T3 cannot carry its merge node here.
  // A-1 does not touch either rule, so this is escalated as a contract conflict.
  const result = await admit(
    [
      nodeDef("n-sem", "o2", "semantic"),
      nodeDef("n-dp", "o1", "data_plant", ["n-sem"]),
      nodeDef("n-dec", "main", "decision", ["n-dp"]),
    ],
    "main",
  );
  assert.equal(result.code, "UNAUTHORIZED_TARGET");
  assert.deepEqual(result.activated, []);
  assert.equal(result.briefWriteEvents, 0);
});

// ===========================================================================
// No capability widening, driven off the table rather than off literals
// ===========================================================================

test("A-1: an o2 node on infrastructure is refused, exactly per the table", async () => {
  assert.equal(AGENT_STACK_POLICY.o2.includes("infrastructure"), false);
  const result = await admit([nodeDef("n-in", "o2", "infrastructure")], "main");
  assert.equal(result.code, "UNAUTHORIZED_TARGET");
  assert.deepEqual(result.activated, []);
  assert.equal(result.briefWriteEvents, 0);
});

test("A-1: every agent/stack pair the table does not own is refused", async () => {
  // Each probe uses an authoring context that CAN spawn the node's agent, so the
  // stack table is the only rule left that can refuse it.
  const contextFor = {
    o1: "main",
    o2: "main",
    excel: "o1",
    sql: "o1",
    python: "o1",
    "power-bi": "o2",
  };
  const stacks = [
    "infrastructure",
    "data_plant",
    "semantic",
    "intelligence",
    "decision",
  ];
  for (const [agent, contextAgent] of Object.entries(contextFor)) {
    for (const stack of stacks) {
      if ((AGENT_STACK_POLICY[agent] ?? []).includes(stack)) continue;
      const result = await admit([nodeDef("n-x", agent, stack)], contextAgent);
      assert.equal(
        result.code,
        "UNAUTHORIZED_TARGET",
        `${agent}/${stack} is not in AGENT_STACK_POLICY and must be refused under a ${contextAgent} author`,
      );
      assert.equal(
        result.briefWriteEvents,
        0,
        `${agent}/${stack} must be refused before any durable write`,
      );
    }
  }
});

// ===========================================================================
// Source-shape pin: the copy must not come back
// ===========================================================================

test("A-1 pin: admission reads AGENT_STACK_POLICY and holds no coordinator stack list", () => {
  const start = GUARD_SOURCE.indexOf("function admitInitialBrief");
  assert.ok(start !== -1, "the initial-brief admission seam must exist");
  const end = GUARD_SOURCE.indexOf(
    'recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED"',
    start,
  );
  assert.ok(
    end !== -1,
    "admission must still end in the durable brief write it guards",
  );
  const window = GUARD_SOURCE.slice(start, end);

  assert.match(
    window,
    /AGENT_STACK_POLICY\[node\.agent_id\]/u,
    "admission must validate each node against the canonical stack table",
  );
  // The inverted copy, in either order, must be gone.
  assert.doesNotMatch(
    window,
    /\[\s*"semantic",\s*"intelligence",\s*"decision"\s*\]/u,
    "no inline coordinator stack list may survive in admission",
  );
  assert.doesNotMatch(
    window,
    /\[\s*"infrastructure",\s*"data_plant"\s*\]/u,
    "no inline coordinator stack list may survive in admission",
  );
  // The brief-wide single-stack predicate must be gone, not merely reordered.
  assert.doesNotMatch(
    window,
    /new Set\(brief\.nodes\.map\(\(?\w*\)?\s*=>\s*\w*\.stack_id\)\)\.size\s*===\s*1/u,
    "a brief may span stacks; the single-stack predicate must not return",
  );
  // And the gate that let the copy diverge for Main only must be gone.
  assert.doesNotMatch(
    window,
    /context\.agentId !== "main"/u,
    "the stack rule applies to every author, so no main-only exemption may remain",
  );
});

test("A-1 pin: the kept spawn-target and decision-owner rules are still in place", () => {
  const start = GUARD_SOURCE.indexOf("function admitInitialBrief");
  const window = GUARD_SOURCE.slice(
    start,
    GUARD_SOURCE.indexOf(
      'recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED"',
      start,
    ),
  );
  assert.match(
    window,
    /AGENT_SPAWN_POLICY\[context\.agentId\]/u,
    "the pre-commit spawn-target check must stay",
  );
  assert.match(
    window,
    /node\.agent_id === "main"/u,
    "the decision-node ownership check must stay",
  );
});
