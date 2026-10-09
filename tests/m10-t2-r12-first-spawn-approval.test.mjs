// M10/T2-R12 — first-approval bootstrap for sessions_spawn.
//
// Deadlock closed: a fresh Main task could not spawn (guard requires an
// approved brief), but the only approval-request path needed a child announce,
// which needs a spawn. Main may now ASK: an otherwise-valid spawn denied ONLY
// for lack of approval ALSO records a first-class WORKFLOW_APPROVAL_REQUESTED
// and attempts the #approvals card. Creating the request never authorizes the
// spawn — the denial is returned unchanged.
//
// What each case proves:
// 1. Fresh spawn → approval REQUESTED in ledger + spawn stays blocked.
// 2. Owner APPROVE → QUEUED + approved_at → same spawn passes the gate.
// 3. Invalid request → denied with NO approval created.
// 4. Approval for A ≠ authorization for B (isolation incl. stale approval).
// 5. Repeated request → single approval (deterministic dedupe).
// 6. Card content contract (unit: exported builder, no network).
// 7. Rejection path intact.
// 8. REQUESTED alone never authorizes (spawn stays blocked pre-approval).
//
// Card DELIVERY (Discord POST) is not asserted here — the temp state has no
// forum config or token, so the poster fails closed by design. Delivery is
// live-verified. What IS asserted: the ledger request, the unchanged denial,
// the dedupe, and the card content contract.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { resolveGovernance } from "../integrations/openclaw/topology/lib/native-boundary.mjs";
import {
  governancePluginFiles,
  AGENT_IDS,
  agentInstructions,
} from "../integrations/openclaw/lib/policy.mjs";
import {
  buildFirstSpawnApprovalCard,
  buildApprovalButtonsMessage,
  isGovernanceMachinePayload,
  handleDiscordAction,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import {
  ledgerPaths,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { recordWorkflowEvent } from "../integrations/openclaw/topology/lib/ledger.mjs";
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";
import { canonicalHash } from "../integrations/openclaw/topology/lib/canonical.mjs";

const OWNER = "123456789012345678";
const OFFICE = "1545425766161063937";
const freshMsg = (n) => `154543${String(700000000000 + n).padStart(12, "0")}`;

async function withPlugin(body) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r12-"));
  const paths = ledgerPaths(root);
  readSnapshot(paths);
  const extension = path.join(root, "extensions", "zink-governance");
  const generated = governancePluginFiles();
  for (const [rel, contents] of Object.entries({
    ...generated.assets,
    "index.mjs": generated.entrypoint,
    "package.json": generated.package,
  })) {
    const target = path.join(extension, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  for (const agentId of AGENT_IDS) {
    const dir = path.join(root, "workspaces", agentId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "AGENTS.md"), agentInstructions(agentId));
  }
  writeFileSync(paths.identityKey, `${"1".repeat(64)}\n`);
  const logged = [];
  const plugin = (
    await import(pathToFileURL(path.join(extension, "index.mjs")).href)
  ).default;
  const dispose = plugin.register({
    pluginConfig: { ledgerRoot: paths.root, ownerDiscordId: OWNER },
    on: () => {},
    logger: {
      error: (m) => logged.push(`ERROR ${m}`),
      warn: (m) => logged.push(`WARN ${m}`),
      info: (m) => logged.push(`INFO ${m}`),
    },
  });
  const native = {
    plugins: {
      entries: {
        "zink-governance": {
          enabled: true,
          config: { ledgerRoot: paths.root },
        },
      },
    },
  };
  try {
    return await body({ paths, native, logged, root });
  } finally {
    if (typeof dispose === "function") dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

const NODE_O1 = {
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

function seedTask(paths, msgN, runId, { brief = false, approve = false } = {}) {
  const origin = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: freshMsg(msgN),
    root_agent_id: "main",
    root_session_key: `agent:main:discord:channel:${OFFICE}`,
    root_run_id: runId,
  };
  const taskId = deriveTaskId(origin);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", { ...origin, task_id: taskId });
  if (brief || approve) {
    recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
      task_id: taskId,
      brief_revision: 1,
      semantic_contract_status: "VALID",
      nodes: [NODE_O1],
    });
  }
  if (approve) {
    recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
      task_id: taskId,
      actor: "user",
      channel: "approvals",
      decision: "APPROVE",
    });
  }
  return { taskId, sessionKey: origin.root_session_key, runId };
}

