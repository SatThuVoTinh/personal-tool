// M12/T9 F-115 (R2-B04-01): packaging cannot express the runtime dependency
// set, so the whole governed tool surface was permanently unavailable on the
// deployed extension.
//
// The plugin loads its runtime modules at run time, by repository-relative
// path. Packaging shipped neither the modules nor the tree they live in, so a
// host without the repository answered GOVERNANCE_DEPENDENCY_MISSING or
// ADAPTER_UNAVAILABLE for every governed tool call.
//
// The lanes below prove the packaged tree is SELF-SUFFICIENT: every relative
// import of every packaged module resolves inside the deployed shape, and the
// shared modules the guard needs are present and loadable.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import {
  PACKAGED_RUNTIME_MODULES,
  governancePluginFiles,
} from "../integrations/openclaw/lib/policy.mjs";

/** Materialize the packaged assets exactly as the deployer does. */
function deployShape(assets) {
  const root = mkdtempSync(path.join(os.tmpdir(), "f115-"));
  for (const [relative, body] of Object.entries(assets)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return root;
}

const relativeSpecifiers = (source) =>
  [...source.matchAll(/(?:from|import)\s+"(\.[^"]+)"/gu)].map((m) => m[1]);

test("F-115: every runtime module of the packaged tree is a packaged asset", () => {
  const { assets } = governancePluginFiles();
  for (const relative of PACKAGED_RUNTIME_MODULES) {
    assert.ok(
      assets[relative],
      `${relative} must travel with the packaged build`,
    );
  }
});

test("F-115: the deployed shape resolves every relative import of every packaged module", () => {
  const { assets } = governancePluginFiles();
  const root = deployShape(assets);
  try {
    const broken = [];
    for (const relative of Object.keys(assets).filter((key) =>
      key.endsWith(".mjs"),
    )) {
      const source = readFileSync(path.join(root, relative), "utf8");
      for (const specifier of relativeSpecifiers(source)) {
        const target = path.resolve(
          path.dirname(path.join(root, relative)),
          specifier,
        );
        if (!existsSync(target)) {
          broken.push(`${relative} -> ${specifier}`);
        }
      }
    }
    assert.deepEqual(
      broken,
      [],
      `the deployed tree must resolve its own module graph: ${broken.join(", ")}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-115: the packaged runtime modules carry no repository-only import", () => {
  const { assets } = governancePluginFiles();
  for (const relative of PACKAGED_RUNTIME_MODULES) {
    const source = assets[relative];
    assert.equal(
      source.includes("../../integrations/openclaw/lib/"),
      false,
      `${relative} must not import the repository layout in the deployed tree`,
    );
  }
});

test("F-115: the packaged guard resolves a shared module from the plugin root", () => {
  const { assets } = governancePluginFiles();
  const guard = assets["lib/guard.mjs"];
  assert.equal(
    guard.includes('"../" + relativePath'),
    true,
    "the deployed guard must look for a shared module one level above its own lib/ directory",
  );
});

test("F-115: the deployed shared modules load from the deployed tree alone", async () => {
  const { assets } = governancePluginFiles();
  const root = deployShape(assets);
  try {
    const validator = await import(
      pathToFileURL(path.join(root, "zink-tools", "sql", "validator.mjs")).href
    );
    assert.equal(typeof validator.validateSqlQuery, "function");
    const pathSafety = await import(
      pathToFileURL(path.join(root, "zink-tools", "common", "path-safety.mjs"))
        .href
    );
    assert.equal(typeof pathSafety.validateArtifactLogicalPath, "function");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
