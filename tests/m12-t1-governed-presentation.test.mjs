// M12/T1-R1 Phase 3 — the approval card presents the plan, not the plumbing.
//
// Owner instruction 2026-10-13: "Không có mã run, chỉ có task ID, không có mục người
// yêu cầu, không có hành động, không có child:… Lý do: phải ghi chi tiết plan ra, làm
// những gì, những thao tác nào cụ thể, tại các phần mềm nào… Kết quả: Trả về hình ảnh kết
// quả dự kiến." These tests pin both halves: what must appear and what must never appear.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  renderGovernedApprovalBody,
  renderGovernedExpectedResult,
  renderGovernedPlanSteps,
  specialistSoftwareLabel,
} from "../integrations/openclaw/lib/discord-formatter.mjs";
import { buildFirstSpawnApprovalCard } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

const NEW_ID = "13102026CDEF";
const LEGACY_ID = "a".repeat(64);

const NODES = [
  {
    node_id: "extract-sales",
    agent_id: "sql",
    required: true,
    inputs:
      "Truy vấn bảng Sales theo tháng, lọc đơn đã thanh toán, xuất ra bảng staging.",
    constraints: "Chỉ đọc, không ghi lại nguồn.",
    validation_criteria: "Số dòng khớp tổng đơn đã thanh toán của tháng.",
  },
  {
    node_id: "build-workbook",
    agent_id: "excel",
    required: true,
    inputs: "Tạo workbook 3 sheet: Data, Pivot, Dashboard.",
    constraints: "Dùng template của anh.",
    validation_criteria: "Pivot khớp staging theo từng tháng.",
  },
];

describe("M12/T1 P3 — the approval body carries the plan", () => {
  it("names the software and the concrete operations for every step", () => {
    const steps = renderGovernedPlanSteps(NODES, {
      activeNodeId: "build-workbook",
    });
    assert.equal(steps.length, 2);
    assert.match(steps[0], /SQL Server/u);
    assert.match(steps[0], /Truy vấn bảng Sales/u);
    assert.match(steps[0], /Ràng buộc: Chỉ đọc/u);
    assert.match(steps[0], /Nghiệm thu: Số dòng khớp/u);
    assert.match(steps[1], /Microsoft Excel/u);
    assert.match(steps[1], /Đang chờ anh duyệt ở bước này/u);
    assert.doesNotMatch(steps[0], /Đang chờ anh duyệt/u);
    assert.equal(specialistSoftwareLabel("power-bi"), "Power BI");
    assert.equal(specialistSoftwareLabel("python"), "Python");
  });

  it("renders the expected result and names the attached preview image", () => {
    const text = renderGovernedExpectedResult({
      nodes: NODES,
      outcome: "Bảng theo dõi doanh thu theo tháng",
      previewImage: "dashboard_preview.png",
    });
    assert.match(text, /Bảng theo dõi doanh thu theo tháng/u);
    assert.match(text, /SQL Server: Số dòng khớp/u);
    assert.match(text, /Hình ảnh kết quả dự kiến: `dashboard_preview\.png`/u);
  });

  it("says plainly when the plan has no expected result recorded", () => {
    assert.match(
      renderGovernedExpectedResult({ nodes: [], outcome: "" }),
      /chưa có mô tả kết quả/u,
    );
  });
});

describe("M12/T1 P3 — the first-spawn card matches the owner's shape", () => {
  it("shows the task id and the plan, and nothing that identifies plumbing", () => {
    const card = buildFirstSpawnApprovalCard({
      taskId: NEW_ID,
      taskCode: NEW_ID,
      briefRevision: 2,
      targetAgentId: "o1",
      spawnInputs: "Dựng pipeline ETL doanh thu",
      spawnNodeId: "build-workbook",
      planNodes: NODES,
      previewImage: "dashboard_preview.png",
    });
    assert.match(card.title, /🔖 \[PHÊ DUYỆT\]/u);
    assert.ok(
      card.bodyContent.includes(`**Task ID:** \`${NEW_ID}\``),
      `the card must lead with the task id, got:\n${card.bodyContent}`,
    );
    assert.match(card.bodyContent, /Lý do \(kế hoạch chi tiết\)/u);
    assert.match(card.bodyContent, /Kết quả dự kiến/u);
    assert.match(card.bodyContent, /Microsoft Excel/u);
    assert.match(card.bodyContent, /SQL Server/u);
    for (const forbidden of [
      "Mã ngắn",
      "Người yêu cầu",
      "**Child:**",
      "**Hành động:**",
      "**Run:**",
      "sessions_spawn",
      "Node:",
      "brief revision",
    ]) {
      assert.doesNotMatch(
        card.bodyContent,
        new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
        `the card must no longer print "${forbidden}"`,
      );
    }
    assert.equal(card.buttons.length, 3);
    assert.deepEqual(
      card.buttons.map((button) => button.label),
      ["Approve", "Reject", "Request Revision"],
    );
  });

  it("still puts the full legacy id in the body when a task has no code", () => {
    const card = buildFirstSpawnApprovalCard({
      taskId: LEGACY_ID,
      taskCode: null,
      briefRevision: 1,
      targetAgentId: "sql",
      spawnInputs: "Trích xuất dữ liệu tồn kho",
      spawnNodeId: "extract",
      planNodes: [],
    });
    // The text-approval path correlates on this token, so it must be present and it
    // must be what the owner is told to type.
    assert.match(card.bodyContent, new RegExp(LEGACY_ID, "u"));
    assert.match(card.bodyContent, /APPROVE a{64}/u);
    assert.match(card.bodyContent, /1\. \*\*SQL Server\*\*/u);
    assert.match(card.bodyContent, /Trích xuất dữ liệu tồn kho/u);
  });

  it("clips an over-long plan with a marker and keeps the actions readable", () => {
    const huge = [
      {
        node_id: "step-a",
        agent_id: "python",
        required: true,
        inputs: "x".repeat(4000),
        constraints: "y".repeat(4000),
        validation_criteria: "z".repeat(4000),
      },
    ];
    const body = renderGovernedApprovalBody({
      title: "🔖 [PHÊ DUYỆT] Kế hoạch Thực thi",
      taskId: NEW_ID,
      planSteps: renderGovernedPlanSteps(huge),
      expectedResult: renderGovernedExpectedResult({ nodes: huge }),
      commandToken: NEW_ID,
    });
    assert.ok(
      body.length <= 2000,
      `Discord refuses a message over 2000 characters, got ${body.length}`,
    );
    assert.match(body, /…\(xem toàn bộ kế hoạch trong phiên\)/u);
    assert.match(body, /Bấm \*\*Approve\*\*/u);
    assert.match(body, new RegExp(`APPROVE ${NEW_ID}`, "u"));
  });
});
