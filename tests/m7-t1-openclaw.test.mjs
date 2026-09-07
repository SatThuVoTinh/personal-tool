import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  AGENT_DEFINITIONS,
  AGENT_GOOGLE_PROFILES,
  AGENT_IDS,
  DISCORD_SURFACE_IDENTIFIERS,
  GOOGLE_PROFILE_IDS,
  MODEL_ALLOWLIST,
  OPENCLAW_RELEASE,
  PASS_ENTRY_IDS,
  PASS_PROVIDER_ID,
  PLUGIN_ALLOWLIST,
  SECRET_REFS,
  buildAuthOrderPlan,
  buildConfig,
  buildSecretsPlan,
  passResolverContents,
  parseIdentifiers,
  validateConfig,
} from "../integrations/openclaw/lib/policy.mjs";
import { isExpectedDiscordCapability } from "../integrations/openclaw/verify.mjs";

const identifiers = Object.freeze({
  discordGuildId: "12345678901234567",
  discordOwnerId: "32345678901234567",
  discordOfficeChannelId: "22345678901234567",
  discordResultsForumId: "42345678901234567",
  discordApprovalsForumId: "52345678901234567",
  discordIncidentsForumId: "62345678901234567",
});

const discordIdentifierArguments = Object.freeze([
  "--discord-guild-id",
  identifiers.discordGuildId,
  "--discord-owner-id",
  identifiers.discordOwnerId,
  "--discord-office-channel-id",
  identifiers.discordOfficeChannelId,
  "--discord-results-forum-id",
  identifiers.discordResultsForumId,
  "--discord-approvals-forum-id",
  identifiers.discordApprovalsForumId,
  "--discord-incidents-forum-id",
  identifiers.discordIncidentsForumId,
]);

function temporaryDirectory() {
  return mkdtempSync(path.join(tmpdir(), "zink-openclaw-"));
}

function environmentForTemporaryHome(root) {
  return {
    ...process.env,
    USERPROFILE: root,
  };
}

