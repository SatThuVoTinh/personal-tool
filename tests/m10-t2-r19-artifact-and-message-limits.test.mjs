// M10/T2-R19 — artifact path containment, spreadsheet column references,
// byte-budgeted coordinator messages, and attributable binding failures.
//
// Each test reproduces a defect that was MEASURED against the pre-fix code.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

/**
 * Pull xl/worksheets/sheet1.xml back out of a built .xlsx archive so the test
 * inspects the REAL emitted XML rather than a re-implementation of it.
 */
function readXlsxSheetXml(buf) {
  const name = Buffer.from("xl/worksheets/sheet1.xml", "utf8");
  const at = buf.indexOf(name);
  if (at < 0) throw new Error("sheet1.xml not present in the workbook archive");
  // Walk back to the local file header (PK\x03\x04) that owns this name.
  let header = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), at);
  if (header < 0) throw new Error("local file header not found");
  const method = buf.readUInt16LE(header + 8);
  const size = buf.readUInt32LE(header + 18);
  const nameLen = buf.readUInt16LE(header + 26);
  const extraLen = buf.readUInt16LE(header + 28);
  const start = header + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + size);
  return method === 0
    ? raw.toString("utf8")
    : inflateRawSync(raw).toString("utf8");
}

const excel = await import("../integrations/openclaw/lib/excel-writer.mjs");
const pickup =
  await import("../integrations/openclaw/lib/coordinator-pickup.mjs");

const root = () => mkdtempSync(path.join(tmpdir(), "zink-r19-"));
const cleanup = (dirs) =>
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));

const spec = (file_path) => ({
  operation: "generate",
  file_path,
  data: [["a"]],
  specification: { sheets: [{ name: "S", columns: ["a"], rows: [["x"]] }] },
});

test("R19-01: a relative file_path cannot escape the workspace", () => {
  // Proven pre-fix: `../outside/proof.xlsx` resolved out of the sandbox, three
  // files were written there, the tool returned status "success", and the
  // returned file_path was only path.basename — so the escape was invisible.
  const base = root();
  try {
    const sandbox = path.join(base, "sandbox");
    assert.throws(
      () => excel.executeExcelOperation(spec("../outside/proof.xlsx"), sandbox),
      /ARTIFACT_PATH_ESCAPE/u,
    );
    assert.equal(
      existsSync(path.join(base, "outside")),
      false,
      "nothing may be written outside the workspace",
    );
    assert.equal(
      existsSync(sandbox),
      false,
      "a rejected path must not create anything",
    );
  } finally {
    cleanup([base]);
  }
});

test("R19-02: an absolute file_path outside the workspace is also refused", () => {
  const base = root();
  try {
    const sandbox = path.join(base, "sandbox");
    const abs = path.join(base, "elsewhere", "abs.xlsx");
    assert.throws(
      () => excel.executeExcelOperation(spec(abs), sandbox),
      /ARTIFACT_PATH_ESCAPE/u,
    );
    assert.equal(existsSync(abs), false);
  } finally {
    cleanup([base]);
  }
});

test("R19-03: a legitimate path inside the workspace still works", () => {
  // The containment check must not break the ordinary case.
  const base = root();
  try {
    const sandbox = path.join(base, "sandbox");
    const res = excel.executeExcelOperation(spec("report.xlsx"), sandbox);
    assert.equal(res.status, "success");
    assert.equal(res.file_path, "report.xlsx");
    assert.ok(
      existsSync(path.join(sandbox, "report.xlsx")),
      "the workbook must land inside the workspace",
    );
  } finally {
    cleanup([base]);
  }
});

test("R19-04: spreadsheet column references use base-26, not modulo", () => {
  // Pre-fix `String.fromCharCode(65 + (i % 26))` wrapped back to "A" at index 26,
  // so a 27-column row emitted a SECOND `<c r="A1">` and every later column was
  // mislabelled in every row — invalid SpreadsheetML that Excel refuses.
  assert.equal(excel.spreadsheetColumnLetter(0), "A");
  assert.equal(excel.spreadsheetColumnLetter(25), "Z");
  assert.equal(excel.spreadsheetColumnLetter(26), "AA");
  assert.equal(excel.spreadsheetColumnLetter(27), "AB");
  assert.equal(excel.spreadsheetColumnLetter(51), "AZ");
  assert.equal(excel.spreadsheetColumnLetter(52), "BA");
  assert.equal(excel.spreadsheetColumnLetter(701), "ZZ");
  assert.equal(excel.spreadsheetColumnLetter(702), "AAA");

  // End-to-end: a 30-column row must produce 30 DISTINCT, correctly ordered refs.
  // buildWorkbookBuffer returns a real .xlsx Buffer (a zip), so the sheet XML is
  // read back out of the archive rather than from a filename->xml map.
  const row = Array.from({ length: 30 }, (_, i) => `v${i}`);
  const buf = excel.buildWorkbookBuffer([row], "S");
  const sheet = readXlsxSheetXml(buf);
  const refs = [...sheet.matchAll(/<c r="([A-Z]+)1"/gu)].map((m) => m[1]);
  assert.equal(refs.length, 30, "every cell must be emitted");
  assert.equal(new Set(refs).size, 30, `duplicate refs: ${refs.join(",")}`);
  assert.equal(refs[0], "A");
  assert.equal(refs[26], "AA", "index 26 must be AA, not a second A");
  assert.equal(refs[29], "AD");
  // And the emitted cell reference must carry the row.
  assert.match(sheet, /<c r="AA1"/u, "row 1 column 27 must be AA1");
});

