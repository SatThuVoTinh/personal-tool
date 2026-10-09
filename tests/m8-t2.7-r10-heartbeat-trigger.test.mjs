// M8/T2.2-R10 — G1 contract correction using the host-authoritative trigger.
//
// R9 proved two things. First, the native patch injects only agentId, sessionKey,
// runId, inputProvenance, channelId, senderId and currentMessageId, so the R7
// content-based predicate could never observe the sentinel and was inert in
// production. Second, `mentions` and any bot-author field do not exist at the
// native admission anchor at all.
//
// R10 therefore makes G1 observable from data the host already provides there:
// `trigger`, which the host assigns itself, and `transcriptPrompt`, the canonical
// host heartbeat representation. The "no mentions / not bot-author" condition is
// retired, NOT replaced by an `undefined` check.
//
// These tests drive the SAME injection contract production uses. The field list
// is read out of native-patch.mjs itself, so if the patch stops supplying a
// required discriminator these tests fail instead of quietly passing.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { enterNativeRun } from "../integrations/openclaw/topology/lib/native-boundary.mjs";
import {
  AGENT_IDS,
  agentInstructions,
  governancePluginFiles,
} from "../integrations/openclaw/lib/policy.mjs";
import {
  ledgerPaths,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";

const REPO = process.cwd();
const PATCHER = path.join(
  REPO,
  "integrations",
  "openclaw",
  "topology",
  "lib",
  "native-patch.mjs",
);
const SENTINEL = "[OpenClaw heartbeat poll]";
const OWNER = "123456789012345678";

/**
 * The exact field names the pinned native patch passes into enterNativeRun,
 * read out of the patcher source rather than hand-copied. If the injection
 * contract changes, every production-shaped test below changes with it.
 */
const injectedFields = () => {
  const source = readFileSync(PATCHER, "utf8");
  const at = source.indexOf("await enterNativeRun(params.config");
  assert.notEqual(at, -1, "the native patch must still inject enterNativeRun");
  const raw = source.slice(at, source.indexOf("}, params.abortSignal)", at));
  // The patch body is a template literal whose indentation is written as \t
  // escape sequences, so neutralise them before reading property names.
  const block = raw.replaceAll("\\t", " ");
  return [...block.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:/gu)].map(
    (m) => m[1],
  );
};

/**
 * Build a context shaped exactly like the production injection: only the fields
 * the patch actually supplies, populated the way runEmbeddedAttempt populates
 * them for a heartbeat.
 */
const productionContext = (overrides = {}) => {
  const fields = injectedFields();
  const values = {
    agentId: "main",
    sessionKey: "agent:main:main",
    runId: "r10-run",
    inputProvenance: undefined,
    channelId: undefined,
    senderId: undefined,
    currentMessageId: undefined,
    trigger: "heartbeat",
    transcriptPrompt: SENTINEL,
  };
  const context = {};
  for (const field of fields) context[field] = values[field];
  return { ...context, ...overrides };
};

const nativeConfig = (scope) => ({
  plugins: {
    entries: {
      "zink-governance": { enabled: true, config: { ledgerRoot: scope } },
    },
  },
});

