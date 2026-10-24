// M12/T9-R4 B6 — F-580 (legacy R10-T12-5).
//
// `promoteApprovedSkillUnlocked` re-validates the promoted record and, on
// failure, removes the version directory; when that removal ALSO fails (the
// retryable errno set `file-lock.mjs:51-62` documents as host-normal) the
// directory stays canonical-named and complete. No sweeper could match it —
// the residue grammars knew `<semver>.pending-*`, live manifests and incomplete
// pairs — so the store-wide `PREEXISTING_CATALOG_ERRORS` gate refused every
// later promotion and the Zink Tools read arms answered SKILL_CATALOG_INVALID
// for every governed skill.
//
// This lane pins the repair and the grammar:
//   1. the geometry — the stranded pair is an ERROR, never residue, and both
//      read arms are dark while it is canonical;
//   2. the shipped repair quarantines it by rename into a name the scanner
//      treats as residue, so the next scan is error-free and both read arms
//      serve again;
//   3. the repair refuses a version that validates (it is not a repair for a
//      healthy record) and an unknown version.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CATALOG_PATH = fileURLToPath(
  new URL("../zink-skill-store/src/catalog.mjs", import.meta.url),
);
const CLI_PATH = fileURLToPath(
  new URL("../zink-skill-store/bin/skill-store.mjs", import.meta.url),
);
const ADAPTER_PATH = fileURLToPath(
  new URL(
    "../zink-tools/adapters/skill-store/skill-adapter.mjs",
    import.meta.url,
  ),
);

const { promoteApprovedSkill, scanCatalog } = await import(
  pathToFileURL(CATALOG_PATH).href
);
const { executeCli } = await import(pathToFileURL(CLI_PATH).href);
const { SkillAdapter } = await import(pathToFileURL(ADAPTER_PATH).href);

const GOVERNED = {
  requestingActor: "excel",
  ownerActor: "owner",
  sourceType: "research",
  references: [{ type: "plan", ref: "M12/T9-R4" }],
  decisionRef: "PLAN:M12/T9-R4",
};

// The digest must be the real SHA-256 of the bytes, so the stranded pair
// fails on the schema — not on a digest that never could have matched.
const sha = (value) => createHash("sha256").update(value, "utf8").digest("hex");

async function writeStrandedPair(skillsRoot) {
  const body = "# Stranded\n\nthe record this pair carries is refused\n";
  const directory = path.join(skillsRoot, "office", "stranded", "1.0.0");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"), body, "utf8");
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(
      {
        schema_version: 1,
        identity: {
          namespace: ["office"],
          capability: "stranded",
          version: "1.0.0",
        },
        content: { path: "SKILL.md", sha256: sha(body) },
        provenance: { source_type: "research", references: [] },
        lifecycle: [
          { status: "CANDIDATE", at: "2026-09-17T00:00:00Z", actor: "excel" },
          {
            status: "ACTIVE",
            at: "2026-09-17T01:00:00Z",
            actor: "owner",
            decision_ref: "PLAN:M12/T9-R4",
          },
        ],
        // The key the canonical schema forbids: the catalog refuses this pair
        // and the promotion's rollback could not remove it.
        metadata: { description: "model-controlled key outside the schema" },
      },
      null,
      2,
    ),
    "utf8",
  );
  return directory;
}

async function seededStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12-t9-f580-"));
  const skillsRoot = path.join(root, "skills");
  await promoteApprovedSkill({
    skillsRoot,
    namespace: ["office"],
    capability: "healthy",
    version: "1.0.0",
    content: "# Healthy\n\nthe record every read arm must keep serving\n",
    ...GOVERNED,
  });
  return { root, skillsRoot };
}

