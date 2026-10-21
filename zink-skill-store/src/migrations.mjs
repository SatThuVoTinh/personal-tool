/**
 * M12/T9 F-094 (R5-E03-07) / H5 — the Skill Store's OWN migration runner.
 *
 * The `skills.*` schema used to be filed under `apps/knowledge/migrations/`,
 * so the Knowledgebase's migration runner applied a PEER module's DDL on every
 * boot. That is the ownership violation `AGENTS.md` §9 names: no module may
 * mutate another owner's persistence, and a Skill Store schema change needed a
 * Knowledgebase release.
 *
 * The owner decided `H5`: the `skills.*` DDL and the migration runner move into
 * `zink-skill-store/`, the module that owns the Skill Store's persistence. The
 * decision is about DDL PLACEMENT only: no data is moved, no applied migration
 * is edited (the applied ones are keyed by filename and digest-pinned), and
 * the Skill Store keeps its OWN migration ledger.
 *
 * This module is that runner and that ledger:
 *
 *   - the migration set is `zink-skill-store/migrations/*.sql`, applied in
 *     filename order;
 *   - the ledger is `skills.schema_migrations` — the Skill Store's OWN table,
 *     in the Skill Store's OWN schema. The Knowledgebase's
 *     `knowledge.schema_migrations` is never read and never written here;
 *   - an applied migration is keyed by filename AND pinned by its SHA-256. A
 *     file whose bytes changed after it was applied is REFUSED, never
 *     re-applied: the only correct action is a NEW forward migration.
 *
 * The runner is a trusted internal seam. It is published through the store's
 * public door (`zink-skill-store/index.mjs`) and never as a model-visible
 * action: applying a schema is an operator/deployment step, not a tool call.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { escapeSqlLiteral, executePostgresQuery } from "./vector-sync.mjs";

/** The Skill Store's own migration set, beside this module. */
export const SKILL_STORE_MIGRATIONS_DIR = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

/**
 * The Skill Store's own migration ledger.
 *
 * A table in the Skill Store's own schema, keyed by the migration's filename.
 * The Knowledgebase's `knowledge.schema_migrations` belongs to the
 * Knowledgebase: reading or writing it from here would be the very cross-
 * module mutation this module exists to end.
 */
export const SKILL_STORE_LEDGER = "skills.schema_migrations";

/**
 * The ledger bootstrap.
 *
 * The schema and the ledger table are created by the Skill Store's own
 * runner, in the Skill Store's own schema. `CREATE ... IF NOT EXISTS` keeps
 * the statement idempotent: a database that already carries the schema (for
 * example one that adopted the Knowledgebase's `003` before the move) is left
 * exactly as it is.
 */
const LEDGER_DDL = `
CREATE SCHEMA IF NOT EXISTS skills;
CREATE TABLE IF NOT EXISTS ${SKILL_STORE_LEDGER} (
  version text PRIMARY KEY,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;

/**
 * The runner's own refusals.
 *
 * `code` is the machine-readable class a caller branches on, and `details`
 * names the migration the refusal is about.
 */
function migrationError(code, message, details = []) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.details = details;
  return error;
}

/**
 * The migration files of a migration set, in the order they are applied.
 *
 * The order is the filename order: the set is numbered, and a migration may
 * depend on the objects an earlier one created.
 */
export async function listSkillStoreMigrations(
  directory = SKILL_STORE_MIGRATIONS_DIR,
) {
  const entries = await readdir(directory);
  return entries.filter((name) => name.endsWith(".sql")).sort();
}

/**
 * Applies the Skill Store's own migration set.
 *
 * Every file that the ledger does not name yet is applied inside one
 * transaction and then recorded with its SHA-256. A file the ledger already
 * names is skipped — unless its bytes changed, which is refused: the applied
 * set is keyed by filename, so an edited file would be a silent no-op on every
 * database that already adopted it.
 *
 * @param {object} options the runner options. `dbExecutor` runs the
 *   statements (the same seam the vector sync uses); `migrationsDir` overrides
 *   the migration set.
 * @returns {Promise<object>} the applied and skipped file names.
 */
export async function applySkillStoreMigrations(options = {}) {
  const directory = options.migrationsDir ?? SKILL_STORE_MIGRATIONS_DIR;
  const files = await listSkillStoreMigrations(directory);
  if (files.length === 0) {
    throw migrationError(
      "SKILL_STORE_MIGRATIONS_MISSING",
      `no Skill Store migration was found in ${directory}.`,
    );
  }

  await executePostgresQuery(LEDGER_DDL, options);

  const applied = [];
  const skipped = [];
  for (const file of files) {
    const sql = await readFile(path.join(directory, file), "utf8");
    const digest = createHash("sha256").update(sql, "utf8").digest("hex");
    const recorded = await executePostgresQuery(
      `SELECT sha256 FROM ${SKILL_STORE_LEDGER} WHERE version = ${escapeSqlLiteral(file)};`,
      options,
    );
    const recordedDigest = String(recorded ?? "").trim();
    if (recordedDigest.length > 0) {
      if (recordedDigest !== digest) {
        throw migrationError(
          "SKILL_STORE_MIGRATION_DIGEST_MISMATCH",
          `the applied migration ${file} no longer hashes to the digest it was applied with ` +
            `(recorded ${recordedDigest}, observed ${digest}). An applied migration is keyed by ` +
            `filename, so editing it in place changes nothing on any database that already ` +
            `adopted it: add a NEW forward migration instead.`,
          [file],
        );
      }
      skipped.push(file);
      continue;
    }
    await executePostgresQuery(`BEGIN;\n${sql}\nCOMMIT;`, options);
    await executePostgresQuery(
      `INSERT INTO ${SKILL_STORE_LEDGER} (version, sha256) VALUES ` +
        `(${escapeSqlLiteral(file)}, ${escapeSqlLiteral(digest)});`,
      options,
    );
    applied.push(file);
  }

  return {
    status: "READY",
    applied,
    skipped,
    ledger: SKILL_STORE_LEDGER,
  };
}
