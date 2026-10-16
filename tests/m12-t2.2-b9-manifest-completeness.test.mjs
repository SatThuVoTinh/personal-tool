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
