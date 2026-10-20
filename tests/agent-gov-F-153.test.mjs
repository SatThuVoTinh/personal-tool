// F-153 (R5-E12-01) — AGENTS.md §11 forbids committing implementation until the
// review-convergence and Final Quality Gate are PASS, and neither token has ever
// been recorded.
//
// Every PLAN.md row marked CLOSED/COMPLETE/REMOTE-BACKED shows an explicit
// populated Review Convergence Gate and Final Quality Gate status, one pair per
// closed task, never a prose-only summary.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLAN = readFileSync(path.join(REPO_ROOT, "PLAN.md"), "utf8");
const LINES = PLAN.split("\n");

const GATE_TOKENS = new Set(["PASS", "FAIL", "NOT RUN"]);
const CLOSED_TOKENS = new Set(["COMPLETE", "CLOSED", "REMOTE-BACKED"]);

function cells(row) {
  return row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function strip(value) {
  return value.replaceAll("`", "").trim();
}

function tables() {
  const found = [];
  let current = null;
  LINES.forEach((line, index) => {
    if (!line.startsWith("|")) {
      current = null;
      return;
    }
    if (!current) {
      current = { start: index + 1, rows: [] };
      found.push(current);
    }
    current.rows.push(line);
  });
  return found;
}

function releaseGateSection() {
  const start = LINES.findIndex((line) =>
    line.startsWith("## 3. Current release gate"),
  );
  assert.ok(start >= 0, "PLAN.md must carry §3");
  const end = LINES.findIndex(
    (line, index) => index > start && /^## /u.test(line),
  );
  return LINES.slice(start, end < 0 ? undefined : end);
}

test("F-153: the release-gate table carries both gate columns", () => {
  const header = releaseGateSection().find((line) =>
    /^\|\s*Milestone/u.test(line),
  );
  assert.ok(header, "the release-gate table must carry a header row");
  const headings = cells(header);
  assert.ok(
    headings.some((heading) => heading.includes("Review Convergence Gate")),
    "the release-gate table must carry a Review Convergence Gate column",
  );
  assert.ok(
    headings.some((heading) => heading.includes("Final Quality Gate")),
    "the release-gate table must carry a Final Quality Gate column",
  );
});

test("F-153: every table with a closed row carries both gate columns", () => {
  const offenders = [];
  for (const table of tables()) {
    const header = cells(table.rows[0]);
    const statusIndex = header.findIndex((h) => /status/iu.test(h));
    const evidenceIndex = header.findIndex((h) => /evidence/iu.test(h));
    if (statusIndex < 0 && evidenceIndex < 0) continue;
    const marked = table.rows.slice(1).filter((row) => {
      const rowCells = cells(row);
      return [statusIndex, evidenceIndex]
        .filter((index) => index >= 0)
        .some((index) => CLOSED_TOKENS.has(strip(rowCells[index] ?? "")));
    });
    if (marked.length === 0) continue;
    if (
      !header.some((h) => h.includes("Review Convergence Gate")) ||
      !header.some((h) => h.includes("Final Quality Gate"))
    ) {
      offenders.push(
        `table at PLAN.md:${table.start} — ${marked.length} closed row(s) without a gate pair`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a table row marked CLOSED/COMPLETE/REMOTE-BACKED shows no explicit gate pair: ${offenders.join(" | ")}`,
  );
});

test("F-153: every gate cell shows one of PASS, FAIL or NOT RUN", () => {
  const offenders = [];
  for (const table of tables()) {
    const header = cells(table.rows[0]);
    const convergence = header.findIndex((h) =>
      h.includes("Review Convergence Gate"),
    );
    const quality = header.findIndex((h) => h.includes("Final Quality Gate"));
    if (convergence < 0 || quality < 0) continue;
    for (const row of table.rows.slice(1)) {
      const rowCells = cells(row);
      if (rowCells.every((cell) => /^-+$/u.test(cell))) continue; // separator
      for (const [name, index] of [
        ["Review Convergence Gate", convergence],
        ["Final Quality Gate", quality],
      ]) {
        const value = strip(rowCells[index] ?? "");
        if (!GATE_TOKENS.has(value)) {
          offenders.push(
            `PLAN.md:${table.start} — ${rowCells[0]} — ${name} = "${value}"`,
          );
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a gate cell carries a prose summary instead of an explicit status: ${offenders.join(" | ")}`,
  );
});

test("F-153: the live header blocks carry both gate tokens explicitly", () => {
  const activeTaskStart = LINES.findIndex((line) =>
    /^## Active task\b/u.test(line),
  );
  assert.ok(activeTaskStart >= 0, "PLAN.md must carry the Active task block");
  const block = LINES.slice(activeTaskStart);
  for (const field of ["Review Convergence Gate:", "Final Quality Gate:"]) {
    const line = block.find((entry) => entry.startsWith(field));
    assert.ok(line, `the Active task block must carry "${field}"`);
    const value = strip(line.slice(field.length)).split(/\s/u)[0];
    assert.ok(
      GATE_TOKENS.has(value),
      `the Active task block's "${field}" must carry one of ${[...GATE_TOKENS].join(", ")}, found "${value}"`,
    );
  }
});
