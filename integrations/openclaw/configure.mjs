#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import {
  createRuntimeBackup,
  runtimeBackupPath,
} from "./topology/lib/runtime-backup.mjs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  assertDirectoryOrMissing,
  assertInsideHome,
  assertNoRepositoryOverlap,
  assertNoSymlinkComponents,
  assertRegularOrMissing,
  assertWorkspaceMatchesTemplate,
  buildAuthOrderPlan,
  buildConfig,
  buildSecretsPlan,
  defaultStateDirectory,
  defaultSystemdUserDirectory,
  agentInstructions,
  governancePluginFiles,
  GOVERNANCE_PLUGIN_ID,
  ensurePrivateDirectory,
  geminiStreamHotfixContents,
  materializeWorkspace,
  parseIdentifiers,
  passResolverContents,
  renderLegacySystemdDropInR16,
  renderSystemdDropIn,
  stableJson,
  validateConfig,
  writePrivateRegularFile,
} from "./lib/policy.mjs";
import {
  ledgerPaths,
  inspectLedgerUpgrade,
  upgradeEmptyLegacyLedger,
} from "./topology/lib/ledger.mjs";
import { canonicalJson } from "./topology/lib/canonical.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const LEGACY_GEMINI_STREAM_HOTFIX_R18_SHA256 =
  "41bfeedf2835db4a50573a0f61325bc438ac805a90fef03ce3bc29b8c303f133";
const LEGACY_GOVERNANCE_ENTRYPOINT_R11_SHA256 =
  "c71cf9d6fe9965eaa0ff789d611a55ee0ea2fc98d8023b3c7526495aaa60f559";
const STARTING_GOVERNANCE_ENTRYPOINT_SHA256 =
  "26bb3b447bdc039925fa568ae89beb1969319ce8b6c86236eb715c2c6224ebf0";
const INTERMEDIATE_GOVERNANCE_ENTRYPOINT_SHA256 =
  "a384e509ebac2c47f4a50e758b2bb697e87cc50721367ae20948d11d4f24b06b";
