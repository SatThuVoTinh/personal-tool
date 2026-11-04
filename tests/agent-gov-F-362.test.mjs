// F-362 (R7-IG-02) — a tracked archive orders re-application of three held
// diffs whose content is already in the tree.
//
// An archived contract must not order re-application of work that is already in
// the tree: the pending-admission files are annotated `ALREADY LANDED via
// <commit>`, and the live rule that governs a re-application carries the check
// that the target diff is absent before it is offered to an executor.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...segments) =>
  readFileSync(path.join(REPO_ROOT, ...segments), "utf8");

const STATES_DIRECTORY = path.join(REPO_ROOT, ".agents", "states");
const STATES_PROTOCOL = read(".agents", "states", "README.md");
const ARCHIVE_README = read(
  "docs",
  "contracts",
  "execution",
  "archive",
  "README.md",
);

const PENDING_ADMISSION_RULE =
  "A `*-pending-admission.md` file must not be offered to an executor unless a recorded check proves its diff is still absent from the tracked tree; a diff that is already applied is annotated `ALREADY LANDED via <commit>` and is never re-applied.";

function pendingAdmissionFiles() {
  if (!existsSync(STATES_DIRECTORY)) return [];
  return readdirSync(STATES_DIRECTORY)
    .filter((name) => name.endsWith("-pending-admission.md"))
    .map((name) => `.agents/states/${name}`);
}

function addedLines(contents) {
  const blocks = [];
  let current = null;
  for (const line of contents.split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/u.exec(line);
    if (header) {
      current = { target: header[1], added: [] };
      blocks.push(current);
      continue;
    }
    if (current && line.startsWith("+") && !line.startsWith("+++")) {
      current.added.push(line.slice(1));
    }
  }
  return blocks;
}

function appliedRatio(contents) {
  const blocks = addedLines(contents);
  let total = 0;
  let present = 0;
  for (const block of blocks) {
    const targetPath = path.join(REPO_ROOT, block.target);
    if (!existsSync(targetPath)) continue;
    const target = readFileSync(targetPath, "utf8").split("\n");
    for (const line of block.added) {
      total += 1;
      if (target.includes(line)) present += 1;
    }
  }
  return { total, present };
}

test("F-362: the state protocol carries the absent-diff check", () => {
  assert.ok(
    STATES_PROTOCOL.includes(PENDING_ADMISSION_RULE),
    "the protocol must state when a pending-admission file may be offered to an executor",
  );
});

test("F-362: the archive points at the live check for its frozen re-application instructions", () => {
  assert.ok(
    ARCHIVE_README.includes(".agents/states/README.md"),
    "the archive README must point at the live rule that governs a re-application",
  );
});

test("F-362: a pending-admission file whose diff is already applied says ALREADY LANDED", () => {
  const offenders = [];
  for (const relative of pendingAdmissionFiles()) {
    const contents = read(...relative.split("/"));
    const { total, present } = appliedRatio(contents);
    if (total === 0) continue;
    if (present / total < 0.5) continue;
    if (!contents.includes("ALREADY LANDED")) {
      offenders.push(
        `${relative} — ${present}/${total} of its added lines are already in the tracked tree`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a held diff is already applied but still reads as pending work: ${offenders.join(" | ")}`,
  );
});

test("F-362: an ALREADY LANDED annotation names the commit that landed it", () => {
  for (const relative of pendingAdmissionFiles()) {
    const contents = read(...relative.split("/"));
    if (!contents.includes("ALREADY LANDED")) continue;
    const annotation = contents
      .split("\n")
      .find((line) => line.includes("ALREADY LANDED"));
    assert.match(
      annotation,
      /`[0-9a-f]{7,40}`/u,
      `${relative} must name the commit that landed the diff`,
    );
  }
});
