// F-365 (R7-IG-05) - three PostgreSQL archives sit under
// backups/knowledge-t5/ with no tracked producer, one of them empty.
//
// The acceptance criterion offers two branches: the T5 driver owns the
// `knowledge.dump` naming (producer tracked, digest recorded in PLAN.md
// section 8, retention stated), or the archives are removed by an
// owner-authorized deletion. Removal is destructive, so the first branch is
// taken: the tracked driver writes the archive under the name the tree
// already uses, refuses a zero-length archive, and writes the run's manifest
// beside it, so a run's pointer never lives only in ignored scratch.
//
// The archives that already exist are recorded, with their digests, in the
// tracked ledger, so provenance, digest and expiry are defined for them too.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  compareArchiveLedger,
  checkRecoveryArchiveProvenance,
} from "../scripts/repository-policy.mjs";

const root = process.cwd();

const LEDGER_PATH = path.join(
  "docs",
  "runbooks",
  "recovery-archive-ledger.json",
);
const DRIVER_PATH = path.join(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t5-live.ps1",
);

function ledger() {
  return JSON.parse(readFileSync(path.join(root, LEDGER_PATH), "utf8"));
}

function listArchives(directory = path.join(root, "backups")) {
  const archives = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".dump")) continue;
      const bytes = statSync(full).size;
      archives.push({
        relativePath: path.relative(root, full).replaceAll("\\", "/"),
        bytes,
        sha256: createHash("sha256").update(readFileSync(full)).digest("hex"),
      });
    }
  };
  if (existsSync(directory)) walk(directory);
  return archives;
}
test("F-365: the tracked T5 driver owns the recovery-archive name", () => {
  const driver = readFileSync(path.join(root, DRIVER_PATH), "utf8");
  assert.match(
    driver,
    /\$dumpPath = Join-Path \$backupRoot "knowledge\.dump"/,
    "the driver must write the archive under the name the tree already uses",
  );
  assert.match(
    driver,
    /\$manifestPath = Join-Path \$backupRoot "knowledge\.manifest\.json"/,
    "the run's manifest must sit beside the archive",
  );
  assert.match(
    driver,
    /Recovery archive copy is missing or empty/,
    "the driver must refuse a zero-length recovery archive",
  );
  assert.match(driver, /Assert-FileChecksum \$dumpPath \$dumpSha256/);
});

test("F-365: the driver names no other recovery archive", () => {
  const driver = readFileSync(path.join(root, DRIVER_PATH), "utf8");
  const archiveNames = [...driver.matchAll(/m4-recovery-\$runId\.dump/g)];
  assert.deepEqual(
    archiveNames,
    [],
    `the driver must not write a second archive name: ${archiveNames.length} left`,
  );
});

test("F-365: every recovery archive under backups/ is recorded with its digest", () => {
  const recorded = ledger();
  const archives = listArchives();
  assert.ok(
    archives.length > 0,
    "the tree must carry recovery archives to record",
  );
  for (const archive of archives) {
    const entry = recorded.archives.find(
      (candidate) => candidate.path === archive.relativePath,
    );
    assert.ok(
      entry,
      `the archive ${archive.relativePath} must be recorded in the tracked ledger`,
    );
    assert.equal(entry.bytes, archive.bytes);
    assert.equal(entry.sha256, archive.sha256);
    assert.ok(
      typeof entry.retention === "string" && entry.retention.length > 0,
      `the archive ${archive.relativePath} must state its retention`,
    );
  }
});

test("F-365: no recorded recovery archive is zero-length", () => {
  for (const entry of ledger().archives) {
    if (entry.status !== "recovery-archive") continue;
    assert.ok(
      entry.bytes > 0,
      `a zero-length recovery archive must not be presented as a backup: ${entry.path}`,
    );
  }
});

test("F-365: the repository policy check accepts the recorded archives", () => {
  assert.deepEqual(checkRecoveryArchiveProvenance(root), []);
});

test("F-365: the policy check refuses an archive that is not recorded", () => {
  const failures = compareArchiveLedger(
    [],
    [
      {
        path: "backups/knowledge-t5/run/knowledge.dump",
        bytes: 10,
        sha256: "aa",
      },
    ],
  );
  assert.ok(
    failures.length > 0,
    "an unrecorded archive has no provenance, digest or expiry",
  );
});

test("F-365: the policy check refuses an archive whose digest drifted", () => {
  const failures = compareArchiveLedger(
    [
      {
        path: "backups/knowledge-t5/run/knowledge.dump",
        bytes: 10,
        sha256: "aa",
      },
    ],
    [
      {
        path: "backups/knowledge-t5/run/knowledge.dump",
        bytes: 10,
        sha256: "bb",
      },
    ],
  );
  assert.ok(
    failures.some((failure) => failure.includes("digest")),
    `a changed archive must fail the policy check: ${failures.join(" | ")}`,
  );
});
