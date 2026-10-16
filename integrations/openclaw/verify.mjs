#!/usr/bin/env node
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import {
  runtimeBackupPath,
  verifyRuntimeBackup,
} from "./topology/lib/runtime-backup.mjs";

import {
  AGENT_IDS,
  DISCORD_SURFACE_IDENTIFIERS,
  PASS_PROVIDER_ID,
  ROUTER_PROVIDER_MODEL_IDS,
  SECRET_REFS,
  assertDirectoryOrMissing,
  assertInsideHome,
  assertNoRepositoryOverlap,
  assertNoSymlinkComponents,
  assertRegularOrMissing,
  assertWorkspaceMatchesTemplate,
  agentInstructions,
  buildAuthOrderPlan,
  buildSecretsPlan,
  defaultStateDirectory,
  defaultSystemdUserDirectory,
  GOVERNANCE_PLUGIN_ID,
  governancePluginFiles,
  geminiStreamHotfixContents,
  parseIdentifiers,
  passResolverContents,
  renderSystemdDropIn,
  resolveRouterApiKey,
  resolveRouterBaseUrl,
  stableJson,
  validateConfig,
} from "./lib/policy.mjs";
import { ledgerPaths } from "./topology/lib/ledger.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const LIVE_COMMAND_TIMEOUT_MS = 45_000;
const LIVE_PROBE_CONCURRENCY = 1;
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

// NTFS reports 0o666 for files and 0o777 for directories whatever was requested, so a
// 0o600/0o700 assertion can never be true on that host. configure.mjs already skips its
// mode checks the same way (configure.mjs `requireFileMode`); before that skip existed
// here, this gate could not produce evidence on the host the evidence was being produced
// on, which is the mechanism behind the standing `NOT RUN`.
export function hostEnforcesPosixModes(platform) {
  return platform !== "win32";
}

export function requireMode(filePath, expected) {
  if (!hostEnforcesPosixModes(process.platform)) {
    return;
  }
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

export async function resolveGatewayToken(resolverPath, environment) {
  const request = {
    protocolVersion: 1,
    provider: PASS_PROVIDER_ID,
    ids: [SECRET_REFS.gateway.id],
  };
  const { stdout } = await execFileBounded(resolverPath, [], {
    env: environment,
    timeout: 5_000,
    maxBuffer: 16 * 1024,
    input: JSON.stringify(request),
  });
  const response = JSON.parse(stdout);
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

function terminateBoundedChild(child) {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall through to the direct child kill when a process group is gone.
    }
  }
  child.kill("SIGKILL");
}

export function execFileBounded(command, args, options = {}) {
  const {
    timeout = LIVE_COMMAND_TIMEOUT_MS,
    maxBuffer = 16 * 1024 * 1024,
    input,
    ...spawnOptions
  } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...spawnOptions,
      detached: process.platform !== "win32",
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    let timer;
    const abort = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      terminateBoundedChild(child);
      child.stdin?.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      reject(error);
    };
    timer = setTimeout(() => {
      const error = new Error(`${command} timed out`);
      error.code = "ETIMEDOUT";
      abort(error);
    }, timeout);

    const append = (name, chunk) => {
      if (settled) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > maxBuffer) {
        abort(new Error(`${command} exceeded output limit`));
        return;
      }
      (name === "stdout" ? stdout : stderr).push(chunk);
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    if (input !== undefined) {
      child.stdin.on("error", abort);
      child.stdin.end(input);
    }
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error(`${command} exited with code ${code}`);
        error.code = code;
        error.signal = signal;
        reject(error);
      } else {
        resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      }
    });
  });
}

export async function runLiveAsync(command, args, environment) {
  try {
    await execFileBounded(command, args, { env: environment });
    return { command: displayCommand(command, args), status: "PASS" };
  } catch {
    return { command: displayCommand(command, args), status: "FAIL" };
  }
}

