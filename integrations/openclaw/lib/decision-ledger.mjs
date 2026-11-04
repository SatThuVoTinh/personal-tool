import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { lockDirFor, withFileLockSync } from "./file-lock.mjs";
import {
  assertNoSymlinkComponents,
  DECISION_STORE_FILE,
  resolveGovernedStoreRoot,
  stableJson,
} from "./policy.mjs";

/**
 * Remove a temp this process created but could not rename; same tolerance set,
 * same reason, and the same packaging constraint as `removeWriterResidue` in
 * `lib/queue-manager.mjs` — the deployed tree flattens `topology/lib/*` only for
 * the targets `PACKAGE_REWRITES` names, so the ledger's own copy cannot be
 * imported from here.
 */
function removeWriterResidue(tempPath) {
  try {
    unlinkSync(tempPath);
  } catch (error) {
    if (!["EPERM", "EISDIR", "ENOENT"].includes(error?.code)) throw error;
  }
}

/**
 * Governed Decision Ledger
 * Implements ACTIVE.md Sections 18, 19, 20:
 * - Stores user-confirmed decisions with explicit scope and context.
 * - Queried by Main, O1, and O2 before asking the user for clarification.
 * - Strictly prevents generalizing decisions beyond their approved scope.
 * - Enforces Human Semantic Authority: AI agents may propose, but only user confirmation persists.
 */

/**
 * M12/T9 F-002: the decision store lives under the ONE configured governance
 * store root, and there is no home-directory default.
 *
 * The store used to default to `~/.openclaw-zink/decision-ledger.json` while
 * the ledger event journal and the snapshot lived under the configured
 * `ledgerRoot`. A process that wrote through the configured root and read
 * through the default root was reading and writing two different files, and
 * the default-root store was a module-level singleton whose map was filled ONCE
 * at import — so a second process's decision was invisible to the first and
 * the first's save could replace the second's whole decision set.
 *
 * The root is configured explicitly (`configureGovernedStoreRoot` in
 * `lib/policy.mjs`) by whoever owns the configuration, and an unconfigured
 * store is a named refusal rather than a guessed path.
 */
export function resolveDecisionLedgerStoragePath(root = null) {
  const base = root === null ? resolveGovernedStoreRoot() : root;
  return path.join(base, DECISION_STORE_FILE);
}

const DECISION_SCOPES = Object.freeze(["global", "domain", "task-specific"]);

// Governed teaching classifications. A candidate must carry exactly one.
// Anything else — including an explicit "ambiguous" — fails closed and
// persists nothing: the owner must classify before memory may form.
export const MEMORY_CLASSIFICATIONS = Object.freeze([
  "preference-decision",
  "reusable-procedure",
  "factual-knowledge",
  "operational-state",
]);

/**
 * Builds an untrusted decision candidate. Pure: persists nothing.
 * Only `preference-decision` candidates may later be confirmed into the
 * ledger; every other classification routes elsewhere and never lands here.
 */
export function buildDecisionCandidate({
  topic,
  question,
  proposedDecision,
  scope = "global",
  taskId = null,
  domain = null,
  context = {},
  classification,
}) {
  if (!MEMORY_CLASSIFICATIONS.includes(classification)) {
    failLedger("DECISION_CANDIDATE_AMBIGUOUS");
  }
  if (typeof topic !== "string" || !topic.trim()) {
    failLedger("DECISION_CANDIDATE_INVALID");
  }
  if (typeof proposedDecision !== "string" || !proposedDecision.trim()) {
    failLedger("DECISION_CANDIDATE_INVALID");
  }
  const normalizedScope = String(scope ?? "global")
    .toLowerCase()
    .trim();
  if (!DECISION_SCOPES.includes(normalizedScope)) {
    failLedger("DECISION_SCOPE_INVALID");
  }
  if (normalizedScope === "task-specific" && !taskId) {
    failLedger("DECISION_TASK_IDENTITY_REQUIRED");
  }
  if (normalizedScope === "domain" && !domain) {
    failLedger("DECISION_DOMAIN_REQUIRED");
  }
  const candidateKey = canonicalDecisionKey({
    topic,
    question: question ?? "",
    scope: normalizedScope,
    taskId,
    domain,
  });
  return {
    candidate_key: candidateKey,
    topic: String(topic).toUpperCase().trim(),
    question: question ?? "",
    proposed_decision: String(proposedDecision).trim(),
    scope: normalizedScope,
    task_id: normalizedScope === "task-specific" ? taskId : null,
    domain: normalizedScope === "domain" ? String(domain) : null,
    context,
    classification,
    created_at: new Date().toISOString(),
  };
}

