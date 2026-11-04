// M12/T9 F-381 — the resolver on the live host was not admitted, so the
// preflight refused the deployment.
//
// Measured on the live host on 2026-10-22, READ-ONLY: the deployed resolver
// (`~/.openclaw-zink/bin/openclaw-pass-resolver`) is the repository's own
// template with the EIGHT ids it carries — the seven Discord bot tokens and
// the gateway token — and no Gemini id and no router key. It was written to the
// live state by a diagnostic `configure.mjs --apply` that bypassed the
// transaction wrapper, and the repository recorded that it was "no longer on
// disk" and therefore deliberately not admitted.
//
// That premise is dead: the file IS on the host. The preflight refuses it with
// `Password-store resolver`, so the apply cannot reach the extension it is
// supposed to replace.
//
// The digest is DERIVED here, never transcribed: the deployed bytes are the
// repository's template with the canonical Discord and gateway ids — the two
// tables the policy itself publishes — and the lane rebuilds them and
// compares.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PASS_ENTRY_IDS } from "../integrations/openclaw/lib/policy.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(
  REPO,
  "integrations",
  "openclaw",
  "templates",
  "openclaw-pass-resolver",
);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/**
 * The resolver the live host carries, rebuilt from the repository's template
 * and the canonical Discord and gateway ids.
 */
function deployedResolverBytes() {
  const template = readFileSync(TEMPLATE, "utf8");
  const ids = [
    ...Object.values(PASS_ENTRY_IDS.discord),
    PASS_ENTRY_IDS.gateway,
  ];
  const rebuilt = template.replace(
    "__ZINK_ALLOWED_IDS__",
    JSON.stringify(ids, null, 2),
  );
  assert.notEqual(
    rebuilt,
    template,
    "the template must carry the allowlist marker, or the rebuild is the \
template itself",
  );
  return { bytes: rebuilt, ids };
}

/** The digests the builder's resolver list admits. */
function admittedResolverDigests(configureSource) {
  const start = configureSource.indexOf("const PREVIOUS_PASS_RESOLVER_SHA256");
  assert.notEqual(
    start,
    -1,
    "the builder must keep a resolver admission list, so a resolver from a \
previous build can be recognised instead of refused",
  );
  const block = configureSource.slice(start);
  const end = block.indexOf("];");
  assert.notEqual(end, -1, "the resolver admission list must be terminated");
  return [...block.slice(0, end).matchAll(/["']([0-9a-f]{64})["']/gu)].map(
    (match) => match[1],
  );
}

test("M12/T9 F-381: the resolver on the host is derived from the repository and admitted", () => {
  const configureSource = readFileSync(
    path.join(REPO, "integrations", "openclaw", "configure.mjs"),
    "utf8",
  );
  const { bytes, ids } = deployedResolverBytes();
  const digest = sha256(bytes);
  assert.equal(
    ids.length,
    8,
    `the deployed resolver carries the seven Discord ids and the gateway id: ${ids.join(", ")}`,
  );
  const admitted = admittedResolverDigests(configureSource);
  assert.ok(
    admitted.includes(digest),
    `the resolver the host carries (${digest.slice(0, 12)}...) must be admitted by \
the builder's resolver list, or --preflight refuses the deployment`,
  );
});

test("M12/T9 F-381: the current resolver is not admitted as a predecessor", () => {
  // The current build's resolver is accepted by content comparison, so listing
  // it would be a statement about the current build.
  const configureSource = readFileSync(
    path.join(REPO, "integrations", "openclaw", "configure.mjs"),
    "utf8",
  );
  const current = execFileSync(
    process.execPath,
    [
      "-e",
      `import("./integrations/openclaw/lib/policy.mjs").then((m) => {
        const { createHash } = require("node:crypto");
        process.stdout.write(createHash("sha256").update(m.passResolverContents()).digest("hex"));
      });`,
    ],
    { cwd: REPO, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  ).trim();
  const admitted = admittedResolverDigests(configureSource);
  assert.equal(
    admitted.includes(current),
    false,
    "the current build's resolver is accepted by content comparison and must \
not be listed as a predecessor",
  );
});
