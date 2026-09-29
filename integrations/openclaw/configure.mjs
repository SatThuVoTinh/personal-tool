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
const LEGACY_GOVERNANCE_MANIFEST_R11_SHA256 =
  "02c805e7909b9ca35711cc5888bc889fe9c9a566f09f580ba614682682ce41ca";
const ALLOWED_GOVERNANCE_ASSET_SHA256 = Object.freeze({
  "lib/guard.mjs": Object.freeze([
    "3d017828de32ed2d9ecdfc7c78e1828f3b4f8a13f88a51aabdd8ddff81443029",
    "00cce929877bfab0864b16519dfa0276bb2955053d348b3e298c4121c3784100",
    "55b38c41d44dc5386f696af671ca8b4de3655e2e2f5b0a6c586560509336c0bc",
    "1c580dc09518ceffeb48ea44d760f280af03b9e3f2b11d0f7a9231638d04e9b3",
    "a6b6f452255d22bee7d3b8b860da4fddef85bafa299fcbaf519dd76cfca075e9",
    "b230651ec4fa9b5a123c10e319438918c0763f99287f5223da1a71d1aebe213a",
    "efdcea2457db29f20603fa0cf948fd8e0261f78d3ec3f863637a56befdf8f784",
  ]),
  "lib/native-boundary.mjs": Object.freeze([
    "4b77356f2a843f26040a7cd3312c896469aff33cc472bc6c02fdd5c472bd1234",
    "4c3f908b84ae64155e6a32741596fc6e2b28601127b72dc33fcea20bcbcc7347",
    "25759e86e53d962bcb00a13eedd63ea028abb31c212ae2874a84bfd041509809",
    "164b17293cf4ac63089ad2ea1afe96bc24b39450bc3332820bc9f5fff654e253",
    "8dbd524a49a8b65959e74f0aaf37516a7a211759bd0a3d047dfd1e73863bd741",
  ]),
  "lib/runtime.mjs": Object.freeze([
    "6a522c73efacf8b593d63ee55e18b5d02c3675340e0593142a5c2fea8dc6e24a",
  ]),
  "lib/ledger.mjs": Object.freeze([
    "d7f406e9dfa8f45d117f555bed18d2bf4c63ed966c3dd0588d221a54b9e87255",
  ]),
  "lib/workflow.mjs": Object.freeze([
    "14bb6a5575b3f25e7d04aafb28eb1e95b0b5b2a21b15b6b5dec787aaaf94f907",
    "19dc0eb40b216fbc898afd8dfc66f5c6aae4da15d1d2a6e5923753e13fcb09f0",
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
    if (actual.channels?.discord?.streaming !== undefined) {
      throw validationError;
    }
    const migrated = JSON.parse(JSON.stringify(actual));
    try {
      migrated.channels.discord.streaming = { mode: "off" };
      // Frozen M8/T1 delivery default restored in R4 builder: configs that
      // predate it converge the same way streaming does.
      if (migrated.channels.discord.replyToMode === undefined) {
        migrated.channels.discord.replyToMode = "off";
      }
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
    [LEGACY_GOVERNANCE_MANIFEST_R11_SHA256],
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
