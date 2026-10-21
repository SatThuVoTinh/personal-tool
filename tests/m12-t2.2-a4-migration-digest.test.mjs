// M12/T2.2-R1 A-4 — an applied migration must not be editable in silence
// (`R6-V10-01`).
//
// Adoption is keyed on filename only: apps/knowledge/app/database.py records
// `knowledge.schema_migrations.version = migration_path.name` and skips any file
// whose name is already recorded, with no digest or checksum column. So editing
// an already-applied apps/knowledge/migrations/00x.sql in place is a silent
// no-op on every database that adopted it — the file changed, the applied set
// did not, and no gate could see the difference.
//
// This guard closes that gap at the repository level: docs/contracts/
// knowledgebase-migration-digests.json pins the SHA-256 of each applied
// migration's bytes, and the digest check reddens `npm run verify` when a
// tracked migration's bytes change, telling the author the only correct action
// is to add a NEW forward migration.
//
// This file edits no SQL and adds no schema. It is pure filesystem:
// no Postgres, no Docker, no uv, no network, no Python. The only repository
// files it reads are the manifest and the migration bytes themselves
// (read-only, per §3 of the contract).
//
// Assertion taxonomy (real files vs. temporary fixtures):
// - REAL: the manifest structure, the digest equality of every migration
//   listed in docs/contracts/knowledgebase-migration-digests.json against the
//   actual bytes in apps/knowledge/migrations/, AND the reverse direction:
//   every migration file on disk must be named by the manifest. This is the
//   gate that bites in CI.
// - FIXTURE: mutated-copy detection, missing-file detection, and the
//   "new unlisted file reddens the guard" rule run the same digest logic over
//   a temporary directory under os.tmpdir(), never inside the repository.
//
// F-315 (R7-E3-03): the guard used to walk the manifest only, so it could
// detect a LISTED file changing but never noticed a migration file that is
// absent from the manifest, and the fixture below pinned that blindness green
// as "the forward-migration allowance". The guard now reconciles in BOTH
// directions, and a new file enters the manifest by being NAMED in it with
// its digest — the owner decision that rule rests on is escalated with the
// row, because the manifest's own `purpose` text still describes the old
// one-directional rule.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Repo-relative paths resolved from this file's own location, so the test
// behaves identically on Windows, in a Linux CI runner, and under WSL.
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIGRATIONS_DIR = path.join(REPO_ROOT, "apps", "knowledge", "migrations");
const MANIFEST_FILE = path.join(
  REPO_ROOT,
  "docs",
  "contracts",
  "knowledgebase-migration-digests.json",
);

// M12/T9 F-094 (R5-E03-07) / H5: the repository has TWO migration sets and
// TWO manifests. The `skills.*` schema moved to the module that owns it, so
// the Skill Store pins its own migrations in its own manifest, and the
// Knowledgebase's set keeps its own tables.
const SKILL_STORE_MIGRATIONS_DIR = path.join(
  REPO_ROOT,
  "zink-skill-store",
  "migrations",
);
const SKILL_STORE_MANIFEST_FILE = path.join(
  REPO_ROOT,
  "docs",
  "contracts",
  "skill-store",
  "skill-store-migration-digests.json",
);

