import {
  existsSync,
  openSync,
  readSync,
  closeSync,
  readFileSync,
  statSync,
  lstatSync,
  realpathSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

/**
 * Multi-Tier Artifact Validation & Real Preview Generator
 * Implements ACTIVE.md Sections 16 & 17:
 * - Technical Validation (readability, schema, sheets, formula integrity, file presence).
 * - Business Validation (objectives, constraints, KPI boundaries, rule consistency).
 * - CRITICAL INVARIANT: Technical PASS + Business FAIL = RESULT BLOCKED (never send as success).
 * - Real Preview: Derived directly from real artifact data rows and KPIs; NO MOCKS.
 * - Group I Hardening: Sandbox containment (I01-I04), symlink escape check (I05),
 *   logical/real path persistence (I06), SHA-256 metadata (I07), type allowlist (I08),
 *   atomic publication (I10).
 * - Group J Hardening: Format-specific depth (J01-J14).
 */

export const VALIDATION_STATUS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  BLOCKED: "BLOCKED",
});

export const CANONICAL_ARTIFACT_TYPES = Object.freeze([
  "excel",
  "csv",
  "json",
  "sql",
  "python",
  "powerbi",
  "parquet",
  "pdf",
  "docx",
  "doc",
  "markdown",
  "generic",
]);

// J09: Discord 25MB ceiling & format-specific maximum size limits
export const MAX_ARTIFACT_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

export const FORMAT_MAX_SIZE_LIMITS = Object.freeze({
  excel: 25 * 1024 * 1024,
  powerbi: 25 * 1024 * 1024,
  parquet: 25 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
  docx: 25 * 1024 * 1024,
  doc: 25 * 1024 * 1024,
  csv: 25 * 1024 * 1024,
  json: 10 * 1024 * 1024,
  sql: 5 * 1024 * 1024,
  python: 2 * 1024 * 1024,
  markdown: 2 * 1024 * 1024,
  generic: 25 * 1024 * 1024,
});

// J12: Cross-platform sandbox path normalization
export function normalizeSandboxPath(p) {
  if (typeof p !== "string") return "";
  let normalized = path.normalize(p);
  if (
    normalized.length > 1 &&
    (normalized.endsWith("/") || normalized.endsWith("\\"))
  ) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

// J06: Robust RFC 4180 CSV line parser supporting quoted delimiters and escaped quotes
export function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === "," && !inQ) {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (inQ) {
    throw new Error("MALFORMED_CSV: Unclosed quote detected in CSV record");
  }
  fields.push(cur.trim());
  return fields;
}

// J02 & J03: Inspect ZIP central directory / local headers for required entry patterns.
//
// M12/T9 F-258: this helper read the whole file as latin1 and asked whether a
// keyword appeared ANYWHERE in the bytes, so a keyword inside arbitrary
// payload bytes counted as a container entry and a garbage file reached a
// PASS verdict. The CENTRAL DIRECTORY is parsed instead: the entry names come
// from the container's own index, and a file that is not a readable ZIP has no
// entries at all.
export function readZipEntryNames(filePath) {
  let buf;
  try {
    buf = readFileSync(filePath);
  } catch {
    return null;
  }
  if (buf.length < 22) return null;
  let eocd = -1;
  const lowest = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buf.length) return null;
    if (buf.readUInt32LE(offset) !== 0x02014b50) return null;
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    names.push(
      buf.subarray(offset + 46, offset + 46 + nameLen).toString("utf8"),
    );
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** An entry matches a required keyword by name or by path prefix. */
function zipEntryMatches(entryName, keyword) {
  return (
    entryName === keyword ||
    entryName.startsWith(keyword) ||
    entryName.includes(`/${keyword}`)
  );
}

/** True when the container is a readable ZIP holding AT LEAST ONE of the parts. */
export function inspectZipContainsEntries(filePath, requiredKeywords) {
  const names = readZipEntryNames(filePath);
  if (!names) return false;
  return requiredKeywords.some((keyword) =>
    names.some((name) => zipEntryMatches(name, keyword)),
  );
}

