#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync } from "node:fs";
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
  ensurePrivateDirectory,
  materializeWorkspace,
  parseIdentifiers,
  passResolverContents,
  renderSystemdDropIn,
  stableJson,
  validateConfig,
  writePrivateRegularFile,
} from "./lib/policy.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

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

function existingConfigMatches(configPath, expected, context) {
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
  validateConfig(actual, context);
  const policyConfig = { ...actual };
  delete policyConfig.meta;
  if (stableJson(policyConfig) !== stableJson(expected)) {
    throw new Error(
      "Existing config does not match the deterministic T1 policy",
    );
  }
  return true;
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

function materializeOwnedFile(filePath, contents, label, fileMode = 0o600) {
  assertRegularOrMissing(filePath);
  if (existsSync(filePath)) {
    if (readFileSync(filePath, "utf8") !== contents) {
      throw new Error(`${label} drift detected: ${filePath}`);
    }
    requireFileMode(filePath, fileMode, label);
    return;
  }
  writePrivateRegularFile(filePath, contents, fileMode);
}

function assertOwnedFileMatchesOrMissing(
  filePath,
  contents,
  label,
  fileMode = 0o600,
) {
  assertRegularOrMissing(filePath);
  if (existsSync(filePath)) {
    if (readFileSync(filePath, "utf8") !== contents) {
      throw new Error(`${label} drift detected: ${filePath}`);
    }
    requireFileMode(filePath, fileMode, label);
  }
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
    passStoreDirectory: path.join(stateDir, "secrets", "password-store"),
    gpgHomeDirectory: path.join(stateDir, "secrets", "gnupg"),
    systemdDropInPath: path.join(
      systemdUserDir,
      "openclaw-gateway-zink.service.d",
      "10-zink.conf",
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
    output.passStoreDirectory,
    output.gpgHomeDirectory,
    systemdUserDir,
    output.systemdDropInPath,
  ]) {
    assertNoSymlinkComponents(target);
  }

  const context = { stateDir, identifiers };
  const configPath = output.configPath;
  const configExists = existingConfigMatches(configPath, config, context);
  for (const workspace of Object.values(output.workspaces)) {
    assertWorkspaceMatchesTemplate(workspace);
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
    output.systemdDropInPath,
    renderSystemdDropIn(stateDir),
    "Systemd drop-in",
  );

  ensurePrivateDirectory(stateDir);
  if (!configExists) {
    writePrivateRegularFile(configPath, stableJson(config));
  }
  for (const workspace of Object.values(output.workspaces)) {
    materializeWorkspace(workspace);
  }
  for (const agentDir of Object.values(output.agentDirs)) {
    ensurePrivateDirectory(agentDir);
  }
  materializeOwnedFile(
    output.authPlanPath,
    stableJson(buildSecretsPlan()),
    "Auth SecretRef plan",
  );
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
  ensurePrivateDirectory(path.dirname(output.passStoreDirectory));
  ensurePrivateDirectory(output.passStoreDirectory);
  ensurePrivateDirectory(output.gpgHomeDirectory);
  ensurePrivateDirectory(path.dirname(output.systemdDropInPath));
  materializeOwnedFile(
    output.systemdDropInPath,
    renderSystemdDropIn(stateDir),
    "Systemd drop-in",
  );
  process.stdout.write(`${stableJson(output)}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n${usage()}\n`);
  process.exitCode = 1;
}
