// M12/T9 F-302 (legacy R7-C6-02) + F-305 (legacy R7-C6-06) - the expected-result
// preview must be filled from the admitted plan, and the seam must refuse an
// unsanitised string.
//
// MEASURED AT HEAD: the only production caller of the preview renderer passed
// a target, a title, a truncated note string and an output directory, so the
// renderer's placeholder header was the only layout that ever ran - while the
// task's own plan nodes were read one statement later for the text card.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const load = async (rel) => import(pathToFileURL(path.join(REPO_ROOT, rel)).href);
const plugin = await load(
  "integrations/openclaw/plugins/zink-governance/index.mjs",
);
const { renderExpectedResultPreview, buildPreviewTable } = await load(
  "integrations/openclaw/lib/discord-result-preview.mjs",
);

const PLACEHOLDER = "(cột sẽ được xác định khi chạy)";

const PLAN_NODES = [
  {
    node_id: "node-excel",
    agent_id: "excel",
    stack_id: "data_plant",
    dependencies: [],
    required: true,
    inputs: "Tổng hợp doanh thu theo tháng",
    constraints: "Chỉ đọc",
    validation_criteria: "Tổng khớp báo cáo tài chính",
  },
];

test("F-302: a task whose plan declares criteria produces a real table", () => {
  const inputs = plugin.buildExpectedResultPreviewInputs(
    { nodes: PLAN_NODES },
    "step inputs",
  );
  assert.ok(inputs.columns.length > 0, "columns must be produced");
  assert.notEqual(inputs.columns[0], PLACEHOLDER);
  assert.equal(inputs.rows.length, 1);
  assert.equal(inputs.rows[0][0], "node-excel");
  assert.match(String(inputs.rows[0][2]), /doanh thu/u);
  assert.match(String(inputs.rows[0][3]), /khớp báo cáo/u);
});

test("F-302: the rendered table header is NOT the placeholder value", () => {
  const inputs = plugin.buildExpectedResultPreviewInputs(
    { nodes: PLAN_NODES },
    "step inputs",
  );
  const table = buildPreviewTable(inputs);
  assert.notEqual(table.headers[0], PLACEHOLDER);
  assert.notDeepEqual(table.headers, [PLACEHOLDER]);
  assert.equal(table.rows.length >= 1, true);
});

test("F-302: a task with no declared plan keeps the placeholder", () => {
  const inputs = plugin.buildExpectedResultPreviewInputs({}, "");
  assert.deepEqual(inputs.columns, []);
  assert.deepEqual(inputs.rows, []);
  const table = buildPreviewTable(inputs);
  assert.deepEqual(table.headers, [PLACEHOLDER]);
});

test("F-302: the real card path hands the table to the renderer", () => {
  // The preview call site must pass the produced columns and rows.
  const source = readFileSync(
    path.join(REPO_ROOT, "integrations/openclaw/plugins/zink-governance/index.mjs"),
    "utf8",
  );
  const at = source.indexOf("renderExpectedResultPreview({");
  assert.ok(at > 0, "the preview call site must exist");
  const call = source.slice(at, at + 700);
  assert.match(call, /columns:\s*previewInputs\.columns/u);
  assert.match(call, /rows:\s*previewInputs\.rows/u);
});

test("F-305: the seam refuses a token-shaped string", () => {
  assert.equal(
    plugin.previewInputIsSanitised("Tổng hợp doanh thu theo tháng"),
    true,
  );
  assert.equal(
    plugin.previewInputIsSanitised(
      "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    ),
    false,
    "a token-shaped string must not be accepted at the seam",
  );
  assert.equal(
    plugin.previewInputIsSanitised(
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    ),
    false,
  );
  assert.equal(
    plugin.previewInputIsSanitised("a".repeat(64)),
    false,
    "a 64-hex digest must not be accepted at the seam",
  );
  assert.equal(plugin.previewInputIsSanitised(undefined), true);
  assert.equal(plugin.previewInputIsSanitised(42), true);
});

test("F-302/F-305: a declared plan with a token is refused before the image", () => {
  const inputs = plugin.buildExpectedResultPreviewInputs(
    {
      nodes: [
        {
          node_id: "node-sql",
          agent_id: "sql",
          inputs: "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
          validation_criteria: "rows > 0",
        },
      ],
    },
    "",
  );
  const unsanitised = [
    ...inputs.columns,
    ...inputs.rows.flat(),
    inputs.notes,
  ]
    .filter(
      (value) =>
        typeof value === "string" && !plugin.previewInputIsSanitised(value),
    );
  assert.equal(unsanitised.length > 0, true, "the token must be caught");
});


