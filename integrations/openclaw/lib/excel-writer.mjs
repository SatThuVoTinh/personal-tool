import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const crcTable = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c;
}

function calculateCrc32(buf) {
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function createZipArchive(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    const dataBuf = Buffer.isBuffer(content)
      ? content
      : Buffer.from(content, "utf8");
    const compressed = zlib.deflateRawSync(dataBuf);
    const crc = calculateCrc32(dataBuf);

    // Local file header (30 bytes + name)
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    localHeaders.push(local, compressed);

    // Central directory header (46 bytes + name)
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    centralHeaders.push(central);
    offset += local.length + compressed.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const c of centralHeaders) centralSize += c.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

/**
 * Spreadsheet column reference for a zero-based index.
 *
 * M10/T2-R19: this was `String.fromCharCode(65 + (i % 26))`, which is a modulo,
 * not a base conversion. At index 26 it wrapped back to "A", so a row with 27
 * values emitted a SECOND `<c r="A1">` and every column past 27 was mislabelled
 * in every row. The result is invalid SpreadsheetML: Excel refuses the workbook
 * ("unreadable content"). Correct mapping is 0=A .. 25=Z, 26=AA .. 51=AZ,
 * 52=BA .. 701=ZZ, 702=AAA.
 */
export function spreadsheetColumnLetter(index) {
  let n = index;
  let letter = "";
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letter;
}

/**
 * Minimal ZIP reader ? the mirror of `createZipArchive` above.
 *
 * F-126: `load` used to report a hardcoded `["Sheet1"]` and `populate` had no
 * way to read a template, because nothing in this module could open the
 * container it writes. This reads the central directory and inflates the
 * entries, so the sheet names and the template parts come from the real file
 * instead of from a constant.
 */
export function readZipEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) {
    throw new Error("ZIP_CONTAINER_UNREADABLE: not a ZIP archive");
  }
  let eocd = -1;
  const lowest = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error(
      "ZIP_CONTAINER_UNREADABLE: end-of-central-directory not found",
    );
  }
  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(
        "ZIP_CONTAINER_UNREADABLE: central directory entry invalid",
      );
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf
      .subarray(offset + 46, offset + 46 + nameLen)
      .toString("utf8");
    if (
      localOffset + 30 > buf.length ||
      buf.readUInt32LE(localOffset) !== 0x04034b50
    ) {
      throw new Error(
        `ZIP_CONTAINER_UNREADABLE: local header invalid for ${name}`,
      );
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    const content = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
    entries.set(name, content);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

/**
 * The real sheet names of a workbook, read from `xl/workbook.xml`.
 *
 * F-126: `load` reported `["Sheet1"]` for every workbook, so a caller could
 * not tell a one-sheet report from a twelve-sheet model.
 */
export function readWorkbookSheetNames(buf) {
  const entries = readZipEntries(buf);
  const workbookPart = entries.get("xl/workbook.xml");
  if (!workbookPart) {
    throw new Error(
      "XLSX_WORKBOOK_PART_MISSING: xl/workbook.xml is not present",
    );
  }
  const xml = workbookPart.toString("utf8");
  const names = [];
  for (const match of xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/gu)) {
    names.push(decodeXmlEntities(match[1]));
  }
  return names;
}

// XML 1.0 forbids C0 controls other than tab/LF/CR, plus U+FFFE/U+FFFF and
// unpaired surrogates. A cell carrying one produces a workbook Excel opens in
// repair mode, so the writer refuses the value instead of emitting invalid
// OOXML (F-465).
function forbiddenXmlCodePoint(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code === 0xfffe || code === 0xffff) return code;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return code;
    }
    if (code >= 0xd800 && code <= 0xdfff) return code;
  }
  return null;
}

function assertXmlSafeCellText(ref, value) {
  const code = forbiddenXmlCodePoint(value);
  if (code === null) return;
  const label = code.toString(16).toUpperCase().padStart(4, "0");
  throw new Error(
    `EXCEL_CELL_CONTROL_CHARACTER: cell ${ref} contains U+${label}, which XML 1.0 forbids in a worksheet`,
  );
}

// Excel's published per-cell text budget. A longer inline string is written by
// the container writer but Excel refuses/repairs the workbook, so the writer
// refuses the cell instead of emitting an artifact that cannot be opened
// (F-473).
const EXCEL_MAX_CELL_CHARACTERS = 32767;

function assertCellWithinCharacterBudget(ref, value) {
  if (value.length <= EXCEL_MAX_CELL_CHARACTERS) return;
  throw new Error(
    `EXCEL_CELL_TOO_LONG: cell ${ref} holds ${value.length} characters, above the ${EXCEL_MAX_CELL_CHARACTERS}-character per-cell budget`,
  );
}

function buildSheetRowsXml(rows, startRow = 1) {
  let sheetRowsXml = "";
  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const rowNum = rIdx + startRow;
    let cellsXml = "";
    const row = Array.isArray(rows[rIdx]) ? rows[rIdx] : [rows[rIdx]];
    for (let cIdx = 0; cIdx < row.length; cIdx++) {
      const colLetter = spreadsheetColumnLetter(cIdx);
      const ref = `${colLetter}${rowNum}`;
      const val = String(row[cIdx] ?? "");
      assertXmlSafeCellText(ref, val);
      assertCellWithinCharacterBudget(ref, val);
      const escaped = val
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      cellsXml += `<c r="${ref}" t="inlineStr"><is><t>${escaped}</t></is></c>`;
    }
    sheetRowsXml += `<row r="${rowNum}">${cellsXml}</row>`;
  }
  return sheetRowsXml;
}

const EXCEL_SHEET_NAME_MAX_LENGTH = 31;