test("M7/T1 builds the exact minimal-tool, zero-command foundation", () => {
  const stateDir = path.join(tmpdir(), "zink-openclaw-static");
  const config = buildConfig({ stateDir, identifiers });
  assert.deepEqual(Object.keys(config.agents.defaults.models), MODEL_ALLOWLIST);
  assert.equal(config.agents.defaults.skipBootstrap, true);
  assert.equal(config.agents.defaults.thinkingDefault, "low");
  assert.deepEqual(
    config.agents.list.map((agent) => agent.id),
    AGENT_IDS,
  );
  assert.deepEqual(
    config.agents.list.map((agent) => agent.name),
    AGENT_DEFINITIONS.map((agent) => agent.name),
  );
  assert.equal(config.agents.list.filter((agent) => agent.default).length, 1);
  for (const agent of config.agents.list) {
    assert.equal(agent.default, agent.id === "main");
    assert.equal(agent.workspace, path.join(stateDir, "workspaces", agent.id));
    assert.equal(
      agent.agentDir,
      path.join(stateDir, "agents", agent.id, "agent"),
    );
    assert.deepEqual(agent.skills, []);
    assert.deepEqual(agent.tools, { profile: "minimal" });
    assert.deepEqual(agent.sandbox, {
      mode: "all",
      backend: "docker",
      scope: "agent",
      workspaceAccess: "none",
      docker: {
        image: "openclaw-sandbox:bookworm-slim",
        network: "none",
        readOnlyRoot: true,
        capDrop: ["ALL"],
        tmpfs: ["/tmp", "/var/tmp", "/run"],
      },
    });
  }
  assert.deepEqual(config.commands, {
    native: false,
    nativeSkills: false,
    text: false,
    bash: false,
    config: false,
    mcp: false,
    plugins: false,
    debug: false,
    restart: false,
  });
  assert.deepEqual(config.tools, {
    agentToAgent: { enabled: false, allow: [] },
  });
  assert.deepEqual(config.plugins, {
    enabled: true,
    allow: [...PLUGIN_ALLOWLIST],
    deny: [],
    load: { paths: [] },
    slots: { memory: "none" },
    entries: {
      google: { enabled: true },
      discord: { enabled: true },
    },
    bundledDiscovery: "allowlist",
  });
  assert.equal(Object.keys(config.auth.profiles).length, 21);
  assert.deepEqual(Object.keys(config.auth.profiles), GOOGLE_PROFILE_IDS);
  for (const profileId of GOOGLE_PROFILE_IDS) {
    assert.deepEqual(config.auth.profiles[profileId], {
      provider: "google",
      mode: "api_key",
    });
  }
  assert.deepEqual(config.auth.order.google, GOOGLE_PROFILE_IDS);
  assert.deepEqual(config.auth.cooldowns, {
    overloadedProfileRotations: 2,
    rateLimitedProfileRotations: 2,
  });
  const secretPlan = buildSecretsPlan();
  assert.deepEqual(buildAuthOrderPlan(), {
    version: 1,
    provider: "google",
    agents: Object.fromEntries(
      AGENT_IDS.map((agentId) => [
        agentId,
        [...AGENT_GOOGLE_PROFILES[agentId]],
      ]),
    ),
  });
  assert.equal(secretPlan.targets.length, 21);
  assert.deepEqual(
    secretPlan.targets.map((target) => target.ref),
    SECRET_REFS.gemini,
  );
  assert.equal(
    new Set(secretPlan.targets.map((target) => target.ref.id)).size,
    21,
  );
  for (const agentId of AGENT_IDS) {
    const targets = secretPlan.targets.filter(
      (target) => target.agentId === agentId,
    );
    assert.equal(targets.length, 3);
    assert.deepEqual(
      targets.map((target) => target.pathSegments[1]),
      AGENT_GOOGLE_PROFILES[agentId],
    );
  }
  assert.deepEqual(config.secrets.providers[PASS_PROVIDER_ID], {
    source: "exec",
    command: path.join(stateDir, "bin", "openclaw-pass-resolver"),
    passEnv: ["PATH", "HOME", "GNUPGHOME", "GPG_TTY", "PASSWORD_STORE_DIR"],
    jsonOnly: true,
    trustedDirs: [path.join(stateDir, "bin")],
  });
  assert.deepEqual(
    SECRET_REFS.gemini.map((ref) => ref.id),
    PASS_ENTRY_IDS.gemini,
  );
  assert.equal(Object.hasOwn(config.channels.discord, "token"), false);
  assert.equal(config.channels.discord.defaultAccount, "main");
  assert.deepEqual(Object.keys(config.channels.discord.accounts), AGENT_IDS);
  for (const agentId of AGENT_IDS) {
    assert.deepEqual(config.channels.discord.accounts[agentId], {
      enabled: true,
      token: SECRET_REFS.discord[agentId],
    });
  }
  assert.deepEqual(
    config.bindings.map((binding) => binding.agentId),
    AGENT_IDS,
  );
  for (const binding of config.bindings) {
    assert.deepEqual(binding.match, {
      channel: "discord",
      accountId: binding.agentId,
      guildId: identifiers.discordGuildId,
    });
  }
  const guild = config.channels.discord.guilds[identifiers.discordGuildId];
  assert.equal(guild.requireMention, true);
  assert.equal(guild.ignoreOtherMentions, true);
  assert.deepEqual(guild.users, [identifiers.discordOwnerId]);
  assert.deepEqual(
    Object.keys(guild.channels),
    DISCORD_SURFACE_IDENTIFIERS.map((name) => identifiers[name]),
  );
  for (const name of DISCORD_SURFACE_IDENTIFIERS) {
    assert.deepEqual(guild.channels[identifiers[name]], {
      enabled: true,
      requireMention: true,
      ignoreOtherMentions: true,
      users: [identifiers.discordOwnerId],
    });
  }
  assert.equal(config.channels.discord.allowBots, false);
  assert.equal(Object.hasOwn(config.channels.discord, "joinIntro"), false);
  assert.equal(config.channels.discord.contextVisibility, "allowlist");
  assert.deepEqual(config.channels.discord.thread, { inheritParent: false });
  assert.equal(Object.hasOwn(config.channels.discord, "intents"), false);
  assert.deepEqual(config.session.threadBindings, { enabled: false });
  assert.equal(
    Object.hasOwn(config.session.maintenance, "archiveDashboardAfter"),
    false,
  );
  validateConfig(config, { stateDir, identifiers });
});

