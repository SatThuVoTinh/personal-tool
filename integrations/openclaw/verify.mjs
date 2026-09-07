#!/usr/bin/env node
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  AGENT_GOOGLE_PROFILES,
  AGENT_IDS,
  DISCORD_SURFACE_IDENTIFIERS,
  PASS_PROVIDER_ID,
  SECRET_REFS,
  assertDirectoryOrMissing,
  assertInsideHome,
  assertNoRepositoryOverlap,
  assertNoSymlinkComponents,
  assertRegularOrMissing,
  assertWorkspaceMatchesTemplate,
  buildAuthOrderPlan,
  buildSecretsPlan,
  defaultStateDirectory,
  defaultSystemdUserDirectory,
  parseIdentifiers,
  passResolverContents,
  renderSystemdDropIn,
  stableJson,
  validateConfig,
} from "./lib/policy.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const execFileAsync = promisify(execFile);
const DISCORD_FORBIDDEN_PERMISSIONS = Object.freeze([
  "Administrator",
  "ManageChannels",
  "ManageRoles",
  "ManageWebhooks",
  "UseApplicationCommands",
]);

export function isExpectedDiscordCapability(
  value,
  { accountId, surfaceIdentifier },
) {
  const channel = value?.channels?.find(
    (entry) => entry?.channel === "discord" && entry?.accountId === accountId,
  );
  const permissionDetails = channel?.diagnostics?.details?.permissions;
  const permissions = permissionDetails?.permissions;
  const isOffice = surfaceIdentifier === "discordOfficeChannelId";
  const requiredPermissions = isOffice
    ? ["ViewChannel", "SendMessages", "ReadMessageHistory"]
    : ["ViewChannel", "SendMessagesInThreads", "ReadMessageHistory"];
  return (
    channel?.probe?.ok === true &&
    permissionDetails?.channelType === (isOffice ? 0 : 15) &&
    Array.isArray(permissions) &&
    requiredPermissions.every((permission) =>
      permissions.includes(permission),
    ) &&
    DISCORD_FORBIDDEN_PERMISSIONS.every(
      (permission) => !permissions.includes(permission),
    ) &&
    Array.isArray(permissionDetails.missingRequired) &&
    permissionDetails.missingRequired.length === 0
  );
}

