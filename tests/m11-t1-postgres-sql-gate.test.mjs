//
// SKIP-FAMILY: postgres
//
// M12/T9 F-197 (R5-E09-03) / H3: this lane may skip, and it declares WHICH
// family it belongs to, so the skip-expectation gate can tell an explained
// skip from an unexplained one. The family-to-lane map is derived from the
// repository's own lane list; the expectation lives in
// `docs/contracts/ci-skip-expectations.json`.
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
import {
  retireSkill,
  withSkillStoreWriterLock,
} from "../zink-skill-store/index.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MIGRATIONS_DIR = path.join(REPO_ROOT, "apps", "knowledge", "migrations");
// M12/T9 F-094 (R5-E03-07) / H5: the `skills.*` schema moved to the module
// that owns it, so this gate applies the Skill Store's own migration set too.
// The statements under test read and write `skills.*`, so the gate MUST
// create that schema - from its owner, not from the Knowledgebase.
const SKILL_STORE_MIGRATIONS_DIR = path.join(
  REPO_ROOT,
  "zink-skill-store",
  "migrations",
);

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
 * The Skill Store's own migration set, in the order its runner applies it.
 */
function skillStoreMigrations() {
  return readdirSync(SKILL_STORE_MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      path: path.join(SKILL_STORE_MIGRATIONS_DIR, name),
    }));
}

/**
 * Every tracked migration of the repository, in the order they are applied:
 * the Knowledgebase's set first, then the Skill Store's own set.
 */
