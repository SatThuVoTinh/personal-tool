import path from "node:path";

/**
 * Discord Output Sanitization & Formatting
 * Transforms internal GovernedResult envelopes into human-safe, clean Markdown messages for Discord.
 * Strictly redacts: JSON-RPC, governance receipts, session keys, run IDs, task IDs, authorization objects,
 * tool schemas, stack traces, local filesystem paths, secrets/API keys.
 */

// Banned patterns per ACTIVE.md BUG-13
const BANNED_PATTERNS = [
  // Session keys: sess-xxx
  /\bsess-[a-zA-Z0-9_-]{8,}\b/g,
  // Run IDs: run-xxx
  /\brun-[a-zA-Z0-9_-]{8,}\b/g,
  // 64-hex hashes (internal task IDs, digests, principal refs)
  /\b[a-f0-9]{64}\b/g,
  // Task IDs with prefix: task-xxx
  /\btask-[a-zA-Z0-9_-]{8,}\b/g,
  // JSON-RPC artifacts
  /\{"jsonrpc":\s*"2\.0".*?\}/gs,
  // Local filesystem paths (Windows & Unix)
  /(?:[a-zA-Z]:\\[^\s"'<>|]+|\/(?:Users|home|tmp|etc|var|app)\/[^\s"'<>|]+)/g,
  // File URI
  /file:\/\/\/[^\s"'<>|]+/g,
  // Secrets and tokens
  /(?:Bearer\s+[A-Za-z0-9._~+/-]+=*|ghp_[A-Za-z0-9]{36}|discord_token[^\s]*)/gi,
  // Stack traces
  /\s+at\s+(?:[a-zA-Z0-9_$.<>]+\s+)?\(?[^\n)]+:\d+:\d+\)?/g,
];

/**
 * Sanitizes an identifier (task ID, incident ID, tag, status, action)
 * ensuring it contains no control characters, newlines, or Discord mention injections,
 * while preserving legitimate task and digest strings.
 */
export function sanitizeDiscordIdentifier(id) {
  if (id === null || id === undefined) return "";
  return (
    String(id)
      // eslint-disable-next-line no-control-regex
      .replace(/[\r\n\x00-\x1f\x7f]/g, "")
      .replace(/@(everyone|here)/gi, "")
      .replace(/<@[!&]?\d+>/g, "")
      .trim()
  );
}

/**
 * Strips all internal governance and sensitive tokens from text.
 * Uses a delimiter replacement rather than deleting tokens to prevent word-joining (F03).
 * Supports preserveIdentifiers to maintain task IDs and public digests on card displays (F01, F02, F22).
 */
export function sanitizeDiscordText(
  text,
  { preserveIdentifiers = false, delimiter = " " } = {},
) {
  if (typeof text !== "string") return "";
  let sanitized = text;
  for (const pattern of BANNED_PATTERNS) {
    if (
      preserveIdentifiers &&
      (pattern.source.includes("a-f0-9]{64}") ||
        pattern.source.includes("task-"))
    ) {
      continue;
    }
    sanitized = sanitized.replace(pattern, delimiter);
  }
  return sanitized.replace(/[^\S\r\n]+/g, " ").trim();
}

/**
 * Formats a governed result or raw output into a clean, human-safe Discord message.
 */
export function formatForDiscord(rawInput, { agentName = "Zink Bot" } = {}) {
  if (rawInput === null || rawInput === undefined) {
    return `ℹ️ [${agentName}]: Hoàn thành (không có nội dung phản hồi).`;
  }

  let textContent = "";
  let assumptions = [];
  let limitations = [];

  // Check if rawInput is an object or a JSON string
  let parsed = null;
  if (typeof rawInput === "object") {
    parsed = rawInput;
  } else if (typeof rawInput === "string") {
    let trimmed = rawInput.trim();
    if (trimmed.startsWith("```")) {
      trimmed = trimmed
        .replace(/^```(?:json)?\s*/iu, "")
        .replace(/\s*```$/u, "")
        .trim();
    }
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Not valid JSON, treat as raw text
        textContent = rawInput;
      }
    } else {
      // Do not perform opportunistic substring JSON extraction (F04)
      textContent = rawInput;
    }
  }

  if (parsed) {
    // If it's a governed envelope/receipt
    const target = parsed.payload ?? parsed;
    textContent =
      target.output ?? target.text ?? target.content ?? target.message ?? "";
    if (Array.isArray(target.assumptions) && target.assumptions.length > 0) {
      assumptions = target.assumptions;
    }
    if (Array.isArray(target.limitations) && target.limitations.length > 0) {
      limitations = target.limitations;
    }

    // Fallback if output was empty but status is present
    if (!textContent && (target.outcome_claim || parsed.outcome_claim)) {
      const status = target.outcome_claim || parsed.outcome_claim;
      const reason = target.reason_claim || parsed.reason_claim || "NONE";
      textContent = `Tác vụ hoàn thành với trạng thái: ${status}${reason !== "NONE" ? ` (${reason})` : ""}`;
    }
  }

  // If textContent itself is a stringified JSON (nested JSON payload), unwrap it
  if (typeof textContent === "string") {
    let innerTrimmed = textContent.trim();
    if (innerTrimmed.startsWith("```")) {
      innerTrimmed = innerTrimmed
        .replace(/^```(?:json)?\s*/iu, "")
        .replace(/\s*```$/u, "")
        .trim();
    }
    if (innerTrimmed.startsWith("{") && innerTrimmed.endsWith("}")) {
      try {
        const innerParsed = JSON.parse(innerTrimmed);
        const innerTarget = innerParsed.payload ?? innerParsed;
        if (
          innerTarget.output ||
          innerTarget.text ||
          innerTarget.content ||
          innerTarget.message
        ) {
          textContent =
            innerTarget.output ??
            innerTarget.text ??
            innerTarget.content ??
            innerTarget.message;
          if (
            Array.isArray(innerTarget.assumptions) &&
            innerTarget.assumptions.length > 0
          ) {
            assumptions = [...assumptions, ...innerTarget.assumptions];
          }
          if (
            Array.isArray(innerTarget.limitations) &&
            innerTarget.limitations.length > 0
          ) {
            limitations = [...limitations, ...innerTarget.limitations];
          }
        }
      } catch {
        // Keep textContent as is
      }
    }
  }

  // Check if input is a structured governed envelope (Approval, Result, Incident, or Proposal)
  if (parsed && typeof parsed === "object") {
    const candidate = parsed.payload ?? parsed;
    if (
      candidate.type === "approval" ||
      (candidate.action === "propose" && candidate.proposal) ||
      (candidate.proposal_id && candidate.capability) ||
      (candidate.approval_id && candidate.exact_operation)
    ) {
      return formatApprovalNotification(candidate, { agentName });
    }
    if (
      candidate.type === "incident" ||
      (candidate.incident_id &&
        (candidate.observed_state || candidate.severity))
    ) {
      return formatIncidentNotification(candidate, { agentName });
    }
    if (
      candidate.type === "result" ||
      (candidate.result_id &&
        (candidate.deliverables || candidate.summary || candidate.output))
    ) {
      return formatResultNotification(candidate, { agentName });
    }
  }

  // Clean the text content
  let cleanText = sanitizeDiscordText(textContent);

  // If text is still empty or was completely stripped
  if (!cleanText) {
    cleanText = `ℹ️ [${agentName}]: Tác vụ đã được xử lý thành công.`;
  }

  // Format assumptions & limitations into clean Markdown bullets
  const sections = [cleanText];

  if (assumptions.length > 0) {
    const cleanAssumptions = assumptions
      .map((a) => sanitizeDiscordText(String(a)))
      .filter(Boolean);
    if (cleanAssumptions.length > 0) {
      sections.push(
        `\n**Giả định:**\n${cleanAssumptions.map((a) => `• ${a}`).join("\n")}`,
      );
    }
  }

  if (limitations.length > 0) {
    const cleanLimitations = limitations
      .map((l) => sanitizeDiscordText(String(l)))
      .filter(Boolean);
    if (cleanLimitations.length > 0) {
      sections.push(
        `\n**Hạn chế:**\n${cleanLimitations.map((l) => `• ${l}`).join("\n")}`,
      );
    }
  }

  return sections.join("\n");
}

