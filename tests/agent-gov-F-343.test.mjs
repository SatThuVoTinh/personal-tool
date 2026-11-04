// F-343 (R7-OB-01) — the `work | research` task mode has a normative
// architecture document, a cross-reference, and no implementation.
//
// The mode is not in any schema or source file, so the document must be
// withdrawn as a proposal and the boundary document must stop delegating to it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const read = (...segments) =>
  readFileSync(path.join(REPO_ROOT, ...segments), "utf8");

const ROUTING = read("docs", "architecture", "work-research-routing.md");
const BOUNDARIES = read("docs", "architecture", "zink-tools-boundaries.md");
const ARCHITECTURE_INDEX = read("docs", "architecture", "README.md");

const BRIEF_SCHEMA = read(
  "integrations",
  "openclaw",
  "topology",
  "contracts",
  "execution-brief.schema.json",
);

test("F-343: the routing document is marked as a proposal, not canonical architecture", () => {
  assert.match(
    ROUTING,
    /status:[ ]*proposal/iu,
    "a document with no implementation must declare its status as a proposal",
  );
  assert.match(
    ROUTING,
    /not implemented/iu,
    "the proposal must say that no runtime carries the mode",
  );
});

test("F-343: the boundary document no longer delegates the mode classification", () => {
  assert.ok(
    !BOUNDARIES.includes("work | research"),
    "the boundary document must stop delegating a classification that no " +
      "runtime implements",
  );
  const mention = BOUNDARIES.split(/\n\s*\n/u).find((paragraph) =>
    paragraph.includes("work-research-routing.md"),
  );
  assert.ok(mention, "the boundary document must say what became of the mode");
  assert.match(
    mention,
    /proposal/iu,
    "the boundary document may mention the routing document only to say it is " +
      "a proposal, never as a boundary it delegates",
  );
});

test("F-343: the architecture index marks the routing document as a proposal", () => {
  const indexEntry = ARCHITECTURE_INDEX.split("\n").find((line) =>
    line.includes("work-research-routing.md"),
  );
  assert.ok(indexEntry, "the architecture index must still list the document");
  assert.match(
    indexEntry,
    /proposal/iu,
    "the index must not present a withdrawn document as canonical architecture",
  );
});

test("F-343: no schema carries the mode field the proposal describes", () => {
  assert.ok(
    !/"mode"/u.test(BRIEF_SCHEMA),
    "the execution-brief schema must not carry a mode field while the routing " +
      "document is only a proposal",
  );
});
