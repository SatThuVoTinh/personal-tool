// M10/T2-R12 — the human-facing task code.
//
// Owner decision 2026-10-08: a task must carry a short ruled code the owner can
// read and type to approve by text, instead of a 64-hex task id. 8 date
// characters (YYYYMMDD) + 4 random characters.
//
// Two properties are load bearing and are pinned here:
//
// 1. The code is a DISPLAY ALIAS. The canonical 64-hex task_id stays the ledger
//    key and stays inside the button custom_id. A 12-character code over the
//    21-symbol alphabet this lane pins has under 200k combinations for its
//    four random characters (21^4 = 194,481), so it must never be the thing
//    that proves WHICH task is being approved.
//
// 2. Uniqueness is enforced at generation, not hoped for. 21 profiles, seven
//    agents, many tasks per day: a collision would let the owner approve the
//    wrong task, so a taken code is regenerated within a bounded attempt count.
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTaskCode,
  buildUniqueTaskCode,
  normalizeTaskCodeDate,
  deriveTaskId,
  TASK_CODE_ALPHABET,
  TASK_CODE_LENGTH,
  TASK_CODE_PATTERN,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";

const emptySnapshot = () => ({ tasks: {}, sequence: 0 });

const openedPayload = (overrides = {}) => {
  const base = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: "12345678901234567",
    root_agent_id: "main",
    root_session_key: "agent:main:sess-1",
    root_run_id: "run-1",
    ...overrides,
  };
  return { ...base, task_id: deriveTaskId(base) };
};

/** Deterministic stand-in for a random byte source. */
const seqRandom = (values) => (index) => values[index % values.length];

test("R12 code: format is 8 date characters + 4 code characters", () => {
  const code = buildTaskCode({
    date: "20261008",
    random: seqRandom([0, 5, 10, 15]),
  });
  assert.equal(code.length, TASK_CODE_LENGTH);
  assert.equal(code.length, 12);
  assert.equal(code.slice(0, 8), "20261008");
  assert.match(code, new RegExp(TASK_CODE_PATTERN, "u"));
});

test("R12 code: a Date is rendered as UTC YYYYMMDD", () => {
  assert.equal(
    normalizeTaskCodeDate(new Date("2026-10-08T00:00:00Z")),
    "20261008",
  );
  assert.equal(
    normalizeTaskCodeDate(new Date("2026-12-31T23:59:59Z")),
    "20261231",
  );
  assert.equal(
    normalizeTaskCodeDate(new Date("2026-01-05T00:00:00Z")),
    "20260105",
  );
});

test("R12 code: the alphabet omits every confusable character", () => {
  // The owner types this by hand, so a confusable glyph is a real failure mode.
  // Every excluded letter/digit pair: 0/O, 1/I/L, 5/S, 2/Z, 8/B, 6/G, 4/A.
  for (const banned of [
    "0",
    "O",
    "1",
    "I",
    "L",
    "5",
    "S",
    "2",
    "Z",
    "8",
    "B",
    "6",
    "G",
    "4",
    "A",
  ]) {
    assert.equal(
      TASK_CODE_ALPHABET.includes(banned),
      false,
      `${banned} must not be in the task-code alphabet: ${TASK_CODE_ALPHABET}`,
    );
  }
  // No duplicate symbols, and the documented size.
  assert.equal(
    new Set(TASK_CODE_ALPHABET).size,
    TASK_CODE_ALPHABET.length,
    "the alphabet must not repeat a symbol",
  );
  assert.equal(TASK_CODE_ALPHABET.length, 21);
  // M12/T9 F-335: the header's collision budget is computed from the alphabet
  // this lane pins, so the prose and the pin cannot drift apart silently.
  // The four random characters of a 12-character code are the only part of
  // the space that is not the date.
  const randomSpace = TASK_CODE_ALPHABET.length ** 4;
  assert.equal(
    randomSpace,
    194481,
    "the four random characters' space is 21^4 for the pinned alphabet",
  );
  assert.ok(
    randomSpace < 200000,
    `the code space must stay under 200k combinations, got ${randomSpace}`,
  );
  // And every produced suffix character must come from the alphabet.
  for (let index = 0; index < TASK_CODE_ALPHABET.length; index++) {
    const code = buildTaskCode({
      date: "20261008",
      random: () => index,
    });
    for (const ch of code.slice(8)) {
      assert.ok(
        TASK_CODE_ALPHABET.includes(ch),
        `${ch} came from outside the alphabet`,
      );
    }
  }
});

