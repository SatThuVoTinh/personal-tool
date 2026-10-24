// M12/T9-R4 B6 — F-428 (legacy R9-L06-2).
//
// `scanCatalog` returns healthy records beside diagnostics. The sync treated
// every DEPRECATED record as proven and built its tombstone key without
// checking that the record had no errors or that its identity matched its
// directory. One mis-filed DEPRECATED manifest therefore retired a live skill's
// derived row before the CATALOG_INVALID return; a string namespace crashed
// tombstoneKey with a TypeError instead of the named refusal.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  syncSkillsToVectorStore,
  tombstoneKey,
  recordIdentityMatchesPath,
  EXPECTED_DIMENSIONS,
} from "../zink-skill-store/src/vector-sync.mjs";

const ACTIVE_LIFECYCLE = [
  { status: "CANDIDATE", at: "2026-10-01T00:00:00Z", actor: "excel" },
  {
    status: "ACTIVE",
    at: "2026-10-01T01:00:00Z",
    actor: "owner",
    decision_ref: "PLAN:M11/T1-R1",
  },
];
const DEPRECATED_LIFECYCLE = [
  ...ACTIVE_LIFECYCLE,
  {
    status: "DEPRECATED",
    at: "2026-10-02T00:00:00Z",
    actor: "owner",
    decision_ref: "PLAN:M11/T1-R2",
  },
];

async function writeSkill(root, directory, identity, lifecycle) {
  const versionDirectory = path.join(root, ...directory, "1.0.0");
  await mkdir(versionDirectory, { recursive: true });
  const content = `# ${identity.capability}\n\nfixture body\n`;
  const sha = createHash("sha256").update(content, "utf8").digest("hex");
  const manifest = {
    schema_version: 1,
    identity,
    content: { path: "SKILL.md", sha256: sha },
    provenance: { source_type: "research", references: [] },
    lifecycle,
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

test("F-428: an error-bearing DEPRECATED record cannot retire a live skill", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12-f428-misfiled-"));
  try {
    await writeSkill(
      root,
      ["office", "live-skill"],
      { namespace: ["office"], capability: "live-skill", version: "1.0.0" },
      ACTIVE_LIFECYCLE,
    );
    // The manifest claims the live identity, but it is filed under a different
    // capability. scanCatalog records IDENTITY_PATH_MISMATCH and still returns
    // the record; the sync must not treat its DEPRECATED lifecycle as proof.
    await writeSkill(
      root,
      ["office", "decoy-skill"],
      { namespace: ["office"], capability: "live-skill", version: "1.0.0" },
      DEPRECATED_LIFECYCLE,
    );

    const statements = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn,
      dbExecutor: async (sql) => {
        statements.push(sql);
        return "";
      },
    });

    assert.equal(report.status, "FAILED");
    assert.equal(report.error_code, "CATALOG_INVALID");
    assert.ok(
      (report.details ?? []).some(
        (entry) => entry.code === "IDENTITY_PATH_MISMATCH",
      ),
      `the refusal must name the mismatch, got ${JSON.stringify(report.details)}`,
    );
    assert.ok(
      statements.every((sql) => !sql.includes("office|live-skill|1.0.0")),
      `no statement may retire the live skill: ${JSON.stringify(statements)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-428: a path-matching DEPRECATED record with a scan error cannot be retired", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12-f428-errorful-"));
  try {
    await writeSkill(
      root,
      ["office", "errorful-skill"],
      {
        namespace: ["office"],
        capability: "errorful-skill",
        version: "1.0.0",
      },
      DEPRECATED_LIFECYCLE,
    );
    // The identity matches its directory, but the body no longer matches the
    // manifest digest. The scan records CONTENT_DIGEST_MISMATCH; the record is
    // not proof of retirement and its key must not reach the marker.
    await writeFile(
      path.join(root, "office", "errorful-skill", "1.0.0", "SKILL.md"),
      "# errorful-skill\n\ndifferent fixture body\n",
      "utf8",
    );

    const statements = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn,
      dbExecutor: async (sql) => {
        statements.push(sql);
        return "";
      },
    });

    assert.equal(report.status, "FAILED");
    assert.equal(report.error_code, "CATALOG_INVALID");
    assert.ok(
      (report.details ?? []).some(
        (entry) => entry.code === "CONTENT_DIGEST_MISMATCH",
      ),
      `the refusal must name the digest mismatch, got ${JSON.stringify(report.details)}`,
    );
    assert.ok(
      statements.every((sql) => !sql.includes("office|errorful-skill|1.0.0")),
      `no statement may retire an unproven record: ${JSON.stringify(statements)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-428: a malformed DEPRECATED namespace yields CATALOG_INVALID, not a crash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12-f428-shape-"));
  try {
    await writeSkill(
      root,
      ["office", "malformed-skill"],
      {
        namespace: "office",
        capability: "malformed-skill",
        version: "1.0.0",
      },
      DEPRECATED_LIFECYCLE,
    );

    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn,
      dbExecutor: async () => "",
    });

    assert.equal(report.status, "FAILED");
    assert.equal(report.error_code, "CATALOG_INVALID");
    assert.ok(
      (report.details ?? []).some(
        (entry) => entry.code === "MANIFEST_SCHEMA_INVALID",
      ),
      `the refusal must name the schema diagnostic, got ${JSON.stringify(report.details)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-428: tombstoneKey refuses a malformed identity by name", () => {
  assert.throws(
    () =>
      tombstoneKey({
        namespace: "office",
        capability: "malformed-skill",
        version: "1.0.0",
      }),
    (error) =>
      error?.code === "CATALOG_INVALID" && /namespace/iu.test(error.message),
    "a string namespace must be a named CATALOG_INVALID, not a TypeError",
  );
});

// The retirement path is destructive: it deletes a live skill's derived row.
// F-428 names a path-matching identity as the second condition, so the predicate
// is proven by execution. At this HEAD a mismatch always arrives beside an
// IDENTITY_PATH_MISMATCH diagnostic, which is why the filter below, not a catalog
// fixture, is the level at which it can be measured.
test("F-428: the identity/path predicate decides on its own terms", () => {
  const identity = {
    namespace: ["office"],
    capability: "live-skill",
    version: "1.0.0",
  };
  assert.equal(
    recordIdentityMatchesPath({
      manifest: { identity },
      expected: identity,
    }),
    true,
    "a manifest that names its own directory is proof",
  );
  assert.equal(
    recordIdentityMatchesPath({
      manifest: { identity },
      expected: {
        namespace: ["office"],
        capability: "decoy-skill",
        version: "1.0.0",
      },
    }),
    false,
    "a manifest filed under another capability is not proof",
  );
  assert.equal(
    recordIdentityMatchesPath({
      manifest: { identity: { ...identity, namespace: "office" } },
      expected: identity,
    }),
    false,
    "a malformed namespace is not proof either",
  );
  assert.equal(
    recordIdentityMatchesPath({ manifest: { identity } }),
    false,
    "a record the catalog gave no expectation for is not proof",
  );
});
