// M12/T9 F-369 - the tree the gateway loads must correspond to a named repo
// revision.
//
// The only proof this repository accepted for "this is what is running" was a
// digest ceremony over the packaged tree it had just written. No lane ever
// compared the repo source with the tree the gateway actually loads, so a
// green verify was compatible with a deployed tree that lacked every commit
// made after the last apply - which is exactly how the state-root guard
// (LEDGER_ROOT_ALREADY_JOINED) stayed in the repository while the tree that
// still minted nested ledger roots never had it.
//
// The gate here is the first option of the acceptance criterion: it diffs
// EVERY loaded file against its repo source, and it names the revision that
// source belongs to. The second half of the criterion is the pre-apply
// ceremony, which now refuses a nested governance root inside the real one.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { applyRouterTestEnv } from "./helpers/router-env.mjs";

applyRouterTestEnv();

const {
  AGENT_IDS,
  buildConfig,
  governancePluginFiles,
  PACKAGE_REWRITES,
  PACKAGE_RUNTIME_REWRITES,
} = await import("../integrations/openclaw/lib/policy.mjs");
const { createRuntimeBackup } =
  await import("../integrations/openclaw/topology/lib/runtime-backup.mjs");

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TOPOLOGY = "integrations/openclaw/topology";
const PLUGIN = "integrations/openclaw/plugins/zink-governance";

const identifiers = {
  discordGuildId: "12345678901234567",
  discordOwnerId: "32345678901234567",
  discordOfficeChannelId: "22345678901234567",
  discordResultsForumId: "42345678901234567",
  discordApprovalsForumId: "52345678901234567",
  discordIncidentsForumId: "62345678901234567",
};

/** The published rewrites, applied the way the packager applies them. */
function rewrite(target, content) {
  let result = content;
  for (const [search, replacement] of PACKAGE_REWRITES[target] ?? [])
    result = result.replaceAll(search, replacement);
  return result;
}
function rewriteRuntimeModule(content) {
  let result = content;
  for (const [search, replacement] of PACKAGE_RUNTIME_REWRITES)
    result = result.replaceAll(search, replacement);
  return result;
}

/**
 * The repo source of a deployed asset, derived from where the packager reads
 * it - never a second hand-written asset list.
 */
function sourceOf(asset) {
  if (asset.startsWith("lib/")) {
    const name = asset.slice("lib/".length);
    const topology = path.join(TOPOLOGY, "lib", name);
    if (existsSync(path.join(REPO_ROOT, topology)))
      return { relative: topology, target: "topology/lib" };
    const lib = path.join("integrations/openclaw/lib", name);
    if (existsSync(path.join(REPO_ROOT, lib)))
      return { relative: lib, target: asset };
    return null;
  }
  if (asset.startsWith("contracts/") || asset.startsWith("policy/"))
    return { relative: path.join(TOPOLOGY, asset), target: asset };
  // The runtime modules keep their repository-relative layout in the tree.
  return { relative: asset, target: null, runtimeModule: true };
}

const git = (...args) =>
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });

describe("M12/T9 F-369 - the tree the gateway loads corresponds to a named repo revision", () => {
  it("every loaded file is byte-identical to its repo source", () => {
    const {
      assets,
      entrypoint,
      manifest,
      package: pkg,
    } = governancePluginFiles();
    for (const [asset, packaged] of Object.entries(assets)) {
      if (asset === "governance-manifests.json") continue;
      const source = sourceOf(asset);
      assert.ok(source, `${asset}: the packager must ship a repo source`);
      const raw = readFileSync(path.join(REPO_ROOT, source.relative), "utf8");
      const expected = source.runtimeModule
        ? rewriteRuntimeModule(raw)
        : rewrite(source.target, raw);
      assert.equal(
        packaged,
        expected,
        `${asset}: the deployed bytes must be the repo source, byte for byte`,
      );
    }
    // The three files the packager writes beside the assets.
    assert.equal(
      entrypoint,
      rewrite(
        "entrypoint",
        readFileSync(path.join(REPO_ROOT, PLUGIN, "index.mjs"), "utf8"),
      ),
      "index.mjs: the deployed entrypoint must be the repo source",
    );
    assert.equal(
      pkg,
      readFileSync(path.join(REPO_ROOT, PLUGIN, "package.json"), "utf8"),
      "package.json: the deployed package must be the repo source",
    );
    assert.equal(
      manifest,
      readFileSync(
        path.join(REPO_ROOT, PLUGIN, "openclaw.plugin.json"),
        "utf8",
      ),
      "openclaw.plugin.json: the deployed manifest must be the repo source",
    );
  });

  it("the repo source is the content of a NAMED revision", () => {
    const revision = git("rev-parse", "HEAD").trim();
    assert.match(revision, /^[0-9a-f]{40}$/u, "HEAD must be a named revision");
    // The revision must be a commit this repository actually has.
    git("cat-file", "-e", `${revision}^{commit}`);
    const { assets } = governancePluginFiles();
    // The governance sources that decide what the runtime does: the tree the
    // gateway loads must be the source of the named revision, not of some
    // uncommitted working tree.
    for (const file of [
      "canonical.mjs",
      "guard.mjs",
      "ledger.mjs",
      "workflow.mjs",
      "schema.mjs",
      "runtime.mjs",
      "native-boundary.mjs",
    ]) {
      const relative = path.join(TOPOLOGY, "lib", file);
      const atRevision = git(
        "show",
        `${revision}:${relative.split(path.sep).join("/")}`,
      );
      assert.equal(
        assets[`lib/${file}`],
        rewrite("topology/lib", atRevision),
        `lib/${file}: the deployed bytes must be the source of ${revision}`,
      );
    }
  });

  it("the pre-apply ceremony refuses a nested governance root", async () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "zink-f369-nested-"));
    try {
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
      // The artifact the live host still carries: a second, empty,
      // permission-valid governance root INSIDE the real one.
      const nested = path.join(
        stateDir,
        "operator",
        "m7-t2",
        "ledger",
        "operator",
        "m7-t2",
        "ledger",
      );
      mkdirSync(nested, { recursive: true });
      writeFileSync(path.join(nested, "events.jsonl"), "", "utf8");
      writeFileSync(path.join(nested, "snapshot.json"), "{}", "utf8");
      await assert.rejects(
        () => createRuntimeBackup({ stateDir, identifiers }),
        /BACKUP_NESTED_LEDGER_ROOT_PRESENT/u,
      );
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
