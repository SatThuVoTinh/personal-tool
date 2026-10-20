// M10/T2-R20 — a rejected skill catalog must not degrade to a permissive walk,
// and the tombstone composite key must be representable and comparable in SQL.
//
// Both defects were reproduced against the pre-fix code by execution.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  syncSkillsToVectorStore,
  tombstoneKey,
  TOMBSTONE_KEY_SQL_EXPRESSION,
  EXPECTED_DIMENSIONS,
} from "../zink-skill-store/src/vector-sync.mjs";
import { scanCatalog } from "../zink-skill-store/src/catalog.mjs";
import { SkillAdapter } from "../zink-tools/adapters/skill-store/skill-adapter.mjs";
import { isArtifactLogicalPathValid } from "../zink-tools/common/path-safety.mjs";

/**
 * Writes one canonical skill under `root` and returns nothing. The MANIFEST
 * carries `identity` verbatim while the DIRECTORY keeps the canonical names, so
 * a case can drive the catalog's identity grammar without creating a
 * filesystem name the host cannot represent.
 */
async function writeSkillWithIdentity(
  root,
  identity,
  directoryParts = ["supply-chain", "inventory", "safety-stock", "1.0.0"],
) {
  const dir = path.join(root, ...directoryParts);
  await mkdir(dir, { recursive: true });
  const content = "# Separator\n\nBody.";
  const sha = createHash("sha256").update(content, "utf8").digest("hex");
  await writeFile(path.join(dir, "SKILL.md"), content, "utf8");
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        schema_version: 1,
        identity,
        content: { path: "SKILL.md", sha256: sha },
        provenance: { source_type: "research", references: [] },
        lifecycle: [
          {
            status: "CANDIDATE",
            at: "2026-10-01T00:00:00Z",
            actor: "excel",
          },
          {
            status: "ACTIVE",
            at: "2026-10-01T01:00:00Z",
            actor: "owner",
            decision_ref: "PLAN:M11/T1-R1",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
}

/**
 * Runs the shipped sync over one ACTIVE skill and captures the statements it
 * really issues. The assertions below read those statements, so a change in
 * the production SQL is visible to them.
 */
async function captureSyncStatements(namespace, capability) {
  const root = await mkdtemp(path.join(os.tmpdir(), "r20-tombstone-"));
  try {
    const identity = { namespace, capability, version: "1.0.0" };
    await writeSkillWithIdentity(root, identity, [
      ...namespace,
      capability,
      "1.0.0",
    ]);
    const statements = [];
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn: async (texts) =>
        texts.map(() => new Array(EXPECTED_DIMENSIONS).fill(0.01)),
      dbExecutor: async (sql) => {
        statements.push(sql);
        return "";
      },
    });
    assert.equal(
      report.status,
      "READY",
      `the sync must complete: ${JSON.stringify(report)}`,
    );
    return { statements, identity };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Evaluates the shipped tombstone SQL expression the way PostgreSQL does:
 * `array_to_string(namespace, '/')` renders the array with the separator, a
 * quoted literal is itself, and `||` concatenates. Reading the expression out
 * of the shipped module is what makes the comparison a statement about the
 * production SQL rather than about a copy of it.
 */
function evaluateTombstoneSql(expression, identity) {
  return expression
    .split("||")
    .map((segment) => {
      const trimmed = segment.trim();
      if (trimmed === "capability") return identity.capability;
      if (trimmed === "version") return identity.version;
      const arrayToString =
        /^array_to_string\(\s*namespace\s*,\s*'([^']*)'\s*\)$/u.exec(trimmed);
      if (arrayToString) return identity.namespace.join(arrayToString[1]);
      const literal = /^'([^']*)'$/u.exec(trimmed);
      if (literal) return literal[1];
      throw new Error(`unhandled tombstone SQL segment: ${trimmed}`);
    })
    .join("");
}

