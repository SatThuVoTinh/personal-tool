// M12/T2-R1 forum-tag machinery. The owner's rule is "exactly one tag per category, chosen
// from what the request actually is" across three forums that do NOT share a vocabulary, and
// "an unresolvable required tag means no post plus a loud log — never a short-tagged thread
// reported as success". These tests pin the machinery against the tag NAMES the owner dumped
// read-only from his live server on 2026-10-13; no snowflake from that dump is repeated here,
// because the repository must hold names and read ids at run time.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STACK_TAG_OF,
  STACK_TAG_PRECEDENCE,
  SURFACE_TAG_CATEGORIES,
  approvalRiskTag,
  approvalStatusTag,
  buildSurfaceSelections,
  buildTagName,
  createForumTagResolver,
  incidentSeverityTag,
  incidentStatusTag,
  normalizeTagName,
  parseTagName,
  readActiveForumThreads,
  FORUM_THREAD_MAX_PAGES,
  readForumTags,
  readForumThreadTags,
  resultStatusTag,
  resultTypeTag,
  surfaceStackTag,
  transitionGovernedForumStatus,
} from "../integrations/openclaw/lib/discord-forum-tags.mjs";
import { incidentSurfaceDecision } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

// Non-routable placeholders: value shape only, never the owner's live ids.
const APPROVALS_CHANNEL = "1000000000000000001";
const RESULTS_CHANNEL = "1000000000000000002";
const INCIDENTS_CHANNEL = "1000000000000000003";

const APPROVAL_TAGS = [
  "STATUS: WAITING",
  "STATUS: APPROVED",
  "STATUS: REJECTED",
  "STATUS: CHANGES",
  "STATUS: EXPIRED",
  "RISK: LOW",
  "RISK: MEDIUM",
  "RISK: RED",
  "STACK: INFRA",
  "STACK: SEMANTIC",
  "STACK: ANALYTICS",
  "STACK: DECISION",
  "STACK: DATA",
].map((name, index) => ({ id: `a${index}`, name }));

const RESULTS_TAGS = [
  "STATUS: SUCCESS",
  "STATUS: FAILED",
  "STATUS: PARTIAL",
  "TYPE: ANALYSIS",
  "TYPE: DATA",
  "TYPE: REPORT",
  "TYPE: MODEL",
  "TYPE: RESEARCH",
  "TYPE: AUTOMATION",
  "STACK: INFRA",
  "STACK: ANALYTICS",
  "STACK: SEMANTIC",
  "STACK: DECISION",
  "STACK: DATA",
].map((name, index) => ({ id: `r${index}`, name }));

// The live dump really does contain `STATUS: ANALYTICS` in #incidents, where the STACK
// category belongs. That is the owner-side naming defect: the matcher must refuse it rather
// than alias around it.
const INCIDENT_TAGS = [
  "STATUS: OPEN",
  "STATUS: INVESTIGATE",
  "STATUS: MITIGATE",
  "STATUS: SOLVED",
  "SEVERITY: LOW",
  "SEVERITY: MEDIUM",
  "SEVERITY: HIGH",
  "SEVERITY: CRITICAL",
  "STACK: INFRA",
  "STACK: DATA",
  "STACK: SEMANTIC",
  "STATUS: ANALYTICS",
  "STACK: DECISION",
].map((name, index) => ({ id: `i${index}`, name }));

const TAG_SETS = {
  [APPROVALS_CHANNEL]: APPROVAL_TAGS,
  [RESULTS_CHANNEL]: RESULTS_TAGS,
  [INCIDENTS_CHANNEL]: INCIDENT_TAGS,
};

// F-003: the guild the three governed forums live in.
const GUILD_ID = "900000000000000001";

