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

import { handleDiscordAction } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

import {
  formatOfficeClarificationQuestion,
  formatGovernedApprovalCard,
  formatGovernedResultCard,
  formatIncidentCard,
} from "../integrations/openclaw/lib/discord-formatter.mjs";

import { AGENT_SPAWN_POLICY } from "../integrations/openclaw/lib/policy.mjs";
import { executeExcelOperation } from "../integrations/openclaw/lib/excel-writer.mjs";

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
      observed: "Worker disconnect during processing",
      expected: "Heartbeat maintained every 60s",
      action: "Re-queueing task to waiting worker",
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

    // Specialists have empty spawn lists (pure execution workers)
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
      await writeFile(sqlFile, "SELECT id, name FROM products WHERE active = 1;");
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
      const result = validateTechnicalArtifact({ filePath: sqlFile, minBytes: 1 });
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
      const result = validateTechnicalArtifact({ filePath: pyFile, minBytes: 1 });
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
      await writeFile(parquetFile, Buffer.concat([magic, body, Buffer.from("XXXX")]));
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
    const sql = "DELETE FROM logs WHERE created_at < '2024-01-01';\nDROP TABLE temp;";
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
    assert.throws(
      () => validateSqlFileContent(null),
      /SQL_CONTENT_INVALID/,
    );
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
    const py = "import pandas as pd\n\ndef transform(df):\n    return df.dropna()\n";
    const analysis = validatePythonFileContent(py);
    const preview = formatPythonPreview("transform.py", analysis);
    assert.match(preview, /Python Script/);
    assert.match(preview, /transform\.py/);
    assert.match(preview, /```python/);
    assert.match(preview, /pandas/);
  });
});