/**
 * Unified Governed Markdown Template.
 * All three (Approval, Result, Incident) share this exact same 5-part layout.
 */
export function formatGovernedEnvelope({
  tag,
  title,
  purpose,
  details = {},
  content = "",
  attachments = [],
  impact = "",
  action = "",
  agentName = "Zink Bot",
} = {}) {
  const cleanTag = sanitizeDiscordIdentifier(tag || "");
  const cleanTitle = sanitizeDiscordText(title || "Thông báo Hệ thống", {
    preserveIdentifiers: true,
  });
  const cleanPurpose = sanitizeDiscordText(
    purpose || "Thông báo từ tác vụ Zink",
    { preserveIdentifiers: true },
  );
  const lines = [
    `### ${cleanTag} ${cleanTitle}`.trim(),
    `> **Mục đích:** ${cleanPurpose}`,
    "",
    "---",
    "",
  ];

  // 1. Details section
  lines.push("#### 📋 Thông tin Chi tiết (Details)");
  const detailEntries = Object.entries(details);
  if (detailEntries.length > 0) {
    for (const [key, value] of detailEntries) {
      if (value !== undefined && value !== null && value !== "") {
        lines.push(
          `- **${sanitizeDiscordText(key)}:** ${sanitizeDiscordText(String(value))}`,
        );
      }
    }
  } else {
    lines.push(`- **Tác nhân thực hiện:** ${agentName}`);
    lines.push(
      `- **Thời gian:** ${new Date().toISOString().replace("T", " ").slice(0, 19)}`,
    );
  }
  lines.push("");

  // 2. Content / Deliverables / Observed section
  lines.push("#### 📝 Nội dung Thực thi / Báo cáo (Content & Deliverables)");
  const cleanContent = sanitizeDiscordText(
    content || "(Không có nội dung mô tả)",
  );
  lines.push(cleanContent);
  lines.push("");

  // 3. Attachments & Files section
  lines.push("#### 📦 Tệp đính kèm & Tham chiếu (Files & Artifacts)");
  const cleanAttachments = Array.isArray(attachments)
    ? attachments.map((att) => sanitizeDiscordText(String(att))).filter(Boolean)
    : attachments
      ? [sanitizeDiscordText(String(attachments))]
      : [];
  if (cleanAttachments.length > 0) {
    for (const item of cleanAttachments) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push("*(Không có tệp đính kèm)*");
  }
  lines.push("");

  // 4. Impact & Validation section
  lines.push("#### ⚖️ Đánh giá Tác động & Kiểm định (Impact & Validation)");
  const cleanImpact = sanitizeDiscordText(
    impact || "Tác vụ tuân thủ các quy chuẩn quản trị hệ thống.",
  );
  lines.push(cleanImpact);
  lines.push("");

  // 5. Action & Recovery section
  lines.push("#### 🔄 Hướng dẫn Xử lý & Phục hồi (Action & Recovery)");
  const cleanAction = sanitizeDiscordText(
    action || "Không yêu cầu hành động can thiệp thêm.",
  );
  lines.push(cleanAction);

  return lines.join("\n").trim();
}

