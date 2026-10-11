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
import os from "node:os";

import {
  syncSkillsToVectorStore,
  generateSkillEmbeddings,
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
