// F-361 (R7-IG-01) — two ignored state files contradict the owner's recorded
// deployment and disposition decisions, and the bootstrap order puts them on the
// read path.
//
// No state file on the bootstrap read path may state a deployment, evidence-level
// or owner-disposition fact that PLAN.md contradicts, and the bootstrap steps
// must say that state is historical and PLAN.md wins without comparison.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...segments) =>
  readFileSync(path.join(REPO_ROOT, ...segments), "utf8");

const PLAN = read("PLAN.md");
const STATES_DIRECTORY = path.join(REPO_ROOT, ".agents", "states");

const BOOTSTRAP_SKILLS = [
  ".agents/skills/execution/SKILL.md",
  ".agents/skills/debugging/SKILL.md",
  ".agents/skills/planning/SKILL.md",
  ".agents/skills/validating/SKILL.md",
];

const HISTORICAL_CLAUSE =
  "**State is historical:** `PLAN.md` wins without comparison — a state file is working memory, never a second source to reconcile against.";

function stateFiles() {
  if (!existsSync(STATES_DIRECTORY)) return [];
  return readdirSync(STATES_DIRECTORY)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => `.agents/states/${name}`);
}

test("F-361: every bootstrap step says state is historical and PLAN.md wins", () => {
  const missing = [];
  for (const relative of BOOTSTRAP_SKILLS) {
    if (!read(...relative.split("/")).includes(HISTORICAL_CLAUSE)) {
      missing.push(relative);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `a skill that puts a state file on the read path must say state is historical and PLAN.md wins without comparison: ${missing.join(", ")}`,
  );
});

test("F-361: no state file contradicts the recorded deployment of M11/T3-R1", () => {
  assert.match(
    PLAN,
    /M11\/T3-R1 is CLOSED[^\n]*DEPLOYED AND VERIFIED/u,
    "PLAN.md must record the M11/T3-R1 deployment",
  );
  const offenders = [];
  for (const relative of stateFiles()) {
    const contents = read(...relative.split("/"));
    if (!contents.includes("M11/T3")) continue;
    if (/NOT installed/iu.test(contents)) {
      offenders.push(`${relative} — claims the band is not installed`);
    }
    if (/LOCAL-VERIFIED, not REMOTE-BACKED/iu.test(contents)) {
      offenders.push(`${relative} — claims a lower evidence level`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a state file states a deployment or evidence-level fact that PLAN.md contradicts: ${offenders.join(" | ")}`,
  );
});

test("F-361: no state file re-labels an owner-excluded item as unselected", () => {
  assert.match(
    PLAN,
    /owner-excluded items/u,
    "PLAN.md must record the owner-excluded items",
  );
  const offenders = [];
  for (const relative of stateFiles()) {
    const contents = read(...relative.split("/"));
    if (/owner has not selected/iu.test(contents)) {
      offenders.push(`${relative} — re-labels an owner-excluded item`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a state file re-labels what the owner excluded: ${offenders.join(" | ")}`,
  );
});
