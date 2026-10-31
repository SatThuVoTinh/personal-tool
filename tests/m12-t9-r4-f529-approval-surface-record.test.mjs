// M12/T9-R4 F-529 (legacy R10-T01-1) — the approval card's only durable
// anchor is written best-effort, and the guards that depend on it skip
// instead of refusing.
//
// Proven here:
//   1. (criterion b) APPROVE is REFUSED when `approval_requested_at` exists
//      but no readable WORKFLOW_APPROVAL_SURFACED record does — the clock and
//      thread guards must never skip past a missing record;
//   2. a card WITH a readable surfaced record is still approvable (the refusal
//      is the missing record, not the approval path);
//   3. (criterion a) a failed SURFACED write in the announce path returns
//      BLOCKED instead of logging and reporting PUBLISHED (deterministic
//      source-order probe, same technique as tests/m12-t2-governed-surface
//      and tests/agent-plugin-F-066).
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ledgerPaths,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  handleDiscordAction,
  recordWorkflowEvent,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TASK_ID = "23102026CDEF";
const THREAD_ID = "900000000000000001";

/** A ledger with a recorded approval request; SURFACED only when asked. */
function ledgerFixture(tag, { surfaced }) {
  const root = mkdtempSync(path.join(os.tmpdir(), `zink-f529-${tag}-`));
  const paths = ledgerPaths(root);
  mkdirSync(path.dirname(paths.identityKey), { recursive: true });
  writeFileSync(paths.identityKey, `${"1".repeat(64)}\n`, "utf8");
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    task_id: TASK_ID,
    origin: "discord",
    origin_principal_ref: "b".repeat(64),
    origin_message_id: "123456789012345679",
    root_agent_id: "main",
    root_session_key: "main-session",
    root_run_id: "main-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
    task_id: TASK_ID,
    agent_id: "main",
    session_key: "main-session",
    run_id: "main-run",
  });
  if (surfaced) {
    recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
      task_id: TASK_ID,
      channel: "approvals",
      thread_id: THREAD_ID,
    });
  }
  return { root, paths };
}

function decide(paths) {
  return handleDiscordAction({
    actor: "user",
    channel: "approvals",
    taskId: TASK_ID,
    action: "APPROVE",
    currentState: "APPROVAL_PENDING",
    paths,
    data: { threadId: THREAD_ID, messageId: "123456789012345679" },
    currentTime: Date.now(),
  });
}

test("F-529: APPROVE without a readable surfaced record is refused and writes nothing", () => {
  const { root, paths } = ledgerFixture("absent", { surfaced: false });
  try {
    assert.ok(
      readSnapshot(paths).tasks[TASK_ID].approval_requested_at,
      "the fixture must carry a recorded approval request",
    );
    const before = readSnapshot(paths).sequence;
    const verdict = decide(paths);
    assert.equal(
      verdict.allowed,
      false,
      "an APPROVE whose surfaced card has no durable record must be refused",
    );
    assert.match(
      String(verdict.reason),
      /APPROVAL_SURFACE_RECORD_REQUIRED/u,
      "the refusal must name the missing record",
    );
    assert.equal(
      readSnapshot(paths).sequence,
      before,
      "a refused decision must not be written to the ledger",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-529: APPROVE with a readable surfaced record is still a decision", () => {
  const { root, paths } = ledgerFixture("present", { surfaced: true });
  try {
    const before = readSnapshot(paths).sequence;
    const verdict = decide(paths);
    assert.equal(
      verdict.allowed,
      true,
      `a surfaced card inside its window must stay approvable: ${verdict.reason ?? ""}`,
    );
    assert.equal(readSnapshot(paths).sequence, before + 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-529: a failed SURFACED write in the announce path returns BLOCKED, never PUBLISHED", () => {
  const source = readFileSync(
    path.join(
      REPO_ROOT,
      "integrations",
      "openclaw",
      "plugins",
      "zink-governance",
      "index.mjs",
    ),
    "utf8",
  );
  const start = source.indexOf("async function maybePublishDiscordCard");
  assert.ok(start > 0, "maybePublishDiscordCard must exist");
  const surface = source.indexOf(
    'recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED"',
    start,
  );
  assert.ok(
    surface > start,
    "the announce path must write the SURFACED record",
  );
  const published = source.indexOf('return { status: "PUBLISHED"', surface);
  assert.ok(published > surface, "the PUBLISHED verdict must follow the write");
  const window = source.slice(surface, published);
  assert.match(
    window,
    /APPROVAL_SURFACE_UNRECORDED[\s\S]*status: "BLOCKED"/u,
    "a failed SURFACED write must fail closed (BLOCKED) instead of only logging before PUBLISHED",
  );
});

test("F-586: a failed SURFACED write in the first-spawn REST path halts before posting buttons", () => {
  const source = readFileSync(
    path.join(
      REPO_ROOT,
      "integrations",
      "openclaw",
      "plugins",
      "zink-governance",
      "index.mjs",
    ),
    "utf8",
  );
  const start = source.indexOf("async function postFirstSpawnApprovalCard");
  assert.ok(start > 0, "postFirstSpawnApprovalCard must exist");
  const surface = source.indexOf(
    'recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED"',
    start,
  );
  assert.ok(
    surface > start,
    "the first-spawn path must write the SURFACED record",
  );
  const buttonsPost = source.indexOf("buildApprovalButtonsMessage", surface);
  assert.ok(buttonsPost > surface, "posting buttons must follow the SURFACED write");
  const window = source.slice(surface, buttonsPost);
  assert.match(
    window,
    /APPROVAL_SURFACE_UNRECORDED[\s\S]*return;/u,
    "a failed SURFACED write in first-spawn path must halt before posting buttons",
  );
});