// M7-034: only principals in verified-identity shape are recorded — a raw
// Discord snowflake or a derived 64-hex principal digest. Arbitrary display
// names can never be stored as the "verified user".
const SNOWFLAKE_RE = /^[1-9][0-9]{16,19}$/u;
const PRINCIPAL_DIGEST_RE = /^[a-f0-9]{64}$/u;

export function isVerifiedPrincipalRef(value) {
  return (
    typeof value === "string" &&
    (SNOWFLAKE_RE.test(value) || PRINCIPAL_DIGEST_RE.test(value))
  );
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, " ");
}

// M7-036: canonical governed semantic key — exact, never substring.
export function canonicalDecisionKey({
  topic,
  question,
  scope,
  taskId,
  domain,
}) {
  const normalizedScope = String(scope ?? "global")
    .toLowerCase()
    .trim();
  return createHash("sha256")
    .update(
      [
        "zink-decision-v1",
        String(topic ?? "")
          .toUpperCase()
          .trim(),
        normalizeText(question ?? ""),
        normalizedScope,
        normalizedScope === "task-specific" ? String(taskId ?? "") : "",
        normalizedScope === "domain" ? normalizeText(domain ?? "") : "",
      ].join("\0"),
      "utf8",
    )
    .digest("hex");
}

function recordKey(record) {
  const ctx = record?.context ?? {};
  return canonicalDecisionKey({
    topic: record?.topic,
    question: record?.question,
    scope: record?.scope,
    taskId: ctx.taskId ?? ctx.task_id ?? null,
    domain: ctx.domain ?? null,
  });
}

function failLedger(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validateDecisionRecord(d) {
  if (!d || typeof d !== "object") return false;
  if (typeof d.decisionId !== "string" || !d.decisionId) return false;
  if (typeof d.topic !== "string" || !d.topic) return false;
  if (typeof d.decision !== "string" || !d.decision) return false;
  if (typeof d.confirmedBy !== "string" || !d.confirmedBy) return false;
  if (typeof d.scope !== "string") return false;
  if (!DECISION_SCOPES.includes(d.scope)) return false;
  if (d.scope === "task-specific") {
    const ctx = d.context ?? {};
    if (typeof ctx.taskId !== "string" && typeof ctx.task_id !== "string")
      return false;
  }
  return true;
}

// M12/T9 F-404: the replay comparison must be key-order independent for the
// same reason the derived id is — `canonicalDecisionKey` hashes a canonical
// key, so two representations of one decision share an id. Comparing raw
// `JSON.stringify` bytes made an honest replay throw DECISION_ID_CONFLICT.
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeysDeep(value[key])]),
    );
  }
  return value;
}

function canonicalRecordBytes(record) {
  return stableJson({
    decisionId: record.decisionId,
    topic: record.topic,
    question: record.question ?? "",
    decision: record.decision,
    scope: record.scope,
    confirmedBy: record.confirmedBy,
    context: sortKeysDeep(record.context ?? {}),
    tags: record.tags ?? [],
  });
}

