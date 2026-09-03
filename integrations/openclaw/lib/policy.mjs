import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const PROFILE = "zink";
export const STATE_DIRECTORY_NAME = ".openclaw-zink";
export const GOOGLE_PROFILE_ID = "google:zink-primary";
export const MODEL_ALLOWLIST = [
  "google/gemini-flash-latest",
  "google/gemini-flash-lite-latest",
];

export const SECRET_REFS = Object.freeze({
  gemini: { source: "store", provider: "default", id: "GEMINI_API_KEY" },
  discord: { source: "store", provider: "default", id: "DISCORD_BOT_TOKEN" },
  gateway: {
    source: "store",
    provider: "default",
    id: "ZINK_OPENCLAW_GATEWAY_TOKEN",
  },
});

const COMMAND_POSTURE = Object.freeze({
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

const SNOWFLAKE = /^[1-9]\d{16,19}$/u;
const TEMPLATE_FILES = Object.freeze([".gitkeep"]);

export function defaultStateDirectory() {
  return path.join(homedir(), STATE_DIRECTORY_NAME);
}

export function defaultSystemdUserDirectory() {
  return path.join(homedir(), ".config", "systemd", "user");
}

export function parseIdentifiers(values) {
  const names = ["discordGuildId", "discordChannelId", "discordOwnerId"];
  for (const name of names) {
    if (!SNOWFLAKE.test(values[name] ?? "")) {
      throw new Error(`${name} must be a numeric Discord snowflake`);
    }
  }
  return Object.freeze({
    discordGuildId: values.discordGuildId,
    discordChannelId: values.discordChannelId,
    discordOwnerId: values.discordOwnerId,
  });
}

export function buildConfig({ stateDir, identifiers }) {
  const ids = parseIdentifiers(identifiers);
  const workspace = path.join(stateDir, "workspaces", "main");
  return {
    update: {
      channel: "extended-stable",
      checkOnStart: true,
      auto: { enabled: false },
    },
    gateway: {
      mode: "local",
      bind: "loopback",
      auth: { mode: "token", token: SECRET_REFS.gateway },
      tailscale: { mode: "off" },
      controlUi: { enabled: true },
      cliAgents: { enabled: false },
      terminal: { enabled: false },
    },
    agents: {
      defaults: {
        skipBootstrap: true,
        model: {
          primary: MODEL_ALLOWLIST[0],
          fallbacks: [MODEL_ALLOWLIST[1]],
        },
        modelPolicy: { allow: MODEL_ALLOWLIST },
        utilityModel: "",
      },
      entries: {
        main: {
          workspace,
          skills: [],
          tools: { profile: "minimal", deny: ["session_status"] },
          sandbox: {
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
          },
        },
      },
    },
    auth: {
      profiles: {
        [GOOGLE_PROFILE_ID]: { provider: "google", mode: "api_key" },
      },
      order: { google: [GOOGLE_PROFILE_ID] },
    },
    commands: { ...COMMAND_POSTURE },
    channels: {
      discord: {
        enabled: true,
        token: SECRET_REFS.discord,
        joinIntro: false,
        dmPolicy: "disabled",
        dm: { enabled: false, groupEnabled: false },
        groupPolicy: "allowlist",
        allowBots: false,
        intents: { messageContent: false },
        commands: { native: false, nativeSkills: false },
        guilds: {
          [ids.discordGuildId]: {
            requireMention: true,
            ignoreOtherMentions: true,
            users: [ids.discordOwnerId],
            channels: {
              [ids.discordChannelId]: {
                enabled: true,
                requireMention: true,
                users: [ids.discordOwnerId],
              },
            },
          },
        },
      },
    },
    session: {
      maintenance: {
        mode: "enforce",
        pruneAfter: "30d",
        archiveDashboardAfter: "7d",
        maxEntries: 500,
        resetArchiveRetention: "30d",
        maxDiskBytes: "512mb",
      },
    },
  };
}

export function buildSecretsPlan() {
  return {
    version: 1,
    protocolVersion: 1,
    targets: [
      {
        type: "auth-profiles.api_key.key",
        path: `profiles.${GOOGLE_PROFILE_ID}.key`,
        pathSegments: ["profiles", GOOGLE_PROFILE_ID, "key"],
        agentId: "main",
        authProfileProvider: "google",
        ref: SECRET_REFS.gemini,
      },
    ],
  };
}

export function renderSystemdDropIn(stateDir) {
  return `[Service]\nEnvironment=OPENCLAW_PROFILE=${PROFILE}\nEnvironment=OPENCLAW_STATE_DIR=${stateDir}\nMemoryMax=768M\n`;
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertEqual(actual, expected, label) {
  if (!equal(actual, expected)) {
    throw new Error(`Policy drift at ${label}`);
  }
}

export function validateConfig(config, { stateDir, identifiers }) {
  const expected = buildConfig({ stateDir, identifiers });
  assertEqual(config.update, expected.update, "update");
  assertEqual(config.gateway, expected.gateway, "gateway");
  assertEqual(config.agents, expected.agents, "agents");
  assertEqual(config.auth, expected.auth, "auth");
  assertEqual(config.commands, expected.commands, "commands");
  assertEqual(config.channels, expected.channels, "channels");
  assertEqual(config.session, expected.session, "session");
  const unexpected = Object.keys(config).filter(
    (key) => !Object.hasOwn(expected, key),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected top-level configuration: ${unexpected.join(", ")}`,
    );
  }
  return expected;
}

export function assertRegularOrMissing(filePath) {
  if (!existsSync(filePath)) {
    return;
  }
  const entry = lstatSync(filePath);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`Expected a regular non-symlink file: ${filePath}`);
  }
}

export function assertDirectoryOrMissing(directoryPath) {
  if (!existsSync(directoryPath)) {
    return;
  }
  const entry = lstatSync(directoryPath);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`Expected a directory, not a symlink: ${directoryPath}`);
  }
}

export function ensurePrivateDirectory(directoryPath) {
  assertDirectoryOrMissing(directoryPath);
  mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  chmodSync(directoryPath, 0o700);
  return realpathSync(directoryPath);
}

export function writePrivateRegularFile(filePath, contents) {
  assertRegularOrMissing(filePath);
  writeFileSync(filePath, contents, { encoding: "utf8", mode: 0o600 });
  chmodSync(filePath, 0o600);
}

export function assertWorkspaceMatchesTemplate(workspacePath) {
  assertDirectoryOrMissing(workspacePath);
  if (!existsSync(workspacePath)) {
    return false;
  }
  const entries = readdirSync(workspacePath).sort();
  assertEqual(entries, TEMPLATE_FILES, "main workspace template");
  const marker = path.join(workspacePath, ".gitkeep");
  assertRegularOrMissing(marker);
  if (readFileSync(marker, "utf8") !== "") {
    throw new Error("Main workspace template marker must remain empty");
  }
  return true;
}

export function materializeWorkspace(workspacePath) {
  if (assertWorkspaceMatchesTemplate(workspacePath)) {
    return;
  }
  ensurePrivateDirectory(workspacePath);
  writePrivateRegularFile(path.join(workspacePath, ".gitkeep"), "");
}

export function assertNoRepositoryOverlap(repositoryRoot, stateDir) {
  const repository = realpathSync(repositoryRoot);
  const state = path.resolve(stateDir);
  const relative = path.relative(repository, state);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    throw new Error(
      "OpenClaw state directory must remain outside the repository",
    );
  }
}

export function assertInsideHome(targetPath, label) {
  const userHome = realpathSync(homedir());
  const missingSegments = [];
  let existingAncestor = path.resolve(targetPath);
  while (!existsSync(existingAncestor)) {
    missingSegments.unshift(path.basename(existingAncestor));
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new Error(`${label} has no resolvable filesystem ancestor`);
    }
    existingAncestor = parent;
  }
  const target = path.join(realpathSync(existingAncestor), ...missingSegments);
  const relative = path.relative(userHome, target);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} must be a child path of the user home`);
  }
}

export function assertNoSymlinkComponents(targetPath) {
  const absolute = path.resolve(targetPath);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep)) {
    if (!segment) {
      continue;
    }
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Symlink path component is not allowed: ${current}`);
    }
  }
}
