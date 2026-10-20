// F-267 (R7-D13-04) — the memory acceptance gate compared against a hardcoded
// 80% of 4 GiB without reading the container's real ceiling.
//
// The t4 gate threw when the cgroup peak reached the literal 3435973837
// bytes, assuming a 4 GiB limit; the sibling t5 harness reads and asserts
// `HostConfig.Memory == 4294967296`. An overlay that lowered the limit
// therefore made the gate unreachably lenient while the run still reported
// PASS.
//
// Acceptance criteria: the gate reads the configured limit before applying the
// percentage and fails when the limit differs from the documented ceiling.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

const t4 = read("infrastructure", "docker", "scripts", "knowledge-t4.ps1");
const t5Common = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t5-common.ps1",
);

test("F-267: the documented ceiling is the one the t5 harness already asserts", () => {
  assert.match(
    t5Common,
    /4294967296/,
    "the t5 harness must assert the documented Knowledge memory ceiling",
  );
});

test("F-267: the t4 gate reads the container's configured memory limit", () => {
  assert.match(
    t4,
    /HostConfig\.Memory/,
    "the t4 gate must read the limit the container was actually given",
  );
  assert.match(
    t4,
    /docker inspect/,
    "the limit must be read from the running container",
  );
});

test("F-267: the t4 gate fails when the limit differs from the documented ceiling", () => {
  assert.match(
    t4,
    /4294967296/,
    "the t4 gate must name the documented ceiling",
  );
  assert.match(
    t4,
    /memory limit is \$?\{?\w+\}? bytes/i,
    "a limit that differs from the documented ceiling must stop the gate",
  );
});

test("F-267: the percentage is applied to the limit that was read", () => {
  assert.doesNotMatch(
    t4,
    /3435973837/,
    "the hardcoded 80% threshold is the defect: it cannot react to the real limit",
  );
  assert.match(
    t4,
    /Ceiling\([^\n]*\*\s*0\.8\)|Ceiling\([^\n]*\*\s*\$[A-Za-z]*MemoryLimitFraction/,
    "the peak ceiling must be computed from the limit that was read",
  );
});
