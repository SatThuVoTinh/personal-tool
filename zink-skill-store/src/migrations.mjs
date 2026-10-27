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
 * The PUBLISHED digest store of the applied migration set.
 *
 * M12/T9-R4 F-547 (R10-T05-4): the runner used to compare each file only
 * against the digest its OWN ledger recorded on its first run. That pin is
 * trust-on-first-use: a fresh database (or any database that never recorded
 * the row) applies whatever bytes the checkout carries, so editing a tracked
 * migration in place is adopted silently, and the published expectation is
 * read by a test and by nothing at runtime.
 *
 * The published store is therefore the apply seam's own input: a file it names
 * must hash to the digest it names BEFORE that file is applied. A file it does
 * not name is a forward migration, which the published store admits by design
 * (its own `purpose` text): the same-commit rule that puts a new migration into
 * the store is enforced by
 * `tests/m12-t2.2-a4-migration-digest.test.mjs`, not by this runner.
 */
export const SKILL_STORE_DIGEST_MANIFEST = fileURLToPath(
  new URL(
    "../../docs/contracts/skill-store/skill-store-migration-digests.json",
    import.meta.url,
  ),
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
 * The digests the published store pins, keyed by migration filename.
 *
 * Fail-closed: an absent, unreadable or malformed store is a REFUSAL, because
 * a runner that silently drops its pin is exactly the state F-547 measured.
 */
async function readPublishedDigests(manifestPath) {
  let text;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch (error) {
    throw migrationError(
      "SKILL_STORE_MIGRATION_MANIFEST_UNREADABLE",
      `the published migration digest store ${manifestPath} could not be read ` +
        `(${error?.message ?? "unknown error"}). The applied migration set is pinned ` +
        `by that store; a runner without it would adopt an edited migration silently.`,
    );
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw migrationError(
      "SKILL_STORE_MIGRATION_MANIFEST_UNREADABLE",
      `the published migration digest store ${manifestPath} is not valid JSON ` +
        `(${error?.message ?? "unknown error"}).`,
    );
  }
  const entries = document?.migrations;
  if (!Array.isArray(entries)) {
    throw migrationError(
      "SKILL_STORE_MIGRATION_MANIFEST_UNREADABLE",
      `the published migration digest store ${manifestPath} declares no migrations array.`,
    );
  }
  const published = new Map();
  for (const entry of entries) {
    const file = entry?.file;
    const sha256 = entry?.sha256;
    if (typeof file !== "string" || typeof sha256 !== "string") {
      throw migrationError(
        "SKILL_STORE_MIGRATION_MANIFEST_UNREADABLE",
        `the published migration digest store ${manifestPath} carries an entry without file/sha256.`,
      );
    }
    published.set(file, sha256);
  }
  return published;
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
 * M12/T9-R4 F-547: before either rule runs, a file the PUBLISHED digest store
 * names must match the digest the store names. The ledger rule can only speak
 * for a database that has already recorded the row; the published rule speaks
 * for every database, including a fresh one.
 *
 * @param {object} options the runner options. `dbExecutor` runs the
 *   statements (the same seam the vector sync uses); `migrationsDir` overrides
 *   the migration set; `digestManifestPath` overrides the published digest
 *   store.
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

  const manifestPath =
    options.digestManifestPath ?? SKILL_STORE_DIGEST_MANIFEST;
  const publishedDigests = await readPublishedDigests(manifestPath);

  await executePostgresQuery(LEDGER_DDL, options);

  const applied = [];
  const skipped = [];
  for (const file of files) {
    // The digest is over the file's BYTES, like the published store's own
    // gate (`tests/m12-t2.2-a4-migration-digest.test.mjs`): a text-level hash
    // would disagree with every non-ASCII migration the moment one existed.
    const bytes = await readFile(path.join(directory, file));
    const sql = bytes.toString("utf8");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const publishedDigest = publishedDigests.get(file);
    if (publishedDigest !== undefined && publishedDigest !== digest) {
      throw migrationError(
        "SKILL_STORE_MIGRATION_DIGEST_UNPUBLISHED",
        `the migration ${file} is published with digest ${publishedDigest} but its ` +
          `bytes hash to ${digest}. The published store is what every database — ` +
          `including a fresh one with an empty ledger — adopts, so this file would ` +
          `apply different DDL than the pin says: add a NEW forward migration instead.`,
        [file],
      );
    }
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
    // M12/T9-R4 F-431: the ledger write rides INSIDE the DDL transaction and
    // is idempotent on the `version` PRIMARY KEY.
    //
    // It used to be a separate unlocked statement after the COMMIT, so two
    // concurrent first-run syncs both passed the recorded-digest skip above
    // and the loser threw a primary-key violation even though its DDL had
    // committed — stamping INDEX_FAILED on a healthy promotion — and a
    // process dying between the COMMIT and the INSERT left the file
    // unrecorded, re-sending committed DDL cold. One BEGIN/COMMIT block makes
    // the DDL and its record indivisible, and `ON CONFLICT (version) DO
    // NOTHING` makes the raced loser a committed no-op instead of a
    // violation: the winner's row records the identical file bytes both
    // runners hashed. No "was it already applied" guess is involved — the
    // recorded-vs-observed digest check above stays the authority for edited
    // files.
    await executePostgresQuery(
      `BEGIN;\n${sql}\nINSERT INTO ${SKILL_STORE_LEDGER} (version, sha256) ` +
        `VALUES (${escapeSqlLiteral(file)}, ${escapeSqlLiteral(digest)}) ` +
        `ON CONFLICT (version) DO NOTHING;\nCOMMIT;`,
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