test("F-580: a canonical pair that fails validation takes every read arm dark", async () => {
  const { root, skillsRoot } = await seededStore();
  try {
    await writeStrandedPair(skillsRoot);

    const scan = await scanCatalog(skillsRoot);
    assert.ok(
      scan.errors.length > 0,
      "the stranded pair must be diagnosed, not silently accepted",
    );
    assert.ok(
      scan.errors.some((error) =>
        error.path.startsWith("skills/office/stranded/1.0.0"),
      ),
      `the diagnostic must name the stranded directory, got ${JSON.stringify(scan.errors)}`,
    );
    assert.deepEqual(
      scan.residue,
      [],
      "a canonical directory is never residue before it is quarantined",
    );

    const adapter = new SkillAdapter(skillsRoot, { skillsRoot });
    for (const action of ["read", "apply"]) {
      await assert.rejects(
        () =>
          adapter.querySkillStore({
            action,
            skill_id: "office/healthy",
          }),
        (error) => error.code === "SKILL_CATALOG_INVALID",
        `${action} must fail closed: one stranded directory blanks the whole store`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-580: the shipped repair quarantines the stranded pair and reads recover", async () => {
  const { root, skillsRoot } = await seededStore();
  try {
    const strandedDir = await writeStrandedPair(skillsRoot);

    const repaired = await executeCli(
      [
        "quarantine",
        "--namespace",
        "office",
        "--capability",
        "stranded",
        "--version",
        "1.0.0",
      ],
      skillsRoot,
    );
    assert.equal(
      repaired.stderr,
      "",
      `the repair must not refuse: ${repaired.stderr}`,
    );
    assert.equal(repaired.exitCode, 0);
    const report = JSON.parse(repaired.stdout);
    assert.equal(report.status, "QUARANTINED");
    assert.match(report.skill.quarantined_as, /^1\.0\.0\.stranded-/u);

    const scan = await scanCatalog(skillsRoot);
    assert.deepEqual(scan.errors, [], "the store must be error-free again");
    const residue = scan.residue.map((entry) => entry.path);
    assert.ok(
      residue.some((entry) =>
        entry.startsWith("skills/office/stranded/1.0.0.stranded-"),
      ),
      `the quarantined directory must be residue the sweeper clears, got ${JSON.stringify(residue)}`,
    );

    // The quarantine renames; it never deletes the bytes. The refused record
    // stays inspectable under the residue name.
    const quarantined = path.join(
      path.dirname(strandedDir),
      report.skill.quarantined_as,
    );
    assert.deepEqual((await readdir(quarantined)).sort(), [
      "SKILL.md",
      "manifest.json",
    ]);

    const adapter = new SkillAdapter(skillsRoot, { skillsRoot });
    for (const action of ["read", "apply"]) {
      const served = await adapter.querySkillStore({
        action,
        skill_id: "office/healthy",
      });
      assert.match(
        served.skill_content.content,
        /the record every read arm must keep serving/u,
        `${action} must serve the healthy record again`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-580: the repair refuses a record that validates and an absent version", async () => {
  const { root, skillsRoot } = await seededStore();
  try {
    const healthy = await executeCli(
      [
        "quarantine",
        "--namespace",
        "office",
        "--capability",
        "healthy",
        "--version",
        "1.0.0",
      ],
      skillsRoot,
    );
    assert.equal(healthy.exitCode, 1);
    assert.equal(
      JSON.parse(healthy.stderr).error.code,
      "CATALOG_INVALID",
      "a healthy record is not a repair target",
    );
    assert.match(
      JSON.parse(healthy.stderr).error.details.join(","),
      /VERSION_NOT_STRANDED/u,
    );

    const absent = await executeCli(
      [
        "quarantine",
        "--namespace",
        "office",
        "--capability",
        "healthy",
        "--version",
        "9.9.9",
      ],
      skillsRoot,
    );
    assert.equal(absent.exitCode, 1);
    assert.equal(
      JSON.parse(absent.stderr).error.code,
      "SKILL_VERSION_NOT_FOUND",
    );

    // Neither refusal touched the canonical tree.
    const body = await readFile(
      path.join(skillsRoot, "office", "healthy", "1.0.0", "SKILL.md"),
      "utf8",
    );
    assert.match(body, /# Healthy/u);
    assert.deepEqual((await scanCatalog(skillsRoot)).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
