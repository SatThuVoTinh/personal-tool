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
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  TASK_CODE_ALPHABET,
  TASK_CODE_LENGTH,
  TASK_CODE_PATTERN,
  TASK_ID_PATTERN,
  deriveApprovalPlanDigest,
  deriveTaskId,
  mintTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
import {
  isDeclaredReasonCode,
  loadReasonPolicy,
} from "../integrations/openclaw/topology/lib/runtime.mjs";
import {
  deriveGovernedDispatchTarget,
  findTaskByOriginBinding,
  mintUserPrincipalRef,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import { derivePrincipalRef } from "../integrations/openclaw/topology/lib/canonical.mjs";
import { ledgerPaths } from "../integrations/openclaw/topology/lib/ledger.mjs";

const emptyProjection = () => ({ tasks: {}, sequence: 0 });

// ---------------------------------------------------------------------------
// M12/T9 F-031 - the ANSWER_USER principal is minted with the identity secret
// ---------------------------------------------------------------------------

describe("M12/T9 F-031: a recorded user principal is not recomputable from source", () => {
  const SNOWFLAKE = "123456789012345678";
  const IDENTITY_SECRET = "1".repeat(64);

  it("mints the ref with the identity key, never with the literal that was in the source", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "m12t9-principal-"));
    try {
      const paths = ledgerPaths(root);
      mkdirSync(path.dirname(paths.identityKey), { recursive: true });
      writeFileSync(paths.identityKey, `${IDENTITY_SECRET}\n`);
      const minted = mintUserPrincipalRef(paths, SNOWFLAKE);
      assert.equal(
        minted,
        derivePrincipalRef(IDENTITY_SECRET, SNOWFLAKE),
        "the ref must be the one the identity secret mints",
      );
      assert.notEqual(
        minted,
        derivePrincipalRef("identity-key", SNOWFLAKE),
        "the literal key that was in the public source must never mint a ref",
      );
      assert.notEqual(
        minted,
        derivePrincipalRef("2".repeat(64), SNOWFLAKE),
        "a different identity secret must mint a different ref",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to mint anything when the identity key is absent or unusable", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "m12t9-principal-"));
    try {
      const paths = ledgerPaths(root);
      assert.equal(
        mintUserPrincipalRef(paths, SNOWFLAKE),
        null,
        "an absent identity key must refuse, not fall back to a weaker key",
      );
      mkdirSync(path.dirname(paths.identityKey), { recursive: true });
      writeFileSync(paths.identityKey, "not-a-64-hex-secret\n");
      assert.equal(
        mintUserPrincipalRef(paths, SNOWFLAKE),
        null,
        "an unusable identity key must refuse, not fall back to a weaker key",
      );
      assert.equal(mintUserPrincipalRef(null, SNOWFLAKE), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

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

// ===========================================================================
// M12/T9 - the reducer binds a decision to the plan and to the outcome
// ===========================================================================
// F-023: the owner's APPROVE used to be bound to a task id only. Nothing in
// the ledger tied the consent to the work that then ran, so a re-brief between
// the card and the click executed the NEW plan under the OLD consent, and a
// wrong-scope digest was accepted and ignored.
//
// F-226: an owner ACCEPT stamped workflow_status COMPLETE from the verdict
// alone, so a FAILED or PARTIAL run became a COMPLETE task the moment the
// owner clicked accept - the ledger then contradicted the outcome it had
// recorded.
//
// F-251: the reason-code matrix publishes three vocabularies and the check
// that guards every durable `task.reason_code` read only two of them, so a
// declared suspension code was invisible to it.
//
// F-057: nothing in the ledger ever wrote task.primary_coordinator, so every
// approved task died at COORDINATOR_NOT_EXECUTABLE before it could be
// enqueued, while the owner was told it had been queued.

describe("M12/T9 - the reducer binds a decision to the plan and the outcome", () => {
  const emptyProjection = () => ({ tasks: {}, sequence: 0 });

  function openedPayload(overrides = {}) {
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
  }

  function briefNode(nodeId, agentId, stackId) {
    return {
      node_id: nodeId,
      agent_id: agentId,
      stack_id: stackId,
      dependencies: [],
      required: false,
      input_digest: "1".repeat(64),
      constraints_digest: "2".repeat(64),
      validation_digest: "3".repeat(64),
    };
  }

  function openedWithBrief(overrides = {}) {
    const opened = openedPayload(overrides);
    let snapshot = applyWorkflowEvent(
      emptyProjection(),
      "WORKFLOW_OPENED",
      opened,
    );
    snapshot = applyWorkflowEvent(snapshot, "WORKFLOW_BRIEF_ACTIVATED", {
      task_id: opened.task_id,
      brief_revision: 1,
      semantic_contract_status: "VALID",
      nodes: [briefNode("node-excel", "excel", "data_plant")],
    });
    return { opened, snapshot };
  }

  it("F-023: an approval whose scope digest does not match the recorded plan is refused", () => {
    const { opened, snapshot } = openedWithBrief();
    assert.throws(
      () =>
        applyWorkflowEvent(snapshot, "WORKFLOW_USER_APPROVAL_DECIDED", {
          task_id: opened.task_id,
          actor: "user",
          channel: "approvals",
          decision: "APPROVE",
          scope_digest: "f".repeat(64),
        }),
      { code: "RESULT_MISMATCH" },
      "a wrong-scope consent must not transition the task",
    );
    assert.equal(
      snapshot.tasks[opened.task_id].workflow_status,
      "ACTIVE",
      "the refused approval leaves the task where it was",
    );
  });

  it("F-023: an approval bound to the recorded plan is accepted", () => {
    const { opened, snapshot } = openedWithBrief();
    const planDigest = deriveApprovalPlanDigest({
      brief_revision: snapshot.tasks[opened.task_id].brief_revision,
      nodes: snapshot.tasks[opened.task_id].nodes,
    });
    const approved = applyWorkflowEvent(
      snapshot,
      "WORKFLOW_USER_APPROVAL_DECIDED",
      {
        task_id: opened.task_id,
        actor: "user",
        channel: "approvals",
        decision: "APPROVE",
        scope_digest: planDigest,
        brief_revision: 1,
      },
    );
    assert.equal(approved.tasks[opened.task_id].workflow_status, "QUEUED");
    assert.ok(approved.tasks[opened.task_id].approved_at);
  });

  it("F-023: an approval that names a superseded brief revision is refused", () => {
    const { opened, snapshot } = openedWithBrief();
    assert.throws(
      () =>
        applyWorkflowEvent(snapshot, "WORKFLOW_USER_APPROVAL_DECIDED", {
          task_id: opened.task_id,
          actor: "user",
          channel: "approvals",
          decision: "APPROVE",
          brief_revision: 7,
        }),
      { code: "SUPERSEDED_REVISION" },
      "a stale consent must not transition the task",
    );
  });

  it("F-023: the plan digest changes when the plan changes", () => {
    const { opened, snapshot } = openedWithBrief();
    const before = deriveApprovalPlanDigest({
      brief_revision: snapshot.tasks[opened.task_id].brief_revision,
      nodes: snapshot.tasks[opened.task_id].nodes,
    });
    const other = deriveApprovalPlanDigest({
      brief_revision: snapshot.tasks[opened.task_id].brief_revision,
      nodes: [briefNode("node-sql", "sql", "data_plant")],
    });
    assert.notEqual(before, other);
    assert.match(before, /^[a-f0-9]{64}$/u);
  });

  it("F-226: an accepted FAILED outcome does not become a COMPLETE task", () => {
    const { opened, snapshot } = openedWithBrief();
    const digest = "c".repeat(64);
    const reviewed = applyWorkflowEvent(
      snapshot,
      "WORKFLOW_ROOT_RESULT_RECORDED",
      {
        task_id: opened.task_id,
        brief_revision: 1,
        native_run_id: "run-1",
        agent_id: "main",
        payload_digest: digest,
        outcome_status: "FAILED",
        reason_code: "RUN_TIMEOUT",
        governance_hash: "d".repeat(64),
      },
    );
    assert.equal(
      reviewed.tasks[opened.task_id].workflow_status,
      "RESULT_PENDING_REVIEW",
    );
    const accepted = applyWorkflowEvent(
      reviewed,
      "WORKFLOW_USER_RESULT_ACCEPTED",
      {
        task_id: opened.task_id,
        actor: "user",
        channel: "results",
        decision: "ACCEPT",
        result_digest: digest,
        outcome_status: "FAILED",
      },
    );
    assert.equal(
      accepted.tasks[opened.task_id].workflow_status,
      "FAILED",
      "the accepted outcome must survive the verdict",
    );
    assert.equal(accepted.tasks[opened.task_id].brief_state, "CLOSED");
  });

  it("F-226: an acceptance that re-labels the recorded outcome is refused", () => {
    const { opened, snapshot } = openedWithBrief();
    const digest = "c".repeat(64);
    const reviewed = applyWorkflowEvent(
      snapshot,
      "WORKFLOW_ROOT_RESULT_RECORDED",
      {
        task_id: opened.task_id,
        brief_revision: 1,
        native_run_id: "run-1",
        agent_id: "main",
        payload_digest: digest,
        outcome_status: "FAILED",
        reason_code: "RUN_TIMEOUT",
        governance_hash: "d".repeat(64),
      },
    );
    assert.throws(
      () =>
        applyWorkflowEvent(reviewed, "WORKFLOW_USER_RESULT_ACCEPTED", {
          task_id: opened.task_id,
          actor: "user",
          channel: "results",
          decision: "ACCEPT",
          result_digest: digest,
          outcome_status: "COMPLETE",
        }),
      { code: "RESULT_MISMATCH" },
      "a verdict may not re-label the result it accepts",
    );
  });

  it("F-226: a COMPLETE outcome still closes the task as COMPLETE", () => {
    const { opened, snapshot } = openedWithBrief();
    const digest = "c".repeat(64);
    const reviewed = applyWorkflowEvent(
      snapshot,
      "WORKFLOW_ROOT_RESULT_RECORDED",
      {
        task_id: opened.task_id,
        brief_revision: 1,
        native_run_id: "run-1",
        agent_id: "main",
        payload_digest: digest,
        outcome_status: "COMPLETE",
        reason_code: "NONE",
        governance_hash: "d".repeat(64),
      },
    );
    const accepted = applyWorkflowEvent(
      reviewed,
      "WORKFLOW_USER_RESULT_ACCEPTED",
      {
        task_id: opened.task_id,
        actor: "user",
        channel: "results",
        decision: "ACCEPT",
        result_digest: digest,
        outcome_status: "COMPLETE",
      },
    );
    assert.equal(accepted.tasks[opened.task_id].workflow_status, "COMPLETE");
  });

  it("F-251: every declared matrix section is visible to the reason-code check", () => {
    const policy = loadReasonPolicy();
    assert.ok(Array.isArray(policy.task_suspension_reasons));
    for (const code of policy.task_suspension_reasons) {
      assert.equal(
        isDeclaredReasonCode(code),
        true,
        `${code} is declared by the matrix and must pass the check`,
      );
    }
  });

  it("F-251: the durable reason a suspended task carries passes the check", () => {
    const opened = openedPayload();
    const snapshot = applyWorkflowEvent(
      emptyProjection(),
      "WORKFLOW_OPENED",
      opened,
    );
    const withDelegation = {
      ...snapshot,
      tasks: {
        [opened.task_id]: {
          ...snapshot.tasks[opened.task_id],
          delegations: {
            "del-1": {
              delegation_id: "del-1",
              agent_id: "o1",
              parent_session_key: "agent:main:sess-1",
              native_run_id: "native-1",
              child_session_key: "agent:o1:child-1",
              run_state: "RUNNING",
              brief_revision: 1,
            },
          },
        },
      },
    };
    const blocked = applyWorkflowEvent(
      withDelegation,
      "WORKFLOW_NATIVE_ENDED",
      {
        task_id: opened.task_id,
        native_run_id: "native-1",
        child_session_key: "agent:o1:child-1",
        parent_session_key: "agent:main:sess-1",
        outcome: "error",
      },
    );
    const reason = blocked.tasks[opened.task_id].reason_code;
    assert.equal(reason, "BLOCKED");
    assert.equal(
      isDeclaredReasonCode(reason),
      true,
      "a durable reason code must pass the published-vocabulary check",
    );
  });

  it("F-057: an opened task carries the coordinator the ledger recorded", () => {
    const opened = openedPayload();
    const snapshot = applyWorkflowEvent(emptyProjection(), "WORKFLOW_OPENED", {
      ...opened,
      primary_coordinator: "o1",
    });
    assert.equal(snapshot.tasks[opened.task_id].primary_coordinator, "o1");
    const dispatch = deriveGovernedDispatchTarget({
      ...snapshot.tasks[opened.task_id],
      nodes: [{ node_id: "node-excel", agent_id: "excel" }],
    });
    assert.equal(dispatch.ok, true);
    assert.equal(dispatch.coordinator, "o1");
  });

  it("F-057: a task with no recorded coordinator is not dispatchable", () => {
    const opened = openedPayload();
    const snapshot = applyWorkflowEvent(
      emptyProjection(),
      "WORKFLOW_OPENED",
      opened,
    );
    const dispatch = deriveGovernedDispatchTarget({
      ...snapshot.tasks[opened.task_id],
      nodes: [{ node_id: "node-excel", agent_id: "excel" }],
    });
    assert.equal(dispatch.ok, false);
    assert.equal(dispatch.error, "COORDINATOR_NOT_EXECUTABLE");
  });

  it("F-057: a coordinator that is not an executable coordinator is refused", () => {
    const opened = openedPayload();
    assert.throws(
      () =>
        applyWorkflowEvent(emptyProjection(), "WORKFLOW_OPENED", {
          ...opened,
          primary_coordinator: "main",
        }),
      { code: "UNAUTHORIZED_TARGET" },
    );
  });
});
// ===========================================================================
// F-108 - parent_agent_id is declared once, in a shared $defs block
// ===========================================================================
// The ledger's spawn reservation and the delegation envelope both carry the
// agent that owns a delegation, and they declared it twice with DIFFERENT
// value sets: the ledger accepted all seven agents, the envelope accepted
// three. Both are enforced at runtime, so a reservation the ledger accepted
// could be a handoff the envelope refuses - a sealed half-record in the audit
// trail.
//
// Only main, o1 and o2 can spawn: the specialists have no spawn targets, so a
// specialist can never be a parent. The reducer's own topology gate already
// refuses one, so no reservation the ledger ever accepted can name a
// specialist as its parent and the narrower vocabulary loses no history.
describe("M12/T9 - F-108: the parent agent is declared once", () => {
  const contractDir = path.resolve("integrations/openclaw/topology/contracts");

  function inlineParentAgentEnums(node, file, found, trail = "") {
    if (Array.isArray(node)) {
      for (const item of node) inlineParentAgentEnums(item, file, found, trail);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const at = trail ? `${trail}.${key}` : key;
      // The shared declaration itself is the ONE place the value set is
      // written; every other occurrence must reference it.
      const isTheDeclaration =
        file === "ledger-event.schema.json" && at === "$defs.parent_agent_id";
      if (key === "parent_agent_id" && value && typeof value === "object") {
        if (isTheDeclaration) found.push({ file, declaration: at });
        else if (Array.isArray(value.enum))
          found.push({ file, enum: value.enum });
        else if (typeof value.$ref === "string")
          found.push({ file, ref: value.$ref });
        else found.push({ file, other: Object.keys(value) });
      }
      inlineParentAgentEnums(value, file, found, at);
    }
  }

  it("F-108: no contract declares a second inline enum for the parent agent", () => {
    const files = readdirSync(contractDir).filter((file) =>
      /^[a-z-]+\.schema\.json$/u.test(file),
    );
    const declarations = [];
    const references = [];
    const foundDeclarations = [];
    for (const file of files) {
      const schema = JSON.parse(
        readFileSync(path.join(contractDir, file), "utf8"),
      );
      const found = [];
      inlineParentAgentEnums(schema, file, found);
      for (const entry of found) {
        if (entry.declaration) foundDeclarations.push(entry);
        else if (entry.enum) declarations.push(entry);
        else if (entry.ref) references.push(entry);
        else
          assert.fail(
            `${file}: parent_agent_id must be an enum or a $ref, saw ${JSON.stringify(entry.other)}`,
          );
      }
    }
    assert.equal(
      declarations.length,
      0,
      `the parent agent must be declared once, saw ${declarations.length} inline enum(s)`,
    );
    assert.equal(
      foundDeclarations.length,
      1,
      "exactly one shared declaration of the parent agent must exist",
    );
    assert.ok(
      references.length >= 2,
      "both the ledger event and the delegation envelope must reference the shared declaration",
    );
    for (const reference of references) {
      assert.ok(
        [
          "ledger-event.schema.json#/$defs/parent_agent_id",
          "#/$defs/parent_agent_id",
        ].includes(reference.ref),
        `${reference.file} must reference the shared declaration, saw ${reference.ref}`,
      );
    }
  });

  it("F-108: the shared declaration names exactly the agents that can spawn", () => {
    const schema = JSON.parse(
      readFileSync(path.join(contractDir, "ledger-event.schema.json"), "utf8"),
    );
    assert.deepEqual(schema.$defs.parent_agent_id.enum, ["main", "o1", "o2"]);
  });

  it("F-108: the ledger and the envelope accept and refuse the same values", async () => {
    const { validateContract } =
      await import("../integrations/openclaw/topology/lib/schema.mjs");
    const envelope = {
      schema_version: "1.0.0",
      governance_version: "m8-t2.3-r5",
      task_id: "a".repeat(64),
      brief_revision: 1,
      node_id: "node-1",
      delegation_id: "b".repeat(64),
      attempt: 1,
      parent_agent_id: "o1",
      target_agent_id: "excel",
      target_stack: "data_plant",
      expected_governance_hash: "c".repeat(64),
      inputs: "x",
      input_refs: [],
      constraints: "{}",
      validation_criteria: "{}",
      remaining_task_budget: {
        revisions: 1,
        transitions: 1,
        delegated_runs: 1,
      },
      requested_output_schema: "agent-result-payload",
    };
    for (const parent of ["main", "o1", "o2"]) {
      assert.doesNotThrow(
        () =>
          validateContract("delegation-envelope", {
            ...envelope,
            parent_agent_id: parent,
          }),
        `${parent} is a legal parent`,
      );
    }
    assert.throws(
      () =>
        validateContract("delegation-envelope", {
          ...envelope,
          parent_agent_id: "excel",
        }),
      { code: "SCHEMA_VALIDATION_FAILED" },
      "a specialist has no spawn targets and can never be a parent",
    );
  });
});
