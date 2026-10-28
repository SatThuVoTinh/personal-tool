import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CATALOG_PATH = fileURLToPath(
  new URL("../src/catalog.mjs", import.meta.url),
);
const catalog = await import(`file:///${CATALOG_PATH.replace(/\\/gu, "/")}`);
const { promoteApprovedSkillWithLock, quarantineInvalidVersion } = catalog;

const GOVERNED = {
  requestingActor: "excel",
  ownerActor: "owner",
  sourceType: "research",
  references: [{ type: "plan", ref: "M12/T9-R4" }],
  decisionRef: "PLAN:M12/T9-R4",
};

async function createSymlink(target, linkPath) {
  try {
    await symlink(target, linkPath, "dir");
  } catch {
    await symlink(target, linkPath, "junction");
  }
}

test("F-SKILL-001: promotion residue cleanup refuses escaping symlink ancestor and preserves outside files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f-skill-001-ancestor-"));
  const skillsRoot = path.join(root, "skills");
  const outsideDir = path.join(root, "outside");

  try {
    await mkdir(skillsRoot, { recursive: true });
    await mkdir(path.join(outsideDir, "1.0.0.pending-attacker"), {
      recursive: true,
    });
    const sentinel = path.join(
      outsideDir,
      "1.0.0.pending-attacker",
      "sentinel.txt",
    );
    await writeFile(sentinel, "SECRET_OUTSIDE_DATA", "utf8");

    // Symlink skills/ns/cap -> outsideDir
    const capDir = path.join(skillsRoot, "ns", "cap");
    await mkdir(path.dirname(capDir), { recursive: true });
    await createSymlink(outsideDir, capDir);

    await assert.rejects(
      () =>
        promoteApprovedSkillWithLock({
          skillsRoot,
          namespace: ["ns"],
          capability: "cap",
          version: "1.0.0",
          content: "# Test Skill\n",
          ...GOVERNED,
        }),
      (err) => {
        assert.strictEqual(err.code, "SKILL_IDENTITY_INVALID");
        assert.match(err.message, /resolves outside skill store base/);
        return true;
      },
    );

    const sentinelExists = await stat(sentinel)
      .then(() => true)
      .catch(() => false);
    assert.strictEqual(
      sentinelExists,
      true,
      "Outside sentinel must remain untouched when escaping symlink is refused",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-SKILL-001: promotion residue cleanup refuses escaping residue symlink and preserves outside target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f-skill-001-residue-"));
  const skillsRoot = path.join(root, "skills");
  const outsideDir = path.join(root, "outside");

  try {
    await mkdir(skillsRoot, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    const sentinel = path.join(outsideDir, "sentinel.txt");
    await writeFile(sentinel, "SECRET_OUTSIDE_DATA", "utf8");

    const capDir = path.join(skillsRoot, "ns", "cap");
    await mkdir(capDir, { recursive: true });

    // Symlink skills/ns/cap/1.0.0.pending-attacker -> outsideDir
    const residueLink = path.join(capDir, "1.0.0.pending-attacker");
    await createSymlink(outsideDir, residueLink);

    await assert.rejects(
      () =>
        promoteApprovedSkillWithLock({
          skillsRoot,
          namespace: ["ns"],
          capability: "cap",
          version: "1.0.0",
          content: "# Test Skill\n",
          ...GOVERNED,
        }),
      (err) => {
        assert.strictEqual(err.code, "SKILL_IDENTITY_INVALID");
        assert.match(err.message, /resolves outside skill store base/);
        return true;
      },
    );

    const sentinelExists = await stat(sentinel)
      .then(() => true)
      .catch(() => false);
    assert.strictEqual(
      sentinelExists,
      true,
      "Outside target must remain untouched when residue symlink escapes base",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-SKILL-001: dangling symlinks in skill store path components are refused", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f-skill-001-dangling-"));
  const skillsRoot = path.join(root, "skills");

  try {
    await mkdir(skillsRoot, { recursive: true });
    const capDir = path.join(skillsRoot, "ns", "cap");
    await mkdir(path.dirname(capDir), { recursive: true });

    // Symlink skills/ns/cap -> nonexistent
    const nonExistentTarget = path.join(root, "nonexistent");
    await createSymlink(nonExistentTarget, capDir);

    await assert.rejects(
      () =>
        promoteApprovedSkillWithLock({
          skillsRoot,
          namespace: ["ns"],
          capability: "cap",
          version: "1.0.0",
          content: "# Test Skill\n",
          ...GOVERNED,
        }),
      (err) => {
        assert.strictEqual(err.code, "SKILL_IDENTITY_INVALID");
        assert.match(err.message, /dangling symlink/);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-SKILL-001: quarantineInvalidVersion refuses escaping symlinks without touching external files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f-skill-001-quarantine-"));
  const skillsRoot = path.join(root, "skills");
  const outsideDir = path.join(root, "outside");

  try {
    await mkdir(skillsRoot, { recursive: true });
    await mkdir(path.join(outsideDir, "1.0.0"), { recursive: true });
    const sentinel = path.join(outsideDir, "1.0.0", "SKILL.md");
    await writeFile(sentinel, "CANNOT_TOUCH", "utf8");

    const capDir = path.join(skillsRoot, "ns", "cap");
    await mkdir(path.dirname(capDir), { recursive: true });
    await createSymlink(outsideDir, capDir);

    await assert.rejects(
      () =>
        quarantineInvalidVersion({
          skillsRoot,
          namespace: ["ns"],
          capability: "cap",
          version: "1.0.0",
        }),
      (err) => {
        assert.strictEqual(err.code, "SKILL_IDENTITY_INVALID");
        assert.match(err.message, /resolves outside skill store base/);
        return true;
      },
    );

    const sentinelExists = await stat(sentinel)
      .then(() => true)
      .catch(() => false);
    assert.strictEqual(
      sentinelExists,
      true,
      "External file must not be quarantined or touched when ancestor is escaping symlink",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-SKILL-001: symlink inside sandbox is checked against store base and preserved", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f-skill-001-sandbox-"));
  const skillsRoot = path.join(root, "skills");

  try {
    await mkdir(skillsRoot, { recursive: true });
    const internalTarget = path.join(skillsRoot, "internal_dir");
    await mkdir(internalTarget, { recursive: true });
    const internalFile = path.join(internalTarget, "data.txt");
    await writeFile(internalFile, "INTERNAL_SANDBOX_DATA", "utf8");

    // Symlink skills/ns/cap -> skillsRoot/internal_dir (inside sandbox)
    const capDir = path.join(skillsRoot, "ns", "cap");
    await mkdir(path.dirname(capDir), { recursive: true });
    await createSymlink(internalTarget, capDir);

    // Promotion sees cap is inside skillsRoot, but scanCatalog walk flags it as DIRECTORY_GRAMMAR_INVALID
    await assert.rejects(
      () =>
        promoteApprovedSkillWithLock({
          skillsRoot,
          namespace: ["ns"],
          capability: "cap",
          version: "1.0.0",
          content: "# Test Skill\n",
          ...GOVERNED,
        }),
      (err) => {
        // Must be rejected by catalog grammar, NOT deleted!
        assert.ok(
          err.code === "CATALOG_INVALID" || err.code === "SKILL_IDENTITY_INVALID",
        );
        return true;
      },
    );

    const internalFileExists = await stat(internalFile)
      .then(() => true)
      .catch(() => false);
    assert.strictEqual(
      internalFileExists,
      true,
      "Internal sandbox directory target must be preserved and NOT deleted",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
