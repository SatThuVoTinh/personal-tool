// F-136 (R5-E12-06) — the finding register has no attributable writer discipline,
// no serialization rule, and a "must" any agent can satisfy by declining to write.
//
// The three governance texts that route the register must name one and the same
// accountable writer and one and the same serialization rule, and the pin must
// live in a gate so the files cannot drift apart again.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const read = (...segments) =>
  readFileSync(path.join(REPO_ROOT, ...segments), "utf8");

const EXECUTION_SKILL = read(".agents", "skills", "execution", "SKILL.md");
const CODE_REVIEW_SKILL = read(".agents", "skills", "code-review", "SKILL.md");
const STATES_PROTOCOL = read(".agents", "states", "README.md");

const GOVERNANCE_TEXTS = [
  ["execution/SKILL.md", EXECUTION_SKILL],
  ["code-review/SKILL.md", CODE_REVIEW_SKILL],
  [".agents/states/README.md", STATES_PROTOCOL],
];

// The two clauses the three texts must carry verbatim.
const ACCOUNTABLE_WRITER_CLAUSE =
  "**Accountable writer:** Codex review/remediation.";
const SERIALIZATION_CLAUSE =
  "**Serialization:** one row, one writer — a second lane that finds the same `F-xxx` block already being edited does not edit it and hands the conflict to the orchestrator.";

test("F-136: code-review/SKILL.md records every actionable finding with no opt-out", () => {
  assert.ok(
    !/when useful/u.test(CODE_REVIEW_SKILL),
    "a 'must' with a 'when useful' opt-out is satisfied by declining to write; the " +
      "recording duty must be unconditional",
  );
  assert.match(
    CODE_REVIEW_SKILL,
    /create\/update `docs\/execution\/findings\.md`/u,
    "the review skill must state the recording duty on the register",
  );
});

test("F-136: the three governance texts name one and the same accountable writer role", () => {
  const missing = [];
  for (const [name, contents] of GOVERNANCE_TEXTS) {
    if (!contents.includes(ACCOUNTABLE_WRITER_CLAUSE)) {
      missing.push(`${name} — accountable writer`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `the register must have one accountable writer role, named identically in every governance text: ${missing.join(" | ")}`,
  );
});

test("F-136: the three governance texts carry one and the same serialization rule", () => {
  const missing = [];
  for (const [name, contents] of GOVERNANCE_TEXTS) {
    if (!contents.includes(SERIALIZATION_CLAUSE)) {
      missing.push(`${name} — serialization rule`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `concurrent writers need one serialization rule, stated identically in every governance text: ${missing.join(" | ")}`,
  );
});

test("F-136: no other accountable writer role is named for the register", () => {
  const alternatives = [
    "reviewer/debugger/validator",
    "owner: Codex",
    "owned by the executing lane",
  ];
  for (const [name, contents] of GOVERNANCE_TEXTS) {
    for (const alternative of alternatives) {
      assert.ok(
        !contents.includes(alternative),
        `${name} names a second writer role for the register: ${alternative}`,
      );
    }
  }
});
