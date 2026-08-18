import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXCEL_IMPORT_MAX_FILE_BYTES } from "@/lib/domain/excel-import-preview";
import {
  markExcelImportSourceFileDeleted,
  persistExcelImportPreview,
  type ExcelImportPreviewBatchInfo,
  type ExcelImportPreviewResultCode,
} from "@/lib/db/mutations/excel-import-preview";
import { loadWorkbook } from "../../../scripts/lib/xlsx/workbook-loader";
import {
  parseRepairCaseListWorkbook,
  REPAIR_CASE_IMPORT_SHEET,
} from "../../../scripts/lib/xlsx/repair-case-list-import";
import { validateRepairCaseXlsxBuffer } from "../../../scripts/lib/xlsx/repair-case-xlsx-safety";

export const EXCEL_IMPORT_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const REPAIR_CASE_LIST_PARSER_VERSION = "repair-case-list-parser-v6";

export type ExcelImportUploadResult =
  | {
      ok: true;
      outcome: "CREATED" | "RESET" | "REFRESH" | "REUSED";
      batch: ExcelImportPreviewBatchInfo;
    }
  | {
      ok: false;
      code:
        | "FILE_REQUIRED"
        | "INVALID_FILE_NAME"
        | "UNSUPPORTED_MIME_TYPE"
        | "FILE_TOO_LARGE"
        | "UNSAFE_XLSX"
        | "WORKBOOK_STRUCTURE_ERROR"
        | "TEMP_FILE_CLEANUP_FAILED"
        | "SOURCE_DELETE_MARK_FAILED"
        | ExcelImportPreviewResultCode;
      issueCodes?: string[];
      batch?: ExcelImportPreviewBatchInfo;
    };

type ProcessUploadOptions = {
  temporaryRoot?: string;
  now?: () => Date;
};

function headerFingerprint(workbook: ReturnType<typeof loadWorkbook>): string {
  const sheet = workbook.sheets.find((candidate) => candidate.name === REPAIR_CASE_IMPORT_SHEET);
  const values = "ABCDEFGHIJKLMNOPQRSTUVWXY".split("").map((column) =>
    (sheet?.worksheet.cells[`${column}3`] ?? "").replace(/[\r\n\t ]+/g, " ").trim()
  );
  return createHash("sha256").update(JSON.stringify(values), "utf8").digest("hex");
}

function fileNameIsSafe(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    name !== "." &&
    name !== ".." &&
    !/[\\/]/.test(name) &&
    name.toLowerCase().endsWith(".xlsx")
  );
}

/**
 * Parses one browser upload through the approved safety/parser/persistence
 * chain. The workbook bytes exist only in a per-run temporary directory and
 * the path is never returned or logged.
 */
