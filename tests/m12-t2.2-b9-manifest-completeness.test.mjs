import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_CONTRACTS,
  CANONICAL_TOOL_CONTRACTS,
  generateSchemaManifest,
  verifySchemaManifestChecksums,
  resolveContractFilePath,
  PINNED_SCHEMA_MANIFEST_CHECKSUM,
} from "../integrations/openclaw/topology/lib/schema.mjs";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCHEMA_PATH = path.join(
  REPO_ROOT,
  "integrations/openclaw/topology/lib/schema.mjs",
);

function manifestChecksum(manifest) {
  return createHash("sha256")
    .update(
      JSON.stringify({ contracts: manifest.contracts, tools: manifest.tools }),
    )
    .digest("hex");
}

// R4-V01-01: the generator skipped any canonical member it could not resolve, and the
// verifier then iterated only whatever survived -- so a manifest that quietly lost a
// contract still reported `valid: true`. Completeness is now asserted at both ends.

test("the generated manifest covers every canonical member", () => {
  const manifest = generateSchemaManifest();
  for (const name of CANONICAL_CONTRACTS) {
    assert.ok(name in manifest.contracts, `${name} must appear in contracts`);
  }
  for (const name of CANONICAL_TOOL_CONTRACTS) {
    assert.ok(name in manifest.tools, `${name} must appear in tools`);
  }
});

test("the committed-shaped manifest still verifies", () => {
  assert.equal(verifySchemaManifestChecksums().valid, true);
});

test("a manifest that lost a canonical member is invalid, not merely smaller", () => {
  const [dropped] = CANONICAL_CONTRACTS;
  const doctored = JSON.parse(JSON.stringify(generateSchemaManifest()));
  delete doctored.contracts[dropped];
  doctored.manifestChecksum = manifestChecksum(doctored);
  const result = verifySchemaManifestChecksums(doctored);
  assert.equal(result.valid, false);
  assert.ok(
    (result.incomplete ?? []).includes(dropped),
    `must name the lost member; got ${JSON.stringify(result)}`,
  );
});

test("a manifest that lost a canonical tool is invalid too", () => {
  const [dropped] = CANONICAL_TOOL_CONTRACTS;
  const doctored = JSON.parse(JSON.stringify(generateSchemaManifest()));
  delete doctored.tools[dropped];
  doctored.manifestChecksum = manifestChecksum(doctored);
  const result = verifySchemaManifestChecksums(doctored);
  assert.equal(result.valid, false);
  assert.ok(
    (result.incomplete ?? []).includes(dropped),
    `must name the lost tool; got ${JSON.stringify(result)}`,
  );
});

test("completeness means canonical members, so an extra entry is judged on its hash", () => {
  const [existing] = CANONICAL_CONTRACTS;
  const augmented = JSON.parse(JSON.stringify(generateSchemaManifest()));
  augmented.contracts["zink-extra-preview"] = {
    file: `${existing}.schema.json`,
    hash: "0".repeat(64),
    title: "extra",
    version: "1.0.0",
  };
  const result = verifySchemaManifestChecksums(augmented);
  assert.equal(result.mismatch, "zink-extra-preview");
  assert.equal(result.incomplete, undefined);
});

test("the generator no longer skips an unresolvable canonical member", () => {
  const source = readFileSync(SCHEMA_PATH, "utf8");
  const start = source.indexOf("export function generateSchemaManifest()");
  const end = source.indexOf(
    "export function verifySchemaManifestChecksums",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);
  assert.ok(
    !/\bcontinue\b/u.test(body),
    "a canonical member that does not resolve must fail loudly, not be passed over",
  );
});

// =========================================================================
// M12/T9 F-128 / F-303 / F-322 — the published manifest version, the
// repository-relative resolution, and the COMMITTED expectation.
//
// Measured pre-fix: every contract reported the version "1.0.0" whether or
// not it declared one, the resolver could be fed a same-named file by the
// working directory, and the verifier regenerated the manifest it was
// comparing against, so no lane compared the repository against a committed
// expectation.
// =========================================================================
test("F-128: every published version comes from the contract, never from a default", () => {
  const manifest = generateSchemaManifest();
  const expectedVersion = (parsed) => {
    const declared = parsed?.["x-zink-contract-version"] ?? parsed?.version;
    return typeof declared === "string" && declared.trim().length > 0
      ? declared.trim()
      : "unknown";
  };
  for (const [name, info] of Object.entries(manifest.contracts)) {
    const file = resolveContractFilePath(info.file || name);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(
      info.version,
      expectedVersion(parsed),
      `${name} must publish the version its own contract declares`,
    );
  }
  for (const [name, info] of Object.entries(manifest.tools)) {
    const file = resolveContractFilePath(info.file || name);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(
      info.version,
      expectedVersion(parsed),
      `${name} must publish the version its own contract declares`,
    );
  }
  // The version is a FIELD of its own: a contract that declares one is
  // published with it, without any hash comparison.
  const declared = Object.entries(manifest.tools).filter(
    ([, info]) => info.version !== "unknown",
  );
  assert.ok(
    declared.length > 0,
    "at least one tool contract must publish its declared version",
  );
});

test("F-303: contract resolution never consults the working directory", () => {
  const source = readFileSync(SCHEMA_PATH, "utf8");
  const start = source.indexOf("export function resolveContractFilePath");
  const end = source.indexOf("export function loadContractSchema", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);
  assert.equal(
    body.includes("process.cwd()"),
    false,
    "the resolver must not consult the working directory: a same-named file outside the repository could supply the bytes",
  );
  // And the resolution is the repository's own file.
  const resolved = resolveContractFilePath("tool-call");
  assert.ok(resolved, "the tool-call envelope must resolve");
  assert.match(
    resolved,
    /zink-tools[\\/]contracts[\\/]tool-call\.schema\.json$/u,
  );
});

test("F-322: the verifier compares the repository against a COMMITTED expectation", () => {
  const manifest = generateSchemaManifest();
  assert.equal(
    manifest.manifestChecksum,
    PINNED_SCHEMA_MANIFEST_CHECKSUM,
    "the committed expectation must match the repository's contracts; a contract edit without a re-pin must fail here",
  );
  const result = verifySchemaManifestChecksums();
  assert.equal(result.valid, true, JSON.stringify(result));
});
