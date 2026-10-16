// M12/T2.2-R2 K-1 — the guard's announce discards must name their cause.
//
// B-16 put the guard's reason on the boundary's diagnostic line, but two of the
// seam's four discard paths in `topology/lib/guard.mjs` return a bare
// `{ action: "discard" }`, so the seam could only ever print
// `REASON_UNDECLARED` for them (`guard.mjs:1982` collapses three different
// liveness causes into one anonymous drop, `:2048` drops an already-accepted
// result anonymously). That is the same attribution collapse `K01` records, one
// layer down.
//
// These tests drive the REAL guard over a REAL ledger pair — the convention
// `tests/m12-t2.2-a1-stack-authority.test.mjs` and `…a2-stack-registry.test.mjs`
// set — because a discard verdict is only honest if the durable state that
// caused it is on disk. No reason code is invented here: every one is read from
// `policy/reason-code-matrix.json`, and the last test pins that against the
// file so a later edit cannot drift into an undeclared vocabulary.
process.env.ZINK_ROUTER_HOST ||= "router.invalid";
process.env.ZINK_ROUTER_PORT ||= "1";
process.env.ZINK_ROUTER_API_KEY ||= "test-router-key-not-a-credential";

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createGovernanceGuard } from "../integrations/openclaw/topology/lib/guard.mjs";
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
  GOVERNANCE_VERSION,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { createTrustedResultEnvelope } from "../integrations/openclaw/topology/lib/runtime.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";
import {
  gateNativeAnnounce,
  registerNativeGuard,
} from "../integrations/openclaw/topology/lib/native-boundary.mjs";

const MATRIX = JSON.parse(
  readFileSync(
    path.join(
      fileURLToPath(new URL(".", import.meta.url)),
      "..",
      "integrations",
      "openclaw",
      "topology",
      "policy",
      "reason-code-matrix.json",
    ),
    "utf8",
  ),
);

let snowflake = 88000000000000001n;
const nextMessageId = () => String(snowflake++);

function briefNode(agentId) {
  return {
    node_id: agentId,
    agent_id: agentId,
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
}

const manifestFor = (agentId) => ({
  expected_governance_hash: governanceHash(agentId),
  observed_governance_hash: governanceHash(agentId),
  allowed_tools: ["sessions_spawn", "sessions_yield"],
});

/**
 * One live delegated run (o1) under a main-rooted task, exactly as
 * `tests/m7-lane-d3-native-receipts.test.mjs` seeds it, plus the guard reading
 * the same ledger.
 */
function seeded() {
  const root = mkdtempSync(path.join(os.tmpdir(), "k1-announce-"));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
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
    root_session_key: "main-session",
    root_run_id: "main-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
    task_id: taskId,
    brief_revision: 1,
    semantic_contract_status: "VALID",
    nodes: [briefNode("o1")],
  });
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
    parent_session_key: "main-session",
    parent_run_id: "main-run",
    tool_call_id: "call-0",
    turn: 1,
    attempt: 1,
    expected_governance_hash: governanceHash("o1"),
  });
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", proposal);
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
    task_id: taskId,
    delegation_id: proposal.delegation_id,
    native_run_id: "o1-run-1",
    child_session_key: "o1-session-1",
    agent_id: "o1",
    parent_session_key: "main-session",
  });
  return {
    root,
    paths,
    taskId,
    guard: createGovernanceGuard({ paths, manifestFor }),
    event: {
      childSessionKey: "o1-session-1",
      childRunId: "o1-run-1",
      requesterSessionKey: "main-session",
    },
  };
}

const claim = (output) => ({
  schema_version: "1.0.0",
  governance_version: GOVERNANCE_VERSION,
  outcome_claim: "COMPLETE",
  reason_claim: "NONE",
  output,
  assumptions: [],
  limitations: [],
  requested_prerequisites: [],
  agent_self_validation: "Claim only",
});

/** Record o1's accepted result so the run carries an accepted payload digest. */
function acceptChildResult(fixture, payload) {
  const run = readSnapshot(fixture.paths).tasks[fixture.taskId].delegations[
    Object.keys(
      readSnapshot(fixture.paths).tasks[fixture.taskId].delegations,
    )[0]
  ];
  const envelope = createTrustedResultEnvelope({
    payload,
    lineage: run,
    governance: {
      expected_governance_hash: run.expected_governance_hash,
      observed_governance_hash: run.expected_governance_hash,
    },
    runState: "COMPLETE",
    verifierValidation: "VALID",
    resultAcceptance: "ACCEPTED",
  });
  recordWorkflowEvent(fixture.paths, "WORKFLOW_RESULT_RECORDED", {
    task_id: fixture.taskId,
    envelope,
  });
  return envelope;
}