export async function processExcelImportUpload(input: {
  file: File | null;
  actorUserId: string;
  resetExpiredBatchId?: string;
  refreshExistingBatchId?: string;
  expectedBatchVersion?: number;
  confirmExpiredReset?: boolean;
  confirmParserRefresh?: boolean;
}, options: ProcessUploadOptions = {}): Promise<ExcelImportUploadResult> {
  const file = input.file;
  if (!file || file.size === 0) return { ok: false, code: "FILE_REQUIRED" };
  if (!fileNameIsSafe(file.name)) return { ok: false, code: "INVALID_FILE_NAME" };
  if (file.type !== EXCEL_IMPORT_XLSX_MIME) return { ok: false, code: "UNSUPPORTED_MIME_TYPE" };
  if (file.size > EXCEL_IMPORT_MAX_FILE_BYTES) return { ok: false, code: "FILE_TOO_LARGE" };

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return { ok: false, code: "WORKBOOK_STRUCTURE_ERROR" };
  }
  if (bytes.length > EXCEL_IMPORT_MAX_FILE_BYTES) return { ok: false, code: "FILE_TOO_LARGE" };

  const safety = validateRepairCaseXlsxBuffer(bytes, file.name);
  if (!safety.ok) {
    return {
      ok: false,
      code: "UNSAFE_XLSX",
      issueCodes: safety.issues.map((issue) => issue.code),
    };
  }

  const root = options.temporaryRoot ?? tmpdir();
  const tempDirectory = join(root, `dss-excel-import-${randomUUID()}`);
  const tempFilePath = join(tempDirectory, "upload.xlsx");
  let directoryCreated = false;
  let fileCreated = false;
  let cleanupSucceeded = false;
  let result: ExcelImportUploadResult = { ok: false, code: "WORKBOOK_STRUCTURE_ERROR" };
  let batchToMark: string | null = null;

  try {
    await mkdir(tempDirectory, { recursive: false });
    directoryCreated = true;
    await writeFile(tempFilePath, bytes, { flag: "wx" });
    fileCreated = true;

    const workbook = loadWorkbook(tempFilePath);
    const now = options.now?.() ?? new Date();
    const parsed = parseRepairCaseListWorkbook(workbook, {
      referenceDate: now.toISOString().slice(0, 10),
    });
    if (!parsed.ok) {
      result = {
        ok: false,
        code: "WORKBOOK_STRUCTURE_ERROR",
        issueCodes: parsed.issues.map((issue) => issue.code),
      };
    } else {
      const persisted = await persistExcelImportPreview({
        sourceFileSha256: createHash("sha256").update(bytes).digest("hex"),
        parserVersion: REPAIR_CASE_LIST_PARSER_VERSION,
        sourceSheet: REPAIR_CASE_IMPORT_SHEET,
        headerFingerprint: headerFingerprint(workbook),
        originalFileName: file.name,
        fileSizeBytes: bytes.length,
        mimeType: file.type,
        uploadedBy: input.actorUserId,
        now,
        safetyValidation: safety,
        parsedPreview: parsed,
        ...(input.resetExpiredBatchId === undefined ? {} : { resetExpiredBatchId: input.resetExpiredBatchId }),
        ...(input.refreshExistingBatchId === undefined ? {} : { refreshExistingBatchId: input.refreshExistingBatchId }),
        ...(input.expectedBatchVersion === undefined ? {} : { expectedBatchVersion: input.expectedBatchVersion }),
        ...(input.confirmExpiredReset === undefined ? {} : { confirmExpiredReset: input.confirmExpiredReset }),
        ...(input.confirmParserRefresh === undefined ? {} : { confirmParserRefresh: input.confirmParserRefresh }),
      });
      if (persisted.ok) {
        batchToMark = persisted.batch.batchId;
        result = persisted;
      } else if ([
        "EXISTING_PREVIEW",
        "EXISTING_IMPORT_IN_PROGRESS",
        "EXISTING_PARTIAL_SUCCESS",
        "EXISTING_FAILED_IMPORT",
        "EXISTING_COMPLETED_IMPORT",
      ].includes(persisted.code) && persisted.batch) {
        batchToMark = persisted.batch.batchId;
        result = { ok: true, outcome: "REUSED", batch: persisted.batch };
      } else {
        batchToMark = persisted.batch?.batchId ?? null;
        result = persisted;
      }
    }
  } catch {
    result = { ok: false, code: "WORKBOOK_STRUCTURE_ERROR" };
  } finally {
    if (directoryCreated) {
      try {
        if (fileCreated) await unlink(tempFilePath);
        await rmdir(tempDirectory);
        cleanupSucceeded = true;
      } catch {
        cleanupSucceeded = false;
      }
    }
  }

  if (!cleanupSucceeded) return { ok: false, code: "TEMP_FILE_CLEANUP_FAILED" };
  if (batchToMark) {
    const marked = await markExcelImportSourceFileDeleted({
      batchId: batchToMark,
      actorUserId: input.actorUserId,
      deletedAt: options.now?.() ?? new Date(),
    });
    if (!marked) return { ok: false, code: "SOURCE_DELETE_MARK_FAILED" };
  }
  return result;
}
