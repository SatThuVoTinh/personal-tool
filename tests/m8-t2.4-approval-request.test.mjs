//
// SKIP-FAMILY: live-ledger
//
// M12/T9 F-197 (R5-E09-03) / H3: this lane may skip, and it declares WHICH
// family it belongs to, so the skip-expectation gate can tell an explained
// skip from an unexplained one. The family-to-lane map is derived from the
// repository's own lane list; the expectation lives in
// `docs/contracts/ci-skip-expectations.json`.
// R6 — no recorded approval request means no approval.
//
// Before R6, "approvable" was inferred from `ACTIVE && !approved_at &&
// !claimed_at`. WORKFLOW_OPENED sets workflow_status to ACTIVE, so every freshly
// opened task looked approval-pending and the owner could approve a request that
// was never surfaced. These tests pin the corrected rule and, critically, prove
// the 103-event production history still replays unchanged.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";
import {
  GOVERNANCE_VERSION,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";

const PRODUCTION_LEDGER =
  "/home/hoang_vinh/.openclaw-zink/operator/m7-t2/ledger";

const OPENED = {
  origin: "discord",
  origin_principal_ref: "a".repeat(64),
  origin_message_id: "123456789012345678",
  root_agent_id: "main",
  root_session_key: "root-session",
  root_run_id: "root-run",
};

// M12/T9 F-529: the approvals thread a surfaced card is recorded in. An
// APPROVE against a recorded request now requires the durable SURFACED record
// and must name this thread (the tests/agent-owner-F-123.test.mjs fixture
// pattern).
const APPROVAL_THREAD = "900000000000000031";

const surfaced = (taskId) => ({
  task_id: taskId,
  channel: "approvals",
  thread_id: APPROVAL_THREAD,
});

function lineage(tag) {
  const root = mkdtempSync(path.join(os.tmpdir(), `r6-${tag}-`));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  return { root, paths };
}

function openTask(paths, tag = "b") {
  // The reducer requires deriveTaskId(payload) === task_id, so the id is
  // derived, never invented.
  const payload = {
    ...OPENED,
    origin_message_id: `12345678901234567${tag.charCodeAt(0) % 10}`,
  };
  const taskId = deriveTaskId(payload);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...payload,
    task_id: taskId,
  });
  return taskId;
}

const byPrefix = (tasks, prefix) =>
  Object.values(tasks).find((t) => (t.task_id ?? "").startsWith(prefix));

const request = (taskId, agentId = "o1", runId = "root-run") => ({
  task_id: taskId,
  agent_id: agentId,
  session_key: OPENED.root_session_key,
  run_id: runId,
});

