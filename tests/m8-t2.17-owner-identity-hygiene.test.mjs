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
import { buildConfig } from "../integrations/openclaw/lib/policy.mjs";
import {
  isOwnerDiscordId,
  normalizeActor,
  resolveOwnerDiscordId,
} from "../integrations/openclaw/lib/authority.mjs";
import { applyRouterTestEnv } from "./helpers/router-env.mjs";

// M10/T2-R9: the governed model provider resolves its endpoint and
// credential from the environment at build time; supply non-routable
// placeholders so this suite can assert config SHAPE only.
applyRouterTestEnv();

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
const OWNER = "123456789012345678";
const OTHER = "999999999999999999";

// Distinct, valid synthetic surface identifiers for the config-side tests.
const SURFACES = Object.freeze({
  discordGuildId: "123456789012345671",
  discordOwnerId: OWNER,
  discordOfficeChannelId: "123456789012345672",
  discordResultsForumId: "123456789012345673",
  discordApprovalsForumId: "123456789012345674",
  discordIncidentsForumId: "123456789012345675",
});

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
  // A correctly bound approval authorizes only against the exact durable
  // proposal: owner identity plus proposal identity plus content digest.
  const { mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const { SkillAdapter } =
    await import("../zink-tools/adapters/skill-store/skill-adapter.mjs");
  const root = await mkdtemp(path.join(os.default.tmpdir(), "zink-hyg-"));
  try {
    const proposalStorageDir = path.join(root, "proposals");
    const proposing = new SkillAdapter(undefined, { proposalStorageDir });
    const content = "# Hygiene Skill\n\nGoverned content.";
    const proposed = await proposing.querySkillStore({
      action: "propose",
      namespace: ["office"],
      capability: "hygiene-skill",
      version: "1.0.0",
      content,
      reason: "owner hygiene binding",
      requesting_agent: "excel",
    });
    const result = await handleOwnerSkillApproval({
      ownerDiscordId: OWNER,
      proposalId: proposed.proposal.proposal_id,
      contentSha256: proposed.proposal.content_sha256,
      decisionRef: "PLAN:M8/T2-R17",
      namespace: ["office"],
      capability: "hygiene-skill",
      version: "1.0.0",
      skillsRoot: path.join(root, "skills"),
      proposalStorageDir,
      expectedOwnerId: OWNER,
      options: {
        embedFn: async () => [new Array(1024).fill(0.01)],
        dbExecutor: async () => "",
      },
    });
    assert.ok(
      result && result.approval_status === "APPROVED",
      "the exact-identity binding must still work when satisfied",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
    5,
    "one definition and all four owner gates must use it (execution approval " +
      "button gate, execution approve/reject action gate, skill learning " +
      "confirmation gate, decision confirmation gate)",
  );
});

// ---------------------------------------------------------------------------
// normalizeActor: the owner alias is configuration-derived, and fails closed
// ---------------------------------------------------------------------------

test("owner hygiene: normalizeActor honours a configured owner id", () => {
  const previous = process.env.DISCORD_OWNER_ID;
  try {
    process.env.DISCORD_OWNER_ID = OWNER;
    assert.equal(
      normalizeActor(OWNER),
      "user",
      "the configured owner snowflake normalizes to the owner actor",
    );
    assert.equal(
      normalizeActor("user"),
      "user",
      "the role name keeps working on its own merits",
    );
    assert.equal(
      normalizeActor(OTHER),
      OTHER.toLowerCase(),
      "any other snowflake is not an alias for anyone",
    );
  } finally {
    if (previous === undefined) delete process.env.DISCORD_OWNER_ID;
    else process.env.DISCORD_OWNER_ID = previous;
  }
});

test("owner hygiene: normalizeActor recognises no snowflake without configuration", () => {
  const previous = process.env.DISCORD_OWNER_ID;
  try {
    delete process.env.DISCORD_OWNER_ID;
    assert.equal(
      normalizeActor(OWNER),
      OWNER.toLowerCase(),
      "without DISCORD_OWNER_ID no account snowflake may alias the owner",
    );
    assert.equal(normalizeActor("user"), "user");
    assert.equal(normalizeActor("main"), "main");
  } finally {
    if (previous === undefined) delete process.env.DISCORD_OWNER_ID;
    else process.env.DISCORD_OWNER_ID = previous;
  }
});

test("owner hygiene: normalizeActor rejects a malformed configured id", () => {
  const previous = process.env.DISCORD_OWNER_ID;
  try {
    process.env.DISCORD_OWNER_ID = "not-a-snowflake";
    assert.equal(
      normalizeActor("not-a-snowflake"),
      "not-a-snowflake",
      "a malformed configured value must not create an owner alias",
    );
    assert.equal(normalizeActor(OWNER), OWNER.toLowerCase());
  } finally {
    if (previous === undefined) delete process.env.DISCORD_OWNER_ID;
    else process.env.DISCORD_OWNER_ID = previous;
  }
});