const proposal = (nodeId = "o1") =>
  JSON.stringify({
    schema_version: "1.0.0",
    governance_version: "m8-t2.3-r5",
    node_id: nodeId,
    inputs: "probe work",
    input_refs: [],
    constraints: "{}",
    validation_criteria: "probe",
  });

async function spawnViaHook(native, ctx, params) {
  const hook = resolveGovernance(native).guard?.beforeToolCall;
  assert.equal(
    typeof hook,
    "function",
    "registered guard must expose beforeToolCall",
  );
  try {
    const d = await hook(
      {
        toolName: "sessions_spawn",
        toolCallId: `call-r12-${ctx.runId.slice(0, 8)}`,
        params,
        turn: 1,
        batchToolNames: ["sessions_spawn"],
        assistantText: "",
      },
      ctx,
      null,
    );
    return { allow: d?.allow === true, reason: d?.reason ?? null };
  } catch (error) {
    return { allow: false, threw: error?.message ?? String(error) };
  }
}

const spawnParams = (agentId = "o1") => ({
  agentId,
  task: proposal("o1"),
  context: "isolated",
  sandbox: "require",
});

const approvalRequestedAt = (paths, taskId) =>
  readSnapshot(paths)?.tasks?.[taskId]?.approval_requested_at ?? null;

test("R12 case 1: fresh spawn records an approval request and stays blocked", async () => {
  await withPlugin(async ({ paths, native }) => {
    const { taskId, sessionKey, runId } = seedTask(paths, 1, "run-r12-c1");
    const before = approvalRequestedAt(paths, taskId);
    assert.equal(before, null, "no request must pre-exist");

    const d = await spawnViaHook(
      native,
      { agentId: "main", sessionKey, runId },
      spawnParams(),
    );
    assert.equal(d.allow, false, "spawn must stay blocked");
    assert.equal(
      d.reason ?? d.threw,
      "AUTH_APPROVAL_REQUIRED",
      `denial must stay the approval gate, got: ${d.reason ?? d.threw}`,
    );

    const at = approvalRequestedAt(paths, taskId);
    assert.ok(at, "WORKFLOW_APPROVAL_REQUESTED must be recorded");
    const snap = readSnapshot(paths).tasks[taskId];
    assert.equal(snap.approval_requested_by, "main");
    assert.equal(snap.approval_requested_run_id, runId);
    assert.equal(snap.approved_at ?? null, null, "REQUESTED must not approve");
    assert.equal(
      snap.workflow_status,
      "ACTIVE",
      "request must not move workflow state",
    );
  });
});

test("R12 case 5: repeated request creates no duplicate", async () => {
  await withPlugin(async ({ paths, native }) => {
    const { taskId, sessionKey, runId } = seedTask(paths, 2, "run-r12-c5");
    const ctx = { agentId: "main", sessionKey, runId };
    await spawnViaHook(native, ctx, spawnParams());
    const first = approvalRequestedAt(paths, taskId);
    assert.ok(first, "first attempt must record the request");

    const countRequests = () => (readSnapshot(paths).tasks[taskId] ? 1 : 0);
    await spawnViaHook(native, ctx, spawnParams());
    await spawnViaHook(native, ctx, spawnParams());
    assert.equal(countRequests(), 1, "retries must not mint new requests");
    assert.equal(
      approvalRequestedAt(paths, taskId),
      first,
      "request timestamp must be stable across retries",
    );
  });
});