/**
 * Formats an Approval Request (skill proposal or protected operation).
 */
export function formatApprovalNotification(
  data = {},
  { agentName = "Zink Bot" } = {},
) {
  const proposal = data.proposal || data;
  const isSkill = Boolean(
    proposal.capability ||
    proposal.proposal_id?.startsWith?.("skill-") ||
    data.action === "propose",
  );
  const identifier =
    proposal.proposal_id || data.approval_id || proposal.id || "N/A";
  const target = isSkill
    ? `skills/${Array.isArray(proposal.namespace) ? proposal.namespace.join("/") : proposal.namespace || "specialist"}/${proposal.capability || "skill"}@${proposal.version || "1.0.0"}`
    : data.exact_target || "Tác vụ được bảo vệ";
  const actor = proposal.requesting_agent || data.agent_id || agentName;
  const reason = proposal.reason || data.impact || "(Không có lý do kèm theo)";

  const details = {
    "Mã định danh (ID)": identifier,
    "Tác nhân đề xuất (Actor)": actor,
    "Đối tượng / Phạm vi (Target)": target,
    "Thời gian phát hành":
      proposal.created_at ||
      new Date().toISOString().replace("T", " ").slice(0, 19),
    "Trạng thái": "CANDIDATE (Chờ phê duyệt)",
  };

  const content = isSkill
    ? `**Lý do đề xuất:** ${reason}\n\n**Mã băm nội dung (SHA-256):** \`${proposal.content_sha256 || "N/A"}\``
    : `**Thao tác yêu cầu:** \`${data.exact_operation || "PROTECTED_OPERATION"}\`\n**Chi tiết:** ${reason}`;

  const attachments = isSkill
    ? [
        `SKILL.md (Phiên bản ${proposal.version || "1.0.0"})`,
        `Kho lưu trữ: ${target}`,
      ]
    : data.material_parameters
      ? [JSON.stringify(data.material_parameters)]
      : [];

  const impact = isSkill
    ? "Khi được duyệt, kỹ năng sẽ chuyển sang trạng thái ACTIVE, được đồng bộ vào cơ sở dữ liệu vector dài hạn (pgvector) để toàn bộ 7 bot truy vấn và áp dụng."
    : data.impact ||
      "Yêu cầu quyền can thiệp đặc quyền hoặc sửa đổi dữ liệu quan trọng.";

  const action = `**Lệnh phê duyệt dành cho Owner:**\nPhản hồi tin nhắn này hoặc gõ lệnh: \`Duyệt đề xuất: ${identifier}\`\n*(Phương án hoàn tác: Owner có thể hạ cấp (deprecate) hoặc hủy bỏ bất kỳ lúc nào)*`;

  return formatGovernedEnvelope({
    tag: "🔖 [PHÊ DUYỆT]",
    title: isSkill
      ? `Đề xuất Skill: ${proposal.capability || "kỹ năng mới"}`
      : `Yêu cầu Phê duyệt: ${data.exact_operation || "Thao tác"}`,
    purpose: isSkill
      ? "Phê duyệt đưa kỹ năng mới vào Zink Skill Store và vector memory"
      : "Phê duyệt thực thi thao tác nhạy cảm theo chính sách an toàn",
    details,
    content,
    attachments,
    impact,
    action,
    agentName,
  });
}

