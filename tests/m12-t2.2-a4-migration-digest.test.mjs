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
// - REAL: the manifest structure, and the digest equality of every migration
//   listed in docs/contracts/knowledgebase-migration-digests.json against the
//   actual bytes in apps/knowledge/migrations/. This is the gate that bites in
//   CI; the failure-mode tests below only prove the check is not vacuous.
// - FIXTURE: mutated-copy detection, missing-file detection, and the
//   "new unlisted file stays green" rule run the same digest logic over a
//   temporary directory under os.tmpdir(), never inside the repository.

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

function sha256OfFile(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

// The shared guard logic, so the fixture tests exercise the same code path the
// real-file gate runs. `migrationsDir` is a directory holding *.sql files
// (files NOT listed in the manifest are ignored — they are forward migrations,
// the allowed path); `manifest` is the parsed manifest object.
// Returns an array of human-readable failure messages; empty means pass.
function checkMigrationDigests(migrationsDir, manifest) {
  const failures = [];
  for (const entry of manifest.migrations) {
    const migrationPath = path.join(migrationsDir, entry.file);
    if (!fs.existsSync(migrationPath)) {
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
  return failures;
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
  const failures = checkMigrationDigests(MIGRATIONS_DIR, manifest);
  assert.deepEqual(
    failures,
    [],
    `Applied migrations are immutable once adopted by filename; the forward-migration rule is the only ` +
      `allowed path. Failures:\n${failures.join("\n")}`,
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

test("A-4 FIXTURE: a NEW unlisted migration file does not redden the guard (forward migration is the allowed path)", () => {
  const failures = runGuardOnFixture(["001_initial.sql"], (dir) => {
    fs.writeFileSync(
      path.join(dir, "004_forward_example.sql"),
      "-- a brand-new forward migration\n",
    );
  });
  assert.deepEqual(
    failures,
    [],
    "A migration file absent from the manifest is a forward migration and must stay green.",
  );
});
