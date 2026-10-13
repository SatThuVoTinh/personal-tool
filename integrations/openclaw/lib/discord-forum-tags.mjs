/**
 * Governed Discord forum tags (M12/T2-R1).
 *
 * Every governed thread this plugin opens must carry exactly one tag per category of the
 * forum it is posted to: #approvals STATUS + RISK + STACK, #results STATUS + TYPE + STACK,
 * #incidents STATUS + SEVERITY + STACK. The three forums do NOT share a vocabulary, so
 * nothing here assumes a tag that exists in one channel exists in another: each channel's
 * own `available_tags` are read, and a category that is absent from that channel is an
 * error, never a silent omission.
 *
 * Tags are identified by Discord snowflakes, and the repository deliberately holds none of
 * them (owner decision Q2 = A). Names are the contract; ids are read from the live channel
 * at post time through the same token resolver the plugin already uses for thread
 * creation. That keeps a rename in Discord an operator action instead of a code change.
 *
 * Failure posture (owner requirement 4): if a required tag cannot be resolved, this module
 * reports it and the caller must NOT post. It returns results instead of throwing, so a
 * broken #approvals surface can never consume or block a #results or #incidents event
 * (requirement 5).
 */

export const SURFACE_TAG_CATEGORIES = Object.freeze({
  approvals: Object.freeze(["STATUS", "RISK", "STACK"]),
  results: Object.freeze(["STATUS", "TYPE", "STACK"]),
  incidents: Object.freeze(["STATUS", "SEVERITY", "STACK"]),
});

/** Tag names are read from Discord, so `stack_excel` and `STACK: EXCEL` must agree. */
export function normalizeTagName(name) {
  if (typeof name !== "string") return "";
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, " ")
    .trim();
}

/**
 * Split a Discord tag name into its category and value. Discord has no category concept
 * when tags are flat names, so the convention this repository's server uses
 * (`STATUS: WAITING`) is parsed here; a name without a separator contributes no category,
 * which keeps an unrelated tag from ever matching a required category.
 */
export function parseTagName(name) {
  const normalized = normalizeTagName(name);
  if (!normalized) return { category: "", value: "", normalized: "" };
  const at = normalized.indexOf(" ");
  if (at === -1) return { category: "", value: normalized, normalized };
  return {
    category: normalized.slice(0, at),
    value: normalized.slice(at + 1),
    normalized,
  };
}

export function buildTagName(category, value) {
  return `${category}: ${value}`;
}

/**
 * Every Discord call in this repository carries a deadline; an unbounded fetch is exactly
 * the defect class M11/T3-R1 removed. Tag reads are no exception, so a missing deadline is
 * refused rather than defaulting to "wait forever".
 */
function assertTagDeadline(deadlineMs) {
  if (
    typeof deadlineMs !== "number" ||
    !Number.isFinite(deadlineMs) ||
    deadlineMs <= 0
  )
    throw new Error("FORUM_TAG_DEADLINE_REQUIRED");
}

/**
 * Read a forum channel's tags. `GET /channels/{id}` carries `available_tags` on a forum
 * channel; `GET /channels/{id}/tags` is the newer grouped form and is used only when the
 * channel object has no flat list, so a server configured with tag groups still resolves.
 */
export async function readForumTags({
  channelId,
  token,
  fetchImpl = globalThis.fetch,
  deadlineMs,
}) {
  if (!channelId) throw new Error("FORUM_TAG_CHANNEL_REQUIRED");
  if (!token) throw new Error("FORUM_TAG_TOKEN_REQUIRED");
  assertTagDeadline(deadlineMs);
  const request = async (url) => {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(deadlineMs),
    });
    if (!response.ok)
      throw new Error(`DISCORD_CHANNEL_READ_FAILED_${response.status}`);
    return response.json();
  };
  const channel = await request(
    `https://discord.com/api/v10/channels/${channelId}`,
  );
  let raw = Array.isArray(channel?.available_tags)
    ? channel.available_tags
    : null;
  let groupIdOf = () => null;
  if (raw === null) {
    const grouped = await request(
      `https://discord.com/api/v10/channels/${channelId}/tags`,
    );
    raw = Array.isArray(grouped?.tags)
      ? grouped.tags
      : Array.isArray(grouped?.items)
        ? grouped.items
        : Array.isArray(grouped)
          ? grouped
          : [];
    groupIdOf = (tag) => tag?.group_id ?? tag?.groupId ?? null;
  }
  return raw
    .filter((tag) => tag && typeof tag.id === "string" && tag.name)
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      normalized: normalizeTagName(tag.name),
      category: parseTagName(tag.name).category,
      groupId: groupIdOf(tag),
    }));
}

