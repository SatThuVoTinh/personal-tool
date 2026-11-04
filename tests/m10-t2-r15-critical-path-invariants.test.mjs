// M10/T2-R15 — structural invariants for the "cosmetic await gates governance"
// defect family.
//
// Two real bugs came from the same shape: a fallible, non-essential delivery
// awaited on the critical path, ahead of the durable effect. Fixing them
// point-by-point is not enough, because nothing stopped the next one appearing.
// These tests assert the invariant directly on the source, which is the idiom
// this repo already uses for path-shape guarantees (e.g. "no Atomics.wait
// remains on live QueueManager/ledger/guard paths").
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { proveEveryRenameIsFollowedByADirectoryFsync } from "./helpers/directory-fsync.mjs";

const SOURCE = readFileSync(
  new URL(
    "../integrations/openclaw/plugins/zink-governance/index.mjs",
    import.meta.url,
  ),
  "utf8",
);
const LINES = SOURCE.split("\n");

/** Line numbers (0-based) of every occurrence of `needle`. */
const occurrences = (needle) => {
  const hits = [];
  LINES.forEach((line, i) => {
    if (line.includes(needle)) hits.push(i);
  });
  return hits;
};

/** Line numbers (0-based) of `needle` in CODE lines only (comments skipped). */
const codeOccurrences = (needle) =>
  occurrences(needle).filter(
    (i) =>
      !LINES[i].trim().startsWith("//") && !LINES[i].trim().startsWith("*"),
  );

/** The source window immediately above `lineIndex`, as a single string. */
const above = (lineIndex, lines) =>
  LINES.slice(Math.max(0, lineIndex - lines), lineIndex).join("\n");

/**
 * Is the awaited send at `line` inside a try block that has a catch?
 *
 * M12/T9: this used to be answered by a fixed 14-line lookback window, which
 * only works when the `try {` happens to sit close above the await. The
 * control it proves is not "the try is near" but "the await is GUARDED": a
 * delivery failure must not abort the handler. So the predicate is stated
 * structurally instead, and it is STRICTER than the window it replaces:
 *
 *   1. the nearest preceding CODE line that opens a try owns the await;
 *   2. that try is still OPEN at the await - no `} catch (` closed it above,
 *      which the old window never checked;
 *   3. the catch that closes it FOLLOWS the await.
 *
 * The band's plugin code passes this: every awaited send sits inside a try,
 * and one of them (the pending-result control) sits inside a try whose block
 * spans two dozen lines above it - which is exactly what the fixed window
 * could not see. The predicate's own capability is proved by the case below,
 * so the widening is not an assumption.
 */
