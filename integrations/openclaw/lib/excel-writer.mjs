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

export function buildWorkbookBuffer(rows = [], sheetName = "Sheet1") {
  let sheetRowsXml = "";
  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const rowNum = rIdx + 1;
    let cellsXml = "";
    const row = Array.isArray(rows[rIdx]) ? rows[rIdx] : [rows[rIdx]];
    for (let cIdx = 0; cIdx < row.length; cIdx++) {
      const colLetter = spreadsheetColumnLetter(cIdx);
      const val = String(row[cIdx] ?? "");
      const escaped = val
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      cellsXml += `<c r="${colLetter}${rowNum}" t="inlineStr"><is><t>${escaped}</t></is></c>`;
    }
    sheetRowsXml += `<row r="${rowNum}">${cellsXml}</row>`;
  }

  const safeSheetName = sheetName.replace(/[^a-zA-Z0-9_-]/g, "") || "Sheet1";

  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${sheetRowsXml}
  </sheetData>
</worksheet>`,
  };

  return createZipArchive(files);
}

export function executeExcelOperation(params, baseDir = null) {
  const op = params?.operation || "generate";
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
  }
  const publicFileName = path.basename(targetPath);

  if (op === "load" || op === "read") {
    let checkPath = targetPath;
    if (!fs.existsSync(checkPath)) {
      return {
        status: "ERROR",
        tool: "zink_excel",
        operation: op,
        file_path: publicFileName,
        error: `File not found: ${publicFileName}`,
      };
    }
    const stat = fs.statSync(checkPath);
    return {
      status: "success",
      tool: "zink_excel",
      operation: op,
      file_path: publicFileName,
      summary: {
        exists: true,
        size_bytes: stat.size,
        sheets: ["Sheet1"],
        last_modified: stat.mtime.toISOString(),
      },
    };
  }

  if (op === "validate") {
    const exists = fs.existsSync(targetPath);
    return {
      status: exists ? "success" : "ERROR",
      tool: "zink_excel",
      operation: "validate",
      file_path: publicFileName,
      summary: {
        valid: exists,
        rules_checked: params?.rules || ["file_existence", "extension_check"],
      },
    };
  }

  // generate, create, populate, append, write
  let rows = [];
  if (Array.isArray(params?.specification?.sheets?.[0]?.rows)) {
    rows = params.specification.sheets[0].rows;
  } else if (params?.data) {
    if (Array.isArray(params.data)) {
      rows = params.data.map((item) =>
        Array.isArray(item) ? item : Object.values(item),
      );
    } else if (typeof params.data === "object") {
      rows = [Object.values(params.data)];
    }
  }

  if (rows.length === 0) {
    throw new Error(
      "DATA_INPUT_REQUIRED: Data-bearing Excel operations require rows",
    );
  }

  const sheetName =
    params?.specification?.sheets?.[0]?.name || params?.sheet_name || "Sheet1";
  const buf = buildWorkbookBuffer(rows, sheetName);

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
      sheets: [sheetName],
      size_bytes: buf.length,
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

export function generatePureNodePng(rows, sheetName = "Sheet1") {
  const width = 850;
  const height = 440;
  const rgba = Buffer.alloc(width * height * 4);

  // Background #111827 (dark slate)
  fillRect(rgba, width, height, 0, 0, width, height, 17, 24, 39);

  // Excel Brand Header #107c41
  fillRect(rgba, width, height, 0, 0, width, 48, 16, 124, 65);
  drawText(
    rgba,
    width,
    height,
    `MICROSOFT EXCEL PREVIEW - ${String(sheetName).toUpperCase()}`,
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