/**
 * Formats a Result Publication (#results).
 */
export function formatResultNotification(
  data = {},
  { agentName = "Zink Bot" } = {},
) {
  const result = data.payload || data;
  const identifier = result.result_id || result.task_id || "N/A";
  const status = result.workflow_status || result.outcome_claim || "COMPLETE";
  const summary =
    result.summary ||
    result.output ||
    result.text ||
    result.content ||
    "Tác vụ đã hoàn tất thành công.";

  const details = {
    "Mã tác vụ (Task ID)": identifier,
    "Tác nhân thực hiện (Actor)": agentName,
    "Trạng thái (Status)": status,
    "Thời gian hoàn tất":
      result.created_at ||
      new Date().toISOString().replace("T", " ").slice(0, 19),
  };

  const deliverables =
    Array.isArray(result.deliverables) && result.deliverables.length > 0
      ? result.deliverables.map((d) => `• ${d}`).join("\n")
      : summary;

  const attachments =
    Array.isArray(result.deliverables) && result.deliverables.length > 0
      ? result.deliverables
      : result.artifacts || [];

  const validation = result.validation
    ? `Kết quả kiểm định: **${result.validation}**`
    : "Bằng chứng thực thi đã được kiểm tra tính toàn vẹn và hợp đồng đầu ra.";

  const action =
    "Kết quả đã được xác thực và sẵn sàng đưa vào áp dụng. Không yêu cầu can thiệp thêm.";

  return formatGovernedEnvelope({
    tag: "📋 [KẾT QUẢ]",
    title: `Báo cáo Kết quả Tác vụ (${identifier.slice(0, 8)})`,
    purpose:
      "Báo cáo hoàn thành tác vụ phân tích & Bàn giao sản phẩm kết quả kèm file",
    details,
    content: deliverables,
    attachments,
    impact: validation,
    action,
    agentName,
  });
}

/**
 * Formats an Incident Notification (#incidents).
 */
export function formatIncidentNotification(
  data = {},
  { agentName = "Zink Bot" } = {},
) {
  const incident = data.payload || data;
  const identifier = incident.incident_id || "INC-" + Date.now();
  const severity = incident.severity || "MEDIUM";
  const category = incident.category || "GOVERNANCE_SAFETY_BOUNDARY";
  const observed =
    incident.observed_state ||
    incident.error ||
    incident.message ||
    "Phát hiện sai lệch trạng thái thực thi.";
  const expected =
    incident.expected_state || "Hoạt động bình thường theo hợp đồng quy định.";

  const details = {
    "Mã sự cố (Incident ID)": identifier,
    "Nguồn phát hiện (Detected By)": incident.detected_by || agentName,
    "Phân loại (Category)": category,
    "Mức độ nghiêm trọng (Severity)": severity,
    "Thời gian ghi nhận":
      incident.created_at ||
      new Date().toISOString().replace("T", " ").slice(0, 19),
  };

  const content = `**Hiện trạng quan sát (Observed):**\n${observed}\n\n**Trạng thái kỳ vọng (Expected):**\n${expected}`;
  const attachments = Array.isArray(incident.evidence) ? incident.evidence : [];
  const impact =
    incident.impact ||
    "Sự cố được cách ly trong phạm vi phiên làm việc hiện tại.";
  const action = `**Trạng thái cô lập (Containment):** ${incident.containment_status || "Đã chặn tác vụ vi phạm"}\n**Khắc phục (Recovery):** ${incident.recovery_status || "Hệ thống an toàn, chờ chỉ thị tiếp theo"}${incident.owner_action_required ? "\n⚠️ **Yêu cầu Owner can thiệp để mở khóa tác vụ.**" : ""}`;

  return formatGovernedEnvelope({
    tag: "🚨 [SỰ CỐ]",
    title: `Cảnh báo Sự cố: ${category} [${severity}]`,
    purpose:
      "Thông báo sự cố kỹ thuật, vi phạm hợp đồng dữ liệu hoặc cảnh báo ranh giới an toàn",
    details,
    content,
    attachments,
    impact,
    action,
    agentName,
  });
}

export function formatError(errorOrCode, optsOrName = "Zink Bot") {
  const agentName =
    typeof optsOrName === "object" && optsOrName !== null
      ? (optsOrName.agentName ?? "Zink Bot")
      : optsOrName;

  let rawMessage = "UNKNOWN_ERROR";
  if (errorOrCode instanceof Error) {
    rawMessage = errorOrCode.code ?? errorOrCode.message ?? "EXECUTION_FAILED";
  } else if (errorOrCode) {
    rawMessage = String(errorOrCode);
  }

  const cleanCode = sanitizeDiscordText(rawMessage)
    .split("\n")[0]
    .replace(/^Error:\s*/, "");

  return `⚠️ [${agentName}]: Yêu cầu chưa thể hoàn thành (${cleanCode}). Vui lòng kiểm tra lại quyền hạn hoặc cấu hình.`;
}

