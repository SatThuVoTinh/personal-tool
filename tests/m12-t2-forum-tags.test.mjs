// M12/T2-R1 forum-tag machinery. The owner's rule is "exactly one tag per category, chosen
// from what the request actually is" across three forums that do NOT share a vocabulary, and
// "an unresolvable required tag means no post plus a loud log — never a short-tagged thread
// reported as success". These tests pin the machinery against the tag NAMES the owner dumped
// read-only from his live server on 2026-10-13; no snowflake from that dump is repeated here,
// because the repository must hold names and read ids at run time.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
  readForumTags,
  resultStatusTag,
  resultTypeTag,
  surfaceStackTag,
} from "../integrations/openclaw/lib/discord-forum-tags.mjs";

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

function fakeFetch({ fail = false, grouped = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (fail) return { ok: false, status: 403, json: async () => ({}) };
    const channel = /\/channels\/([^/]+)$/.exec(url);
    if (channel) {
      const list = TAG_SETS[channel[1]] ?? [];
      if (grouped)
        return {
          ok: true,
          json: async () => ({ id: channel[1] }),
        };
      return {
        ok: true,
        json: async () => ({ available_tags: list.map((t) => ({ ...t })) }),
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
    if (url.endsWith("/threads/active")) {
      const id = /\/channels\/([^/]+)\/threads\/active/.exec(url)[1];
      return {
        ok: true,
        json: async () => ({
          threads:
            id === INCIDENTS_CHANNEL
              ? [{ id: "t1", name: "INCIDENT 12345678ABCD ALREADY OPEN" }]
              : [],
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
    const threads = await readActiveForumThreads({
      channelId: INCIDENTS_CHANNEL,
      token: "t",
      fetchImpl: fakeFetch().fetchImpl,
      deadlineMs: 5000,
    });
    assert.equal(threads.length, 1);
    assert.equal(threads[0].normalized, "INCIDENT 12345678ABCD ALREADY OPEN");
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

  it("maps the five durable stacks and refuses to choose when a task spans two", () => {
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
    assert.equal(
      surfaceStackTag({ nodeStackIds: ["semantic", "decision"] }),
      null,
    );
    assert.equal(surfaceStackTag({}), null);
    assert.equal(surfaceStackTag({ currentStack: "excel" }), null);
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
