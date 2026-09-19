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
  isValidStructuredReferenceId,
  deduplicateRetrievalContext,
} from "../zink-tools/common/semantic-contract.mjs";

import { handleDiscordAction } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

import {
  formatOfficeClarificationQuestion,
  formatGovernedApprovalCard,
  formatGovernedResultCard,
  formatIncidentCard,
} from "../integrations/openclaw/lib/discord-formatter.mjs";

describe("M8/T2 Governed Runtime, Authority, Memory & Reliability Hardening — Audit Bug Register", () => {
  // =========================================================================
  // BUG-M8T2-01: Decouple execution finish from task completion
  // =========================================================================
  test("BUG-M8T2-01: EXECUTION_FINISHED event transitions to RESULT_PENDING_REVIEW, never directly to COMPLETE", () => {
    const res = validateActionAuthority({
      actor: ACTORS.O1,
      channel: CHANNELS.RESULTS,
      taskId: "TASK-001",
      currentState: TASK_STATES.EXECUTING,
      action: ACTIONS.EXECUTION_FINISHED,
    });

    assert.equal(res.allowed, true);
    // Crucial invariant: never transitions directly to COMPLETE
    assert.equal(res.nextState, TASK_STATES.RESULT_PENDING_REVIEW);
    assert.notEqual(res.nextState, TASK_STATES.COMPLETE);
  });

  // =========================================================================
  // BUG-M8T2-02: Strict 5-tuple authority check (Actor + Channel + Task + State + Action)
  // =========================================================================
  test("BUG-M8T2-02: Non-user actors strictly forbidden from APPROVE and ACCEPT_RESULT", () => {
    // 1. O1 tries to approve in #approvals -> DENIED
    const o1Approve = validateActionAuthority({
      actor: ACTORS.O1,
      channel: CHANNELS.APPROVALS,
      taskId: "TASK-002",
      currentState: TASK_STATES.APPROVAL_PENDING,
      action: ACTIONS.APPROVE,
    });
    assert.equal(o1Approve.allowed, false);
    assert.match(o1Approve.reason, /AUTHORITY_DENIED/);

    // 2. Main tries to accept result in #results -> DENIED
    const mainAccept = validateActionAuthority({
      actor: ACTORS.MAIN,
      channel: CHANNELS.RESULTS,
      taskId: "TASK-002",
      currentState: TASK_STATES.RESULT_PENDING_REVIEW,
      action: ACTIONS.ACCEPT_RESULT,
    });
    assert.equal(mainAccept.allowed, false);
    assert.match(mainAccept.reason, /AUTHORITY_DENIED/);

    // 3. User approves in wrong channel (#office instead of #approvals) -> CHANNEL_MISMATCH
    const userWrongChannel = validateActionAuthority({
      actor: ACTORS.USER,
      channel: CHANNELS.OFFICE,
      taskId: "TASK-002",
      currentState: TASK_STATES.APPROVAL_PENDING,
      action: ACTIONS.APPROVE,
    });
    assert.equal(userWrongChannel.allowed, false);
    assert.match(userWrongChannel.reason, /CHANNEL_MISMATCH/);

    // 4. User completes result while task is still EXECUTING -> INVALID_STATE_TRANSITION
    const prematureComplete = validateActionAuthority({
      actor: ACTORS.USER,
      channel: CHANNELS.RESULTS,
      taskId: "TASK-002",
      currentState: TASK_STATES.EXECUTING,
      action: ACTIONS.ACCEPT_RESULT,
    });
    assert.equal(prematureComplete.allowed, false);
    assert.match(prematureComplete.reason, /INVALID_STATE_TRANSITION/);

    // 5. User accepts result in #results when state is RESULT_PENDING_REVIEW -> ALLOWED
    const validAccept = validateActionAuthority({
      actor: ACTORS.USER,
      channel: CHANNELS.RESULTS,
      taskId: "TASK-002",
      currentState: TASK_STATES.RESULT_PENDING_REVIEW,
      action: ACTIONS.ACCEPT_RESULT,
    });
    assert.equal(validAccept.allowed, true);
    assert.equal(validAccept.nextState, TASK_STATES.COMPLETE);
  });

  // =========================================================================
  // BUG-M8T2-03: Decoupled Queue with atomic single claim and offline worker resilience
  // =========================================================================
  test("BUG-M8T2-03: QueueManager prevents dual claims and detects stale heartbeat", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-queue-test-"));
    const queueFile = path.join(tempDir, "queue.json");
    try {
      const qm = new QueueManager({ storagePath: queueFile });

      // Enqueue task
      const enqueued = qm.enqueueTask({
        taskId: "TASK-003",
        primaryCoordinator: "o1",
        requiredCapabilities: ["excel"],
      });
      assert.equal(enqueued.status, TASK_STATES.QUEUED);

      // Worker 1 claims task
      const claim1 = qm.claimTask({
        workerId: "worker-1",
        capabilities: ["excel"],
        leaseSeconds: 2,
      });
      assert.equal(claim1.claimed, true);
      assert.equal(claim1.task.claimedBy, "worker-1");
      assert.equal(claim1.task.status, TASK_STATES.EXECUTING);

      // Worker 2 attempts to claim same task -> DENIED (already executing)
      assert.throws(
        () => qm.claimTaskById({ taskId: "TASK-003", workerId: "worker-2" }),
        /CONCURRENT_CLAIM_DENIED/,
      );

      // Verify stale recovery after lease expiration
      await setTimeout(100); // small delay
      const staleRecovered = qm.detectAndRecoverStaleTasks({
        staleThresholdSeconds: 0.05,
      });
      assert.equal(staleRecovered.length, 1);
      assert.equal(staleRecovered[0].taskId, "TASK-003");

      const taskAfterStale = qm.getTask("TASK-003");
      assert.equal(taskAfterStale.status, TASK_STATES.WAITING_FOR_WORKER);
      assert.equal(taskAfterStale.claimedBy, null);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // BUG-M8T2-04: Multi-tier validation: Technical PASS + Business FAIL = RESULT BLOCKED
  // =========================================================================
  test("BUG-M8T2-04: Technical PASS + Business FAIL strictly blocks result and prohibits fake previews", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-val-test-"));
    const csvFile = path.join(tempDir, "output.csv");
    try {
      // Create a technically valid CSV
      await writeFile(
        csvFile,
        "sku,units,price,margin\nSKU-A,100,50,0.05\nSKU-B,200,30,0.02",
        "utf8",
      );

      // Business rule requires margin >= 0.10
      const gateResult = evaluateResultGate({
        artifactPath: csvFile,
        technicalConfig: {
          expectedType: "csv",
          expectedFields: ["sku", "units", "price", "margin"],
        },
        businessData: { minMargin: 0.02, targetMargin: 0.05 },
        businessConfig: {
          kpiConstraints: {
            targetMargin: { min: 0.1 }, // Expects at least 10% margin, but observed 5%
          },
        },
      });

      // Technical check passes
      assert.equal(gateResult.technical.status, VALIDATION_STATUS.PASS);
      // Business check fails
      assert.equal(gateResult.business.status, VALIDATION_STATUS.FAIL);
      // OVERALL RESULT MUST BE BLOCKED
      assert.equal(gateResult.overallStatus, VALIDATION_STATUS.BLOCKED);
      assert.equal(gateResult.isReadyForUserReview, false);
      assert.match(gateResult.blockedReason, /RESULT BLOCKED/);

      // Preview is extracted from real data, not mocked
      assert.equal(gateResult.preview.available, true);
      assert.match(gateResult.preview.previewText, /SKU-A/);
      assert.match(gateResult.preview.previewText, /SKU-B/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // BUG-M8T2-05: Decision Ledger records user decisions and eliminates redundant queries
  // =========================================================================
  test("BUG-M8T2-05: DecisionLedger requires human confirmation and answers prior queries", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-dl-test-"));
    const ledgerFile = path.join(tempDir, "decisions.json");
    try {
      const dl = new DecisionLedger({ storagePath: ledgerFile });

      // 1. Rejects recording without human confirmation
      assert.throws(
        () =>
          dl.recordDecision({
            topic: "LSCM",
            decision: "Use 2026 baseline",
            confirmedBy: null,
          }),
        /HUMAN_CONFIRMATION_REQUIRED/,
      );

      // 2. Records valid decision confirmed by user
      const recorded = dl.recordDecision({
        topic: "LSCM",
        question: "What forecast baseline should be used?",
        decision: "Use 2026 fiscal baseline model",
        scope: "global",
        confirmedBy: "854005217715814432",
        tags: ["forecast", "baseline"],
      });
      assert.equal(recorded.topic, "LSCM");

      // 3. Query finds prior decision
      assert.equal(dl.hasDecision("LSCM", "baseline"), true);
      const matches = dl.queryDecisions({ topic: "LSCM", query: "forecast" });
      assert.equal(matches.length, 1);
      assert.equal(matches[0].decision, "Use 2026 fiscal baseline model");

      // 4. Query for unknown topic returns empty
      assert.equal(dl.hasDecision("UNKNOWN_TOPIC"), false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // BUG-M8T2-06: Stale & Duplicate interaction prevention
  // =========================================================================
  test("BUG-M8T2-06: handleDiscordAction rejects mismatched attempt tokens with STALE_ACTION_REJECTED", () => {
    const res = handleDiscordAction({
      actor: "user",
      channel: "approvals",
      taskId: "TASK-006",
      action: "APPROVE",
      currentState: "APPROVAL_PENDING",
      attemptToken: "token-attempt-1",
      activeAttemptToken: "token-attempt-2", // active attempt has bumped!
    });

    assert.equal(res.allowed, false);
    assert.equal(res.status, "STALE");
    assert.match(res.reason, /STALE_ACTION_REJECTED/);
  });

  // =========================================================================
  // BUG-M8T2-07: Structured Reference ID Scheme (TOPIC-EXECUTION-TASK)
  // =========================================================================
  test("BUG-M8T2-07: formatStructuredReferenceId and parseStructuredReferenceId enforce TOPIC(2)-EXEC(2)-TASK(4)", () => {
    // Valid standard reference
    const id1 = formatStructuredReferenceId({
      topicCode: 1,
      executionCode: 3,
      taskNumber: 42,
    });
    assert.equal(id1, "01-03-0042");
    assert.equal(isValidStructuredReferenceId(id1), true);

    const parsed1 = parseStructuredReferenceId(id1);
    assert.equal(parsed1.topicCode, "01");
    assert.equal(parsed1.executionCode, "03");
    assert.equal(parsed1.taskNumber, "0042");
    assert.equal(parsed1.isHumanContributed, false);

    // Valid human-contributed reference (00 execution)
    const idHuman = formatStructuredReferenceId({
      topicCode: 1,
      executionCode: 0,
      taskNumber: 42,
    });
    assert.equal(idHuman, "01-00-0042");
    const parsedHuman = parseStructuredReferenceId(idHuman);
    assert.equal(parsedHuman.isHumanContributed, true);

    // Invalid formats
    assert.equal(isValidStructuredReferenceId("invalid-id"), false);
    assert.equal(isValidStructuredReferenceId("01-03"), false);
    assert.throws(
      () => parseStructuredReferenceId("abc-def-ghij"),
      /INVALID_REFERENCE_ID_FORMAT/,
    );
  });

  // =========================================================================
  // BUG-M8T2-08: Retrieval Deduplication collapses triple-redundant layers
  // =========================================================================
  test("BUG-M8T2-08: deduplicateRetrievalContext collapses redundant fact copies into canonical layers", () => {
    const rawResults = [
      {
        passage_id: "p-01",
        text: "Demand forecasting uses MAPE metric",
        type: "fact",
      },
      {
        passage_id: "p-01",
        text: "Demand forecasting uses MAPE metric",
        type: "fact",
      }, // Duplicate fact!
      {
        passage_id: "p-02",
        text: "How to calculate MAPE in Python",
        type: "skill",
      },
      { passage_id: "p-03", text: "zink_forecast tool schema", type: "tool" },
    ];

    const deduped = deduplicateRetrievalContext(rawResults);
    assert.equal(deduped.canonicalFacts.length, 1);
    assert.equal(deduped.procedures.length, 1);
    assert.equal(deduped.toolReferences.length, 1);
    assert.equal(deduped.totalCount, 3); // collapsed from 4 down to 3 unique
  });

  // =========================================================================
  // BUG-M8T2-09: Direct O1/O2 Clarification in #office
  // =========================================================================
  test("BUG-M8T2-09: formatOfficeClarificationQuestion formats exact ACTIVE.md Section 8 structure", () => {
    const text = formatOfficeClarificationQuestion({
      taskId: "TASK-042",
      agentId: "O1",
      question:
        "Cần chọn phương pháp phân rã theo cộng tính (additive) hay nhân tính (multiplicative)?",
      reason:
        "Dữ liệu chuỗi thời gian có biên độ dao động mùa vụ tăng dần theo thời gian.",
    });

    assert.match(text, /\*\*TASK-042 \| O1\*\*/);
    assert.match(text, /\*\*Cần xác nhận:\*\*/);
    assert.match(text, /\*\*Lý do:\*\*/);
    assert.match(text, /WAITING_FOR_USER/);
  });

  // =========================================================================
  // BUG-M8T2-10: Governed Approval & Result cards contain exact required fields
  // =========================================================================
  test("BUG-M8T2-10: Governed Discord cards contain all required fields and user button reminders", () => {
    // 1. Approval card
    const approvalCard = formatGovernedApprovalCard({
      taskId: "TASK-042",
      planVersion: "1.0",
      primary: "O1",
      executionPlan: "Chạy trích xuất SQL và xử lý Python",
      risk: "Thấp",
      validationCriteria: "Độ trễ < 2s, không lỗi schema",
      queueStatus: "QUEUED",
    });
    assert.match(approvalCard, /PHÊ DUYỆT THỰC THI/);
    assert.match(approvalCard, /TASK-042/);
    assert.match(approvalCard, /1\.0/);
    assert.match(approvalCard, /O1/);
    assert.match(approvalCard, /\[APPROVE\]/);
    assert.match(approvalCard, /\[REJECT\]/);
    assert.match(approvalCard, /\[REQUEST REVISION\]/);

    // 2. Result card
    const resultCard = formatGovernedResultCard({
      taskId: "TASK-042",
      attempt: 1,
      executionStatus: "EXECUTION_FINISHED",
      technicalValidation: "PASS",
      businessValidation: "PASS",
      preview: "| SKU | Qty |\n| --- | --- |\n| A1 | 100 |",
      artifact: "s3://bucket/result.xlsx",
      keyFindings: "Sản lượng tăng 15%",
    });
    assert.match(resultCard, /NGHIỆM THU KẾT QUẢ/);
    assert.match(resultCard, /TASK-042/);
    assert.match(resultCard, /#1/);
    assert.match(resultCard, /PASS/);
    assert.match(resultCard, /\[ACCEPT \/ COMPLETE\]/);
    assert.match(resultCard, /\[REJECT\]/);
    assert.match(resultCard, /\[REQUEST REVISION\]/);

    // 3. Incident card
    const incCard = formatIncidentCard({
      incidentId: "INC-001",
      taskId: "TASK-042",
      state: "INVESTIGATING",
      severity: "HIGH",
      observed: "Worker disconnect during processing",
      expected: "Heartbeat maintained every 60s",
      action: "Re-queueing task to waiting worker",
    });
    assert.match(incCard, /SỰ CỐ/);
    assert.match(incCard, /INC-001/);
    assert.match(incCard, /INVESTIGATING/);
  });
});
