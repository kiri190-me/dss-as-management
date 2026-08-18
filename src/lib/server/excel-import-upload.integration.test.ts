import "../../../scripts/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, pgClient } from "@/lib/db/connection";
import { excelImportBatches, products, users } from "@/lib/db/schema";
import { EXCEL_IMPORT_XLSX_MIME, processExcelImportUpload } from "./excel-import-upload";

type Entry = { name: string; data: string };
const RUN_TOKEN = randomUUID();
const TEMP_ROOT = join(process.cwd(), `.tmp-excel-import-${RUN_TOKEN}`);
const createdUserIds: string[] = [];
const createdBatchIds: string[] = [];
let adminId: string;
let engineerId: string;
let baselineProductCount = 0;

function storedZip(entries: Entry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, data);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const HEADERS: Record<string, string> = {
  A: "번호バンゴウ", B: "인수 번호ヒキトリ", C: "인수일ハッコウビ", D: "고객처", E: "End_User", F: "제품", G: "型式カタシキ", H: "L/N", I: "", J: "S/N", K: "DSS 견적번호", L: "발주현황(유.무상)", M: "선적일(여부)", N: "납입일(여부)→고객", O: "수리보고서", P: "세금계산서발행", Q: "기재자キサイシャ", R: "장소", S: "고객반출사유備考(原因)ビコウゲンイン", T: "교산출하일", U: "인수검사 완료 / P.O 발행 후 통전 예정", V: "점검 완료일 (예상)", W: "수리완료일(예상)", X: "담당자", Y: "수리소 출하확인",
};

function cell(ref: string, value: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
}