function parseArguments(argv) {
  const options = { live: false };
  const allowed = new Set([
    "state-dir",
    "systemd-user-dir",
    "discord-guild-id",
    "discord-owner-id",
    "discord-office-channel-id",
    "discord-results-forum-id",
    "discord-approvals-forum-id",
    "discord-incidents-forum-id",
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

function displayCommand(command, args) {
  const redacted = args.map((argument, index) =>
    args[index - 1] === "--target" && argument.startsWith("channel:")
      ? "channel:<redacted>"
      : argument,
  );
  return [command, ...redacted].join(" ");
}

function resolveGatewayToken(resolverPath, environment) {
  const request = {
    protocolVersion: 1,
    provider: PASS_PROVIDER_ID,
    ids: [SECRET_REFS.gateway.id],
  };
  const output = execFileSync(resolverPath, [], {
    env: environment,
    encoding: "utf8",
    input: JSON.stringify(request),
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5_000,
    maxBuffer: 16 * 1024,
  });
  const response = JSON.parse(output);
  const value = response?.values?.[SECRET_REFS.gateway.id];
  if (
    response?.protocolVersion !== 1 ||
    typeof value !== "string" ||
    value.length === 0 ||
    Object.keys(response.values ?? {}).length !== 1 ||
    Object.keys(response.errors ?? {}).length !== 0
  ) {
    throw new Error("Gateway SecretRef resolution failed");
  }
  return value;
}

function runLive(command, args, environment) {
  try {
    execFileSync(command, args, {
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { command: displayCommand(command, args), status: "PASS" };
  } catch {
    return { command: displayCommand(command, args), status: "FAIL" };
  }
}

function runLiveJsonCheck(command, args, environment, isExpected) {
  try {
    const output = execFileSync(command, args, {
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(output);
    if (!isExpected(parsed)) {
      throw new Error("Unexpected live JSON result");
    }
    return { command: displayCommand(command, args), status: "PASS" };
  } catch {
    return { command: displayCommand(command, args), status: "FAIL" };
  }
}

async function runLiveJsonCheckAsync(command, args, environment, isExpected) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      env: environment,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    if (!isExpected(parsed)) {
      throw new Error("Unexpected live JSON result");
    }
    return { command: displayCommand(command, args), status: "PASS" };
  } catch {
    return { command: displayCommand(command, args), status: "FAIL" };
  }
}

async function runInBatches(items, batchSize, operation) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    results.push(
      ...(await Promise.all(
        items.slice(index, index + batchSize).map(operation),
      )),
    );
  }
  return results;
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
  assertDirectoryOrMissing(stateDir);
  const configPath = path.join(stateDir, "openclaw.json");
  const authPlanPath = path.join(stateDir, "zink-auth-secret-plan.json");
  const authOrderPlanPath = path.join(stateDir, "zink-auth-order-plan.json");
  const passResolverPath = path.join(stateDir, "bin", "openclaw-pass-resolver");
  const passStoreDirectory = path.join(stateDir, "secrets", "password-store");
  const gpgHomeDirectory = path.join(stateDir, "secrets", "gnupg");
  const workspaces = AGENT_IDS.map((agentId) =>
    path.join(stateDir, "workspaces", agentId),
  );
  const agentDirs = AGENT_IDS.map((agentId) =>
    path.join(stateDir, "agents", agentId, "agent"),
  );
  const dropInPath = path.join(
    systemdUserDir,
    "openclaw-gateway-zink.service.d",
    "10-zink.conf",
  );
  for (const target of [
    stateDir,
    configPath,
    authPlanPath,
    authOrderPlanPath,
    passResolverPath,
    passStoreDirectory,
    gpgHomeDirectory,
    ...workspaces,
    ...agentDirs,
    systemdUserDir,
    dropInPath,
  ]) {
    assertNoSymlinkComponents(target);
  }
  assertRegularOrMissing(configPath);
  assertRegularOrMissing(authPlanPath);
  assertRegularOrMissing(authOrderPlanPath);
  assertRegularOrMissing(dropInPath);
  if (
    !existsSync(configPath) ||
    !existsSync(authPlanPath) ||
    !existsSync(authOrderPlanPath) ||
    !existsSync(passResolverPath) ||
    !existsSync(passStoreDirectory) ||
    !existsSync(gpgHomeDirectory) ||
    !existsSync(dropInPath) ||
    workspaces.some((workspace) => !existsSync(workspace)) ||
    agentDirs.some((agentDir) => !existsSync(agentDir))
  ) {
    throw new Error("Run configure.mjs --apply before verification");
  }
  requireMode(stateDir, 0o700);
  requireMode(configPath, 0o600);
  requireMode(authPlanPath, 0o600);
  requireMode(authOrderPlanPath, 0o600);
  requireMode(passResolverPath, 0o700);
  requireMode(passStoreDirectory, 0o700);
  requireMode(gpgHomeDirectory, 0o700);
  requireMode(dropInPath, 0o600);
  for (const workspace of workspaces) {
    requireMode(workspace, 0o700);
  }
  for (const agentDir of agentDirs) {
    requireMode(agentDir, 0o700);
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  validateConfig(config, { stateDir, identifiers });
  if (readFileSync(authPlanPath, "utf8") !== stableJson(buildSecretsPlan())) {
    throw new Error("Auth SecretRef plan drift detected");
  }
  if (
    readFileSync(authOrderPlanPath, "utf8") !== stableJson(buildAuthOrderPlan())
  ) {
    throw new Error("Auth order plan drift detected");
  }
  if (readFileSync(passResolverPath, "utf8") !== passResolverContents()) {
    throw new Error("Password-store resolver drift detected");
  }
  if (readFileSync(dropInPath, "utf8") !== renderSystemdDropIn(stateDir)) {
    throw new Error("Systemd drop-in drift detected");
  }
  if (
    config.agents.list.length !== AGENT_IDS.length ||
    config.agents.list.some((agent, index) => agent.id !== AGENT_IDS[index])
  ) {
    throw new Error("Expected the exact seven-agent roster");
  }
  for (const agent of config.agents.list) {
    assertWorkspaceMatchesTemplate(agent.workspace);
  }
  const result = { static: "PASS", live: [] };
  if (options.live) {
    const command = options["openclaw-bin"] ?? "openclaw";
    const environment = {
      ...process.env,
      OPENCLAW_PROFILE: "zink",
      OPENCLAW_STATE_DIR: stateDir,
      PASSWORD_STORE_DIR: passStoreDirectory,
      GNUPGHOME: gpgHomeDirectory,
    };
    environment.OPENCLAW_GATEWAY_TOKEN = resolveGatewayToken(
      passResolverPath,
      environment,
    );
    const commands = [
      ["config", "validate"],
      ["doctor"],
      ["update", "status", "--json"],
      ...AGENT_IDS.map((agentId) => [
        "sandbox",
        "explain",
        "--agent",
        agentId,
        "--json",
      ]),
      ["agents", "list", "--bindings", "--json"],
      ["plugins", "list", "--enabled", "--verbose"],
      ["plugins", "inspect", "--all", "--runtime", "--json"],
      ["gateway", "status", "--deep", "--require-rpc"],
      ["channels", "status", "--channel", "discord", "--probe", "--json"],
      ...AGENT_IDS.map((agentId) => [
        "models",
        "status",
        "--agent",
        agentId,
        "--probe",
        "--json",
      ]),
      ["secrets", "audit", "--check", "--allow-exec"],
      ["security", "audit", "--deep", "--json"],
    ];
    result.live = commands.map((args) => runLive(command, args, environment));
    const permissionChecks = AGENT_IDS.flatMap((accountId) =>
      DISCORD_SURFACE_IDENTIFIERS.map((surfaceIdentifier) => ({
        accountId,
        surfaceIdentifier,
      })),
    );
    result.live.push(
      ...(await runInBatches(permissionChecks, 4, (check) =>
        runLiveJsonCheckAsync(
          command,
          [
            "channels",
            "capabilities",
            "--channel",
            "discord",
            "--account",
            check.accountId,
            "--target",
            `channel:${identifiers[check.surfaceIdentifier]}`,
            "--json",
          ],
          environment,
          (value) => isExpectedDiscordCapability(value, check),
        ),
      )),
    );
    result.live.push(
      ...AGENT_IDS.map((agentId) => {
        const expectedOrder = AGENT_GOOGLE_PROFILES[agentId];
        return runLiveJsonCheck(
          command,
          [
            "models",
            "auth",
            "order",
            "get",
            "--agent",
            agentId,
            "--provider",
            "google",
            "--json",
          ],
          environment,
          (value) =>
            value.agentId === agentId &&
            value.provider === "google" &&
            JSON.stringify(value.order) === JSON.stringify(expectedOrder),
        );
      }),
    );
    if (result.live.some((entry) => entry.status === "FAIL")) {
      process.exitCode = 1;
    }
  }
  process.stdout.write(`${stableJson(result)}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