/**
 * List the threads a forum currently holds. Used only where no durable publication marker
 * exists (incidents) to keep a retry from opening a second thread for the same incident;
 * the durable ledger fields are the primary guard everywhere else.
 */
export async function readActiveForumThreads({
  channelId,
  token,
  fetchImpl = globalThis.fetch,
  deadlineMs,
}) {
  if (!channelId) throw new Error("FORUM_TAG_CHANNEL_REQUIRED");
  if (!token) throw new Error("FORUM_TAG_TOKEN_REQUIRED");
  assertTagDeadline(deadlineMs);
  const response = await fetchImpl(
    `https://discord.com/api/v10/channels/${channelId}/threads/active`,
    {
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(deadlineMs),
    },
  );
  if (!response.ok)
    throw new Error(`DISCORD_THREAD_LIST_FAILED_${response.status}`);
  const body = await response.json();
  return (Array.isArray(body?.threads) ? body.threads : []).map((thread) => ({
    id: thread?.id,
    name: thread?.name ?? "",
    normalized: normalizeTagName(thread?.name ?? ""),
  }));
}

/**
 * A resolver is per plugin process. Reads are cached so a burst of governed cards does not
 * mean one REST call per card, and a failed read is never cached — the next attempt reads
 * again rather than inheriting a stale failure.
 */
/**
 * M12/T2-R2: the tags a thread carries right now. A transition must not re-derive the whole
 * trio from the ledger: the owner asked for the *state* to move, and re-deriving RISK/STACK
 * could silently rewrite tags that were already correct (or that he set by hand). So the
 * current list is read and only the STATUS-category entry is replaced.
 */
export async function readForumThreadTags({
  threadId,
  token,
  fetchImpl = globalThis.fetch,
  deadlineMs,
}) {
  if (!threadId) throw new Error("FORUM_TAG_THREAD_REQUIRED");
  if (!token) throw new Error("FORUM_TAG_TOKEN_REQUIRED");
  assertTagDeadline(deadlineMs);
  const response = await fetchImpl(
    `https://discord.com/api/v10/channels/${threadId}`,
    {
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(deadlineMs),
    },
  );
  if (!response.ok)
    throw new Error(`DISCORD_THREAD_READ_FAILED_${response.status}`);
  const thread = await response.json();
  return (Array.isArray(thread?.applied_tags) ? thread.applied_tags : [])
    .map((id) => String(id))
    .filter(Boolean);
}

