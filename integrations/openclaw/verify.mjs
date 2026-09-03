#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
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
  buildSecretsPlan,
  defaultStateDirectory,
  defaultSystemdUserDirectory,
  parseIdentifiers,
  renderSystemdDropIn,
  stableJson,
  validateConfig,
} from "./lib/policy.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function parseArguments(argv) {
  const options = { live: false };
  const allowed = new Set([
    "state-dir",
    "systemd-user-dir",
    "discord-guild-id",
    "discord-channel-id",
    "discord-owner-id",
    "openclaw-bin",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--live") {
      if (options.live) {
        throw new Error("Repeated argument: --live");
      }
      options.live = true;
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
  return options;
}

function mode(filePath) {
  return statSync(filePath).mode & 0o777;
}

function requireMode(filePath, expected) {
  if (mode(filePath) !== expected) {
    throw new Error(
      `Unexpected mode for ${filePath}: expected ${expected.toString(8)}`,
    );
  }
}

function runLive(command, args, environment) {
  try {
    execFileSync(command, args, {
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { command: [command, ...args].join(" "), status: "PASS" };
  } catch {
    return { command: [command, ...args].join(" "), status: "FAIL" };
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
  assertDirectoryOrMissing(stateDir);
  const configPath = path.join(stateDir, "openclaw.json");
  const authPlanPath = path.join(stateDir, "zink-auth-secret-plan.json");
  const dropInPath = path.join(
    systemdUserDir,
    "openclaw-gateway-zink.service.d",
    "10-zink.conf",
  );
  for (const target of [
    stateDir,
    configPath,
    authPlanPath,
    path.join(stateDir, "workspaces", "main"),
    systemdUserDir,
    dropInPath,
  ]) {
    assertNoSymlinkComponents(target);
  }
  assertRegularOrMissing(configPath);
  assertRegularOrMissing(authPlanPath);
  assertRegularOrMissing(dropInPath);
  if (
    !existsSync(configPath) ||
    !existsSync(authPlanPath) ||
    !existsSync(dropInPath)
  ) {
    throw new Error("Run configure.mjs --apply before verification");
  }
  requireMode(stateDir, 0o700);
  requireMode(configPath, 0o600);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  validateConfig(config, { stateDir, identifiers });
  if (readFileSync(authPlanPath, "utf8") !== stableJson(buildSecretsPlan())) {
    throw new Error("Auth SecretRef plan drift detected");
  }
  if (readFileSync(dropInPath, "utf8") !== renderSystemdDropIn(stateDir)) {
    throw new Error("Systemd drop-in drift detected");
  }
  assertWorkspaceMatchesTemplate(config.agents.entries.main.workspace);
  const result = { static: "PASS", live: [] };
  if (options.live) {
    const command = options["openclaw-bin"] ?? "openclaw";
    const environment = {
      ...process.env,
      OPENCLAW_PROFILE: "zink",
      OPENCLAW_STATE_DIR: stateDir,
    };
    const commands = [
      ["doctor"],
      ["update", "status", "--json"],
      ["sandbox", "explain", "--agent", "main", "--json"],
      ["plugins", "list", "--enabled", "--verbose"],
      ["plugins", "inspect", "--all", "--runtime", "--json"],
      ["gateway", "status", "--deep", "--require-rpc"],
      ["channels", "status", "--channel", "discord", "--probe", "--json"],
      ["models", "status", "--probe"],
      ["secrets", "audit", "--check"],
      ["security", "audit", "--deep", "--json"],
    ];
    result.live = commands.map((args) => runLive(command, args, environment));
    if (result.live.some((entry) => entry.status === "FAIL")) {
      process.exitCode = 1;
    }
  }
  process.stdout.write(`${stableJson(result)}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
