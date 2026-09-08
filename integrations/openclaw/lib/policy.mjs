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
import { fileURLToPath } from "node:url";

export const PROFILE = "zink";
export const STATE_DIRECTORY_NAME = ".openclaw-zink";
export const OPENCLAW_RELEASE = "2026.6.34";
export const AGENT_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "main", name: "Main" }),
  Object.freeze({ id: "o1", name: "Knowledge" }),
  Object.freeze({ id: "o2", name: "Orchestrator" }),
  Object.freeze({ id: "excel", name: "Excel" }),
  Object.freeze({ id: "power-bi", name: "Power BI" }),
  Object.freeze({ id: "sql", name: "SQL" }),
  Object.freeze({ id: "python", name: "Python" }),
]);
export const AGENT_IDS = Object.freeze(
  AGENT_DEFINITIONS.map((agent) => agent.id),
);
export const DISCORD_SURFACE_IDENTIFIERS = Object.freeze([
  "discordOfficeChannelId",
  "discordResultsForumId",
  "discordApprovalsForumId",
  "discordIncidentsForumId",
]);
export const GOOGLE_PROFILE_IDS = Object.freeze(
  Array.from(
    { length: 21 },
    (_, index) => `google:zink-${String(index + 1).padStart(2, "0")}`,
  ),
);
export const PASS_PROVIDER_ID = "pass_store";
export const PLUGIN_ALLOWLIST = Object.freeze(["google", "discord"]);
export const PASS_ENTRY_IDS = Object.freeze({
  gemini: Object.freeze(
    Array.from(
      { length: 21 },
      (_, index) =>
        `zink/openclaw/GEMINI_API_KEY_${String(index + 1).padStart(2, "0")}`,
    ),
  ),
  discord: Object.freeze(
    Object.fromEntries(
      AGENT_IDS.map((agentId) => [
        agentId,
        `zink/openclaw/DISCORD_BOT_TOKEN_${agentId
          .toUpperCase()
          .replaceAll("-", "_")}`,
      ]),
    ),
  ),
  gateway: "zink/openclaw/ZINK_OPENCLAW_GATEWAY_TOKEN",
});
export const AGENT_GOOGLE_PROFILES = Object.freeze(
  Object.fromEntries(
    AGENT_IDS.map((agentId, index) => [
      agentId,
      Object.freeze(GOOGLE_PROFILE_IDS.slice(index * 3, index * 3 + 3)),
    ]),
  ),
);
export const MODEL_ALLOWLIST = [
  "google/gemini-flash-latest",
  "google/gemini-flash-lite-latest",
];