async function withPlugin(body) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r10-"));
  const paths = ledgerPaths(root);
  readSnapshot(paths);
  const extension = path.join(root, "extensions", "zink-governance");
  const generated = governancePluginFiles();
  for (const [rel, contents] of Object.entries({
    ...generated.assets,
    "index.mjs": generated.entrypoint,
    "package.json": generated.package,
  })) {
    const target = path.join(extension, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  for (const agentId of AGENT_IDS) {
    const dir = path.join(root, "workspaces", agentId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "AGENTS.md"), agentInstructions(agentId));
  }
  writeFileSync(paths.identityKey, `${"1".repeat(64)}\n`);
  const hooks = new Map();
  const logged = [];
  const plugin = (
    await import(pathToFileURL(path.join(extension, "index.mjs")).href)
  ).default;
  const dispose = plugin.register({
    pluginConfig: { ledgerRoot: paths.root, ownerDiscordId: OWNER },
    on: (name, fn) => hooks.set(name, fn),
    logger: { error: (m) => logged.push(String(m)) },
  });
  try {
    return await body({
      paths,
      hooks,
      logged,
      native: nativeConfig(paths.root),
    });
  } finally {
    if (typeof dispose === "function") dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The injection contract itself
// ---------------------------------------------------------------------------

test("R10: the native patch supplies every field the G1 predicate needs", () => {
  const fields = injectedFields();
  for (const required of [
    "agentId",
    "sessionKey",
    "runId",
    "trigger",
    "transcriptPrompt",
  ]) {
    assert.ok(
      fields.includes(required),
      `native patch must inject ${required}`,
    );
  }
  // And it must NOT have grown Discord-layer or whole-object fields.
  for (const forbidden of [
    "mentions",
    "isBot",
    "message",
    "events",
    "payloads",
    "request",
  ]) {
    assert.equal(
      fields.includes(forbidden),
      false,
      `native patch must not inject ${forbidden}`,
    );
  }
});

test("R10: a production-shaped heartbeat is admitted and fabricates no ledger task", async () => {
  await withPlugin(async ({ paths, native }) => {
    const before = readSnapshot(paths);
    await enterNativeRun(native, productionContext());
    const after = readSnapshot(paths);
    assert.equal(after.sequence, before.sequence);
    assert.equal(Object.keys(after.tasks).length, 0);
  });
});

test("R10: a self-keyed run without the host heartbeat trigger is not exempt", async () => {
  await withPlugin(async ({ native }) => {
    await assert.rejects(
      enterNativeRun(native, productionContext({ trigger: "user" })),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R10: a user message carrying the sentinel is not exempt", async () => {
  await withPlugin(async ({ native }) => {
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({ trigger: "user", senderId: OWNER }),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R10: Discord ingress is not exempt even with heartbeat trigger and sentinel", async () => {
  await withPlugin(async ({ native }) => {
    await assert.rejects(
      enterNativeRun(native, productionContext({ channelId: "discord" })),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({ sessionKey: "agent:main:main:discord:1" }),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R10: an inter-session continuation with a heartbeat payload is not exempt", async () => {
  await withPlugin(async ({ native }) => {
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({
          inputProvenance: {
            kind: "inter_session",
            sourceTool: "subagent_announce",
            sourceSessionKey: "agent:o1:o1",
          },
        }),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R10: a missing or alternative trigger is not exempt", async () => {
  await withPlugin(async ({ native }) => {
    for (const trigger of [
      undefined,
      null,
      "",
      "cron",
      "manual",
      "HEARTBEAT",
      "Heartbeat",
    ]) {
      await assert.rejects(
        enterNativeRun(native, productionContext({ trigger })),
        /GOVERNANCE_RUN_UNAVAILABLE/u,
        `trigger=${String(trigger)} must not qualify`,
      );
    }
  });
});

test("R10: a non-self-keyed session is not exempt even with the full trigger set", async () => {
  await withPlugin(async ({ native }) => {
    for (const sessionKey of [
      "agent:main:other",
      "main-session",
      "agent:o1:o1",
    ]) {
      await assert.rejects(
        enterNativeRun(native, productionContext({ sessionKey })),
        /GOVERNANCE_RUN_UNAVAILABLE/u,
        `sessionKey=${sessionKey} must not qualify`,
      );
    }
  });
});

test("R10: the sentinel in the host representation is required", async () => {
  await withPlugin(async ({ native }) => {
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({ transcriptPrompt: "please do the ETL" }),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({ transcriptPrompt: undefined }),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

// ---------------------------------------------------------------------------
// Falsification: each condition must be independently load-bearing.
// ---------------------------------------------------------------------------

test("R10 F: the sentinel alone does not qualify", async () => {
  await withPlugin(async ({ native }) => {
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({ trigger: undefined, transcriptPrompt: SENTINEL }),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R10 F: the trigger alone does not qualify", async () => {
  await withPlugin(async ({ native }) => {
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({ transcriptPrompt: "unrelated body" }),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R10 F: a valid governed run is unaffected and still creates its task", async () => {
  await withPlugin(async ({ paths, native, hooks }) => {
    const governed = {
      channelId: "discord",
      agentId: "main",
      senderId: OWNER,
      currentMessageId: "123456789012345901",
      content: "@main ordinary request",
      mentions: [{ username: "main" }],
      sessionKey: "main-session",
      runId: "discord-valid",
    };
    await enterNativeRun(native, governed);
    const snapshot = readSnapshot(paths);
    const task_id = Object.keys(snapshot.tasks)[0];
    assert.ok(
      task_id,
      "a valid owner Discord ingress must create exactly one task",
    );
    const receipt = await hooks.get("before_prompt_build")({}, governed);
    assert.match(receipt.prependContext, new RegExp(task_id, "u"));
  });
});

test("R10 F: replaying the same Discord message id creates no duplicate task", async () => {
  await withPlugin(async ({ paths, native }) => {
    const governed = {
      channelId: "discord",
      agentId: "main",
      senderId: OWNER,
      currentMessageId: "123456789012345902",
      content: "@main ordinary request",
      mentions: [{ username: "main" }],
      sessionKey: "main-session",
      runId: "discord-replay",
    };
    await enterNativeRun(native, governed);
    // M10/T2-R9-C: a replay arrives under a DIFFERENT run. The same runId re-entering
    // its own admitted message is the host's model-fallback lane, which R9-C admits
    // so a hung primary can fail over; it still creates no second task either.
    await assert.rejects(
      enterNativeRun(native, { ...governed, runId: "discord-replay-2" }),
    );
    assert.equal(Object.keys(readSnapshot(paths).tasks).length, 1);
  });
});

test("R10 F: an exempt heartbeat gets no fabricated governance receipt", async () => {
  await withPlugin(async ({ paths, hooks }) => {
    const result = await hooks.get(
      "before_prompt_build",
      {},
      {
        agentId: "main",
        sessionKey: "agent:main:main",
        runId: "hb",
        trigger: "heartbeat",
        transcriptPrompt: SENTINEL,
      },
    );
    assert.equal(result?.prependContext, undefined);
    assert.equal(Object.keys(readSnapshot(paths).tasks).length, 0);
  });
});
