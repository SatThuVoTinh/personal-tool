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
  unlinkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";
import { assertNoSymlinkComponents } from "./policy.mjs";
// F-459 (R9-T08-1): the ONE SQL mask both artifact decisions read. It is owned
// by the canonical validator so the two gates cannot drift into two dialects;
// the owner authorized this static edge on 2026-10-25, and
// `policy.mjs`'s packaging table rewrites the path for the deployed tree.
// Re-exported because this module's public surface already named it.
import { maskSqlLiteralsAndComments } from "../../../zink-tools/sql/validator.mjs";

export { maskSqlLiteralsAndComments };

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
  return readZipArchive(buf, { includeContents: false })?.names ?? null;
}

/**
 * Parse the ZIP central directory and, when asked, inflate the declared parts.
 *
 * F-465: the EXCEL tier now parses the worksheet XML, so it needs the
 * archive's real bytes, not just the entry names. The per-part output is
 * capped at the artifact ceiling so a crafted container cannot expand a small
 * file into an unbounded buffer. Name-only callers skip inflation.
 *
 * @param {Buffer} buf
 * @param {{ includeContents?: boolean }} [options]
 * @returns {{ names: string[], contents: Map<string, Buffer> } | null}
 */
function readZipArchive(buf, { includeContents = true } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null;
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
  const contents = new Map();
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buf.length) return null;
    if (buf.readUInt32LE(offset) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf
      .subarray(offset + 46, offset + 46 + nameLen)
      .toString("utf8");
    names.push(name);
    if (
      includeContents &&
      localOffset + 30 <= buf.length &&
      buf.readUInt32LE(localOffset) === 0x04034b50
    ) {
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compressedSize);
      try {
        contents.set(
          name,
          method === 0
            ? Buffer.from(raw)
            : inflateRawSync(raw, {
                maxOutputLength: MAX_ARTIFACT_SIZE_BYTES,
              }),
        );
      } catch {
        // An unreadable part is treated as missing by the format tiers; it is
        // never accepted as valid content.
      }
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return { names, contents };
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
}