describe("R6 — WORKFLOW_APPROVAL_REQUESTED contract", () => {
  it("A. the event schema accepts a well-formed request and rejects a malformed one", () => {
    const base = {
      schema_version: "1.0.0",
      governance_version: GOVERNANCE_VERSION,
      sequence: 1,
      previous_event_digest: null,
      event_digest: "f".repeat(64),
      created_at: new Date().toISOString(),
      type: "WORKFLOW_APPROVAL_REQUESTED",
      payload: request("b".repeat(64)),
    };
    assert.doesNotThrow(() =>
      validateContract("ledger-event", base, Number.MAX_SAFE_INTEGER),
    );
    // A session key is mandatory: the request must be attributable to a run.
    const noSession = JSON.parse(JSON.stringify(base));
    delete noSession.payload.session_key;
    assert.throws(() =>
      validateContract("ledger-event", noSession, Number.MAX_SAFE_INTEGER),
    );
    // An unexpected key is refused: Discord presentation data must not leak in.
    const withThread = JSON.parse(JSON.stringify(base));
    withThread.payload.thread_id = "123";
    assert.throws(() =>
      validateContract("ledger-event", withThread, Number.MAX_SAFE_INTEGER),
    );
  });

  it("B. the reducer projects the request without changing workflow_status", () => {
    const { root, paths } = lineage("project");
    try {
      const taskId = openTask(paths);
      recordWorkflowEvent(
        paths,
        "WORKFLOW_APPROVAL_REQUESTED",
        request(taskId),
      );
      const task = readSnapshot(paths).tasks[taskId];
      assert.ok(task.approval_requested_at, "the request must be projected");
      assert.equal(task.approval_requested_by, "o1");
      assert.equal(task.approval_requested_run_id, "root-run");
      assert.equal(
        task.workflow_status,
        "ACTIVE",
        "workflow_status must stay ACTIVE so existing ACTIVE guards keep working",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("E. a duplicate request from the SAME run is an idempotent no-op", () => {
    const { root, paths } = lineage("dupreq");
    try {
      const taskId = openTask(paths);
      recordWorkflowEvent(
        paths,
        "WORKFLOW_APPROVAL_REQUESTED",
        request(taskId),
      );
      const afterFirst = readSnapshot(paths).sequence;
      assert.doesNotThrow(() =>
        recordWorkflowEvent(
          paths,
          "WORKFLOW_APPROVAL_REQUESTED",
          request(taskId),
        ),
      );
      const snap = readSnapshot(paths);
      assert.equal(
        snap.sequence,
        afterFirst,
        "a retry must not append a second approval opportunity",
      );
      assert.equal(snap.tasks[taskId].workflow_status, "ACTIVE");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("E2. a different requester while one is pending is refused", () => {
    const { root, paths } = lineage("otherreq");
    try {
      const taskId = openTask(paths);
      recordWorkflowEvent(
        paths,
        "WORKFLOW_APPROVAL_REQUESTED",
        request(taskId, "o1"),
      );
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_APPROVAL_REQUESTED",
            request(taskId, "o2"),
          ),
        /INVALID_STATE_TRANSITION/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("N. a request after a revision cycle is allowed (revision is a new opportunity)", async () => {
    // NOTE: exercised at the REDUCER level on purpose. The event contract's
    // `decision` enum does not include "REQUEST_REVISION", so REVISING is not
    // reachable through the schema-validated write path. That divergence is a
    // PRE-EXISTING defect (the plugin writes decision:"REQUEST_REVISION" at
    // index.mjs:730) and is deliberately out of R6 scope; this test pins the R6
    // revision-cycle rule without depending on it.
    const { applyWorkflowEvent } =
      await import("../integrations/openclaw/topology/lib/workflow.mjs");
    const { root, paths } = lineage("revision");
    try {
      const taskId = openTask(paths);
      let projection = readSnapshot(paths);
      applyWorkflowEvent(
        projection,
        "WORKFLOW_APPROVAL_REQUESTED",
        request(taskId),
        new Date().toISOString(),
        "current",
      );
      projection = applyWorkflowEvent(
        projection,
        "WORKFLOW_USER_APPROVAL_DECIDED",
        {
          task_id: taskId,
          actor: "user",
          channel: "approvals",
          decision: "REQUEST_REVISION",
          reason: "needs detail",
        },
        new Date().toISOString(),
        "current",
      );
      assert.equal(projection.tasks[taskId].workflow_status, "REVISING");
      const afterRevision = applyWorkflowEvent(
        projection,
        "WORKFLOW_APPROVAL_REQUESTED",
        request(taskId, "o1", "root-run-2"),
        new Date().toISOString(),
        "current",
      );
      assert.equal(
        afterRevision.tasks[taskId].approval_requested_run_id,
        "root-run-2",
        "a revision cycle must open a fresh approval opportunity",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("O. a request on a decided or terminal task is refused", () => {
    const { root, paths } = lineage("decided");
    try {
      const taskId = openTask(paths);
      recordWorkflowEvent(
        paths,
        "WORKFLOW_APPROVAL_REQUESTED",
        request(taskId),
      );
      recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
        task_id: taskId,
        actor: "user",
        channel: "approvals",
        decision: "APPROVE",
      });
      assert.equal(readSnapshot(paths).tasks[taskId].workflow_status, "QUEUED");
      // QUEUED is not ACTIVE/REVISING, so a fresh request is refused.
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_APPROVAL_REQUESTED",
            request(taskId, "o1", "root-run-9"),
          ),
        /INVALID_STATE_TRANSITION/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// C, D, F, G, H, I exercise the deployed PLUGIN path, which is where the
// APPROVAL_PENDING derivation actually lives.
async function pluginHarness(tag) {
  const plugin = (
    await import("../integrations/openclaw/plugins/zink-governance/index.mjs")
  ).default;
  const root = mkdtempSync(path.join(os.tmpdir(), `r6-plugin-${tag}-`));
  const ledgerRoot = path.join(root, "operator", "m7-t2", "ledger");
  mkdirSync(ledgerRoot, { recursive: true });
  const policy = await import("../integrations/openclaw/lib/policy.mjs");
  const { mkdirSync: mk, writeFileSync: wf } = await import("node:fs");
  for (const agentId of [
    "main",
    "o1",
    "o2",
    "excel",
    "power-bi",
    "sql",
    "python",
  ]) {
    const dir = path.join(root, "workspaces", agentId);
    mk(dir, { recursive: true });
    wf(path.join(dir, "AGENTS.md"), policy.agentInstructions(agentId));
  }
  const hooks = new Map();
  const logs = [];
  plugin.register({
    pluginConfig: {
      ledgerRoot,
      ownerDiscordId: "123456789012345678",
      enabled: true,
    },
    on: (n, f) => hooks.set(n, f),
    registerTool: () => {},
    logger: {
      warn: (m) => logs.push(`warn:${m}`),
      info: (m) => logs.push(`info:${m}`),
      error: (m) => logs.push(`error:${m}`),
    },
  });
  return { root, paths: ledgerPaths(root), hooks, logs, ledgerRoot };
}

// (No OWNER constant: the authorized-actor path uses the role name "user",
// exactly as production does. See test E2 for the snowflake-as-actor negative.)

describe("R6 — approval semantics through the deployed plugin", () => {
  it("C. APPROVE on an OPENED task with NO request is rejected", async () => {
    const h = await pluginHarness("norequest");
    try {
      const taskId = openTask(h.paths);
      const res =
        h.root &&
        (
          await import("../integrations/openclaw/plugins/zink-governance/index.mjs")
        ).handleDiscordAction({
          actor: "user",
          channel: "approvals",
          taskId,
          action: "APPROVE",
          paths: h.paths,
        });
      assert.equal(res.allowed, false, "must not be allowed");
      assert.match(res.reason, /INVALID_STATE_TRANSITION/u);
      assert.equal(
        readSnapshot(h.paths).tasks[taskId].workflow_status,
        "ACTIVE",
        "the task must remain un-approved",
      );
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });

  // The actor below is the production-legitimate role name. Production proves the
  // owner at the sender gate and never passes a raw account snowflake here;
  // a snowflake-as-actor case is covered separately by test E2 above.
  it("D. after a recorded request, owner APPROVE reaches QUEUED", async () => {
    const h = await pluginHarness("withrequest");
    try {
      const taskId = openTask(h.paths);
      recordWorkflowEvent(
        h.paths,
        "WORKFLOW_APPROVAL_REQUESTED",
        request(taskId),
      );
      // M12/T9 F-529: the surfaced record is load-bearing — without it the
      // APPROVE is now denied with APPROVAL_SURFACE_RECORD_REQUIRED.
      recordWorkflowEvent(
        h.paths,
        "WORKFLOW_APPROVAL_SURFACED",
        surfaced(taskId),
      );
      const res = (
        await import("../integrations/openclaw/plugins/zink-governance/index.mjs")
      ).handleDiscordAction({
        actor: "user",
        channel: "approvals",
        taskId,
        action: "APPROVE",
        paths: h.paths,
        data: { threadId: APPROVAL_THREAD },
      });
      assert.equal(res.allowed, true, `expected allow, got ${res.reason}`);
      const task = readSnapshot(h.paths).tasks[taskId];
      assert.equal(task.workflow_status, "QUEUED");
      assert.ok(task.approved_at, "the decision must be recorded");
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });

  // Production never passes a raw account snowflake as the actor: the owner is
  // proven at the sender gate (sender vs validated configured owner) and only
  // the role name travels into handleDiscordAction. A raw snowflake must
  // therefore NOT be treated as an authorized actor, even when it matches the
  // configured owner id — identity is established before this function, never
  // by it.
  it("E2. a raw account snowflake is not an authorized actor", async () => {
    const h = await pluginHarness("snowflake");
    try {
      const taskId = openTask(h.paths);
      recordWorkflowEvent(
        h.paths,
        "WORKFLOW_APPROVAL_REQUESTED",
        request(taskId),
      );
      const res = (
        await import("../integrations/openclaw/plugins/zink-governance/index.mjs")
      ).handleDiscordAction({
        actor: "123456789012345678",
        channel: "approvals",
        taskId,
        action: "APPROVE",
        paths: h.paths,
      });
      assert.equal(res.allowed, false);
      assert.match(res.reason, /AUTHORITY_DENIED/u);
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });

  it("F, G, H. duplicate, non-owner and wrong-channel all remain refused", async () => {
    const h = await pluginHarness("guards");
    try {
      const mod =
        await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
      const taskId = openTask(h.paths);
      recordWorkflowEvent(
        h.paths,
        "WORKFLOW_APPROVAL_REQUESTED",
        request(taskId),
      );
      // M12/T9 F-529: the first APPROVE is only admissible with the durable
      // record of the surfaced card; the duplicate below must then be refused
      // by the STATE guard, not by the record requirement.
      recordWorkflowEvent(
        h.paths,
        "WORKFLOW_APPROVAL_SURFACED",
        surfaced(taskId),
      );
      const dup = mod.handleDiscordAction({
        actor: "user",
        channel: "approvals",
        taskId,
        action: "APPROVE",
        paths: h.paths,
        data: { threadId: APPROVAL_THREAD },
      });
      mod.handleDiscordAction({
        actor: "user",
        channel: "approvals",
        taskId,
        action: "APPROVE",
        paths: h.paths,
        data: { threadId: APPROVAL_THREAD },
      });
      const second = mod.handleDiscordAction({
        actor: "user",
        channel: "approvals",
        taskId,
        action: "APPROVE",
        paths: h.paths,
        data: { threadId: APPROVAL_THREAD },
      });
      assert.equal(dup.allowed, true);
      assert.equal(second.allowed, false, "duplicate approve must be refused");
      assert.match(second.reason, /INVALID_STATE_TRANSITION/u);

      const task2 = openTask(h.paths, "c");
      recordWorkflowEvent(
        h.paths,
        "WORKFLOW_APPROVAL_REQUESTED",
        request(task2),
      );
      const nonOwner = mod.handleDiscordAction({
        actor: "999999999999999999",
        channel: "approvals",
        taskId: task2,
        action: "APPROVE",
        paths: h.paths,
      });
      assert.equal(nonOwner.allowed, false);
      assert.match(nonOwner.reason, /AUTHORITY_DENIED/u);

      const wrongChannel = mod.handleDiscordAction({
        actor: "user",
        channel: "results",
        taskId: task2,
        action: "APPROVE",
        paths: h.paths,
      });
      assert.equal(wrongChannel.allowed, false);
      assert.match(wrongChannel.reason, /CHANNEL_MISMATCH/u);
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });

  it("G2. an OPENED task cannot reach execution merely because APPROVE was refused", async () => {
    const h = await pluginHarness("noexec");
    try {
      const mod =
        await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
      const taskId = openTask(h.paths);
      mod.handleDiscordAction({
        actor: "user",
        channel: "approvals",
        taskId,
        action: "APPROVE",
        paths: h.paths,
      });
      // CLAIM is only valid from QUEUED, and a reservation only from an
      // approved state, so neither can be reached without a request.
      assert.throws(
        () =>
          recordWorkflowEvent(h.paths, "WORKFLOW_TASK_CLAIMED", {
            task_id: taskId,
            agent_id: "o1",
          }),
        /INVALID_STATE_TRANSITION/u,
      );
      assert.throws(
        () =>
          recordWorkflowEvent(h.paths, "WORKFLOW_SPAWN_RESERVED", {
            task_id: taskId,
            node_id: "o1",
            request_digest: "1".repeat(64),
            agent_id: "o1",
          }),
        /AUTH_APPROVAL_REQUIRED/u,
      );
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });
});

describe("R6 — the request is recorded before the card is advertised", () => {
  it("I. the emission and its read-back precede the Discord post, and failure returns early", () => {
    // Structural proof of the ORDERING requirement. The emit path lives on
    // `beforeAnnounce`, which the plugin does NOT expose through `api.on`, so it
    // cannot be driven end-to-end in an isolated harness; driving it for real
    // would require a production Discord announce, which is out of scope. The
    // invariant is therefore asserted on the emitted plugin source: the request
    // write AND its durable read-back must both appear before the first fetch,
    // and the failure branch must return rather than fall through.
    const src = readFileSync(
      new URL(
        "../integrations/openclaw/plugins/zink-governance/index.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    const start = src.indexOf("async function maybePublishDiscordCard");
    assert.ok(start > 0, "maybePublishDiscordCard must exist");
    const body = src.slice(
      start,
      src.indexOf("\n  async function ", start + 10),
    );

    const emit = body.indexOf('"WORKFLOW_APPROVAL_REQUESTED"');
    const readBack = body.indexOf("approval_requested_at");
    const post = body.indexOf("await fetch(");
    assert.ok(emit > 0, "the request must be emitted");
    assert.ok(readBack > 0, "the request must be read back");
    assert.ok(post > 0, "the card post must exist");
    assert.ok(
      emit < post,
      "the request MUST be written before the card is advertised",
    );
    assert.ok(
      readBack < post,
      "durability MUST be confirmed before the card is advertised",
    );
    // The failure branch must abandon the post, not continue past it.
    const guard = body.slice(0, post);
    assert.match(
      guard,
      /catch \(requestError\)[\s\S]*?return;/u,
      "a failed request write must return without posting the card",
    );
  });

  it("I2. an unresolvable run writes no event, so nothing is advertised", async () => {
    // The behavioural half: with no ledger-resolvable task there is no task_id to
    // bind a request to, so the implementation cannot produce an event at all.
    const h = await pluginHarness("orderfail");
    const { findSession } =
      await import("../integrations/openclaw/topology/lib/workflow.mjs");
    try {
      assert.throws(
        () =>
          findSession(readSnapshot(h.paths), "agent:o1:nope", "no-run", false),
        /EXECUTION_STATE_UNKNOWN/u,
        "an unknown run must not resolve to a task",
      );
      assert.equal(
        readSnapshot(h.paths).sequence,
        0,
        "an unresolvable run must not produce an approval request",
      );
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });
});

describe("R6 — historical compatibility", () => {
  const hasProduction =
    process.platform === "linux" && existsSync(PRODUCTION_LEDGER);

  it("J, K, L, M. the real production ledger replays unchanged", async (t) => {
    if (!hasProduction) return t.skip("production ledger not reachable");
    const root = mkdtempSync(path.join(os.tmpdir(), "r6-history-"));
    const copy = path.join(root, "operator", "m7-t2", "ledger");
    mkdirSync(copy, { recursive: true });
    copyFileSync(
      path.join(PRODUCTION_LEDGER, "events.jsonl"),
      path.join(copy, "events.jsonl"),
    );
    copyFileSync(
      path.join(PRODUCTION_LEDGER, "snapshot.json"),
      path.join(copy, "snapshot.json"),
    );
    try {
      const eventsBefore = readFileSync(
        path.join(copy, "events.jsonl"),
        "utf8",
      );
      // Read the installed anchor before replay: readSnapshot repairs the
      // snapshot in place once a tail exists, so the pre-replay projection has
      // to be captured here to stay a comparison rather than a consequence.
      const installed = JSON.parse(
        readFileSync(path.join(copy, "snapshot.json"), "utf8"),
      );
      const paths = ledgerPaths(root);
      const snap = readSnapshot(paths);
      // M12/T2-R1: this case originally pinned the literals `103` events and `37` tasks,
      // which was a photograph of the production ledger on the day it was written. The
      // running gateway keeps appending, so the case went red on any host that can read
      // the live tree while nothing about the ledger's meaning changed. The invariant is
      // the one that matters: every event in the real log replays, and the projected
      // sequence equals the log length.
      const replayedEvents = eventsBefore.trim().split("\n").length;
      assert.equal(
        snap.sequence,
        replayedEvents,
        "every event in the real production ledger must replay",
      );
      assert.ok(
        Object.keys(snap.tasks).length >= 37,
        "the historical tasks must survive the replay",
      );

      // M: the brief-backed historical approval.
      const withBrief = byPrefix(snap.tasks, "21c7b6e5");
      assert.ok(withBrief, "21c7b6e5 must still exist");
      assert.equal(withBrief.workflow_status, "COMPLETE");
      assert.ok(withBrief.approved_at, "M: 21c7b6e5 keeps its approval");
      assert.equal(withBrief.nodes.length, 7, "its brief is untouched");

      // K and L: historical approvals that had NO brief must be untouched and
      // must NOT have gained an approval request.
      for (const prefix of ["cd8b9e6b", "145319f4"]) {
        const t = byPrefix(snap.tasks, prefix);
        assert.ok(t, `${prefix} must still be present`);
        assert.ok(t.approved_at, `${prefix} keeps its historical approval`);
        assert.equal(
          t.approval_requested_at,
          undefined,
          `${prefix} must not acquire a fabricated request`,
        );
      }

      // No task may BECOME approvable through replay. This case originally
      // asserted that zero approvable tasks exist in the production ledger,
      // which was a photograph of a quiet day: the live gateway legitimately
      // parks tasks in "requested, not yet decided", and those pending approvals
      // are real state, not replay artifacts. The invariant under test is that
      // reading history cannot invent an opportunity the deployed writer never
      // recorded — so the projection is compared against its own anchor.
      const approvableIds = (tasks) =>
        new Set(
          Object.values(tasks ?? {})
            .filter(
              (t) =>
                t.workflow_status === "ACTIVE" &&
                t.approval_requested_at &&
                !t.approved_at,
            )
            .map((t) => t.task_id),
        );
      const before = approvableIds(installed.tasks);
      const after = approvableIds(snap.tasks);
      const invented = [...after].filter((id) => !before.has(id));
      assert.deepEqual(
        invented,
        [],
        "replay must not create approval opportunities",
      );

      // The journal itself must be byte-identical: reading never rewrites.
      assert.equal(
        readFileSync(path.join(copy, "events.jsonl"), "utf8"),
        eventsBefore,
        "replay must not rewrite history",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("K2. a historical-style approval without a brief still reads as approved", async (t) => {
    if (!hasProduction) return t.skip("production ledger not reachable");
    const root = mkdtempSync(path.join(os.tmpdir(), "r6-nobrief-"));
    const copy = path.join(root, "operator", "m7-t2", "ledger");
    mkdirSync(copy, { recursive: true });
    copyFileSync(
      path.join(PRODUCTION_LEDGER, "events.jsonl"),
      path.join(copy, "events.jsonl"),
    );
    copyFileSync(
      path.join(PRODUCTION_LEDGER, "snapshot.json"),
      path.join(copy, "snapshot.json"),
    );
    try {
      const paths = ledgerPaths(root);
      const snap = readSnapshot(paths);
      // The whole point of compatibility: a task approved the old way, with no
      // brief and no request event, is still a legitimately approved task.
      const legacy = Object.values(snap.tasks).filter(
        (t) => t.approved_at && !t.approval_requested_at,
      );
      assert.ok(
        legacy.length >= 2,
        "the two brief-less historical approvals must remain approved",
      );
      for (const t of legacy)
        assert.notEqual(
          t.workflow_status,
          "ACTIVE",
          `${t.task_id.slice(0, 8)} must not be left in an approvable state`,
        );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