function sha256OfFile(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

// The shared guard logic, so the fixture tests exercise the same code path the
// real-file gate runs. `migrationsDir` is a directory holding *.sql files;
// `manifest` is the parsed manifest object. The guard reconciles in BOTH
// directions: every entry the manifest names must match the bytes on disk,
// and every migration file on disk must be named by the manifest.
// Returns an array of human-readable failure messages; empty means pass.
function checkMigrationDigests(migrationsDir, manifest, movedResolver = null) {
  const failures = [];
  for (const entry of manifest.migrations) {
    const migrationPath = path.join(migrationsDir, entry.file);
    if (!fs.existsSync(migrationPath)) {
      // M12/T9 F-094 (R5-E03-07) / H5: a migration that MOVED to the module
      // that owns it is not a deleted migration. The bytes are still pinned -
      // by the owning module's own manifest - so the immutability guarantee
      // this guard exists for still holds.
      const moved = movedResolver ? movedResolver(entry) : null;
      if (moved && moved.digest === entry.sha256) continue;
      if (moved) {
        failures.push(
          `Migration ${entry.file} moved to ${moved.dir} but its bytes changed ` +
            `(expected sha256 ${entry.sha256}, observed ${moved.digest}). An applied migration is ` +
            `immutable: restore the original bytes, or add a NEW forward migration.`,
        );
        continue;
      }
      failures.push(
        `Migration ${entry.file} is listed in docs/contracts/knowledgebase-migration-digests.json ` +
          `but no longer exists in ${migrationsDir}. Deleting an applied migration changes nothing on ` +
          `databases that already adopted it by filename, and breaks every future run of this guard: ` +
          `restore the original file, or revert the manifest edit. Applied migrations are immutable.`,
      );
      continue;
    }

    const actual = sha256OfFile(migrationPath);
    if (actual !== entry.sha256) {
      failures.push(
        `Migration ${entry.file} has already been applied by filename ` +
          `(knowledge.schema_migrations.version is the filename, so editing this file changes NOTHING ` +
          `on any database that adopted it — it is a silent no-op). Add a NEW forward migration in ` +
          `apps/knowledge/migrations/ (e.g. 004_*.sql) instead of editing an applied one. ` +
          `Expected sha256 ${entry.sha256}, observed ${actual}.`,
      );
    }
  }
  // The reverse direction. A migration file that the manifest does not name
  // carries no digest at all, so nothing can prove it was never edited in
  // place after it was adopted: the one-directional guard was blind to it.
  const listed = new Set(manifest.migrations.map((entry) => entry.file));
  for (const file of migrationFilesIn(migrationsDir)) {
    if (listed.has(file)) continue;
    failures.push(
      `Migration ${file} exists in ${migrationsDir} but is NOT named in ` +
        `docs/contracts/knowledgebase-migration-digests.json. Every tracked migration must enter the ` +
        `manifest with its sha256 digest in the SAME commit that adds the file: the digest is what ` +
        `proves the file was never edited in place after it was adopted, and an unnamed file has no ` +
        `such proof.`,
    );
  }
  return failures;
}

/** The migration files in a directory, in a stable order. */
function migrationFilesIn(migrationsDir) {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

// --- REAL manifest + REAL migration files: the gate that runs in CI. ---

test("A-4 REAL: the digest manifest is well-formed", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  assert.equal(
    manifest.digestAlgorithm,
    "sha256",
    "Manifest must state digestAlgorithm: sha256 so future readers cannot guess the hash used.",
  );
  assert.ok(
    typeof manifest.purpose === "string" && manifest.purpose.length > 0,
    "Manifest must carry a one-line statement of what it is for.",
  );
  assert.ok(
    Array.isArray(manifest.migrations),
    "Manifest migrations must be an array.",
  );
  const seen = new Set();
  for (const entry of manifest.migrations) {
    assert.match(
      entry.file,
      /^\d{3}_[a-z0-9_]+\.sql$/,
      `Manifest entry ${JSON.stringify(entry.file)} must name a Knowledgebase migration file.`,
    );
    assert.ok(!seen.has(entry.file), `Manifest lists ${entry.file} twice.`);
    seen.add(entry.file);
    assert.match(
      entry.sha256,
      /^[0-9a-f]{64}$/,
      `Manifest digest for ${entry.file} must be 64 lowercase hex characters.`,
    );
  }
});

test("A-4 REAL: every tracked migration's bytes still match its recorded digest", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  const failures = checkMigrationDigests(MIGRATIONS_DIR, manifest, movedEntry);
  assert.deepEqual(
    failures,
    [],
    `Applied migrations are immutable once adopted by filename; the forward-migration rule is the only ` +
      `allowed path. Failures:\n${failures.join("\n")}`,
  );
});

// ---------------------------------------------------------------------------
// M12/T9 F-094 (R5-E03-07) / H5 - the Skill Store's own migration set
// ---------------------------------------------------------------------------