export function createForumTagResolver({
  readTags = readForumTags,
  ttlMs = 10 * 60 * 1000,
  defaultDeadlineMs = 10_000,
  now = () => Date.now(),
  logger = null,
} = {}) {
  const cache = new Map();
  const warn = (line) => logger?.warn?.(line);

  async function tagsFor(channelId, context) {
    const hit = cache.get(channelId);
    if (hit && now() - hit.at < ttlMs) return hit.tags;
    const tags = await readTags({
      channelId,
      token: context.token,
      fetchImpl: context.fetchImpl,
      deadlineMs: context.deadlineMs ?? defaultDeadlineMs,
    });
    cache.set(channelId, { at: now(), tags });
    return tags;
  }

  /**
   * `selections` is one `{category, value}` per required category of the surface. The
   * return shape is deliberately a result object: the caller posts or does not post based
   * on `ok`, and no path here can report a short-tagged thread as a success.
   */
  async function resolve({ surface, channelId, selections, ...context }) {
    const categories = SURFACE_TAG_CATEGORIES[surface];
    if (!categories)
      return { ok: false, code: "FORUM_SURFACE_UNKNOWN", surface, missing: [] };
    if (!channelId)
      return {
        ok: false,
        code: "FORUM_TAG_CHANNEL_REQUIRED",
        surface,
        missing: [],
      };
    if (!Array.isArray(selections) || selections.length !== categories.length)
      return {
        ok: false,
        code: "FORUM_TAG_SELECTION_INCOMPLETE",
        surface,
        missing: categories.filter(
          (category) =>
            !Array.isArray(selections) ||
            !selections.some(
              (selection) =>
                selection?.category === category && selection.value,
            ),
        ),
      };

    let tags;
    try {
      tags = await tagsFor(channelId, context);
    } catch (err) {
      // Read failure is reported per surface with the channel named, and never degrades
      // into "post it untagged".
      const line = `[zink-governance] DISCORD_TAGS_UNREADABLE channel=${surface} channelId=${channelId} cause=${err?.message ?? err}`;
      warn(line);
      return {
        ok: false,
        code: "DISCORD_TAGS_UNREADABLE",
        surface,
        channelId,
        missing: categories.slice(),
        cause: err?.message ?? String(err),
      };
    }

    const missing = [];
    const tagIds = [];
    for (const { category, value } of selections) {
      const wanted = buildTagName(category, value);
      const normalizedWanted = normalizeTagName(wanted);
      const inCategory = tags.filter(
        (tag) =>
          tag.category === normalizeTagName(category) && tag.category !== "",
      );
      if (inCategory.length === 0) {
        missing.push({ category, value, wanted, reason: "CATEGORY_ABSENT" });
        continue;
      }
      const match = inCategory.find(
        (tag) => tag.normalized === normalizedWanted,
      );
      if (!match) {
        missing.push({ category, value, wanted, reason: "VALUE_ABSENT" });
        continue;
      }
      if (!tagIds.includes(match.id)) tagIds.push(match.id);
    }

    if (missing.length > 0) {
      for (const entry of missing) {
        warn(
          `[zink-governance] DISCORD_TAG_UNRESOLVED channel=${surface} category=${entry.category} wanted="${entry.wanted}" reason=${entry.reason} channelId=${channelId}`,
        );
      }
      return {
        ok: false,
        code: "DISCORD_TAG_UNRESOLVED",
        surface,
        channelId,
        tagIds,
        missing,
      };
    }
    return { ok: true, surface, channelId, tagIds, tags };
  }

  return {
    resolve,
    tags: (context) => tagsFor(context.channelId, context),
    invalidate: (channelId) => cache.delete(channelId),
    clear: () => cache.clear(),
    size: () => cache.size,
  };
}

/**
 * Q3 = A: the approvals RISK tag is the highest `riskClass` among the tools named in the
 * admitted brief. No risk field exists on a task or a brief, so this is the only derivation
 * that does not invent one. `null` means the brief carried no tool evidence at all — the
 * caller then reports an unresolved tag instead of defaulting to LOW.
 */
