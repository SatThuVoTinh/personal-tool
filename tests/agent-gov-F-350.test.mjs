// F-350 (R7-OC1-03) — PLAN.md uses a `Task Status` value its own §2 vocabulary
// does not admit.
//
// §2 must enumerate every value PLAN itself writes, and an assertion must compare
// the used tokens against the declared set.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLAN = readFileSync(path.join(REPO_ROOT, "PLAN.md"), "utf8");

const LINES = PLAN.split("\n");

function declaredStatusValues() {
  const declaration = LINES.find(
    (line) => line.startsWith("Task Status:") && line.includes(" | "),
  );
  assert.ok(declaration, "PLAN.md §2 must declare the Task Status vocabulary");
  return declaration
    .slice("Task Status:".length)
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
}

function usedStatusValues() {
  const used = [];
  for (const line of LINES) {
    if (!line.startsWith("Task Status:")) continue;
    if (line.includes(" | ")) continue; // the §2 declaration itself
    const rest = line.slice("Task Status:".length);
    const token =
      /`?\b(NOT STARTED|IN PROGRESS|BLOCKED|COMPLETE|DEFERRED|CANCELLED|CLOSED)\b/u.exec(
        rest,
      );
    used.push({
      token: token ? token[1] : null,
      line: line.slice(0, 120),
    });
  }
  return used;
}

test("F-350: every Task Status value PLAN writes is declared in §2", () => {
  const declared = new Set(declaredStatusValues());
  const undeclared = usedStatusValues()
    .filter((used) => used.token === null || !declared.has(used.token))
    .map((used) => used.line);
  assert.deepEqual(
    undeclared,
    [],
    `every status PLAN writes must be in the §2 vocabulary (${[...declared].join(", ")}): ${undeclared.join(" | ")}`,
  );
});

test("F-350: the §2 vocabulary is not narrower than the values PLAN writes", () => {
  const declared = new Set(declaredStatusValues());
  const used = new Set(
    usedStatusValues()
      .map((entry) => entry.token)
      .filter(Boolean),
  );
  const missing = [...used].filter((value) => !declared.has(value));
  assert.deepEqual(
    missing,
    [],
    `PLAN writes a status its own §2 does not admit: ${missing.join(", ")}`,
  );
});

test("F-350: CLOSED is a declared status value", () => {
  assert.ok(
    declaredStatusValues().includes("CLOSED"),
    "CLOSED is the value PLAN most often writes for finished work and must be declared",
  );
});