function safeSheetName(name) {
  return (
    String(name ?? "")
      .replace(/[^a-zA-Z0-9_-]/gu, "")
      .slice(0, EXCEL_SHEET_NAME_MAX_LENGTH) || "Sheet1"
  );
}

/**
 * Normalise a declared sheet name to a worksheet name that is unique in the
 * workbook.
 *
 * F-466: `safeSheetName` stripped disallowed characters and truncated to 31
 * with no de-duplication, so two declared names that sanitise identically
 * ("A B" and "AB") wrote two `<sheet name="AB">` entries — an invalid workbook
 * — while the tool reported the declared names. Excel sheet names are unique
 * case-insensitively, so the suffix search is case-insensitive and
 * deterministic (the first declaration keeps the base name).
 */
function uniqueSheetName(name, usedNames) {
  const base = safeSheetName(name);
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const marker = `_${suffix}`;
    const stem =
      base.slice(0, EXCEL_SHEET_NAME_MAX_LENGTH - marker.length) || "Sheet";
    candidate = `${stem}${marker}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Build a workbook with EVERY sheet the caller declared.
 *
 * F-126: the writer emitted exactly one `xl/worksheets/sheet1.xml` and read
 * only `specification.sheets[0]`, so `sheets[1..]` were dropped silently while
 * the tool reported `status: "success"`.
 */
export function buildMultiSheetWorkbookBuffer(sheets = []) {
  const usedNames = new Set();
  const list = (Array.isArray(sheets) ? sheets : []).map((sheet, index) => ({
    name: uniqueSheetName(sheet?.name || `Sheet${index + 1}`, usedNames),
    rows: Array.isArray(sheet?.rows) ? sheet.rows : [],
  }));
  if (list.length === 0) list.push({ name: "Sheet1", rows: [] });

  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${list
  .map(
    (_s, i) =>
      `  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join("\n")}
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${list
  .map(
    (_s, i) =>
      `  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join("\n")}
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${list
  .map(
    (sheet, i) =>
      `    <sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
  )
  .join("\n")}
  </sheets>
</workbook>`,
  };

  list.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${buildSheetRowsXml(sheet.rows)}
  </sheetData>
</worksheet>`;
  });

  return createZipArchive(files);
}

export function buildWorkbookBuffer(rows = [], sheetName = "Sheet1") {
  return buildMultiSheetWorkbookBuffer([{ name: sheetName, rows }]);
} /**
 * The four operations the published contract declares
 * (`zink-tools/contracts/tools/zink-excel.schema.json`).
 *
 * F-126: the writer accepted any verb, so a call could come back with an
 * `operation` the contract forbids. Aliases are mapped onto the closed
 * vocabulary; anything else is refused by an explicit error code and is never
 * reported as a success.
 */
const EXCEL_OPERATIONS = Object.freeze({
  load: "load",
  read: "load",
  validate: "validate",
  generate: "generate",
  create: "generate",
  append: "generate",
  write: "generate",
  populate: "populate",
});

function normalizeExcelOperation(operation) {
  const key = String(operation || "generate")
    .trim()
    .toLowerCase();
  const mapped = EXCEL_OPERATIONS[key];
  if (!mapped) {
    throw new Error(`EXCEL_OPERATION_UNSUPPORTED: ${key}`);
  }
  return mapped;
}

/**
 * The closed rule vocabulary `validate` can evaluate.
 *
 * F-126: `validate` used to report `valid: exists` and echo the caller's own
 * `rules` back as `rules_checked` without evaluating any of them. Each rule
 * now produces its own verdict; an unknown rule is refused rather than
 * silently ignored.
 */
const EXCEL_VALIDATION_RULES = Object.freeze({
  file_existence: (ctx) => ({
    passed: ctx.exists === true,
    detail: ctx.exists
      ? "the workbook file exists"
      : "the workbook file does not exist",
  }),
  extension_check: (ctx) => ({
    passed: ctx.extension === ".xlsx",
    detail: `the file extension is ${ctx.extension}`,
  }),
  non_empty: (ctx) => ({
    passed: ctx.sizeBytes > 0,
    detail: `the workbook is ${ctx.sizeBytes} bytes`,
  }),
  readable_workbook: (ctx) => ({
    passed: Array.isArray(ctx.sheets),
    detail: Array.isArray(ctx.sheets)
      ? "the workbook is a readable OOXML package"
      : `the workbook could not be read as a workbook (${ctx.sheetError})`,
  }),
  has_sheets: (ctx) => ({
    passed: Array.isArray(ctx.sheets) && ctx.sheets.length > 0,
    detail: Array.isArray(ctx.sheets)
      ? `the workbook declares ${ctx.sheets.length} sheet(s)`
      : "the workbook declares no sheet",
  }),
});

/**
 * F-044: resolve a path THROUGH the filesystem, not through the string.
 *
 * `path.resolve` normalises `..` away, so the lexical containment test above
 * cannot see a directory JUNCTION inside the workspace: the junction's own
 * path is inside the base, but the bytes it points at are not. The read side
 * of this tool already resolved its path for real; the write side did not.
 *
 * `realpathOf` walks to the deepest EXISTING ancestor of the target and
 * resolves that, then re-appends the segments that do not exist yet — the
 * path a write will create, seen through the filesystem as it is.
 */