/**
 * Close the delegated run and put the task where a user verdict can be recorded:
 * `QUEUED → EXECUTING` by the claim, then the coordinator's own task-level
 * result, which is the branch that carries `execution_payload_digest` (the
 * root-result branch demands `workflow_status === "ACTIVE"` and so cannot be
 * reached once a delegation has been approved and reserved).
 */
function awaitUserVerdict(fixture, resultDigest) {
  recordWorkflowEvent(fixture.paths, "WORKFLOW_TASK_CLAIMED", {
    task_id: fixture.taskId,
    agent_id: "main",
  });
  recordWorkflowEvent(fixture.paths, "WORKFLOW_RESULT_RECORDED", {
    task_id: fixture.taskId,
    agent_id: "main",
    payload_digest: resultDigest,
  });
  return resultDigest;
}

test("K1 1: a cancelled delegation discards the announce as an inactive delegation", async () => {
  const fixture = seeded();
  try {
    recordWorkflowEvent(fixture.paths, "WORKFLOW_CANCELLED", {
      task_id: fixture.taskId,
      reason_code: "PARENT_CANCELLED",
      actor: "main",
    });
    const run = Object.values(
      readSnapshot(fixture.paths).tasks[fixture.taskId].delegations,
    )[0];
    assert.equal(run.run_state, "CANCELLED");
    const decision = await fixture.guard.beforeAnnounce(fixture.event);
    assert.deepEqual(decision, {
      action: "discard",
      reason: "AUTH_DELEGATION_INACTIVE",
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("K1 2: the revision-mismatch disjunct has no producing sequence, and is recorded as unreachable", () => {
  // `guard.mjs:1977-1981` collapses THREE causes into one anonymous discard.
  // Two of them are reachable and tested below (K1 1, K1 3). The middle one —
  // `run.brief_revision !== owner.task.brief_revision` — is not, and this test
  // states why instead of fabricating a fixture for it:
  //   * `WORKFLOW_BRIEF_ACTIVATED` is the only event that advances
  //     `task.brief_revision` (`workflow.mjs:1508`),
  //   * it is gated on `workflow_status === "ACTIVE" && brief_state === "ACTIVE"`
  //     (`workflow.mjs:1234-1236`),
  //   * and a delegation cannot exist in that state: `WORKFLOW_SPAWN_RESERVED`
  //     requires the post-approval state (`workflow.mjs:1223`) and the approval
  //     itself moves the task out of ACTIVE into QUEUED (`workflow.mjs:753`).
  // Measured, not argued: the second activation is refused on a task that
  // already carries a reserved run.
  const fixture = seeded();
  try {
    assert.throws(
      () =>
        recordWorkflowEvent(fixture.paths, "WORKFLOW_BRIEF_ACTIVATED", {
          task_id: fixture.taskId,
          brief_revision: 2,
          semantic_contract_status: "VALID",
          nodes: [briefNode("o1")],
        }),
      /INVALID_STATE_TRANSITION/u,
    );
    // The branch still carries a declared reason so that, if this verdict is
    // ever wrong, the diagnostic names the cause instead of saying nothing.
    const guardSource = readFileSync(
      path.join(
        fileURLToPath(new URL(".", import.meta.url)),
        "..",
        "integrations",
        "openclaw",
        "topology",
        "lib",
        "guard.mjs",
      ),
      "utf8",
    );
    // `beforeAnnounce` is the last method of the guard object, and the only
    // place in this file that can answer `discard`, so the slice runs to EOF.
    const announce = guardSource.slice(
      guardSource.indexOf("beforeAnnounce(event) {"),
    );
    const discards = [...announce.matchAll(/action: "discard"/gu)];
    assert.equal(
      discards.length,
      4,
      "the announce seam has four discard sites",
    );
    const attributed = [
      ...announce.matchAll(/action: "discard",\s*reason: "([A-Z0-9_]+)"/gu),
    ];
    for (const [, reason] of attributed) {
      assert.ok(
        MATRIX.runtime_reasons.includes(reason),
        `${reason} is not declared in policy/reason-code-matrix.json`,
      );
    }
    assert.equal(
      attributed.length,
      4,
      "every announce discard must name a reason, including the unreachable clause",
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("K1 3: a closed brief with a live revision discards as SUPERSEDED_REVISION", async () => {
  const fixture = seeded();
  try {
    const envelope = acceptChildResult(fixture, claim("final result"));
    awaitUserVerdict(fixture, envelope.payload_digest);
    recordWorkflowEvent(fixture.paths, "WORKFLOW_USER_RESULT_ACCEPTED", {
      task_id: fixture.taskId,
      actor: "user",
      channel: "results",
      decision: "ACCEPT",
      result_digest: envelope.payload_digest,
    });
    const task = readSnapshot(fixture.paths).tasks[fixture.taskId];
    const run = Object.values(task.delegations)[0];
    assert.equal(task.brief_state, "CLOSED");
    assert.equal(run.run_state, "COMPLETE");
    assert.equal(run.brief_revision, task.brief_revision);
    const decision = await fixture.guard.beforeAnnounce(fixture.event);
    assert.deepEqual(decision, {
      action: "discard",
      reason: "SUPERSEDED_REVISION",
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("K1 4: a repeated accepted payload with no next run discards as STALE_RESULT", async () => {
  const fixture = seeded();
  try {
    const payload = claim("already accepted");
    acceptChildResult(fixture, payload);
    const decision = await fixture.guard.beforeAnnounce({
      ...fixture.event,
      phase: "completion",
      findings: JSON.stringify(payload),
    });
    assert.deepEqual(decision, { action: "discard", reason: "STALE_RESULT" });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("K1 5: every reason this seam can emit is a declared runtime reason", async () => {
  const fixtures = [];
  const emitted = [];
  try {
    const cancelled = seeded();
    fixtures.push(cancelled);
    recordWorkflowEvent(cancelled.paths, "WORKFLOW_CANCELLED", {
      task_id: cancelled.taskId,
      reason_code: "PARENT_CANCELLED",
      actor: "main",
    });
    emitted.push(
      (await cancelled.guard.beforeAnnounce(cancelled.event)).reason,
    );

    const closed = seeded();
    fixtures.push(closed);
    const envelope = acceptChildResult(closed, claim("closed task result"));
    awaitUserVerdict(closed, envelope.payload_digest);
    recordWorkflowEvent(closed.paths, "WORKFLOW_USER_RESULT_ACCEPTED", {
      task_id: closed.taskId,
      actor: "user",
      channel: "results",
      decision: "ACCEPT",
      result_digest: envelope.payload_digest,
    });
    emitted.push((await closed.guard.beforeAnnounce(closed.event)).reason);

    const stale = seeded();
    fixtures.push(stale);
    acceptChildResult(stale, claim("stale result"));
    emitted.push(
      (
        await stale.guard.beforeAnnounce({
          ...stale.event,
          phase: "completion",
          findings: JSON.stringify(claim("stale result")),
        })
      ).reason,
    );
  } finally {
    for (const fixture of fixtures) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
  assert.equal(emitted.length, 3);
  for (const reason of emitted) {
    assert.ok(
      MATRIX.runtime_reasons.includes(reason),
      `${reason} is not declared in policy/reason-code-matrix.json`,
    );
  }
});

test("K1 6: the boundary prints the guard's real discard reason, not REASON_UNDECLARED", async () => {
  const fixture = seeded();
  const scope = fixture.root;
  const lines = [];
  const original = console.error;
  const unregister = registerNativeGuard(scope, fixture.guard);
  console.error = (...args) => lines.push(args.join(" "));
  try {
    recordWorkflowEvent(fixture.paths, "WORKFLOW_CANCELLED", {
      task_id: fixture.taskId,
      reason_code: "PARENT_CANCELLED",
      actor: "main",
    });
    const value = await gateNativeAnnounce(
      {
        plugins: {
          entries: {
            "zink-governance": {
              enabled: true,
              config: { ledgerRoot: scope },
            },
          },
        },
      },
      fixture.event,
      undefined,
    );
    // The host-visible verdict is unchanged by K-1.
    assert.deepEqual(value, { governed: true, action: "discard" });
    assert.ok(
      lines.some((line) =>
        line.includes(
          "gateNativeAnnounce discarded: reason=AUTH_DELEGATION_INACTIVE",
        ),
      ),
      `no attributed discard diagnostic was logged (lines=${lines.length})`,
    );
    assert.equal(
      lines.some((line) => line.includes("REASON_UNDECLARED")),
      false,
      "the guard declares this denial, so the seam must not report it undeclared",
    );
  } finally {
    console.error = original;
    unregister();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