const LEGACY_GOVERNANCE_MANIFEST_R11_SHA256 = Object.freeze([
  "02c805e7909b9ca35711cc5888bc889fe9c9a566f09f580ba614682682ce41ca",
  // The manifest of the superseded WSL deployment recognized on 2026-09-30
  // under the same owner authorization as the asset list.
  "5026959d41a76c531f37caa6297b3b0b010ee17cedd7bdd3806447600c98a18d",
]);
// Digests of prior audited plugin builds that the current build may overwrite.
//
// The 2026-09-30 group is the plugin tree that was live on the WSL gateway
// before the R5 deployment. Unlike every other entry here, its provenance is
// NOT established: regenerating the assets at `01489aa` (the commit before R4)
// reproduces only 7 of its 29 files, and the deployed `openclaw.json` beside it
// matches no commit either, so the whole deployment came from an uncommitted
// build. It is listed because the owner explicitly authorized recognizing it as
// a superseded predecessor on 2026-09-30, not because it was audited here.
//
// These entries only ever permit OVERWRITING the listed file with the current
// build's own bytes. They do not make the old content trusted, and an
// unrecognised digest still fails closed.
const ALLOWED_GOVERNANCE_ASSET_SHA256 = Object.freeze({
  "contracts/agent-result-payload.schema.json": Object.freeze([
    "48bcbf6b64daae63a3d7a917ac8f17790ba1468b4ed78182df5d1de59cd34717",
  ]),
  "contracts/approval-request.schema.json": Object.freeze([
    "a4866a323a17e7e4e0243afb4f771e2d3db2116034a7bd6a615501b0ae3d2e54",
  ]),
  "contracts/delegation-envelope.schema.json": Object.freeze([
    "cc5023418300cd616b9ced2bff752c2903a07ef2a3e2e0e29c16968e7e90af97",
  ]),
  "contracts/delegation-proposal.schema.json": Object.freeze([
    "efd4371cacf396dc618cc84c8663a114f06b034c13737937b48aa0b895b2d6e0",
  ]),
  "contracts/execution-brief.schema.json": Object.freeze([
    "514001e3edfd31a128b82f2c3944761214fd5d2ef7439d8033d914180410f5e4",
  ]),
  "contracts/governance-manifest.schema.json": Object.freeze([
    "f980bfd5474c8d057be92fee136779490ba93ed944295e4d173c54d7082e24c5",
  ]),
  "contracts/governed-reference.schema.json": Object.freeze([
    "e3eabb880bd46b4fccdb7b7b3767ad4be42a6d8ec4894c72959cfbf8a572c02e",
  ]),
  "contracts/incident.schema.json": Object.freeze([
    "9d70678804bfc3059f3a2218babda4f4c1b55486bde5c6da5ef8c4f114fcc242",
  ]),
  "contracts/ledger-event.schema.json": Object.freeze([
    "e636b2452916ad8d1391a90844c0eaa3bc1c84e4aef8ede1361e3cee70143f15",
    // The accepted V16 build (9713872), established by packaging that commit.
    // Listed only so the R6 WORKFLOW_APPROVAL_REQUESTED contract can replace it.
    "12ac1bbf2f034e2d3f9ba98d1916c69eddb0e0035b618f1293f2e61f85f0c228",
  ]),
  "contracts/ledger-snapshot.schema.json": Object.freeze([
    "3cde5162ae845a9b7066a623a9c4c8896f1fc6b77f2b5983ad506a9dfcbc0151",
    "01138d85c148c06c4cfc7d6cdfd844db70a2c5b9990e21cf92810fd8ee2b50c5",
  ]),
  "contracts/result.schema.json": Object.freeze([
    "9440dfb87b3daf358b11dc7b59b62586c68786235d99d717daf9783b9a6e4540",
  ]),
  "contracts/trusted-result-envelope.schema.json": Object.freeze([
    "5d40c23152bba749826797eb0271c47a20f3aab910bcad2852428618ad9f0ec9",
  ]),
  "governance-manifests.json": Object.freeze([
    "5026959d41a76c531f37caa6297b3b0b010ee17cedd7bdd3806447600c98a18d",
  ]),
  "lib/artifact-validator.mjs": Object.freeze([
    "0b35496fdebe5e204bfc4395057e9a54e5635060a1af1fe47146dd391ebeac79",
  ]),
  "lib/authority.mjs": Object.freeze([
    "1e6eb2659f3d671ec62e6c57f28088bfcfffef3d637ec0f898d8ef18fc426b13",
    // Owner-identity hygiene follow-up: the outgoing R19 build currently
    // deployed, byte-verified against the live runtime at this exact path.
    // This revision changes this file (the owner alias is now resolved from
    // configuration), so without this entry --preflight refuses the deployed
    // R19 extension and the deployment is unreachable. The new digest is
    // deliberately NOT listed: it is the current build and is already accepted
    // by content comparison.
    "50a0b47860cb4cce29fc4f4d40d7c57813035324bc2e490a6f184754212e3e82",
  ]),
  "lib/canonical.mjs": Object.freeze([
    "c6c0515ab3b1ade07d94d8b5969cd425456db2b5fff56847ba7ef0030989b203",
  ]),
  "lib/decision-ledger.mjs": Object.freeze([
    "cec8776c771d4cf521a664fa7dd62aa5e14b54cc05389b30be51bc03b4c51a6e",
  ]),
  "lib/policy.mjs": Object.freeze([
    "0584ca5fd8698ef986a7a41f31d1b735997bc1f7fb879f91a1df90ad191603e5",
    // The accepted R5 build (652ac0c), whose provenance IS established: this
    // digest was reproduced by packaging the same file at that commit. Listed
    // only so the V15 contracts-lookup fix can replace it. Contrast the
    // 2026-09-30 group above, whose provenance is explicitly NOT established.
    "d2f3e7203f327041a5678234d8fd302f20e06c7b7b2fbf8b1c079317858e4d2a",
    // The accepted V15 build (9a6702f), established the same way, listed only so
    // the V16 self-safe rewrite mechanism can replace it. Same classification as
    // the entry above; the semantics of this table are unchanged.
    "5bbcbdbf39cdee8f568f48ce613450ea203f04ca39ee360f213456e4977e74f8",
    // Owner-identity hygiene follow-up: the outgoing R19 build currently
    // deployed, byte-verified against the live runtime at this exact path.
    // This revision changes this file (the built plugin config now carries the
    // validated Discord surface ids), so without this entry --preflight refuses
    // the deployed R19 extension and the deployment is unreachable. The new
    // digest is deliberately NOT listed: it is the current build and is already
    // accepted by content comparison.
    "5a1d991977b6b5bb3c510f9e193f21b8300766ef6271a6316acb9a77ed4b6776",
  ]),
  "lib/queue-manager.mjs": Object.freeze([
    "a8021088a4e9373fcf74cf4dd31433c8606b9505eaf74c5fa922839ee716776a",
  ]),
  "lib/schema.mjs": Object.freeze([
    "869a2254975f60432c596a115acee1fc0e03893224b925c5a54334dc532d1cee",
  ]),
  "lib/guard.mjs": Object.freeze([
    "3d017828de32ed2d9ecdfc7c78e1828f3b4f8a13f88a51aabdd8ddff81443029",
    "00cce929877bfab0864b16519dfa0276bb2955053d348b3e298c4121c3784100",
    "55b38c41d44dc5386f696af671ca8b4de3655e2e2f5b0a6c586560509336c0bc",
    "1c580dc09518ceffeb48ea44d760f280af03b9e3f2b11d0f7a9231638d04e9b3",
    "a6b6f452255d22bee7d3b8b860da4fddef85bafa299fcbaf519dd76cfca075e9",
    "b230651ec4fa9b5a123c10e319438918c0763f99287f5223da1a71d1aebe213a",
    "efdcea2457db29f20603fa0cf948fd8e0261f78d3ec3f863637a56befdf8f784",
    "c66587e10db3f35c8c03ff430360e1abe4bc2268613ae78d1e2bd8837dca0173",
  ]),
  "lib/native-boundary.mjs": Object.freeze([
    "4b77356f2a843f26040a7cd3312c896469aff33cc472bc6c02fdd5c472bd1234",
    "4c3f908b84ae64155e6a32741596fc6e2b28601127b72dc33fcea20bcbcc7347",
    "25759e86e53d962bcb00a13eedd63ea028abb31c212ae2874a84bfd041509809",
    "164b17293cf4ac63089ad2ea1afe96bc24b39450bc3332820bc9f5fff654e253",
    "8dbd524a49a8b65959e74f0aaf37516a7a211759bd0a3d047dfd1e73863bd741",
    "6308a7c37745f2a8214a5ad47f9dd3fa0af00d1479ea9676d15bd3a6eb8ea29a",
    // M8/T2.2-R8: the accepted R5 build (9713872), established by packaging that
    // commit and matching the restored pre-incident extension byte-for-byte. R7
    // changed only this file, so without this entry --preflight refuses the whole
    // verified R5 extension and --apply becomes unreachable on it.
    "49352d47ac88798cc918c654875f84241a7efbb1d5a661c64b77e7efbacf3be9",
    // M8/T2.2-R13: the outgoing R7 build currently deployed, byte-proven
    // against the live runtime at this exact path on 2026-09-30
    // (extensions/zink-governance/lib/native-boundary.mjs, 13981 bytes) and
    // cross-checked against the live dist bridge. R10 is the only revision that
    // changes this file after R7, so without this entry --preflight refuses the
    // deployed R7 extension and the R10 deployment is unreachable. The R10
    // digest is deliberately NOT listed: it is the current build and is already
    // accepted by content comparison.
    "33b3feefdfd473dc0d6d09b0ae7b8e39b394fa93a1247fe117bc58757f075412",
    // M8/T2.2-R17: the outgoing R10 build currently deployed, byte-proven against
    // the live runtime at this exact path and cross-checked against the live dist
    // bridge on 2026-09-30 after the R16 deployment. R17 changes only this file,
    // so without this entry --preflight refuses the deployed R10 extension and the
    // R17 deployment is unreachable. The R17 digest is deliberately NOT listed:
    // it is the current build and is already accepted by content comparison.
    "50af7d4ae10b519340b8dc13af3e2b219041fb28991e2a777ea815b537d2c7c2",
    // M8/T2.2-R18: the outgoing R17 build currently deployed, byte-proven against
    // the live runtime at this exact path and cross-checked against the live dist
    // bridge after the R17 deployment. R18 changes only this file -- it recovers
    // the admission-time heartbeat discriminator at the run-end seam so both seams
    // classify a run with one predicate -- so without this entry --preflight
    // refuses the deployed R17 extension and the R18 deployment is unreachable.
    // The R18 digest is deliberately NOT listed: it is the current build and is
    // already accepted by content comparison.
    "4567ce268064cb7729ace6ebc122dcaa2f1a938fa6b59143e3baeddd7c3a9a14",
  ]),
  "lib/runtime.mjs": Object.freeze([
    "6a522c73efacf8b593d63ee55e18b5d02c3675340e0593142a5c2fea8dc6e24a",
  ]),
  "lib/ledger.mjs": Object.freeze([
    "d7f406e9dfa8f45d117f555bed18d2bf4c63ed966c3dd0588d221a54b9e87255",
    "50efeec64203240014b93479900a51251efbf0f286cc170feb93facf5a954148",
  ]),
  "lib/workflow.mjs": Object.freeze([
    "14bb6a5575b3f25e7d04aafb28eb1e95b0b5b2a21b15b6b5dec787aaaf94f907",
    "19dc0eb40b216fbc898afd8dfc66f5c6aae4da15d1d2a6e5923753e13fcb09f0",
    "ff2ca8d3abbef43081756d68b553e23f036bbed302f6ffdf0075c045f8f1f5e2",
    // The accepted V16 build (9713872), established by packaging that commit.
    "1a1913e3d3d0923dec0089812242ccd1f7221ea535ad4d85b554dce1587e9407",
  ]),
  "policy/reason-code-matrix.json": Object.freeze([
    "982896fe4fcc856728f8348058f19b69d89eabd9974bdaf4311c4afa510fc200",
  ]),
});

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function usage() {
  return [
    "Usage: configure.mjs --dry-run|--preflight|--apply --discord-guild-id <id>",
    "  --discord-owner-id <id> --discord-office-channel-id <id>",
    "  --discord-results-forum-id <id> --discord-approvals-forum-id <id>",
    "  --discord-incidents-forum-id <id>",
    "  [--state-dir <absolute-path>] [--systemd-user-dir <absolute-path>]",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {};
  const allowed = new Set([
    "state-dir",
    "systemd-user-dir",
    "discord-guild-id",
    "discord-owner-id",
    "discord-office-channel-id",
    "discord-results-forum-id",
    "discord-approvals-forum-id",
    "discord-incidents-forum-id",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--dry-run", "--preflight", "--apply"].includes(argument)) {
      if (options.mode) {
        throw new Error(
          "Select exactly one of --dry-run, --preflight or --apply",
        );
      }
      options.mode = argument.slice(2);
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const name = argument.slice(2);
    if (!allowed.has(name)) {
      throw new Error(`Unsupported argument: ${argument}`);
    }
    if (Object.hasOwn(options, name)) {
      throw new Error(`Repeated argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    options[name] = value;
    index += 1;
  }
  if (!options.mode) {
    throw new Error("Select exactly one of --dry-run, --preflight or --apply");
  }
  return options;
}

function existingConfigMatches(configPath, context) {
  assertRegularOrMissing(configPath);
  if (!existsSync(configPath)) {
    return false;
  }
  let actual;
  try {
    actual = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new Error(`Existing config must be canonical JSON: ${configPath}`);
  }
  try {
    validateConfig(actual, context);
    return true;
  } catch (validationError) {
    const legacy = JSON.parse(JSON.stringify(buildConfig(context)));
    delete legacy.agents.defaults.subagents;
    for (const agent of legacy.agents.list) {
      delete agent.subagents;
      delete agent.tools.alsoAllow;
    }
    delete legacy.tools.subagents;
    delete legacy.tools.sessions;
    delete legacy.tools.sessions_spawn;
    legacy.plugins.allow = legacy.plugins.allow.filter(
      (pluginId) => pluginId !== GOVERNANCE_PLUGIN_ID,
    );
    legacy.plugins.load = { paths: [] };
    delete legacy.plugins.entries[GOVERNANCE_PLUGIN_ID];
    try {
      const actualFoundation = JSON.parse(JSON.stringify(actual));
      delete actualFoundation.meta;
      if (actualFoundation.channels?.discord?.streaming === undefined) {
        actualFoundation.channels.discord.streaming = { mode: "off" };
      }
      const previousR11 = JSON.parse(JSON.stringify(buildConfig(context)));
      delete previousR11.plugins.entries[GOVERNANCE_PLUGIN_ID].config
        .ownerDiscordId;
      if (canonicalJson(actualFoundation) === canonicalJson(previousR11))
        return false;
      if (canonicalJson(actualFoundation) === canonicalJson(legacy))
        return false;
    } catch {
      // fall through to the fail-closed drift error below
    }
    // Field-scoped convergence. Each migration below replaces ONLY the fields
    // it owns, and `validateConfig` then has to accept the RESULT, so a config
    // that differs in any other respect still fails closed: convergence can
    // never launder unrelated drift into an accepted config.
    const expectedConfig = buildConfig(context);
    const migrated = JSON.parse(JSON.stringify(actual));
    let converged = false;
    const discord = migrated.channels?.discord;
    if (discord && discord.streaming === undefined) {
      discord.streaming = { mode: "off" };
      converged = true;
    }
    // Frozen M8/T1 delivery default restored in R4 builder: configs that
    // predate it converge the same way streaming does.
    if (discord && discord.replyToMode === undefined) {
      discord.replyToMode = "off";
      converged = true;
    }
    // M8/T2.2-R4 regenerated the Discord mention grammar from AGENT_ALIASES
    // and the orchestrators' `alsoAllow` from the canonical tool policy,
    // replacing values that earlier builds hand-transcribed. A config written
    // by such a build differs in exactly these two fields, so regenerating them
    // from the canonical source is the same kind of convergence as the two
    // above. The aliases R4 dropped are dropped on purpose: the alias table is
    // asserted absent in tests/m7-lane-g-policy.test.mjs, so this is the R4
    // behaviour arriving late, not a new policy.
    //
    // The shape is matched field-by-field rather than as a whole-config literal
    // because the drifted config was produced by an uncommitted build and is
    // not reproducible from any commit, so there is no prior generator to
    // derive a legacy literal from.
    //
    // `alsoAllow` is converged ONLY where the policy serializes it. For the
    // specialists `buildConfig` defines it non-enumerable, so it is absent from
    // the stored config and `validateConfig` never compares it; writing an
    // enumerable `[]` there would add a key the policy does not have and turn
    // an accepted config into a drifting one.
    const liveAgents = Array.isArray(migrated.agents?.list)
      ? migrated.agents.list
      : null;
    if (liveAgents && liveAgents.length === expectedConfig.agents.list.length)
      for (const [index, agent] of liveAgents.entries()) {
        const expectedAgent = expectedConfig.agents.list[index];
        const expectedAllow = expectedAgent.tools.alsoAllow ?? [];
        if (
          agent.groupChat &&
          JSON.stringify(agent.groupChat.mentionPatterns) !==
            JSON.stringify(expectedAgent.groupChat.mentionPatterns)
        ) {
          agent.groupChat.mentionPatterns =
            expectedAgent.groupChat.mentionPatterns;
          converged = true;
        }
        if (
          expectedAllow.length > 0 &&
          JSON.stringify(agent.tools?.alsoAllow) !==
            JSON.stringify(expectedAllow)
        ) {
          agent.tools.alsoAllow = expectedAllow;
          converged = true;
        }
      }
    // Owner-identity hygiene follow-up: the built zink-governance plugin config
    // now carries the four validated Discord surface ids, so outbound routing
    // targets resolve from configuration instead of hardcoded production
    // fallbacks. A config written by an earlier build differs in exactly these
    // four fields, so filling them from the canonical build is the same kind of
    // convergence as the cases above. Only MISSING fields are filled, in the
    // same key order the policy serializes them; a present-but-different value
    // is NOT overwritten here, so a hand-edited destination still fails closed
    // in the final validation below.
    const livePluginConfig =
      migrated.plugins?.entries?.[GOVERNANCE_PLUGIN_ID]?.config;
    const expectedPluginConfig =
      expectedConfig.plugins?.entries?.[GOVERNANCE_PLUGIN_ID]?.config;
    if (livePluginConfig && expectedPluginConfig) {
      for (const field of [
        "discordOfficeChannelId",
        "discordResultsForumId",
        "discordApprovalsForumId",
        "discordIncidentsForumId",
      ]) {
        if (
          livePluginConfig[field] === undefined &&
          typeof expectedPluginConfig[field] === "string"
        ) {
          livePluginConfig[field] = expectedPluginConfig[field];
          converged = true;
        }
      }
    }
    if (!converged) {
      throw validationError;
    }
    try {
      validateConfig(migrated, context);
    } catch {
      throw validationError;
    }
    return false;
  }
}

function requireFileMode(filePath, expectedMode, label) {
  if (process.platform === "win32") {
    return;
  }
  const actualMode = lstatSync(filePath).mode & 0o777;
  if (actualMode !== expectedMode) {
    throw new Error(
      `${label} mode drift: expected ${expectedMode.toString(8)}, got ${actualMode.toString(8)}`,
    );
  }
}

function materializeOwnedFile(
  filePath,
  contents,
  label,
  fileMode = 0o600,
  allowedPreviousContents = [],
  allowedPreviousSha256 = [],
) {
  assertRegularOrMissing(filePath);
  if (existsSync(filePath)) {
    const existingContents = readFileSync(filePath, "utf8");
    if (
      existingContents !== contents &&
      !allowedPreviousContents.includes(existingContents) &&
      !allowedPreviousSha256.includes(sha256(existingContents))
    ) {
      throw new Error(`${label} drift detected: ${filePath}`);
    }
    requireFileMode(filePath, fileMode, label);
    if (existingContents === contents) return;
  }
  writePrivateRegularFile(filePath, contents, fileMode);
}

function assertOwnedFileMatchesOrMissing(
  filePath,
  contents,
  label,
  fileMode = 0o600,
  allowedPreviousContents = [],
  allowedPreviousSha256 = [],
) {
  assertRegularOrMissing(filePath);
  if (existsSync(filePath)) {
    const existingContents = readFileSync(filePath, "utf8");
    if (
      existingContents !== contents &&
      !allowedPreviousContents.includes(existingContents) &&
      !allowedPreviousSha256.includes(sha256(existingContents))
    ) {
      throw new Error(`${label} drift detected: ${filePath}`);
    }
    requireFileMode(filePath, fileMode, label);
  }
}

function assertGovernanceManifestMatchesOrMissing(filePath, contents) {
  assertRegularOrMissing(filePath);
  if (!existsSync(filePath)) return;
  let actual;
  let expected;
  try {
    actual = JSON.parse(readFileSync(filePath, "utf8"));
    expected = JSON.parse(contents);
  } catch {
    throw new Error(`Governance plugin manifest drift detected: ${filePath}`);
  }
  const previous = JSON.parse(JSON.stringify(expected));
  delete previous.configSchema.properties.ownerDiscordId;
  if (
    canonicalJson(actual) !== canonicalJson(expected) &&
    canonicalJson(actual) !== canonicalJson(previous)
  ) {
    throw new Error(`Governance plugin manifest drift detected: ${filePath}`);
  }
  requireFileMode(filePath, 0o600, "Governance plugin manifest");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const stateDir = path.resolve(
    options["state-dir"] ?? defaultStateDirectory(),
  );
  const systemdUserDir = path.resolve(
    options["systemd-user-dir"] ?? defaultSystemdUserDirectory(),
  );
  if (stateDir !== path.resolve(defaultStateDirectory())) {
    throw new Error("OpenClaw state directory must be ~/.openclaw-zink");
  }
  if (systemdUserDir !== path.resolve(defaultSystemdUserDirectory())) {
    throw new Error("Systemd user directory must be ~/.config/systemd/user");
  }
  const identifiers = parseIdentifiers({
    discordGuildId: options["discord-guild-id"],
    discordOwnerId: options["discord-owner-id"],
    discordOfficeChannelId: options["discord-office-channel-id"],
    discordResultsForumId: options["discord-results-forum-id"],
    discordApprovalsForumId: options["discord-approvals-forum-id"],
    discordIncidentsForumId: options["discord-incidents-forum-id"],
  });
  assertInsideHome(stateDir, "OpenClaw state directory");
  assertInsideHome(systemdUserDir, "Systemd user directory");
  assertNoRepositoryOverlap(REPOSITORY_ROOT, stateDir);
  const config = buildConfig({ stateDir, identifiers });
  const output = {
    profile: "zink",
    stateDir,
    workspaces: Object.fromEntries(
      config.agents.list.map((agent) => [agent.id, agent.workspace]),
    ),
    agentDirs: Object.fromEntries(
      config.agents.list.map((agent) => [agent.id, agent.agentDir]),
    ),
    configPath: path.join(stateDir, "openclaw.json"),
    authPlanPath: path.join(stateDir, "zink-auth-secret-plan.json"),
    authOrderPlanPath: path.join(stateDir, "zink-auth-order-plan.json"),
    passResolverPath: path.join(stateDir, "bin", "openclaw-pass-resolver"),
    geminiStreamHotfixPath: path.join(
      stateDir,
      "bin",
      "openclaw-gemini-stream-hotfix.mjs",
    ),
    passStoreDirectory: path.join(stateDir, "secrets", "password-store"),
    gpgHomeDirectory: path.join(stateDir, "secrets", "gnupg"),
    systemdDropInPath: path.join(
      systemdUserDir,
      "openclaw-gateway-zink.service.d",
      "10-zink.conf",
    ),
    governancePluginDirectory: path.join(
      stateDir,
      "extensions",
      GOVERNANCE_PLUGIN_ID,
    ),
    governancePluginManifestPath: path.join(
      stateDir,
      "extensions",
      GOVERNANCE_PLUGIN_ID,
      "openclaw.plugin.json",
    ),
    governancePluginPackagePath: path.join(
      stateDir,
      "extensions",
      GOVERNANCE_PLUGIN_ID,
      "package.json",
    ),
    governancePluginEntrypointPath: path.join(
      stateDir,
      "extensions",
      GOVERNANCE_PLUGIN_ID,
      "index.mjs",
    ),
    ledgerDirectory: ledgerPaths(stateDir).root,
    ledgerEventsPath: ledgerPaths(stateDir).events,
    ledgerSnapshotPath: ledgerPaths(stateDir).snapshot,
    identityKeyPath: ledgerPaths(stateDir).identityKey,
    backupManifestPath: path.join(runtimeBackupPath(stateDir), "manifest.json"),
  };
  if (options.mode === "dry-run") {
    process.stdout.write(`${stableJson(output)}`);
    return;
  }

  for (const target of [
    stateDir,
    ...Object.values(output.workspaces),
    ...Object.values(output.agentDirs),
    output.configPath,
    output.authPlanPath,
    output.authOrderPlanPath,
    output.passResolverPath,
    output.geminiStreamHotfixPath,
    output.passStoreDirectory,
    output.gpgHomeDirectory,
    systemdUserDir,
    output.systemdDropInPath,
    output.governancePluginDirectory,
    output.governancePluginManifestPath,
    output.governancePluginPackagePath,
    output.governancePluginEntrypointPath,
    output.ledgerDirectory,
    output.ledgerEventsPath,
    output.ledgerSnapshotPath,
    output.identityKeyPath,
    output.backupManifestPath,
  ]) {
    assertNoSymlinkComponents(target);
  }

  const context = { stateDir, identifiers };
  inspectLedgerUpgrade(ledgerPaths(stateDir));
  const configPath = output.configPath;
  const configExists = existingConfigMatches(configPath, context);
  for (const [agentId, workspace] of Object.entries(output.workspaces)) {
    assertWorkspaceMatchesTemplate(
      workspace,
      agentInstructions(agentId),
      false,
      agentId,
    );
  }
  for (const agentDir of Object.values(output.agentDirs)) {
    assertDirectoryOrMissing(agentDir);
  }
  assertDirectoryOrMissing(output.passStoreDirectory);
  assertDirectoryOrMissing(output.gpgHomeDirectory);
  assertOwnedFileMatchesOrMissing(
    output.authPlanPath,
    stableJson(buildSecretsPlan()),
    "Auth SecretRef plan",
  );
  const pluginFiles = governancePluginFiles();
  for (const [relative, contents] of Object.entries(pluginFiles.assets)) {
    const target = path.join(output.governancePluginDirectory, relative);
    assertNoSymlinkComponents(target);
    assertOwnedFileMatchesOrMissing(
      target,
      contents,
      "Governance plugin asset",
      0o600,
      [],
      ALLOWED_GOVERNANCE_ASSET_SHA256[relative] ?? [],
    );
  }
  assertGovernanceManifestMatchesOrMissing(
    output.governancePluginManifestPath,
    pluginFiles.manifest,
  );
  assertOwnedFileMatchesOrMissing(
    output.governancePluginPackagePath,
    pluginFiles.package,
    "Governance plugin package",
  );
  assertOwnedFileMatchesOrMissing(
    output.governancePluginEntrypointPath,
    pluginFiles.entrypoint,
    "Governance plugin entrypoint",
    0o700,
    [],
    [
      LEGACY_GOVERNANCE_ENTRYPOINT_R11_SHA256,
      STARTING_GOVERNANCE_ENTRYPOINT_SHA256,
      INTERMEDIATE_GOVERNANCE_ENTRYPOINT_SHA256,
      "d5f1394e18eb2e1910c2ec7f1c92cab4e6c16b1e7ced7c7899b7d1076df85b2e",
      "f116d778cb5a8fa875ff33cb2fe6de8a42f209b984a84899cf2ab795592b13d7",
      "73bea1f506a72181528c11bd210ee6ccaf4ad69518c2ff38fdafc5da4a91be6e",
      "6ccf56a256a321597c7405f2daff3412371a3c37e5d27a410c0cf2a3db802724",
      "3c6545cc8925710ca76068ed64070a71353a794b81de74561bd168e034ec2135",
      "9402dc774e7db90616bf5cafe9afc2bf899892fb2c926abf2526f69eb29d7d7e",
      "e2a265dca6a0ea2b20b8a41004cf08b6157bfbaf503d1a5d2257dfc2504243f3",
      "694a89ae93d6685ff37562828873e7120bb07353b8d3e6e213fd5b080106bf8f",
      "af0ce312e23a0d3be9a10c3bb350b3d6b7d345b1ca7fc49ae13efd41219e5c93",
      "fdb72c9f058cb29e3ba4e3ae3a394d1f84e805a274e8614e592018d073e88015",
      "17b4be782cebc34df7a363c095865653cc8351ba50e08c1206ce4981d6c7e6d1",
      // The entrypoint of the superseded WSL deployment recognized on
      // 2026-09-30 under the same owner authorization as the asset list.
      "09f1d8e66f2b9fca35180d9e0d208f644cedf34824e4cd18bb9f229b51cec1c7",
      // The accepted R5/V15/V16 build (652ac0c lineage), established by
      // packaging that commit, listed only so the R6 emission path can replace it.
      "e77689c94ba066bd854549750044f78dcf9d97cc3de73420893851c0a800b10a",
      // M8/T2.2-R13: the outgoing R7 entrypoint currently deployed, byte-proven
      // against the live runtime at this exact path on 2026-09-30
      // (extensions/zink-governance/index.mjs, 192895 bytes). R10 is the only
      // revision that changes the entrypoint after R7, so without this entry
      // --preflight refuses the deployed R7 extension. The R10 digest is
      // deliberately NOT listed: it is the current build and is already accepted
      // by content comparison.
      "74582778e5d58ce6a26dec3514b9a73ad5f8964f892023b37221f8a85b5ff215",
      // M8/T2.2-R17: the outgoing R10 entrypoint currently deployed, byte-proven
      // against the live runtime at this exact path on 2026-09-30 after the R16
      // deployment. R17 changes the entrypoint (run-end governance parity), so
      // without this entry --preflight refuses the deployed R10 extension and the
      // R17 deployment is unreachable. The R17 digest is deliberately NOT listed:
      // it is the current build and is already accepted by content comparison.
      "e5b220b4a3b023f6d7b26561964f6204f0d004267b208cddab90adb6043b8bd7",
      // M8/T2.2-R19: the outgoing R17 entrypoint currently deployed, byte-proven
      // against the live runtime at this exact path after the R18 deployment.
      // R19 changes the entrypoint (the prompt-build liveness exemption), so
      // without this entry --preflight refuses the deployed R17 extension and the
      // R19 deployment is unreachable. The R19 digest is deliberately NOT listed:
      // it is the current build and is already accepted by content comparison.
      "d01c210b0cc13f01d6d294223ae400a30ef6407c962d5b46e2f199474f799a1d",
      // Owner-identity hygiene: the outgoing R19 entrypoint currently deployed,
      // which removed a real account identifier that was hardcoded as a fallback
      // inside two owner authorization gates. Admitted here so the next authorized
      // deployment is reachable. The new digest is deliberately NOT listed: it is
      // the current build and is accepted by content comparison.
      "bae7bdf358f35c43c5308c4b0b24a1da57b55bbc609d1ff3a7e32daf65182eca",
      // M8/T3: the outgoing hygiene entrypoint currently deployed, byte-proven
      // as the packaged build before the governed-memory learning loop changed
      // the entrypoint (durable skill proposals, fail-closed skill approval,
      // #office learning path). Admitted here so the next authorized
      // deployment is reachable. The new digest is deliberately NOT listed:
      // it is the current build and is accepted by content comparison.
      "2271b56bc7f0ed3a3446e4474c411c1a6132a4e3c1a2edfedb5e6907d8340b5d",
      // Functional-truth remediation: the outgoing M8/T3 entrypoint, byte-proven
      // as the packaged build before the approved-task path stopped executing a
      // hardcoded revenue/KPI demo, before zink_n8n was routed to the real
      // governed adapter, and before the Power BI / Python capabilities were made
      // explicitly fail-closed. Admitted here so the next authorized deployment
      // is reachable. The new digest is deliberately NOT listed: it is the current
      // build and is accepted by content comparison.
      "a3dbf945deae82c1c07b419d6f1af1724f70a336c88331d4a772dfc93420ab92",
      // Handoff-semantics remediation: the outgoing functional-truth entrypoint,
      // byte-proven as the packaged build before RELEASED_TO_COORDINATOR was
      // withdrawn (a Discord POST is not an accepted handoff), before the
      // release precondition moved ahead of the durable queue write, and before
      // the coordinator handoff was required to satisfy canonical spawn
      // topology. Admitted here so the next authorized deployment is reachable.
      // The new digest is deliberately NOT listed: it is the current build and
      // is accepted by content comparison.
      "118db9a746a0757dbea2d15c5d8d9585a298a1ca0d235a6b13a3a8513fb2bcac",
    ],
  );
  assertRegularOrMissing(output.identityKeyPath);
  if (existsSync(output.identityKeyPath))
    requireFileMode(output.identityKeyPath, 0o600, "Governance identity key");
  assertRegularOrMissing(output.backupManifestPath);
  if (existsSync(output.backupManifestPath))
    requireFileMode(output.backupManifestPath, 0o600, "T2 backup manifest");
  assertOwnedFileMatchesOrMissing(
    output.authOrderPlanPath,
    stableJson(buildAuthOrderPlan()),
    "Auth order plan",
  );
  assertOwnedFileMatchesOrMissing(
    output.passResolverPath,
    passResolverContents(),
    "Password-store resolver",
    0o700,
  );
  assertOwnedFileMatchesOrMissing(
    output.geminiStreamHotfixPath,
    geminiStreamHotfixContents(),
    "Gemini stream hotfix utility",
    0o700,
    [],
    [LEGACY_GEMINI_STREAM_HOTFIX_R18_SHA256],
  );
  assertOwnedFileMatchesOrMissing(
    output.systemdDropInPath,
    renderSystemdDropIn(stateDir),
    "Systemd drop-in",
    0o600,
    [renderLegacySystemdDropInR16(stateDir)],
  );

  if (options.mode === "preflight") {
    process.stdout.write(
      `${stableJson({ ...output, preflight: "PASS", installedMutation: false })}`,
    );
    return;
  }
  ensurePrivateDirectory(stateDir);
  ensurePrivateDirectory(output.ledgerDirectory);
  await createRuntimeBackup({ stateDir, identifiers });
  if (!configExists) {
    writePrivateRegularFile(configPath, stableJson(config));
  }
  for (const [agentId, workspace] of Object.entries(output.workspaces)) {
    materializeWorkspace(workspace, agentInstructions(agentId), agentId);
  }
  for (const agentDir of Object.values(output.agentDirs)) {
    ensurePrivateDirectory(agentDir);
  }
  materializeOwnedFile(
    output.authPlanPath,
    stableJson(buildSecretsPlan()),
    "Auth SecretRef plan",
  );
  ensurePrivateDirectory(output.governancePluginDirectory);
  for (const [relative, contents] of Object.entries(pluginFiles.assets)) {
    const target = path.join(output.governancePluginDirectory, relative);
    ensurePrivateDirectory(path.dirname(target));
    materializeOwnedFile(
      target,
      contents,
      "Governance plugin asset",
      0o600,
      [],
      ALLOWED_GOVERNANCE_ASSET_SHA256[relative] ?? [],
    );
  }
  materializeOwnedFile(
    output.governancePluginManifestPath,
    pluginFiles.manifest,
    "Governance plugin manifest",
    0o600,
    [],
    LEGACY_GOVERNANCE_MANIFEST_R11_SHA256,
  );
  materializeOwnedFile(
    output.governancePluginPackagePath,
    pluginFiles.package,
    "Governance plugin package",
  );
  materializeOwnedFile(
    output.governancePluginEntrypointPath,
    pluginFiles.entrypoint,
    "Governance plugin entrypoint",
    0o700,
    [],
    [
      LEGACY_GOVERNANCE_ENTRYPOINT_R11_SHA256,
      STARTING_GOVERNANCE_ENTRYPOINT_SHA256,
      INTERMEDIATE_GOVERNANCE_ENTRYPOINT_SHA256,
      "d5f1394e18eb2e1910c2ec7f1c92cab4e6c16b1e7ced7c7899b7d1076df85b2e",
      "f116d778cb5a8fa875ff33cb2fe6de8a42f209b984a84899cf2ab795592b13d7",
      "73bea1f506a72181528c11bd210ee6ccaf4ad69518c2ff38fdafc5da4a91be6e",
      "6ccf56a256a321597c7405f2daff3412371a3c37e5d27a410c0cf2a3db802724",
      "3c6545cc8925710ca76068ed64070a71353a794b81de74561bd168e034ec2135",
      "9402dc774e7db90616bf5cafe9afc2bf899892fb2c926abf2526f69eb29d7d7e",
      "e2a265dca6a0ea2b20b8a41004cf08b6157bfbaf503d1a5d2257dfc2504243f3",
      "694a89ae93d6685ff37562828873e7120bb07353b8d3e6e213fd5b080106bf8f",
      "af0ce312e23a0d3be9a10c3bb350b3d6b7d345b1ca7fc49ae13efd41219e5c93",
      "fdb72c9f058cb29e3ba4e3ae3a394d1f84e805a274e8614e592018d073e88015",
      "17b4be782cebc34df7a363c095865653cc8351ba50e08c1206ce4981d6c7e6d1",
      // The entrypoint of the superseded WSL deployment recognized on
      // 2026-09-30 under the same owner authorization as the asset list.
      "09f1d8e66f2b9fca35180d9e0d208f644cedf34824e4cd18bb9f229b51cec1c7",
      // The accepted R5/V15/V16 build (652ac0c lineage), established by
      // packaging that commit, listed only so the R6 emission path can replace it.
      "e77689c94ba066bd854549750044f78dcf9d97cc3de73420893851c0a800b10a",
      // M8/T2.2-R13: the outgoing R7 entrypoint currently deployed, byte-proven
      // against the live runtime at this exact path on 2026-09-30
      // (extensions/zink-governance/index.mjs, 192895 bytes). Listed here as well
      // as in the preflight gate above because that list is duplicated per mode:
      // admitting the predecessor in one mode and not the other would let
      // --preflight PASS and then --apply refuse, which is exactly the deadlock
      // R13 exists to remove. The R10 digest is deliberately NOT listed: it is
      // the current build and is already accepted by content comparison.
      "74582778e5d58ce6a26dec3514b9a73ad5f8964f892023b37221f8a85b5ff215",
      // M8/T2.2-R17: the outgoing R10 entrypoint, listed here as well as in the
      // preflight gate above for the same reason R13's entry is duplicated per
      // mode: admitting the predecessor in one mode and not the other would let
      // --preflight PASS and then --apply refuse. The R17 digest is deliberately
      // NOT listed: it is the current build and is accepted by content comparison.
      "e5b220b4a3b023f6d7b26561964f6204f0d004267b208cddab90adb6043b8bd7",
      // M8/T2.2-R19: the outgoing R17 entrypoint, listed here as well as in the
      // preflight gate above for the same reason R13's entry is duplicated per
      // mode: admitting the predecessor in one mode and not the other would let
      // --preflight PASS and then --apply refuse. The R19 digest is deliberately
      // NOT listed: it is the current build and is accepted by content comparison.
      "d01c210b0cc13f01d6d294223ae400a30ef6407c962d5b46e2f199474f799a1d",
      // Owner-identity hygiene: the outgoing R19 entrypoint currently deployed,
      // listed here as well as in the preflight gate above for the same
      // per-mode-duplication reason.
      "bae7bdf358f35c43c5308c4b0b24a1da57b55bbc609d1ff3a7e32daf65182eca",
      // M8/T3: the outgoing hygiene entrypoint, listed here as well as in the
      // preflight gate above for the same per-mode-duplication reason.
      "2271b56bc7f0ed3a3446e4474c411c1a6132a4e3c1a2edfedb5e6907d8340b5d",
    ],
  );
  if (!existsSync(output.identityKeyPath))
    writePrivateRegularFile(
      output.identityKeyPath,
      `${randomBytes(32).toString("hex")}\n`,
      0o600,
    );
  upgradeEmptyLegacyLedger(ledgerPaths(stateDir));
  materializeOwnedFile(
    output.authOrderPlanPath,
    stableJson(buildAuthOrderPlan()),
    "Auth order plan",
  );
  ensurePrivateDirectory(path.dirname(output.passResolverPath));
  materializeOwnedFile(
    output.passResolverPath,
    passResolverContents(),
    "Password-store resolver",
    0o700,
  );
  materializeOwnedFile(
    output.geminiStreamHotfixPath,
    geminiStreamHotfixContents(),
    "Gemini stream hotfix utility",
    0o700,
    [],
    [LEGACY_GEMINI_STREAM_HOTFIX_R18_SHA256],
  );
  ensurePrivateDirectory(path.dirname(output.passStoreDirectory));
  ensurePrivateDirectory(output.passStoreDirectory);
  ensurePrivateDirectory(output.gpgHomeDirectory);
  ensurePrivateDirectory(path.dirname(output.systemdDropInPath));
  materializeOwnedFile(
    output.systemdDropInPath,
    renderSystemdDropIn(stateDir),
    "Systemd drop-in",
    0o600,
    [renderLegacySystemdDropInR16(stateDir)],
  );
  process.stdout.write(`${stableJson(output)}`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.message}\n${usage()}\n`);
  process.exitCode = 1;
}
