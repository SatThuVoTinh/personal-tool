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
  GOOGLE_PROFILE_ID,
  MODEL_ALLOWLIST,
  SECRET_REFS,
  buildConfig,
  buildSecretsPlan,
  parseIdentifiers,
  validateConfig,
} from "../integrations/openclaw/lib/policy.mjs";

const identifiers = Object.freeze({
  discordGuildId: "12345678901234567",
  discordChannelId: "22345678901234567",
  discordOwnerId: "32345678901234567",
});

function temporaryDirectory() {
  return mkdtempSync(path.join(tmpdir(), "zink-openclaw-"));
}

function environmentForTemporaryHome(root) {
  return {
    ...process.env,
    USERPROFILE: root,
  };
}

test("M7/T1 builds the exact zero-tool, zero-command foundation", () => {
  const stateDir = path.join(tmpdir(), "zink-openclaw-static");
  const config = buildConfig({ stateDir, identifiers });
  assert.deepEqual(config.agents.defaults.modelPolicy.allow, MODEL_ALLOWLIST);
  assert.equal(config.agents.defaults.utilityModel, "");
  assert.equal(config.agents.defaults.skipBootstrap, true);
  assert.deepEqual(config.agents.entries.main.skills, []);
  assert.deepEqual(config.agents.entries.main.tools, {
    profile: "minimal",
    deny: ["session_status"],
  });
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
  assert.deepEqual(config.auth.profiles[GOOGLE_PROFILE_ID], {
    provider: "google",
    mode: "api_key",
  });
  assert.deepEqual(config.auth.order.google, [GOOGLE_PROFILE_ID]);
  assert.deepEqual(buildSecretsPlan().targets[0].ref, SECRET_REFS.gemini);
  assert.equal(config.channels.discord.joinIntro, false);
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
  sandboxDrift.agents.entries.main.sandbox.docker.network = "bridge";
  assert.throws(
    () => validateConfig(sandboxDrift, { stateDir, identifiers }),
    /Policy drift at agents/u,
  );
  const toolDrift = buildConfig({ stateDir, identifiers });
  toolDrift.agents.entries.main.tools.alsoAllow = ["sessions_spawn"];
  assert.throws(
    () => validateConfig(toolDrift, { stateDir, identifiers }),
    /Policy drift at agents/u,
  );
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
      "--discord-guild-id",
      identifiers.discordGuildId,
      "--discord-channel-id",
      identifiers.discordChannelId,
      "--discord-owner-id",
      identifiers.discordOwnerId,
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
    assert.doesNotMatch(configText, /AIza|DISCORD_BOT_TOKEN=/u);
    assert.match(authPlanText, /"GEMINI_API_KEY"/u);
    assert.equal(
      readFileSync(
        path.join(stateDir, "workspaces", "main", ".gitkeep"),
        "utf8",
      ),
      "",
    );
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
});

test("M7/T1 rejects ambiguous or unsupported builder arguments", () => {
  const script = path.join(
    process.cwd(),
    "integrations",
    "openclaw",
    "configure.mjs",
  );
  const common = [
    "--discord-guild-id",
    identifiers.discordGuildId,
    "--discord-channel-id",
    identifiers.discordChannelId,
    "--discord-owner-id",
    identifiers.discordOwnerId,
  ];
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
      "--discord-guild-id",
      identifiers.discordGuildId,
      "--discord-channel-id",
      identifiers.discordChannelId,
      "--discord-owner-id",
      identifiers.discordOwnerId,
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
    assert.match(result.stderr, /Policy drift at main workspace template/u);
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
        "--discord-guild-id",
        identifiers.discordGuildId,
        "--discord-channel-id",
        identifiers.discordChannelId,
        "--discord-owner-id",
        identifiers.discordOwnerId,
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
        "--discord-guild-id",
        identifiers.discordGuildId,
        "--discord-channel-id",
        identifiers.discordChannelId,
        "--discord-owner-id",
        identifiers.discordOwnerId,
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
      "--discord-guild-id",
      identifiers.discordGuildId,
      "--discord-channel-id",
      identifiers.discordChannelId,
      "--discord-owner-id",
      identifiers.discordOwnerId,
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
