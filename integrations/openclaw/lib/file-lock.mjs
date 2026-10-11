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
/**
 * M10/T2-R18: release is retried a bounded number of times, and only for
 * errnos that mean "someone is briefly holding a handle", never for a genuine
 * permission fault. See `release`.
 */
export const RELEASE_RETRY_ATTEMPTS = 5;
const RETRYABLE_RELEASE_ERRNOS = new Set(["EPERM", "EACCES", "EBUSY"]);

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
  // M10/T2-R18: bounded retry. `rmdirSync` takes no retry budget of its own, and
  // on Windows a directory that was just created can transiently refuse removal
  // while a sync client or scanner holds a handle to it (EPERM/EACCES/
  // EBUSY). A single transient refusal must not become a permanent lockout of
  // the ledger, the queue and the decision ledger.
  let lastError = null;
  for (let attempt = 0; attempt < RELEASE_RETRY_ATTEMPTS; attempt++) {
    try {
      rmdirSync(dir);
      return;
    } catch (err) {
      if (err?.code === "ENOENT") return; // already released
      lastError = err;
      if (!RETRYABLE_RELEASE_ERRNOS.has(err?.code ?? "")) break;
      // Synchronous sleep-free backoff: a tight loop is fine here because the
      // window is a few milliseconds and the alternative is event-loop blocking.
    }
  }
  throw lastError;
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
  // M10/T2-R18: only EEXIST means "held". `tryAcquire` already converts EEXIST
  // to `false`, so anything it THROWS is a real filesystem failure (ENOSPC,
  // EACCES, EPERM...). Retrying cannot fix those, and relabelling them as a
  // timeout hides the cause behind an error that carries no `.code` — so every
  // caller that classifies on `err?.code === "FILE_LOCK_BUSY"` silently
  // misdiagnoses a permanent fault as transient contention. It therefore
  // propagates unchanged instead of being converted to FILE_LOCK_TIMEOUT.
  for (;;) {
    if (tryAcquire(dir)) return;
    if (Date.now() >= deadline) break;
    await delay(retryDelayMs);
  }
  const timeout = new Error(
    `FILE_LOCK_TIMEOUT: failed to acquire lock at ${dir}`,
    {
      cause: lastError,
    },
  );
  timeout.code = "FILE_LOCK_TIMEOUT";
  throw timeout;
}

/**
 * Acquire, run `fn`, and always release — including when `fn` throws.
 * Resolves with `fn`'s return value; rejects with `fn`'s error or timeout.
 */
export async function withFileLock(lockDir, fn, options = {}) {
  const dir = normalizeLockDir(lockDir);
  await acquire(dir, options);
  // M10/T2-R18: same semantics as the sync seam — a failing release must not
  // replace the guarded call's own outcome, and a committed result is never
  // converted into a thrown error.
  let result;
  let failure = null;
  try {
    result = await fn();
  } catch (err) {
    failure = err;
  } finally {
    try {
      release(dir);
    } catch (releaseErr) {
      if (failure) releaseErr.cause = failure;
    }
  }
  if (failure) throw failure;
  return result;
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
  // M10/T2-R18: `fn`'s outcome must survive a failing release.
  //
  // `try { return fn() } finally { release(dir) }` means a release error
  // REPLACES the value `fn()` already returned, so an event that was appended
  // and fsynced is reported to the caller as a failure — the ledger, the queue
  // and the decision ledger all take a durable commit and treat it as rejected.
  // Retrying that is what duplicates work.
  //
  // Semantics chosen deliberately:
  // - `fn` threw  -> re-throw `fn`'s error. That diagnostic is what tells the
  //   operator whether a commit partially applied; the release error is attached
  //   as `cause` rather than replacing it.
  // - `fn` succeeded -> return its result. A stranded lock directory is NOT
  //   silent: the very next acquirer fails loudly with FILE_LOCK_BUSY, which is
  //   the documented operator-recovery path. Converting a committed write into a
  //   thrown error is strictly worse than a detectable lockout, because it
  //   invites the caller to repeat work that already landed.
  let result;
  let failure = null;
  try {
    result = fn();
  } catch (err) {
    failure = err;
  } finally {
    try {
      release(dir);
    } catch (releaseErr) {
      if (failure) releaseErr.cause = failure;
    }
  }
  if (failure) throw failure;
  return result;
}
