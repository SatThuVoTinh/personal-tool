// M11/T1 Phase 1 — skill-store vector SQL correctness.
//
// The derived-index SQL in zink-skill-store/src/vector-sync.mjs had never
// executed against real PostgreSQL (every prior test mocked the executor).
// These tests pin the statements the sync generates and refuse to accept any
// shape PostgreSQL rejects: brace array literals inside ARRAY[...], unescaped
// single quotes, per-segment non-transactional writes, and startsWith-based
// model identity.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";

import {
  syncSkillsToVectorStore,
  generateSkillEmbeddings,
  chunkSkillContent,
  toPostgresArrayLiteral,
  escapeSqlLiteral,
  executePostgresQuery,
  validatePostgresContainerName,
  withServerSideTimeout,
  EXPECTED_DIMENSIONS,
  EXPECTED_MODEL_DIGEST,
  MAX_EMBEDDING_PAYLOAD_BYTES,
} from "../zink-skill-store/src/vector-sync.mjs";
import {
  applySkillStoreMigrations,
  SKILL_STORE_MIGRATIONS_DIR,
  SKILL_STORE_DIGEST_MANIFEST,
} from "../zink-skill-store/src/migrations.mjs";

const embedFn = async (texts) =>
  texts.map(() => new Array(EXPECTED_DIMENSIONS).fill(0.01));

async function makeActiveSkill(root, namespace, capability, contentText) {
  const dir = path.join(root, ...namespace, capability, "1.0.0");
  await mkdir(dir, { recursive: true });
  const sha = createHash("sha256").update(contentText, "utf8").digest("hex");
  const manifest = {
    schema_version: 1,
    identity: { namespace, capability, version: "1.0.0" },
    content: { path: "SKILL.md", sha256: sha },
    provenance: { source_type: "research", references: [] },
    lifecycle: [
      { status: "CANDIDATE", at: "2026-10-01T00:00:00Z", actor: "excel" },
      {
        status: "ACTIVE",
        at: "2026-10-01T01:00:00Z",
        actor: "owner",
        decision_ref: "PLAN:M11/T1-R1",
      },
    ],
  };
  await writeFile(path.join(dir, "SKILL.md"), contentText, "utf8");
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  return sha;
}

/**
 * A dollar-quoted block must open and close with the SAME tag, and the tag
 * must not occur inside the block: PostgreSQL ends the string at the first
 * matching tag, so a stray `$$` in untrusted text closed the block early and
 * the statement was a syntax error.
 */
function assertWellFormedDollarQuote(sql, label) {
  const opening = sql.match(/DO (\$[A-Za-z0-9_]*\$)/u);
  assert.ok(opening, `${label} must open with a dollar-quote tag`);
  const tag = opening[1];
  assert.notEqual(
    tag,
    "$$",
    `${label} must not use the anonymous tag: untrusted text can carry it`,
  );
  assert.equal(
    sql.split(tag).length - 1,
    2,
    `${label} must open and close with ${tag} exactly once`,
  );
  assert.ok(
    sql.includes(`END ${tag};`),
    `${label} must close with the tag it opened with`,
  );
}

async function makeRetiredSkill(root, namespace, capability, contentText) {
  const dir = path.join(root, ...namespace, capability, "1.0.0");
  await mkdir(dir, { recursive: true });
  const sha = createHash("sha256").update(contentText, "utf8").digest("hex");
  const manifest = {
    schema_version: 1,
    identity: { namespace, capability, version: "1.0.0" },
    content: { path: "SKILL.md", sha256: sha },
    provenance: { source_type: "research", references: [] },
    lifecycle: [
      { status: "CANDIDATE", at: "2026-10-01T00:00:00Z", actor: "excel" },
      {
        status: "ACTIVE",
        at: "2026-10-01T01:00:00Z",
        actor: "owner",
        decision_ref: "PLAN:M11/T1-R1",
      },
      {
        status: "DEPRECATED",
        at: "2026-10-02T00:00:00Z",
        actor: "owner",
        decision_ref: "PLAN:M11/T1-R2",
      },
    ],
  };
  await writeFile(path.join(dir, "SKILL.md"), contentText, "utf8");
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  return sha;
}

async function runSyncCapturing(contentText) {
  const root = await mkdtemp(path.join(os.tmpdir(), "m11-sql-"));
  try {
    await makeActiveSkill(root, ["office"], "capture-skill", contentText);
    const statements = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn,
      dbExecutor: async (sql) => {
        statements.push(sql);
        return "";
      },
    });
    return { report, statements };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("M11-01: array literal follows the PostgreSQL grammar (backslash escapes, control refusal)", () => {
  assert.equal(toPostgresArrayLiteral([]), "{}");
  assert.equal(toPostgresArrayLiteral(["plain"]), '{"plain"}');
  // Inside a double-quoted array item, `"` and `\` escape with a BACKSLASH.
  // The pre-fix implementation doubled the quote, which PostgreSQL reads as
  // two literal quote characters.
  assert.equal(toPostgresArrayLiteral(['O"l\\']), '{"O\\"l\\\\"}');
  assert.throws(
    () => toPostgresArrayLiteral(["bad\u0007bell"]),
    /ARRAY_LITERAL_CONTROL_CHARACTER/u,
  );
});

test("M11-02: tombstone is a valid statement scoped to the derived index", async () => {
  const { report, statements } = await runSyncCapturing(
    "# Capture\n\nHeaded body.",
  );
  assert.equal(report.status, "READY");
  const tombstone = statements[0];
  // The pre-fix shape `unnest(ARRAY[{"a"}]::text[])` is a syntax error in
  // PostgreSQL: a brace array literal is only legal as a quoted string.
  assert.ok(
    !tombstone.includes("ARRAY[{"),
    `tombstone must not embed a brace literal in ARRAY[]: ${tombstone}`,
  );
  assert.ok(
    tombstone.includes(
      `unnest(${escapeSqlLiteral('{"office|capture-skill|1.0.0"}')}::text[])`,
    ),
    "tombstone key set must be a properly quoted, escaped array literal",
  );
  // Schema 003 only admits status ('ACTIVE') and sync_status
  // ('PENDING','READY','FAILED'): the derived row is REMOVED, never marked
  // DEPRECATED/TOMBSTONED. Canonical lifecycle truth lives in the catalog.
  assert.match(tombstone, /DELETE FROM skills\.catalog_index/u);
  assert.ok(!/DEPRECATED|TOMBSTONED/.test(tombstone));
});

