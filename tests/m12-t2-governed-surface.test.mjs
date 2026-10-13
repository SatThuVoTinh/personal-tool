// M12/T2-R1 governed surfaces. The owner's rule is that every governed thread carries
// exactly one tag per category of the forum it opens in, that an unresolvable required tag
// stops the post instead of producing a short-tagged thread reported as success, and that a
// retry can neither duplicate a thread nor lose the durable event behind it. These tests
// drive the real reducer, the real publish helper and the real classification functions —
// not a copy of them — with fake Discord reads and non-routable identifiers.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { governancePluginFiles } from "../integrations/openclaw/lib/policy.mjs";
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

const NODE_POWERBI = {
  ...NODE_EXCEL,
  node_id: "n3",
  agent_id: "power-bi",
  stack_id: "intelligence",
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
  // A plan whose nodes reach two stacks is tagged by the surface its output belongs to:
  // ETL work plus meaning work is still DATA. This is the live defect the owner hit — the
  // old "one distinct stack or nothing" rule refused the whole approval card.
  assert.deepEqual(
    approvalTagSelectionsFor(
      { nodes: [NODE_EXCEL, NODE_SQL], current_stack: null },
      "excel",
    ).selections.find((entry) => entry.category === "STACK").value,
    "DATA",
  );
  // Only a plan with no stack evidence at all is refused.
  assert.deepEqual(
    approvalTagSelectionsFor(
      { nodes: [{ ...NODE_SQL, stack_id: "excel" }], current_stack: null },
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

// ---------------------------------------------------------------------------
// M12/T2-R2 — the owner's verdict moves the thread's STATUS tag
// ---------------------------------------------------------------------------

test("M12/T2-R2: the verdict changes only the STATUS of the trio", () => {
  const excel = { nodes: [NODE_EXCEL], current_stack: "data_plant" };
  assert.deepEqual(
    approvalTagSelectionsFor(excel, "excel").selections.map(
      (entry) => `${entry.category}:${entry.value}`,
    ),
    ["STATUS:WAITING", "RISK:MEDIUM", "STACK:DATA"],
    "an opened card always asks",
  );
  assert.deepEqual(
    approvalTagSelectionsFor(excel, "excel", "APPROVE").selections.map(
      (entry) => `${entry.category}:${entry.value}`,
    ),
    ["STATUS:APPROVED", "RISK:MEDIUM", "STACK:DATA"],
    "the risk and the stack the plan carried survive the verdict",
  );
  for (const [decision, value] of [
    ["REJECT", "REJECTED"],
    ["REQUEST_REVISION", "CHANGES"],
  ]) {
    assert.equal(
      approvalTagSelectionsFor(excel, "excel", decision).selections.find(
        (entry) => entry.category === "STATUS",
      ).value,
      value,
    );
  }
  assert.deepEqual(
    approvalTagSelectionsFor(excel, "excel", "ACCEPT_RESULT").absent,
    ["STATUS"],
    "a decision with no forum status value yields no tag instead of a guess",
  );
});

test("M12/T2-R2: one transition seam, fired after the verdict, never awaited by it", () => {
  assert.equal(
    (pluginSource.match(/transitionGovernedForumStatus\(/g) || []).length,
    1,
    "the plugin must move tags through the shared lib, not its own REST call",
  );
  assert.equal(
    (pluginSource.match(/transitionApprovalTag\(\{/g) || []).length,
    2,
    "one definition and one call site",
  );
  assert.equal(
    pluginSource.includes("await transitionApprovalTag("),
    false,
    "no owner decision path may block on a Discord round-trip",
  );
  const effect = pluginSource.indexOf("function applyOwnerDecisionEffect({");
  const call = pluginSource.indexOf("transitionApprovalTag({", effect);
  const dispatch = pluginSource.indexOf("executeApprovedTask({", effect);
  assert.ok(
    effect > -1 && call > effect && call < dispatch,
    "the transition lives in the one post-decision effect and runs before execution dispatch",
  );
  const wiring = pluginSource.slice(call, dispatch);
  for (const literal of ['"APPROVE"', '"REJECT"', '"REQUEST_REVISION"'])
    assert.ok(
      wiring.includes(literal),
      `the ${literal} verdict must be mapped onto a tag value`,
    );
  assert.ok(
    wiring.includes("}).catch("),
    "a surface failure is recorded, never thrown into the verdict",
  );
  assert.ok(
    pluginSource.includes("NO_SURFACE_STATE"),
    "a task whose card was never surfaced reports instead of inventing a thread",
  );
  assert.ok(
    pluginSource.includes("DISCORD_TAG_TRANSITION_SKIPPED"),
    "every refusal to transition is named",
  );
  assert.ok(
    pluginSource.includes("approvalStatusTag(decision)"),
    "the creation path and the verdict path share one STATUS mapping",
  );
});

test("M12/T2-R3: a live multi-stack approval request resolves all three tags", () => {
  // The outage the owner reported: #office stopped producing approval cards. Every pending
  // task in the live ledger has no `current_stack` — the reducer binds it only when execution
  // starts (workflow.mjs:1726) — and its nodes reach data_plant (excel/sql/python) plus
  // intelligence (power-bi). The card must be posted, not refused for want of a tag.
  const live = {
    nodes: [NODE_EXCEL, { ...NODE_SQL, stack_id: "data_plant" }, NODE_POWERBI],
    current_stack: undefined,
  };
  const { selections, absent } = approvalTagSelectionsFor(live, "excel");
  assert.deepEqual(absent, [], "no required approvals tag may be unresolved");
  assert.deepEqual(
    selections.map((entry) => `${entry.category}:${entry.value}`),
    ["STATUS:WAITING", "RISK:MEDIUM", "STACK:ANALYTICS"],
    "the chart work the plan reaches is the surface its output belongs to",
  );
});

// ---------------------------------------------------------------------------
// M12/T2-R3 — the asset Deployment A installed must stay reachable for the next --apply
// ---------------------------------------------------------------------------

const FORUM_TAGS_ASSET_REL = "lib/discord-forum-tags.mjs";

/** The digest the live WSL runtime carries, measured by the operator apply post-check. */
const DEPLOYED_FORUM_TAGS_SHA256 =
  "e0a755bb9c6add431c9306fd8bc2895318a868c3c6b8e84326d94fb95526fff5";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("M12/T2-R3: the deployed forum-tag asset digest is admitted under its own path", () => {
  // Provenance first: the admitted digest is not an operator-measured number taken on faith,
  // it is what the repository's own committed source packages to.
  const deployedSource = execFileSync(
    "git",
    ["show", "b6d04e8:integrations/openclaw/lib/discord-forum-tags.mjs"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(
    sha256(deployedSource),
    DEPLOYED_FORUM_TAGS_SHA256,
    "the admitted digest must reproduce from the commit Deployment A installed",
  );
  const packaged = governancePluginFiles().assets[FORUM_TAGS_ASSET_REL];
  assert.equal(
    packaged,
    readFileSync("integrations/openclaw/lib/discord-forum-tags.mjs", "utf8"),
    "packaging must not rewrite this asset's bytes",
  );
  assert.notEqual(
    sha256(packaged),
    DEPLOYED_FORUM_TAGS_SHA256,
    "this revision changes the asset, which is why a predecessor entry is needed at all",
  );
  const configureSource = readFileSync(
    "integrations/openclaw/configure.mjs",
    "utf8",
  );
  const start = configureSource.indexOf(
    "const ALLOWED_GOVERNANCE_ASSET_SHA256",
  );
  assert.notEqual(start, -1, "the asset allowlist must exist");
  const table = configureSource.slice(
    start,
    configureSource.indexOf("\n});", start),
  );
  assert.notEqual(table, undefined, "the asset allowlist must be terminated");
  const key = table.indexOf(`"${FORUM_TAGS_ASSET_REL}": Object.freeze([`);
  assert.notEqual(
    key,
    -1,
    "the asset must have its own key in the allowlist table",
  );
  const block = table.slice(key, table.indexOf("]),", key));
  assert.ok(
    block.includes(DEPLOYED_FORUM_TAGS_SHA256),
    "the deployed digest must be listed under lib/discord-forum-tags.mjs",
  );
  assert.equal(
    configureSource.split(DEPLOYED_FORUM_TAGS_SHA256).length - 1,
    1,
    "the deployed digest must appear exactly once in the file",
  );
  // The current build is accepted by content comparison, never by admission.
  assert.equal(
    configureSource.includes(sha256(packaged)),
    false,
    "the current build digest must not be allowlisted",
  );
});