export function approvalRiskTag(riskClasses) {
  const classes = new Set(
    (Array.isArray(riskClasses) ? riskClasses : [])
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (classes.size === 0) return null;
  if (classes.has("orchestrated_workflow_trigger"))
    return { category: "RISK", value: "RED" };
  if (classes.has("state_mutation_risk") || classes.has("isolated_compute"))
    return { category: "RISK", value: "MEDIUM" };
  if (
    [...classes].every(
      (value) => value === "read_only" || value === "none_schema_only",
    )
  )
    return { category: "RISK", value: "LOW" };
  // An unknown risk class is not evidence of a low-risk task.
  return null;
}

/**
 * STACK is read from the ledger, never inferred from a bot name: `infrastructure → INFRA`,
 * `data_plant → DATA`, `semantic → SEMANTIC`, `intelligence → ANALYTICS`,
 * `decision → DECISION`. A task that spans more than one stack has no single honest tag.
 */
export const STACK_TAG_OF = Object.freeze({
  infrastructure: "INFRA",
  data_plant: "DATA",
  semantic: "SEMANTIC",
  intelligence: "ANALYTICS",
  decision: "DECISION",
});

export function surfaceStackTag({ currentStack, nodeStackIds = [] } = {}) {
  const candidates = [
    currentStack,
    ...(Array.isArray(nodeStackIds) ? nodeStackIds : []),
  ].filter((value) => typeof value === "string" && value in STACK_TAG_OF);
  const distinct = [...new Set(candidates)];
  if (distinct.length !== 1) return null;
  return { category: "STACK", value: STACK_TAG_OF[distinct[0]] };
}

/**
 * RESULT STATUS: only an owner verdict opens a results thread, so ACCEPT is SUCCESS and
 * REJECT is FAILED. PARTIAL is honest only when the durable outcome says so. BLOCKED and
 * CANCELLED are deliberately unmapped — they are not owner-accepted outcomes, and forcing
 * them into FAILED would claim a judgement the owner never made.
 */
export function resultStatusTag({ decision, outcomeStatus }) {
  if (decision === "REJECT") return { category: "STATUS", value: "FAILED" };
  if (decision !== "ACCEPT") return null;
  if (outcomeStatus === "PARTIAL")
    return { category: "STATUS", value: "PARTIAL" };
  if (
    outcomeStatus === "COMPLETE" ||
    outcomeStatus === null ||
    outcomeStatus === undefined
  )
    return { category: "STATUS", value: "SUCCESS" };
  return null;
}

/**
 * RESULT TYPE. Durable artifact evidence wins when it exists; otherwise the admitted
 * brief's target software decides. MODEL, RESEARCH and AUTOMATION are only selected from
 * an explicit brief statement, because nothing else in the ledger distinguishes them.
 */
const RESULT_TYPE_BY_EXTENSION = Object.freeze({
  sql: "DATA",
  csv: "DATA",
  tsv: "DATA",
  xlsx: "DATA",
  xls: "DATA",
  xlsm: "DATA",
  json: "DATA",
  parquet: "DATA",
  py: "ANALYSIS",
  md: "REPORT",
  markdown: "REPORT",
  doc: "REPORT",
  docx: "REPORT",
  pdf: "REPORT",
  pptx: "REPORT",
  pbix: "REPORT",
});

const RESULT_TYPE_BY_TARGET = Object.freeze({
  excel: "DATA",
  sql: "DATA",
  python: "ANALYSIS",
  "power-bi": "REPORT",
  powerbi: "REPORT",
});

export function resultTypeTag({ artifactPaths = [], target, declaredType }) {
  const explicit =
    typeof declaredType === "string" ? declaredType.toUpperCase() : "";
  if (
    ["ANALYSIS", "DATA", "REPORT", "MODEL", "RESEARCH", "AUTOMATION"].includes(
      explicit,
    )
  )
    return { category: "TYPE", value: explicit };
  const paths = Array.isArray(artifactPaths) ? artifactPaths : [];
  for (const artifact of paths) {
    const logicalPath =
      typeof artifact === "string" ? artifact : artifact?.logical_path;
    if (typeof logicalPath !== "string") continue;
    const extension = logicalPath.includes(".")
      ? logicalPath.slice(logicalPath.lastIndexOf(".") + 1).toLowerCase()
      : "";
    const value = RESULT_TYPE_BY_EXTENSION[extension];
    if (value) return { category: "TYPE", value };
  }
  const normalizedTarget =
    typeof target === "string" ? target.trim().toLowerCase() : "";
  const value = RESULT_TYPE_BY_TARGET[normalizedTarget];
  if (value) return { category: "TYPE", value };
  return null;
}

/**
 * INCIDENT SEVERITY comes from what the containment decision actually was, not from a
 * default. An unrecognized reason is MEDIUM: it is a real governance incident, and
 * understating it as LOW would be the more expensive error.
 */
export function incidentSeverityTag({ reason, scope, ledgerError }) {
  if (typeof reason !== "string" || reason.length === 0) return null;
  if (reason === "NATIVE_COMPLETION_UNRECONCILED") {
    if (ledgerError) return { category: "SEVERITY", value: "CRITICAL" };
    if (scope === "ALL_LIVE_RUNS")
      return { category: "SEVERITY", value: "CRITICAL" };
    return { category: "SEVERITY", value: "HIGH" };
  }
  if (reason === "SPAWN_LINEAGE_MISMATCH")
    return { category: "SEVERITY", value: "HIGH" };
  if (ledgerError) return { category: "SEVERITY", value: "HIGH" };
  return { category: "SEVERITY", value: "MEDIUM" };
}

/** INCIDENT STATUS: a first surfacing is always OPEN. Later transitions are out of scope. */
export function incidentStatusTag() {
  return { category: "STATUS", value: "OPEN" };
}

/**
 * The approvals STATUS value for a state the owner is being asked about. Creation always asks,
 * so no decision means `WAITING`. M12/T2-R2: once he actually decides, the same tag carries his
 * answer. An unrecognised decision returns `null` so the caller refuses to transition instead of
 * inventing a state — and `EXPIRED` is deliberately absent, because nothing here expires a card:
 * that would need a sweeper, and the host's own component ttl is not a governance verdict.
 */
export const APPROVAL_STATUS_OF_DECISION = Object.freeze({
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
  REQUEST_REVISION: "CHANGES",
});

export function approvalStatusTag(decision = null) {
  if (decision === null || decision === undefined || decision === "REQUEST")
    return { category: "STATUS", value: "WAITING" };
  const value = APPROVAL_STATUS_OF_DECISION[decision];
  return value ? { category: "STATUS", value } : null;
}

/**
 * M12/T2-R2: move one thread's STATUS tag. Deliberately NOT a re-derivation of the whole trio:
 * the owner asked for the state to change, and recomputing RISK/STACK here could rewrite tags
 * that were already right. Every id the thread already carries is kept — including ids that are
 * not in the forum's own list at all, because a tag he added by hand is his data, not ours to
 * delete. Only a STATUS-category id is dropped, and exactly one replaces it. Like the publish
 * path this returns a result instead of throwing: a decision already durable in the ledger is
 * never revoked by a surface failure (requirement 5).
 */
export async function transitionGovernedForumStatus({
  surface,
  channelId,
  threadId,
  token,
  status,
  resolver,
  fetchImpl = globalThis.fetch,
  deadlineMs,
  logger = null,
}) {
  const warn = (line) => logger?.warn?.(line);
  if (!resolver) throw new Error("FORUM_TAG_RESOLVER_REQUIRED");
  if (!(SURFACE_TAG_CATEGORIES[surface] ?? []).includes("STATUS"))
    return { applied: false, code: "FORUM_SURFACE_UNKNOWN" };
  if (!channelId) return { applied: false, code: "FORUM_TAG_CHANNEL_REQUIRED" };
  if (!threadId) return { applied: false, code: "FORUM_TAG_THREAD_REQUIRED" };
  if (!token) return { applied: false, code: "FORUM_TAG_TOKEN_REQUIRED" };
  if (!status || status.category !== "STATUS" || !status.value)
    return { applied: false, code: "FORUM_TAG_STATUS_MISSING" };
  assertTagDeadline(deadlineMs);

  let tags;
  try {
    tags = await resolver.tags({ channelId, token, fetchImpl, deadlineMs });
  } catch (err) {
    warn(
      `[zink-governance] DISCORD_TAGS_UNREADABLE channel=${surface} channelId=${channelId} cause=${err?.message ?? err}`,
    );
    return { applied: false, code: "DISCORD_TAGS_UNREADABLE" };
  }
  let current;
  try {
    current = await readForumThreadTags({
      threadId,
      token,
      fetchImpl,
      deadlineMs,
    });
  } catch (err) {
    warn(
      `[zink-governance] DISCORD_TAGS_UNREADABLE channel=${surface} threadId=${threadId} cause=${err?.message ?? err}`,
    );
    return { applied: false, code: "DISCORD_TAGS_UNREADABLE" };
  }

  const categoryById = new Map(tags.map((tag) => [tag.id, tag.category]));
  const kept = current.filter((id) => categoryById.get(id) !== "STATUS");
  const wanted = buildTagName("STATUS", status.value);
  const normalizedWanted = normalizeTagName(wanted);
  const match = tags.find(
    (tag) => tag.category === "STATUS" && tag.normalized === normalizedWanted,
  );
  if (!match) {
    warn(
      `[zink-governance] DISCORD_TAG_UNRESOLVED channel=${surface} category=STATUS wanted="${wanted}" reason=${tags.some((tag) => tag.category === "STATUS") ? "VALUE_ABSENT" : "CATEGORY_ABSENT"} channelId=${channelId}`,
    );
    return { applied: false, code: "DISCORD_TAG_UNRESOLVED" };
  }

  const tagIds = [...new Set([...kept, match.id])];
  const response = await fetchImpl(
    `https://discord.com/api/v10/channels/${threadId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ applied_tags: tagIds }),
      signal: AbortSignal.timeout(deadlineMs),
    },
  );
  if (!response.ok) {
    warn(
      `[zink-governance] DISCORD_TAG_TRANSITION_REJECTED channel=${surface} threadId=${threadId} status=${response.status}`,
    );
    return {
      applied: false,
      code: `DISCORD_TAG_TRANSITION_REJECTED_${response.status}`,
    };
  }
  return { applied: true, threadId: String(threadId), tagIds };
}

/**
 * The single publish path for a governed forum thread. All three surfaces go through it so
 * the tag rule, the deadline rule and the "no post without the forum's required tags" rule
 * exist once (owner requirement 1). It returns a result instead of throwing: a broken
 * #approvals surface must not be able to consume a #results or #incidents event
 * (requirement 5), and the caller decides what a non-post means for its own state machine.
 */
export async function openGovernedForumThread({
  surface,
  channelId,
  token,
  title,
  bodyContent,
  selections,
  resolver,
  fetchImpl = globalThis.fetch,
  deadlineMs,
}) {
  if (!resolver) throw new Error("FORUM_TAG_RESOLVER_REQUIRED");
  if (!channelId)
    return { posted: false, code: "FORUM_TAG_CHANNEL_REQUIRED", missing: [] };
  if (!token)
    return { posted: false, code: "FORUM_TAG_TOKEN_REQUIRED", missing: [] };
  assertTagDeadline(deadlineMs);
  const outcome = await resolver.resolve({
    surface,
    channelId,
    token,
    selections,
    fetchImpl,
    deadlineMs,
  });
  if (!outcome.ok)
    return {
      posted: false,
      code: outcome.code,
      missing: outcome.missing ?? [],
    };
  const response = await fetchImpl(
    `https://discord.com/api/v10/channels/${channelId}/threads`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: String(title ?? "").slice(0, 100),
        message: { content: String(bodyContent ?? "").slice(0, 2000) },
        applied_tags: outcome.tagIds,
      }),
      signal: AbortSignal.timeout(deadlineMs),
    },
  );
  if (!response.ok)
    return {
      posted: false,
      code: `DISCORD_THREAD_POST_FAILED_${response.status}`,
      missing: [],
    };
  const thread = await response.json();
  return {
    posted: true,
    threadId: String(thread?.id ?? ""),
    tagIds: outcome.tagIds,
  };
}

/**
 * Turn a surface's logical values into the exact selection list the resolver expects, in
 * the forum's own category order. A missing value is returned in `absent` so the caller can
 * name it in the log instead of posting a short-tagged thread.
 */
export function buildSurfaceSelections(surface, values = {}) {
  const categories = SURFACE_TAG_CATEGORIES[surface] ?? [];
  const selections = [];
  const absent = [];
  for (const category of categories) {
    const selection = values[category.toLowerCase()];
    if (selection && selection.category === category && selection.value)
      selections.push({ category, value: selection.value });
    else absent.push(category);
  }
  return { selections, absent };
}