function realpathOf(target) {
  let current = path.resolve(target);
  const trailing = [];
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return trailing.length ? path.join(real, ...trailing.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      trailing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * F-044: the target must stay inside the base AFTER both are resolved
 * through the filesystem.
 */
function assertInsideWorkspace(base, target, message) {
  const realBase = realpathOf(base);
  const realTarget = realpathOf(target);
  const rel = path.relative(realBase, realTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(message);
  }
}

function evaluateExcelRules(rules, ctx) {
  const ruleResults = [];
  for (const rule of rules) {
    const evaluator = EXCEL_VALIDATION_RULES[rule];
    if (!evaluator) {
      throw new Error(`EXCEL_RULE_UNSUPPORTED: ${rule}`);
    }
    const verdict = evaluator(ctx);
    ruleResults.push({
      rule,
      passed: verdict.passed === true,
      detail: verdict.detail,
    });
  }
  return ruleResults;
}

function xmlAttr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`, "u"));
  return match ? match[1] : null;
}

/**
 * Apply `rows` to a template workbook, preserving everything the template
 * already contains.
 *
 * F-126: `template_path` was accepted by the contract and by the parameter
 * list, and then ignored ? `populate` regenerated the workbook from `data` and
 * reported `status: "success"`, so the owner's formatting and formulas were
 * silently lost. The template's own parts (styles, theme, every other sheet)
 * are copied verbatim and the new rows are appended to the target sheet, so
 * the template's existing rows, formulas and formatting survive.
 */
function buildPopulatedWorkbook(templateBuffer, sheetName, rows) {
  const entries = readZipEntries(templateBuffer);
  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8");
  if (!workbookXml) {
    throw new Error(
      "XLSX_WORKBOOK_PART_MISSING: xl/workbook.xml is not present in the template",
    );
  }
  const relsXml =
    entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") || "";
  const relTargets = new Map();
  for (const tag of relsXml.matchAll(/<Relationship\b[^>]*>/gu)) {
    const id = xmlAttr(tag[0], "Id");
    const target = xmlAttr(tag[0], "Target");
    if (id && target) relTargets.set(id, target);
  }
  const sheetTags = [...workbookXml.matchAll(/<sheet\b[^>]*>/gu)].map(
    (match) => match[0],
  );
  if (sheetTags.length === 0) {
    throw new Error(
      "XLSX_TEMPLATE_HAS_NO_SHEET: the template declares no sheet",
    );
  }
  let chosen = null;
  for (const tag of sheetTags) {
    const name = decodeXmlEntities(xmlAttr(tag, "name") || "");
    const relId = xmlAttr(tag, "r:id");
    if (!chosen) chosen = { name, relId };
    if (name === sheetName) {
      chosen = { name, relId };
      break;
    }
  }
  const relTarget = chosen.relId ? relTargets.get(chosen.relId) : null;
  if (!relTarget) {
    throw new Error(
      "XLSX_TEMPLATE_SHEET_UNRESOLVED: the target sheet part is not declared",
    );
  }
  const partPath = relTarget.startsWith("/")
    ? relTarget.slice(1)
    : relTarget.startsWith("xl/")
      ? relTarget
      : `xl/${relTarget}`;
  const sheetPart = entries.get(partPath);
  if (!sheetPart) {
    throw new Error(
      `XLSX_TEMPLATE_SHEET_UNRESOLVED: ${partPath} is not present in the template`,
    );
  }
  const sheetXml = sheetPart.toString("utf8");
  const rowNumbers = [...sheetXml.matchAll(/<row\b[^>]*\br="(\d+)"/gu)].map(
    (match) => Number(match[1]),
  );
  const startRow = (rowNumbers.length ? Math.max(...rowNumbers) : 0) + 1;
  const rowsXml = buildSheetRowsXml(rows, startRow);
  let populatedSheetXml;
  if (/<sheetData\s*\/>/u.test(sheetXml)) {
    populatedSheetXml = sheetXml.replace(
      /<sheetData\s*\/>/u,
      `<sheetData>${rowsXml}</sheetData>`,
    );
  } else if (/<sheetData>/u.test(sheetXml)) {
    populatedSheetXml = sheetXml.replace(
      "</sheetData>",
      `${rowsXml}</sheetData>`,
    );
  } else {
    throw new Error(
      "XLSX_TEMPLATE_SHEET_DATA_MISSING: the target sheet has no <sheetData>",
    );
  }
  const files = {};
  for (const [name, content] of entries) {
    files[name] = name === partPath ? populatedSheetXml : content;
  }
  return {
    buffer: createZipArchive(files),
    sheetNames: sheetTags.map((tag) =>
      decodeXmlEntities(xmlAttr(tag, "name") || ""),
    ),
    targetSheet: chosen.name,
  };
}

function rowsFromData(data) {
  if (Array.isArray(data)) {
    return data.map((item) =>
      Array.isArray(item) ? item : Object.values(item),
    );
  }
  if (data && typeof data === "object") return [Object.values(data)];
  return [];
}

function sheetsFromSpecification(specification) {
  const declared = Array.isArray(specification?.sheets)
    ? specification.sheets
    : [];
  return declared
    .map((sheet, index) => ({
      name: sheet?.name || `Sheet${index + 1}`,
      rows: Array.isArray(sheet?.rows) ? sheet.rows : [],
    }))
    .filter((sheet) => sheet.rows.length > 0);
}

export function executeExcelOperation(params, baseDir = null) {
  const op = normalizeExcelOperation(params?.operation);
  const rawPath = params?.file_path || "workbook.xlsx";
  let cleanPath = rawPath;
  if (cleanPath.startsWith("/workspace/")) {
    cleanPath = cleanPath.slice("/workspace/".length);
  } else if (cleanPath.startsWith("/workspace")) {
    cleanPath = cleanPath.slice("/workspace".length);
  }
  const normalizedPath = cleanPath.endsWith(".xlsx")
    ? cleanPath
    : `${cleanPath}.xlsx`;
  const effectiveBase =
    baseDir && typeof baseDir === "string" && baseDir !== "null"
      ? baseDir
      : null;
  if (!path.isAbsolute(normalizedPath) && !effectiveBase) {
    throw new Error(
      "ARTIFACT_BASE_REQUIRED: Relative workbook paths require an explicit workspace",
    );
  }
  const targetPath = path.isAbsolute(normalizedPath)
    ? normalizedPath
    : path.resolve(effectiveBase, normalizedPath);
  // M10/T2-R19: containment. `path.resolve` silently normalises `..` away, so a
  // `file_path` of "../outside/proof.xlsx" resolved OUT of the agent sandbox and
  // three files (workbook, SVG preview, PNG preview) were written there while the
  // tool reported `status: "success"` and returned only `path.basename`, which
  // hides the escape from the model and from the operator. Proven by execution:
  // the sandbox directory was never created and the files landed one level up.
  //
  // `file_path` is model-supplied (`string`, maxLength 512, no pattern), and the
  // base is the agent sandbox, so the escape is fully reachable from a governed
  // tool call. Absolute paths are permitted only when they stay inside the base
  // too. `path.relative` also reports a different Windows drive as absolute,
  // which is caught by the isAbsolute check.
  if (effectiveBase) {
    const rel = path.relative(path.resolve(effectiveBase), targetPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `ARTIFACT_PATH_ESCAPE: file_path must stay inside the workspace`,
      );
    }
    // F-044: the lexical test above cannot see a junction inside the
    // workspace, so the containment is checked again through the filesystem.
    assertInsideWorkspace(
      effectiveBase,
      targetPath,
      `ARTIFACT_PATH_ESCAPE: file_path must stay inside the workspace`,
    );
  }
  const publicFileName = path.basename(targetPath);

  if (op === "load") {
    if (!fs.existsSync(targetPath)) {
      return {
        status: "ERROR",
        success: false,
        tool: "zink_excel",
        operation: op,
        file_path: publicFileName,
        error: `File not found: ${publicFileName}`,
      };
    }
    const stat = fs.statSync(targetPath);
    // F-126: the sheet names come from the workbook itself, not from a
    // hardcoded `["Sheet1"]`.
    let sheets = [];
    let readable = true;
    let readError = null;
    try {
      sheets = readWorkbookSheetNames(fs.readFileSync(targetPath));
    } catch (error) {
      readable = false;
      readError = error?.message || String(error);
    }
    if (!readable) {
      return {
        status: "ERROR",
        success: false,
        tool: "zink_excel",
        operation: op,
        file_path: publicFileName,
        error: `Workbook is not readable: ${readError}`,
      };
    }
    return {
      status: "success",
      success: true,
      tool: "zink_excel",
      operation: op,
      file_path: publicFileName,
      summary: {
        exists: true,
        size_bytes: stat.size,
        sheets,
        last_modified: stat.mtime.toISOString(),
      },
    };
  }

  if (op === "validate") {
    // F-126: `validate` evaluated nothing. It now evaluates every rule the
    // caller declared and reports one verdict per rule; a rule this module
    // cannot evaluate is refused by an explicit error code.
    const rules =
      Array.isArray(params?.rules) && params.rules.length > 0
        ? params.rules
        : ["file_existence", "extension_check"];
    const exists = fs.existsSync(targetPath);
    let sheets = null;
    let sheetError = null;
    let sizeBytes = 0;
    if (exists) {
      sizeBytes = fs.statSync(targetPath).size;
      try {
        sheets = readWorkbookSheetNames(fs.readFileSync(targetPath));
      } catch (error) {
        sheetError = error?.message || String(error);
      }
    }
    const ruleResults = evaluateExcelRules(rules, {
      exists,
      sizeBytes,
      extension: path.extname(targetPath).toLowerCase(),
      sheets,
      sheetError,
    });
    const valid = ruleResults.every((entry) => entry.passed);
    return {
      status: "success",
      success: true,
      tool: "zink_excel",
      operation: op,
      file_path: publicFileName,
      summary: {
        valid,
        rules_checked: rules,
        rule_results: ruleResults,
      },
    };
  }

  // generate, create, append, write, populate
  const templatePath = params?.template_path;
  if (templatePath && op !== "populate") {
    throw new Error(
      `EXCEL_TEMPLATE_UNSUPPORTED_OPERATION: template_path is only honoured by the populate operation`,
    );
  }

  const declaredSheets = sheetsFromSpecification(params?.specification);
  let rows = [];
  let sheetName =
    params?.specification?.sheets?.[0]?.name || params?.sheet_name || "Sheet1";
  if (declaredSheets.length > 0) {
    rows = declaredSheets[0].rows;
    sheetName = declaredSheets[0].name;
  } else if (params?.data) {
    rows = rowsFromData(params.data);
  }

  if (rows.length === 0) {
    throw new Error(
      "DATA_INPUT_REQUIRED: Data-bearing Excel operations require rows",
    );
  }

  let buf;
  let writtenSheetNames;
  let templateApplied = false;
  if (op === "populate" && templatePath) {
    // F-126: `template_path` is consumed, not ignored.
    const templateTarget = path.isAbsolute(templatePath)
      ? templatePath
      : path.resolve(effectiveBase || ".", templatePath);
    if (effectiveBase) {
      const rel = path.relative(path.resolve(effectiveBase), templateTarget);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(
          `ARTIFACT_PATH_ESCAPE: template_path must stay inside the workspace`,
        );
      }
      // F-044: the same filesystem-resolved containment as the write target.
      assertInsideWorkspace(
        effectiveBase,
        templateTarget,
        `ARTIFACT_PATH_ESCAPE: template_path must stay inside the workspace`,
      );
    }
    if (!fs.existsSync(templateTarget)) {
      throw new Error(
        `EXCEL_TEMPLATE_NOT_FOUND: ${path.basename(templateTarget)}`,
      );
    }
    const populated = buildPopulatedWorkbook(
      fs.readFileSync(templateTarget),
      sheetName,
      rows,
    );
    buf = populated.buffer;
    writtenSheetNames = populated.sheetNames;
    sheetName = populated.targetSheet;
    templateApplied = true;
  } else if (declaredSheets.length > 1) {
    // F-126: every declared sheet is written, not only the first.
    buf = buildMultiSheetWorkbookBuffer(declaredSheets);
    // F-466: report the names the workbook actually declares (sanitised and
    // de-duplicated), not the unnormalised inputs.
    writtenSheetNames = readWorkbookSheetNames(buf);
    sheetName = writtenSheetNames[0];
  } else {
    buf = buildWorkbookBuffer(rows, sheetName);
    writtenSheetNames = readWorkbookSheetNames(buf);
    sheetName = writtenSheetNames[0];
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, buf);

  // Generate real visual SVG preview of the spreadsheet
  const previewSvg = renderSheetPreviewSvg(rows, sheetName);
  const previewPath = targetPath.replace(/\.xlsx$/i, "_preview.svg");
  fs.writeFileSync(previewPath, previewSvg, "utf8");

  // Generate real visual PNG preview of the spreadsheet
  const previewPngPath = targetPath.replace(/\.xlsx$/i, "_preview.png");
  renderSheetPreviewPng(rows, sheetName, previewPngPath);

  const logicalFilePath = publicFileName;
  const previewFileName = path.basename(previewPath);
  const previewPngFileName = path.basename(previewPngPath);

  return {
    status: "success",
    success: true,
    tool: "zink_excel",
    operation: op,
    file_path: logicalFilePath,
    container_path: logicalFilePath,
    preview_image_path: previewFileName,
    preview_image_file: previewFileName,
    preview_svg_path: previewFileName,
    preview_png_path: previewPngFileName,
    preview_png_file: previewPngFileName,
    summary: {
      rows: rows.length,
      columns: rows[0]?.length || 1,
      sheets: writtenSheetNames,
      size_bytes: buf.length,
      template_applied: templateApplied,
      preview_image: path.basename(previewPath),
      preview_png: path.basename(previewPngPath),
      file_path: logicalFilePath,
      message: `Workbook ${op} completed successfully with real image preview at ${path.basename(previewPath)} and ${path.basename(previewPngPath)}`,
    },
  };
}
export function renderSheetPreviewSvg(rows, sheetName = "Sheet1") {
  const displayRows = rows.slice(0, 15);
  const maxCols = Math.min(
    8,
    Math.max(...displayRows.map((r) => (Array.isArray(r) ? r.length : 1)), 1),
  );
  const colWidth = 140;
  const rowHeight = 32;
  const headerHeight = 44;
  const titleHeight = 50;
  const totalWidth = Math.max(500, maxCols * colWidth + 60);
  const totalHeight =
    titleHeight + headerHeight + displayRows.length * rowHeight + 40;

  const colLetters = Array.from({ length: maxCols }, (_, i) =>
    String.fromCharCode(65 + i),
  );

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" style="background-color: #1e1e24; font-family: 'Segoe UI', Helvetica, Arial, sans-serif;">
  <!-- Title bar -->
  <rect x="0" y="0" width="${totalWidth}" height="${titleHeight}" fill="#107c41" />
  <text x="20" y="32" fill="#ffffff" font-size="18" font-weight="bold">📊 Microsoft Excel Preview — ${escapeXml(sheetName)}</text>

  <!-- Column header background -->
  <rect x="50" y="${titleHeight}" width="${maxCols * colWidth}" height="${headerHeight}" fill="#2d2d34" stroke="#3e3e46" />
`;

  colLetters.forEach((letter, c) => {
    svg += `  <rect x="${50 + c * colWidth}" y="${titleHeight}" width="${colWidth}" height="${headerHeight}" fill="#2a2d32" stroke="#3e3e46" />\n`;
    svg += `  <text x="${50 + c * colWidth + colWidth / 2}" y="${titleHeight + 28}" fill="#9da5b4" font-size="14" font-weight="bold" text-anchor="middle">${letter}</text>\n`;
  });

  displayRows.forEach((row, r) => {
    const y = titleHeight + headerHeight + r * rowHeight;
    const isFirstRow = r === 0;
    const rowBg = isFirstRow ? "#243228" : r % 2 === 0 ? "#25252b" : "#1e1e24";

    svg += `  <rect x="10" y="${y}" width="40" height="${rowHeight}" fill="#2d2d34" stroke="#3e3e46" />\n`;
    svg += `  <text x="30" y="${y + 20}" fill="#9da5b4" font-size="12" text-anchor="middle">${r + 1}</text>\n`;

    for (let c = 0; c < maxCols; c++) {
      const val =
        Array.isArray(row) && row[c] !== undefined && row[c] !== null
          ? String(row[c])
          : "";
      const textColor = isFirstRow ? "#4ec9b0" : "#d4d4d4";
      const fontWeight = isFirstRow ? "bold" : "normal";
      svg += `  <rect x="${50 + c * colWidth}" y="${y}" width="${colWidth}" height="${rowHeight}" fill="${rowBg}" stroke="#3e3e46" />\n`;
      svg += `  <text x="${50 + c * colWidth + 10}" y="${y + 20}" fill="${textColor}" font-size="13" font-weight="${fontWeight}">${escapeXml(val.slice(0, 18))}</text>\n`;
    }
  });

  const footerY =
    titleHeight + headerHeight + displayRows.length * rowHeight + 24;
  svg += `  <text x="20" y="${footerY}" fill="#6a9955" font-size="12">Preview generated from supplied workbook data • ${rows.length} rows total</text>\n`;
  svg += `</svg>`;
  return svg;
}

function escapeXml(unsafe) {
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
    }
  });
}

