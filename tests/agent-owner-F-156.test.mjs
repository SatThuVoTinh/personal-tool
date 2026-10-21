// M12/T9 F-156 — the Skill Store's PUBLIC DOOR.
//
// The governance plugin imported the Skill Store's INTERNALS by relative path
// (`zink-skill-store/src/catalog.mjs`, `zink-skill-store/src/vector-sync.mjs`),
// so the plugin's behaviour was welded to the store's private file layout and
// the module boundary was unenforceable: a rename inside `src/` broke the
// plugin, and the plugin could reach any internal it liked.
//
// The owner's ruling ("Mở một cửa chính thức") is ONE public module in the
// Skill Store's own tree, exporting exactly what a caller needs:
//
//   promoteApprovedSkill(...)      the canonical promotion
//   withSkillStoreWriterLock(...)  the store-wide writer lock
//   syncSkillsToVectorStore(...)   the derived pgvector index sync
//
// and the plugin uses THAT module, never `src/*`.
//
// This lane proves the three halves of the ruling:
//   1. no file under `integrations/` LOADS a Skill Store internal module;
//   2. the public module exports exactly the three governed entry points;
//   3. the plugin's own calls still work through the door.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "..");
const PLUGIN_PATH = path.join(
  REPO,
  "integrations",
  "openclaw",
  "plugins",
  "zink-governance",
  "index.mjs",
);
const POLICY_PATH = path.join(
  REPO,
  "integrations",
  "openclaw",
  "lib",
  "policy.mjs",
);
const DOOR_PATH = path.join(REPO, "zink-skill-store", "index.mjs");
const ADAPTER_PATH = path.join(
  REPO,
  "zink-tools",
  "adapters",
  "skill-store",
  "skill-adapter.mjs",
);
const OWNER = "123456789012345678";

const { SkillAdapter } = await import(pathToFileURL(ADAPTER_PATH).href);
const { handleOwnerSkillApproval } = await import(
  pathToFileURL(PLUGIN_PATH).href
);
const { governancePluginFiles, PACKAGED_RUNTIME_MODULES } = await import(
  pathToFileURL(POLICY_PATH).href
);

/**
 * The source with its comments removed, so an explanatory comment can neither
 * satisfy nor trip a source assertion (the R25/M11 house helper).
 */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/u, "$1"))
    .join("\n");
}

/** Every regular file under `dir`, recursively. */
async function filesUnder(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full)));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/**
 * The Skill Store modules the BUILD ships.
 *
 * The owner's ruling requires the packaged asset set to carry the store's
 * modules the public door imports, so the packaging registry is the ONE place
 * in the OpenClaw tree that may NAME a store internal. Naming a shipped asset
 * is not loading a module: the registry is a list of paths the build copies,
 * not a module the OpenClaw code imports.
 */
const SHIPPED_STORE_ASSETS = PACKAGED_RUNTIME_MODULES.filter((relative) =>
  relative.startsWith("zink-skill-store/"),
);

