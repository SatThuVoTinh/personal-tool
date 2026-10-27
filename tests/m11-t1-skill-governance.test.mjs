// M11/T1 Phase 2 — skill-store governance hardening.
//
// The audit cluster this pins down (findings P2-01..P2-07):
// 1. read/apply resolved skills by an unvalidated disk walk that re-read raw
//    files with lax JSON.parse — a schema-invalid ("forged") manifest was
//    served while discover correctly failed closed. Resolution now goes
//    through scanCatalog, so the validator, strict parser, lstat rules and
//    byte ceilings bind every model-visible read identically.
// 2. The derived vector index could serve indefinitely stale rows: the
//    freshness helper existed but was never wired into search.
// 3. promoteApprovedSkillWithLock — the sole canonical writer — had no lock, so two
//    concurrent promotions could interleave heal/clash-check/stage/rename.
// 4. handleOwnerSkillApproval defaulted its provenance decisionRef to a stale
//    plan revision, and promotion references were hardcoded rather than bound
//    to the approval record.
// 5. A bare capability slug present under two namespaces resolved by
//    enumeration order.
// 6. The promote replay probe used lax JSON.parse, silently accepting
//    duplicate-key manifests the catalog rejects.
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const CATALOG_PATH = path.join(
  import.meta.dirname,
  "../zink-skill-store/src/catalog.mjs",
);
const STORE_DOOR_PATH = path.join(
  import.meta.dirname,
  "../zink-skill-store/index.mjs",
);

const VECTOR_SYNC_PATH = path.join(
  import.meta.dirname,
  "../zink-skill-store/src/vector-sync.mjs",
);
const ADAPTER_PATH = path.join(
  import.meta.dirname,
  "../zink-tools/adapters/skill-store/skill-adapter.mjs",
);
const PLUGIN_PATH = path.join(
  import.meta.dirname,
  "../integrations/openclaw/plugins/zink-governance/index.mjs",
);

const {
  promoteApprovedSkillWithLock,
  promoteApprovedSkillUnlocked,
  withSkillStoreWriterLock,
  skillStoreWriterLockDir,
  scanCatalog,
} = await import(pathToFile(CATALOG_PATH));
const STORE_DOOR = await import(pathToFile(STORE_DOOR_PATH));

const { SkillAdapter } = await import(pathToFile(ADAPTER_PATH));
const { handleOwnerSkillApproval, handleOwnerSkillRejection } = await import(
  pathToFile(PLUGIN_PATH)
);

function pathToFile(p) {
  return "file:///" + p.replace(/\\/gu, "/");
}

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const OWNER = "123456789012345678";

/**
 * Strip JS comments so an explanatory comment can neither satisfy nor trip
 * a source assertion (same helper contract as the R25 suite).
 */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/u, "$1"))
    .join("\n");

async function freshRoots() {
  const root = await mkdtemp(path.join(os.tmpdir(), "m11-t1-p2-"));
  return { root, skillsRoot: path.join(root, "skills") };
}

