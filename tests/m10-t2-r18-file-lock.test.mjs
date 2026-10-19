// M10/T2-R18 — file-lock defects found by the concurrency review.
//
// Each test reproduces a concrete failure that was demonstrated against the
// pre-fix code, not merely reasoned about.
import assert from "node:assert/strict";
import test from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const mod = await import("../integrations/openclaw/lib/file-lock.mjs");
const { withFileLockSync, release, acquire, tryAcquire } = mod;

const root = () => mkdtempSync(path.join(tmpdir(), "zink-lock-"));
const cleanup = (dirs) =>
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));

test("R18-01: a committed result survives a failing release", () => {
  // The pre-fix `try { return fn() } finally { release(dir) }` made a release
  // error REPLACE the value fn() had already returned. In the ledger that means
  // an event that was appended AND fsynced is reported to the caller as a
  // failure, so a durable commit is indistinguishable from a rejected one.
  //
  // The release failure is FORCED here: the critical section leaves a file
  // inside the lock directory, so `rmdirSync` cannot succeed. Without that the
  // buggy branch is never reached and the test would pass vacuously — which is
  // exactly what happened on the first version of this test.
  const base = root();
  const lockDir = path.join(base, "writer.lock");
  try {
    const out = withFileLockSync(lockDir, () => {
      writeFileSync(path.join(lockDir, "in-flight"), "x", "utf8");
      return { committed: true, seq: 7 };
    });
    assert.deepEqual(
      out,
      { committed: true, seq: 7 },
      "the guarded call's own result must survive a failed release",
    );
    // M12/T9 F-334: the case asserted only the returned value, so deleting the
    // forcing step above made it pass vacuously ? the very failure this
    // comment warns about. The precondition is now asserted: the release must
    // actually have failed, which is observable as the lock directory still
    // being there.
    assert.equal(
      existsSync(lockDir),
      true,
      "the release must have failed for this case to mean anything; if the lock directory is gone the forcing step no longer forces a failure",
    );
    assert.equal(
      existsSync(path.join(lockDir, "in-flight")),
      true,
      "the file that makes `rmdirSync` fail must still be inside the lock directory",
    );
  } finally {
    cleanup([base]);
  }
});

test("R18-02: the original business error is not destroyed by a release failure", () => {
  // When fn() throws, the caller needs THAT diagnostic — it is what tells the
  // operator whether a commit partially applied. Pre-fix, a release failure
  // replaced it entirely.
  const base = root();
  const lockDir = path.join(base, "writer.lock");
  try {
    assert.throws(
      () =>
        withFileLockSync(lockDir, () => {
          writeFileSync(path.join(lockDir, "in-flight"), "x", "utf8");
          throw new Error("STALE_SNAPSHOT");
        }),
      (err) => {
        assert.equal(
          err.message,
          "STALE_SNAPSHOT",
          "the caller's own diagnostic must survive; a lock-internal errno must not replace it",
        );
        return true;
      },
    );
  } finally {
    cleanup([base]);
  }
});

test("R18-03: a non-EEXIST filesystem failure is not relabelled as contention", async () => {
  // Pre-fix, acquire() caught every non-EEXIST errno, broke the retry loop and
  // threw FILE_LOCK_TIMEOUT with NO `.code`. Every caller classifies on
  // `err?.code === "FILE_LOCK_BUSY"`, so a permanent fault looked like
  // transient lock contention.
  const base = root();
  try {
    // The lock's PARENT is a file, so `mkdir` fails ENOTDIR — a real
    // filesystem fault, NOT contention. (Making the lock path itself a file
    // would throw EEXIST, which IS contention and correctly times out.)
    const blocker = path.join(base, "blocker");
    writeFileSync(blocker, "not-a-directory", "utf8");
    const blocked = path.join(blocker, "writer.lock");

    await assert.rejects(
      () => acquire(blocked, { timeoutMs: 60, retryDelayMs: 5 }),
      (err) => {
        assert.notEqual(
          err.code,
          "FILE_LOCK_TIMEOUT",
          "a real filesystem failure must not be relabelled as contention",
        );
        assert.ok(
          ["ENOTDIR", "ENOENT"].includes(err.code),
          `the underlying filesystem errno must reach the caller unchanged, got ${err.code}`,
        );
        return true;
      },
    );
  } finally {
    cleanup([base]);
  }
});

