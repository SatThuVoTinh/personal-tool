// M12/T1-R1 Phase 2 — the 12-character code IS the task identity.
//
// Owner instruction 2026-10-13: "task ID anh muốn identity vẫn là 12 kí tự thay vì 64
// hex, để vậy cho đồng bộ." Prior agents recorded the opposite at canonical.mjs:25-30 and
// never made the change, so the display alias and the authority key were two different
// values in the same card. This suite pins the new rule AND the two properties that must
// survive it: the live ledger's 64-hex records must still replay, and a re-delivered
// Discord message must still be recognized as the same task even though the id is no
// longer a function of that message.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  TASK_CODE_ALPHABET,
  TASK_CODE_LENGTH,
  TASK_CODE_PATTERN,
  TASK_ID_PATTERN,
  deriveTaskId,
  mintTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
import { findTaskByOriginBinding } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

const emptyProjection = () => ({ tasks: {}, sequence: 0 });

const LEGACY_ID = deriveTaskId({
  origin: "discord",
  origin_principal_ref: "a".repeat(64),
  origin_message_id: "1234567890123456789",
  agent_id: "main",
});

const DATE = "13102026";
const SUFFIX = "CDEF";

function fixedRandom(suffix) {
  let index = 0;
  return () => {
    const pick = TASK_CODE_ALPHABET.indexOf(suffix[index]);
    index += 1;
    if (pick < 0) throw new Error(`unknown suffix symbol ${suffix[index - 1]}`);
    return pick;
  };
}

// `buildUniqueTaskCode` passes `(index, attempt)` to the entropy source, so an
// attempt-keyed generator walks the alphabet one whole code per attempt.
const byAttempt = (_index, attempt) => attempt;

function openPayload(taskId, overrides = {}) {
  return {
    task_id: taskId,
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: "1234567890123456789",
    root_agent_id: "main",
    root_session_key: "root-session",
    root_run_id: "root-run",
    ...overrides,
  };
}

describe("M12/T1 P2 — minting the identity", () => {
  const notTaken = () => false;

  it("mints exactly the ruled 12-character form", () => {
    const id = mintTaskId({
      date: DATE,
      random: fixedRandom(SUFFIX),
      isTaken: notTaken,
    });
    assert.equal(id, `${DATE}${SUFFIX}`);
    assert.equal(id.length, TASK_CODE_LENGTH);
    assert.match(id, new RegExp(TASK_CODE_PATTERN, "u"));
  });

  it("requires uniqueness to be checked, because the code IS the key", () => {
    assert.throws(
      () => mintTaskId({ date: DATE, random: fixedRandom(SUFFIX) }),
      /TASK_ID_IS_TAKEN_REQUIRED/u,
    );
  });

  it("uses the creation date in ddmmyyyy order", () => {
    const id = mintTaskId({
      date: new Date(Date.UTC(2026, 9, 13)),
      random: fixedRandom(SUFFIX),
      isTaken: notTaken,
    });
    assert.equal(id.slice(0, 8), "13102026");
  });

  it("is a function of the entropy, never of the origin message", () => {
    const first = mintTaskId({
      date: DATE,
      random: byAttempt,
      isTaken: notTaken,
    });
    const second = mintTaskId({
      date: DATE,
      random: byAttempt,
      isTaken: notTaken,
    });
    assert.equal(
      first,
      second,
      "identical entropy must give an identical code",
    );
    const other = mintTaskId({
      date: DATE,
      random: (_index, attempt) => attempt + 3,
      isTaken: notTaken,
    });
    assert.notEqual(
      other,
      first,
      "different entropy must give a different code",
    );
  });

  it("retries a taken code and never reuses one", () => {
    // attempt n fills the suffix with alphabet[n], so attempts 0 and 1 produce
    // CCCC and DDDD; those are the codes already held by other tasks.
    const taken = new Set([`${DATE}CCCC`, `${DATE}DDDD`]);
    let attemptSeen = -1;
    const id = mintTaskId({
      date: DATE,
      random: (_index, attempt) => {
        attemptSeen = attempt;
        return attempt;
      },
      isTaken: (candidate) => taken.has(candidate),
    });
    assert.equal(
      attemptSeen,
      2,
      "the first two codes collide, the third is taken",
    );
    assert.equal(id, `${DATE}EEEE`);
    assert.equal(taken.has(id), false);
    assert.match(id, new RegExp(TASK_CODE_PATTERN, "u"));
  });

  it("fails closed instead of issuing a colliding identity", () => {
    assert.throws(
      () =>
        mintTaskId({
          date: DATE,
          random: () => 0,
          isTaken: () => true,
          maxAttempts: 4,
        }),
      /TASK_CODE_COLLISION_EXHAUSTED/u,
    );
  });
});

