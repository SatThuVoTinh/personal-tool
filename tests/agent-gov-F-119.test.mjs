// F-119 (R6-V01-01) — Cluster A goes RED on landing with no owner approval for
// that red.
//
// The acceptance criterion is about the record: M12/T2.1-R3 must either record an
// explicit grant for the gate edit or exclude 4A.1 with its successor named.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...segments) =>
  readFileSync(path.join(REPO_ROOT, ...segments), "utf8");

const PLAN = read("PLAN.md");
const T2_1_R3 = read(
  "docs",
  "contracts",
  "execution",
  "archive",
  "2026-10-15-M12-T2.1-R3.md",
);
const T2_2_R1 = read(
  "docs",
  "contracts",
  "execution",
  "archive",
  "2026-10-16-M12-T2.2-R1.md",
);

test("F-119: the M12/T2.1-R3 contract excludes 4A.1 with an owner answer and a named successor", () => {
  const row = T2_1_R3.split("\n").find((line) => line.includes("**4A.1**"));
  assert.ok(row, "the contract must record what happened to 4A.1");
  assert.match(row, /I1-A/u, "the exclusion must carry the owner's own answer");
  assert.match(
    row,
    /\*\*T2\.2\*\*/u,
    "the exclusion must name the successor task",
  );
  assert.match(
    row,
    /pinned required gate/u,
    "the record must name the pinned gate the fix would have had to amend",
  );
});

test("F-119: the successor band executed 4A.1 under its own contract", () => {
  assert.match(
    T2_2_R1,
    /A-5[^\n]*4A\.1/u,
    "the successor contract must carry the item that took over 4A.1",
  );
});

test("F-119: PLAN.md records the same owner answer", () => {
  assert.match(
    PLAN,
    /I1-A[^\n]*4A\.1(?![\d])/u,
    "PLAN.md must record the same owner answer for the same item",
  );
});
