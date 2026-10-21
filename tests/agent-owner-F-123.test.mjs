// M12/T9 F-123 — STATUS: EXPIRED is not producible for a workflow approval;
// an unanswered approval never expires.
//
// The owner's ruling (2026-10-21): "Thẻ của anh hết hạn sau 24h kể từ lúc bot
// đưa thông báo, không bấm duyệt = không phê duyệt, thẻ hết hạn = không phê
// duyệt." The 24 hours run from the moment the bot POSTS the card; an
// untouched card is a refusal, not a pending state; and an expired card is not
// approved.
//
// The owner ALSO ruled that the task does NOT leave its pending state in the
// ledger: no durable terminal `EXPIRED` workflow status is introduced and no
// sweeper is added. That is the owner's decision, not an omission, and these
// lanes assert the surface and the decision path — not a terminal state.
//
// These lanes prove:
//   1. a card posted 23 hours ago is NOT expired, and one posted 25 hours ago
//      IS: the approvals surface derives `STATUS: EXPIRED` for the second and
//      keeps `STATUS: WAITING` for the first;
//   2. a decision against an expired card is REFUSED with the named code
//      `AUTH_APPROVAL_EXPIRED`, and nothing is written;
//   3. a decision against an untouched card that is still inside its 24 hours
//      is still a decision — the clock changes nothing else.
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
import {
  ledgerPaths,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  APPROVAL_CARD_TTL_MS,
  approvalCardExpiresAt,
  approvalStatusTag,
  isApprovalCardExpired,
} from "../integrations/openclaw/lib/discord-forum-tags.mjs";
import {
  handleDiscordAction,
  recordWorkflowEvent,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";

const TASK_ID = "21102026CDEF";
const THREAD_ID = "900000000000000001";
const HOUR_MS = 60 * 60 * 1000;

/** A ledger with one task whose approval card has been surfaced. */
function ledgerWithCard(tag) {
  const root = mkdtempSync(path.join(os.tmpdir(), `zink-f123-${tag}-`));
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
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
    task_id: TASK_ID,
    channel: "approvals",
    thread_id: THREAD_ID,
  });
  return { root, paths };
}

/** The owner's decision, presented against the card. */
function decide(paths, currentTime) {
  return handleDiscordAction({
    actor: "user",
    channel: "approvals",
    taskId: TASK_ID,
    action: "APPROVE",
    currentState: "APPROVAL_PENDING",
    paths,
    data: { threadId: THREAD_ID, messageId: "123456789012345679" },
    currentTime,
  });
}

test("F-123: the owner's window is 24 hours from the moment the card is posted", () => {
  assert.equal(APPROVAL_CARD_TTL_MS, 24 * HOUR_MS);
  const postedAt = Date.parse("2026-10-20T12:00:00.000Z");
  assert.equal(
    approvalCardExpiresAt(postedAt),
    Date.parse("2026-10-21T12:00:00.000Z"),
    "the card must expire 24 hours after it was posted",
  );
  assert.equal(
    approvalCardExpiresAt(null),
    null,
    "an unknown posting moment is not an expiry",
  );
});

test("F-123: a card posted 23 hours ago is WAITING and one posted 25 hours ago is EXPIRED", () => {
  const now = Date.parse("2026-10-21T12:00:00.000Z");
  const inside = approvalCardExpiresAt(now - 23 * HOUR_MS);
  const outside = approvalCardExpiresAt(now - 25 * HOUR_MS);
  assert.equal(isApprovalCardExpired({ expiresAt: inside, now }), false);
  assert.equal(isApprovalCardExpired({ expiresAt: outside, now }), true);
  assert.deepEqual(approvalStatusTag(null, { expiresAt: inside, now }), {
    category: "STATUS",
    value: "WAITING",
  });
  assert.deepEqual(approvalStatusTag(null, { expiresAt: outside, now }), {
    category: "STATUS",
    value: "EXPIRED",
  });
  // A card that WAS answered keeps the owner's answer: the clock never
  // rewrites a decision the owner took inside the window.
  assert.deepEqual(approvalStatusTag("APPROVE", { expiresAt: outside, now }), {
    category: "STATUS",
    value: "APPROVED",
  });
  // An untouched card with no expiry is still WAITING: an unknown expiry is
  // never an expired card.
  assert.deepEqual(approvalStatusTag(), {
    category: "STATUS",
    value: "WAITING",
  });
});

test("F-123: the refusal projects the expiry onto the card", () => {
  const source = readFileSync(
    path.join(
      path.resolve(import.meta.dirname, ".."),
      "integrations",
      "openclaw",
      "plugins",
      "zink-governance",
      "index.mjs",
    ),
    "utf8",
  );
  assert.ok(
    source.includes('reason: "AUTH_APPROVAL_EXPIRED"'),
    "the refusal must carry the named code",
  );
  assert.ok(
    source.includes("projectExpiredApprovalTag("),
    "the refusal must project the expiry onto the card",
  );
  assert.match(
    source,
    /transitionApprovalTag\(\{ taskId, decision: null \}\)/u,
    "the expiry projection must ask for the decision-less tag, so the surface derives EXPIRED",
  );
});

test("F-123: a decision against an expired card is refused with AUTH_APPROVAL_EXPIRED", () => {
  const { root, paths } = ledgerWithCard("expired");
  try {
    const before = readSnapshot(paths).sequence;
    const refused = decide(paths, Date.now() + 25 * HOUR_MS);
    assert.equal(refused.allowed, false);
    assert.equal(
      refused.reason,
      "AUTH_APPROVAL_EXPIRED",
      "the refusal must name the expiry",
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

test("F-123: a decision against an untouched card inside its 24 hours is still a decision", () => {
  const { root, paths } = ledgerWithCard("inside");
  try {
    const before = readSnapshot(paths).sequence;
    const allowed = decide(paths, Date.now() + 23 * HOUR_MS);
    assert.equal(
      allowed.allowed,
      true,
      `an untouched card inside its window must still be answerable: ${allowed.reason ?? ""}`,
    );
    assert.equal(
      readSnapshot(paths).sequence,
      before + 1,
      "the decision must be written to the ledger",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
