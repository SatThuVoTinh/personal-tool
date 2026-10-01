import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  withFileLockSync,
  lockDirFor,
} from "../integrations/openclaw/lib/file-lock.mjs";

describe("M7-065 / R4-LOCK-PRIMITIVE — no blocking wait loop", () => {
  it("contended withFileLockSync fails fast with FILE_LOCK_BUSY (<100ms)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "r4-lock-"));
    const lockDir = lockDirFor(root, "writer.lock");
    mkdirSync(lockDir);
    const start = Date.now();
    assert.throws(() => withFileLockSync(lockDir, () => "should-not-run"), {
      code: "FILE_LOCK_BUSY",
    });
    assert.ok(
      Date.now() - start < 100,
      `contention must fail in <100ms, took ${Date.now() - start}ms`,
    );
  });

  it("callback errors propagate unchanged, only lock failures translate", () => {
    const root = mkdtempSync(path.join(tmpdir(), "r4-lock-"));
    const lockDir = lockDirFor(root, "writer.lock");
    assert.throws(
      () =>
        withFileLockSync(lockDir, () => {
          const err = new Error("BUSINESS_FAILURE");
          err.code = "BUSINESS_FAILURE";
          throw err;
        }),
      { code: "BUSINESS_FAILURE" },
    );
  });

  it("QueueManager contention surfaces QUEUE_LOCK_TIMEOUT fast", async () => {
    const { QueueManager } =
      await import("../integrations/openclaw/lib/queue-manager.mjs");
    const dir = mkdtempSync(path.join(tmpdir(), "r4-qm-"));
    const storagePath = path.join(dir, "task-queue.json");
    const qm = new QueueManager({ storagePath });
    const lockDir = lockDirFor(dir, "task-queue.json.lock");
    mkdirSync(lockDir);
    const start = Date.now();
    assert.throws(() => qm.withLock(() => "x"), /QUEUE_LOCK_TIMEOUT/);
    assert.ok(Date.now() - start < 1000, "queue contention must not block");
  });

  it("no Atomics.wait remains on live QueueManager/ledger/guard paths", () => {
    for (const file of [
      "../integrations/openclaw/lib/queue-manager.mjs",
      "../integrations/openclaw/topology/lib/ledger.mjs",
      "../integrations/openclaw/topology/lib/guard.mjs",
    ]) {
      const url = new URL(file, import.meta.url);
      const src = readFileSync(url, "utf8");
      assert.ok(
        !src.includes("Atomics.wait"),
        `${file} must not contain a blocking wait loop`,
      );
    }
  });

  it("governance plugin materializes file-lock.mjs", async () => {
    const { governancePluginFiles } =
      await import("../integrations/openclaw/lib/policy.mjs");
    const { assets } = governancePluginFiles();
    assert.ok(
      typeof assets["lib/file-lock.mjs"] === "string" &&
        assets["lib/file-lock.mjs"].includes("withFileLockSync"),
      "plugin must materialize the shared lock primitive",
    );
  });
});
