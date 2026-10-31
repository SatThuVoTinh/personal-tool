import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs, {
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
import { runInNewContext } from "node:vm";

import {
  AGENT_DEFINITIONS,
  ROUTER_PROVIDER_ID,
  ROUTER_PROVIDER_MODEL_IDS,
  AGENT_IDS,
  AGENT_MENTION_PATTERNS,
  DISCORD_SURFACE_IDENTIFIERS,
  MODEL_ALLOWLIST,
  OPENCLAW_RELEASE,
  PASS_ENTRY_IDS,
  PASS_PROVIDER_ID,
  PLUGIN_ALLOWLIST,
  SECRET_REFS,
  buildAuthOrderPlan,
  buildConfig,
  buildSecretsPlan,
  geminiStreamHotfixContents,
  passResolverContents,
  parseIdentifiers,
  renderSystemdDropIn,
  renderLegacySystemdDropInR16,
  validateConfig,
} from "../integrations/openclaw/lib/policy.mjs";
import {
  HOTFIX_BOOT_ACTION,
  OPENCLAW_HOTFIX_ARTIFACTS,
  OPENCLAW_HOTFIX_RELEASE,
  assertPatchedInvariants,
  classifyState,
  hotfixBootAction,
  patchContents,
  requireKnownHash,
  requireSupportedRelease,
  revertContents,
  sha256,
  writeTransaction,
} from "../integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs";
import { isExpectedDiscordCapability } from "../integrations/openclaw/verify.mjs";
import {
  ROUTER_TEST_HOST,
  ROUTER_TEST_PORT,
  applyRouterTestEnv,
} from "./helpers/router-env.mjs";
// M12/T9 F-111: the builder's apply is reachable ONLY through the apply
// orchestration, which takes the transaction snapshot first and hands the
// builder its attempt id. A lane that drives the builder directly takes the
// same transaction and passes the same id; the helper is the operator driver's
// own two-step (snapshot, then persist), so the record the builder reads is the
// production one.
import { takeApplyTransaction } from "./helpers/apply-transaction.mjs";

// M10/T2-R9: the governed model provider resolves its endpoint and
// credential from the environment at build time; supply non-routable
// placeholders so this suite can assert config SHAPE only.
applyRouterTestEnv();

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
    HOME: root,
    USERPROFILE: root,
  };
}

const ORIGINAL_HOTFIX_FIXTURES = Object.freeze({
  transport: `\t\twhile (true) {
\t\t\tif (signal?.aborted) throw new Error("Request was aborted");
\t\t\tconst { done, value } = await reader.read();
\t\t\tif (done) {
\t\t\t\tcompleted = true;
\t\t\t\tbreak;
\t\t\t}
\t\t\tbuffer += decoder.decode(value, { stream: true }).replace(/\\r/g, "");
\t\t}
\t\t\t\tlet currentBlockIndex = -1;
\t\t\t\tconst toolCallBlocksById = /* @__PURE__ */ new Map();
\t\t\t\t\tif (typeof candidate?.finishReason === "string") {
\t\t\t\t\t\toutput.stopReason = mapStopReasonString(candidate.finishReason);
\t\t\t\t\t}
\t\t\t\tif (currentBlockIndex >= 0) pushTextBlockEnd(stream, output, currentBlockIndex);
\t\t\t\tfinalizeTransportStream({`,
  "error-classification": `const ERROR_PATTERNS = {
\tserverError: [
\t\t"an error occurred while processing",
\t\t"internal server error"
\t]
};
ERROR_PATTERNS;`,
  payloads: `\tconst reasoningText = suppressAssistantArtifacts || runAborted ? "" : assistantForPayload && params.reasoningLevel === "on" && params.thinkingLevel !== "off" ? extractAssistantThinking(assistantForPayload) : "";
\tconst answerTexts = suppressAssistantArtifacts || runAborted ? [] : (shouldUseCanonicalFinalAnswer ? [fallbackAnswerSourceText] : shouldPreferRawAnswerText && fallbackRawAnswerText ? [fallbackRawAnswerText] : hasAssistantTextPayload ? nonEmptyAssistantTexts : fallbackAnswerText ? [fallbackAnswerText] : []).filter((text) => !shouldSuppressRawErrorText(text));`,
  "embedded-runner": `\t\t\t\t\tconst finalAssistantVisibleText = resolveFinalAssistantVisibleText(sessionLastAssistant);
\t\t\t\t\tconst finalAssistantRawText = resolveFinalAssistantRawText(sessionLastAssistant);
\t\t\t\t\tconst payloads = [];
\t\t\t\t\tconst timedOutDuringPrompt = timedOut && !timedOutDuringCompaction && !timedOutDuringToolExecution;
\t\t\t\t\tconst finalAssistantStopReason = (sessionLastAssistant?.stopReason ?? "").trim().toLowerCase();`,
});

