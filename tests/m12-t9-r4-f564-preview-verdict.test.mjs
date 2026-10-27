// M12/T9-R4 — F-564 (legacy R10-T08-5): the operator preview arm asserted
// validity from magic bytes alone and was computed after the machine verdict,
// so a file the technical tier refuses was reported as valid to the human.
// The preview arm must call the technical tier's per-type helpers, and the
// gate must stop attaching an unevaluated verdict after overallStatus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const {
  generateArtifactPreview,
  validateTechnicalArtifact,
  evaluateResultGate,
} = await import(
  new URL(
    "../integrations/openclaw/lib/artifact-validator.mjs",
    import.meta.url,
  ).href
);

// --- minimal store-method ZIP builder (the validator parses the central directory)
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function buildStoreZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); // stored
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>\n';
const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>\n';

// >64 bytes, %PDF- header, NO %%EOF trailer and NO xref/startxref pointer:
// exactly the shape the technical tier refuses at the trailer check.
const HEADER_ONLY_PDF = `%PDF-1.7\n%${"p".repeat(80)}\n1 0 obj\n<< /Type /Catalog >>\nendobj\n`;
const COMPLETE_PDF = `%PDF-1.7\n%${"p".repeat(80)}\n1 0 obj\n<< /Type /Catalog >>\nendobj\nstartxref\n0\n%%EOF\n`;

function makeDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test("F-564: a DOCX-shaped zip without word/document.xml is NOT valid in the preview string", () => {
  const dir = makeDir("l8-f564-docx-");
  try {
    const file = path.join(dir, "report.docx");
    writeFileSync(
      file,
      buildStoreZip([["[Content_Types].xml", CONTENT_TYPES_XML]]),
    );

    const tier = validateTechnicalArtifact({ filePath: file });
    assert.equal(tier.status, "FAIL", "the technical tier refuses this shape");

    const preview = generateArtifactPreview({ filePath: file });
    assert.equal(preview.verdict, "INVALID");
    assert.equal(preview.structureValid, false);
    assert.match(
      preview.previewText,
      /KHÔNG/u,
      `preview must report NOT valid, got: ${preview.previewText}`,
    );
    assert.doesNotMatch(preview.previewText, /✅/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-564: a header-only PDF is NOT valid in the preview string", () => {
  const dir = makeDir("l8-f564-pdf-");
  try {
    const file = path.join(dir, "report.pdf");
    writeFileSync(file, HEADER_ONLY_PDF);

    const tier = validateTechnicalArtifact({ filePath: file });
    assert.equal(
      tier.status,
      "FAIL",
      "the technical tier refuses a missing %%EOF trailer",
    );

    const preview = generateArtifactPreview({ filePath: file });
    assert.equal(preview.verdict, "INVALID");
    assert.equal(preview.hasTrailerEof, false);
    assert.match(
      preview.previewText,
      /KHÔNG/u,
      `preview must report NOT valid, got: ${preview.previewText}`,
    );
    assert.doesNotMatch(preview.previewText, /✅/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-564: the gate never attaches a preview INVALID verdict beneath a PASS outcome", () => {
  const dir = makeDir("l8-f564-gate-");
  try {
    const file = path.join(dir, "report.pdf");
    writeFileSync(file, HEADER_ONLY_PDF);

    const gate = evaluateResultGate({ artifactPath: file });
    assert.equal(gate.preview?.verdict, "INVALID");
    assert.notEqual(gate.overallStatus, "PASS");
    assert.equal(gate.isReadyForUserReview, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-564 control: a complete DOCX and a complete PDF stay VALID in both arms", () => {
  const dir = makeDir("l8-f564-control-");
  try {
    const docx = path.join(dir, "good.docx");
    writeFileSync(
      docx,
      buildStoreZip([
        ["[Content_Types].xml", CONTENT_TYPES_XML],
        ["word/document.xml", DOCUMENT_XML],
      ]),
    );
    const docxTier = validateTechnicalArtifact({ filePath: docx });
    assert.equal(docxTier.status, "PASS", `tier errors: ${docxTier.errors}`);
    const docxPreview = generateArtifactPreview({ filePath: docx });
    assert.equal(docxPreview.verdict, "VALID");
    assert.match(docxPreview.previewText, /✅/u);

    const pdf = path.join(dir, "good.pdf");
    writeFileSync(pdf, COMPLETE_PDF);
    const pdfTier = validateTechnicalArtifact({ filePath: pdf });
    assert.equal(pdfTier.status, "PASS", `tier errors: ${pdfTier.errors}`);
    const pdfPreview = generateArtifactPreview({ filePath: pdf });
    assert.equal(pdfPreview.verdict, "VALID");
    assert.match(pdfPreview.previewText, /✅/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