test("R18-04: the contention timeout carries a machine-readable code", async () => {
  // withFileLockSync already set `busy.code = "FILE_LOCK_BUSY"`; the async
  // acquire path did not. Callers branch on `.code`, so the async timeout was
  // unclassifiable.
  const base = root();
  try {
    const lockDir = path.join(base, "writer.lock");
    mkdirSync(lockDir, { recursive: true }); // pre-created = held by someone else

    await assert.rejects(
      () => acquire(lockDir, { timeoutMs: 40, retryDelayMs: 5 }),
      (err) => {
        assert.match(err.message, /FILE_LOCK_TIMEOUT/u);
        assert.equal(
          err.code,
          "FILE_LOCK_TIMEOUT",
          "the timeout must be classifiable by callers",
        );
        return true;
      },
    );
  } finally {
    cleanup([base]);
  }
});

test("R18-05: release is idempotent and never throws for an absent lock", () => {
  const base = root();
  const lockDir = path.join(base, "writer.lock");
  try {
    assert.equal(tryAcquire(lockDir), true);
    release(lockDir);
    release(lockDir); // second release must be a no-op, not an error
  } finally {
    cleanup([base]);
  }
});

test("R18-06: an acquired lock carries an owner token inside its directory", () => {
  const base = root();
  const lockDir = path.join(base, "writer.lock");
  try {
    assert.equal(tryAcquire(lockDir), true);
    const owner = JSON.parse(
      readFileSync(path.join(lockDir, mod.LOCK_OWNER_FILE), "utf8"),
    );
    assert.equal(owner.pid, process.pid);
    assert.match(owner.token, /^[0-9a-f]{32}$/u);
  } finally {
    cleanup([base]);
  }
});

test("R18-07: release refuses a foreign lock directory and leaves it intact", () => {
  const base = root();
  const lockDir = path.join(base, "writer.lock");
  try {
    mkdirSync(lockDir); // an external/live holder's lock — never touched by us
    assert.throws(
      () => release(lockDir),
      (err) => err.code === "FILE_LOCK_NOT_OWNER",
      "a lock this process never acquired must not be releasable",
    );
    assert.equal(existsSync(lockDir), true, "the foreign lock must survive");
  } finally {
    cleanup([base]);
  }
});

test("R18-08: a stale holder cannot release the next holder's lock", async () => {
  // Two independent module instances model two processes with distinct
  // token maps. The operator removes holder A's live lock; holder B acquires
  // a fresh lock at the same path; A's `finally` must NOT delete B's lock,
  // because that is how two writers entered the critical section and forked
  // events.jsonl beyond digest-chain recovery.
  const holderB =
    await import("../integrations/openclaw/lib/file-lock.mjs?test-holder=b");
  const base = root();
  const lockDir = path.join(base, "writer.lock");
  try {
    assert.equal(tryAcquire(lockDir), true); // A holds the lock
    rmSync(lockDir, { recursive: true, force: true }); // operator removes it
    assert.equal(holderB.tryAcquire(lockDir), true); // B takes over
    assert.throws(
      () => release(lockDir),
      (err) => err.code === "FILE_LOCK_NOT_OWNER",
      "A's token no longer matches the on-disk owner record",
    );
    assert.equal(
      existsSync(lockDir),
      true,
      "B's lock must still guard the section",
    );
    holderB.release(lockDir); // B releases its own lock normally
    assert.equal(existsSync(lockDir), false);
  } finally {
    cleanup([base]);
  }
});