test("R20-01: discovery fails closed when the catalog is invalid", async () => {
  // Proven pre-fix: scanCatalog returned records: [] whenever errors was
  // non-empty (catalog.mjs:732). One tampered skill therefore made
  // `catalog.records.length > 0` false, and the adapter fell through to a
  // disk walk that re-read the same files with NO digest or manifest
  // validation and still answered governed_status: "SUCCESS", listing the
  // tampered skill as discoverable.
  //
  // F-240: the guarantee used to be read out of the adapter's SOURCE TEXT
  // with regular expressions, so a rewording of the shipped code could break
  // the case without changing the behaviour, and a behavioural change could
  // keep the text and lose the guarantee. It is now proven by execution: the
  // adapter's own discover action is called over a store whose bytes do not
  // match their manifest digest, and the ANSWER must fail closed.
  const root = await mkdtemp(path.join(os.tmpdir(), "r20-discover-"));
  try {
    const dir = path.join(
      root,
      "supply-chain",
      "inventory",
      "safety-stock",
      "1.0.0",
    );
    await mkdir(dir, { recursive: true });
    // The bytes on disk are NOT the bytes the manifest approved.
    const onDisk = "# Tampered\n\nBytes that were never approved.\n";
    const approved = "# Tampered\n\nBytes that were approved.\n";
    await writeFile(path.join(dir, "SKILL.md"), onDisk, "utf8");
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify(
        {
          schema_version: 1,
          identity: {
            namespace: ["supply-chain", "inventory"],
            capability: "safety-stock",
            version: "1.0.0",
          },
          content: {
            path: "SKILL.md",
            sha256: createHash("sha256").update(approved, "utf8").digest("hex"),
          },
          provenance: { source_type: "research", references: [] },
          lifecycle: [
            {
              status: "CANDIDATE",
              at: "2026-10-01T00:00:00Z",
              actor: "excel",
            },
            {
              status: "ACTIVE",
              at: "2026-10-01T01:00:00Z",
              actor: "owner",
              decision_ref: "PLAN:M11/T1-R1",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    // The catalog refuses the drifted bytes in the first place.
    const catalog = await scanCatalog(root);
    assert.ok(
      catalog.errors.some((error) => error.code === "CONTENT_DIGEST_MISMATCH"),
      `the catalog must refuse the drifted bytes: ${JSON.stringify(catalog.errors)}`,
    );

    // And discovery must fail closed over that store, never listing the
    // tampered skill.
    const adapter = new SkillAdapter(root, { skillsRoot: root });
    const discovered = await adapter.querySkillStore({ action: "discover" });
    assert.equal(
      discovered.governed_status,
      "FAILED",
      "an invalid catalog must not report SUCCESS",
    );
    assert.equal(
      discovered.error_code,
      "SKILL_CATALOG_INVALID",
      "an invalid catalog must produce an explicit error code",
    );
    assert.deepEqual(
      discovered.skills,
      [],
      "no skill may be listed out of an invalid catalog",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R20-02: the issued tombstone statement carries no NUL separator", async () => {
  // PostgreSQL `text` cannot store a NUL byte, so the statement aborted and
  // the catch turned every sync into VECTOR_TOMBSTONE_SYNC_FAILED before
  // ingestion was reached. The skill identity rules also forbid control
  // characters in a skill path (path-safety.mjs rejects /[\0\x01-\x1F\x7F]/).
  //
  // F-240: the pre-fix case scanned the module's SOURCE TEXT for the escape,
  // so it could not fail for any production change that mattered — only for a
  // rewording of the file. The statement the sync really issues is the
  // evidence now: it must carry the production key and no NUL byte at all.
  const { statements, identity } = await captureSyncStatements(
    ["office", "ops"],
    "s",
  );
  const tombstone = statements.find((s) =>
    s.includes("DELETE FROM skills.catalog_index"),
  );
  assert.ok(tombstone, "the sync must issue a tombstone statement");
  assert.equal(
    tombstone.includes("\u0000"),
    false,
    "the issued statement must carry no NUL escape",
  );
  assert.equal(
    tombstone.includes(String.fromCharCode(0)),
    false,
    "the issued statement must carry no raw NUL byte",
  );
  assert.ok(
    tombstone.includes(tombstoneKey(identity)),
    `the statement must carry the production key: ${tombstone}`,
  );
});
test("R20-03: the JS key and the SQL predicate build the SAME string", async () => {
  // Pre-fix the sides were structurally incomparable even ignoring the NUL:
  // the left side was `namespace::text || capability || version`, where
  // `namespace::text` renders a text[] as `{a,b}` — braces, no separators —
  // concatenated with nothing between parts. `NOT IN` could never match, so
  // the statement would have DEPRECATED every ACTIVE row.
  //
  // F-240: the guarantee used to be read out of the SOURCE TEXT with a
  // regular expression, so a rewording of the shipped statement could break
  // the case without changing the behaviour, and a behavioural change could
  // keep the text and lose the guarantee. It is now proven by execution: the
  // statement the sync really issues must carry the shipped SQL expression,
  // and the key set it carries must be the string the shipped key builder
  // produces for the same identity.
  const { statements, identity } = await captureSyncStatements(
    ["office", "ops"],
    "s",
  );
  const tombstone = statements.find((s) =>
    s.includes("DELETE FROM skills.catalog_index"),
  );
  assert.ok(tombstone, "the sync must issue a tombstone statement");
  assert.ok(
    tombstone.includes(TOMBSTONE_KEY_SQL_EXPRESSION),
    `the shipped statement must carry the shipped expression: ${tombstone}`,
  );
  // `namespace::text` renders a text[] with braces and cannot match the JS key.
  assert.doesNotMatch(
    tombstone,
    /namespace::text/u,
    "namespace::text renders a text[] with braces and cannot match the JS key",
  );
  assert.match(
    tombstone,
    /array_to_string\(namespace, '\/'\)/u,
    "the SQL side must use array_to_string so it matches join('/')",
  );
  // Count the separator LITERAL, not `||` — `||` is also SQL's concatenation
  // operator, so it appears on every join and says nothing.
  assert.equal(
    (TOMBSTONE_KEY_SQL_EXPRESSION.match(/'\|'/gu) || []).length,
    2,
    "the SQL side must join with the same '|' separator twice",
  );
  // And the key the statement carries is the one the production builder makes.
  const jsKey = tombstoneKey(identity);
  assert.ok(
    tombstone.includes(jsKey),
    `the statement must carry the production key ${jsKey}: ${tombstone}`,
  );
});

test("R20-04: the separator cannot occur in any identity component", () => {
  // The fix is only sound if `|` is unambiguous. Every component is a skill
  // path segment restricted to /^[a-zA-Z0-9_.-]+$/u, so it cannot contain `|`.
  //
  // F-240: the pre-fix case asserted that a charset string DEFINED INSIDE the
  // test did not contain the separator - a statement about the test, not about
  // the store - and read the store's own grammar out of its SOURCE TEXT, so a
  // rewording of the shipped validator could break the case without changing
  // the behaviour. The grammar is now DRIVEN: the shipped path validator is
  // called with a segment carrying the separator, with a legal one and with a
  // control character, so the case can only fail if the shipped validator
  // stops refusing them.
  assert.equal(
    isArtifactLogicalPathValid("office/safe|stock/1.0.0"),
    false,
    "the shipped path validator must refuse a segment carrying the separator",
  );
  assert.equal(
    isArtifactLogicalPathValid("office/safe-stock/1.0.0"),
    true,
    "the shipped path validator must still accept a legal segment",
  );
  assert.equal(
    isArtifactLogicalPathValid("office/safe\u0000stock/1.0.0"),
    false,
    "the shipped path validator must refuse a control character",
  );
});
test("R20-05: the two sides render identically for a real identity", () => {
  // F-240: the pre-fix case compared two template literals written INSIDE the
  // test — `jsKey` and `sqlKey` were the same expression — so it could not
  // fail for any production change. Both sides now come from the shipped
  // module: the JS side from the shipped key builder, the SQL side from the
  // shipped expression, evaluated the way PostgreSQL evaluates it.
  const identities = [
    { namespace: ["office", "ops"], capability: "s", version: "1.0.0" },
    {
      namespace: ["supply-chain", "inventory"],
      capability: "safety-stock",
      version: "2.10.3",
    },
    { namespace: ["data"], capability: "power-bi-report", version: "0.1.0" },
  ];
  for (const identity of identities) {
    const jsKey = tombstoneKey(identity);
    const sqlKey = evaluateTombstoneSql(TOMBSTONE_KEY_SQL_EXPRESSION, identity);
    assert.equal(
      jsKey,
      sqlKey,
      `the JS and SQL keys must agree for ${JSON.stringify(identity)}`,
    );
    assert.equal(
      sqlKey.split("|").length,
      3,
      `the key must carry exactly three components: ${sqlKey}`,
    );
  }
});

test("R20-06: an identity carrying the separator is refused by the catalog", async () => {
  // The fix is only sound if `|` cannot appear in any identity component.
  //
  // F-240: the pre-fix case asserted that a charset string DEFINED INSIDE the
  // test did not contain the separator — a statement about the test, not
  // about the store, and unchangeable by any production edit. The store's own
  // identity grammar is what proves it, and it is proven by driving it: a
  // manifest whose identity carries the separator is refused, so such an
  // identity can never reach a tombstone key.
  const mutations = [
    (identity) => {
      identity.capability = "safe|stock";
    },
    (identity) => {
      identity.namespace = ["supply-chain|inventory"];
    },
    (identity) => {
      identity.version = "1.0.0|x";
    },
  ];
  for (const mutate of mutations) {
    const root = await mkdtemp(path.join(os.tmpdir(), "r20-separator-"));
    try {
      const identity = {
        namespace: ["supply-chain", "inventory"],
        capability: "safety-stock",
        version: "1.0.0",
      };
      mutate(identity);
      await writeSkillWithIdentity(root, identity);
      const catalog = await scanCatalog(root);
      assert.ok(
        catalog.errors.length > 0,
        `an identity carrying the separator must be refused: ${JSON.stringify(identity)}`,
      );
      assert.ok(
        catalog.errors.some((error) =>
          ["MANIFEST_SCHEMA_INVALID", "DIRECTORY_GRAMMAR_INVALID"].includes(
            error.code,
          ),
        ),
        `the refusal must name a catalog diagnostic: ${JSON.stringify(catalog.errors)}`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