async function runLiveJsonCheckAsync(command, args, environment, isExpected) {
  try {
    const { stdout } = await execFileBounded(command, args, {
      env: environment,
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

// M10/T2-R9: live reachability probe for the baked router endpoint.
//
// This deliberately reports a FAIL, with a reason, instead of a bare failure,
// because the failure mode it exists to catch (a stale WSL host address after a
// WSL restart) otherwise looks identical to "the agent has no model". The probe
// performs no model call and never prints the credential: it asserts reachability
// and that every allowlisted wire model id is still served.
async function runLiveRouterReachabilityAsync() {
  const label = `router endpoint reachability (${ROUTER_PROVIDER_MODEL_IDS.length} model ids)`;
  let baseUrl;
  let apiKey;
  try {
    baseUrl = resolveRouterBaseUrl();
    apiKey = resolveRouterApiKey();
  } catch {
    return {
      command: label,
      status: "FAIL",
      detail: "ROUTER_CONFIG_UNAVAILABLE",
    };
  }
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return {
        command: label,
        status: "FAIL",
        detail: `ROUTER_HTTP_${response.status}`,
      };
    }
    const payload = await response.json();
    const served = new Set((payload?.data ?? []).map((model) => model?.id));
    const missing = ROUTER_PROVIDER_MODEL_IDS.filter((id) => !served.has(id));
    if (missing.length > 0) {
      return {
        command: label,
        status: "FAIL",
        detail: `ROUTER_MODEL_ID_MISSING:${missing.join(",")}`,
      };
    }
    return { command: label, status: "PASS" };
  } catch (error) {
    return {
      command: label,
      status: "FAIL",
      detail: `ROUTER_UNREACHABLE:${error?.name ?? "Error"}`,
    };
  }
}

// Exported for `tests/m12-t2.2-b4-live-probe-invariants.test.mjs`. Printing
// `{"static":"PASS","live":[]}` under `--live` has to be impossible, and that is a property of
// this batching rule plus the verdict rule in `runLiveAsync` — not of a guard `main()` could
// ever reach, which is why there is no guard there.
export async function runInBatches(items, batchSize, operation) {
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
  const geminiStreamHotfixPath = path.join(
    stateDir,
    "bin",
    "openclaw-gemini-stream-hotfix.mjs",
  );
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
  const pluginDirectory = path.join(
    stateDir,
    "extensions",
    GOVERNANCE_PLUGIN_ID,
  );
  const pluginManifestPath = path.join(pluginDirectory, "openclaw.plugin.json");
  const pluginPackagePath = path.join(pluginDirectory, "package.json");
  const pluginEntrypointPath = path.join(pluginDirectory, "index.mjs");
  const governancePaths = ledgerPaths(stateDir);
  const backupManifestPath = path.join(
    runtimeBackupPath(stateDir),
    "manifest.json",
  );
  for (const target of [
    stateDir,
    configPath,
    authPlanPath,
    authOrderPlanPath,
    passResolverPath,
    geminiStreamHotfixPath,
    passStoreDirectory,
    gpgHomeDirectory,
    ...workspaces,
    ...agentDirs,
    systemdUserDir,
    dropInPath,
    pluginDirectory,
    pluginManifestPath,
    pluginPackagePath,
    pluginEntrypointPath,
    governancePaths.root,
    governancePaths.events,
    governancePaths.snapshot,
    governancePaths.identityKey,
    backupManifestPath,
  ]) {
    assertNoSymlinkComponents(target);
  }
  assertRegularOrMissing(configPath);
  assertRegularOrMissing(authPlanPath);
  assertRegularOrMissing(authOrderPlanPath);
  assertRegularOrMissing(passResolverPath);
  assertRegularOrMissing(geminiStreamHotfixPath);
  assertRegularOrMissing(dropInPath);
  assertRegularOrMissing(pluginManifestPath);
  assertRegularOrMissing(pluginPackagePath);
  assertRegularOrMissing(pluginEntrypointPath);
  assertRegularOrMissing(backupManifestPath);
  if (
    !existsSync(configPath) ||
    !existsSync(authPlanPath) ||
    !existsSync(authOrderPlanPath) ||
    !existsSync(passResolverPath) ||
    !existsSync(geminiStreamHotfixPath) ||
    !existsSync(passStoreDirectory) ||
    !existsSync(gpgHomeDirectory) ||
    !existsSync(dropInPath) ||
    !existsSync(pluginManifestPath) ||
    !existsSync(pluginPackagePath) ||
    !existsSync(pluginEntrypointPath) ||
    !existsSync(governancePaths.events) ||
    !existsSync(governancePaths.snapshot) ||
    !existsSync(governancePaths.identityKey) ||
    !existsSync(backupManifestPath) ||
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
  requireMode(geminiStreamHotfixPath, 0o700);
  requireMode(passStoreDirectory, 0o700);
  requireMode(gpgHomeDirectory, 0o700);
  requireMode(dropInPath, 0o600);
  requireMode(pluginDirectory, 0o700);
  requireMode(pluginManifestPath, 0o600);
  requireMode(pluginPackagePath, 0o600);
  requireMode(pluginEntrypointPath, 0o700);
  requireMode(governancePaths.root, 0o700);
  requireMode(governancePaths.events, 0o600);
  requireMode(governancePaths.snapshot, 0o600);
  requireMode(governancePaths.identityKey, 0o600);
  requireMode(backupManifestPath, 0o600);
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
  if (
    readFileSync(geminiStreamHotfixPath, "utf8") !==
    geminiStreamHotfixContents()
  ) {
    throw new Error("Gemini stream hotfix utility drift detected");
  }
  if (readFileSync(dropInPath, "utf8") !== renderSystemdDropIn(stateDir)) {
    throw new Error("Systemd drop-in drift detected");
  }
  const pluginFiles = governancePluginFiles();
  for (const [relative, contents] of Object.entries(pluginFiles.assets)) {
    const target = path.join(pluginDirectory, relative);
    assertNoSymlinkComponents(target);
    assertRegularOrMissing(target);
    requireMode(target, 0o600);
    if (readFileSync(target, "utf8") !== contents)
      throw new Error("Governance plugin asset drift detected");
  }
  if (
    readFileSync(pluginManifestPath, "utf8") !== pluginFiles.manifest ||
    readFileSync(pluginPackagePath, "utf8") !== pluginFiles.package ||
    readFileSync(pluginEntrypointPath, "utf8") !== pluginFiles.entrypoint
  ) {
    throw new Error("Governance plugin drift detected");
  }
  await verifyRuntimeBackup({ stateDir, identifiers });
  if (
    config.agents.list.length !== AGENT_IDS.length ||
    config.agents.list.some((agent, index) => agent.id !== AGENT_IDS[index])
  ) {
    throw new Error("Expected the exact seven-agent roster");
  }
  for (const agent of config.agents.list) {
    assertWorkspaceMatchesTemplate(
      agent.workspace,
      agentInstructions(agent.id),
      true,
    );
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
    environment.OPENCLAW_GATEWAY_TOKEN = await resolveGatewayToken(
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
    result.live = await runInBatches(commands, LIVE_PROBE_CONCURRENCY, (args) =>
      runLiveAsync(command, args, environment),
    );
    result.live.unshift(
      await runLiveAsync(
        process.execPath,
        [geminiStreamHotfixPath, "--check"],
        environment,
      ),
    );
    const permissionChecks = AGENT_IDS.flatMap((accountId) =>
      DISCORD_SURFACE_IDENTIFIERS.map((surfaceIdentifier) => ({
        accountId,
        surfaceIdentifier,
      })),
    );
    result.live.push(
      ...(await runInBatches(
        permissionChecks,
        LIVE_PROBE_CONCURRENCY,
        (check) =>
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
    // M10/T2-R9: the per-agent `models auth order get --provider google` check
    // is gone because auth profiles and auth order no longer exist. It is
    // replaced by a check on the thing that can actually break: the baked
    // router endpoint. OpenClaw has no config templating (proven against the
    // installed runtime), so a stale WSL host address is undetectable from the
    // config alone and would otherwise present as "the agent has no model".
    // This probe fails loudly when the endpoint is unreachable or when the
    // router stops serving an allowlisted model id.
    result.live.push(await runLiveRouterReachabilityAsync());
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