/**
 * Formats a direct clarification question from O1/O2 in #office.
 * Implements ACTIVE.md Section 8:
 * Format:
 * TASK-042 | O1
 * Cần xác nhận: ...
 * Lý do: ...
 * Task: WAITING_FOR_USER
 */
export function formatOfficeClarificationQuestion({
  taskId,
  agentId = "O1",
  question,
  reason,
}) {
  const cleanTask = sanitizeDiscordIdentifier(taskId || "TASK-UNKNOWN");
  const cleanAgent = sanitizeDiscordIdentifier(agentId.toUpperCase());
  const cleanQuestion = sanitizeDiscordText(
    question || "Cần xác nhận thêm thông tin.",
    { preserveIdentifiers: true },
  );
  const cleanReason = sanitizeDiscordText(
    reason || "Thiếu dữ kiện hoặc yêu cầu nghiệp vụ chưa rõ.",
    { preserveIdentifiers: true },
  );

  return [
    `**${cleanTask} | ${cleanAgent}**`,
    "",
    "**Cần xác nhận:**",
    cleanQuestion,
    "",
    "**Lý do:**",
    cleanReason,
    "",
    "**Trạng thái tác vụ:** `WAITING_FOR_USER`",
    "*(Vui lòng trả lời trực tiếp tại #office để tác vụ tiếp tục thực thi)*",
  ].join("\n");
}

/**
 * Formats the final completion/rejection notification in #office by Main.
 * Implements ACTIVE.md Section 8 and distinct states (F21).
 */
export function formatOfficeFinalNotification({
  taskId,
  status = "COMPLETE",
  summary,
}) {
  const cleanTask = sanitizeDiscordIdentifier(taskId || "TASK-UNKNOWN");
  const cleanSummary = sanitizeDiscordText(summary || "Tác vụ đã kết thúc.", {
    preserveIdentifiers: true,
  });

  let statusText = "✅ ĐÃ HOÀN THÀNH (Đã được User nghiệm thu)";
  if (status === "FAILED") {
    statusText = "❌ THẤT BẠI (Gặp lỗi trong quá trình thực thi)";
  } else if (status === "BLOCKED") {
    statusText = "⛔ BỊ CHẶN (Cần can thiệp gỡ chặn / quyết định từ Owner)";
  } else if (status === "PARTIAL") {
    statusText = "⚠️ HOÀN THÀNH MỘT PHẦN (Cần xử lý thêm các phần chưa đạt)";
  } else if (status === "CANCELLED") {
    statusText = "🛑 ĐÃ HỦY BỎ";
  } else if (status !== "COMPLETE") {
    statusText = `ℹ️ TRẠNG THÁI: ${sanitizeDiscordIdentifier(status)}`;
  }

  return [
    `📢 **[Quản Lý | Thông báo Cuối]** Tác vụ **${cleanTask}**`,
    "",
    `**Kết quả:** ${statusText}`,
    "",
    "**Tóm tắt kết quả:**",
    cleanSummary,
  ].join("\n");
}

/**
 * M12/T1-R1 — the governed presentation primitives.
 *
 * Owner instruction 2026-10-13: an approval card carries ONLY the Task ID (no run
 * code, no requester, no action line, no `child:` line); `Lý do` spells out the
 * detailed plan — what will be done, which concrete operations, in which software;
 * and `Kết quả` shows the expected result with an image that resembles the Excel /
 * SQL / Python / Power BI screen, because that is what makes "Request Revision" a
 * meaningful answer.
 *
 * The plan is rendered from the durable admitted brief nodes, never from the
 * model's own card prose, so the owner reads the governed plan itself rather than a
 * restatement of it.
 */
export const SPECIALIST_SOFTWARE_LABELS = Object.freeze({
  main: "Quản Lý (Main)",
  o1: "Điều phối ETL (O1)",
  o2: "Điều phối Analytics (O2)",
  excel: "Microsoft Excel",
  sql: "SQL Server",
  python: "Python",
  "power-bi": "Power BI",
});

const PLAN_FIELD_LIMIT = 600;
const DISCORD_BODY_LIMIT = 2000;
const PLAN_TRUNCATION_MARK = "…(xem toàn bộ kế hoạch trong phiên)";

