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

import {
  existsSync,
  mkdirSync,
  rmdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";

export const DEFAULT_LOCK_TIMEOUT_MS = 5000;
export const DEFAULT_LOCK_RETRY_DELAY_MS = 10;
export const LOCK_MODE = 0o700;
/**
 * M10/T2-R18: release is retried a bounded number of times, and only for
 * errnos that mean "someone is briefly holding a handle", never for a genuine
 * permission fault. See `release`.
 */
export const RELEASE_RETRY_ATTEMPTS = 5;
// ENOTEMPTY belongs here: on Windows a directory whose just-deleted file still
// has a pending handle reports the removal as "directory not empty".
// ESTALE and EIO belong here too: the live runtime is WSL, and drvfs/9p answer
// a removal that is about to succeed with one of those two.
const RETRYABLE_RELEASE_ERRNOS = new Set([
  "EPERM",
  "EACCES",
  "EBUSY",
  "ENOTEMPTY",
  "ESTALE",
  "EIO",
]);

function busyWaitMs(ms) {
  // M12/T9 F-581 (R10-T12-6): the spin budget is monotonic. Wall-clock time is
  // not monotonic: a forward clock step truncated the wait and a backward step
  // extended it, and this module's own Python-child precedent (the ocr.py
  // deadline arms) already treats monotonic time as the correct source.
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // bounded spin — the total budget below is 15 ms, two orders of magnitude
    // under the event-loop stall this module was introduced to remove
  }
}
/**
 * M10/T2 owner-token decision (owner-authorized): every lock this protocol
 * acquires carries `owner.json` inside the lock directory, holding a random
 * per-acquisition token registered in this process. `release` only removes a
 * lock whose on-disk token matches the one this process recorded. Without
 * this, an operator removing a live holder's lock let the holder's `finally`
 * delete the NEXT holder's lock directory, putting two writers inside the
 * critical section and forking `events.jsonl` beyond digest-chain recovery.
 */
export const LOCK_OWNER_FILE = "owner.json";

/**
 * M12/T9 F-058: the holder registry is PROCESS-GLOBAL, not per module instance.
 *
 * The Skill Store imports this module by relative path
 * (`zink-skill-store/src/catalog.mjs` -> `../../integrations/openclaw/lib/file-lock.mjs`)
 * while the packaged plugin loads its own copy at a different URL
 * (`<plugin>/lib/file-lock.mjs`). Two ESM instances of the same source are two
 * modules, so a per-instance `heldTokens` map meant `ownsRecordedLock()` was
 * false across instances: the releasing instance did not recognise the token it
 * had acquired, refused the release with FILE_LOCK_NOT_OWNER, and the error was
 * swallowed by `withFileLock`'s `finally` - so the lock directory stayed behind
 * and every later writer hit FILE_LOCK_BUSY. That is the orphan-lock/outage
 * class this registry exists to prevent.
 *
 * `Symbol.for` gives one key across every realm and every copy of this module,
 * and `globalThis` gives one holder map per PROCESS. The registry is keyed by
 * the lock directory, which is the same path string in both copies, so the
 * token recorded by one instance is the token the other instance can verify.
 */
const HELD_TOKENS_KEY = Symbol.for("zink.file-lock.heldTokens");
const heldTokens = (globalThis[HELD_TOKENS_KEY] ??= new Map());

/**
 * M12/T9 F-058: the token THIS instance recorded for a lock directory.
 *
 * The process-wide registry above answers "does this PROCESS hold this
 * lock?", which is what a second loaded copy of this module needs: the copy
 * that releases a lock the other copy acquired must be able to verify the
 * on-disk token. It cannot answer "did THIS holder record this token?", and
 * that is the question the owner-token protocol exists for. After an operator
 * removes a live holder's lock directory and another holder takes the same
 * path, the first holder's `finally` must NOT delete the second holder's lock
 * directory - that is how two writers enter the critical section and fork the
 * event chain beyond digest-chain recovery.
 *
 * So every instance keeps its OWN record, and the process registry is the
 * fallback for an instance that never acquired the lock itself.
 */