test("R12 code: a random source outside the alphabet is refused", () => {
  assert.throws(
    () => buildTaskCode({ date: "20261008", random: () => -1 }),
    /TASK_CODE_RANDOM_OUT_OF_RANGE/u,
  );
  assert.throws(
    () => buildTaskCode({ date: "20261008", random: () => 28 }),
    /TASK_CODE_RANDOM_OUT_OF_RANGE/u,
  );
  assert.throws(
    () => buildTaskCode({ date: "20261008", random: () => 1.5 }),
    /TASK_CODE_RANDOM_OUT_OF_RANGE/u,
  );
  assert.throws(
    () => buildTaskCode({ date: "20261008" }),
    /TASK_CODE_RANDOM_REQUIRED/u,
  );
});

test("R12 code: a malformed date is refused", () => {
  assert.throws(
    () =>
      buildTaskCode({ date: "2026-10-08", random: seqRandom([0, 0, 0, 0]) }),
    /TASK_CODE_DATE_INVALID/u,
  );
  assert.throws(
    () =>
      buildTaskCode({
        date: new Date("nope"),
        random: seqRandom([0, 0, 0, 0]),
      }),
    /TASK_CODE_DATE_INVALID/u,
  );
});

test("R12 code: a taken code is regenerated, never reused", () => {
  const alphabet = TASK_CODE_ALPHABET;
  const firstSuffix = alphabet[0] + alphabet[1] + alphabet[2] + alphabet[3];
  const secondSuffix = alphabet[4] + alphabet[5] + alphabet[6] + alphabet[7];
  const perAttempt = [[...firstSuffix], [...secondSuffix]];
  let attemptsSeen = 0;
  const code = buildUniqueTaskCode({
    date: "20261008",
    random: (index, attempt) => {
      attemptsSeen = attempt + 1;
      return alphabet.indexOf(perAttempt[attempt][index]);
    },
    // Only the FIRST candidate is taken, so the generator must move to the second.
    isTaken: (candidate) => candidate === "20261008" + firstSuffix,
  });
  assert.equal(
    attemptsSeen,
    2,
    "the taken candidate must be retried exactly once",
  );
  assert.equal(code, "20261008" + secondSuffix);
  assert.match(code, new RegExp(TASK_CODE_PATTERN, "u"));
});

test("R12 code: collision retry is bounded, never an infinite loop", () => {
  // `random` is called once per suffix CHARACTER (4 per attempt), so the
  // attempt counter is the second argument — counting calls would read 128.
  let attempts = 0;
  assert.throws(
    () =>
      buildUniqueTaskCode({
        date: "20261008",
        random: (_index, attempt) => {
          attempts = attempt + 1;
          return 0;
        },
        // Always taken: the generator must give up rather than spin.
        isTaken: () => true,
      }),
    /TASK_CODE_COLLISION_EXHAUSTED/u,
  );
  assert.equal(attempts, 32, "must stop at the documented attempt bound");
});

test("R12 code: the collision predicate is required", () => {
  assert.throws(
    () => buildUniqueTaskCode({ date: "20261008", random: () => 0 }),
    /TASK_CODE_IS_TAKEN_REQUIRED/u,
  );
  assert.throws(
    () =>
      buildUniqueTaskCode({
        date: "20261008",
        random: () => 0,
        isTaken: () => false,
        maxAttempts: 0,
      }),
    /TASK_CODE_MAX_ATTEMPTS_INVALID/u,
  );
});

