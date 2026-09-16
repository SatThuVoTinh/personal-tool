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
    const trimmed = rawInput.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Not valid JSON, treat as raw text
        textContent = rawInput;
      }
    } else {
      textContent = rawInput;
    }
  }

  if (parsed) {
    // If it's a governed envelope/receipt
    const target = parsed.payload ?? parsed;
    textContent = target.output ?? target.text ?? target.content ?? target.message ?? "";
    if (Array.isArray(target.assumptions) && target.assumptions.length > 0) {
      assumptions = target.assumptions;
    }
    if (Array.isArray(target.limitations) && target.limitations.length > 0) {
      limitations = target.limitations;
    }

    // Fallback if output was empty but status is present
    if (!textContent && (target.outcome_claim || parsed.outcome_claim)) {
      const status = target.outcome_claim || parsed.outcome_claim;
      textContent = `Tác vụ hoàn thành với trạng thái: ${status}`;
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
      sections.push(`\n**Giả định:**\n${cleanAssumptions.map((a) => `• ${a}`).join("\n")}`);
    }
  }

  if (limitations.length > 0) {
    const cleanLimitations = limitations
      .map((l) => sanitizeDiscordText(String(l)))
      .filter(Boolean);
    if (cleanLimitations.length > 0) {
      sections.push(`\n**Hạn chế:**\n${cleanLimitations.map((l) => `• ${l}`).join("\n")}`);
    }
  }

  return sections.join("\n");
}

export function formatError(errorOrCode, optsOrName = "Zink Bot") {
  const agentName =
    typeof optsOrName === "object" && optsOrName !== null
      ? optsOrName.agentName ?? "Zink Bot"
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
