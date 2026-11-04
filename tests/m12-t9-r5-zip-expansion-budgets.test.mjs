import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { validateTechnicalArtifact } from "../integrations/openclaw/lib/artifact-validator.mjs";
import { readZipEntries } from "../integrations/openclaw/lib/excel-writer.mjs";

const ENTRY_COUNT_LIMIT = 5000;
const PER_ENTRY_LIMIT = 128 * 1024 * 1024;
const TOTAL_UNCOMPRESSED_LIMIT = 512 * 1024 * 1024;

const contentTypesXml = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
);
const worksheetXml = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row></sheetData></worksheet>',
);

const crcTable = new Uint32Array(256);
for (let i = 0; i < crcTable.length; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[i] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function localRecord(name, body, declaredSize = body.length) {
  const nameBytes = Buffer.from(name, "utf8");
  const compressed = zlib.deflateRawSync(body);
  const checksum = crc32(body);
  const header = Buffer.alloc(30 + nameBytes.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(declaredSize, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  nameBytes.copy(header, 30);
  return {
    bytes: Buffer.concat([header, compressed]),
    compressedSize: compressed.length,
    checksum,
    uncompressedSize: declaredSize,
  };
}

function centralRecord(
  name,
  local,
  localOffset,
  declaredSize = local.uncompressedSize,
) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(46 + nameBytes.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(local.checksum, 16);
  header.writeUInt32LE(local.compressedSize, 20);
  header.writeUInt32LE(declaredSize, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  nameBytes.copy(header, 46);
  return header;
}

function zipArchive(localEntries, centralEntries) {
  const localParts = [];
  const offsets = [];
  let localSize = 0;
  for (const entry of localEntries) {
    offsets.push(localSize);
    localParts.push(entry.bytes);
    localSize += entry.bytes.length;
  }

  const centralParts = centralEntries.map((entry) =>
    centralRecord(
      entry.name,
      localEntries[entry.localIndex],
      offsets[entry.localIndex],
      entry.declaredSize,
    ),
  );
  const centralOffset = localSize;
  const centralSize = centralParts.reduce(
    (size, part) => size + part.length,
    0,
  );
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralEntries.length, 8);
  end.writeUInt16LE(centralEntries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function repeatedStreamArchive(aliases) {
  const types = localRecord("[Content_Types].xml", contentTypesXml);
  const sheet = localRecord("xl/worksheets/sheet1.xml", worksheetXml);
  const localEntries = [types, sheet];
  const centralEntries = [
    { name: "[Content_Types].xml", localIndex: 0 },
    { name: "xl/worksheets/sheet1.xml", localIndex: 1 },
    ...aliases.map((entry) => ({ ...entry, localIndex: 1 })),
  ];
  return zipArchive(localEntries, centralEntries);
}

function ordinaryExcelArchive() {
  const types = localRecord("[Content_Types].xml", contentTypesXml);
  const sheet = localRecord("xl/worksheets/sheet1.xml", worksheetXml);
  return zipArchive(
    [types, sheet],
    [
      { name: "[Content_Types].xml", localIndex: 0 },
      { name: "xl/worksheets/sheet1.xml", localIndex: 1 },
    ],
  );
}

function entryCountArchive() {
  const aliases = [];
  for (let index = 2; index < ENTRY_COUNT_LIMIT + 1; index += 1) {
    aliases.push({
      name: `xl/worksheets/repeated-${String(index).padStart(5, "0")}.xml`,
    });
  }
  return repeatedStreamArchive(aliases);
}

function declaredPerEntryArchive() {
  const types = localRecord("[Content_Types].xml", contentTypesXml);
  const sheet = localRecord("xl/worksheets/sheet1.xml", worksheetXml);
  const forged = localRecord(
    "xl/worksheets/oversized.xml",
    worksheetXml,
    PER_ENTRY_LIMIT + 1,
  );
  return zipArchive(
    [types, sheet, forged],
    [
      { name: "[Content_Types].xml", localIndex: 0 },
      { name: "xl/worksheets/sheet1.xml", localIndex: 1 },
      { name: "xl/worksheets/oversized.xml", localIndex: 2 },
    ],
  );
}

function declaredAggregateArchive() {
  const declaredSizePerEntry = 110 * 1024 * 1024;
  return repeatedStreamArchive(
    [
      "xl/worksheets/extra-1.xml",
      "xl/worksheets/extra-2.xml",
      "xl/worksheets/extra-3.xml",
      "xl/worksheets/extra-4.xml",
      "xl/worksheets/extra-5.xml",
    ].map((name) => ({ name, declaredSize: declaredSizePerEntry })),
  );
}

function oversizedWorksheet() {
  const prefix = Buffer.from(
    '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1"><v>',
  );
  const suffix = Buffer.from("</v></c></row></sheetData></worksheet>");
  const body = Buffer.alloc(
    prefix.length + PER_ENTRY_LIMIT + 1 + suffix.length,
    0x41,
  );
  prefix.copy(body);
  suffix.copy(body, body.length - suffix.length);
  return body;
}

function actualPerEntryArchive(declaredSize) {
  const types = localRecord("[Content_Types].xml", contentTypesXml);
  const sheetBody = oversizedWorksheet();
  const sheet = localRecord(
    "xl/worksheets/sheet1.xml",
    sheetBody,
    declaredSize,
  );
  return zipArchive(
    [types, sheet],
    [
      { name: "[Content_Types].xml", localIndex: 0 },
      { name: "xl/worksheets/sheet1.xml", localIndex: 1 },
    ],
  );
}

function actualAggregateArchive() {
  const declaredSize = 1000;
  const actualSizePerWorksheet = 103 * 1024 * 1024;
  assert.ok(actualSizePerWorksheet < PER_ENTRY_LIMIT);
  assert.ok(actualSizePerWorksheet * 5 > TOTAL_UNCOMPRESSED_LIMIT);

  const prefix = Buffer.from(
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row>',
  );
  const suffix = Buffer.from("</sheetData></worksheet>");
  const repeatedBody = Buffer.alloc(actualSizePerWorksheet, 0x20);
  prefix.copy(repeatedBody);
  suffix.copy(repeatedBody, repeatedBody.length - suffix.length);

  const types = localRecord("[Content_Types].xml", contentTypesXml);
  const firstSheet = localRecord("xl/worksheets/sheet1.xml", worksheetXml);
  const sharedSheet = localRecord(
    "xl/worksheets/sheet2.xml",
    repeatedBody,
    declaredSize,
  );
  const archive = zipArchive(
    [types, firstSheet, sharedSheet],
    [
      { name: "[Content_Types].xml", localIndex: 0 },
      { name: "xl/worksheets/sheet1.xml", localIndex: 1 },
      ...Array.from({ length: 5 }, (_, index) => ({
        name: `xl/worksheets/sheet${index + 2}.xml`,
        localIndex: 2,
        declaredSize,
      })),
    ],
  );
  assert.ok(archive.length < 25 * 1024 * 1024);
  return archive;
}

function validatorFile(t, zipBuffer) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "m12-t9-f-oc-002-"));
  const filePath = path.join(directory, "workbook.xlsx");
  fs.writeFileSync(filePath, zipBuffer);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return filePath;
}

function assertBudgetMessage(message, quantity, limitText) {
  assert.ok(
    message.toLowerCase().includes(quantity.toLowerCase()),
    `message must name ${quantity}; received: ${message}`,
  );
  assert.ok(
    limitText.some((limit) => message.includes(limit)),
    `message must name one of ${limitText.join(", ")}; received: ${message}`,
  );
}

function assertValidatorBudget(t, zipBuffer, quantity, limitText) {
  const filePath = validatorFile(t, zipBuffer);
  const verdict = validateTechnicalArtifact({
    filePath,
    expectedType: "excel",
  });
  assert.equal(
    verdict.status,
    "FAIL",
    "over-budget workbook must fail validation",
  );
  assertBudgetMessage(verdict.errors.join(" "), quantity, limitText);
}

function assertExcelReaderBudget(zipBuffer, quantity, limitText) {
  assert.throws(
    () => readZipEntries(zipBuffer),
    (error) => {
      assert.ok(error instanceof Error, "reader must throw an Error");
      assertBudgetMessage(error.message, quantity, limitText);
      return true;
    },
  );
}

describe("M12/T9-R5 F-OC-002 ZIP expansion budgets", () => {
  it("validator rejects 5,001 central entries with the 5,000-entry budget", (t) => {
    assertValidatorBudget(t, entryCountArchive(), "entries", ["5000"]);
  });

  it("Excel reader rejects 5,001 central entries with the 5,000-entry budget", () => {
    assertExcelReaderBudget(entryCountArchive(), "entries", ["5000"]);
  });

  it("validator rejects declared per-entry size above 128 MiB", (t) => {
    assertValidatorBudget(t, declaredPerEntryArchive(), "per-entry", [
      "128 MiB",
      String(PER_ENTRY_LIMIT),
    ]);
  });

  it("Excel reader rejects declared per-entry size above 128 MiB", () => {
    assertExcelReaderBudget(declaredPerEntryArchive(), "per-entry", [
      "128 MiB",
      String(PER_ENTRY_LIMIT),
    ]);
  });

  it("validator rejects declared aggregate size above 512 MiB", (t) => {
    assertValidatorBudget(t, declaredAggregateArchive(), "total uncompressed", [
      "512 MiB",
      String(TOTAL_UNCOMPRESSED_LIMIT),
    ]);
  });

  it("Excel reader rejects declared aggregate size above 512 MiB", () => {
    assertExcelReaderBudget(declaredAggregateArchive(), "total uncompressed", [
      "512 MiB",
      String(TOTAL_UNCOMPRESSED_LIMIT),
    ]);
  });

  it("validator rejects actual per-entry output when declared size is forged small", (t) => {
    assertValidatorBudget(t, actualPerEntryArchive(1000), "per-entry", [
      "128 MiB",
      String(PER_ENTRY_LIMIT),
    ]);
  });

  it("Excel reader rejects actual per-entry output above 128 MiB", () => {
    assertExcelReaderBudget(actualPerEntryArchive(), "per-entry", [
      "128 MiB",
      String(PER_ENTRY_LIMIT),
    ]);
  });

  it("Excel reader rejects actual per-entry output when declared size is forged small", () => {
    assertExcelReaderBudget(actualPerEntryArchive(1000), "per-entry", [
      "128 MiB",
      String(PER_ENTRY_LIMIT),
    ]);
  });

  it("validator rejects actual aggregate output above 512 MiB with forged small declarations", (t) => {
    assertValidatorBudget(t, actualAggregateArchive(), "total uncompressed", [
      "512 MiB",
      String(TOTAL_UNCOMPRESSED_LIMIT),
    ]);
  });

  it("Excel reader rejects actual aggregate output above 512 MiB with forged small declarations", () => {
    assertExcelReaderBudget(actualAggregateArchive(), "total uncompressed", [
      "512 MiB",
      String(TOTAL_UNCOMPRESSED_LIMIT),
    ]);
  });

  it("validator accepts an ordinary Excel ZIP with the required XML parts", (t) => {
    const filePath = validatorFile(t, ordinaryExcelArchive());
    const verdict = validateTechnicalArtifact({
      filePath,
      expectedType: "excel",
    });
    assert.equal(verdict.status, "PASS");
  });

  it("Excel reader returns the expected entry from an ordinary ZIP Buffer", () => {
    const entries = readZipEntries(ordinaryExcelArchive());
    assert.ok(entries instanceof Map);
    assert.deepEqual(entries.get("xl/worksheets/sheet1.xml"), worksheetXml);
  });

  it("declared aggregate exceeds 512 MiB: reader rejects before any inflation", () => {
    assertExcelReaderBudget(declaredAggregateArchive(), "total uncompressed", [
      "512 MiB",
      String(TOTAL_UNCOMPRESSED_LIMIT),
    ]);
  });
});