// J01: Python syntax validator using py_compile with AST bracket fallback
export function validatePythonSyntax(filePath, content) {
  try {
    execFileSync("python", ["-m", "py_compile", filePath], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    return { valid: true, method: "py_compile" };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString("utf8") : "";
    // F-554 (R10-T06-6): only an interpreter that RAN can answer the syntax
    // question. A spawn failure (`ENOENT`), the 5000 ms overrun (`ETIMEDOUT`)
    // and a child killed by a signal all arrive with `status: null` and an
    // empty stderr, so they used to fall through to the structural counter and
    // return `valid: true` from a check that never executed — and the caller
    // stamped `checks.pythonSyntax: true` over it.
    const interpreterRan = typeof err?.status === "number" && !err?.signal;
    if (!interpreterRan) {
      return {
        valid: false,
        error: `PYTHON_INTERPRETER_UNAVAILABLE: the Python syntax validator did not run (${err?.code ?? (err?.signal ? `signal ${err.signal}` : "no exit status")})`,
        method: "interpreter_unavailable",
      };
    }
    if (stderr.includes("SyntaxError") || err.status !== 0) {
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
 * F-472 / R9-T12-1: exported so the governed completion seam can consult the
 * same FORMAT_MAX_SIZE_LIMITS row the validator uses, BEFORE it reads the bytes.
 * @param {string|undefined} expectedType
 * @param {string} ext  lowercase extension including dot
 * @returns {string}
 */
export function deriveType(expectedType, ext) {
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

/**
 * True when the bytes carry the ZIP local-file signature (`PK\x03\x04`).
 * F-564 (R10-T08-5): one predicate for the technical tier and the preview arm,
 * so the two verdicts over one artifact cannot use different magic-byte tests.
 *
 * @param {Buffer} header
 * @returns {boolean}
 */
function isPkZipHeader(header) {
  return (
    header.length >= 4 &&
    header[0] === 0x50 &&
    header[1] === 0x4b &&
    header[2] === 0x03 &&
    header[3] === 0x04
  );
}

/**
 * F-564 (R10-T08-5): the PDF container facts the TECHNICAL tier decides on.
 * The preview arm used to read only the `%PDF-` header, so a file the tier
 * refused over a missing `%%EOF` trailer was still reported to the operator as
 * valid. Both callers now share this reader.
 *
 * @param {string} filePath
 * @param {number | null} knownSizeBytes the tier's already-measured size, when it has one
 * @returns {{ isPdfHeader: boolean, version: string, hasTrailerEof: boolean, hasStartXref: boolean }}
 */
function inspectPdfContainer(filePath, knownSizeBytes = null) {
  const header = readFirstBytes(filePath, 8);
  const isPdfHeader =
    header.length >= 5 && header.subarray(0, 5).toString("ascii") === "%PDF-";
  const versionMatch = header.toString("ascii").match(/%PDF-([\d.]+)/u);
  const trailerStr = readLastBytes(filePath, 1024).toString("ascii");
  let sizeBytes = knownSizeBytes;
  if (typeof sizeBytes !== "number") {
    try {
      sizeBytes = statSync(filePath).size;
    } catch {
      sizeBytes = 0;
    }
  }
  return {
    isPdfHeader,
    version: versionMatch ? versionMatch[1] : "?",
    hasTrailerEof:
      trailerStr.includes("%%EOF") ||
      (sizeBytes <= 64 && trailerStr.includes("%EOF")),
    hasStartXref:
      trailerStr.includes("startxref") ||
      trailerStr.includes("xref") ||
      sizeBytes <= 64,
  };
}

/**
 * F-564 (R10-T08-5): the Power BI structure the TECHNICAL tier decides on.
 * `[Content_Types].xml` alone is an OPC part every Office document carries, so
 * the report layout plus its data half are required conjunctively. Shared with
 * the preview arm, which used to call any PK container "valid".
 *
 * @param {string} filePath
 * @returns {{ isPkZip: boolean, hasStructure: boolean }}
 */
function inspectPowerBiContainer(filePath) {
  const isPkZip = isPkZipHeader(readFirstBytes(filePath, 4));
  const hasStructure =
    isPkZip &&
    (inspectZipContainsAllEntries(filePath, ["Report/Layout", "DataMashup"]) ||
      inspectZipContainsAllEntries(filePath, ["Report/Layout", "DataModel"]));
  return { isPkZip, hasStructure };
}

/**
 * F-564 (R10-T08-5): the legacy `.doc` header facts the TECHNICAL tier decides
 * on. A `.doc` carrying the DOCX ZIP signature is refused by the tier, while
 * the preview arm used to call exactly that shape a valid Word container.
 *
 * @param {string} filePath
 * @returns {{ isPkZip: boolean, isOle2: boolean }}
 */
function inspectLegacyDocContainer(filePath) {
  const header = readFirstBytes(filePath, 8);
  return {
    isPkZip: isPkZipHeader(header),
    isOle2:
      header.length >= 8 &&
      header[0] === 0xd0 &&
      header[1] === 0xcf &&
      header[2] === 0x11 &&
      header[3] === 0xe0 &&
      header[4] === 0xa1 &&
      header[5] === 0xb1 &&
      header[6] === 0x1a &&
      header[7] === 0xe1,
  };
}

// XML 1.0 forbids C0 controls other than tab/LF/CR, plus U+FFFE/U+FFFF and
// unpaired surrogates. F-465: the EXCEL tier parses each worksheet part, so a
// forbidden byte cannot hide behind a container-only structure check.
function forbiddenXmlCharacterCode(xml) {
  for (const character of xml) {
    const code = character.codePointAt(0);
    const forbidden =
      code === 0xfffe ||
      code === 0xffff ||
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0xd800 && code <= 0xdfff);
    if (forbidden) {
      return code.toString(16).toUpperCase().padStart(4, "0");
    }
  }
  return null;
}

// Excel's published per-cell text budget (F-473). The validator checks the
// decoded text so escaped characters (`&amp;`) are measured as one character.
const EXCEL_MAX_CELL_CHARACTERS = 32767;

function decodeXmlText(value) {
  return String(value)
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

/**
 * Return the first worksheet cell that exceeds Excel's per-cell text budget.
 *
 * F-473: the writer refuses an over-budget value, but a workbook built by any
 * other producer could still arrive here; the EXCEL tier therefore measures
 * the `<t>`/`<v>` text of every cell instead of trusting the container shape.
 *
 * @param {string} sheetName
 * @param {string} xml
 * @returns {string | null}
 */
function overBudgetCellFailure(sheetName, xml) {
  for (const cell of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)) {
    const inner = cell[2];
    let characters = 0;
    for (const text of inner.matchAll(
      /<(?:t|v)\b[^>]*>([\s\S]*?)<\/(?:t|v)>/gu,
    )) {
      characters += decodeXmlText(text[1]).length;
    }
    if (characters > EXCEL_MAX_CELL_CHARACTERS) {
      const ref = /\br="([^"]*)"/u.exec(cell[1])?.[1] || "(unreferenced)";
      return `EXCEL_CELL_TOO_LONG: ${sheetName} cell ${ref} holds ${characters} characters, above the ${EXCEL_MAX_CELL_CHARACTERS}-character per-cell budget`;
    }
  }
  return null;
}

/**
 * Parse every worksheet part of a workbook archive.
 *
 * @param {{ names: string[], contents: Map<string, Buffer> } | null} archive
 * @returns {string | null} the failure code with its detail, or null when the
 *   worksheet parts are readable and XML-valid.
 */
function inspectExcelSheetParts(archive) {
  if (!archive) {
    return "CORRUPT_EXCEL: workbook central directory could not be read";
  }
  for (const name of archive.names) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/u.test(name)) continue;
    const part = archive.contents.get(name);
    if (!part) {
      return `CORRUPT_EXCEL: worksheet part ${name} could not be read`;
    }
    const xml = part.toString("utf8");
    const code = forbiddenXmlCharacterCode(xml);
    if (code) {
      return `INVALID_EXCEL_SHEET_XML: ${name} contains U+${code}, which XML 1.0 forbids`;
    }
    const overBudget = overBudgetCellFailure(name, xml);
    if (overBudget) {
      return overBudget;
    }
  }
  return null;
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
      const archive = readZipArchive(contentBuf);
      const names = archive?.names ?? null;
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
      } else {
        const sheetXmlFailure = inspectExcelSheetParts(archive);
        result.checks.sheetXmlValid = sheetXmlFailure === null;
        if (sheetXmlFailure) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(sheetXmlFailure);
        }
      }
    }
  } else if (inferredType === "sql") {
    try {
      const content = readFileSync(filePath, "utf8");
      if (content.trim().length === 0) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push("EMPTY_SQL: SQL file has no content");
      } else {
        // F-459 (R9-T08-1): BOTH decisions below read the same mask, so a
        // keyword or a bracket that only exists inside a literal or a comment
        // is never read as syntax. The mask also carries the lexer's own
        // refusals (unterminated literal/comment, backslash escape), which the
        // hand-rolled quote toggle could not see.
        const sqlMask = maskSqlLiteralsAndComments(content);
        // J08: Bounded parser-level safety contract
        const UNSAFE_SQL =
          /\b(DROP\s+DATABASE|DROP\s+SCHEMA|SHUTDOWN|GRANT\s+ALL|REVOKE|ALTER\s+SYSTEM|EXEC\s+xp_)\b/i;
        if (UNSAFE_SQL.test(sqlMask.masked)) {
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
        for (const ch of sqlMask.masked) {
          if (ch === "(") parenCount++;
          else if (ch === ")") parenCount--;
          else if (ch === "[") bracketCount++;
          else if (ch === "]") bracketCount--;
        }
        if (
          parenCount !== 0 ||
          bracketCount !== 0 ||
          sqlMask.unterminatedLiteral ||
          sqlMask.unterminatedComment ||
          sqlMask.backslashInLiteral
        ) {
          result.status = VALIDATION_STATUS.FAIL;
          result.errors.push(
            "MALFORMED_SQL_SYNTAX: Unbalanced parentheses/brackets, an unclosed string literal or comment, or a backslash escape in a SQL string literal",
          );
          result.checks.sqlSyntax = false;
        } else {
          result.checks.sqlSyntax = true;
        }

        const SQL_KEYWORDS =
          /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|WITH|MERGE|CALL|EXEC)\b/i;
        result.checks.hasSqlKeyword = SQL_KEYWORDS.test(sqlMask.masked);
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
    // PBIX and PBIT are ZIP archives — the same reader the preview arm calls.
    const { isPkZip, hasStructure } = inspectPowerBiContainer(filePath);
    result.checks.format = "POWERBI";
    result.checks.magicBytesValid = isPkZip;
    if (!isPkZip) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        "CORRUPT_POWERBI: File does not have valid ZIP/PBIX magic bytes (PK\\x03\\x04)",
      );
    } else {
      // J03: Inspect internal Power BI structures.
      // M12/T9 F-258: the structure check now reads the container's own central
      // directory, so a keyword inside arbitrary payload bytes no longer
      // counts as an entry.
      // F-503 / R10-L02-2: the gate was an ANY-of over a list that carried
      // "[Content_Types].xml", a part the OPC spec mandates for EVERY Office
      // document, so a renamed xlsx/docx/pptx satisfied it and reached the
      // result gate as a valid Power BI artifact. Power BI is now identified
      // conjunctively by its own distinguishing parts: the report layout plus
      // its data half (DataMashup or DataModel).
      result.checks.powerbiStructureValid = hasStructure;
      if (!hasStructure) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          "INVALID_POWERBI_STRUCTURE: ZIP archive does not contain recognizable Power BI structures (Report/Layout with DataModel or DataMashup)",
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
    // J05: PDF header + trailer %%EOF and startxref validation. F-564: the
    // preview arm consumes the same reader instead of re-testing magic bytes.
    const pdf = inspectPdfContainer(filePath, fileSizeBytes);
    result.checks.format = "PDF";
    result.checks.magicBytesValid = pdf.isPdfHeader;
    if (!pdf.isPdfHeader) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        "CORRUPT_PDF: File does not start with %PDF- magic bytes",
      );
    } else {
      result.checks.hasTrailerEof = pdf.hasTrailerEof;
      result.checks.hasStartXref = pdf.hasStartXref;
      if (!pdf.hasTrailerEof) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          "CORRUPT_PDF: Missing %%EOF trailer marker in last 1024 bytes",
        );
      }
      if (!pdf.hasStartXref) {
        result.status = VALIDATION_STATUS.FAIL;
        result.errors.push(
          "CORRUPT_PDF: Missing xref or startxref pointer in trailer",
        );
      }
    }
  } else if (inferredType === "docx") {
    // J02: DOCX is a ZIP archive with word/ and [Content_Types].xml
    const isPkZip = isPkZipHeader(readFirstBytes(filePath, 4));
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
    const doc = inspectLegacyDocContainer(filePath);
    if (doc.isPkZip) {
      result.status = VALIDATION_STATUS.FAIL;
      result.errors.push(
        "LEGACY_DOC_MISMATCH: .doc file has DOCX ZIP signature, expected OLE2 binary header (\\xD0\\xCF\\x11\\xE0)",
      );
      result.checks.legacyDocValid = false;
    } else {
      result.checks.legacyDocValid = doc.isOle2;
      if (!doc.isOle2) {
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
      // F-564 (R10-T08-5): the preview reported any PK container as valid while
      // the technical tier required the report layout plus its data half, so a
      // renamed xlsx reached the operator as a valid Power BI report. It reads
      // the tier's reader now.
      const { isPkZip, hasStructure } = inspectPowerBiContainer(filePath);
      const validity = !isPkZip
        ? "❌ Không nhận dạng được định dạng PBIX/PBIT"
        : hasStructure
          ? "✅ Container ZIP hợp lệ và đủ cấu trúc Power BI (Report/Layout với DataModel hoặc DataMashup)"
          : "❌ Container ZIP nhưng KHÔNG phải Power BI hợp lệ (thiếu Report/Layout với DataModel hoặc DataMashup)";
      const label = ext === ".pbit" ? "Template (.pbit)" : "Report (.pbix)";
      const text = `📊 **Power BI ${label}:** \`${path.basename(filePath)}\` (${(stat.size / 1024).toFixed(1)} KB)\n${validity}`;
      return {
        available: true,
        type: "powerbi",
        sizeBytes: stat.size,
        magicBytesValid: isPkZip,
        structureValid: hasStructure,
        verdict: hasStructure ? "VALID" : "INVALID",
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
      // F-564 (R10-T08-5): the technical tier refuses a PDF without its
      // `%%EOF` trailer and an xref/startxref pointer; the preview used to
      // print valid from the `%PDF-` header alone. Same reader, same verdict.
      const pdf = inspectPdfContainer(filePath, stat.size);
      const structurallyValid =
        pdf.isPdfHeader && pdf.hasTrailerEof && pdf.hasStartXref;
      const validity = !pdf.isPdfHeader
        ? "❌ Không nhận dạng được định dạng PDF"
        : structurallyValid
          ? `✅ PDF hợp lệ (phiên bản ${pdf.version})`
          : "❌ PDF KHÔNG hợp lệ: thiếu %%EOF trailer hoặc xref/startxref";
      const text = `📕 **PDF:** \`${path.basename(filePath)}\` (${(stat.size / 1024).toFixed(1)} KB)\n${validity}`;
      return {
        available: true,
        type: "pdf",
        sizeBytes: stat.size,
        magicBytesValid: pdf.isPdfHeader,
        hasTrailerEof: pdf.hasTrailerEof,
        hasStartXref: pdf.hasStartXref,
        pdfVersion: pdf.isPdfHeader ? pdf.version : null,
        verdict: structurallyValid ? "VALID" : "INVALID",
        previewText: text,
      };
    }

    // -----------------------------------------------------------------------
    // DOCX / DOC
    // -----------------------------------------------------------------------
    if (ext === ".docx") {
      const stat = statSync(filePath);
      // F-564 (R10-T08-5): the technical tier requires both OOXML parts; the
      // preview used to call any PK container a valid DOCX.
      const isPkZip = isPkZipHeader(readFirstBytes(filePath, 4));
      const hasDocxStructure =
        isPkZip &&
        inspectZipContainsAllEntries(filePath, [
          "[Content_Types].xml",
          "word/document.xml",
        ]);
      const validity = !isPkZip
        ? "❌ Không nhận dạng được định dạng DOCX"
        : hasDocxStructure
          ? "✅ Container ZIP hợp lệ và đủ cấu trúc DOCX (OOXML)"
          : "❌ Container ZIP nhưng KHÔNG phải DOCX hợp lệ (thiếu [Content_Types].xml hoặc word/document.xml)";
      const text = `📝 **Word Document:** \`${path.basename(filePath)}\` (${(stat.size / 1024).toFixed(1)} KB)\n${validity}`;
      return {
        available: true,
        type: "docx",
        sizeBytes: stat.size,
        magicBytesValid: isPkZip,
        structureValid: hasDocxStructure,
        verdict: hasDocxStructure ? "VALID" : "INVALID",
        previewText: text,
      };
    }

    if (ext === ".doc") {
      const stat = statSync(filePath);
      // F-564 (R10-T08-5): a `.doc` must be an OLE2 compound document; the
      // technical tier refuses a DOCX ZIP signature under this extension, so
      // the preview may not call that shape a valid Word container.
      const doc = inspectLegacyDocContainer(filePath);
      const validity = doc.isOle2
        ? "✅ Container OLE2 hợp lệ (DOC)"
        : doc.isPkZip
          ? "❌ .doc KHÔNG hợp lệ: có chữ ký ZIP của DOCX, thiếu header OLE2"
          : "❌ Không nhận dạng được định dạng DOC (OLE2)";
      const text = `📝 **Word Document:** \`${path.basename(filePath)}\` (${(stat.size / 1024).toFixed(1)} KB)\n${validity}`;
      return {
        available: true,
        type: "doc",
        sizeBytes: stat.size,
        magicBytesValid: doc.isOle2,
        legacyDocValid: doc.isOle2,
        verdict: doc.isOle2 ? "VALID" : "INVALID",
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
 * F-564 (R10-T08-5): the preview is evaluated BEFORE the outcome so a container
 * refusal it can prove is never attached beneath a PASS.
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
    // F-469 (R9-L05-8): the digest was stamped inside validateTechnicalArtifact
    // BEFORE this mutation, so a FAIL(artifactSetPathSecurity) result shipped a
    // stale PASS-era evidenceDigest that omitted the added check and error.
    // Recompute over the FINAL artifact-set verdict.
    stampProvenanceAndDigest(
      technical,
      technical.provenance?.format ?? "generic",
    );
  } else if (technical.status === VALIDATION_STATUS.PASS) {
    technical.checks.artifactSetPathSecurity = true;
    // F-469 (R9-L05-8): the added check key also postdates the original stamp.
    stampProvenanceAndDigest(
      technical,
      technical.provenance?.format ?? "generic",
    );
  }

  const business = validateBusinessLogic({
    data: businessData,
    ...businessConfig,
  });

  // F-564 (R10-T08-5): the preview is EVALUATED BEFORE the outcome, not attached
  // after it. It used to be generated at the end and only spray-painted onto an
  // already-decided payload, so a preview that could not verify the container
  // (a header-only PDF under a generic expected type, for example) rode beside a
  // PASS and the operator read the weaker of two verdicts as the answer.
  const preview = generateArtifactPreview({ filePath: primaryPath });

  let overallStatus = VALIDATION_STATUS.PASS;
  let blockedReason = null;

  if (technical.status !== VALIDATION_STATUS.PASS) {
    overallStatus = VALIDATION_STATUS.FAIL;
    blockedReason = `Technical validation failed: ${technical.errors.join("; ")}`;
  } else if (business.status !== VALIDATION_STATUS.PASS) {
    // CRITICAL INVARIANT: Technical PASS but Business FAIL = RESULT BLOCKED
    overallStatus = VALIDATION_STATUS.BLOCKED;
    blockedReason = `RESULT BLOCKED: Technical check passed, but Business validation failed: ${business.errors.join("; ")}`;
  } else if (preview?.verdict === "INVALID") {
    // F-564: a structural refusal the preview can prove must not be emitted as a
    // PASS. The preview arm now reads the same per-type helpers as the technical
    // tier, so an INVALID verdict here is a real container refusal, not the old
    // magic-bytes-only snapshot.
    overallStatus = VALIDATION_STATUS.FAIL;
    blockedReason =
      "Technical validation failed: PREVIEW_STRUCTURE_REFUSED: the preview arm could not verify the artifact container";
  }

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
 *
 * F-502 (R10-L02-1): this writer used to adopt whatever already sat at its
 * predictable `.tmp-<pid>-<ms>` name (`"w"` truncates), never checked the path
 * for symlinked components, and left its own residue behind when the write
 * failed — the exact adopt-pattern `queue-manager.mjs` and `decision-ledger.mjs`
 * replaced with `"wx"` + `assertNoSymlinkComponents` + own-temp removal. It is
 * the same discipline here, not a new atomic writer.
 */
export function publishArtifactAtomic({ sourcePath, targetPath }) {
  if (!sourcePath || !targetPath) {
    throw new Error("SOURCE_AND_TARGET_PATHS_REQUIRED");
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`SOURCE_FILE_NOT_FOUND: ${sourcePath}`);
  }
  const targetDir = path.dirname(targetPath);
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  // Before anything is created: `mkdirSync(recursive)` would otherwise happily
  // materialize the artifact through a symlinked ancestor.
  assertNoSymlinkComponents(tempPath);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  const data = readFileSync(sourcePath);
  let fd = null;
  let tempIsOurs = false;
  try {
    // `"wx"` CREATES the temp instead of adopting a path an attacker (or a
    // crashed earlier attempt) already populated; `EEXIST` is the refusal.
    fd = openSync(tempPath, "wx", 0o600);
    tempIsOurs = true;
    writeFileSync(fd, data);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
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
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* preserve the original failure */
      }
    }
    // Closed first, so the removal can succeed on Windows as well as POSIX. Only
    // ever a temp this call created: after a successful rename the temp name is
    // gone, and a foreign file at that path must be left untouched.
    if (tempIsOurs && existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        /* preserve the original failure */
      }
    }
    throw error;
  }
  return { success: true, publishedPath: targetPath, sizeBytes: data.length };
}
