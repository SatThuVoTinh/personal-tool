// M12/T9-R4 B6 — F-433 (legacy R9-L06-9).
//
// The Skill Store lock recovery read `owner.json` ONCE, proved THAT holder's
// pid dead, and then unlinked the lock with no re-read. The read is a snapshot,
// not a compare-before-delete: a writer that acquires the lock between the read
// and the removal is erased by the tool while it believes it is protected — two
// writers inside the critical section, which is the failure the owner token
// exists to prevent.
//
// This lane pins the control the acceptance criteria name:
//   1. the record is re-read and compared (token AND pid) immediately before
//      the removal, so a lock that changed hands after the inspection is never
//      deleted - and the record is unchanged when the removal is refused;
//   2. the same snapshot still removes the lock whose record it holds, and the
//      shipped recovery keeps every documented state it had before.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CATALOG_URL = pathToFileURL(
  path.join(REPO, "zink-skill-store", "src", "catalog.mjs"),
).href;
const RECOVERY_URL = pathToFileURL(
  path.join(REPO, "zink-skill-store", "bin", "skill-store-lock-recovery.mjs"),
).href;

const { skillStoreWriterLockDir } = await import(CATALOG_URL);
const { recoverSkillStoreLock, removeOrphanedLock } = await import(
  RECOVERY_URL
);

const DEAD_PID = 2147483646;

async function scratchRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12-t9-f433-"));
  const skillsRoot = path.join(root, "skills");
  const lockDir = skillStoreWriterLockDir(skillsRoot);
  mkdirSync(lockDir, { recursive: true });
  return {
    root,
    skillsRoot,
    lockDir,
    ownerPath: path.join(lockDir, "owner.json"),
  };
}

test("F-433: a lock that changed hands after the inspection is never deleted", async () => {
  const { root, lockDir, ownerPath } = await scratchRoot();
  try {
    // What the scan proved dead.
    const scanned = { pid: DEAD_PID, token: "a".repeat(32) };
    writeFileSync(ownerPath, JSON.stringify(scanned), "utf8");
    const snapshot = JSON.parse(readFileSync(ownerPath, "utf8"));

    // The interleaving: a NEW writer acquires the same lock between the scan
    // and the removal. Its token and pid are both different from the snapshot.
    const acquired = { pid: process.pid, token: "b".repeat(32) };
    writeFileSync(ownerPath, JSON.stringify(acquired), "utf8");

    const refused = removeOrphanedLock(lockDir, snapshot);
    assert.equal(
      refused.removed,
      false,
      "a live lock must survive the removal",
    );
    assert.equal(refused.mutated, false);
    assert.equal(refused.reason, "OWNER_CHANGED_BEFORE_REMOVAL");
    assert.ok(existsSync(lockDir), "the new holder's lock directory must stay");
    assert.deepEqual(
      JSON.parse(readFileSync(ownerPath, "utf8")),
      acquired,
      "the new holder's owner record must be untouched",
    );

    // The same snapshot still removes the lock it actually describes.
    const removed = removeOrphanedLock(lockDir, acquired);
    assert.equal(removed.removed, true);
    assert.equal(removed.reason, null);
    assert.equal(existsSync(lockDir), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-433: the shipped recovery keeps its documented states", async () => {
  const { root, skillsRoot, lockDir, ownerPath } = await scratchRoot();
  try {
    // A live holder is refused, never reclaimed.
    writeFileSync(
      ownerPath,
      JSON.stringify({ pid: process.pid, token: "c".repeat(32) }),
      "utf8",
    );
    const live = recoverSkillStoreLock({ root: skillsRoot });
    assert.equal(live.exitCode, 1);
    assert.equal(live.report.action, "REFUSED_LIVE_HOLDER");
    assert.ok(existsSync(lockDir), "a live holder's lock must survive");

    // An orphaned lock is reported read-only ...
    writeFileSync(
      ownerPath,
      JSON.stringify({ pid: DEAD_PID, token: "d".repeat(32) }),
      "utf8",
    );
    const reported = recoverSkillStoreLock({ root: skillsRoot });
    assert.equal(reported.exitCode, 0);
    assert.equal(reported.report.action, "REPORT");
    assert.equal(reported.report.mutated, false);
    assert.ok(existsSync(lockDir));

    // ... and recovered only with the typed confirmation.
    const recovered = recoverSkillStoreLock({
      root: skillsRoot,
      recover: true,
      confirm: "ORPHAN_LOCK_RECOVERY",
    });
    assert.equal(recovered.exitCode, 0);
    assert.equal(recovered.report.action, "RECOVERED");
    assert.equal(recovered.report.recovered, true);
    assert.equal(existsSync(lockDir), false);

    // An unreadable record is inspected, not reclaimed.
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(ownerPath, "not json", "utf8");
    const malformed = recoverSkillStoreLock({
      root: skillsRoot,
      recover: true,
      confirm: "ORPHAN_LOCK_RECOVERY",
    });
    assert.equal(malformed.exitCode, 1);
    assert.equal(malformed.report.action, "INSPECT");
    assert.equal(malformed.report.reason, "OWNER_ENTRY_UNREADABLE");
    assert.ok(existsSync(lockDir), "an unverifiable lock must survive");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
