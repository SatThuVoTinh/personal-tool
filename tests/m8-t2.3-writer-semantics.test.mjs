import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  canonicalHash,
  deriveTaskId,
  GOVERNANCE_VERSION,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";

const PRE_VERDICT_VERSIONS = [
  "m7-t2-r12",
  "m7-t5-r13",
  "m8-t2-r9",
  "m8-t2.1-r3",
];
const AMBIGUOUS_VERSION = "m8-t2.2-r4";

function fixture(tag) {
  return mkdtempSync(path.join(os.tmpdir(), `r5-${tag}-`));
}

const OPENED = (taskId) => ({
  origin: "discord",
  origin_principal_ref: "a".repeat(64),
  origin_message_id: "123456789012345678",
  task_id: taskId,
  root_agent_id: "main",
  root_session_key: "root-session",
  root_run_id: "root-run",
});

const ROOT_RESULT = (taskId) => ({
  task_id: taskId,
  brief_revision: 1,
  native_run_id: "root-run",
  agent_id: "main",
  payload_digest: "1".repeat(64),
  outcome_status: "COMPLETE",
  reason_code: "NONE",
  governance_hash: governanceHash("main"),
});

/**
 * Re-seal a journal under a different governance version, projecting and
 * recording the snapshot the reader will then accept. A re-sealed journal is
 * internally consistent in exactly the way a real historical journal is: every
 * digest covers its own stamp and the links chain through the whole file.
 */