// ---------------------------------------------------------------------------
// 1. The boundary itself
// ---------------------------------------------------------------------------
test("F-156: no file under integrations/ loads a zink-skill-store/src module", async () => {
  const offenders = [];
  for (const file of await filesUnder(path.join(REPO, "integrations"))) {
    let text = code(readFileSync(file, "utf8"));
    if (file === POLICY_PATH) {
      // The packaging registry is exempt, and only the registry: every shipped
      // store asset is masked, so a store internal named ANYWHERE else in the
      // packaging file is still an offence.
      for (const relative of SHIPPED_STORE_ASSETS) {
        text = text.replaceAll(`"${relative}"`, '"<shipped-asset>"');
      }
    }
    if (text.includes("zink-skill-store/src")) {
      offenders.push(path.relative(REPO, file).replaceAll("\\", "/"));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "the OpenClaw tree must reach the Skill Store through its public door only",
  );
});

test("F-156: the plugin loads the Skill Store's public door, not its internals", () => {
  const source = code(readFileSync(PLUGIN_PATH, "utf8"));
  assert.match(
    source,
    /zink-skill-store\/index\.mjs/u,
    "the plugin must load the Skill Store's public module",
  );
  assert.doesNotMatch(
    source,
    /zink-skill-store\/src\//u,
    "the plugin must not name a Skill Store internal module",
  );
});

// ---------------------------------------------------------------------------
// 2. The public surface
// ---------------------------------------------------------------------------
test("F-156: the public module exports exactly the three governed entry points", async () => {
  const door = await import(pathToFileURL(DOOR_PATH).href);
  assert.deepEqual(
    Object.keys(door).sort(),
    [
      "promoteApprovedSkill",
      "syncSkillsToVectorStore",
      "withSkillStoreWriterLock",
    ],
    "the door publishes exactly what a caller needs, and nothing else",
  );
  for (const name of Object.keys(door)) {
    assert.equal(
      typeof door[name],
      "function",
      `${name} must be a callable entry point`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. The plugin's calls still work
// ---------------------------------------------------------------------------
test("F-156: the plugin's approval still promotes and syncs through the door", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f156-door-"));
  const skillsRoot = path.join(root, "skills");
  const proposalStorageDir = path.join(root, "proposals");
  try {
    const proposing = new SkillAdapter(skillsRoot, {
      skillsRoot,
      proposalStorageDir,
    });
    const content =
      "# Public door\n\nGoverned content promoted through the door.";
    const proposed = await proposing.querySkillStore({
      action: "propose",
      namespace: ["office"],
      capability: "door-skill",
      version: "1.0.0",
      content,
      reason: "F-156 public door",
      requesting_agent: "excel",
    });

    const statements = [];
    const approval = await handleOwnerSkillApproval({
      ownerDiscordId: OWNER,
      expectedOwnerId: OWNER,
      proposalId: proposed.proposal.proposal_id,
      contentSha256: proposed.proposal.content_sha256,
      namespace: ["office"],
      capability: "door-skill",
      version: "1.0.0",
      skillsRoot,
      proposalStorageDir,
      decisionRef: "PLAN:M12/T9-R1",
      // No `vectorSyncFn`: the plugin must reach the REAL sync, through the
      // door, with the database contract supplied by the caller.
      options: {
        embedFn: async (texts) => texts.map(() => new Array(1024).fill(0.01)),
        dbExecutor: async (sql) => {
          statements.push(sql);
          return "";
        },
      },
    });
    assert.equal(approval.approval_status, "APPROVED");

    // The canonical record was written by the door's promotion.
    const manifest = JSON.parse(
      await readFile(
        path.join(skillsRoot, "office", "door-skill", "1.0.0", "manifest.json"),
        "utf8",
      ),
    );
    assert.equal(manifest.lifecycle.at(-1).status, "ACTIVE");
    assert.equal(manifest.lifecycle.at(-1).decision_ref, "PLAN:M12/T9-R1");

    // The derived index was written by the door's sync: the transaction the
    // production sync really issues must have reached the database.
    assert.ok(
      statements.some((sql) =>
        sql.includes("INSERT INTO skills.catalog_index"),
      ),
      `the door's sync must reach the database: ${JSON.stringify(statements).slice(0, 400)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. The door travels with the packaged build
// ---------------------------------------------------------------------------
test("F-156: the packaged build ships the door and its imports survive the rewrite", () => {
  const { assets } = governancePluginFiles();
  const packaged = assets["zink-skill-store/index.mjs"];
  assert.ok(
    typeof packaged === "string" && packaged.length > 0,
    "the public door must be a packaged asset",
  );
  // The door's own relative imports are not rewritten, and they resolve in the
  // deployed tree because the store's modules keep their repository-relative
  // layout there.
  assert.match(packaged, /"\.\/src\/catalog\.mjs"/u);
  assert.match(packaged, /"\.\/src\/vector-sync\.mjs"/u);
  for (const relative of [
    "zink-skill-store/src/catalog.mjs",
    "zink-skill-store/src/vector-sync.mjs",
  ]) {
    assert.ok(
      assets[relative],
      `${relative} must travel with the door: the deployed tree resolves the door's relative imports`,
    );
  }
});
// ---------------------------------------------------------------------------
// 5. The door's own precondition
// ---------------------------------------------------------------------------
test("F-156: the door refuses a canonical promotion outside the store's writer lock", async () => {
  const door = await import(pathToFileURL(DOOR_PATH).href);
  const { scanCatalog } = await import(
    pathToFileURL(path.join(REPO, "zink-skill-store", "src", "catalog.mjs"))
      .href
  );
  const root = await mkdtemp(path.join(os.tmpdir(), "f156-lock-"));
  try {
    await assert.rejects(
      () =>
        door.promoteApprovedSkill({
          skillsRoot: root,
          namespace: ["office"],
          capability: "unlocked-skill",
          version: "1.0.0",
          content: "# Unlocked\n\nBody.",
          decisionRef: "PLAN:M12/T9-R1",
        }),
      (error) => error?.code === "SKILL_STORE_WRITER_LOCK_REQUIRED",
      "an unlocked canonical promotion must be refused by name",
    );
    // The refusal wrote nothing: the canonical tree is still empty.
    const catalog = await scanCatalog(root);
    assert.deepEqual(catalog.errors, []);
    assert.equal(catalog.records.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