export function renderSheetPreviewHtml(rows, sheetName = "Sheet1") {
  const displayRows = rows.slice(0, 15);
  const maxCols = Math.min(
    8,
    Math.max(...displayRows.map((r) => (Array.isArray(r) ? r.length : 1)), 1),
  );

  let theadHtml = "";
  let tbodyHtml = "";

  displayRows.forEach((row, r) => {
    const isFirstRow = r === 0;
    const isTotalRow =
      Array.isArray(row) &&
      row.some(
        (cell) =>
          typeof cell === "string" &&
          (cell.includes("TỔNG") || cell.includes("TOTAL")),
      );

    let rowCells = "";
    for (let c = 0; c < maxCols; c++) {
      let val =
        Array.isArray(row) && row[c] !== undefined && row[c] !== null
          ? String(row[c])
          : "";

      if (isFirstRow) {
        rowCells += `<th>${escapeXml(val)}</th>`;
      } else {
        let badgeHtml = null;
        if (/^(ĐẠT|PASS|OK|XUẤT SẮC)$/i.test(val.trim())) {
          badgeHtml = `<span class="badge badge-pass">${escapeXml(val)}</span>`;
        } else if (/^(KHÔNG ĐẠT|FAIL|CẢNH BÁO)$/i.test(val.trim())) {
          badgeHtml = `<span class="badge badge-fail">${escapeXml(val)}</span>`;
        }

        // Format number with commas if applicable
        if (!badgeHtml && /^\d{4,}$/.test(val.trim())) {
          val = Number(val).toLocaleString("en-US");
        }

        rowCells += `<td>${badgeHtml || escapeXml(val)}</td>`;
      }
    }

    if (isFirstRow) {
      theadHtml = `<tr>${rowCells}</tr>`;
    } else {
      const rowClass = isTotalRow ? ' class="total"' : "";
      tbodyHtml += `<tr${rowClass}>${rowCells}</tr>`;
    }
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    margin: 0;
    padding: 20px;
    background: #18191c;
    color: #f2f3f5;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }
  .card {
    background: #2b2d31;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    border: 1px solid #383a40;
    max-width: 920px;
  }
  .header {
    background: #107c41;
    color: white;
    padding: 12px 20px;
    font-size: 16px;
    font-weight: bold;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    background: #232428;
    color: #949ba4;
    padding: 10px 14px;
    text-align: left;
    font-size: 13px;
    border-bottom: 1px solid #383a40;
  }
  td {
    padding: 9px 14px;
    font-size: 13px;
    border-bottom: 1px solid #313338;
    color: #dbdee1;
  }
  tr:nth-child(even) td {
    background: #2e3035;
  }
  tr.total td {
    background: #202225;
    font-weight: bold;
    color: #57f287;
    border-top: 2px solid #57f287;
  }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
  }
  .badge-pass {
    background: #23a55a;
    color: white;
  }
  .badge-fail {
    background: #da373c;
    color: white;
  }
  .footer {
    background: #232428;
    padding: 8px 20px;
    font-size: 12px;
    color: #949ba4;
  }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    📊 Microsoft Excel Preview — ${escapeXml(sheetName)}
  </div>
  <table>
    <thead>${theadHtml}</thead>
    <tbody>${tbodyHtml}</tbody>
  </table>
  <div class="footer">
    Preview generated from supplied workbook data • ${rows.length} rows total
  </div>
</div>
</body>
</html>`;
}

// 5x7 font definitions for printable ASCII (32-126)
const FONT_5X7 = {
  " ": [0x00, 0x00, 0x00, 0x00, 0x00],
  "!": [0x00, 0x00, 0x5f, 0x00, 0x00],
  '"': [0x00, 0x07, 0x00, 0x07, 0x00],
  "#": [0x14, 0x7f, 0x14, 0x7f, 0x14],
  $: [0x24, 0x2a, 0x7f, 0x2a, 0x12],
  "%": [0x23, 0x13, 0x08, 0x64, 0x62],
  "&": [0x36, 0x49, 0x55, 0x22, 0x50],
  "'": [0x00, 0x05, 0x03, 0x00, 0x00],
  "(": [0x00, 0x1c, 0x22, 0x41, 0x00],
  ")": [0x00, 0x41, 0x22, 0x1c, 0x00],
  "*": [0x14, 0x08, 0x3e, 0x08, 0x14],
  "+": [0x08, 0x08, 0x3e, 0x08, 0x08],
  ",": [0x00, 0x50, 0x30, 0x00, 0x00],
  "-": [0x08, 0x08, 0x08, 0x08, 0x08],
  ".": [0x00, 0x60, 0x60, 0x00, 0x00],
  "/": [0x20, 0x10, 0x08, 0x04, 0x02],
  0: [0x3e, 0x51, 0x49, 0x45, 0x3e],
  1: [0x00, 0x42, 0x7f, 0x40, 0x00],
  2: [0x42, 0x61, 0x51, 0x49, 0x46],
  3: [0x21, 0x41, 0x45, 0x4b, 0x31],
  4: [0x18, 0x14, 0x12, 0x7f, 0x10],
  5: [0x27, 0x45, 0x45, 0x45, 0x39],
  6: [0x3c, 0x4a, 0x49, 0x49, 0x30],
  7: [0x01, 0x71, 0x09, 0x05, 0x03],
  8: [0x36, 0x49, 0x49, 0x49, 0x36],
  9: [0x06, 0x49, 0x49, 0x29, 0x1e],
  ":": [0x00, 0x36, 0x36, 0x00, 0x00],
  ";": [0x00, 0x56, 0x36, 0x00, 0x00],
  "<": [0x08, 0x14, 0x22, 0x41, 0x00],
  "=": [0x14, 0x14, 0x14, 0x14, 0x14],
  ">": [0x00, 0x41, 0x22, 0x14, 0x08],
  "?": [0x02, 0x01, 0x51, 0x09, 0x06],
  "@": [0x32, 0x49, 0x79, 0x41, 0x3e],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e],
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a],
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e],
  R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31],
  T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x3f, 0x40, 0x38, 0x40, 0x3f],
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
  Z: [0x61, 0x51, 0x49, 0x45, 0x43],
  "[": [0x00, 0x7f, 0x41, 0x41, 0x00],
  "\\": [0x02, 0x04, 0x08, 0x10, 0x20],
  "]": [0x00, 0x41, 0x41, 0x7f, 0x00],
  "^": [0x04, 0x02, 0x01, 0x02, 0x04],
  _: [0x40, 0x40, 0x40, 0x40, 0x40],
  "`": [0x00, 0x01, 0x02, 0x04, 0x00],
  a: [0x20, 0x54, 0x54, 0x54, 0x78],
  b: [0x7f, 0x48, 0x44, 0x44, 0x38],
  c: [0x38, 0x44, 0x44, 0x44, 0x20],
  d: [0x38, 0x44, 0x44, 0x48, 0x7f],
  e: [0x38, 0x54, 0x54, 0x54, 0x18],
  f: [0x08, 0x7e, 0x09, 0x01, 0x02],
  g: [0x0c, 0x52, 0x52, 0x52, 0x3e],
  h: [0x7f, 0x08, 0x04, 0x04, 0x78],
  i: [0x00, 0x44, 0x7d, 0x40, 0x00],
  j: [0x20, 0x40, 0x44, 0x3d, 0x00],
  k: [0x7f, 0x10, 0x28, 0x44, 0x00],
  l: [0x00, 0x41, 0x7f, 0x40, 0x00],
  m: [0x7c, 0x04, 0x18, 0x04, 0x78],
  n: [0x7c, 0x08, 0x04, 0x04, 0x78],
  o: [0x38, 0x44, 0x44, 0x44, 0x38],
  p: [0x7c, 0x14, 0x14, 0x14, 0x08],
  q: [0x08, 0x14, 0x14, 0x18, 0x7c],
  r: [0x7c, 0x08, 0x04, 0x04, 0x08],
  s: [0x48, 0x54, 0x54, 0x54, 0x20],
  t: [0x04, 0x3f, 0x44, 0x40, 0x20],
  u: [0x3c, 0x40, 0x40, 0x20, 0x7c],
  v: [0x1c, 0x20, 0x40, 0x20, 0x1c],
  w: [0x3c, 0x40, 0x30, 0x40, 0x3c],
  x: [0x44, 0x28, 0x10, 0x28, 0x44],
  y: [0x0c, 0x50, 0x50, 0x50, 0x3c],
  z: [0x44, 0x64, 0x54, 0x4c, 0x44],
  "{": [0x00, 0x08, 0x36, 0x41, 0x00],
  "|": [0x00, 0x00, 0x7f, 0x00, 0x00],
  "}": [0x00, 0x41, 0x36, 0x08, 0x00],
  "~": [0x08, 0x04, 0x08, 0x10, 0x08],
};

function normalizeAscii(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (m) => (m === "đ" ? "d" : "D"));
}

