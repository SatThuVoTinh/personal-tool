/**
 * Shared asynchronous cross-process file lock.
 *
 * Design (R4 Finding 2):
 * - Mutual exclusion via atomic directory creation (`mkdir`, mode 0o700).
 *   `EEXIST` means another process holds the lock — never double-acquire.
 * - Waiting is fully asynchronous (`setTimeout` between attempts): the event
 *   loop is never blocked while contending for the lock.
 * - Bounded: `acquire` throws an explicit timeout error after `timeoutMs`
 *   (default 5000ms, matching the pre-existing governance lock deadline).
 * - Release-safe: `withFileLock` releases in `finally`, including on throw.
 * - Crash-safe by fail-closed design: a crashed holder leaves the lock
 *   directory behind and the next acquirer times out with an explicit error.
 *   There is intentionally NO age-based stale-lock reclaim — reclaiming could
 *   let two processes enter the critical section together. Recovery of an
 *   orphaned lock is an explicit operator action, not an automatic heuristic.
 *
 * Adoption (M7-065/R4): the three call sites that each carried their own
 * inline retry loop now use this module — the ledger writer lock
 * (`topology/lib/ledger.mjs`), the guard lock (`topology/lib/guard.mjs`) and the
 * queue lock (`lib/queue-manager.mjs`). Each previously retried for up to 5000ms
 * using `Atomics.wait`, which blocked the Node event loop. The sync half used by
 * those sites (`withFileLockSync`) therefore makes exactly ONE atomic
 * acquisition attempt and throws `FILE_LOCK_BUSY` immediately; the caller
 * retries at a higher async boundary. That is a deliberate behavior change: it
 * removes the multi-second event-loop stall, and it is the reason the async
 * half exists alongside the sync half.
 */

import { mkdirSync, rmdirSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const DEFAULT_LOCK_TIMEOUT_MS = 5000;
export const DEFAULT_LOCK_RETRY_DELAY_MS = 10;
export const LOCK_MODE = 0o700;

function normalizeLockDir(lockDir) {
  if (typeof lockDir !== "string" || lockDir.length === 0) {
    throw new Error("FILE_LOCK_PATH_REQUIRED");
  }
  return lockDir;
}

/**
 * Single non-blocking acquisition attempt.
 * @returns true when the lock was acquired, false when held elsewhere.
 * @throws on unexpected filesystem errors (e.g. permission denied).
 */
export function tryAcquire(lockDir) {
  const dir = normalizeLockDir(lockDir);
  try {
    mkdirSync(dir, { mode: LOCK_MODE });
    return true;
  } catch (err) {
    if (err?.code === "EEXIST") return false;
    throw err;
  }
}

/**
 * Release a lock held by this process. Never throws for a missing lock.
 */
export function release(lockDir) {
  const dir = normalizeLockDir(lockDir);
  try {
    rmdirSync(dir);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
}

/**
 * Asynchronously acquire the lock, retrying without blocking the event loop.
 * @throws {Error} FILE_LOCK_TIMEOUT after `timeoutMs` (cause = last error).
 */
export async function acquire(lockDir, options = {}) {
  const dir = normalizeLockDir(lockDir);
  const timeoutMs =
    Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_LOCK_TIMEOUT_MS;
  const retryDelayMs =
    Number.isSafeInteger(options.retryDelayMs) && options.retryDelayMs >= 0
      ? options.retryDelayMs
      : DEFAULT_LOCK_RETRY_DELAY_MS;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  for (;;) {
    try {
      if (tryAcquire(dir)) return;
    } catch (err) {
      lastError = err;
      break;
    }
    if (Date.now() >= deadline) break;
    await delay(retryDelayMs);
  }
  throw new Error(`FILE_LOCK_TIMEOUT: failed to acquire lock at ${dir}`, {
    cause: lastError,
  });
}

/**
 * Acquire, run `fn`, and always release — including when `fn` throws.
 * Resolves with `fn`'s return value; rejects with `fn`'s error or timeout.
 */
export async function withFileLock(lockDir, fn, options = {}) {
  const dir = normalizeLockDir(lockDir);
  await acquire(dir, options);
  try {
    return await fn();
  } finally {
    release(dir);
  }
}

/**
 * Derive the lock directory for a storage/ledger root. Shared convention so
 * migrated call sites cannot accidentally use divergent lock paths.
 */
export function lockDirFor(rootPath, name = "writer.lock") {
  if (typeof rootPath !== "string" || rootPath.length === 0) {
    throw new Error("FILE_LOCK_ROOT_REQUIRED");
  }
  return path.join(rootPath, name);
}

/**
 * Synchronous single-attempt compatibility seam for frozen M7 sync contracts.
 *
 * Performs exactly one atomic mkdir acquisition attempt; contention immediately
 * throws FILE_LOCK_BUSY instead of sleeping. Callback/business errors are
 * propagated unchanged; only lock acquisition failures are translated.
 * Never blocks the event loop with Atomics.wait.
 */
export function withFileLockSync(lockDir, fn) {
  const dir = normalizeLockDir(lockDir);
  try {
    mkdirSync(dir, { mode: LOCK_MODE });
  } catch (err) {
    if (err?.code === "EEXIST") {
      const busy = new Error(`FILE_LOCK_BUSY: lock held at ${dir}`, {
        cause: err,
      });
      busy.code = "FILE_LOCK_BUSY";
      throw busy;
    }
    throw err;
  }
  try {
    return fn();
  } finally {
    release(dir);
  }
}
