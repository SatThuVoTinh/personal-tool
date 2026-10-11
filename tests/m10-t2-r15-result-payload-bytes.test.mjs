// M10/T2-R15 — the byte-vs-character bound defect on the agent result path.
//
// Every assertion here was measured against the REAL contract validator before
// the fix. The pre-fix behaviour was reproduced, not assumed.
import assert from "node:assert/strict";
import test from "node:test";

const { validateAgentClaim, truncateUtf8 } =
  await import("../integrations/openclaw/topology/lib/runtime.mjs");

const payload = () => ({
  schema_version: "1.0.0",
  governance_version: "m7-t2-r12",
  outcome_claim: "COMPLETE",
  reason_claim: "NONE",
  output: "",
  assumptions: [],
  limitations: [],
  requested_prerequisites: [],
  agent_self_validation: "verified",
});

const VIETNAMESE = "á"; // 2 UTF-8 bytes
const CJK = "中"; // 3 UTF-8 bytes
const BYTE = Buffer.byteLength;

test("R15-01: the contract measures maxLength in UTF-8 bytes", () => {
  // Establishes why a character-count bound is wrong here, using the real
  // validator on a well-formed payload.
  const small = payload();
  small.output = "x";
  assert.doesNotThrow(() => validateAgentClaim(small));

  // Exactly at the byte limit is accepted.
  const exact = payload();
  exact.output = VIETNAMESE.repeat(8192); // 16384 bytes
  assert.equal(BYTE(exact.output, "utf8"), 16384);
  assert.doesNotThrow(() => validateAgentClaim(exact));

  // Over the byte limit is rejected even though it is under 16384 CHARACTERS.
  const overBytes = payload();
  overBytes.output = VIETNAMESE.repeat(8200); // 16400 bytes, 8200 chars
  assert.ok(
    overBytes.output.length < 16384,
    "this input is UNDER the old character bound",
  );
  assert.throws(
    () => validateAgentClaim(overBytes),
    /SCHEMA_VALIDATION_FAILED/u,
  );
});

test("R15-02: the pre-fix guard truncation produced values the contract rejected", () => {
  // This is the defect, frozen as evidence. The guard used to emit exactly these
  // values via `.slice(0, N)` on a CHARACTER count; each was then rejected.
  for (const [chars, glyph, field, bound] of [
    [16384, VIETNAMESE, "output", 16384],
    [16384, CJK, "output", 16384],
    [4096, VIETNAMESE, "agent_self_validation", 4096],
  ]) {
    const slice = glyph.repeat(chars).slice(0, bound); // the old character slice
    const p = payload();
    p[field] = slice;
    assert.ok(
      BYTE(slice, "utf8") > bound,
      `${field}: the old slice must exceed its byte bound`,
    );
    assert.throws(
      () => validateAgentClaim(p),
      /SCHEMA_VALIDATION_FAILED/u,
      `${field}: the old truncation must be rejected by its own contract`,
    );
  }
});

test("R15-03: byte-budgeted truncation makes the same inputs valid", () => {
  for (const [chars, glyph, field, bound] of [
    [16384, VIETNAMESE, "output", 16384],
    [12000, VIETNAMESE, "output", 16384],
    [16384, CJK, "output", 16384],
    [4096, VIETNAMESE, "agent_self_validation", 4096],
  ]) {
    const p = payload();
    p[field] = truncateUtf8(glyph.repeat(chars), bound);
    assert.ok(
      BYTE(p[field], "utf8") <= bound,
      `${field} must fit its byte bound`,
    );
    assert.doesNotThrow(
      () => validateAgentClaim(p),
      `${field}: ${chars} ${glyph} characters must now be accepted`,
    );
  }
});

test("R15-04: assumptions and limitations are bounded too", () => {
  // The contract allows 16 items of at most 4096 BYTES each. Before the fix
  // these arrays were only sanitized and never bounded, so one long assumption
  // failed the entire result with no truncation and no recovery.
  const p = payload();
  p.assumptions = [truncateUtf8(VIETNAMESE.repeat(6000), 4096)];
  p.limitations = [truncateUtf8(CJK.repeat(6000), 4096)];
  assert.doesNotThrow(() => validateAgentClaim(p));

  // And the pre-fix state is still genuinely invalid, proving the bound is real.
  const unbounded = payload();
  unbounded.assumptions = [VIETNAMESE.repeat(6000)];
  assert.throws(
    () => validateAgentClaim(unbounded),
    /SCHEMA_VALIDATION_FAILED/u,
  );
});

test("R15-05: truncation never splits a UTF-8 character", () => {
  // A byte-budgeted slice that cut a surrogate pair or a 3-byte character would
  // produce a lone surrogate, which `Buffer.byteLength` would then mis-report
  // and the contract would reject as malformed.
  for (const [text, budget] of [
    ["😀".repeat(10), 10],
    [CJK.repeat(10), 7],
    [VIETNAMESE.repeat(10), 7],
    ["á".repeat(100), 1],
    ["😀".repeat(100), 3],
  ]) {
    const cut = truncateUtf8(text, budget);
    assert.ok(
      BYTE(cut, "utf8") <= budget,
      `budget ${budget} exceeded for ${text.slice(0, 4)}`,
    );
    // Round-tripping proves no lone surrogate survived.
    assert.equal(
      Buffer.from(cut, "utf8").toString("utf8"),
      cut,
      "truncation produced invalid UTF-8",
    );
    assert.doesNotMatch(cut, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
    assert.doesNotMatch(cut, /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  }
  // Values already inside the budget are returned unchanged, not rebuilt.
  assert.equal(truncateUtf8("abc", 100), "abc");
  assert.equal(truncateUtf8("", 100), "");
});
