// M12/T9 F-122 (legacy R1-A04-04) - an absent or unmapped stack must yield a
// canonical denial and record nothing, never a silent `data_plant`.
//
// MEASURED AT HEAD: four sites answered "which stack?" with `|| "data_plant"`.
// Three of them were in this plugin (the brief-activation node builder, the
// candidate node builder and the run-end brief activation) and one is the
// guard's delegation-scope fallback (integrations/openclaw/topology/lib/
// guard.mjs, owned by fix-openclaw-topology).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const pluginPath = path.join(
  REPO_ROOT,
  "integrations/openclaw/plugins/zink-governance/index.mjs",
);
const plugin = await import(pathToFileURL(pluginPath).href);
const { AGENT_STACK_POLICY } = await import(
  pathToFileURL(path.join(REPO_ROOT, "integrations/openclaw/lib/policy.mjs"))
    .href
);

test("F-122: a roster agent resolves its canonical stack", () => {
  for (const agentId of Object.keys(AGENT_STACK_POLICY)) {
    const stack = plugin.canonicalAgentPrimaryStack(agentId);
    assert.equal(
      typeof stack,
      "string",
      `${agentId} must resolve a canonical stack`,
    );
    assert.ok(
      AGENT_STACK_POLICY[agentId].includes(stack),
      `${agentId}: ${stack} must be a stack the canonical policy permits`,
    );
  }
});

test("F-122: an unmapped agent resolves NO stack", () => {
  assert.equal(plugin.canonicalAgentPrimaryStack("unknown-agent"), null);
  assert.equal(plugin.canonicalAgentPrimaryStack(""), null);
  assert.equal(plugin.canonicalAgentPrimaryStack(undefined), null);
  assert.equal(plugin.canonicalAgentPrimaryStack(null), null);
  assert.equal(plugin.canonicalAgentPrimaryStack(42), null);
});

test("F-122: the plugin holds no silent data_plant default", () => {
  const source = readFileSync(pluginPath, "utf8");
  assert.equal(
    /\|\|\s*"data_plant"/u.test(source),
    false,
    'no `|| "data_plant"` fallback may remain in the plugin',
  );
  assert.equal(
    /\?\?\s*"data_plant"/u.test(source),
    false,
    'no `?? "data_plant"` fallback may remain in the plugin',
  );
});

test("F-122: the canonical mapping table itself is the only data_plant source", () => {
  const source = readFileSync(pluginPath, "utf8");
  const table = source.match(
    /const CANONICAL_AGENT_PRIMARY_STACK = Object\.freeze\(\{[\s\S]*?\}\);/u,
  );
  assert.ok(table, "the canonical primary-stack table must exist");
  assert.match(table[0], /o1: "data_plant"/u);
});
