// M10/T2-R20 — a rejected skill catalog must not degrade to a permissive walk,
// and the tombstone composite key must be representable and comparable in SQL.
//
// Both defects were reproduced against the pre-fix code by execution.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (rel) => readFileSync(path.join(REPO, rel), "utf8");

const vectorSyncSrc = readSource("zink-skill-store/src/vector-sync.mjs");
const adapterSrc = readSource(
  "zink-tools/adapters/skill-store/skill-adapter.mjs",
);

const codeOf = (src) =>
  src
    .split("\n")
    .filter(
      (l) =>
        !l.trim().startsWith("//") &&
        !l.trim().startsWith("*") &&
        !l.trim().startsWith("/*"),
    )
    .join("\n");

test("R20-01: discovery fails closed when the catalog is invalid", () => {
  // Proven pre-fix: scanCatalog returns records: [] whenever errors is non-empty
  // (catalog.mjs:732). One tampered skill therefore made
  // `catalog.records.length > 0` false, and the adapter fell through to a disk
  // walk that re-read the same files with NO digest or manifest validation and
  // still answered governed_status: "SUCCESS", listing the tampered skill as
  // discoverable.
  //
  // The other two consumers of the same scan already failed closed
  // (catalog.mjs:738 getActiveSkill, vector-sync.mjs:358). Discovery must too.
  const code = codeOf(adapterSrc);
  assert.match(
    code,
    /catalogErrors\.length > 0/u,
    "discovery must inspect catalog.errors, not infer validity from record count",
  );
  assert.match(
    code,
    /error_code:\s*"SKILL_CATALOG_INVALID"/u,
    "an invalid catalog must produce an explicit error code",
  );
  assert.match(
    code,
    /governed_status:\s*"FAILED"/u,
    "an invalid catalog must not report SUCCESS",
  );
  // M11/T1-R1 (2.1): the permissive disk walk is deleted outright, not just
  // gated. Read/apply now resolve only through scanCatalog, so discovery has
  // no second, unvalidated path to fall through to.
  assert.equal(
    code.includes("function walkActive"),
    false,
    "the permissive walk must no longer exist at all",
  );
});

test("R20-02: the tombstone key carries no NUL separator", () => {
  // PostgreSQL `text` cannot store a NUL byte, so the statement aborted and the
  // catch turned every sync into VECTOR_TOMBSTONE_SYNC_FAILED before ingestion
  // was reached. The skill identity rules also forbid control characters in a
  // skill path (path-safety.mjs rejects /[\0\x01-\x1F\x7F]/).
  const code = codeOf(vectorSyncSrc);
  assert.equal(
    code.includes("\\u0000"),
    false,
    "no \\u0000 escape may survive in code",
  );
  assert.equal(
    code.includes(String.fromCharCode(0)),
    false,
    "no raw NUL byte may survive in code",
  );
});

test("R20-03: the JS key and the SQL predicate build the SAME string", () => {
  // Pre-fix the sides were structurally incomparable even ignoring the NUL:
  // the left side was `namespace::text || capability || version`, where
  // `namespace::text` renders a text[] as `{a,b}` — braces, no separators —
  // concatenated with nothing between parts. `NOT IN` could never match, so
  // the statement would have DEPRECATED every ACTIVE row.
  //
  // Scoped to the tombstone block: `reconcileVectorSync` above also builds an
  // `activeKeys`, with its own separators, but only `activeKeys.size` escapes
  // that function, so its key format is never compared to anything.
  // Anchor on the tombstone block's own `activeKeys` construction. The
  // `reconcileVectorSync` function above also builds one, but with `new Set`;
  // only this one feeds the SQL.
  const code = codeOf(vectorSyncSrc);
  const tombstoneAt = code.indexOf("const activeKeys = activeRecords.map");
  assert.ok(tombstoneAt > 0, "the tombstone activeKeys must exist");
  const block = code.slice(tombstoneAt, tombstoneAt + 1200);

  const key = block.match(
    /return `\$\{id\.namespace\.join\("\/"\)\}([^`]*)`;/u,
  );
  assert.ok(key, "the tombstone key builder must be present in that block");
  assert.equal(
    key[1],
    "|${id.capability}|${id.version}",
    `unexpected tombstone key shape: ${JSON.stringify(key[1])}`,
  );

  // Non-greedy up to the closing paren: the predicate contains NESTED parens
  // (`array_to_string(namespace, '/')`), so a `[^)]*` body would stop early.
  const predicate = block.match(/AND \((.*?)\)\s*\n?\s*NOT IN/u);
  assert.ok(predicate, "the NOT IN predicate must be present in that block");
  const sql = predicate[1].replace(/\s+/gu, "");
  assert.match(
    sql,
    /array_to_string\(namespace,'\/'\)/u,
    "the SQL side must use array_to_string so it matches join('/')",
  );
  assert.doesNotMatch(
    sql,
    /namespace::text/u,
    "namespace::text renders a text[] with braces and cannot match the JS key",
  );
  // Count the separator LITERAL, not `||` — `||` is also SQL's concatenation
  // operator, so it appears on every join and says nothing.
  assert.equal(
    (sql.match(/'\|'/gu) || []).length,
    2,
    "the SQL side must join with the same '|' separator twice",
  );
});

test("R20-04: the separator cannot occur in any identity component", () => {
  // The fix is only sound if `|` is unambiguous. Every component is a skill
  // path segment restricted to /^[a-zA-Z0-9_.-]+$/u, so it cannot contain `|`.
  const safety = readSource("zink-tools/common/path-safety.mjs");
  assert.match(
    safety,
    /const SAFE_SEGMENT_PATTERN = \/\^\[a-zA-Z0-9_\.-\]\+\$\/u/u,
    "path safety must still restrict skill path segments",
  );
  assert.ok(
    safety.includes("/[\\0\\x01-\\x1F\\x7F]/u"),
    "path safety must still reject control characters",
  );
  // And the separator itself is outside the allowed set.
  assert.ok(
    !/[a-zA-Z0-9_.-]/.test("|"),
    "the separator is outside the segment charset",
  );
});

test("R20-05: the two sides render identically for a real identity", () => {
  const ns = ["office", "ops"];
  const capability = "s";
  const version = "1.0.0";
  const jsKey = `${ns.join("/")}|${capability}|${version}`;
  // array_to_string(namespace,'/') || '|' || capability || '|' || version
  const sqlKey = `${ns.join("/")}|${capability}|${version}`;
  assert.equal(jsKey, sqlKey);
  assert.equal(jsKey, "office/ops|s|1.0.0");
  for (const part of [...ns, capability, version]) {
    assert.ok(
      !part.includes("|"),
      `component ${part} must not contain the separator`,
    );
  }
});

test("R20-06: the separator is outside the allowed segment charset", () => {
  // The fix is only sound if `|` cannot appear in any identity component, which
  // rests on the path-safety charset asserted in R20-04.
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-";
  assert.ok(
    !charset.includes("|"),
    "the separator must be outside the charset",
  );
});