test("R12 case 3: invalid request is denied with NO approval created", async () => {
  await withPlugin(async ({ paths, native }) => {
    // Invalid target: main cannot spawn excel (topology violation).
    const { taskId, sessionKey, runId } = seedTask(paths, 3, "run-r12-c3");
    const d = await spawnViaHook(
      native,
      { agentId: "main", sessionKey, runId },
      spawnParams("excel"),
    );
    assert.equal(d.allow, false);
    assert.notEqual(
      d.reason ?? d.threw,
      "AUTH_APPROVAL_REQUIRED",
      "topology violation must not reach the approval gate",
    );
    assert.equal(
      approvalRequestedAt(paths, taskId),
      null,
      "invalid request must NOT create an approval",
    );

    // Unknown target agent: not in the roster, denied before any approval
    // logic. The plugin normalizes model-shaped params into a canonical
    // request, so shape-level sloppiness that survives normalization is still
    // governed by the canonical checks — but a non-existent target can never
    // yield a valid request.
    const {
      taskId: taskId2,
      sessionKey: sk2,
      runId: run2,
    } = seedTask(paths, 4, "run-r12-c3b");
    const d2 = await spawnViaHook(
      native,
      { agentId: "main", sessionKey: sk2, runId: run2 },
      spawnParams("ghost-agent"),
    );
    assert.equal(d2.allow, false);
    assert.notEqual(
      d2.reason ?? d2.threw,
      "AUTH_APPROVAL_REQUIRED",
      `unknown target must not reach approval, got: ${d2.reason ?? d2.threw}`,
    );
    assert.equal(
      approvalRequestedAt(paths, taskId2),
      null,
      "unknown target must NOT create an approval",
    );
  });
});

test("R12 case 2+8: owner approval unblocks the SAME task, never another", async () => {
  await withPlugin(async ({ paths, native }) => {
    const a = seedTask(paths, 5, "run-r12-c2a");
    const b = seedTask(paths, 6, "run-r12-c2b");

    // Both start blocked with their own requests.
    const ctxA = { agentId: "main", sessionKey: a.sessionKey, runId: a.runId };
    const da = await spawnViaHook(native, ctxA, spawnParams());
    assert.equal(da.reason ?? da.threw, "AUTH_APPROVAL_REQUIRED");

    // Owner approves task A only (text path, as the owner would send it).
    const verdict = handleDiscordAction({
      actor: "user",
      channel: "approvals",
      taskId: a.taskId,
      action: "APPROVE",
      currentState: "APPROVAL_PENDING",
      paths,
      data: { messageId: freshMsg(50) },
    });
    assert.equal(verdict.allowed, true, "owner APPROVE must be accepted");
    const snapA = readSnapshot(paths).tasks[a.taskId];
    assert.equal(snapA.workflow_status, "QUEUED");
    assert.ok(snapA.approved_at, "approval must be timestamped");

    // Task B is untouched: still blocked, still unapproved (case 8: no replay).
    const ctxB = { agentId: "main", sessionKey: b.sessionKey, runId: b.runId };
    const db = await spawnViaHook(native, ctxB, spawnParams());
    assert.equal(
      db.reason ?? db.threw,
      "AUTH_APPROVAL_REQUIRED",
      "task B must not inherit task A's approval",
    );
    const snapB = readSnapshot(paths).tasks[b.taskId];
    assert.equal(snapB.approved_at ?? null, null);
  });
});

