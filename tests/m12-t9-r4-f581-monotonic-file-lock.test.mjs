/**
 * M12/T9-R4 F-581 (R10-T12-6) — L5 lane.
 *
 * The file-lock acquire deadline and the release busy-spin were computed from
 * `Date.now()`, which is not monotonic: a forward wall-clock step truncates the
 * governed budget (spurious FILE_LOCK_TIMEOUT while the real budget remains)
 * and a backward step silently extends it. The repo's own Python child already
 * treats monotonic time as the correct source; these tests pin the JS seam.
 *
 * Two controls:
 *  1. behavioural — a simulated forward wall-clock step must NOT truncate an
 *     acquire whose monotonic budget remains;
 *  2. gate — `file-lock.mjs` computes no deadline from the wall clock (scoped:
 *     this module has no legitimate expiry-timestamp arithmetic; the 7
 *     legitimate `Date.now() +` sites named by the register live in other
 *     files, e.g. the queue lease-expiry stamps, which are wall-clock
 *     timestamps by contract and out of this gate's scope).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { acquire, release } from "../integrations/openclaw/lib/file-lock.mjs";

const FILE_LOCK_SOURCE = fileURLToPath(
  new URL("../integrations/openclaw/lib/file-lock.mjs", import.meta.url),
);

test("F-581: a forward wall-clock step does not truncate the acquire budget", async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zink-f581-"));
  const lockDir = path.join(scratch, "writer.lock");
  const realNow = Date.now;
  let acquired = false;
  try {
    // A foreign holder owns the lock: acquire() must keep retrying inside its
    // monotonic budget instead of giving up.
    fs.mkdirSync(lockDir);

    const pending = acquire(lockDir, { timeoutMs: 2000, retryDelayMs: 5 }).then(
      () => {
        acquired = true;
        return "acquired";
      },
      (err) => err,
    );

    await new Promise((resolve) => setTimeout(resolve, 40));

    // Simulated forward wall-clock step: +60s, far past the 2000ms budget. A
    // Date.now()-derived deadline breaks out of the loop here and reports a
    // spurious FILE_LOCK_TIMEOUT; a monotonic deadline ignores the step.
    Date.now = () => realNow() + 60_000;
    try {
      await new Promise((resolve) => setTimeout(resolve, 40));
      // The foreign holder releases; the monotonic budget is still intact, so
      // the waiter must take the lock.
      fs.rmdirSync(lockDir);
      const outcome = await pending;
      assert.equal(
        outcome,
        "acquired",
        `acquire must survive the clock step; got ${outcome?.code ?? outcome}`,
      );
      assert.ok(acquired, "the lock was acquired within the monotonic budget");
      assert.ok(
        fs.existsSync(lockDir),
        "the acquirer now holds the lock directory",
      );
    } finally {
      Date.now = realNow;
    }
    release(lockDir);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("F-581 gate: file-lock.mjs derives no deadline from Date.now()", () => {
  const source = fs.readFileSync(FILE_LOCK_SOURCE, "utf8");
  const offenders = source
    .split("\n")
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter(({ text }) => /Date\.now\(\)/u.test(text))
    .map(({ line, text }) => `${line}: ${text}`);
  assert.deepEqual(
    offenders,
    [],
    "every deadline/backoff in file-lock.mjs must use the monotonic clock (performance.now())",
  );
});