describe("M12/T1 P2 — the reducer accepts the new identity and the old one", () => {
  it("opens a task keyed by the 12-character id", () => {
    const id = `${DATE}${SUFFIX}`;
    const projection = applyWorkflowEvent(
      emptyProjection(),
      "WORKFLOW_OPENED",
      openPayload(id),
      "2026-10-13T02:00:00.000Z",
      "current",
    );
    assert.equal(projection.tasks[id].task_id, id);
    assert.equal(projection.tasks[id].workflow_status, "ACTIVE");
  });

  it("still opens the legacy 64-hex records the live ledger already carries", () => {
    const projection = applyWorkflowEvent(
      emptyProjection(),
      "WORKFLOW_OPENED",
      openPayload(LEGACY_ID),
      "2026-10-13T02:00:00.000Z",
      "current",
    );
    assert.equal(projection.tasks[LEGACY_ID].task_id, LEGACY_ID);
  });

  it("refuses an identity that is neither shape", () => {
    for (const bad of [
      "short",
      `${DATE}!!!`,
      `${DATE}${SUFFIX}X`,
      "g".repeat(64),
      "0".repeat(63),
    ]) {
      assert.throws(
        () =>
          applyWorkflowEvent(
            emptyProjection(),
            "WORKFLOW_OPENED",
            openPayload(bad),
            "2026-10-13T02:00:00.000Z",
            "current",
          ),
        /SCHEMA_INVALID/u,
        `${bad} must not be accepted as a task identity`,
      );
    }
  });

  it("refuses a task_code that disagrees with the identity", () => {
    assert.throws(
      () =>
        applyWorkflowEvent(
          emptyProjection(),
          "WORKFLOW_OPENED",
          openPayload(`${DATE}${SUFFIX}`, { task_code: `${DATE}ZZZZ` }),
          "2026-10-13T02:00:00.000Z",
          "current",
        ),
      /SCHEMA_INVALID/u,
      "one task must not carry two owner-visible codes",
    );
  });

  it("keeps requiring the binding fields that replace re-derivation", () => {
    assert.throws(
      () =>
        applyWorkflowEvent(
          emptyProjection(),
          "WORKFLOW_OPENED",
          openPayload(`${DATE}${SUFFIX}`, {
            origin_message_id: "not-a-snowflake",
          }),
          "2026-10-13T02:00:00.000Z",
          "current",
        ),
      /SCHEMA_INVALID/u,
    );
    assert.throws(
      () =>
        applyWorkflowEvent(
          emptyProjection(),
          "WORKFLOW_OPENED",
          openPayload(`${DATE}${SUFFIX}`, {
            origin_principal_ref: "a".repeat(63),
          }),
          "2026-10-13T02:00:00.000Z",
          "current",
        ),
      /SCHEMA_INVALID/u,
    );
  });

  it("carries a later event against the 12-character key", () => {
    const id = `${DATE}${SUFFIX}`;
    let projection = applyWorkflowEvent(
      emptyProjection(),
      "WORKFLOW_OPENED",
      openPayload(id),
      "2026-10-13T02:00:00.000Z",
      "current",
    );
    projection = applyWorkflowEvent(
      projection,
      "WORKFLOW_APPROVAL_REQUESTED",
      {
        task_id: id,
        agent_id: "o1",
        session_key: "agent:o1:session",
        run_id: "run-2",
      },
      "2026-10-13T02:00:01.000Z",
      "current",
    );
    assert.equal(projection.tasks[id].workflow_status, "ACTIVE");
    assert.ok(projection.tasks[id].approval_requested_at);
  });

  it("refuses a later event for an unknown task", () => {
    assert.throws(
      () =>
        applyWorkflowEvent(
          emptyProjection(),
          "WORKFLOW_APPROVAL_REQUESTED",
          {
            task_id: `${DATE}${SUFFIX}`,
            agent_id: "o1",
            session_key: "agent:o1:session",
            run_id: "run-2",
          },
          "2026-10-13T02:00:01.000Z",
          "current",
        ),
      /SCHEMA_INVALID|EXECUTION_STATE_UNKNOWN/u,
    );
  });
});

