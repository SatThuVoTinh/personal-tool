// M12/T9-R4 B6 — F-435 (legacy R9-T05-3).
//
// `promoteApprovedSkill` was exported TWICE with opposite locking contracts:
// `src/catalog.mjs` exported the ACQUIRING wrapper (takes the writer lock
// itself) while the public door `index.mjs` exported the REFUSING variant
// (throws SKILL_STORE_WRITER_LOCK_REQUIRED unless the lock is already held).
// Import-site selection silently chose whether a call self-serialised or
// errored, and the governance plugin's docblock justified its placement with
// the variant it does not bind.
//
// Acceptance: ONE name per locking semantics. The door keeps the public name
// `promoteApprovedSkill` (the refusing variant every governed caller binds);
// the store's acquiring wrapper moves to its own name
// `promoteApprovedSkillWithLock`, so the two contracts can never share an
// importable name again. This test is the identity check the acceptance
// names: it turns red if both modules re-export the shared name.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const catalog = await import(
  pathToFileURL(path.join(REPO, "zink-skill-store", "src", "catalog.mjs")).href
);
const door = await import(
  pathToFileURL(path.join(REPO, "zink-skill-store", "index.mjs")).href
);

const GOVERNED = {
  requestingActor: "excel",
  ownerActor: "owner",
  sourceType: "research",
  references: [{ type: "plan", ref: "M12/T9-R4" }],
  decisionRef: "PLAN:M12/T9-R4",
};

test("F-435: the two locking contracts no longer share an importable name", () => {
  // The identity check the acceptance criteria name: at the pre-fix HEAD BOTH
  // modules export `promoteApprovedSkill` (distinct functions with opposite
  // contracts) and this is the red.
  assert.equal(
    catalog.promoteApprovedSkill,
    undefined,
    "the store internals must not export the door's public name; the " +
      "acquiring wrapper is `promoteApprovedSkillWithLock`",
  );
  assert.equal(typeof door.promoteApprovedSkill, "function");
  assert.equal(typeof catalog.promoteApprovedSkillWithLock, "function");
  assert.notEqual(
    catalog.promoteApprovedSkillWithLock,
    door.promoteApprovedSkill,
    "the acquiring wrapper and the refusing door variant are distinct",
  );
  // The unlocked writer keeps its explicit name — the rename removes the
  // ambiguity, it does not hide the unlocked variant from governed callers
  // that already hold the lock.
  assert.equal(typeof catalog.promoteApprovedSkillUnlocked, "function");
});

test("F-435: each name behaves as its locking semantics promise", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12-t9-f435-"));
  const skillsRoot = path.join(root, "skills");
  try {
    const params = {
      skillsRoot,
      namespace: ["office"],
      capability: "named-contract",
      version: "1.0.0",
      content: "# Named contract\n\nbody\n",
      ...GOVERNED,
    };

    // The door's variant REFUSES outside the lock.
    await assert.rejects(
      () => door.promoteApprovedSkill(params),
      (error) => error?.code === "SKILL_STORE_WRITER_LOCK_REQUIRED",
      "the door must refuse an unlocked promotion",
    );

    // The store's acquiring wrapper ACQUIRES outside any lock and promotes.
    const promoted = await catalog.promoteApprovedSkillWithLock(params);
    assert.equal(promoted.status, "ACTIVE");

    // ... and it still refuses to double-acquire from inside a held section:
    // the self-deadlock the plugin docblock describes stays documented by the
    // lock's own timeout, not by a shared ambiguous name.
    await assert.rejects(
      () =>
        catalog.withSkillStoreWriterLock(
          skillsRoot,
          () => catalog.promoteApprovedSkillWithLock(params),
          { timeoutMs: 200, retryDelayMs: 10 },
        ),
      (error) => error?.code === "FILE_LOCK_TIMEOUT",
      "a nested acquisition must fail on the lock, not on the name",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
