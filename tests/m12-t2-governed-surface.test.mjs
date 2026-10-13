// M12/T2-R1 governed surfaces. The owner's rule is that every governed thread carries
// exactly one tag per category of the forum it opens in, that an unresolvable required tag
// stops the post instead of producing a short-tagged thread reported as success, and that a
// retry can neither duplicate a thread nor lose the durable event behind it. These tests
// drive the real reducer, the real publish helper and the real classification functions —
// not a copy of them — with fake Discord reads and non-routable identifiers.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  approvalTagSelectionsFor,
  incidentIdentityFor,
  incidentTagSelectionsFor,
  resultSoftwareLabelFor,
  resultTagSelectionsFor,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import {
  openGovernedForumThread,
  createForumTagResolver,
} from "../integrations/openclaw/lib/discord-forum-tags.mjs";
import {
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";
import { canonicalHash } from "../integrations/openclaw/topology/lib/canonical.mjs";

const OFFICE = "1545425766161063937";
const APPROVALS_CHANNEL = "1000000000000000001";

const TAGS = [
  "STATUS: WAITING",
  "RISK: LOW",
  "RISK: MEDIUM",
  "RISK: RED",
  "STACK: INFRA",
  "STACK: DATA",
  "STACK: SEMANTIC",
  "STACK: ANALYTICS",
  "STACK: DECISION",
].map((name, index) => ({ id: `tag-${index}`, name }));

function tagsFetch({ postStatus = 200, threadId = "900000000000000001" } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/threads") && init?.method === "POST")
      return {
        ok: postStatus === 200,
        status: postStatus,
        json: async () => ({ id: threadId }),
        text: async () => "rejected",
      };
    if (/\/channels\/[^/]+$/.test(url))
      return {
        ok: true,
        json: async () => ({
          available_tags: TAGS.map((tag) => ({ ...tag })),
        }),
      };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

const resolver = () =>
  createForumTagResolver({
    logger: { warn() {}, info() {}, error() {} },
  });

function origin(n, runId) {
  return {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: `154543${String(700000000000 + n).padStart(12, "0")}`,
    root_agent_id: "main",
    root_session_key: `agent:main:discord:channel:${OFFICE}`,
    root_run_id: runId,
  };
}

const NODE_EXCEL = {
  node_id: "n1",
  agent_id: "excel",
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

const NODE_SQL = {
  ...NODE_EXCEL,
  node_id: "n2",
  agent_id: "sql",
  stack_id: "semantic",
};

function withLedger(body) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-m12t2-"));
  const paths = ledgerPaths(root);
  readSnapshot(paths);
  writeFileSync(paths.identityKey, `${"1".repeat(64)}\n`);
  try {
    return body(paths);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// DURABLE PUBLICATION STATE
// ---------------------------------------------------------------------------

test("M12/T2 P2: a surfaced approval projects its thread and blocks a second one", () => {
  withLedger((paths) => {
    const seed = origin(1, "run-m12t2-a1");
    const taskId = deriveTaskId(seed);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", { ...seed, task_id: taskId });
    recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
      task_id: taskId,
      agent_id: "main",
      session_key: seed.root_session_key,
      run_id: seed.root_run_id,
    });

    // The request alone is not a surface: that is exactly the state a retry must re-drive.
    assert.equal(
      readSnapshot(paths).tasks[taskId].approval_thread_id,
      undefined,
      "a recorded request must not look like a delivered card",
    );

    recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
      task_id: taskId,
      channel: "approvals",
      thread_id: "111111111111111111",
    });
    assert.equal(
      readSnapshot(paths).tasks[taskId].approval_thread_id,
      "111111111111111111",
    );

    // The same thread reported again is a retry, not a second surface: the ledger
    // refuses to append an event that changes nothing, so a duplicate can neither
    // grow the log nor overwrite the recorded thread.
    recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
      task_id: taskId,
      channel: "approvals",
      thread_id: "111111111111111111",
    });
    assert.equal(readSnapshot(paths).sequence, 3, "the retry appended nothing");
    assert.equal(
      readSnapshot(paths).tasks[taskId].approval_thread_id,
      "111111111111111111",
      "a retry must not move the recorded surface",
    );

    // A different thread for the same request is the duplicate the owner forbade.
    assert.throws(
      () =>
        recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
          task_id: taskId,
          channel: "approvals",
          thread_id: "222222222222222222",
        }),
      /INVALID_STATE_TRANSITION/,
    );
  });
});

