// M12/T9 F-113 (legacy R1-A16-03) - a task waiting for the owner's verdict must
// have an owner-visible surface carrying the accept control, plus a durable
// event proving it.
//
// MEASURED AT HEAD: the only producer able to make a pending result visible
// was the ACCEPT path itself (`surfaceAcceptedResult` is reachable only from
// `applyOwnerDecisionEffect`), so the accept path had nothing to accept and no
// task could sit pending with zero producers able to announce it.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const load = async (rel) => import(pathToFileURL(path.join(REPO_ROOT, rel)).href);
const plugin = await load(
  "integrations/openclaw/plugins/zink-governance/index.mjs",
);
const { ensureLedger, ledgerPaths, readSnapshot, recordWorkflowEvent } =
  await load("integrations/openclaw/topology/lib/ledger.mjs");
const { deriveTaskId } = await load(
  "integrations/openclaw/topology/lib/canonical.mjs",
);

const SOURCE = readFileSync(
  path.join(REPO_ROOT, "integrations/openclaw/plugins/zink-governance/index.mjs"),
  "utf8",
);

test("F-113: a pending-result producer exists outside the accept path", () => {
  assert.match(
    SOURCE,
    /async function surfacePendingResult\(/u,
    "a pending-result producer must exist",
  );
  // The producer must be reachable from the run-end seam, NOT only from the
  // ACCEPT path.
  const runEnd = SOURCE.indexOf("announcePendingResult(owner?.task_id");
  assert.ok(runEnd > 0, "the run-end seam must announce the pending result");
  const acceptPath = SOURCE.indexOf("surfaceAcceptedResult({");
  assert.ok(acceptPath > 0);
  const announce = SOURCE.indexOf("surfacePendingResult({ taskId, resultsForumId })");
  assert.ok(announce > 0, "the producer must be called by the announcement seam");
});

test("F-113: the pending surface carries the accept control", () => {
  const at = SOURCE.indexOf("async function surfacePendingResult(");
  assert.ok(at > 0);
  const slice = SOURCE.slice(at, at + 6000);
  assert.match(slice, /DISCORD_COMPONENT_ACTION_NAMESPACE\.RESULT_ACCEPT/u);
  assert.match(slice, /DISCORD_COMPONENT_ACTION_NAMESPACE\.RESULT_REJECT/u);
  assert.match(slice, /WORKFLOW_RESULT_SURFACED/u);
  assert.match(slice, /RESULT_PENDING_REVIEW/u);
});

test("F-113: the durable surface event is schema-valid and projects the thread", () => {
  const event = plugin.buildResultSurfaceEvent({
    taskId: "a".repeat(12),
    threadId: "1111111111111111111",
    resultDigest: "b".repeat(64),
  });
  assert.equal(event.channel, "results");
  assert.equal(event.result_digest, "b".repeat(64));
  const noDigest = plugin.buildResultSurfaceEvent({
    taskId: "a".repeat(12),
    threadId: "1111111111111111111",
    resultDigest: null,
  });
  assert.equal(
    Object.hasOwn(noDigest, "result_digest"),
    false,
    "an absent digest is not recorded as one",
  );

  // The durable proof: the reducer accepts the event and projects the thread.
  const root = mkdtempSync(path.join(os.tmpdir(), "f113-"));
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const payload = {
      origin: "discord",
      origin_principal_ref: "a".repeat(64),
      origin_message_id: "123456789012345678",
      root_agent_id: "main",
      root_session_key: "root-session",
      root_run_id: "root-run",
    };
    const taskId = deriveTaskId(payload);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
      ...payload,
      task_id: taskId,
    });
    recordWorkflowEvent(
      paths,
      "WORKFLOW_RESULT_SURFACED",
      plugin.buildResultSurfaceEvent({
        taskId,
        threadId: "1111111111111111111",
        resultDigest: null,
      }),
    );
    assert.equal(
      readSnapshot(paths).tasks[taskId].results_thread_id,
      "1111111111111111111",
      "the announcement must be durable",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
