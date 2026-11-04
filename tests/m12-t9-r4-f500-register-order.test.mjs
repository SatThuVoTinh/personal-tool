// M12/T9-R4 F-500 (legacy R10-L01-3) — register() attached the governed tool
// surface BEFORE the config validation threw, so an invalid deployment left a
// half-registered plugin whose inertness rested on another module's unset
// store-root refusal. The fix moves the validation above registerTools, so an
// invalid deployment registers neither tools nor hooks (the M8-058 posture).
//
// The row also asks for tests/m7-t2-openclaw.test.mjs to be extended with the
// never-called assertion; that file is outside this lane's write scope and is
// reported to the lead. This lane ships the equivalent assertion here.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const plugin = await import(
  `file:///${path.join(REPO_ROOT, "integrations/openclaw/plugins/zink-governance/index.mjs").replaceAll("\\", "/")}`
);

const OWNER = "123456789012345678";

function apiSpy(pluginConfig) {
  const tools = [];
  const hooks = [];
  const api = {
    pluginConfig,
    on: (name) => hooks.push(name),
    registerTool: (spec) => tools.push(spec?.name ?? spec),
    logger: { warn() {}, info() {}, error() {} },
  };
  return { api, tools, hooks };
}

test("F-500: an invalid config throws BEFORE any tool or hook is registered", () => {
  const { api, tools, hooks } = apiSpy({
    ledgerRoot: "relative/ledger-root",
    ownerDiscordId: OWNER,
  });
  assert.throws(
    () => plugin.default.register(api),
    /GOVERNANCE_CONFIGURATION_INVALID/u,
    "a relative ledgerRoot must throw",
  );
  assert.equal(
    tools.length,
    0,
    "registerTool must never be called when the config validation throws",
  );
  assert.equal(hooks.length, 0, "no hook may attach to an invalid deployment");
});

test("F-500: a missing ownerDiscordId throws before registration too", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f500-"));
  try {
    const { api, tools, hooks } = apiSpy({ ledgerRoot: root });
    assert.throws(
      () => plugin.default.register(api),
      /GOVERNANCE_CONFIGURATION_INVALID/u,
    );
    assert.equal(tools.length, 0);
    assert.equal(hooks.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-500 control: a valid config still registers the governed tool surface", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f500-ok-"));
  try {
    const { api, tools } = apiSpy({ ledgerRoot: root, ownerDiscordId: OWNER });
    plugin.default.register(api);
    assert.ok(
      tools.length > 0,
      "the spy must observe tools for a valid config, or the negative cases prove nothing",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