// ---------------------------------------------------------------------------
// M11-01 (2.1): read/apply resolve through the catalog validator
// ---------------------------------------------------------------------------
test("M11-01: a schema-invalid (forged) manifest is refused by read/apply/validate", async () => {
  const { root, skillsRoot } = await freshRoots();
  try {
    const dir = path.join(skillsRoot, "office", "forged", "1.0.0");
    await mkdir(dir, { recursive: true });
    const body = "# Forged\n\nmanifest carries a key the schema forbids\n";
    const manifest = {
      schema_version: 1,
      identity: {
        namespace: ["office"],
        capability: "forged",
        version: "1.0.0",
      },
      content: { path: "SKILL.md", sha256: sha(body) },
      provenance: { source_type: "research", references: [] },
      lifecycle: [
        { status: "CANDIDATE", at: "2026-09-17T00:00:00Z", actor: "excel" },
        {
          status: "ACTIVE",
          at: "2026-09-17T01:00:00Z",
          actor: "owner",
          decision_ref: "PLAN:M11/T1-R1",
        },
      ],
      metadata: { description: "model-controlled key outside the schema" },
    };
    await writeFile(path.join(dir, "SKILL.md"), body, "utf8");
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );

    const adapter = new SkillAdapter(skillsRoot, { skillsRoot });
    for (const action of ["read", "apply", "validate"]) {
      await assert.rejects(
        () => adapter.querySkillStore({ action, skill_id: "office/forged" }),
        (error) => error.code === "SKILL_CATALOG_INVALID",
        `${action} must fail closed on a catalog-invalid store`,
      );
    }

    // The permissive resolution paths are gone: no unvalidated walk, no
    // direct SKILL.md/manifest reads in the adapter's source.
    const src = code(readFileSync(ADAPTER_PATH, "utf8"));
    assert.doesNotMatch(src, /function walkActive/u);
    assert.doesNotMatch(src, /findSkillRecordOnDisk/u);
    assert.doesNotMatch(src, /JSON\.parse\(fs\.readFileSync\(manifestPath/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// M11-02 (2.2): the freshness gate is wired into search
// ---------------------------------------------------------------------------
function searchAdapter(output) {
  return new SkillAdapter(undefined, {
    embedFn: async () => [new Array(1024).fill(0.1)],
    dbExecutor: async () => output,
  });
}

const searchRow = JSON.stringify({
  skill_id: "00000000-0000-4000-8000-000000000001",
  namespace: ["office"],
  capability: "fresh-skill",
  version: "1.0.0",
  domain: "office",
  primary_topic: "spreadsheet",
  subtopic: null,
  content: "# Fresh\nbody",
  score: 0.9,
});

const FRESH_STAMP = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
const STALE_STAMP = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  .toISOString()
  .replace(/\.\d{3}Z$/u, "Z");

test("M11-02: search fails closed on a stale or never-synced derived index", async () => {
  const cases = [
    ["stale", `ZINK_FRESHNESS|${STALE_STAMP}\n${searchRow}`],
    ["never synced", "ZINK_FRESHNESS|"],
    ["no freshness row at all", searchRow],
    ["empty result", ""],
  ];
  for (const [label, output] of cases) {
    await assert.rejects(
      () =>
        searchAdapter(output).querySkillStore({ action: "search", query: "x" }),
      (error) => error.code === "SKILL_INDEX_STALE",
      `${label} must refuse to serve`,
    );
  }

  const ok = await searchAdapter(
    `ZINK_FRESHNESS|${FRESH_STAMP}\n${searchRow}`,
  ).querySkillStore({ action: "search", query: "x" });
  assert.equal(ok.governed_status, "SUCCESS");
  assert.equal(ok.results.length, 1);
});

test("M11-03: the freshness SELECT rides the same psql invocation as the search rows", async () => {
  let capturedSql = "";
  const adapter = new SkillAdapter(undefined, {
    embedFn: async () => [new Array(1024).fill(0.1)],
    dbExecutor: async (sql) => {
      capturedSql = sql;
      return `ZINK_FRESHNESS|${FRESH_STAMP}`;
    },
  });
  const res = await adapter.querySkillStore({ action: "search", query: "x" });
  assert.equal(res.governed_status, "NO_MATCH");
  assert.match(capturedSql, /ZINK_FRESHNESS/u);
  assert.match(capturedSql, /max\(synced_at\)/u);
  assert.match(
    capturedSql,
    /WHERE status = 'ACTIVE' AND sync_status = 'READY'/u,
  );
  assert.match(capturedSql, /FROM skills\.segments/u);
});

// ---------------------------------------------------------------------------
// M11-04 (2.3): the sole canonical writer is serialized by the store lock
// ---------------------------------------------------------------------------
const RACE_CONTENT = "# Race\n\ndistinct bytes per version\n";

test("M11-04: concurrent in-process promotions serialize; one ACTIVE, one conflict", async () => {
  const { root, skillsRoot } = await freshRoots();
  try {
    const settled = await Promise.allSettled([
      promoteApprovedSkillWithLock({
        skillsRoot,
        namespace: ["office"],
        capability: "race-skill",
        version: "1.0.0",
        content: RACE_CONTENT,
        requestingActor: "excel",
        decisionRef: "PLAN:M11/T1-R1",
      }),
      promoteApprovedSkillWithLock({
        skillsRoot,
        namespace: ["office"],
        capability: "race-skill",
        version: "1.0.1",
        content: "# Race\n\nother bytes\n",
        requestingActor: "excel",
        decisionRef: "PLAN:M11/T1-R1",
      }),
    ]);
    const successes = settled.filter((s) => s.status === "fulfilled");
    const failures = settled.filter((s) => s.status === "rejected");
    assert.equal(successes.length, 1, "exactly one promotion may publish");
    assert.equal(successes[0].value.status, "ACTIVE");
    assert.equal(failures.length, 1);
    assert.equal(failures[0].reason.code, "SKILL_ACTIVE_CONFLICT");

    const scan = await scanCatalog(skillsRoot);
    assert.deepEqual(scan.errors, [], "catalog must stay valid");
    assert.equal(scan.records.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M11-05: cross-process promotions under contention yield ACTIVE + ALREADY_ACTIVE", async () => {
  const { root, skillsRoot } = await freshRoots();
  const childScript = path.join(root, "promote-child.mjs");
  try {
    await writeFile(
      childScript,
      `import { pathToFileURL } from "node:url";
const [catalogArg, skillsRootArg] = process.argv.slice(2);
const mod = await import(pathToFileURL(catalogArg).href);
try {
  const result = await mod.promoteApprovedSkillWithLock({
    skillsRoot: skillsRootArg,
    namespace: ["office"],
    capability: "xproc-race",
    version: "1.0.0",
    content: "# XProc\\n\\nsame approved bytes\\n",
    requestingActor: "excel",
    decisionRef: "PLAN:M11/T1-R1",
  });
  process.stdout.write(JSON.stringify({ ok: true, status: result.status }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      code: error?.code ?? null,
      message: String(error?.message ?? error).slice(0, 300),
    }),
  );
}
`,
      "utf8",
    );
    const run = () =>
      execFileP(process.execPath, [childScript, CATALOG_PATH, skillsRoot], {
        timeout: 30000,
      });
    const [a, b] = await Promise.all([run(), run()]);
    const outcomes = [a.stdout, b.stdout].map((out) => JSON.parse(out));
    const statuses = outcomes.map((o) => (o.ok ? o.status : o.code)).sort();
    assert.deepEqual(
      statuses,
      ["ACTIVE", "ALREADY_ACTIVE"],
      `expected serialized promotion outcomes, got ${JSON.stringify(outcomes)}`,
    );
    const scan = await scanCatalog(skillsRoot);
    assert.deepEqual(scan.errors, []);
    assert.equal(scan.records.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M11-06: the store lock lives beside skillsRoot, never inside it", async () => {
  const { root, skillsRoot } = await freshRoots();
  try {
    const lockDir = skillStoreWriterLockDir(skillsRoot);
    // Named after the guarded root so sibling catalogs never contend on one
    // lock and a stranded lock from a crashed run cannot fail-close an
    // unrelated catalog.
    assert.equal(
      lockDir,
      path.join(
        path.dirname(skillsRoot),
        `${path.basename(skillsRoot)}.writer.lock`,
      ),
    );
    // The lock must be OUTSIDE the scanned root, or `scanCatalog` would see it
    // as an invalid entry. A plain `startsWith` is not enough: the lock path
    // shares `skills` as a string prefix with `skills.writer.lock`, so compare
    // against the root-with-separator to test true directory containment.
    assert.ok(
      !lockDir.startsWith(skillsRoot + path.sep) && lockDir !== skillsRoot,
      "lock must not poison the scan",
    );
    // Create the (empty) canonical root so a real scan runs; an empty root is
    // valid, and a lock inside it would surface as DIRECTORY_GRAMMAR_INVALID.
    await mkdir(skillsRoot, { recursive: true });
    let ran = false;
    await withSkillStoreWriterLock(skillsRoot, async () => {
      ran = true;
      // The lock directory exists while the section runs, and the catalog
      // scan is not affected because it sits outside the scanned root.
      const scan = await scanCatalog(skillsRoot);
      assert.deepEqual(scan.errors, []);
      // Prove the lock really is held by a second non-blocking acquire.
      const { tryAcquire } = await import(
        pathToFile(
          path.join(
            path.dirname(PLUGIN_PATH),
            "..",
            "..",
            "lib",
            "file-lock.mjs",
          ),
        )
      );
      assert.equal(
        tryAcquire(lockDir),
        false,
        "the lock must be contended while the section runs",
      );
    });
    assert.equal(ran, true);
    // promoteApprovedSkillUnlocked exists for callers already inside the lock.
    assert.equal(typeof promoteApprovedSkillUnlocked, "function");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// M11-07 (2.4): provenance binding — decisionRef required, references derived
// ---------------------------------------------------------------------------
async function proposedFixture(extra = {}) {
  const { root, skillsRoot } = await freshRoots();
  const proposalStorageDir = path.join(root, "proposals");
  const proposing = new SkillAdapter(undefined, { proposalStorageDir });
  const content = "# Bound Ref\n\nGoverned content.";
  const proposed = await proposing.querySkillStore({
    action: "propose",
    namespace: ["office"],
    capability: "bound-ref-skill",
    version: "1.0.0",
    content,
    reason: "M11/T1 provenance binding",
    requesting_agent: "excel",
  });
  const base = {
    ownerDiscordId: OWNER,
    expectedOwnerId: OWNER,
    proposalId: proposed.proposal.proposal_id,
    contentSha256: proposed.proposal.content_sha256,
    namespace: ["office"],
    capability: "bound-ref-skill",
    version: "1.0.0",
    skillsRoot,
    proposalStorageDir,
    options: {
      vectorSyncFn: async () => ({ status: "READY", synced_count: 1 }),
    },
    ...extra,
  };
  return { root, base };
}

test("M11-07: approval without an explicit decisionRef is denied; refs are derived from it", async () => {
  const src = code(readFileSync(PLUGIN_PATH, "utf8"));
  assert.doesNotMatch(
    src,
    /decisionRef = "PLAN:M8\/T3-R1"/u,
    "the stale default must be gone",
  );

  const denied = await proposedFixture();
  try {
    await assert.rejects(
      () => handleOwnerSkillApproval({ ...denied.base }),
      /APPROVAL_DECISION_REF_REQUIRED/u,
    );
    await assert.rejects(
      () => handleOwnerSkillApproval({ ...denied.base, decisionRef: "   " }),
      /APPROVAL_DECISION_REF_REQUIRED/u,
    );
  } finally {
    await rm(denied.root, { recursive: true, force: true });
  }

  const decided = await proposedFixture();
  try {
    const approval = await handleOwnerSkillApproval({
      ...decided.base,
      decisionRef: "PLAN:M11/T1-R1",
    });
    assert.equal(approval.approval_status, "APPROVED");
    const manifest = JSON.parse(
      await readFile(
        path.join(
          decided.base.skillsRoot,
          "office",
          "bound-ref-skill",
          "1.0.0",
          "manifest.json",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(manifest.provenance.references, [
      { type: "plan", ref: "M11/T1-R1" },
    ]);
    assert.equal(manifest.lifecycle.at(-1).decision_ref, "PLAN:M11/T1-R1");
  } finally {
    await rm(decided.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// M11-08 (2.5): bare-slug ambiguity fails closed instead of ordering
// ---------------------------------------------------------------------------
test("M11-08: a bare slug present under two namespaces is SKILL_ID_AMBIGUOUS", async () => {
  const { root, skillsRoot } = await freshRoots();
  try {
    for (const ns of ["office", "data"]) {
      await promoteApprovedSkillWithLock({
        skillsRoot,
        namespace: [ns],
        capability: "amb-skill",
        version: "1.0.0",
        content: `# ${ns} ambiguous\n\nbody\n`,
        requestingActor: "excel",
        decisionRef: "PLAN:M11/T1-R1",
      });
    }
    const adapter = new SkillAdapter(skillsRoot, { skillsRoot });
    await assert.rejects(
      () => adapter.querySkillStore({ action: "read", skill_id: "amb-skill" }),
      (error) => {
        assert.equal(error.code, "SKILL_ID_AMBIGUOUS");
        assert.match(error.message, /data\/amb-skill/u);
        assert.match(error.message, /office\/amb-skill/u);
        return true;
      },
    );
    // The qualified form still resolves exactly.
    const qualified = await adapter.querySkillStore({
      action: "read",
      skill_id: "office/amb-skill",
    });
    assert.match(qualified.skill_content.content, /office ambiguous/u);
    // A single-namespace bare slug keeps working.
    await promoteApprovedSkillWithLock({
      skillsRoot,
      namespace: ["research"],
      capability: "solo-skill",
      version: "1.0.0",
      content: "# Solo\n\nbody\n",
      requestingActor: "excel",
      decisionRef: "PLAN:M11/T1-R1",
    });
    const solo = await adapter.querySkillStore({
      action: "read",
      skill_id: "solo-skill",
    });
    assert.match(solo.skill_content.content, /Solo/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// M11-09 (2.6): the replay probe uses the strict parser
// ---------------------------------------------------------------------------
test("M11-09: a duplicate-key manifest is rejected by the promote replay probe", async () => {
  const { root, skillsRoot } = await freshRoots();
  try {
    const content = "# Dup Key\n\napproved bytes\n";
    await promoteApprovedSkillWithLock({
      skillsRoot,
      namespace: ["office"],
      capability: "dup-key",
      version: "1.0.0",
      content,
      requestingActor: "excel",
      decisionRef: "PLAN:M11/T1-R1",
    });
    const manifestPath = path.join(
      skillsRoot,
      "office",
      "dup-key",
      "1.0.0",
      "manifest.json",
    );
    const text = await readFile(manifestPath, "utf8");
    const duplicated = text.replace(
      '"schema_version": 1,',
      '"schema_version": 1, "schema_version": 1,',
    );
    assert.notEqual(duplicated, text, "the duplicate injection must apply");
    await writeFile(manifestPath, duplicated, "utf8");

    // Lax JSON.parse (last-key-wins) would have answered ALREADY_ACTIVE here.
    await assert.rejects(
      () =>
        promoteApprovedSkillWithLock({
          skillsRoot,
          namespace: ["office"],
          capability: "dup-key",
          version: "1.0.0",
          content,
          requestingActor: "excel",
          decisionRef: "PLAN:M11/T1-R1",
        }),
      (error) => error.code === "SKILL_VERSION_CONFLICT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// M11-10 (2.3): rejection transitions run under the same store lock
// ---------------------------------------------------------------------------
test("M11-10: rejection requires the store root and marks the proposal REJECTED", async () => {
  const decided = await proposedFixture();
  const { root, base } = decided;
  try {
    await assert.rejects(
      () =>
        handleOwnerSkillRejection({
          ownerDiscordId: OWNER,
          expectedOwnerId: OWNER,
          proposalId: base.proposalId,
          proposalStorageDir: base.proposalStorageDir,
        }),
      /SKILLS_ROOT_REQUIRED/u,
      "an unlocked rejection cannot be proven against the store",
    );
    const rejected = await handleOwnerSkillRejection({
      ownerDiscordId: OWNER,
      expectedOwnerId: OWNER,
      proposalId: base.proposalId,
      proposalStorageDir: base.proposalStorageDir,
      skillsRoot: base.skillsRoot,
    });
    assert.equal(rejected.approval_status, "REJECTED");
    const stored = JSON.parse(
      await readFile(
        path.join(base.proposalStorageDir, `${base.proposalId}.json`),
        "utf8",
      ),
    );
    assert.equal(stored.status, "REJECTED");
    await assert.rejects(
      () =>
        handleOwnerSkillRejection({
          ownerDiscordId: OWNER,
          expectedOwnerId: OWNER,
          proposalId: base.proposalId,
          proposalStorageDir: base.proposalStorageDir,
          skillsRoot: base.skillsRoot,
        }),
      /APPROVAL_ALREADY_DECIDED/u,
    );
    // A rejected candidate can never be approved afterwards.
    await assert.rejects(
      () =>
        handleOwnerSkillApproval({
          ...base,
          decisionRef: "PLAN:M11/T1-R1",
        }),
      /APPROVAL_PROPOSAL_REJECTED/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// M11-11: dead code removal (2.1/2.2)
// ---------------------------------------------------------------------------
test("M11-11: unwired reconciliation and dead manifest reads are removed", () => {
  // Code-only: explanatory comments legitimately name the removed patterns,
  // so a raw-source assertion would match the prose rather than the code.
  const vs = code(readFileSync(VECTOR_SYNC_PATH, "utf8"));
  assert.doesNotMatch(vs, /export async function reconcileVectorSync/u);
  assert.doesNotMatch(vs, /manifest\.verification/u);
  assert.doesNotMatch(vs, /manifest\.metadata\?\.tags/u);

  const adapterSrc = code(readFileSync(ADAPTER_PATH, "utf8"));
  assert.doesNotMatch(adapterSrc, /manifest\?\.metadata\?\.description/u);
  assert.doesNotMatch(adapterSrc, /metadata\?\.description/u);

  const cat = code(readFileSync(CATALOG_PATH, "utf8"));
  assert.doesNotMatch(cat, /JSON\.parse\(\s*new TextDecoder/u);
});

// ---------------------------------------------------------------------------
// F-064 (R1-A10-01): a superseded version must never hide the ACTIVE one
// ---------------------------------------------------------------------------
test("F-064: read/apply/validate resolve the ACTIVE version when a superseded one coexists", async () => {
  const { root, skillsRoot } = await freshRoots();
  try {
    // 1.0.0 was retired (CANDIDATE,ACTIVE,DEPRECATED) and sorts BEFORE 2.0.0
    // by relative path, so a resolver that takes the first path match
    // resolves the retired record and the ACTIVE version becomes unreachable:
    // the read/apply gate then refuses with SKILL_NOT_ACTIVE and the skill
    // silently disappears from the apply boundary.
    const writeVersion = async (version, status, body) => {
      const dir = path.join(
        skillsRoot,
        "office",
        "rotating-capability",
        version,
      );
      await mkdir(dir, { recursive: true });
      const lifecycle = [
        { status: "CANDIDATE", at: "2026-10-01T00:00:00Z", actor: "excel" },
        {
          status: "ACTIVE",
          at: "2026-10-01T01:00:00Z",
          actor: "owner",
          decision_ref: "PLAN:M11/T1-R1",
        },
      ];
      if (status === "DEPRECATED") {
        lifecycle.push({
          status: "DEPRECATED",
          at: "2026-10-02T00:00:00Z",
          actor: "owner",
          decision_ref: "PLAN:M11/T1-R1",
        });
      }
      await writeFile(path.join(dir, "SKILL.md"), body, "utf8");
      await writeFile(
        path.join(dir, "manifest.json"),
        JSON.stringify(
          {
            schema_version: 1,
            identity: {
              namespace: ["office"],
              capability: "rotating-capability",
              version,
            },
            content: { path: "SKILL.md", sha256: sha(body) },
            provenance: { source_type: "research", references: [] },
            lifecycle,
          },
          null,
          2,
        ),
        "utf8",
      );
    };

    const retiredBody = "# Rotating\n\nThe retired 1.0.0 body.\n";
    const activeBody = "# Rotating\n\nThe current 2.0.0 body.\n";
    await writeVersion("1.0.0", "DEPRECATED", retiredBody);
    await writeVersion("2.0.0", "ACTIVE", activeBody);

    const catalog = await scanCatalog(skillsRoot);
    assert.equal(
      catalog.errors.length,
      0,
      `both versions must be valid records: ${JSON.stringify(catalog.errors)}`,
    );
    assert.equal(catalog.records.length, 2);

    const adapter = new SkillAdapter(skillsRoot, { skillsRoot });
    for (const action of ["read", "apply", "validate"]) {
      const result = await adapter.querySkillStore({
        action,
        skill_id: "office/rotating-capability",
      });
      assert.equal(result.governed_status, "SUCCESS", `${action} must succeed`);
      assert.equal(
        result.skill_content.version,
        "2.0.0",
        `${action} must resolve the ACTIVE version, not the superseded one`,
      );
      assert.equal(result.skill_content.lifecycle_state, "ACTIVE");
      assert.equal(
        result.skill_content.content,
        activeBody,
        `${action} must serve the ACTIVE version's bytes`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// M12/T9 F-095 (R5-E04-05) / H8 - the governed DEPRECATED retirement
// ---------------------------------------------------------------------------
//
// The owner could not withdraw a wrong skill through ANY supported path: the
// first ACTIVE version froze the capability forever, and the only route was
// out-of-band tree editing - precisely the path the audit forbids.
//
// This case pins the governed route: an owner-confirmed retirement, taken
// under the store-wide writer lock through the store's public door, appends
// the third lifecycle event (`CANDIDATE,ACTIVE,DEPRECATED` - the sequence
// `scanCatalog` already accepts) and lets the successor version promote.
test("F-095: the governed retirement withdraws the wrong version and the successor promotes", async () => {
  const { root, skillsRoot } = await freshRoots();
  try {
    await promoteApprovedSkillWithLock({
      skillsRoot,
      namespace: ["office"],
      capability: "wrong-skill",
      version: "1.0.0",
      content: "# Wrong\n\nthe wrong bytes\n",
      requestingActor: "excel",
      decisionRef: "PLAN:M11/T1-R1",
    });

    // While the wrong version is ACTIVE, its successor is refused.
    await assert.rejects(
      () =>
        promoteApprovedSkillWithLock({
          skillsRoot,
          namespace: ["office"],
          capability: "wrong-skill",
          version: "2.0.0",
          content: "# Right\n\nthe right bytes\n",
          requestingActor: "excel",
          decisionRef: "PLAN:M11/T1-R1",
        }),
      (error) => error.code === "SKILL_ACTIVE_CONFLICT",
    );

    // The governed retirement: an owner decision, inside the store writer lock.
    const retired = await withSkillStoreWriterLock(skillsRoot, () =>
      STORE_DOOR.retireSkill({
        skillsRoot,
        namespace: ["office"],
        capability: "wrong-skill",
        version: "1.0.0",
        decisionRef: "PLAN:M12/T9-R3",
      }),
    );
    assert.equal(retired.status, "DEPRECATED");

    // The durable record carries CANDIDATE, ACTIVE, DEPRECATED, and the
    // catalog accepts the retired record.
    const scan = await scanCatalog(skillsRoot);
    assert.deepEqual(
      scan.errors,
      [],
      "a retired record must stay a valid catalog record",
    );
    const record = scan.records.find(
      (entry) => entry.manifest.identity.version === "1.0.0",
    );
    assert.deepEqual(
      record.manifest.lifecycle.map((event) => event.status),
      ["CANDIDATE", "ACTIVE", "DEPRECATED"],
    );
    assert.equal(
      record.manifest.lifecycle.at(-1).decision_ref,
      "PLAN:M12/T9-R3",
      "the retirement must cite the decision that authorized it",
    );

    // The successor promotes now.
    const promoted = await promoteApprovedSkillWithLock({
      skillsRoot,
      namespace: ["office"],
      capability: "wrong-skill",
      version: "2.0.0",
      content: "# Right\n\nthe right bytes\n",
      requestingActor: "excel",
      decisionRef: "PLAN:M11/T1-R1",
    });
    assert.equal(promoted.status, "ACTIVE");
    const after = await scanCatalog(skillsRoot);
    assert.deepEqual(after.errors, []);
    assert.equal(after.records.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-095: the retirement refuses an unlocked call, an unknown version and a version that is not ACTIVE", async () => {
  const { root, skillsRoot } = await freshRoots();
  try {
    await promoteApprovedSkillWithLock({
      skillsRoot,
      namespace: ["office"],
      capability: "guarded-skill",
      version: "1.0.0",
      content: "# Guarded\n\nbytes\n",
      requestingActor: "excel",
      decisionRef: "PLAN:M11/T1-R1",
    });

    // The public door refuses an unlocked retirement, exactly like the
    // promotion: the retirement is a canonical write and needs the lock.
    await assert.rejects(
      () =>
        STORE_DOOR.retireSkill({
          skillsRoot,
          namespace: ["office"],
          capability: "guarded-skill",
          version: "1.0.0",
          decisionRef: "PLAN:M12/T9-R3",
        }),
      (error) => error.code === "SKILL_STORE_WRITER_LOCK_REQUIRED",
    );

    await withSkillStoreWriterLock(skillsRoot, async () => {
      // An unknown version is refused.
      await assert.rejects(
        () =>
          STORE_DOOR.retireSkill({
            skillsRoot,
            namespace: ["office"],
            capability: "guarded-skill",
            version: "9.9.9",
            decisionRef: "PLAN:M12/T9-R3",
          }),
        (error) => error.code === "SKILL_VERSION_NOT_FOUND",
      );

      // An ungoverned decision is refused: a retirement without a decision
      // reference is not a governed act.
      await assert.rejects(
        () =>
          STORE_DOOR.retireSkill({
            skillsRoot,
            namespace: ["office"],
            capability: "guarded-skill",
            version: "1.0.0",
            decisionRef: "because",
          }),
        (error) => error.code === "DECISION_REF_INVALID",
      );

      // The first retirement succeeds ...
      const retired = await STORE_DOOR.retireSkill({
        skillsRoot,
        namespace: ["office"],
        capability: "guarded-skill",
        version: "1.0.0",
        decisionRef: "PLAN:M12/T9-R3",
      });
      assert.equal(retired.status, "DEPRECATED");

      // ... and a second one is refused: a retired version is not ACTIVE.
      await assert.rejects(
        () =>
          STORE_DOOR.retireSkill({
            skillsRoot,
            namespace: ["office"],
            capability: "guarded-skill",
            version: "1.0.0",
            decisionRef: "PLAN:M12/T9-R3",
          }),
        (error) => error.code === "SKILL_NOT_ACTIVE",
      );
    });

    // The record carries exactly one DEPRECATED event.
    const scan = await scanCatalog(skillsRoot);
    assert.deepEqual(scan.errors, []);
    assert.deepEqual(
      scan.records[0].manifest.lifecycle.map((event) => event.status),
      ["CANDIDATE", "ACTIVE", "DEPRECATED"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
