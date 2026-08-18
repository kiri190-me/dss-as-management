import "../../../../scripts/load-env";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { inArray } from "drizzle-orm";
import {
  EXCEL_IMPORT_COLUMNS,
  type ExcelImportParsedRowInput,
  type ExcelImportRawCellInput,
} from "@/lib/domain/excel-import-preview";
import { db, pgClient } from "../connection";
import { excelImportBatches, users } from "../schema";
import { persistExcelImportPreview, markExcelImportSourceFileDeleted } from "../mutations/excel-import-preview";
import { getExcelImportPreviewPage } from "./excel-import-preview";

const RUN_TOKEN = randomUUID();
const createdUserIds: string[] = [];
const createdBatchIds: string[] = [];
let adminId: string;
let otherAdminId: string;
let engineerId: string;

function hash(label: string): string {
  return createHash("sha256").update(`${RUN_TOKEN}:${label}`).digest("hex");
}

function row(rowNumber: number): ExcelImportParsedRowInput {
  const rawCells = Object.fromEntries(EXCEL_IMPORT_COLUMNS.map((column) => [column, {
    value: column === "D" ? `sensitive-${RUN_TOKEN}` : column === "F" ? "Generator" : column === "L" && rowNumber % 2 !== 0 ? "유상 / 확인" : null,
    metadata: null,
  }])) as Record<string, ExcelImportRawCellInput>;
  return {
    sourceSheet: "목록",
    sourceRowNumber: rowNumber,
    rawCells,
    normalized: {
      intakeNumber: `D9608${String(rowNumber - 3).padStart(2, "0")}`,
      receivedDate: "2096-08-01",
      customerName: `customer-${RUN_TOKEN}`,
      endUserName: `end-user-${RUN_TOKEN}`,
      productName: "Generator",
      modelName: `model-${RUN_TOKEN}`,
      lotNumber: `lot-${RUN_TOKEN}`,
      serialNumber: `serial-${RUN_TOKEN}`,
      billingType: "PAID" as const,
      status: "IN_REPAIR" as const,
    },
    sourceClassification: rowNumber % 2 === 0 ? "SOURCE_READY" as const : "SOURCE_REVIEW" as const,
    issues: rowNumber % 2 === 0 ? [] : [{ code: "BILLING_AMBIGUOUS", severity: "REVIEW" as const, rowNumber, cellAddress: `L${rowNumber}` }],
  };
}

function assigneeRow(rowNumber: number, sourceText: string): ExcelImportParsedRowInput {
  const value = row(rowNumber);
  value.rawCells.X = { value: sourceText, metadata: null };
  value.sourceClassification = "SOURCE_READY";
  value.issues = [{ code: "ASSIGNEE_MAPPING_PENDING", severity: "WARNING", rowNumber, cellAddress: `X${rowNumber}` }];
  return value;
}

function expectedCountRow(index: number, classification: "EXECUTABLE" | "AUTO_EXCLUDED" | "CONFLICT"): ExcelImportParsedRowInput {
  const rowNumber = index + 4;
  const month = Math.floor(index / 100) + 1;
  const value = row(rowNumber);
  value.normalized.intakeNumber = `D96${String(month).padStart(2, "0")}${String(index % 100).padStart(2, "0")}`;
  value.normalized.receivedDate = `2096-${String(month).padStart(2, "0")}-01`;
  value.rawCells.B = { value: value.normalized.intakeNumber, metadata: null };
  value.rawCells.C = { value: value.normalized.receivedDate, metadata: null };
  value.rawCells.L = { value: "유상", metadata: null };
  value.sourceClassification = "SOURCE_READY";
  value.issues = [];
  if (classification === "AUTO_EXCLUDED") {
    value.normalized.serialNumber = null;
    value.rawCells.J = { value: null, metadata: null };
  } else if (classification === "CONFLICT") {
    value.sourceClassification = "SOURCE_REVIEW";
    value.rawCells.L = { value: "유상 / 확인", metadata: null };
    value.issues = [{ code: "BILLING_AMBIGUOUS", severity: "REVIEW", rowNumber, cellAddress: `L${rowNumber}` }];
  }
  return value;
}