function drawChar(
  rgba,
  width,
  height,
  ch,
  startX,
  startY,
  scale,
  r,
  g,
  b,
  a = 255,
) {
  const glyph = FONT_5X7[ch] || FONT_5X7["?"] || [0x00, 0x00, 0x00, 0x00, 0x00];
  for (let col = 0; col < 5; col++) {
    const colBits = glyph[col];
    for (let row = 0; row < 7; row++) {
      if ((colBits & (1 << row)) !== 0) {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = startX + col * scale + dx;
            const py = startY + row * scale + dy;
            if (px >= 0 && px < width && py >= 0 && py < height) {
              const idx = (py * width + px) * 4;
              rgba[idx] = r;
              rgba[idx + 1] = g;
              rgba[idx + 2] = b;
              rgba[idx + 3] = a;
            }
          }
        }
      }
    }
  }
}

function drawText(
  rgba,
  width,
  height,
  text,
  startX,
  startY,
  scale = 1,
  r = 255,
  g = 255,
  b = 255,
  maxWidth = Infinity,
) {
  const clean = normalizeAscii(text);
  let curX = startX;
  const charWidth = 6 * scale;
  for (let i = 0; i < clean.length; i++) {
    if (curX + charWidth > startX + maxWidth) {
      if (curX + 3 * charWidth <= startX + maxWidth) {
        drawChar(rgba, width, height, ".", curX, startY, scale, r, g, b);
        drawChar(
          rgba,
          width,
          height,
          ".",
          curX + 4 * scale,
          startY,
          scale,
          r,
          g,
          b,
        );
        drawChar(
          rgba,
          width,
          height,
          ".",
          curX + 8 * scale,
          startY,
          scale,
          r,
          g,
          b,
        );
      }
      break;
    }
    drawChar(rgba, width, height, clean[i], curX, startY, scale, r, g, b);
    curX += charWidth;
  }
}

