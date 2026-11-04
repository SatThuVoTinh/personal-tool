// F-262 (R7-D12B-02) -- every tracked compose file is YAML-parsed by a tracked lane.
//
// The live acceptance overlay `compose.m4-t5.live.yml` was the one compose file
// in the tree that no test and no repository gate opened, so a syntactically
// invalid edit to it was first reported by the live Docker host, in the lane
// that is already `NOT TESTED`. Its siblings are covered
// (`tests/m5-docker-contract.test.mjs` parses `compose.core.yml` and
// `compose.knowledge.yml`), which is why the finding was narrowed to this file.
//
// The lane is deliberately GENERAL: it parses every tracked compose file, so a
// NEW compose file cannot join the tree ungated. The overlay additionally gets
// a parse-and-assert case of its own, so it is not merely "parses" but
// "still declares what the live run needs".
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseDocument } from "yaml";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE_DIR = path.join(REPO, "infrastructure", "docker", "compose");

function composeFiles() {
  return readdirSync(COMPOSE_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => path.join("infrastructure", "docker", "compose", name));
}

function parseCompose(relative) {
  const text = readFileSync(path.join(REPO, relative), "utf8");
  const document = parseDocument(text, { merge: true });
  assert.deepEqual(
    document.errors,
    [],
    `${relative} must be valid YAML: ${document.errors
      .map((error) => error.message)
      .join("; ")}`,
  );
  return document.toJS();
}

test("F-262: every tracked compose file parses as YAML", () => {
  const files = composeFiles();
  assert.ok(files.length > 0, "the compose directory must not be empty");
  for (const relative of files) {
    const parsed = parseCompose(relative);
    assert.equal(
      typeof parsed,
      "object",
      `${relative} must parse into a mapping`,
    );
  }
});

test("F-262: the live acceptance overlay still declares its barrier volume", () => {
  const relative = path.join(
    "infrastructure",
    "docker",
    "compose",
    "compose.m4-t5.live.yml",
  );
  const parsed = parseCompose(relative);
  const knowledge = parsed?.services?.knowledge;
  assert.ok(knowledge, "the overlay must declare the knowledge service");
  assert.equal(
    knowledge.environment?.KNOWLEDGE_ACCEPTANCE_BACKUP_BARRIER_DIR,
    "/acceptance-backup-barrier",
    "the overlay must keep pointing the acceptance barrier at the barrier path",
  );
  const volumes = Array.isArray(knowledge.volumes) ? knowledge.volumes : [];
  const barrier = volumes.find(
    (volume) => volume?.target === "/acceptance-backup-barrier",
  );
  assert.ok(
    barrier,
    "the overlay must keep binding the acceptance backup barrier",
  );
  assert.match(
    String(barrier.source),
    /KNOWLEDGE_T5_BACKUP_BARRIER_ROOT/u,
    "the barrier source must stay an explicit operator-supplied root",
  );
});
