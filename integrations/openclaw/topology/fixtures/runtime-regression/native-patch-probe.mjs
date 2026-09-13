// In-memory dry-run only. Never modifies the installed runtime.
import assert from "node:assert/strict";
import process from "node:process";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  inspectNativePatch,
  sha256,
  transformNativeSource,
  applyNativePatch,
  checkNativePatch,
  restoreNativePatch,
} from "../../lib/native-patch.mjs";
import {
  installNativeToolGate,
  registerNativeGuard,
} from "../../lib/native-boundary.mjs";

for (const [file, value] of Object.entries(
  inspectNativePatch(process.argv[2] ?? ""),
)) {
  const roundtrip = transformNativeSource(file, value.after);
  assert.equal(roundtrip.state, "PATCHED");
  assert.equal(roundtrip.before, value.before);
  assert.throws(
    () => transformNativeSource(file, `${value.after}\n// drift`),
    /NATIVE_SOURCE_DRIFT/u,
  );
  process.stdout.write(
    `${JSON.stringify({
      file,
      state: value.state,
      before_digest: value.beforeDigest,
      after_digest: value.afterDigest,
      exact_roundtrip: "PASS",
      drift_rejection: "PASS",
      installed_mutation: false,
    })}\n`,
  );
}

// Exercise the exact installed preparation function that precedes tool.execute.
// Only tool resolution/argument validation are synthetic fixtures here.
const loop = readFileSync(
  path.join(process.argv[2], "dist/proxy-QBx6NvOg.js"),
  "utf8",
);
assert.equal(
  sha256(loop),
  "4cef3ca0b60bf97d27b0116f33049550066d8500723cdab10920410d73ea7e83",
);
const start = loop.indexOf("async function prepareToolCall(");
const end = loop.indexOf("async function executePreparedToolCall(", start);
assert.ok(start > 0 && end > start);
const prepare = new Function(
  "resolveToolCallTool",
  "createErrorToolResult",
  "validateToolArguments",
  "prepareToolCallArguments",
  `${loop.slice(start, end)}\nreturn prepareToolCall;`,
)(
  async (context, _message, call) => ({
    kind: "resolved",
    tool: context.tools.find((tool) => tool.name === call.name),
  }),
  (text) => ({ content: [{ type: "text", text }] }),
  (_tool, call) => call.arguments,
  (_tool, call) => call,
);
const config = {
  plugins: {
    entries: {
      "zink-governance": {
        enabled: true,
        config: { ledgerRoot: "synthetic-native-probe" },
      },
    },
  },
};
const unregister = registerNativeGuard("synthetic-native-probe", {
  beforeToolCall: () => ({ allow: true }),
  beforeAnnounce: () => ({ action: "discard" }),
});
try {
  const agent = {};
  installNativeToolGate(agent, config, {
    agentId: "main",
    sessionKey: "synthetic",
    runId: "synthetic-run",
  });
  let sideEffects = 0;
  const context = {
    tools: ["sessions_spawn", "sessions_yield", "session_status"].map(
      (name) => ({
        name,
        execute: () => {
          sideEffects++;
        },
      }),
    ),
  };
  for (const names of [
    ["sessions_spawn", "sessions_yield"],
    ["sessions_yield", "session_status"],
  ]) {
    const message = {
      role: "assistant",
      content: names.map((name, index) => ({
        type: "toolCall",
        name,
        id: `call-${index}`,
        arguments: {},
      })),
    };
    for (const call of message.content) {
      const prepared = await prepare(
        context,
        message,
        call,
        agent,
        undefined,
        new Map(),
      );
      assert.equal(prepared.kind, "immediate");
      assert.equal(prepared.isError, true);
      if (prepared.kind === "prepared") prepared.tool.execute();
    }
  }
  assert.equal(sideEffects, 0);
  const call = {
    type: "toolCall",
    name: "sessions_spawn",
    id: "valid-call",
    arguments: {},
  };
  const prepared = await prepare(
    context,
    { role: "assistant", content: [call] },
    call,
    agent,
    undefined,
    new Map(),
  );
  assert.equal(prepared.kind, "prepared");
  prepared.tool.execute();
  assert.equal(sideEffects, 1);
  process.stdout.write(
    `${JSON.stringify({ native_prepare_execution: "PASS", sibling_side_effects: 0, valid_fixture_side_effects: 1, live_gateway: "NOT RUN" })}\n`,
  );
} finally {
  unregister();
}

// Apply/restore to a synthetic copy of public source, never to the installation.
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "zink-r12-native-"));
try {
  const fixtureRuntime = path.join(fixtureRoot, "runtime");
  mkdirSync(path.join(fixtureRuntime, "dist"), { recursive: true });
  writeFileSync(
    path.join(fixtureRuntime, "dist", "agent-FRfbCcij.js"),
    readFileSync(path.join(process.argv[2], "dist", "agent-FRfbCcij.js")),
  );
  writeFileSync(
    path.join(fixtureRuntime, "package.json"),
    JSON.stringify({ version: "2026.6.34" }),
  );
  const inspection = inspectNativePatch(process.argv[2]);
  for (const [file, entry] of Object.entries(inspection))
    writeFileSync(path.join(fixtureRuntime, "dist", file), entry.before);
  const backup = path.join(fixtureRoot, "backup");
  assert.equal(applyNativePatch(fixtureRuntime, backup).status, "PATCHED");
  for (const file of [
    ...Object.keys(inspection),
    "zink-governance-boundary.mjs",
  ])
    execFileSync(
      process.execPath,
      ["--check", path.join(fixtureRuntime, "dist", file)],
      { timeout: 10000, stdio: "pipe" },
    );
  assert.equal(checkNativePatch(fixtureRuntime).status, "PATCHED");
  assert.equal(applyNativePatch(fixtureRuntime, backup).status, "PATCHED");
  assert.equal(restoreNativePatch(fixtureRuntime, backup).status, "RESTORED");
  assert.equal(
    existsSync(
      path.join(fixtureRuntime, "dist", "zink-governance-boundary.mjs"),
    ),
    false,
  );
  assert.throws(() => applyNativePatch(fixtureRuntime, backup), {
    code: "EEXIST",
  });
  process.stdout.write(
    `${JSON.stringify({ synthetic_apply: "PASS", patched_source_syntax: "PASS", synthetic_idempotency: "PASS", synthetic_restore: "PASS", backup_overwrite_rejected: "PASS", installed_mutation: false })}\n`,
  );
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
