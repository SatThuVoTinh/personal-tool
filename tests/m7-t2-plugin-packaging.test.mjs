// V15: the deployed governance plugin could not resolve its own contracts.
//
// `policy.mjs` looks its contracts up through a `path.resolve` argument rather
// than an import specifier, so the packaging rewriters never saw it. In the
// deployed tree that lookup resolved to `<plugin>/topology/contracts`, which does
// not exist, and `governanceHash` threw ENOENT on the first governed turn.
//
// These tests exercise the DEPLOYED SHAPE of the plugin, not the repository
// layout: the packaged assets are materialized into a throwaway tree laid out
// the way `configure.mjs` deploys them, and the packaged `policy.mjs` is
// imported from there. A repository-layout test would pass both before and after
// the fix and would prove nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { governancePluginFiles } from "../integrations/openclaw/lib/policy.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function fixture(tag) {
  return mkdtempSync(path.join(os.tmpdir(), `v15-${tag}-`));
}

/** Materialize the packaged assets exactly as the deployer does. */
function deployShape(assets) {
  const root = fixture("shape");
  for (const [relative, body] of Object.entries(assets)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return root;
}

const repoFile = (relative) =>
  readFileSync(path.join(REPO_ROOT, relative), "utf8");

describe("V15 — the deployed plugin resolves its own topology contracts", () => {
  it("A. the packaged lookup points at the deployed contracts directory", () => {
    const { assets } = governancePluginFiles();
    const packaged = assets["lib/policy.mjs"];

    // The repository-only path must be gone from the packaged artifact.
    assert.ok(
      !packaged.includes('"../../topology/contracts"'),
      "the packaged policy.mjs must not keep the repository-only contracts lookup",
    );
    // And the deployed path must be present exactly where the contracts land.
    assert.ok(
      packaged.includes('"../../contracts"'),
      "the packaged policy.mjs must look contracts up under the plugin root",
    );
    assert.ok(
      Object.keys(assets).some((k) => k.startsWith("contracts/")),
      "contracts must still be materialized as plugin-root assets",
    );
  });

  it("B. governanceHash completes on the deployed shape and returns a stable hash", async () => {
    const { assets } = governancePluginFiles();
    const root = deployShape(assets);
    try {
      const deployed = await import(
        pathToFileURL(path.join(root, "lib", "policy.mjs")).href
      );
      // This is the exact call that threw ENOENT before the fix.
      const hash = deployed.governanceHash("main");
      assert.match(
        hash,
        /^[0-9a-f]{64}$/u,
        "governanceHash must return a digest",
      );
      // Stable across calls, and equal for every agent id.
      assert.equal(deployed.governanceHash("main"), hash);
      assert.match(deployed.governanceHash("sql"), /^[0-9a-f]{64}$/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("B2. the deployed hash equals the hash baked into the packaged manifest", async () => {
    // The manifest is generated at BUILD time from the repository layout. If the
    // deployed lookup found different bytes the runtime hash would silently
    // disagree with the manifest, so prove they are identical.
    const { assets } = governancePluginFiles();
    const manifest = JSON.parse(assets["governance-manifests.json"]);
    const root = deployShape(assets);
    try {
      const deployed = await import(
        pathToFileURL(path.join(root, "lib", "policy.mjs")).href
      );
      for (const [agentId, entry] of Object.entries(manifest)) {
        assert.equal(
          deployed.governanceHash(agentId),
          entry.governance_hash,
          `${agentId}: deployed governance_hash must match the packaged manifest`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("C. the pre-existing import rewrites are unchanged", () => {
    const { assets, entrypoint } = governancePluginFiles();

    // The entrypoint rewriter: topology/lib and shared lib imports flatten.
    const sourceEntrypoint = repoFile(
      "integrations/openclaw/plugins/zink-governance/index.mjs",
    );
    assert.ok(
      sourceEntrypoint.includes('"../../topology/lib/'),
      "precondition: the entrypoint source still uses the topology import form",
    );
    assert.ok(
      !entrypoint.includes('"../../topology/lib/'),
      "the entrypoint must still have its topology imports rewritten",
    );
    assert.ok(
      !entrypoint.includes('"../../lib/'),
      "the entrypoint must still have its shared lib imports rewritten",
    );

    // The shared-lib rewriter for topology modules.
    for (const name of ["ledger", "workflow", "canonical", "guard"]) {
      const source = repoFile(`integrations/openclaw/topology/lib/${name}.mjs`);
      if (!source.includes('"../../lib/')) continue;
      assert.ok(
        !assets[`lib/${name}.mjs`].includes('"../../lib/'),
        `${name}.mjs must still have its shared lib imports rewritten`,
      );
    }

    // The policy.mjs import rewrite must survive packaging, and the new
    // contracts rule must not have been rewritten by its own pattern.
    assert.ok(
      !assets["lib/policy.mjs"].includes('"../topology/lib/'),
      "policy.mjs must still rewrite its canonical.mjs import",
    );
    assert.ok(
      assets["lib/policy.mjs"].includes("SOURCE_CONTRACTS_LOOKUP = "),
      "the V15 lookup constant must survive packaging unrewritten",
    );
    assert.ok(
      assets["lib/policy.mjs"].includes("DEPLOYED_CONTRACTS_LOOKUP = "),
      "the V15 deployed constant must survive packaging unrewritten",
    );
  });

  it("D. a missing contract still fails closed, and never falls back to the source tree", async () => {
    const { assets } = governancePluginFiles();
    const root = deployShape(assets);
    try {
      const target = path.join(
        root,
        "contracts",
        "agent-result-payload.schema.json",
      );
      assert.ok(existsSync(target), "precondition: the contract is deployed");
      rmSync(target);

      const deployed = await import(
        pathToFileURL(path.join(root, "lib", "policy.mjs")).href
      );
      assert.throws(
        () => deployed.governanceHash("main"),
        (error) => {
          assert.equal(error.code, "ENOENT", "must fail closed with ENOENT");
          // The lookup must have stayed inside the deployed tree. If it had
          // silently fallen back to the host repository the message would name
          // the repository path instead.
          assert.ok(
            String(error.path ?? "").startsWith(root),
            `lookup must stay inside the deployed tree, got ${error.path}`,
          );
          return true;
        },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("D2. an unreadable contract directory is not silently tolerated", async () => {
    const { assets } = governancePluginFiles();
    const root = deployShape(assets);
    try {
      rmSync(path.join(root, "contracts"), { recursive: true, force: true });
      const deployed = await import(
        pathToFileURL(path.join(root, "lib", "policy.mjs")).href
      );
      assert.throws(() => deployed.governanceHash("main"), /ENOENT/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