function everyTrackedMigration() {
  return [...trackedMigrations(), ...skillStoreMigrations()];
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
  for (const migration of everyTrackedMigration()) {
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
      everyTrackedMigration().map((migration) => migration.name),
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
      everyTrackedMigration().map((migration) => migration.name),
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

// ===========================================================================
// M12/T9 F-095 (R5-E04-05) / H8 - the governed retirement against real
// PostgreSQL.
//
// The retirement's derived-index statement is a data-modifying CTE: it drops
// the segments of the retired skill and marks its derived row
// `DEPRECATED`/`TOMBSTONED` in ONE statement. `003`'s CHECK constraints could
// not admit that state, so the Skill Store's own forward migration
// (`004_skill_retirement_state.sql`) widened them. This case executes the
// whole path against a real PostgreSQL: promote, sync, retire through the
// governed writer, sync again, and read the derived row back.
// ===========================================================================
test("F-095: the governed retirement is recorded in the derived index (real PostgreSQL)", async (t) => {
  if (!containerAvailable(t)) return;

  const dbName = `m12_t9_f095_${createHash("sha256")
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

    const root = await mkdtemp(path.join(os.tmpdir(), "m12-t9-f095-"));
    try {
      const content =
        "# Retirable\n\n" + "A body long enough to be a segment. ".repeat(200);
      await seedActiveSkill(root, content);
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
        `the first sync must reach READY; got ${JSON.stringify(ready).slice(0, 600)}`,
      );
      assert.equal(
        runSql(
          "SELECT status || '|' || sync_status FROM skills.catalog_index;",
        ),
        "ACTIVE|READY",
      );

      assert.ok(
        Number(runSql("SELECT count(*) FROM skills.segments;")) >= 1,
        "the synced skill must own its segment vectors",
      );

      // The governed retirement, through the store's public door and under
      // the store-wide writer lock.
      const retired = await withSkillStoreWriterLock(root, () =>
        retireSkill({
          skillsRoot: root,
          namespace: ["office"],
          capability: "gate-skill",
          version: "1.0.0",
          decisionRef: "PLAN:M12/T9-R3",
        }),
      );
      assert.equal(retired.status, "DEPRECATED");

      // The next sync records the retirement in the derived index.
      const resync = await syncSkillsToVectorStore({
        skillsRoot: root,
        embedFn: async (texts) =>
          texts.map(() => new Array(EXPECTED_DIMENSIONS).fill(0.01)),
        dbExecutor,
      });
      assert.equal(resync.status, "READY");
      assert.equal(
        runSql(
          "SELECT status || '|' || sync_status FROM skills.catalog_index;",
        ),
        "DEPRECATED|TOMBSTONED",
        "the derived row must carry the retirement instead of vanishing",
      );
      assert.equal(
        runSql("SELECT count(*) FROM skills.segments;"),
        "0",
        "the vectors of a retired skill must not survive its retirement",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  } finally {
    admin(`DROP DATABASE IF EXISTS ${dbName}`);
  }
});

// M12/T9 F-391: the reclamation's statement ORDER is proven on real
// PostgreSQL, not argued from a fake.
//
// `reclaim_pdf_content` deletes three derived relations and THEN moves the
// content build out of `READY`. That order is not a style choice: the link row
// (`knowledge.pdf_source_details`) carries `(build_id, build_status='READY')`
// and holds a foreign key to the build's `(id, status)`, so while the link
// exists the build CANNOT leave `READY` — PostgreSQL refuses the UPDATE.
//
// The Python lane exercises the same method against a fake connection that
// records statements; a recorder cannot tell an accepted order from a refused
// one. This case runs the writer's OWN statements — read out of its source, so
// there is no second copy to drift — against the container, and then proves the
// gate has teeth by running the reverse order and requiring the refusal.
const RECLAMATION_WRITER = path.join(
  REPO_ROOT,
  "apps",
  "knowledge",
  "app",
  "database.py",
);

function reclamationStatements() {
  const source = readFileSync(RECLAMATION_WRITER, "utf8");
  const start = source.indexOf("async def reclaim_pdf_content");
  assert.notEqual(
    start,
    -1,
    "apps/knowledge/app/database.py must declare reclaim_pdf_content",
  );
  const end = source.indexOf("\n    async def ", start + 1);
  const body = source.slice(start, end === -1 ? undefined : end);
  const call =
    /await connection\.(?:execute|fetchrow|fetchval)\(\s*("""[\s\S]*?"""|"(?:[^"\\]|\\.)*")/gu;
  const statements = [];
  for (const match of body.matchAll(call)) {
    // The capture keeps its delimiters: a triple-quoted block or a one-line
    // Python string. Strip exactly the delimiters that were captured.
    const literal = match[1];
    const sql = (
      literal.startsWith('"""') ? literal.slice(3, -3) : literal.slice(1, -1)
    ).trim();
    // The SELECTs count what is about to go; only the writes carry the order
    // this case is about.
    if (/^(?:DELETE|UPDATE)\b/u.test(sql)) statements.push(sql);
  }
  return statements;
}

function reclamationFixtureSql(prefix, identity, indexStatus = "ACTIVE") {
  const source = `${prefix}03`;
  return `
INSERT INTO knowledge.indexes (id, status, embedding_model_name, embedding_model_digest, embedding_dimensions, activated_at, superseded_at)
VALUES ('${prefix}01', '${indexStatus}', 'gate-embedding', '${"e".repeat(64)}', 1024, now(), ${indexStatus === "ACTIVE" ? "NULL" : "now()"});
INSERT INTO knowledge.index_runs (id, index_id, kind, status, finished_at)
VALUES ('${prefix}02', '${prefix}01', 'INCREMENTAL', 'SUCCEEDED', now());
INSERT INTO knowledge.sources (id, index_id, source_type, source_path, sha256, mime_type, title, primary_topic, indexed_by_run_id)
VALUES ('${source}', '${prefix}01', 'PDF', 'vault/gate-${prefix}.pdf', '${identity}', 'application/pdf', 'Gate PDF', 'gate', '${prefix}02');
INSERT INTO knowledge.pdf_content_builds (id, content_identity_digest, pdf_digest, sidecar_digest, processing_identity_digest, status, ready_at, finished_at)
VALUES ('${prefix}04', '${identity}', '${"b".repeat(64)}', '${"c".repeat(64)}', '${"d".repeat(64)}', 'READY', now(), now());
INSERT INTO knowledge.pdf_content_batches (id, build_id, page_start, page_end, status, started_at, finished_at)
VALUES ('${prefix}05', '${prefix}04', 1, 1, 'SUCCEEDED', now(), now());
INSERT INTO knowledge.pdf_content_segments (id, build_id, batch_id, ordinal, segment_type, content, page_start, page_end, provenance)
VALUES ('${prefix}06', '${prefix}04', '${prefix}05', 0, 'PDF_PASSAGE', 'derived text', 1, 1, '{"source":"gate"}');
INSERT INTO knowledge.pdf_source_details (index_id, source_id, build_id)
VALUES ('${prefix}01', '${source}', '${prefix}04');
INSERT INTO knowledge.segments (id, index_id, source_id, segment_type, chunk_ordinal, source_path, title, primary_topic, text, indexed_by_run_id)
VALUES ('${prefix}07', '${prefix}01', '${source}', 'PDF_PASSAGE', 0, 'vault/gate-${prefix}.pdf', 'Gate PDF', 'gate', 'published text', '${prefix}02');
`;
}

test("M12/T9 F-391: the reclamation's order is accepted by real PostgreSQL, and the reverse is refused", async (t) => {
  if (!containerAvailable(t)) return;

  const statements = reclamationStatements();
  assert.equal(
    statements.length,
    4,
    `the writer must issue four writes; read: ${statements.map((sql) => sql.slice(0, 40)).join(" | ")}`,
  );
  assert.match(
    statements[0],
    /^DELETE FROM knowledge\.pdf_source_details\b/u,
    "the link that pins the build to READY must go FIRST",
  );
  assert.match(
    statements[statements.length - 1],
    /^UPDATE knowledge\.pdf_content_builds\b/u,
    "the build may leave READY only after the link is gone",
  );

  const dbName = `m12_t9_f391_${createHash("sha256")
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
    const run = (sql) =>
      dockerExec(
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
    const runSql = (sql) => {
      const res = run(sql);
      if (res.status !== 0) {
        throw new Error(
          `psql rejected SQL (code ${res.status}): ${(res.stderr || res.stdout || "").slice(0, 400)}`,
        );
      }
      return (res.stdout || "").trim();
    };

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
    assert.deepEqual(
      appliedMigrations,
      everyTrackedMigration().map((migration) => migration.name),
      "the gate must apply EVERY tracked migration, in order",
    );

    // The writer's statements bind $1 (the build) and, for the terminal state,
    // $2 (the failure code). psql has no positional binding, so each runs as a
    // PREPARE/EXECUTE with the same parameters the writer passes.
    const runWriterStatement = (statement, index, buildId) => {
      const name = `f391_stmt_${index}`;
      const types = statement.includes("$2") ? "uuid, text" : "uuid";
      const args = statement.includes("$2")
        ? `'${buildId}', 'PDF_CONTENT_RECLAIMED'`
        : `'${buildId}'`;
      return runSql(
        `PREPARE ${name}(${types}) AS ${statement};\nEXECUTE ${name}(${args});\nDEALLOCATE ${name};`,
      );
    };

    // 1) The writer's own order must be ACCEPTED by real PostgreSQL.
    const accepted = "11111111-1111-4111-8111-1111111111";
    runSql(reclamationFixtureSql(accepted, "a".repeat(64)));
    statements.forEach((statement, index) =>
      runWriterStatement(statement, index, `${accepted}04`),
    );
    assert.equal(
      runSql(
        `SELECT count(*) FROM knowledge.pdf_source_details WHERE build_id = '${accepted}04';`,
      ),
      "0",
      "no link may still pin the reclaimed build",
    );
    assert.equal(
      runSql(
        `SELECT count(*) FROM knowledge.pdf_content_segments WHERE build_id = '${accepted}04';`,
      ),
      "0",
      "the extraction's segments are the copy that goes",
    );
    assert.equal(
      runSql(
        `SELECT count(*) FROM knowledge.pdf_content_batches WHERE build_id = '${accepted}04';`,
      ),
      "0",
      "the extraction's manifest is the copy that goes",
    );
    assert.equal(
      runSql(
        `SELECT status || '|' || coalesce(failure_code, '') FROM knowledge.pdf_content_builds WHERE id = '${accepted}04';`,
      ),
      "CANCELLED|PDF_CONTENT_RECLAIMED",
      "the build's terminal state is the record of the reclamation",
    );
    assert.equal(
      runSql(
        `SELECT count(*) FROM knowledge.segments WHERE source_id = '${accepted}03';`,
      ),
      "1",
      "the PUBLISHED (searchable) copy must survive the reclamation",
    );
    assert.equal(
      runSql(
        `SELECT count(*) FROM knowledge.sources WHERE id = '${accepted}03';`,
      ),
      "1",
      "the PDF's source row must survive the reclamation",
    );

    // 2) The reverse order must be REFUSED. This is the control that proves the
    // FK really pins the build to READY: if PostgreSQL accepted this, the first
    // half would prove nothing about order. The second fixture's index is
    // SUPERSEDED only because the schema allows a single ACTIVE index; the
    // control exercises the build/link foreign key, not index selection.
    const refused = "22222222-2222-4222-8222-2222222222";
    runSql(reclamationFixtureSql(refused, "f".repeat(64), "SUPERSEDED"));
    const reversal = run(
      `PREPARE f391_reversed(uuid, text) AS ${statements[statements.length - 1]};\nEXECUTE f391_reversed('${refused}04', 'PDF_CONTENT_RECLAIMED');`,
    );
    assert.notEqual(
      reversal.status,
      0,
      "PostgreSQL must refuse to move a build whose link still pins it to READY",
    );
    assert.match(
      `${reversal.stderr || ""}${reversal.stdout || ""}`,
      /foreign key|violates/iu,
      `the refusal must be the foreign key, not another error: ${(reversal.stderr || reversal.stdout || "").slice(0, 300)}`,
    );
    assert.equal(
      runSql(
        `SELECT status FROM knowledge.pdf_content_builds WHERE id = '${refused}04';`,
      ),
      "READY",
      "a refused transition must leave the build exactly as it was",
    );
    assert.equal(
      runSql(
        `SELECT count(*) FROM knowledge.pdf_source_details WHERE build_id = '${refused}04';`,
      ),
      "1",
      "a refused transition must leave the link exactly as it was",
    );
  } finally {
    admin(`DROP DATABASE IF EXISTS ${dbName}`);
  }
});
// ===========================================================================
// M12/T9-R4 F-443 (R9-T06-1) — two incremental passes over one PDF leave no
// build-and-batch residue.
//
// The Python lane proves the sweep ISSUES the right statement; a recorder
// cannot prove that the statement, run against the real schema, actually
// reaches the rows the link table can never name. This case runs the writer's
// OWN DELETE — read out of `database.py`, so there is no second copy to drift —
// over an accumulation a real database accepts: `002` makes the identity
// uniqueness partial over ('BUILDING','READY'), so every pass that ends FAILED
// commits one more build plus its whole batch set, and no cleanup path that
// names its candidates from `pdf_source_details` can ever see them.
//
// The control that gives the case teeth is the CANCELLED row: it is the
// owner's reclamation RECORD (F-444), it is equally unlinkable, and the sweep
// must leave it standing while it deletes the FAILED residue.
// ===========================================================================
const SWEEP_WRITER = path.join(
  REPO_ROOT,
  "apps",
  "knowledge",
  "app",
  "database.py",
);

function terminalSweepStatement() {
  const source = readFileSync(SWEEP_WRITER, "utf8");
  const start = source.indexOf("async def _retire_terminal_pdf_content_builds");
  assert.notEqual(
    start,
    -1,
    "apps/knowledge/app/database.py must declare _retire_terminal_pdf_content_builds",
  );
  const end = source.indexOf("\n    async def ", start + 1);
  const body = source.slice(start, end === -1 ? undefined : end);
  const call = /await connection\.execute\(\s*([\s\S]*?)\n\s*\)/u.exec(body);
  assert.ok(
    call,
    "the sweep must issue exactly one connection.execute — read the source",
  );
  const sql = [...call[1].matchAll(/"((?:[^"\\]|\\.)*)"/gu)]
    .map((fragment) => fragment[1])
    .join("")
    .trim();
  assert.match(
    sql,
    /^DELETE FROM knowledge\.pdf_content_builds\b/u,
    `the sweep's write must delete builds; read: ${sql.slice(0, 80)}`,
  );
  return sql;
}

const RESIDUE_BUILD = "22222222-2222-4222-8222-222222222201";
const RESIDUE_BATCH = "22222222-2222-4222-8222-222222222202";
const LATER_BUILD = "33333333-3333-4333-8333-333333333301";
const LATER_BATCH = "33333333-3333-4333-8333-333333333302";
const RECLAIMED_BUILD = "44444444-4444-4444-8444-444444444401";
const RECLAIMED_BATCH = "44444444-4444-4444-8444-444444444402";

function residueSql(buildId, batchId, identity, cause) {
  return `
INSERT INTO knowledge.pdf_content_builds
  (id, content_identity_digest, pdf_digest, sidecar_digest,
   processing_identity_digest, status, finished_at, failure_code, failure_cause)
VALUES ('${buildId}', '${identity}', '${"b".repeat(64)}', '${"c".repeat(64)}',
        '${"d".repeat(64)}', 'FAILED', now(), 'PDF_RUNTIME_FAILED', '${cause}');
INSERT INTO knowledge.pdf_content_batches
  (id, build_id, page_start, page_end, status, started_at, finished_at, failure_code)
VALUES ('${batchId}', '${buildId}', 1, 1, 'FAILED', now(), now(), 'PDF_RUNTIME_FAILED');
`;
}

function reclaimedSql(buildId, batchId, identity) {
  return `
INSERT INTO knowledge.pdf_content_builds
  (id, content_identity_digest, pdf_digest, sidecar_digest,
   processing_identity_digest, status, finished_at, failure_code)
VALUES ('${buildId}', '${identity}', '${"e".repeat(64)}', '${"f".repeat(64)}',
        '${"0".repeat(64)}', 'CANCELLED', now(), 'PDF_CONTENT_RECLAIMED');
INSERT INTO knowledge.pdf_content_batches
  (id, build_id, page_start, page_end, status, started_at, finished_at)
VALUES ('${batchId}', '${buildId}', 1, 1, 'SUCCEEDED', now(), now());
`;
}

test("M12/T9 F-443: two incremental passes over one PDF leave no build-and-batch residue", async (t) => {
  if (!containerAvailable(t)) return;

  const sweep = terminalSweepStatement();
  const dbName = `m12_t9_f443_${createHash("sha256")
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

    try {
      applyTrackedMigrations(dbName);
    } catch (error) {
      if (error?.migration === VECTOR_SCHEMA_MIGRATION) {
        t.skip(
          `pgvector/migration unavailable in container: ${String(error?.message ?? error).slice(0, 300)}`,
        );
        return;
      }
      throw error;
    }

    const published = "55555555-5555-4555-8555-5555555555";
    const PDF_IDENTITY = "a".repeat(64);
    // Pass 1 publishes the PDF: a READY build, its batch, its link.
    runSql(reclamationFixtureSql(published, PDF_IDENTITY));
    // Pass 2 over the SAME identity ends FAILED. PostgreSQL accepts it because
    // the identity uniqueness is partial over ('BUILDING','READY') — this is
    // the accumulation the sweep exists for.
    runSql(residueSql(RESIDUE_BUILD, RESIDUE_BATCH, PDF_IDENTITY, "exit=-9; stderr=Killed"));
    // An owner reclamation, which is terminal AND unlinkable, and must survive.
    runSql(reclaimedSql(RECLAIMED_BUILD, RECLAIMED_BATCH, "9".repeat(64)));

    assert.equal(
      runSql(`SELECT count(*) FROM knowledge.pdf_content_builds WHERE status = 'FAILED';`),
      "1",
      "the second pass must have left exactly one FAILED build",
    );

    runSql(`${sweep};`);

    assert.equal(
      runSql(`SELECT count(*) FROM knowledge.pdf_content_builds WHERE status = 'FAILED';`),
      "0",
      "the sweep must retire the FAILED build no link can name",
    );
    assert.equal(
      runSql(
        `SELECT count(*) FROM knowledge.pdf_content_batches WHERE build_id = '${RESIDUE_BUILD}';`,
      ),
      "0",
      "the residue's whole batch set goes with the build",
    );
    assert.equal(
      runSql(
        `SELECT status FROM knowledge.pdf_content_builds WHERE id = '${published}04';`,
      ),
      "READY",
      "the published build is never residue",
    );
    assert.equal(
      runSql(
        `SELECT status FROM knowledge.pdf_content_builds WHERE id = '${RECLAIMED_BUILD}';`,
      ),
      "CANCELLED",
      "the reclamation RECORD survives the sweep that takes the residue",
    );

    // Pass 3 over the same PDF, then the sweep again: the second cleanup must
    // reach the new accumulation and still leave every survivor alone.
    runSql(residueSql(LATER_BUILD, LATER_BATCH, PDF_IDENTITY, "exit=1; stderr=artifact missing"));
    runSql(`${sweep};`);

    assert.equal(
      runSql(`SELECT count(*) FROM knowledge.pdf_content_builds WHERE status = 'FAILED';`),
      "0",
      "a second sweep must retire the residue a later pass adds",
    );
    assert.equal(
      runSql(
        `SELECT count(*) FROM knowledge.pdf_content_batches WHERE build_id IN ('${RESIDUE_BUILD}', '${LATER_BUILD}');`,
      ),
      "0",
      "no batch of any retired build may survive",
    );
    assert.equal(
      runSql(
        `SELECT count(*) FROM knowledge.pdf_content_builds WHERE status IN ('READY','CANCELLED');`,
      ),
      "2",
      "the published build and the reclamation record are untouched by both sweeps",
    );
    assert.equal(
      runSql(
        `SELECT count(*) FROM knowledge.segments WHERE source_id = '${published}03';`,
      ),
      "1",
      "the published searchable copy must survive",
    );
  } finally {
    admin(`DROP DATABASE IF EXISTS ${dbName}`);
  }
});


// ===========================================================================
// M12/T9-R4 F-509 (R10-L05-2) — the retirement state's postcondition, fired.
//
// 004 widens two CHECK constraints and verifies only the status one. The harm
// is unreachable by the ordinary path (003 creates both unnamed, so PostgreSQL
// auto-names them to the names 004 drops), which is why the row is LATENT: it
// needs a database whose narrow `sync_status` CHECK carries a DIFFERENT name.
// That is exactly what this case injects. 005 must refuse that database,
// leaving the migration unrecorded instead of freezing an unreachable domain
// as applied.
//
// The static, non-skippable half of the same invariant lives in
// `tests/m11-t1-skill-vector-sql.test.mjs` (F-509), because this family may
// skip (F-481's ceiling).
// ===========================================================================
test("F-509: a surviving narrow sync_status CHECK is refused by the postcondition", async (t) => {
  if (!containerAvailable(t)) return;

  const dbName = `m12_t9r4_f509_${createHash("sha256")
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
  const runFile = (name, sql) =>
    dockerExec(
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
  const migrationSql = (name) =>
    readFileSync(path.join(SKILL_STORE_MIGRATIONS_DIR, name), "utf8");
  const runSql = (sql) =>
    String(
      dockerExec([
        "psql",
        "-U",
        "postgres",
        "-d",
        dbName,
        "--set=ON_ERROR_STOP=1",
        "-t",
        "-A",
        "-c",
        sql,
      ]).stdout ?? "",
    ).trim();

  const created = admin(`CREATE DATABASE ${dbName}`);
  if (created.status !== 0) {
    t.skip(
      `could not create scratch database: ${created.stderr?.slice(0, 200)}`,
    );
    return;
  }

  try {
    const schema = runFile(
      "003_skills_vector_schema.sql",
      migrationSql("003_skills_vector_schema.sql"),
    );
    if (schema.status !== 0) {
      t.skip(
        `pgvector/migration unavailable in container: ${(schema.stderr || "").slice(0, 300)}`,
      );
      return;
    }

    // The injected pre-adoption shape: the same narrow domain under a name
    // that 004's `DROP CONSTRAINT IF EXISTS` cannot match.
    const injected = runFile(
      "inject",
      "ALTER TABLE skills.catalog_index ADD CONSTRAINT hand_named_narrow_sync " +
        "CHECK (sync_status IN ('PENDING','READY','FAILED'));\n",
    );
    assert.equal(
      injected.status,
      0,
      `the narrow CHECK must be creatable: ${(injected.stderr || "").slice(0, 300)}`,
    );

    const widening = runFile(
      "004_skill_retirement_state.sql",
      migrationSql("004_skill_retirement_state.sql"),
    );
    assert.equal(
      widening.status,
      0,
      `004 must apply over the narrow CHECK: ${(widening.stderr || "").slice(0, 300)}`,
    );
    assert.equal(
      runSql(
        `SELECT count(*) FROM pg_constraint con
           JOIN pg_class rel ON rel.oid = con.conrelid
           JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
          WHERE nsp.nspname = 'skills' AND rel.relname = 'catalog_index'
            AND con.contype = 'c'
            AND pg_get_constraintdef(con.oid) LIKE '%sync_status%'
            AND pg_get_constraintdef(con.oid) NOT LIKE '%TOMBSTONED%';`,
      ),
      "1",
      "the injected narrow CHECK must still be there: that is the state the row is about",
    );

    const verification = runFile(
      "005_retirement_state_domain_verification.sql",
      migrationSql("005_retirement_state_domain_verification.sql"),
    );
    assert.notEqual(
      verification.status,
      0,
      "the postcondition must REFUSE a database that still carries a narrow sync_status CHECK",
    );
    assert.match(
      `${verification.stderr ?? ""}${verification.stdout ?? ""}`,
      /TOMBSTONED retirement state/u,
      "the refusal must name the domain it could not prove",
    );
  } finally {
    admin(`DROP DATABASE IF EXISTS ${dbName}`);
  }
});
