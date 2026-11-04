// M12/T9-R4 B6 — F-431 (legacy R9-L06-6).
//
// The Skill Store migration runner committed the DDL transaction and then ran
// the ledger INSERT as a SEPARATE unlocked statement with no ON CONFLICT
// against the `version text PRIMARY KEY`, so two concurrent first-run syncs
// both passed the recorded-digest skip check and the loser threw a primary-key
// violation AFTER its DDL committed — stamping INDEX_FAILED on a healthy
// promotion. A process dying between the COMMIT and the INSERT left the file
// unrecorded and re-sent committed DDL cold.
//
// This lane pins the acceptance criteria:
//   1. deterministic structural probe (no database): the ledger write ships in
//      the SAME BEGIN/COMMIT block as the DDL and carries ON CONFLICT — the
//      probe goes red the moment the INSERT moves back outside the
//      transaction;
//   2. real-database concurrency test: two raced first-run applications of the
//      real migration set against a scratch database both succeed and the
//      ledger holds exactly one row per version. It skips deterministically
//      when the shared PostgreSQL container is unavailable (NOT RUN, never a
//      pass).
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_URL = pathToFileURL(
  path.join(REPO, "zink-skill-store", "src", "migrations.mjs"),
).href;
const { applySkillStoreMigrations, SKILL_STORE_LEDGER } = await import(
  MIGRATIONS_URL
);

const CONTAINER = process.env.POSTGRES_CONTAINER || "personal-tool-postgres-1";
const SCRATCH_DB = "m12_t9_f431_scratch";

test("F-431: the ledger write is atomic with the DDL and idempotent on the version key", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12-t9-f431-"));
  try {
    const migrationsDir = path.join(root, "migrations");
    await mkdir(migrationsDir, { recursive: true });
    const sql = "CREATE SCHEMA IF NOT EXISTS f431_probe;\n";
    await writeFile(path.join(migrationsDir, "001_probe.sql"), sql, "utf8");
    const digest = createHash("sha256").update(Buffer.from(sql)).digest("hex");
    const manifestPath = path.join(root, "digests.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        migrations: [{ file: "001_probe.sql", sha256: digest }],
      }),
      "utf8",
    );

    const statements = [];
    await applySkillStoreMigrations({
      migrationsDir,
      digestManifestPath: manifestPath,
      dbExecutor: async (query) => {
        statements.push(query);
        return "";
      },
    });

    const ledgerWrites = statements.filter((query) =>
      query.includes(`INSERT INTO ${SKILL_STORE_LEDGER}`),
    );
    assert.equal(
      ledgerWrites.length,
      1,
      `exactly one ledger write must ship, got ${JSON.stringify(statements)}`,
    );
    const write = ledgerWrites[0];
    // Same transaction as the DDL ...
    assert.ok(
      write.includes("BEGIN;") && write.includes("COMMIT;"),
      `the ledger write must ride in the DDL transaction, got ${write}`,
    );
    assert.ok(
      write.includes(sql.trim()),
      `the DDL must ride in the same block, got ${write}`,
    );
    // ... and idempotent against the version PRIMARY KEY.
    assert.match(
      write,
      /ON CONFLICT \(version\) DO NOTHING/u,
      `the ledger write must be idempotent on version, got ${write}`,
    );
    // No separate unlocked INSERT survives anywhere in the sequence.
    assert.ok(
      statements.every(
        (query) =>
          !query.includes(`INSERT INTO ${SKILL_STORE_LEDGER}`) ||
          query.includes("BEGIN;"),
      ),
      "no ledger INSERT may run outside a transaction",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function psql(database, sql) {
  const res = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      database,
      "--set=ON_ERROR_STOP=1",
      "-t",
      "-A",
    ],
    { input: sql, encoding: "utf8" },
  );
  if (res.status !== 0) {
    throw new Error(
      `psql -d ${database} failed (${res.status}): ${(res.stderr || res.stdout || "").slice(0, 400)}`,
    );
  }
  return (res.stdout || "").trim();
}

function dockerAvailable() {
  const probe = spawnSync("docker", ["inspect", CONTAINER], {
    encoding: "utf8",
  });
  return probe.status === 0;
}

test("F-431: two raced first-run applications both succeed on real PostgreSQL", async (t) => {
  if (!dockerAvailable()) {
    t.skip(`docker container ${CONTAINER} unavailable`);
    return;
  }
  psql("postgres", `DROP DATABASE IF EXISTS ${SCRATCH_DB};`);
  psql("postgres", `CREATE DATABASE ${SCRATCH_DB};`);
  try {
    // The race is forced with two barriers, not with scheduling luck. A must not
    // enter its transaction until B has run its first recorded-digest SELECT, so
    // B provably reads the empty ledger; B must not enter its transaction until
    // A has fully committed, so B's INSERT is the raced loser. Under a loaded
    // full-suite run the old single gate let A finish before B even started, and
    // B then legitimately skipped every file — an empty `applied`, not a defect.
    let signalBRead;
    const bReadFirst = new Promise((resolve) => {
      signalBRead = resolve;
    });
    let releaseB;
    const aDone = new Promise((resolve) => {
      releaseB = resolve;
    });
    let aWaited = false;
    let bSignalled = false;
    const executorA = async (sql) => {
      if (!aWaited && sql.includes("BEGIN;")) {
        aWaited = true;
        await bReadFirst;
      }
      return psql(SCRATCH_DB, sql);
    };
    const executorB = async (sql) => {
      if (!bSignalled && sql.includes("SELECT sha256 FROM")) {
        bSignalled = true;
        const selected = psql(SCRATCH_DB, sql);
        signalBRead();
        return selected;
      }
      if (sql.includes("BEGIN;")) await aDone;
      return psql(SCRATCH_DB, sql);
    };
    const runnerA = applySkillStoreMigrations({ dbExecutor: executorA });
    const runnerB = applySkillStoreMigrations({ dbExecutor: executorB });
    const settledA = runnerA.then(
      (value) => {
        releaseB();
        return value;
      },
      (error) => {
        releaseB();
        throw error;
      },
    );
    const [a, b] = await Promise.all([settledA, runnerB]);
    assert.ok(a.applied.length > 0, "runner A must apply the migration set");
    assert.ok(b.applied.length > 0, "the raced runner must not lose");
    const rows = psql(
      SCRATCH_DB,
      `SELECT count(*) FROM ${SKILL_STORE_LEDGER};`,
    );
    assert.equal(rows, String(a.applied.length));
  } finally {
    psql("postgres", `DROP DATABASE IF EXISTS ${SCRATCH_DB};`);
  }
});