/**
 * Where a listed migration went, when it is no longer in the set that names
 * it.
 *
 * A migration that moved to the module that owns it is still an APPLIED
 * migration: the bytes are pinned there by that module's own manifest. The
 * resolver reports the owning set and the digest the owner pins, so the guard
 * can tell a relocation (allowed) from an edit (refused).
 */
function movedEntry(entry) {
  for (const [dir, manifestFile] of [
    [SKILL_STORE_MIGRATIONS_DIR, SKILL_STORE_MANIFEST_FILE],
  ]) {
    const owner = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    const named = owner.migrations.find((item) => item.file === entry.file);
    if (!named) continue;
    const movedPath = path.join(dir, entry.file);
    if (!fs.existsSync(movedPath)) continue;
    return { dir, digest: sha256OfFile(movedPath) };
  }
  return null;
}

test("A-4 REAL: the Skill Store's manifest is well-formed", () => {
  const manifest = JSON.parse(
    fs.readFileSync(SKILL_STORE_MANIFEST_FILE, "utf8"),
  );
  assert.equal(manifest.digestAlgorithm, "sha256");
  assert.ok(
    typeof manifest.purpose === "string" && manifest.purpose.length > 0,
    "The Skill Store manifest must carry a one-line statement of what it is for.",
  );
  assert.ok(Array.isArray(manifest.migrations));
  const seen = new Set();
  for (const entry of manifest.migrations) {
    assert.match(
      entry.file,
      /^\d{3}_[a-z0-9_]+\.sql$/,
      `Manifest entry ${JSON.stringify(entry.file)} must name a Skill Store migration file.`,
    );
    assert.ok(!seen.has(entry.file), "Manifest lists the same file twice.");
    seen.add(entry.file);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  }
});

test("A-4 REAL: every tracked Skill Store migration's bytes still match its recorded digest", () => {
  const manifest = JSON.parse(
    fs.readFileSync(SKILL_STORE_MANIFEST_FILE, "utf8"),
  );
  const failures = checkMigrationDigests(SKILL_STORE_MIGRATIONS_DIR, manifest);
  assert.deepEqual(
    failures,
    [],
    `The Skill Store's applied migrations are immutable too. Failures:\n${failures.join("\n")}`,
  );
});

test("A-4 REAL: every tracked Skill Store migration is named by the Skill Store's manifest", () => {
  const manifest = JSON.parse(
    fs.readFileSync(SKILL_STORE_MANIFEST_FILE, "utf8"),
  );
  const listed = new Set(manifest.migrations.map((entry) => entry.file));
  const unlisted = migrationFilesIn(SKILL_STORE_MIGRATIONS_DIR).filter(
    (file) => !listed.has(file),
  );
  assert.deepEqual(
    unlisted,
    [],
    `these tracked Skill Store migrations are not named by the Skill Store's manifest, ` +
      `so their bytes are unpinned: ${unlisted.join(", ")}`,
  );
});

test("A-4 REAL: the migrated skills schema is pinned by BOTH manifests, with the same bytes", () => {
  // The `skills.*` DDL was applied by the Knowledgebase's runner before it
  // moved to the module that owns it. The move must not have changed a byte:
  // the digest the Knowledgebase's manifest already pinned is the digest the
  // Skill Store's manifest pins now.
  const knowledgebase = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  const skillStore = JSON.parse(
    fs.readFileSync(SKILL_STORE_MANIFEST_FILE, "utf8"),
  );
  const migrated = "003_skills_vector_schema.sql";
  const before = knowledgebase.migrations.find(
    (entry) => entry.file === migrated,
  );
  assert.ok(
    before,
    "the Knowledgebase manifest must still name the migrated file",
  );
  const after = skillStore.migrations.find((entry) => entry.file === migrated);
  assert.ok(after, "the Skill Store manifest must name the migrated file");
  assert.equal(
    after.sha256,
    before.sha256,
    "the migration moved, so its bytes must be identical",
  );
  assert.equal(
    sha256OfFile(path.join(SKILL_STORE_MIGRATIONS_DIR, migrated)),
    before.sha256,
  );
  assert.ok(
    !fs.existsSync(path.join(MIGRATIONS_DIR, migrated)),
    "the skills.* DDL must not stay in the Knowledgebase's migration set",
  );
});