function clipField(value, limit = PLAN_FIELD_LIMIT) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}…`;
}

export function specialistSoftwareLabel(agentId) {
  return (
    SPECIALIST_SOFTWARE_LABELS[agentId] ??
    clipField(String(agentId ?? ""), 80) ??
    "không rõ"
  );
}

/**
 * One numbered step per planned node: the software that will be used, the concrete
 * operations, the constraints it must respect, and the criterion its result is
 * judged against.
 */
export function renderGovernedPlanSteps(nodes, { activeNodeId = null } = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  return nodes.map((node, index) => {
    const nodeId = clipField(node?.node_id, 80);
    const label = specialistSoftwareLabel(node?.agent_id);
    const lines = [
      nodeId
        ? `${index + 1}. **${label}** — \`${nodeId}\``
        : `${index + 1}. **${label}**`,
    ];
    const operations = clipField(node?.inputs);
    if (operations) lines.push(`   - Thao tác: ${operations}`);
    const constraints = clipField(node?.constraints);
    if (constraints) lines.push(`   - Ràng buộc: ${constraints}`);
    const criteria = clipField(node?.validation_criteria);
    if (criteria) lines.push(`   - Nghiệm thu: ${criteria}`);
    if (node?.required === false) lines.push("   - Không bắt buộc");
    if (activeNodeId && node?.node_id === activeNodeId) {
      lines.push("   - **Đang chờ anh duyệt ở bước này**");
    }
    return lines.join("\n");
  });
}

/**
 * The `Kết quả` section: the expected outcome in words plus the preview image that
 * travels with the card. The image is named, never inlined — Discord renders it
 * from the attachment itself.
 */
export function renderGovernedExpectedResult({
  nodes,
  outcome = "",
  previewImage = null,
}) {
  const lines = [];
  const summary = clipField(outcome, PLAN_FIELD_LIMIT);
  if (summary) lines.push(summary);
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const criteria = clipField(node?.validation_criteria, 240);
    if (criteria) {
      lines.push(`• ${specialistSoftwareLabel(node?.agent_id)}: ${criteria}`);
    }
  }
  if (lines.length === 0) {
    lines.push("*(chưa có mô tả kết quả trong kế hoạch đã ghi)*");
  }
  if (typeof previewImage === "string" && previewImage.length > 0) {
    lines.push(
      `• Hình ảnh kết quả dự kiến: \`${sanitizeDiscordIdentifier(previewImage)}\``,
    );
  }
  return lines.join("\n");
}

/**
 * Assemble the governed approval body. When the plan cannot fit Discord's 2000
 * character ceiling the plan is cut with an explicit marker and the action footer
 * is kept whole: a silently truncated plan is exactly how an owner ends up
 * approving something he never saw.
 */
export function renderGovernedApprovalBody({
  title,
  taskId,
  planSteps = [],
  expectedResult = "",
  commandToken,
}) {
  const head = [
    `### ${title}`,
    `**Task ID:** \`${sanitizeDiscordIdentifier(taskId)}\``,
    // The card asks; it never authorizes. This line is what keeps a redesign from
    // turning a request into an implied go-ahead.
    "**Trạng thái:** CHỜ DUYỆT (chưa được phép thực thi)",
    "",
    "**Lý do (kế hoạch chi tiết):**",
    planSteps.length > 0
      ? planSteps.join("\n")
      : "*(không có bước nào trong kế hoạch đã ghi)*",
    "",
    "**Kết quả dự kiến:**",
    expectedResult,
  ].join("\n");
  const footer = [
    "",
    "---",
    "**Thao tác dành cho User:**",
    `- Bấm **Approve** hoặc phản hồi \`APPROVE ${commandToken}\` để phê duyệt đưa vào hàng đợi thực thi.`,
    `- Bấm **Reject** hoặc phản hồi \`REJECT ${commandToken}\` để từ chối kế hoạch.`,
    `- Bấm **Request Revision** hoặc phản hồi \`REQUEST REVISION ${commandToken}\` để yêu cầu sửa kế hoạch.`,
  ].join("\n");
  if (head.length + footer.length <= DISCORD_BODY_LIMIT) {
    return `${head}${footer}`;
  }
  const budget =
    DISCORD_BODY_LIMIT - footer.length - PLAN_TRUNCATION_MARK.length;
  const cut = head.lastIndexOf("\n", Math.max(0, budget));
  return `${head.slice(0, cut > 0 ? cut : budget).trimEnd()}\n${PLAN_TRUNCATION_MARK}${footer}`;
}

/**
 * Formats an Approval Card for #approvals with exact fields and buttons.
 * Implements ACTIVE.md Section 8, canonical action IDs, and verifiable digests (F17, F23).
 */
