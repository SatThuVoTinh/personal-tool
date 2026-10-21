//
// SKIP-FAMILY: symlink
//
// M12/T9 F-197 (R5-E09-03) / H3: this lane may skip, and it declares WHICH
// family it belongs to, so the skip-expectation gate can tell an explained
// skip from an unexplained one. The family-to-lane map is derived from the
// repository's own lane list; the expectation lives in
// `docs/contracts/ci-skip-expectations.json`.
// M12/T2-R4 (owner decision C1, 2026-10-14) — orphaned ledger writer lock recovery.
//
// `file-lock.mjs` states the rule in its own header: a crashed holder leaves the lock
// directory behind, the next acquirer fails, and "there is intentionally NO age-based
// stale-lock reclaim… Recovery of an orphaned lock is an explicit operator action, not an
// automatic heuristic." That sentence is the whole contract, and until now nothing in the
// repository implemented it, so an apply/rollback restart that killed the gateway mid-append
// left the live host unable to write its ledger OR to be deployed at all.
//
// These tests run the REAL operator script as a child process against a scratch state
// directory. The refusals are the point: a recovery tool that deletes a lock held by a live
// process would let two writers into the critical section together, which is the data-integrity
// failure the no-reclaim design exists to prevent.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { ledgerPaths } from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  LOCK_OWNER_FILE,
  lockDirFor,
} from "../integrations/openclaw/lib/file-lock.mjs";

const REPO = process.cwd();
const SCRIPT = path.join(
  REPO,
  "integrations",
  "openclaw",
  "topology",
  "fixtures",
  "runtime-regression",
  "operator-lock-recovery.mjs",
);
const CONFIRM = "ORPHAN_LOCK_RECOVERY";
const DEAD_PID = 2_147_483_646;

function scratch({ owner, entries = [], mode = 0o600 } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-lock-recovery-"));
  const stateDir = path.join(root, ".openclaw-zink");
  const lock = lockDirFor(ledgerPaths(stateDir).root, "writer.lock");
  mkdirSync(lock, { recursive: true, mode: 0o700 });
  if (owner)
    writeFileSync(path.join(lock, LOCK_OWNER_FILE), JSON.stringify(owner), {
      mode,
    });
  for (const [name, body] of Object.entries(entries)) {
    writeFileSync(path.join(lock, name), body, { mode: 0o600 });
  }
  return { root, stateDir, lock };
}

function run(stateDir, extra = []) {
  try {
    const out = execFileSync(
      process.execPath,
      [SCRIPT, "--state-dir", stateDir, ...extra],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 },
    );
    return { status: 0, report: JSON.parse(out) };
  } catch (error) {
    return {
      status: error.status,
      report: error.stdout ? JSON.parse(error.stdout) : null,
      stderr: String(error.stderr ?? ""),
    };
  }
}

