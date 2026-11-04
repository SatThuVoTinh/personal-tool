// F-050 (R5-E13-05) -- the machine-path guard covers the RESOLUTION dependency
// set, derived rather than hand-enumerated.
//
// The guard named two files by hand:
//
//   integrations/openclaw/topology/lib/schema.mjs
//   integrations/openclaw/topology/lib/guard.mjs
//
// while the file that actually carried the machine-specific literal was the
// plugin entrypoint -- the module that resolves contracts in the deployed
// tree -- and that file was never read by the guard. A guard that enumerates
// its own scope by hand cannot notice a file that joins the scope.
//
// This lane DERIVES the resolution dependency set (the transitive closure of
// the relative imports of the contract-resolution module and of the plugin
// entrypoint) and scans every file in it. A new file that joins the
// resolution path is therefore covered without anyone editing a list.
//
// The premise correction is recorded here as well: the literal this finding
// quotes is no longer in the plugin entrypoint. It was removed by the A2
// packaging work, and the guard's hand-enumerated list was never widened, so
// the defect that survived was the SCOPE, not the literal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const RESOLUTION_ROOTS = [
  // The module that exports the contract resolver.
  "integrations/openclaw/topology/lib/schema.mjs",
  // The deployed entrypoint: the module that resolves contracts in the plugin
  // tree, and the file this finding measured the literal in.
  "integrations/openclaw/plugins/zink-governance/index.mjs",
];

const IMPORT = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/gu;

function resolveRelative(fromRelative, specifier) {
  const base = path.posix.join(path.posix.dirname(fromRelative), specifier);
  const candidates = [base, `${base}.mjs`, `${base}/index.mjs`];
  for (const candidate of candidates) {
    try {
      readFileSync(path.join(REPO, candidate), "utf8");
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function resolutionDependencySet() {
  const seen = new Set();
  const queue = [...RESOLUTION_ROOTS];
  while (queue.length > 0) {
    const relative = queue.pop();
    if (seen.has(relative)) continue;
    seen.add(relative);
    let source;
    try {
      source = readFileSync(path.join(REPO, relative), "utf8");
    } catch {
      continue;
    }
    IMPORT.lastIndex = 0;
    let match;
    while ((match = IMPORT.exec(source)) !== null) {
      const resolved = resolveRelative(relative, match[1]);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen].sort();
}

const DEPENDENCIES = resolutionDependencySet();

test("F-050: the derived resolution set covers the plugin entrypoint and the resolver", () => {
  for (const relative of RESOLUTION_ROOTS) {
    assert.ok(
      DEPENDENCIES.includes(relative),
      `${relative} must be part of the derived resolution dependency set`,
    );
  }
  // The two files the hand-enumerated list named are still in scope.
  for (const relative of [
    "integrations/openclaw/topology/lib/schema.mjs",
    "integrations/openclaw/topology/lib/guard.mjs",
  ]) {
    assert.ok(
      DEPENDENCIES.includes(relative),
      `${relative} must remain in scope`,
    );
  }
  assert.ok(
    DEPENDENCIES.length > 5,
    "the derived set must be more than the two hand-enumerated files",
  );
});

// A machine path that is only PROSE (a comment explaining what the production
// host looks like) is not a machine path the runtime resolves. A machine path
// in CODE is.
function machinePathInCode(source, needle) {
  const lines = source.split(/\r?\n/u);
  for (const line of lines) {
    let from = 0;
    for (;;) {
      const index = line.indexOf(needle, from);
      if (index === -1) break;
      const comment = line.lastIndexOf("//", index);
      if (comment === -1) return true;
      from = index + needle.length;
    }
  }
  return false;
}

test("F-050: no machine-specific absolute path in the resolution dependency set", () => {
  const machinePaths = [
    "/mnt/c/Users/HOANG VINH",
    "C:/Users/HOANG VINH",
    "/home/hoang_vinh",
  ];
  for (const relative of DEPENDENCIES) {
    const source = readFileSync(path.join(REPO, relative), "utf8");
    for (const needle of machinePaths) {
      assert.ok(
        !machinePathInCode(source, needle),
        `${relative} must not carry the machine-specific path ${needle} in code`,
      );
    }
  }
});
