// M12/T9 F-185 - the backup manifests must derive their governance revision
// from ONE authoritative source, and their validation must accept every
// revision the machinery actually wrote.
//
// Both manifests used to stamp a frozen literal - "m7-t2-r12" - and both
// validations demanded that same literal. The literal is not the revision the
// repository publishes any more (the authoritative constant is
// `GOVERNANCE_VERSION`, `topology/lib/canonical.mjs`), so the restore
// evidence could not attribute the captured bytes to a governance revision -
// and the moment the literal was bumped, every manifest already written
// failed validation, so recovery authorization failed closed on real evidence.
//
// The lane therefore asserts:
//   1. both manifests carry the authoritative constant;
//   2. the two agree;
//   3. a manifest written under an EARLIER published revision still validates
//      (bumping the constant never invalidates real written manifests);
//   4. a revision the machinery never wrote is still refused;
//   5. the frozen literal is gone from both sources.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { applyRouterTestEnv } from "./helpers/router-env.mjs";

applyRouterTestEnv();

const { AGENT_IDS, buildConfig } =
  await import("../integrations/openclaw/lib/policy.mjs");
const { GOVERNANCE_VERSION } =
  await import("../integrations/openclaw/topology/lib/canonical.mjs");
const { createRuntimeBackup, runtimeBackupPath, verifyRuntimeBackup } =
  await import("../integrations/openclaw/topology/lib/runtime-backup.mjs");
const { NATIVE_PINNED_RUNTIME_VERSION, nativeBackupManifest } =
  await import("../integrations/openclaw/topology/lib/native-patch.mjs");

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const identifiers = {
  discordGuildId: "12345678901234567",
  discordOwnerId: "32345678901234567",
  discordOfficeChannelId: "22345678901234567",
  discordResultsForumId: "42345678901234567",
  discordApprovalsForumId: "52345678901234567",
  discordIncidentsForumId: "62345678901234567",
};

// A published revision the machinery wrote before the constant moved on.
const EARLIER_REVISION = "m7-t2-r12";

function buildStateRoot(tag) {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), `zink-f185-${tag}-`));
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

describe("M12/T9 F-185 - the backup manifests derive their governance revision", () => {
  it("the runtime-backup manifest carries the authoritative revision", async () => {
    const stateDir = buildStateRoot("runtime");
    try {
      await createRuntimeBackup({ stateDir, identifiers });
      const manifest = JSON.parse(
        readFileSync(
          path.join(runtimeBackupPath(stateDir), "manifest.json"),
          "utf8",
        ),
      );
      assert.equal(
        manifest.governance_version,
        GOVERNANCE_VERSION,
        "the runtime-backup manifest must stamp the authoritative revision",
      );
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("the native-patch manifest carries the authoritative revision", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "zink-f185-native-"));
    try {
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "openclaw",
          version: NATIVE_PINNED_RUNTIME_VERSION,
        }),
        "utf8",
      );
      const manifest = nativeBackupManifest(root);
      assert.equal(
        manifest.version,
        GOVERNANCE_VERSION,
        "the native backup manifest must stamp the authoritative revision",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the two manifests agree", async () => {
    const stateDir = buildStateRoot("agree");
    try {
      await createRuntimeBackup({ stateDir, identifiers });
      const runtimeManifest = JSON.parse(
        readFileSync(
          path.join(runtimeBackupPath(stateDir), "manifest.json"),
          "utf8",
        ),
      );
      const root = mkdtempSync(path.join(os.tmpdir(), "zink-f185-native-"));
      try {
        writeFileSync(
          path.join(root, "package.json"),
          JSON.stringify({
            name: "openclaw",
            version: NATIVE_PINNED_RUNTIME_VERSION,
          }),
          "utf8",
        );
        const nativeManifest = nativeBackupManifest(root);
        assert.equal(
          runtimeManifest.governance_version,
          nativeManifest.version,
          "the runtime-backup and native-patch manifests must agree",
        );
        assert.equal(nativeManifest.version, GOVERNANCE_VERSION);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("a manifest written under an earlier revision still validates", async () => {
    const stateDir = buildStateRoot("earlier");
    try {
      await createRuntimeBackup({ stateDir, identifiers });
      const manifestPath = path.join(
        runtimeBackupPath(stateDir),
        "manifest.json",
      );
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest.governance_version = EARLIER_REVISION;
      writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
      const verified = await verifyRuntimeBackup({ stateDir, identifiers });
      assert.equal(
        verified.t1PolicyVerified,
        true,
        "a manifest written under an earlier revision must still restore",
      );
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("a revision the machinery never wrote is still refused", async () => {
    const stateDir = buildStateRoot("unknown");
    try {
      await createRuntimeBackup({ stateDir, identifiers });
      const manifestPath = path.join(
        runtimeBackupPath(stateDir),
        "manifest.json",
      );
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest.governance_version = "m0-t0-not-a-revision";
      writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
      await assert.rejects(
        () => verifyRuntimeBackup({ stateDir, identifiers }),
        /BACKUP_MANIFEST_INVALID/u,
      );
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("the frozen literal is gone from both sources", () => {
    for (const relative of [
      "integrations/openclaw/topology/lib/runtime-backup.mjs",
      "integrations/openclaw/topology/lib/native-patch.mjs",
    ]) {
      const source = readFileSync(path.join(REPO_ROOT, relative), "utf8");
      assert.doesNotMatch(
        source,
        /version: "m7-t2-r12"/u,
        `${relative}: the frozen governance literal must be gone`,
      );
    }
  });
});
