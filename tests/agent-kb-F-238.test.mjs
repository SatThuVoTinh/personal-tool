// F-238 (R7-D3-01) — the operator backup never dumped the Knowledge database.
//
// The Knowledge schema lives in the `postgres` database (compose.core.yml:
// POSTGRES_DB and KNOWLEDGE_DATABASE_NAME), but backup.ps1 defaulted its
// database list to `n8n` alone and the runbook's documented command omits
// `-Databases`. The artifact therefore contained no indexed source, no
// segment and no provenance row: every acceptance of the backup was an
// acceptance of a dump that could not restore the Knowledgebase.
//
// Acceptance criteria: the runbook command produces a manifest containing a
// Knowledge (`postgres`) dump — the script and the runbook must agree.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseDocument } from "yaml";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

function compose() {
  const document = parseDocument(
    read("infrastructure", "docker", "compose", "compose.core.yml"),
    { merge: true },
  );
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

function defaultDatabases(script) {
  const match = script.match(/\$Databases\s*=\s*@\(([^)]*)\)/);
  assert.ok(match, "backup.ps1 must declare its default database list");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

test("F-238: the default backup dumps the database the Knowledge schema lives in", () => {
  const script = read("infrastructure", "docker", "scripts", "backup.ps1");
  const services = compose().services;
  const knowledgeDatabase =
    services.knowledge.environment.KNOWLEDGE_DATABASE_NAME;
  const databases = defaultDatabases(script);

  assert.equal(
    knowledgeDatabase,
    services.postgres.environment.POSTGRES_DB,
    "the Knowledge schema and the backup target must be the same database",
  );
  assert.ok(
    databases.includes(knowledgeDatabase),
    `backup.ps1 must dump the Knowledge database '${knowledgeDatabase}' by default; it dumps ${databases.join(", ")}`,
  );
});

test("F-238: every declared database gets its own dump, and the manifest names it", () => {
  const script = read("infrastructure", "docker", "scripts", "backup.ps1");

  assert.match(
    script,
    /--file=\/backup\/postgres\/\$database\.dump/,
    "the dump loop must write one file per declared database",
  );
  assert.match(
    script,
    /"postgres\/\*\.dump"\)\s*\{\s*"postgres-custom"/,
    "the manifest must classify the PostgreSQL dump as a PostgreSQL dump",
  );
  assert.match(
    script,
    /foreach\s*\(\$database\s+in\s+\$Databases\)/,
    "the dump loop must iterate the declared database list",
  );
});
