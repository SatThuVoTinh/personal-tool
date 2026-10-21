// M12/T9 F-176 — name the store before it is synced or tombstoned.
//
// A valid `skillsRoot` that points at a DIFFERENT empty store still tombstones
// the intended store: the sync deletes every row of the derived index it
// finds, because nothing in the sync contract says WHICH store the caller
// means. Measured at HEAD, an empty store issues
//
//   DELETE FROM skills.catalog_index WHERE status = 'ACTIVE'
//     AND (...) NOT IN (SELECT unnest('{}'::text[]));
//
// which removes EVERY active derived row.
//
// The owner's ruling ("Bắt buộc ghi tên kho") is that the store carries an
// identity and the sync is told which store it is talking to:
//
//   - the store's own identity lives in a small file BESIDE its root (the
//     same convention as the writer lock: a file INSIDE the scanned root
//     would poison the catalog grammar);
//   - the sync call takes an OPTIONAL expected identity;
//   - a named store that does not carry the expected identity is REFUSED
//     with a named code and NOTHING is deleted;
//   - an unnamed EMPTY store is not tombstoned either: the zero-row tombstone
//     needs an explicit opt-in, or a confirmed identity.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "..");
const { syncSkillsToVectorStore } = await import(
  pathToFileURL(path.join(REPO, "zink-skill-store", "src", "vector-sync.mjs"))
    .href
);
const { skillStoreIdentityPath } = await import(
  pathToFileURL(path.join(REPO, "zink-skill-store", "src", "catalog.mjs")).href
);

const STORE_ID = "zink-canonical-skill-store";