test("M12/T2 P2: a surface with no recorded request is refused", () => {
  withLedger((paths) => {
    const seed = origin(2, "run-m12t2-a2");
    const taskId = deriveTaskId(seed);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", { ...seed, task_id: taskId });
    assert.throws(
      () =>
        recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
          task_id: taskId,
          channel: "approvals",
          thread_id: "333333333333333333",
        }),
      /INVALID_STATE_TRANSITION/,
      "a thread cannot be claimed for a request the ledger never recorded",
    );
  });
});

test("M12/T2 P3: a surfaced result projects its own thread id", () => {
  withLedger((paths) => {
    const seed = origin(3, "run-m12t2-r1");
    const taskId = deriveTaskId(seed);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", { ...seed, task_id: taskId });
    recordWorkflowEvent(paths, "WORKFLOW_RESULT_SURFACED", {
      task_id: taskId,
      channel: "results",
      thread_id: "444444444444444444",
      result_digest: "b".repeat(64),
    });
    assert.equal(
      readSnapshot(paths).tasks[taskId].results_thread_id,
      "444444444444444444",
    );
    recordWorkflowEvent(paths, "WORKFLOW_RESULT_SURFACED", {
      task_id: taskId,
      channel: "results",
      thread_id: "444444444444444444",
    });
    assert.throws(
      () =>
        recordWorkflowEvent(paths, "WORKFLOW_RESULT_SURFACED", {
          task_id: taskId,
          channel: "results",
          thread_id: "555555555555555555",
        }),
      /INVALID_STATE_TRANSITION/,
    );
    assert.throws(
      () =>
        recordWorkflowEvent(paths, "WORKFLOW_RESULT_SURFACED", {
          task_id: taskId,
          channel: "approvals",
          thread_id: "666666666666666666",
        }),
      /CHANNEL_MISMATCH/,
      "a results surface may not claim another surface's channel",
    );
  });
});

// ---------------------------------------------------------------------------
// THE SINGLE PUBLISH PATH
// ---------------------------------------------------------------------------

test("M12/T2 P2: a governed thread opens with exactly one tag per category", async () => {
  const { fetchImpl, calls } = tagsFetch();
  const surfaced = await openGovernedForumThread({
    surface: "approvals",
    channelId: APPROVALS_CHANNEL,
    token: "t",
    title: "🔖 [PHÊ DUYỆT] Kế hoạch Thực thi",
    bodyContent: "**Task ID:** `13102026CDEF`",
    selections: [
      { category: "STATUS", value: "WAITING" },
      { category: "RISK", value: "MEDIUM" },
      { category: "STACK", value: "DATA" },
    ],
    resolver: resolver(),
    fetchImpl,
    deadlineMs: 5000,
  });
  assert.deepEqual(surfaced, {
    posted: true,
    threadId: "900000000000000001",
    tagIds: ["tag-0", "tag-2", "tag-5"],
  });
  const post = calls.find((call) => call.url.endsWith("/threads"));
  const body = JSON.parse(post.init.body);
  assert.equal(body.applied_tags.length, 3, "exactly one tag per category");
  assert.ok(post.init.signal, "the post is deadline bounded");
  assert.equal(post.init.headers.Authorization, "Bot t");
});

test("M12/T2 P4: an unresolvable required tag posts nothing", async () => {
  const { fetchImpl, calls } = tagsFetch();
  const surfaced = await openGovernedForumThread({
    surface: "approvals",
    channelId: APPROVALS_CHANNEL,
    token: "t",
    title: "t",
    bodyContent: "b",
    // SEVERITY does not exist on the approvals forum: the whole post must be refused
    // rather than delivered with two of three tags (owner requirement 4).
    selections: [
      { category: "STATUS", value: "WAITING" },
      { category: "SEVERITY", value: "HIGH" },
      { category: "STACK", value: "DATA" },
    ],
    resolver: resolver(),
    fetchImpl,
    deadlineMs: 5000,
  });
  assert.equal(surfaced.posted, false);
  assert.equal(surfaced.code, "DISCORD_TAG_UNRESOLVED");
  assert.equal(
    calls.some((call) => call.url.endsWith("/threads")),
    false,
    "no thread creation request may be sent",
  );
});

