/**
 * M12/T1-R1 — expected-result preview images for governed Discord cards.
 *
 * The owner's requirement, verbatim: "Kết quả: Trả về hình ảnh kết quả dự kiến, ưu tiên
 * hình ảnh trùng khớp với giao diện Excel, SQL, Python, PowerBI vì anh đã cấp quyền truy
 * cập cho các cái này, lúc này request revision mới có ý nghĩa." A wall of prose is not
 * reviewable; a picture of the screen the work will produce is, and it is what makes
 * "Request Revision" a real answer instead of a guess.
 *
 * There is already exactly one PNG encoder in this repository that needs no native or
 * npm dependency (`generatePureNodePng` in `excel-writer.mjs`), so this module renders
 * through it and only chooses the brand strip — the label and colour that say which
 * screen the preview imitates. No second encoder, no new dependency.
 *
 * The image is a MOCK-UP of the expected result. It is drawn from the columns and rows
 * the approved plan actually declares; anything the plan does not declare is stated as
 * unknown on the image rather than invented, because a preview that fabricates the
 * owner's data is worse than no preview.
 */

import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

import { generatePureNodePng } from "./excel-writer.mjs";

export const RESULT_PREVIEW_BRANDS = Object.freeze({
  excel: Object.freeze({
    label: "MICROSOFT EXCEL WORKBOOK",
    rgb: Object.freeze([16, 124, 65]),
  }),
  sql: Object.freeze({
    label: "SQL SERVER RESULTS GRID",
    rgb: Object.freeze([68, 121, 193]),
  }),
  python: Object.freeze({
    label: "PYTHON OUTPUT / DATAFRAME",
    rgb: Object.freeze([55, 118, 171]),
  }),
  "power-bi": Object.freeze({
    label: "POWER BI DASHBOARD CANVAS",
    rgb: Object.freeze([212, 175, 55]),
  }),
  o1: Object.freeze({
    label: "ETL PIPELINE OUTPUT",
    rgb: Object.freeze([68, 121, 193]),
  }),
  o2: Object.freeze({
    label: "ANALYTICS DELIVERABLE",
    rgb: Object.freeze([212, 175, 55]),
  }),
  main: Object.freeze({
    label: "ZINK COORDINATOR OUTPUT",
    rgb: Object.freeze([75, 102, 173]),
  }),
});

const UNKNOWN_COLUMN = "(cột sẽ được xác định khi chạy)";

function sanitizeTarget(target) {
  const value = String(target ?? "result")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/gu, "-");
  return value.length > 0 ? value.slice(0, 40) : "result";
}

/**
 * The preview's table: the plan's declared columns and sample rows, with anything
 * the plan does not declare labelled as such instead of filled with invented data.
 */
export function buildPreviewTable({ columns = [], rows = [], notes = "" }) {
  const headerRow = (Array.isArray(columns) ? columns : [])
    .map((column) => String(column ?? "").trim())
    .filter((column) => column.length > 0)
    .slice(0, 7);
  const headers = headerRow.length > 0 ? headerRow : [UNKNOWN_COLUMN];
  const dataRows = (Array.isArray(rows) ? rows : []).slice(0, 8).map((row) => {
    const cells = Array.isArray(row)
      ? row
      : [
          typeof row === "object" && row !== null
            ? JSON.stringify(row)
            : String(row ?? ""),
        ];
    return headers.map((_header, index) =>
      String(cells[index] ?? "").slice(0, 40),
    );
  });
  const note = String(notes ?? "").trim();
  if (dataRows.length === 0) {
    dataRows.push(
      headers.map((_header, index) =>
        index === 0
          ? note
            ? `du kien: ${note.slice(0, 60)}`
            : "(du kien: chua khai bao trong ke hoach)"
          : "-",
      ),
    );
  }
  return { headers, rows: dataRows };
}

/**
 * Render the expected-result PNG into a caller-owned directory and return its path.
 * The directory must be absolute and must not be reachable through a path traversal;
 * the caller owns it, which is why the transport layer separately confines the
 * attachment root it hands to the host.
 */
export function renderExpectedResultPreview({
  target = "main",
  title = "",
  columns = [],
  rows = [],
  notes = "",
  outputDirectory,
} = {}) {
  if (
    typeof outputDirectory !== "string" ||
    !path.isAbsolute(outputDirectory)
  ) {
    throw new Error("RESULT_PREVIEW_OUTPUT_DIR_REQUIRED");
  }
  const normalized = path.normalize(outputDirectory);
  if (normalized !== outputDirectory || normalized.split("..").length > 1) {
    throw new Error("RESULT_PREVIEW_OUTPUT_DIR_UNSAFE");
  }
  const sheetTitle = String(title ?? "").trim() || `expected ${target} result`;
  const { headers, rows: tableRows } = buildPreviewTable({
    columns,
    rows,
    notes,
  });
  const png = generatePureNodePng(
    [headers, ...tableRows],
    sheetTitle,
    RESULT_PREVIEW_BRANDS[sanitizeTarget(target)] ?? RESULT_PREVIEW_BRANDS.main,
  );
  const filePath = path.join(
    normalized,
    `expected_result_${sanitizeTarget(target)}.png`,
  );
  mkdirSync(normalized, { recursive: true });
  writeFileSync(filePath, png);
  return filePath;
}
