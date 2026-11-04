// F-363 (R7-IG-03) — 25 tracked lines still cite `.agents/states/findings.md`,
// a path that no longer exists and is Git-ignored.
//
// No tracked document may cite the retired path as the live register: each
// citation is rewritten to the live register or explicitly marked historical
// with the move date.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...segments) =>
  readFileSync(path.join(REPO_ROOT, ...segments), "utf8");

const RETIRED = ".agents/states/findings.md";
const LIVE = "docs/execution/findings.md";
const MOVE_DATE = "2026-10-17";
const ARCHIVE_DIRECTORY = "docs/contracts/execution/archive/";

// The register itself documents the move, and the archived contracts are frozen
// history: the archive's own README is where the move is recorded for them.
const EXEMPT = new Set(["docs/execution/findings.md"]);

const HISTORICAL_MARKER =
  /historical|former|former path|retired|moved|renamed|predecessor|2026-10-17|chuyển sang|sản phẩm cũ/iu;

function trackedMarkdownFiles() {
  const output = execFileSync("git", ["ls-files", "*.md"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

test("F-363: the archive records the register move for the frozen contracts", () => {
  const archiveReadme = read(
    "docs",
    "contracts",
    "execution",
    "archive",
    "README.md",
  );
  assert.ok(
    archiveReadme.includes(RETIRED),
    "the archive README must name the retired register path it explains",
  );
  assert.ok(
    archiveReadme.includes(LIVE),
    "the archive README must name the live register",
  );
  assert.ok(
    archiveReadme.includes(MOVE_DATE),
    "the archive README must date the move",
  );
});

test("F-363: no tracked document cites the retired path as the live register", () => {
  const offenders = [];
  for (const relative of trackedMarkdownFiles()) {
    if (EXEMPT.has(relative)) continue;
    if (relative.startsWith(ARCHIVE_DIRECTORY)) continue; // covered by the archive README
    const contents = read(...relative.split("/"));
    if (!contents.includes(RETIRED)) continue;
    for (const paragraph of contents.split(/\n\s*\n/u)) {
      if (!paragraph.includes(RETIRED)) continue;
      const marked =
        paragraph.includes(LIVE) || HISTORICAL_MARKER.test(paragraph);
      if (!marked) {
        offenders.push(
          `${relative}: ${paragraph.slice(0, 140).replace(/\n/gu, " ")}`,
        );
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a tracked document cites the retired register path with no live path and no historical marker: ${offenders.join(" | ")}`,
  );
});

test("F-363: PLAN.md names the live register wherever it names the retired one", () => {
  const plan = read("PLAN.md");
  const offenders = [];
  for (const paragraph of plan.split(/\n\s*\n/u)) {
    if (!paragraph.includes(RETIRED)) continue;
    if (!paragraph.includes(LIVE) && !HISTORICAL_MARKER.test(paragraph)) {
      offenders.push(paragraph.slice(0, 140).replace(/\n/gu, " "));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `PLAN.md cites the retired register path with no live path and no historical marker: ${offenders.join(" | ")}`,
  );
});
