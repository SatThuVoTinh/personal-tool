// F-360 (R7-X1-01) — the published module inventory names no owner for the
// tracked files that hold workflow state.
//
// README.md's tree block and AGENTS.md §9 must name an owner for every tracked
// top-level directory, and the directory-ownership assertion must pass for all of
// them.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ARCHITECTURE_DIRECTORY = path.join(REPO_ROOT, "docs", "architecture");

const README = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
const AGENTS = readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8");

const architectureDocuments = readdirSync(ARCHITECTURE_DIRECTORY)
  .filter((name) => name.endsWith(".md"))
  .map((name) => ({
    name,
    contents: readFileSync(path.join(ARCHITECTURE_DIRECTORY, name), "utf8"),
  }));

function trackedTopLevelDirectories() {
  const output = execFileSync("git", ["ls-files"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const directories = new Set();
  for (const file of output.split("\n")) {
    const trimmed = file.trim();
    if (!trimmed || !trimmed.includes("/")) continue;
    directories.add(trimmed.split("/")[0]);
  }
  return [...directories].sort();
}

test("F-360: the published tree block names the integrations hosting boundary", () => {
  assert.match(
    README,
    /integrations\/openclaw\//u,
    "README.md's tree block must publish where the OpenClaw host runtime lives",
  );
  assert.match(
    README,
    /platforms\//u,
    "README.md's tree block must publish the platforms tree",
  );
});

test("F-360: AGENTS.md §9 names an owner for the integrations hosting boundary", () => {
  assert.match(
    AGENTS,
    /integrations\/openclaw\//u,
    "AGENTS.md §9 must name the host boundary that carries the workflow state",
  );
  assert.match(
    AGENTS,
    /platforms\//u,
    "AGENTS.md §9 must say what the platforms tree is",
  );
});

test("F-360: every tracked top-level directory maps to a documented owner", () => {
  const unowned = trackedTopLevelDirectories().filter(
    (directory) =>
      !architectureDocuments.some((document) =>
        document.contents.includes(`${directory}/`),
      ),
  );
  assert.deepEqual(
    unowned,
    [],
    `no canonical architecture document owns: ${unowned.join(", ")}`,
  );
});

test("F-360: the three logical modules are still exactly three", () => {
  assert.match(
    AGENTS,
    /three logical modules only/u,
    "the hosting boundary must not become a fourth logical module",
  );
});
