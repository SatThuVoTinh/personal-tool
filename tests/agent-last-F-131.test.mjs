// M12/T9 F-131 - the runtime-backup enumerator and the packager must derive
// from ONE source of truth.
//
// The enumerator used to carry its own hand-written list of what a plugin tree
// may contain: four root files and a name pattern per directory. The packager
// (`governancePluginFiles()`) ships a different and larger set - 44 assets
// today, including the `zink-skill-store/**` and `zink-tools/**` runtime
// modules that travel with the build. Every governed asset the enumerator did
// not know was an unexplained hard failure of `configure.mjs --apply`, and the
// same guard runs in `restoreT1RuntimeFiles`, so the rollback refused to run
// either - before the quarantine move, so the tree could not be rolled back at
// all.
//
// The lane therefore materializes the tree the PACKAGER deploys - every asset
// it ships, at the paths it ships them - and asserts that the backup AND the
// rollback both succeed. It then asserts that the refusals that must survive
// do survive: anything outside the deployed set, and any symlink.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import process from "node:process";

import { applyRouterTestEnv } from "./helpers/router-env.mjs";

applyRouterTestEnv();

const { AGENT_IDS, buildConfig, governancePluginFiles } =
  await import("../integrations/openclaw/lib/policy.mjs");
const { createRuntimeBackup, restoreT1RuntimeFiles, runtimeBackupPath } =
  await import("../integrations/openclaw/topology/lib/runtime-backup.mjs");

const identifiers = {
  discordGuildId: "12345678901234567",
  discordOwnerId: "32345678901234567",
  discordOfficeChannelId: "22345678901234567",
  discordResultsForumId: "42345678901234567",
  discordApprovalsForumId: "52345678901234567",
  discordIncidentsForumId: "62345678901234567",
};

/** A state root with a config, the workspace instructions and NO plugin tree. */
function buildStateRoot(tag) {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), `zink-f131-${tag}-`));
  writeFileSync(
    path.join(stateDir, "openclaw.json"),
    JSON.stringify(buildConfig({ stateDir, identifiers })),
    "utf8",
  );
  for (const agentId of AGENT_IDS) {
    const workspace = path.join(stateDir, "workspaces", agentId);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(
      path.join(workspace, "AGENTS.md"),
      `synthetic ${agentId}`,
      "utf8",
    );
  }
  return stateDir;
}

/** The tree `configure.mjs` deploys, materialized exactly as it deploys it. */
function deployPluginTree(stateDir) {
  const {
    assets,
    manifest,
    package: pkg,
    entrypoint,
  } = governancePluginFiles();
  const pluginDir = path.join(stateDir, "extensions", "zink-governance");
  for (const [relative, body] of Object.entries(assets)) {
    const target = path.join(pluginDir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body, "utf8");
  }
  writeFileSync(path.join(pluginDir, "index.mjs"), entrypoint, "utf8");
  writeFileSync(path.join(pluginDir, "package.json"), pkg, "utf8");
  writeFileSync(path.join(pluginDir, "openclaw.plugin.json"), manifest, "utf8");
  return pluginDir;
}

describe("M12/T9 F-131 - the backup enumerator and the packager share one asset set", () => {
  it("backs up and restores the tree the packager deploys", async () => {
    const stateDir = buildStateRoot("deployed");
    try {
      const pluginDir = deployPluginTree(stateDir);
      const { assets } = governancePluginFiles();
      // The packager ships runtime modules that live OUTSIDE `lib/`,
      // `contracts/` and `policy/` - the enumerator used to refuse them.
      assert.ok(
        Object.keys(assets).some((relative) =>
          relative.startsWith("zink-skill-store/"),
        ),
        "the packager must ship the skill-store runtime modules",
      );
      assert.ok(
        Object.keys(assets).some((relative) =>
          relative.startsWith("zink-tools/"),
        ),
        "the packager must ship the tools runtime modules",
      );

      const backup = await createRuntimeBackup({ stateDir, identifiers });
      assert.equal(backup.t1PolicyVerified, true);
      const written = JSON.parse(
        readFileSync(
          path.join(runtimeBackupPath(stateDir), "manifest.json"),
          "utf8",
        ),
      );
      const captured = written.files.map((entry) => entry.relative);
      for (const relative of Object.keys(assets))
        assert.ok(
          captured.includes(`extensions/zink-governance/${relative}`),
          `${relative}: a governed asset must be captured by the backup`,
        );

      const restored = await restoreT1RuntimeFiles({ stateDir, identifiers });
      assert.equal(restored.filesRestored, true);
      assert.equal(
        readFileSync(
          path.join(pluginDir, "zink-skill-store", "src", "catalog.mjs"),
          "utf8",
        ),
        assets["zink-skill-store/src/catalog.mjs"],
        "the rollback must restore a newly governed runtime module",
      );
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("refuses content outside the deployed set and names the offending path", async () => {
    const stateDir = buildStateRoot("outside");
    try {
      const pluginDir = deployPluginTree(stateDir);
      writeFileSync(path.join(pluginDir, "README.md"), "not governed", "utf8");
      await assert.rejects(
        () => createRuntimeBackup({ stateDir, identifiers }),
        /BACKUP_UNEXPECTED_PLUGIN_CONTENT: README\.md/u,
      );
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("refuses a symlink inside the plugin tree", async () => {
    const stateDir = buildStateRoot("symlink");
    try {
      const pluginDir = deployPluginTree(stateDir);
      const external = path.join(stateDir, "external");
      mkdirSync(external, { recursive: true });
      writeFileSync(path.join(external, "sentinel.txt"), "sentinel", "utf8");
      symlinkSync(
        external,
        path.join(pluginDir, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await assert.rejects(
        () => createRuntimeBackup({ stateDir, identifiers }),
        /BACKUP_SYMLINK_DENIED: linked/u,
      );
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