test("M7/T1 Gemini stream backport is exact, reversible, and fail closed", () => {
  assert.equal(OPENCLAW_HOTFIX_RELEASE, OPENCLAW_RELEASE);
  assert.deepEqual(
    OPENCLAW_HOTFIX_ARTIFACTS.map(({ id, fileName }) => ({ id, fileName })),
    [
      { id: "transport", fileName: "transport-stream-Cs5gt3Yy.js" },
      {
        id: "error-classification",
        fileName: "sanitize-user-facing-text-DCd-Uriq.js",
      },
      { id: "payloads", fileName: "payloads-CpuaeKbz.js" },
      { id: "embedded-runner", fileName: "embedded-agent-CGzgLLU-.js" },
    ],
  );
  for (const artifact of OPENCLAW_HOTFIX_ARTIFACTS) {
    assert.match(artifact.originalSha256, /^[a-f0-9]{64}$/u);
    assert.match(artifact.patchedSha256, /^[a-f0-9]{64}$/u);
    assert.notEqual(artifact.originalSha256, artifact.patchedSha256);
    const original = ORIGINAL_HOTFIX_FIXTURES[artifact.id];
    const patched = patchContents(artifact.id, original);
    assertPatchedInvariants(artifact.id, patched);
    assert.equal(revertContents(artifact.id, patched), original);
  }
  requireSupportedRelease(OPENCLAW_RELEASE);
  assert.throws(
    () => requireSupportedRelease("2026.6.35"),
    /Unsupported OpenClaw version/u,
  );
  assert.throws(
    () => requireKnownHash("unknown", "unknown artifact"),
    /Unknown OpenClaw hotfix artifact/u,
  );
  assert.throws(
    () => requireKnownHash("transport", "unknown artifact"),
    /hash is not allowlisted/u,
  );

  const patched = patchContents(
    "transport",
    ORIGINAL_HOTFIX_FIXTURES.transport,
  );
  assert.match(patched, /Google SSE stream ended with an incomplete frame/u);
  assert.match(
    patched,
    /candidate\.finishReason !== "FINISH_REASON_UNSPECIFIED"/u,
  );
  assert.match(patched, /Google stream ended before a terminal finish reason/u);
  assert.match(patched, /code: "STREAM_INCOMPLETE"/u);
  assert.match(patched, /type: "google_incomplete_stream"/u);
  const trailingStatement = patched
    .split("\n")
    .find((line) => line.includes('if (buffer.split("\\n")'))
    ?.trim();
  assert.ok(trailingStatement);
  assert.doesNotThrow(() => runInNewContext(trailingStatement, { buffer: "" }));
  assert.throws(
    () =>
      runInNewContext(trailingStatement, {
        buffer: 'data: {"candidates":[{"content":"partial"}',
      }),
    /incomplete frame/u,
  );
  const terminalStart = patched.indexOf(
    "if (!sawTerminalReason && !options?.signal?.aborted)",
  );
  const terminalEnd = patched.indexOf(
    "\n\t\t\t\tfinalizeTransportStream({",
    terminalStart,
  );
  assert.notEqual(terminalStart, -1);
  assert.notEqual(terminalEnd, -1);
  const terminalStatement = patched.slice(terminalStart, terminalEnd);
  assert.doesNotThrow(() =>
    runInNewContext(terminalStatement, {
      sawTerminalReason: true,
      options: { signal: { aborted: false } },
    }),
  );
  assert.throws(
    () =>
      runInNewContext(terminalStatement, {
        sawTerminalReason: false,
        options: { signal: { aborted: false } },
      }),
    (error) =>
      error.code === "STREAM_INCOMPLETE" &&
      error.type === "google_incomplete_stream",
  );
  assert.doesNotThrow(() =>
    runInNewContext(terminalStatement, {
      sawTerminalReason: false,
      options: { signal: { aborted: true } },
    }),
  );
  assert.equal(
    revertContents("transport", patched),
    ORIGINAL_HOTFIX_FIXTURES.transport,
  );
  assert.throws(
    () =>
      patchContents(
        "transport",
        ORIGINAL_HOTFIX_FIXTURES.transport.replace(
          "reader.read()",
          "reader.next()",
        ),
      ),
    /source shape mismatch/u,
  );
});

test("M7/T1 classifies incomplete terminal streams without widening generic stream errors", () => {
  const patched = patchContents(
    "error-classification",
    ORIGINAL_HOTFIX_FIXTURES["error-classification"],
  );
  const patterns = runInNewContext(patched).serverError;
  assert.equal(
    patterns.some(
      (pattern) =>
        typeof pattern?.test === "function" &&
        pattern.test("Google stream ended before a terminal finish reason"),
    ),
    true,
  );
  for (const unrelated of [
    "local stream ended before cleanup",
    "OpenRouter music generation stream ended before completion",
    "SSE stream ended before next event",
  ]) {
    assert.equal(
      patterns.some(
        (pattern) =>
          typeof pattern?.test === "function" && pattern.test(unrelated),
      ),
      false,
    );
  }
});