function guardedAwait(lines, line) {
  const isCode = (text) => {
    const trimmed = text.trim();
    return !trimmed.startsWith("//") && !trimmed.startsWith("*");
  };
  const opensTry = (text) => /^try \{/u.test(text.trim());
  const closesTry = (text) => /^\} catch \(/u.test(text.trim());

  let opener = -1;
  for (let index = line - 1; index >= 0; index -= 1) {
    if (!isCode(lines[index])) continue;
    if (opensTry(lines[index])) {
      opener = index;
      break;
    }
  }
  if (opener === -1) return false;
  for (let index = opener + 1; index < line; index += 1) {
    if (closesTry(lines[index])) return false;
  }
  for (
    let index = line + 1;
    index < Math.min(lines.length, line + 80);
    index += 1
  ) {
    if (closesTry(lines[index])) return true;
  }
  return false;
}

test("R15-06: every awaited send is guarded and none gates a dispatch", () => {
  // `sendNativePayload` posts to Discord and can legitimately fail
  // (NATIVE_OUTBOUND_UNAVAILABLE when the host runtime config is unresolved).
  // Two real bugs came from awaiting it UNGUARDED. Two of the three remaining
  // call sites legitimately await it because the transport receipt IS their
  // result (coordinator-notification evidence, approval-card message id) — so
  // the invariant is "guarded", not "never awaited".
  const awaited = occurrences("await sendNativePayload");
  assert.ok(awaited.length >= 1, "expected the guarded sends to still exist");

  for (const line of awaited) {
    assert.ok(
      guardedAwait(LINES, line),
      `the awaited send at line ${
        line + 1
      } is not inside a try block; an unguarded await turns a delivery failure into an aborted handler`,
    );
  }
});

test("R15-06 predicate: an awaited send outside a try is still refused", () => {
  // The capability of the check above, proved on the shapes it must refuse.
  // Without this, "the awaited send is guarded" could be a statement about
  // the window rather than about the code.
  const unguarded = [
    "async function deliver() {",
    "  await sendNativePayload({});",
    "}",
  ];
  assert.equal(
    guardedAwait(unguarded, 1),
    false,
    "an awaited send with no try above it must not pass",
  );

  const closedTry = [
    "async function deliver() {",
    "  try {",
    "    work();",
    "  } catch (error) {",
    "    report(error);",
    "  }",
    "  await sendNativePayload({});",
    "}",
  ];
  assert.equal(
    guardedAwait(closedTry, 6),
    false,
    "an awaited send AFTER the try closed must not pass",
  );

  const guarded = [
    "async function deliver() {",
    "  try {",
    "    await sendNativePayload({});",
    "  } catch (error) {",
    "    report(error);",
    "  }",
    "}",
  ];
  assert.equal(
    guardedAwait(guarded, 2),
    true,
    "a guarded awaited send must pass",
  );

  const wideTry = [
    "async function deliver() {",
    "  try {",
    "    const buttons = [",
    "      {",
    '        label: "Accept",',
    "      },",
    "    ];",
    "    await sendNativePayload({ buttons });",
    "  } catch (error) {",
    "    report(error);",
    "  }",
    "}",
  ];
  assert.equal(
    guardedAwait(wideTry, 7),
    true,
    "a guarded awaited send inside a WIDE try must pass",
  );
});

test("R15-07: no governance dispatch is preceded by an unguarded ack", () => {
  // The Approve button path used to `await ctx.respond.followUp(...)` right
  // before `executeApprovedTask`. An expired Discord interaction token makes
  // that reject, the enclosing catch only warns, and the approval stays
  // recorded while the task never runs. The ack is allowed — it is better UX
  // and the order is unchanged — but it must be guarded by its own try/catch.
  const dispatches = occurrences("executeApprovedTask({");
  assert.ok(dispatches.length >= 2, "expected both approval paths to dispatch");

  for (const line of dispatches) {
    const window = above(line, 34);
    assert.doesNotMatch(
      window,
      /await\s+sendNativePayload/u,
      `an awaited send sits on the critical path above line ${line + 1}`,
    );
    const acks = [...window.matchAll(/await\s+ctx\.respond\./gu)];
    if (acks.length === 0) continue;
    // Every ack in the window must be closed by a catch BEFORE the dispatch.
    const lastAck = acks[acks.length - 1].index;
    const between = window.slice(lastAck);
    assert.match(
      between,
      /\} catch \(/u,
      `the interaction ack above line ${
        line + 1
      } is not followed by a catch before the dispatch; a failed ack would skip executeApprovedTask`,
    );
  }
});

test("R15-08: the interactive callback catch cannot reject out of the handler", () => {
  // The handler's catch block awaited a fallback reply. A rejection there
  // escapes the handler with nothing left to catch it, and under Node's
  // default unhandled-rejection behaviour that terminates the gateway process.
  const catchLine = occurrences("} catch (intErr) {")[0];
  assert.notEqual(catchLine, undefined, "expected the interactive catch block");

  const block = LINES.slice(catchLine, catchLine + 30).join("\n");
  // The fallback reply must be nested inside its own try.
  assert.match(
    block,
    /catch \(intErr\) \{[\s\S]*?try \{[\s\S]*?await\s+ctx\.respond\./u,
    "the error reply must be wrapped in its own try, or a failed error report becomes an unhandled rejection",
  );
  assert.match(
    block,
    /catch \(reportErr\)/u,
    "the nested try must have its own catch",
  );
});

test("R15-09: there is exactly one completion notice, and it is gated", () => {
  // Both accept paths used to reduce a `completeTask` failure to a warn and then
  // publish "Tác vụ đã hoàn tất xuất sắc" to the public office channel
  // unconditionally, i.e. a failure presented as a success. R16 then collapsed
  // the two duplicated blocks into one shared helper, so there must now be
  // exactly ONE notice text — two would mean the duplication is back.
  const notices = occurrences("Chúc mừng!");
  assert.equal(
    notices.length,
    1,
    `expected exactly one office completion notice, found ${notices.length}`,
  );

  const window = above(notices[0], 22);
  assert.match(
    window,
    /queueCompletionRecorded/u,
    "the office completion notice must be gated on queueCompletionRecorded",
  );
  // The flag must come from the real outcome of the write, not a default.
  assert.match(
    SOURCE,
    /queueCompletionRecorded\s*=\s*true;[\s\S]{0,200}?catch \(qErr\)/u,
    "queueCompletionRecorded must be set true only on the success path",
  );
});

test("R15-11: every governance durability writer fsyncs its directory", () => {
  // Proven gap (M10/T2-R17): fsyncing the FILE after writing is not enough —
  // without fsyncing the parent directory the rename itself can be lost on a
  // crash, silently reverting to the pre-rename file. `queue-manager.mjs` and
  // `topology/lib/ledger.mjs` already did this (M7-066), and queue-manager's
  // comment states the intent, but `decision-ledger.mjs` and
  // `artifact-validator.mjs` did not — so the guarantee was declared in one place
  // and not implemented in the others.
  //
  // F-296 (R7-C5-04): the check that used to live here sliced each file from
  // its LAST `renameSync` and asserted that the remaining text mentioned an
  // fsync. It never named a directory handle and never bound an fsync to a
  // rename, so ANY mention of `fsyncSync` after that rename satisfied it:
  // retargeting the directory fsync onto the already-durable file handle left
  // this lane green while the rename stopped being crash-durable. The
  // predicate below proves the property per SITE — every rename is followed by
  // a directory fsync bound to a handle opened on the parent directory, in the
  // same block — and its failure message names the site (`file:line`) and the
  // handle, so the failure can be acted on.
  const writes = [
    "topology/lib/ledger.mjs",
    "lib/queue-manager.mjs",
    "lib/decision-ledger.mjs",
    "lib/artifact-validator.mjs",
  ];
  for (const rel of writes) {
    proveEveryRenameIsFollowedByADirectoryFsync(`integrations/openclaw/${rel}`);
  }
});

test("R15-12: the owner-action label has one definition", () => {
  // The button and text paths each carried their own label mapping and they had
  // drifted: the button copy enumerated five actions with a real REJECT-RESULT
  // fallback while the text copy had four and let its DEFAULT mean ACCEPT. That
  // default is safe today only because the text path can produce just four
  // actions; any future verb would be reported to the owner as "nghiệm thu".
  assert.equal(
    occurrences("describeOwnerAction(").length,
    3,
    "expected exactly one definition plus two call sites (button path, text path)",
  );
  assert.equal(
    codeOccurrences("nghiệm thu (ACCEPT)").length,
    1,
    "the ACCEPT label must exist exactly once in code, in the shared mapping",
  );
  assert.equal(
    codeOccurrences("từ chối kết quả (REJECT)").length,
    1,
    "the REJECT-RESULT label must exist exactly once in code, in the shared mapping",
  );
  // And the shared mapping must not silently treat an unknown action as an
  // approval: an explicit fallback is required.
  assert.match(
    SOURCE,
    /default:\s*return "hành động không xác định"/u,
    "an unknown action must be reported as unknown, never as an acceptance",
  );
});

test("R15-10: the two approval paths share one post-decision effect", () => {
  // R16: the text and button paths carried near-identical copies of the
  // dispatch/accept logic. They drifted twice (R14 awaited a send before
  // dispatching on one path only; R15 an ack on the other), so the duplication
  // itself was the defect. There must now be a single definition and exactly
  // two call sites.
  assert.equal(
    occurrences("function applyOwnerDecisionEffect(").length,
    1,
    "expected exactly one definition of the shared post-decision effect",
  );
  // 3 = the definition line plus the two call sites (button path, text path).
  assert.equal(
    occurrences("applyOwnerDecisionEffect({").length,
    3,
    "expected exactly two call sites (button path and text path)",
  );
  // The dispatch must live in that helper, not be inlined at each path. 2 = the
  // helper's call plus the `async function` declaration itself.
  assert.equal(
    occurrences("executeApprovedTask({").length,
    2,
    "executeApprovedTask must be called from the shared helper only",
  );
  // The dispatch itself must live in that helper, not be inlined at each path.
});
