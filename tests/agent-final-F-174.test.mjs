// F-174 (R5-E12-05) — `AGENTS.md` section 5 routes architecture, ownership and
// overengineering review to `.agents/skills/architecture-review/SKILL.md`, and
// the artifact it routes to carried an expired milestone fact and no procedure
// at all.
//
// The file was a priority list and an invariants list, both copied from sources
// that own them, plus one clause that had expired: "the accepted
// apps/knowledge/ implementation is not moved during M5". The repository is not
// at M5 any more, and the copy of the invariants silently drifted from
// `AGENTS.md` section 9 - it omitted the canonical peer-module path rule and
// the "target directory trees are architecture, not implementation evidence"
// clause.
//
// Acceptance criteria: the skill becomes executable by stating review inputs,
// ordered steps, a verdict/output vocabulary and a completion gate; it contains
// no milestone-dated facts (the M5 clause is gone or reduced to the durable
// rule already in `AGENTS.md` section 9); and it points to `AGENTS.md`
// sections 8 and 9 and `planning/SKILL.md` as the single sources for the
// priority and invariants lists instead of carrying its own divergent copies.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const skill = readFileSync(
  path.join(REPO, ".agents", "skills", "architecture-review", "SKILL.md"),
  "utf8",
);
// Whitespace-normalised, so a sentence that wraps across two lines is still
// one sentence to the assertions below.
const text = skill.replace(/\s+/gu, " ");

test("F-174: the skill names the procedure it runs", () => {
  assert.match(
    text,
    /architecture, ownership and overengineering review/u,
    "the skill must name the review it performs",
  );
  assert.match(
    text,
    /review inputs[\s\S]*ordered steps[\s\S]*verdict[\s\S]*gate/iu,
    "the skill must state its inputs, its steps, its verdict and its gate",
  );
});

test("F-174: the skill states inputs, ordered steps, a verdict vocabulary and a gate", () => {
  assert.match(skill, /^## Review inputs$/mu, "the inputs must be stated");
  assert.match(skill, /^## Ordered steps$/mu, "the steps must be ordered");
  assert.match(
    skill,
    /^## Verdict vocabulary$/mu,
    "the verdict must be stated",
  );
  assert.match(skill, /^## Completion gate$/mu, "the gate must be stated");
  // Ordered steps are a numbered list, not a prose paragraph.
  const steps = /## Ordered steps\n([\s\S]*?)\n## /u.exec(skill);
  assert.ok(steps, "the ordered steps section must exist");
  const numbered = steps[1].match(/^\d+\. /gmu) ?? [];
  assert.ok(
    numbered.length >= 3,
    `the ordered steps must be a numbered list, found ${numbered.length}`,
  );
  // The verdict vocabulary is a closed set the review emits.
  const verdict = /## Verdict vocabulary\n\s*```text\n([\s\S]*?)\n```/u.exec(
    skill,
  );
  assert.ok(verdict, "the verdict vocabulary must be an explicit list");
  for (const name of [
    "ARCHITECTURE PASS",
    "LOCAL FIX",
    "OWNER DECISION REQUIRED",
    "BLOCKED",
  ]) {
    assert.ok(
      verdict[1].includes(name),
      `the verdict vocabulary must name ${name}`,
    );
  }
  // The gate names the conditions that close the review.
  const gate = /## Completion gate\n([\s\S]*)$/u.exec(skill);
  assert.ok(gate, "the completion gate section must exist");
  assert.match(
    gate[1],
    /- /u,
    "the completion gate must state its conditions as a list",
  );
});

test("F-174: the skill carries no milestone-dated fact", () => {
  assert.doesNotMatch(
    skill,
    /\bM\d+\b/u,
    "a milestone token is a dated fact that expires with the milestone",
  );
  assert.doesNotMatch(
    text,
    /not moved during/iu,
    "the expired clause must be gone",
  );
  assert.doesNotMatch(
    text,
    /is not moved/iu,
    "the expired clause must be gone",
  );
});

test("F-174: the skill states the current runtime truth instead of the expired clause", () => {
  assert.match(
    text,
    /remains the current Knowledgebase runtime until a separately approved migration/u,
    "the skill must state the current rule, which `AGENTS.md` section 9 owns",
  );
  assert.match(
    text,
    /structural migration requires its own task and regression gate/u,
    "the durable rule keeps its regression-gate clause",
  );
});

test("F-174: the skill points to the single owners of the priority and invariants lists", () => {
  assert.match(
    text,
    /AGENTS\.md[`\s]+section 8/u,
    "the priority order is owned by `AGENTS.md` section 8",
  );
  assert.match(
    text,
    /AGENTS\.md[`\s]+section 9/u,
    "the invariants are owned by `AGENTS.md` section 9",
  );
  assert.match(
    text,
    /planning\/SKILL\.md/u,
    "the task and decision procedure is owned by `planning/SKILL.md`",
  );
});

test("F-174: the skill carries no second copy of the priority or invariants lists", () => {
  // The priority list this file used to copy.
  assert.doesNotMatch(
    skill,
    /future extensibility only when justified/u,
    "the priority list belongs to `AGENTS.md` section 8 alone",
  );
  assert.doesNotMatch(
    skill,
    /^\s*\d+\.\s+correctness;?$/mu,
    "the priority list belongs to `AGENTS.md` section 8 alone",
  );
  // The invariants list this file used to copy.
  for (const invariant of [
    "Zink Skill Store",
    "Zink Knowledgebase",
    "Zink Tools",
    "knowledge-ai",
    "Obsidian Vault",
    "L&SC",
  ]) {
    assert.doesNotMatch(
      skill,
      new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
      `the invariants are owned by ` +
        "`AGENTS.md`" +
        ` section 9 alone (${invariant})`,
    );
  }
});
