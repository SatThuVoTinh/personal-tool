import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateSqlQuery,
  validateSqlFileContent,
} from "../zink-tools/sql/validator.mjs";
import { validateLiveSqlQuery } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

/**
 * Lane H4 — the SQL safety matrix. The canonical contract is a deliberately
 * narrow read-only subset: a single SELECT ... FROM with optional WHERE, ORDER
 * BY, LIMIT and OFFSET, no comments, no semicolons, no positional parameters.
 * Every case below is asserted against BOTH the canonical validator and the
 * live plugin seam, so the two can never diverge.
 */

/** The read-only subset the canonical contract admits. */
const ALLOWED = [
  ["a bare projection", "SELECT a FROM t"],
  ["a star projection", "SELECT * FROM t"],
  ["a multi-column projection", "SELECT a, b FROM t"],
  ["a qualified column", "SELECT t.a FROM t"],
  ["a numeric filter", "SELECT a FROM t WHERE a = 1"],
  ["a string-literal filter", "SELECT a FROM t WHERE a = 'x'"],
  ["a null test", "SELECT a FROM t WHERE a IS NULL"],
  ["a negated null test", "SELECT a FROM t WHERE a IS NOT NULL"],
  ["a conjunction", "SELECT a FROM t WHERE a = 1 AND b = 2"],
  ["a disjunction", "SELECT a FROM t WHERE a = 1 OR b = 2"],
  ["a chained filter", "SELECT a FROM t WHERE a = 1 AND b = 2 AND c = 3"],
  ["an ordering", "SELECT a FROM t ORDER BY a"],
  ["a descending ordering", "SELECT a FROM t ORDER BY a DESC"],
  ["a multi-column ordering", "SELECT a FROM t ORDER BY a ASC, b DESC"],
  ["a limit", "SELECT a FROM t LIMIT 10"],
  ["a limit and offset", "SELECT a FROM t ORDER BY a LIMIT 10 OFFSET 5"],
  ["a boolean literal", "SELECT a FROM t WHERE b = TRUE"],
  [
    "a fully-clause query",
    "SELECT a FROM t WHERE a = 1 ORDER BY a DESC LIMIT 5 OFFSET 1",
  ],
];

/** Everything outside the subset, with the reason the contract requires. */
const REFUSED = [
  ["a trailing semicolon", "SELECT a FROM t;", "SQL_UNSUPPORTED_SYNTAX"],
  ["an empty query", "", "SQL_UNSUPPORTED_SYNTAX"],
  ["a whitespace-only query", "   ", "SQL_UNSUPPORTED_SYNTAX"],
  [
    "multi-statement",
    "SELECT a FROM t; SELECT b FROM u",
    "SQL_UNSUPPORTED_SYNTAX",
  ],
  ["a line comment", "-- c\nSELECT a FROM t", "SQL_UNSUPPORTED_SYNTAX"],
  ["a block comment", "/* c */ SELECT a FROM t", "SQL_UNSUPPORTED_SYNTAX"],
  ["a CTE", "WITH c AS (SELECT 1) SELECT * FROM c", "SQL_UNSUPPORTED_SYNTAX"],
  [
    "a UNION",
    "SELECT a FROM t UNION SELECT a FROM u",
    "SQL_UNSUPPORTED_SYNTAX",
  ],
  ["a JOIN", "SELECT a FROM t JOIN u ON t.id = u.id", "SQL_UNSUPPORTED_SYNTAX"],
  ["an INSERT", "INSERT INTO t VALUES (1)", "SQL_MUTATION_NOT_PERMITTED"],
  ["an UPDATE", "UPDATE t SET a = 1", "SQL_MUTATION_NOT_PERMITTED"],
  ["a DELETE", "DELETE FROM t", "SQL_MUTATION_NOT_PERMITTED"],
  ["a DROP", "DROP TABLE t", "SQL_MUTATION_NOT_PERMITTED"],
  ["a CREATE", "CREATE TABLE t (a INT)", "SQL_MUTATION_NOT_PERMITTED"],
  ["a TRUNCATE", "TRUNCATE TABLE t", "SQL_MUTATION_NOT_PERMITTED"],
  ["a MERGE", "MERGE INTO t USING u ON 1=1", "SQL_MUTATION_NOT_PERMITTED"],
  ["an ALTER", "ALTER TABLE t ADD COLUMN b INT", "SQL_MUTATION_NOT_PERMITTED"],
  ["a GRANT", "GRANT ALL ON t TO u", "SQL_MUTATION_NOT_PERMITTED"],
  ["a REVOKE", "REVOKE ALL ON t FROM u", "SQL_MUTATION_NOT_PERMITTED"],
  // Engine-specific escape forms: never part of the read-only subset.
  ["a PRAGMA", "PRAGMA table_info(t)", "SQL_UNSUPPORTED_SYNTAX"],
  ["an ATTACH", "ATTACH DATABASE 'x' AS y", "SQL_UNSUPPORTED_SYNTAX"],
  ["a dot command", ".tables", "SQL_UNSUPPORTED_SYNTAX"],
  [
    "a positional parameter",
    "SELECT a FROM t WHERE a = ?",
    "SQL_UNSUPPORTED_SYNTAX",
  ],
  [
    "a numbered parameter",
    "SELECT a FROM t WHERE a = $1",
    "SQL_UNSUPPORTED_SYNTAX",
  ],
  [
    "an unterminated string",
    "SELECT a FROM t WHERE a = 'x",
    "SQL_UNSUPPORTED_SYNTAX",
  ],
  [
    "a quoted identifier",
    'SELECT a FROM t WHERE a = "col"',
    "SQL_UNSUPPORTED_SYNTAX",
  ],
  ["malformed SQL", "not sql (((", "SQL_UNSUPPORTED_SYNTAX"],
  ["a missing FROM", "SELECT", "SQL_UNSUPPORTED_SYNTAX"],
  ["a missing projection", "SELECT FROM t", "SQL_UNSUPPORTED_SYNTAX"],
  ["a missing table", "SELECT a FROM", "SQL_UNSUPPORTED_SYNTAX"],
  [
    "an unparenthesised expression",
    "SELECT a FROM t WHERE a = 1 +",
    "SQL_UNSUPPORTED_SYNTAX",
  ],
];

