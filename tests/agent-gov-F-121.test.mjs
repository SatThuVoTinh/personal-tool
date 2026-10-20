// F-121 (R1-A01-03) — `platforms/` names a fourth module that no canonical
// architecture document owns.
//
// Every top-level module path must map to a documented owner.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ARCHITECTURE_DIRECTORY = path.join(REPO_ROOT, "docs", "architecture");

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
    if (!trimmed) continue;
    const [first] = trimmed.split("/");
    if (!trimmed.includes("/")) continue; // a root file, not a directory
    directories.add(first);
  }
  return [...directories].sort();
}

test("F-121: every tracked top-level directory has a canonical architecture owner", () => {
  const owners = new Map();
  for (const directory of trackedTopLevelDirectories()) {
    owners.set(
      directory,
      architectureDocuments
        .filter((document) => document.contents.includes(`${directory}/`))
        .map((document) => document.name),
    );
  }
  const unowned = [...owners.entries()]
    .filter(([, documents]) => documents.length === 0)
    .map(([directory]) => directory);
  assert.deepEqual(
    unowned,
    [],
    `a tracked top-level directory is owned by no canonical architecture document: ${unowned.join(", ")}`,
  );
});

test("F-121: the platforms tree is owned by a canonical architecture document", () => {
  const owners = architectureDocuments.filter((document) =>
    document.contents.includes("platforms/"),
  );
  assert.ok(
    owners.length > 0,
    "no canonical architecture document owns the platforms/ tree",
  );
  assert.ok(
    owners.some((document) =>
      document.contents.includes("platforms/README.md"),
    ),
    "the owning document must name the tree it owns",
  );
});