export function formatGovernedApprovalCard({
  taskId,
  planVersion = "1.0",
  primary = "O1",
  executionPlan = "",
  risk = "Thấp",
  validationCriteria = "",
  queueStatus = "APPROVAL_PENDING",
  approvalId = null,
  scopeDigest = null,
  expiry = null,
}) {
  const cleanTask = sanitizeDiscordIdentifier(taskId || "TASK-UNKNOWN");
  const cleanPlanVer = sanitizeDiscordIdentifier(planVersion);
  const cleanPrimary = sanitizeDiscordIdentifier(primary);
  const cleanPlan = sanitizeDiscordText(executionPlan, {
    preserveIdentifiers: true,
  });
  const cleanRisk = sanitizeDiscordText(risk);
  const cleanCriteria = sanitizeDiscordText(
    validationCriteria || "Kiểm định kỹ thuật và nghiệp vụ",
    { preserveIdentifiers: true },
  );
  const cleanQueue = sanitizeDiscordIdentifier(queueStatus);
  const cleanApprovalId = approvalId
    ? sanitizeDiscordIdentifier(approvalId)
    : `appr-${cleanTask}-${cleanPlanVer}`;
  const actionApproveId = `zink:approval:approve:${cleanTask}:${cleanPlanVer}`;
  const actionRejectId = `zink:approval:reject:${cleanTask}:${cleanPlanVer}`;
  const actionRevisionId = `zink:approval:revision:${cleanTask}:${cleanPlanVer}`;

  const headerLines = [
    `### 🔖 [PHÊ DUYỆT THỰC THI] — Tác vụ ${cleanTask}`,
    "> **Lưu ý:** Chỉ User/Owner mới có thẩm quyền APPROVE hoặc REJECT kế hoạch thực thi.",
    "",
    "---",
    `**Mã tác vụ:** \`${cleanTask}\``,
    `**Mã phê duyệt (Approval ID):** \`${cleanApprovalId}\``,
    `**Phiên bản kế hoạch:** \`${cleanPlanVer}\``,
    `**Điều phối chính (Primary):** \`${cleanPrimary}\``,
    `**Đánh giá rủi ro:** \`${cleanRisk}\``,
    `**Trạng thái hàng đợi:** \`${cleanQueue}\``,
  ];

  if (scopeDigest) {
    headerLines.push(
      `**Mã băm phạm vi (Scope Digest):** \`${sanitizeDiscordIdentifier(scopeDigest)}\``,
    );
  }
  if (expiry) {
    headerLines.push(
      `**Thời hạn hiệu lực:** \`${sanitizeDiscordIdentifier(expiry)}\``,
    );
  }

  return [
    ...headerLines,
    "",
    "#### 📝 Kế hoạch Thực thi:",
    cleanPlan || "*(Chi tiết kế hoạch chưa được đính kèm)*",
    "",
    "#### ⚖️ Tiêu chí Nghiệm thu (Validation Criteria):",
    cleanCriteria,
    "",
    "---",
    "**Thao tác dành cho User (Buttons & Action IDs):**",
    `- Bấm **[APPROVE]** (\`${actionApproveId}\`) để phê duyệt đưa vào hàng đợi thực thi.`,
    `- Bấm **[REJECT]** (\`${actionRejectId}\`) để từ chối kế hoạch.`,
    `- Bấm **[REQUEST REVISION]** (\`${actionRevisionId}\`) để yêu cầu sửa đổi kế hoạch.`,
  ].join("\n");
}

/**
 * Formats a Result Review Card for #results with exact fields, preview, and buttons.
 * Implements ACTIVE.md Section 8 and verified validation findings (F14, F15, F16, F18, F20, F23).
 */
