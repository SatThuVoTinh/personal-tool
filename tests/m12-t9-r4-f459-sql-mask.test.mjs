// M12/T9-R4 — F-459 (legacy R9-T08-1): the artifact SQL scanner applied the
// raw UNSAFE_SQL regex to raw text and counted brackets with a hand-rolled
// backslash-parity quote toggle, disagreeing with the canonical validator in
// BOTH directions. Both decisions must route through one exported mask
// (maskSqlLiteralsAndComments) OWNED BY THE CANONICAL MODULE, and this suite
// must turn red when the raw regex, the hand-rolled quote counter, or the
// shared-import edge is restored/removed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { validateTechnicalArtifact, maskSqlLiteralsAndComments } = await import(
  new URL(
    "../integrations/openclaw/lib/artifact-validator.mjs",
    import.meta.url,
  ).href
);
const {
  validateSqlFileContent,
  assertReadOnlyStatement,
  maskSqlLiteralsAndComments: canonicalMask,
} = await import(
  new URL("../zink-tools/sql/validator.mjs", import.meta.url).href
);
const { governancePluginFiles } = await import(
  new URL("../integrations/openclaw/lib/policy.mjs", import.meta.url).href
);

function runSqlArtifact(content, name = "artifact.sql") {
  const dir = mkdtempSync(path.join(tmpdir(), "l8-f459-"));
  try {
    const file = path.join(dir, name);
    writeFileSync(file, content);
    return validateTechnicalArtifact({ filePath: file });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("F-459: a benign 'DROP DATABASE' inside a string literal is no longer refused (over-reject half)", () => {
  const sql = "SELECT 'DROP DATABASE' AS note FROM t;\n";
  const result = runSqlArtifact(sql);
  assert.ok(
    !result.errors.some((e) => /UNSAFE_SQL_STATEMENT/u.test(e)),
    `the masked keyword decision must not read literal data as syntax: ${JSON.stringify(result.errors)}`,
  );
  assert.equal(
    result.status,
    "PASS",
    `errors: ${JSON.stringify(result.errors)}`,
  );
  // Agreement with the canonical FILE analyzer on identical bytes.
  assert.doesNotThrow(() => validateSqlFileContent(sql));
});

test("F-459: a backslash escape inside a literal is refused like the canonical lexer (under-reject half)", () => {
  const sql = "SELECT 'a\\b' FROM t;\n";
  const result = runSqlArtifact(sql);
  assert.equal(result.status, "FAIL");
  assert.ok(
    result.errors.some((e) => /MALFORMED_SQL_SYNTAX/u.test(e)),
    `errors: ${JSON.stringify(result.errors)}`,
  );
  assert.equal(result.checks.sqlSyntax, false);
  // The canonical QUERY lexer forbids backslash escaping too (validator.mjs:153-158).
  assert.throws(
    () => assertReadOnlyStatement(sql),
    /SQL_UNSUPPORTED_SYNTAX|UNSUPPORTED/u,
  );
});

test("F-459: an apostrophe inside a -- comment is valid input, not an unclosed literal (R10 site: migration 004)", () => {
  const migrationPath = new URL(
    "../zink-skill-store/migrations/004_skill_retirement_state.sql",
    import.meta.url,
  );
  const sql = readFileSync(migrationPath, "utf8");
  const result = runSqlArtifact(sql, "004_skill_retirement_state.sql");
  assert.ok(
    !result.errors.some((e) => /MALFORMED_SQL_SYNTAX/u.test(e)),
    `the comment-aware mask must not misread the comment apostrophe: ${JSON.stringify(result.errors)}`,
  );
  assert.equal(
    result.status,
    "PASS",
    `errors: ${JSON.stringify(result.errors)}`,
  );
  // The canonical FILE analyzer accepts the identical bytes (strips comments).
  assert.doesNotThrow(() => validateSqlFileContent(sql));
});

test("F-459: a real destructive keyword outside any literal is still refused", () => {
  const result = runSqlArtifact("DROP DATABASE production;\n");
  assert.equal(result.status, "FAIL");
  assert.ok(result.errors.some((e) => /UNSAFE_SQL_STATEMENT/u.test(e)));
});

test("F-459: the exported mask blanks literals and comments and reports the lexer refusals", () => {
  const mask = maskSqlLiteralsAndComments(
    "-- don't drop anything\nSELECT 'DROP DATABASE' /* x's */ FROM t WHERE a = 'un\\'closed",
  );
  // The canonical lexer forbids backslash escaping (it is not an escape: the
  // quote still closes the literal), and the mask reports it as a refusal.
  assert.equal(mask.backslashInLiteral, true);
  assert.ok(!/DROP\s+DATABASE/u.test(mask.masked), "literal data is blanked");
  assert.ok(!/don't/u.test(mask.masked), "comment body is blanked");
  const unclosed = maskSqlLiteralsAndComments("SELECT 'abc FROM t;\n");
  assert.equal(unclosed.unterminatedLiteral, true);
  const unclosedComment = maskSqlLiteralsAndComments(
    "SELECT 1 /* never closed\n",
  );
  assert.equal(unclosedComment.unterminatedComment, true);
});

test("F-459: the mask is the canonical module's export, and packaging rewrites the shared edge", () => {
  // Same function object, not a copy: restoring a local scanner reddens this.
  assert.equal(
    maskSqlLiteralsAndComments,
    canonicalMask,
    "the artifact gate must import the canonical mask, not own a copy",
  );
  const { assets } = governancePluginFiles();
  const packaged = assets["lib/artifact-validator.mjs"];
  assert.ok(
    packaged.includes('from "../zink-tools/sql/validator.mjs"'),
    "the deployed artifact validator must import the packaged canonical mask",
  );
  assert.ok(
    !packaged.includes('"../../../zink-tools/'),
    "the repository-only path must not survive packaging",
  );
});
