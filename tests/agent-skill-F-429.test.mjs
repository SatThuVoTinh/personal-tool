// M12/T9-R4 B6 — F-429 (legacy R9-L06-4).
//
// The derived-index sync used to scan and tombstone outside the store writer
// lock, and its only re-read compared content.sha256, never lifecycle. A
// retirement landing between the scan and the READY write was silently undone
// by the upsert; a promotion landing in the same window could be deleted by the
// stale tombstone. The fix locks the scan/tombstone prelude and re-reads the
// manifest lifecycle immediately before the READY transaction.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  syncSkillsToVectorStore,
  EXPECTED_DIMENSIONS,
} from "../zink-skill-store/src/vector-sync.mjs";
import { isSkillStoreWriterLockHeld } from "../zink-skill-store/src/catalog.mjs";
import {
  retireSkill,
  withSkillStoreWriterLock,
} from "../zink-skill-store/index.mjs";

const NAMESPACE = ["office"];
const CAPABILITY = "live-skill";
const VERSION = "1.0.0";

const ACTIVE_LIFECYCLE = [
  { status: "CANDIDATE", at: "2026-10-01T00:00:00Z", actor: "excel" },
  {
    status: "ACTIVE",
    at: "2026-10-01T01:00:00Z",
    actor: "owner",
    decision_ref: "PLAN:M11/T1-R1",
  },
];

async function writeActiveSkill(skillsRoot) {
  const versionDirectory = path.join(
    skillsRoot,
    ...NAMESPACE,
    CAPABILITY,
    VERSION,
  );
  await mkdir(versionDirectory, { recursive: true });
  const content = "# Live\n\nfixture body\n";
  const sha = createHash("sha256").update(content, "utf8").digest("hex");
  const manifest = {
    schema_version: 1,
    identity: {
      namespace: NAMESPACE,
      capability: CAPABILITY,
      version: VERSION,
    },
    content: { path: "SKILL.md", sha256: sha },
    provenance: { source_type: "research", references: [] },
    lifecycle: ACTIVE_LIFECYCLE,
  };
  await writeFile(path.join(versionDirectory, "SKILL.md"), content, "utf8");
  await writeFile(
    path.join(versionDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
}

const embedFn = async (texts) =>
  texts.map(() => new Array(EXPECTED_DIMENSIONS).fill(0.01));

test("F-429: the scan and tombstone prelude runs under the store writer lock", async () => {
  const skillsRoot = await mkdtemp(path.join(os.tmpdir(), "m12-f429-lock-"));
  try {
    await writeActiveSkill(skillsRoot);
    let lockHeldDuringTombstone = null;
    const report = await syncSkillsToVectorStore({
      skillsRoot,
      embedFn,
      dbExecutor: async (sql) => {
        if (/^\s*DELETE\s+FROM\s+skills\.catalog_index/iu.test(sql)) {
          lockHeldDuringTombstone = isSkillStoreWriterLockHeld(skillsRoot);
        }
        return "";
      },
    });

    assert.equal(report.status, "READY");
    assert.equal(
      lockHeldDuringTombstone,
      true,
      "the tombstone must run while this process holds the store writer lock",
    );
  } finally {
    await rm(skillsRoot, { recursive: true, force: true });
  }
});

test("F-429: a retirement during embedding is not re-marked READY", async () => {
  const skillsRoot = await mkdtemp(path.join(os.tmpdir(), "m12-f429-retire-"));
  try {
    await writeActiveSkill(skillsRoot);
    let retired = false;
    const statements = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot,
      embedFn: async (texts) => {
        if (!retired) {
          retired = true;
          await withSkillStoreWriterLock(skillsRoot, () =>
            retireSkill({
              skillsRoot,
              namespace: NAMESPACE,
              capability: CAPABILITY,
              version: VERSION,
              decisionRef: "PLAN:M12/T9-R4",
            }),
          );
        }
        return texts.map(() => new Array(EXPECTED_DIMENSIONS).fill(0.01));
      },
      dbExecutor: async (sql) => {
        statements.push(sql);
        return "";
      },
    });

    assert.equal(retired, true, "the fixture must retire mid-sync");
    assert.notEqual(
      report.status,
      "READY",
      `a lifecycle drift must not report READY: ${JSON.stringify(report)}`,
    );
    assert.equal(report.skills.length, 1);
    assert.equal(report.skills[0].sync_status, "FAILED");
    assert.match(report.skills[0].error, /SOURCE_LIFECYCLE_DRIFT/u);
    assert.ok(
      statements.every((sql) => !sql.includes("INSERT INTO skills.segments")),
      `no READY transaction may be written after the retirement: ${JSON.stringify(statements)}`,
    );
    assert.ok(
      statements.some(
        (sql) =>
          sql.includes("UPDATE skills.catalog_index") &&
          sql.includes("office|live-skill|1.0.0") &&
          sql.includes("TOMBSTONED"),
      ),
      `the retirement marker must be applied: ${JSON.stringify(statements)}`,
    );
  } finally {
    await rm(skillsRoot, { recursive: true, force: true });
  }
});
