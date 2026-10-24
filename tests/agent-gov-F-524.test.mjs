// F-524 (R10-L10-4) — a skill may not name a binding artifact it never defines.
//
// `architecture-review/SKILL.md` names the Approved Plan Lock and the Owner
// Decision Protocol as the controls that bind post-approval behaviour, and
// points at `planning/SKILL.md` as their owner. The Owner Decision Protocol is
// genuinely defined there; the Approved Plan Lock was only a sentence, so the
// routing target had no content, no lift authority and nothing a gate could
// redden on. This lane keeps every named governance artifact resolvable to a
// heading in the skill that owns it, and pins the lock's substantive rules to
// the RED boundary in AGENTS.md.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = path.join(REPO, ".agents", "skills");
const OWNER_SKILL = "planning";

function skillTexts() {
  const texts = new Map();
  for (const entry of readdirSync(SKILLS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(SKILLS, entry.name, "SKILL.md");
    texts.set(entry.name, readFileSync(file, "utf8"));
  }
  return texts;
}

function headingBody(markdown, name) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^#{1,6} ${name}$`, "u").test(line),
  );
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,6} /u.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

test("every governance artifact named across skills is defined by its owning skill", () => {
  const texts = skillTexts();
  const named = ["Approved Plan Lock", "Owner Decision Protocol"];
  for (const name of named) {
    const referenced = [...texts.entries()].filter(([, text]) =>
      text.includes(name),
    );
    assert.ok(
      referenced.length > 0,
      `${name} is listed here, so at least one skill must name it`,
    );
    const owner = texts.get(OWNER_SKILL);
    assert.ok(owner, "the planning skill must exist");
    assert.ok(
      headingBody(owner, name) !== null,
      `${name} is named by ${referenced
        .map(([skill]) => skill)
        .join(
          ", ",
        )} but has no heading in .agents/skills/${OWNER_SKILL}/SKILL.md`,
    );
  }
});

test("the Approved Plan Lock names its lift authority, RED boundary and recording point", () => {
  const owner = skillTexts().get(OWNER_SKILL);
  const lock = headingBody(owner, "Approved Plan Lock");
  assert.ok(lock, "the Approved Plan Lock must be a heading, not a sentence");
  assert.match(
    lock,
    /\bowner\b/iu,
    "only the owner may lift or narrow the lock",
  );
  assert.match(lock, /AGENTS\.md/u, "the lock must name its authority source");
  assert.match(
    lock,
    /§7|section 7/iu,
    "the lock must name the RED decision boundary in AGENTS.md §7",
  );
  assert.match(lock, /\bRED\b/u, "a violation must map to a RED decision");
  assert.match(
    lock,
    /PLAN\.md/u,
    "a revised decision must be recorded in PLAN.md before execution resumes",
  );
});
