// M12/T9-R4 — F-469 (legacy R9-L05-8): the technical evidenceDigest was
// stamped inside validateTechnicalArtifact BEFORE evaluateResultGate mutated
// status/checks/errors for artifact-set path security, so a
// FAIL(artifactSetPathSecurity) result shipped a stale PASS-era digest. The
// digest must commit to the FINAL artifact-set verdict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { validateTechnicalArtifact, evaluateResultGate } = await import(
  new URL(
    "../integrations/openclaw/lib/artifact-validator.mjs",
    import.meta.url,
  ).href
);

function expectedDigest(result) {
  const sortedChecks = Object.keys(result.checks).slice().sort().join(",");
  const raw = `${result.sha256 || "none"}:${result.sizeBytes || 0}:${result.status}:${sortedChecks}:${result.errors.length}`;
  return createHash("sha256").update(raw).digest("hex");
}

const COMPLETE_PDF = `%PDF-1.7\n%${"p".repeat(80)}\n1 0 obj\n<< /Type /Catalog >>\nendobj\nstartxref\n0\n%%EOF\n`;

function makePassingPrimary(dir) {
  const primary = path.join(dir, "primary.pdf");
  writeFileSync(primary, COMPLETE_PDF);
  return primary;
}

test("F-469: FAIL(artifactSetPathSecurity) carries a digest recomputed over the FINAL verdict", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "l8-f469-fail-"));
  try {
    const primary = makePassingPrimary(dir);
    const standalone = validateTechnicalArtifact({ filePath: primary });
    assert.equal(
      standalone.status,
      "PASS",
      `baseline errors: ${standalone.errors}`,
    );

    const gate = evaluateResultGate({
      artifactPath: primary,
      artifactSet: [primary, "relative/secondary.sql"],
    });
    const technical = gate.technical;
    assert.equal(technical.status, "FAIL");
    assert.equal(technical.checks.artifactSetPathSecurity, false);
    assert.ok(
      technical.errors.some((e) => /INVALID_PATH_SECONDARY_ARTIFACT/u.test(e)),
      `errors: ${JSON.stringify(technical.errors)}`,
    );
    assert.notEqual(
      technical.evidenceDigest,
      standalone.evidenceDigest,
      "the digest must CHANGE when the path-security arm fires (stale PASS-era digest)",
    );
    assert.equal(
      technical.evidenceDigest,
      expectedDigest(technical),
      "the digest must commit to the added check and error",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-469: the clean-set PASS arm also stamps a digest over its final checks", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "l8-f469-pass-"));
  try {
    const primary = makePassingPrimary(dir);
    const secondary = path.join(dir, "secondary.pdf");
    writeFileSync(secondary, COMPLETE_PDF);

    const gate = evaluateResultGate({
      artifactPath: primary,
      artifactSet: [primary, secondary],
    });
    const technical = gate.technical;
    assert.equal(
      technical.status,
      "PASS",
      `errors: ${JSON.stringify(technical.errors)}`,
    );
    assert.equal(technical.checks.artifactSetPathSecurity, true);
    assert.equal(
      technical.evidenceDigest,
      expectedDigest(technical),
      "artifactSetPathSecurity was added after the original stamp, so the digest must be recomputed",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