async function assertVerdict(query, expected, label) {
  let canonicalCode = null;
  try {
    validateSqlQuery(query, []);
  } catch (err) {
    canonicalCode = err?.message ?? String(err);
  }
  const live = await validateLiveSqlQuery(query, []);
  assert.equal(
    live.ok,
    canonicalCode === null,
    `${label}: the live seam and the canonical validator disagree`,
  );
  if (canonicalCode !== null) {
    assert.equal(canonicalCode, expected, `${label}: unexpected reason`);
    assert.equal(
      live.reason,
      expected,
      `${label}: the live seam must surface the canonical reason`,
    );
  }
  return canonicalCode;
}

describe("Lane H4 — SQL safety matrix", () => {
  it("the admitted read-only subset is admitted by both validators", async () => {
    for (const [label, query] of ALLOWED) {
      assert.equal(
        await assertVerdict(query, null, label),
        null,
        `${label}: ${JSON.stringify(query)} must be admitted`,
      );
    }
  });

  it("everything outside the subset is refused with the canonical reason", async () => {
    for (const [label, query, expected] of REFUSED) {
      assert.equal(
        await assertVerdict(query, expected, label),
        expected,
        `${label}: ${JSON.stringify(query)} must be refused`,
      );
    }
  });

  it("a parameter is admitted only when it is bound exactly once", () => {
    // A named parameter with its single binding is admitted.
    validateSqlQuery("SELECT a FROM t WHERE a = :p", [{ name: "p", value: 1 }]);
    // The same parameter without a binding is refused: the placeholder and the
    // binding set must be exactly equal.
    assert.throws(() => validateSqlQuery("SELECT a FROM t WHERE a = :p", []), {
      message: "SQL_UNSUPPORTED_SYNTAX",
    });
    // A repeated placeholder is refused even with one binding: an unbound
    // repeat is an injection seam.
    assert.throws(
      () =>
        validateSqlQuery("SELECT a FROM t WHERE a = :p OR b = :p", [
          { name: "p", value: 1 },
        ]),
      { message: "SQL_UNSUPPORTED_SYNTAX" },
    );
    // A duplicated binding is refused: the same name cannot be bound twice.
    assert.throws(
      () =>
        validateSqlQuery("SELECT a FROM t WHERE a = :p", [
          { name: "p", value: 1 },
          { name: "p", value: 2 },
        ]),
      { message: "SQL_UNSUPPORTED_SYNTAX" },
    );
    // An unused binding is refused: an extra binding is as unsafe as a
    // missing one.
    assert.throws(
      () =>
        validateSqlQuery("SELECT a FROM t WHERE a = :p", [
          { name: "p", value: 1 },
          { name: "q", value: 2 },
        ]),
      { message: "SQL_UNSUPPORTED_SYNTAX" },
    );
  });

  it("a mutation hidden behind a string literal is still just a string", () => {
    // The tokenizer treats string contents as data, so this is an ordinary
    // literal filter rather than a mutation.
    validateSqlQuery("SELECT a FROM t WHERE a = 'DROP TABLE t'");
    // The same word as a bare token IS a mutation.
    assert.throws(() => validateSqlQuery("SELECT a FROM t WHERE a = DROP"), {
      message: "SQL_MUTATION_NOT_PERMITTED",
    });
  });

  it("static file analysis reports mutations without executing them", () => {
    const clean = validateSqlFileContent(
      "SELECT a FROM t;\nSELECT b FROM u;\n",
    );
    assert.equal(clean.hasMutations, false);
    assert.deepEqual(clean.mutationKeywords, []);
    assert.equal(clean.statementCount, 2);
    // A mutation anywhere in the file is reported, including after a comment
    // that would otherwise hide it from a reader.
    const dirty = validateSqlFileContent(
      "-- a comment mentioning nothing\nSELECT a FROM t;\nDROP TABLE t;\n",
    );
    assert.equal(dirty.hasMutations, true);
    assert.deepEqual(dirty.mutationKeywords, ["DROP"]);
    assert.equal(dirty.statementCount, 2);
    // A non-string input is refused, never analysed as empty.
    assert.throws(() => validateSqlFileContent(null), {
      message: "SQL_CONTENT_INVALID: content must be a string",
    });
  });
});