test("M7/T1 rejects configuration drift on restricted surfaces", () => {
  const stateDir = path.join(tmpdir(), "zink-openclaw-static");
  const config = buildConfig({ stateDir, identifiers });
  config.commands.restart = true;
  assert.throws(
    () => validateConfig(config, { stateDir, identifiers }),
    /Policy drift at commands/u,
  );
  const sandboxDrift = buildConfig({ stateDir, identifiers });
  sandboxDrift.agents.list[0].sandbox.docker.network = "bridge";
  assert.throws(
    () => validateConfig(sandboxDrift, { stateDir, identifiers }),
    /Policy drift at agents/u,
  );
  const toolDrift = buildConfig({ stateDir, identifiers });
  toolDrift.agents.list[0].tools.alsoAllow = ["sessions_spawn"];
  assert.throws(
    () => validateConfig(toolDrift, { stateDir, identifiers }),
    /Policy drift at agents/u,
  );
  const agentToAgentDrift = buildConfig({ stateDir, identifiers });
  agentToAgentDrift.tools.agentToAgent.enabled = true;
  agentToAgentDrift.tools.agentToAgent.allow = ["main", "o1"];
  assert.throws(
    () => validateConfig(agentToAgentDrift, { stateDir, identifiers }),
    /Policy drift at tools/u,
  );
  const secretProviderDrift = buildConfig({ stateDir, identifiers });
  secretProviderDrift.secrets.providers[PASS_PROVIDER_ID].command =
    "/tmp/untrusted-resolver";
  assert.throws(
    () => validateConfig(secretProviderDrift, { stateDir, identifiers }),
    /Policy drift at secrets/u,
  );
  const pluginDrift = buildConfig({ stateDir, identifiers });
  pluginDrift.plugins.allow.push("browser");
  assert.throws(
    () => validateConfig(pluginDrift, { stateDir, identifiers }),
    /Policy drift at plugins/u,
  );
  const runtimeMetadata = buildConfig({ stateDir, identifiers });
  runtimeMetadata.meta = {
    lastTouchedVersion: OPENCLAW_RELEASE,
    lastTouchedAt: "2026-09-07T08:14:04.912Z",
  };
  assert.doesNotThrow(() =>
    validateConfig(runtimeMetadata, { stateDir, identifiers }),
  );
  runtimeMetadata.meta.lastTouchedVersion = "2026.6.33";
  assert.throws(
    () => validateConfig(runtimeMetadata, { stateDir, identifiers }),
    /OpenClaw runtime metadata drift/u,
  );
  const authOrderDrift = buildConfig({ stateDir, identifiers });
  authOrderDrift.auth.order.google = [...GOOGLE_PROFILE_IDS].reverse();
  assert.throws(
    () => validateConfig(authOrderDrift, { stateDir, identifiers }),
    /Policy drift at auth/u,
  );
  const rotationDrift = buildConfig({ stateDir, identifiers });
  rotationDrift.auth.cooldowns.rateLimitedProfileRotations = 20;
  assert.throws(
    () => validateConfig(rotationDrift, { stateDir, identifiers }),
    /Policy drift at auth/u,
  );
  const rosterDrift = buildConfig({ stateDir, identifiers });
  rosterDrift.agents.list.pop();
  assert.throws(
    () => validateConfig(rosterDrift, { stateDir, identifiers }),
    /Policy drift at agents/u,
  );
  const bindingDrift = buildConfig({ stateDir, identifiers });
  bindingDrift.bindings[0].match.accountId = "o1";
  assert.throws(
    () => validateConfig(bindingDrift, { stateDir, identifiers }),
    /Policy drift at bindings/u,
  );
  const peerBindingDrift = buildConfig({ stateDir, identifiers });
  peerBindingDrift.bindings[0].match.peer = {
    kind: "channel",
    id: identifiers.discordOfficeChannelId,
  };
  assert.throws(
    () => validateConfig(peerBindingDrift, { stateDir, identifiers }),
    /Policy drift at bindings/u,
  );
  const accountDrift = buildConfig({ stateDir, identifiers });
  accountDrift.channels.discord.accounts.o1.allowBots = "mentions";
  assert.throws(
    () => validateConfig(accountDrift, { stateDir, identifiers }),
    /Policy drift at channels/u,
  );
  const mentionDrift = buildConfig({ stateDir, identifiers });
  mentionDrift.channels.discord.guilds[identifiers.discordGuildId].channels[
    identifiers.discordOfficeChannelId
  ].requireMention = false;
  assert.throws(
    () => validateConfig(mentionDrift, { stateDir, identifiers }),
    /Policy drift at channels/u,
  );
  const wildcardDrift = buildConfig({ stateDir, identifiers });
  wildcardDrift.channels.discord.guilds[identifiers.discordGuildId].channels[
    "*"
  ] = { enabled: true, requireMention: true };
  assert.throws(
    () => validateConfig(wildcardDrift, { stateDir, identifiers }),
    /Policy drift at channels/u,
  );
  const contextDrift = buildConfig({ stateDir, identifiers });
  contextDrift.channels.discord.contextVisibility = "all";
  assert.throws(
    () => validateConfig(contextDrift, { stateDir, identifiers }),
    /Policy drift at channels/u,
  );
  const unsupportedIntentDrift = buildConfig({ stateDir, identifiers });
  unsupportedIntentDrift.channels.discord.intents = { messageContent: false };
  assert.throws(
    () => validateConfig(unsupportedIntentDrift, { stateDir, identifiers }),
    /Policy drift at channels/u,
  );
  const threadDrift = buildConfig({ stateDir, identifiers });
  threadDrift.channels.discord.thread.inheritParent = true;
  assert.throws(
    () => validateConfig(threadDrift, { stateDir, identifiers }),
    /Policy drift at channels/u,
  );
  const threadBindingDrift = buildConfig({ stateDir, identifiers });
  threadBindingDrift.session.threadBindings.enabled = true;
  assert.throws(
    () => validateConfig(threadBindingDrift, { stateDir, identifiers }),
    /Policy drift at session/u,
  );
});