test("M12/T2 P4: a Discord refusal is reported, not treated as delivered", async () => {
  const { fetchImpl } = tagsFetch({ postStatus: 400 });
  const surfaced = await openGovernedForumThread({
    surface: "approvals",
    channelId: APPROVALS_CHANNEL,
    token: "t",
    title: "t",
    bodyContent: "b",
    selections: [
      { category: "STATUS", value: "WAITING" },
      { category: "RISK", value: "LOW" },
      { category: "STACK", value: "INFRA" },
    ],
    resolver: resolver(),
    fetchImpl,
    deadlineMs: 5000,
  });
  assert.equal(surfaced.posted, false);
  assert.equal(surfaced.code, "DISCORD_THREAD_POST_FAILED_400");
  assert.equal(surfaced.threadId, undefined);
});

// ---------------------------------------------------------------------------
// CLASSIFICATION OF THE REAL RECORD
// ---------------------------------------------------------------------------

test("M12/T2 P2: the RISK tag is the highest risk class the admitted plan reaches", () => {
  const excel = { nodes: [NODE_EXCEL], current_stack: "data_plant" };
  const { selections, absent } = approvalTagSelectionsFor(excel, "excel");
  assert.deepEqual(absent, []);
  assert.deepEqual(
    selections.map((entry) => `${entry.category}:${entry.value}`),
    ["STATUS:WAITING", "RISK:MEDIUM", "STACK:DATA"],
  );
  // n8n is admitted to the python agent, so a plan that runs Python triggers workflows.
  assert.deepEqual(
    approvalTagSelectionsFor(
      {
        nodes: [{ ...NODE_EXCEL, agent_id: "python" }],
        current_stack: "data_plant",
      },
      "python",
    ).selections.find((entry) => entry.category === "RISK").value,
    "RED",
  );
  // A read-only plan is LOW, and a coordinator with no capability of its own still
  // inherits the tools the plan it admits can run.
  assert.equal(
    approvalTagSelectionsFor(
      { nodes: [NODE_SQL], current_stack: "semantic" },
      "sql",
    ).selections.find((entry) => entry.category === "RISK").value,
    "LOW",
  );
  // O1 admits no capability of its own, but the plan it runs can trigger n8n
  // workflows, so the honest tag is the highest class it can reach, not LOW.
  assert.equal(
    approvalTagSelectionsFor({ nodes: [] }, "o1").selections.find(
      (entry) => entry.category === "RISK",
    ).value,
    "RED",
  );
  // No agents at all is not evidence of a low-risk task.
  assert.deepEqual(
    approvalTagSelectionsFor({ nodes: [] }, null).absent.sort(),
    ["RISK", "STACK"],
  );
});

test("M12/T2 P2: STACK comes from the recorded stack, never from a bot nickname", () => {
  assert.equal(
    approvalTagSelectionsFor(
      { nodes: [NODE_SQL], current_stack: "semantic" },
      "sql",
    ).selections.find((entry) => entry.category === "STACK").value,
    "SEMANTIC",
  );
  // Two stacks in one plan have no single honest tag.
  assert.deepEqual(
    approvalTagSelectionsFor(
      { nodes: [NODE_EXCEL, NODE_SQL], current_stack: null },
      "excel",
    ).absent,
    ["STACK"],
  );
});

