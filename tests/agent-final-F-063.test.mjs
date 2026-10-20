// M12/T9 F-063 (legacy R1-A08-02): the replay reader failed a forked journal
// with a bare "event chain mismatch" and no reconciliation path.
//
// Two writers behind one lock emit the SAME sequence number with different
// payloads, so the journal carries two branches from one point. The reader
// accepted the first branch and then refused the second, so the whole
// governance history became unreadable and the operator had nothing to
// reconcile against.
//
// Acceptance criteria: "a fixture with one forked pair replays and reports the
// discarded branch."
//
// The fail-stop integrity shape is untouched: a duplicated event (the same
// digest twice) and a corrupted digest are still corruption, and a journal
// with no fork replays exactly as before.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  readSnapshotWithReport,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "agent-final-f063-"));
}

function seed(root, rootAgentId = "sql") {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: "1556249093729427459",
  };
  const taskId = deriveTaskId(origin);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...origin,
    task_id: taskId,
    root_agent_id: rootAgentId,
    root_session_key: `agent:${rootAgentId}:sess`,
    root_run_id: "run-1",
  });
  return { paths, taskId };
}

/** The forked twin of the journal's last event: same sequence, same parent, different payload. */
function forkLastEvent(paths, mutate) {
  const lines = readFileSync(paths.events, "utf8").split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  const unsigned = { ...last };
  delete unsigned.event_digest;
  const forked = { ...unsigned, payload: mutate(unsigned.payload) };
  const event_digest = canonicalHash("zink-ledger-event-v1", forked);
  return { event: { ...forked, event_digest }, event_digest };
}

test("F-063: a forked pair replays and reports the discarded branch", () => {
  const root = fixture();
  try {
    const { paths, taskId } = seed(root, "sql");
    const { event: forked, event_digest: forkedDigest } = forkLastEvent(
      paths,
      (payload) => ({ ...payload, root_agent_id: "excel" }),
    );
    // The fork lands right after the branch the journal continued on.
    const journal = readFileSync(paths.events, "utf8");
    writeFileSync(
      paths.events,
      `${journal}${JSON.stringify(forked)}\n`,
      "utf8",
    );

    const diagnostics = [];
    const originalError = console.error;
    console.error = (...args) => diagnostics.push(args.join(" "));
    let report;
    try {
      report = readSnapshotWithReport(paths);
    } finally {
      console.error = originalError;
    }

    assert.equal(
      report.discardedBranches.length,
      1,
      "exactly one discarded branch must be reported",
    );
    const discarded = report.discardedBranches[0];
    assert.equal(
      discarded.sequence,
      1,
      "the discarded branch names its sequence",
    );
    assert.equal(
      discarded.event_digest,
      forkedDigest,
      "the discarded branch names the digest that was discarded",
    );
    assert.ok(
      diagnostics.some((line) => line.includes("LEDGER_FORK_DISCARDED")),
      `the discarded branch must be reported: ${JSON.stringify(diagnostics)}`,
    );
    // The SURVIVING branch is the one that was replayed.
    assert.equal(
      report.snapshot.tasks[taskId].root_agent_id,
      "sql",
      "the branch the journal continued on must be the one that was replayed",
    );
    // The plain reader answers the same forked journal instead of refusing it.
    const plain = readSnapshot(paths);
    assert.equal(plain.tasks[taskId].root_agent_id, "sql");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-063: a journal with no fork reports no discarded branch", () => {
  const root = fixture();
  try {
    const { paths, taskId } = seed(root, "sql");
    const diagnostics = [];
    const originalError = console.error;
    console.error = (...args) => diagnostics.push(args.join(" "));
    let report;
    try {
      report = readSnapshotWithReport(paths);
    } finally {
      console.error = originalError;
    }
    assert.deepEqual(report.discardedBranches, []);
    assert.equal(report.snapshot.tasks[taskId].root_agent_id, "sql");
    assert.ok(
      !diagnostics.some((line) => line.includes("LEDGER_FORK_DISCARDED")),
      "an unforked journal must report nothing",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-063: a duplicated event is corruption, not a fork, and still fails closed", () => {
  const root = fixture();
  try {
    const { paths } = seed(root, "sql");
    const journal = readFileSync(paths.events, "utf8");
    // The SAME event twice: the digest is identical, so this is a corrupted
    // journal and not a branch.
    writeFileSync(paths.events, `${journal}${journal}`, "utf8");
    assert.throws(
      () => readSnapshot(paths),
      /Ledger corruption/u,
      "a duplicated event must still fail closed",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
