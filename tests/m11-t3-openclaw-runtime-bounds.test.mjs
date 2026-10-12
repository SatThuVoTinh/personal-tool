// M11/T3-R1 phase 1 — OpenClaw gateway runtime bounds (ACTIVE.md §3, items A1-A4).
//
// A3 and A4 are behavioral: they drive the real seams with temp-directory
// fixtures and no live runtime. A1 and A2 assert an invariant over the plugin
// source, because both live inside the `register(api)` closure, which exposes
// nothing to a caller: reaching them would mean decomposing `register()`, and
// that refactor is explicitly excluded from this task's scope. The invariant
// scan is therefore written to generalize — it covers EVERY `await fetch(` in
// the file, so a future unbounded outbound call fails this test too.
import assert from "node:assert/strict";
import test from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { QueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";
import {
  registerNativeGuard,
  finishNativeRun,
  gateNativeAnnounce,
  sanitizeNativePrompt,
} from "../integrations/openclaw/topology/lib/native-boundary.mjs";

const PLUGIN_PATH = path.join(
  import.meta.dirname,
  "..",
  "integrations",
  "openclaw",
  "plugins",
  "zink-governance",
  "index.mjs",
);

function pluginSource() {
  return readFileSync(PLUGIN_PATH, "utf8");
}

/**
 * Return the balanced-parenthesis argument text of every call whose source
 * starts at `needle`, scanning the whole file.
 */
function callArguments(source, needle) {
  const found = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(needle, from);
    if (at === -1) return found;
    const open = at + needle.length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          found.push(source.slice(open, i + 1));
          break;
        }
      }
    }
    from = open + 1;
  }
}

/** Return the balanced-brace body of the first function named `signature`. */
function functionBody(source, signature) {
  const at = source.indexOf(signature);
  assert.notEqual(at, -1, `${signature} no longer exists`);
  const open = source.indexOf("{", at + signature.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  assert.fail(`${signature} has no balanced body`);
}

function tempRoot(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------- A1

test("M11-T3 A1: the bot-token resolver runs by argv, never through a shell", () => {
  const source = pluginSource();
  // execSync interprets its first argument with /bin/sh -c. The resolver path is
  // joined from a config-derived stateDir that legitimately contains spaces on
  // this host, so a shell there is both broken and an injection surface.
  assert.equal(
    source.includes(`import { execSync } from "node:child_process";`),
    false,
    "the plugin still imports the shell-interpreting execSync",
  );
  assert.equal(
    source.includes(`import { execFileSync } from "node:child_process";`),
    true,
    "the plugin does not import execFileSync",
  );
  const body = functionBody(source, "function resolveDiscordBotToken(");
  assert.equal(body.includes("execFileSync("), true);
  assert.equal(
    body.includes("execSync("),
    false,
    "the token path still executes a path through a shell",
  );
});

// ---------------------------------------------------------------- A2

test("M11-T3 A2: every outbound fetch declares one deadline constant", () => {
  const source = pluginSource();
  assert.equal(
    source.includes("export const DISCORD_REST_DEADLINE_MS = 10_000;"),
    true,
    "DISCORD_REST_DEADLINE_MS is not defined as an exported constant",
  );
  const sites = callArguments(source, "await fetch(");
  assert.ok(
    sites.length >= 3,
    `expected at least the three known Discord REST sites, found ${sites.length}`,
  );
  for (const [index, args] of sites.entries()) {
    assert.equal(
      args.includes("signal: AbortSignal.timeout(DISCORD_REST_DEADLINE_MS)"),
      true,
      `fetch site ${index + 1} has no deadline bound`,
    );
  }
});

// ---------------------------------------------------------------- A3

function guardedConfig(scope) {
  return {
    plugins: {
      entries: {
        "zink-governance": {
          enabled: true,
          config: { ledgerRoot: scope },
        },
      },
    },
  };
}

async function captureConsoleError(run) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    await run();
    return { error: undefined, lines };
  } catch (error) {
    return { error, lines };
  } finally {
    console.error = original;
  }
}

/**
 * `registerNativeGuard` fails closed unless the five mandatory governance
 * capabilities are present, so every fixture starts from a complete guard and
 * overrides only the seam under test.
 */
function baseGuard(overrides) {
  return {
    beforeToolCall: () => ({ allow: true }),
    beforeAnnounce: () => ({ action: "deliver", receipt: "receipt" }),
    beforeRunEnd: () => ({ allow: true }),
    beforeIngress: () => ({ prompt: "prompt" }),
    recordQuota: () => ({ recorded: true }),
    selfQuotaReceipt: () => ({ receipt: "quota" }),
    resolveRunModel: () => ({ model: "fixture-model" }),
    ...overrides,
  };
}

