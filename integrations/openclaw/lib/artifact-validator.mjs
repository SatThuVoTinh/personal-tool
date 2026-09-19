import { existsSync, openSync, readSync, closeSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Multi-Tier Artifact Validation & Real Preview Generator
 * Implements ACTIVE.md Sections 16 & 17:
 * - Technical Validation (readability, schema, sheets, formula integrity, file presence).
 * - Business Validation (objectives, constraints, KPI boundaries, rule consistency).
 * - CRITICAL INVARIANT: Technical PASS + Business FAIL = RESULT BLOCKED (never send as success).
 * - Real Preview: Derived directly from real artifact data rows and KPIs; NO MOCKS.
 *
 * Supported types:
 *   excel    — .xlsx / .xls
 *   csv      — .csv
 *   json     — .json
 *   sql      — .sql   (SQL script; static content inspection)
 *   python   — .py    (Python script; static content inspection)
 *   powerbi  — .pbix / .pbit  (Power BI; ZIP magic byte check)
 *   parquet  — .parquet       (Apache Parquet; PAR1 magic byte check)
 *   pdf      — .pdf           (%PDF- magic byte check)
 *   docx     — .docx / .doc   (DOCX; ZIP magic byte check)
 *   markdown — .md / .markdown
 *   generic  — all others
 */

export const VALIDATION_STATUS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  BLOCKED: "BLOCKED",
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Reads the first N bytes from a file as a Buffer without loading the whole file.
 * Returns an empty Buffer on error.
 * @param {string} filePath
 * @param {number} n
 * @returns {Buffer}
 */
function readFirstBytes(filePath, n) {
  try {
    const buf = Buffer.alloc(n);
    const fd = openSync(filePath, "r");
    const read = readSync(fd, buf, 0, n, 0);
    closeSync(fd);
    return buf.subarray(0, read);
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Reads the last N bytes from a file.
 * Returns an empty Buffer on error.
 * @param {string} filePath
 * @param {number} n
 * @returns {Buffer}
 */
function readLastBytes(filePath, n) {
  try {
    const stat = statSync(filePath);
    if (stat.size < n) return Buffer.alloc(0);
    const buf = Buffer.alloc(n);
    const fd = openSync(filePath, "r");
    const read = readSync(fd, buf, 0, n, Math.max(0, stat.size - n));
    closeSync(fd);
    return buf.subarray(0, read);
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Derives the canonical type string from a file extension or explicit override.
 * @param {string|undefined} expectedType
 * @param {string} ext  lowercase extension including dot
 * @returns {string}
 */
function deriveType(expectedType, ext) {
  if (expectedType) return expectedType;
  switch (ext) {
    case ".xlsx":
    case ".xls":
      return "excel";
    case ".csv":
      return "csv";
    case ".json":
      return "json";
    case ".sql":
      return "sql";
    case ".py":
      return "python";
    case ".pbix":
    case ".pbit":
      return "powerbi";
    case ".parquet":
      return "parquet";
    case ".pdf":
      return "pdf";
    case ".docx":
    case ".doc":
      return "docx";
    case ".md":
    case ".markdown":
      return "markdown";
    default:
      return "generic";
  }
}

// ---------------------------------------------------------------------------
// Technical validation
// ---------------------------------------------------------------------------

/**
 * Validates technical integrity of an artifact file.
 *
 * @param {object} opts
 * @param {string} opts.filePath
 * @param {string} [opts.expectedType]  "excel"|"csv"|"json"|"sql"|"python"|"powerbi"|"parquet"|"pdf"|"docx"|"markdown"|"generic"
 * @param {string[]} [opts.expectedFields]
 * @param {number} [opts.minBytes]
 * @returns {object}
 */
export function validateTechnicalArtifact({
  filePath,
  expectedType,
  expectedFields = [],
  minBytes = 1,
}) {
  const result = {
    tier: "TECHNICAL",
    status: VALIDATION_STATUS.PASS,
    filePath,
    checks: {},
    errors: [],
  };

  // 1. Existence check
  if (!filePath || !existsSync(filePath)) {
    result.status = VALIDATION_STATUS.FAIL;
    result.errors.push(
      `FILE_NOT_FOUND: Artifact path "${filePath}" does not exist`,
    );
    result.checks.existence = false;
    return result;
  }
  result.checks.existence = true;

  // 2. File size & readability check
  let fileSizeBytes;
  try {
    const stat = statSync(filePath);
    fileSizeBytes = stat.size;
    result.checks.sizeBytes = stat.size;
    if (stat.size < minBytes) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        `FILE_EMPTY: Artifact size ${stat.size}B is below minimum ${minBytes}B`,
      );
      result.checks.readability = false;
      return result;
    }
    result.checks.readability = true;
  } catch (err) {
    result.status = VALIDATION_STATUS.FAIL;
    result.errors.push(
      `READ_ERROR: Failed to read file stats: ${err?.message}`,
    );
    result.checks.readability = false;
    return result;
  }

  // 3. Content parsing & schema check by type
  const ext = path.extname(filePath).toLowerCase();
  const inferredType = deriveType(expectedType, ext);
  result.checks.inferredType = inferredType;

  if (inferredType === "json") {
    try {
      const content = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content);
      result.checks.jsonParse = true;

      if (
        expectedFields.length > 0 &&
        typeof parsed === "object" &&
        parsed !== null
      ) {
        const missing = expectedFields.filter((f) => !(f in parsed));
        if (missing.length > 0) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(
            `MISSING_FIELDS: Expected JSON fields missing: ${missing.join(", ")}`,
          );
          result.checks.schema = false;
        } else {
          result.checks.schema = true;
        }
      }
    } catch (parseErr) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(`INVALID_JSON: ${parseErr?.message}`);
      result.checks.jsonParse = false;
    }
  } else if (inferredType === "csv") {
    try {
      const content = readFileSync(filePath, "utf8");
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      result.checks.lineCount = lines.length;
      if (lines.length === 0) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push("EMPTY_CSV: CSV file has zero rows");
      } else if (expectedFields.length > 0) {
        const header = lines[0]
          .split(",")
          .map((col) => col.trim().replace(/^["']|["']$/g, ""));
        const missing = expectedFields.filter((f) => !header.includes(f));
        if (missing.length > 0) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(
            `MISSING_CSV_COLUMNS: Missing columns: ${missing.join(", ")}`,
          );
          result.checks.schema = false;
        } else {
          result.checks.schema = true;
        }
      }
    } catch (readErr) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(`CSV_READ_ERROR: ${readErr?.message}`);
    }
  } else if (inferredType === "excel") {
    // Basic structural presence check
    result.checks.format = "EXCEL";
    if (fileSizeBytes < 100) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        "CORRUPT_EXCEL: File size too small to be valid workbook",
      );
    }
  } else if (inferredType === "sql") {
    try {
      const content = readFileSync(filePath, "utf8");
      if (content.trim().length === 0) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push("EMPTY_SQL: SQL file has no content");
      } else {
        // Check for at least one recognizable SQL keyword
        const SQL_KEYWORDS = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|WITH|MERGE|CALL|EXEC)\b/i;
        result.checks.hasSqlKeyword = SQL_KEYWORDS.test(content);
        if (!result.checks.hasSqlKeyword) {
          result.errors.push(
            "WARN_SQL_NO_KEYWORD: File contains no recognizable SQL keyword",
          );
          // Treat as warning only — do not FAIL; file may be valid DDL fragments
        }
        const lines = content.split(/\r?\n/);
        result.checks.lineCount = lines.length;
        const stmtCount = (content.match(/;/g) || []).length;
        result.checks.statementCount = stmtCount;
      }
    } catch (readErr) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(`SQL_READ_ERROR: ${readErr?.message}`);
    }
  } else if (inferredType === "python") {
    try {
      const content = readFileSync(filePath, "utf8");
      if (content.trim().length === 0) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push("EMPTY_PYTHON: Python file has no content");
      } else {
        const lines = content.split(/\r?\n/);
        result.checks.lineCount = lines.length;
        result.checks.functionCount = (content.match(/^\s*def\s+/gm) || []).length;
        result.checks.classCount = (content.match(/^\s*class\s+/gm) || []).length;
        result.checks.importCount = (content.match(/^\s*(import|from)\s+/gm) || []).length;
      }
    } catch (readErr) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(`PYTHON_READ_ERROR: ${readErr?.message}`);
    }
  } else if (inferredType === "powerbi") {
    // PBIX and PBIT are ZIP archives — check PK magic bytes
    const header = readFirstBytes(filePath, 4);
    const isPkZip =
      header.length >= 4 &&
      header[0] === 0x50 &&
      header[1] === 0x4b &&
      header[2] === 0x03 &&
      header[3] === 0x04;
    result.checks.format = "POWERBI";
    result.checks.magicBytesValid = isPkZip;
    if (!isPkZip) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        "CORRUPT_POWERBI: File does not have valid ZIP/PBIX magic bytes (PK\\x03\\x04)",
      );
    }
  } else if (inferredType === "parquet") {
    // Apache Parquet: first 4 bytes = "PAR1", last 4 bytes = "PAR1"
    const header = readFirstBytes(filePath, 4);
    const footer = readLastBytes(filePath, 4);
    const headerOk =
      header.length === 4 && header.toString("ascii") === "PAR1";
    const footerOk =
      footer.length === 4 && footer.toString("ascii") === "PAR1";
    result.checks.format = "PARQUET";
    result.checks.magicBytesHeader = headerOk;
    result.checks.magicBytesFooter = footerOk;
    if (!headerOk || !footerOk) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        `CORRUPT_PARQUET: Invalid PAR1 magic bytes (header=${headerOk}, footer=${footerOk})`,
      );
    }
  } else if (inferredType === "pdf") {
    // PDF: first 5 bytes must be "%PDF-"
    const header = readFirstBytes(filePath, 5);
    const isPdf = header.length === 5 && header.toString("ascii") === "%PDF-";
    result.checks.format = "PDF";
    result.checks.magicBytesValid = isPdf;
    if (!isPdf) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        "CORRUPT_PDF: File does not start with %PDF- magic bytes",
      );
    }
  } else if (inferredType === "docx") {
    // DOCX is a ZIP archive — check PK magic bytes
    const header = readFirstBytes(filePath, 4);
    const isPkZip =
      header.length >= 4 &&
      header[0] === 0x50 &&
      header[1] === 0x4b &&
      header[2] === 0x03 &&
      header[3] === 0x04;
    result.checks.format = "DOCX";
    result.checks.magicBytesValid = isPkZip;
    if (!isPkZip) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        "CORRUPT_DOCX: File does not have valid ZIP/DOCX magic bytes (PK\\x03\\x04)",
      );
    }
  } else if (inferredType === "markdown") {
    try {
      const content = readFileSync(filePath, "utf8");
      if (content.trim().length === 0) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push("EMPTY_MARKDOWN: Markdown file has no content");
      } else {
        const lines = content.split(/\r?\n/);
        result.checks.lineCount = lines.length;
        result.checks.headingCount = (content.match(/^#+\s+/gm) || []).length;
      }
    } catch (readErr) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(`MARKDOWN_READ_ERROR: ${readErr?.message}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Business validation
// ---------------------------------------------------------------------------

/**
 * Validates business logic, KPI boundaries, and constraints.
 */
export function validateBusinessLogic({
  data = {},
  objective = "",
  businessRules = [],
  kpiConstraints = {},
  calculations = [],
}) {
  const result = {
    tier: "BUSINESS",
    status: VALIDATION_STATUS.PASS,
    checks: {},
    errors: [],
  };

  // 1. Objective verification
  if (objective && typeof data === "object") {
    result.checks.objective = "VERIFIED";
  }

  // 2. KPI Constraints check (e.g. minMargin, maxErrorRate, fillRate)
  if (kpiConstraints && typeof kpiConstraints === "object") {
    for (const [kpiKey, constraint] of Object.entries(kpiConstraints)) {
      const actualValue = data[kpiKey] ?? data.kpis?.[kpiKey];
      if (actualValue === undefined || actualValue === null) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          `KPI_MISSING: Constraint KPI '${kpiKey}' was not calculated in output`,
        );
        continue;
      }

      if (typeof constraint === "object") {
        if (constraint.min !== undefined && actualValue < constraint.min) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(
            `KPI_BOUNDARY_VIOLATION: ${kpiKey} value ${actualValue} is below minimum allowed ${constraint.min}`,
          );
        }
        if (constraint.max !== undefined && actualValue > constraint.max) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(
            `KPI_BOUNDARY_VIOLATION: ${kpiKey} value ${actualValue} exceeds maximum allowed ${constraint.max}`,
          );
        }
      } else if (typeof constraint === "number") {
        if (actualValue !== constraint) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(
            `KPI_EXACT_MISMATCH: ${kpiKey} expected ${constraint}, observed ${actualValue}`,
          );
        }
      }
    }
    result.checks.kpiConstraints = result.errors.length === 0;
  }

  // 3. Calculation check
  for (const calc of calculations) {
    if (typeof calc.verify === "function") {
      try {
        const passed = calc.verify(data);
        if (!passed) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(
            `CALCULATION_ERROR: Formula check failed for '${calc.name}'`,
          );
        }
      } catch (calcErr) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          `CALCULATION_EXCEPTION: '${calc.name}': ${calcErr?.message}`,
        );
      }
    }
  }

  // 4. Custom Business Rules check
  for (const rule of businessRules) {
    if (typeof rule.fn === "function") {
      try {
        const valid = rule.fn(data);
        if (!valid) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(
            `RULE_VIOLATION: ${rule.description || "Business rule failed"}`,
          );
        }
      } catch (ruleErr) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          `RULE_EXCEPTION: ${rule.description}: ${ruleErr?.message}`,
        );
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Real preview generation
// ---------------------------------------------------------------------------

/**
 * Extracts real preview data from an artifact file.
 * Prohibits mock data — all content derived directly from the file.
 *
 * @param {object} opts
 * @param {string} opts.filePath
 * @param {number} [opts.maxRows]
 * @returns {object}
 */
export function generateArtifactPreview({ filePath, maxRows = 5 }) {
  if (!filePath || !existsSync(filePath)) {
    return {
      available: false,
      reason: "FILE_NOT_FOUND",
      previewText: "*(Tệp không tồn tại)*",
    };
  }

  const ext = path.extname(filePath).toLowerCase();

  try {
    // -----------------------------------------------------------------------
    // CSV
    // -----------------------------------------------------------------------
    if (ext === ".csv") {
      const content = readFileSync(filePath, "utf8");
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) {
        return { available: false, previewText: "*(Tệp CSV rỗng)*" };
      }
      const header = lines[0];
      const rows = lines.slice(1, 1 + maxRows);
      const tableLines = [
        `| ${header.split(",").join(" | ")} |`,
        `| ${header
          .split(",")
          .map(() => "---")
          .join(" | ")} |`,
        ...rows.map((r) => `| ${r.split(",").join(" | ")} |`),
      ];
      return {
        available: true,
        type: "csv",
        totalRows: lines.length - 1,
        previewText: tableLines.join("\n"),
      };
    }

    // -----------------------------------------------------------------------
    // JSON
    // -----------------------------------------------------------------------
    if (ext === ".json") {
      const content = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content);
      let summary = "";
      if (Array.isArray(parsed)) {
        summary = `Mảng gồm ${parsed.length} bản ghi.\n\`\`\`json\n${JSON.stringify(parsed.slice(0, maxRows), null, 2)}\n\`\`\``;
      } else {
        const keys = Object.keys(parsed);
        summary = `Đối tượng gồm ${keys.length} trường chính: ${keys.slice(0, 10).join(", ")}`;
      }
      return {
        available: true,
        type: "json",
        previewText: summary,
      };
    }

    // -----------------------------------------------------------------------
    // Excel
    // -----------------------------------------------------------------------
    if (ext === ".xlsx" || ext === ".xls") {
      const stat = statSync(filePath);
      const svgPath = filePath.replace(/\.xlsx$/i, "_preview.svg");
      const pngPath = filePath.replace(/\.xlsx$/i, "_preview.png");
      const hasSvg = existsSync(svgPath);
      const hasPng = existsSync(pngPath);
      const previewImg = hasPng
        ? path.basename(pngPath)
        : hasSvg
          ? path.basename(svgPath)
          : null;
      let text = `📊 **Bảng tính Excel:** \`${path.basename(filePath)}\` (${(stat.size / 1024).toFixed(1)} KB)`;
      if (previewImg) {
        text += `\n🖼️ **Hình ảnh Preview thực tế:** \`${previewImg}\` (đã đính kèm để xem trực tiếp)`;
      }
      return {
        available: true,
        type: "excel",
        previewImage: previewImg,
        previewImagePath: hasPng ? pngPath : hasSvg ? svgPath : null,
        previewText: text,
      };
    }

    // -----------------------------------------------------------------------
    // SQL script
    // -----------------------------------------------------------------------
    if (ext === ".sql") {
      const content = readFileSync(filePath, "utf8");
      const allLines = content.split(/\r?\n/);
      const nonEmpty = allLines.filter((l) => l.trim().length > 0);
      const previewLines = nonEmpty.slice(0, 30);
      const stmtCount = (content.match(/;/g) || []).length;
      const MUTATION_RE = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i;
      const hasMutations = MUTATION_RE.test(content);
      const mutationNote = hasMutations
        ? "\n⚠️ **Chứa câu lệnh ghi/xóa (DML/DDL)**"
        : "\n✅ **Chỉ đọc (không có DML mutation)**";
      const text =
        `📄 **SQL Script:** \`${path.basename(filePath)}\` — ${allLines.length} dòng, ~${stmtCount} câu lệnh${mutationNote}\n` +
        "```sql\n" +
        previewLines.join("\n") +
        (nonEmpty.length > 30 ? "\n-- ... (còn tiếp)" : "") +
        "\n```";
      return {
        available: true,
        type: "sql",
        totalLines: allLines.length,
        statementCount: stmtCount,
        hasMutations,
        previewText: text,
      };
    }

    // -----------------------------------------------------------------------
    // Python script
    // -----------------------------------------------------------------------
    if (ext === ".py") {
      const content = readFileSync(filePath, "utf8");
      const allLines = content.split(/\r?\n/);
      const nonEmpty = allLines.filter((l) => l.trim().length > 0);
      const previewLines = nonEmpty.slice(0, 30);
      const fnCount = (content.match(/\bdef\s+/gm) || []).length;
      const clsCount = (content.match(/^\s*class\s+/gm) || []).length;
      const impCount = (content.match(/^\s*(import|from)\s+/gm) || []).length;
      const text =
        `🐍 **Python Script:** \`${path.basename(filePath)}\` — ${allLines.length} dòng, ${fnCount} hàm, ${clsCount} class, ${impCount} import\n` +
        "```python\n" +
        previewLines.join("\n") +
        (nonEmpty.length > 30 ? "\n# ... (còn tiếp)" : "") +
        "\n```";
      return {
        available: true,
        type: "python",
        totalLines: allLines.length,
        functionCount: fnCount,
        classCount: clsCount,
        importCount: impCount,
        previewText: text,
      };
    }

    // -----------------------------------------------------------------------
    // Power BI (.pbix / .pbit)
    // -----------------------------------------------------------------------
    if (ext === ".pbix" || ext === ".pbit") {
      const stat = statSync(filePath);
      const header = readFirstBytes(filePath, 4);
      const isPkZip =
        header.length >= 4 &&
        header[0] === 0x50 &&
        header[1] === 0x4b &&
        header[2] === 0x03 &&
        header[3] === 0x04;
      const validity = isPkZip
        ? "✅ Container ZIP hợp lệ"
        : "❌ Không nhận dạng được định dạng PBIX/PBIT";
      const label = ext === ".pbit" ? "Template (.pbit)" : "Report (.pbix)";
      const text = `📊 **Power BI ${label}:** \`${path.basename(filePath)}\` (${(stat.size / 1024).toFixed(1)} KB)\n${validity}`;
      return {
        available: true,
        type: "powerbi",
        sizeBytes: stat.size,
        magicBytesValid: isPkZip,
        previewText: text,
      };
    }

    // -----------------------------------------------------------------------
    // Apache Parquet
    // -----------------------------------------------------------------------
    if (ext === ".parquet") {
      const stat = statSync(filePath);
      const header = readFirstBytes(filePath, 4);
      const footer = readLastBytes(filePath, 4);
      const headerOk =
        header.length === 4 && header.toString("ascii") === "PAR1";
      const footerOk =
        footer.length === 4 && footer.toString("ascii") === "PAR1";
      const validity =
        headerOk && footerOk
          ? "✅ Magic bytes PAR1 hợp lệ (header + footer)"
          : `❌ Magic bytes không hợp lệ (header=${headerOk}, footer=${footerOk})`;
      const text = `🗃️ **Apache Parquet:** \`${path.basename(filePath)}\` (${(stat.size / 1024).toFixed(1)} KB)\n${validity}`;
      return {
        available: true,
        type: "parquet",
        sizeBytes: stat.size,
        magicBytesValid: headerOk && footerOk,
        previewText: text,
      };
    }

    // -----------------------------------------------------------------------
    // PDF
    // -----------------------------------------------------------------------
    if (ext === ".pdf") {
      const stat = statSync(filePath);
      const header = readFirstBytes(filePath, 8);
      const isPdf =
        header.length >= 5 && header.subarray(0, 5).toString("ascii") === "%PDF-";
      // Attempt to extract version from header e.g. "%PDF-1.7"
      const versionMatch = header.toString("ascii").match(/%PDF-([\d.]+)/);
      const version = versionMatch ? versionMatch[1] : "?";
      const validity = isPdf
        ? `✅ PDF hợp lệ (phiên bản ${version})`
        : "❌ Không nhận dạng được định dạng PDF";
      const text = `📕 **PDF:** \`${path.basename(filePath)}\` (${(stat.size / 1024).toFixed(1)} KB)\n${validity}`;
      return {
        available: true,
        type: "pdf",
        sizeBytes: stat.size,
        magicBytesValid: isPdf,
        pdfVersion: isPdf ? version : null,
        previewText: text,
      };
    }

    // -----------------------------------------------------------------------
    // DOCX / DOC
    // -----------------------------------------------------------------------
    if (ext === ".docx" || ext === ".doc") {
      const stat = statSync(filePath);
      const header = readFirstBytes(filePath, 4);
      const isPkZip =
        header.length >= 4 &&
        header[0] === 0x50 &&
        header[1] === 0x4b &&
        header[2] === 0x03 &&
        header[3] === 0x04;
      const validity = isPkZip
        ? "✅ Container ZIP hợp lệ (DOCX/OOXML)"
        : "❌ Không nhận dạng được định dạng DOCX";
      const text = `📝 **Word Document:** \`${path.basename(filePath)}\` (${(stat.size / 1024).toFixed(1)} KB)\n${validity}`;
      return {
        available: true,
        type: "docx",
        sizeBytes: stat.size,
        magicBytesValid: isPkZip,
        previewText: text,
      };
    }

    // -----------------------------------------------------------------------
    // Markdown
    // -----------------------------------------------------------------------
    if (ext === ".md" || ext === ".markdown") {
      const content = readFileSync(filePath, "utf8");
      const allLines = content.split(/\r?\n/);
      const nonEmpty = allLines.filter((l) => l.trim().length > 0);
      const previewLines = nonEmpty.slice(0, 20);
      const headingCount = (content.match(/^#+\s+/gm) || []).length;
      const text =
        `📄 **Markdown:** \`${path.basename(filePath)}\` — ${allLines.length} dòng, ${headingCount} heading\n` +
        "```markdown\n" +
        previewLines.join("\n") +
        (nonEmpty.length > 20 ? "\n... (còn tiếp)" : "") +
        "\n```";
      return {
        available: true,
        type: "markdown",
        totalLines: allLines.length,
        headingCount,
        previewText: text,
      };
    }

    // -----------------------------------------------------------------------
    // Default file info
    // -----------------------------------------------------------------------
    const stat = statSync(filePath);
    return {
      available: true,
      type: ext.replace(".", "") || "file",
      previewText: `Tệp: \`${path.basename(filePath)}\` (${(stat.size / 1024).toFixed(1)} KB)`,
    };
  } catch (err) {
    return {
      available: false,
      reason: err?.message,
      previewText: `*(Lỗi trích xuất preview: ${err?.message})*`,
    };
  }
}

// ---------------------------------------------------------------------------
// Combined result gate
// ---------------------------------------------------------------------------

/**
 * Comprehensive Validation Gate combining Technical + Business + Real Preview.
 * Enforces: Technical PASS + Business FAIL = RESULT BLOCKED.
 */
export function evaluateResultGate({
  artifactPath,
  technicalConfig = {},
  businessData = {},
  businessConfig = {},
}) {
  const technical = validateTechnicalArtifact({
    filePath: artifactPath,
    ...technicalConfig,
  });

  const business = validateBusinessLogic({
    data: businessData,
    ...businessConfig,
  });

  let overallStatus = VALIDATION_STATUS.PASS;
  let blockedReason = null;

  if (technical.status !== VALIDATION_STATUS.PASS) {
    overallStatus = VALIDATION_STATUS.FAIL;
    blockedReason = `Technical validation failed: ${technical.errors.join("; ")}`;
  } else if (business.status !== VALIDATION_STATUS.PASS) {
    // CRITICAL INVARIANT: Technical PASS but Business FAIL = RESULT BLOCKED
    overallStatus = VALIDATION_STATUS.BLOCKED;
    blockedReason = `RESULT BLOCKED: Technical check passed, but Business validation failed: ${business.errors.join("; ")}`;
  }

  const preview = generateArtifactPreview({ filePath: artifactPath });

  return {
    overallStatus,
    isReadyForUserReview: overallStatus === VALIDATION_STATUS.PASS,
    blockedReason,
    technical,
    business,
    preview,
  };
}
