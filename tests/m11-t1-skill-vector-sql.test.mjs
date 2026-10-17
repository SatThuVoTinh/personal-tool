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
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";

import {
  syncSkillsToVectorStore,
  generateSkillEmbeddings,
  chunkSkillContent,
  toPostgresArrayLiteral,
  escapeSqlLiteral,
  EXPECTED_DIMENSIONS,
  EXPECTED_MODEL_DIGEST,
  MAX_EMBEDDING_PAYLOAD_BYTES,
} from "../zink-skill-store/src/vector-sync.mjs";

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

test("M11-04: failure escalation — a failed failSql is surfaced, not swallowed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m11-fail-"));
  try {
    await makeActiveSkill(
      root,
      ["office"],
      "broken-skill",
      "# Broken\n\nBody.",
    );
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn,
      dbExecutor: async (sql) => {
        if (sql.includes("DELETE FROM skills.catalog_index")) return "";
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
    assert.ok(failSql.includes("DO $$") && failSql.includes("END $$;"));
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
