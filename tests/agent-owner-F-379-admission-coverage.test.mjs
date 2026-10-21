// M12/T9 F-379 — the admission list did not name every asset of the deployed
// build, so the preflight refused the deployment.
//
// Measured on the live host on 2026-10-22, READ-ONLY: the deployed extension
// at `~/.openclaw-zink/extensions/zink-governance` is byte-for-byte the build
// at commit `0b55dfa4` ("fix(openclaw): stop the STACK tag from refusing every
// multi-stack approval card", 2026-10-13) — 34 of 34 assets identical, and
// the 11 assets the current build adds are simply absent on the host (an absent
// asset is accepted; only a PRESENT file the builder cannot explain is
// refused).
//
// The runbook claims the admission list "is already rolled: every asset of the
// deployed build is named". It was not: 15 of the 34 deployed assets were
// missing from `ALLOWED_GOVERNANCE_ASSET_SHA256`, so `--preflight` refused the
// deployment with `Governance plugin asset drift detected`.
//
// This lane pins the claim the runbook makes: the list must name EVERY asset
// of the deployed build. The digests are DERIVED from the deploy commit — the
// asset's own bytes at that commit, packaged exactly as the builder packages
// them — so an entry can never be a transcription nobody can check.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The commit whose build the live host's extension carries, measured on
 * 2026-10-22: every one of the 34 assets it packages is byte-identical to the
 * deployed file, and the manifest it generates is byte-identical too.
 */
const DEPLOYED_BUILD = "0b55dfa40dffd77af49e49b230b888b0eea9e26a";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The allowlist table, as source text. */
function governanceAssetAllowlist(configureSource) {
  const start = configureSource.indexOf(
    "const ALLOWED_GOVERNANCE_ASSET_SHA256",
  );
  assert.notEqual(start, -1, "the asset allowlist must exist");
  const tableEnd = configureSource.indexOf("\n});", start);
  assert.notEqual(
    tableEnd,
    -1,
    "the asset allowlist must be terminated, or the slice below silently " +
      "reads past the table and drops the file's last character",
  );
  return configureSource.slice(start, tableEnd).replace(/\/\/[^\n]*/gu, "");
}

/** The digests admitted for one asset path, in table order. */
function admittedAssetDigests(table, rel) {
  const key = table.indexOf(`"${rel}": Object.freeze([`);
  if (key === -1) return [];
  const open = table.indexOf("[", key);
  const close = table.indexOf("]", open);
  assert.ok(
    open > -1 && close > open,
    `the entry for ${rel} must be a closed list of digests`,
  );
  return [
    ...table.slice(open + 1, close).matchAll(/["']([0-9a-f]{64})["']/gu),
  ].map((match) => match[1]);
}

/**
 * The digests the DEPLOYED build packages for every asset.
 *
 * The build is archived from its own commit and packaged there, so the digests
 * are the ones the host carries — measured, not transcribed. The child runs
 * inside the archived tree, because the packaging reads the tree it lives in.
 */
function deployedBuildDigests() {
  const root = mkdtempSync(path.join(tmpdir(), "zink-f379-"));
  try {
    const archive = path.join(root, "deploy.tar");
    execFileSync(
      "git",
      [
        "-c",
        `safe.directory=${REPO}`,
        "archive",
        "--format=tar",
        "-o",
        archive,
        DEPLOYED_BUILD,
      ],
      { cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    const tree = path.join(root, "tree");
    mkdirSync(tree);
    execFileSync("tar", ["-xf", archive, "-C", tree], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const child = path.join(tree, "f379-packaged-digests.mjs");
    writeFileSync(
      child,
      `import { createHash } from "node:crypto";
import { governancePluginFiles } from "./integrations/openclaw/lib/policy.mjs";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const out = {};
for (const [rel, contents] of Object.entries(governancePluginFiles().assets)) {
  out[rel] = sha256(contents);
}
process.stdout.write(JSON.stringify(out));
`,
      "utf8",
    );
    const raw = execFileSync(process.execPath, [child], {
      cwd: tree,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(raw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("M12/T9 F-379: the admission list names every asset of the deployed build", () => {
  const configureSource = readFileSync(
    path.join(REPO, "integrations", "openclaw", "configure.mjs"),
    "utf8",
  );
  const table = governanceAssetAllowlist(configureSource);
  const deployed = deployedBuildDigests();
  const assetCount = Object.keys(deployed).length;
  assert.ok(assetCount > 0, "the deployed build must package some assets");

  const missing = [];
  for (const [rel, digest] of Object.entries(deployed)) {
    if (!admittedAssetDigests(table, rel).includes(digest)) {
      missing.push(`${rel} ${digest}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `the admission list must name every asset of the deployed build \
(${DEPLOYED_BUILD.slice(0, 7)}); these are not named: ${missing.join(" | ")}`,
  );
});

test("M12/T9 F-379: the deployed build is the build the live host carries", () => {
  // The premise of the lane above: the deployed build is identified by a
  // commit, not by a number somebody typed. The commit must exist and must
  // package the assets the extension carries.
  const deployed = deployedBuildDigests();
  assert.ok(
    Object.hasOwn(deployed, "lib/discord-forum-tags.mjs"),
    "the deployed build must package the forum-tag resolver",
  );
  assert.ok(
    Object.hasOwn(deployed, "governance-manifests.json"),
    "the deployed build must package the generated governance manifests",
  );
  const show = execFileSync(
    "git",
    ["-c", `safe.directory=${REPO}`, "show", "-s", "--format=%ci", DEPLOYED_BUILD],
    { cwd: REPO, encoding: "utf8" },
  ).trim();
  assert.match(
    show,
    /^2026-10-13 /u,
    `the deployed build commit must be the one measured on the host: ${show}`,
  );
});
