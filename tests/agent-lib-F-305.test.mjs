// F-305 (R7-C6-06) — the preview renderer sanitises every inbound string.
//
// The plugin's seam gate (`previewInputIsSanitised`) already refuses an
// unsanitised string before it reaches the renderer, but a renderer that
// depends on its caller to have sanitised is a contract every caller has to
// remember. The module now sanitises the headers, the cells and the notes
// itself, so a token-shaped value cannot reach the image through any caller.
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPreviewTable,
  renderExpectedResultPreview,
} from "../integrations/openclaw/lib/discord-result-preview.mjs";
import { sanitizeDiscordText } from "../integrations/openclaw/lib/discord-formatter.mjs";

const TOKEN = "/home/hoang_vinh/.openclaw-zink/state";

// The token is one the canonical sanitiser removes: the seam gate compares
// the sanitised value with the original, so a value the sanitiser leaves
// alone is not a sanitisation case at all.
assert.notEqual(
  sanitizeDiscordText(TOKEN),
  TOKEN,
  "the token must be one the canonical sanitiser removes",
);

test("F-305: the table builder sanitises the headers, the cells and the notes", () => {
  const table = buildPreviewTable({
    columns: [`head${TOKEN}`],
    rows: [[`cell${TOKEN}`]],
    notes: `note${TOKEN}`,
  });
  for (const value of [
    ...table.headers,
    ...table.rows.flat(),
    table.notes ?? "",
  ]) {
    assert.ok(
      !String(value).includes(TOKEN),
      `the preview must not carry a token-shaped value: ${value}`,
    );
  }
});

test("F-305: the renderer sanitises the title it is given", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(os.tmpdir(), "zink-f305-"));
  try {
    const filePath = renderExpectedResultPreview({
      target: "main",
      title: `title${TOKEN}`,
      columns: [`head${TOKEN}`],
      rows: [[`cell${TOKEN}`]],
      notes: `note${TOKEN}`,
      outputDirectory: dir,
    });
    assert.ok(filePath, "the renderer must produce a file");
    const bytes = readFileSync(filePath);
    // the PNG carries the rendered text; the token must not be in the bytes
    const asText = bytes.toString("latin1");
    assert.ok(
      !asText.includes(TOKEN),
      "the rendered image must not carry a token-shaped value",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
