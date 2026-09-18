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
 * Strips all internal governance and sensitive tokens from text.
 */
export function sanitizeDiscordText(text) {
  if (typeof text !== "string") return "";
  let sanitized = text;
  for (const pattern of BANNED_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized.trim();
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
      const firstBrace = trimmed.indexOf("{");
      const lastBrace = trimmed.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
        } catch {
          textContent = rawInput;
        }
      } else {
        textContent = rawInput;
      }
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
      candidate.action === "propose" ||
      candidate.proposal ||
      candidate.proposal_id ||
      candidate.exact_operation ||
      candidate.approval_id ||
      candidate.type === "approval"
    ) {
      return formatApprovalNotification(candidate, { agentName });
    }
    if (
      candidate.incident_id ||
      candidate.severity ||
      candidate.observed_state ||
      candidate.type === "incident"
    ) {
      return formatIncidentNotification(candidate, { agentName });
    }
    if (
      candidate.result_id ||
      candidate.deliverables ||
      candidate.workflow_status ||
      candidate.type === "result"
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
  const cleanTitle = sanitizeDiscordText(title || "Thông báo Hệ thống");
  const cleanPurpose = sanitizeDiscordText(
    purpose || "Thông báo từ tác vụ Zink",
  );
  const lines = [
    `### ${tag} ${cleanTitle}`,
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