function fillRect(rgba, width, height, x0, y0, w, h, r, g, b, a = 255) {
  const x1 = Math.min(width, Math.max(0, x0 + w));
  const y1 = Math.min(height, Math.max(0, y0 + h));
  const startX = Math.max(0, x0);
  const startY = Math.max(0, y0);
  for (let y = startY; y < y1; y++) {
    for (let x = startX; x < x1; x++) {
      const idx = (y * width + x) * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = a;
    }
  }
}

function extractTableData(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { headers: ["Column 1"], data: [["(No Data)"]], totalRows: 0 };
  }
  const first = rows[0];
  if (Array.isArray(first)) {
    if (rows.length > 1) {
      return {
        headers: first.map(String),
        data: rows
          .slice(1)
          .map((r) => (Array.isArray(r) ? r.map(String) : [String(r)])),
        totalRows: rows.length - 1,
      };
    } else {
      return {
        headers: first.map((_, i) => `Col ${i + 1}`),
        data: [first.map(String)],
        totalRows: 1,
      };
    }
  } else if (typeof first === "object" && first !== null) {
    const keys = Object.keys(first);
    return {
      headers: keys,
      data: rows.map((r) => keys.map((k) => String(r[k] ?? ""))),
      totalRows: rows.length,
    };
  } else {
    return {
      headers: ["Value"],
      data: rows.map((r) => [String(r)]),
      totalRows: rows.length,
    };
  }
}