export const SECRET_REFS = Object.freeze({
  gemini: Object.freeze(
    PASS_ENTRY_IDS.gemini.map((id) =>
      Object.freeze({ source: "exec", provider: PASS_PROVIDER_ID, id }),
    ),
  ),
  discord: Object.freeze(
    Object.fromEntries(
      AGENT_IDS.map((agentId) => [
        agentId,
        Object.freeze({
          source: "exec",
          provider: PASS_PROVIDER_ID,
          id: PASS_ENTRY_IDS.discord[agentId],
        }),
      ]),
    ),
  ),
  gateway: {
    source: "exec",
    provider: PASS_PROVIDER_ID,
    id: PASS_ENTRY_IDS.gateway,
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
const PASS_RESOLVER_TEMPLATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
  "openclaw-pass-resolver",
);
const GEMINI_STREAM_HOTFIX_TEMPLATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
  "openclaw-gemini-stream-hotfix.mjs",
);

export function defaultStateDirectory() {
  return path.join(homedir(), STATE_DIRECTORY_NAME);
}

export function defaultSystemdUserDirectory() {
  return path.join(homedir(), ".config", "systemd", "user");
}

export function parseIdentifiers(values) {
  const names = [
    "discordGuildId",
    "discordOwnerId",
    ...DISCORD_SURFACE_IDENTIFIERS,
  ];
  for (const name of names) {
    if (!SNOWFLAKE.test(values[name] ?? "")) {
      throw new Error(`${name} must be a numeric Discord snowflake`);
    }
  }
  const surfaceIds = DISCORD_SURFACE_IDENTIFIERS.map((name) => values[name]);
  if (new Set(surfaceIds).size !== surfaceIds.length) {
    throw new Error("Discord surface IDs must be distinct");
  }
  return Object.freeze(
    Object.fromEntries(names.map((name) => [name, values[name]])),
  );
}

export function buildConfig({ stateDir, identifiers }) {
  const ids = parseIdentifiers(identifiers);
  const resolverDirectory = path.join(stateDir, "bin");
  const channelAccess = {
    requireMention: true,
    ignoreOtherMentions: true,
    users: [ids.discordOwnerId],
    channels: Object.fromEntries(
      DISCORD_SURFACE_IDENTIFIERS.map((name) => [
        ids[name],
        {
          enabled: true,
          requireMention: true,
          ignoreOtherMentions: true,
          users: [ids.discordOwnerId],
        },
      ]),
    ),
  };
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
    },
    agents: {
      defaults: {
        skipBootstrap: true,
        model: {
          primary: MODEL_ALLOWLIST[0],
          fallbacks: [MODEL_ALLOWLIST[1]],
        },
        models: Object.fromEntries(MODEL_ALLOWLIST.map((model) => [model, {}])),
        thinkingDefault: "low",
      },
      list: AGENT_DEFINITIONS.map((agent) => ({
        id: agent.id,
        default: agent.id === "main",
        name: agent.name,
        workspace: path.join(stateDir, "workspaces", agent.id),
        agentDir: path.join(stateDir, "agents", agent.id, "agent"),
        skills: [],
        tools: { profile: "minimal" },
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
      })),
    },
    auth: {
      profiles: Object.fromEntries(
        GOOGLE_PROFILE_IDS.map((profileId) => [
          profileId,
          { provider: "google", mode: "api_key" },
        ]),
      ),
      order: { google: [...GOOGLE_PROFILE_IDS] },
      cooldowns: {
        overloadedProfileRotations: 2,
        rateLimitedProfileRotations: 2,
      },
    },
    tools: {
      agentToAgent: { enabled: false, allow: [] },
    },
    commands: { ...COMMAND_POSTURE },
    secrets: {
      providers: {
        [PASS_PROVIDER_ID]: {
          source: "exec",
          command: path.join(resolverDirectory, "openclaw-pass-resolver"),
          passEnv: [
            "PATH",
            "HOME",
            "GNUPGHOME",
            "GPG_TTY",
            "PASSWORD_STORE_DIR",
          ],
          jsonOnly: true,
          trustedDirs: [resolverDirectory],
        },
      },
    },
    plugins: {
      enabled: true,
      allow: [...PLUGIN_ALLOWLIST],
      deny: [],
      load: { paths: [] },
      entries: Object.fromEntries(
        PLUGIN_ALLOWLIST.map((pluginId) => [pluginId, { enabled: true }]),
      ),
      bundledDiscovery: "allowlist",
      slots: { memory: "none" },
    },
    bindings: AGENT_IDS.map((agentId) => ({
      agentId,
      match: {
        channel: "discord",
        accountId: agentId,
        guildId: ids.discordGuildId,
      },
    })),
    channels: {
      discord: {
        enabled: true,
        defaultAccount: "main",
        dmPolicy: "disabled",
        dm: { enabled: false, groupEnabled: false },
        groupPolicy: "allowlist",
        allowBots: false,
        contextVisibility: "allowlist",
        thread: { inheritParent: false },
        commands: { native: false, nativeSkills: false },
        guilds: {
          [ids.discordGuildId]: channelAccess,
        },
        accounts: Object.fromEntries(
          AGENT_IDS.map((agentId) => [
            agentId,
            { enabled: true, token: SECRET_REFS.discord[agentId] },
          ]),
        ),
        streaming: { mode: "off" },
      },
    },
    session: {
      threadBindings: { enabled: false },
      maintenance: {
        mode: "enforce",
        pruneAfter: "30d",
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
    targets: GOOGLE_PROFILE_IDS.map((profileId, index) => {
      const agentId = AGENT_IDS[Math.floor(index / 3)];
      return {
        type: "auth-profiles.api_key.key",
        path: `profiles.${profileId}.key`,
        pathSegments: ["profiles", profileId, "key"],
        agentId,
        authProfileProvider: "google",
        ref: SECRET_REFS.gemini[index],
      };
    }),
  };
}

export function buildAuthOrderPlan() {
  return {
    version: 1,
    provider: "google",
    agents: Object.fromEntries(
      AGENT_IDS.map((agentId) => [
        agentId,
        [...AGENT_GOOGLE_PROFILES[agentId]],
      ]),
    ),
  };
}

export function renderSystemdDropIn(stateDir) {
  const passStore = path.join(stateDir, "secrets", "password-store");
  const gpgHome = path.join(stateDir, "secrets", "gnupg");
  const userBin = path.join(path.dirname(stateDir), ".local", "bin");
  const nodeBinary = path.join(userBin, "node");
  const hotfix = path.join(
    stateDir,
    "bin",
    "openclaw-gemini-stream-hotfix.mjs",
  );
  return `[Service]\nEnvironment=OPENCLAW_PROFILE=${PROFILE}\nEnvironment=OPENCLAW_STATE_DIR=${stateDir}\nEnvironment=PASSWORD_STORE_DIR=${passStore}\nEnvironment=GNUPGHOME=${gpgHome}\nEnvironment=PATH=${userBin}:/usr/local/bin:/usr/bin:/bin\nExecStartPre=${nodeBinary} ${hotfix} --check\nMemoryMax=768M\n`;
}

export function renderLegacySystemdDropInR16(stateDir) {
  const passStore = path.join(stateDir, "secrets", "password-store");
  const gpgHome = path.join(stateDir, "secrets", "gnupg");
  const userBin = path.join(path.dirname(stateDir), ".local", "bin");
  return `[Service]\nEnvironment=OPENCLAW_PROFILE=${PROFILE}\nEnvironment=OPENCLAW_STATE_DIR=${stateDir}\nEnvironment=PASSWORD_STORE_DIR=${passStore}\nEnvironment=GNUPGHOME=${gpgHome}\nEnvironment=PATH=${userBin}:/usr/local/bin:/usr/bin:/bin\nMemoryMax=768M\n`;
}

export function geminiStreamHotfixContents() {
  const template = readFileSync(GEMINI_STREAM_HOTFIX_TEMPLATE, "utf8");
  if (/__ZINK_[A-Z0-9_]+__/u.test(template)) {
    throw new Error("Gemini stream hotfix template hash is not materialized");
  }
  return template;
}

export function passResolverContents() {
  const template = readFileSync(PASS_RESOLVER_TEMPLATE, "utf8");
  const marker = "__ZINK_ALLOWED_IDS__";
  if (template.split(marker).length !== 2) {
    throw new Error("Password-store resolver template marker drift detected");
  }
  return template.replace(
    marker,
    JSON.stringify(
      [
        ...PASS_ENTRY_IDS.gemini,
        ...Object.values(PASS_ENTRY_IDS.discord),
        PASS_ENTRY_IDS.gateway,
      ],
      null,
      2,
    ),
  );
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

function validateRuntimeMetadata(meta) {
  if (meta === undefined) return;
  if (
    meta === null ||
    typeof meta !== "object" ||
    Array.isArray(meta) ||
    !equal(Object.keys(meta), ["lastTouchedVersion", "lastTouchedAt"]) ||
    meta.lastTouchedVersion !== OPENCLAW_RELEASE ||
    typeof meta.lastTouchedAt !== "string" ||
    !Number.isFinite(Date.parse(meta.lastTouchedAt))
  ) {
    throw new Error("OpenClaw runtime metadata drift detected");
  }
}

export function validateConfig(config, { stateDir, identifiers }) {
  const expected = buildConfig({ stateDir, identifiers });
  validateRuntimeMetadata(config.meta);
  assertEqual(config.update, expected.update, "update");
  assertEqual(config.gateway, expected.gateway, "gateway");
  assertEqual(config.agents, expected.agents, "agents");
  assertEqual(config.auth, expected.auth, "auth");
  assertEqual(config.tools, expected.tools, "tools");
  assertEqual(config.commands, expected.commands, "commands");
  assertEqual(config.secrets, expected.secrets, "secrets");
  assertEqual(config.plugins, expected.plugins, "plugins");
  assertEqual(config.bindings, expected.bindings, "bindings");
  assertEqual(config.channels, expected.channels, "channels");
  assertEqual(config.session, expected.session, "session");
  const unexpected = Object.keys(config).filter(
    (key) => key !== "meta" && !Object.hasOwn(expected, key),
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

export function writePrivateRegularFile(filePath, contents, fileMode = 0o600) {
  assertRegularOrMissing(filePath);
  writeFileSync(filePath, contents, { encoding: "utf8", mode: fileMode });
  chmodSync(filePath, fileMode);
}

export function assertWorkspaceMatchesTemplate(workspacePath) {
  assertDirectoryOrMissing(workspacePath);
  if (!existsSync(workspacePath)) {
    return false;
  }
  const entries = readdirSync(workspacePath).sort();
  assertEqual(entries, TEMPLATE_FILES, "agent workspace template");
  const marker = path.join(workspacePath, ".gitkeep");
  assertRegularOrMissing(marker);
  if (readFileSync(marker, "utf8") !== "") {
    throw new Error("Agent workspace template marker must remain empty");
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