test("M11-03: one atomic transaction per skill, READY set only after all segments", async () => {
  const { report, statements } = await runSyncCapturing(
    "# Owner's \"weird\" rule\n\nBody with an apostrophe ' and a backslash \\.",
  );
  assert.equal(report.status, "READY");
  const skillStatements = statements.filter((s) =>
    s.includes("INSERT INTO skills.segments"),
  );
  assert.equal(
    skillStatements.length,
    1,
    "exactly one spawn per skill regardless of segment count",
  );
  const sql = skillStatements[0];
  assert.ok(/BEGIN;/u.test(sql) && /COMMIT;/u.test(sql));
  const readyAt = sql.indexOf(`'READY'`);
  const insertAt = sql.indexOf("INSERT INTO skills.segments");
  assert.ok(
    readyAt > insertAt,
    "sync_status READY must be written after the segment inserts",
  );
  // Heading quotes/backslashes: array grammar inside, SQL doubling outside.
  assert.ok(
    sql.includes(`'{"Owner''s \\"weird\\" rule"}'::text[]`),
    `heading literal must survive both escape layers: ${sql}`,
  );
  // Digest literals are the content hash, quoted as text.
  const hex = createHash("sha256")
    .update(
      "# Owner's \"weird\" rule\n\nBody with an apostrophe ' and a backslash \\.",
      "utf8",
    )
    .digest("hex");
  assert.ok(sql.includes(`'${hex}'`));
  assert.match(sql, /source_sha256/u);
});

/**
 * The tombstone statement, identified by its ROLE and not by the text it
 * happens to contain.
 *
 * The failure injection used to match the SQL source text
 * (`sql.includes("DELETE FROM skills.catalog_index")`). That binding made the
 * coverage of BOTH refusal paths depend on one table name: a rewording of the
 * tombstone changed which statement the executor refused, and the tombstone
 * refusal path (`VECTOR_TOMBSTONE_SYNC_FAILED`) was never exercised at all —
 * the case named the tombstone and only ever proved the secondary write
 * refusal. The role binding keeps the injection on the tombstone whatever the
 * text becomes, and the two cases below cover the two paths separately.
 */
function isTombstoneStatement(sql) {
  return /^\s*DELETE\b/iu.test(String(sql ?? ""));
}