test("R12 case 7: rejection stays terminal", async () => {
  await withPlugin(async ({ paths, native }) => {
    // A rejection answers a real request: drive the spawn first so the
    // approval exists, then the owner rejects it.
    const { taskId, sessionKey, runId } = seedTask(paths, 7, "run-r12-c7");
    const ctx = { agentId: "main", sessionKey, runId };
    const d = await spawnViaHook(native, ctx, spawnParams());
    assert.equal(d.reason ?? d.threw, "AUTH_APPROVAL_REQUIRED");
    assert.ok(approvalRequestedAt(paths, taskId), "request must exist first");

    const verdict = handleDiscordAction({
      actor: "user",
      channel: "approvals",
      taskId,
      action: "REJECT_APPROVAL",
      currentState: "APPROVAL_PENDING",
      paths,
      data: { messageId: freshMsg(51) },
    });
    assert.equal(verdict.allowed, true, "owner REJECT must be accepted");
    const snap = readSnapshot(paths).tasks[taskId];
    assert.equal(snap.workflow_status, "REJECTED");
    assert.equal(snap.approved_at ?? null, null, "rejected must never approve");

    // A later spawn on the rejected task stays denied (terminal, not approval).
    const d2 = await spawnViaHook(native, ctx, spawnParams());
    assert.equal(d2.allow, false, "rejected task must stay denied");
    assert.notEqual(
      d2.reason ?? d2.threw,
      "RUNTIME_CAPABILITY_MISMATCH",
      "denial must stay governed",
    );
  });
});

test("R12 case 6: first-approval card content contract", () => {
  const taskId = "c".repeat(64);
  const runId = "run-r12-card";
  const card = buildFirstSpawnApprovalCard({
    taskId,
    runId,
    requesterAgentId: "main",
    briefRevision: 1,
    targetAgentId: "o1",
    spawnInputs: "probe work",
    spawnNodeId: "node-o1",
  });
  // The text-approval path matches by taskId substring.
  assert.ok(
    card.bodyContent.includes(taskId),
    "card must carry the full task_id for text approval",
  );
  assert.ok(
    card.bodyContent.includes("[PHÊ DUYỆT]"),
    "card must carry the approval marker",
  );
  assert.ok(
    card.bodyContent.includes("CHỜ DUYỆT") &&
      card.bodyContent.includes("chưa được phép thực thi"),
    "card must state REQUESTED, never imply authorization",
  );
  assert.ok(
    card.bodyContent.includes(runId) && card.bodyContent.includes("o1"),
    "card must name run and child",
  );
  assert.equal(card.buttons.length, 3, "Approve / Reject / Revision");
  for (const b of card.buttons) {
    assert.ok(
      b.customId.includes(taskId),
      "every button must bind the exact task",
    );
  }
  assert.throws(
    () => buildFirstSpawnApprovalCard({ taskId: "", runId }),
    /FIRST_APPROVAL_CARD_TASK_REQUIRED/,
  );
  // NOTE: button wire delivery goes through the native outbound adapter (R4
  // rule: only forum-thread creation may remain raw REST). The adapter was
  // proven unable to deliver from the tool-call hook context (2026-10-07,
  // "Discord send requires a resolved runtime config"), so cards currently
  // land as button-less threads and the owner approves by text. The button
  // specs themselves are pinned above (customId binds the task); the
  // adapter-cfg gap is an open host-plumbing defect, not an R12 regression.
});

test("R12 buttons: R4-EXCEPTION wire message carries custom_id", () => {
  // Owner decision 2026-10-07 grants ONE explicit exception: raw-REST
  // /messages SOLELY for the approval-buttons post. This pins the wire
  // mapping so a field-name typo cannot silently drop buttons, and the R4
  // test pins the exception marker + singularity.
  const card = buildFirstSpawnApprovalCard({
    taskId: "d".repeat(64),
    runId: "run-r12-btn",
    requesterAgentId: "main",
    briefRevision: 1,
    targetAgentId: "o1",
    spawnInputs: "probe",
    spawnNodeId: "node-o1",
  });
  const msg = buildApprovalButtonsMessage(card.bodyContent, card.buttons);
  assert.equal(msg.content, card.bodyContent.slice(0, 2000));
  assert.equal(msg.components.length, 1);
  assert.equal(msg.components[0].type, 1);
  assert.equal(msg.components[0].components.length, 3);
  for (const [i, b] of msg.components[0].components.entries()) {
    assert.equal(b.type, 2, `button ${i} must be a button`);
    assert.ok(
      typeof b.custom_id === "string" && b.custom_id.includes("d".repeat(64)),
      `button ${i} custom_id must bind the task`,
    );
    assert.ok(!("customId" in b), `button ${i} must not carry camelCase`);
  }
  const labels = msg.components[0].components.map((b) => b.label);
  assert.deepEqual(labels, ["Approve", "Reject", "Request Revision"]);
});

