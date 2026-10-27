// M12/T9-R4 lane L3 (fix-tools) — F-434 (legacy R9-T05-1).
//
// The skill adapter's freshness gate used to read ONE table-wide
// `max(synced_at)` marker, so a single re-synced skill declared every row
// fresh and a row aged past the 7-day SLA kept being served. The fix decides
// freshness per served row from the row's own `synced_at` stamp: the OLDEST
// returned row decides, and a row older than the SLA can never be served
// because another skill was synced moments ago.
//
// Harness shape copied from tests/m11-t1-skill-governance.test.mjs (embedFn +
// dbExecutor injection; no live container, no real database).
import test from "node:test";
import assert from "node:assert/strict";

import { SkillAdapter } from "../zink-tools/adapters/skill-store/skill-adapter.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

function stamp(msAgo) {
  return new Date(Date.now() - msAgo).toISOString().replace(/\.\d{3}Z$/u, "Z");
}

const FRESH_STAMP = stamp(60 * 1000);
const NINE_DAY_STAMP = stamp(9 * DAY_MS);

function searchAdapter(output) {
  return new SkillAdapter(undefined, {
    embedFn: async () => [new Array(1024).fill(0.1)],
    dbExecutor: async () => output,
  });
}

function row(skillId, capability, score, syncedAt) {
  const obj = {
    skill_id: skillId,
    namespace: ["office"],
    capability,
    version: "1.0.0",
    domain: "office",
    primary_topic: "spreadsheet",
    subtopic: null,
    content: "# Body\ncontent",
    score,
  };
  if (syncedAt !== undefined) obj.synced_at = syncedAt;
  return JSON.stringify(obj);
}

const OLD_ROW = row(
  "00000000-0000-4000-8000-000000000001",
  "aged-skill",
  0.9,
  NINE_DAY_STAMP,
);
const FRESH_ROW = row(
  "00000000-0000-4000-8000-000000000002",
  "fresh-skill",
  0.95,
  FRESH_STAMP,
);

test("F-434: a re-synced sibling cannot vouch for a served row older than the SLA", async () => {
  // Table-wide marker is FRESH (the 1-day-old re-sync updated the max), but
  // one of the two served rows was synced 9 days ago — past the 7-day SLA.
  const output = `ZINK_FRESHNESS|${FRESH_STAMP}\n${OLD_ROW}\n${FRESH_ROW}`;
  await assert.rejects(
    () =>
      searchAdapter(output).querySkillStore({ action: "search", query: "x" }),
    (error) => {
      assert.equal(error.code, "SKILL_INDEX_STALE");
      return true;
    },
    "the aged served row must refuse, not ride the fresh table-wide marker",
  );
});

test("F-434: rows whose own stamps are all fresh are served normally", async () => {
  const output = `ZINK_FRESHNESS|${FRESH_STAMP}\n${FRESH_ROW}\n${row(
    "00000000-0000-4000-8000-000000000001",
    "aged-skill",
    0.9,
    FRESH_STAMP,
  )}`;
  const ok = await searchAdapter(output).querySkillStore({
    action: "search",
    query: "x",
  });
  assert.equal(ok.governed_status, "SUCCESS");
  assert.equal(ok.results.length, 2);
});

test("F-434: an unparseable per-row stamp fails closed instead of being skipped", async () => {
  const bad = row(
    "00000000-0000-4000-8000-000000000003",
    "bad-stamp-skill",
    0.9,
    "not-a-timestamp",
  );
  const output = `ZINK_FRESHNESS|${FRESH_STAMP}\n${FRESH_ROW}\n${bad}`;
  await assert.rejects(
    () =>
      searchAdapter(output).querySkillStore({ action: "search", query: "x" }),
    (error) => {
      assert.equal(error.code, "SKILL_INDEX_STALE");
      assert.match(error.message, /INVALID_SYNC_TIMESTAMP/u);
      return true;
    },
  );
});

test("F-434: a legacy stub row without a per-row stamp falls back to the table marker", async () => {
  const legacy = row(
    "00000000-0000-4000-8000-000000000004",
    "legacy-stub-skill",
    0.9,
    undefined,
  );
  const ok = await searchAdapter(
    `ZINK_FRESHNESS|${FRESH_STAMP}\n${legacy}`,
  ).querySkillStore({ action: "search", query: "x" });
  assert.equal(ok.governed_status, "SUCCESS");
  assert.equal(ok.results.length, 1);

  // The fallback does not weaken the shipped marker gate.
  await assert.rejects(
    () =>
      searchAdapter(
        `ZINK_FRESHNESS|${NINE_DAY_STAMP}\n${legacy}`,
      ).querySkillStore({ action: "search", query: "x" }),
    (error) => error.code === "SKILL_INDEX_STALE",
  );
});

test("F-434: the served SELECT projects each row's own synced_at stamp", async () => {
  let capturedSql = "";
  const adapter = new SkillAdapter(undefined, {
    embedFn: async () => [new Array(1024).fill(0.1)],
    dbExecutor: async (sql) => {
      capturedSql = sql;
      return `ZINK_FRESHNESS|${FRESH_STAMP}`;
    },
  });
  await adapter.querySkillStore({ action: "search", query: "x" });
  assert.match(
    capturedSql,
    /'synced_at', to_char\(c\.synced_at AT TIME ZONE 'UTC'/u,
    "the row projection must carry the per-row stamp the gate reads",
  );
});