test("M11-T3 A3: finishNativeRun keeps the cause and the host-visible code", async () => {
  const scope = tempRoot("m11-t3-boundary-end-");
  const guardFault = new Error("Stale ledger snapshot");
  registerNativeGuard(
    scope,
    baseGuard({
      beforeRunEnd: () => {
        throw guardFault;
      },
    }),
  );
  const { error, lines } = await captureConsoleError(() =>
    finishNativeRun(
      guardedConfig(scope),
      { runId: "run-1", outcome: "ok" },
      { agentId: "o1", sessionKey: "session-1", runId: "run-1" },
    ),
  );
  // The host-visible contract string must not change.
  assert.equal(error.message, "GOVERNANCE_COMPLETION_UNAVAILABLE");
  // ...but the guard fault that produced it must survive as the cause, so a
  // policy denial, an unregistered guard and a disk fault stay separable.
  assert.equal(error.cause, guardFault);
  assert.equal(
    lines.some((line) => line.includes("[zink-native-gate] finishNativeRun:")),
    true,
    "no seam-tagged diagnostic was emitted",
  );
  assert.equal(
    lines.some((line) => line.includes("    at ")),
    false,
    "a stack frame reached the log",
  );
});

test("M11-T3 A3: sanitizeNativePrompt keeps the cause too", async () => {
  const scope = tempRoot("m11-t3-boundary-ingress-");
  const guardFault = new Error("guard exploded");
  registerNativeGuard(
    scope,
    baseGuard({
      beforeIngress: () => {
        throw guardFault;
      },
    }),
  );
  const { error } = await captureConsoleError(() =>
    sanitizeNativePrompt(guardedConfig(scope), "hello"),
  );
  assert.equal(error.message, "GOVERNANCE_INGRESS_UNAVAILABLE");
  assert.equal(error.cause, guardFault);
});

test("M11-T3 A3: gateNativeAnnounce still blocks, and now says why", async () => {
  const scope = tempRoot("m11-t3-boundary-announce-");
  registerNativeGuard(
    scope,
    baseGuard({
      beforeAnnounce: () => {
        throw new Error("announce guard down");
      },
    }),
  );
  const { error, lines } = await captureConsoleError(async () =>
    gateNativeAnnounce(guardedConfig(scope), { runId: "run-2" }, undefined),
  );
  // This seam returns a verdict rather than throwing; the verdict is unchanged.
  assert.equal(error, undefined);
  assert.equal(
    lines.some((line) =>
      line.includes("[zink-native-gate] gateNativeAnnounce:"),
    ),
    true,
    "a blocked announce produced no diagnostic, so the block is unattributable",
  );
});

// ---------------------------------------------------------------- A4

function foreignLock(storagePath) {
  const lockDir = `${storagePath}.lock`;
  mkdirSync(lockDir, { mode: 0o700 });
  writeFileSync(
    path.join(lockDir, "owner.json"),
    JSON.stringify({ pid: 999_999, token: "not-our-token" }),
    { mode: 0o700 },
  );
  return lockDir;
}

const ENQUEUE_ARGS = {
  taskId: "task-A4",
  primaryCoordinator: "o1",
  requiredCapabilities: ["sql"],
  payload: { note: "serialized write" },
};

test("M11-T3 A4: enqueueTask refuses to write while another process holds the queue lock", () => {
  const root = tempRoot("m11-t3-queue-enqueue-");
  const storagePath = path.join(root, "task-queue.json");
  foreignLock(storagePath);
  const manager = new QueueManager({ storagePath });
  assert.throws(
    () => manager.enqueueTask(ENQUEUE_ARGS),
    /QUEUE_LOCK_TIMEOUT/,
    "enqueueTask wrote the queue projection without taking the writer lock",
  );
  assert.equal(
    existsSync(storagePath),
    false,
    "enqueueTask persisted a queue file while another process held the lock",
  );
});

test("M11-T3 A4: clear() refuses to drop the projection while the lock is held", () => {
  const root = tempRoot("m11-t3-queue-clear-");
  const storagePath = path.join(root, "task-queue.json");
  const manager = new QueueManager({ storagePath });
  manager.enqueueTask(ENQUEUE_ARGS);
  foreignLock(storagePath);
  assert.throws(
    () => manager.clear(),
    /QUEUE_LOCK_TIMEOUT/,
    "clear() rewrote the queue projection without the writer lock",
  );
  const survivor = new QueueManager({ storagePath });
  assert.equal(survivor.queue.has("task-A4"), true);
});

test("M11-T3 A4: an uncontended enqueue still persists and reloads for the next process", () => {
  const root = tempRoot("m11-t3-queue-happy-");
  const storagePath = path.join(root, "task-queue.json");
  const writer = new QueueManager({ storagePath });
  writer.enqueueTask(ENQUEUE_ARGS);
  const reader = new QueueManager({ storagePath });
  assert.equal(reader.queue.get("task-A4").status, "QUEUED");
});