/** One ACTIVE skill, so the store is not empty. */
async function seedActiveSkill(root, capability, content) {
  const dir = path.join(root, "office", capability, "1.0.0");
  await mkdir(dir, { recursive: true });
  const sha = createHash("sha256").update(content, "utf8").digest("hex");
  await writeFile(path.join(dir, "SKILL.md"), content, "utf8");
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        schema_version: 1,
        identity: {
          namespace: ["office"],
          capability,
          version: "1.0.0",
        },
        content: { path: "SKILL.md", sha256: sha },
        provenance: { source_type: "research", references: [] },
        lifecycle: [
          {
            status: "CANDIDATE",
            at: "2026-09-17T00:00:00Z",
            actor: "excel",
          },
          {
            status: "ACTIVE",
            at: "2026-09-17T01:00:00Z",
            actor: "owner",
            decision_ref: "PLAN:M12/T9-R1",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
}

/** A store root plus the identity file that names it. */
async function namedStore(storeId = STORE_ID) {
  const root = await mkdtemp(path.join(os.tmpdir(), "f176-store-"));
  const identityFile = skillStoreIdentityPath(root);
  await writeFile(
    identityFile,
    `${JSON.stringify({ schema_version: 1, store_id: storeId }, null, 2)}\n`,
    "utf8",
  );
  return { root, identityFile, storeId };
}

/** Run a sync and capture every statement it issues. */
async function sync(root, options = {}) {
  const statements = [];
  const report = await syncSkillsToVectorStore({
    skillsRoot: root,
    embedFn: async (texts) => texts.map(() => new Array(1024).fill(0.01)),
    dbExecutor: async (sql) => {
      statements.push(sql);
      return "";
    },
    ...options,
  });
  return { report, statements };
}

const isTombstone = (sql) => sql.includes("DELETE FROM skills.catalog_index");

// ---------------------------------------------------------------------------
// The identity's home
// ---------------------------------------------------------------------------
test("F-176: the store's identity lives beside its root, never inside the scanned tree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f176-path-"));
  try {
    const identityFile = skillStoreIdentityPath(root);
    assert.ok(
      !path.resolve(identityFile).startsWith(path.resolve(root) + path.sep),
      "a file inside the scanned root would poison the catalog grammar",
    );
    assert.equal(
      path.basename(identityFile),
      `${path.basename(root)}.store-identity.json`,
      "the identity file is named after the root it identifies",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The lanes the owner's ruling names
// ---------------------------------------------------------------------------
test("F-176: the same store with the same identity syncs", async () => {
  const { root, identityFile } = await namedStore();
  try {
    await seedActiveSkill(root, "named-skill", "# Named\n\nBody.");
    const { report, statements } = await sync(root, {
      expectedStoreId: STORE_ID,
    });
    assert.equal(report.status, "READY");
    assert.equal(report.error_code, undefined);
    assert.ok(
      statements.some(isTombstone),
      "a confirmed store keeps the ordinary tombstone",
    );
    assert.equal(report.tombstone_status, "APPLIED");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(identityFile, { force: true });
  }
});

test("F-176: a store with a DIFFERENT identity is refused and nothing is deleted", async () => {
  const { root, identityFile } = await namedStore("another-store");
  try {
    await seedActiveSkill(root, "named-skill", "# Named\n\nBody.");
    const { report, statements } = await sync(root, {
      expectedStoreId: STORE_ID,
    });
    assert.equal(report.status, "FAILED");
    assert.equal(report.error_code, "SKILL_STORE_IDENTITY_MISMATCH");
    assert.deepEqual(
      statements,
      [],
      "a refused sync must not reach the database at all",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(identityFile, { force: true });
  }
});

test("F-176: a store that carries NO identity is refused when the caller names one", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f176-unnamed-"));
  try {
    await seedActiveSkill(root, "named-skill", "# Named\n\nBody.");
    const { report, statements } = await sync(root, {
      expectedStoreId: STORE_ID,
    });
    assert.equal(report.status, "FAILED");
    assert.equal(report.error_code, "SKILL_STORE_IDENTITY_MISMATCH");
    assert.deepEqual(statements, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-176: an unnamed store with rows syncs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f176-rows-"));
  try {
    await seedActiveSkill(root, "rows-skill", "# Rows\n\nBody.");
    const { report, statements } = await sync(root);
    assert.equal(report.status, "READY");
    assert.ok(
      statements.some(isTombstone),
      "an unnamed store with rows keeps the ordinary tombstone",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-176: an unnamed EMPTY store is refused rather than tombstoned", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f176-empty-"));
  try {
    const { report, statements } = await sync(root);
    assert.equal(
      report.status,
      "READY",
      "the sync itself still succeeds: an empty catalog is a valid catalog",
    );
    assert.equal(
      report.tombstone_status,
      "REFUSED",
      "the zero-row tombstone must be refused without a confirmed identity",
    );
    assert.equal(report.tombstone_error_code, "SKILL_STORE_IDENTITY_UNNAMED");
    assert.ok(
      !statements.some(isTombstone),
      `nothing may be tombstoned: ${JSON.stringify(statements).slice(0, 400)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-176: a store that names ITSELF is still not tombstoned while it is empty", async () => {
  const { root, identityFile } = await namedStore();
  try {
    const { report, statements } = await sync(root);
    assert.equal(report.tombstone_status, "REFUSED");
    assert.equal(report.tombstone_error_code, "SKILL_STORE_IDENTITY_UNNAMED");
    assert.ok(!statements.some(isTombstone));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(identityFile, { force: true });
  }
});

test("F-176: the explicit opt-in is the only way an unnamed empty store is tombstoned", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f176-optin-"));
  try {
    const { report, statements } = await sync(root, {
      allowUnnamedEmptyTombstone: true,
    });
    assert.equal(report.status, "READY");
    assert.equal(report.tombstone_status, "APPLIED");
    assert.ok(
      statements.some(isTombstone),
      "the opt-in must restore the tombstone",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-176: an unreadable identity file carries no identity and never authorizes a tombstone", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f176-malformed-"));
  const identityFile = skillStoreIdentityPath(root);
  try {
    await writeFile(identityFile, "{not json", "utf8");
    const { report, statements } = await sync(root, {
      expectedStoreId: STORE_ID,
    });
    assert.equal(report.status, "FAILED");
    assert.equal(report.error_code, "SKILL_STORE_IDENTITY_MISMATCH");
    assert.deepEqual(statements, []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(identityFile, { force: true });
  }
});

test("F-176: the identity file beside the root does not disturb the catalog scan", async () => {
  const { root, identityFile } = await namedStore();
  try {
    await seedActiveSkill(root, "scanned-skill", "# Scanned\n\nBody.");
    const { report } = await sync(root, { expectedStoreId: STORE_ID });
    assert.equal(report.status, "READY");
    assert.equal(report.scanned_count, 1);
    assert.ok(existsSync(identityFile));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(identityFile, { force: true });
  }
});