test("M12/T2 P3: result tags follow the accepted outcome and its evidence", () => {
  const task = {
    nodes: [NODE_EXCEL],
    current_stack: "data_plant",
    root_result: { outcome_status: "COMPLETE" },
  };
  assert.deepEqual(
    resultTagSelectionsFor(task, ["workspace/sheet.xlsx"]).selections.map(
      (entry) => `${entry.category}:${entry.value}`,
    ),
    ["STATUS:SUCCESS", "TYPE:DATA", "STACK:DATA"],
  );
  assert.equal(
    resultTagSelectionsFor(
      { ...task, root_result: { outcome_status: "PARTIAL" } },
      ["report.md"],
    ).selections.find((entry) => entry.category === "TYPE").value,
    "REPORT",
  );
  // BLOCKED is not an outcome the owner accepted, so there is no honest tag for it and
  // the surface must be refused rather than mapped to FAILED.
  assert.deepEqual(
    resultTagSelectionsFor(
      { ...task, root_result: { outcome_status: "BLOCKED" } },
      ["x.bin"],
    ).absent,
    ["STATUS"],
  );
  assert.equal(resultSoftwareLabelFor(task), "Microsoft Excel");
});

test("M12/T2 P4: an incident is identified deterministically and graded by the decision", () => {
  const first = incidentIdentityFor({
    reason: "NATIVE_COMPLETION_UNRECONCILED",
    runId: "run-1",
    childSessionKey: "sk-1",
    scope: "IDENTIFIED_RUN",
    taskIds: ["t-2", "t-1"],
  });
  const again = incidentIdentityFor({
    reason: "NATIVE_COMPLETION_UNRECONCILED",
    runId: "run-1",
    childSessionKey: "sk-1",
    scope: "IDENTIFIED_RUN",
    taskIds: ["t-1", "t-2"],
  });
  assert.equal(
    first.token,
    again.token,
    "task order must not mint a new incident",
  );
  assert.match(first.title, /^🚨 \[SỰ CỐ\] NATIVE_COMPLETION_UNRECONCILED · /u);
  assert.notEqual(
    first.token,
    incidentIdentityFor({ ...first, runId: "run-2" }).token,
  );
  const selections = incidentTagSelectionsFor(
    [{ nodes: [NODE_SQL], current_stack: "semantic" }],
    {
      reason: "NATIVE_COMPLETION_UNRECONCILED",
      scope: "ALL_LIVE_RUNS",
      ledgerError: null,
    },
  );
  assert.deepEqual(
    selections.selections.map((entry) => `${entry.category}:${entry.value}`),
    ["STATUS:OPEN", "SEVERITY:CRITICAL", "STACK:SEMANTIC"],
  );
  assert.deepEqual(
    incidentTagSelectionsFor([], {
      reason: "SPAWN_LINEAGE_MISMATCH",
      scope: "NONE",
    }).absent,
    ["STACK"],
  );
});

// ---------------------------------------------------------------------------
// THE SURFACE IS ONE SYSTEM
// ---------------------------------------------------------------------------

const pluginSource = readFileSync(
  path.resolve("integrations/openclaw/plugins/zink-governance/index.mjs"),
  "utf8",
);

test("M12/T2 P1: no Discord tag id is hardcoded anywhere in the repository", () => {
  assert.equal(
    /applied_tags:\s*\[\s*"\d{15,25}"/u.test(pluginSource),
    false,
    "tag ids belong to Discord; the repository holds names only",
  );
  assert.equal(
    pluginSource.includes("1545697161985921064"),
    false,
    "the former STATUS: WAITING literal must be gone",
  );
});

test("M12/T2 P2: every governed surface publishes through one path and records its thread", () => {
  for (const surface of ["approvals", "results", "incidents"]) {
    assert.ok(
      pluginSource.includes(`surface: "${surface}"`),
      `${surface} must publish through the shared path`,
    );
  }
  assert.equal(
    (pluginSource.match(/openGovernedForumThread\(/g) || []).length,
    1,
    "one call site only: postGovernedThread is the single publish path",
  );
  assert.equal(
    (pluginSource.match(/"WORKFLOW_APPROVAL_SURFACED"/g) || []).length,
    2,
    "both approval sites must record the thread they opened",
  );
  assert.ok(
    pluginSource.includes('"WORKFLOW_RESULT_SURFACED"'),
    "the results surface is recorded durably",
  );
  assert.ok(
    pluginSource.includes("INCIDENT_SURFACE_SKIPPED"),
    "an unreadable thread list refuses a duplicate incident post",
  );
});
