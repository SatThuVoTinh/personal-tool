// F-351 (R7-OC1-04) — the Active Task block carries two task identities and two
// `Task Status` lines, so the authorization check has no single answer.
//
// Exactly one task identity and one status per Active Task block, historical
// statuses marked as history outside the header, and the header identity compared
// against the live contract pointer.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLAN = readFileSync(path.join(REPO_ROOT, "PLAN.md"), "utf8");
const LINES = PLAN.split("\n");

const CONTRACT_PATH = path.join(
  REPO_ROOT,
  "docs",
  "contracts",
  "execution",
  "ACTIVE.md",
);

function sectionLines(headingPattern) {
  const start = LINES.findIndex((line) => headingPattern.test(line));
  assert.ok(start >= 0, `PLAN.md must carry the section ${headingPattern}`);
  const end = LINES.findIndex(
    (line, index) => index > start && /^## /u.test(line),
  );
  return LINES.slice(start, end < 0 ? undefined : end);
}

function currentFocusBlock() {
  const section = sectionLines(/^## 4\. Current focus/u);
  const fenceStart = section.findIndex((line) => line.startsWith("```text"));
  assert.ok(
    fenceStart >= 0,
    "§4 must open its header block with a ```text fence",
  );
  const fenceEnd = section.findIndex(
    (line, index) => index > fenceStart && line.startsWith("```"),
  );
  assert.ok(fenceEnd > fenceStart, "§4 must close its header block");
  return section.slice(fenceStart + 1, fenceEnd);
}

function activeTaskBlock() {
  const section = sectionLines(/^## Active task\b/u);
  return section;
}

test("F-351: the §4 header block carries exactly one task identity and one status", () => {
  const block = currentFocusBlock();
  const identities = block.filter((line) => line.startsWith("Task:"));
  const statuses = block.filter((line) => line.startsWith("Task Status:"));
  assert.equal(
    identities.length,
    1,
    `the §4 header must name exactly one task identity, found: ${identities.join(" | ")}`,
  );
  assert.equal(
    statuses.length,
    1,
    `the §4 header must carry exactly one Task Status line, found: ${statuses.join(" | ")}`,
  );
});

test("F-351: every superseded revision in the §4 header is marked as history", () => {
  const block = currentFocusBlock();
  const unmarked = block.filter(
    (line) =>
      line.includes("Active revision") &&
      !line.trimStart().startsWith("(history)"),
  );
  assert.deepEqual(
    unmarked,
    [],
    `a superseded revision still reads as the live identity: ${unmarked.join(" | ")}`,
  );
});

test("F-351: the Active task block carries exactly one task identity and one status", () => {
  const block = activeTaskBlock();
  const identities = block.filter((line) => line.startsWith("Task:"));
  const statuses = block.filter((line) => line.startsWith("Task Status:"));
  assert.equal(
    identities.length,
    1,
    "the Active task block must name one task",
  );
  assert.equal(
    statuses.length,
    1,
    "the Active task block must carry exactly one Task Status line",
  );
});

test("F-351: the Active task header identity matches the live contract pointer", () => {
  if (!existsSync(CONTRACT_PATH)) {
    return; // no live contract: nothing to compare against
  }
  const contract = readFileSync(CONTRACT_PATH, "utf8");
  const contractTask = /^Task ID:[ ]*(\S+)/mu.exec(contract)?.[1];
  const contractRevision = /^Plan Revision:[ ]*(\S+)/mu.exec(contract)?.[1];
  assert.ok(contractTask, "a live contract must name its task id");
  assert.ok(contractRevision, "a live contract must name its plan revision");

  const block = activeTaskBlock();
  const planTask = block
    .find((line) => line.startsWith("Task:"))
    ?.slice(5)
    .trim();
  const planRevision = block
    .find((line) => line.startsWith("Plan Revision:"))
    ?.slice("Plan Revision:".length)
    .trim();
  assert.ok(
    planTask?.startsWith(contractTask),
    `PLAN names the task "${planTask}" while the live contract names "${contractTask}"`,
  );
  assert.equal(
    planRevision,
    contractRevision,
    "PLAN and the live contract must name the same Plan Revision",
  );
});