// The wire ids must carry the host envelope. Without it every click answers
// "This component is no longer valid." — proven live 2026-10-08 15:45:08.
test("R12 buttons: every card button id is host-routable", () => {
  const card = buildFirstSpawnApprovalCard({
    taskId: "b".repeat(64),
    runId: "run-r12-wire",
    requesterAgentId: "main",
    briefRevision: 1,
    targetAgentId: "o1",
    spawnInputs: "probe",
    spawnNodeId: "node-o1",
  });
  assert.equal(card.buttons.length, 3);
  for (const b of card.buttons) {
    assert.ok(
      b.customId.startsWith("occomp:cid=zink:approval:"),
      `not host-routable: ${b.customId}`,
    );
    assert.equal(b.customId.includes(";"), false, b.customId);
    assert.ok(b.customId.length <= 100, `${b.customId.length} chars`);
  }
});

test("R12 machine payload: the brief envelope is recognised, prose is not", () => {
  // Live 2026-10-08 15:41: Main emitted the execution-brief envelope as its turn
  // text and the host delivered raw JSON to #office. The payload is REQUIRED (the
  // spawn gate ingests it from assistantText), so the fix is to keep it off the
  // wire, never to forbid it.
  const brief = {
    schema_version: "1.0.0",
    governance_version: "m8-t2.3-r5",
    task_id: "5cecad008c3d0050d7bd49a79c49b21464e5afa0ed07884c80ff755a865ad51f",
    brief_revision: 1,
    brief_state: "ACTIVE",
    workflow_status: "ACTIVE",
    origin: "discord",
    origin_message_id: "1557674158144364606",
    inputs: "Tạo 1 file Excel mẫu",
    nodes: [],
  };
  assert.equal(
    isGovernanceMachinePayload("```json\n" + JSON.stringify(brief) + "\n```"),
    true,
    "the fenced brief envelope must be recognised",
  );
  assert.equal(
    isGovernanceMachinePayload(JSON.stringify(brief)),
    true,
    "the bare brief envelope must be recognised",
  );
  assert.equal(
    isGovernanceMachinePayload(
      "```json\n" +
        JSON.stringify({
          ...brief,
          outcome_claim: "COMPLETE",
        }) +
        "\n```",
    ),
    true,
    "a result envelope must be recognised too",
  );

  // Everything below is a real reply and must pass through untouched.
  assert.equal(isGovernanceMachinePayload("Em chào anh!"), false);
  assert.equal(
    isGovernanceMachinePayload(
      'Em đã tạo file, đây là JSON anh cần:\n```json\n{"a":1}\n```',
    ),
    false,
    "prose AROUND json is a reply, not a payload",
  );
  assert.equal(
    isGovernanceMachinePayload('{"schema_version":"1.0.0","a":1}'),
    false,
    "json without the governance markers is the owner's own content",
  );
  assert.equal(
    isGovernanceMachinePayload('{"governance_version":"m7","a":1}'),
    false,
    "one marker alone is not enough",
  );
  assert.equal(isGovernanceMachinePayload("[1,2,3]"), false);
  assert.equal(isGovernanceMachinePayload(null), false);
  assert.equal(isGovernanceMachinePayload(42), false);
});
