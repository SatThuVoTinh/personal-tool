// M12/T9-R4 B6 — F-432 (legacy R9-L06-8).
//
// `withSkillStoreWriterLock` incremented its process-local `heldWriterLocks`
// Map at FUNCTION ENTRY, before `withFileLock` had acquired the mutex, and
// `isSkillStoreWriterLockHeld` answers from that Map. A process merely WAITING
// for the lock therefore reported itself as its holder for the whole wait, and
// the public door's mandatory-lock control - which trusts that predicate -
// accepted a promotion that ran before the lock was real: an unlocked canonical
// write under a foreign holder.
//
// This lane pins the two halves the acceptance criteria name:
//   1. two processes: while A holds the writer lock, B's PENDING acquisition is
//      not a hold, so B's door call is refused by name;
//   2. the waiter still acquires and runs its critical section once A releases,
//      so the red half cannot be satisfied by never recording a hold at all.
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CATALOG_URL = pathToFileURL(
  path.join(REPO, "zink-skill-store", "src", "catalog.mjs"),
).href;
const DOOR_URL = pathToFileURL(
  path.join(REPO, "zink-skill-store", "index.mjs"),
).href;

const { isSkillStoreWriterLockHeld, withSkillStoreWriterLock } = await import(
  CATALOG_URL
);
const door = await import(DOOR_URL);

// Every governed input is passed explicitly: this case must not depend on the
// promotion's own defaults.
const GOVERNED = {
  requestingActor: "excel",
  ownerActor: "owner",
  sourceType: "research",
  references: [{ type: "plan", ref: "M12/T9-R4" }],
  decisionRef: "PLAN:M12/T9-R4",
};

// The holder is a REAL second process: the lock is a cross-process mutex, and
// an in-process second acquisition would find this process's own hold in the
// Map - the pending window this row is about only exists against a foreign
// holder.
const holderSource = `import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { withSkillStoreWriterLock } from ${JSON.stringify(CATALOG_URL)};

const [skillsRoot, releaseMarker] = process.argv.slice(2);
await withSkillStoreWriterLock(skillsRoot, async () => {
  process.stdout.write("HELD\\n");
  while (!existsSync(releaseMarker)) await delay(10);
});
process.stdout.write("RELEASED\\n");
`;

function waitForStdout(child, needle, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let seen = "";
    const settle = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    };
    const onData = (chunk) => {
      seen += chunk;
      if (seen.includes(needle)) {
        settle();
        resolve(seen);
      }
    };
    const onExit = (code) => {
      settle();
      reject(
        new Error(`holder exited with ${code} before ${needle}; saw ${seen}`),
      );
    };
    const timer = setTimeout(() => {
      settle();
      reject(new Error(`holder never reported ${needle}; saw ${seen}`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", onData);
    child.on("exit", onExit);
  });
}

test("F-432: a pending acquisition is not a hold, so the door refuses the waiter", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "m12-t9-f432-"));
  const skillsRoot = path.join(rootDir, "skills");
  const releaseMarker = path.join(rootDir, "release");
  const holderPath = path.join(rootDir, "hold-lock.mjs");
  await writeFile(holderPath, holderSource, "utf8");

  const holder = spawn(
    process.execPath,
    [holderPath, skillsRoot, releaseMarker],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let holderStderr = "";
  holder.stderr.setEncoding("utf8");
  holder.stderr.on("data", (chunk) => {
    holderStderr += chunk;
  });

  try {
    await waitForStdout(holder, "HELD");

    let fnRan = false;
    const pending = withSkillStoreWriterLock(
      skillsRoot,
      async () => {
        fnRan = true;
      },
      { timeoutMs: 10000, retryDelayMs: 10 },
    );
    try {
      await delay(250);
      assert.equal(
        fnRan,
        false,
        `the waiter must still be waiting for the file lock; child stderr: ${holderStderr}`,
      );
      assert.equal(
        isSkillStoreWriterLockHeld(skillsRoot),
        false,
        "a process waiting for the lock must not report itself as its holder",
      );
      await assert.rejects(
        () =>
          door.promoteApprovedSkill({
            skillsRoot,
            namespace: ["office"],
            capability: "pending-skill",
            version: "1.0.0",
            content: "# Pending\n\nan unlocked write under a foreign holder\n",
            ...GOVERNED,
          }),
        (error) => error?.code === "SKILL_STORE_WRITER_LOCK_REQUIRED",
        "the door must refuse the promotion while the acquisition is pending",
      );
    } finally {
      writeFileSync(releaseMarker, "release", "utf8");
      await pending;
    }
    assert.equal(
      fnRan,
      true,
      "the waiter must enter its critical section once the holder releases",
    );
  } finally {
    holder.kill();
    await rm(rootDir, { recursive: true, force: true });
  }
});
