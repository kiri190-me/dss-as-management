"use server";

import { canManageExcelImports } from "@/lib/auth/excel-import-authorization";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  processExcelImportUpload,
  type ExcelImportUploadResult,
} from "@/lib/server/excel-import-upload";
import {
  confirmExcelImportExecution,
  runExcelImportChunk,
  type ConfirmExcelImportExecutionResult,
  type RunExcelImportChunkResult,
} from "@/lib/db/mutations/excel-import-execution";

export type UploadExcelImportPreviewActionResult =
  | ExcelImportUploadResult
  | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" };

function optionalString(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function uploadExcelImportPreviewAction(
  formData: FormData
): Promise<UploadExcelImportPreviewActionResult> {
  if (getAuthSource() !== "database") return { ok: false, code: "FORBIDDEN" };
  const session = await readSession();
  if (!session) return { ok: false, code: "UNAUTHORIZED" };
  const actor = await resolveActingUserForSession(session);
  if (!actor) return { ok: false, code: "UNAUTHORIZED" };
  if (actor.approvalStatus !== "APPROVED" || !canManageExcelImports(actor.role)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const fileValue = formData.get("file");
  const expectedVersionValue = optionalString(formData, "expectedBatchVersion");
  const confirmValue = optionalString(formData, "confirmExpiredReset");
  const confirmRefreshValue = optionalString(formData, "confirmParserRefresh");
  return processExcelImportUpload({
    file: fileValue instanceof File ? fileValue : null,
    actorUserId: actor.id,
    resetExpiredBatchId: optionalString(formData, "resetExpiredBatchId"),
    refreshExistingBatchId: optionalString(formData, "refreshExistingBatchId"),
    expectedBatchVersion:
      expectedVersionValue === undefined ? undefined : Number(expectedVersionValue),
    confirmExpiredReset: confirmValue === undefined ? undefined : confirmValue === "true",
    confirmParserRefresh:
      confirmRefreshValue === undefined ? undefined : confirmRefreshValue === "true",
  });
}

async function excelImportActor() {
  if (getAuthSource() !== "database") return null;
  const session = await readSession();
  if (!session) return null;
  const actor = await resolveActingUserForSession(session);
  if (!actor || actor.approvalStatus !== "APPROVED" || !canManageExcelImports(actor.role)) return null;
  return actor;
}

export async function confirmExcelImportExecutionAction(input: {
  batchId: string;
  expectedBatchVersion: number;
}): Promise<ConfirmExcelImportExecutionResult> {
  const actor = await excelImportActor();
  if (!actor) return { ok: false, code: "FORBIDDEN" };
  return confirmExcelImportExecution({ ...input, actorUserId: actor.id });
}

export async function runExcelImportChunkAction(input: {
  batchId: string;
  expectedBatchVersion: number;
  retryFailed?: boolean;
}): Promise<RunExcelImportChunkResult> {
  const actor = await excelImportActor();
  if (!actor) return { ok: false, code: "FORBIDDEN" };
  return runExcelImportChunk({ ...input, actorUserId: actor.id });
}