export function formatGovernedResultCard({
  taskId,
  attempt = 1,
  executionStatus = "EXECUTION_FINISHED",
  technicalValidation = "PASS",
  businessValidation = "PASS",
  preview = "",
  previewImage = null,
  artifact = "",
  keyFindings = "",
  resultDigest = null,
}) {
  const cleanTask = sanitizeDiscordIdentifier(taskId || "TASK-UNKNOWN");
  const cleanStatus = sanitizeDiscordIdentifier(executionStatus);
  const cleanTechVal = sanitizeDiscordIdentifier(technicalValidation);
  const cleanBizVal = sanitizeDiscordIdentifier(businessValidation);
  const cleanFindings = sanitizeDiscordText(
    keyFindings || "Hoàn thành xử lý dữ liệu.",
    { preserveIdentifiers: true },
  );
  const cleanArtifact = sanitizeDiscordText(
    artifact || "*(Không có tệp đính kèm)*",
    { preserveIdentifiers: true },
  );
  const previewImgSection =
    previewImage &&
    typeof previewImage === "string" &&
    !previewImage.includes("..")
      ? `\n🖼️ **Hình ảnh Preview Trực quan (Screenshot/Render):** \`${sanitizeDiscordIdentifier(path.basename(previewImage))}\` *(đã đính kèm)*\n`
      : "";
  const actionAcceptId = `zink:result:accept:${cleanTask}:${attempt}`;
  const actionRejectId = `zink:result:reject:${cleanTask}:${attempt}`;
  const actionRevisionId = `zink:result:revision:${cleanTask}:${attempt}`;

  const headerLines = [
    `### 📋 [NGHIỆM THU KẾT QUẢ] — Tác vụ ${cleanTask}`,
    "> **Lưu ý:** Chỉ User/Owner mới có quyền ACCEPT / COMPLETE hoặc REJECT kết quả.",
    "",
    "---",
    `**Mã tác vụ:** \`${cleanTask}\``,
    `**Lần thử nghiệm (Attempt):** \`#${attempt}\``,
    `**Trạng thái thực thi:** \`${cleanStatus}\``,
    `**Kiểm định Kỹ thuật:** \`${cleanTechVal}\``,
    `**Kiểm định Nghiệp vụ:** \`${cleanBizVal}\``,
  ];

  if (resultDigest) {
    headerLines.push(
      `**Mã băm kết quả (Result Digest):** \`${sanitizeDiscordIdentifier(resultDigest)}\``,
    );
  }

  return [
    ...headerLines,
    "",
    "#### 🔍 Dữ liệu Mẫu & Xem trước Thực tế (Actual Preview):",
    preview || "*(Không có dữ liệu trích xuất)*",
    previewImgSection,
    "#### 📦 Tệp Sản phẩm (Artifact):",
    `- ${cleanArtifact}`,
    "",
    "#### 💡 Phát hiện & Kết luận Chính (Key Findings):",
    cleanFindings,
    "",
    "---",
    "**Thao tác dành cho User (Buttons & Action IDs):**",
    `- Bấm **[ACCEPT / COMPLETE]** (\`${actionAcceptId}\`) để nghiệm thu và hoàn thành tác vụ.`,
    `- Bấm **[REJECT]** (\`${actionRejectId}\`) để bác bỏ kết quả.`,
    `- Bấm **[REQUEST REVISION]** (\`${actionRevisionId}\`) để yêu cầu chạy lại/tinh chỉnh.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Formats an Incident Card for #incidents with normalized lifecycle.
 * Implements ACTIVE.md Section 9 and sanitized status/severity (F13).
 * States: RECEIVED -> INVESTIGATING -> REPAIRING -> RESOLVED
 */
export function formatIncidentCard({
  incidentId,
  taskId = null,
  state = "RECEIVED",
  severity = "MEDIUM",
  observed = "",
  expected = "",
  action = "",
}) {
  const cleanIncId = sanitizeDiscordIdentifier(
    incidentId || "INC-" + Date.now(),
  );
  const cleanTask = taskId
    ? ` (Liên kết: \`${sanitizeDiscordIdentifier(taskId)}\`)`
    : "";
  const cleanState = sanitizeDiscordIdentifier(state);
  const cleanSeverity = sanitizeDiscordIdentifier(severity);

  return [
    `### 🚨 [SỰ CỐ] — ${cleanIncId}${cleanTask}`,
    `> **Trạng thái:** \`${cleanState}\` | **Mức độ:** \`${cleanSeverity}\``,
    "",
    "---",
    "**Hiện trạng quan sát (Observed):**",
    sanitizeDiscordText(
      observed || "Phát hiện bất thường trong quá trình thực thi.",
      { preserveIdentifiers: true },
    ),
    "",
    "**Trạng thái kỳ vọng (Expected):**",
    sanitizeDiscordText(
      expected || "Hoạt động bình thường theo hợp đồng quy định.",
      { preserveIdentifiers: true },
    ),
    "",
    "**Hành động xử lý & Khắc phục:**",
    sanitizeDiscordText(
      action || "Hệ thống đang tiến hành điều tra nguyên nhân.",
      { preserveIdentifiers: true },
    ),
  ].join("\n");
}

/**
 * Chunks a Discord message to respect platform text and line bounds (F10, F11).
 * Default limit is 2000 chars per Discord message specification.
 */
export function chunkDiscordMessage(
  text,
  { limit = 2000, maxLines = null } = {},
) {
  if (typeof text !== "string") return [];
  if (
    text.length <= limit &&
    (maxLines === null || text.split("\n").length <= maxLines)
  ) {
    return [text];
  }
  const chunks = [];
  const lines = text.split("\n");
  let currentChunk = [];
  let currentLength = 0;

  for (const line of lines) {
    const lineLen = line.length + 1;
    const lineCountExceeded =
      maxLines !== null && currentChunk.length >= maxLines;
    if (
      (currentLength + lineLen > limit || lineCountExceeded) &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk.join("\n"));
      currentChunk = [];
      currentLength = 0;
    }
    if (line.length > limit) {
      let remaining = line;
      while (remaining.length > 0) {
        chunks.push(remaining.slice(0, limit));
        remaining = remaining.slice(limit);
      }
    } else {
      currentChunk.push(line);
      currentLength += lineLen;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join("\n"));
  }
  return chunks;
}