test("R19-05: the coordinator message obeys its own BYTE ceiling", () => {
  // Measured pre-fix: a 6000-character Vietnamese brief produced 11721 bytes
  // against a declared 4096-byte ceiling (286%), and emoji additionally produced
  // a LONE SURROGATE because slicing by UTF-16 unit can split a pair.
  const CEIL = pickup.COORDINATOR_MESSAGE_MAX_BYTES;
  for (const glyph of ["ế", "中", "😀"]) {
    const msg = pickup.buildCoordinatorMessage({
      taskId: "a".repeat(64),
      coordinator: "o1",
      requiredCapabilities: ["zink_excel"],
      payload: { brief: glyph.repeat(6000) },
      planVersion: 1,
      leaseId: "lease-1",
      attempt: 1,
    });
    assert.ok(
      Buffer.byteLength(msg, "utf8") <= CEIL,
      `glyph ${glyph}: ${Buffer.byteLength(msg, "utf8")} bytes exceeds ${CEIL}`,
    );
    assert.doesNotMatch(
      msg,
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
      "truncation must never emit a lone surrogate",
    );
  }
});

test("R19-06: a short message is untouched", () => {
  const msg = pickup.buildCoordinatorMessage({
    taskId: "a".repeat(64),
    coordinator: "o1",
    requiredCapabilities: ["zink_excel"],
    payload: { brief: "short" },
    planVersion: 1,
    leaseId: "lease-1",
    attempt: 1,
  });
  assert.doesNotMatch(
    msg,
    /\.\.\.\[truncated\]/u,
    "no truncation marker expected",
  );
  assert.ok(
    Buffer.byteLength(msg, "utf8") <= pickup.COORDINATOR_MESSAGE_MAX_BYTES,
  );
});

test("F-505: an oversized brief is truncated BEFORE serializing, so the bundle still parses and keeps all three instructions", () => {
  // Measured pre-fix: a 20 KB brief went through `truncateUtf8Bytes(body, ...)`,
  // i.e. raw bytes cut off the SERIALIZED bundle, so the returned string is
  // unterminated JSON (`JSON.parse` throws) and the whole `instructions` array —
  // including the anti-escalation line — disappears. The ceiling itself was
  // obeyed; the declared guarantee that the bundle is a bundle was not.
  const CEIL = pickup.COORDINATOR_MESSAGE_MAX_BYTES;
  const INSTRUCTIONS = [
    "You are the designated coordinator for this approved task. Resolve the authoritative task by task_id from the queue/ledger; this message is input only, not authority.",
    "Delegate each required specialist EXCLUSIVELY through the governed sessions_spawn gate in one canonical topology step per the task DAG.",
    "Never alter the primary coordinator, the approved specialist set, the lease, or the attempt. Never claim completion; end the turn with a self-contained evidence summary as the final message.",
  ];
  const briefs = [
    "x".repeat(20_000),
    "ế".repeat(9_000),
    "\n".repeat(6_000),
    '"\\'.repeat(4_000),
    "😀".repeat(6_000),
  ];
  for (const brief of briefs) {
    const msg = pickup.buildCoordinatorMessage({
      taskId: "a".repeat(64),
      coordinator: "o1",
      requiredCapabilities: ["zink_excel"],
      payload: { brief },
      planVersion: 1,
      leaseId: "lease-1",
      attempt: 3,
    });
    assert.ok(
      Buffer.byteLength(msg, "utf8") <= CEIL,
      `brief of ${brief.length} chars produced ${Buffer.byteLength(msg, "utf8")} bytes, over the ${CEIL} ceiling`,
    );
    let parsed;
    assert.doesNotThrow(
      () => {
        parsed = JSON.parse(msg);
      },
      undefined,
      `brief of ${brief.length} chars must serialize a parseable bundle, got: ${msg.slice(0, 120)}`,
    );
    assert.deepEqual(
      parsed.instructions,
      INSTRUCTIONS,
      "every instruction must survive an oversized brief",
    );
    assert.equal(parsed.task_id, "a".repeat(64));
    assert.equal(parsed.lease_id, "lease-1");
    assert.equal(parsed.attempt, 3);
    assert.equal(typeof parsed.brief, "string");
    assert.doesNotMatch(
      msg,
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
      "truncation must never emit a lone surrogate",
    );
  }
});

test("R19-07: the deployed sources stay free of character-count budgets", () => {
  // Structural guard: this is the THIRD defect of the byte-vs-character class in
  // this codebase (ledger `safeReason`, guard result payload, coordinator
  // message). Each was a slice feeding a byte-measured ceiling. This pins the
  // deployed modules so the class cannot reappear unnoticed.
  const files = [
    "integrations/openclaw/lib/coordinator-pickup.mjs",
    "integrations/openclaw/plugins/zink-governance/index.mjs",
    "integrations/openclaw/topology/lib/guard.mjs",
  ];
  for (const rel of files) {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
    const offenders = [
      ...src.matchAll(/slice\(\s*0\s*,\s*[A-Z_]*MAX[A-Z_]*\s*\)/gu),
    ];
    assert.deepEqual(
      offenders.map((m) => m[0]),
      [],
      `${rel} must not truncate a byte-budgeted bound with a character slice`,
    );
  }
});
