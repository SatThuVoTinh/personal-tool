// M12/T9 F-247 — `task.accepted_reference_digests` is declared and read but
// has no writer, so any delegation carrying `input_refs` is refused forever.
//
// The owner's ruling (2026-10-21) is "bỏ ô" — DROP THE FIELD. The register's
// own acceptance criteria had asked for a writer (a new event type plus a
// reducer branch); the owner chose the other half: the slot never existed in
// any committed state, so it is removed from the published contract and from
// every reader.
//
// These lanes prove:
//   1. the published snapshot contract no longer declares the field, and the
//      task branch still refuses unknown properties, so a task that still
//      carries it is INVALID rather than silently tolerated;
//   2. a task written by the real ledger writer validates against the
//      published contract after the removal;
//   3. NO tracked code reads or writes the name any more — the lane fails if
//      the name reappears anywhere in the tracked tree outside this row's own
//      history (the findings register and this lane itself).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureLedger,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  loadContractSchema,
  validateContract,
} from "../integrations/openclaw/topology/lib/schema.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const FIELD = "accepted_reference_digests";
const TASK_PATTERN = "^([0-9a-f]{64}|[0-9]{8}[CDEFHJKMNPQRTUVWXY379]{4})$";
const TASK_ID = "21102026CDEF";

/**
 * The task branch of the published snapshot contract: the one shape a task
 * object may take.
 */
function publishedTaskBranch() {
  const schema = loadContractSchema("ledger-snapshot");
  const branch = schema?.properties?.tasks?.patternProperties?.[TASK_PATTERN];
  assert.ok(branch, "the snapshot contract must publish a task branch");
  const shape = branch?.oneOf?.[0];
  assert.ok(shape, "the task branch must publish exactly one shape");
  return shape;
}

/** A ledger written by the REAL writer, so the snapshot is a real snapshot. */
function writeRealLedger() {
  const root = mkdtempSync(path.join(os.tmpdir(), "f247-ledger-"));
  const paths = {
    root,
    snapshot: path.join(root, "snapshot.json"),
    events: path.join(root, "events.jsonl"),
  };
  ensureLedger(paths);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    task_id: TASK_ID,
    origin: "discord",
    origin_principal_ref: "b".repeat(64),
    origin_message_id: "123456789012345678",
    root_agent_id: "main",
    root_session_key: "main-session",
    root_run_id: "main-run",
  });
  return { root, paths };
}

test("F-247: the published snapshot contract no longer declares the field", () => {
  const shape = publishedTaskBranch();
  assert.equal(shape.additionalProperties, false);
  assert.ok(
    !Object.hasOwn(shape.properties, FIELD),
    "the published snapshot contract still declares " + FIELD,
  );
});

test("F-247: a task that still carries the field is refused by the contract", () => {
  const { root, paths } = writeRealLedger();
  try {
    const snapshot = readSnapshot(paths);
    assert.doesNotThrow(
      () => validateContract("ledger-snapshot", snapshot, 65536),
      "a snapshot written by the real ledger writer must validate",
    );
    const tampered = JSON.parse(JSON.stringify(snapshot));
    tampered.tasks[TASK_ID][FIELD] = { ["a".repeat(64)]: "b".repeat(64) };
    assert.throws(
      () => validateContract("ledger-snapshot", tampered, 65536),
      "a task carrying " + FIELD + " must be refused by the published contract",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-247: no tracked code reads or writes the field any more", () => {
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter(Boolean);
  // This row's own history: the findings register names the field in its
  // evidence line, PLAN.md records the owner's ruling, the changelog carries
  // the closed row's history (H10 moved it there), and this lane names it
  // because it proves the removal. Those four are the field's HISTORY; no
  // other tracked file may carry it, and in particular no CODE may.
  const ownHistory = new Set([
    "docs/execution/findings.md",
    "CHANGELOG.md",
    "PLAN.md",
    "tests/agent-owner-F-247.test.mjs",
  ]);
  const offenders = tracked
    .filter((file) => !ownHistory.has(file))
    .filter((file) => {
      try {
        return readFileSync(path.join(REPO_ROOT, file), "utf8").includes(FIELD);
      } catch {
        return false;
      }
    });
  assert.deepEqual(
    offenders,
    [],
    "no tracked file outside this row's own history may mention " + FIELD,
  );
});