test("A-4 REAL: every tracked migration is named by the manifest", () => {
  // F-315: the second clause of the guard. A migration file the manifest does
  // not name carries no digest, so nothing can prove it was never edited in
  // place after adoption — and the guard used to say nothing about it at all.
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  const listed = new Set(manifest.migrations.map((entry) => entry.file));
  const unlisted = migrationFilesIn(MIGRATIONS_DIR).filter(
    (file) => !listed.has(file),
  );
  assert.deepEqual(
    unlisted,
    [],
    `these tracked migrations are not named by docs/contracts/knowledgebase-migration-digests.json, ` +
      `so their bytes are unpinned: ${unlisted.join(", ")}`,
  );
});

// --- FIXTURES: prove the same logic is not vacuous. Every temp tree lives
// under os.tmpdir() and is deleted; nothing is written inside apps/knowledge/
// or anywhere else in the repository. ---

// Copies the named real migrations into a fresh temp dir, builds a manifest
// from their ORIGINAL bytes, applies `mutate` to the temp dir, then runs the
// real guard logic over it. Returns the guard's failure list.
function runGuardOnFixture(migrationFiles, mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a4-digest-fixture-"));
  try {
    const manifest = {
      digestAlgorithm: "sha256",
      purpose: "fixture",
      migrations: migrationFiles.map((file) => ({
        file,
        sha256: sha256OfFile(path.join(MIGRATIONS_DIR, file)),
      })),
    };
    for (const file of migrationFiles) {
      fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(dir, file));
    }
    mutate(dir);
    return checkMigrationDigests(dir, manifest);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("A-4 FIXTURE: mutating a tracked migration's bytes reddens the guard with the forward-migration message", () => {
  const failures = runGuardOnFixture(["001_initial.sql"], (dir) => {
    // Flip the last byte of the fixture copy so the digest genuinely changes.
    const target = path.join(dir, "001_initial.sql");
    fs.appendFileSync(target, " ");
  });
  assert.equal(
    failures.length,
    1,
    "A mutated tracked migration must produce exactly one failure.",
  );
  assert.match(
    failures[0],
    /already been applied by filename/,
    `Failure message must explain the silent-no-op defect, got: ${failures[0]}`,
  );
  assert.match(
    failures[0],
    /Add a NEW forward migration/,
    `Failure message must name the forward-migration rule, got: ${failures[0]}`,
  );
});

test("A-4 FIXTURE: deleting a manifest-listed migration reddens the guard", () => {
  const failures = runGuardOnFixture(["001_initial.sql"], (dir) => {
    fs.rmSync(path.join(dir, "001_initial.sql"));
  });
  assert.equal(
    failures.length,
    1,
    "A missing tracked migration must produce exactly one failure.",
  );
  assert.match(
    failures[0],
    /no longer exists/,
    `Failure message must name the missing migration, got: ${failures[0]}`,
  );
});

test("A-4 FIXTURE: a NEW unlisted migration file reddens the guard (a new file enters the manifest by being named in it)", () => {
  // F-315: this case used to assert the OPPOSITE — that a migration file
  // absent from the manifest stays green — which pinned the one-directional
  // guard green as "the forward-migration allowance". The allowance is now an
  // explicit rule: the file is named in the manifest, with its digest, in the
  // same commit that adds it.
  const failures = runGuardOnFixture(["001_initial.sql"], (dir) => {
    fs.writeFileSync(
      path.join(dir, "004_forward_example.sql"),
      "-- a brand-new forward migration\n",
    );
  });
  assert.equal(
    failures.length,
    1,
    "A migration file absent from the manifest must produce exactly one failure.",
  );
  assert.match(
    failures[0],
    /is NOT named in\s+docs\/contracts\/knowledgebase-migration-digests\.json/u,
    `Failure message must name the manifest the file has to enter, got: ${failures[0]}`,
  );
  assert.match(
    failures[0],
    /SAME commit/u,
    `Failure message must say how a new file enters the manifest, got: ${failures[0]}`,
  );
});