describe("M12/T1 P2 — replay protection survives a random identity", () => {
  const binding = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: "1234567890123456789",
    root_agent_id: "main",
  };

  it("finds the task that a re-delivered Discord message already opened", () => {
    const id = `${DATE}${SUFFIX}`;
    const snapshot = {
      tasks: {
        [id]: openPayload(id),
        ["1".repeat(64)]: openPayload("1".repeat(64), {
          origin_message_id: "9999999999999999999",
        }),
      },
    };
    assert.equal(findTaskByOriginBinding(snapshot, binding), id);
    assert.equal(
      findTaskByOriginBinding(snapshot, { ...binding, root_agent_id: "o1" }),
      null,
      "a different agent under the same message is not the same task",
    );
    assert.equal(
      findTaskByOriginBinding(snapshot, {
        ...binding,
        origin_message_id: "7777777777777777777",
      }),
      null,
    );
    assert.equal(
      findTaskByOriginBinding(snapshot, { ...binding, origin: "telegram" }),
      null,
    );
    assert.equal(findTaskByOriginBinding(null, binding), null);
    assert.equal(
      findTaskByOriginBinding(snapshot, {
        ...binding,
        origin_message_id: "1",
      }),
      null,
      "a malformed snowflake must not resolve any task",
    );
  });

  it("still resolves the task when a second session quotes the same message", () => {
    const id = `${DATE}${SUFFIX}`;
    const snapshot = { tasks: { [id]: openPayload(id) } };
    assert.equal(
      findTaskByOriginBinding(snapshot, {
        ...binding,
        root_session_key: "agent:main:discord:channel:9999999999999999999",
      }),
      id,
      "the session is not part of the identity binding; dropping it here would let a foreign session silently open a second task instead of being denied by the duplicate guard",
    );
  });
});

describe("M12/T1 P2 — every contract states both shapes", () => {
  const contractDir = path.resolve("integrations/openclaw/topology/contracts");
  const UNION = /^(?:\^)?\(?\[0-9a-f\]\{64\}\|/u;

  function walk(node, found, file) {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, found, file);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (/task_id$/u.test(key) && value && typeof value === "object") {
        if (typeof value.pattern === "string") {
          found.push({ file, key, pattern: value.pattern });
          assert.match(
            value.pattern,
            UNION,
            `${file}: ${key} must accept the legacy 64-hex form first`,
          );
          assert.match(
            value.pattern,
            /\[0-9\]\{8\}\[CDEFHJKMNPQRTUVWXY379\]\{4\}/u,
            `${file}: ${key} must accept the 12-character identity`,
          );
        }
      }
      walk(value, found, file);
    }
  }

  it("widens every task_id pattern in every contract", () => {
    const files = readdirSync(contractDir).filter((file) =>
      /^[a-z-]+\.schema\.json$/u.test(file),
    );
    assert.ok(files.length >= 8, "the contract set must be loaded");
    let total = 0;
    for (const file of files) {
      const schema = JSON.parse(
        readFileSync(path.join(contractDir, file), "utf8"),
      );
      const found = [];
      walk(schema, found, file);
      total += found.length;
    }
    assert.ok(
      total >= 30,
      `expected the task_id patterns to still be numerous, saw ${total}`,
    );
  });

  it("widens the task map key and keeps every other digest at 64 hex", () => {
    const snapshot = JSON.parse(
      readFileSync(
        path.join(contractDir, "ledger-snapshot.schema.json"),
        "utf8",
      ),
    );
    const taskKeys = Object.keys(snapshot.properties.tasks.patternProperties);
    assert.deepEqual(
      taskKeys,
      [TASK_ID_PATTERN],
      "the snapshot must be keyed by both identity shapes",
    );
    const taskShape =
      snapshot.properties.tasks.patternProperties[TASK_ID_PATTERN];
    const delegations =
      taskShape.oneOf[0].properties.delegations.patternProperties;
    assert.deepEqual(
      Object.keys(delegations),
      ["^[a-f0-9]{64}$"],
      "delegation ids are canonical hashes, not identities, and stay 64-hex",
    );
    assert.equal(
      snapshot.properties.last_event_digest.pattern,
      "^[a-f0-9]{64}$",
      "the ledger's own digests must not have been widened",
    );
  });
});

describe("M12/T1 P2 — the custom_id byte budget is no longer at the cliff", () => {
  it("a 12-character identity leaves the governed id well under 100", async () => {
    const { buildComponentCustomId, DISCORD_COMPONENT_ACTION_NAMESPACE } =
      await import("../integrations/openclaw/lib/authority.mjs");
    const id = buildComponentCustomId(
      DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_REVISION,
      `${DATE}${SUFFIX}`,
      "12",
    );
    assert.ok(
      id.length < 60,
      `the longest governed id should shrink to ~47 characters, got ${id.length}`,
    );
    const legacy = buildComponentCustomId(
      DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_REVISION,
      LEGACY_ID,
      "1",
    );
    assert.equal(
      legacy.length,
      100,
      "the legacy worst case sat exactly on Discord's cap, with no room for a two-digit revision",
    );
    assert.throws(
      () =>
        buildComponentCustomId(
          DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_REVISION,
          LEGACY_ID,
          "12",
        ),
      /CUSTOM_ID_TOO_LONG/u,
      "a legacy id with a two-digit revision cannot be delivered as a button at all",
    );
  });
});
