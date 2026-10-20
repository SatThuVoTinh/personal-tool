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
import { execFileSync } from "node:child_process";
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
import {
  governancePluginFiles,
  PACKAGE_REWRITES,
} from "../integrations/openclaw/lib/policy.mjs";

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

// V16: the rewriter used to rewrite its own rewrite specification.
//
// governancePluginFiles packages policy.mjs, and policy.mjs is where the rewrite
// rules were written as inline string literals. A literal rule therefore occurs
// inside the very file its own pass rewrites, and the pass destroyed it: the
// deployed copy carried replaceAll('"./', '"./') instead of the real
// import-flattening rule, a silent no-op that disabled the rewrite for every
// later build.
//
// A no-op rule cannot be detected by applying it — a no-op is a fixed point — so
// these tests assert the SEMANTIC invariant instead: the rewrite specification
// evaluated from the packaged bytes must equal the specification evaluated from
// the source. That needs no restated expectations, so it cannot drift from the
// implementation, and it covers every rule including ones added later.
describe("V16 — the packaging rewriter cannot rewrite its own specification", () => {
  const importDeployedTable = async () => {
    const { assets } = governancePluginFiles();
    const root = deployShape(assets);
    try {
      const deployed = await import(
        pathToFileURL(path.join(root, "lib", "policy.mjs")).href
      );
      return { root, assets, deployed, text: assets["lib/policy.mjs"] };
    } catch (error) {
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
  };

  it("A. the packaged policy.mjs carries the SAME rewrite table as the source", async () => {
    const { root, deployed } = await importDeployedTable();
    try {
      assert.deepStrictEqual(
        deployed.PACKAGE_REWRITES,
        PACKAGE_REWRITES,
        "the rewrite specification must survive self-packaging unchanged",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("D. the topology/lib import rule is functional, not a silent no-op", async () => {
    const { root, text } = await importDeployedTable();
    try {
      // The rule's EFFECT is the proof. If the rule had degenerated to
      // '"./' -> '"./' the import below would still be present in the packaged
      // bytes, because nothing would have removed it.
      assert.ok(
        !text.includes('"../topology/lib/canonical.mjs'),
        "the policy.mjs canonical import must actually be rewritten",
      );
      assert.ok(
        text.includes('from "./canonical.mjs"'),
        "the flattened import must be present in the packaged bytes",
      );
      // And the rule that did it must still be specified, not consumed.
      assert.ok(
        text.includes("PACKAGE_REWRITES"),
        "the rewrite table must be present in the packaged bytes",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("B. the entrypoint rewrite rules survive and are functional", async () => {
    const { assets, deployed, root } = await importDeployedTable();
    try {
      const entrypointRules = deployed.PACKAGE_REWRITES.entrypoint;
      assert.strictEqual(entrypointRules.length, 2);
      assert.deepStrictEqual(entrypointRules, PACKAGE_REWRITES.entrypoint);

      const entrypoint = assets["index.mjs"] ?? null;
      const packaged = governancePluginFiles().entrypoint;
      assert.ok(
        !packaged.includes('"../../topology/lib/'),
        "entrypoint topology imports must be rewritten",
      );
      assert.ok(
        !packaged.includes('"../../lib/'),
        "entrypoint shared lib imports must be rewritten",
      );
      void entrypoint;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("C. the ../../lib/ rule survives and is functional for the topology modules", async () => {
    const { assets, deployed, root } = await importDeployedTable();
    try {
      assert.deepStrictEqual(
        deployed.PACKAGE_REWRITES["topology/lib"],
        PACKAGE_REWRITES["topology/lib"],
      );
      // guard, ledger and workflow are the modules that actually import
      // shared lib/ siblings, so they are the observable effect of this rule.
      for (const name of ["guard", "ledger", "workflow"]) {
        assert.ok(
          !assets[`lib/${name}.mjs`].includes('"../../lib/'),
          `${name}.mjs must have its shared lib imports rewritten`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("E. the V15 contract-path fix is unaffected by the V16 mechanism", async () => {
    const { assets, deployed, text, root } = await importDeployedTable();
    try {
      assert.ok(
        text.includes('"../../contracts"'),
        "the deployed contracts lookup must still be in place",
      );
      assert.ok(
        !text.includes('"../../topology/contracts"'),
        "the repository-only lookup must still be gone",
      );
      // And it must still actually resolve on deployed-shaped bytes.
      assert.match(deployed.governanceHash("main"), /^[0-9a-f]{64}$/u);
      assert.equal(
        deployed.governanceHash("main"),
        JSON.parse(assets["governance-manifests.json"]).main.governance_hash,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("F. no rule degenerates, reaches the source tree, or embeds a host path", async () => {
    const { root, text } = await importDeployedTable();
    try {
      for (const [target, rules] of Object.entries(PACKAGE_REWRITES))
        for (const [, replacement] of rules) {
          assert.ok(
            !path.isAbsolute(replacement) && !replacement.includes("/home/"),
            `${target}: replacement must stay relative, got ${replacement}`,
          );
          assert.ok(
            !replacement.includes("integrations/openclaw"),
            `${target}: replacement must not point at the source tree`,
          );
        }

      // The self-safety invariant, checked on the PACKAGED bytes rather than on
      // source: if any search pattern occurred contiguously in this file, that
      // rule's own pass would consume it. Every pattern is assembled, so none
      // may appear. This is deliberately a literal check — it is immune to
      // prose, and it is exactly the condition that caused the original defect.
      for (const [search] of Object.values(PACKAGE_REWRITES).flat())
        assert.ok(
          !text.includes(search),
          `the packaged policy.mjs must not contain the search literal ${search}`,
        );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("G. every governed rewrite rule is non-degenerate and effective", async () => {
    const { root, deployed } = await importDeployedTable();
    try {
      const sources = {
        "topology/lib": [
          "canonical",
          "guard",
          "ledger",
          "workflow",
          "schema",
          "runtime",
          "native-boundary",
        ].map((n) => repoFile(`integrations/openclaw/topology/lib/${n}.mjs`)),
        "lib/policy.mjs": [repoFile("integrations/openclaw/lib/policy.mjs")],
        entrypoint: [
          repoFile("integrations/openclaw/plugins/zink-governance/index.mjs"),
        ],
      };

      const targets = Object.keys(deployed.PACKAGE_REWRITES);
      assert.ok(targets.length > 0, "the rewrite table must not be empty");
      // Mechanical coverage: every target the packager can rewrite is declared,
      // so a future inline replaceAll cannot bypass the table unnoticed.
      for (const expected of ["topology/lib", "lib/policy.mjs", "entrypoint"])
        assert.ok(
          targets.includes(expected),
          `${expected} must be governed by the rewrite table`,
        );

      let ruleCount = 0;
      for (const [target, rules] of Object.entries(deployed.PACKAGE_REWRITES)) {
        assert.ok(rules.length > 0, `${target} must declare at least one rule`);
        for (const [search, replacement] of rules) {
          ruleCount += 1;
          assert.equal(typeof search, "string");
          assert.ok(search.length > 0, `${target}: empty search pattern`);
          assert.notEqual(
            search,
            replacement,
            `${target}: rule ${search} is a no-op and would be invisible`,
          );
          // EFFECTIVENESS: the rule must actually match its target's source.
          // A vacuous rule would silently stop flattening imports.
          assert.ok(
            sources[target].some((body) => body.includes(search)),
            `${target}: rule ${search} matches nothing in its target`,
          );
        }
      }
      assert.ok(
        ruleCount >= 5,
        `expected the full rule set, enumerated only ${ruleCount}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// M12/T9 F-004 - a config key the plugin reads must be DECLARABLE
// ---------------------------------------------------------------------------

describe("M12/T9 F-004: the config keys the plugin reads are declared", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        "../integrations/openclaw/plugins/zink-governance/openclaw.plugin.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const declared = manifest.configSchema.properties;

  it("declares the skill-approval decision ref and the guild id", () => {
    // Without these two the plugin's own reads are unreachable: the manifest
    // sets additionalProperties:false, so a key it does not declare can never
    // be configured, and the read always sees undefined.
    for (const key of ["skillApprovalDecisionRef", "discordGuildId"]) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(declared, key),
        `${key} is read by the plugin and must be declared in configSchema`,
      );
    }
    assert.equal(
      manifest.configSchema.additionalProperties,
      false,
      "the schema is closed, so an undeclared key is unreachable",
    );
  });

  it("keeps the declared keys in step with the keys the plugin reads", () => {
    const source = readFileSync(
      new URL(
        "../integrations/openclaw/plugins/zink-governance/index.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    const read = new Set();
    for (const match of source.matchAll(/\bconfig\.([A-Za-z_][A-Za-z0-9_]*)/gu))
      read.add(match[1]);
    for (const match of source.matchAll(
      /\bconfig\?\.\s*([A-Za-z_][A-Za-z0-9_]*)/gu,
    ))
      read.add(match[1]);
    // The legacy single-channel aliases are read as FALLBACKS for the forum ids
    // the build emits; they are deliberately not configurable, so they are the
    // only reads a closed schema may not declare.
    const LEGACY_ALIASES = new Set([
      "approvalsChannelId",
      "incidentsChannelId",
      "officeChannelId",
      "resultsChannelId",
    ]);
    const undeclared = [...read]
      .filter((key) => !declared[key] && !LEGACY_ALIASES.has(key))
      .sort();
    assert.deepEqual(
      undeclared,
      [],
      `every config key the plugin reads must be declared: ${undeclared.join(", ")}`,
    );
  });
});

// M12/T9 F-201: the packaging whitelist and its rewrite engine had no
// completeness gate, and the deployed entrypoint's module graph was never
// imported by any test. Adding one module imported by index.mjs shipped green
// through CI and then died at gateway start with ERR_MODULE_NOT_FOUND.
describe("M12/T9 F-201 - the deployed entrypoint's module graph resolves", () => {
  const relativeSpecifiers = (source) =>
    [...source.matchAll(/(?:from|import)\s+"(\.[^"]+)"/gu)].map(
      (match) => match[1],
    );

  it("resolves every relative specifier of the deployed entrypoint", async () => {
    const { assets, entrypoint } = governancePluginFiles();
    const root = deployShape(assets);
    try {
      const entryPath = path.join(root, "index.mjs");
      writeFileSync(entryPath, entrypoint);
      const specifiers = relativeSpecifiers(entrypoint);
      assert.ok(
        specifiers.length > 0,
        "the entrypoint must import something for this gate to mean anything",
      );
      for (const specifier of specifiers) {
        assert.ok(
          existsSync(path.join(root, specifier)),
          `the deployed entrypoint imports ${specifier}, which is not a packaged asset`,
        );
      }
      // The graph must actually load: this is the ERR_MODULE_NOT_FOUND the
      // gateway used to die with.
      await import(pathToFileURL(entryPath).href);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("detects an entrypoint that imports a module the package does not carry", async () => {
    const { assets, entrypoint } = governancePluginFiles();
    const root = deployShape(assets);
    try {
      const broken = `${entrypoint}\nimport "./lib/not-packaged.mjs";\n`;
      const specifiers = relativeSpecifiers(broken);
      assert.ok(
        specifiers.includes("./lib/not-packaged.mjs"),
        "the gate must see the added specifier",
      );
      assert.equal(
        existsSync(path.join(root, "./lib/not-packaged.mjs")),
        false,
        "the broken specifier must not be a packaged asset",
      );
      // And the import step must fail on it, exactly as the gateway did.
      const brokenPath = path.join(root, "index-broken.mjs");
      writeFileSync(brokenPath, broken);
      await assert.rejects(
        () => import(pathToFileURL(brokenPath).href),
        /ERR_MODULE_NOT_FOUND|Cannot find module/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// M12/T9 F-022 / F-162 - the deployed plugin resolves its modules from its own
// digest-gated tree, never from a machine-specific absolute path
// ---------------------------------------------------------------------------

describe("M12/T9 F-022 - no governance-resolution source carries a machine-specific path", () => {
  // A Windows home mounted into WSL, a Windows home, a Linux home.
  const MACHINE_PATH_PATTERNS = [
    /\/mnt\/[a-z]\/Users\//iu,
    /[A-Za-z]:\\+Users\\+/u,
    /\/home\/[a-z_][a-z0-9_-]*\//iu,
  ];

  const trackedRuntimeSources = () =>
    execFileSync(
      "git",
      [
        "-c",
        `safe.directory=${REPO_ROOT}`,
        "ls-files",
        "-z",
        "integrations/openclaw",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
    )
      .split("\0")
      .filter(Boolean)
      .filter((relative) => relative.endsWith(".mjs"))
      // The operator fixtures under topology/fixtures run ON the live host and
      // name it on purpose; they are not runtime resolution sources.
      .filter((relative) => !relative.includes("/fixtures/"));

  /** The lines of a source that carry a machine-specific path. */
  const machinePathLines = (content) => {
    const offenders = [];
    content.split(/\r?\n/u).forEach((line, index) => {
      const trimmed = line.trim();
      // A comment that NAMES the live path is documentation, not a resolution.
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*")
      ) {
        return;
      }
      for (const pattern of MACHINE_PATH_PATTERNS) {
        if (pattern.test(line)) offenders.push(index + 1);
      }
    });
    return offenders;
  };

  it("no tracked runtime source resolves a module through a machine-specific path", () => {
    const files = trackedRuntimeSources();
    assert.ok(
      files.length > 10,
      `the tracked tree must actually be walked, got ${files.length} files`,
    );
    const offenders = [];
    for (const relative of files) {
      const content = readFileSync(path.join(REPO_ROOT, relative), "utf8");
      for (const line of machinePathLines(content)) {
        offenders.push(`${relative}:${line}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `a tracked runtime source resolves through a machine-specific path: ${offenders.join(", ")}`,
    );
  });

  it("the deployed entrypoint carries no machine-specific path", () => {
    const { entrypoint } = governancePluginFiles();
    assert.deepEqual(
      machinePathLines(entrypoint),
      [],
      "the deployed entrypoint must not resolve through a machine-specific path",
    );
  });
});

describe("M12/T9 F-162 - the excel writer that executes is the one whose digest was admitted", () => {
  it("the deployed entrypoint loads the excel writer from its own packaged asset", () => {
    const { assets, entrypoint } = governancePluginFiles();
    assert.ok(
      assets["lib/excel-writer.mjs"],
      "the excel writer must travel with the packaged build",
    );
    const specifiers = [
      ...entrypoint.matchAll(/["']([^"']*excel-writer\.mjs)["']/gu),
    ].map((match) => match[1]);
    assert.ok(
      specifiers.length > 0,
      "the entrypoint must load the excel writer at all",
    );
    for (const specifier of specifiers) {
      assert.ok(
        specifier.startsWith("./lib/"),
        `the excel writer must come from the packaged tree, got ${specifier}`,
      );
    }
  });

  it("no working-tree override of the excel writer remains", () => {
    const source = repoFile(
      "integrations/openclaw/plugins/zink-governance/index.mjs",
    );
    assert.equal(
      source.includes("integrations/openclaw/lib/excel-writer.mjs"),
      false,
      "the excel writer must not be loaded from an arbitrary working-tree path",
    );
  });
});
