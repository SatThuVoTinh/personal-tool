// M12/T2.2-R1 A-3 — the queue's durable writer must be serialized by the
// caller that owns the mutation (`R6-A03-01`).
//
// What this item first claimed was wrong: `queue-manager.mjs:200-247` and
// `decision-ledger.mjs:238-290` already write temp -> fsync -> close -> rename
// -> parent-dir fsync, so there was no in-place rewrite to convert. What is
// true, and what is fixed here, is that `QueueManager.save()` does NOT acquire
// the cross-process queue lock — serialization belongs to the caller, via
// `withLock()`, which reloads the projection from disk before running its body.
// One shipped caller skipped it: `index.mjs:recordCoordinatorNotification` set
// `defaultQueueManager.queue` and called `save()` directly, projecting a stale
// whole-document map over one the four concurrent pickup loops also write.
//
// Why the fix is the call site and not `save()`: `tryAcquire()` is
// `mkdirSync` + `EEXIST` -> false (`file-lock.mjs:112-115`), so the lock is NOT
// reentrant. Making `save()` lock itself would make every existing
// `withLock(() => { … save() })` path — `enqueueTask`, `claimTaskById`,
// `completeTask` and the rest — deadlock against its own lock. The last test
// pins that fact so nobody "finishes" this fix that way.
process.env.ZINK_ROUTER_HOST ||= "router.invalid";
process.env.ZINK_ROUTER_PORT ||= "1";
process.env.ZINK_ROUTER_API_KEY ||= "test-router-key-not-a-credential";

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { QueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";

const PLUGIN_SOURCE = fs.readFileSync(
  new URL(
    "../integrations/openclaw/plugins/zink-governance/index.mjs",
    import.meta.url,
  ),
  "utf8",
);
const QUEUE_SOURCE = fs.readFileSync(
  new URL("../integrations/openclaw/lib/queue-manager.mjs", import.meta.url),
  "utf8",
);

/**
 * Extract one brace-balanced body starting at `fromIndex`, so a pin can talk
 * about a single function instead of a line window. Scanning starts after the
 * signature's `) {`, because a destructured parameter object (`fn({ a, b }) {`)
 * would otherwise be taken as the body. Every function used here is
 * brace-balanced in source, so the count is exact.
 */
function balancedBody(source, fromIndex) {
  const signatureEnd = source.indexOf(") {", fromIndex);
  const open =
    signatureEnd === -1 ? source.indexOf("{", fromIndex) : signatureEnd + 2;
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(fromIndex, i + 1);
    }
  }
  return source.slice(fromIndex);
}

function tempStorage(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `a3-queue-${name}-`));
  return path.join(dir, "queue.json");
}

/** Enqueue one real, schema-valid task through the class's own locked path. */
function seed(storagePath, taskId) {
  const writer = new QueueManager({ storagePath });
  writer.enqueueTask({
    taskId,
    primaryCoordinator: "o1",
    requiredCapabilities: ["excel"],
    payload: { note: `seed ${taskId}` },
  });
}

/**
 * A second real row, under a different identity. `load()` keys the projection by
 * `item.taskId` rather than by the map key, so changing only the key would
 * collapse both entries into one on reload and the test would prove nothing.
 */
function rowLike(item, taskId) {
  // JSON round-trip rather than `structuredClone`: the eslint globals list this
  // repository configures does not include it, and queue rows are plain JSON.
  const copy = JSON.parse(JSON.stringify(item));
  copy.taskId = taskId;
  return copy;
}

/**
 * Drop comment lines from an extracted body. Without this, a WHY comment that
 * mentions the API it is explaining (`save()` appears in one) reads as code to
 * the ordering checks below.
 */
function codeOnly(body) {
  return body
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
    .join("\n");
}

// ===========================================================================
// The mechanism, on the real class and the real file
// ===========================================================================

test("A-3: an unlocked set+save from a stale instance erases a task another writer committed", () => {
  const storagePath = tempStorage("unlocked");
  seed(storagePath, "t-first");
  // Snapshot taken before the next commit, and never reloaded — the state a
  // long-lived plugin instance is in between locked calls.
  const stale = new QueueManager({ storagePath });
  assert.equal(stale.queue.size, 1);
  seed(storagePath, "t-second");

  // Exactly what `recordCoordinatorNotification` used to do: mutate the map,
  // then save it.
  stale.queue.set("t-third", rowLike(stale.getTask("t-first"), "t-third"));
  stale.save();

  const after = new QueueManager({ storagePath });
  assert.notEqual(
    after.getTask("t-third"),
    null,
    "the stale writer's own row did land",
  );
  assert.equal(
    after.getTask("t-second"),
    null,
    "save() projects the whole in-memory map, so a row committed after the snapshot is erased — this is the defect",
  );
});