function fakeFetch({ fail = false, grouped = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (fail) return { ok: false, status: 403, json: async () => ({}) };
    const channel = /\/channels\/([^/]+)$/.exec(url);
    if (channel) {
      const list = TAG_SETS[channel[1]] ?? [];
      // F-003: the channel read is how the guild id is resolved when the
      // caller does not name one, so the stub answers with one.
      if (grouped)
        return {
          ok: true,
          json: async () => ({ id: channel[1], guild_id: GUILD_ID }),
        };
      return {
        ok: true,
        json: async () => ({
          id: channel[1],
          guild_id: GUILD_ID,
          available_tags: list.map((t) => ({ ...t })),
        }),
      };
    }
    if (url.endsWith("/tags")) {
      const id = /\/channels\/([^/]+)\/tags/.exec(url)[1];
      return {
        ok: true,
        json: async () => ({
          items: (TAG_SETS[id] ?? []).map((tag, index) => ({
            ...tag,
            group_id: `g${index % 3}`,
          })),
        }),
      };
    }
    // F-003: the listing is a GUILD route (`/guilds/{id}/threads/active`),
    // and it spans every channel of the guild, so the reader filters it by
    // `parent_id`. The stub answers with one thread of another parent too,
    // so a reader that stopped filtering would see it.
    if (/\/guilds\/[^/]+\/threads\/active$/.test(url)) {
      return {
        ok: true,
        json: async () => ({
          threads: [
            { id: "t-other", name: "OTHER PARENT", parent_id: RESULTS_CHANNEL },
            {
              id: "t1",
              name: "INCIDENT 12345678ABCD ALREADY OPEN",
              parent_id: INCIDENTS_CHANNEL,
            },
          ],
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

function logger() {
  const lines = [];
  return { lines, warn: (line) => lines.push(line) };
}

const selections = (surface, values) => {
  const { selections: list, absent } = buildSurfaceSelections(surface, values);
  assert.deepEqual(absent, [], `${surface} selections must be complete`);
  return list;
};

describe("M12/T2 P1 — each forum owns its own categories", () => {
  it("requires exactly three categories per surface, no more and no fewer", () => {
    assert.deepEqual(SURFACE_TAG_CATEGORIES.approvals, [
      "STATUS",
      "RISK",
      "STACK",
    ]);
    assert.deepEqual(SURFACE_TAG_CATEGORIES.results, [
      "STATUS",
      "TYPE",
      "STACK",
    ]);
    assert.deepEqual(SURFACE_TAG_CATEGORIES.incidents, [
      "STATUS",
      "SEVERITY",
      "STACK",
    ]);
    for (const categories of Object.values(SURFACE_TAG_CATEGORIES))
      assert.equal(categories.length, 3);
  });

  it("normalizes the naming styles a Discord server can hold without duplicating a parser", () => {
    assert.equal(normalizeTagName("STATUS:  waiting"), "STATUS WAITING");
    assert.equal(normalizeTagName("stack_excel"), "STACK EXCEL");
    assert.equal(normalizeTagName("Stack / Excel"), "STACK EXCEL");
    assert.deepEqual(parseTagName("RISK: RED"), {
      category: "RISK",
      value: "RED",
      normalized: "RISK RED",
    });
    // A tag with no category prefix can never satisfy a required category.
    assert.equal(parseTagName("ANALYTICS").category, "");
    assert.equal(buildTagName("STACK", "INFRA"), "STACK: INFRA");
  });

  it("resolves three ids for an approvals card from the approvals channel alone", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const resolver = createForumTagResolver({ logger: logger() });
    const result = await resolver.resolve({
      surface: "approvals",
      channelId: APPROVALS_CHANNEL,
      token: "t",
      fetchImpl,
      selections: selections("approvals", {
        status: approvalStatusTag(),
        risk: approvalRiskTag(["state_mutation_risk"]),
        stack: surfaceStackTag({ currentStack: "data_plant" }),
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.tagIds.length, 3);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/channels\/1000000000000000001$/u);
  });
});

describe("M12/T2 P1 — a required tag that cannot be resolved stops the post", () => {
  it("does not assume #approvals tags exist in #results", async () => {
    const resolver = createForumTagResolver({ logger: logger() });
    const result = await resolver.resolve({
      surface: "results",
      channelId: RESULTS_CHANNEL,
      token: "t",
      fetchImpl: fakeFetch().fetchImpl,
      // RISK exists in #approvals and nowhere in #results: the results surface must not be
      // allowed to borrow it.
      selections: selections("results", {
        status: { category: "STATUS", value: "WAITING" },
        type: { category: "TYPE", value: "DATA" },
        stack: { category: "STACK", value: "DATA" },
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "DISCORD_TAG_UNRESOLVED");
    assert.deepEqual(result.missing, [
      {
        category: "STATUS",
        value: "WAITING",
        wanted: "STATUS: WAITING",
        reason: "VALUE_ABSENT",
      },
    ]);
    // The two that did match must not be treated as a green light.
    assert.equal(result.tagIds.length, 2);
  });

  it("names the channel, the category and the wanted tag in the log line", async () => {
    const log = logger();
    const resolver = createForumTagResolver({ logger: log });
    await resolver.resolve({
      surface: "incidents",
      channelId: INCIDENTS_CHANNEL,
      token: "t",
      fetchImpl: fakeFetch().fetchImpl,
      selections: selections("incidents", {
        status: incidentStatusTag(),
        severity: { category: "SEVERITY", value: "HIGH" },
        stack: { category: "STACK", value: "ANALYTICS" },
      }),
    });
    assert.equal(
      log.lines.filter((line) => line.includes("DISCORD_TAG_UNRESOLVED"))
        .length,
      1,
    );
    assert.match(
      log.lines[0],
      /channel=incidents category=STACK wanted="STACK: ANALYTICS"/u,
    );
  });

  it("reports a missing category separately from a missing value", async () => {
    const resolver = createForumTagResolver({ logger: logger() });
    const result = await resolver.resolve({
      surface: "results",
      channelId: APPROVALS_CHANNEL,
      token: "t",
      fetchImpl: fakeFetch().fetchImpl,
      selections: selections("results", {
        status: { category: "STATUS", value: "SUCCESS" },
        type: { category: "TYPE", value: "DATA" },
        stack: { category: "STACK", value: "INFRA" },
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(
      result.missing.find((entry) => entry.category === "TYPE")?.reason,
      "CATEGORY_ABSENT",
    );
  });

  it("treats an unreadable channel as unresolved and never caches the failure", async () => {
    const log = logger();
    const { fetchImpl, calls } = fakeFetch({ fail: true });
    const resolver = createForumTagResolver({ logger: log });
    const first = await resolver.resolve({
      surface: "approvals",
      channelId: APPROVALS_CHANNEL,
      token: "t",
      fetchImpl,
      selections: selections("approvals", {
        status: approvalStatusTag(),
        risk: approvalRiskTag(["read_only"]),
        stack: surfaceStackTag({ currentStack: "infrastructure" }),
      }),
    });
    const second = await resolver.resolve({
      surface: "approvals",
      channelId: APPROVALS_CHANNEL,
      token: "t",
      fetchImpl,
      selections: selections("approvals", {
        status: approvalStatusTag(),
        risk: approvalRiskTag(["read_only"]),
        stack: surfaceStackTag({ currentStack: "infrastructure" }),
      }),
    });
    for (const outcome of [first, second]) {
      assert.equal(outcome.ok, false);
      assert.equal(outcome.code, "DISCORD_TAGS_UNREADABLE");
      assert.match(
        log.lines.join("\n"),
        /DISCORD_TAGS_UNREADABLE channel=approvals/u,
      );
    }
    assert.equal(
      calls.length,
      2,
      "a failed read must be retried, not remembered",
    );
  });

  it("refuses an incomplete selection set instead of posting two tags", async () => {
    const resolver = createForumTagResolver({ logger: logger() });
    const result = await resolver.resolve({
      surface: "approvals",
      channelId: APPROVALS_CHANNEL,
      token: "t",
      fetchImpl: fakeFetch().fetchImpl,
      selections: [
        { category: "STATUS", value: "WAITING" },
        { category: "STACK", value: "INFRA" },
      ],
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "FORUM_TAG_SELECTION_INCOMPLETE");
    assert.deepEqual(result.missing, ["RISK"]);
  });
});

describe("M12/T2 P1 — reads go through the bounded Discord path", () => {
  it("sends an authorized, deadline-bounded request and falls back to the grouped form", async () => {
    const { fetchImpl, calls } = fakeFetch({ grouped: true });
    const tags = await readForumTags({
      channelId: RESULTS_CHANNEL,
      token: "secret-token",
      fetchImpl,
      deadlineMs: 5000,
    });
    assert.equal(tags.length, RESULTS_TAGS.length);
    assert.equal(calls.length, 2, "channel object then the grouped tag list");
    assert.equal(calls[0].init.headers.Authorization, "Bot secret-token");
    assert.ok(
      calls[0].init.signal,
      "every Discord read carries an abort signal",
    );
    assert.equal(
      calls[1].url,
      `https://discord.com/api/v10/channels/${RESULTS_CHANNEL}/tags`,
    );
    assert.ok(tags.every((tag) => typeof tag.groupId === "string"));
    assert.equal(
      tags.find((tag) => tag.name === "TYPE: MODEL").category,
      "TYPE",
    );
  });

  it("refuses to read without a deadline instead of fetching unbounded", async () => {
    await assert.rejects(
      () =>
        readForumTags({
          channelId: RESULTS_CHANNEL,
          token: "t",
          fetchImpl: fakeFetch().fetchImpl,
        }),
      /FORUM_TAG_DEADLINE_REQUIRED/u,
    );
    await assert.rejects(
      () =>
        readActiveForumThreads({
          channelId: RESULTS_CHANNEL,
          token: "t",
          fetchImpl: fakeFetch().fetchImpl,
        }),
      /FORUM_TAG_DEADLINE_REQUIRED/u,
    );
    await assert.rejects(
      () =>
        readForumTags({
          token: "t",
          deadlineMs: 1000,
          fetchImpl: fakeFetch().fetchImpl,
        }),
      /FORUM_TAG_CHANNEL_REQUIRED/u,
    );
  });

  it("lists active threads so an incident retry can be recognized", async () => {
    const listing = await readActiveForumThreads({
      channelId: INCIDENTS_CHANNEL,
      token: "t",
      fetchImpl: fakeFetch().fetchImpl,
      deadlineMs: 5000,
    });
    assert.equal(listing.threads.length, 1);
    assert.equal(
      listing.threads[0].normalized,
      "INCIDENT 12345678ABCD ALREADY OPEN",
    );
    assert.equal(listing.truncated, false);
  });
});

// ---------------------------------------------------------------------------
// M12/T9 F-016 — a first-page-only listing is a PARTIAL listing
// ---------------------------------------------------------------------------

describe("M12/T9 F-016 - a truncated thread listing is reported, never treated as complete", () => {
  function pagedFetch(pages) {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      const index = calls.length - 1;
      const page = pages[Math.min(index, pages.length - 1)];
      return { ok: true, json: async () => page };
    };
    return { fetchImpl, calls };
  }

  it("follows the cursor while Discord reports another page", async () => {
    const { fetchImpl, calls } = pagedFetch([
      {
        threads: [
          {
            id: "t1",
            name: "INCIDENT 11111111AAAA",
            parent_id: INCIDENTS_CHANNEL,
          },
        ],
        has_more: true,
        next_cursor: "cursor-2",
      },
      {
        threads: [
          {
            id: "t2",
            name: "INCIDENT 22222222BBBB",
            parent_id: INCIDENTS_CHANNEL,
          },
        ],
        has_more: false,
      },
    ]);
    const listing = await readActiveForumThreads({
      channelId: INCIDENTS_CHANNEL,
      guildId: GUILD_ID,
      token: "t",
      fetchImpl,
      deadlineMs: 5000,
    });
    assert.equal(
      listing.truncated,
      false,
      "a complete listing is not truncated",
    );
    assert.equal(listing.threads.length, 2, "both pages are read");
    assert.equal(calls.length, 2, "the second page is requested");
    assert.ok(
      calls[1].url.includes("cursor-2"),
      `the second page must carry the cursor, got ${calls[1].url}`,
    );
  });

  it("reports truncation when Discord says more exists but no cursor is offered", async () => {
    const { fetchImpl } = pagedFetch([
      {
        threads: [
          {
            id: "t1",
            name: "INCIDENT 11111111AAAA",
            parent_id: INCIDENTS_CHANNEL,
          },
        ],
        has_more: true,
      },
    ]);
    const listing = await readActiveForumThreads({
      channelId: INCIDENTS_CHANNEL,
      guildId: GUILD_ID,
      token: "t",
      fetchImpl,
      deadlineMs: 5000,
    });
    assert.equal(
      listing.truncated,
      true,
      "a listing that cannot be completed is truncated",
    );
    // F-003: the listing is a GUILD route now, and a guild listing
    // paginates by the last thread id of the page — so a body that offers no
    // cursor of its own is still paginated, and the reader's own page budget
    // is what bounds it. The claim this case makes is that the listing is
    // TRUNCATED, and that the reader stays inside its budget rather than
    // accumulating without limit.
    assert.ok(
      listing.threads.length <= FORUM_THREAD_MAX_PAGES,
      `the reader must stay inside its page budget, got ${listing.threads.length} threads`,
    );
  });

  it("reports truncation when the page budget is exhausted", async () => {
    const { fetchImpl, calls } = pagedFetch([
      {
        threads: [
          {
            id: "t1",
            name: "INCIDENT 11111111AAAA",
            parent_id: INCIDENTS_CHANNEL,
          },
        ],
        has_more: true,
        next_cursor: "cursor-loop",
      },
    ]);
    const listing = await readActiveForumThreads({
      channelId: INCIDENTS_CHANNEL,
      guildId: GUILD_ID,
      token: "t",
      fetchImpl,
      deadlineMs: 5000,
      maxPages: 3,
    });
    assert.equal(listing.truncated, true);
    assert.equal(calls.length, 3, "the page budget is bounded");
  });

  it("refuses to open a second thread when the listing could not be completed", async () => {
    // The caller's dedupe rule, driven by the SAME stub body that carries has_more.
    // A partial listing must read as "unable to conclude", never as "not open yet".
    const { fetchImpl } = pagedFetch([
      {
        threads: [
          {
            id: "t1",
            name: "INCIDENT 99999999ZZZZ",
            parent_id: INCIDENTS_CHANNEL,
          },
        ],
        has_more: true,
      },
    ]);
    const listing = await readActiveForumThreads({
      channelId: INCIDENTS_CHANNEL,
      guildId: GUILD_ID,
      token: "t",
      fetchImpl,
      deadlineMs: 5000,
    });
    const decision = incidentSurfaceDecision(listing, "99999999ZZZZ");
    assert.equal(
      decision.open,
      false,
      "a truncated listing cannot authorise a post",
    );
    assert.equal(decision.reason, "THREAD_LIST_TRUNCATED");
  });

  it("opens a thread only for a complete listing that does not carry the token", async () => {
    const complete = await readActiveForumThreads({
      channelId: INCIDENTS_CHANNEL,
      guildId: GUILD_ID,
      token: "t",
      fetchImpl: fakeFetch().fetchImpl,
      deadlineMs: 5000,
    });
    assert.deepEqual(incidentSurfaceDecision(complete, "99999999ZZZZ"), {
      open: true,
      reason: null,
    });
    assert.deepEqual(incidentSurfaceDecision(complete, "12345678ABCD"), {
      open: false,
      reason: "ALREADY_SURFACED",
    });
  });
});

describe("M12/T2 P1 — classification follows the request, never a default", () => {
  it("takes the highest risk class present in the admitted brief", () => {
    assert.deepEqual(
      approvalRiskTag(["read_only", "orchestrated_workflow_trigger"]),
      {
        category: "RISK",
        value: "RED",
      },
    );
    assert.deepEqual(approvalRiskTag(["state_mutation_risk", "read_only"]), {
      category: "RISK",
      value: "MEDIUM",
    });
    assert.deepEqual(approvalRiskTag(["isolated_compute"]), {
      category: "RISK",
      value: "MEDIUM",
    });
    assert.deepEqual(approvalRiskTag(["read_only", "none_schema_only"]), {
      category: "RISK",
      value: "LOW",
    });
    // No tool evidence, or an unknown class, is not evidence of a low-risk task.
    assert.equal(approvalRiskTag([]), null);
    assert.equal(approvalRiskTag(["read_only", "mystery_class"]), null);
  });

  it("maps the five durable stacks and takes the deepest one a task reaches", () => {
    // The order is the rule, so it is pinned as a set as well as through behaviour: a stack
    // missing from it would make any plan that reaches only that stack untaggable again.
    assert.deepEqual(
      [...STACK_TAG_PRECEDENCE].sort(),
      Object.keys(STACK_TAG_OF).sort(),
      "the precedence must order exactly the stacks the ledger can hold",
    );
    assert.deepEqual(surfaceStackTag({ currentStack: "infrastructure" }), {
      category: "STACK",
      value: "INFRA",
    });
    assert.deepEqual(surfaceStackTag({ currentStack: "data_plant" }), {
      category: "STACK",
      value: "DATA",
    });
    assert.deepEqual(surfaceStackTag({ currentStack: "intelligence" }), {
      category: "STACK",
      value: "ANALYTICS",
    });
    assert.deepEqual(
      surfaceStackTag({ currentStack: "semantic", nodeStackIds: ["semantic"] }),
      { category: "STACK", value: "SEMANTIC" },
    );
    assert.deepEqual(surfaceStackTag({ nodeStackIds: ["decision"] }), {
      category: "STACK",
      value: "DECISION",
    });
    // The live defect this replaced: a real plan spans stacks (excel/sql = DATA plus
    // power-bi = ANALYTICS), and the old "exactly one distinct stack, else nothing" rule refused
    // the whole approval card. The tag now names the surface the plan's output belongs to.
    assert.deepEqual(
      surfaceStackTag({ nodeStackIds: ["data_plant", "intelligence"] }),
      { category: "STACK", value: "ANALYTICS" },
    );
    assert.deepEqual(
      surfaceStackTag({ nodeStackIds: ["semantic", "decision"] }),
      { category: "STACK", value: "DECISION" },
    );
    assert.deepEqual(
      surfaceStackTag({
        nodeStackIds: ["data_plant", "semantic", "infrastructure"],
      }),
      { category: "STACK", value: "DATA" },
      "meaning and machine work under an ETL deliverable stay DATA",
    );
    assert.deepEqual(
      surfaceStackTag({ nodeStackIds: ["semantic", "infrastructure"] }),
      { category: "STACK", value: "SEMANTIC" },
    );
    assert.deepEqual(
      surfaceStackTag({
        currentStack: "data_plant",
        nodeStackIds: ["intelligence"],
      }),
      { category: "STACK", value: "DATA" },
      "a stack the ledger has bound for execution outranks the plan's reach",
    );
    assert.equal(surfaceStackTag({}), null);
    assert.equal(surfaceStackTag({ currentStack: "excel" }), null);
    assert.equal(
      surfaceStackTag({ nodeStackIds: ["excel", "power_bi"] }),
      null,
      "software names are not stacks; nothing is invented",
    );
  });

  it("maps only the verdicts that actually have a results tag", () => {
    assert.deepEqual(
      resultStatusTag({ decision: "ACCEPT", outcomeStatus: "COMPLETE" }),
      {
        category: "STATUS",
        value: "SUCCESS",
      },
    );
    assert.deepEqual(
      resultStatusTag({ decision: "ACCEPT", outcomeStatus: "PARTIAL" }),
      {
        category: "STATUS",
        value: "PARTIAL",
      },
    );
    assert.deepEqual(resultStatusTag({ decision: "REJECT" }), {
      category: "STATUS",
      value: "FAILED",
    });
    // BLOCKED and CANCELLED are not owner judgements about a result; forcing them into
    // FAILED would report a verdict that was never made.
    assert.equal(resultStatusTag({ decision: "BLOCK" }), null);
    assert.equal(
      resultStatusTag({ decision: "ACCEPT", outcomeStatus: "BLOCKED" }),
      null,
    );
    assert.equal(
      resultStatusTag({ decision: "ACCEPT", outcomeStatus: "CANCELLED" }),
      null,
    );
  });

  it("reads TYPE from durable evidence first, then the brief target, then nothing", () => {
    assert.deepEqual(
      resultTypeTag({
        artifactPaths: [{ logical_path: "sales.xlsx" }],
        target: "python",
      }),
      { category: "TYPE", value: "DATA" },
    );
    assert.deepEqual(resultTypeTag({ artifactPaths: ["report.md"] }), {
      category: "TYPE",
      value: "REPORT",
    });
    assert.deepEqual(resultTypeTag({ artifactPaths: [], target: "power-bi" }), {
      category: "TYPE",
      value: "REPORT",
    });
    assert.deepEqual(resultTypeTag({ target: "sql" }), {
      category: "TYPE",
      value: "DATA",
    });
    assert.deepEqual(resultTypeTag({ declaredType: "automation" }), {
      category: "TYPE",
      value: "AUTOMATION",
    });
    assert.equal(resultTypeTag({ artifactPaths: ["mystery.bin"] }), null);
    assert.equal(resultTypeTag({}), null);
  });

  it("grades severity from the containment decision", () => {
    assert.deepEqual(
      incidentSeverityTag({
        reason: "NATIVE_COMPLETION_UNRECONCILED",
        scope: "ALL_LIVE_RUNS",
      }),
      { category: "SEVERITY", value: "CRITICAL" },
    );
    assert.deepEqual(
      incidentSeverityTag({
        reason: "NATIVE_COMPLETION_UNRECONCILED",
        scope: "IDENTIFIED_RUN",
        ledgerError: "LEDGER_WRITE_FAILED",
      }),
      { category: "SEVERITY", value: "CRITICAL" },
    );
    assert.deepEqual(
      incidentSeverityTag({
        reason: "NATIVE_COMPLETION_UNRECONCILED",
        scope: "IDENTIFIED_RUN",
      }),
      { category: "SEVERITY", value: "HIGH" },
    );
    assert.deepEqual(
      incidentSeverityTag({ reason: "SPAWN_LINEAGE_MISMATCH" }),
      {
        category: "SEVERITY",
        value: "HIGH",
      },
    );
    assert.deepEqual(incidentSeverityTag({ reason: "SOMETHING_ELSE" }), {
      category: "SEVERITY",
      value: "MEDIUM",
    });
    assert.equal(incidentSeverityTag({}), null);
  });
});

describe("M12/T2 P1 — the tag read is cached per channel", () => {
  it("reads once per ttl, then re-reads after expiry or invalidation", async () => {
    let clock = 0;
    const { fetchImpl, calls } = fakeFetch();
    const resolver = createForumTagResolver({
      logger: logger(),
      ttlMs: 1000,
      now: () => clock,
    });
    const args = {
      surface: "approvals",
      channelId: APPROVALS_CHANNEL,
      token: "t",
      fetchImpl,
      selections: selections("approvals", {
        status: approvalStatusTag(),
        risk: approvalRiskTag(["read_only"]),
        stack: surfaceStackTag({ currentStack: "infrastructure" }),
      }),
    };
    await resolver.resolve(args);
    await resolver.resolve(args);
    assert.equal(
      calls.length,
      1,
      "the second card must reuse the cached tag list",
    );
    clock = 1500;
    await resolver.resolve(args);
    assert.equal(
      calls.length,
      2,
      "a cached read expires instead of living for the process",
    );
    clock = 0;
    resolver.invalidate(APPROVALS_CHANNEL);
    await resolver.resolve(args);
    assert.equal(calls.length, 3);
    assert.equal(resolver.size(), 1);
  });
});

// ---------------------------------------------------------------- M12/T2-R2

const THREAD_ID = "9000000000000000001";

/**
 * Serves the forum tag list on the channel read and a thread's own tags on the thread read, and
 * records the PATCH so a test can assert exactly what Discord was asked to change.
 */
function threadFetch({ threadTags = [], patchStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (init.method === "PATCH")
      return patchStatus === 200
        ? { ok: true, status: 200, json: async () => ({}) }
        : { ok: false, status: patchStatus, json: async () => ({}) };
    const single = /\/channels\/([^/]+)$/.exec(url);
    if (single) {
      if (single[1] === THREAD_ID)
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: THREAD_ID, applied_tags: threadTags }),
        };
      const list = TAG_SETS[single[1]] ?? [];
      return {
        ok: true,
        status: 200,
        json: async () => ({ available_tags: list.map((t) => ({ ...t })) }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

const transition = (over = {}) =>
  transitionGovernedForumStatus({
    surface: "approvals",
    channelId: APPROVALS_CHANNEL,
    threadId: THREAD_ID,
    token: "t",
    status: approvalStatusTag("APPROVE"),
    resolver: createForumTagResolver({}),
    fetchImpl: threadFetch().fetchImpl,
    deadlineMs: 10_000,
    ...over,
  });

describe("M12/T2-R2 — the verdict moves the thread STATUS tag", () => {
  it("maps the owner decision onto the forum own STATUS values", () => {
    assert.deepEqual(approvalStatusTag(), {
      category: "STATUS",
      value: "WAITING",
    });
    assert.deepEqual(approvalStatusTag("REQUEST"), {
      category: "STATUS",
      value: "WAITING",
    });
    assert.equal(approvalStatusTag("APPROVE").value, "APPROVED");
    assert.equal(approvalStatusTag("REJECT").value, "REJECTED");
    assert.equal(approvalStatusTag("REQUEST_REVISION").value, "CHANGES");
    assert.equal(approvalStatusTag("EXPIRE"), null);
    assert.equal(approvalStatusTag("ACCEPT_RESULT"), null);
  });

  it("reads a thread tag list and refuses an unbounded or unauthenticated read", async () => {
    const { fetchImpl } = threadFetch({ threadTags: ["a0", "a6", "a8"] });
    assert.deepEqual(
      await readForumThreadTags({
        threadId: THREAD_ID,
        token: "t",
        fetchImpl,
        deadlineMs: 10_000,
      }),
      ["a0", "a6", "a8"],
    );
    await assert.rejects(
      () =>
        readForumThreadTags({
          threadId: THREAD_ID,
          token: "t",
          fetchImpl,
          deadlineMs: undefined,
        }),
      /FORUM_TAG_DEADLINE_REQUIRED/u,
    );
    await assert.rejects(
      () =>
        readForumThreadTags({
          threadId: "",
          token: "t",
          fetchImpl,
          deadlineMs: 10_000,
        }),
      /FORUM_TAG_THREAD_REQUIRED/u,
    );
    await assert.rejects(
      () =>
        readForumThreadTags({
          threadId: THREAD_ID,
          token: "",
          fetchImpl,
          deadlineMs: 10_000,
        }),
      /FORUM_TAG_TOKEN_REQUIRED/u,
    );
  });

  it("replaces only the STATUS tag and keeps every id it did not put there", async () => {
    const { fetchImpl, calls } = threadFetch({
      threadTags: ["a0", "a6", "a8", "z99"],
    });
    const log = logger();
    const result = await transition({
      fetchImpl,
      resolver: createForumTagResolver({ logger: log }),
    });
    assert.equal(result.applied, true);
    const patch = calls.find((call) => call.init.method === "PATCH");
    assert.equal(
      patch.url,
      `https://discord.com/api/v10/channels/${THREAD_ID}`,
    );
    assert.deepEqual(
      [...JSON.parse(patch.init.body).applied_tags].sort(),
      ["a1", "a6", "a8", "z99"].sort(),
      "WAITING becomes APPROVED and nothing else is touched",
    );
    assert.equal(
      JSON.parse(patch.init.body).applied_tags.includes("a0"),
      false,
      "a decided card may not keep asking",
    );
    assert.equal(patch.init.signal !== undefined, true);
  });

  it("never PATCHes when that forum has no such STATUS value, and names why", async () => {
    const { fetchImpl, calls } = threadFetch({
      threadTags: ["a0", "a6", "a8"],
    });
    const log = logger();
    // The results forum carries STATUS: SUCCESS|FAILED|PARTIAL and no APPROVED at all, which is
    // exactly the cross-forum assumption requirement 2 forbids.
    const result = await transition({
      channelId: RESULTS_CHANNEL,
      fetchImpl,
      logger: log,
      resolver: createForumTagResolver({ logger: log }),
    });
    assert.equal(result.applied, false);
    assert.equal(result.code, "DISCORD_TAG_UNRESOLVED");
    assert.equal(
      calls.some((call) => call.init.method === "PATCH"),
      false,
      "an unresolved status must not reach Discord",
    );
    assert.match(
      log.lines.join("\n"),
      /DISCORD_TAG_UNRESOLVED channel=approvals category=STATUS wanted="STATUS: APPROVED" reason=VALUE_ABSENT/u,
    );
  });

  it("names CATEGORY_ABSENT when the forum has no STATUS category at all", async () => {
    const log = logger();
    const result = await transition({
      resolver: createForumTagResolver({
        readTags: async () => [],
        logger: log,
      }),
      logger: log,
      fetchImpl: threadFetch({ threadTags: ["a0"] }).fetchImpl,
    });
    assert.equal(result.code, "DISCORD_TAG_UNRESOLVED");
    assert.match(log.lines.join("\n"), /reason=CATEGORY_ABSENT/u);
  });

  it("reports a rejected PATCH by status instead of throwing into the verdict path", async () => {
    const log = logger();
    const result = await transition({
      fetchImpl: threadFetch({
        threadTags: ["a0"],
        patchStatus: 400,
      }).fetchImpl,
      resolver: createForumTagResolver({ logger: log }),
      logger: log,
    });
    assert.equal(result.applied, false);
    assert.equal(result.code, "DISCORD_TAG_TRANSITION_REJECTED_400");
    assert.match(
      log.lines.join("\n"),
      /DISCORD_TAG_TRANSITION_REJECTED channel=approvals threadId=/u,
    );
  });

  it("reports unreadable tags and sends nothing", async () => {
    const calls = [];
    const result = await transition({
      fetchImpl: async (url, init) => {
        if (init.method === "PATCH") calls.push({ url, init });
        throw new Error("ETIMEDOUT");
      },
      resolver: createForumTagResolver({ logger: logger() }),
    });
    assert.equal(result.code, "DISCORD_TAGS_UNREADABLE");
    assert.equal(calls.length, 0);
  });

  it("refuses an unknown surface, a missing thread and a missing status", async () => {
    assert.equal(
      (await transition({ surface: "office" })).code,
      "FORUM_SURFACE_UNKNOWN",
    );
    assert.equal(
      (await transition({ threadId: "" })).code,
      "FORUM_TAG_THREAD_REQUIRED",
    );
    assert.equal(
      (await transition({ channelId: "" })).code,
      "FORUM_TAG_CHANNEL_REQUIRED",
    );
    assert.equal(
      (await transition({ token: "" })).code,
      "FORUM_TAG_TOKEN_REQUIRED",
    );
    assert.equal(
      (await transition({ status: null })).code,
      "FORUM_TAG_STATUS_MISSING",
    );
    await assert.rejects(
      () => transition({ resolver: null }),
      /FORUM_TAG_RESOLVER_REQUIRED/u,
    );
    await assert.rejects(
      () => transition({ deadlineMs: 0 }),
      /FORUM_TAG_DEADLINE_REQUIRED/u,
    );
  });

  it("reuses the cached forum tags instead of re-reading the channel per transition", async () => {
    const { fetchImpl, calls } = threadFetch({
      threadTags: ["a0", "a6", "a8"],
    });
    const resolver = createForumTagResolver({});
    for (const status of [
      approvalStatusTag("APPROVE"),
      approvalStatusTag("REJECT"),
    ]) {
      const applied = await transition({ fetchImpl, resolver, status });
      assert.equal(applied.applied, true);
    }
    const reads = calls.filter(
      (call) =>
        call.url ===
        `https://discord.com/api/v10/channels/${APPROVALS_CHANNEL}`,
    ).length;
    assert.equal(reads, 1, "the forum tag list is read once and cached");
  });
});