// ---------------------------------------------------------------------------
// Configuration controls every outbound destination (no hidden fallback)
// ---------------------------------------------------------------------------

test("owner hygiene: no hardcoded production destination in the plugin", () => {
  // Any `config.X || "<17-19 digits>"` or `?? "<digits>"` in the plugin would be
  // a hidden fallback to a real Discord surface. Destinations may only come
  // from the validated resolver.
  assert.equal(
    /(?:\|\||\?\?)\s*"[1-9][0-9]{16,19}"/u.test(source),
    false,
    "the plugin must not fall back to any literal Discord surface id",
  );
  const resolutions = source.match(/resolveDiscordDestination\(/gu) || [];
  assert.ok(
    resolutions.length >= 5,
    `every outbound routing site must use the resolver (found ${resolutions.length})`,
  );
});

test("owner hygiene: buildConfig carries the validated surface ids", () => {
  const config = buildConfig({
    stateDir: "/tmp/zink-hygiene",
    identifiers: SURFACES,
  });
  const pluginConfig = config.plugins.entries["zink-governance"].config;
  assert.equal(pluginConfig.ownerDiscordId, SURFACES.discordOwnerId);
  assert.equal(
    pluginConfig.discordOfficeChannelId,
    SURFACES.discordOfficeChannelId,
  );
  assert.equal(
    pluginConfig.discordResultsForumId,
    SURFACES.discordResultsForumId,
  );
  assert.equal(
    pluginConfig.discordApprovalsForumId,
    SURFACES.discordApprovalsForumId,
  );
  assert.equal(
    pluginConfig.discordIncidentsForumId,
    SURFACES.discordIncidentsForumId,
  );
});

test("owner hygiene: buildConfig refuses an invalid surface id", () => {
  assert.throws(
    () =>
      buildConfig({
        stateDir: "/tmp/zink-hygiene",
        identifiers: {
          ...SURFACES,
          discordResultsForumId: "not-a-snowflake",
        },
      }),
    /discordResultsForumId must be a numeric Discord snowflake/u,
    "an invalid destination must fail at configuration build time, " +
      "never silently fall back at send time",
  );
});

test("owner hygiene: channel access control uses the same validated ids", () => {
  const config = buildConfig({
    stateDir: "/tmp/zink-hygiene",
    identifiers: SURFACES,
  });
  const guilds = config.channels?.discord?.guilds;
  assert.ok(guilds, "discord guild access control must exist");
  const access = guilds[SURFACES.discordGuildId];
  assert.ok(access, "the configured guild must be access-controlled");
  assert.deepEqual(access.users, [SURFACES.discordOwnerId]);
  for (const id of [
    SURFACES.discordOfficeChannelId,
    SURFACES.discordResultsForumId,
    SURFACES.discordApprovalsForumId,
    SURFACES.discordIncidentsForumId,
  ]) {
    assert.ok(access.channels[id], `surface ${id} must be access-controlled`);
    assert.deepEqual(access.channels[id].users, [SURFACES.discordOwnerId]);
  }
});

// M12/T9 F-139: the owner id was validated by three different regexes, so a
// 20-digit configured owner was admitted by the configuration and then denied
// by every owner gate. One validator, one source.
test("F-139: one canonical owner-snowflake validator", () => {
  // 17 to 20 digits, no leading zero.
  assert.equal(isOwnerDiscordId("12345678901234567"), true);
  assert.equal(isOwnerDiscordId("123456789012345678"), true);
  assert.equal(isOwnerDiscordId("1234567890123456789"), true);
  assert.equal(isOwnerDiscordId("12345678901234567890"), true);
  assert.equal(isOwnerDiscordId("0123456789012345678"), false);
  assert.equal(isOwnerDiscordId("1234567890123456"), false);
  assert.equal(isOwnerDiscordId("123456789012345678901"), false);
  assert.equal(isOwnerDiscordId(""), false);
  assert.equal(isOwnerDiscordId(undefined), false);

  // The configuration admission and the owner gates must agree on the shape:
  // a 20-digit owner id is admitted by the configuration and must then resolve.
  assert.equal(
    isOwnerDiscordId("12345678901234567890"),
    true,
    "an id the configuration admits must resolve at the owner gates",
  );
  assert.equal(
    resolveOwnerDiscordId({ ownerDiscordId: "12345678901234567890" }),
    "12345678901234567890",
  );
  assert.equal(
    resolveOwnerDiscordId({ ownerDiscordId: "0123456789012345678" }),
    undefined,
    "a leading-zero id is not a snowflake and must not resolve",
  );
  assert.equal(resolveOwnerDiscordId({}), undefined);
  assert.equal(
    resolveOwnerDiscordId({ ownerDiscordId: "not-an-id" }),
    undefined,
  );
});