export function renderSheetPreviewPng(rows, sheetName, targetPngPath) {
  fs.mkdirSync(path.dirname(targetPngPath), { recursive: true });
  const pngBuf = generatePureNodePng(rows, sheetName);
  fs.writeFileSync(targetPngPath, pngBuf);
  return targetPngPath;
}

function createPngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = calculateCrc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// The brand strip is the only part of this renderer that says which screen the
// preview imitates. It is a parameter now because M12/T1-R1 previews the expected
// result of SQL, Python and Power BI work too; Excel keeps exactly the pixels it
// produced before, because the defaults are the values that were hardcoded here.
export const EXCEL_PREVIEW_BRAND = Object.freeze({
  label: "MICROSOFT EXCEL PREVIEW",
  rgb: Object.freeze([16, 124, 65]),
});

export function generatePureNodePng(
  rows,
  sheetName = "Sheet1",
  brand = EXCEL_PREVIEW_BRAND,
) {
  const width = 850;
  const height = 440;
  const rgba = Buffer.alloc(width * height * 4);

  const brandRgb =
    Array.isArray(brand?.rgb) && brand.rgb.length === 3
      ? brand.rgb
      : EXCEL_PREVIEW_BRAND.rgb;
  const brandLabel =
    typeof brand?.label === "string" && brand.label.trim().length > 0
      ? brand.label.trim().toUpperCase()
      : EXCEL_PREVIEW_BRAND.label;

  // Background #111827 (dark slate)
  fillRect(rgba, width, height, 0, 0, width, height, 17, 24, 39);

  // Brand header strip
  fillRect(
    rgba,
    width,
    height,
    0,
    0,
    width,
    48,
    brandRgb[0],
    brandRgb[1],
    brandRgb[2],
  );
  drawText(
    rgba,
    width,
    height,
    `${brandLabel} - ${String(sheetName).toUpperCase()}`,
    20,
    16,
    2,
    255,
    255,
    255,
  );

  const { headers, data, totalRows } = extractTableData(rows);

  const marginX = 20;
  const tableW = width - marginX * 2;
  const colCount = Math.max(1, Math.min(headers.length, 7)); // max 7 columns visible
  const colW = Math.floor(tableW / colCount);

  // Table Header Background #1f2937
  fillRect(rgba, width, height, marginX, 60, tableW, 32, 31, 41, 55);
  // Bottom border of header #374151
  fillRect(rgba, width, height, marginX, 91, tableW, 2, 55, 65, 81);

  // Draw Header Labels
  for (let c = 0; c < colCount; c++) {
    const colName = headers[c] || `Col ${c + 1}`;
    const x = marginX + c * colW + 8;
    drawText(rgba, width, height, colName, x, 70, 1, 243, 244, 246, colW - 16);
  }

  // Draw Rows
  const maxDisplayRows = 10;
  const rowCount = Math.min(data.length, maxDisplayRows);
  const rowH = 28;

  for (let r = 0; r < rowCount; r++) {
    const rowY = 93 + r * rowH;
    const isEven = r % 2 === 0;
    // Row background
    if (isEven) {
      fillRect(
        rgba,
        width,
        height,
        marginX,
        rowY,
        tableW,
        rowH - 1,
        24,
        32,
        47,
      );
    } else {
      fillRect(
        rgba,
        width,
        height,
        marginX,
        rowY,
        tableW,
        rowH - 1,
        17,
        24,
        39,
      );
    }
    // Subtle row divider line
    fillRect(
      rgba,
      width,
      height,
      marginX,
      rowY + rowH - 1,
      tableW,
      1,
      38,
      48,
      65,
    );

    const rowCells = data[r] || [];
    for (let c = 0; c < colCount; c++) {
      const val = rowCells[c] !== undefined ? String(rowCells[c]) : "";
      const x = marginX + c * colW + 8;
      drawText(
        rgba,
        width,
        height,
        val,
        x,
        rowY + 9,
        1,
        226,
        232,
        240,
        colW - 16,
      );
    }
  }

  // Footer bar #1f2937
  const footerY = height - 36;
  fillRect(rgba, width, height, marginX, footerY, tableW, 26, 31, 41, 55);
  const footerText = `VERIFIED DATA: ${totalRows} total rows | Generated by Zink Specialist`;
  drawText(
    rgba,
    width,
    height,
    footerText,
    marginX + 12,
    footerY + 8,
    1,
    156,
    163,
    175,
  );

  // PNG Framing
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = createPngChunk("IHDR", ihdr);

  const scanlineLength = width * 4 + 1;
  const filtered = Buffer.alloc(scanlineLength * height);
  for (let y = 0; y < height; y++) {
    filtered[y * scanlineLength] = 0;
    rgba.copy(
      filtered,
      y * scanlineLength + 1,
      y * width * 4,
      (y + 1) * width * 4,
    );
  }
  const idatChunk = createPngChunk(
    "IDAT",
    zlib.deflateSync(filtered, { level: 6 }),
  );
  const iendChunk = createPngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}
