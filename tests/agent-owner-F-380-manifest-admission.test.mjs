// M12/T9 F-380 — the deployed plugin manifest was not admitted, so the
// preflight refused the deployment.
//
// Measured on the live host on 2026-10-22, READ-ONLY: the deployed extension
// at `~/.openclaw-zink/extensions/zink-governance` is the build at commit
// `0b55dfa4`, and its plugin manifest (`openclaw.plugin.json`) is the file as
// of `01489aa9` — the commit that last changed it before that build. The
// current build's manifest adds two config-schema properties
// (`discordGuildId`, `skillApprovalDecisionRef`), so the deployed bytes are
// neither the current bytes nor the legacy R11 manifest the builder admits.
//
// The manifest check compares the PARSED JSON and tolerates one member
// (`ownerDiscordId`); it had NO admission list at all, so a manifest from a
// previous build was refused — the apply could not reach the extension it
// was supposed to replace.
//
// This lane pins the admission: the deployed manifest's digest must be derived
// from the commit that produced it, and it must be admitted by the builder's
// manifest list. The digest is never transcribed — it is read from the commit.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The commit whose manifest bytes the live host carries. It is the commit that
 * last changed the manifest before the deployed build (`0b55dfa4`).
 */
const DEPLOYED_MANIFEST_COMMIT = "01489aa996aef7ab04789ba3bb08dcd0b0974c68";
const MANIFEST_SOURCE =
  "integrations/openclaw/plugins/zink-governance/openclaw.plugin.json";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** The manifest bytes the deployed build carried, read from the commit. */
function deployedManifestBytes() {
  return execFileSync(
    "git",
    [
      "-c",
      `safe.directory=${REPO}`,
      "show",
      `${DEPLOYED_MANIFEST_COMMIT}:${MANIFEST_SOURCE}`,
    ],
    { cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
}

/** The digests the builder's manifest list admits. */
function admittedManifestDigests(configureSource) {
  const start = configureSource.indexOf(
    "const ALLOWED_GOVERNANCE_MANIFEST_SHA256",
  );
  assert.notEqual(
    start,
    -1,
    "the builder must keep a manifest admission list, so a manifest from a \
previous build can be recognised instead of refused",
  );
  const block = configureSource.slice(start);
  return [
    ...block.matchAll(/["']([0-9a-f]{64})["']/gu),
  ].map((match) => match[1]);
}

test("M12/T9 F-380: the deployed manifest is derived from its commit and admitted", () => {
  const configureSource = readFileSync(
    path.join(REPO, "integrations", "openclaw", "configure.mjs"),
    "utf8",
  );
  const deployed = sha256(deployedManifestBytes());
  const admitted = admittedManifestDigests(configureSource);
  assert.ok(
    admitted.includes(deployed),
    `the deployed manifest's digest (${deployed.slice(0, 12)}...) must be admitted by \
the builder's manifest list, or --preflight refuses the deployed extension`,
  );
  // The current build's manifest is accepted by content comparison, so it must
  // NOT be listed: a list entry is a statement about a PREVIOUS build.
  const current = sha256(readFileSync(path.join(REPO, MANIFEST_SOURCE), "utf8"));
  assert.notEqual(
    current,
    deployed,
    "the current build's manifest must differ from the deployed one, or the \
admission would be a statement about the current build",
  );
  assert.equal(
    admitted.includes(current),
    false,
    "the current build's manifest is accepted by content comparison and must \
not be listed as a predecessor",
  );
});
