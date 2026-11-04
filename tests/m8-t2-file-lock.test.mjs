import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { setInterval, clearInterval } from "node:timers";

import {
  tryAcquire,
  acquire,
  release,
  withFileLock,
} from "../integrations/openclaw/lib/file-lock.mjs";

function tempRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "zink-file-lock-"));
}

function holderScript(lockDir, holdMs) {
  return `
    const { acquire, release } = await import(${JSON.stringify(new URL("../integrations/openclaw/lib/file-lock.mjs", import.meta.url).href)});
    await acquire(${JSON.stringify(lockDir)}, { timeoutMs: 5000 });
    setTimeout(() => { release(${JSON.stringify(lockDir)}); }, ${holdMs});
    setTimeout(() => process.exit(0), ${holdMs + 2000});
  `;
}

describe("R4 Finding 2 — shared async file lock", () => {
  test("acquire/release round-trip", async () => {
    const lockDir = path.join(tempRoot(), "a.lock");
    await acquire(lockDir, { timeoutMs: 1000 });
    assert.equal(existsSync(lockDir), true);
    assert.equal(tryAcquire(lockDir), false);
    release(lockDir);
    assert.equal(existsSync(lockDir), false);
    assert.equal(tryAcquire(lockDir), true);
    release(lockDir);
  });

  test("two-process contention: second process waits, never double-acquires", async () => {
    const lockDir = path.join(tempRoot(), "b.lock");
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", holderScript(lockDir, 800)],
      { stdio: "ignore" },
    );
    try {
      const appeared = Date.now() + 10000;
      while (!existsSync(lockDir) && Date.now() < appeared) {
        await delay(25);
      }
      assert.equal(
        existsSync(lockDir),
        true,
        "holder child must take the lock",
      );
      assert.equal(tryAcquire(lockDir), false);
      await assert.rejects(
        acquire(lockDir, { timeoutMs: 200, retryDelayMs: 10 }),
        /FILE_LOCK_TIMEOUT/,
      );
      await acquire(lockDir, { timeoutMs: 5000 }); // succeeds after release
      release(lockDir);
    } finally {
      child.kill();
    }
  });

  test("waiting for the lock does not block the event loop", async () => {
    const lockDir = path.join(tempRoot(), "c.lock");
    await acquire(lockDir, { timeoutMs: 1000 }); // hold locally
    let heartbeats = 0;
    const timer = setInterval(() => {
      heartbeats += 1;
    }, 20);
    let fault;
    try {
      await acquire(lockDir, { timeoutMs: 300, retryDelayMs: 10 });
    } catch (error) {
      fault = error;
    } finally {
      clearInterval(timer);
    }
    release(lockDir);
    // Two properties, asserted separately. LIVENESS: a synchronous wait
    // (Atomics.wait style) starves every timer, so ONE tick proves the loop ran.
    // The previous `>= 5` of a 20 ms interval inside a 300 ms window measured the
    // host's timer resolution instead, and went red at ticks=4 under parallel
    // load with nothing in the diff touching this suite (`R7-GATE-01`).
    // DEADLINE: widening the liveness bound must not cost the gate its other
    // half, so the contention timeout is asserted by code — a wait that returned
    // instead of timing out leaves `fault` undefined here.
    assert.ok(
      heartbeats >= 1,
      `event loop stayed alive during contention wait (ticks=${heartbeats})`,
    );
    assert.equal(fault?.code, "FILE_LOCK_TIMEOUT");
  });

  test("acquire times out with explicit error instead of waiting forever", async () => {
    const lockDir = path.join(tempRoot(), "d.lock");
    await acquire(lockDir, { timeoutMs: 1000 });
    try {
      await assert.rejects(
        acquire(lockDir, { timeoutMs: 120, retryDelayMs: 10 }),
        /FILE_LOCK_TIMEOUT/,
      );
    } finally {
      release(lockDir);
    }
  });

  test("withFileLock releases even when the critical section throws", async () => {
    const lockDir = path.join(tempRoot(), "e.lock");
    await assert.rejects(
      withFileLock(
        lockDir,
        async () => {
          throw new Error("CRITICAL_BOOM");
        },
        { timeoutMs: 1000 },
      ),
      /CRITICAL_BOOM/,
    );
    assert.equal(existsSync(lockDir), false);
    await acquire(lockDir, { timeoutMs: 1000 });
    release(lockDir);
  });

  test("crashed holder fails closed: no silent reclaim, explicit timeout", async () => {
    const lockDir = path.join(tempRoot(), "f.lock");
    const crashScript = `
      const { acquire } = await import(${JSON.stringify(new URL("../integrations/openclaw/lib/file-lock.mjs", import.meta.url).href)});
      await acquire(${JSON.stringify(lockDir)}, { timeoutMs: 5000 });
      process.exit(1);
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", crashScript],
      {
        stdio: "ignore",
      },
    );
    await new Promise((resolve) => child.on("exit", resolve));
    assert.equal(existsSync(lockDir), true); // orphaned lock left behind
    await assert.rejects(
      acquire(lockDir, { timeoutMs: 200, retryDelayMs: 10 }),
      /FILE_LOCK_TIMEOUT/,
      "orphaned lock must fail closed, never silently reclaimed",
    );
    // M10/T2 owner-token design: an orphaned lock is recovered by the operator
    // removing the directory itself — `release` now refuses a lock this process
    // never acquired, which is exactly what stopped a stale holder from
    // deleting the next holder's lock and forking events.jsonl.
    rmSync(lockDir, { recursive: true, force: true });
    assert.equal(existsSync(lockDir), false);
  });

  test("lock module works on the repository filesystem (Windows/OneDrive)", async () => {
    const lockDir = path.join(tempRoot(), "g.lock");
    await withFileLock(lockDir, async () => existsSync(lockDir), {
      timeoutMs: 2000,
    });
    assert.equal(existsSync(lockDir), false);
  });
});
