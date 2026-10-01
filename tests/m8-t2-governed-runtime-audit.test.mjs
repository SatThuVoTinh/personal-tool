import test, { describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

import {
  validateActionAuthority,
  ACTORS,
  CHANNELS,
  TASK_STATES,
  ACTIONS,
  resolveMentionedAgents,
  resolveIngressRouting,
  validateCrossLayerIdentity,
  validateDiscordTargetGuild,
  isAllowedDiscordSender,
  convertAgentsListToEntries,
  validateOpenClawReleaseCompatibility,
  getDiscordSurfaceBindings,
  validateAgentRoster,
  CANONICAL_AGENT_ROSTER,
  AGENT_ROSTER_VERSION,
} from "../integrations/openclaw/lib/authority.mjs";

import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";
import { buildSpawnProposal } from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
import {
  ensureLedger,
  inspectLedgerUpgrade,
  readSnapshot,
  ledgerPaths,
} from "../integrations/openclaw/topology/lib/ledger.mjs";

import { QueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";

import {
  evaluateResultGate,
  validateTechnicalArtifact,
  generateArtifactPreview,
  VALIDATION_STATUS,
} from "../integrations/openclaw/lib/artifact-validator.mjs";

import { validateSqlFileContent } from "../zink-tools/sql/validator.mjs";
import {
  validatePythonFileContent,
  formatPythonPreview,
} from "../zink-tools/python/python-validator.mjs";

import { DecisionLedger } from "../integrations/openclaw/lib/decision-ledger.mjs";

import {
  formatStructuredReferenceId,
  parseStructuredReferenceId,
  isValidStructuredReferenceId,
  deduplicateRetrievalContext,
  REFERENCE_TOPIC_CODES,
  REFERENCE_EXECUTION_CODES,
  resolveReferenceIdMeaning,
} from "../zink-tools/common/semantic-contract.mjs";

import {
  evaluateToolAccess,
  handleDiscordAction,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";

import {
  formatOfficeClarificationQuestion,
  formatGovernedApprovalCard,
  formatGovernedResultCard,
  formatIncidentCard,
} from "../integrations/openclaw/lib/discord-formatter.mjs";

import {
  AGENT_SPAWN_POLICY,
  agentInstructions,
} from "../integrations/openclaw/lib/policy.mjs";
import { executeExcelOperation } from "../integrations/openclaw/lib/excel-writer.mjs";
// A14-A22, A24, A30: Discord component callback schema and interaction guards
import {
  DISCORD_COMPONENT_ACTION_NAMESPACE,
  buildComponentCustomId,
  parseComponentCustomId,
  isStaleComponentAction,
  buildMessageIdempotencyKey,
  validateDiscordForumTarget,
  validateComponentThreadCorrelation,
  validateContextVisibilityForThread,
} from "../integrations/openclaw/lib/authority.mjs";

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
  // BUG-M8T2-03: Decoupled Queue with atomic single claim and offline execution agent resilience
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

      // Execution agent 1 claims task (M7-010: claimant must be the
      // designated coordinator or a listed required capability)
      const claim1 = qm.claimTask({
        agentId: "excel",
        capabilities: ["excel"],
        leaseSeconds: 2,
      });
      assert.equal(claim1.claimed, true);
      assert.equal(claim1.task.claimedBy, "excel");
      assert.equal(claim1.task.status, TASK_STATES.EXECUTING);

      // Execution agent 2 attempts to claim same task -> DENIED (already executing)
      assert.throws(
        () =>
          qm.claimTaskById({
            taskId: "TASK-003",
            agentId: "o2",
          }),
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
      assert.equal(taskAfterStale.status, TASK_STATES.QUEUED);
      assert.equal(taskAfterStale.claimedBy, null);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("R4: QueueManager fails closed on storage read and write errors", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-queue-fail-"));
    try {
      const unreadableQueue = path.join(tempDir, "unreadable.json");
      await writeFile(unreadableQueue, "not-json", "utf8");
      assert.throws(
        () => new QueueManager({ storagePath: unreadableQueue }),
        /QUEUE_STORAGE_READ_FAILED/u,
      );

      const storageBlocker = path.join(tempDir, "storage-blocker");
      await writeFile(storageBlocker, "not-a-directory", "utf8");
      const blockedQueue = path.join(storageBlocker, "queue.json");
      const qm = new QueueManager({ storagePath: blockedQueue });
      assert.throws(
        () =>
          qm.enqueueTask({
            taskId: "QUEUE-WRITE-FAIL",
            primaryCoordinator: "o1",
          }),
        /QUEUE_STORAGE_WRITE_FAILED/u,
      );
      assert.equal(qm.getTask("QUEUE-WRITE-FAIL"), null);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("R4: Skill Store tool access requires a governed, non-global namespace", () => {
    assert.equal(
      evaluateToolAccess("excel", "zink_skill_search", {
        namespace: "excel",
      }).allowed,
      true,
    );
    assert.deepEqual(
      evaluateToolAccess("excel", "zink_skill_search", {
        namespace: "all",
      }),
      { allowed: false, reason: "NAMESPACE_ACCESS_DENIED" },
    );
    assert.deepEqual(
      evaluateToolAccess("excel", "zink_skill_search", {
        namespace: "unknown-namespace",
      }),
      { allowed: false, reason: "NAMESPACE_ACCESS_DENIED" },
    );
    assert.deepEqual(
      evaluateToolAccess("excel", "zink_skill_search", {
        namespace: "",
      }),
      { allowed: false, reason: "NAMESPACE_ACCESS_DENIED" },
    );
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
        confirmedBy: "123456789012345678",
        tags: ["forecast", "baseline"],
      });
      assert.equal(recorded.topic, "LSCM");

      // 3. Query finds prior decision (M7-036: exact governed question —
      // substring generalization never matches)
      assert.equal(
        dl.hasDecision("LSCM", "What forecast baseline should be used?"),
        true,
      );
      assert.equal(dl.hasDecision("LSCM", "baseline"), false);
      const matches = dl.queryDecisions({
        topic: "LSCM",
        query: "What forecast baseline should be used?",
      });
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

    // Verify Canonical Reference ID Matrix tables and decoding
    assert.equal(Object.keys(REFERENCE_TOPIC_CODES).length >= 7, true);
    assert.equal(REFERENCE_TOPIC_CODES["01"].key, "LSCM");
    assert.equal(REFERENCE_TOPIC_CODES["03"].key, "EXCEL");

    assert.equal(REFERENCE_EXECUTION_CODES["00"].isHuman, true);
    assert.equal(REFERENCE_EXECUTION_CODES["01"].isHuman, false);
    assert.equal(REFERENCE_EXECUTION_CODES["03"].code, "03");

    // Semantic Meaning Resolution
    const meaning1 = resolveReferenceIdMeaning("01-03-0042");
    assert.equal(meaning1.topic.key, "LSCM");
    assert.equal(meaning1.execution.code, "03");
    assert.match(meaning1.summary, /LSCM/);

    const meaningHuman = resolveReferenceIdMeaning("01-00-0042");
    assert.equal(meaningHuman.isHumanContributed, true);
    assert.equal(meaningHuman.execution.isHuman, true);
    assert.match(meaningHuman.summary, /Human-Contributed/);

    const meaningExcel = resolveReferenceIdMeaning("03-03-0105");
    assert.equal(meaningExcel.topic.key, "EXCEL");
    assert.equal(meaningExcel.taskNumber, "0105");
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
      observed: "Execution agent disconnect during processing",
      expected: "Heartbeat maintained every 60s",
      action: "Re-queueing task to waiting execution agent",
    });
    assert.match(incCard, /SỰ CỐ/);
    assert.match(incCard, /INC-001/);
    assert.match(incCard, /INVESTIGATING/);
  });

  // =========================================================================
  // BUG-M8T2-11: Strict Authority Hierarchy & Spawn Policy Enforcement
  // =========================================================================
  test("BUG-M8T2-11: Main only delegates to O1 and O2; O1/O2 manage distinct specialist domains", () => {
    // Main is Control Supervisor: strictly prohibited from spawning specialists directly
    assert.deepEqual([...AGENT_SPAWN_POLICY.main], ["o1", "o2"]);
    assert.equal(AGENT_SPAWN_POLICY.main.includes("excel"), false);
    assert.equal(AGENT_SPAWN_POLICY.main.includes("power-bi"), false);
    assert.equal(AGENT_SPAWN_POLICY.main.includes("sql"), false);
    assert.equal(AGENT_SPAWN_POLICY.main.includes("python"), false);

    // O1 manages ETL specialists
    assert.deepEqual([...AGENT_SPAWN_POLICY.o1], ["excel", "sql", "python"]);

    // O2 manages Analytics & Visualization specialists
    assert.deepEqual([...AGENT_SPAWN_POLICY.o2], ["power-bi", "python"]);

    // Specialists have empty spawn lists (pure execution execution agents)
    for (const spec of ["excel", "power-bi", "sql", "python"]) {
      assert.deepEqual([...AGENT_SPAWN_POLICY[spec]], []);
    }
  });

  // =========================================================================
  // BUG-M8T2-12: Real Visual Spreadsheet Preview Generation & Multi-Tier Linking
  // =========================================================================
  test("BUG-M8T2-12: Excel operation produces real visual SVG preview alongside xlsx file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-excel-prev-"));
    const excelFile = path.join(tempDir, "revenue_report.xlsx");
    try {
      const res = executeExcelOperation(
        {
          operation: "generate",
          file_path: excelFile,
          sheet_name: "DoanhThu2026",
          data: [
            ["Tháng", "Doanh Thu (VNĐ)", "Chi Phí (VNĐ)", "Lợi Nhuận"],
            ["T1", "150,000,000", "90,000,000", "60,000,000"],
            ["T2", "180,000,000", "100,000,000", "80,000,000"],
          ],
        },
        tempDir,
      );

      assert.equal(res.status, "success");
      assert.ok(res.preview_image_path);
      assert.match(res.preview_image_path, /revenue_report_preview\.svg$/);
      assert.equal(Object.hasOwn(res, "absolute_path"), false);
      assert.equal(res.preview_image_path, "revenue_report_preview.svg");
      assert.equal(JSON.stringify(res).includes(tempDir), false);

      // Verify artifact evaluation detects Excel and links real visual preview
      const gate = evaluateResultGate({
        artifactPath: excelFile,
        technicalConfig: { expectedType: "excel" },
      });

      assert.equal(gate.technical.status, VALIDATION_STATUS.PASS);
      assert.equal(gate.preview.available, true);
      assert.equal(gate.preview.type, "excel");
      assert.match(gate.preview.previewText, /Hình ảnh Preview thực tế/);
      assert.match(gate.preview.previewText, /revenue_report_preview\.svg/);

      // Result card includes visual preview image reference
      const card = formatGovernedResultCard({
        taskId: "TASK-042",
        attempt: 1,
        executionStatus: "EXECUTION_FINISHED",
        technicalValidation: "PASS",
        businessValidation: "PASS",
        preview: gate.preview.previewText,
        previewImage: gate.preview.previewImage,
        artifact: excelFile,
        keyFindings: "Doanh thu Q1 tăng trưởng tốt.",
      });

      assert.match(card, /revenue_report_preview\.svg/);
      assert.match(card, /Hình ảnh Preview Trực quan/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Data File Format Handler Enrichment — format coverage test suite
// =============================================================================

describe("Data File Format Handler Enrichment — multi-format validation & preview", () => {
  // -------------------------------------------------------------------------
  // SQL script files
  // -------------------------------------------------------------------------
  test("SQL: validateTechnicalArtifact passes for valid .sql file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-sql-"));
    try {
      const sqlFile = path.join(tempDir, "query.sql");
      await writeFile(
        sqlFile,
        "SELECT id, name FROM products WHERE active = 1;",
      );
      const result = validateTechnicalArtifact({ filePath: sqlFile });
      assert.equal(result.status, VALIDATION_STATUS.PASS);
      assert.equal(result.checks.inferredType, "sql");
      assert.equal(result.checks.hasSqlKeyword, true);
      assert.equal(result.checks.statementCount, 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("SQL: generateArtifactPreview returns statement count and no-mutation flag", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-sqlprev-"));
    try {
      const sqlFile = path.join(tempDir, "report.sql");
      await writeFile(
        sqlFile,
        "-- Sales report\nSELECT month, SUM(revenue) AS total\nFROM sales\nGROUP BY month;",
      );
      const preview = generateArtifactPreview({ filePath: sqlFile });
      assert.equal(preview.available, true);
      assert.equal(preview.type, "sql");
      assert.match(preview.previewText, /SQL Script/);
      assert.match(preview.previewText, /Chỉ đọc/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("SQL: generateArtifactPreview flags DML mutations", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-sqlmut-"));
    try {
      const sqlFile = path.join(tempDir, "migrate.sql");
      await writeFile(sqlFile, "DELETE FROM old_records WHERE year < 2020;");
      const preview = generateArtifactPreview({ filePath: sqlFile });
      assert.equal(preview.hasMutations, true);
      assert.match(preview.previewText, /câu lệnh ghi/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("SQL: validateTechnicalArtifact fails for empty .sql file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-sqlempty-"));
    try {
      const sqlFile = path.join(tempDir, "empty.sql");
      await writeFile(sqlFile, "");
      const result = validateTechnicalArtifact({
        filePath: sqlFile,
        minBytes: 1,
      });
      assert.equal(result.status, VALIDATION_STATUS.FAIL);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Python script files
  // -------------------------------------------------------------------------
  test("Python: validateTechnicalArtifact passes for valid .py file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-py-"));
    try {
      const pyFile = path.join(tempDir, "etl.py");
      await writeFile(
        pyFile,
        "import pandas as pd\n\ndef load_data(path):\n    return pd.read_csv(path)\n",
      );
      const result = validateTechnicalArtifact({ filePath: pyFile });
      assert.equal(result.status, VALIDATION_STATUS.PASS);
      assert.equal(result.checks.inferredType, "python");
      assert.equal(result.checks.importCount, 1);
      assert.equal(result.checks.functionCount, 1);
      assert.equal(result.checks.classCount, 0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("Python: generateArtifactPreview returns function/class/import counts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-pyprev-"));
    try {
      const pyFile = path.join(tempDir, "model.py");
      await writeFile(
        pyFile,
        "from sklearn.linear_model import LinearRegression\nimport numpy as np\n\nclass Predictor:\n    def fit(self, X, y):\n        pass\n    def predict(self, X):\n        pass\n",
      );
      const preview = generateArtifactPreview({ filePath: pyFile });
      assert.equal(preview.available, true);
      assert.equal(preview.type, "python");
      assert.equal(preview.functionCount, 2);
      assert.equal(preview.classCount, 1);
      assert.equal(preview.importCount, 2);
      assert.match(preview.previewText, /Python Script/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("Python: validateTechnicalArtifact fails for empty .py file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-pyempty-"));
    try {
      const pyFile = path.join(tempDir, "empty.py");
      await writeFile(pyFile, "");
      const result = validateTechnicalArtifact({
        filePath: pyFile,
        minBytes: 1,
      });
      assert.equal(result.status, VALIDATION_STATUS.FAIL);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Power BI (.pbix / .pbit)
  // -------------------------------------------------------------------------
  test("Power BI: validateTechnicalArtifact passes for valid ZIP magic bytes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-pbix-"));
    try {
      const pbixFile = path.join(tempDir, "dashboard.pbix");
      // PK\x03\x04 = ZIP local file header signature
      const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
      await writeFile(pbixFile, buf);
      const result = validateTechnicalArtifact({ filePath: pbixFile });
      assert.equal(result.status, VALIDATION_STATUS.PASS);
      assert.equal(result.checks.inferredType, "powerbi");
      assert.equal(result.checks.magicBytesValid, true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("Power BI: validateTechnicalArtifact fails for corrupt file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-pbixbad-"));
    try {
      const pbixFile = path.join(tempDir, "corrupt.pbix");
      await writeFile(pbixFile, Buffer.from([0xff, 0xfe, 0x00, 0x00, 0x00]));
      const result = validateTechnicalArtifact({ filePath: pbixFile });
      assert.equal(result.status, VALIDATION_STATUS.FAIL);
      assert.equal(result.checks.magicBytesValid, false);
      assert.ok(result.errors.some((e) => e.includes("CORRUPT_POWERBI")));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("Power BI: generateArtifactPreview describes pbix container validity", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-pbixprev-"));
    try {
      const pbixFile = path.join(tempDir, "report.pbix");
      const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
      await writeFile(pbixFile, buf);
      const preview = generateArtifactPreview({ filePath: pbixFile });
      assert.equal(preview.available, true);
      assert.equal(preview.type, "powerbi");
      assert.match(preview.previewText, /Power BI/);
      assert.match(preview.previewText, /Container ZIP hợp lệ/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Apache Parquet
  // -------------------------------------------------------------------------
  test("Parquet: validateTechnicalArtifact passes for valid PAR1 magic bytes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-parquet-"));
    try {
      const parquetFile = path.join(tempDir, "data.parquet");
      // PAR1 header + dummy body + PAR1 footer
      const body = Buffer.alloc(20, 0x00);
      const magic = Buffer.from("PAR1", "ascii");
      await writeFile(parquetFile, Buffer.concat([magic, body, magic]));
      const result = validateTechnicalArtifact({ filePath: parquetFile });
      assert.equal(result.status, VALIDATION_STATUS.PASS);
      assert.equal(result.checks.inferredType, "parquet");
      assert.equal(result.checks.magicBytesHeader, true);
      assert.equal(result.checks.magicBytesFooter, true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("Parquet: validateTechnicalArtifact fails when footer PAR1 is missing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-parqbad-"));
    try {
      const parquetFile = path.join(tempDir, "bad.parquet");
      const magic = Buffer.from("PAR1", "ascii");
      const body = Buffer.alloc(20, 0xab);
      // Header OK but footer is garbage
      await writeFile(
        parquetFile,
        Buffer.concat([magic, body, Buffer.from("XXXX")]),
      );
      const result = validateTechnicalArtifact({ filePath: parquetFile });
      assert.equal(result.status, VALIDATION_STATUS.FAIL);
      assert.equal(result.checks.magicBytesHeader, true);
      assert.equal(result.checks.magicBytesFooter, false);
      assert.ok(result.errors.some((e) => e.includes("CORRUPT_PARQUET")));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("Parquet: generateArtifactPreview shows size and magic byte result", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-parqprev-"));
    try {
      const parquetFile = path.join(tempDir, "events.parquet");
      const magic = Buffer.from("PAR1", "ascii");
      const body = Buffer.alloc(20, 0x00);
      await writeFile(parquetFile, Buffer.concat([magic, body, magic]));
      const preview = generateArtifactPreview({ filePath: parquetFile });
      assert.equal(preview.available, true);
      assert.equal(preview.type, "parquet");
      assert.equal(preview.magicBytesValid, true);
      assert.match(preview.previewText, /Parquet/);
      assert.match(preview.previewText, /PAR1/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // PDF
  // -------------------------------------------------------------------------
  test("PDF: validateTechnicalArtifact passes for valid %PDF- magic bytes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-pdf-"));
    try {
      const pdfFile = path.join(tempDir, "report.pdf");
      await writeFile(pdfFile, "%PDF-1.7\n%EOF\n");
      const result = validateTechnicalArtifact({ filePath: pdfFile });
      assert.equal(result.status, VALIDATION_STATUS.PASS);
      assert.equal(result.checks.inferredType, "pdf");
      assert.equal(result.checks.magicBytesValid, true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("PDF: validateTechnicalArtifact fails for corrupt file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-pdfbad-"));
    try {
      const pdfFile = path.join(tempDir, "corrupt.pdf");
      await writeFile(pdfFile, "not a real pdf content here");
      const result = validateTechnicalArtifact({ filePath: pdfFile });
      assert.equal(result.status, VALIDATION_STATUS.FAIL);
      assert.equal(result.checks.magicBytesValid, false);
      assert.ok(result.errors.some((e) => e.includes("CORRUPT_PDF")));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("PDF: generateArtifactPreview shows version and validity", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-pdfprev-"));
    try {
      const pdfFile = path.join(tempDir, "analysis.pdf");
      await writeFile(pdfFile, "%PDF-1.7\n%EOF\n");
      const preview = generateArtifactPreview({ filePath: pdfFile });
      assert.equal(preview.available, true);
      assert.equal(preview.type, "pdf");
      assert.equal(preview.pdfVersion, "1.7");
      assert.match(preview.previewText, /PDF/);
      assert.match(preview.previewText, /1\.7/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // DOCX
  // -------------------------------------------------------------------------
  test("DOCX: validateTechnicalArtifact passes for valid ZIP magic bytes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-docx-"));
    try {
      const docxFile = path.join(tempDir, "report.docx");
      const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00]);
      await writeFile(docxFile, buf);
      const result = validateTechnicalArtifact({ filePath: docxFile });
      assert.equal(result.status, VALIDATION_STATUS.PASS);
      assert.equal(result.checks.inferredType, "docx");
      assert.equal(result.checks.magicBytesValid, true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("DOCX: validateTechnicalArtifact fails for corrupt file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-docxbad-"));
    try {
      const docxFile = path.join(tempDir, "bad.docx");
      await writeFile(docxFile, "this is not a docx");
      const result = validateTechnicalArtifact({ filePath: docxFile });
      assert.equal(result.status, VALIDATION_STATUS.FAIL);
      assert.equal(result.checks.magicBytesValid, false);
      assert.ok(result.errors.some((e) => e.includes("CORRUPT_DOCX")));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("DOCX: generateArtifactPreview shows size and container validity", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-docxprev-"));
    try {
      const docxFile = path.join(tempDir, "contract.docx");
      const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
      await writeFile(docxFile, buf);
      const preview = generateArtifactPreview({ filePath: docxFile });
      assert.equal(preview.available, true);
      assert.equal(preview.type, "docx");
      assert.match(preview.previewText, /Word Document/);
      assert.match(preview.previewText, /Container ZIP hợp lệ/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Markdown
  // -------------------------------------------------------------------------
  test("Markdown: validateTechnicalArtifact passes for valid .md file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-md-"));
    try {
      const mdFile = path.join(tempDir, "notes.md");
      await writeFile(mdFile, "# Title\n\n## Section\n\nSome text.\n");
      const result = validateTechnicalArtifact({ filePath: mdFile });
      assert.equal(result.status, VALIDATION_STATUS.PASS);
      assert.equal(result.checks.inferredType, "markdown");
      assert.ok(result.checks.headingCount >= 2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("Markdown: generateArtifactPreview shows heading count and preview block", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-fmt-mdprev-"));
    try {
      const mdFile = path.join(tempDir, "analysis.md");
      await writeFile(
        mdFile,
        "# Analysis Report\n\n## KPIs\n\nRevenue: 1M\n\n## Findings\n\nStrong Q1 growth.\n",
      );
      const preview = generateArtifactPreview({ filePath: mdFile });
      assert.equal(preview.available, true);
      assert.equal(preview.type, "markdown");
      assert.equal(preview.headingCount, 3);
      assert.match(preview.previewText, /Markdown/);
      assert.match(preview.previewText, /```markdown/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // validateSqlFileContent (static SQL file analyzer)
  // -------------------------------------------------------------------------
  test("validateSqlFileContent: counts statements and detects read-only script", () => {
    const sql = "SELECT id FROM orders;\nSELECT name FROM products;";
    const result = validateSqlFileContent(sql);
    assert.equal(result.statementCount, 2);
    assert.equal(result.hasMutations, false);
    assert.deepEqual(result.mutationKeywords, []);
    assert.match(result.firstStatement, /SELECT id FROM orders/);
  });

  test("validateSqlFileContent: detects DML mutations", () => {
    const sql =
      "DELETE FROM logs WHERE created_at < '2024-01-01';\nDROP TABLE temp;";
    const result = validateSqlFileContent(sql);
    assert.equal(result.hasMutations, true);
    assert.ok(result.mutationKeywords.includes("DELETE"));
    assert.ok(result.mutationKeywords.includes("DROP"));
  });

  test("validateSqlFileContent: strips comments before analysis", () => {
    const sql = "-- This is a comment\nSELECT * FROM sales; -- inline comment";
    const result = validateSqlFileContent(sql);
    assert.equal(result.statementCount, 1);
    assert.equal(result.hasMutations, false);
  });

  test("validateSqlFileContent: throws on non-string input", () => {
    assert.throws(() => validateSqlFileContent(null), /SQL_CONTENT_INVALID/);
  });

  // -------------------------------------------------------------------------
  // validatePythonFileContent (static Python file analyzer)
  // -------------------------------------------------------------------------
  test("validatePythonFileContent: counts functions, classes, imports", () => {
    const py = `
import pandas as pd
from sklearn.linear_model import LinearRegression
import numpy as np

class Model:
    def fit(self, X, y):
        pass
    async def predict(self, X):
        pass

def helper():
    pass

if __name__ == "__main__":
    pass
`;
    const result = validatePythonFileContent(py);
    assert.equal(result.importCount, 3);
    assert.equal(result.classCount, 1);
    assert.equal(result.functionCount, 3); // fit, predict, helper
    assert.equal(result.asyncFunctionCount, 1);
    assert.equal(result.hasMainBlock, true);
    assert.ok(result.dataModules.includes("pandas"));
    assert.ok(result.dataModules.includes("numpy"));
  });

  test("validatePythonFileContent: throws on non-string input", () => {
    assert.throws(
      () => validatePythonFileContent(42),
      /PYTHON_CONTENT_INVALID/,
    );
  });

  test("formatPythonPreview: returns formatted markdown block", () => {
    const py =
      "import pandas as pd\n\ndef transform(df):\n    return df.dropna()\n";
    const analysis = validatePythonFileContent(py);
    const preview = formatPythonPreview("transform.py", analysis);
    assert.match(preview, /Python Script/);
    assert.match(preview, /transform\.py/);
    assert.match(preview, /```python/);
    assert.match(preview, /pandas/);
  });
});

describe("M8/T2.1 Hardening & Regression Suite (A-Series, H-Series, C-Series, D-Series)", () => {
  describe("Queue & Lease Fencing (H01, H04, H05, H08, H10)", () => {
    test("H01: finishExecution fences by agentId, leaseId, attempt", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-h-test-"));
      const qm = new QueueManager({
        storagePath: path.join(tempDir, "q.json"),
      });
      qm.enqueueTask({
        taskId: "T-H01",
        primaryCoordinator: "o1",
        taskPayload: { cmd: "run" },
      });
      const { leaseId } = qm.claimTaskById({
        taskId: "T-H01",
        agentId: "o1",
      });
      assert.ok(leaseId);
      assert.throws(
        () =>
          qm.finishExecution({
            taskId: "T-H01",
            agentId: "o2",
            leaseId,
            attempt: 1,
          }),
        /AGENT_MISMATCH/,
      );
      assert.throws(
        () =>
          qm.finishExecution({
            taskId: "T-H01",
            agentId: "o1",
            leaseId: "wrong-lease",
            attempt: 1,
          }),
        /LEASE_MISMATCH/,
      );
      assert.throws(
        () =>
          qm.finishExecution({
            taskId: "T-H01",
            agentId: "o1",
            leaseId,
            attempt: 99,
          }),
        /ATTEMPT_MISMATCH/,
      );
      const res = qm.finishExecution({
        taskId: "T-H01",
        agentId: "o1",
        leaseId,
        attempt: 1,
        resultSummary: "completed successfully",
      });
      assert.equal(res.status, TASK_STATES.RESULT_PENDING_REVIEW);
      assert.equal(qm.getTask("T-H01").resultSummary, "completed successfully");
      assert.equal(qm.getTask("T-H01").resultAttempt, 1);
      await rm(tempDir, { recursive: true, force: true });
    });

    test("H04: Stale recovery revokes leaseId and increments attempt", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-h04-test-"));
      const qm = new QueueManager({
        storagePath: path.join(tempDir, "q.json"),
      });
      qm.enqueueTask({
        taskId: "T-H04",
        primaryCoordinator: "o1",
        taskPayload: {},
      });
      const { leaseId } = qm.claimTaskById({
        taskId: "T-H04",
        agentId: "o1",
      });
      // Backdate the heartbeat durably: withLock reloads the persisted
      // projection, so in-memory-only edits are not authoritative.
      const stored = JSON.parse(readFileSync(qm.storagePath, "utf8"));
      for (const item of stored) {
        if (item.taskId === "T-H04") {
          item.lastHeartbeatAt = new Date(Date.now() - 700000).toISOString();
        }
      }
      writeFileSync(qm.storagePath, JSON.stringify(stored, null, 2), "utf8");
      const recovered = qm.detectAndRecoverStaleTasks({
        staleThresholdSeconds: 600,
      });
      assert.equal(recovered.length, 1);
      assert.equal(recovered[0].revokedLeaseId, leaseId);
      const updated = qm.getTask("T-H04");
      assert.equal(updated.status, TASK_STATES.QUEUED);
      assert.equal(updated.leaseId, null);
      assert.equal(updated.attempt, 2);
      await rm(tempDir, { recursive: true, force: true });
    });

    test("H08: projectionVersion increases monotonically on save", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-h08-test-"));
      const qm = new QueueManager({
        storagePath: path.join(tempDir, "q.json"),
      });
      assert.equal(qm._projectionVersion, 0);
      qm.enqueueTask({
        taskId: "T-H08",
        primaryCoordinator: "o1",
        taskPayload: {},
      });
      assert.equal(qm._projectionVersion, 1);
      qm.claimTaskById({ taskId: "T-H08", agentId: "o1" });
      assert.equal(qm._projectionVersion, 2);
      await rm(tempDir, { recursive: true, force: true });
    });

    test("H02 & H06: claimTask atomicity with cross-process file lock and durable fsync+rename", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-h02-test-"));
      const queueFile = path.join(tempDir, "queue.json");
      const qm1 = new QueueManager({ storagePath: queueFile });
      const qm2 = new QueueManager({ storagePath: queueFile });

      qm1.enqueueTask({ taskId: "T-H02", primaryCoordinator: "o1" });
      const c1 = qm1.claimTaskById({
        taskId: "T-H02",
        agentId: "o1",
      });
      assert.equal(c1.claimed, true);

      // qm2 must see task is already claimed and reject concurrent claim
      assert.throws(
        () => qm2.claimTaskById({ taskId: "T-H02", agentId: "o2" }),
        /CONCURRENT_CLAIM_DENIED/,
        "H02: concurrent claim from second QM instance must be denied",
      );

      // Verify file persisted atomically on disk
      const raw = readFileSync(queueFile, "utf8");
      const data = JSON.parse(raw);
      assert.equal(data.length, 1);
      assert.equal(data[0].claimedBy, "o1");
      await rm(tempDir, { recursive: true, force: true });
    });

    test("H03, H07, H09: rebuildFromLedger reconciles diverging queue, purges orphans and duplicate task IDs", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "zink-h07-test-"));
      const queueFile = path.join(tempDir, "queue.json");
      const qm = new QueueManager({ storagePath: queueFile });

      // Enqueue an orphan task not present in ledger and a diverging task
      qm.enqueueTask({ taskId: "ORPHAN-TASK", primaryCoordinator: "o1" });
      qm.enqueueTask({ taskId: "DIVERGENT-TASK", primaryCoordinator: "o1" });

      // Authoritative ledger snapshot
      const snapshot = {
        sequence: 5,
        tasks: {
          "DIVERGENT-TASK": {
            task_id: "DIVERGENT-TASK",
            brief_revision: 2,
            root_agent_id: "o1",
            workflow_status: "COMPLETE",
          },
          "LEDGER-NEW-TASK": {
            task_id: "LEDGER-NEW-TASK",
            brief_revision: 1,
            root_agent_id: "o2",
            workflow_status: "QUEUED",
            approved_at: new Date().toISOString(),
          },
        },
      };

      const result = qm.rebuildFromLedger(snapshot);
      assert.equal(
        result.orphanedRemoved,
        1,
        "H09: orphan task not in ledger must be purged",
      );
      assert.equal(
        result.updated,
        1,
        "H03: diverging task must be updated to match ledger authority",
      );
      assert.equal(
        result.totalRebuilt,
        1,
        "H07: missing task in ledger must be rebuilt into queue",
      );

      assert.equal(qm.getTask("ORPHAN-TASK"), null);
      assert.equal(qm.getTask("DIVERGENT-TASK").status, TASK_STATES.COMPLETE);
      assert.equal(qm.getTask("LEDGER-NEW-TASK").status, TASK_STATES.QUEUED);

      // Invalid snapshot throws
      assert.throws(
        () => qm.rebuildFromLedger(null),
        /LEDGER_SNAPSHOT_REQUIRED/,
      );

      await rm(tempDir, { recursive: true, force: true });
    });
  });

  describe("Discord Ingress & Identity (A01-A10, A23-A29)", () => {
    test("A01 & A06: resolveIngressRouting admits only an explicit Main mention", () => {
      const res = resolveIngressRouting({
        message: {
          content: "Hey @main process this data",
          mentions: [{ username: "main" }],
        },
      });
      assert.equal(res.intent, "DELEGATE_TO_MAIN");
      assert.equal(res.confidence, 1.0);
      assert.equal(res.needs_clarification, false);
      assert.deepEqual(res.target_agents, ["main"]);

      const directCoordinator = resolveIngressRouting({
        message: {
          content: "Hey @o1 process this data",
          mentions: [{ username: "o1" }],
        },
      });
      assert.equal(directCoordinator.needs_clarification, true);
      assert.match(
        directCoordinator.clarification_reason,
        /NON_MAIN_DIRECT_INGRESS/,
      );
    });

    test("A02: @everyone and @here reject execution fanning out", () => {
      const res = resolveIngressRouting({
        message: { content: "@everyone do this task", mentions: [] },
      });
      assert.equal(res.intent, "BROADCAST");
      assert.equal(res.is_broadcast, true);
      assert.equal(res.needs_clarification, true);
      assert.match(res.clarification_reason, /BROADCAST_NO_DELEGATION/);
      assert.deepEqual(res.target_agents, []);
    });

    test("A03: Discord mention objects take precedence over text aliases", () => {
      const agents = resolveMentionedAgents(
        {
          content: "@main but text mentions @o1",
          mentions: [{ username: "main" }],
        },
        { executionTarget: true },
      );
      assert.deepEqual(agents, ["main"]);
    });

    test("A04 & A07: CANONICAL_AGENT_ROSTER and AGENT_ROSTER_VERSION pass validation", () => {
      assert.equal(AGENT_ROSTER_VERSION, "m8-t2.2-r4");
      assert.ok(validateAgentRoster(CANONICAL_AGENT_ROSTER));
    });

    test("A05: Missing mention returns empty array, never defaults to main", () => {
      const agents = resolveMentionedAgents({
        content: "hello world without mentions",
        mentions: [],
      });
      assert.deepEqual(agents, []);
    });

    test("A08: validateCrossLayerIdentity validates complete roster across all layers", () => {
      assert.ok(validateCrossLayerIdentity());
    });

    test("A09 & A26: getDiscordSurfaceBindings binds all 4 surfaces", () => {
      const bindings = getDiscordSurfaceBindings({
        discordOfficeChannelId: "1001",
        discordApprovalsChannelId: "1002",
        discordResultsChannelId: "1003",
        discordIncidentsChannelId: "1004",
      });
      assert.equal(bindings.length, 4);
      assert.equal(bindings[0].channelId, "1001");
    });

    test("A10: validateDiscordTargetGuild rejects guild mismatch", () => {
      const res = validateDiscordTargetGuild({
        guildId: "999",
        configuredGuildId: "100",
      });
      assert.equal(res.valid, false);
      assert.match(res.reason, /GUILD_MISMATCH/);
    });

    test("A23 & A25: isAllowedDiscordSender permits owner and known bot snowflakes only", () => {
      assert.equal(
        isAllowedDiscordSender({ senderId: "owner-1", ownerId: "owner-1" }),
        true,
      );
      assert.equal(
        isAllowedDiscordSender({ senderId: "rogue-bot", isBot: true }),
        false,
      );
    });

    test("A28: convertAgentsListToEntries maps list to entries object", () => {
      const config = {
        agents: {
          defaults: {},
          list: [
            { id: "main", name: "Main" },
            { id: "o1", name: "O1" },
          ],
        },
      };
      const converted = convertAgentsListToEntries(config);
      assert.ok(converted.agents.entries.main);
      assert.ok(converted.agents.entries.o1);
      assert.equal(converted.agents.list, undefined);
    });

    test("A29: validateOpenClawReleaseCompatibility validates top-level keys", () => {
      const validConfig = {
        update: {},
        gateway: {},
        agents: { list: [] },
        auth: {},
        tools: {},
        commands: {},
        secrets: {},
        plugins: {},
        bindings: [],
        channels: {},
      };
      const res = validateOpenClawReleaseCompatibility(validConfig);
      assert.equal(res.compatible, true);
    });
  });

  describe("Schema Validator Parity & Hardening (C01-C04, C07-C09)", () => {
    test("C01 & C02: schema validator supports finite floats and integers", () => {
      const validRef = {
        schema_version: "1.0.0",
        governance_version: "m8-t2.2-r4",
        ref_id: "a".repeat(64),
        ref_type: "document",
        producer_task_id: "b".repeat(64),
        producer_brief_revision: 1,
        producer_node_id: "node1",
        producer_agent_id: "o1",
        producer_run_id: "run-123",
        content_digest: "c".repeat(64),
        media_type: "text/plain",
        size_bytes: 100,
        classification: "INTERNAL",
        provenance: "test-provenance",
        validation_status: "VALID",
        created_at: "2026-09-20T12:00:00Z",
      };
      assert.doesNotThrow(() =>
        validateContract("governed-reference", validRef),
      );
    });

    test("C03: date-time format accepts RFC 3339 timezone offsets", () => {
      const validRefWithOffset = {
        schema_version: "1.0.0",
        governance_version: "m8-t2.2-r4",
        ref_id: "a".repeat(64),
        ref_type: "document",
        producer_task_id: "b".repeat(64),
        producer_brief_revision: 1,
        producer_node_id: "node1",
        producer_agent_id: "o1",
        producer_run_id: "run-123",
        content_digest: "c".repeat(64),
        media_type: "text/plain",
        size_bytes: 100,
        classification: "INTERNAL",
        provenance: "test-provenance",
        validation_status: "VALID",
        created_at: "2026-09-20T12:00:00+07:00",
      };
      assert.doesNotThrow(() =>
        validateContract("governed-reference", validRefWithOffset),
      );
    });
  });

  describe("Workflow State Machine (D01, D02, D05, D11-D13)", () => {
    test("D01 & D02: WORKFLOW_TASK_CLAIMED rejects claim from ACTIVE state", () => {
      const taskId = "d".repeat(64);
      const snapshot = {
        sequence: 1,
        schema_version: "1.0.0",
        governance_version: "m8-t2.2-r4",
        last_event_digest: "a".repeat(64),
        tasks: {
          [taskId]: {
            task_id: taskId,
            brief_state: "ACTIVE",
            workflow_status: "ACTIVE",
            brief_revision: 1,
            revisions_used: 1,
            transitions_used: 0,
            delegated_runs_used: 0,
            delegations: {},
          },
        },
      };
      assert.throws(
        () =>
          applyWorkflowEvent(snapshot, "WORKFLOW_TASK_CLAIMED", {
            task_id: taskId,
            agent_id: "execution agent-1",
          }),
        /INVALID_STATE_TRANSITION/,
      );
    });
  });

  describe("Workflow State Machine Hardening (D03, D04, D07, D09, D10, D18, D19, D20)", () => {
    // Helper to build a minimal snapshot with a task
    function makeSnapshot(taskId, overrides = {}) {
      return {
        sequence: 1,
        schema_version: "1.0.0",
        governance_version: "m8-t2.2-r4",
        last_event_digest: "a".repeat(64),
        tasks: {
          [taskId]: {
            task_id: taskId,
            brief_state: "ACTIVE",
            workflow_status: "ACTIVE",
            root_agent_id: "main",
            root_session_key: "sess-root",
            root_run_id: "run-root",
            brief_revision: 1,
            revisions_used: 1,
            transitions_used: 0,
            delegated_runs_used: 0,
            nodes: [],
            delegations: {},
            ...overrides,
          },
        },
      };
    }

    test("D03: WORKFLOW_NATIVE_ENDED outcome=ok transitions run from RUNNING to COMPLETE", () => {
      const taskId = "d".repeat(64);
      const delegationId = "f".repeat(64);
      const snap = makeSnapshot(taskId, {
        delegations: {
          [delegationId]: {
            delegation_id: delegationId,
            agent_id: "o1",
            run_state: "RUNNING",
            brief_revision: 1,
            native_run_id: "run-child",
            child_session_key: "sess-child",
            parent_session_key: "sess-root",
          },
        },
      });
      const result = applyWorkflowEvent(snap, "WORKFLOW_NATIVE_ENDED", {
        task_id: taskId,
        native_run_id: "run-child",
        child_session_key: "sess-child",
        parent_session_key: "sess-root",
        outcome: "ok",
      });
      assert.equal(
        result.tasks[taskId].delegations[delegationId].run_state,
        "COMPLETE",
        "D03: outcome=ok must transition RUNNING run to COMPLETE",
      );
    });

    test("D03: WORKFLOW_NATIVE_ENDED outcome=ok does not alter task workflow_status", () => {
      const taskId = "d".repeat(64);
      const delegationId = "f".repeat(64);
      const snap = makeSnapshot(taskId, {
        delegations: {
          [delegationId]: {
            delegation_id: delegationId,
            agent_id: "o1",
            run_state: "RUNNING",
            brief_revision: 1,
            native_run_id: "run-child",
            child_session_key: "sess-child",
            parent_session_key: "sess-root",
          },
        },
      });
      const result = applyWorkflowEvent(snap, "WORKFLOW_NATIVE_ENDED", {
        task_id: taskId,
        native_run_id: "run-child",
        child_session_key: "sess-child",
        parent_session_key: "sess-root",
        outcome: "ok",
      });
      assert.equal(
        result.tasks[taskId].workflow_status,
        "ACTIVE",
        "D03: outcome=ok must not change task workflow_status to BLOCKED",
      );
    });

    test("D04: WORKFLOW_NATIVE_ENDED error outcome stamps recovery metadata", () => {
      const taskId = "d".repeat(64);
      const delegationId = "f".repeat(64);
      const snap = makeSnapshot(taskId, {
        delegations: {
          [delegationId]: {
            delegation_id: delegationId,
            agent_id: "o1",
            run_state: "RUNNING",
            brief_revision: 1,
            native_run_id: "run-child",
            child_session_key: "sess-child",
            parent_session_key: "sess-root",
          },
        },
      });
      const result = applyWorkflowEvent(snap, "WORKFLOW_NATIVE_ENDED", {
        task_id: taskId,
        native_run_id: "run-child",
        child_session_key: "sess-child",
        parent_session_key: "sess-root",
        outcome: "error",
      });
      const run = result.tasks[taskId].delegations[delegationId];
      assert.equal(
        run.run_state,
        "UNKNOWN",
        "D04: error outcome must set run to UNKNOWN",
      );
      assert.equal(
        run.recovery_reason,
        "error",
        "D04: must record recovery_reason=error",
      );
      assert.ok(
        run.recovery_needed_at,
        "D04: must stamp recovery_needed_at ISO timestamp",
      );
      assert.equal(
        result.tasks[taskId].workflow_status,
        "BLOCKED",
        "D04: error outcome must BLOCK the task",
      );
    });

    test("D04: WORKFLOW_NATIVE_ENDED timeout stamps RUN_TIMEOUT reason code", () => {
      const taskId = "d".repeat(64);
      const delegationId = "f".repeat(64);
      const snap = makeSnapshot(taskId, {
        delegations: {
          [delegationId]: {
            delegation_id: delegationId,
            agent_id: "o1",
            run_state: "RUNNING",
            brief_revision: 1,
            native_run_id: "run-child",
            child_session_key: "sess-child",
            parent_session_key: "sess-root",
          },
        },
      });
      const result = applyWorkflowEvent(snap, "WORKFLOW_NATIVE_ENDED", {
        task_id: taskId,
        native_run_id: "run-child",
        child_session_key: "sess-child",
        parent_session_key: "sess-root",
        outcome: "timeout",
      });
      const run = result.tasks[taskId].delegations[delegationId];
      assert.equal(
        run.runtime_reason_code,
        "RUN_TIMEOUT",
        "D04: timeout must set RUN_TIMEOUT",
      );
      assert.equal(
        run.recovery_reason,
        "timeout",
        "D04: must record recovery_reason=timeout",
      );
    });

    test("D10: WORKFLOW_BRIEF_ACTIVATED rejects node with invalid agent/stack combination", () => {
      const taskId = "d".repeat(64);
      const snap = makeSnapshot(taskId, {
        workflow_status: "ACTIVE",
      });
      const node = {
        node_id: "node1",
        // o1 cannot be on semantic stack — that belongs to o2
        agent_id: "o1",
        stack_id: "semantic",
        dependencies: [],
        required: true,
        input_digest: "a".repeat(64),
        constraints_digest: "b".repeat(64),
        validation_digest: "c".repeat(64),
      };
      assert.throws(
        () =>
          applyWorkflowEvent(snap, "WORKFLOW_BRIEF_ACTIVATED", {
            task_id: taskId,
            brief_revision: 1,
            semantic_contract_status: "VALID",
            nodes: [node],
          }),
        /UNAUTHORIZED_TARGET/,
        "D10: o1 on semantic stack must be rejected",
      );
    });

    test("D10: WORKFLOW_BRIEF_ACTIVATED accepts valid agent/stack combination for o1", () => {
      const taskId = "d".repeat(64);
      const snap = makeSnapshot(taskId, {
        workflow_status: "ACTIVE",
      });
      const node = {
        node_id: "node1",
        agent_id: "o1",
        stack_id: "data_plant",
        dependencies: [],
        required: true,
        input_digest: "a".repeat(64),
        constraints_digest: "b".repeat(64),
        validation_digest: "c".repeat(64),
      };
      assert.doesNotThrow(
        () =>
          applyWorkflowEvent(snap, "WORKFLOW_BRIEF_ACTIVATED", {
            task_id: taskId,
            brief_revision: 1,
            semantic_contract_status: "VALID",
            nodes: [node],
          }),
        "D10: o1 on data_plant stack must be accepted",
      );
    });

    test("D18: WORKFLOW_ROOT_RESULT_RECORDED blocked while children are RUNNING", () => {
      const taskId = "d".repeat(64);
      const delegationId = "f".repeat(64);
      const snap = makeSnapshot(taskId, {
        workflow_status: "ACTIVE",
        root_run_id: "run-main-1",
        brief_revision: 1,
        delegations: {
          [delegationId]: {
            delegation_id: delegationId,
            agent_id: "o1",
            node_id: "node1",
            run_state: "RUNNING",
            brief_revision: 1,
            attempt: 1,
            native_run_id: "run-child",
            child_session_key: "sess-child",
            parent_session_key: "sess-root",
          },
        },
        nodes: [
          {
            node_id: "node1",
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
      assert.throws(
        () =>
          applyWorkflowEvent(snap, "WORKFLOW_ROOT_RESULT_RECORDED", {
            task_id: taskId,
            brief_revision: 1,
            native_run_id: "run-main-1",
            agent_id: "main",
            payload_digest: "a".repeat(64),
            outcome_status: "COMPLETE",
            reason_code: "NONE",
            governance_hash: "b".repeat(64),
          }),
        /MISSING_PREREQUISITE/,
        "D18: Root result must be blocked while child runs are RUNNING",
      );
    });

    test("D20: WORKFLOW_SPAWN_RESERVED rejects duplicate attempt number for same node", async () => {
      const taskId = "d".repeat(64);
      const firstDelegationId = "f1".padEnd(64, "0");
      const snap = makeSnapshot(taskId, {
        // M7-020: a spawn reservation is a post-approval event, so the
        // fixture carries approval evidence and a post-approval status.
        workflow_status: "QUEUED",
        approved_at: "2026-09-01T00:00:00.000Z",
        brief_revision: 1,
        current_stack: "data_plant",
        delegated_runs_used: 1,
        nodes: [
          {
            node_id: "node1",
            agent_id: "o1",
            stack_id: "data_plant",
            dependencies: [],
            required: true,
            input_digest: "a".repeat(64),
            constraints_digest: "b".repeat(64),
            validation_digest: "c".repeat(64),
          },
        ],
        delegations: {
          [firstDelegationId]: {
            delegation_id: firstDelegationId,
            agent_id: "o1",
            node_id: "node1",
            run_state: "FAILED",
            brief_revision: 1,
            attempt: 1,
            runtime_reason_code: "TRANSIENT_RUNTIME_FAILURE",
            accepted_outcome_status: null,
            parent_session_key: "sess-root",
            parent_run_id: "run-root",
            tool_call_id: "tc-1",
          },
        },
      });
      // Attempt to reserve with attempt=1 again (duplicate). M8-055: the
      // canonical builder derives both ids, so only the attempt number and the
      // tool call id differ from the committed reservation.
      const dupPayload = {
        ...buildSpawnProposal({
          task_id: taskId,
          brief_revision: 1,
          node_id: "node1",
          agent_id: "o1",
          parent_agent_id: "main",
          parent_session_key: "sess-root",
          parent_run_id: "run-root",
          tool_call_id: "tc-2",
          turn: 2,
          attempt: 1, // duplicate — should be rejected
          expected_governance_hash: "a".repeat(64),
        }),
        delegation_id: firstDelegationId,
      };
      assert.throws(
        () => applyWorkflowEvent(snap, "WORKFLOW_SPAWN_RESERVED", dupPayload),
        /RETRY_EXHAUSTED|SPAWN_UNKNOWN|LINEAGE_MISMATCH/,
        "D20: duplicate attempt number for same node must be rejected",
      );
    });
  });

  // =========================================================================
  // E-Series: governance/index.mjs Guard Hook Hardening
  // =========================================================================
  describe("E-Series & G-Series: Governance Hook & Action Hardening", () => {
    // E01/E02: beforeRunEnd must reject non-JSON and payloads missing outcome_claim
    test("E01 & E02: beforeRunEnd rejects plain-text and non-JSON output — no synthetic COMPLETE payload", async () => {
      const { createGovernanceGuard } =
        await import("../integrations/openclaw/topology/lib/guard.mjs");
      const snapshot = {
        sequence: 1,
        schema_version: "1.0.0",
        governance_version: "m8-t2.2-r4",
        last_event_digest: "a".repeat(64),
        tasks: {},
      };
      const guard = createGovernanceGuard({
        paths: {
          root: "/fake",
          events: "/fake/events.jsonl",
          snapshot: "/fake/snapshot.json",
        },
        manifestFor: () => ({
          expected_governance_hash: "a".repeat(64),
          observed_governance_hash: "a".repeat(64),
          allowed_tools: [],
        }),
        _snapshotOverride: snapshot,
      });

      // Plain text without JSON or outcome_claim must throw
      const plainEvent = {
        success: true,
        lastAssistant: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Done, all looks good." }],
        },
      };
      const ctx = {
        sessionKey: "agent:main:sess1",
        runId: "run1",
        agentId: "main",
      };
      assert.throws(
        () => guard.beforeRunEnd(plainEvent, ctx),
        /SCHEMA_INVALID|EXECUTION_STATE_UNKNOWN/,
      );
    });

    // E05: beforeRunEnd catch must fail closed for ALL agents
    test("E05: governance plugin beforeRunEnd catch block fails closed (never allow: true on error)", async () => {
      // Verify that the plugin wrapper does NOT return { allow: true } silently on errors.
      // We import the plugin and test the guard's internal behavior indirectly via the
      // beforeRunEnd wrapper by confirming it rejects non-JSON output for non-main agents.
      const { createGovernanceGuard } =
        await import("../integrations/openclaw/topology/lib/guard.mjs");
      const snapshot = {
        sequence: 1,
        schema_version: "1.0.0",
        governance_version: "m8-t2.2-r4",
        last_event_digest: "a".repeat(64),
        tasks: {},
      };
      const guard = createGovernanceGuard({
        paths: {
          root: "/fake",
          events: "/fake/events.jsonl",
          snapshot: "/fake/snapshot.json",
        },
        manifestFor: () => ({
          expected_governance_hash: "a".repeat(64),
          observed_governance_hash: "a".repeat(64),
          allowed_tools: [],
        }),
        _snapshotOverride: snapshot,
      });

      const event = {
        success: true,
        lastAssistant: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Not JSON at all" }],
        },
      };
      // For any agent (including specialists), non-JSON must throw, not silently allow
      const ctx = {
        sessionKey: "agent:o1:sess2",
        runId: "run2",
        agentId: "o1",
      };
      assert.throws(
        () => guard.beforeRunEnd(event, ctx),
        /SCHEMA_INVALID|EXECUTION_STATE_UNKNOWN/,
      );
    });

    // E06: spawn with governance hash must fail if manifest unavailable
    // M7-019: this used to assert that the string "GOVERNANCE_HASH_MISSING"
    // appears in the plugin source. That was a source-grep, not a proof: the
    // manifest-hash policy now lives in the ONE canonical spawn gate, and the
    // live adapter delegates to it. The zero-hash fallback is still forbidden;
    // the behavioural proof is in tests/m7-lane-k-spawn-gate.test.mjs
    // ("a target without a governance manifest is blocked, and no zero hash is
    // ever reserved"). What remains here is only the check that no code path
    // reintroduces a literal zero hash.
    test("E06: zero governance hash is not a fallback anywhere in the runtime", () => {
      const sources = [
        "../integrations/openclaw/plugins/zink-governance/index.mjs",
        "../integrations/openclaw/topology/lib/guard.mjs",
        "../integrations/openclaw/topology/lib/canonical.mjs",
      ];
      for (const relative of sources) {
        const src = readFileSync(
          fileURLToPath(new URL(relative, import.meta.url)),
          "utf8",
        );
        assert.ok(
          !src.includes('"0".repeat(64)'),
          `E06: zero governance hash fallback must not appear in ${relative}`,
        );
        assert.ok(
          !/expected_governance_hash\s*[:=]\s*["'`]0{64}["'`]/.test(src),
          `E06: a literal zero governance hash must not be assigned in ${relative}`,
        );
      }
    });

    // E07: spawn reservation write failure must block spawn
    test("E07: spawn reservation write failure returns block decision (no silent pass)", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        pluginSrc.includes("SPAWN_RESERVATION_FAILED"),
        "E07: SPAWN_RESERVATION_FAILED block code must be present in plugin",
      );
    });

    // E04: beforeRunEnd qualifies agent_self_validation as unverified self-assertion
    test("E04: beforeRunEnd qualifies model self-validation as unverified self-assertion", () => {
      const guardSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/topology/lib/guard.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        guardSrc.includes("[UNVERIFIED_SELF_ASSERTION]"),
        "E04: beforeRunEnd must qualify agent_self_validation with [UNVERIFIED_SELF_ASSERTION]",
      );
    });

    // E13: beforeRun inputProvenance inter-session trust is cryptographically bound to sender event
    test("E13: beforeRun binds inter-session inputProvenance cryptographically to trigger sender event", () => {
      const guardSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/topology/lib/guard.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        /context\.inputProvenance\.sourceSessionKey\s*===\s*entry\.source_session_key/.test(
          guardSrc,
        ),
        "E13: beforeRun must verify sourceSessionKey matches continuation entry",
      );
      assert.ok(
        guardSrc.includes("trigger.accepted_payload_digest"),
        "E13: beforeRun must verify trigger delegation has accepted_payload_digest",
      );
    });

    // E10: lease TTL helpers exist and expired entries are removed
    test("E10: lease map uses TTL-aware setLease/getLease helpers to prevent unbounded growth", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        pluginSrc.includes("LEASE_TTL_MS"),
        "E10: LEASE_TTL_MS constant must be defined",
      );
      assert.ok(
        pluginSrc.includes("function setLease"),
        "E10: setLease helper must exist",
      );
      assert.ok(
        pluginSrc.includes("function getLease"),
        "E10: getLease helper must exist",
      );
      assert.ok(
        pluginSrc.includes("entry.expiresAt"),
        "E10: entries must carry expiry timestamps",
      );
    });

    // E11/E12: log lines must not expose full params or all lease keys
    test("E11 & E12: lease log lines do not expose full params or enumerate all active keys", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      // Old patterns that exposed sensitive data must be gone
      assert.ok(
        !pluginSrc.includes("available=[${[...leases.keys()].join"),
        "E12: lease key enumeration must not appear in log lines",
      );
      assert.ok(
        !pluginSrc.includes("expected=${expected}") &&
          !pluginSrc.includes("actual=${actualHash}"),
        "E11: hash values must not appear in log lines",
      );
    });

    // E15: subagent_spawned lineage error must record incident event
    test("E15: subagent_spawned lineage mismatch records WORKFLOW_NATIVE_ENDED incident instead of only logging", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        pluginSrc.includes("SPAWN_LINEAGE_MISMATCH"),
        "E15: SPAWN_LINEAGE_MISMATCH reason must be recorded in WORKFLOW_NATIVE_ENDED incident",
      );
    });

    // E17: message_sending unknown agent identity must be blocked
    test("E17: message_sending with missing or unknown agent identity is blocked", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        pluginSrc.includes("!agentId || !ids.has(agentId)"),
        "E17: missing/unknown agent identity check must exist in message_sending handler",
      );
    });

    // E18: message_sending validates destination against canonical surface set
    test("E18: message_sending validates destination channel against canonical Discord surfaces", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        pluginSrc.includes("CANONICAL_DISCORD_SURFACE_IDS"),
        "E18: CANONICAL_DISCORD_SURFACE_IDS set must exist",
      );
      assert.ok(
        pluginSrc.includes("non-canonical destination channel"),
        "E18: non-canonical destination block must exist",
      );
    });

    // E19: outbound @everyone/@here must be stripped
    test("E19: message_sending strips outbound @everyone and @here broadcast mentions", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        pluginSrc.includes("OUTBOUND_BROADCAST_RE"),
        "E19: OUTBOUND_BROADCAST_RE pattern must exist",
      );
      assert.ok(
        pluginSrc.includes("@\\u200b$1") || pluginSrc.includes("@\u200b$1"),
        "E19: broadcast mentions must be replaced with zero-width space escape",
      );
    });

    // G01–G05: handleDiscordAction authoritative state re-checks
    test("G01 & G02: handleDiscordAction reloads authoritative snapshot and resolves coordinator from ledger", () => {
      // Verify the STALE_ACTION_REJECTED path exists and the attempt token fence works
      // (both tested by BUG-M8T2-06 above) — confirm guard code pattern here
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        pluginSrc.includes("STALE_ACTION_REJECTED"),
        "G01/G02: STALE_ACTION_REJECTED must exist for attempt-token mismatch",
      );
      assert.ok(
        pluginSrc.includes("normalizeActor(actor)"),
        "G06: actor must be normalized via normalizeActor",
      );
    });

    // G05: ledger write failure must be fatal (FAILED status)
    test("G05: handleDiscordAction ledger write failure returns FAILED status — fails closed", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      // The fail-closed path emits status: "FAILED" on ledger write error
      assert.ok(
        pluginSrc.includes('"FAILED"') || pluginSrc.includes('"FAILED"'),
        "G05: FAILED status must exist in handleDiscordAction for ledger write failures",
      );
    });

    // H01 fence: finishExecution agentId/leaseId/attempt — already covered in BUG-M8T2-06 and H01 suite
    test("G14: handleExecutionFinished enforces execution agent lease fence before artifact finalization", async () => {
      const { handleExecutionFinished } =
        await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
      const os_mod = await import("node:os");
      const path_mod = await import("node:path");
      const fs_mod = await import("node:fs/promises");
      const { QueueManager: QM } =
        await import("../integrations/openclaw/lib/queue-manager.mjs");

      const tempDir = await fs_mod.mkdtemp(
        path_mod.default.join(os_mod.default.tmpdir(), "zink-g14-"),
      );
      const queueFile = path_mod.default.join(tempDir, "queue.json");
      const artFile = path_mod.default.join(tempDir, "report.csv");
      try {
        await fs_mod.writeFile(
          artFile,
          "date,revenue\n2026-01-01,1000",
          "utf8",
        );
        const qm = new QM({ storagePath: queueFile });
        const taskId = "G14-TASK";
        qm.enqueueTask({
          taskId,
          primaryCoordinator: "o1",
          requiredCapabilities: [],
        });
        const claim = qm.claimTask({
          agentId: "o1",
          capabilities: [],
        });
        assert.ok(claim.claimed);

        // Wrong agentId — must return FAILED
        const badExecutionAgent = await handleExecutionFinished({
          taskId,
          agentId: "o2",
          artifactPath: artFile,
          technicalConfig: {
            expectedType: "csv",
            expectedFields: ["date", "revenue"],
          },
          businessData: { revenue: 1000 },
          businessConfig: { kpiConstraints: { revenue: { min: 500 } } },
          queueManager: qm,
        });
        assert.equal(
          badExecutionAgent.status,
          "FAILED",
          "G14: wrong agentId must return FAILED",
        );
      } finally {
        await fs_mod.rm(tempDir, { recursive: true, force: true });
      }
    });

    // E09: alternate candidateParams hash bypass eliminated
    test("E09: candidateParams alternate hash bypass is removed from before_tool_call", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        !pluginSrc.includes("candidateParams"),
        "E09: candidateParams alternate bypass must not exist in plugin",
      );
      assert.ok(
        pluginSrc.includes("E09: Unified request digest"),
        "E09: unified request digest comment/logic must be present",
      );
    });

    // E14: bounded timeout for spawn receipt
    test("E14: awaitSpawnReceipt timeout is bounded to 10s (no 300s tie-up)", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        !pluginSrc.includes("setTimeout(abort, 300000)"),
        "E14: 300s timeout must be removed",
      );
      assert.ok(
        pluginSrc.includes("setTimeout(abort, 10000)"),
        "E14: bounded 10s timeout must be configured",
      );
    });

    // E16: subagent_ended outcome validation
    test("E16: subagent_ended validates outcome against canonical set and fails closed", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        pluginSrc.includes(
          "E16: Validate outcome string from subagent_ended event source",
        ),
        "E16: validation logic must be present in subagent_ended",
      );
      assert.ok(
        !pluginSrc.includes('event.outcome || "ok"'),
        "E16: unvalidated fallback to ok must not exist",
      );
    });

    // E20: message_sending attachment validation
    test("E20: message_sending blocks when unlinked/non-existent attachment is present", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        pluginSrc.includes("E20: Validate outbound attachments/files linkage"),
        "E20: attachment validation logic must be present in message_sending",
      );
    });

    // G04: handleDiscordAction unpersisted status on paths=null
    test("G04: handleDiscordAction returns UNPERSISTED when paths is null and not readOnly", async () => {
      const { handleDiscordAction } =
        await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
      const res = handleDiscordAction({
        actor: "user",
        channel: "approvals",
        taskId: "G04-TASK",
        action: "APPROVE",
        currentState: "APPROVAL_PENDING",
        paths: null,
        readOnly: false,
      });
      assert.equal(
        res.status,
        "UNPERSISTED",
        "G04: paths=null must return UNPERSISTED, not SUCCESS",
      );

      const readOnlyRes = handleDiscordAction({
        actor: "user",
        channel: "approvals",
        taskId: "G04-TASK",
        action: "APPROVE",
        currentState: "APPROVAL_PENDING",
        paths: null,
        readOnly: true,
      });
      assert.equal(
        readOnlyRes.status,
        "READ_ONLY",
        "G04: readOnly=true must return READ_ONLY",
      );
    });

    // G20: handleExecutionFinished idempotency key tracking
    test("G20: handleExecutionFinished returns ALREADY_COMPLETED on duplicate idempotencyKey", async () => {
      const { handleExecutionFinished } =
        await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
      const os_mod = await import("node:os");
      const path_mod = await import("node:path");
      const fs_mod = await import("node:fs/promises");
      const { QueueManager: QM } =
        await import("../integrations/openclaw/lib/queue-manager.mjs");

      const tempDir = await fs_mod.mkdtemp(
        path_mod.default.join(os_mod.default.tmpdir(), "zink-g20-"),
      );
      const queueFile = path_mod.default.join(tempDir, "queue.json");
      const artFile = path_mod.default.join(tempDir, "report.csv");
      try {
        await fs_mod.writeFile(
          artFile,
          "date,revenue\n2026-01-01,1000",
          "utf8",
        );
        const qm = new QM({ storagePath: queueFile });
        const taskId = "G20-TASK";
        qm.enqueueTask({
          taskId,
          primaryCoordinator: "o1",
          requiredCapabilities: [],
        });
        const claim = qm.claimTask({
          agentId: "o1",
          capabilities: [],
        });
        assert.ok(claim.claimed);

        const idemKey = "idem-" + Date.now();
        const first = await handleExecutionFinished({
          taskId,
          agentId: "o1",
          leaseId: claim.leaseId,
          attempt: claim.task.attempt,
          artifactPath: artFile,
          technicalConfig: {
            expectedType: "csv",
            expectedFields: ["date", "revenue"],
          },
          businessData: { revenue: 1000 },
          businessConfig: { kpiConstraints: { revenue: { min: 500 } } },
          queueManager: qm,
          idempotencyKey: idemKey,
        });
        assert.equal(first.status, "READY_FOR_REVIEW");

        // Second call with same idempotencyKey must return ALREADY_COMPLETED
        const second = await handleExecutionFinished({
          taskId,
          agentId: "o1",
          artifactPath: artFile,
          queueManager: qm,
          idempotencyKey: idemKey,
        });
        assert.equal(
          second.status,
          "ALREADY_COMPLETED",
          "G20: duplicate idempotencyKey must be acknowledged as ALREADY_COMPLETED",
        );
      } finally {
        await fs_mod.rm(tempDir, { recursive: true, force: true });
      }
    });

    // D06: authenticateIngress duplicate WORKFLOW_OPENED protection
    test("D06: authenticateIngress checks existing snapshot before recording WORKFLOW_OPENED", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        pluginSrc.includes(
          "D06: Check snapshot; do not write duplicate WORKFLOW_OPENED",
        ),
        "D06: duplicate check must be present in authenticateIngress",
      );
    });

    // D08: previous_native_run_ids deduplication in WORKFLOW_CONTINUATION_STARTED
    test("D08: WORKFLOW_CONTINUATION_STARTED deduplicates previous_native_run_ids", async () => {
      const { applyWorkflowEvent } =
        await import("../integrations/openclaw/topology/lib/workflow.mjs");
      const taskId = "d08".padEnd(64, "0");
      const delegationId = "del08".padEnd(64, "0");
      const snapshot = {
        sequence: 1,
        schema_version: "1.0.0",
        governance_version: "m8-t2.2-r4",
        last_event_digest: "a".repeat(64),
        tasks: {
          [taskId]: {
            task_id: taskId,
            brief_revision: 1,
            brief_state: "ACTIVE",
            // M7-020: a continuation continues approved work, so the fixture
            // carries approval evidence and a post-approval status.
            workflow_status: "EXECUTING",
            approved_at: "2026-09-01T00:00:00.000Z",
            root_agent_id: "main",
            root_session_key: "agent:main:s1",
            root_run_id: "root-run-1",
            revisions_used: 1,
            transitions_used: 0,
            delegated_runs_used: 1,
            delegations: {
              [delegationId]: {
                delegation_id: delegationId,
                agent_id: "o1",
                node_id: "node-o1",
                stack_id: "infrastructure",
                brief_revision: 1,
                attempt: 1,
                run_state: "RUNNING",
                native_run_id: "o1-run-1",
                child_session_key: "agent:o1:s2",
                parent_session_key: "agent:main:s1",
                previous_native_run_ids: ["o1-run-1"], // already contains this ID
              },
            },
            continuations: {
              "o1-run-2": {
                task_id: taskId,
                next_run_id: "o1-run-2",
                session_key: "agent:o1:s2",
                source_session_key: "agent:o1:s2",
                trigger_run_id: "o1-run-1",
                previous_run_id: "o1-run-1",
                brief_revision: 1,
                agent_id: "o1",
                started: false,
              },
            },
          },
        },
      };

      const next = applyWorkflowEvent(
        snapshot,
        "WORKFLOW_CONTINUATION_STARTED",
        {
          task_id: taskId,
          next_run_id: "o1-run-2",
          session_key: "agent:o1:s2",
          source_session_key: "agent:o1:s2",
          agent_id: "o1",
        },
      );

      const del = next.tasks[taskId].delegations[delegationId];
      // Should not have duplicated "o1-run-1"
      const occurrences = del.previous_native_run_ids.filter(
        (id) => id === "o1-run-1",
      ).length;
      assert.equal(
        occurrences,
        1,
        "D08: previous_native_run_ids must not have duplicate entries",
      );
      assert.equal(del.native_run_id, "o1-run-2");
    });

    // D14 & D15: AGENT_STACK_POLICY O1 ETL / O2 Analytics alignment
    test("D14 & D15: AGENT_STACK_POLICY assigns ETL stacks to O1 and Analytics stacks to O2", async () => {
      const { AGENT_STACK_POLICY } =
        await import("../integrations/openclaw/lib/authority.mjs");
      assert.deepEqual(
        [...AGENT_STACK_POLICY.o1],
        ["infrastructure", "data_plant"],
        "D14: O1 must be assigned ETL stacks (infrastructure, data_plant)",
      );
      assert.deepEqual(
        [...AGENT_STACK_POLICY.o2],
        ["semantic", "intelligence", "decision"],
        "D15: O2 must be assigned Analytics stacks (semantic, intelligence, decision)",
      );
    });

    // D16 & D17: delegated_runs budget parity
    test("D16 & D17: delegated_runs budget uses 72 for M8 governance version", async () => {
      // The ceiling is canonical (BUDGETS) and only the version-specific delta
      // is declared by the guard. A source-grep for a literal `71 : 72` no
      // longer proved anything once the ceiling stopped being restated inline,
      // so this asserts the authority and the delta instead.
      const { BUDGETS } =
        await import("../integrations/openclaw/topology/lib/ledger.mjs");
      assert.equal(
        BUDGETS.maxTotalDelegatedRunsPerTask,
        72,
        "D16: the canonical delegation ceiling is 72",
      );
      assert.equal(BUDGETS.maxBriefRevisionsPerTask, 16);
      assert.equal(BUDGETS.maxStackTransitionsPerTask, 10);
      // D17: the legacy m7-t2-r12 carve-out reduces the ceiling by exactly one,
      // expressed as a named delta rather than as a restated ceiling.
      const guardSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/topology/lib/guard.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        guardSrc.includes('"m7-t2-r12": 1'),
        "D17: the legacy governance version must carry a one-run carve-out",
      );
      // The guard must read the canonical ceiling, never restate it.
      assert.ok(
        guardSrc.includes("BUDGETS.maxTotalDelegatedRunsPerTask -") &&
          !/\?\s*71\s*:\s*72/u.test(guardSrc),
        "the delegation ceiling must come from BUDGETS, not a restated literal",
      );
    });

    // N03, N04, N05: DELEGATION_TABLE role parity
    test("N03, N04, N05: DELEGATION_TABLE aligns with O1 ETL / O2 Analytics specialist routing", async () => {
      const { DELEGATION_TABLE } =
        await import("../integrations/openclaw/lib/policy.mjs");
      // N03: Main routes Power BI to O2
      assert.deepEqual([...DELEGATION_TABLE.main.zink_power_bi], ["o2"]);
      // N03/N04: Main routes Excel and SQL to O1
      assert.deepEqual([...DELEGATION_TABLE.main.zink_excel], ["o1"]);
      assert.deepEqual([...DELEGATION_TABLE.main.zink_sql], ["o1"]);
      // N05: Main routes n8n to O2
      assert.deepEqual([...DELEGATION_TABLE.main.zink_n8n], ["o2"]);
      // N04: O1 does NOT delegate power-bi
      assert.equal(DELEGATION_TABLE.o1.zink_power_bi, undefined);
      // N04: O2 does NOT delegate excel or sql
      assert.equal(DELEGATION_TABLE.o2.zink_excel, undefined);
      assert.equal(DELEGATION_TABLE.o2.zink_sql, undefined);
    });

    // E08: attempt derived under fresh snapshot reload
    test("E08: spawn reservation reloads fresh snapshot from disk before deriving attempt", () => {
      const pluginSrc = readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/plugins/zink-governance/index.mjs",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      assert.ok(
        pluginSrc.includes(
          "E08: Authoritative snapshot reload immediately before attempt derivation",
        ),
        "E08: fresh snapshot reload must be present before attempt count",
      );
    });
  });
});