test("M7/T1 password-store resolver is a fail-closed 29-entry boundary", () => {
  const root = temporaryDirectory();
  try {
    const resolver = path.join(root, "openclaw-pass-resolver");
    const resolverSource = passResolverContents();
    const allowedIds = [
      ...PASS_ENTRY_IDS.gemini,
      ...Object.values(PASS_ENTRY_IDS.discord),
      PASS_ENTRY_IDS.gateway,
    ];
    assert.equal(allowedIds.length, 29);
    assert.equal(new Set(allowedIds).size, 29);
    assert.doesNotMatch(resolverSource, /__ZINK_ALLOWED_IDS__/u);
    assert.doesNotMatch(resolverSource, /spawnSync/u);
    assert.match(resolverSource, /Promise\.all/u);
    for (const id of allowedIds) {
      assert.match(resolverSource, new RegExp(id, "u"));
    }
    writeFileSync(resolver, resolverSource, "utf8");
    const rejected = spawnSync(process.execPath, [resolver], {
      encoding: "utf8",
      input: JSON.stringify({
        protocolVersion: 1,
        provider: PASS_PROVIDER_ID,
        ids: ["zink/openclaw/UNAPPROVED_SECRET"],
      }),
    });
    assert.notEqual(rejected.status, 0);
    assert.equal(rejected.stdout, "");
    assert.equal(rejected.stderr, "");

    const boundedLookup = spawnSync(process.execPath, [resolver], {
      encoding: "utf8",
      input: JSON.stringify({
        protocolVersion: 1,
        provider: PASS_PROVIDER_ID,
        ids: [PASS_ENTRY_IDS.gemini[0]],
      }),
    });
    assert.equal(boundedLookup.status, 0);
    const response = JSON.parse(boundedLookup.stdout);
    assert.deepEqual(Object.keys(response.values), []);
    assert.deepEqual(response.errors, {
      [PASS_ENTRY_IDS.gemini[0]]: { code: "NOT_FOUND" },
    });

    const mockPass = path.join(root, "mock-pass.mjs");
    writeFileSync(
      mockPass,
      `setTimeout(() => process.stdout.write("fixture-secret\\n"), 200);\n`,
      "utf8",
    );
    const parallelResolver = path.join(root, "parallel-resolver");
    writeFileSync(
      parallelResolver,
      resolverSource
        .replace(
          'const PASS_COMMAND = "/usr/bin/pass";',
          `const PASS_COMMAND = ${JSON.stringify(process.execPath)};`,
        )
        .replace(
          "const PASS_ARGUMENTS = [];",
          `const PASS_ARGUMENTS = [${JSON.stringify(mockPass)}];`,
        ),
      "utf8",
    );
    const parallelLookup = spawnSync(process.execPath, [parallelResolver], {
      encoding: "utf8",
      input: JSON.stringify({
        protocolVersion: 1,
        provider: PASS_PROVIDER_ID,
        ids: PASS_ENTRY_IDS.gemini,
      }),
      timeout: 3000,
    });
    assert.equal(parallelLookup.status, 0);
    assert.equal(parallelLookup.signal, null);
    const parallelResponse = JSON.parse(parallelLookup.stdout);
    assert.equal(Object.keys(parallelResponse.values).length, 21);
    assert.deepEqual(parallelResponse.errors, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("M7/T1 builder is dry-run safe and apply materializes no secrets", () => {
  const root = temporaryDirectory();
  try {
    const environment = environmentForTemporaryHome(root);
    const stateDir = path.join(root, ".openclaw-zink");
    const systemdUserDir = path.join(root, ".config", "systemd", "user");
    const script = path.join(
      process.cwd(),
      "integrations",
      "openclaw",
      "configure.mjs",
    );
    const baseArgs = [
      script,
      "--state-dir",
      stateDir,
      "--systemd-user-dir",
      systemdUserDir,
      ...discordIdentifierArguments,
    ];
    execFileSync(process.execPath, ["--", ...baseArgs, "--dry-run"], {
      env: environment,
      stdio: "pipe",
    });
    assert.equal(existsSync(stateDir), false);
    execFileSync(process.execPath, ["--", ...baseArgs, "--apply"], {
      env: environment,
      stdio: "pipe",
    });
    const configText = readFileSync(
      path.join(stateDir, "openclaw.json"),
      "utf8",
    );
    const authPlanText = readFileSync(
      path.join(stateDir, "zink-auth-secret-plan.json"),
      "utf8",
    );
    const authOrderPlanText = readFileSync(
      path.join(stateDir, "zink-auth-order-plan.json"),
      "utf8",
    );
    assert.doesNotMatch(configText, /AIza|DISCORD_BOT_TOKEN=/u);
    assert.deepEqual(
      JSON.parse(authPlanText).targets.map((target) => target.ref),
      SECRET_REFS.gemini,
    );
    assert.deepEqual(JSON.parse(authOrderPlanText), buildAuthOrderPlan());
    const resolverPath = path.join(stateDir, "bin", "openclaw-pass-resolver");
    assert.equal(existsSync(resolverPath), true);
    assert.match(readFileSync(resolverPath, "utf8"), /ALLOWED_IDS/u);
    assert.equal(
      existsSync(path.join(stateDir, "secrets", "password-store")),
      true,
    );
    assert.equal(existsSync(path.join(stateDir, "secrets", "gnupg")), true);
    for (const agentId of AGENT_IDS) {
      assert.equal(
        readFileSync(
          path.join(stateDir, "workspaces", agentId, ".gitkeep"),
          "utf8",
        ),
        "",
      );
      assert.equal(
        existsSync(path.join(stateDir, "agents", agentId, "agent")),
        true,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("M7/T1 rejects non-snowflake Discord identifiers", () => {
  assert.throws(
    () => parseIdentifiers({ ...identifiers, discordOwnerId: "not-an-id" }),
    /discordOwnerId/u,
  );
  assert.throws(
    () =>
      parseIdentifiers({
        ...identifiers,
        discordOwnerId: "1".repeat(21),
      }),
    /discordOwnerId/u,
  );
  assert.throws(
    () =>
      parseIdentifiers({
        ...identifiers,
        discordResultsForumId: "not-a-forum-id",
      }),
    /discordResultsForumId/u,
  );
  assert.throws(
    () =>
      parseIdentifiers({
        ...identifiers,
        discordResultsForumId: identifiers.discordOfficeChannelId,
      }),
    /Discord surface IDs must be distinct/u,
  );
});

test("M7/T1 rejects ambiguous or unsupported builder arguments", () => {
  const script = path.join(
    process.cwd(),
    "integrations",
    "openclaw",
    "configure.mjs",
  );
  const common = [...discordIdentifierArguments];
  const repeatedMode = spawnSync(
    process.execPath,
    ["--", script, "--dry-run", "--apply", ...common],
    { encoding: "utf8" },
  );
  assert.notEqual(repeatedMode.status, 0);
  assert.match(repeatedMode.stderr, /Select exactly one/u);
  const unsupported = spawnSync(
    process.execPath,
    ["--", script, "--dry-run", "--unsafe-override", "true", ...common],
    { encoding: "utf8" },
  );
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /Unsupported argument/u);
  const removedSingularArgument = spawnSync(
    process.execPath,
    [
      "--",
      script,
      "--dry-run",
      "--discord-channel-id",
      identifiers.discordOfficeChannelId,
      ...common,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(removedSingularArgument.status, 0);
  assert.match(removedSingularArgument.stderr, /Unsupported argument/u);
});

test("M7/T1 requires operational permissions and rejects admin capabilities", () => {
  const accountId = "power-bi";
  const capability = (channelType, permissions) => ({
    channels: [
      {
        channel: "discord",
        accountId,
        probe: { ok: true },
        diagnostics: {
          details: {
            permissions: {
              channelType,
              permissions,
              missingRequired: [],
            },
          },
        },
      },
    ],
  });
  const office = {
    accountId,
    surfaceIdentifier: "discordOfficeChannelId",
  };
  const forum = {
    accountId,
    surfaceIdentifier: "discordResultsForumId",
  };
  assert.equal(
    isExpectedDiscordCapability(
      capability(0, ["ViewChannel", "SendMessages", "ReadMessageHistory"]),
      office,
    ),
    true,
  );
  assert.equal(
    isExpectedDiscordCapability(
      capability(15, [
        "ViewChannel",
        "SendMessagesInThreads",
        "ReadMessageHistory",
        "AttachFiles",
        "EmbedLinks",
        "CreatePublicThreads",
        "ManageThreads",
      ]),
      forum,
    ),
    true,
  );
  assert.equal(
    isExpectedDiscordCapability(
      capability(15, ["ViewChannel", "SendMessagesInThreads"]),
      forum,
    ),
    false,
  );
  for (const forbidden of [
    "Administrator",
    "ManageChannels",
    "ManageRoles",
    "ManageWebhooks",
    "UseApplicationCommands",
  ]) {
    assert.equal(
      isExpectedDiscordCapability(
        capability(15, [
          "ViewChannel",
          "SendMessagesInThreads",
          "ReadMessageHistory",
          forbidden,
        ]),
        forum,
      ),
      false,
    );
  }
});

test("M7/T1 builder refuses workspace drift without deleting it", () => {
  const root = temporaryDirectory();
  try {
    const environment = environmentForTemporaryHome(root);
    const stateDir = path.join(root, ".openclaw-zink");
    const systemdUserDir = path.join(root, ".config", "systemd", "user");
    const script = path.join(
      process.cwd(),
      "integrations",
      "openclaw",
      "configure.mjs",
    );
    const args = [
      script,
      "--apply",
      "--state-dir",
      stateDir,
      "--systemd-user-dir",
      systemdUserDir,
      ...discordIdentifierArguments,
    ];
    execFileSync(process.execPath, ["--", ...args], {
      env: environment,
      stdio: "pipe",
    });
    const unexpected = path.join(stateDir, "workspaces", "main", "drift.txt");
    writeFileSync(unexpected, "owner content\n", "utf8");
    const result = spawnSync(process.execPath, ["--", ...args], {
      encoding: "utf8",
      env: environment,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Policy drift at agent workspace template/u);
    assert.equal(readFileSync(unexpected, "utf8"), "owner content\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("M7/T1 preflights workspace drift before writing owned files", () => {
  const root = temporaryDirectory();
  try {
    const environment = environmentForTemporaryHome(root);
    const stateDir = path.join(root, ".openclaw-zink");
    const workspace = path.join(stateDir, "workspaces", "main");
    const systemdUserDir = path.join(root, ".config", "systemd", "user");
    const script = path.join(
      process.cwd(),
      "integrations",
      "openclaw",
      "configure.mjs",
    );
    mkdirSync(workspace, { recursive: true });
    writeFileSync(path.join(workspace, "owner.txt"), "owner content\n", "utf8");
    const result = spawnSync(
      process.execPath,
      [
        "--",
        script,
        "--apply",
        "--state-dir",
        stateDir,
        "--systemd-user-dir",
        systemdUserDir,
        ...discordIdentifierArguments,
      ],
      { encoding: "utf8", env: environment },
    );
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(path.join(stateDir, "openclaw.json")), false);
    assert.equal(
      readFileSync(path.join(workspace, "owner.txt"), "utf8"),
      "owner content\n",
    );
    assert.equal(existsSync(systemdUserDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("M7/T1 rejects a symlinked workspace parent before writing config", (t) => {
  const root = temporaryDirectory();
  try {
    const environment = environmentForTemporaryHome(root);
    const stateDir = path.join(root, ".openclaw-zink");
    const outside = path.join(root, "outside-workspaces");
    const systemdUserDir = path.join(root, ".config", "systemd", "user");
    mkdirSync(stateDir);
    mkdirSync(outside);
    try {
      symlinkSync(outside, path.join(stateDir, "workspaces"), "junction");
    } catch (error) {
      t.skip(`symlink creation unavailable: ${error.code ?? "unknown"}`);
      return;
    }
    const script = path.join(
      process.cwd(),
      "integrations",
      "openclaw",
      "configure.mjs",
    );
    const result = spawnSync(
      process.execPath,
      [
        "--",
        script,
        "--apply",
        "--state-dir",
        stateDir,
        "--systemd-user-dir",
        systemdUserDir,
        ...discordIdentifierArguments,
      ],
      { encoding: "utf8", env: environment },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Symlink path component is not allowed/u);
    assert.equal(existsSync(path.join(stateDir, "openclaw.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("M7/T1 builder refuses owned secret-plan drift without overwriting it", () => {
  const root = temporaryDirectory();
  try {
    const environment = environmentForTemporaryHome(root);
    const stateDir = path.join(root, ".openclaw-zink");
    const systemdUserDir = path.join(root, ".config", "systemd", "user");
    const script = path.join(
      process.cwd(),
      "integrations",
      "openclaw",
      "configure.mjs",
    );
    const args = [
      script,
      "--apply",
      "--state-dir",
      stateDir,
      "--systemd-user-dir",
      systemdUserDir,
      ...discordIdentifierArguments,
    ];
    execFileSync(process.execPath, ["--", ...args], {
      env: environment,
      stdio: "pipe",
    });
    const planPath = path.join(stateDir, "zink-auth-secret-plan.json");
    writeFileSync(planPath, "not the owner plan\n", "utf8");
    const result = spawnSync(process.execPath, ["--", ...args], {
      encoding: "utf8",
      env: environment,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Auth SecretRef plan drift/u);
    assert.equal(readFileSync(planPath, "utf8"), "not the owner plan\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("M7/T1 builder refuses owned auth-order drift without overwriting it", () => {
  const root = temporaryDirectory();
  try {
    const environment = environmentForTemporaryHome(root);
    const stateDir = path.join(root, ".openclaw-zink");
    const systemdUserDir = path.join(root, ".config", "systemd", "user");
    const script = path.join(
      process.cwd(),
      "integrations",
      "openclaw",
      "configure.mjs",
    );
    const args = [
      script,
      "--apply",
      "--state-dir",
      stateDir,
      "--systemd-user-dir",
      systemdUserDir,
      ...discordIdentifierArguments,
    ];
    execFileSync(process.execPath, ["--", ...args], {
      env: environment,
      stdio: "pipe",
    });
    const orderPlanPath = path.join(stateDir, "zink-auth-order-plan.json");
    writeFileSync(orderPlanPath, "not the owner order plan\n", "utf8");
    const result = spawnSync(process.execPath, ["--", ...args], {
      encoding: "utf8",
      env: environment,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Auth order plan drift/u);
    assert.equal(
      readFileSync(orderPlanPath, "utf8"),
      "not the owner order plan\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
