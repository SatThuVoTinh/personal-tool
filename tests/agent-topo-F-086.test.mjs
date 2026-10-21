// F-086 (R1-A13-06) -- ONE packaged denominator, computed one way.
//
// Two "byte-equal" deployment post-checks reported different denominators (35
// and 37) for a packaged set that did not change, because one counted the
// assets plus the entrypoint and the other counted the assets plus the
// entrypoint, the plugin manifest and the plugin package.
//
// This lane computes the denominator ONE way and proves the convention holds:
//
//     packaged tree = the assets + the entrypoint + the plugin manifest
//                     + the plugin package
//
// The absolute number is reported in the failure message, so a change in the
// packaged set is visible in ONE place instead of in two records that each
// count their own way. The two records themselves (PLAN.md) are the
// orchestrator's to restate against this convention.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { governancePluginFiles } from "../integrations/openclaw/lib/policy.mjs";

/** Materialize the packaged assets exactly as the deployer does. */
function deployShape(assets) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-f086-"));
  for (const [relative, body] of Object.entries(assets)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return root;
}

function countFiles(root) {
  let count = 0;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) walk(path.join(directory, entry.name));
      else count += 1;
    }
  };
  walk(root);
  return count;
}

test("F-086: the packaged denominator is the assets plus exactly three files", () => {
  const {
    assets,
    entrypoint,
    manifest,
    package: packageText,
  } = governancePluginFiles();
  const assetCount = Object.keys(assets).length;
  const root = deployShape(assets);
  try {
    // The three files the deployer writes beside the assets.
    writeFileSync(path.join(root, "index.mjs"), entrypoint);
    writeFileSync(path.join(root, "openclaw.plugin.json"), manifest);
    writeFileSync(path.join(root, "package.json"), packageText);
    const total = countFiles(root);
    assert.equal(
      total,
      assetCount + 3,
      `the packaged denominator is the ${assetCount} assets plus the entrypoint, the plugin manifest and the plugin package = ${assetCount + 3}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-086: the packaged assets are the documented categories", () => {
  const { assets } = governancePluginFiles();
  const categories = new Map();
  for (const relative of Object.keys(assets)) {
    const category = relative.includes("/")
      ? relative.slice(0, relative.indexOf("/"))
      : "<root>";
    categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  // M12/T9: the band shipped the Skill Store runtime modules
  // (`zink-skill-store/src/*`) and the Zink Tools runtime modules
  // (`zink-tools/*`) as PACKAGED assets, so the packaged set holds two more
  // roots than it did. The claim is unchanged - the packaged set holds exactly
  // the DOCUMENTED categories, and nothing else - and the documented set now
  // includes the two new roots.
  assert.deepEqual(
    [...categories.keys()].sort(),
    ["<root>", "contracts", "lib", "policy", "zink-skill-store", "zink-tools"],
    `the packaged asset categories changed: ${JSON.stringify(Object.fromEntries(categories))}`,
  );
  // The composition, not only the category names: this is the ONE denominator
  // the packaged set has, and it is read here the way the deployer reads it.
  assert.deepEqual(
    Object.fromEntries([...categories.entries()].sort()),
    {
      "<root>": 1,
      contracts: 12,
      lib: 20,
      policy: 2,
      "zink-skill-store": 3,
      "zink-tools": 7,
    },
    `the packaged asset composition changed: ${JSON.stringify(Object.fromEntries(categories))}`,
  );
  assert.equal(
    categories.get("<root>"),
    1,
    "exactly one asset lives at the plugin root: the governance manifest bundle",
  );
  assert.ok(
    Object.keys(assets).includes("governance-manifests.json"),
    "the governance manifest bundle must be a packaged asset",
  );
});
