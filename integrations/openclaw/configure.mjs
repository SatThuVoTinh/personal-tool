#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  assertInsideHome,
  assertNoRepositoryOverlap,
  assertNoSymlinkComponents,
  assertRegularOrMissing,
  assertWorkspaceMatchesTemplate,
  buildConfig,
  buildSecretsPlan,
  defaultStateDirectory,
  defaultSystemdUserDirectory,
  ensurePrivateDirectory,
  materializeWorkspace,
  parseIdentifiers,
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
    "  --discord-channel-id <id> --discord-owner-id <id>",
    "  [--state-dir <absolute-path>] [--systemd-user-dir <absolute-path>]",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {};
  const allowed = new Set([
    "state-dir",
    "systemd-user-dir",
    "discord-guild-id",
    "discord-channel-id",
    "discord-owner-id",
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
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(
      "Existing config does not match the deterministic T1 policy",
    );
  }
  return true;
}

function materializeOwnedFile(filePath, contents, label) {
  assertRegularOrMissing(filePath);
  if (existsSync(filePath)) {
    if (readFileSync(filePath, "utf8") !== contents) {
      throw new Error(`${label} drift detected: ${filePath}`);
    }
    return;
  }
  writePrivateRegularFile(filePath, contents);
}

function assertOwnedFileMatchesOrMissing(filePath, contents, label) {
  assertRegularOrMissing(filePath);
  if (existsSync(filePath) && readFileSync(filePath, "utf8") !== contents) {
    throw new Error(`${label} drift detected: ${filePath}`);
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
    discordChannelId: options["discord-channel-id"],
    discordOwnerId: options["discord-owner-id"],
  });
  assertInsideHome(stateDir, "OpenClaw state directory");
  assertInsideHome(systemdUserDir, "Systemd user directory");
  assertNoRepositoryOverlap(REPOSITORY_ROOT, stateDir);
  const config = buildConfig({ stateDir, identifiers });
  const output = {
    profile: "zink",
    stateDir,
    workspace: config.agents.entries.main.workspace,
    configPath: path.join(stateDir, "openclaw.json"),
    authPlanPath: path.join(stateDir, "zink-auth-secret-plan.json"),
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
    output.workspace,
    output.configPath,
    output.authPlanPath,
    systemdUserDir,
    output.systemdDropInPath,
  ]) {
    assertNoSymlinkComponents(target);
  }

  const context = { stateDir, identifiers };
  const configPath = output.configPath;
  const configExists = existingConfigMatches(configPath, config, context);
  assertWorkspaceMatchesTemplate(output.workspace);
  assertOwnedFileMatchesOrMissing(
    output.authPlanPath,
    stableJson(buildSecretsPlan()),
    "Auth SecretRef plan",
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
  materializeWorkspace(output.workspace);
  materializeOwnedFile(
    output.authPlanPath,
    stableJson(buildSecretsPlan()),
    "Auth SecretRef plan",
  );
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