test("A-3: the same mutation through withLock survives, because withLock reloads before its body", () => {
  const storagePath = tempStorage("locked");
  seed(storagePath, "t-first");
  const stale = new QueueManager({ storagePath });
  seed(storagePath, "t-second");

  stale.withLock(() => {
    stale.queue.set("t-third", rowLike(stale.getTask("t-first"), "t-third"));
    stale.save();
  });

  const after = new QueueManager({ storagePath });
  assert.notEqual(after.getTask("t-third"), null, "the caller's row landed");
  assert.notEqual(
    after.getTask("t-second"),
    null,
    "withLock re-read the document first, so the other writer's committed row is still there",
  );
});

// ===========================================================================
// The call site that skipped the lock
// ===========================================================================

test("A-3: recordCoordinatorNotification mutates the queue projection inside the queue lock", () => {
  const declAt = PLUGIN_SOURCE.indexOf(
    "function recordCoordinatorNotification(",
  );
  assert.notEqual(
    declAt,
    -1,
    "the notification persistence seam must still exist",
  );
  const body = codeOnly(balancedBody(PLUGIN_SOURCE, declAt));

  assert.match(
    body,
    /defaultQueueManager\.withLock\(\(\) =>/u,
    "the queue projection write must run inside withLock, the class's own critical section",
  );
  // The read must be inside too. Reading the item before taking the lock is how
  // the mutation ended up applied to a copy the lock has since replaced.
  const lockAt = body.indexOf("defaultQueueManager.withLock(");
  const readAt = body.indexOf("getTask(taskId)");
  assert.notEqual(readAt, -1, "the projection read must still happen");
  assert.ok(
    readAt > lockAt,
    "getTask must be called after the lock is held, or the caller still projects a stale copy",
  );
  assert.ok(
    body.indexOf("defaultQueueManager.save()") > lockAt,
    "the durable write must be inside the critical section",
  );
});

test("A-3: contention and storage failure stay returned failures at that seam, not throws", () => {
  // The pre-existing contract of this seam is `{ ok, error }`: `persist` callers
  // treat notification evidence as reconciliation material, not authority
  // (index.mjs:5635-5637). `withLock` turns FILE_LOCK_BUSY into a thrown
  // QUEUE_LOCK_TIMEOUT (queue-manager.mjs:153-159), so the seam must keep
  // converting failure into a returned value instead of adding a new way for
  // the dispatch path to blow up.
  const declAt = PLUGIN_SOURCE.indexOf(
    "function recordCoordinatorNotification(",
  );
  const body = balancedBody(PLUGIN_SOURCE, declAt);
  assert.match(
    body,
    /catch\s*\(/u,
    "lock contention and storage failures must be caught and returned, as the save-failure path already did",
  );
  assert.match(
    body,
    /ok:\s*false/u,
    "the failure shape the callers already handle must be preserved",
  );
});

// ===========================================================================
// The trap that must stay closed
// ===========================================================================

test("A-3 pin: QueueManager.save() must NOT acquire the queue lock itself — the lock is not reentrant", () => {
  const saveAt = QUEUE_SOURCE.indexOf("  save() {");
  assert.notEqual(saveAt, -1, "save() must still exist");
  assert.doesNotMatch(
    balancedBody(QUEUE_SOURCE, saveAt),
    /withFileLockSync|tryAcquire/u,
    "save() must stay lock-free: every locked mutator calls it from inside withLock, and a self-locking save would deadlock the queue",
  );

  // Executable half: the lock really is non-reentrant, which is why a
  // self-locking `save()` is not an available fix.
  const storagePath = tempStorage("nested");
  const manager = new QueueManager({ storagePath });
  manager.enqueueTask({
    taskId: "t-one-lock",
    primaryCoordinator: "o2",
    requiredCapabilities: ["power-bi"],
  });
  assert.notEqual(
    new QueueManager({ storagePath }).getTask("t-one-lock"),
    null,
    "a single locked mutator completes: withLock holds the lock, save() writes inside it",
  );
  assert.throws(
    () => manager.withLock(() => manager.withLock(() => "never")),
    /QUEUE_LOCK_TIMEOUT/u,
    "acquiring the queue lock twice in one process must fail, so save() can never lock itself",
  );
});