test("M7/T1 suppresses errored partial payloads and preserves successful replies", () => {
  const patched = patchContents("payloads", ORIGINAL_HOTFIX_FIXTURES.payloads);
  const [reasoningStatement, answerStatement] = patched.split("\n");
  const baseContext = {
    assistantForPayload: {},
    extractAssistantThinking: () => "partial hidden reasoning",
    fallbackAnswerSourceText: "complete answer",
    fallbackAnswerText: "fallback answer",
    fallbackRawAnswerText: "raw answer",
    hasAssistantTextPayload: true,
    nonEmptyAssistantTexts: ["partial answer"],
    params: { reasoningLevel: "on", thinkingLevel: "low" },
    runAborted: false,
    shouldPreferRawAnswerText: false,
    shouldSuppressRawErrorText: () => false,
    shouldUseCanonicalFinalAnswer: false,
    suppressAssistantArtifacts: false,
  };
  assert.equal(
    runInNewContext(`${reasoningStatement}\nreasoningText;`, {
      ...baseContext,
      lastAssistantNeedsErrorSurface: true,
    }),
    "",
  );
  assert.deepEqual(
    Array.from(
      runInNewContext(`${answerStatement}\nanswerTexts;`, {
        ...baseContext,
        lastAssistantNeedsErrorSurface: true,
      }),
    ),
    [],
  );
  assert.equal(
    runInNewContext(`${reasoningStatement}\nreasoningText;`, {
      ...baseContext,
      lastAssistantNeedsErrorSurface: false,
    }),
    "partial hidden reasoning",
  );
  assert.deepEqual(
    Array.from(
      runInNewContext(`${answerStatement}\nanswerTexts;`, {
        ...baseContext,
        lastAssistantNeedsErrorSurface: false,
      }),
    ),
    ["partial answer"],
  );
});

