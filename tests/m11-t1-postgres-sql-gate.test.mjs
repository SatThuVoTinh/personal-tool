// M11/T1 Phase 1 — real-PostgreSQL SQL gate.
//
// Every prior vector-sync test mocked the executor, which is exactly how an
// `unnest(ARRAY[{...}]::text[])` syntax error and schema-impossible
// DEPRECATED/TOMBSTONED writes survived to this audit. This gate executes the
// REAL generated statements against the local M2 PostgreSQL container inside
// a scratch database that is created and dropped by the gate itself. If
// Docker or the container is unavailable the gate skips itself honestly (the
// skip is recorded at task closeout; it is never converted into a pass).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";

import { syncSkillsToVectorStore } from "../zink-skill-store/src/vector-sync.mjs";
import { skillStoreIdentityPath } from "../zink-skill-store/src/catalog.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MIGRATIONS_DIR = path.join(REPO_ROOT, "apps", "knowledge", "migrations");
const CONTAINER = process.env.POSTGRES_CONTAINER || "personal-tool-postgres-1";
const EXPECTED_DIMENSIONS = 1024;
// The migration that creates the `skills` schema the gate's statements read.
// It needs the pgvector extension, so a container without pgvector skips the
// lane; every OTHER tracked migration failing is a real defect and must be
// red, not a skip.
const VECTOR_SCHEMA_MIGRATION = "003_skills_vector_schema.sql";
// M12/T9 F-176: the identity this gate's scratch store carries.
const GATE_STORE_ID = "m11-postgres-gate-store";

/**
 * Every tracked migration, in the order the runtime applies them.
 *
 * The gate used to apply the vector-schema migration alone, so
 * `001_initial.sql` and `002_pdf_ingestion_foundation.sql` never executed
 * against a real PostgreSQL in any lane and their defects stayed
 * undetectable. The set is read from the tracked directory, so a migration
 * added later is picked up instead of silently skipped.
 */
function trackedMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, path: path.join(MIGRATIONS_DIR, name) }));
}

/**
 * Apply every tracked migration, in order, to the scratch database and report
 * the set that was applied.
 *
 * The runtime creates the `knowledge` schema before it applies the migrations
 * (apps/knowledge/app/database.py), so the gate does the same; the migrations
 * themselves only create objects INSIDE that schema.
 */
function applyTrackedMigrations(dbName) {
  const bootstrap = dockerExec([
    "psql",
    "-U",
    "postgres",
    "-d",
    dbName,
    "--set=ON_ERROR_STOP=1",
    "-t",
    "-A",
    "-c",
    "CREATE SCHEMA IF NOT EXISTS knowledge;",
  ]);
  if (bootstrap.status !== 0) {
    throw new Error(
      `could not create the knowledge schema: ${(bootstrap.stderr || bootstrap.stdout || "").slice(0, 400)}`,
    );
  }
  const applied = [];
  for (const migration of trackedMigrations()) {
    const sql = readFileSync(migration.path, "utf8");
    const res = dockerExec(
      [
        "psql",
        "-U",
        "postgres",
        "-d",
        dbName,
        "--set=ON_ERROR_STOP=1",
        "-t",
        "-A",
        "-f",
        "-",
      ],
      sql,
    );
    if (res.status !== 0) {
      const failure = new Error(
        `tracked migration ${migration.name} did not apply: ${(res.stderr || res.stdout || "").slice(0, 400)}`,
      );
      failure.migration = migration.name;
      throw failure;
    }
    applied.push(migration.name);
  }
  return applied;
}