export class DecisionLedger {
  constructor({
    storagePath = null,
    // M12/T9 F-260: the post-rename directory fsync is the one step whose
    // failure used to erase a COMMITTED record, and a healthy filesystem
    // cannot provoke it from the outside, so the failure is injectable here
    // for the regression case. `null` means the real fsync.
    directoryFsync = null,
  } = {}) {
    // M12/T9 F-002: the store path is EXPLICIT or it is resolved from the ONE
    // configured governance store root. There is no home-directory default and
    // no import-time file access: an instance created without a path holds an
    // empty map until the root is configured, so importing this module never
    // creates or reads a directory.
    this._explicitStoragePath =
      typeof storagePath === "string" && storagePath.trim().length > 0
        ? storagePath
        : null;
    this.decisions = new Map();
    this.corrupt = false;
    this.loadError = null;
    this.directoryFsync = directoryFsync;
    // M12/T9 F-002: `true` makes the next write REPLACE the durable set
    // instead of merging into it. It is set only by `clear()`.
    this._replaceDurableSet = false;
    if (this._explicitStoragePath) this.load();
  }

  /**
   * The durable location of this store.
   *
   * With no explicit path it is resolved from the configured governance store
   * root on every access, so a store that is configured late still reads and
   * writes the ONE configured root instead of a home-directory default.
   */
  get storagePath() {
    return this._explicitStoragePath ?? resolveDecisionLedgerStoragePath();
  }

  set storagePath(value) {
    this._explicitStoragePath =
      typeof value === "string" && value.trim().length > 0 ? value : null;
  }

  assertUsable() {
    if (this.corrupt) failLedger("LEDGER_CORRUPT");
  }

  /**
   * M12/T9 F-002: read the durable file and REPLACE the in-memory view.
   *
   * The load is a replacement, not an accumulation: a store whose map was
   * filled once and then merged with every later read answered from a mix of
   * the file as it was and the file as it is. Every read path re-reads the
   * durable file, so the map is never the authority — the file is.
   *
   * The replacement happens IN PLACE, so a captured reference to
   * `this.decisions` stays the live map.
   */
  load() {
    // Resolved OUTSIDE the read: an unconfigured store is a configuration
    // refusal and keeps its own name, never "the file is corrupt".
    const storagePath = this.storagePath;
    this.corrupt = false;
    this.loadError = null;
    const rebuilt = new Map();
    try {
      if (existsSync(storagePath)) {
        const raw = readFileSync(storagePath, "utf8");
        const entries = JSON.parse(raw);
        if (!Array.isArray(entries)) {
          this.corrupt = true;
          this.loadError = "LEDGER_SCHEMA_INVALID";
          return;
        }
        for (const d of entries) {
          if (!validateDecisionRecord(d)) {
            this.corrupt = true;
            this.loadError = "LEDGER_SCHEMA_INVALID";
            return;
          }
          rebuilt.set(d.decisionId, d);
        }
      }
    } catch (err) {
      this.corrupt = true;
      this.loadError = err?.code ?? "LEDGER_CORRUPT";
      return;
    }
    this.decisions.clear();
    for (const [id, record] of rebuilt) {
      this.decisions.set(id, record);
    }
  }

  /**
   * M12/T9 F-002: re-read the durable decision set.
   *
   * Every read path calls this first, so an answer is always derived from the
   * file on disk and never from a map that was populated at import time.
   */
  refresh() {
    this.load();
    return this;
  }

  /**
   * M12/T9 F-002: the durable decision set, read under the writer lock.
   *
   * A file that exists but cannot be read or parsed is a REFUSAL, never an
   * empty set: overwriting it would destroy the owner's decisions, and
   * answering "no prior decision" from a file this process could not read is
   * the failure mode this store is not allowed to have.
   */
  readDurableEntries() {
    const durable = new Map();
    const storagePath = this.storagePath;
    if (!existsSync(storagePath)) return durable;
    let entries;
    try {
      entries = JSON.parse(readFileSync(storagePath, "utf8"));
    } catch (err) {
      const error = new Error(
        `LEDGER_CORRUPT: the durable decision ledger could not be read (${err?.code ?? err?.message})`,
      );
      error.code = "LEDGER_CORRUPT";
      error.cause = err;
      throw error;
    }
    if (!Array.isArray(entries)) {
      const error = new Error(
        "LEDGER_CORRUPT: the durable decision ledger is not a list of records",
      );
      error.code = "LEDGER_CORRUPT";
      throw error;
    }
    for (const d of entries) {
      if (!validateDecisionRecord(d)) {
        const error = new Error(
          "LEDGER_CORRUPT: the durable decision ledger holds an invalid record",
        );
        error.code = "LEDGER_CORRUPT";
        throw error;
      }
      durable.set(d.decisionId, d);
    }
    return durable;
  }

