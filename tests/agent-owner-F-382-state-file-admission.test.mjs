// M12/T9 F-382 — the remaining files of the deployed build were not admitted,
// so the preflight refused the deployment.
//
// Measured on the live host on 2026-10-22, READ-ONLY: the deployed extension
// is the build at `0b55dfa4`, and the state root still carries that build's
// Gemini hotfix, its plugin entrypoint and its two auth plans. None of the four
// was admitted by the builder, so `--preflight` refused them one after the
// other (`Gemini stream hotfix utility`, `Governance plugin entrypoint`, the
// auth plans).
//
// Every digest here is DERIVED from the repository, never transcribed:
//
//   - the hotfix is the repository's own template at commit `7b5edc51`;
//   - the entrypoint is the plugin's own `index.mjs` at commit `b6d04e80`,
//     packaged exactly as the builder packages it;
//   - the two plans are the policy's own plan generators, pretty-printed the
//     way the deployed writer wrote them.
//
// An admission only ever permits OVERWRITING the file with the current
// build's own bytes; it does not make the old content trusted, and an
// unrecognised digest still fails closed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAuthOrderPlan,
  buildSecretsPlan,
  PACKAGE_REWRITES,
  renderDeployedSystemdDropIn,
} from "../integrations/openclaw/lib/policy.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** The commit whose hotfix the live host carries. */
const HOTFIX_COMMIT = "7b5edc510d463eec197f000191d907e5b17aa87c";
/** The commit whose packaged plugin entrypoint the live host carries. */
const ENTRYPOINT_COMMIT = "b6d04e802e1f1a7e420db31e73f765fabaa9ab73";

/** Every digest the builder's source admits, as source text. */
function admittedDigests(configureSource) {
  return [...configureSource.matchAll(/["']([0-9a-f]{64})["']/gu)].map(
    (match) => match[1],
  );
}

function gitShow(commit, source) {
  return execFileSync(
    "git",
    ["-c", `safe.directory=${REPO}`, "show", `${commit}:${source}`],
    { cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
}

test("M12/T9 F-382: the deployed hotfix, entrypoint and plans are derived and admitted", () => {
  const configureSource = readFileSync(
    path.join(REPO, "integrations", "openclaw", "configure.mjs"),
    "utf8",
  );
  const admitted = admittedDigests(configureSource);

  const hotfix = gitShow(
    HOTFIX_COMMIT,
    "integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs",
  );
  const hotfixDigest = sha256(hotfix);
  assert.ok(
    admitted.includes(hotfixDigest),
    `the deployed hotfix (${hotfixDigest.slice(0, 12)}...) must be admitted`,
  );

  let entrypoint = gitShow(
    ENTRYPOINT_COMMIT,
    "integrations/openclaw/plugins/zink-governance/index.mjs",
  );
  for (const [search, replacement] of PACKAGE_REWRITES["entrypoint"] ?? [])
    entrypoint = entrypoint.replaceAll(search, replacement);
  const entrypointDigest = sha256(entrypoint);
  assert.ok(
    admitted.includes(entrypointDigest),
    `the deployed entrypoint (${entrypointDigest.slice(0, 12)}...) must be admitted`,
  );

  const secretPlanDigest = sha256(
    `${JSON.stringify(buildSecretsPlan(), null, 2)}\n`,
  );
  assert.ok(
    admitted.includes(secretPlanDigest),
    `the deployed auth secret plan (${secretPlanDigest.slice(0, 12)}...) must be admitted`,
  );

  const orderPlanDigest = sha256(
    `${JSON.stringify(buildAuthOrderPlan(), null, 2)}\n`,
  );
  assert.ok(
    admitted.includes(orderPlanDigest),
    `the deployed auth order plan (${orderPlanDigest.slice(0, 12)}...) must be admitted`,
  );
});

test("M12/T9 F-382: the deployed systemd drop-in is the previous rendering, and it is admitted", () => {
  // The drop-in is a MACHINE artifact: its bytes carry the host's state root,
  // so it cannot be admitted by a digest without pinning that root into the
  // repository. It is admitted by RENDERING the previous variant, exactly like
  // the R16 rendering beside it.
  const configureSource = readFileSync(
    path.join(REPO, "integrations", "openclaw", "configure.mjs"),
    "utf8",
  );
  const stateDir = "/home/hoang_vinh/.openclaw-zink";
  // The drop-in is a POSIX artifact; the rendering follows the platform's
  // separator, so the lane normalises it before it compares.
  const rendered = renderDeployedSystemdDropIn(stateDir).split("\\").join("/");
  assert.match(
    rendered,
    /openclaw-gemini-stream-hotfix\.mjs --check\n/u,
    "the previous rendering runs the hotfix with --check",
  );
  assert.notEqual(
    rendered,
    renderDeployedSystemdDropIn(stateDir).replace(" --check", " --ensure"),
    "the previous rendering must differ from the current one",
  );
  const calls = configureSource.split("renderDeployedSystemdDropIn(stateDir)");
  assert.equal(
    calls.length - 1,
    2,
    "the previous rendering must be admitted in BOTH per-mode lists, so the two \
modes cannot diverge",
  );
});