const instanceTokens = new Map();

function normalizeLockDir(lockDir) {
  if (typeof lockDir !== "string" || lockDir.length === 0) {
    throw new Error("FILE_LOCK_PATH_REQUIRED");
  }
  return lockDir;
}

function ownerFileFor(dir) {
  return path.join(dir, LOCK_OWNER_FILE);
}

function notOwnerError(dir, reason) {
  const error = new Error(
    `FILE_LOCK_NOT_OWNER: refusing to release ${dir} (${reason})`,
  );
  error.code = "FILE_LOCK_NOT_OWNER";
  return error;
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
  } catch (err) {
    if (err?.code === "EEXIST") return false;
    throw err;
  }
  const token = randomBytes(16).toString("hex");
  try {
    writeFileSync(
      ownerFileFor(dir),
      JSON.stringify({ pid: process.pid, token }),
      {
        mode: LOCK_MODE,
      },
    );
  } catch (err) {
    // The lock exists but is unverifiable; leaving it would strand every
    // future release behind FILE_LOCK_NOT_OWNER, so unwind and rethrow.
    try {
      rmdirSync(dir);
    } catch {
      /* best-effort unwind */
    }
    throw err;
  }
  instanceTokens.set(dir, token);
  heldTokens.set(dir, token);
  return true;
}

/**
 * The owner-token half of `release`, shared with `releaseAsync`: this process
 * must have recorded the token and the on-disk record must still match it.
 * @returns false when there is nothing to release (no lock present).
 */
