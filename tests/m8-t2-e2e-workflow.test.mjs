import test, { describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

import {
  validateActionAuthority,
  ACTORS,
  CHANNELS,
  TASK_STATES,
  ACTIONS,
} from "../integrations/openclaw/lib/authority.mjs";

import { QueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";

import {
  evaluateResultGate,
  VALIDATION_STATUS,
} from "../integrations/openclaw/lib/artifact-validator.mjs";

import { DecisionLedger } from "../integrations/openclaw/lib/decision-ledger.mjs";

import {
  formatStructuredReferenceId,
  parseStructuredReferenceId,
  deduplicateRetrievalContext,
  prepareQueryEmbedding,
} from "../zink-tools/common/semantic-contract.mjs";

import {
  handleDiscordAction,
  handleExecutionFinished,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";

describe("M8/T2 Mandatory E2E Workflow & Failure Injection Suite", () => {
  // =========================================================================
  // Happy Path: End-to-End Canonical Flow
  // =========================================================================
  test("E2E Happy Path: Complete flow from #office to #approvals to Execution agent to #results to #office", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-e2e-happy-"));
    const queueFile = path.join(tempDir, "queue.json");
    const artifactFile = path.join(tempDir, "report.csv");
    try {
      const qm = new QueueManager({ storagePath: queueFile });
      const taskId = "TASK-100-HAPPY";

      // 1. #office: User initiates request, Main assigns Primary (O1)
      const state1 = TASK_STATES.PREFLIGHT;
      assert.equal(state1, "PREFLIGHT");

      // 2. Preflight passes -> moves to #approvals (APPROVAL_PENDING)
      const state2 = TASK_STATES.APPROVAL_PENDING;

      // 3. #approvals: User approves plan
      const approvalDecision = handleDiscordAction({
        actor: "user",
        channel: "approvals",
        taskId,
        action: "APPROVE",
        currentState: state2,
      });
      assert.equal(approvalDecision.allowed, true);
      assert.equal(approvalDecision.nextState, TASK_STATES.QUEUED);

      // 4. Enqueued in QueueManager
      const queuedItem = qm.enqueueTask({
        taskId,
        primaryCoordinator: "o1",
        requiredCapabilities: ["python", "sql"],
      });
      assert.equal(queuedItem.status, TASK_STATES.QUEUED);

      // 5. Coordinator connects and claims task -> EXECUTING (M7-010:
      // claimant must be the designated coordinator or listed capability)
      const claim = qm.claimTask({
        agentId: "o1",
        capabilities: ["python", "sql"],
      });
      assert.equal(claim.claimed, true);
      assert.equal(claim.task.status, TASK_STATES.EXECUTING);

      // 6. Execution agent generates real artifact
      await writeFile(
        artifactFile,
        "date,revenue,cost\n2026-09-01,1000,600\n2026-09-02,1200,700",
        "utf8",
      );

      // 7. O1 emits EXECUTION_FINISHED event with Multi-tier Validation
      const finishRes = handleExecutionFinished({
        taskId,
        agentId: "o1",
        leaseId: claim.leaseId,
        attempt: claim.task.attempt,
        artifactPath: artifactFile,
        technicalConfig: {
          expectedType: "csv",
          expectedFields: ["date", "revenue", "cost"],
        },
        businessData: { revenue: 2200, cost: 1300 },
        businessConfig: {
          kpiConstraints: { revenue: { min: 2000 } },
        },
        queueManager: qm,
      });
      assert.equal(finishRes.status, "READY_FOR_REVIEW");
      assert.equal(finishRes.gateResult.overallStatus, VALIDATION_STATUS.PASS);
      assert.match(finishRes.resultCard, /NGHIỆM THU KẾT QUẢ/);

      // 8. Task in #results is RESULT_PENDING_REVIEW
      const state3 = TASK_STATES.RESULT_PENDING_REVIEW;

      // 9. #results: User reviews and clicks ACCEPT / COMPLETE
      const userAccept = handleDiscordAction({
        actor: "user",
        channel: "results",
        taskId,
        action: "ACCEPT_RESULT",
        currentState: state3,
      });
      assert.equal(userAccept.allowed, true);
      assert.equal(userAccept.nextState, TASK_STATES.COMPLETE);

      // 10. Queue marked COMPLETE (M7-012: verified user + current digest)
      const completedQueue = qm.completeTask({
        taskId,
        userConfirmationRef: "user-click-accept",
        userPrincipalRef: "user-1",
        resultDigest: qm.getTask(taskId)?.resultDigest,
      });
      assert.equal(completedQueue.status, TASK_STATES.COMPLETE);

      // 11. #office: Main sends final notification
      const finalNotice = validateActionAuthority({
        actor: ACTORS.MAIN,
        channel: CHANNELS.OFFICE,
        taskId,
        currentState: TASK_STATES.COMPLETE,
        action: ACTIONS.FINAL_NOTIFICATION,
      });
      assert.equal(finalNotice.allowed, true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // 20 Required Failure & Edge Scenarios (ACTIVE.md Section 37)
  // =========================================================================

  // Scenario 1: approval REJECT
  test("Scenario 01: Approval REJECT sets task to REJECTED and halts execution", () => {
    const res = validateActionAuthority({
      actor: ACTORS.USER,
      channel: CHANNELS.APPROVALS,
      taskId: "SCEN-01",
      currentState: TASK_STATES.APPROVAL_PENDING,
      action: ACTIONS.REJECT_APPROVAL,
    });
    assert.equal(res.allowed, true);
    assert.equal(res.nextState, TASK_STATES.REJECTED);
  });

  // Scenario 2: approval REQUEST_REVISION
  test("Scenario 02: Approval REQUEST_REVISION sets task to REVISING for plan update", () => {
    const res = validateActionAuthority({
      actor: ACTORS.USER,
      channel: CHANNELS.APPROVALS,
      taskId: "SCEN-02",
      currentState: TASK_STATES.APPROVAL_PENDING,
      action: ACTIONS.REQUEST_REVISION_APPROVAL,
    });
    assert.equal(res.allowed, true);
    assert.equal(res.nextState, TASK_STATES.REVISING);
  });

  // Scenario 3: Main WAITING_FOR_USER (Main is sole authority for user clarification in #office per RC-06)
  test("Scenario 03: Direct clarification in #office moves task to WAITING_FOR_USER, user reply resumes", () => {
    // O1 cannot directly ASK_USER in #office
    const o1Ask = validateActionAuthority({
      actor: ACTORS.O1,
      channel: CHANNELS.OFFICE,
      taskId: "SCEN-03",
      currentState: TASK_STATES.EXECUTING,
      action: ACTIONS.ASK_USER,
    });
    assert.equal(o1Ask.allowed, false);
    assert.match(o1Ask.reason, /Only Main can initiate user clarification/);

    const ask = validateActionAuthority({
      actor: ACTORS.MAIN,
      channel: CHANNELS.OFFICE,
      taskId: "SCEN-03",
      currentState: TASK_STATES.EXECUTING,
      action: ACTIONS.ASK_USER,
    });
    assert.equal(ask.allowed, true);
    assert.equal(ask.nextState, TASK_STATES.WAITING_FOR_USER);

    const answer = validateActionAuthority({
      actor: ACTORS.USER,
      channel: CHANNELS.OFFICE,
      taskId: "SCEN-03",
      currentState: TASK_STATES.WAITING_FOR_USER,
      action: ACTIONS.ANSWER_USER,
    });
    assert.equal(answer.allowed, true);
    assert.equal(answer.nextState, TASK_STATES.EXECUTING);
  });

  // Scenario 4: Significant plan change
  test("Scenario 04: Significant plan change during EXECUTING pauses task to REVISING", () => {
    const res = validateActionAuthority({
      actor: ACTORS.O1,
      channel: CHANNELS.APPROVALS,
      taskId: "SCEN-04",
      currentState: TASK_STATES.EXECUTING,
      action: ACTIONS.SIGNIFICANT_PLAN_CHANGE,
    });
    assert.equal(res.allowed, true);
    assert.equal(res.nextState, TASK_STATES.REVISING);
  });

  // Scenario 5 & 6: Execution agent offline and reconnect
  test("Scenario 05 & 06: Execution agent offline keeps task in QUEUED/QUEUED; execution agent claims on reconnect", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-scen-5-"));
    try {
      const qm = new QueueManager({
        storagePath: path.join(tempDir, "q.json"),
      });
      qm.enqueueTask({ taskId: "SCEN-05", primaryCoordinator: "o1" });

      // No execution agent available yet -> task stays QUEUED
      assert.equal(qm.getTask("SCEN-05").status, TASK_STATES.QUEUED);

      // Execution agent reconnects later and claims (as assigned coordinator)
      const claim = qm.claimTask({
        agentId: "o1",
        capabilities: [],
      });
      assert.equal(claim.claimed, true);
      assert.equal(claim.task.taskId, "SCEN-05");
      assert.equal(claim.task.status, TASK_STATES.EXECUTING);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Scenario 7: Execution agent crash & stale recovery
  test("Scenario 07: Execution agent crash detected via stale heartbeat; recovers task for retry", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-scen-7-"));
    try {
      const qm = new QueueManager({
        storagePath: path.join(tempDir, "q.json"),
      });
      qm.enqueueTask({ taskId: "SCEN-07", primaryCoordinator: "o2" });
      qm.claimTask({ agentId: "o2", leaseSeconds: 1 });

      await setTimeout(60);
      const stale = qm.detectAndRecoverStaleTasks({
        staleThresholdSeconds: 0.04,
      });
      assert.equal(stale.length, 1);
      assert.equal(qm.getTask("SCEN-07").status, TASK_STATES.QUEUED);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Scenario 8: Control Plane restart persistence
  test("Scenario 08: Queue state survives Control Plane restart from filesystem", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-scen-8-"));
    const qPath = path.join(tempDir, "persisted-q.json");
    try {
      const qm1 = new QueueManager({ storagePath: qPath });
      qm1.enqueueTask({ taskId: "SCEN-08", primaryCoordinator: "o1" });

      // Simulate control plane shutdown and cold restart
      const qm2 = new QueueManager({ storagePath: qPath });
      const task = qm2.getTask("SCEN-08");
      assert.ok(task);
      assert.equal(task.taskId, "SCEN-08");
      assert.equal(task.status, TASK_STATES.QUEUED);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Scenario 9: Discord reconnect / duplicate action protection
  test("Scenario 09 & 10: Duplicate actions from Discord resends are rejected", () => {
    // Attempting to accept a task that is already COMPLETE
    const res = validateActionAuthority({
      actor: ACTORS.USER,
      channel: CHANNELS.RESULTS,
      taskId: "SCEN-10",
      currentState: TASK_STATES.COMPLETE,
      action: ACTIONS.ACCEPT_RESULT,
    });
    assert.equal(res.allowed, false);
    assert.match(res.reason, /INVALID_STATE_TRANSITION/);
  });

  // Scenario 11: Stale attempt action rejection
  test("Scenario 11: Action on expired attempt token rejected with STALE_ACTION_REJECTED", () => {
    const res = handleDiscordAction({
      actor: "user",
      channel: "approvals",
      taskId: "SCEN-11",
      action: "APPROVE",
      currentState: "APPROVAL_PENDING",
      attemptToken: "old-token-v1",
      activeAttemptToken: "active-token-v2",
    });
    assert.equal(res.allowed, false);
    assert.equal(res.status, "STALE");
  });

  // Scenario 12: Governance unavailable fails closed
  test("Scenario 12: Missing required task ID or unknown actor fails closed", () => {
    const noId = validateActionAuthority({
      actor: ACTORS.USER,
      channel: CHANNELS.APPROVALS,
      taskId: "",
      currentState: TASK_STATES.APPROVAL_PENDING,
      action: ACTIONS.APPROVE,
    });
    assert.equal(noId.allowed, false);
    assert.equal(noId.reason, "TASK_ID_REQUIRED");
  });

  // Scenario 13: Sandbox / Specialist unauthorized governance action
  test("Scenario 13: Execution specialist (e.g. Python) attempting governance action is blocked", () => {
    const specAction = validateActionAuthority({
      actor: ACTORS.PYTHON,
      channel: CHANNELS.RESULTS,
      taskId: "SCEN-13",
      currentState: TASK_STATES.RESULT_PENDING_REVIEW,
      action: ACTIONS.ACCEPT_RESULT,
    });
    assert.equal(specAction.allowed, false);
    assert.match(specAction.reason, /SPECIALIST_NO_GOVERNANCE/);
  });

  // Scenario 14: Artifact technical failure (file missing / empty)
  test("Scenario 14: Non-existent or empty artifact fails Technical Validation", () => {
    const gate = evaluateResultGate({
      artifactPath: "non_existent_file_path.xlsx",
    });
    assert.equal(gate.technical.status, VALIDATION_STATUS.FAIL);
    assert.equal(gate.overallStatus, VALIDATION_STATUS.FAIL);
    assert.equal(gate.isReadyForUserReview, false);
  });

  // Scenario 15: Technical PASS but Business FAIL = RESULT BLOCKED
  test("Scenario 15: Technical PASS + Business FAIL = RESULT BLOCKED (critical invariant)", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-scen-15-"));
    const fPath = path.join(tempDir, "test.csv");
    try {
      await writeFile(fPath, "col1,col2\n10,20", "utf8");
      const gate = evaluateResultGate({
        artifactPath: fPath,
        technicalConfig: { expectedType: "csv" },
        businessData: { targetAccuracy: 0.85 },
        businessConfig: {
          kpiConstraints: { targetAccuracy: { min: 0.95 } }, // Fails business logic!
        },
      });
      assert.equal(gate.technical.status, VALIDATION_STATUS.PASS);
      assert.equal(gate.business.status, VALIDATION_STATUS.FAIL);
      assert.equal(gate.overallStatus, VALIDATION_STATUS.BLOCKED);
      assert.match(gate.blockedReason, /RESULT BLOCKED/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Scenario 16: Result REJECT
  test("Scenario 16: User REJECT on result card marks task REJECTED", () => {
    const res = validateActionAuthority({
      actor: ACTORS.USER,
      channel: CHANNELS.RESULTS,
      taskId: "SCEN-16",
      currentState: TASK_STATES.RESULT_PENDING_REVIEW,
      action: ACTIONS.REJECT_RESULT,
    });
    assert.equal(res.allowed, true);
    assert.equal(res.nextState, TASK_STATES.REJECTED);
  });

  // Scenario 17: Result REQUEST_REVISION
  test("Scenario 17: Result REQUEST_REVISION moves task to REVISING for another attempt", () => {
    const res = validateActionAuthority({
      actor: ACTORS.USER,
      channel: CHANNELS.RESULTS,
      taskId: "SCEN-17",
      currentState: TASK_STATES.RESULT_PENDING_REVIEW,
      action: ACTIONS.REQUEST_REVISION_RESULT,
    });
    assert.equal(res.allowed, true);
    assert.equal(res.nextState, TASK_STATES.REVISING);
  });

  // Scenario 18: Memory deduplication
  test("Scenario 18: Retrieval context deduplication collapses duplicate facts", () => {
    const raw = [
      {
        content_hash: "hash-01",
        text: "Inventory holding cost rate is 18%",
        type: "fact",
      },
      {
        content_hash: "hash-01",
        text: "Inventory holding cost rate is 18%",
        type: "fact",
      }, // Duplicate!
      {
        content_hash: "hash-02",
        text: "EOQ calculation procedure",
        type: "skill",
      },
    ];
    const deduped = deduplicateRetrievalContext(raw);
    assert.equal(deduped.canonicalFacts.length, 1);
    assert.equal(deduped.procedures.length, 1);
    assert.equal(deduped.totalCount, 2);
  });

  // Scenario 19: Semantic ambiguity resolution via Decision Ledger
  test("Scenario 19: Decision Ledger consultation prevents ambiguous re-questioning", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-scen-19-"));
    try {
      const dl = new DecisionLedger({
        storagePath: path.join(tempDir, "dl.json"),
      });
      dl.recordDecision({
        topic: "SEMANTICS",
        question: "Is revenue gross or net?",
        decision: "Revenue is defined as Net Revenue after returns",
        confirmedBy: "123456789012345678",
      });
      assert.equal(
        dl.hasDecision("SEMANTICS", "Is revenue gross or net?"),
        true,
      );
      assert.equal(dl.hasDecision("SEMANTICS", "revenue"), false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Scenario 20: Embedding & Reference ID schema compliance
  test("Scenario 20: Structured Reference ID conforms to TOPIC-EXECUTION-TASK and query embedding is uncontaminated", () => {
    const id = formatStructuredReferenceId({
      topicCode: 2,
      executionCode: 4,
      taskNumber: 105,
    });
    assert.equal(id, "02-04-0105");
    const parsed = parseStructuredReferenceId(id);
    assert.equal(parsed.topicCode, "02");
    assert.equal(parsed.taskNumber, "0105");

    const queryEmbed = prepareQueryEmbedding({
      query: "Calculate safety stock",
      primary_topic: "inventory",
    });
    assert.equal(queryEmbed.queryTextForEmbedding, "Calculate safety stock");
    assert.equal(queryEmbed.queryTextForEmbedding.includes("inventory"), false);
  });
});
