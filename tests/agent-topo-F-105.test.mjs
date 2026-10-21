// M12/T9 F-105 (R1-A01-01) - the legacy orchestration patterns module
// re-created the retired L&SC Data Plant and a second orchestrator.
//
// `integrations/openclaw/orchestration/patterns/index.mjs` exported
// `executePattern1_N8nToR2Landing` ... `executePattern10_SyntheticComposition`:
// the landing -> silver -> gold stitching plus the MLflow/DagsHub
// model-registry sync that AGENTS.md A9 forbids ("an in-repo ETL control
// plane, a Bronze/Silver/Gold lakehouse, and a second orchestrator that
// duplicates OpenClaw/n8n"). Its only importer was
// `tests/m7-t4-orchestration.test.mjs`, so the forbidden surface was
// GREEN-TESTED - which is what the row is about.
//
// The owner authorised the deletion of that tracked file ("nhCo dXuAt") and
// the rewrite of the suite so the provider adapters keep their own lanes.
// This gate is the invariant the deletion has to hold:
//
//   "No tracked, test-enforced module in this repository stitches
//    landing/silver/gold tiers, a model-registry sync, or a composition
//    function that sequences them; the data/compute flow exists only as the
//    external contract in docs/architecture/lsc-data-flow.md."
//
// It is GREEN against the fixed tree and RED the moment the module comes
// back - as a tracked file, as a test-enforced file, or as a file on disk.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/** The tracked modules, from the index, without touching the working tree. */
function trackedFiles(pattern) {
  return execFileSync("git", ["ls-files", pattern], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

/** The exported names of a module, read from its source. */
function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(
    /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/gu,
  )) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/gu)) {
    for (const entry of match[1].split(",")) {
      const name = entry
        .split(/\s+as\s+/u)
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Whether a module carries the forbidden surface: the pattern executors, a
 * composition that sequences the tiers, or a model-registry sync.
 */
function forbiddenSurface(modulePath, source) {
  const names = exportedNames(source);
  const reasons = [];
  const lower = source.toLowerCase();
  const tiers = ["landing", "silver", "gold"].filter((tier) =>
    lower.includes(tier),
  );
  for (const name of names) {
    if (/^executePattern\d+_/u.test(name)) {
      reasons.push(`${modulePath} exports ${name} (the pattern executors)`);
    }
    if (
      /Composition|Synthesis|Stitch/iu.test(name) &&
      tiers.includes("landing") &&
      tiers.includes("silver") &&
      tiers.includes("gold")
    ) {
      reasons.push(
        `${modulePath} exports ${name} (a composition that sequences the landing/silver/gold tiers)`,
      );
    }
    if (
      /Sync/iu.test(name) &&
      lower.includes("mlflow") &&
      lower.includes("dagshub")
    ) {
      reasons.push(
        `${modulePath} exports ${name} (the MLflow/DagsHub model-registry sync)`,
      );
    }
  }
  return reasons;
}

/** The module paths the tracked test files import. */
function importedByTests() {
  const imported = new Set();
  for (const file of trackedFiles("tests/*.test.mjs")) {
    const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/gu)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const resolved = path
        .relative(REPO_ROOT, path.resolve(path.dirname(file), specifier))
        .split(path.sep)
        .join("/");
      imported.add(resolved);
      imported.add(`${resolved}.mjs`);
    }
  }
  return imported;
}

test("F-105: no tracked, test-enforced module stitches the tiers or the model registry", () => {
  const imported = importedByTests();
  const offences = [];
  for (const file of trackedFiles("*.mjs")) {
    const absolute = path.join(REPO_ROOT, file);
    if (!existsSync(absolute)) {
      // A tracked file that is not on disk is a pending deletion. It may not
      // be test-enforced: the suite that imported it has to be rewritten.
      if (imported.has(file)) {
        offences.push(
          `${file} is not on disk but a tracked test still imports it`,
        );
      }
      continue;
    }
    for (const reason of forbiddenSurface(
      file,
      readFileSync(absolute, "utf8"),
    )) {
      offences.push(
        `${reason}${imported.has(file) ? " and it is TEST-ENFORCED" : ""}`,
      );
    }
  }
  assert.deepEqual(
    offences,
    [],
    "the forbidden orchestration surface must not live in a tracked, test-enforced module",
  );
});
test("F-105: the legacy orchestration patterns module stays deleted", () => {
  const legacy = path.join(
    REPO_ROOT,
    "integrations",
    "openclaw",
    "orchestration",
    "patterns",
    "index.mjs",
  );
  assert.equal(
    existsSync(legacy),
    false,
    "the owner-authorised deletion of the legacy patterns module must hold",
  );
  // The index entry is the orchestrator's `git rm` to complete: the file is
  // gone from the working tree and the commit removes it from the tree. What
  // this gate must catch is the module coming BACK - and a module that is
  // tracked and present at the same time is exactly that.
  const tracked = trackedFiles(
    "integrations/openclaw/orchestration/patterns/index.mjs",
  );
  assert.equal(
    tracked.length === 0 || existsSync(legacy) === false,
    true,
    "the legacy patterns module must not be tracked and present at the same time",
  );
});

test("F-105: the data/compute flow exists only as the external contract", () => {
  // The architecture document is where the flow is ALLOWED to live.
  const contract = readFileSync(
    path.join(REPO_ROOT, "docs", "architecture", "lsc-data-flow.md"),
    "utf8",
  );
  assert.match(
    contract,
    /not a separate repository module/iu,
    "the external data/compute flow must stay documented as NOT a repository module",
  );
  for (const provider of ["R2", "Kaggle", "Databricks"]) {
    assert.ok(
      contract.includes(provider),
      `the external flow contract must keep naming ${provider}`,
    );
  }
});