function reseal(paths, version, options) {
  const events = readFileSync(paths.events, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  let previous = null;
  let projection = { tasks: {} };
  const sealed = events.map((event) => {
    const body = {
      ...event,
      governance_version: version,
      previous_event_digest: previous,
    };
    delete body.event_digest;
    const event_digest = canonicalHash("zink-ledger-event-v1", body);
    previous = event_digest;
    projection = applyWorkflowEvent(
      projection,
      body.type,
      body.payload,
      body.created_at,
      options,
    );
    return { ...body, event_digest };
  });
  writeFileSync(
    paths.events,
    `${sealed.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
  writeFileSync(
    paths.snapshot,
    `${JSON.stringify(
      {
        schema_version: "1.0.0",
        governance_version: version,
        sequence: sealed.length,
        last_event_digest: previous,
        ingress_ids: [],
        tasks: projection.tasks,
        updated_at: "2026-09-01T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );
  return sealed.length;
}

function openedLedger(tag) {
  const root = fixture(tag);
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const taskId = deriveTaskId(OPENED("x"));
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", OPENED(taskId));
  return { root, paths, taskId };
}

describe("Phase B (gap A) — an unambiguous writer-semantics discriminator", () => {
  it("1. a fresh new-contract ledger writes and reads back", () => {
    const { root, paths, taskId } = openedLedger("fresh");
    try {
      assert.equal(
        readSnapshot(paths).governance_version,
        GOVERNANCE_VERSION,
        "a new ledger carries the current contract",
      );
      recordWorkflowEvent(
        paths,
        "WORKFLOW_ROOT_RESULT_RECORDED",
        ROOT_RESULT(taskId),
      );
      const written = JSON.parse(readFileSync(paths.snapshot, "utf8"));
      assert.equal(
        written.tasks[taskId].workflow_status,
        "RESULT_PENDING_REVIEW",
      );
      const read = readSnapshot(paths);
      assert.equal(
        read.tasks[taskId].workflow_status,
        written.tasks[taskId].workflow_status,
        "the write must survive its own read-back",
      );
      assert.equal(
        read.tasks[taskId].root_result.pending_outcome_status,
        "COMPLETE",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("2. an unambiguous legacy journal replays historically", () => {
    for (const version of PRE_VERDICT_VERSIONS) {
      const { root, paths, taskId } = openedLedger(`legacy-${version}`);
      try {
        // Project the pre-verdict end state the deployed writer would have left.
        reseal(paths, version, {
          replayAnchored: true,
          preVerdictRootResult: true,
        });
        // A pre-verdict root result, re-sealed under the legacy stamp.
        const events = readFileSync(paths.events, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l));
        let previous = events[events.length - 1].event_digest;
        const body = {
          schema_version: "1.0.0",
          governance_version: version,
          sequence: events.length + 1,
          type: "WORKFLOW_ROOT_RESULT_RECORDED",
          payload: ROOT_RESULT(taskId),
          created_at: "2026-09-02T00:00:00.000Z",
          previous_event_digest: previous,
        };
        const event_digest = canonicalHash("zink-ledger-event-v1", body);
        writeFileSync(
          paths.events,
          `${events.map((e) => JSON.stringify(e)).join("\n")}\n${JSON.stringify({ ...body, event_digest })}\n`,
        );
        const tasks = applyWorkflowEvent(
          { tasks: readSnapshot(paths, false) && {} },
          "WORKFLOW_OPENED",
          OPENED(taskId),
          "2026-09-01T00:00:00.000Z",
        );
        // Rebuild the snapshot the pre-verdict writer would have recorded.
        let projection = { tasks: {} };
        for (const line of readFileSync(paths.events, "utf8")
          .split("\n")
          .filter(Boolean)) {
          const event = JSON.parse(line);
          projection = applyWorkflowEvent(
            projection,
            event.type,
            event.payload,
            event.created_at,
            { replayAnchored: true, preVerdictRootResult: true },
          );
        }
        assert.ok(tasks.tasks[taskId], "fixture must project the task");
        writeFileSync(
          paths.snapshot,
          `${JSON.stringify(
            {
              schema_version: "1.0.0",
              governance_version: version,
              sequence: events.length + 1,
              last_event_digest: event_digest,
              ingress_ids: [],
              tasks: projection.tasks,
              updated_at: "2026-09-02T00:00:00.000Z",
            },
            null,
            2,
          )}\n`,
        );
        const read = readSnapshot(paths);
        assert.equal(
          read.tasks[taskId].workflow_status,
          "COMPLETE",
          `${version}: historical replay must reproduce the pre-verdict end state`,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("3. a legacy journal plus a new-contract write stays readable", () => {
    // This is the defect Phase B fixes: a journal-wide era flag re-resolved the
    // current writer's own write and made a successful write unreadable.
    const { root, paths, taskId } = openedLedger("mixed");
    try {
      reseal(paths, AMBIGUOUS_VERSION, {
        replayAnchored: true,
        preVerdictRootResult: true,
      });
      const read = readSnapshot(paths);
      assert.equal(read.sequence, 1, "the legacy journal is accepted");
      recordWorkflowEvent(
        paths,
        "WORKFLOW_ROOT_RESULT_RECORDED",
        ROOT_RESULT(taskId),
      );
      const written = JSON.parse(readFileSync(paths.snapshot, "utf8"));
      assert.equal(
        written.tasks[taskId].workflow_status,
        "RESULT_PENDING_REVIEW",
      );
      const after = readSnapshot(paths);
      assert.equal(
        after.tasks[taskId].workflow_status,
        "RESULT_PENDING_REVIEW",
        "the new-contract event must keep the CURRENT semantics",
      );
      assert.equal(
        after.tasks[taskId].root_result.pending_outcome_status,
        "COMPLETE",
        "and must be resolved by the verdict model, not the legacy one",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("4. m8-t2.2-r4 is not a verdict-writer discriminator", () => {
    // The ambiguous stamp must not, by itself, select verdict semantics. A
    // journal carrying only m8-t2.2-r4 events has no pre-verdict stamp, so the
    // compatibility path declines and the CURRENT model applies.
    const { root, paths, taskId } = openedLedger("ambig");
    try {
      reseal(paths, AMBIGUOUS_VERSION, {
        replayAnchored: true,
        preVerdictRootResult: true,
      });
      const events = readFileSync(paths.events, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      let previous = events[events.length - 1].event_digest;
      const body = {
        schema_version: "1.0.0",
        governance_version: AMBIGUOUS_VERSION,
        sequence: events.length + 1,
        type: "WORKFLOW_ROOT_RESULT_RECORDED",
        payload: ROOT_RESULT(taskId),
        created_at: "2026-09-02T00:00:00.000Z",
        previous_event_digest: previous,
      };
      const event_digest = canonicalHash("zink-ledger-event-v1", body);
      previous = event_digest;
      writeFileSync(
        paths.events,
        `${events.map((e) => JSON.stringify(e)).join("\n")}\n${JSON.stringify({ ...body, event_digest })}\n`,
      );
      // Snapshot recorded under the VERDICT model, as the verdict writer left it.
      let verdictTasks = { tasks: {} };
      for (const line of readFileSync(paths.events, "utf8")
        .split("\n")
        .filter(Boolean)) {
        const event = JSON.parse(line);
        verdictTasks = applyWorkflowEvent(
          verdictTasks,
          event.type,
          event.payload,
          event.created_at,
        );
      }
      const tasks = verdictTasks.tasks;
      writeFileSync(
        paths.snapshot,
        `${JSON.stringify(
          {
            schema_version: "1.0.0",
            governance_version: AMBIGUOUS_VERSION,
            sequence: events.length + 1,
            last_event_digest: previous,
            ingress_ids: [],
            tasks,
            updated_at: "2026-09-02T00:00:00.000Z",
          },
          null,
          2,
        )}\n`,
      );
      const read = readSnapshot(paths);
      assert.equal(
        read.tasks[taskId].workflow_status,
        "RESULT_PENDING_REVIEW",
        "an m8-t2.2-r4 stamp alone must not force pre-verdict semantics",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("5. a snapshot-derived discriminator cannot pass verification", () => {
    // Whatever the snapshot claims, the digest chain and the projected state
    // must agree. A snapshot edited to select the other semantics is rejected.
    const { root, paths, taskId } = openedLedger("circular");
    try {
      reseal(paths, AMBIGUOUS_VERSION, {
        replayAnchored: true,
        preVerdictRootResult: true,
      });
      const events = readFileSync(paths.events, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      let previous = events[events.length - 1].event_digest;
      const body = {
        schema_version: "1.0.0",
        governance_version: AMBIGUOUS_VERSION,
        sequence: events.length + 1,
        type: "WORKFLOW_ROOT_RESULT_RECORDED",
        payload: ROOT_RESULT(taskId),
        created_at: "2026-09-02T00:00:00.000Z",
        previous_event_digest: previous,
      };
      const event_digest = canonicalHash("zink-ledger-event-v1", body);
      writeFileSync(
        paths.events,
        `${events.map((e) => JSON.stringify(e)).join("\n")}\n${JSON.stringify({ ...body, event_digest })}\n`,
      );
      const current = readSnapshot(paths, false) ?? {};
      // Forge a snapshot that CLAIMS the verdict state while the events
      // reproduce the pre-verdict state. The reader must refuse it.
      const forgedTasks = JSON.parse(
        readFileSync(paths.snapshot, "utf8"),
      ).tasks;
      writeFileSync(
        paths.snapshot,
        `${JSON.stringify(
          {
            schema_version: "1.0.0",
            governance_version: AMBIGUOUS_VERSION,
            sequence: events.length + 1,
            last_event_digest: event_digest,
            ingress_ids: [],
            tasks: forgedTasks,
            updated_at: "2026-09-02T00:00:00.000Z",
          },
          null,
          2,
        )}\n`,
      );
      const projected = applyWorkflowEvent(
        { tasks: {} },
        "WORKFLOW_OPENED",
        OPENED(taskId),
        "2026-09-01T00:00:00.000Z",
      );
      assert.ok(projected.tasks[taskId], "fixture must project");
      // Now break exactly one projected field the compare reads.
      const tampered = JSON.parse(readFileSync(paths.snapshot, "utf8"));
      tampered.tasks[taskId].workflow_status = "REJECTED";
      writeFileSync(paths.snapshot, `${JSON.stringify(tampered, null, 2)}\n`);
      assert.throws(
        () => readSnapshot(paths),
        (err) => err.code === "EXECUTION_STATE_UNKNOWN",
        "a snapshot that disagrees with the projected state must be refused",
      );
      void current;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("6. a successful write is always readable, in every era", () => {
    for (const version of [
      GOVERNANCE_VERSION,
      AMBIGUOUS_VERSION,
      "m7-t5-r13",
    ]) {
      const { root, paths, taskId } = openedLedger(`writable-${version}`);
      try {
        if (version !== GOVERNANCE_VERSION) {
          reseal(paths, version, {
            replayAnchored: true,
            preVerdictRootResult: true,
          });
        }
        recordWorkflowEvent(
          paths,
          "WORKFLOW_ROOT_RESULT_RECORDED",
          ROOT_RESULT(taskId),
        );
        const written = JSON.parse(readFileSync(paths.snapshot, "utf8"));
        const read = readSnapshot(paths);
        assert.equal(
          read.tasks[taskId].workflow_status,
          written.tasks[taskId].workflow_status,
          `${version}: the write must survive its own read-back`,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("7. the tail remains strict, in every era", () => {
    for (const version of [
      GOVERNANCE_VERSION,
      AMBIGUOUS_VERSION,
      "m7-t5-r13",
    ]) {
      const { root, paths, taskId } = openedLedger(`tail-${version}`);
      try {
        if (version !== GOVERNANCE_VERSION) {
          reseal(paths, version, {
            replayAnchored: true,
            preVerdictRootResult: true,
          });
        }
        recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
          task_id: taskId,
          brief_revision: 1,
          semantic_contract_status: "VALID",
          nodes: [
            {
              node_id: "o1",
              agent_id: "o1",
              stack_id: "data_plant",
              dependencies: [],
              required: true,
              input_digest: "a".repeat(64),
              constraints_digest: "b".repeat(64),
              validation_digest: "c".repeat(64),
            },
          ],
        });
        // No approval: the reserve must be refused on the WRITE path, and the
        // tolerance must never let one through on read-back either.
        const before = readFileSync(paths.events, "utf8").length;
        assert.throws(
          () =>
            recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", {
              task_id: taskId,
              brief_revision: 1,
              node_id: "o1",
              agent_id: "o1",
              parent_agent_id: "main",
              parent_session_key: "root-session",
              parent_run_id: "root-run",
              tool_call_id: "call-x",
              turn: 1,
              attempt: 1,
              expected_governance_hash: governanceHash("o1"),
            }),
          { code: "AUTH_APPROVAL_REQUIRED" },
          `${version}: an unapproved reserve must be refused`,
        );
        assert.equal(
          readFileSync(paths.events, "utf8").length,
          before,
          `${version}: a refused write must append nothing`,
        );
        assert.doesNotThrow(
          () => readSnapshot(paths),
          `${version}: the ledger stays readable after a refused write`,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("8. BLOCKED is never silently read as RESULT_PENDING_REVIEW", () => {
    // The verdict model routes a root result to owner review. The pre-verdict
    // model ended the task at its recorded outcome. These are different
    // semantics, so a ledger recorded under one must not verify under the
    // other: the compare must reject the substitution.
    const { root, paths, taskId } = openedLedger("blocked");
    try {
      // The real legacy shape: the task's OPENED and its root result BOTH carry
      // a PRE-VERDICT stamp, so the pre-verdict model is the one the events
      // describe.
      //
      // M12/T9 F-160 (the owner's ruling, 2026-10-21): the AMBIGUOUS
      // m8-t2.2-r4 stamp is a VERDICT stamp in every path, so a root result
      // carrying it is no longer resolved by the JOURNAL's scope. This case
      // therefore uses the pre-verdict stamp the pre-verdict writer actually
      // emitted, and the AMBIGUOUS stamp is covered by case 4 above, by
      // tests/m8-t2.3-blocked-verdict.test.mjs and by
      // tests/agent-owner-F-160.test.mjs.
      const opened = readFileSync(paths.events, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      // Re-seal the opener under a pre-verdict stamp so the journal carries one.
      const legacyOpen = {
        ...opened[0],
        governance_version: "m7-t5-r13",
        previous_event_digest: null,
      };
      delete legacyOpen.event_digest;
      legacyOpen.event_digest = canonicalHash(
        "zink-ledger-event-v1",
        legacyOpen,
      );
      const all = [legacyOpen];
      let previous = legacyOpen.event_digest;
      const body = {
        schema_version: "1.0.0",
        governance_version: "m7-t5-r13",
        sequence: 2,
        type: "WORKFLOW_ROOT_RESULT_RECORDED",
        payload: {
          ...ROOT_RESULT(taskId),
          outcome_status: "BLOCKED",
          reason_code: "POLICY_DENIED",
        },
        created_at: "2026-09-02T00:00:00.000Z",
        previous_event_digest: previous,
      };
      const event_digest = canonicalHash("zink-ledger-event-v1", body);
      all.push({ ...body, event_digest });
      writeFileSync(
        paths.events,
        `${all.map((e) => JSON.stringify(e)).join("\n")}\n`,
      );
      // Pre-verdict projection: the task ends BLOCKED.
      let preVerdict = { tasks: {} };
      for (const event of all) {
        preVerdict = applyWorkflowEvent(
          preVerdict,
          event.type,
          event.payload,
          event.created_at,
          { replayAnchored: true, preVerdictRootResult: true },
        );
      }
      assert.equal(preVerdict.tasks[taskId].workflow_status, "BLOCKED");
      writeFileSync(
        paths.snapshot,
        `${JSON.stringify(
          {
            schema_version: "1.0.0",
            governance_version: AMBIGUOUS_VERSION,
            sequence: all.length,
            last_event_digest: event_digest,
            ingress_ids: [],
            tasks: preVerdict.tasks,
            updated_at: "2026-09-02T00:00:00.000Z",
          },
          null,
          2,
        )}\n`,
      );
      // Accepted, as the pre-verdict writer left it.
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "BLOCKED",
      );
      // Now substitute the verdict state in the snapshot only. The events are
      // untouched, so the compare must reject it: BLOCKED must not be laundered
      // into RESULT_PENDING_REVIEW by editing state.
      const laundered = JSON.parse(readFileSync(paths.snapshot, "utf8"));
      laundered.tasks[taskId].workflow_status = "RESULT_PENDING_REVIEW";
      laundered.tasks[taskId].result_pending_at = "2026-09-02T00:00:00.000Z";
      laundered.tasks[taskId].root_result.pending_outcome_status = "BLOCKED";
      writeFileSync(paths.snapshot, `${JSON.stringify(laundered, null, 2)}\n`);
      assert.throws(
        () => readSnapshot(paths),
        (err) => err.code === "EXECUTION_STATE_UNKNOWN",
        "BLOCKED must not be silently converted to RESULT_PENDING_REVIEW",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("9. the discriminator is carried by the event and sealed by its digest", () => {
    // The contract is auditable from the event alone: every event declares a
    // version, the version is inside the digest, and tampering with it breaks
    // the chain.
    const { root, paths, taskId } = openedLedger("auditable");
    try {
      recordWorkflowEvent(
        paths,
        "WORKFLOW_ROOT_RESULT_RECORDED",
        ROOT_RESULT(taskId),
      );
      const lines = readFileSync(paths.events, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      for (const event of lines) {
        assert.ok(
          typeof event.governance_version === "string",
          "every event must declare its writer-semantics version",
        );
        validateContract("ledger-event", event);
        const { event_digest, ...unsigned } = event;
        assert.equal(
          canonicalHash("zink-ledger-event-v1", unsigned),
          event_digest,
          "the version must be covered by the event digest",
        );
        // Restamping the version without re-sealing must break verification.
        const forged = { ...unsigned, governance_version: AMBIGUOUS_VERSION };
        assert.notEqual(
          canonicalHash("zink-ledger-event-v1", forged),
          event_digest,
          "a re-stamped version must not keep the original digest",
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