  /**
   * Write the decision set durably.
   *
   * The write MERGES the durable set by default: the lock serialises the
   * write, it does not reload, so the whole decision set must not be
   * rewritten from this process's in-memory map — a concurrent writer's
   * decisions would be silently replaced. `clear()` sets the replace flag
   * first, because its intent is to REPLACE the durable set with the
   * (empty) in-memory one.
   */
  save() {
    // Resolved OUTSIDE the write: an unconfigured store is a configuration
    // refusal and keeps its own name, never "the write failed".
    const storagePath = this.storagePath;
    const dir = path.dirname(storagePath);
    const tempPath = `${storagePath}.tmp-${process.pid}-${Date.now()}`;
    let fd = null;
    let tempIsOurs = false;
    try {
      // M12/T2.2-R2 B-12: refuse a link on the way, then create the temp rather
      // than adopt whatever already sits at its predictable path. Same discipline
      // as `topology/lib/ledger.mjs` and `lib/queue-manager.mjs`.
      assertNoSymlinkComponents(tempPath);
      // The lock lives beside the storage file, so the directory must exist
      // before `mkdir`-based acquisition can succeed.
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      // M11/T3 B4: this is a whole-file read-modify-write rewrite and both
      // sibling stores (`topology/lib/ledger.mjs`, `lib/queue-manager.mjs`)
      // already serialize theirs through `withFileLockSync` at the same
      // `<basename>.lock` path convention. Unguarded, a concurrent writer's
      // rename lands between this process's temp write and its own rename, so
      // one whole decision set is silently replaced by the other's.
      //
      // Contention surfaces as `LEDGER_WRITE_FAILED` — the same code this seam
      // already emits for a storage failure — because semantically it IS a
      // refused durable write, and it keeps the host-visible error enum closed.
      //
      // The guarded region is the write AND the rename as ONE unit: locking only
      // around the rename would leave the torn-window defect this closes.
      withFileLockSync(
        lockDirFor(dir, `${path.basename(this.storagePath)}.lock`),
        () => {
          // M12/T9 F-002: the lock serialises the write, it does not reload.
          // The whole decision set used to be rewritten from this process's
          // in-memory map, so a second process's decision was silently
          // replaced by this process's copy. The durable set is therefore read
          // back INSIDE the lock and merged, and this process's records win
          // only for the ids it actually holds. `clear()` asks for the
          // replacement instead, because that is what erasing the store means.
          const durable = this._replaceDurableSet
            ? new Map()
            : this.readDurableEntries();
          for (const [id, record] of this.decisions) {
            // F-OC-005: inside the writer lock AFTER reading durable records
            // from disk, if an existing record with the same deterministic ID
            // is found in durable store, check whether its decision content
            // differs from the record being saved. If decision content differs,
            // throw DECISION_ID_CONFLICT, preserving the existing durable record
            // on disk and refusing the overwrite.
            const existing = durable.get(id);
            if (existing) {
              if (canonicalRecordBytes(existing) !== canonicalRecordBytes(record)) {
                failLedger("DECISION_ID_CONFLICT");
              }
            }
            durable.set(id, record);
          }
          const data = Array.from(durable.values());
          fd = openSync(tempPath, "wx", 0o600);
          tempIsOurs = true;
          writeFileSync(fd, JSON.stringify(data, null, 2) + "\n", "utf8");
          fsyncSync(fd);
          closeSync(fd);
          fd = null;
          renameSync(tempPath, this.storagePath);
          // The durable set is now the file's content, so the in-memory view
          // is set to exactly that: memory and disk agree, and the next write
          // merges against the same state. The map is updated IN PLACE, so a
          // captured reference stays live.
          this.decisions.clear();
          for (const [id, record] of durable) {
            this.decisions.set(id, record);
          }
          // M10/T2-R17: fsync the parent directory after the rename, so the rename
          // ITSELF is durable. Without it the file's contents are fsynced but the
          // name swap can still be lost on a crash, leaving the pre-rename file in
          // place — which for this ledger means losing the owner's most recent
          // CONFIRMED decision. This closes a gap against the standard the rest of
          // the repo already declares: `topology/lib/ledger.mjs` and
          // `lib/queue-manager.mjs` both do this (M7-066), and queue-manager's
          // comment states the intent explicitly. win32-tolerant, same as those two.
          try {
            if (typeof this.directoryFsync === "function") {
              this.directoryFsync();
            } else {
              const directoryFd = openSync(dir, "r");
              try {
                fsyncSync(directoryFd);
              } finally {
                closeSync(directoryFd);
              }
            }
          } catch (error) {
            if (
              process.platform === "win32" &&
              /^(EPERM|EISDIR|EINVAL|ENOTSUP)$/u.test(error?.code ?? "")
            ) {
              // The platform cannot fsync a directory at all. The rename is
              // still committed and there is nothing to report.
            } else {
              // M12/T9 F-260: the rename ABOVE already committed the write. A
              // directory-fsync failure after it is a DURABILITY warning, not a
              // failed write, and it used to be rethrown as one: the caller's
              // catch then restored the pre-write in-memory state, which is
              // now BEHIND a disk that already holds the record, and the next
              // successful save serialised that stale map over the owner's
              // decision. The commit is now classified as uncertain and the
              // in-memory map is reloaded from the disk that holds it.
              const uncertain = new Error(
                `LEDGER_COMMIT_UNCERTAIN: the record was committed but the directory entry could not be fsynced (${error?.code ?? "unknown error"})`,
              );
              uncertain.code = "LEDGER_COMMIT_UNCERTAIN";
              uncertain.committed = true;
              uncertain.cause = error;
              throw uncertain;
            }
          }
        },
      );
    } catch (err) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          /* preserve original failure */
        }
      }
      // Closed first, so the removal can succeed on Windows as well as POSIX.
      // Only ever a temp this process created: an `EEXIST` refusal is someone
      // else's file, and deleting it would turn a refusal into a side effect.
      if (tempIsOurs) removeWriterResidue(tempPath);
      if (err?.committed === true) {
        // The record IS on disk. The in-memory map is reloaded from it, so
        // memory and disk agree again, and the uncertain commit is reported
        // as such instead of being relabelled as a refused write.
        this.decisions.clear();
        this.load();
        throw err;
      }
      // M12/T9 F-002: an unreadable durable file is a corrupt store, not a
      // write failure. It keeps its own name so the operator can tell "the
      // disk could not be written" from "the disk could not be read, and was
      // therefore not overwritten".
      if (err?.code === "LEDGER_CORRUPT") {
        this.decisions.clear();
        this.load();
        throw err;
      }
      if (err?.code === "DECISION_ID_CONFLICT") {
        throw err;
      }
      failLedger(`LEDGER_WRITE_FAILED: ${err?.message}`);
    }
  }

  /**
   * Records a user-confirmed decision.
   * Requires confirmedBy (user snowflake / identity).
   *
   * Only trusted governance code may call this, after an explicit owner
   * confirmation has passed the authority gate. Observed answers and
   * behavior are operational evidence, never implicit input here.
   *
   * Identity is deterministic: without an explicit decisionId, the id
   * derives from the governed question key, so confirming the same teaching
   * twice is idempotent, while a different decision for the same governed
   * question is a fail-closed conflict.
   */
  recordDecision({
    decisionId,
    topic, // e.g. "LSCM", "TAXONOMY", "SEMANTIC_MERGE"
    question,
    decision, // exact decision text
    scope = "global", // e.g. "task-specific", "domain", "global"
    confirmedBy, // Must be verified user
    context = {},
    tags = [],
  }) {
    if (!topic || !decision) {
      throw new Error("TOPIC_AND_DECISION_REQUIRED");
    }
    // M7-034: only a verified-identity principal may author a decision.
    if (!isVerifiedPrincipalRef(confirmedBy)) {
      throw new Error(
        "HUMAN_CONFIRMATION_REQUIRED: Agents cannot author decisions without a verified user principal",
      );
    }
    // M12/T9 F-002: the conflict check reads the DURABLE set, not a map that
    // was filled when this instance was created. A decision another process
    // recorded in the meantime is therefore visible here, and the write below
    // merges with it instead of replacing it.
    this.refresh();
    this.assertUsable();
    const normalizedScope = String(scope).toLowerCase().trim();
    if (!DECISION_SCOPES.includes(normalizedScope)) {
      throw new Error(`DECISION_SCOPE_INVALID: ${scope}`);
    }
    if (normalizedScope === "task-specific") {
      const ctx = context ?? {};
      if (typeof ctx.taskId !== "string" && typeof ctx.task_id !== "string") {
        throw new Error("DECISION_TASK_IDENTITY_REQUIRED");
      }
    }

    const id =
      decisionId ||
      `dec-${canonicalDecisionKey({
        topic,
        question: question || "",
        scope: normalizedScope,
        taskId:
          normalizedScope === "task-specific"
            ? (context?.taskId ?? context?.task_id ?? null)
            : null,
        domain: normalizedScope === "domain" ? (context?.domain ?? null) : null,
      }).slice(0, 16)}`;
    const record = {
      decisionId: id,
      topic: topic.toUpperCase().trim(),
      question: question || "",
      decision: decision.trim(),
      scope: normalizedScope,
      confirmedBy,
      confirmedAt: new Date().toISOString(),
      context,
      tags: tags.map((t) => String(t).toLowerCase()),
    };

    const existing = this.decisions.get(id);
    if (existing) {
      // Same governed identity with a different decision is a conflict:
      // the owner must resolve it explicitly, never silently overwrite.
      const key = canonicalDecisionKey({
        topic: record.topic,
        question: record.question,
        scope: record.scope,
        taskId: context?.taskId ?? context?.task_id ?? null,
        domain: context?.domain ?? null,
      });
      if (recordKey(existing) !== key) {
        failLedger("DECISION_ID_CONFLICT");
      }
      if (!existing.superseded) {
        if (canonicalRecordBytes(existing) === canonicalRecordBytes(record)) {
          return existing;
        }
        failLedger("DECISION_ID_CONFLICT");
      }
      // This governed identity was corrected: the deterministic id now
      // belongs to the chain, so answer against the chain's AUTHORITATIVE
      // record. Replaying the current decision stays idempotent, while
      // re-asserting the superseded value fails closed and must go through
      // the explicit correction path.
      const authoritative = Array.from(this.decisions.values()).find(
        (d) => !d.superseded && recordKey(d) === key,
      );
      if (
        authoritative &&
        authoritative.decision === record.decision &&
        authoritative.scope === record.scope
      ) {
        return authoritative;
      }
      failLedger("DECISION_SUPERSEDED_CORRECTION_REQUIRED");
    }
    this.decisions.set(id, record);
    try {
      this.save();
    } catch (err) {
      // M12/T9 F-260: a COMMITTED-UNCERTAIN write is not a failed write. The
      // record is on disk and the map was reloaded from it, so restoring the
      // pre-write snapshot here would put memory BEHIND the disk and the next
      // successful save would erase the owner's decision.
      if (err?.committed !== true) {
        this.decisions.delete(id);
        if (existing) this.decisions.set(id, existing);
      }
      throw err;
    }
    return record;
  }

  /**
   * Explicit owner correction of an existing decision. The old record is
   * superseded (kept as audit history, excluded from all applicable
   * lookups) and exactly one new authoritative record takes its place,
   * so two contradictory active decisions for one scope can never coexist.
   * Raw `recordDecision` stays fail-closed on conflict; only this path,
   * driven by an explicit owner correction, may supersede.
   */
  correctDecision({
    topic,
    question,
    decision,
    scope = "global",
    confirmedBy,
    context = {},
    tags = [],
  }) {
    if (!topic || !decision) {
      throw new Error("TOPIC_AND_DECISION_REQUIRED");
    }
    if (!isVerifiedPrincipalRef(confirmedBy)) {
      throw new Error(
        "HUMAN_CONFIRMATION_REQUIRED: Agents cannot author decisions without a verified user principal",
      );
    }
    // M12/T9 F-002: the correction reads the DURABLE set (see
    // `recordDecision`), so a decision another process recorded in the
    // meantime is part of the chain this correction supersedes.
    this.refresh();
    this.assertUsable();
    const normalizedScope = String(scope).toLowerCase().trim();
    if (!DECISION_SCOPES.includes(normalizedScope)) {
      throw new Error(`DECISION_SCOPE_INVALID: ${scope}`);
    }
    const key = canonicalDecisionKey({
      topic,
      question: question || "",
      scope: normalizedScope,
      taskId:
        normalizedScope === "task-specific"
          ? (context?.taskId ?? context?.task_id ?? null)
          : null,
      domain: normalizedScope === "domain" ? (context?.domain ?? null) : null,
    });
    const chain = Array.from(this.decisions.values()).filter(
      (d) => recordKey(d) === key,
    );
    const active = chain.find((d) => !d.superseded) ?? null;
    if (!active) {
      failLedger("DECISION_NOT_FOUND");
    }
    if (
      active.decision === String(decision).trim() &&
      active.scope === normalizedScope
    ) {
      return active;
    }
    const now = new Date().toISOString();
    const successorId = `dec-${key.slice(0, 12)}-s${chain.length + 1}`;
    if (this.decisions.has(successorId)) {
      failLedger("DECISION_ID_CONFLICT");
    }
    const successor = {
      decisionId: successorId,
      topic: String(topic).toUpperCase().trim(),
      question: question || "",
      decision: String(decision).trim(),
      scope: normalizedScope,
      confirmedBy,
      confirmedAt: now,
      context,
      tags: tags.map((t) => String(t).toLowerCase()),
      supersedes: active.decisionId,
    };
    const supersededActive = {
      ...active,
      superseded: true,
      superseded_by: successorId,
      superseded_at: now,
    };
    this.decisions.set(active.decisionId, supersededActive);
    this.decisions.set(successorId, successor);
    try {
      this.save();
    } catch (err) {
      // M12/T9 F-260: same rule as `recordDecision` — a committed-uncertain
      // write is not rolled back from memory.
      if (err?.committed !== true) {
        this.decisions.set(active.decisionId, active);
        this.decisions.delete(successorId);
      }
      throw err;
    }
    return successor;
  }

  /**
   * Finds relevant prior decisions to avoid redundant questions to the user.
   * M7-035: lookup always carries explicit scope/task/domain context with
   * containment — a task-specific decision never satisfies another task, a
   * domain decision only satisfies its domain, a global decision matches all.
   * M7-036: matching is exact (canonical key or normalized exact text),
   * never raw substring generalization.
   */
  queryDecisions({
    topic,
    query = "",
    scope = null,
    taskId = null,
    domain = null,
    key = null,
  } = {}) {
    // M12/T9 F-002: the answer comes from the durable file. The map this
    // store holds is a cache of that file, refreshed here, and never the
    // authority on its own — so a decision recorded by another process is
    // visible to this one instead of being silently replaced by it.
    this.refresh();
    this.assertUsable();
    const normTopic = topic ? topic.toUpperCase().trim() : null;
    const normScope = scope ? String(scope).toLowerCase().trim() : null;
    const normQuery = normalizeText(query);
    const results = [];

    for (const d of this.decisions.values()) {
      // Superseded records are audit history, never applicable answers.
      // Fresh lookups therefore see only the authoritative decision.
      if (d.superseded) continue;
      if (normTopic && d.topic !== normTopic) continue;
      if (normScope && d.scope !== normScope) continue;

      // M7-035 containment: narrow decisions never leak outward.
      const ctx = d.context ?? {};
      if (d.scope === "task-specific") {
        const owner = ctx.taskId ?? ctx.task_id ?? null;
        if (owner === null || owner !== taskId) continue;
      } else if (d.scope === "domain") {
        if (
          domain === null ||
          normalizeText(ctx.domain) !== normalizeText(domain)
        )
          continue;
      }

      if (key) {
        if (recordKey(d) !== key) continue;
      } else if (normQuery) {
        const exactHit =
          normalizeText(d.question) === normQuery ||
          normalizeText(d.decision) === normQuery ||
          normalizeText(d.topic) === normQuery ||
          recordKey(d) ===
            canonicalDecisionKey({
              topic: d.topic,
              question: normQuery,
              scope: d.scope,
              taskId,
              domain,
            });
        if (!exactHit) continue;
      }

      results.push(d);
    }

    return results;
  }

  /**
   * Exact lookup of one prior decision by its canonical governed key.
   */
  lookupDecision({
    topic,
    question,
    scope = "global",
    taskId = null,
    domain = null,
  }) {
    this.assertUsable();
    const key = canonicalDecisionKey({
      topic,
      question,
      scope,
      taskId,
      domain,
    });
    const matches = this.queryDecisions({
      topic,
      scope,
      taskId,
      domain,
      key,
    });
    return matches.length > 0 ? matches[0] : null;
  }

  /**
   * M7-017: governed pre-clarification lookup. Returns { ask: false,
   * decision } when a prior decision already covers the question, { ask: true }
   * otherwise. A corrupt/unreadable ledger fails closed (throws) instead of
   * acting as if no decision exists.
   */
  shouldClarify({
    topic,
    question,
    scope = "global",
    taskId = null,
    domain = null,
  }) {
    this.assertUsable();
    const prior = this.lookupDecision({
      topic,
      question,
      scope,
      taskId,
      domain,
    });
    if (prior) return { ask: false, decision: prior };
    return { ask: true, decision: null };
  }

  /**
   * Checks if an authoritative prior decision exists for the given topic /
   * question under explicit scope context (M7-035/M7-036). The query must be
   * the exact governed question (or decision text) — near-collision terms
   * and same-topic different-question queries never match.
   */
  hasDecision(
    topic,
    query = "",
    { scope = null, taskId = null, domain = null } = {},
  ) {
    const matches = this.queryDecisions({
      topic,
      query,
      scope,
      taskId,
      domain,
    });
    return matches.length > 0;
  }

  /**
   * M12/T9 F-002: the durable record for one decision id, or `null`.
   *
   * The read re-reads the file, so this never answers from a map that was
   * populated when the instance was created.
   */
  getDecision(decisionId) {
    this.refresh();
    this.assertUsable();
    return this.decisions.get(decisionId) || null;
  }

  /**
   * M12/T9 F-002: the durable decision set, read from the file.
   */
  listAll() {
    this.refresh();
    this.assertUsable();
    return Array.from(this.decisions.values());
  }

  /**
   * Erase the store.
   *
   * The write REPLACES the durable set instead of merging into it: a clear
   * that merged would be a no-op, because the durable records would be merged
   * straight back in.
   */
  clear() {
    this.decisions.clear();
    this._replaceDurableSet = true;
    try {
      this.save();
    } finally {
      this._replaceDurableSet = false;
    }
  }
}

/**
 * M12/T9 F-002: the process-wide decision store.
 *
 * It is NOT a load-once singleton any more: the instance holds no state until
 * the governance store root is configured, it touches no file at import, and
 * every read re-reads the durable file. Until the root is configured, every
 * use is a named refusal (`GOVERNANCE_STORE_ROOT_UNCONFIGURED`) rather than a
 * silent home-directory default.
 */
export const defaultDecisionLedger = new DecisionLedger();