before(async () => {
  for (const [name, role] of [["owner", "ADMIN"], ["other", "SUPER_ADMIN"], ["engineer", "AS_ENGINEER"]] as const) {
    const [user] = await db.insert(users).values({
      email: `excel-preview-query-${RUN_TOKEN}-${name}@example.invalid`,
      name: `Excel Preview Query ${name}`,
      role,
      approvalStatus: "APPROVED",
    }).returning({ id: users.id });
    createdUserIds.push(user.id);
    if (name === "owner") adminId = user.id;
    else if (name === "other") otherAdminId = user.id;
    else engineerId = user.id;
  }
});

after(async () => {
  if (createdBatchIds.length > 0) await db.delete(excelImportBatches).where(inArray(excelImportBatches.id, createdBatchIds));
  if (createdUserIds.length > 0) await db.delete(users).where(inArray(users.id, createdUserIds));
  await pgClient.end({ timeout: 5 });
});

async function createBatch(rows = Array.from({ length: 55 }, (_, index) => row(index + 4))) {
  const batchToken = randomUUID();
  const result = await persistExcelImportPreview({
    sourceFileSha256: hash(`file:${batchToken}`),
    parserVersion: "repair-case-list-parser-v3",
    sourceSheet: "목록",
    headerFingerprint: hash(`header:${batchToken}`),
    originalFileName: "preview-query.xlsx",
    fileSizeBytes: 4096,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    uploadedBy: adminId,
    now: new Date("2026-08-17T00:00:00.000Z"),
    safetyValidation: { ok: true, issues: [] },
    parsedPreview: { ok: true, sourceSheet: "목록", headerValid: true, totalDataRowsConsidered: rows.length, blankRowsSkipped: 0, rows, issues: [] },
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("preview setup failed");
  createdBatchIds.push(result.batch.batchId);
  return result.batch.batchId;
}

describe("getExcelImportPreviewPage", () => {
  test("returns only the allow-listed DTO with counts and deterministic pagination", async () => {
    const batchId = await createBatch();
    const first = await getExcelImportPreviewPage({ batchId, actorUserId: adminId, page: 1, pageSize: 25 });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.value.batch.counts.total, 55);
    assert.equal(first.value.batch.counts.executable, 28);
    assert.equal(first.value.batch.counts.conflicts, 27);
    assert.equal(first.value.batch.counts.autoExcluded, 0);
    assert.equal(first.value.rows.length, 25);
    assert.equal(first.value.rows[0].sourceRowNumber, 4);
    assert.equal(first.value.pagination.totalPages, 3);
    const reviewRow = first.value.rows.find((item) => item.sourceRowNumber === 5);
    assert.equal(reviewRow?.reviewItems[0]?.title, "유·무상 확인 필요");
    assert.deepEqual(reviewRow?.reviewItems[0]?.sources, [{
      column: "L", label: "유·무상", cellAddress: "L5", value: "유상 / 확인",
    }]);
    const serialized = JSON.stringify(first.value);
    for (const forbidden of ["rawData", "sourceFileSha256", "sourceRowFingerprint", "productId", "assignedEngineerId"]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} must not be exposed`);
    }

    const third = await getExcelImportPreviewPage({ batchId, actorUserId: adminId, page: 3, pageSize: 25 });
    assert.equal(third.ok, true);
    if (third.ok) {
      assert.equal(third.value.rows.length, 5);
      assert.equal(third.value.rows[0].sourceRowNumber, 54);
    }
  });

  test("filters the whole 661-row batch before pagination while retaining full-batch card counts", async () => {
    const rows = Array.from({ length: 661 }, (_, index) => expectedCountRow(
      index,
      index === 652 ? "AUTO_EXCLUDED" : index > 652 ? "CONFLICT" : "EXECUTABLE",
    ));
    const batchId = await createBatch(rows);

    for (const [filter, expected] of [["ALL", 661], ["EXECUTABLE", 652], ["AUTO_EXCLUDED", 1], ["CONFLICT", 8], ["IMPORTED", 0]] as const) {
      const result = await getExcelImportPreviewPage({ batchId, actorUserId: adminId, filter, page: 1, pageSize: 25 });
      assert.equal(result.ok, true, filter);
      if (!result.ok) continue;
      assert.deepEqual(result.value.batch.counts, {
        ...result.value.batch.counts,
        total: 661,
        executable: 652,
        autoExcluded: 1,
        conflicts: 8,
        imported: 0,
      });
      assert.equal(result.value.filter, filter);
      assert.equal(result.value.pagination.totalItems, expected);
      assert.equal(result.value.rows.length, Math.min(25, expected));
      assert.equal(result.value.rows.every((item) => filter === "ALL" || item.classification === filter), true);
    }

    const lastExecutablePage = await getExcelImportPreviewPage({ batchId, actorUserId: adminId, filter: "EXECUTABLE", page: 27, pageSize: 25 });
    assert.equal(lastExecutablePage.ok, true);
    if (lastExecutablePage.ok) {
      assert.equal(lastExecutablePage.value.rows.length, 2);
      assert.equal(lastExecutablePage.value.pagination.totalPages, 27);
    }
    const invalidFilter = await getExcelImportPreviewPage({ batchId, actorUserId: adminId, filter: "NOT_ALLOWED", page: 1, pageSize: 25 });
    assert.equal(invalidFilter.ok, true);
    if (invalidFilter.ok) {
      assert.equal(invalidFilter.value.filter, "ALL");
      assert.equal(invalidFilter.value.pagination.totalItems, 661);
    }
  });

  test("links one exact assignee and leaves unmatched assignees unassigned without blocking", async () => {
    const batchId = await createBatch([
      assigneeRow(4, "  Legacy   Person  "),
      assigneeRow(5, "legacy person"),
      assigneeRow(6, "Excel Preview Query engineer"),
    ]);
    const result = await getExcelImportPreviewPage({ batchId, actorUserId: adminId });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.batch.counts.total, 3);
    assert.equal(result.value.batch.counts.assigneeLinked, 1);
    assert.equal(result.value.batch.counts.assigneeUnassigned, 2);
    assert.equal(result.value.rows.some((row) => row.reviewItems.some((item) => item.code === "ASSIGNEE_MAPPING_PENDING")), false);
  });

  test("keeps legacy I as detail-only raw trace while excluding it from review issue sources", async () => {
    const legacyRow = row(4);
    legacyRow.rawCells.H = { value: "LOT-H", metadata: null };
    legacyRow.rawCells.I = { value: `legacy-receipt-count-${RUN_TOKEN}`, metadata: null };
    legacyRow.sourceClassification = "SOURCE_REVIEW";
    legacyRow.issues = [{
      code: "LOT_NUMBER_CONFLICT",
      severity: "REVIEW",
      rowNumber: 4,
      cellAddress: "H4:I4",
    }];
    const batchId = await createBatch([legacyRow]);
    const result = await getExcelImportPreviewPage({ batchId, actorUserId: adminId });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.rows[0].reviewItems[0].sources, [{
      column: "H", label: "L/N", cellAddress: "H4", value: "LOT-H",
    }]);
    assert.equal(result.value.rows[0].rawValues.I, `legacy-receipt-count-${RUN_TOKEN}`);
  });

  test("hides an owned batch from another admin and denies a non-admin", async () => {
    const batchId = createdBatchIds[0] ?? await createBatch();
    assert.deepEqual(await getExcelImportPreviewPage({ batchId, actorUserId: otherAdminId }), { ok: false, code: "NOT_FOUND" });
    assert.deepEqual(await getExcelImportPreviewPage({ batchId, actorUserId: engineerId }), { ok: false, code: "FORBIDDEN" });
  });

  test("marks source deletion only for the owning authorized actor", async () => {
    const batchId = createdBatchIds[0] ?? await createBatch();
    const deletedAt = new Date("2026-08-17T00:01:00.000Z");
    assert.equal(await markExcelImportSourceFileDeleted({ batchId, actorUserId: otherAdminId, deletedAt }), false);
    assert.equal(await markExcelImportSourceFileDeleted({ batchId, actorUserId: adminId, deletedAt }), true);
    const result = await getExcelImportPreviewPage({ batchId, actorUserId: adminId });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.batch.sourceFileDeletedAt, deletedAt.toISOString());
  });
});
