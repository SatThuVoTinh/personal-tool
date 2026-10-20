// M12/T9 F-033 - the live governance probe writes SYNTHETIC origin provenance
// into the state root it inspects.
//
// The probe forges an `origin_principal_ref`, a synthetic `origin_message_id`
// and the task id derived from them, and it journals that origin with
// `recordWorkflowEvent`. A forged row in a live ledger is indistinguishable
// from real intake except by its message-id range, and the synthetic ids never
// collide - so the duplicate guard stays unexercisable in exactly the ledger
// where it matters, and every later read of the real history sees rows no
// intake produced.
//
// The gate is therefore the state root itself: the probe writes only into a
// DISPOSABLE root, and NO acknowledgement can unlock a production write.
//
// The refusals are asserted by RUNNING the probe, because the defect is a
// runtime property of the fixture, not a string in it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const PROBE = fileURLToPath(
  new URL(
    "../integrations/openclaw/topology/fixtures/runtime-regression/live-governance-probe.mjs",
    import.meta.url,
  ),
);

// The one machine-specific literal the probe owns: the production root it
// refuses to write to. It is a comparison, never an input.
const PRODUCTION_ROOT = "/home/hoang_vinh/.openclaw-zink";
const WRITE_ACK = "--acknowledge-production-ledger-write";

function runProbe(args) {
  // The state root is named by argv only: an inherited environment variable
  // would override it (the probe reads the env FIRST), so it is removed.
  const env = { ...process.env };
  delete env.ZINK_PROBE_STATE_DIR;
  return spawnSync(process.execPath, [PROBE, ...args], {
    encoding: "utf8",
    env,
    timeout: 60000,
  });
}

function disposableRoot(tag) {
  return mkdtempSync(path.join(os.tmpdir(), `zink-f033-${tag}-`));
}

describe("M12/T9 F-033 - the live governance probe writes only into a disposable state root", () => {
  it("refuses the production root even when the write is acknowledged", () => {
    const result = runProbe([PRODUCTION_ROOT, WRITE_ACK]);
    assert.equal(result.status, 2, "the probe must stop before any write");
    assert.match(
      result.stdout,
      /PROBE_STATE_DIR_IS_PRODUCTION_ROOT/u,
      "an acknowledged production write must still be refused",
    );
    assert.doesNotMatch(
      result.stdout,
      /"stage":"native-patch"/u,
      "the refusal must happen at the preflight, before any stage runs",
    );
  });

  it("refuses a state root INSIDE the production root", () => {
    // A path-segment comparison, so a nested root cannot smuggle the
    // production tree in as a "different" directory.
    const result = runProbe([
      path.join(PRODUCTION_ROOT, "operator", "m7-t2"),
      WRITE_ACK,
    ]);
    assert.equal(result.status, 2, "the probe must stop before any write");
    assert.match(
      result.stdout,
      /PROBE_STATE_DIR_IS_PRODUCTION_ROOT/u,
      "a root inside the production root is the production root",
    );
  });

  it("refuses a state root that already holds a real governance ledger", () => {
    const root = disposableRoot("history");
    try {
      const ledger = path.join(root, "operator", "m7-t2", "ledger");
      mkdirSync(ledger, { recursive: true });
      writeFileSync(
        path.join(ledger, "events.jsonl"),
        `${JSON.stringify({ sequence: 1 })}\n`,
        "utf8",
      );
      const result = runProbe([root]);
      assert.equal(result.status, 2, "the probe must stop before any write");
      assert.match(
        result.stdout,
        /PROBE_STATE_DIR_NOT_DISPOSABLE/u,
        "a root with a real ledger is not disposable",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a state root whose snapshot already holds a task", () => {
    const root = disposableRoot("task");
    try {
      const ledger = path.join(root, "operator", "m7-t2", "ledger");
      mkdirSync(ledger, { recursive: true });
      writeFileSync(
        path.join(ledger, "snapshot.json"),
        `${JSON.stringify({ sequence: 0, tasks: { t1: {} } })}\n`,
        "utf8",
      );
      const result = runProbe([root]);
      assert.equal(result.status, 2, "the probe must stop before any write");
      assert.match(
        result.stdout,
        /PROBE_STATE_DIR_NOT_DISPOSABLE/u,
        "a root with a task in its snapshot is not disposable",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("admits a disposable root: the preflight does not refuse it", () => {
    const root = disposableRoot("scratch");
    try {
      const result = runProbe([root]);
      assert.notEqual(
        result.status,
        2,
        "a disposable root must pass the preflight",
      );
      assert.doesNotMatch(
        result.stdout,
        /PROBE_STATE_DIR_NOT_DISPOSABLE|PROBE_STATE_DIR_IS_PRODUCTION_ROOT/u,
        "a disposable root must not be refused",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
