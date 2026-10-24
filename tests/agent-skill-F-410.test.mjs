// M12/T9-R4 B6 — F-410 (legacy R9-L06-3).
//
// `writeFileAtomic` creates `<target>.tmp-<pid>-<ms>-<hex>` and renames it with
// no unlink on failure, while `validateVersion` demanded exactly two entries in
// a version directory and the residue grammar knew only `<semver>.pending-*`.
// One interrupted write therefore converted a single file fault into a
// store-wide `VERSION_DIRECTORY_CONTENT_INVALID` / `PREEXISTING_CATALOG_ERRORS`
// refusal with no shipped repair.
//
// This lane pins the three halves of the acceptance criteria:
//   1. the fault injection — a forced failure inside the atomic writer leaves
//      no temp file behind;
//   2. a killed publisher's residue (the exact name shape the writer produces)
//      is RESIDUE, not corruption: the scan reports it and reports no error;
//   3. the next promotion succeeds and sweeps that residue away.
import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CATALOG_PATH = fileURLToPath(
  new URL("../zink-skill-store/src/catalog.mjs", import.meta.url),
);
const catalog = await import(`file:///${CATALOG_PATH.replace(/\\/gu, "/")}`);
const { promoteApprovedSkill, scanCatalog, writeFileAtomic } = catalog;

// Every governed input is passed explicitly: the promotion must not be able to
// fall back to a constant actor or provenance (F-045's row).
const GOVERNED = {
  requestingActor: "excel",
  ownerActor: "owner",
  sourceType: "research",
  references: [{ type: "plan", ref: "M12/T9-R4" }],
  decisionRef: "PLAN:M12/T9-R4",
};

async function freshRoots() {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12-t9-f410-"));
  return { root, skillsRoot: path.join(root, "skills") };
}

test("F-410: a failed atomic write removes its own temp file", async () => {
  const { root } = await freshRoots();
  try {
    // The fault: the rename target is an occupied directory, so the write
    // reaches `rename()` and fails there — the one failure that happens AFTER
    // the temp file exists. EPERM on Windows, EISDIR on POSIX; both throw.
    const target = path.join(root, "office", "capability", "manifest.json");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "occupied.txt"), "occupied", "utf8");

    await assert.rejects(
      () => writeFileAtomic(target, Buffer.from("{}", "utf8")),
      "the forced rename failure must surface",
    );

    const names = await readdir(path.dirname(target));
    assert.deepEqual(
      names.filter((name) => name.startsWith("manifest.json.tmp-")),
      [],
      "the writer must not leave its own temp file on a failure path",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-410: a killed publisher's temp residue is residue, not store corruption", async () => {
  const { root, skillsRoot } = await freshRoots();
  try {
    const promoted = await promoteApprovedSkill({
      skillsRoot,
      namespace: ["office"],
      capability: "tailored",
      version: "1.0.0",
      content: "# Tailored\n\nbody\n",
      ...GOVERNED,
    });
    assert.equal(promoted.status, "ACTIVE");

    // Exactly what a writer killed between `open()` and `rename()` leaves:
    // the target name, the writer's `.tmp-` marker and its pid/ms/hex suffix.
    const versionDir = path.join(skillsRoot, "office", "tailored", "1.0.0");
    const residueName = "manifest.json.tmp-4242-1700000000000-abcdef12";
    await writeFile(path.join(versionDir, residueName), "{", "utf8");

    const scan = await scanCatalog(skillsRoot);
    assert.deepEqual(
      scan.errors,
      [],
      "the writer's own residue must not be read as a corrupt version directory",
    );
    assert.equal(scan.records.length, 1, "the live pair is still a record");
    assert.ok(
      scan.residue.some((entry) => entry.path.endsWith(residueName)),
      `the residue must be reported for the sweeper, got ${JSON.stringify(scan.residue)}`,
    );

    // The next promotion succeeds and leaves the store clean, so one killed
    // publisher no longer blocks every later one.
    const successor = await promoteApprovedSkill({
      skillsRoot,
      namespace: ["office"],
      capability: "successor",
      version: "1.0.0",
      content: "# Successor\n\nbody\n",
      ...GOVERNED,
    });
    assert.equal(successor.status, "ACTIVE");

    const after = await scanCatalog(skillsRoot);
    assert.deepEqual(after.errors, []);
    assert.deepEqual(after.residue, [], "the sweep must remove the residue");
    assert.deepEqual(
      (await readdir(versionDir)).sort(),
      ["SKILL.md", "manifest.json"],
      "the swept version directory keeps exactly its canonical pair",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-410: a genuinely malformed sibling name is still an error", async () => {
  const { root, skillsRoot } = await freshRoots();
  try {
    await promoteApprovedSkill({
      skillsRoot,
      namespace: ["office"],
      capability: "strict",
      version: "1.0.0",
      content: "# Strict\n\nbody\n",
      ...GOVERNED,
    });
    const versionDir = path.join(skillsRoot, "office", "strict", "1.0.0");
    // Same shape as the residue but for a name the writer never targets: the
    // exemption must be the writer's own grammar, not "anything with .tmp-".
    await writeFile(path.join(versionDir, "notes.tmp-1-2-abcdef12"), "x");

    const scan = await scanCatalog(skillsRoot);
    assert.ok(
      scan.errors.some(
        (error) => error.code === "VERSION_DIRECTORY_CONTENT_INVALID",
      ),
      `an unrecognised entry must still be refused, got ${JSON.stringify(scan.errors)}`,
    );
    assert.deepEqual(scan.residue, []);
    const body = await readFile(path.join(versionDir, "SKILL.md"), "utf8");
    assert.match(body, /# Strict/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
