// F-352 (R7-OC1-05) — the release-gate table has no M9 row although M9 owns a
// tracked suite, and its rows are out of milestone order.
//
// Either the table gains the missing row backed by evidence that exists, or the
// table declares itself a subset and points at the complete derivation — and the
// ordering is fixed either way.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLAN = readFileSync(path.join(REPO_ROOT, "PLAN.md"), "utf8");
const LINES = PLAN.split("\n");

function releaseGateSection() {
  const start = LINES.findIndex((line) =>
    line.startsWith("## 3. Current release gate"),
  );
  const end = LINES.findIndex(
    (line, index) => index > start && /^## /u.test(line),
  );
  return LINES.slice(start, end < 0 ? undefined : end);
}

function milestoneIds() {
  return releaseGateSection()
    .filter((line) => /^\|\s*M\d+/u.test(line))
    .map((line) => Number(/^\|\s*M(\d+)/u.exec(line)?.[1]));
}

function milestonesThatOwnATrackedSuite() {
  const output = execFileSync("git", ["ls-files", "tests/"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const milestones = new Set();
  for (const file of output.split("\n")) {
    const match = /\/m(\d+)-/u.exec(file.trim());
    if (match) milestones.add(Number(match[1]));
  }
  return [...milestones].sort((a, b) => a - b);
}

test("F-352: the release-gate rows are in milestone order", () => {
  const ids = milestoneIds();
  assert.ok(ids.length > 0, "the release-gate table must carry milestone rows");
  const sorted = [...ids].sort((a, b) => a - b);
  assert.deepEqual(
    ids,
    sorted,
    "a reader cannot tell which milestone owns evidence when the rows are out of order",
  );
});

test("F-352: the table declares itself a subset and points at the complete derivation", () => {
  const section = releaseGateSection().join("\n");
  assert.match(
    section,
    /subset/iu,
    "the table must declare that it is a subset of the milestone history",
  );
  assert.match(
    section,
    /tests\//u,
    "the complete derivation must name the tracked suites it is derived from",
  );
  assert.match(
    section,
    /docs\/contracts\/execution\/archive\//u,
    "the complete derivation must name the archived contracts it is derived from",
  );
});

test("F-352: every milestone that owns a tracked suite is a row or is named as excluded", () => {
  const section = releaseGateSection().join("\n");
  const rows = new Set(milestoneIds());
  const missing = milestonesThatOwnATrackedSuite().filter(
    (milestone) => !rows.has(milestone) && !section.includes(`M${milestone}`),
  );
  assert.deepEqual(
    missing,
    [],
    `a milestone that owns a tracked suite has neither a row nor a recorded exclusion: ${missing.map((m) => `M${m}`).join(", ")}`,
  );
});
