//
// SKIP-FAMILY: symlink
//
// M12/T9 F-197 (R5-E09-03) / H3: this lane may skip, and it declares WHICH
// family it belongs to, so the skip-expectation gate can tell an explained
// skip from an unexplained one. The family-to-lane map is derived from the
// repository's own lane list; the expectation lives in
// `docs/contracts/ci-skip-expectations.json`.
// M11/T3 Phase 2 — durable-state integrity.
//
// Cluster B is the set of verified defects that let durable governance state
// (file locks, the execution ledger, the decision ledger, owner approvals and
// skill proposals) be silently recreated, clobbered, overwritten, or read
// outside its writer lock. Each test below reproduces one concrete failure that
// was demonstrated against the pre-fix code, in the style of
// `tests/m10-t2-r18-file-lock.test.mjs`: a test that cannot fail is not written.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as fileLock from "../integrations/openclaw/lib/file-lock.mjs";
import {
  acquire,
  lockDirFor,
  release,
  tryAcquire,
  withFileLock,
} from "../integrations/openclaw/lib/file-lock.mjs";
import {
  assertNoLinks,
  ledgerPaths,
  ensureLedger,
  readSnapshot,
  unlinkWriterResidue,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { DecisionLedger } from "../integrations/openclaw/lib/decision-ledger.mjs";
import { resolveAuthenticatedApproval } from "../integrations/openclaw/topology/lib/guard.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";
import { skillStoreWriterLockDir } from "../zink-skill-store/src/catalog.mjs";
import { SkillAdapter } from "../zink-tools/adapters/skill-store/skill-adapter.mjs";

const FILE_LOCK_SOURCE = readFileSync(
  path.join("integrations", "openclaw", "lib", "file-lock.mjs"),
  "utf8",
);
const GUARD_SOURCE = readFileSync(
  path.join("integrations", "openclaw", "topology", "lib", "guard.mjs"),
  "utf8",
);
const LEDGER_SOURCE = readFileSync(
  path.join("integrations", "openclaw", "topology", "lib", "ledger.mjs"),
  "utf8",
);

const root = () => mkdtempSync(path.join(tmpdir(), "zink-state-"));
const rm = (dir) => rmSync(dir, { recursive: true, force: true });

/** `releaseAsync` does not exist yet; the B1 tests are what add it. */
const releaseAsyncCall = async (dir) => {
  if (typeof fileLock.releaseAsync !== "function") {
    throw new Error("releaseAsync is not exported");
  }
  return fileLock.releaseAsync(dir);
};

/** One UUID v4, reused by the approval tests. */
const APPROVAL_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const approvalRecord = () => ({
  owner_principal_ref: "a".repeat(64),
  task_id: "b".repeat(64),
  brief_revision: 3,
  tool_id: "zink-excel",
  operation: "WRITE_RANGE",
  exact_target: "sheet://budgets!A1:B2",
  approval_scope_digest: "c".repeat(64),
  expires_at: "2099-01-01T00:00:00.000Z",
});

// ---------------------------------------------------------------------------
// B1 — file-lock.mjs
// ---------------------------------------------------------------------------

test("B1-1: the async seam exports an async release and uses it", async () => {
  // `withFileLock`'s own header promises "Waiting is fully asynchronous: the
  // event loop is never blocked", but its finally called the SYNCHRONOUS
  // `release`, which reaches `busyWaitMs` — a CPU spin — on every retried
  // removal round. The fix is a `releaseAsync` that awaits the already-imported
  // `delay()` and shares the same errno policy and attempt count.
  const mod = await import("../integrations/openclaw/lib/file-lock.mjs");
  assert.equal(
    typeof mod.releaseAsync,
    "function",
    "releaseAsync must be exported",
  );
  assert.equal(
    mod.releaseAsync.constructor.name,
    "AsyncFunction",
    "releaseAsync must be asynchronous",
  );

  // The async seam must reach the async release, not the spinning one.
  const seam = FILE_LOCK_SOURCE.slice(
    FILE_LOCK_SOURCE.indexOf("export async function withFileLock"),
    FILE_LOCK_SOURCE.indexOf("export function lockDirFor"),
  );
  assert.match(
    seam,
    /await releaseAsync\(dir\)/u,
    "withFileLock must await the non-blocking release",
  );
  assert.doesNotMatch(
    seam,
    /^\s*release\(dir\);/mu,
    "withFileLock must not call the spinning sync release",
  );

  // The two releases must share the policy instead of restating it. The slice
  // is the release body only, so a spin in another function cannot trip it.
  const asyncBody = FILE_LOCK_SOURCE.slice(
    FILE_LOCK_SOURCE.indexOf("export async function releaseAsync"),
    FILE_LOCK_SOURCE.indexOf("export async function acquire"),
  );
  assert.match(asyncBody, /await delay\(/u, "the backoff must be awaited");
  assert.doesNotMatch(
    asyncBody,
    /busyWaitMs/u,
    "the async release must never spin the event loop",
  );
  assert.match(
    asyncBody,
    /RELEASE_RETRY_ATTEMPTS/u,
    "the attempt count must be shared, not duplicated",
  );
  assert.match(
    asyncBody,
    /removalRound\(dir\)/u,
    "the errno policy must be shared with the sync release, not restated",
  );
  assert.doesNotMatch(
    asyncBody,
    /"EPERM"/u,
    "the async release must not inline its own errno list",
  );
});

test("B1-2: releaseAsync removes a held lock and clears the token", async () => {
  const base = root();
  const lockDir = lockDirFor(base, "writer.lock");
  try {
    await acquire(lockDir);
    assert.ok(existsSync(lockDir));
    await releaseAsyncCall(lockDir);
    assert.equal(existsSync(lockDir), false, "the lock must be gone");
    // A cleared token means the next acquisition is a fresh one rather than a
    // FILE_LOCK_NOT_OWNER refusal against a stale in-process record.
    await acquire(lockDir);
    await releaseAsyncCall(lockDir);
    assert.equal(existsSync(lockDir), false);
  } finally {
    rm(base);
  }
});

test("B1-3: WSL drvfs/9p transient faults are retried on release", () => {
  // The live runtime is WSL, where a 9p handle can answer ESTALE or EIO for a
  // removal that would succeed moments later. Treating those as permanent
  // strands the lock directory and every later acquire fails with
  // FILE_LOCK_BUSY until an operator intervenes.
  const set = FILE_LOCK_SOURCE.slice(
    FILE_LOCK_SOURCE.indexOf("const RETRYABLE_RELEASE_ERRNOS"),
    FILE_LOCK_SOURCE.indexOf("function busyWaitMs"),
  );
  for (const errno of [
    "EPERM",
    "EACCES",
    "EBUSY",
    "ENOTEMPTY",
    "ESTALE",
    "EIO",
  ]) {
    assert.ok(
      set.includes(`"${errno}"`),
      `${errno} must stay in the retryable release policy`,
    );
  }
});

/** Run `fn`, returning the error it threw or rejected with, or null. */
async function captureError(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return null;
}

// B1(c) applies to BOTH release halves, so each half is exhausted with its own
// call and probed through the other half — which also cross-checks that both
// halves validate ownership against the same in-process record.
for (const [half, exhaust, probe] of [
  ["sync", (dir) => release(dir), (dir) => fileLock.releaseAsync(dir)],
  ["async", (dir) => fileLock.releaseAsync(dir), (dir) => release(dir)],
]) {
  test(`B1-4: an exhausted ${half} release clears the in-process token`, async () => {
    // The defect: after all retry rounds fail, `heldTokens` kept the token. A
    // stale in-process token makes a later release of a lock this process no
    // longer holds be judged against the OLD token instead of refusing cleanly,
    // so the owner token stops being the guard it exists to be.
    const base = root();
    const lockDir = lockDirFor(base, "writer.lock");
    try {
      await acquire(lockDir);
      // Force every removal round to fail: a file left inside the lock dir makes
      // `rmdirSync` answer ENOTEMPTY, which is retryable, so the budget runs out.
      writeFileSync(path.join(lockDir, "in-flight"), "x", "utf8");
      const failure = await captureError(() => exhaust(lockDir));
      assert.match(
        failure?.code ?? "",
        /^(EPERM|EACCES|EBUSY|ENOTEMPTY|ESTALE|EIO)$/u,
        "an exhausted release must still report the removal failure",
      );
      assert.ok(
        existsSync(lockDir),
        "the stranded lock stays for the operator",
      );
      // The token must be gone: the next release attempt refuses because this
      // process "never acquired it", not because the owner record is missing.
      const refusal = await captureError(() => probe(lockDir));
      assert.equal(
        refusal?.code,
        "FILE_LOCK_NOT_OWNER",
        "the other half must still refuse a lock this process does not own",
      );
      assert.match(
        refusal.message,
        /this process never acquired it/u,
        "the stale token must not survive into the next acquisition",
      );
    } finally {
      rm(base);
    }
  });
}

test("B1-5: a committed result still survives a failing async release", async () => {
  // The M10/T2-R18 invariant must not regress while the release becomes async.
  const base = root();
  const lockDir = lockDirFor(base, "writer.lock");
  try {
    const out = await withFileLock(lockDir, async () => {
      writeFileSync(path.join(lockDir, "in-flight"), "x", "utf8");
      return { committed: true, seq: 11 };
    });
    assert.deepEqual(out, { committed: true, seq: 11 });
  } finally {
    rm(base);
  }
});

// ---------------------------------------------------------------------------
// B2 / B3 — the execution ledger
// ---------------------------------------------------------------------------

test("B2-1: a half-missing ledger pair is refused, not rebuilt", () => {
  // `events.jsonl` present with `snapshot.json` missing used to recreate the
  // snapshot as `sequence: 0, last_event_digest: null`. The reconciliation
  // guard only fires when `snapshot.sequence > lastSequence`, so the rebuilt
  // pair passed every check and governance resumed at sequence 0 with no
  // digest-chain evidence — a silent reset of the owner's durable state.
  const base = root();
  const paths = ledgerPaths(base);
  try {
    mkdirSync(paths.root, { recursive: true, mode: 0o700 });
    writeFileSync(paths.events, "", "utf8");
    assert.throws(
      () => ensureLedger(paths),
      (error) =>
        error.code === "EXECUTION_STATE_UNKNOWN" &&
        error.message === "Ledger state incomplete",
      "a missing half must be refused",
    );
    assert.equal(
      existsSync(paths.snapshot),
      false,
      "the refusal must not fabricate a snapshot",
    );
  } finally {
    rm(base);
  }
});

test("B2-2: the mirror half-missing pair is refused too", () => {
  const base = root();
  const paths = ledgerPaths(base);
  try {
    mkdirSync(paths.root, { recursive: true, mode: 0o700 });
    writeFileSync(paths.snapshot, "{}", "utf8");
    assert.throws(
      () => ensureLedger(paths),
      (error) => error.code === "EXECUTION_STATE_UNKNOWN",
      "a missing journal must be refused",
    );
    assert.equal(existsSync(paths.events), false);
  } finally {
    rm(base);
  }
});

test("B2-3: both missing still initializes, both present is unchanged", () => {
  const base = root();
  const paths = ledgerPaths(base);
  try {
    ensureLedger(paths);
    assert.ok(existsSync(paths.events) && existsSync(paths.snapshot));
    const snapshotBytes = readFileSync(paths.snapshot, "utf8");
    // Idempotent: an existing complete pair must be left alone.
    ensureLedger(paths);
    assert.equal(readFileSync(paths.snapshot, "utf8"), snapshotBytes);
    assert.deepEqual(readSnapshot(paths).sequence, 0);
  } finally {
    rm(base);
  }
});

test("B3: a replay fault keeps its cause and logs a message-only diagnostic", async (t) => {
  // The outer `catch {}` relabelled every replay fault — a budget exhaustion,
  // ENOSPC, a snapshot write failure, an unparseable snapshot — as
  // EXECUTION_STATE_UNKNOWN with no cause and no log line, so the operator
  // could not separate corruption from a disk fault.
  const errors = t.mock.method(console, "error", () => {});
  const base = root();
  const paths = ledgerPaths(base);
  try {
    ensureLedger(paths);
    writeFileSync(paths.snapshot, '{"sequence": 9\u0000corrupt', "utf8");
    assert.throws(
      () => readSnapshot(paths),
      (error) => {
        assert.equal(
          error.message,
          "Ledger corruption: trusted state cannot be verified",
        );
        assert.equal(error.code, "EXECUTION_STATE_UNKNOWN");
        assert.ok(
          error.cause instanceof SyntaxError,
          "the original parser failure must be preserved as the cause",
        );
        return true;
      },
    );
    assert.equal(errors.mock.callCount(), 1, "exactly one diagnostic line");
    const logged = errors.mock.calls[0].arguments.join(" ");
    assert.ok(logged.length > 0);
    for (const arg of errors.mock.calls[0].arguments) {
      assert.equal(
        typeof arg,
        "string",
        "the diagnostic must be message-only, never the error object",
      );
      assert.doesNotMatch(
        String(arg),
        /corrupt|sequence/u,
        "persisted content must never reach the log",
      );
    }
  } finally {
    rm(base);
  }
});

// ---------------------------------------------------------------------------
// B4 — the decision ledger
// ---------------------------------------------------------------------------

test("B4-1: save() takes the shared writer lock beside its storage file", () => {
  const base = root();
  const storagePath = path.join(base, "decisions.json");
  try {
    const ledger = new DecisionLedger({ storagePath });
    const lockDir = lockDirFor(base, "decisions.json.lock");
    // Hold the lock the way the sibling stores do: a foreign token means this
    // process must not be able to write through it.
    assert.ok(tryAcquire(lockDir));
    assert.throws(
      () => ledger.save(),
      (error) =>
        // This seam's `failLedger` folds the cause into the code itself
        // (`LEDGER_WRITE_FAILED: <cause>`), which is the pre-existing convention
        // every caller already classifies on — so assert the prefix, not an
        // exact code, and keep the enum closed instead of inventing a new value.
        /^LEDGER_WRITE_FAILED/u.test(error.code) &&
        /FILE_LOCK_BUSY/u.test(error.message),
      "a contended save must fail as the durable write it is",
    );
    assert.equal(
      existsSync(storagePath),
      false,
      "the contended save must not write the ledger file",
    );
    release(lockDir);
    ledger.save();
    assert.ok(existsSync(storagePath), "an uncontended save must write");
    assert.equal(existsSync(lockDir), false, "the lock must be released");
  } finally {
    rm(base);
  }
});

test("B4-2: the lock guards the temp-write and the rename as ONE unit", () => {
  // The unit matters: acquiring after the temp write, or releasing before the
  // rename, leaves exactly the window the defect is about. Asserted against the
  // seam's own text as well as behaviorally in B4-1, because a wrapper placed on
  // only half the sequence would still pass a contention test.
  const src = readFileSync(
    path.join("integrations", "openclaw", "lib", "decision-ledger.mjs"),
    "utf8",
  );
  const body = src.slice(
    src.indexOf("  save() {"),
    src.indexOf("\n  }", src.indexOf("  save() {")),
  );
  assert.match(
    body,
    /withFileLockSync\(/u,
    "save must use the shared cross-process lock primitive",
  );
  assert.match(
    body,
    /lockDirFor\(/u,
    "the lock dir must be derived with the shared helper",
  );
  assert.match(
    body,
    /basename\(this\.storagePath\)\}\.lock/u,
    "the lock dir must follow the sibling `<basename>.lock` convention",
  );
  const atLock = body.indexOf("withFileLockSync(");
  // The guarded region is everything from the lock call to the seam's own
  // failure handler; asserting containment on the text (rather than on a
  // punctuation token) keeps it stable under reformatting.
  const guarded = body.slice(atLock, body.indexOf("} catch (err) {", atLock));
  assert.ok(
    guarded.includes("openSync(tempPath"),
    "the temp write must be inside the guarded region",
  );
  assert.ok(
    guarded.includes("renameSync(tempPath, this.storagePath)"),
    "the rename must be inside the guarded region",
  );
  assert.ok(
    guarded.indexOf("openSync(tempPath") <
      guarded.indexOf("renameSync(tempPath, this.storagePath)"),
    "the guarded region must still order write before rename",
  );
});

test("B4-3: the durable format and fsync discipline are unchanged", () => {
  const base = root();
  const storagePath = path.join(base, "decisions.json");
  try {
    const ledger = new DecisionLedger({ storagePath });
    ledger.recordDecision({
      topic: "m11-t3",
      question: "May a proposal be promoted without an owner decision?",
      decision: "No — the owner decides.",
      scope: "global",
      confirmedBy: "a".repeat(64),
      context: {},
      tags: ["m11t3"],
    });
    const raw = readFileSync(storagePath, "utf8");
    assert.ok(raw.endsWith("\n"), "the file keeps its trailing newline");
    assert.ok(
      raw.startsWith("[\n  {\n"),
      "the file keeps its 2-space pretty array form",
    );
    assert.deepEqual(
      Object.keys(JSON.parse(raw)[0]).sort(),
      Object.keys(ledger.listAll()[0]).sort(),
    );
    assert.equal(
      existsSync(path.join(base, "decisions.json.lock")),
      false,
      "no lock directory may survive a save",
    );
  } finally {
    rm(base);
  }
});

// ---------------------------------------------------------------------------
// B5 — the guard's approval reads
// ---------------------------------------------------------------------------

test("B5-1: the file-based approval read happens under the writer lock", () => {
  // `consumeApprovalAtomically` consumes under `writer.lock`, while
  // `resolveAuthenticatedApproval` read `approvals.json` with no lock at all,
  // so a record could be read mid-write and then consumed.
  const base = root();
  const paths = ledgerPaths(base);
  try {
    mkdirSync(paths.root, { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(paths.root, "approvals.json"),
      JSON.stringify({ [APPROVAL_ID]: approvalRecord() }),
      "utf8",
    );
    const lock = lockDirFor(paths.root, "writer.lock");
    assert.ok(tryAcquire(lock), "the writer lock must be acquirable");
    try {
      assert.equal(
        resolveAuthenticatedApproval(paths, APPROVAL_ID),
        null,
        "a contended approval read must fail closed, not read through the lock",
      );
    } finally {
      release(lock);
    }
    // Uncontended, the same record must resolve exactly as before.
    assert.deepEqual(
      resolveAuthenticatedApproval(paths, APPROVAL_ID),
      approvalRecord(),
      "the uncontended read must be unchanged",
    );
  } finally {
    rm(base);
  }
});

test("B5-2: holding the approval read must not deadlock the ledger source", () => {
  // The lock is single-attempt and NOT reentrant: if the guarded block also
  // wrapped `readSnapshot`, the ledger's own writer lock would refuse it. The
  // ledger-sourced read therefore stays outside the approval lock, and a
  // contended read must still return a denial rather than throw.
  const base = root();
  const paths = ledgerPaths(base);
  try {
    ensureLedger(paths);
    const lock = lockDirFor(paths.root, "writer.lock");
    assert.ok(tryAcquire(lock));
    try {
      assert.equal(resolveAuthenticatedApproval(paths, APPROVAL_ID), null);
    } finally {
      release(lock);
    }
  } finally {
    rm(base);
  }
});

test("B5-3: a corrupt individual approval file fails closed", () => {
  // `JSON.parse(readFileSync(individualApprovalFile))` was unguarded, so raw
  // parser text — which may echo persisted content — surfaced to the caller
  // instead of a governed denial.
  const base = root();
  const paths = ledgerPaths(base);
  try {
    ensureLedger(paths);
    mkdirSync(path.join(paths.root, "approvals"), { recursive: true });
    writeFileSync(
      path.join(paths.root, "approvals", `${APPROVAL_ID}.json`),
      '{"owner_principal_ref": "deadbeef',
      "utf8",
    );
    let result;
    assert.doesNotThrow(() => {
      result = resolveAuthenticatedApproval(paths, APPROVAL_ID);
    }, "a corrupt record must never throw parser text");
    assert.equal(result, null, "a corrupt record must be a denial");
  } finally {
    rm(base);
  }
});

test("B5-4: the single-process replay limit is named in the source", () => {
  // Without `paths` there is no durable store to record consumption against, so
  // replay protection is in-memory only. The contract keeps that behavior and
  // requires it to be documented at the seam rather than discovered later.
  const start = GUARD_SOURCE.indexOf(
    "export function consumeApprovalAtomically",
  );
  const window = GUARD_SOURCE.slice(
    start,
    GUARD_SOURCE.indexOf("const lock = lockDirFor", start),
  );
  assert.ok(start !== -1, "the consumption seam must exist");
  assert.match(
    window,
    /single-process|in-memory/u,
    "the limitation must be named where the in-memory replay guard lives",
  );
});

// ---------------------------------------------------------------------------
// B6 — the Skill Store proposal seam
// ---------------------------------------------------------------------------

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function proposalFixture() {
  const base = root();
  const skillsRoot = path.join(base, "store", "skills");
  mkdirSync(skillsRoot, { recursive: true });
  const proposalStorageDir = path.join(base, "proposals");
  mkdirSync(proposalStorageDir, { recursive: true });
  return { base, skillsRoot, proposalStorageDir };
}

const proposeInput = (content) => ({
  action: "propose",
  namespace: ["office"],
  capability: "m11-t3-bound",
  version: "1.0.0",
  content,
  reason: "M11/T3 Phase 2 rejection survival",
  requesting_agent: "excel",
});

test("B6-1: a REJECTED proposal survives an identical re-propose", async () => {
  // The terminal-status guard listed APPROVED, MATERIALIZED, READY and
  // INDEX_FAILED but omitted REJECTED, so proposing the identical bytes again
  // fell through to the atomic write and silently erased the owner's rejection.
  const { base, skillsRoot, proposalStorageDir } = await proposalFixture();
  try {
    const adapter = new SkillAdapter(skillsRoot, {
      skillsRoot,
      proposalStorageDir,
    });
    const content = "# Rejected skill\n\nGoverned bytes.";
    const first = await adapter.querySkillStore(proposeInput(content));
    assert.equal(first.governed_status, "SUCCESS");
    const proposalPath = path.join(
      proposalStorageDir,
      `${first.proposal.proposal_id}.json`,
    );
    // The rejection the governed plugin writes: same status, same file.
    writeFileSync(
      proposalPath,
      JSON.stringify({ ...first.proposal, status: "REJECTED" }, null, 2),
      "utf8",
    );
    const again = await adapter.querySkillStore(proposeInput(content));
    assert.equal(again.governed_status, "SUCCESS");
    assert.equal(
      again.proposal.status,
      "REJECTED",
      "a rejected decision must never regress to CANDIDATE",
    );
    assert.equal(
      JSON.parse(readFileSync(proposalPath, "utf8")).status,
      "REJECTED",
      "the durable record must still say REJECTED",
    );
    assert.equal(again.proposal.content_sha256, sha256(again.proposal.content));
  } finally {
    rm(base);
  }
});

test("B6-2: the propose read-decide-write is inside the store writer lock", async () => {
  // Approval (promote) and rejection both run under the canonical Skill Store
  // writer lock. The propose path read, decided and wrote outside it, so a
  // proposal could be written over a rejection committing in another process.
  const { base, skillsRoot, proposalStorageDir } = await proposalFixture();
  try {
    const adapter = new SkillAdapter(skillsRoot, {
      skillsRoot,
      proposalStorageDir,
    });
    const content = "# Serialized propose\n\nGoverned bytes.";
    const first = await adapter.querySkillStore(proposeInput(content));
    const proposalPath = path.join(
      proposalStorageDir,
      `${first.proposal.proposal_id}.json`,
    );
    rmSync(proposalPath, { force: true });

    const lockDir = skillStoreWriterLockDir(skillsRoot);
    assert.ok(
      tryAcquire(lockDir),
      "the canonical store writer lock must be acquirable at the derived path",
    );
    let wroteWhileHeld = false;
    const pending = adapter.querySkillStore(proposeInput(content));
    for (let round = 0; round < 12; round++) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      if (existsSync(proposalPath)) wroteWhileHeld = true;
    }
    release(lockDir);
    const result = await pending;
    assert.equal(
      wroteWhileHeld,
      false,
      "propose must not write the durable proposal while the store lock is held",
    );
    assert.equal(result.governed_status, "SUCCESS");
    assert.ok(existsSync(proposalPath), "and it must write once released");
  } finally {
    rm(base);
  }
});

test("B6-3: an uncontended propose keeps its existing behavior", async () => {
  const { base, skillsRoot, proposalStorageDir } = await proposalFixture();
  try {
    const adapter = new SkillAdapter(skillsRoot, {
      skillsRoot,
      proposalStorageDir,
    });
    const content = "# Uncontended\n\nGoverned bytes.";
    const first = await adapter.querySkillStore(proposeInput(content));
    assert.equal(first.governed_status, "SUCCESS");
    assert.equal(first.proposal.status, "CANDIDATE");
    // An identical repeat while still a live CANDIDATE keeps one identity.
    const repeat = await adapter.querySkillStore(proposeInput(content));
    assert.equal(repeat.proposal.proposal_id, first.proposal.proposal_id);
    assert.equal(repeat.proposal.proposal_token, first.proposal.proposal_token);
    const lockDir = skillStoreWriterLockDir(skillsRoot);
    assert.equal(
      existsSync(lockDir),
      false,
      "no lock directory may survive a propose",
    );
  } finally {
    rm(base);
  }
});

test("B6-4: a proposal record that cannot be parsed blocks the overwrite", async () => {
  // readJsonIfExistsSync returned null for every failure, so a half-written or
  // corrupt record looked identical to an absent one: sameBytes went false, both
  // the candidacy and the terminal-status guard were skipped, and the atomic
  // write replaced a durable owner decision.
  const { base, skillsRoot, proposalStorageDir } = await proposalFixture();
  try {
    const adapter = new SkillAdapter(skillsRoot, {
      skillsRoot,
      proposalStorageDir,
    });
    const content = "# Unreadable\n\nGoverned bytes.";
    const first = await adapter.querySkillStore(proposeInput(content));
    assert.equal(first.governed_status, "SUCCESS");
    const proposalPath = path.join(
      proposalStorageDir,
      `${first.proposal.proposal_id}.json`,
    );
    const decided = JSON.stringify(
      { ...first.proposal, status: "APPROVED" },
      null,
      2,
    );
    // A truncated tail is the routinely-occurring corruption, not a permission
    // error: a file unreadable is usually unwritable too.
    const corrupt = decided.slice(0, decided.length - 20);
    writeFileSync(proposalPath, corrupt, "utf8");

    await assert.rejects(
      () => adapter.querySkillStore(proposeInput(content)),
      (error) =>
        error.name === "SkillAdapterError" &&
        error.code === "SKILL_PROPOSAL_UNREADABLE",
      "an unreadable decision must never be overwritten as though absent",
    );

    assert.equal(
      readFileSync(proposalPath, "utf8"),
      corrupt,
      "the refusal must leave the record byte-identical",
    );
    assert.equal(
      existsSync(skillStoreWriterLockDir(skillsRoot)),
      false,
      "the refusal must not strand the store writer lock",
    );
  } finally {
    rm(base);
  }
});

// ---------------------------------------------------------------------------
// B7 — T2.1-6: snapshot residue and errno-first attribution (R1-A14-01/02)
// ---------------------------------------------------------------------------

test('B7-1: a replay fault that carries a code is logged as that code, not as "Error"', (t) => {
  // `error.name` is truthy on every Error, so `name ?? code` discarded the one
  // field that separates a disk fault from a schema fault from a torn record —
  // and the caller already sees the single wrapped "Ledger corruption" message.
  const errors = t.mock.method(console, "error", () => {});
  const base = root();
  try {
    const paths = ledgerPaths(base);
    ensureLedger(paths);
    // Valid JSON that the snapshot contract refuses: the fault has a code and a
    // name of plain "Error", which is exactly the pair the old order collapsed.
    writeFileSync(paths.snapshot, "{}", "utf8");
    assert.throws(
      () => readSnapshot(paths),
      (error) => {
        assert.equal(
          error.message,
          "Ledger corruption: trusted state cannot be verified",
        );
        assert.equal(error.code, "EXECUTION_STATE_UNKNOWN");
        assert.equal(
          String(errors.mock.calls[0].arguments[1]),
          error.cause.code,
          "the logged class must be the fault's own code",
        );
        assert.notEqual(
          String(errors.mock.calls[0].arguments[1]),
          "Error",
          "the class string must not be the generic Error name",
        );
        for (const arg of errors.mock.calls[0].arguments) {
          assert.equal(typeof arg, "string");
        }
        return true;
      },
    );
    assert.equal(errors.mock.callCount(), 1, "exactly one diagnostic line");
  } finally {
    rm(base);
  }
});

test("B7-2: the snapshot temp cleanup removes residue and never invents a fault", () => {
  const base = root();
  try {
    const temp = path.join(base, "snapshot.json.tmp-4242");
    writeFileSync(temp, "half-written");
    unlinkWriterResidue(temp);
    assert.equal(existsSync(temp), false, "the temp file must be gone");

    // Already absent is the same verdict as removed: the caller must still see
    // the write fault it had, never a cleanup artifact.
    unlinkWriterResidue(temp);

    // A directory sitting on the temp path is Windows EPERM / POSIX EISDIR.
    // Swallowed, and the directory itself is left where it was.
    const occupied = path.join(base, "occupied");
    mkdirSync(occupied);
    unlinkWriterResidue(occupied);
    assert.equal(existsSync(occupied), true);

    // Anything else is a real fault and propagates: Node rejects an embedded
    // NUL before touching the filesystem, on every platform.
    assert.throws(
      () => unlinkWriterResidue("snapshot\u0000tmp"),
      (error) => {
        assert.equal(error.code, "ERR_INVALID_ARG_VALUE");
        return true;
      },
    );
  } finally {
    rm(base);
  }
});

// B7-2 exercises the cleanup itself; nothing on any host can make `writeFileSync`
// on an open descriptor fail on purpose, so the wiring into the write window is
// pinned here rather than left to a test that cannot fail.
test("B7-3: the snapshot write path cleans its own residue before rethrowing", () => {
  const start = LEDGER_SOURCE.indexOf("function writeSnapshotAtomic");
  assert.ok(start !== -1, "the snapshot write seam must exist");
  const window = LEDGER_SOURCE.slice(
    start,
    LEDGER_SOURCE.indexOf("renameSync(temp, paths.snapshot)", start),
  );
  assert.match(
    window,
    /unlinkWriterResidue\(temp\);\s*\n\s*throw writeFault;/u,
    "a failed snapshot write must remove its residue and still surface the original fault",
  );
  // The temp name is Lane H5's fault-injection hook and must not be changed.
  // M12/T9 F-577: the hook is now the ONE writerTempName seam, and its
  // grammar carries pid + Date.now() + randomBytes entropy (the catalog.mjs
  // shape) instead of pid alone. The persistence matrix injects against this
  // by rewriting exactly that seam in a scratch checkout, so both the call
  // and the grammar stay pinned.
  assert.match(
    window,
    /writerTempName\(paths\.snapshot\)/u,
    "the snapshot writer must mint its temp name through the one grammar seam",
  );
  assert.match(
    LEDGER_SOURCE,
    /function writerTempName\(file\) \{\s*return `\$\{file\}\.tmp-\$\{process\.pid\}-\$\{Date\.now\(\)\}-\$\{randomBytes\(8\)\.toString\("hex"\)\}`;/u,
    "the temp snapshot name must stay the one the persistence matrix injects against",
  );
});

// ===========================================================================
// Cluster B, A-6 / R6-V11-01 — a state root that is already a ledger root.
//
// `ledgerPaths(stateDir)` joined `operator/m7-t2/ledger` unconditionally, so a
// caller that had already resolved a ledger root got a SECOND, empty,
// permission-valid governance root nested inside the first. The live state tree
// carries that artifact (`operator/m7-t2/ledger/operator/m7-t2/ledger/`, a 0-byte
// journal and its own 65-byte `identity.key`) — proof it happened, and proof the
// nested root was never caught by any caller-side check because there is nothing
// to catch: the function answered for the wrong place and the guard machinery
// dutifully created the right permissions on it.
// ===========================================================================

test("B8-1: ledgerPaths refuses a state dir that is already a ledger root", () => {
  const base = mkdtempSync(path.join(tmpdir(), "zink-a6-nested-"));
  try {
    const joined = path.join(base, "operator", "m7-t2", "ledger");
    assert.throws(
      () => ledgerPaths(joined),
      /LEDGER_ROOT_ALREADY_JOINED/u,
      "the refusal must name the mistake, not just fail",
    );
    assert.throws(
      () => ledgerPaths(`${joined}${path.sep}`),
      /LEDGER_ROOT_ALREADY_JOINED/u,
      "a trailing separator must not smuggle the same root past the check",
    );
    // The refusal is diagnostic, so it has to say what to pass instead.
    try {
      ledgerPaths(joined);
    } catch (error) {
      assert.match(
        String(error.message),
        /STATE root/iu,
        `the message must tell the caller to pass the state root, got: ${error.message}`,
      );
    }
    // No scratch governance tree may be minted by the rejected call.
    assert.equal(
      existsSync(path.join(joined, "operator")),
      false,
      "the double-nested root must not be created",
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("B8-2: a correct state root still resolves to the same ledger layout", () => {
  const base = mkdtempSync(path.join(tmpdir(), "zink-a6-valid-"));
  try {
    const paths = ledgerPaths(base);
    assert.equal(
      paths.root,
      path.join(base, "operator", "m7-t2", "ledger"),
      "the ordinary join must be unchanged",
    );
    assert.equal(paths.events, path.join(paths.root, "events.jsonl"));
    assert.equal(paths.snapshot, path.join(paths.root, "snapshot.json"));
    assert.equal(
      paths.identityKey,
      path.join(base, "operator", "m7-t2", "identity.key"),
      "the identity key stays a sibling of the ledger root, not inside it",
    );
    // A path that merely CONTAINS one of the suffix segments is not the suffix.
    const lookalike = path.join(base, "ledger", "operator", "notes");
    assert.equal(
      ledgerPaths(lookalike).root,
      path.join(lookalike, "operator", "m7-t2", "ledger"),
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// R5-E16-03: one ensureLedger walked to the filesystem root six times — four from
// validateLedgerPaths, then two more from privateDir, over chains it had just proven
// link-free. The dedup is scoped to a single call on purpose: a process-level cache would
// stop re-checking links planted later, which is weakening the control rather than
// speeding it up.
test("B11-1: ancestors proven in this call are not re-walked for a sibling path", () => {
  const base = mkdtempSync(path.join(tmpdir(), "m12-t2.2-b11-"));
  try {
    const visited = new Set();
    const first = assertNoLinks(
      path.join(base, "operator", "m7-t2", "ledger"),
      visited,
    );
    assert.ok(first > 1, "the first walk must inspect the whole chain");
    const second = assertNoLinks(
      path.join(base, "operator", "m7-t2", "ledger", "events.jsonl"),
      visited,
    );
    assert.equal(
      second,
      1,
      `only the new leaf may be inspected; it inspected ${second}`,
    );
    // Without a memo the same call re-walks everything, which is the cost being removed.
    assert.ok(
      assertNoLinks(
        path.join(base, "operator", "m7-t2", "ledger", "events.jsonl"),
        null,
      ) > 1,
      "an unmemoized call must still walk the chain, so the count is not an artifact",
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("B11-2: a memo of the parent chain cannot mask a symlinked leaf", (t) => {
  if (process.platform === "win32") {
    t.skip("creating a symlink needs privileges this host does not grant");
    return;
  }
  const base = mkdtempSync(path.join(tmpdir(), "m12-t2.2-b11-link-"));
  try {
    const real = path.join(base, "real");
    mkdirSync(real, { recursive: true });
    const link = path.join(base, "ledger");
    symlinkSync(real, link);
    const visited = new Set([base]);
    assert.throws(
      () => assertNoLinks(link, visited),
      /LEDGER_SYMLINK_DENIED/u,
      "the leaf is not in the memo, so it must still be checked",
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("B11-3: ensureLedger threads one memo, and every other entry point gets a fresh one", () => {
  const source = readFileSync(
    new URL(
      "../integrations/openclaw/topology/lib/ledger.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const start = source.indexOf("export function ensureLedger");
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.ok(start > -1, "ensureLedger must still exist");
  assert.match(body, /const visited = new Set\(\)/u);
  assert.match(body, /validateLedgerPaths\(paths, visited\)/u);
  assert.match(body, /privateDir\(paths\.root, visited\)/u);
  assert.match(body, /privateDir\(path\.dirname\(paths\.root\), visited\)/u);
});

// M12/T9 F-347: the outage runbook cited a line number for the writer lock,
// and the cited line was the symlink-target array rather than the lock
// acquisition, so an operator following it read a validator and concluded the
// mechanism lived elsewhere. A line-number citation cannot survive a moving
// file, so the runbook now names the symbol and this resolves symbols.
test("F-347: the outage runbook names the symbol that takes the writer lock", () => {
  const runbook = readFileSync(
    new URL("../docs/runbooks/governed-outage-classes.md", import.meta.url),
    "utf8",
  );
  assert.match(runbook, /withWriterLock/u, "the runbook must name the symbol");
  assert.match(runbook, /lockDirFor/u, "the runbook must name the symbol");
  assert.doesNotMatch(
    runbook,
    /ledger\.mjs:\d+/u,
    "a bare line number cannot survive a moving file",
  );
  const ledger = readFileSync(
    new URL(
      "../integrations/openclaw/topology/lib/ledger.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(ledger, /function withWriterLock\(/u);
  const fileLock = readFileSync(
    new URL("../integrations/openclaw/lib/file-lock.mjs", import.meta.url),
    "utf8",
  );
  assert.match(fileLock, /export function lockDirFor\(/u);
});

test("F-347: every source line citation in the runbooks resolves", () => {
  const runbookDir = new URL("../docs/runbooks/", import.meta.url);
  const citation = /`([^`\s]+\.(?:mjs|json|md|yml|yaml)):(\d+)`/gu;
  for (const entry of readdirSync(runbookDir, { withFileTypes: true })) {
    if (!entry.name.endsWith(".md")) continue;
    const body = readFileSync(new URL(entry.name, runbookDir), "utf8");
    for (const match of body.matchAll(citation)) {
      const [, relative, line] = match;
      const target = new URL(`../../${relative}`, import.meta.url);
      assert.ok(
        existsSync(target),
        `${entry.name} cites ${relative}, which does not exist`,
      );
      const lines = readFileSync(target, "utf8").split("\n");
      assert.ok(
        Number(line) <= lines.length,
        `${entry.name} cites ${relative}:${line}, which is past the end of the file`,
      );
    }
  }
});

// =========================================================================
// M12/T9 F-250 — the event contract accepted artifact objects the SNAPSHOT
// contract rejects, and the event was fsynced before the projection was
// validated. A result whose artifact item lacked `sha256` therefore became
// durable history that the next read could not project, which the ledger
// reports as corruption.
//
// The event contract now declares the artifact item shape identically to the
// snapshot's, so such an event is refused BEFORE it is durable.
// =========================================================================
test("F-250: an event whose artifact lacks sha256 is refused by the contract", () => {
  const event = (artifacts) => ({
    schema_version: "1.0.0",
    governance_version: "m8-t2.3-r5",
    sequence: 1,
    type: "WORKFLOW_RESULT_RECORDED",
    payload: {
      task_id: "c".repeat(64),
      artifacts,
    },
    created_at: "2026-10-20T00:00:00.000Z",
    previous_event_digest: null,
    event_digest: "a".repeat(64),
  });

  // The artifact item that the SNAPSHOT contract rejects must be rejected by
  // the EVENT contract too, so the event can never become durable ahead of a
  // projection the next read cannot build.
  assert.throws(
    () => validateContract("ledger-event", event([{ logical_path: "a.csv" }])),
    /SCHEMA_INVALID|SCHEMA_VALIDATION_FAILED/u,
    "an artifact without sha256 must be refused",
  );
  // And the shape the snapshot requires is accepted.
  assert.equal(
    validateContract(
      "ledger-event",
      event([{ logical_path: "a.csv", sha256: "b".repeat(64) }]),
    ),
    true,
  );
});
