// M12/T2.2-R2 B-15 — the two acceptance compose files are one stack under two
// names (`R5-E14-05`).
//
// `compose.m3-t3.acceptance.yml` and `compose.m3-t4.acceptance.yml` carry
// identical bytes while `knowledge-t3.ps1` and `knowledge-t4.ps1` each point at
// their own copy. Nothing but this file makes that equality a requirement, so a
// fix applied to one environment silently misses the other — which is how a
// verified t3 acceptance stopped describing what t4 actually runs.
//
// The register's "Where" for this finding names `compose.m4-t4.acceptance.yml`,
// a file that does not exist; the real pair is recorded here and in the plan.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

const T3_COMPOSE = path.join(
  "infrastructure",
  "docker",
  "compose",
  "compose.m3-t3.acceptance.yml",
);
const T4_COMPOSE = path.join(
  "infrastructure",
  "docker",
  "compose",
  "compose.m3-t4.acceptance.yml",
);

test("B-15: the t3 and t4 acceptance compose files are byte-identical", () => {
  const t3 = read(T3_COMPOSE);
  const t4 = read(T4_COMPOSE);
  assert.equal(
    t3,
    t4,
    `${path.basename(T3_COMPOSE)} and ${path.basename(
      T4_COMPOSE,
    )}: these two files configure the same acceptance stack for two different task drivers, so a difference between them is a silent divergence — fix both or say why they differ`,
  );
});

test("B-15: each task driver still selects its OWN copy of that content", () => {
  // The pairing above only matters while the two drivers load separate files. If
  // one driver were repointed at the other's file, the duplication would be gone
  // and this guard should be deleted rather than left to pass vacuously.
  const t3Driver = read(
    "infrastructure",
    "docker",
    "scripts",
    "knowledge-t3.ps1",
  );
  const t4Driver = read(
    "infrastructure",
    "docker",
    "scripts",
    "knowledge-t4.ps1",
  );
  assert.match(
    t3Driver,
    /compose\.m3-t3\.acceptance\.yml/u,
    "the t3 driver must name the t3 acceptance file",
  );
  assert.match(
    t4Driver,
    /compose\.m3-t4\.acceptance\.yml/u,
    "the t4 driver must name the t4 acceptance file",
  );
  assert.doesNotMatch(
    t3Driver,
    /compose\.m3-t4\.acceptance\.yml/u,
    "the t3 driver has been repointed; the two-file premise no longer holds",
  );
  assert.doesNotMatch(
    t4Driver,
    /compose\.m3-t3\.acceptance\.yml/u,
    "the t4 driver has been repointed; the two-file premise no longer holds",
  );
});
