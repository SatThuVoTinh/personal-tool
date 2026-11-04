// F-354 (R7-OC1-07) — the Owner Decision Protocol exists in full in two skills
// and one has already drifted from the other.
//
// One file owns the protocol; the others cite it in a single line; a text
// assertion pins that the clause wording is not repeated.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKILLS_DIRECTORY = path.join(REPO_ROOT, ".agents", "skills");

const skillFiles = readdirSync(SKILLS_DIRECTORY, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `.agents/skills/${entry.name}/SKILL.md`)
  .filter((relative) => {
    try {
      readFileSync(path.join(REPO_ROOT, relative), "utf8");
      return true;
    } catch {
      return false;
    }
  });

const OWNER = ".agents/skills/planning/SKILL.md";

// The protocol body: from the escalation heading to the question line.
const PROTOCOL_BODY_START = "OWNER DECISION REQUIRED";
const PROTOCOL_BODY_END = "Question:";

test("F-354: exactly one skill file carries the Owner Decision Protocol body", () => {
  const carriers = skillFiles.filter((relative) => {
    const contents = readFileSync(path.join(REPO_ROOT, relative), "utf8");
    return (
      contents.includes(PROTOCOL_BODY_START) &&
      contents.includes(PROTOCOL_BODY_END)
    );
  });
  assert.deepEqual(
    carriers,
    [OWNER],
    `the protocol body must live in exactly one file (${OWNER}); found it in: ${carriers.join(", ")}`,
  );
});

test("F-354: the execution skill cites the protocol owner in a single line", () => {
  const execution = readFileSync(
    path.join(REPO_ROOT, ".agents", "skills", "execution", "SKILL.md"),
    "utf8",
  );
  assert.ok(
    execution.includes(OWNER),
    `execution/SKILL.md must cite the protocol owner ${OWNER} instead of copying it`,
  );
  assert.ok(
    !execution.includes(PROTOCOL_BODY_START),
    "execution/SKILL.md must not repeat the escalation template",
  );
});

test("F-354: the AGENTS.md decision boundary cites the protocol owner", () => {
  const agents = readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
  assert.ok(
    agents.includes(OWNER),
    `AGENTS.md §7 must cite the protocol owner ${OWNER} in a single line`,
  );
});