function dockerExec(args, input) {
  const res = spawnSync("docker", ["exec", "-i", CONTAINER, ...args], {
    input,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return res;
}

function containerAvailable(t) {
  const probe = spawnSync("docker", ["inspect", CONTAINER], {
    encoding: "utf8",
  });
  if (probe.error || probe.status !== 0) {
    t.skip(`docker container ${CONTAINER} unavailable`);
    return false;
  }
  return true;
}

async function seedActiveSkill(root, contentText) {
  const dir = path.join(root, "office", "gate-skill", "1.0.0");
  await mkdir(dir, { recursive: true });
  const sha = createHash("sha256").update(contentText, "utf8").digest("hex");
  const manifest = {
    schema_version: 1,
    identity: {
      namespace: ["office"],
      capability: "gate-skill",
      version: "1.0.0",
    },
    content: { path: "SKILL.md", sha256: sha },
    provenance: { source_type: "research", references: [] },
    lifecycle: [
      { status: "CANDIDATE", at: "2026-10-01T00:00:00Z", actor: "excel" },
      {
        status: "ACTIVE",
        at: "2026-10-01T01:00:00Z",
        actor: "owner",
        decision_ref: "PLAN:M11/T1-R1",
      },
    ],
  };
  await writeFile(path.join(dir, "SKILL.md"), contentText, "utf8");
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
}

test("M11-06: generated statements execute against real PostgreSQL (scratch DB)", async (t) => {
  if (!containerAvailable(t)) return;

  const dbName = `m11_t1_gate_${createHash("sha256")
    .update(String(Math.random()))
    .digest("hex")
    .slice(0, 10)}`;
  const create = dockerExec([
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "--set=ON_ERROR_STOP=1",
    "-t",
    "-A",
    "-c",
    `CREATE DATABASE ${dbName}`,
  ]);
  if (create.status !== 0) {
    t.skip(
      `could not create scratch database: ${create.stderr?.slice(0, 200)}`,
    );
    return;
  }

  try {
    // Every tracked migration, in order. The gate used to apply the
    // vector-schema migration alone, so the other two never executed against
    // a real PostgreSQL in any lane.
    let appliedMigrations;
    try {
      appliedMigrations = applyTrackedMigrations(dbName);
    } catch (error) {
      if (error?.migration === VECTOR_SCHEMA_MIGRATION) {
        t.skip(
          `pgvector/migration unavailable in container: ${String(error?.message ?? error).slice(0, 300)}`,
        );
        return;
      }
      throw error;
    }
    t.diagnostic(
      `tracked migrations applied: ${appliedMigrations.join(", ") || "(none)"}`,
    );
    assert.deepEqual(
      appliedMigrations,
      trackedMigrations().map((migration) => migration.name),
      "the gate must apply EVERY tracked migration, in order",
    );

    const runSql = (sql) => {
      const res = dockerExec(
        [
          "psql",
          "-U",
          "postgres",
          "-d",
          dbName,
          "--set=ON_ERROR_STOP=1",
          "-t",
          "-A",
          "-f",
          "-",
        ],
        sql,
      );
      if (res.status !== 0) {
        throw new Error(
          `psql rejected SQL (code ${res.status}): ${(res.stderr || res.stdout || "").slice(0, 400)}`,
        );
      }
      return (res.stdout || "").trim();
    };

    const root = await mkdtemp(path.join(os.tmpdir(), "m11-gate-"));
    // M12/T9 F-176: the store is NAMED before it is synced. The scratch store
    // carries its identity beside its root and the sync is told which store it
    // is talking to, because the empty-catalog tombstone below removes EVERY
    // derived row - a tombstone that must never run against a store nobody
    // named.
    const identityFile = skillStoreIdentityPath(root);
    await writeFile(
      identityFile,
      `${JSON.stringify({ schema_version: 1, store_id: GATE_STORE_ID }, null, 2)}\n`,
      "utf8",
    );
    try {
      const content =
        "# Owner's \"weird\" rule\n\nBody with quote ' and backslash \\ and a second heading.\n\n## Sub 'section'\n\nMore body.";
      await seedActiveSkill(root, content);

      const report = await syncSkillsToVectorStore({
        skillsRoot: root,
        expectedStoreId: GATE_STORE_ID,
        embedFn: async (texts) =>
          texts.map(() => new Array(EXPECTED_DIMENSIONS).fill(0.01)),
        dbExecutor: async (sql) => runSql(sql),
      });
      assert.equal(
        report.status,
        "READY",
        `sync report must reach READY; got ${JSON.stringify(report).slice(0, 500)}`,
      );

      const rows = runSql(
        "SELECT status || '|' || sync_status FROM skills.catalog_index;",
      );
      assert.equal(rows, "ACTIVE|READY");
      const segCount = runSql("SELECT count(*) FROM skills.segments;");
      assert.ok(
        Number(segCount) >= 2,
        `expected multiple segments, got ${segCount}`,
      );

      // The apostrophe-bearing heading must round-trip through the array
      // literal exactly once (escape layers correct against the real parser).
      const heading = runSql(
        "SELECT heading_path FROM skills.segments WHERE segment_ordinal = 0;",
      );
      assert.ok(
        heading.includes("Owner's") && heading.includes('\\"weird\\"'),
        `heading must round-trip both escape layers, got: ${heading}`,
      );

      // Tombstone against real SQL: remove the skill from canonical state and
      // resync with an empty catalog — the derived row must be deleted.
      await rm(path.join(root, "office"), { recursive: true, force: true });
      const resync = await syncSkillsToVectorStore({
        skillsRoot: root,
        expectedStoreId: GATE_STORE_ID,
        embedFn: async (texts) =>
          texts.map(() => new Array(EXPECTED_DIMENSIONS).fill(0.01)),
        dbExecutor: async (sql) => runSql(sql),
      });
      assert.equal(resync.status, "READY");
      const remaining = runSql("SELECT count(*) FROM skills.catalog_index;");
      assert.equal(
        remaining,
        "0",
        "tombstone must remove derived rows via real SQL",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(identityFile, { force: true });
    }
  } finally {
    dockerExec([
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "--set=ON_ERROR_STOP=1",
      "-c",
      `DROP DATABASE IF EXISTS ${dbName}`,
    ]);
  }
});

// ===========================================================================
// M12/T2.2-R3 `R3-12` (owner grant `n1`, 2026-10-17) — the failure-path
// statement has now executed against real PostgreSQL at least once in the
// tracked tree. `M11-06` proves the READY transaction and the tombstone;
// `failSql` was previously only ever read as a string by
// `tests/m11-t1-skill-vector-sql.test.mjs`, which left this band's own
// acceptance line ("after a failed sync no segment row survives for a skill
// whose catalog row is not READY") unprovable from the repository.
//
// `M11-06`'s body is deliberately NOT refactored into a shared helper: `n1`
// admitted a new lane, not a rewrite of the assertions that are M11/T1's
// accepted evidence. The scratch-database prologue is duplicated on purpose.
// ===========================================================================
test("R3-12: the failure statement runs on real PostgreSQL and clears the segments", async (t) => {
  if (!containerAvailable(t)) return;

  const dbName = `m12_t22r3_${createHash("sha256")
    .update(String(Math.random()))
    .digest("hex")
    .slice(0, 10)}`;
  const admin = (statement) =>
    dockerExec([
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "--set=ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-c",
      statement,
    ]);

  const created = admin(`CREATE DATABASE ${dbName}`);
  if (created.status !== 0) {
    t.skip(
      `could not create scratch database: ${created.stderr?.slice(0, 200)}`,
    );
    return;
  }

  try {
    const runSql = (sql) => {
      const res = dockerExec(
        [
          "psql",
          "-U",
          "postgres",
          "-d",
          dbName,
          "--set=ON_ERROR_STOP=1",
          "-t",
          "-A",
          "-f",
          "-",
        ],
        sql,
      );
      if (res.status !== 0) {
        throw new Error(
          `psql rejected SQL (code ${res.status}): ${(res.stderr || res.stdout || "").slice(0, 400)}`,
        );
      }
      return (res.stdout || "").trim();
    };

    // Every tracked migration, in order (see the M11-06 case above).
    let appliedMigrations;
    try {
      appliedMigrations = applyTrackedMigrations(dbName);
    } catch (error) {
      if (error?.migration === VECTOR_SCHEMA_MIGRATION) {
        t.skip(
          `pgvector/migration unavailable in container: ${String(error?.message ?? error).slice(0, 300)}`,
        );
        return;
      }
      throw error;
    }
    t.diagnostic(
      `tracked migrations applied: ${appliedMigrations.join(", ") || "(none)"}`,
    );
    assert.deepEqual(
      appliedMigrations,
      trackedMigrations().map((migration) => migration.name),
      "the gate must apply EVERY tracked migration, in order",
    );

    const root = await mkdtemp(path.join(os.tmpdir(), "m12-r3-12-"));
    try {
      const content =
        "# Failure lane\n\n" +
        "A body long enough to be a real segment. ".repeat(200) +
        "\n\n## Second section\n\n" +
        "A second heading is what gives the chunker a split point, so the READY " +
        "path leaves more than one row to clear. ".repeat(200);
      await seedActiveSkill(root, content);
      const sha = createHash("sha256").update(content, "utf8").digest("hex");
      const dbExecutor = async (sql) => runSql(sql);

      const ready = await syncSkillsToVectorStore({
        skillsRoot: root,
        embedFn: async (texts) =>
          texts.map(() => new Array(EXPECTED_DIMENSIONS).fill(0.01)),
        dbExecutor,
      });
      assert.equal(
        ready.status,
        "READY",
        `the lane must start from a real READY sync; got ${JSON.stringify(ready).slice(0, 400)}`,
      );
      const readySegments = runSql("SELECT count(*) FROM skills.segments;");
      assert.ok(
        Number(readySegments) >= 2,
        `the READY sync must have left several segment rows, got ${readySegments}`,
      );

      const failed = await syncSkillsToVectorStore({
        skillsRoot: root,
        embedFn: async () => {
          throw new Error("EMBEDDING_ENDPOINT_DOWN_SIMULATION");
        },
        dbExecutor,
      });
      assert.equal(failed.failed_count, 1);
      assert.notEqual(
        failed.error_code,
        "VECTOR_FAILURE_WRITE_FAILED",
        `real psql must accept the failure statement; report was ${JSON.stringify(failed).slice(0, 400)}`,
      );

      const row = runSql(
        "SELECT status || '|' || sync_status || '|' || source_sha256 || '|' || domain FROM skills.catalog_index;",
      );
      assert.equal(
        row,
        `ACTIVE|FAILED|${sha}|office`,
        "the failed row must advertise the digest it failed on and the derived taxonomy",
      );
      assert.equal(
        runSql("SELECT count(*) FROM skills.segments;"),
        "0",
        "no segment row may survive under a catalog row that is not READY",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  } finally {
    admin(`DROP DATABASE IF EXISTS ${dbName}`);
  }
});
