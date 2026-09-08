#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
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
import { ledgerPaths, ensureLedger } from "./topology/lib/ledger.mjs";
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
const LEGACY_GOVERNANCE_MANIFEST_R11_SHA256 =
  "02c805e7909b9ca35711cc5888bc889fe9c9a566f09f580ba614682682ce41ca";

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function buildBackupManifest(output, config) {
  const targets = [
    output.configPath,
    ...Object.values(output.workspaces),
    output.governancePluginDirectory,
  ];
  return {
    schema_version: "1.0.0",
    governance_version: "m7-t2-r11",
    target_policy_digest: sha256(stableJson(config)),
    restore_order: [
      output.configPath,
      ...Object.values(output.workspaces),
      output.governancePluginDirectory,
    ],
    files: targets
      .filter((target) => existsSync(target))
      .map((target) => ({
        path: target,
        kind: statSync(target).isDirectory() ? "directory" : "file",
        digest: statSync(target).isDirectory()
          ? null
          : sha256(readFileSync(target)),
        mode: statSync(target).mode & 0o777,
      })),
    excludes: ["secrets", "auth material", "identity.key"],
  };
}

function usage() {
  return [
    "Usage: configure.mjs --dry-run|--apply --discord-guild-id <id>",
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
    if (argument === "--dry-run" || argument === "--apply") {
      if (options.mode) {
        throw new Error("Select exactly one of --dry-run or --apply");
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
    throw new Error("Select exactly one of --dry-run or --apply");
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

function main() {
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
    backupManifestPath: path.join(
      stateDir,
      "operator",
      "m7-t2",
      "backup-manifest.json",
    ),
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
  const configPath = output.configPath;
  const configExists = existingConfigMatches(configPath, context);
  for (const [agentId, workspace] of Object.entries(output.workspaces)) {
    assertWorkspaceMatchesTemplate(workspace, agentInstructions(agentId));
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
    [LEGACY_GOVERNANCE_ENTRYPOINT_R11_SHA256],
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

  ensurePrivateDirectory(stateDir);
  ensurePrivateDirectory(output.ledgerDirectory);
  if (!existsSync(output.backupManifestPath)) {
    materializeOwnedFile(
      output.backupManifestPath,
      stableJson(buildBackupManifest(output, config)),
      "T2 backup manifest",
    );
  }
  if (!configExists) {
    writePrivateRegularFile(configPath, stableJson(config));
  }
  for (const [agentId, workspace] of Object.entries(output.workspaces)) {
    materializeWorkspace(workspace, agentInstructions(agentId));
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
    [LEGACY_GOVERNANCE_ENTRYPOINT_R11_SHA256],
  );
  if (!existsSync(output.identityKeyPath))
    writePrivateRegularFile(
      output.identityKeyPath,
      `${randomBytes(32).toString("hex")}\n`,
      0o600,
    );
  ensureLedger(ledgerPaths(stateDir));
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
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n${usage()}\n`);
  process.exitCode = 1;
}