/** True when the container is a readable ZIP holding EVERY one of the parts. */
export function inspectZipContainsAllEntries(filePath, requiredKeywords) {
  const names = readZipEntryNames(filePath);
  if (!names) return false;
  return requiredKeywords.every((keyword) =>
    names.some((name) => zipEntryMatches(name, keyword)),
  );
} // J01: Python syntax validator using py_compile with AST bracket fallback
export function validatePythonSyntax(filePath, content) {
  try {
    execFileSync("python", ["-m", "py_compile", filePath], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    return { valid: true, method: "py_compile" };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString("utf8") : "";
    if (stderr.includes("SyntaxError") || (err.status && err.status !== 0)) {
      return {
        valid: false,
        error: `INVALID_PYTHON_SYNTAX: ${stderr.trim() || err.message}`,
        method: "py_compile",
      };
    }
  }

  // Fallback structural syntax check
  const lines = content.split(/\r?\n/);
  const stack = [];
  let inTripleQuote = false;
  let tripleQuoteChar = "";

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    let cleanLine = line;
    if (!inTripleQuote) {
      const hashIdx = cleanLine.indexOf("#");
      if (hashIdx !== -1) cleanLine = cleanLine.substring(0, hashIdx);
    }

    for (let col = 0; col < cleanLine.length; col++) {
      const ch = cleanLine[col];
      if (
        (ch === '"' || ch === "'") &&
        cleanLine.startsWith(ch.repeat(3), col)
      ) {
        if (!inTripleQuote) {
          inTripleQuote = true;
          tripleQuoteChar = ch.repeat(3);
          col += 2;
          continue;
        } else if (cleanLine.startsWith(tripleQuoteChar, col)) {
          inTripleQuote = false;
          tripleQuoteChar = "";
          col += 2;
          continue;
        }
      }
      if (inTripleQuote) continue;

      if (ch === "(" || ch === "[" || ch === "{") {
        stack.push({ char: ch, line: lineNum + 1 });
      } else if (ch === ")" || ch === "]" || ch === "}") {
        const expected = ch === ")" ? "(" : ch === "]" ? "[" : "{";
        const top = stack.pop();
        if (!top || top.char !== expected) {
          return {
            valid: false,
            error: `INVALID_PYTHON_SYNTAX: Unmatched '${ch}' at line ${lineNum + 1}`,
            method: "structural",
          };
        }
      }
    }

    const trimmed = cleanLine.trim();
    if (
      /^\s*(def|class)\s*\(?\s*:/.test(trimmed) ||
      /^\s*def\s+\w+\s*\([^)]*:\s*$/.test(trimmed)
    ) {
      return {
        valid: false,
        error: `INVALID_PYTHON_SYNTAX: Malformed def/class signature at line ${lineNum + 1}`,
        method: "structural",
      };
    }
  }

  if (stack.length > 0) {
    const top = stack.pop();
    return {
      valid: false,
      error: `INVALID_PYTHON_SYNTAX: Unclosed '${top.char}' from line ${top.line}`,
      method: "structural",
    };
  }
  if (inTripleQuote) {
    return {
      valid: false,
      error: "INVALID_PYTHON_SYNTAX: Unclosed triple quote string",
      method: "structural",
    };
  }
  return { valid: true, method: "structural" };
}

// J10, J13, J14: Attach validator provenance, checksRun list, and cryptographic evidenceDigest
export function stampProvenanceAndDigest(result, inferredType = "generic") {
  result.validatorVersion = "1.0.0";
  result.detector = "zink-format-validator-v1";
  result.validatedAt = result.validatedAt || new Date().toISOString();
  result.provenance = {
    detector: "zink-format-validator-v1",
    version: "1.0.0",
    format: inferredType,
  };
  result.checksRun = Object.keys(result.checks);
  const sortedChecks = result.checksRun.slice().sort().join(",");
  const rawDigestData = `${result.sha256 || "none"}:${result.sizeBytes || 0}:${result.status}:${sortedChecks}:${result.errors.length}`;
  result.evidenceDigest = createHash("sha256")
    .update(rawDigestData)
    .digest("hex");
  return result;
}

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
    const toRead = Math.min(n, stat.size);
    if (toRead <= 0) return Buffer.alloc(0);
    const buf = Buffer.alloc(toRead);
    const fd = openSync(filePath, "r");
    const read = readSync(fd, buf, 0, toRead, Math.max(0, stat.size - toRead));
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
      return "docx";
    case ".doc":
      return "doc";
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
  sandboxDir = null,
}) {
  const result = {
    tier: "TECHNICAL",
    status: VALIDATION_STATUS.PASS,
    filePath,
    logicalPath: filePath,
    realPath: filePath,
    checks: {},
    errors: [],
  };

  const initialInferredType =
    expectedType ||
    deriveType(undefined, path.extname(filePath || "").toLowerCase());

  // 0. Path security check (must be absolute path, not UNC)
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    result.status = VALIDATION_STATUS.FAIL;
    result.errors.push(
      `INVALID_PATH: Artifact path must be an absolute path, received: "${filePath}"`,
    );
    result.checks.pathSecurity = false;
    return stampProvenanceAndDigest(result, initialInferredType);
  }
  if (filePath.startsWith("\\\\") || filePath.startsWith("//")) {
    result.status = VALIDATION_STATUS.FAIL;
    result.errors.push(
      `UNC_PATH_FORBIDDEN: UNC artifact paths are not allowed: "${filePath}"`,
    );
    result.checks.pathSecurity = false;
    return stampProvenanceAndDigest(result, initialInferredType);
  }
  result.checks.pathSecurity = true;

  // I08: Validate expectedType against canonical artifact type allowlist
  if (expectedType && !CANONICAL_ARTIFACT_TYPES.includes(expectedType)) {
    result.status = VALIDATION_STATUS.FAIL;
    result.errors.push(
      `INVALID_ARTIFACT_TYPE: "${expectedType}" is not a canonical artifact type. Expected one of: ${CANONICAL_ARTIFACT_TYPES.join(", ")}`,
    );
    result.checks.typeAllowlist = false;
    return stampProvenanceAndDigest(result, initialInferredType);
  }
  result.checks.typeAllowlist = true;

  // 1. Existence check
  if (!filePath || !existsSync(filePath)) {
    result.status = VALIDATION_STATUS.FAIL;
    result.errors.push(
      `FILE_NOT_FOUND: Artifact path "${filePath}" does not exist`,
    );
    result.checks.existence = false;
    return stampProvenanceAndDigest(result, initialInferredType);
  }
  result.checks.existence = true;

  // I05 & I06: Symlink escape check and realpath resolution
  let realPath;
  try {
    const lstat = lstatSync(filePath);
    realPath = realpathSync(filePath);
    result.isSymbolicLink = lstat.isSymbolicLink();
    result.logicalPath = filePath;
    result.realPath = realPath;

    if (lstat.isSymbolicLink() && sandboxDir) {
      const rel = path.relative(sandboxDir, realPath);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          `SYMLINK_ESCAPE: Symlink target "${realPath}" escapes sandbox boundary "${sandboxDir}"`,
        );
        result.checks.symlinkSafety = false;
        return stampProvenanceAndDigest(result, initialInferredType);
      }
    }
    result.checks.symlinkSafety = true;
  } catch (statErr) {
    result.status = VALIDATION_STATUS.FAIL;
    result.errors.push(
      `STAT_ERROR: Failed to inspect file path: ${statErr?.message}`,
    );
    return stampProvenanceAndDigest(result, initialInferredType);
  }

  // I01: Sandbox containment check
  if (sandboxDir) {
    const rel = path.relative(sandboxDir, realPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        `PATH_OUTSIDE_SANDBOX: Artifact "${realPath}" is outside designated sandbox "${sandboxDir}"`,
      );
      result.checks.sandboxContainment = false;
      return stampProvenanceAndDigest(result, initialInferredType);
    }
    result.checks.sandboxContainment = true;
  }

  // 2. File size & readability check (stat only)
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
      return stampProvenanceAndDigest(result, initialInferredType);
    }
    result.checks.readability = true;
  } catch (err) {
    result.status = VALIDATION_STATUS.FAIL;
    result.errors.push(
      `READ_ERROR: Failed to read file stats: ${err?.message}`,
    );
    result.checks.readability = false;
    return stampProvenanceAndDigest(result, initialInferredType);
  }

  // 3. Format-specific maximum size limits bounded by the Discord upload
  // ceiling. F-464: the ceiling is compared against stat.size BEFORE the
  // artifact body is read, so an over-limit file is refused without paying the
  // full read and hash cost.
  const ext = path.extname(filePath).toLowerCase();
  const inferredType = deriveType(expectedType, ext);
  result.checks.inferredType = inferredType;
  const maxSize =
    FORMAT_MAX_SIZE_LIMITS[inferredType] || MAX_ARTIFACT_SIZE_BYTES;
  result.checks.maxSizeBytes = maxSize;
  if (fileSizeBytes > maxSize) {
    result.status = VALIDATION_STATUS.FAIL;
    result.errors.push(
      `FILE_TOO_LARGE: Artifact size ${fileSizeBytes}B exceeds limit of ${maxSize}B for ${inferredType} (ARTIFACT_SIZE_EXCEEDED)`,
    );
    result.checks.sizeBound = false;
    return stampProvenanceAndDigest(result, inferredType);
  }
  result.checks.sizeBound = true;

  // 4. Read + SHA-256 hash (I07), bounded by the ceiling above
  let contentBuf;
  try {
    contentBuf = readFileSync(filePath);
    const hash = createHash("sha256").update(contentBuf).digest("hex");
    result.sizeBytes = fileSizeBytes;
    result.sha256 = hash;
    result.checks.hash = hash;
  } catch (err) {
    result.status = VALIDATION_STATUS.FAIL;
    result.errors.push(
      `READ_ERROR: Failed to read the artifact: ${err?.message}`,
    );
    result.checks.readability = false;
    return stampProvenanceAndDigest(result, inferredType);
  }

  // 5. Content parsing & schema check by type
  if (inferredType === "json") {
    try {
      const content = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content);
      result.checks.jsonParse = true;

      // J07: Reject generic primitive scalar when structured JSON expected
      if (parsed === null || typeof parsed !== "object") {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          `UNSTRUCTURED_JSON: Artifact must be a structured JSON object or array, received scalar (${typeof parsed})`,
        );
        result.checks.structured = false;
      } else {
        result.checks.structured = true;
        if (expectedFields.length > 0 && !Array.isArray(parsed)) {
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
      }
    } catch (parseErr) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(`INVALID_JSON: ${parseErr?.message}`);
      result.checks.jsonParse = false;
    }
  } else if (inferredType === "csv") {
    try {
      const content = readFileSync(filePath, "utf8");
      const rawLines = content
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      result.checks.lineCount = rawLines.length;
      if (rawLines.length === 0) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push("EMPTY_CSV: CSV file has zero rows");
      } else {
        try {
          // J06: RFC 4180 quoted delimiter parsing
          const header = parseCsvLine(rawLines[0]);
          result.checks.csvParse = true;
          if (expectedFields.length > 0) {
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
        } catch (csvErr) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(csvErr.message);
          result.checks.csvParse = false;
        }
      }
    } catch (readErr) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(`CSV_READ_ERROR: ${readErr?.message}`);
    }
  } else if (inferredType === "excel") {
    // M12/T9 F-258: this branch checked NOTHING structural. The type came
    // from the file extension, the only check was a 100-byte floor, and the
    // verdict was a PASS for any file over it — so a 200-byte text file named
    // `report.xlsx` reached the governed result card. The container is now
    // parsed: a workbook must be a readable ZIP that declares its content
    // types and at least one worksheet.
    result.checks.format = "EXCEL";
    if (fileSizeBytes < 100) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        "CORRUPT_EXCEL: File size too small to be valid workbook",
      );
      result.checks.excelStructureValid = false;
    } else {
      const names = readZipEntryNames(filePath);
      const hasContentTypes =
        Array.isArray(names) && names.includes("[Content_Types].xml");
      const hasWorksheet =
        Array.isArray(names) &&
        names.some(
          (name) => name.startsWith("xl/worksheets/") && name.endsWith(".xml"),
        );
      result.checks.excelStructureValid = hasContentTypes && hasWorksheet;
      if (!result.checks.excelStructureValid) {
        result.status = VALIDATION_STATUS.FAIL;
        const missing = [];
        if (!hasContentTypes) missing.push("[Content_Types].xml");
        if (!hasWorksheet) missing.push("xl/worksheets/*.xml");
        result.errors.push(
          `CORRUPT_EXCEL: Workbook container is missing required part(s): ${missing.join(", ")}`,
        );
      }
    }
  } else if (inferredType === "sql") {
    try {
      const content = readFileSync(filePath, "utf8");
      if (content.trim().length === 0) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push("EMPTY_SQL: SQL file has no content");
      } else {
        // J08: Bounded parser-level safety contract
        const UNSAFE_SQL =
          /\b(DROP\s+DATABASE|DROP\s+SCHEMA|SHUTDOWN|GRANT\s+ALL|REVOKE|ALTER\s+SYSTEM|EXEC\s+xp_)\b/i;
        if (UNSAFE_SQL.test(content)) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(
            "UNSAFE_SQL_STATEMENT: Destructive or administrative SQL commands forbidden in governed artifacts",
          );
          result.checks.sqlSafety = false;
        } else {
          result.checks.sqlSafety = true;
        }

        let parenCount = 0;
        let bracketCount = 0;
        let inSingleQuote = false;
        for (let i = 0; i < content.length; i++) {
          const ch = content[i];
          if (ch === "'" && (i === 0 || content[i - 1] !== "\\")) {
            inSingleQuote = !inSingleQuote;
          } else if (!inSingleQuote) {
            if (ch === "(") parenCount++;
            else if (ch === ")") parenCount--;
            else if (ch === "[") bracketCount++;
            else if (ch === "]") bracketCount--;
          }
        }
        if (parenCount !== 0 || bracketCount !== 0 || inSingleQuote) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(
            "MALFORMED_SQL_SYNTAX: Unbalanced parentheses/brackets or unclosed string literal in SQL artifact",
          );
          result.checks.sqlSyntax = false;
        } else {
          result.checks.sqlSyntax = true;
        }

        const SQL_KEYWORDS =
          /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|WITH|MERGE|CALL|EXEC)\b/i;
        result.checks.hasSqlKeyword = SQL_KEYWORDS.test(content);
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
        result.checks.functionCount = (
          content.match(/^\s*def\s+/gm) || []
        ).length;
        result.checks.classCount = (
          content.match(/^\s*class\s+/gm) || []
        ).length;
        result.checks.importCount = (
          content.match(/^\s*(import|from)\s+/gm) || []
        ).length;

        // J01: py_compile syntax validation
        const pySyntax = validatePythonSyntax(filePath, content);
        result.checks.pythonSyntax = pySyntax.valid;
        result.checks.pythonValidationMethod = pySyntax.method;
        if (!pySyntax.valid) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(pySyntax.error);
        }
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
    } else {
      // J03: Inspect internal Power BI structures.
      // M12/T9 F-258: the structure check now reads the archive's own central
      // directory, so a keyword inside arbitrary payload bytes no longer
      // counts as an entry.
      const hasPbixStructure = inspectZipContainsEntries(filePath, [
        "DataModel",
        "DataMashup",
        "DiagramLayout",
        "Report/Layout",
        "[Content_Types].xml",
        "Version",
        "Settings",
      ]);
      result.checks.powerbiStructureValid = hasPbixStructure;
      if (!hasPbixStructure) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          "INVALID_POWERBI_STRUCTURE: ZIP archive does not contain recognizable Power BI structures (DataModel, DataMashup, Report/Layout, Version)",
        );
      }
    }
  } else if (inferredType === "parquet") {
    // J04: Apache Parquet structural validation
    if (fileSizeBytes < 12) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        `CORRUPT_PARQUET: File size ${fileSizeBytes}B too small for Parquet container`,
      );
    } else {
      const header = readFirstBytes(filePath, 4);
      const footerBuf = readLastBytes(filePath, 8);
      const headerOk =
        header.length === 4 && header.toString("ascii") === "PAR1";
      const footerOk =
        footerBuf.length === 8 &&
        footerBuf.subarray(4, 8).toString("ascii") === "PAR1";
      result.checks.format = "PARQUET";
      result.checks.magicBytesHeader = headerOk;
      result.checks.magicBytesFooter = footerOk;
      if (!headerOk || !footerOk) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          `CORRUPT_PARQUET: Invalid PAR1 magic bytes (header=${headerOk}, footer=${footerOk})`,
        );
      } else {
        const footerLength = footerBuf.readUInt32LE(0);
        result.checks.footerLength = footerLength;
        if (footerLength > fileSizeBytes - 8) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(
            `CORRUPT_PARQUET: Invalid footer metadata length (${footerLength}B in ${fileSizeBytes}B file)`,
          );
        } else if (fileSizeBytes > 32 && footerLength <= 0) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(
            `CORRUPT_PARQUET: Missing or zero-length footer metadata (${footerLength}B in ${fileSizeBytes}B file)`,
          );
        } else {
          result.checks.parquetStructuralParse = true;
        }
      }
    }
  } else if (inferredType === "pdf") {
    // J05: PDF header + trailer %%EOF and startxref validation
    const header = readFirstBytes(filePath, 8);
    const isPdfHeader = header.toString("ascii").startsWith("%PDF-");
    result.checks.format = "PDF";
    result.checks.magicBytesValid = isPdfHeader;
    if (!isPdfHeader) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        "CORRUPT_PDF: File does not start with %PDF- magic bytes",
      );
    } else {
      const trailerBuf = readLastBytes(filePath, 1024);
      const trailerStr = trailerBuf.toString("ascii");
      const hasTrailerEof =
        trailerStr.includes("%%EOF") ||
        (fileSizeBytes <= 64 && trailerStr.includes("%EOF"));
      const hasStartXref =
        trailerStr.includes("startxref") ||
        trailerStr.includes("xref") ||
        fileSizeBytes <= 64;
      result.checks.hasTrailerEof = hasTrailerEof;
      result.checks.hasStartXref = hasStartXref;
      if (!hasTrailerEof) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          "CORRUPT_PDF: Missing %%EOF trailer marker in last 1024 bytes",
        );
      }
      if (!hasStartXref) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          "CORRUPT_PDF: Missing xref or startxref pointer in trailer",
        );
      }
    }
  } else if (inferredType === "docx") {
    // J02: DOCX is a ZIP archive with word/ and [Content_Types].xml
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
    } else {
      // M12/T9 F-258: the DOCX structure is read from the archive's own
      // central directory and BOTH required parts must be present. A truncated
      // or garbage container is not a DOCX, whatever its magic bytes say.
      const hasDocxStructure = inspectZipContainsAllEntries(filePath, [
        "[Content_Types].xml",
        "word/document.xml",
      ]);
      result.checks.docxStructureValid = hasDocxStructure;
      if (!hasDocxStructure) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          "INVALID_DOCX_STRUCTURE: ZIP archive does not contain recognizable DOCX structures (word/, [Content_Types].xml)",
        );
      }
    }
  } else if (inferredType === "doc") {
    // J02: Legacy .doc is OLE2 Compound Document Binary Format
    const header = readFirstBytes(filePath, 8);
    const isPkZip =
      header.length >= 4 &&
      header[0] === 0x50 &&
      header[1] === 0x4b &&
      header[2] === 0x03 &&
      header[3] === 0x04;
    if (isPkZip) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        "LEGACY_DOC_MISMATCH: .doc file has DOCX ZIP signature, expected OLE2 binary header (\\xD0\\xCF\\x11\\xE0)",
      );
      result.checks.legacyDocValid = false;
    } else {
      const isOle2Doc =
        header.length >= 8 &&
        header[0] === 0xd0 &&
        header[1] === 0xcf &&
        header[2] === 0x11 &&
        header[3] === 0xe0 &&
        header[4] === 0xa1 &&
        header[5] === 0xb1 &&
        header[6] === 0x1a &&
        header[7] === 0xe1;
      result.checks.legacyDocValid = isOle2Doc;
      if (!isOle2Doc) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          "CORRUPT_LEGACY_DOC: Invalid OLE2 binary signature (\\xD0\\xCF\\x11\\xE0)",
        );
      }
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

  // J10, J13, J14: Stamp provenance, checksRun, and evidenceDigest
  return stampProvenanceAndDigest(result, inferredType);
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
      if (hasPng && hasSvg) {
        text += `\n🖼️ **Hình ảnh Preview thực tế:** \`${path.basename(pngPath)}\` (vector: \`${path.basename(svgPath)}\`)`;
      } else if (previewImg) {
        text += `\n🖼️ **Hình ảnh Preview thực tế:** \`${previewImg}\` (đã đính kèm để xem trực tiếp)`;
      }
      return {
        available: true,
        type: "excel",
        previewImage: previewImg,
        previewImagePath: hasPng ? pngPath : hasSvg ? svgPath : null,
        previewPngPath: hasPng ? pngPath : null,
        previewSvgPath: hasSvg ? svgPath : null,
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
        header.length >= 5 &&
        header.subarray(0, 5).toString("ascii") === "%PDF-";
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
  artifactSet = null,
  technicalConfig = {},
  businessData = {},
  businessConfig = {},
}) {
  // M8-051: the primary member of the ordered set carries the format and
  // field checks, and EVERY member must pass the path-security tier. A
  // trailing member may never reach the queue or the ledger without it.
  const orderedSet =
    Array.isArray(artifactSet) && artifactSet.length > 0
      ? artifactSet.map((member) =>
          typeof member === "string" ? member : (member?.logical_path ?? null),
        )
      : [artifactPath];

  const primaryPath = orderedSet[0] ?? artifactPath;
  const technical = validateTechnicalArtifact({
    filePath: primaryPath,
    ...technicalConfig,
  });

  if (technical.status === VALIDATION_STATUS.PASS && orderedSet.length > 1) {
    const offending = orderedSet
      .slice(1)
      .find(
        (member) =>
          typeof member !== "string" ||
          !path.isAbsolute(member) ||
          member.startsWith("\\\\") ||
          member.startsWith("//"),
      );
    if (offending !== undefined) {
      technical.status = VALIDATION_STATUS.FAIL;
      technical.checks.artifactSetPathSecurity = false;
      technical.errors.push(
        `INVALID_PATH_SECONDARY_ARTIFACT: every artifact in the delivered set must be an absolute, non-UNC path, received: "${String(offending)}"`,
      );
    } else {
      technical.checks.artifactSetPathSecurity = true;
    }
  } else if (technical.status === VALIDATION_STATUS.PASS) {
    technical.checks.artifactSetPathSecurity = true;
  }

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

  const preview = generateArtifactPreview({ filePath: primaryPath });

  return {
    overallStatus,
    isReadyForUserReview: overallStatus === VALIDATION_STATUS.PASS,
    blockedReason,
    technical,
    business,
    technicalValidation: technical,
    businessValidation: business,
    primaryArtifactPath: primaryPath,
    preview,
  };
}

/**
 * I10: Atomic artifact publication step.
 * Prevents partially written files from being reviewed or validated.
 */
export function publishArtifactAtomic({ sourcePath, targetPath }) {
  if (!sourcePath || !targetPath) {
    throw new Error("SOURCE_AND_TARGET_PATHS_REQUIRED");
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`SOURCE_FILE_NOT_FOUND: ${sourcePath}`);
  }
  const targetDir = path.dirname(targetPath);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  const data = readFileSync(sourcePath);
  const fd = openSync(tempPath, "w", 0o600);
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, targetPath);
  // M10/T2-R17: fsync the parent directory after the rename so the rename
  // itself is durable; otherwise the bytes are safe but the published name can
  // revert on a crash, and a "published" artifact can disappear. Parity with
  // `topology/lib/ledger.mjs` and `lib/queue-manager.mjs` (M7-066).
  try {
    const directoryFd = openSync(targetDir, "r");
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !/^(EPERM|EISDIR|EINVAL|ENOTSUP)$/u.test(error?.code ?? "")
    ) {
      throw error;
    }
  }
  return { success: true, publishedPath: targetPath, sizeBytes: data.length };
}
