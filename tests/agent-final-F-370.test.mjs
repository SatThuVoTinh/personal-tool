// M12/T9 F-370 (legacy R8-M1-02): two quarantined copies of the governance
// plugin stayed inside the live discovery path carrying the same manifest id.
//
// The plugin loader scans `<stateDir>/extensions/`, so a tree left there under
// another directory name still registers as a candidate for the governed
// plugin id, and the copy that executes is decided by origin precedence
// rather than by the deployment record.
//
// Acceptance criteria: "the deploy and rollback ceremonies move a displaced
// tree outside every scanned directory (or rename its manifest id) as one
// transaction, a gate asserts exactly one manifest per plugin id under the
// extensions root, and the quarantine convention the live host actually uses
// is named in a runbook."
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createRuntimeBackup,
  findDisplacedPluginTrees,
  quarantineDisplacedPluginTrees,
  restoreT1RuntimeFiles,
  runtimeBackupPath,
} from "../integrations/openclaw/topology/lib/runtime-backup.mjs";

const identifiers = Object.freeze({
  discordGuildId: "12345678901234567",
  discordOwnerId: "32345678901234567",
  discordOfficeChannelId: "22345678901234567",
  discordResultsForumId: "42345678901234567",
  discordApprovalsForumId: "52345678901234567",
  discordIncidentsForumId: "62345678901234567",
});

const MANIFEST = JSON.stringify({
  id: "zink-governance",
  name: "Zink Governance",
});

function withRouterEnv() {
  const previous = {
    ZINK_ROUTER_HOST: process.env.ZINK_ROUTER_HOST,
    ZINK_ROUTER_PORT: process.env.ZINK_ROUTER_PORT,
    ZINK_ROUTER_API_KEY: process.env.ZINK_ROUTER_API_KEY,
  };
  process.env.ZINK_ROUTER_HOST = "router.invalid";
  process.env.ZINK_ROUTER_PORT = "1";
  process.env.ZINK_ROUTER_API_KEY = "test-router-key-not-a-credential";
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "agent-final-f370-"));
}

function writePluginTree(root, name) {
  const directory = path.join(root, "extensions", name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "openclaw.plugin.json"), MANIFEST, "utf8");
  writeFileSync(
    path.join(directory, "index.mjs"),
    "export default {};\n",
    "utf8",
  );
  writeFileSync(
    path.join(directory, "package.json"),
    '{"name":"zink-governance"}\n',
    "utf8",
  );
  return directory;
}

/** The gate: exactly one manifest per plugin id under the extensions root. */
function manifestsUnderExtensionsRoot(root) {
  const extensionsRoot = path.join(root, "extensions");
  if (!existsSync(extensionsRoot)) return new Map();
  const ids = new Map();
  for (const entry of readdirSync(extensionsRoot, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(
      extensionsRoot,
      entry.name,
      "openclaw.plugin.json",
    );
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    ids.set(entry.name, manifest.id);
  }
  return ids;
}

function assertOneManifestPerPluginId(root) {
  const byId = new Map();
  for (const id of manifestsUnderExtensionsRoot(root).values()) {
    byId.set(id, (byId.get(id) ?? 0) + 1);
  }
  for (const [id, count] of byId) {
    assert.equal(
      count,
      1,
      `exactly one manifest may carry the plugin id ${id} under the extensions root`,
    );
  }
  return byId;
}

test("F-370: the deploy ceremony moves a displaced tree out of the scanned directory", async () => {
  const root = fixture();
  try {
    writePluginTree(root, "zink-governance");
    // The live host's convention: a sibling that KEEPS the governed id.
    writePluginTree(root, "zink-governance-pre-mig-20260928");
    assert.equal(
      findDisplacedPluginTrees(root).length,
      1,
      "the displaced tree must be found before the ceremony runs",
    );

    const restore = withRouterEnv();
    try {
      await createRuntimeBackup({ stateDir: root, identifiers });
    } finally {
      restore();
    }

    assert.equal(
      existsSync(
        path.join(root, "extensions", "zink-governance-pre-mig-20260928"),
      ),
      false,
      "the displaced tree must not stay inside the scanned directory",
    );
    const quarantine = path.join(
      runtimeBackupPath(root),
      "quarantined-t2",
      "extensions",
      "zink-governance-pre-mig-20260928",
    );
    assert.equal(
      existsSync(quarantine),
      true,
      "the displaced tree must be quarantined outside every scanned directory",
    );
    assertOneManifestPerPluginId(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-370: the rollback ceremony moves a displaced tree out of the scanned directory", async () => {
  const root = fixture();
  try {
    writePluginTree(root, "zink-governance");
    const restore = withRouterEnv();
    try {
      await createRuntimeBackup({ stateDir: root, identifiers });
    } finally {
      restore();
    }
    // The rollback runs against a tree that is still displaced.
    const displaced = path.join(
      root,
      "extensions",
      "zink-governance-pre-r4-20260928",
    );
    writePluginTree(root, "zink-governance-pre-r4-20260928");

    const restore2 = withRouterEnv();
    try {
      await restoreT1RuntimeFiles({ stateDir: root, identifiers });
    } finally {
      restore2();
    }

    assert.equal(
      existsSync(displaced),
      false,
      "the rollback must leave no displaced tree inside the scanned directory",
    );
    assertOneManifestPerPluginId(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-370: a tree that carries another plugin id is left alone", () => {
  const root = fixture();
  try {
    const other = path.join(root, "extensions", "some-other-plugin");
    mkdirSync(other, { recursive: true });
    writeFileSync(
      path.join(other, "openclaw.plugin.json"),
      JSON.stringify({ id: "some-other-plugin", name: "Other" }),
      "utf8",
    );
    writePluginTree(root, "zink-governance");
    const moved = quarantineDisplacedPluginTrees(root);
    assert.deepEqual(moved, []);
    assert.equal(existsSync(other), true);
    assertOneManifestPerPluginId(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-370: the quarantine convention of the live host is named in a runbook", () => {
  const runbook = readFileSync(
    path.join(
      process.cwd(),
      "docs",
      "runbooks",
      "governed-plugin-quarantine.md",
    ),
    "utf8",
  );
  // The live host's convention, measured read-only on 2026-10-21.
  assert.match(runbook, /zink-governance-pre-mig-20260928/u);
  assert.match(runbook, /zink-governance-pre-r4-20260928/u);
  assert.match(runbook, /extensions/u);
});
