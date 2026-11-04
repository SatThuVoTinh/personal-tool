// F-323 (R7-E5-04) — the byte-identical acceptance pair was pinned only
// against each other, and one driver pinned the embedding model while the
// other inherited the operator's.
//
// The two acceptance overlays are held identical by a text-equality test, but
// the divergence that matters sat outside the compared bytes: the t3 driver
// set the embedding model in the shell and the t4 driver left it to the env
// file. Two acceptance runs could therefore resolve different embedding models
// while their compose files were provably identical.
//
// Acceptance criteria: either both drivers pin the model the dimensions were
// designed for, or the overlays carry it explicitly, and one lane asserts the
// resolved value rather than only the file bytes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseDocument } from "yaml";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

function compose(...parts) {
  const document = parseDocument(read(...parts), { merge: true });
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

const ACCEPTANCE_OVERLAYS = [
  "compose.m3-t3.acceptance.yml",
  "compose.m3-t4.acceptance.yml",
  "compose.m3-t5.acceptance.yml",
];

test("F-323: every acceptance overlay pins the embedding model explicitly", () => {
  for (const name of ACCEPTANCE_OVERLAYS) {
    const overlay = compose("infrastructure", "docker", "compose", name);
    const model =
      overlay.services.knowledge.environment.KNOWLEDGE_EMBEDDING_MODEL;
    assert.equal(
      model,
      "bge-m3:latest",
      `${name} must pin the model its dimensions were designed for`,
    );
  }
});

test("F-323: no acceptance driver resolves the embedding model from the shell", () => {
  for (const name of [
    "knowledge-t3.ps1",
    "knowledge-t4.ps1",
    "knowledge-t5.ps1",
  ]) {
    const source = read("infrastructure", "docker", "scripts", name);
    assert.doesNotMatch(
      source,
      /\$env:KNOWLEDGE_EMBEDDING_MODEL\s*=/,
      `${name} must not resolve the embedding model from the shell: the overlay is the one source`,
    );
  }
});

test("F-323: the pinned model is the one the dimension assertion was written for", () => {
  const core = compose(
    "infrastructure",
    "docker",
    "compose",
    "compose.core.yml",
  );
  assert.equal(
    core.services.knowledge.environment.KNOWLEDGE_EMBEDDING_DIMENSIONS,
    "1024",
  );
  const t1 = read("infrastructure", "docker", "scripts", "knowledge-t1.ps1");
  assert.match(
    t1,
    /\.Length\s+-ne\s+1024/,
    "the t1 acceptance asserts this model's dimension is 1024",
  );
  assert.match(t1, /"bge-m3:latest"/);
});