function workbook(sheetName = "목록", dangerousEntry?: Entry, marker = ""): Buffer {
  const headerRow = Object.entries(HEADERS).filter(([, value]) => value !== "").map(([column, value]) => cell(`${column}3`, value)).join("");
  const data = { A: `1${marker}`, B: "D260801", C: "2026-08-01", D: `고객-${RUN_TOKEN}-${marker}`, E: `End-${RUN_TOKEN}-${marker}`, F: `제품-${RUN_TOKEN}`, G: `Model-${RUN_TOKEN}-${marker}`, H: `LOT-${RUN_TOKEN}`, J: `SN-${RUN_TOKEN}`, L: "유상", M: "수리 중" };
  const dataRow = Object.entries(data).map(([column, value]) => cell(`${column}4`, value)).join("");
  const entries: Entry[] = [
    { name: "[Content_Types].xml", data: '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>' },
    { name: "_rels/.rels", data: "<Relationships/>" },
    { name: "xl/workbook.xml", data: `<workbook><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: "xl/worksheets/sheet1.xml", data: `<worksheet><sheetData><row r="3">${headerRow}</row><row r="4">${dataRow}</row></sheetData></worksheet>` },
  ];
  if (dangerousEntry) entries.push(dangerousEntry);
  return storedZip(entries);
}

function file(bytes: Buffer, name = "repair-cases.xlsx", type = EXCEL_IMPORT_XLSX_MIME): File {
  return new File([Uint8Array.from(bytes)], name, { type });
}

async function expectFailure(
  promise: ReturnType<typeof processExcelImportUpload>,
  code: string
) {
  const result = await promise;
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected upload failure");
  assert.equal(result.code, code);
  return result;
}

async function tempRootIsEmpty() {
  assert.deepEqual(await readdir(TEMP_ROOT), []);
}

before(async () => {
  await mkdir(TEMP_ROOT);
  baselineProductCount = (await db.select({ id: products.id }).from(products)).length;
  for (const [name, role] of [["admin", "ADMIN"], ["engineer", "AS_ENGINEER"]] as const) {
    const [user] = await db.insert(users).values({ email: `excel-upload-${RUN_TOKEN}-${name}@example.invalid`, name: `Excel Upload ${name}`, role, approvalStatus: "APPROVED" }).returning({ id: users.id });
    createdUserIds.push(user.id);
    if (name === "admin") adminId = user.id;
    else engineerId = user.id;
  }
});

after(async () => {
  if (createdBatchIds.length > 0) await db.delete(excelImportBatches).where(inArray(excelImportBatches.id, createdBatchIds));
  if (createdUserIds.length > 0) await db.delete(users).where(inArray(users.id, createdUserIds));
  await tempRootIsEmpty();
  await rmdir(TEMP_ROOT);
  assert.equal((await db.select({ id: products.id }).from(products)).length, baselineProductCount);
  await pgClient.end({ timeout: 5 });
});

describe("processExcelImportUpload", () => {
  test("rejects missing/wrong extension/wrong MIME/oversize/signature before persistence", async () => {
    await expectFailure(processExcelImportUpload({ file: null, actorUserId: adminId }, { temporaryRoot: TEMP_ROOT }), "FILE_REQUIRED");
    await expectFailure(processExcelImportUpload({ file: file(workbook(), "repair.xls"), actorUserId: adminId }, { temporaryRoot: TEMP_ROOT }), "INVALID_FILE_NAME");
    await expectFailure(processExcelImportUpload({ file: file(workbook(), "repair.xlsx", "application/octet-stream"), actorUserId: adminId }, { temporaryRoot: TEMP_ROOT }), "UNSUPPORTED_MIME_TYPE");
    await expectFailure(processExcelImportUpload({ file: file(Buffer.alloc(20 * 1024 * 1024 + 1)), actorUserId: adminId }, { temporaryRoot: TEMP_ROOT }), "FILE_TOO_LARGE");
    const signature = await expectFailure(processExcelImportUpload({ file: file(Buffer.from("not-xlsx")), actorUserId: adminId }, { temporaryRoot: TEMP_ROOT }), "UNSAFE_XLSX");
    assert.ok(signature.issueCodes?.includes("INVALID_ZIP_SIGNATURE"));
    await tempRootIsEmpty();
  });

  test("rejects dangerous OOXML without exposing source values", async () => {
    const secret = `secret-${RUN_TOKEN}`;
    const captured: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => captured.push(args.map(String).join(" "));
    try {
      const result = await expectFailure(processExcelImportUpload({ file: file(workbook("목록", { name: "xl/vbaProject.bin", data: secret })), actorUserId: adminId }, { temporaryRoot: TEMP_ROOT }), "UNSAFE_XLSX");
      assert.ok(result.issueCodes?.includes("MACRO_CONTENT_DETECTED"));
      assert.equal(JSON.stringify(result).includes(secret), false);
      assert.equal(captured.join(" ").includes(secret), false);
    } finally {
      console.error = originalError;
    }
    await tempRootIsEmpty();
  });

  test("deletes temporary files after a structural failure", async () => {
    const result = await expectFailure(processExcelImportUpload({ file: file(workbook("다른시트")), actorUserId: adminId }, { temporaryRoot: TEMP_ROOT }), "WORKBOOK_STRUCTURE_ERROR");
    assert.ok(result.issueCodes?.includes("REQUIRED_SHEET_MISSING"));
    await tempRootIsEmpty();
  });

  test("stores a normal Preview, deletes the temp file, marks deletion, and reuses the same batch", async () => {
    const uploaded = file(workbook());
    const first = await processExcelImportUpload({ file: uploaded, actorUserId: adminId }, { temporaryRoot: TEMP_ROOT });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    createdBatchIds.push(first.batch.batchId);
    assert.equal(first.outcome, "CREATED");
    const [batch] = await db.select().from(excelImportBatches).where(eq(excelImportBatches.id, first.batch.batchId));
    assert.ok(batch.sourceFileDeletedAt);
    await tempRootIsEmpty();

    const second = await processExcelImportUpload({ file: uploaded, actorUserId: adminId }, { temporaryRoot: TEMP_ROOT });
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(second.outcome, "REUSED");
      assert.equal(second.batch.batchId, first.batch.batchId);
    }
    await tempRootIsEmpty();

    await db.update(excelImportBatches).set({ status: "EXPIRED" }).where(eq(excelImportBatches.id, first.batch.batchId));
    const expired = await processExcelImportUpload({ file: uploaded, actorUserId: adminId }, { temporaryRoot: TEMP_ROOT });
    assert.equal(expired.ok, false);
    if (expired.ok || expired.code !== "EXPIRED_RESET_REQUIRES_CONFIRMATION" || !expired.batch) return;
    await tempRootIsEmpty();

    const reset = await processExcelImportUpload({
      file: uploaded,
      actorUserId: adminId,
      resetExpiredBatchId: expired.batch.batchId,
      expectedBatchVersion: expired.batch.version,
      confirmExpiredReset: true,
    }, { temporaryRoot: TEMP_ROOT });
    assert.equal(reset.ok, true);
    if (reset.ok) {
      assert.equal(reset.outcome, "RESET");
      assert.equal(reset.batch.batchId, first.batch.batchId);
    }
    await tempRootIsEmpty();
  });

  test("does not let a non-admin persist an upload and still deletes the temp file", async () => {
    const result = await processExcelImportUpload({ file: file(workbook()), actorUserId: engineerId }, { temporaryRoot: TEMP_ROOT });
    assert.deepEqual(result, { ok: false, code: "ACTOR_NOT_ALLOWED" });
    await tempRootIsEmpty();
  });

  test("confirmed same-SHA parser refresh completes once and then reuses v6 without repeating confirmation", async () => {
    const uploaded = file(workbook("목록", undefined, "refresh"));
    const first = await processExcelImportUpload({ file: uploaded, actorUserId: adminId }, { temporaryRoot: TEMP_ROOT });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    createdBatchIds.push(first.batch.batchId);
    await db.update(excelImportBatches).set({ parserVersion: "repair-case-list-parser-v3" }).where(eq(excelImportBatches.id, first.batch.batchId));

    const confirmation = await processExcelImportUpload({ file: uploaded, actorUserId: adminId }, { temporaryRoot: TEMP_ROOT });
    assert.equal(confirmation.ok, false);
    if (confirmation.ok || confirmation.code !== "PARSER_REFRESH_REQUIRES_CONFIRMATION" || !confirmation.batch) return;

    const refreshed = await processExcelImportUpload({
      file: uploaded,
      actorUserId: adminId,
      refreshExistingBatchId: confirmation.batch.batchId,
      expectedBatchVersion: confirmation.batch.version,
      confirmParserRefresh: true,
    }, { temporaryRoot: TEMP_ROOT });
    assert.equal(refreshed.ok, true);
    if (!refreshed.ok) return;
    assert.equal(refreshed.outcome, "REFRESH");

    const repeated = await processExcelImportUpload({ file: uploaded, actorUserId: adminId }, { temporaryRoot: TEMP_ROOT });
    assert.equal(repeated.ok, true);
    if (repeated.ok) {
      assert.equal(repeated.outcome, "REUSED");
      assert.equal(repeated.batch.batchId, first.batch.batchId);
    }
    await tempRootIsEmpty();
  });

  test("same SHA reuses the exact batch for every execution lifecycle state", async () => {
    const uploaded = file(workbook("목록", undefined, "lifecycle"));
    const first = await processExcelImportUpload({ file: uploaded, actorUserId: adminId }, { temporaryRoot: TEMP_ROOT });
    assert.equal(first.ok, true); if (!first.ok) return;
    createdBatchIds.push(first.batch.batchId);
    for (const status of ["IMPORTING", "PARTIAL_SUCCESS", "FAILED", "COMPLETED"] as const) {
      await db.update(excelImportBatches).set({ status, confirmedBy: adminId, confirmedAt: new Date(), completedAt: status === "IMPORTING" ? null : new Date() }).where(eq(excelImportBatches.id, first.batch.batchId));
      const reused = await processExcelImportUpload({ file: uploaded, actorUserId: adminId }, { temporaryRoot: TEMP_ROOT });
      assert.equal(reused.ok, true); if (!reused.ok) return;
      assert.equal(reused.outcome, "REUSED");
      assert.equal(reused.batch.batchId, first.batch.batchId);
      assert.equal(reused.batch.status, status);
    }
    await tempRootIsEmpty();
  });
});
