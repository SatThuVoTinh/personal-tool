// F-161 (R1-A15-06) — PLAN.md cites sections of a file that is Git-ignored and
// deleted at closeout, so durable evidence is unrecoverable.
//
// Every numbered `ACTIVE.md` citation must resolve to a tracked file: either a
// tracked archived contract, or a commit-qualified pointer recorded in the same
// citation key.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLAN = readFileSync(path.join(REPO_ROOT, "PLAN.md"), "utf8");

const CITATION_KEY_HEADING = "**Citation key";
const CITATION_PATTERN =
  /ACTIVE\.md[ ]+(R\d+(?:[ ]\d+(?:\.\d+)?)?|§[\d.]+[A-Za-z]?(?:[ ]step iv)?)/gu;

function citationKey() {
  const start = PLAN.indexOf(CITATION_KEY_HEADING);
  assert.ok(
    start >= 0,
    "PLAN.md must carry a citation key for the ACTIVE.md sections it cites",
  );
  const rest = PLAN.slice(start);
  const end = rest.indexOf("\n## ");
  return end < 0 ? rest : rest.slice(0, end);
}

// The live band's own header cites the live contract, which is the pointer
// itself and is archived at closeout; every other numbered citation names a
// contract revision that no longer exists on disk.
function scannedText() {
  const lines = PLAN.split("\n");
  const activeStart = lines.findIndex((line) =>
    /^## Active task\b/u.test(line),
  );
  return lines
    .slice(0, activeStart < 0 ? lines.length : activeStart)
    .join("\n");
}

function citedSections() {
  const cited = new Map();
  for (const match of scannedText().matchAll(CITATION_PATTERN)) {
    cited.set(match[1], (cited.get(match[1]) ?? 0) + 1);
  }
  return cited;
}

test("F-161: PLAN.md carries a citation key for the contract sections it cites", () => {
  const key = citationKey();
  assert.match(key, /docs\/contracts\/execution\/archive\//u);
  assert.match(key, /git show/u);
});

test("F-161: every numbered ACTIVE.md citation is in the citation key", () => {
  const key = citationKey();
  const missing = [...citedSections().keys()].filter(
    (citation) => !key.includes(`\`${citation}\``),
  );
  assert.deepEqual(
    missing,
    [],
    `a numbered ACTIVE.md citation resolves to nothing: ${missing.join(", ")}`,
  );
});

test("F-161: the commit the key names exists and carries the cited sections", () => {
  const key = citationKey();
  const commit = /`([0-9a-f]{7,40})`/u.exec(key)?.[1];
  assert.ok(commit, "the key must name a commit-qualified pointer");

  let contract;
  try {
    contract = execFileSync(
      "git",
      ["show", `${commit}:docs/contracts/execution/ACTIVE.md`],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
  } catch {
    assert.fail(`the commit the key names does not exist: ${commit}`);
  }

  const sections = [...citedSections().keys()].filter((citation) =>
    /^R\d+/u.test(citation),
  );
  assert.ok(
    sections.length > 0,
    "the key must resolve the R-numbered sections",
  );
  const missing = sections.filter(
    (citation) =>
      !new RegExp(`^#{2,3} ${citation.replace(" ", " ")}`, "mu").test(contract),
  );
  assert.deepEqual(
    missing,
    [],
    `the commit the key names does not carry these sections: ${missing.join(", ")}`,
  );
});

test("F-161: every archived contract the key names is tracked and exists", () => {
  const key = citationKey();
  const archives = [
    ...key.matchAll(/`(docs\/contracts\/execution\/archive\/[^`]+)`/gu),
  ].map((match) => match[1]);
  assert.ok(archives.length > 0, "the key must name the archived contracts");
  for (const relative of archives) {
    const absolute = path.join(REPO_ROOT, ...relative.split("/"));
    assert.ok(
      existsSync(absolute),
      `the citation key names a contract that does not exist: ${relative}`,
    );
  }
});
