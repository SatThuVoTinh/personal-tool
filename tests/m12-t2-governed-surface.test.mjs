// M12/T2-R1 governed surfaces. The owner's rule is that every governed thread carries
// exactly one tag per category of the forum it opens in, that an unresolvable required tag
// stops the post instead of producing a short-tagged thread reported as success, and that a
// retry can neither duplicate a thread nor lose the durable event behind it. These tests
// drive the real reducer, the real publish helper and the real classification functions —
// not a copy of them — with fake Discord reads and non-routable identifiers.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  approvalTagSelectionsFor,
  handleDiscordAction,
  incidentIdentityFor,
  incidentTagSelectionsFor,
  readGovernanceManifests,
  readPickupLedgerTasks,
  resolveAnnouncePublishDecision,
  resolveGovernedAnnouncementAccount,
  resultSoftwareLabelFor,
  resultTagSelectionsFor,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import {
  openGovernedForumThread,
  createForumTagResolver,
} from "../integrations/openclaw/lib/discord-forum-tags.mjs";
import { governancePluginFiles } from "../integrations/openclaw/lib/policy.mjs";
import { ACTIONS } from "../integrations/openclaw/lib/authority.mjs";
import governancePlugin from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";
import { installNativeToolGate } from "../integrations/openclaw/topology/lib/native-boundary.mjs";
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

test("M12/T9 F-009: a containment over several tasks is tagged by the precedence rule", () => {
  // The rule the comment used to contradict: the STACK tag names the surface the
  // containment's OUTPUT belongs to, so the deepest stack the containment reaches wins.
  const twoTasks = incidentTagSelectionsFor(
    [
      { nodes: [NODE_EXCEL], current_stack: "data_plant" },
      { nodes: [NODE_POWERBI], current_stack: "intelligence" },
    ],
    { reason: "SPAWN_LINEAGE_MISMATCH", scope: "ALL_LIVE_RUNS" },
  );
  assert.deepEqual(
    twoTasks.selections.map((entry) => `${entry.category}:${entry.value}`),
    ["STATUS:OPEN", "SEVERITY:HIGH", "STACK:ANALYTICS"],
    "intelligence is downstream of data_plant, so the containment is ANALYTICS",
  );
  // The order of the affected tasks does not decide the tag.
  const reversed = incidentTagSelectionsFor(
    [
      { nodes: [NODE_POWERBI], current_stack: "intelligence" },
      { nodes: [NODE_EXCEL], current_stack: "data_plant" },
    ],
    { reason: "SPAWN_LINEAGE_MISMATCH", scope: "ALL_LIVE_RUNS" },
  );
  assert.equal(
    reversed.selections.find((entry) => entry.category === "STACK").value,
    "ANALYTICS",
    "task order must not move the stack tag",
  );
  // A SINGLE affected task still uses its own bound stack, even a shallower one.
  const oneTask = incidentTagSelectionsFor(
    [{ nodes: [NODE_EXCEL], current_stack: "data_plant" }],
    { reason: "SPAWN_LINEAGE_MISMATCH", scope: "ALL_LIVE_RUNS" },
  );
  assert.equal(
    oneTask.selections.find((entry) => entry.category === "STACK").value,
    "DATA",
    "the executing stack of a single affected task wins",
  );
  // No stack evidence at all is still unresolved, not a guess.
  assert.deepEqual(
    incidentTagSelectionsFor([], {
      reason: "SPAWN_LINEAGE_MISMATCH",
      scope: "NONE",
    }).absent,
    ["STACK"],
  );
});

// M12/T9 F-214: this gate used to read ONE file while claiming to cover the whole
// repository, so a tag id introduced in `lib/discord-forum-tags.mjs`, `configure.mjs`,
// `templates/`, `topology/fixtures/` or an env file kept it green. It now walks the
// tracked tree the way `scripts/repository-policy.mjs` `listTrackedFiles` does.
//
// The former STATUS: WAITING id is written in two halves on purpose: the gate file is
// itself a tracked source file, and a literal that names the id would make the gate
// fail on its own text.
const FORMER_STATUS_WAITING_TAG_ID = "154569716198592" + "1064";
const SNOWFLAKE_APPLIED_TAGS_PATTERN = /applied_tags:\s*\[\s*"\d{15,25}"/u;
const REPO_ROOT = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);