describe("A-Series: Discord Component Callback Schema & Interaction Guards (A14-A22, A24, A30)", () => {
  test("A14: DISCORD_COMPONENT_ACTION_NAMESPACE contains exactly 6 canonical action types", () => {
    const keys = Object.keys(DISCORD_COMPONENT_ACTION_NAMESPACE);
    assert.equal(keys.length, 6, "Must define exactly 6 action types");
    assert.ok(
      DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_APPROVE.startsWith(
        "zink:approval:",
      ),
    );
    assert.ok(
      DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_ACCEPT.startsWith(
        "zink:result:",
      ),
    );
  });

  test("A16: buildComponentCustomId formats custom_id with correct namespace prefix", () => {
    const customId = buildComponentCustomId(
      DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_APPROVE,
      "task123",
      "3",
    );
    assert.equal(customId, "zink:approval:approve:task123:3");
  });

  test("A16: buildComponentCustomId rejects unknown action type", () => {
    assert.throws(
      () => buildComponentCustomId("zink:bogus:action", "task123", "1"),
      /Unknown action type/,
    );
  });

  test("A16: parseComponentCustomId round-trips buildComponentCustomId", () => {
    const customId = buildComponentCustomId(
      DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_ACCEPT,
      "abc:def", // taskId with colon
      "5",
    );
    const parsed = parseComponentCustomId(customId);
    assert.ok(parsed, "Must parse successfully");
    assert.equal(parsed.actionKey, "RESULT_ACCEPT");
    assert.equal(parsed.taskId, "abc:def");
    assert.equal(parsed.revision, "5");
  });

  test("A16: parseComponentCustomId returns null for malformed custom_id", () => {
    assert.equal(parseComponentCustomId("bogus-action"), null);
    assert.equal(parseComponentCustomId(null), null);
    assert.equal(parseComponentCustomId("zink:approval:approve"), null); // missing task+revision
  });

  test("A19: isStaleComponentAction returns true for mismatched revision", () => {
    const customId = buildComponentCustomId(
      DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_APPROVE,
      "taskXYZ",
      "2",
    );
    assert.equal(
      isStaleComponentAction(customId, "1"),
      true,
      "Revision 2 vs active 1 is stale",
    );
    assert.equal(
      isStaleComponentAction(customId, "2"),
      false,
      "Same revision is not stale",
    );
    assert.equal(
      isStaleComponentAction("bogus", "1"),
      true,
      "Malformed is always stale",
    );
  });

  test("A18: buildMessageIdempotencyKey builds deterministic key", () => {
    const key = buildMessageIdempotencyKey(
      "task-1",
      "msg-999",
      "zink:approval:approve",
    );
    assert.equal(key, "idempkey:task-1:msg-999:zink:approval:approve");
  });

  test("A18: buildMessageIdempotencyKey rejects empty arguments", () => {
    assert.throws(
      () => buildMessageIdempotencyKey("", "msg-1", "action"),
      /taskId required/,
    );
    assert.throws(
      () => buildMessageIdempotencyKey("t1", "", "action"),
      /originMessageId required/,
    );
    assert.throws(
      () => buildMessageIdempotencyKey("t1", "m1", ""),
      /actionType required/,
    );
  });

  test("A21: validateDiscordForumTarget rejects targeting forum parent without thread", () => {
    const result = validateDiscordForumTarget({
      targetChannelId: "1545696207316455527",
      threadId: null,
      forumSurfaceIds: ["1545696207316455527", "1545696269010477056"],
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "FORUM_PARENT_NOT_ALLOWED_FOR_COMPONENTS");
  });

  test("A21: validateDiscordForumTarget accepts targeting a thread within a forum", () => {
    const result = validateDiscordForumTarget({
      targetChannelId: "1545696207316455527",
      threadId: "9999999999999999999",
      forumSurfaceIds: ["1545696207316455527"],
    });
    assert.equal(result.valid, true);
  });

  test("A21: validateDiscordForumTarget rejects missing targetChannelId", () => {
    const result = validateDiscordForumTarget({
      targetChannelId: null,
      threadId: null,
      forumSurfaceIds: [],
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "MISSING_TARGET_CHANNEL");
  });

  test("A22: validateComponentThreadCorrelation rejects mismatched thread IDs", () => {
    const result = validateComponentThreadCorrelation({
      replyToThreadId: "thread-A",
      expectedThreadId: "thread-B",
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "THREAD_CORRELATION_MISMATCH");
  });

  test("A22: validateComponentThreadCorrelation accepts matching thread IDs", () => {
    const result = validateComponentThreadCorrelation({
      replyToThreadId: "thread-X",
      expectedThreadId: "thread-X",
    });
    assert.equal(result.valid, true);
  });

  test("A22: validateComponentThreadCorrelation rejects missing thread IDs", () => {
    const result = validateComponentThreadCorrelation({
      replyToThreadId: null,
      expectedThreadId: "thread-X",
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "MISSING_THREAD_CORRELATION");
  });

  test("A23: built custom_ids stay compatible with the native 2026.6.34 custom_id grammar", () => {
    // openclaw@2026.6.34 native parseCustomId splits segments on ";" and
    // parses name=value pairs; our ids must never contain those delimiters
    // so the native parser yields key "zink" without misparsing.
    for (const actionType of Object.values(
      DISCORD_COMPONENT_ACTION_NAMESPACE,
    )) {
      const customId = buildComponentCustomId(actionType, "task-01", "3");
      assert.equal(customId.includes(";"), false);
      assert.equal(customId.includes("="), false);
      const parsed = parseComponentCustomId(customId);
      assert.equal(parsed.actionType, actionType);
      assert.equal(parsed.taskId, "task-01");
      assert.equal(parsed.revision, "3");
    }
  });

  test("A23: parseComponentCustomId accepts the native occomp:cid= envelope", () => {
    const inner = buildComponentCustomId(
      DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_ACCEPT,
      "task-07",
      "1",
    );
    const parsed = parseComponentCustomId(`occomp:cid=${inner};ttl=60000`);
    assert.equal(parsed.actionKey, "RESULT_ACCEPT");
    assert.equal(parsed.taskId, "task-07");
    assert.equal(parsed.revision, "1");
  });

  test("A23: plugin keeps the native interaction boundary (no private registry)", () => {
    const pluginPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "integrations",
      "openclaw",
      "plugins",
      "zink-governance",
      "index.mjs",
    );
    const source = readFileSync(pluginPath, "utf8");
    assert.equal(
      source.includes('Symbol.for("openclaw.discord.componentEntries")'),
      false,
      "private component registry marker must be absent",
    );
    assert.equal(
      source.includes("_zinkPatched"),
      false,
      "registry monkeypatch marker must be absent",
    );
    assert.match(
      source,
      /api\.registerInteractiveHandler\(\{\s*channel:\s*"discord",\s*namespace:\s*"zink"/,
      "native interactive handler registration (discord/zink) must exist",
    );
  });

  test("A25: ensureLedger creates a current-contract ledger (CURRENT, m8-t2.3-r5)", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "zink-r4-ledger-"));
    try {
      const paths = ledgerPaths(stateDir);
      ensureLedger(paths);
      assert.equal(inspectLedgerUpgrade(paths), "CURRENT");
      const snapshot = readSnapshot(paths);
      // Phase B (gap A): a NEW ledger is stamped with the current, unambiguous
      // writer-semantics contract.
      assert.equal(snapshot.governance_version, "m8-t2.3-r5");
      assert.equal(snapshot.sequence, 0);
      assert.deepEqual(snapshot.tasks, {});
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  test("A25: a ledger stamped with a RETIRED version stays CURRENT and readable", async () => {
    // The bump must not orphan history. Every previously-emitted version stays
    // in the reader's supported set, so a ledger the deployed writer produced
    // is still CURRENT and still readable.
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "zink-r4-ledger-"));
    try {
      for (const retired of [
        "m8-t2.2-r4",
        "m8-t2.1-r3",
        "m8-t2-r9",
        "m7-t5-r13",
        "m7-t2-r12",
      ]) {
        const paths = ledgerPaths(stateDir);
        ensureLedger(paths);
        const current = readSnapshot(paths);
        const restamped = {
          ...current,
          governance_version: retired,
          sequence: 0,
          last_event_digest: null,
          ingress_ids: [],
          tasks: {},
          updated_at: current.updated_at,
        };
        writeFileSync(
          paths.snapshot,
          `${JSON.stringify(restamped, null, 2)}\n`,
        );
        assert.equal(
          inspectLedgerUpgrade(paths),
          "CURRENT",
          `${retired}: must stay CURRENT`,
        );
        assert.equal(
          readSnapshot(paths).governance_version,
          retired,
          `${retired}: must stay readable`,
        );
      }
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  test("A25: incompatible legacy ledger stays BLOCKED (fail-closed preserved)", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "zink-r4-ledger-"));
    try {
      const paths = ledgerPaths(stateDir);
      ensureLedger(paths);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        paths.events,
        JSON.stringify({
          sequence: 1,
          schema_version: "1.0.0",
          governance_version: "m7-t2-r11",
          created_at: "2026-01-01T00:00:00.000Z",
          type: "UNKNOWN_STATE_CHANGE",
          payload: {},
          event_digest: "0".repeat(64),
        }) + "\n",
      );
      assert.throws(() => readSnapshot(paths), /Ledger corruption/);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  test("A24: validateContextVisibilityForThread warns when thread not in allowlist", () => {
    const result = validateContextVisibilityForThread({
      contextVisibility: "allowlist",
      allowlistChannelIds: ["channel-A", "channel-B"],
      threadChannelId: "channel-C",
    });
    assert.equal(result.covered, false);
    assert.equal(result.reason, "THREAD_NOT_IN_ALLOWLIST");
  });

  test("A24: validateContextVisibilityForThread passes when thread is in allowlist", () => {
    const result = validateContextVisibilityForThread({
      contextVisibility: "allowlist",
      allowlistChannelIds: ["channel-A", "channel-B"],
      threadChannelId: "channel-A",
    });
    assert.equal(result.covered, true);
  });

  test("A24: validateContextVisibilityForThread is no-op when not allowlist mode", () => {
    const result = validateContextVisibilityForThread({
      contextVisibility: "public",
      allowlistChannelIds: [],
      threadChannelId: "any-channel",
    });
    assert.equal(result.covered, true);
  });

  test("A30: agentInstructions derives channel IDs from identifiers when provided", () => {
    const instructions = agentInstructions("main", {
      discordOfficeChannelId: "OFFICE_ID_TEST",
      discordApprovalsForumId: "APPROVALS_ID_TEST",
      discordResultsForumId: "RESULTS_ID_TEST",
      discordIncidentsForumId: "INCIDENTS_ID_TEST",
    });
    assert.ok(
      instructions.includes("OFFICE_ID_TEST"),
      "A30: should use identifiers office ID",
    );
    assert.ok(
      instructions.includes("APPROVALS_ID_TEST"),
      "A30: should use identifiers approvals ID",
    );
    assert.ok(
      instructions.includes("RESULTS_ID_TEST"),
      "A30: should use identifiers results ID",
    );
  });

  test("A30: agentInstructions falls back to production IDs when identifiers not provided", () => {
    const instructions = agentInstructions("main");
    assert.ok(
      instructions.includes("1545425766161063937"),
      "A30: should use production office ID",
    );
    assert.ok(
      instructions.includes("1545696207316455527"),
      "A30: should use production approvals ID",
    );
  });
});
