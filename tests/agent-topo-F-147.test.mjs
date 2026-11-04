// M12/T9 F-147 - the T1 restore never installed the preimages it captured.
//
// `restoreT1RuntimeFiles` wrote the `t1-config.json` fallback into
// `openclaw.json` and RENAMED the current workspace AGENTS.md and the
// governance extension tree into `quarantined-t2/`. `root/preimages/` was
// never read back, so the call reported `filesRestored: true` while the live
// state matched no preimage at all - the recovery needed an operator copying
// files by hand from a directory the function never names.
//
// These lanes prove:
//   1. the restore RE-INSTALLS the captured preimages: a preimage the apply
//      deleted exists again, byte for byte;
//   2. the current content is still preserved in the quarantine artifact, and
//      the live file carries the preimage;
//   3. `filesRestored: true` is reported only after the live state has been
//      compared with the manifest.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import test from "node:test";
import {
  createRuntimeBackup,
  restoreT1RuntimeFiles,
  runtimeBackupPath,
} from "../integrations/openclaw/topology/lib/runtime-backup.mjs";
import { applyRouterTestEnv } from "./helpers/router-env.mjs";
import { buildConfig } from "../integrations/openclaw/lib/policy.mjs";

// The generated config resolves the router endpoint from the environment at
// BUILD time, so a unit test has to supply the placeholder values.
applyRouterTestEnv();

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const identifiers = {
  discordGuildId: "12345678901234567",
  discordOwnerId: "32345678901234567",
  discordOfficeChannelId: "22345678901234567",
  discordResultsForumId: "42345678901234567",
  discordApprovalsForumId: "52345678901234567",
  discordIncidentsForumId: "62345678901234567",
};
const AGENTS_BODY = "synthetic prior workspace";
const digest = (body) => createHash("sha256").update(body).digest("hex");

/** A state root with a config, a workspace AGENTS.md and a backup of both. */
async function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "f147-backup-"));
  writeFileSync(
    path.join(root, "openclaw.json"),
    JSON.stringify(buildConfig({ stateDir: root, identifiers })),
  );
  const workspace = path.join(root, "workspaces", "main");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(path.join(workspace, "AGENTS.md"), AGENTS_BODY);
  await createRuntimeBackup({ stateDir: root, identifiers });
  return { root, workspace };
}

function manifestOf(root) {
  return JSON.parse(
    readFileSync(path.join(runtimeBackupPath(root), "manifest.json"), "utf8"),
  );
}

test("F-147: the restore re-installs the preimage the apply deleted", async () => {
  const { root, workspace } = await fixture();
  try {
    const manifest = manifestOf(root);
    const entry = manifest.files.find(
      (file) => file.relative === "workspaces/main/AGENTS.md",
    );
    assert.ok(entry?.existed, "the fixture must capture the workspace file");
    assert.equal(entry.digest, digest(AGENTS_BODY));
    // The apply removed the file: the restore has to put it back.
    rmSync(path.join(workspace, "AGENTS.md"));
    const restored = await restoreT1RuntimeFiles({
      stateDir: root,
      identifiers,
    });
    assert.equal(restored.filesRestored, true);
    const body = readFileSync(path.join(workspace, "AGENTS.md"), "utf8");
    assert.equal(
      digest(body),
      entry.digest,
      "the restored file must hash to the manifest preimage digest",
    );
    assert.equal(body, AGENTS_BODY);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-147: the current content is quarantined AND the preimage is installed", async () => {
  const { root, workspace } = await fixture();
  try {
    const manifest = manifestOf(root);
    const entry = manifest.files.find(
      (file) => file.relative === "workspaces/main/AGENTS.md",
    );
    const restored = await restoreT1RuntimeFiles({
      stateDir: root,
      identifiers,
    });
    assert.equal(restored.filesRestored, true);
    // The preimage is live again.
    assert.equal(
      digest(readFileSync(path.join(workspace, "AGENTS.md"), "utf8")),
      entry.digest,
      "the live file must carry the captured preimage",
    );
    // …and the content that was there is preserved, not destroyed.
    const quarantined = path.join(
      runtimeBackupPath(root),
      "quarantined-t2",
      "workspaces",
      "main",
      "AGENTS.md",
    );
    assert.equal(readFileSync(quarantined, "utf8"), AGENTS_BODY);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-147: every manifest entry matches the expectation after the restore", async () => {
  const { root } = await fixture();
  try {
    const manifest = manifestOf(root);
    await restoreT1RuntimeFiles({ stateDir: root, identifiers });
    for (const entry of manifest.files) {
      const target = path.join(root, entry.relative);
      if (!entry.existed) {
        assert.equal(
          existsSync(target),
          false,
          `${entry.relative} must be absent: the manifest recorded it as absent`,
        );
        continue;
      }
      assert.ok(existsSync(target), `${entry.relative} must exist again`);
      if (entry.relative === "openclaw.json") {
        // The T1 config is the manifest's `t1_config_digest`.
        assert.equal(
          digest(readFileSync(target)),
          manifest.t1_config_digest,
          "openclaw.json must carry the T1 config the manifest pinned",
        );
        continue;
      }
      assert.equal(
        digest(readFileSync(target)),
        entry.digest,
        `${entry.relative} must hash to its manifest preimage digest`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-147: the report is produced only after the live state was compared", () => {
  const source = readFileSync(
    path.join(
      REPO_ROOT,
      "integrations",
      "openclaw",
      "topology",
      "lib",
      "runtime-backup.mjs",
    ),
    "utf8",
  );
  assert.ok(
    source.includes("restoreMismatches"),
    "the restore must compare the live state with the manifest",
  );
  assert.ok(
    source.includes("RESTORE_VERIFICATION_FAILED"),
    "a mismatch must be a named refusal",
  );
  assert.ok(
    source.indexOf("restoreMismatches") <
      source.lastIndexOf("filesRestored: true"),
    "the comparison must run before the report",
  );
  assert.ok(
    source.includes('path.join(root, "preimages"'),
    "the restore must read the captured preimages back",
  );
});