/** Every tracked source, template, fixture and env file in the repository. */
function trackedGovernedSourceFiles() {
  const output = execFileSync(
    "git",
    ["-c", `safe.directory=${REPO_ROOT}`, "ls-files", "-z"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return output
    .split("\0")
    .filter(Boolean)
    .filter((relative) => {
      const base = path.basename(relative);
      if (/\.(?:mjs|js|cjs|ts|json)$/iu.test(base)) return true;
      if (/(^|\/)(?:templates|fixtures)\//iu.test(relative)) return true;
      if (base === ".env" || base.startsWith(".env.")) return true;
      return false;
    });
}

test("M12/T2 P1: no Discord tag id is hardcoded anywhere in the repository", () => {
  const files = trackedGovernedSourceFiles();
  assert.ok(
    files.length > 50,
    `the tracked tree must actually be walked, got ${files.length} files`,
  );
  const offenders = [];
  for (const relative of files) {
    let content;
    try {
      content = readFileSync(path.join(REPO_ROOT, relative), "utf8");
    } catch {
      continue;
    }
    if (content.includes("\u0000")) continue;
    if (SNOWFLAKE_APPLIED_TAGS_PATTERN.test(content))
      offenders.push(`${relative}: snowflake-shaped applied_tags`);
    if (content.includes(FORMER_STATUS_WAITING_TAG_ID))
      offenders.push(`${relative}: the former STATUS: WAITING tag id`);
  }
  assert.deepEqual(
    offenders,
    [],
    `tag ids belong to Discord; the repository holds names only: ${offenders.join(", ")}`,
  );
  // The plugin source is still read directly, so a failure names the file even if the
  // tracked-tree walk is ever narrowed again.
  assert.equal(
    SNOWFLAKE_APPLIED_TAGS_PATTERN.test(pluginSource),
    false,
    "tag ids belong to Discord; the repository holds names only",
  );
  assert.equal(
    pluginSource.includes(FORMER_STATUS_WAITING_TAG_ID),
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
  // M12/T9 F-123: the SURFACED event is now READ as well as written — the
  // card's own 24-hour clock is counted from the moment it was posted — so
  // the count that matters is the number of WRITE sites: the two approval
  // paths that open a card. A read is not a write.
  assert.equal(
    (
      pluginSource.match(
        /recordWorkflowEvent\(paths, "WORKFLOW_APPROVAL_SURFACED"/g,
      ) || []
    ).length,
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
  // M12/T9 F-123: the EXPIRY projection is a second, separately named call
  // site of the same seam — an expired card must be able to say so on the
  // surface — but the VERDICT transition still has exactly ONE call site,
  // inside the one post-verdict effect. The count is therefore three: the
  // definition, the verdict call and the expiry call, and no more.
  assert.equal(
    (pluginSource.match(/transitionApprovalTag\(\{/g) || []).length,
    3,
    "one definition and two call sites: the verdict path and the expiry projection",
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
  assert.equal(
    (
      pluginSource
        .slice(effect, dispatch)
        .match(/transitionApprovalTag\(\{/g) || []
    ).length,
    1,
    "the verdict transition still has exactly one call site inside the post-verdict effect",
  );
  const expiryProjection = pluginSource.indexOf(
    "function projectExpiredApprovalTag(",
  );
  assert.ok(
    expiryProjection > -1,
    "the expiry projection must be one named seam, so the two owner paths cannot drift",
  );
  assert.equal(
    pluginSource.includes("await projectExpiredApprovalTag("),
    false,
    "no owner decision path may block on the expiry projection",
  );
  const wiring = pluginSource.slice(call, dispatch);
  // M12/T9 F-085: the verdict vocabulary moved out of string literals and into
  // the shared ACTIONS table, and the decision the transition receives comes
  // from the ONE reviewed mapping (`resolveLedgerDecision`). The claim is
  // unchanged - every owner verdict is mapped onto a tag value, and the
  // mapping is the reviewed one - and it is now stated in the vocabulary the
  // plugin actually uses.
  assert.ok(
    wiring.includes("resolveLedgerDecision(normAction)"),
    "the transition must receive the reviewed ledger decision, not a private copy of the mapping",
  );
  const effectWiring = pluginSource.slice(effect, dispatch);
  for (const literal of [
    "ACTIONS.APPROVE",
    "ACTIONS.REJECT_APPROVAL",
    "ACTIONS.REQUEST_REVISION_APPROVAL",
  ]) {
    assert.ok(
      effectWiring.includes(literal),
      `the ${literal} verdict must be mapped onto a tag value`,
    );
  }
  // The three names are the OWNER verdicts, and they are the shared ones.
  assert.equal(ACTIONS.APPROVE, "APPROVE");
  assert.equal(ACTIONS.REJECT_APPROVAL, "REJECT_APPROVAL");
  assert.equal(ACTIONS.REQUEST_REVISION_APPROVAL, "REQUEST_REVISION_APPROVAL");
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
const FORUM_TAGS_ASSET_PATH = `integrations/openclaw/${FORUM_TAGS_ASSET_REL}`;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// M12/T9 F-217: the digest pin is RE-BASED.
//
// The pin used to freeze ONE historical digest, the commit that produced it and
// an EXACT occurrence count, so admitting the next legitimate build of this
// asset forced an edit to this file - the freeze cost the finding names. The
// admitted set is now READ from the allowlist table in
// `integrations/openclaw/configure.mjs` - the table the deployment itself
// consults - and every admitted digest is checked against the asset's OWN
// committed history. A second predecessor is therefore admitted, and PROVEN,
// without an edit here.
//
// The safety property is unchanged, and it is the point of the lane: the digest
// THIS build produces must never appear in the allowlist, because the current
// build is accepted by content comparison.

/** The allowlist table of `configure.mjs`, as source text. */
function governanceAssetAllowlist(configureSource) {
  const start = configureSource.indexOf(
    "const ALLOWED_GOVERNANCE_ASSET_SHA256",
  );
  assert.notEqual(start, -1, "the asset allowlist must exist");
  const tableEnd = configureSource.indexOf("\n});", start);
  assert.notEqual(
    tableEnd,
    -1,
    "the asset allowlist must be terminated, or the slice below silently " +
      "reads past the table and drops the file's last character",
  );
  return configureSource.slice(start, tableEnd);
}

/**
 * The digests admitted for one asset path, in table order.
 *
 * The table's comments are stripped first: a comment may name a digest - the
 * live-build note does - and a digest named in prose is not an admission.
 */
function admittedAssetDigests(configureSource, rel) {
  const table = governanceAssetAllowlist(configureSource).replace(
    /\/\/[^\n]*/gu,
    "",
  );
  const key = table.indexOf(`"${rel}": Object.freeze([`);
  if (key === -1) return [];
  const open = table.indexOf("[", key);
  const close = table.indexOf("]", open);
  assert.ok(
    open > -1 && close > open,
    `the entry for ${rel} must be a closed list of digests`,
  );
  return [
    ...table.slice(open + 1, close).matchAll(/["']([0-9a-f]{64})["']/gu),
  ].map((match) => match[1]);
}

/** The committed history of each governed asset, derived once per lane. */
const ASSET_HISTORY = new Map();

/**
 * Every digest the asset's own committed history produced, with the commit
 * that produced it. The provenance of an admitted digest is therefore DERIVED:
 * a digest no commit reproduces is not a predecessor of this asset, it is a
 * transcription nobody can check.
 */
function committedAssetDigests(rel) {
  if (ASSET_HISTORY.has(rel)) return ASSET_HISTORY.get(rel);
  const assetPath = `integrations/openclaw/${rel}`;
  const commits = execFileSync(
    "git",
    [
      "-c",
      `safe.directory=${REPO_ROOT}`,
      "log",
      "--format=%H",
      "--",
      assetPath,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    },
  )
    .split("\n")
    .filter(Boolean);
  const digests = new Map();
  for (const commit of commits) {
    const content = execFileSync(
      "git",
      ["-c", `safe.directory=${REPO_ROOT}`, "show", `${commit}:${assetPath}`],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
    );
    digests.set(sha256(content), commit);
  }
  ASSET_HISTORY.set(rel, digests);
  return digests;
}

/**
 * The verdict the pin reaches for one governed asset: the admitted set, and
 * every problem with it.
 *
 * `history` maps each digest the asset's committed history produced to the
 * commit that produced it. Nothing here is pinned to one digest, one commit or
 * one occurrence count, so the same verdict can be reached for any table.
 */
function assessAssetAdmission({
  configureSource,
  rel,
  currentDigest,
  history,
}) {
  const problems = [];
  const admitted = admittedAssetDigests(configureSource, rel);
  if (admitted.length === 0) {
    problems.push(
      `${rel} admits no predecessor digest, so the deployed extension is unreachable`,
    );
  }
  for (const digest of admitted) {
    if (admitted.filter((entry) => entry === digest).length > 1) {
      problems.push(
        `${rel} lists the digest ${digest.slice(0, 12)}... more than once`,
      );
    }
    if (!history.has(digest)) {
      problems.push(
        `${rel} admits ${digest.slice(0, 12)}..., which no commit in the asset's history produced`,
      );
    }
    if (digest === currentDigest) {
      problems.push(
        `${rel} admits the digest the current build produces, which is accepted by content comparison`,
      );
    }
    // The occurrence count is relaxed from EXACTLY once to AT LEAST once: a
    // digest may now be named in prose beside the table. The duplicate
    // protection moves to the list itself, which is where a duplicated
    // admission would actually be.
    //
    // M12/T9 F-217 (review): the "the file does not carry the digest" check
    // that stood here could never fire — the digest was parsed out of this
    // very source, so the file always carried it. A control that cannot fail is
    // not a control; the duplicate check above is the one that holds.
  }
  if (configureSource.includes(currentDigest)) {
    problems.push(
      `the digest the current build produces must not be allowlisted (${rel})`,
    );
  }
  return { admitted, problems };
}

function leaseHarness(tag) {
  const root = mkdtempSync(path.join(os.tmpdir(), `m12t9-lease-${tag}-`));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  for (const agentId of [
    "main",
    "o1",
    "o2",
    "excel",
    "power-bi",
    "sql",
    "python",
  ]) {
    mkdirSync(path.join(root, "workspaces", agentId), { recursive: true });
    mkdirSync(path.join(root, "agents", agentId, "agent"), { recursive: true });
  }
  const hooks = new Map();
  const logs = [];
  governancePlugin.register({
    pluginConfig: {
      ledgerRoot: paths.root,
      ownerDiscordId: "123456789012345678",
      enabled: true,
    },
    on: (name, handler) => hooks.set(name, handler),
    registerTool: () => {},
    logger: {
      warn: (m) => logs.push(String(m)),
      info: (m) => logs.push(String(m)),
      error: (m) => logs.push(String(m)),
    },
  });
  return { root, paths, hooks, logs };
}

const LEASE_TOOL = "zink_skill_propose";
const LEASE_AGENT = "excel";
const LEASE_PARAMS = { namespace: "default" };

/** The native gate's event shape: one tool call in one assistant batch. */
function nativeToolEvent(name, args, id = "call-0") {
  const part = { type: "toolCall", name, id, arguments: args };
  return {
    assistantMessage: { role: "assistant", content: [part] },
    toolCall: part,
    args,
  };
}

const nativeConfig = (scope) => ({
  plugins: {
    entries: {
      "zink-governance": { enabled: true, config: { ledgerRoot: scope } },
    },
  },
});

/** Drive the native gate so the plugin mints the lease for this call. */
async function mintLease(h, context, params = LEASE_PARAMS, id = "call-0") {
  const agent = {};
  installNativeToolGate(agent, nativeConfig(h.paths.root), {
    agentId: context.agentId,
    sessionKey: context.sessionKey,
    runId: context.runId,
  });
  await agent.beforeToolCall(nativeToolEvent(LEASE_TOOL, params, id));
}

test("M12/T9 F-087: a mismatched call does not destroy the one-shot lease", async () => {
  const h = leaseHarness("f087");
  try {
    const context = {
      agentId: LEASE_AGENT,
      sessionKey: "agent:excel:session-1",
      runId: "run-1",
      toolCallId: "call-0",
    };
    await mintLease(h, context);

    // A call whose parameters do not match the authorized digest is refused...
    const wrong = h.hooks.get("before_tool_call")(
      {
        toolName: LEASE_TOOL,
        params: { ...LEASE_PARAMS, namespace: "other" },
      },
      context,
    );
    assert.equal(wrong?.block, true, "a mismatched call must be refused");

    // ...and it must NOT have burned the lease the real call needs.
    const right = h.hooks.get("before_tool_call")(
      { toolName: LEASE_TOOL, params: { ...LEASE_PARAMS } },
      context,
    );
    assert.equal(
      right,
      undefined,
      "the correct call that follows a mismatched one must still be authorized",
    );
  } finally {
    h.hooks.get("gateway_stop")?.();
    rmSync(h.root, { recursive: true, force: true });
  }
});

test("M12/T9 F-087: the three refusal causes are distinguishable and carry no identity", async () => {
  const h = leaseHarness("f087-log");
  try {
    const context = {
      agentId: LEASE_AGENT,
      sessionKey: "agent:excel:session-2",
      runId: "run-2",
      toolCallId: "call-0",
    };
    // 1. No lease at all.
    assert.equal(
      h.hooks.get("before_tool_call")(
        { toolName: LEASE_TOOL, params: { ...LEASE_PARAMS } },
        context,
      )?.block,
      true,
    );
    // 2. A lease whose digest does not match.
    await mintLease(h, context);
    assert.equal(
      h.hooks.get("before_tool_call")(
        {
          toolName: LEASE_TOOL,
          params: { ...LEASE_PARAMS, namespace: "other" },
        },
        context,
      )?.block,
      true,
    );
    // 3. Missing lineage.
    assert.equal(
      h.hooks.get("before_tool_call")(
        { toolName: LEASE_TOOL, params: { ...LEASE_PARAMS } },
        { agentId: LEASE_AGENT },
      )?.block,
      true,
    );

    const blocked = h.logs.filter((line) =>
      line.includes("[zink-lease:blocked]"),
    );
    assert.equal(blocked.length, 3, `three refusals, got ${blocked.length}`);
    assert.match(blocked[0], /LEASE_MISSING/u);
    assert.match(blocked[1], /LEASE_DIGEST_MISMATCH/u);
    assert.match(blocked[2], /LINEAGE_MISMATCH/u);
    for (const line of blocked) {
      assert.equal(
        line.includes(context.sessionKey),
        false,
        `an identity value reached the log: ${line}`,
      );
      assert.equal(
        line.includes(context.runId),
        false,
        `an identity value reached the log: ${line}`,
      );
    }
  } finally {
    h.hooks.get("gateway_stop")?.();
    rmSync(h.root, { recursive: true, force: true });
  }
});

test("M12/T9 F-042: a lease minted under one ledger root never satisfies another", async () => {
  const a = leaseHarness("f042-a");
  const b = leaseHarness("f042-b");
  try {
    const context = {
      agentId: LEASE_AGENT,
      sessionKey: "agent:excel:shared",
      runId: "run-shared",
      toolCallId: "call-0",
    };
    await mintLease(a, context);
    // The SAME triple, checked by the registration that governs a different root.
    const crossed = b.hooks.get("before_tool_call")(
      { toolName: LEASE_TOOL, params: { ...LEASE_PARAMS } },
      context,
    );
    assert.equal(
      crossed?.block,
      true,
      "a lease minted under another ledger root must not authorize this call",
    );
    // The owner of the lease is still authorized.
    assert.equal(
      a.hooks.get("before_tool_call")(
        { toolName: LEASE_TOOL, params: { ...LEASE_PARAMS } },
        context,
      ),
      undefined,
    );

    // Stopping one registration must not revoke the other's pending authorizations.
    const bContext = { ...context, sessionKey: "agent:excel:b-only" };
    await mintLease(b, bContext);
    a.hooks.get("gateway_stop")?.();
    assert.equal(
      b.hooks.get("before_tool_call")(
        { toolName: LEASE_TOOL, params: { ...LEASE_PARAMS } },
        bContext,
      ),
      undefined,
      "stopping another registration must not revoke this one's authorization",
    );
  } finally {
    a.hooks.get("gateway_stop")?.();
    b.hooks.get("gateway_stop")?.();
    rmSync(a.root, { recursive: true, force: true });
    rmSync(b.root, { recursive: true, force: true });
  }
});
// ---------------------------------------------------------------------------
// M12/T9 F-080 / F-158 - the verdict is bound to an authoritative task, and a
// policy artifact read fails with a canonical code
// ---------------------------------------------------------------------------

test("M12/T9 F-080: an approval verdict for a task the ledger does not hold is denied", () => {
  const h = leaseHarness("f080");
  try {
    // The ledger is readable and holds no such task, so the caller named a task
    // that does not exist. There is nothing to approve, and the verdict says so
    // instead of evaluating the caller-supplied currentState.
    const unknownTask = handleDiscordAction({
      actor: "user",
      channel: "approvals",
      taskId: "a-task-the-ledger-never-opened",
      action: "APPROVE",
      currentState: "APPROVAL_PENDING",
      paths: h.paths,
    });
    assert.equal(unknownTask.allowed, false);
    assert.equal(unknownTask.status, "DENIED");
    assert.match(unknownTask.reason, /NO_AUTHORITATIVE_TASK/u);
  } finally {
    h.hooks.get("gateway_stop")?.();
    rmSync(h.root, { recursive: true, force: true });
  }
});

test("M12/T9 F-158: a missing or unparseable governance manifest is a canonical denial", () => {
  assert.throws(
    () =>
      readGovernanceManifests(
        "C:/definitely-not-here/governance-manifests.json",
      ),
    /GOVERNANCE_DEPENDENCY_MISSING/u,
    "a missing manifest must not surface a raw filesystem error",
  );
  const corrupt = path.join(
    os.tmpdir(),
    `m12t9-governance-manifest-${process.pid}.json`,
  );
  writeFileSync(corrupt, "{ this is not json");
  try {
    assert.throws(
      () => readGovernanceManifests(corrupt),
      /GOVERNANCE_DEPENDENCY_MISSING/u,
      "an unparseable manifest must not surface a raw syntax error",
    );
  } finally {
    rmSync(corrupt, { force: true });
  }
});

test("M12/T2-R3: the deployed forum-tag asset digest is admitted under its own path", () => {
  // Provenance first: the admitted digest is not an operator-measured number taken on faith,
  // it is what the repository's own committed source packages to. The admitted SET is read
  // from the allowlist table the deployment itself consults, and every digest in it is
  // checked against the asset's OWN committed history - so the next legitimate build of
  // this asset is admitted, and proven, without an edit to this file.
  const configureSource = readFileSync(
    "integrations/openclaw/configure.mjs",
    "utf8",
  );
  const packaged = governancePluginFiles().assets[FORUM_TAGS_ASSET_REL];
  assert.equal(
    packaged,
    readFileSync(FORUM_TAGS_ASSET_PATH, "utf8"),
    "packaging must not rewrite this asset's bytes",
  );
  const currentDigest = sha256(packaged);
  const { admitted, problems } = assessAssetAdmission({
    configureSource,
    rel: FORUM_TAGS_ASSET_REL,
    currentDigest,
    history: committedAssetDigests(FORUM_TAGS_ASSET_REL),
  });
  assert.deepEqual(problems, [], problems.join("\n"));
  assert.ok(
    admitted.length >= 1,
    "the deployed asset must keep at least one admitted predecessor digest",
  );
  // The current build is accepted by content comparison, never by admission.
  assert.equal(
    configureSource.includes(currentDigest),
    false,
    "the current build digest must not be allowlisted",
  );
});

test("M12/T9 F-217: the pin names no digest and no revision of its own", () => {
  // The pin this replaces named ONE digest, ONE commit and an EXACT occurrence
  // count, so admitting the next legitimate build of this asset forced an edit
  // to this file - the freeze cost the finding names. A pin that carries
  // neither a digest nor a revision of its own can be re-based by the
  // allowlist table alone, which is what the deployment itself consults.
  const pinSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const pinnedDigests = [
    ...pinSource.matchAll(/["'`]([0-9a-f]{64})["'`]/giu),
  ].map((match) => match[1]);
  assert.deepEqual(
    pinnedDigests,
    [],
    "the pin must not name a digest of its own; it must read the admitted set from the allowlist table",
  );
  const pinnedRevisions = [
    ...pinSource.matchAll(/["'`]([0-9a-f]{7,40}):integrations\//giu),
  ].map((match) => match[1]);
  assert.deepEqual(
    pinnedRevisions,
    [],
    "the pin must not name a revision of its own; it must derive the commit from the asset's own history",
  );
});

test("M12/T9 F-217: a newly admitted forum-tag digest is admissible without an edit to this pin", () => {
  // The next legitimate change to this asset admits one more predecessor: the
  // digest of the build the live runtime carries. The pin must reach the same
  // verdict on that table, from the table alone - no digest, no commit and no
  // occurrence count of its own.
  const configureSource = readFileSync(
    "integrations/openclaw/configure.mjs",
    "utf8",
  );
  const packaged = governancePluginFiles().assets[FORUM_TAGS_ASSET_REL];
  const currentDigest = sha256(packaged);
  const history = committedAssetDigests(FORUM_TAGS_ASSET_REL);
  const admitted = admittedAssetDigests(configureSource, FORUM_TAGS_ASSET_REL);
  // A real predecessor of this asset, taken from its own committed history -
  // the same shape as the sibling asset `lib/discord-formatter.mjs`, which
  // carries two admitted digests.
  const next = [...history.keys()].find(
    (digest) => digest !== currentDigest && !admitted.includes(digest),
  );
  assert.ok(
    next,
    "the asset's committed history must hold a predecessor that is neither the current build nor the admitted one",
  );
  const simulated = configureSource.replace(
    `"${FORUM_TAGS_ASSET_REL}": Object.freeze([`,
    `"${FORUM_TAGS_ASSET_REL}": Object.freeze([\n    "${next}",`,
  );
  assert.notEqual(
    simulated,
    configureSource,
    "the simulation must change the allowlist table",
  );
  const verdict = assessAssetAdmission({
    configureSource: simulated,
    rel: FORUM_TAGS_ASSET_REL,
    currentDigest,
    history,
  });
  assert.deepEqual(verdict.problems, [], verdict.problems.join("\n"));
  assert.equal(
    verdict.admitted.length,
    admitted.length + 1,
    "the newly admitted predecessor must be admitted",
  );
});

// =========================================================================
// M12/T9 F-244 — the free-text approval ingress fabricated the channel and
// the actor it then validated, so "approval must occur in #approvals" could
// never fail: an owner typing `APPROVE <task>` in a DM or in any other
// channel was admitted and journalled as `channel: "approvals"`.
// =========================================================================
describe("M12/T9 F-244 — a verdict is recorded only where it was observed", () => {
  const OWNER = "123456789012345678";
  const APPROVALS_CHANNEL = "1545471797452087390";
  const FOREIGN_CHANNEL = "1545430000000000123";
  const APPROVAL_THREAD = "1545471797452087391";

  function seed(root) {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const origin = {
      origin: "discord",
      origin_principal_ref: "b".repeat(64),
      origin_message_id: "1556249093729427459",
    };
    const taskId = deriveTaskId(origin);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
      ...origin,
      task_id: taskId,
      root_agent_id: "main",
      root_session_key: "main-session",
      root_run_id: "main-run",
    });
    // The task must be ON the approval surface for a verdict to be accepted.
    recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
      task_id: taskId,
      agent_id: "main",
      session_key: "main-session",
      run_id: "main-run",
    });
    // M12/T9 F-529: the durable record of the surfaced card is LOAD-BEARING for
    // an APPROVE against a recorded request, and the decision must name the
    // thread the card was surfaced in. The fixture records it the way
    // tests/agent-owner-F-123.test.mjs does.
    recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
      task_id: taskId,
      channel: "approvals",
      thread_id: APPROVAL_THREAD,
    });
    return { paths, taskId };
  }

  function registerPlugin(paths, logs) {
    const hooks = new Map();
    governancePlugin.register({
      pluginConfig: {
        ledgerRoot: paths.root,
        ownerDiscordId: OWNER,
        approvalsChannelId: APPROVALS_CHANNEL,
        resultsChannelId: APPROVALS_CHANNEL,
        enabled: true,
      },
      on: (name, handler) => hooks.set(name, handler),
      registerTool: () => {},
      logger: {
        warn: (m) => logs.push(String(m)),
        info: (m) => logs.push(String(m)),
        error: (m) => logs.push(String(m)),
      },
    });
    return hooks;
  }

  it("F-244: an approval observed outside #approvals is denied and writes no event", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "m12t9-f244-"));
    const logs = [];
    try {
      const { paths, taskId } = seed(root);
      const hooks = registerPlugin(paths, logs);
      const handler = hooks.get("message_received");
      assert.ok(handler, "the plugin must register the inbound text handler");

      const before = readFileSync(paths.events, "utf8");
      await handler(
        {
          content: `APPROVE ${taskId}`,
          messageId: "1556249093729427460",
          senderId: OWNER,
          channelId: FOREIGN_CHANNEL,
        },
        { channelId: FOREIGN_CHANNEL },
      );
      assert.equal(
        readFileSync(paths.events, "utf8"),
        before,
        "a verdict observed outside the approval surface must write no event",
      );
      assert.ok(
        logs.some((line) => line.includes("APPROVAL_SURFACE_MISMATCH")),
        `the refusal must be recorded, got ${JSON.stringify(logs)}`,
      );

      // The SAME verdict, observed IN the approval surface, is recorded.
      await handler(
        {
          content: `APPROVE ${taskId}`,
          messageId: "1556249093729427461",
          senderId: OWNER,
          channelId: APPROVALS_CHANNEL,
          threadId: APPROVAL_THREAD,
        },
        { channelId: APPROVALS_CHANNEL, threadId: APPROVAL_THREAD },
      );
      assert.notEqual(
        readFileSync(paths.events, "utf8"),
        before,
        "the approval observed in #approvals must be recorded",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// M12/T9 F-104 / F-107 / F-109 - the approval card is published by the ledger's
// account, is recorded only for a card the owner can act on, and a publish
// that fails is a named refusal instead of a silent delivery
// ---------------------------------------------------------------------------

/** The body of one function, by brace matching. */
function functionBody(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start > -1, `${marker} must exist`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${marker}: unbalanced body`);
}

test("M12/T9 F-104: the account that opens an approvals thread is the ledger's", () => {
  const owner = {
    delegation: { agent_id: "o1" },
    task: { root_agent_id: "main" },
  };
  assert.deepEqual(
    resolveGovernedAnnouncementAccount({ owner, eventAgentId: "o1" }),
    { status: "COORDINATOR", agentId: "o1" },
    "the ledger's account may be selected when the event agrees with it",
  );
  assert.deepEqual(
    resolveGovernedAnnouncementAccount({ owner, eventAgentId: "o2" }),
    { status: "BLOCKED", error: "UNAUTHORIZED_TARGET" },
    "an event that claims another account is refused, never re-routed",
  );
  assert.deepEqual(
    resolveGovernedAnnouncementAccount({ owner: null, eventAgentId: "o1" }),
    { status: "BLOCKED", error: "EXACT_TASK_CORRELATION_REQUIRED" },
    "an announce the ledger does not own is refused",
  );
  assert.deepEqual(
    resolveGovernedAnnouncementAccount({
      owner: { delegation: { agent_id: "excel" }, task: {} },
      eventAgentId: "excel",
    }),
    { status: "NOT_APPLICABLE", agentId: "excel" },
    "a specialist announce carries no approval card",
  );
  // A bound coordinator run names its coordinator, not the root agent.
  assert.deepEqual(
    resolveGovernedAnnouncementAccount({
      owner: {
        coordinatorRun: { coordinator: "o2" },
        task: { root_agent_id: "main" },
      },
      eventAgentId: "o2",
    }),
    { status: "COORDINATOR", agentId: "o2" },
  );
});

test("M12/T9 F-107: the durable surface record follows the interactive delivery", () => {
  const body = functionBody(
    pluginSource,
    "async function maybePublishDiscordCard",
  );
  const surface = body.indexOf('"WORKFLOW_APPROVAL_SURFACED"');
  const delivery = body.indexOf("await sendNativePayload(");
  assert.ok(surface > -1, "the surface record must exist");
  assert.ok(delivery > -1, "the interactive delivery must exist");
  assert.ok(
    delivery < surface,
    "the card is recorded as SURFACED only after its interactive component was delivered",
  );
  // The posting account is the ledger's, never the event's session key.
  assert.ok(
    body.includes("resolveGovernedAnnouncementAccount("),
    "the card's account is resolved from the ledger",
  );
  assert.ok(
    body.includes("resolveDiscordBotToken(agentId)"),
    "the token is the ledger-resolved account's token",
  );
});

test("M12/T9 F-109: every publish path yields a verdict, and a blocked one is never a delivery", () => {
  // The card body must not have a single silent `return;`: every path answers
  // with a verdict the announce seam can read.
  const body = functionBody(
    pluginSource,
    "async function maybePublishDiscordCard",
  );
  assert.equal(
    /\breturn;/u.test(body),
    false,
    "every publish path must return a verdict, never end silently",
  );
  // The seam reads the verdict.
  const seam = functionBody(
    pluginSource,
    "async beforeAnnounce(event, context, signal)",
  );
  assert.ok(
    seam.includes("resolveAnnouncePublishDecision("),
    "the announce seam must read the publish verdict",
  );
  assert.ok(
    seam.includes("await maybePublishDiscordCard(event)"),
    "the seam must take the verdict the publish returns",
  );

  // The decision the seam returns for each verdict.
  const delivered = { action: "deliver", receipt: "receipt" };
  assert.deepEqual(
    resolveAnnouncePublishDecision({
      decision: delivered,
      verdict: { status: "PUBLISHED" },
    }),
    delivered,
    "a published card leaves the guard's decision alone",
  );
  assert.deepEqual(
    resolveAnnouncePublishDecision({
      decision: delivered,
      verdict: { status: "NOT_APPLICABLE", agentId: "excel" },
    }),
    delivered,
    "an announce that was never a card leaves the guard's decision alone",
  );
  assert.deepEqual(
    resolveAnnouncePublishDecision({
      decision: delivered,
      verdict: { status: "BLOCKED", error: "ANNOUNCE_DELIVERY_FAILED" },
    }),
    { action: "discard", reason: "ANNOUNCE_DELIVERY_FAILED" },
    "a card that was never published is never reported as delivered",
  );
  assert.deepEqual(
    resolveAnnouncePublishDecision({
      decision: delivered,
      verdict: { status: "BLOCKED", error: "UNAUTHORIZED_TARGET" },
    }),
    { action: "discard", reason: "UNAUTHORIZED_TARGET" },
    "the refusal names its own cause",
  );
});

// ---------------------------------------------------------------------------
// M12/T9 F-021 / F-075 / F-079 - the coordinator pickup lane and the
// pre-admitted spawn branch
// ---------------------------------------------------------------------------

test("M12/T9 F-021: the pickup lane's eligibility is decided when work could be claimed", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "m12t9-pickup-"));
  const paths = ledgerPaths(root);
  try {
    // No snapshot yet: the lane is not eligible and it claims nothing.
    assert.deepEqual(
      readPickupLedgerTasks({ paths }),
      {},
      "an absent snapshot must refuse to claim anything",
    );
    ensureLedger(paths);
    const seed = origin(1, "run-m12t9-f021");
    const taskId = deriveTaskId(seed);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", { ...seed, task_id: taskId });
    // The snapshot exists NOW - after the plugin would have loaded. The lane
    // must become eligible without a restart.
    const tasks = readPickupLedgerTasks({ paths });
    assert.deepEqual(
      Object.keys(tasks),
      [taskId],
      "a snapshot created after the load makes the lane eligible",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // The one-shot gate at register() time is gone.
  assert.equal(
    pluginSource.includes("ledgerSnapshotPresent"),
    false,
    "the eligibility must not be decided once, at register() time",
  );
  // The loop reads the ledger through the per-tick reader, so a snapshot that
  // appears later is picked up without a restart.
  assert.ok(
    pluginSource.includes("readPickupLedgerTasks({ paths })"),
    "the pickup loop must read the ledger through the per-tick reader",
  );
});

test("M12/T9 F-079: the pre-admitted spawn branch never skips the approval surface", () => {
  // The branch is entered when the model's proposal names a node the task
  // already declares. Its verdict comes from the canonical guard, but the
  // guard's AUTH_APPROVAL_REQUIRED refusal must be answered with the SAME
  // first-approval surface the canonical path creates - otherwise a
  // model-supplied node id can leave the task waiting for an approval nobody
  // was ever asked for.
  const branch = functionBody(pluginSource, "if (isPreAdmittedFixture) {");
  assert.ok(
    branch.includes('gateError?.message === "AUTH_APPROVAL_REQUIRED"'),
    "the branch must recognise the approval refusal",
  );
  assert.ok(
    branch.includes("requestFirstSpawnApproval("),
    "the branch must create the same first-approval surface the canonical path creates",
  );
  assert.ok(
    branch.includes("throw gateError"),
    "the refusal stays the refusal: creating the request never authorizes the spawn",
  );
});

test("M12/T9 F-075: one process runs exactly one coordinator pickup loop", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "m12t9-pickup-loop-"));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const logs = [];
  const register = () => {
    const hooks = new Map();
    governancePlugin.register({
      pluginConfig: {
        ledgerRoot: paths.root,
        ownerDiscordId: "123456789012345678",
        enabled: true,
      },
      on: (name, handler) => hooks.set(name, handler),
      registerTool: () => {},
      logger: {
        warn: (m) => logs.push(String(m)),
        info: (m) => logs.push(String(m)),
        error: (m) => logs.push(String(m)),
      },
    });
    return hooks;
  };
  const first = register();
  const second = register();
  try {
    const started = logs.filter((line) =>
      line.includes("coordinator pickup loop started"),
    );
    assert.equal(
      started.length,
      1,
      `exactly one pickup loop per process, got ${started.length}`,
    );
    assert.ok(
      logs.some((line) =>
        line.includes("coordinator pickup loop already running"),
      ),
      "a second registration must attach to the running loop, not start another",
    );
  } finally {
    first.get("gateway_stop")?.();
    second.get("gateway_stop")?.();
    rmSync(root, { recursive: true, force: true });
  }
});