test("R12 code: two calls with different draws produce different codes", () => {
  const a = buildUniqueTaskCode({
    date: "20261008",
    random: seqRandom([0, 1, 2, 3]),
    isTaken: () => false,
  });
  const b = buildUniqueTaskCode({
    date: "20261008",
    random: seqRandom([4, 5, 6, 7]),
    isTaken: () => false,
  });
  assert.notEqual(a, b);
  for (const code of [a, b]) {
    assert.match(code, new RegExp(TASK_CODE_PATTERN, "u"));
  }
});

// ---------------------------------------------------------------------------
// LEDGER — the code must survive the reducer, and must never break replay.
// ---------------------------------------------------------------------------

test("R12 ledger: an OPEN with a valid code stores it on the task", () => {
  const code = "20261008CDEF";
  const payload = openedPayload({ task_code: code });
  const snapshot = applyWorkflowEvent(
    emptySnapshot(),
    "WORKFLOW_OPENED",
    payload,
  );
  assert.equal(snapshot.tasks[payload.task_id].task_code, code);
});

test("R12 ledger: an OPEN with NO code is still valid (legacy replay)", () => {
  // The 48 tasks already in the live ledger predate the code. If absence were
  // rejected, replaying history would fail and the ledger would be unreadable.
  const payload = openedPayload();
  assert.equal("task_code" in payload, false);
  const snapshot = applyWorkflowEvent(
    emptySnapshot(),
    "WORKFLOW_OPENED",
    payload,
  );
  const task = snapshot.tasks[payload.task_id];
  assert.ok(task);
  assert.equal("task_code" in task, false, "no code may be invented");
});

test("R12 ledger: a malformed code is refused, never coerced", () => {
  for (const bad of [
    "20261008cdef", // lowercase
    "2026108CDEF", // 11 characters
    "20261008CDEFA", // 13 characters
    "20261008CDE0", // '0' is not in the alphabet
    "20261008CDEI", // 'I' is not in the alphabet
    "261008CDEF", // date too short
    "",
  ]) {
    assert.throws(
      () =>
        applyWorkflowEvent(
          emptySnapshot(),
          "WORKFLOW_OPENED",
          openedPayload({ task_code: bad }),
        ),
      /SCHEMA_INVALID/u,
      `must refuse ${JSON.stringify(bad)}`,
    );
  }
});

test("R12 ledger: two live tasks can never share one code", () => {
  // If they could, an owner approval could be attributed to the wrong task.
  const code = "20261008CDEF";
  const first = openedPayload({ task_code: code });
  const snapshot = applyWorkflowEvent(
    emptySnapshot(),
    "WORKFLOW_OPENED",
    first,
  );
  const second = openedPayload({
    task_code: code,
    origin_message_id: "22345678901234567",
    root_session_key: "agent:main:sess-2",
  });
  assert.notEqual(second.task_id, first.task_id);
  assert.throws(
    () => applyWorkflowEvent(snapshot, "WORKFLOW_OPENED", second),
    /SCHEMA_INVALID/u,
  );
});

test("R12 ledger: a re-delivered OPEN does not rewrite the code", () => {
  // The first writer owns the code. A replay of the same lineage must leave the
  // task byte-identical, so a re-delivered event cannot swap the code an owner
  // was already shown.
  const original = "20261008CDEF";
  const payload = openedPayload({ task_code: original });
  const snapshot = applyWorkflowEvent(
    emptySnapshot(),
    "WORKFLOW_OPENED",
    payload,
  );
  const replay = applyWorkflowEvent(snapshot, "WORKFLOW_OPENED", {
    ...payload,
    task_code: "20261009JKMN",
  });
  assert.equal(replay.tasks[payload.task_id].task_code, original);
  assert.deepEqual(replay, snapshot, "a same-lineage replay must be a no-op");
});