test("M11-04: failure escalation — a failed failSql is surfaced, not swallowed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m11-fail-"));
  try {
    await makeActiveSkill(
      root,
      ["office"],
      "broken-skill",
      "# Broken\n\nBody.",
    );
    const received = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn,
      dbExecutor: async (sql) => {
        received.push(sql);
        // The tombstone is the only statement allowed to succeed, so the
        // refusal lands on the secondary failure write.
        if (isTombstoneStatement(sql)) return "";
        throw new Error("PSQL_REJECTED_SIMULATION");
      },
    });
    assert.equal(report.status, "FAILED");
    assert.equal(report.failed_count, 1);
    assert.equal(report.error_code, "VECTOR_FAILURE_WRITE_FAILED");
    assert.ok(
      report.skills[0].error.includes("PSQL_REJECTED_SIMULATION"),
      "the primary failure reason must remain visible",
    );
    // The exact SQL the failing executor received is asserted, so the refusal
    // is provably the failure write and the tombstone is provably untouched.
    // M12/T9-R4 F-574: the derived index now has TWO deletion statements with
    // different roles — the ACTIVE tombstone and the terminal-row reclamation
    // — so the role this case pins is selected by its predicate, not by
    // "any DELETE".
    const tombstones = received.filter(
      (sql) => isTombstoneStatement(sql) && /status = 'ACTIVE'/u.test(sql),
    );
    assert.equal(
      tombstones.length,
      1,
      "exactly one ACTIVE tombstone statement is issued",
    );
    assert.match(
      tombstones[0],
      /DELETE\s+FROM\s+skills\.catalog_index/iu,
      `the surviving tombstone must still be the derived-index delete: ${tombstones[0]}`,
    );
    const refused = received.filter((sql) => !isTombstoneStatement(sql));
    assert.ok(
      refused.length >= 1,
      "the failure write must have reached the executor and been refused",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M11-04b: a refused tombstone is surfaced, not swallowed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m11-fail-tombstone-"));
  try {
    await makeActiveSkill(
      root,
      ["office"],
      "broken-skill",
      "# Broken\n\nBody.",
    );
    const received = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn,
      dbExecutor: async (sql) => {
        received.push(sql);
        if (isTombstoneStatement(sql)) {
          throw new Error("PSQL_REJECTED_SIMULATION");
        }
        return "";
      },
    });
    assert.equal(report.status, "FAILED");
    assert.equal(report.error_code, "VECTOR_TOMBSTONE_SYNC_FAILED");
    assert.equal(report.failed_count, 1);
    assert.ok(
      String(report.error ?? "").includes("PSQL_REJECTED_SIMULATION"),
      "the tombstone refusal reason must remain visible",
    );
    const refused = received.filter(isTombstoneStatement);
    assert.equal(
      refused.length,
      1,
      "exactly one tombstone statement is issued",
    );
    assert.match(
      refused[0],
      /DELETE\s+FROM\s+skills\.catalog_index/iu,
      `the refused statement must be the derived-index tombstone: ${refused[0]}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M11-05: embedding identity is exact, and a chunked oversized body is still capped", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const jsonResponse =
      (payload, headers = {}) =>
      async () => ({
        ok: true,
        status: 200,
        headers: { get: (k) => headers[k.toLowerCase()] ?? null },
        text: async () => JSON.stringify(payload),
      });
    const vectors = [new Array(EXPECTED_DIMENSIONS).fill(0.01)];

    // Exact configured name passes.
    globalThis.fetch = jsonResponse({
      model: "bge-m3:latest",
      embeddings: vectors,
    });
    const ok = await generateSkillEmbeddings(["t"], {
      ollamaUrl: "http://127.0.0.1:11434",
    });
    assert.equal(ok.length, 1);

    // A startsWith sibling used to pass; now identity must match exactly.
    globalThis.fetch = jsonResponse({
      model: "bge-m3-tampered",
      embeddings: vectors,
    });
    await assert.rejects(
      () =>
        generateSkillEmbeddings(["t"], {
          ollamaUrl: "http://127.0.0.1:11434",
        }),
      /EMBEDDING_MODEL_MISMATCH/u,
    );

    // When the endpoint reports a version, it must equal the pinned digest.
    globalThis.fetch = jsonResponse({
      model: "bge-m3:latest",
      model_version: "sha256:" + "0".repeat(64),
      embeddings: vectors,
    });
    await assert.rejects(
      () =>
        generateSkillEmbeddings(["t"], {
          ollamaUrl: "http://127.0.0.1:11434",
        }),
      /EMBEDDING_MODEL_DIGEST_MISMATCH/u,
    );
    globalThis.fetch = jsonResponse({
      model: "bge-m3:latest",
      model_version: EXPECTED_MODEL_DIGEST,
      embeddings: vectors,
    });
    const pinned = await generateSkillEmbeddings(["t"], {
      ollamaUrl: "http://127.0.0.1:11434",
    });
    assert.equal(pinned[0].length, EXPECTED_DIMENSIONS);

    // No content-length header (chunked transfer) must still be capped.
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => "x".repeat(MAX_EMBEDDING_PAYLOAD_BYTES + 1),
    });
    await assert.rejects(
      () =>
        generateSkillEmbeddings(["t"], {
          ollamaUrl: "http://127.0.0.1:11434",
        }),
      /EMBEDDING_PAYLOAD_TOO_LARGE/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ===========================================================================
// M12/T2.2-R1 A-7 — the owner's choice (a) is that NO re-embed skip exists, and
// the reason is structural: the only embedding model-identity checks in this
// path (`EMBEDDING_MODEL_MISMATCH`, `EMBEDDING_MODEL_DIGEST_MISMATCH`, the
// dimension check) live inside `generateSkillEmbeddings`, i.e. inside the HTTP
// call a skip would avoid. These two tests keep that decision honest: one counts
// real work, one pins the shape so a later "optimization" cannot land silently.
// ===========================================================================

const SYNC_SOURCE = readFileSync(
  new URL("../zink-skill-store/src/vector-sync.mjs", import.meta.url),
  "utf8",
);

test("A7-1: every stored segment is embedded — the sync issues no skip", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m11-a7-skip-"));
  try {
    await makeActiveSkill(
      root,
      ["office"],
      "alpha-skill",
      "# Alpha\n\nFirst body.",
    );
    // Long enough to chunk into several segments: with one segment per skill the
    // embed-per-write equality below would hold trivially and prove nothing.
    await makeActiveSkill(
      root,
      ["data", "power-bi"],
      "beta-skill",
      `# Beta\n\n${"Second body, repeated so the chunker has to split it. ".repeat(400)}`,
    );
    const embedInputs = [];
    const statements = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn: async (texts) => {
        for (const text of texts) embedInputs.push(text);
        return texts.map(() => new Array(EXPECTED_DIMENSIONS).fill(0.01));
      },
      dbExecutor: async (sql) => {
        statements.push(sql);
        return "";
      },
    });
    // M11/T1 writes one whole-skill transaction per skill, with all segments in
    // a single `(VALUES …)` list, so counting statements compares 2 against 4.
    // The authoritative segment count is the chunker's own answer for the same
    // content, and every stored vector literal is cross-checked against it.
    const expectedSegments =
      chunkSkillContent("# Alpha\n\nFirst body.").length +
      chunkSkillContent(
        `# Beta\n\n${"Second body, repeated so the chunker has to split it. ".repeat(400)}`,
      ).length;
    const vectorLiterals = statements.join("").split("[0.01,0.01").length;
    assert.equal(
      report.status,
      "READY",
      `sync must complete: ${JSON.stringify(report)}`,
    );
    assert.equal(report.active_count, 2, "both fixtures are ACTIVE");
    assert.ok(
      expectedSegments > 2,
      "the fixture must chunk into multiple segments",
    );
    // The load-bearing equality: one embedding call per stored segment. A
    // skip-when-unchanged path would show up as fewer embeddings than rows,
    // which is exactly what this asserts against.
    assert.equal(
      embedInputs.length,
      expectedSegments,
      `every segment must be embedded (${embedInputs.length} embeds vs ${expectedSegments} segments)`,
    );
    assert.equal(
      vectorLiterals - 1,
      expectedSegments,
      `no segment row may be written without an embedding (${vectorLiterals - 1} rows vs ${expectedSegments} embeds)`,
    );
    assert.ok(
      embedInputs.every((text) => typeof text === "string" && text.length > 0),
      "each embedding input is real content, not a placeholder",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("A7-2 pin: the embedding call is unconditional and the identity checks stay on the path", () => {
  const loopAt = SYNC_SOURCE.indexOf("for (const seg of segments) {");
  const callAt = SYNC_SOURCE.indexOf(
    "await generateSkillEmbeddings([envelopeText], options)",
    loopAt,
  );
  assert.ok(
    loopAt !== -1 && callAt !== -1,
    "the segment loop and embed call must exist",
  );
  // Comments stripped first: the WHY comment at this call site discusses the
  // refused skip, and prose must not read as control flow.
  const between = SYNC_SOURCE.slice(loopAt, callAt).replace(
    /^\s*(\/\/|\*|\/\*).*$/gmu,
    "",
  );
  assert.doesNotMatch(
    between,
    /\bif\s*\(|\bcontinue\b|\breturn\b/u,
    "no branch may sit between taking a segment and embedding it — that is where a re-embed skip would appear",
  );
  // The checks the skip would have bypassed must still be in the seam.
  for (const token of [
    "EMBEDDING_MODEL_MISMATCH",
    "EMBEDDING_MODEL_DIGEST_MISMATCH",
  ]) {
    assert.ok(
      SYNC_SOURCE.includes(token),
      `${token} must stay in generateSkillEmbeddings; it is the only model-identity protection that exists today`,
    );
  }
});

// ===========================================================================
// M12/T2.2-R3 `R3-7` — the failure row must describe the failure it records.
//
// M11/T1 made the SUCCESS path one atomic DO block; the failure path stayed a
// bare upsert that refreshed only sync_status / failure_reason / synced_at and
// never touched skills.segments. A skill whose sync had just failed therefore
// kept (1) the PREVIOUS successful sync's two digests on a row that said
// FAILED, and (2) every vector of that previous sync selectable under it. These
// assertions pin the new statement shape. The real-PostgreSQL parse and the
// segment cleanup itself are reported separately: no tracked lane executes
// failSql against a database (the scratch-DB gate's M11-06 covers only the
// READY path and the tombstone).
// ===========================================================================

test("R3-7: the failure statement refreshes both digests and clears the segments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m11-r37-"));
  try {
    const sha = await makeActiveSkill(
      root,
      ["office"],
      "capture-skill",
      "# Failing\n\nBody that never reaches a vector.",
    );
    const statements = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn: async () => {
        throw new Error("EMBEDDING_ENDPOINT_DOWN_SIMULATION");
      },
      dbExecutor: async (sql) => {
        statements.push(sql);
        return "";
      },
    });
    assert.equal(report.failed_count, 1);
    const failSql = statements.find((s) =>
      s.includes("sync_status = 'FAILED'"),
    );
    assert.ok(failSql, "the sync must still record the observable failure");

    // One atomic block, the shape the READY path already uses: the id comes
    // back from the upsert and the segment delete runs against that id, so a
    // crash cannot leave a FAILED row with its vectors behind.
    // M12/T9-R1 F-019: the block now opens and closes with a NAMED
    // dollar-quote tag, because the failure reason is untrusted text and can
    // carry `$$`. The guarantee this case pins — one atomic block — is
    // unchanged.
    assertWellFormedDollarQuote(failSql, "the FAILED block");
    assert.match(failSql, /RETURNING id INTO v_skill_id;/u);
    const deleteAt = failSql.indexOf(
      "DELETE FROM skills.segments WHERE skill_id = v_skill_id;",
    );
    assert.ok(
      deleteAt > failSql.indexOf("RETURNING id INTO v_skill_id;"),
      `the segment delete must follow the id it scopes to: ${failSql}`,
    );

    // The digests a FAILED row advertises must be the ones it failed on.
    assert.ok(
      failSql.includes("source_sha256 = EXCLUDED.source_sha256"),
      "a conflict must stop advertising the previous sync's source digest",
    );
    assert.ok(
      failSql.includes(
        "embedding_input_sha256 = EXCLUDED.embedding_input_sha256",
      ),
      "a conflict must stop advertising the previous sync's embedding digest",
    );
    assert.ok(
      failSql.includes(`'${sha}'`),
      "the carried digest is the manifest's, which the catalog enforces",
    );
    assert.equal(
      (failSql.match(/0{64}/gu) ?? []).length,
      1,
      'only embedding_input_sha256 may be the schema-forced zero digest; the old `|| "0".repeat(64)` source stand-in is gone',
    );

    // Semantics come from the contract, not from a hardcoded fallback domain
    // that would let a FAILED row claim a taxonomy it never derived.
    assert.ok(
      failSql.includes("'office'"),
      "domain/primary_topic must be the derived taxonomy for the record",
    );
    assert.ok(
      !failSql.includes("'general'"),
      "the failure row must not fabricate the default domain",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// M12/T2.2-R3 `R3-6` — a control byte in the body must be a catalog diagnostic,
// not a database error. Before this guard `escapeSqlLiteral` (quote-doubling
// only) carried `\x00` into the transaction that `buildSkillSyncTransaction`
// opens, so the failure arrived after psql had already begun one. The scan-side
// check means the sync never gets as far as a statement.
// M12/T9-R1 F-152 — a catalog with one invalid file must still retire the
// skills the owner deprecated.
//
// Before the fix the tombstone was skipped whenever the scan reported
// anything, so one malformed SKILL.md anywhere kept every previously READY
// row alive — including the rows of retired skills. The index still reported
// FRESH for up to the 7-day SLA, and the adapter kept serving skills the
// owner had retired.
//
// The narrow statement is the whole fix: it deletes the rows it can PROVE are
// retired and leaves every other row alone, so an incomplete catalog can
// never turn "not known to be active" into "deleted".
test("F-152: a retired skill is retired even when another record is invalid", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m11-f152-"));
  try {
    // A skill the owner retired ...
    await makeRetiredSkill(
      root,
      ["office"],
      "retired-skill",
      "# Retired\n\nOld.",
    );
    // ... and an unrelated record the scan rejects.
    await makeActiveSkill(
      root,
      ["office"],
      "poisoned-skill",
      "# Poisoned\n\nbefore\u0000after",
    );
    const statements = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn,
      dbExecutor: async (sql) => {
        statements.push(sql);
        return "";
      },
    });
    // The invalid catalog is still reported as such: the operator must see
    // why the sync did not complete.
    assert.equal(report.status, "FAILED");
    assert.equal(report.error_code, "CATALOG_INVALID");
    assert.ok(
      (report.details ?? []).some((e) => e.code === "INVALID_SKILL_CONTENT"),
      `the refusal must still name the byte-level diagnostic, got ${JSON.stringify(report.details)}`,
    );
    // The retirement reached the database. M12/T9-R4 F-574: it reaches it as
    // the RECORDED retirement (the marker UPDATE), not as the second DELETE
    // this branch used to issue — that DELETE could never match a row, because
    // the marker had already moved the same keys out of `status = 'ACTIVE'`.
    const retirement = statements.find((s) =>
      s.includes("sync_status = 'TOMBSTONED'"),
    );
    assert.ok(
      retirement,
      `the retirement must still reach the database: ${JSON.stringify(statements)}`,
    );
    assert.ok(
      retirement.includes("office|retired-skill|1.0.0"),
      `the retired skill must be tombstoned: ${retirement}`,
    );
    // And a row whose skill could not be read is NOT deleted: the catalog is
    // incomplete, so "not known to be active" must not mean "deleted".
    assert.ok(
      !retirement.includes("poisoned-skill"),
      `an unprovable row must not be deleted: ${retirement}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// M12/T9-R1 F-019 — a `$$` inside untrusted text must not truncate the
// dollar-quoted block.
//
// The READY transaction and the FAILED row are both `DO $$ ... $$;` blocks,
// and PostgreSQL ends a dollar-quoted string at the first matching tag. A
// skill body or a failure reason containing `$$` therefore closed the block
// early: the statement was a syntax error, the skill's whole transaction was
// refused, and the failure reason never reached the row it was written for.
test("F-019: a `$$` in the body or in the failure reason cannot truncate the block", async () => {
  // (1) The READY path: a skill body carrying `$$`.
  const ready = await mkdtemp(path.join(os.tmpdir(), "m11-f019-ready-"));
  try {
    await makeActiveSkill(
      ready,
      ["office"],
      "dollar-skill",
      "# Dollar\n\nA body that carries $$ inside it.",
    );
    const statements = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: ready,
      embedFn,
      dbExecutor: async (sql) => {
        statements.push(sql);
        return "";
      },
    });
    assert.equal(report.status, "READY");
    const transaction = statements.find((s) =>
      s.includes("INSERT INTO skills.segments"),
    );
    assert.ok(transaction, "the skill must be written");
    assertWellFormedDollarQuote(transaction, "the READY transaction");
    assert.ok(
      transaction.includes("carries $$ inside"),
      `the body must reach the statement intact: ${transaction}`,
    );
  } finally {
    await rm(ready, { recursive: true, force: true });
  }

  // (2) The FAILED path: a failure reason carrying `$$`.
  const failed = await mkdtemp(path.join(os.tmpdir(), "m11-f019-fail-"));
  try {
    await makeActiveSkill(
      failed,
      ["office"],
      "dollar-failure",
      "# Dollar\n\nA body that carries $$ inside it.",
    );
    const statements = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: failed,
      embedFn: async () => {
        throw new Error("EMBEDDING_ENDPOINT_DOWN_$$ with a $$ reason");
      },
      dbExecutor: async (sql) => {
        statements.push(sql);
        return "";
      },
    });
    assert.equal(report.failed_count, 1);
    const failure = statements.find((s) =>
      s.includes("sync_status = 'FAILED'"),
    );
    assert.ok(failure, "the failure must still be recorded");
    assertWellFormedDollarQuote(failure, "the FAILED block");
    assert.ok(
      failure.includes("with a $$ reason"),
      `the reason must reach the failure row intact: ${failure}`,
    );
  } finally {
    await rm(failed, { recursive: true, force: true });
  }
});

// M12/T9-R1 F-054 — the container name and the deadline.
//
// (1) The container name reaches `docker exec` as an argv token, where a
// leading `--` is parsed by docker as its own option. It comes from the
// environment, so it must be refused before the spawn.
// (2) Killing the `docker exec` client does not stop the query: psql is
// already inside the container and the server-side statement keeps running
// after the client reported DB_TIMEOUT. The deadline must hold where the
// work happens, so the server gets its own bound.
test("F-054: the container name is refused and the deadline reaches the server", async () => {
  // (1) The name is checked, and an invalid one never reaches docker.
  for (const name of [
    "--rm",
    "-it",
    "--version",
    "postgres;drop",
    "with space",
    "",
    null,
  ]) {
    assert.throws(
      () => validatePostgresContainerName(name),
      /POSTGRES_CONTAINER_INVALID/u,
      `${JSON.stringify(name)} must be refused`,
    );
  }
  assert.equal(
    validatePostgresContainerName("personal-tool-postgres-1"),
    "personal-tool-postgres-1",
  );
  await assert.rejects(
    () => executePostgresQuery("SELECT 1", { postgresContainer: "--rm" }),
    /POSTGRES_CONTAINER_INVALID/u,
    "the refusal must happen before the spawn",
  );

  // (2) The server-side bound is part of the statement psql receives.
  const bounded = withServerSideTimeout("SELECT 1", 30000);
  assert.ok(
    bounded.startsWith("SET statement_timeout = 30000;\n"),
    `the server must be bounded: ${bounded}`,
  );
  assert.ok(bounded.endsWith("SELECT 1"), "the caller's SQL must be preserved");
  assert.equal(
    withServerSideTimeout("SELECT 1", 0),
    "SET statement_timeout = 30000;\nSELECT 1",
    "a nonsensical deadline must fall back to the documented default",
  );
});

// M12/T9-R1 F-046 — the model identity must be REPORTED.
//
// The two guards were both conditioned on the endpoint volunteering the
// field, so a response that omitted it was a PASS: the vectors could then
// have come from any model at all, and the sync still reported READY.
test("F-046: a response that does not report its model is refused", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const jsonResponse = (payload) => async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(payload),
    });
    const vectors = [new Array(EXPECTED_DIMENSIONS).fill(0.01)];

    // No `model` at all: the endpoint did not say which model produced these.
    globalThis.fetch = jsonResponse({ embeddings: vectors });
    await assert.rejects(
      () =>
        generateSkillEmbeddings(["t"], {
          ollamaUrl: "http://127.0.0.1:11434",
        }),
      /EMBEDDING_MODEL_UNREPORTED/u,
    );

    // A different model: refused, as before.
    globalThis.fetch = jsonResponse({
      model: "bge-m3-tampered",
      embeddings: vectors,
    });
    await assert.rejects(
      () =>
        generateSkillEmbeddings(["t"], {
          ollamaUrl: "http://127.0.0.1:11434",
        }),
      /EMBEDDING_MODEL_MISMATCH/u,
    );

    // The exact model: accepted.
    globalThis.fetch = jsonResponse({
      model: "bge-m3:latest",
      embeddings: vectors,
    });
    const ok = await generateSkillEmbeddings(["t"], {
      ollamaUrl: "http://127.0.0.1:11434",
    });
    assert.equal(ok.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("R3-6: a control-byte body is refused by the scan before any SQL runs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m11-r36-"));
  try {
    await makeActiveSkill(
      root,
      ["office"],
      "nul-skill",
      "# Nul\n\nbefore\u0000after",
    );
    const issued = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn,
      dbExecutor: async (sql) => {
        issued.push(sql);
        return "";
      },
    });
    assert.equal(report.status, "FAILED");
    assert.equal(report.error_code, "CATALOG_INVALID");
    assert.ok(
      (report.details ?? []).some((e) => e.code === "INVALID_SKILL_CONTENT"),
      `the refusal must name the byte-level diagnostic, got ${JSON.stringify(report.details)}`,
    );
    assert.deepEqual(
      issued,
      [],
      "no statement of any kind may reach the database for a catalog the scan already rejects",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// M12/T9-R4 F-547 (R10-T05-4) — the published migration-digest store had ZERO
// runtime readers: the runner compared each file against the digest it had
// inserted on its own first run, so a fresh database adopted an edited
// migration silently, and `docs/contracts/skill-store/skill-store-migration-
// digests.json` was trust-on-first-use over an unpinned pin file.
//
// The pin is now the apply seam's own input: a file the published store names
// must hash to the published digest before it is applied, and a store the
// runner cannot read is a refusal, not a skipped check.
//
// Both cases are pure filesystem + a fake executor: no Postgres, no Docker.
const emptyLedgerExecutor = async () => "";

async function copyPublishedMigrations(directory) {
  const published = JSON.parse(
    readFileSync(SKILL_STORE_DIGEST_MANIFEST, "utf8"),
  );
  for (const entry of published.migrations) {
    await copyFile(
      path.join(SKILL_STORE_MIGRATIONS_DIR, entry.file),
      path.join(directory, entry.file),
    );
  }
  return published;
}

test("F-547: the exact published bytes still apply", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "f547-pin-ok-"));
  try {
    const published = await copyPublishedMigrations(dir);
    const result = await applySkillStoreMigrations({
      migrationsDir: dir,
      dbExecutor: emptyLedgerExecutor,
    });
    assert.deepEqual(
      result.applied,
      published.migrations.map((entry) => entry.file),
      "the published bytes are the bytes the runner must accept",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("F-547: an edited migration is refused by the PUBLISHED digest, not only by the ledger", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "f547-pin-bad-"));
  try {
    const published = await copyPublishedMigrations(dir);
    const target = published.migrations.at(-1).file;
    // A fresh database has an EMPTY ledger, so the recorded-digest check
    // cannot fire: this edit is exactly the case that used to be adopted.
    const original = await readFile(path.join(dir, target), "utf8");
    await writeFile(
      path.join(dir, target),
      `${original}\n-- an in-place edit no database would ever see\n`,
      "utf8",
    );
    await assert.rejects(
      () =>
        applySkillStoreMigrations({
          migrationsDir: dir,
          dbExecutor: emptyLedgerExecutor,
        }),
      (error) => {
        assert.equal(error.code, "SKILL_STORE_MIGRATION_DIGEST_UNPUBLISHED");
        assert.ok(
          error.message.includes(target),
          "the refusal must name the migration it is about",
        );
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("F-547: an unreadable published digest store refuses the apply instead of skipping the pin", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "f547-pin-missing-"));
  try {
    await copyPublishedMigrations(dir);
    await assert.rejects(
      () =>
        applySkillStoreMigrations({
          migrationsDir: dir,
          digestManifestPath: path.join(dir, "no-such-manifest.json"),
          dbExecutor: emptyLedgerExecutor,
        }),
      (error) => error.code === "SKILL_STORE_MIGRATION_MANIFEST_UNREADABLE",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// M12/T9-R4 F-509 (R10-L05-2) — the retirement state's domain postcondition.
//
// Migration 004 widens BOTH CHECK constraints on `skills.catalog_index` and
// verifies only `catalog_index_status_check`, so a surviving narrow
// `sync_status` CHECK is recorded as applied and frozen by the digest pin:
// PostgreSQL allows several CHECKs on one column and `DROP CONSTRAINT IF EXISTS`
// no-ops on a name it does not find. The widened domain is then unreachable
// while the ledger says it is migrated.
//
// This case is STATIC and non-skippable on purpose: the live proof lives in
// the `postgres` lane, whose cases may skip (F-481's ceiling), so the invariant
// needs a lane that runs on a host with no Docker daemon. It reddens when
// either domain assertion, or the "no OTHER narrow CHECK" guard, is removed.
test("F-509: the retirement-state postcondition asserts both widened domains", async () => {
  const files = (await readdir(SKILL_STORE_MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const texts = await Promise.all(
    files.map((name) =>
      readFile(path.join(SKILL_STORE_MIGRATIONS_DIR, name), "utf8"),
    ),
  );

  // One verification unit has to carry BOTH domains. A status-only block next
  // to a sync-only block would pass a per-file reading and still leave the
  // asymmetry the row measured.
  const covering = texts.find((text) => {
    const blocks = text.match(/DO \$\$[\s\S]*?END \$\$;/gu) ?? [];
    return blocks.some(
      (block) =>
        block.includes("%DEPRECATED%") && block.includes("%TOMBSTONED%"),
    );
  });
  assert.ok(
    covering,
    "some migration must verify BOTH widened domains (DEPRECATED on status, TOMBSTONED on sync_status) in one block",
  );
  const block = (covering.match(/DO \$\$[\s\S]*?END \$\$;/gu) ?? []).find(
    (item) => item.includes("%TOMBSTONED%"),
  );

  // The predicate must select by constraint TYPE and TABLE, not by one
  // predicted name: a hand-named narrow CHECK is exactly what the name-keyed
  // check in 004 cannot see.
  assert.match(
    block,
    /con\.contype\s*=\s*'c'/u,
    "the postcondition must select CHECK constraints by contype",
  );
  assert.match(
    block,
    /con\.conrelid/u,
    "the postcondition must scope to the table by conrelid",
  );

  // The guard that closes the documented harm: ANOTHER CHECK on sync_status
  // may not omit TOMBSTONED.
  assert.match(
    block,
    /NOT LIKE '%TOMBSTONED%'/u,
    "the postcondition must count the OTHER CHECKs on sync_status that omit TOMBSTONED",
  );
  assert.match(
    block,
    /v_narrow_sync_checks > 0/u,
    "the other-CHECK count must be a refusal, not a diagnostic",
  );
});

// M12/T9-R4 F-541 (R10-T03-6) — migration immutability is a BYTE pin, and the
// byte pin says nothing about what the SQL does. Neither runner, and neither
// digest gate, ever inspects a migration's statements.
//
// The checkable minimum is the pairing every widening needs: a constraint a
// migration DROPs must be re-ADDed in the same file (otherwise the column is
// left unconstrained), and its NAME must appear in a `DO $$` verification
// block in the applied set (otherwise the widening has no postcondition and is
// frozen as applied — exactly F-509's harm).
//
// The unit is the applied SET, not one file: an applied migration is
// immutable, so a later forward migration is the module's only lawful way to
// complete an earlier file's postcondition. The set-level reading is what makes
// the rule satisfiable without editing a digest-pinned file.
//
// Both migration sets are parsed, so the Knowledgebase set is covered by the
// same shipped, non-skippable lane.
test("F-541: every CHECK a migration drops is re-added and re-verified by name", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const sets = [
    path.join(repoRoot, "apps", "knowledge", "migrations"),
    SKILL_STORE_MIGRATIONS_DIR,
  ];

  for (const directory of sets) {
    const files = (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    assert.ok(files.length > 0, `${directory} must hold migrations`);

    const texts = [];
    for (const name of files) {
      texts.push({
        name,
        text: await readFile(path.join(directory, name), "utf8"),
      });
    }
    const verification = texts
      .flatMap(
        (file) => file.text.match(/DO \$[\s\S]*?END \$[\s\S]*?;/gu) ?? [],
      )
      .join("\n");
    const droppedInSet = texts.flatMap((file) =>
      [
        ...file.text.matchAll(
          /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+([A-Za-z0-9_]+)/giu,
        ),
      ].map((match) => match[1]),
    );
    if (droppedInSet.length > 0) {
      assert.match(
        verification,
        /pg_constraint/u,
        `${directory}: a postcondition must read the catalog, not be a comment`,
      );
    }

    for (const file of texts) {
      const dropped = [
        ...file.text.matchAll(
          /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+([A-Za-z0-9_]+)/giu,
        ),
      ].map((match) => match[1]);
      const added = new Set(
        [...file.text.matchAll(/ADD\s+CONSTRAINT\s+([A-Za-z0-9_]+)/giu)].map(
          (match) => match[1],
        ),
      );
      for (const name of dropped) {
        assert.ok(
          added.has(name),
          `${file.name} drops ${name} and never re-adds it: the column would be left unconstrained`,
        );
        assert.ok(
          verification.includes(name),
          `${file.name} re-adds ${name} but no migration's postcondition re-asserts it by name: ` +
            `a widening without a postcondition is recorded as applied and frozen by the digest pin`,
        );
      }
    }
  }
});

// M12/T9-R4 F-574 (R10-T10-5) — no statement in the Skill Store could reach a
// DEPRECATED/TOMBSTONED derived row.
//
// Migration 004 widened the two CHECK constraints so a retirement is RECORDED,
// which gave `skills.catalog_index` a lifecycle with no owner path: every
// statement either filtered `status = 'ACTIVE'` or keyed on a fresh upsert id,
// so a terminal row accumulated forever — including a row whose canonical
// record had been deleted afterwards.
//
// Two changes close it: the terminal-row reclamation below (bounded by a stated
// retention window, and only on a COMPLETE scan), and the removal of the
// tombstone in the catalogErrors branch, which the retirement marker in
// `prepareSyncSnapshot` had already made a provable no-op.
test("F-574: terminal rows whose canonical record is gone are reclaimed within a stated window", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f574-prune-"));
  try {
    await makeActiveSkill(root, ["office"], "live-skill", "# Live\n\nBody.");
    const statements = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn,
      dbExecutor: async (sql) => {
        statements.push(sql);
        return "";
      },
    });
    assert.equal(report.status, "READY");
    const prune = statements.find((sql) =>
      /DELETE FROM skills\.catalog_index/u.test(sql),
    );
    // The retirement marker is an UPDATE; a statement that DELETEs and carries
    // the terminal status is the reclamation.
    const terminal = statements.filter(
      (sql) =>
        /DELETE FROM skills\.catalog_index/u.test(sql) &&
        /status = 'DEPRECATED'/u.test(sql),
    );
    assert.equal(
      terminal.length,
      1,
      `exactly one statement must reclaim terminal rows: ${JSON.stringify(statements)}`,
    );
    assert.match(
      terminal[0],
      /sync_status = 'TOMBSTONED'|status = 'DEPRECATED'/u,
      "the reclamation must target the recorded retirement state",
    );
    assert.match(
      terminal[0],
      /synced_at < now\(\) - interval '30 days'/u,
      `the reclamation must be bounded by the stated retention window: ${terminal[0]}`,
    );
    assert.match(
      terminal[0],
      /NOT IN \(/u,
      "only terminal rows whose canonical record is GONE may be reclaimed",
    );
    assert.ok(
      !/status = 'ACTIVE'/u.test(terminal[0]),
      `the reclamation must never target a live row: ${terminal[0]}`,
    );
    assert.ok(
      terminal[0].indexOf("office|live-skill|1.0.0") >
        terminal[0].indexOf("NOT IN"),
      `the live skill's key must be in the EXCLUSION list, not the target set: ${terminal[0]}`,
    );
    assert.ok(prune, "the ordinary tombstone must still be issued");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-574: an incomplete scan issues no reclamation at all", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f574-noprune-"));
  try {
    await makeRetiredSkill(root, ["office"], "retired-skill", "# Old\n\nBody.");
    await makeActiveSkill(
      root,
      ["office"],
      "poisoned-skill",
      "# Poisoned\n\nbefore\u0000after",
    );
    const statements = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn,
      dbExecutor: async (sql) => {
        statements.push(sql);
        return "";
      },
    });
    assert.equal(report.error_code, "CATALOG_INVALID");
    assert.equal(
      statements.filter(
        (sql) =>
          /DELETE FROM skills\.catalog_index/u.test(sql) &&
          /status = 'DEPRECATED'/u.test(sql),
      ).length,
      0,
      "an incomplete catalog cannot prove a record is GONE, so nothing may be reclaimed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// M12/T9-R4 F-133 (R5-E05-08) — the durable governance state disagreed with
// the derived index in BOTH directions.
//
// The sync rolls up one store-wide `status` (`PARTIAL` when ANY skill failed)
// while a governance consumer keys the proposal's state off that aggregate, so
// an APPROVED, correctly-indexed skill was stamped `INDEX_FAILED` because some
// OTHER skill in the same run failed — and a sync that left a row untouched
// carried no per-skill evidence at all.
//
// The store half is that every per-skill entry states the DERIVED ROW's own
// columns, so the two can be compared per skill instead of inferred from an
// aggregate. The consumer half (reading it instead of the rollup) lives in the
// governance plugin, which this lane does not own.
test("F-133: a PARTIAL run still reports each skill's own catalog row state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f133-partial-"));
  try {
    await makeActiveSkill(root, ["office"], "good-skill", "# Good\n\nBody.");
    await makeActiveSkill(root, ["office"], "bad-skill", "# Bad\n\nBody.");
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      // One skill's embedding fails; the other is indexed.
      embedFn: async (texts) =>
        texts.some((text) => text.includes("Bad"))
          ? Promise.reject(new Error("EMBEDDING_UPSTREAM_FAILED"))
          : texts.map(() => new Array(EXPECTED_DIMENSIONS).fill(0.01)),
      dbExecutor: async () => "",
    });
    assert.equal(
      report.status,
      "PARTIAL",
      "the rollup stays a rollup: one failure makes the RUN partial",
    );
    const good = report.skills.find((s) => s.capability === "good-skill");
    const bad = report.skills.find((s) => s.capability === "bad-skill");
    assert.deepEqual(
      {
        sync_status: good.sync_status,
        catalog_row_status: good.catalog_row_status,
        catalog_sync_status: good.catalog_sync_status,
      },
      {
        sync_status: "READY",
        catalog_row_status: "ACTIVE",
        catalog_sync_status: "READY",
      },
      "the skill that WAS indexed must say so, whatever the run's rollup is",
    );
    assert.deepEqual(
      {
        sync_status: bad.sync_status,
        catalog_row_status: bad.catalog_row_status,
        catalog_sync_status: bad.catalog_sync_status,
      },
      {
        sync_status: "FAILED",
        catalog_row_status: "ACTIVE",
        catalog_sync_status: "FAILED",
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F-133: a retirement that lands mid-sync is reported as the terminal row it is", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "f133-drift-"));
  try {
    await makeActiveSkill(root, ["office"], "drift-skill", "# Drift\n\nBody.");
    let flipped = false;
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn: async (texts) => {
        if (!flipped) {
          flipped = true;
          // The canonical retirement lands after the scan and before the
          // READY write: the row this sync may leave behind is terminal.
          await writeFile(
            path.join(root, "office", "drift-skill", "1.0.0", "manifest.json"),
            JSON.stringify(
              {
                schema_version: 1,
                identity: {
                  namespace: ["office"],
                  capability: "drift-skill",
                  version: "1.0.0",
                },
                content: {
                  path: "SKILL.md",
                  sha256: createHash("sha256")
                    .update("# Drift\n\nBody.", "utf8")
                    .digest("hex"),
                },
                provenance: { source_type: "research", references: [] },
                lifecycle: [
                  {
                    status: "ACTIVE",
                    at: "2026-10-01T01:00:00Z",
                    actor: "owner",
                  },
                  {
                    status: "DEPRECATED",
                    at: "2026-10-02T01:00:00Z",
                    actor: "owner",
                    decision_ref: "PLAN:M12/T9-R4",
                  },
                ],
              },
              null,
              2,
            ),
            "utf8",
          );
        }
        return texts.map(() => new Array(EXPECTED_DIMENSIONS).fill(0.01));
      },
      dbExecutor: async () => "",
    });
    assert.notEqual(report.status, "READY");
    const entry = report.skills.at(-1);
    assert.equal(entry.sync_status, "FAILED");
    assert.equal(
      entry.catalog_row_status,
      "DEPRECATED",
      `the row the drift leaves behind is terminal, not failed: ${JSON.stringify(entry)}`,
    );
    assert.equal(entry.catalog_sync_status, "TOMBSTONED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
