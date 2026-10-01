// M8/T2.2 — owner-identity hygiene: no baked-in account identifier.
//
// The repository's own `.gitleaks.toml` allowlists synthetic Discord IDs and test
// fixtures under `tests/` and the orchestration README, and deliberately does NOT
// allowlist production plugin source. The CI `secret-scan` gate enforces that.
//
// Two real account identifiers were nonetheless hardcoded in production source,
// both as fallbacks in OWNER AUTHORIZATION GATES:
//
//   1. `config.ownerDiscordId || "<snowflake>"` at the approval-button gate and
//      the approve/reject action gate;
//   2. `expectedOwnerId = "<snowflake>"` as a default parameter of
//      `handleOwnerSkillApproval`.
//
// These are worse than a privacy leak. An authorization gate that falls back to a
// source constant no longer depends on deployed configuration: if configuration
// were ever absent or unreadable, that fallback would keep authorizing one
// specific account. Absence must fail closed instead.
//
// These tests pin both the source invariant and the fail-closed behaviour.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { handleOwnerSkillApproval } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_SOURCE = path.join(
  REPO,
  "integrations",
  "openclaw",
  "plugins",
  "zink-governance",
  "index.mjs",
);
const source = readFileSync(PLUGIN_SOURCE, "utf8");

// A syntactically valid snowflake, used only as a fixture inside this test file,
// which `.gitleaks.toml` explicitly allowlists.
const OWNER = "854005217715814432";
const OTHER = "999999999999999999";

// ---------------------------------------------------------------------------
// Source invariant: no owner identity may be baked into production source
// ---------------------------------------------------------------------------

test("owner hygiene: no owner-id literal fallback in production source", () => {
  assert.equal(
    /ownerDiscordId\s*\|\|\s*"\d{17,19}"/u.test(source),
    false,
    "config.ownerDiscordId must never fall back to a literal snowflake: the " +
      "authorization gate would depend on a source constant instead of on " +
      "deployed configuration",
  );
  assert.equal(
    source.includes(OWNER),
    false,
    "the owner's account identifier must not appear in production plugin source",
  );
});

test("owner hygiene: expectedOwnerId has no baked-in default", () => {
  assert.equal(
    /expectedOwnerId\s*=\s*"\d{17,19}"/u.test(source),
    false,
    "handleOwnerSkillApproval must require the expected principal explicitly",
  );
  // And the binding comparison itself is still present.
  assert.ok(
    source.includes("APPROVAL_OWNER_MISMATCH"),
    "the exact-identity binding must remain in force",
  );
});

// ---------------------------------------------------------------------------
// Behaviour: absence fails closed
// ---------------------------------------------------------------------------

test("owner hygiene: an omitted expectedOwnerId denies instead of defaulting", async () => {
  await assert.rejects(
    () =>
      handleOwnerSkillApproval({
        ownerDiscordId: OWNER,
        proposalId: "prop-1",
        contentSha256: "a".repeat(64),
        skillsRoot: ".",
      }),
    /APPROVAL_OWNER_MISMATCH/u,
    "without an explicitly bound expected principal, nobody is authorized",
  );
});

test("owner hygiene: a wrong expectedOwnerId still denies", async () => {
  await assert.rejects(
    () =>
      handleOwnerSkillApproval({
        ownerDiscordId: OTHER,
        proposalId: "prop-1",
        contentSha256: "a".repeat(64),
        skillsRoot: ".",
        expectedOwnerId: OWNER,
      }),
    /APPROVAL_OWNER_MISMATCH/u,
  );
});

test("owner hygiene: a correctly bound pair still authorizes", async () => {
  const result = await handleOwnerSkillApproval({
    ownerDiscordId: OWNER,
    proposalId: "prop-1",
    contentSha256: "a".repeat(64),
    skillsRoot: ".",
    expectedOwnerId: OWNER,
    options: {
      embedFn: async () => [new Array(1024).fill(0.01)],
      dbExecutor: async () => "",
    },
  });
  assert.ok(
    result,
    "the exact-identity binding must still work when satisfied",
  );
});

test("owner hygiene: the resolver returns undefined for unusable config", () => {
  // Exercised through the source contract, because the resolver is internal and
  // is deliberately not exported: exporting it would widen the surface for no
  // benefit. Presence of the guarded helper plus the absence of a fallback is
  // what makes the gates fail closed.
  assert.ok(
    source.includes("function resolveOwnerDiscordId(config)"),
    "the owner id must be resolved through one guarded helper",
  );
  assert.ok(
    source.includes('typeof ownerId === "string"'),
    "the helper must validate the configured value rather than trust it",
  );
  assert.equal(
    (source.match(/resolveOwnerDiscordId\(config\)/gu) || []).length,
    3,
    "one definition and both owner gates must use it",
  );
});