test("M7/T1 removes errored final-assistant evidence", () => {
  const patched = patchContents(
    "embedded-runner",
    ORIGINAL_HOTFIX_FIXTURES["embedded-runner"],
  );
  assert.equal(patched.match(/const finalAssistantStopReason/gu)?.length, 1);
  const projection = patched.slice(0, patched.indexOf("const payloads"));
  const evaluate = (stopReason) =>
    runInNewContext(
      `${projection}\n({ finalAssistantVisibleText, finalAssistantRawText });`,
      {
        resolveFinalAssistantRawText: () => "partial raw",
        resolveFinalAssistantVisibleText: () => "partial visible",
        sessionLastAssistant: { stopReason },
      },
    );
  for (const stopReason of ["error", "aborted"]) {
    const result = evaluate(stopReason);
    assert.equal(result.finalAssistantRawText, undefined);
    assert.equal(result.finalAssistantVisibleText, undefined);
  }
  const successful = evaluate("stop");
  assert.equal(successful.finalAssistantRawText, "partial raw");
  assert.equal(successful.finalAssistantVisibleText, "partial visible");
});

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
    // T1: main additionally holds session_status for read-only status
    // inspection. guard.mjs denies every mutating argument, including `model`,
    // for every agent. Specialists receive no session-control capability.
    const expectedTools = { profile: "minimal" };
    if (agent.id === "main") {
      expectedTools.alsoAllow = [
        "agents_list",
        "session_status",
        "sessions_spawn",
        "sessions_yield",
      ];
    } else if (["o1", "o2"].includes(agent.id)) {
      expectedTools.alsoAllow = ["sessions_spawn", "sessions_yield"];
    }
    assert.deepEqual(agent.tools, expectedTools);
    assert.deepEqual(agent.subagents.requireAgentId, true);
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
  test("R4 mention grammar: every agent carries its frozen mention pattern", () => {
    for (const agent of config.agents.list) {
      const patterns = AGENT_MENTION_PATTERNS[agent.id];
      assert.ok(
        Array.isArray(patterns) && patterns.length > 0,
        `${agent.id} must have frozen mention patterns`,
      );
      assert.deepEqual(agent.groupChat.mentionPatterns, patterns);
      for (const pattern of patterns) {
        assert.doesNotThrow(
          () => new RegExp(pattern, "u"),
          `${agent.id} pattern must compile`,
        );
      }
    }
    // R4 PATCH-E: stale pre-R4 display names must not wake coordinators.
    const o1Text = AGENT_MENTION_PATTERNS.o1.join("\n");
    const o2Text = AGENT_MENTION_PATTERNS.o2.join("\n");
    assert.equal(o1Text.includes("knowledge"), false);
    assert.equal(o2Text.includes("orchestrator"), false);
    assert.match(o1Text, /1545437953197744248/);
    assert.match(o2Text, /1545438251966402661/);
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
  assert.deepEqual(config.tools, {
    agentToAgent: { enabled: false, allow: [] },
    subagents: { tools: { alsoAllow: ["session_status"] } },
    sessions: { visibility: "tree" },
    sessions_spawn: { attachments: { enabled: false } },
  });
  assert.deepEqual(config.plugins, {
    enabled: true,
    allow: [...PLUGIN_ALLOWLIST, "zink-governance"],
    deny: [],
    load: { paths: [path.join(stateDir, "extensions", "zink-governance")] },
    slots: { memory: "none" },
    entries: {
      // M10/T2-R9: `google` is no longer in PLUGIN_ALLOWLIST. It existed only
      // to serve the retired provider, and keeping it enabled would keep a
      // second, unused model provider reachable.
      discord: { enabled: true },
      "zink-governance": {
        enabled: true,
        hooks: {
          allowConversationAccess: true,
        },
        config: {
          ledgerRoot: path.join(stateDir, "operator", "m7-t2", "ledger"),
          ownerDiscordId: identifiers.discordOwnerId,
          // Outbound Discord destinations come from the same validated
          // identifiers. Pinned here so the built config carries exactly these
          // four destinations — no more, no less, and never a literal.
          discordOfficeChannelId: identifiers.discordOfficeChannelId,
          discordResultsForumId: identifiers.discordResultsForumId,
          discordApprovalsForumId: identifiers.discordApprovalsForumId,
          discordIncidentsForumId: identifiers.discordIncidentsForumId,
        },
      },
    },
    bundledDiscovery: "allowlist",
  });
  // M10/T2-R9: the 21 google auth profiles, the per-agent auth order and the
  // profile cooldowns are retired. One router credential serves every agent and
  // the router rotates upstream itself, so an OpenClaw-side profile order would
  // be a second rotation policy that cannot take effect.
  assert.equal(Object.hasOwn(config, "auth"), false);
  const router = config.models.providers[ROUTER_PROVIDER_ID];
  assert.deepEqual(router, {
    baseUrl: `http://${ROUTER_TEST_HOST}:${ROUTER_TEST_PORT}/v1`,
    api: "openai-completions",
    auth: "api-key",
    apiKey: SECRET_REFS.router,
    // M10/T2-R13 (owner decision 2026-10-09): the per-attempt ceiling. Proven
    // live: without it one request waited 9,374,777 ms and the owner received
    // nothing. `timeoutSeconds` on the PROVIDER is the only layer the installed
    // schema admits — `requestTimeoutMs` fails validation at provider level and
    // at model-entry level alike (both verified `valid:false`).
    timeoutSeconds: 100,
    // OpenClaw requires an ARRAY here; an object shape is rejected by the
    // installed runtime's validator, so this shape is load-bearing, not cosmetic.
    //
    // M10/T2-R12 (owner decision 2026-10-08): the governed entries are direct
    // model ids, so NO entry carries an output budget. The old 64000 budget
    // existed for `execute` alone (reasoning=true, empty content at
    // finish=length) and `execute` is no longer governed. The four gemini ids
    // the router lists advertise no reasoning and their own
    // max_completion_tokens=65536.
    // NOTE: do NOT add requestTimeoutMs here — the entry schema is STRICT and
    // the gateway refuses to start (`Unrecognized key`, proven 2026-10-07).
    // The attempt ceiling lives on the PROVIDER entry as `timeoutSeconds`.
    models: ROUTER_PROVIDER_MODEL_IDS.map((modelId) => ({
      id: modelId,
      name: modelId,
    })),
  });
  // M10/T2-R13: the provider carries a per-attempt deadline. Proven live
  // 2026-10-09: without it one model request waited 9,374,777 ms (2h36m) and
  // the owner got nothing. The schema admits `timeoutSeconds` on the provider
  // and rejects `requestTimeoutMs` at BOTH the provider and entry level, so
  // this key name and this layer are both load-bearing.
  assert.equal(router.timeoutSeconds, 100);
  // The chain is the owner's exact order, addressed directly, with no combo.
  assert.deepEqual(ROUTER_PROVIDER_MODEL_IDS, [
    "gemini/gemini-3.8-flash",
    "gemini/gemini-3.7-flash",
    "muse-spark-1.3-contributor-free",
    "gemini/gemini-3.6-flash",
    "gemini/gemini-3.5-flash-lite",
  ]);
  for (const entry of router.models) {
    assert.equal(
      entry.params,
      undefined,
      `no governed entry may declare a budget: ${entry.id}`,
    );
  }
  assert.equal(
    config.models.providers[ROUTER_PROVIDER_ID].models.some(
      (m) => m.id === "execute",
    ),
    false,
    "the combo must not be a governed provider entry",
  );
  // The router owns rotation, so OpenClaw must not also carry a rotation order.
  assert.deepEqual(buildAuthOrderPlan(), {
    version: 1,
    provider: ROUTER_PROVIDER_ID,
    agents: {},
  });
  // No auth-profile key targets remain: the profiles are gone, so the secret
  // plan is empty by design rather than by omission.
  assert.deepEqual(buildSecretsPlan(), {
    version: 1,
    protocolVersion: 1,
    targets: [],
  });
  assert.deepEqual(config.secrets.providers[PASS_PROVIDER_ID], {
    source: "exec",
    command: path.join(stateDir, "bin", "openclaw-pass-resolver"),
    passEnv: ["PATH", "HOME", "GNUPGHOME", "GPG_TTY", "PASSWORD_STORE_DIR"],
    jsonOnly: true,
    trustedDirs: [path.join(stateDir, "bin")],
  });
  assert.equal(Object.hasOwn(config.channels.discord, "token"), false);
  assert.equal(config.channels.discord.defaultAccount, "main");
  assert.deepEqual(config.channels.discord.streaming, { mode: "off" });
  assert.deepEqual(Object.keys(config.channels.discord.accounts), AGENT_IDS);
  for (const agentId of AGENT_IDS) {
    assert.deepEqual(config.channels.discord.accounts[agentId], {
      enabled: true,
      token: SECRET_REFS.discord[agentId],
    });
    assert.equal(
      Object.hasOwn(config.channels.discord.accounts[agentId], "streaming"),
      false,
    );
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
  // M10/T2-R9: the auth-order and cooldown drift gates were repointed at the
  // router provider, which is the governed model configuration now. The intent
  // is unchanged — prove validateConfig rejects drift in a governed section.
  const routerEndpointDrift = buildConfig({ stateDir, identifiers });
  routerEndpointDrift.models.providers[ROUTER_PROVIDER_ID].baseUrl =
    "http://router.invalid:1/v2";
  assert.throws(
    () => validateConfig(routerEndpointDrift, { stateDir, identifiers }),
    /Policy drift at models/u,
  );
  const routerAdapterDrift = buildConfig({ stateDir, identifiers });
  routerAdapterDrift.models.providers[ROUTER_PROVIDER_ID].api =
    "openai-responses";
  assert.throws(
    () => validateConfig(routerAdapterDrift, { stateDir, identifiers }),
    /Policy drift at models/u,
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
  for (const mode of ["progress", "partial", "block"]) {
    const streamingDrift = buildConfig({ stateDir, identifiers });
    streamingDrift.channels.discord.streaming.mode = mode;
    assert.throws(
      () => validateConfig(streamingDrift, { stateDir, identifiers }),
      /Policy drift at channels/u,
    );
  }
  const accountStreamingDrift = buildConfig({ stateDir, identifiers });
  accountStreamingDrift.channels.discord.accounts.sql.streaming = {
    mode: "off",
  };
  assert.throws(
    () => validateConfig(accountStreamingDrift, { stateDir, identifiers }),
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

test("M7/T1 password-store resolver is a fail-closed 9-entry boundary", () => {
  const root = temporaryDirectory();
  try {
    const resolver = path.join(root, "openclaw-pass-resolver");
    const resolverSource = passResolverContents();
    // M10/T2-R9: the 21 GEMINI_API_KEY_NN ids are removed. The resolver is a
    // strict allowlist, so leaving them would keep 21 now-unreferenced pass ids
    // resolvable. What remains is 7 Discord bot tokens plus the gateway token.
    // M12/T9 F-036 (owner decision 2026-10-21, `H6`): the router credential
    // joins them, so the generated config carries a REFERENCE and the key can
    // be rotated without a re-apply of the whole tree.
    const allowedIds = [
      ...Object.values(PASS_ENTRY_IDS.discord),
      PASS_ENTRY_IDS.gateway,
      PASS_ENTRY_IDS.router,
    ];
    assert.equal(allowedIds.length, 9);
    assert.equal(new Set(allowedIds).size, 9);
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
        ids: [Object.values(PASS_ENTRY_IDS.discord)[0]],
      }),
    });
    assert.equal(boundedLookup.status, 0);
    const response = JSON.parse(boundedLookup.stdout);
    assert.deepEqual(Object.keys(response.values), []);
    assert.deepEqual(response.errors, {
      [Object.values(PASS_ENTRY_IDS.discord)[0]]: { code: "NOT_FOUND" },
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
        ids: Object.values(PASS_ENTRY_IDS.discord),
      }),
      timeout: 10_000,
    });
    assert.equal(parallelLookup.status, 0);
    assert.equal(parallelLookup.signal, null);
    const parallelResponse = JSON.parse(parallelLookup.stdout);
    assert.equal(Object.keys(parallelResponse.values).length, 7);
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
    const runtimeRoot = path.join(root, "runtime");
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
    execFileSync(
      process.execPath,
      [
        "--",
        ...baseArgs,
        "--apply",
        "--apply-transaction",
        takeApplyTransaction({
          stateDir,
          runtimeRoot,
          systemdRoot: systemdUserDir,
        }),
      ],
      {
        env: environment,
        stdio: "pipe",
      },
    );
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
    // M10/T2-R9: the apply materializes no auth-profile secret targets, because
    // the 21 google profiles are gone. The router credential is supplied through
    // the environment at apply time and is never a pass_store target, so this
    // assertion also pins that no profile key material reappears.
    assert.deepEqual(JSON.parse(authPlanText), {
      version: 1,
      protocolVersion: 1,
      targets: [],
    });
    assert.deepEqual(JSON.parse(authOrderPlanText), buildAuthOrderPlan());
    const resolverPath = path.join(stateDir, "bin", "openclaw-pass-resolver");
    assert.equal(existsSync(resolverPath), true);
    assert.match(readFileSync(resolverPath, "utf8"), /ALLOWED_IDS/u);
    const hotfixPath = path.join(
      stateDir,
      "bin",
      "openclaw-gemini-stream-hotfix.mjs",
    );
    assert.equal(existsSync(hotfixPath), true);
    assert.equal(
      readFileSync(hotfixPath, "utf8"),
      geminiStreamHotfixContents(),
    );
    const dropInPath = path.join(
      systemdUserDir,
      "openclaw-gateway-zink.service.d",
      "10-zink.conf",
    );
    assert.equal(
      readFileSync(dropInPath, "utf8"),
      renderSystemdDropIn(stateDir),
    );
    // M12/T9 F-179: the boot gate is `--ensure`, not `--check`. A `--check`
    // gate exits non-zero until an operator runs the hotfix by hand, and the
    // apply ceremony never establishes that state, so apply-then-start failed
    // the unit five times in 60 s and left the assistant down.
    assert.match(
      readFileSync(dropInPath, "utf8"),
      /ExecStartPre=.*openclaw-gemini-stream-hotfix\.mjs --ensure/u,
    );
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

// M12/T9 F-179: a freshly applied, unpatched profile must survive
// apply-then-start. The live systemd lane is NOT RUN here (it needs a WSL
// host and a real unit), so this pins the two decisions that lane depends on:
// the drop-in carries the establishing gate, and that gate repairs instead of
// failing the unit.
test("F-179: a fresh apply-then-start survives the hotfix boot gate", () => {
  const stateDir = path.join(temporaryDirectory(), ".openclaw-zink");
  const dropIn = renderSystemdDropIn(stateDir);
  assert.match(
    dropIn,
    /ExecStartPre=.*openclaw-gemini-stream-hotfix\.mjs --ensure/u,
    "the boot gate must establish the state it depends on",
  );
  assert.doesNotMatch(
    dropIn,
    /openclaw-gemini-stream-hotfix\.mjs --check/u,
    "a --check gate cannot pass on a profile the apply ceremony never patched",
  );

  assert.equal(
    hotfixBootAction({ state: "original" }),
    HOTFIX_BOOT_ACTION.REPAIR,
    "an unpatched but applicable runtime must be repaired, not refused",
  );
  assert.equal(
    hotfixBootAction({ state: "r18-predecessor" }),
    HOTFIX_BOOT_ACTION.REPAIR,
    "the R18 predecessor state must be upgraded, not refused",
  );
  assert.equal(
    hotfixBootAction({ state: "patched" }),
    HOTFIX_BOOT_ACTION.ALREADY_PATCHED,
  );
  assert.equal(
    hotfixBootAction({ state: "original", releaseSupported: false }),
    HOTFIX_BOOT_ACTION.NOT_APPLICABLE,
    "an openclaw package update must not deadlock the unit",
  );
  assert.throws(
    () => hotfixBootAction({ state: "half-written" }),
    /unsupported partial state/u,
    "a runtime that cannot be repaired still fails the boot",
  );
});

test("F-OC-008: writeTransaction failure after rename rolls back all modified artifacts to accepted state", () => {
  const root = temporaryDirectory();
  try {
    const records = OPENCLAW_HOTFIX_ARTIFACTS.map((baseSpec) => {
      const orig = ORIGINAL_HOTFIX_FIXTURES[baseSpec.id];
      const patched = patchContents(baseSpec.id, orig);
      const spec = {
        ...baseSpec,
        originalSha256: sha256(orig),
        patchedSha256: sha256(patched),
      };
      const filePath = path.join(root, spec.fileName);
      writeFileSync(filePath, orig, "utf8");
      return {
        spec,
        filePath,
        fileMode: 0o644,
        contents: orig,
      };
    });

    let writeCount = 0;
    const injectedWriter = (filePath, contents) => {
      writeCount += 1;
      writeFileSync(filePath, contents, "utf8");
      if (writeCount === 2) {
        const err = new Error("EIO: simulated directory fsync failure after rename");
        err.code = "EIO";
        throw err;
      }
    };

    assert.throws(
      () => writeTransaction(records, "patched", injectedWriter),
      /EIO: simulated directory fsync failure after rename/u,
      "writeTransaction must surface the fsync failure",
    );

    const currentRecords = records.map((r) => ({
      ...r,
      contents: readFileSync(r.filePath, "utf8"),
    }));
    const state = classifyState(currentRecords);
    assert.equal(
      state,
      "original",
      "failure after rename must roll back modified artifacts to original so classifyState accepts the state",
    );
    assert.equal(
      hotfixBootAction({ state }),
      HOTFIX_BOOT_ACTION.REPAIR,
      "gateway boot action on rolled-back state must be REPAIR, not fatal failure",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("M7/T1 builder upgrades only the exact R16 drop-in and rejects owned drift", () => {
  const root = temporaryDirectory();
  try {
    const environment = environmentForTemporaryHome(root);
    const stateDir = path.join(root, ".openclaw-zink");
    const systemdUserDir = path.join(root, ".config", "systemd", "user");
    const dropInPath = path.join(
      systemdUserDir,
      "openclaw-gateway-zink.service.d",
      "10-zink.conf",
    );
    const script = path.join(
      process.cwd(),
      "integrations",
      "openclaw",
      "configure.mjs",
    );
    const apply = () =>
      execFileSync(
        process.execPath,
        [
          "--",
          script,
          "--state-dir",
          stateDir,
          "--systemd-user-dir",
          systemdUserDir,
          ...discordIdentifierArguments,
          "--apply",
          // F-111: every apply carries the transaction the orchestration took.
          // A fresh one per call, because the builder marks the transaction it
          // is given as SPENT.
          "--apply-transaction",
          takeApplyTransaction({
            stateDir,
            runtimeRoot: path.join(root, "runtime"),
            systemdRoot: systemdUserDir,
          }),
        ],
        { env: environment, stdio: "pipe" },
      );

    mkdirSync(path.dirname(dropInPath), { recursive: true });
    writeFileSync(dropInPath, renderLegacySystemdDropInR16(stateDir), {
      encoding: "utf8",
      mode: 0o600,
    });
    apply();
    assert.equal(
      readFileSync(dropInPath, "utf8"),
      renderSystemdDropIn(stateDir),
    );

    const configPath = path.join(stateDir, "openclaw.json");
    const legacyConfig = JSON.parse(readFileSync(configPath, "utf8"));
    delete legacyConfig.channels.discord.streaming;
    const reorderedConfig = Object.fromEntries(
      Object.entries(legacyConfig).reverse(),
    );
    writeFileSync(
      configPath,
      `${JSON.stringify(reorderedConfig, null, 2)}\n`,
      "utf8",
    );
    assert.doesNotThrow(apply);
    assert.deepEqual(
      JSON.parse(readFileSync(configPath, "utf8")).channels.discord.streaming,
      { mode: "off" },
    );

    const streamingDrift = JSON.parse(readFileSync(configPath, "utf8"));
    streamingDrift.channels.discord.streaming.mode = "progress";
    writeFileSync(
      configPath,
      `${JSON.stringify(streamingDrift, null, 2)}\n`,
      "utf8",
    );
    assert.throws(apply, /Policy drift at channels/u);
    streamingDrift.channels.discord.streaming.mode = "off";
    writeFileSync(
      configPath,
      `${JSON.stringify(streamingDrift, null, 2)}\n`,
      "utf8",
    );

    const hotfixPath = path.join(
      stateDir,
      "bin",
      "openclaw-gemini-stream-hotfix.mjs",
    );
    writeFileSync(hotfixPath, "unapproved hotfix drift\n", "utf8");
    assert.throws(apply, /Gemini stream hotfix utility drift detected/u);
    assert.equal(readFileSync(hotfixPath, "utf8"), "unapproved hotfix drift\n");

    writeFileSync(hotfixPath, geminiStreamHotfixContents(), "utf8");
    writeFileSync(dropInPath, "unapproved systemd drift\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    assert.throws(apply, /Systemd drop-in drift detected/u);
    assert.equal(
      readFileSync(dropInPath, "utf8"),
      "unapproved systemd drift\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("M7/T1 builder converges a pre-R4 mention grammar and stays fail-closed otherwise", () => {
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
    const apply = () =>
      execFileSync(
        process.execPath,
        [
          "--",
          script,
          "--state-dir",
          stateDir,
          "--systemd-user-dir",
          systemdUserDir,
          ...discordIdentifierArguments,
          "--apply",
          // F-111: every apply carries the transaction the orchestration took.
          // A fresh one per call, because the builder marks the transaction it
          // is given as SPENT.
          "--apply-transaction",
          takeApplyTransaction({
            stateDir,
            runtimeRoot: path.join(root, "runtime"),
            systemdRoot: systemdUserDir,
          }),
        ],
        { env: environment, stdio: "pipe" },
      );

    const configPath = path.join(stateDir, "openclaw.json");
    apply();
    const canonical = JSON.parse(readFileSync(configPath, "utf8"));

    // M8/T2.2-R4 regenerated the mention grammar from AGENT_ALIASES and the
    // orchestrators' `alsoAllow` from the canonical tool policy. A config
    // written by a pre-R4 build differs in exactly those two fields: a
    // hand-transcribed, diacritic-tolerant pattern, and a `main` allowlist
    // that predates the `session_status` addition.
    const preR4 = JSON.parse(JSON.stringify(canonical));
    preR4.agents.list[0].groupChat.mentionPatterns = [
      "(?:^|\\s|<@(?:!|&)?|@)(?:l[eê]g[aá]cy[-_]alias)(?:>|$|\\s|[:;.,!?\\-—~])",
    ];
    preR4.agents.list[0].tools.alsoAllow = ["agents_list", "sessions_spawn"];
    writeFileSync(configPath, `${JSON.stringify(preR4, null, 2)}\n`, "utf8");

    assert.doesNotThrow(apply, "a pre-R4 mention grammar must converge");
    const converged = JSON.parse(readFileSync(configPath, "utf8"));
    assert.deepEqual(
      converged.agents.list[0].groupChat.mentionPatterns,
      canonical.agents.list[0].groupChat.mentionPatterns,
    );
    assert.deepEqual(
      converged.agents.list[0].tools.alsoAllow,
      canonical.agents.list[0].tools.alsoAllow,
    );
    // The specialists' `alsoAllow` is non-enumerable in the policy, so it is
    // absent from the stored config and must stay absent: convergence must not
    // materialise a key the canonical config does not have.
    assert.equal(
      Object.hasOwn(converged.agents.list[3].tools, "alsoAllow"),
      false,
    );
    assert.doesNotThrow(() =>
      validateConfig(converged, { stateDir, identifiers }),
    );

    // Convergence is FIELD-SCOPED. The same mention drift carried alongside an
    // unrelated difference must still fail closed, otherwise the migration
    // would launder arbitrary config edits into an accepted config.
    const mixed = JSON.parse(JSON.stringify(preR4));
    mixed.agents.list[0].sandbox.docker.network = "bridge";
    writeFileSync(configPath, `${JSON.stringify(mixed, null, 2)}\n`, "utf8");
    assert.throws(apply, /Policy drift at agents/u);

    // A roster change is not a version-evolved field either.
    const roster = JSON.parse(JSON.stringify(canonical));
    roster.agents.list.pop();
    writeFileSync(configPath, `${JSON.stringify(roster, null, 2)}\n`, "utf8");
    assert.throws(apply, /Policy drift at agents/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("M7/T1 builder recognizes the superseded WSL plugin build and still refuses unknown assets", () => {
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
    const apply = () =>
      execFileSync(
        process.execPath,
        [
          "--",
          script,
          "--state-dir",
          stateDir,
          "--systemd-user-dir",
          systemdUserDir,
          ...discordIdentifierArguments,
          "--apply",
          // F-111: every apply carries the transaction the orchestration took.
          // A fresh one per call, because the builder marks the transaction it
          // is given as SPENT.
          "--apply-transaction",
          takeApplyTransaction({
            stateDir,
            runtimeRoot: path.join(root, "runtime"),
            systemdRoot: systemdUserDir,
          }),
        ],
        { env: environment, stdio: "pipe" },
      );

    const entryPath = path.join(
      stateDir,
      "extensions",
      "zink-governance",
      "index.mjs",
    );
    const assetPath = path.join(
      stateDir,
      "extensions",
      "zink-governance",
      "lib",
      "canonical.mjs",
    );

    apply();
    const canonicalEntry = readFileSync(entryPath, "utf8");
    const canonicalAsset = readFileSync(assetPath, "utf8");

    // A file the allowlist does not list is refused, and refused WITHOUT being
    // overwritten: listing a prior build must not weaken the guard.
    writeFileSync(assetPath, "unrecognized plugin asset\n", "utf8");
    assert.throws(apply, /Governance plugin asset drift detected/u);
    assert.equal(
      readFileSync(assetPath, "utf8"),
      "unrecognized plugin asset\n",
    );

    // Restore, then confirm the builder is idempotent on its own output.
    writeFileSync(assetPath, canonicalAsset, "utf8");
    assert.doesNotThrow(apply);
    assert.equal(readFileSync(assetPath, "utf8"), canonicalAsset);
    assert.equal(readFileSync(entryPath, "utf8"), canonicalEntry);
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
    const applyArgs = () => [
      script,
      "--apply",
      "--state-dir",
      stateDir,
      "--systemd-user-dir",
      systemdUserDir,
      ...discordIdentifierArguments,
      // F-111: a fresh transaction per invocation. The builder marks the
      // transaction it is given as SPENT, so a second invocation must not
      // reuse the first one - and the refusal this case proves must be the
      // DRIFT refusal, not the spent-transaction refusal.
      "--apply-transaction",
      takeApplyTransaction({
        stateDir,
        runtimeRoot: path.join(root, "runtime"),
        systemdRoot: systemdUserDir,
      }),
    ];
    execFileSync(process.execPath, ["--", ...applyArgs()], {
      env: environment,
      stdio: "pipe",
    });
    const unexpected = path.join(stateDir, "workspaces", "main", "drift.txt");
    writeFileSync(unexpected, "owner content\n", "utf8");
    const result = spawnSync(process.execPath, ["--", ...applyArgs()], {
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
        // F-111: the apply carries the transaction the orchestration took.
        "--apply-transaction",
        takeApplyTransaction({
          stateDir,
          runtimeRoot: path.join(root, "runtime"),
          systemdRoot: systemdUserDir,
        }),
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
        // F-111: the apply carries the transaction the orchestration took.
        "--apply-transaction",
        takeApplyTransaction({
          stateDir,
          runtimeRoot: path.join(root, "runtime"),
          systemdRoot: systemdUserDir,
        }),
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
    const applyArgs = () => [
      script,
      "--apply",
      "--state-dir",
      stateDir,
      "--systemd-user-dir",
      systemdUserDir,
      ...discordIdentifierArguments,
      // F-111: a fresh transaction per invocation, so the refusal this case
      // proves is the DRIFT refusal and not the spent-transaction refusal.
      "--apply-transaction",
      takeApplyTransaction({
        stateDir,
        runtimeRoot: path.join(root, "runtime"),
        systemdRoot: systemdUserDir,
      }),
    ];
    execFileSync(process.execPath, ["--", ...applyArgs()], {
      env: environment,
      stdio: "pipe",
    });
    const planPath = path.join(stateDir, "zink-auth-secret-plan.json");
    writeFileSync(planPath, "not the owner plan\n", "utf8");
    const result = spawnSync(process.execPath, ["--", ...applyArgs()], {
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
    const applyArgs = () => [
      script,
      "--apply",
      "--state-dir",
      stateDir,
      "--systemd-user-dir",
      systemdUserDir,
      ...discordIdentifierArguments,
      // F-111: a fresh transaction per invocation, so the refusal this case
      // proves is the DRIFT refusal and not the spent-transaction refusal.
      "--apply-transaction",
      takeApplyTransaction({
        stateDir,
        runtimeRoot: path.join(root, "runtime"),
        systemdRoot: systemdUserDir,
      }),
    ];
    execFileSync(process.execPath, ["--", ...applyArgs()], {
      env: environment,
      stdio: "pipe",
    });
    const orderPlanPath = path.join(stateDir, "zink-auth-order-plan.json");
    writeFileSync(orderPlanPath, "not the owner order plan\n", "utf8");
    const result = spawnSync(process.execPath, ["--", ...applyArgs()], {
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
