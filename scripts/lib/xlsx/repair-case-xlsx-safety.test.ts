import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRepairCaseXlsxBuffer } from "./repair-case-xlsx-safety";

type TestEntry = {
  name: string;
  data: string;
  advertisedUncompressedSize?: number;
};

function makeStoredZip(entries: TestEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const uncompressedSize = entry.advertisedUncompressedSize ?? data.length;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

const CONTENT_TYPES =
  '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';

function validEntries(worksheet = '<worksheet><sheetData><row r="3"><c r="A3" t="inlineStr"><is><t>header</t></is></c></row></sheetData></worksheet>'): TestEntry[] {
  return [
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: "<Relationships/>" },
    { name: "xl/workbook.xml", data: "<workbook/>" },
    { name: "xl/_rels/workbook.xml.rels", data: "<Relationships/>" },
    { name: "xl/worksheets/sheet1.xml", data: worksheet },
  ];
}

function codes(entries: TestEntry[], fileName = "repair.xlsx", limits = {}) {
  return validateRepairCaseXlsxBuffer(makeStoredZip(entries), fileName, { limits }).issues.map(
    (candidate) => candidate.code
  );
}

test("valid minimal ordinary xlsx passes", () => {
  assert.equal(validateRepairCaseXlsxBuffer(makeStoredZip(validEntries()), "repair.XLSX").ok, true);
});

test("wrong extension and invalid ZIP signature are rejected", () => {
  assert.ok(codes(validEntries(), "repair.xls").includes("UNSUPPORTED_FILE_EXTENSION"));
  const result = validateRepairCaseXlsxBuffer(Buffer.from("not-a-zip"), "repair.xlsx");
  assert.deepEqual(result.issues.map((candidate) => candidate.code), ["INVALID_ZIP_SIGNATURE"]);
});

test("missing required package file is rejected", () => {
  assert.ok(codes(validEntries().filter((entry) => entry.name !== "xl/workbook.xml")).includes("INVALID_OOXML_PACKAGE"));
});

test("macro entry and macro-enabled content type are rejected", () => {
  const macroTypes = CONTENT_TYPES.replace(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    "application/vnd.ms-excel.sheet.macroEnabled.main+xml"
  );
  const entries = validEntries().map((entry) => entry.name === "[Content_Types].xml" ? { ...entry, data: macroTypes } : entry);
  entries.push({ name: "xl/vbaProject.bin", data: "macro" });
  assert.ok(codes(entries).includes("MACRO_CONTENT_DETECTED"));
});

test("ActiveX, OLE embedding, and external workbook links are rejected", () => {
  assert.ok(codes([...validEntries(), { name: "xl/activeX/activeX1.bin", data: "x" }]).includes("ACTIVEX_CONTENT_DETECTED"));
  assert.ok(codes([...validEntries(), { name: "xl/embeddings/oleObject1.bin", data: "x" }]).includes("OLE_EMBEDDED_CONTENT_DETECTED"));
  assert.ok(codes([...validEntries(), { name: "xl/externalLinks/externalLink1.xml", data: "<externalLink/>" }]).includes("EXTERNAL_WORKBOOK_LINK_DETECTED"));
});

test("DDE formula is rejected while an ordinary formula is accepted without calculation", () => {
  const dde = '<worksheet><sheetData><row r="4"><c r="A4"><f>cmd|\' /C calc\'!A0</f><v>0</v></c></row></sheetData></worksheet>';
  assert.ok(codes(validEntries(dde)).includes("DDE_FORMULA_DETECTED"));
  const ordinary = '<worksheet><sheetData><row r="4"><c r="A4"><f>SUM(B4:C4)</f><v>3</v></c></row></sheetData></worksheet>';
  assert.equal(validateRepairCaseXlsxBuffer(makeStoredZip(validEntries(ordinary)), "repair.xlsx").ok, true);
  const external = '<worksheet><sheetData><row r="4"><c r="A4"><f>[1]Sheet1!A1</f><v>3</v></c></row></sheetData></worksheet>';
  assert.ok(codes(validEntries(external)).includes("EXTERNAL_WORKBOOK_LINK_DETECTED"));
});

test("ordinary hyperlink is warned about but never blocks or follows the target", () => {
  const hyperlink = '<worksheet><sheetData/><hyperlinks><hyperlink ref="A1" r:id="rId1"/></hyperlinks></worksheet>';
  const result = validateRepairCaseXlsxBuffer(makeStoredZip(validEntries(hyperlink)), "repair.xlsx");
  assert.equal(result.ok, true);
  assert.ok(result.issues.some((candidate) => candidate.code === "HYPERLINK_PRESENT" && candidate.severity === "WARNING"));
});

test("path traversal and duplicate/conflicting entry names are rejected", () => {
  assert.ok(codes([...validEntries(), { name: "xl/../escape.bin", data: "x" }]).includes("ZIP_PATH_TRAVERSAL_DETECTED"));
  assert.ok(codes([...validEntries(), { name: "XL/WORKBOOK.XML", data: "duplicate" }]).includes("DUPLICATE_ZIP_ENTRY_DETECTED"));
});

test("entry count, entry size, total size, and compression ratio limits are independent", () => {
  assert.ok(codes(validEntries(), "repair.xlsx", { maxZipEntries: 4 }).includes("ZIP_ENTRY_LIMIT_EXCEEDED"));
  assert.ok(codes(validEntries(), "repair.xlsx", { maxEntryUncompressedBytes: 8 }).includes("ZIP_ENTRY_SIZE_LIMIT_EXCEEDED"));
  assert.ok(codes(validEntries(), "repair.xlsx", { maxTotalUncompressedBytes: 8 }).includes("ZIP_TOTAL_UNCOMPRESSED_LIMIT_EXCEEDED"));
  const expanded = [...validEntries(), { name: "xl/media/large.bin", data: "x", advertisedUncompressedSize: 20_000 }];
  assert.ok(codes(expanded, "repair.xlsx", { maxCompressionRatio: 10 }).includes("ZIP_COMPRESSION_RATIO_LIMIT_EXCEEDED"));
  assert.ok(codes(validEntries(), "repair.xlsx", { maxCompressedBytes: 8 }).includes("COMPRESSED_UPLOAD_SIZE_LIMIT_EXCEEDED"));
});

test("worksheet row, cell, and text limits are enforced", () => {
  const worksheet = '<worksheet><sheetData><row r="4"><c r="A4" t="inlineStr"><is><t>abcd</t></is></c><c r="B4"><v>1</v></c></row></sheetData></worksheet>';
  assert.ok(codes(validEntries(worksheet), "repair.xlsx", { maxWorksheetDataRows: 0 }).includes("WORKSHEET_ROW_LIMIT_EXCEEDED"));
  assert.ok(codes(validEntries(worksheet), "repair.xlsx", { maxParsedCells: 1 }).includes("WORKSHEET_CELL_LIMIT_EXCEEDED"));
  assert.ok(codes(validEntries(worksheet), "repair.xlsx", { maxCellTextLength: 3 }).includes("CELL_TEXT_LIMIT_EXCEEDED"));
});