function ownsRecordedLock(dir) {
  // This instance's own record wins: it is the only answer to "did THIS
  // holder record this token?". The process-wide registry is the fallback for
  // an instance that never acquired the lock itself - the second loaded copy
  // of this module (M12/T9 F-058).
  const expected = instanceTokens.get(dir) ?? heldTokens.get(dir);
  if (expected === undefined) {
    if (!existsSync(dir)) {
      return false; // idempotent no-op for an absent lock
    }
    throw notOwnerError(dir, "this process never acquired it");
  }
  let recorded;
  try {
    recorded = JSON.parse(readFileSync(ownerFileFor(dir), "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw notOwnerError(dir, `no ${LOCK_OWNER_FILE} present`);
    }
    throw notOwnerError(dir, "owner record is unreadable");
  }
  if (recorded?.token !== expected) {
    throw notOwnerError(dir, "a different holder owns it now");
  }
  return true;
}

/**
 * One unlink+rmdir round, returned as a verdict so the synchronous and
 * asynchronous releases apply exactly the same errno policy rather than each
 * restating it.
 */
function removalRound(dir) {
  try {
    unlinkSync(ownerFileFor(dir));
  } catch (err) {
    if (
      err?.code !== "ENOENT" &&
      !RETRYABLE_RELEASE_ERRNOS.has(err?.code ?? "")
    ) {
      return { fatal: err };
    }
  }
  try {
    rmdirSync(dir);
    return { released: true };
  } catch (err) {
    if (err?.code === "ENOENT") return { released: true }; // already released
    if (!RETRYABLE_RELEASE_ERRNOS.has(err?.code ?? "")) {
      return { fatal: err };
    }
    return { retry: err };
  }
}

/**
 * Release a lock held by this process. Never throws for a missing lock.
 * Throws FILE_LOCK_NOT_OWNER when the lock at `dir` was not acquired by this
 * process under the owner-token protocol — including a lock whose directory
 * was removed and re-created by another holder in the meantime.
 *
 * M10/T2-R18: bounded retry. `rmdirSync` takes no retry budget of its own, and
 * on Windows a directory that was just created can transiently refuse removal
 * while a sync client or scanner holds a handle to it (EPERM/EACCES/
 * EBUSY/ENOTEMPTY), while WSL drvfs/9p answers ESTALE or EIO. A single transient
 * refusal must not become a permanent lockout of the ledger, the queue and the
 * decision ledger. unlink+rmdir are attempted as ONE unit per retry round with a
 * small geometric backoff: removing owner.json leaves a pending-delete handle on
 * Windows, so the very next `rmdirSync` transiently answers EPERM/ENOTEMPTY —
 * without the backoff every second acquire at the same path then hit
 * FILE_LOCK_BUSY on a stranded empty directory.
 *
 * This half SPINS between rounds (`busyWaitMs`); it exists for the synchronous
 * seams. `withFileLock` must use `releaseAsync` instead, so the async seam never
 * blocks the event loop it promised not to block.
 */
export function release(lockDir) {
  const dir = normalizeLockDir(lockDir);
  if (!ownsRecordedLock(dir)) return;
  let lastError = null;
  for (let attempt = 0; attempt < RELEASE_RETRY_ATTEMPTS; attempt++) {
    const round = removalRound(dir);
    if (round.released) {
      instanceTokens.delete(dir);
      heldTokens.delete(dir);
      return;
    }
    lastError = round.fatal ?? round.retry;
    if (round.fatal) break;
    if (attempt + 1 < RELEASE_RETRY_ATTEMPTS) busyWaitMs(1 << attempt);
  }
  // M11/T3 B1: an exhausted budget must not leave the token registered. A stale
  // in-process token survives into the next acquisition of the same path, whose
  // release then deletes whichever lock is present — two writers inside the
  // critical section, which is exactly what the owner token exists to prevent.
  instanceTokens.delete(dir);
  heldTokens.delete(dir);
  throw lastError ?? notOwnerError(dir, "lock directory could not be removed");
}

/**
 * The asynchronous half of `release`: identical ownership validation, identical
 * errno policy and attempt count, but the backoff between rounds is awaited
 * instead of spun, so a contended release cannot stall the event loop the
 * module header promises never to block.
 */
export async function releaseAsync(lockDir) {
  const dir = normalizeLockDir(lockDir);
  if (!ownsRecordedLock(dir)) return;
  let lastError = null;
  for (let attempt = 0; attempt < RELEASE_RETRY_ATTEMPTS; attempt++) {
    const round = removalRound(dir);
    if (round.released) {
      instanceTokens.delete(dir);
      heldTokens.delete(dir);
      return;
    }
    lastError = round.fatal ?? round.retry;
    if (round.fatal) break;
    if (attempt + 1 < RELEASE_RETRY_ATTEMPTS) await delay(1 << attempt);
  }
  instanceTokens.delete(dir);
  heldTokens.delete(dir);
  throw lastError ?? notOwnerError(dir, "lock directory could not be removed");
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
  // M12/T9 F-581 (R10-T12-6): the acquire deadline is monotonic, so a wall-clock
  // step can neither truncate the governed budget (spurious FILE_LOCK_TIMEOUT
  // after one attempt) nor silently extend it.
  const deadline = performance.now() + timeoutMs;
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
    if (performance.now() >= deadline) break;
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
  //
  // M11/T3 B1: the release must be the asynchronous half. The sync `release`
  // spins in `busyWaitMs` between retry rounds, which contradicts this module's
  // own header promise that waiting is fully asynchronous.
  let result;
  let failure = null;
  try {
    result = await fn();
  } catch (err) {
    failure = err;
  } finally {
    try {
      await releaseAsync(dir);
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
  // M10/T2 owner token: acquisition must go through `tryAcquire` so the lock
  // is registered with its token; an inline `mkdirSync` here left the lock
  // unverifiable and every subsequent release was refused as foreign.
  if (!tryAcquire(dir)) {
    const busy = new Error(`FILE_LOCK_BUSY: lock held at ${dir}`);
    busy.code = "FILE_LOCK_BUSY";
    throw busy;
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