test("M12/T2-R4: an absent lock is reported and nothing is created or removed", () => {
  const s = scratch({});
  rmSync(s.lock, { recursive: true, force: true });
  try {
    const { status, report } = run(s.stateDir);
    assert.equal(status, 0);
    assert.equal(report.lock_present, false);
    assert.equal(report.action, "NONE");
    assert.equal(report.mutated, false);
    assert.equal(existsSync(s.lock), false);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("M12/T2-R4: a lock whose owner process is alive is never reclaimed", () => {
  // The live holder is THIS process, so the refusal is proven against a real,
  // running owner rather than a simulated one.
  const s = scratch({ owner: { pid: process.pid, token: "a".repeat(32) } });
  try {
    const dry = run(s.stateDir);
    assert.equal(dry.report.holder_alive, true);
    assert.equal(dry.report.action, "REFUSED_LIVE_HOLDER");
    const forced = run(s.stateDir, ["--recover", `--confirm=${CONFIRM}`]);
    assert.equal(forced.status, 1);
    assert.equal(forced.report.action, "REFUSED_LIVE_HOLDER");
    assert.equal(forced.report.mutated, false);
    assert.equal(
      JSON.parse(readFileSync(path.join(s.lock, LOCK_OWNER_FILE), "utf8")).pid,
      process.pid,
      "the live holder's record must survive the refusal",
    );
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("M12/T2-R4: an unreadable owner record is refused, not guessed", () => {
  const s = scratch({});
  try {
    writeFileSync(path.join(s.lock, LOCK_OWNER_FILE), "not json\n", {
      mode: 0o600,
    });
    const { report } = run(s.stateDir, ["--recover", `--confirm=${CONFIRM}`]);
    assert.equal(report.owner_entry, "MALFORMED");
    assert.equal(report.action, "INSPECT");
    assert.equal(report.mutated, false);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("M12/T2-R4: a lock directory holding an owner record is the only shape removed", () => {
  // rmdir refuses a non-empty directory, but the tool must also refuse to delete
  // a lock holding anything the owner record does not explain.
  const s = scratch({
    owner: { pid: DEAD_PID, token: "b".repeat(32) },
    entries: { "unexpected.txt": "content\n" },
  });
  try {
    const { report } = run(s.stateDir, ["--recover", `--confirm=${CONFIRM}`]);
    assert.equal(report.action, "INSPECT");
    assert.deepEqual(report.stray_entries, ["unexpected.txt"]);
    assert.equal(report.mutated, false);
    assert.equal(existsSync(s.lock), true);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("M12/T2-R4: a dead holder without explicit confirmation is reported only", () => {
  const s = scratch({ owner: { pid: DEAD_PID, token: "c".repeat(32) } });
  try {
    const observed = run(s.stateDir);
    assert.equal(observed.report.holder_alive, false);
    assert.equal(observed.report.action, "REPORT");
    assert.equal(observed.report.mutated, false);
    assert.equal(
      existsSync(s.lock),
      true,
      "the observation must mutate nothing",
    );
    const unconfirmed = run(s.stateDir, ["--recover"]);
    assert.equal(unconfirmed.status, 1);
    assert.equal(unconfirmed.report.action, "REFUSED_UNCONFIRMED");
    assert.equal(existsSync(s.lock), true);
    const wrong = run(s.stateDir, ["--recover", "--confirm=whatever"]);
    assert.equal(wrong.report.action, "REFUSED_UNCONFIRMED");
    assert.equal(existsSync(s.lock), true);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("M12/T2-R4: an orphaned lock is removed exactly, and the removal is verified", () => {
  const s = scratch({ owner: { pid: DEAD_PID, token: "d".repeat(32) } });
  try {
    const { status, report } = run(s.stateDir, [
      "--recover",
      `--confirm=${CONFIRM}`,
    ]);
    assert.equal(status, 0);
    assert.equal(report.action, "RECOVERED");
    assert.equal(report.mutated, true);
    assert.equal(report.recovered, true);
    assert.equal(existsSync(s.lock), false, "the lock directory must be gone");
    assert.equal(
      existsSync(path.dirname(s.lock)),
      true,
      "only the lock itself may be removed, never the ledger",
    );
    assert.equal(
      existsSync(path.join(s.stateDir, "operator", "m7-t2", "ledger")),
      true,
    );
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("M12/T2-R4: the report carries no secret material", () => {
  const token = "e".repeat(32);
  const s = scratch({ owner: { pid: DEAD_PID, token } });
  try {
    const { report } = run(s.stateDir);
    assert.equal(
      JSON.stringify(report).includes(token),
      false,
      "the lock token is a holder nonce, not an operator credential: it must not be echoed",
    );
    // OWNER GRANT 2026-10-15 (option A) re-valued this line. It used to be
    // `assert.match(report.owner_token, /^e{4}\*{28}$/u)`, which demanded the
    // token's first four characters and so pinned the leak the fix removes. The
    // property is what must hold: the field carries a presence constant, and no
    // prefix of the nonce reaches the report.
    assert.equal(
      report.owner_token,
      "PRESENT",
      "the report must state presence, never a fragment",
    );
    for (const length of [4, 8, 16, 32]) {
      assert.ok(
        !JSON.stringify(report).includes(token.slice(0, length)),
        `no ${length}-character prefix of the holder nonce may reach the report`,
      );
    }
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("M12/T2-R4: a symlink anywhere on the lock path is refused", (t) => {
  if (process.platform === "win32")
    return t.skip("symlink creation needs privileges Windows does not grant");
  const s = scratch({ owner: { pid: DEAD_PID, token: "f".repeat(32) } });
  const moved = path.join(s.root, "real-lock");
  try {
    rmSync(s.lock, { recursive: true, force: true });
    mkdirSync(moved, { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(moved, LOCK_OWNER_FILE),
      JSON.stringify({ pid: DEAD_PID, token: "f".repeat(32) }),
      { mode: 0o600 },
    );
    symlinkSync(moved, s.lock, "dir");
    const { report } = run(s.stateDir, ["--recover", `--confirm=${CONFIRM}`]);
    assert.equal(report.action, "REFUSED_SYMLINK");
    assert.equal(report.mutated, false);
    assert.equal(
      existsSync(path.join(moved, LOCK_OWNER_FILE)),
      true,
      "a refused path must leave the record it could not validate intact",
    );
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
