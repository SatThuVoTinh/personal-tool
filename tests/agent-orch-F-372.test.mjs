// F-372 (new in M12/T9) — the working tree carries no untracked, ownerless
// top-level tree.
//
// `models/` and `shared/` were the two such trees the F-137 gate found; they
// were moved aside under `scratch/legacy-empty-trees/`. `applications/` was a
// third one — two empty directories, untracked, and named by no canonical
// document.
//
// The gate: every top-level directory on disk is either tracked by Git, ignored
// by Git, one of the standard build/tool directories, or named with an owner in
// `docs/architecture/repository-topology.md`. A directory that is none of those
// is ownerless scaffolding, and a reader cannot tell which module it belongs to.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const STANDARD_DIRECTORIES = new Set([".git", ".tmp", "node_modules"]);
const OWNER_MAP = path.join(
  REPO_ROOT,
  "docs",
  "architecture",
  "repository-topology.md",
);

function trackedTopLevel() {
  return execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => (l.includes("/") ? l.split("/")[0] : l));
}

function ignoredTopLevel() {
  const out = execFileSync(
    "git",
    ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return new Set(
    out
      .split("\n")
      .map((l) => l.trim().replace(/\/$/u, ""))
      .filter((l) => l && !l.includes("/"))
      .map((l) => l),
  );
}

test("F-372: no top-level directory on disk is untracked, unowned and unignored", () => {
  const tracked = new Set(trackedTopLevel());
  const ignored = ignoredTopLevel();
  const ownerMap = readFileSync(OWNER_MAP, "utf8");
  const onDisk = readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const ownerless = onDisk.filter((name) => {
    if (STANDARD_DIRECTORIES.has(name)) return false;
    if (tracked.has(name)) return false;
    if (ignored.has(name)) return false;
    return (
      !ownerMap.includes(`\`${name}/\``) && !ownerMap.includes(`\`${name}\``)
    );
  });

  assert.deepEqual(
    ownerless,
    [],
    `ownerless top-level trees on disk: ${ownerless.join(", ")} — move them aside under scratch/legacy-empty-trees/ or name an owner for them in docs/architecture/repository-topology.md`,
  );
});

test("F-372: the legacy scaffolding the owner map does not name lives under scratch/", () => {
  const aside = path.join(REPO_ROOT, "scratch", "legacy-empty-trees");
  if (!existsSync(aside)) return;
  const entries = readdirSync(aside, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const entry of entries) {
    assert.ok(
      !existsSync(path.join(REPO_ROOT, entry)),
      `${entry}/ is back at the repository root — it needs an owner in docs/architecture/repository-topology.md`,
    );
  }
});
