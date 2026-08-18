import "server-only";

import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { canManageExcelImports } from "@/lib/auth/excel-import-authorization";
import { normalizeEntityName } from "@/lib/domain/entity-name-match";
import {
  EXCEL_IMPORT_PREVIEW_RETENTION_MS,
  validateExcelImportPreviewInput,
  type ExcelImportPreviewBoundaryInput,
  type ExcelImportPreviewRowDto,
  type ExcelImportPreviewSummary,
} from "@/lib/domain/excel-import-preview";
import { db } from "../client";
import {
  excelImportBatches,
  excelImportRowAttempts,
  excelImportRows,
  customers,
  endUsers,
  productModels,
  users,
} from "../schema";

const ROW_INSERT_CHUNK_SIZE = 200;

export type ExcelImportPreviewResultCode =
  | "INVALID_PREVIEW_INPUT"
  | "ACTOR_NOT_ALLOWED"
  | "EXISTING_PREVIEW"
  | "PARSER_REFRESH_REQUIRES_CONFIRMATION"
  | "EXISTING_IMPORT_IN_PROGRESS"
  | "EXISTING_PARTIAL_SUCCESS"
  | "EXISTING_FAILED_IMPORT"
  | "EXISTING_COMPLETED_IMPORT"
  | "EXPIRED_RESET_REQUIRES_CONFIRMATION"
  | "STALE_BATCH_VERSION"
  | "BATCH_RESET_NOT_ALLOWED"
  | "DATABASE_UNAVAILABLE";

export type ExcelImportPreviewBatchInfo = {
  batchId: string;
  status:
    | "PREVIEWED"
    | "REVIEW_REQUIRED"
    | "READY"
    | "IMPORTING"
    | "PARTIAL_SUCCESS"
    | "COMPLETED"
    | "FAILED"
    | "EXPIRED";
  rowCounts: {
    total: number;
    sourceReady: number;
    sourceReview: number;
  };
  version: number;
};

export type PersistExcelImportPreviewResult =
  | {
      ok: true;
      outcome: "CREATED" | "RESET" | "REFRESH";
      batch: ExcelImportPreviewBatchInfo;
    }
  | {
      ok: false;
      code: ExcelImportPreviewResultCode;
      batch?: ExcelImportPreviewBatchInfo;
    };

/** Records only that this actor's temporary source copy was deleted. */
export async function markExcelImportSourceFileDeleted(input: {
  batchId: string;
  actorUserId: string;
  deletedAt: Date;
}): Promise<boolean> {
  if (Number.isNaN(input.deletedAt.getTime())) return false;
  try {
    return await db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ role: users.role, approvalStatus: users.approvalStatus, isDeleted: users.isDeleted })
        .from(users)
        .where(eq(users.id, input.actorUserId))
        .limit(1);
      if (!actor || actor.isDeleted || actor.approvalStatus !== "APPROVED" || !canManageExcelImports(actor.role)) {
        return false;
      }
      const [updated] = await tx
        .update(excelImportBatches)
        .set({ sourceFileDeletedAt: input.deletedAt, updatedAt: input.deletedAt })
        .where(and(eq(excelImportBatches.id, input.batchId), eq(excelImportBatches.uploadedBy, input.actorUserId)))
        .returning({ id: excelImportBatches.id });
      return !!updated;
    });
  } catch {
    return false;
  }
}

type BatchRow = typeof excelImportBatches.$inferSelect;

function existingStateCode(status: BatchRow["status"]): ExcelImportPreviewResultCode {
  if (status === "PREVIEWED" || status === "REVIEW_REQUIRED" || status === "READY") {
    return "EXISTING_PREVIEW";
  }
  if (status === "IMPORTING") return "EXISTING_IMPORT_IN_PROGRESS";
  if (status === "PARTIAL_SUCCESS") return "EXISTING_PARTIAL_SUCCESS";
  if (status === "FAILED") return "EXISTING_FAILED_IMPORT";
  if (status === "COMPLETED") return "EXISTING_COMPLETED_IMPORT";
  if (status === "EXPIRED") return "EXPIRED_RESET_REQUIRES_CONFIRMATION";
  return "BATCH_RESET_NOT_ALLOWED";
}

type ResolvedPreviewRow = {
  row: ExcelImportPreviewRowDto;
  customerId: string | null;
  endUserId: string | null;
  productModelId: string | null;
  assignedEngineerId: string | null;
  decisions: Record<string, unknown> | null;
};

function rowInsertValues(batchId: string, resolved: ResolvedPreviewRow) {
  const { row } = resolved;
  return {
    batchId,
    sourceSheet: row.sourceSheet,
    sourceRowNumber: row.sourceRowNumber,
    sourceRowFingerprint: row.sourceRowFingerprint,
    rawData: row.rawData,
    normalizedData: row.normalizedData,
    issues: row.issues,
    corrections: null,
    decisions: resolved.decisions,
    sourceClassification: row.sourceClassification,
    importStatus: row.importStatus,
    customerId: resolved.customerId,
    endUserId: resolved.endUserId,
    productModelId: resolved.productModelId,
    productId: null,
    assignedEngineerId: resolved.assignedEngineerId,
    workflowVersionId: null,
    workflowStepId: null,
    exceptionStatusId: null,
    matchedExistingRepairCaseId: null,
    resultRepairCaseId: null,
    lastErrorCode: null,
    lastErrorAt: null,
    importedBy: null,
    importedAt: null,
    sensitiveDataPurgedAt: null,
    version: 1,
  } as const;
}

/**
 * Persists parser output into Import-only staging. It never reads or writes any
 * customer/product/Repair Case/audit data; only the actor row and Import staging
 * tables participate. Raw JSON and database errors are never returned.
 */
export async function persistExcelImportPreview(
  input: ExcelImportPreviewBoundaryInput
): Promise<PersistExcelImportPreviewResult> {
  const validated = validateExcelImportPreviewInput(input);
  if (!validated.ok) return validated;
  const preview = validated.value;
  const { metadata } = preview;

  try {
    return await db.transaction(async (tx): Promise<PersistExcelImportPreviewResult> => {
      const [actor] = await tx
        .select({
          id: users.id,
          role: users.role,
          approvalStatus: users.approvalStatus,
          isDeleted: users.isDeleted,
        })
        .from(users)
        .where(eq(users.id, metadata.uploadedBy))
        .limit(1);

      if (
        !actor ||
        actor.isDeleted ||
        actor.approvalStatus !== "APPROVED" ||
        !canManageExcelImports(actor.role)
      ) {
        return { ok: false, code: "ACTOR_NOT_ALLOWED" };
      }

      const customerRows = await tx.select({ id: customers.id, name: customers.name })
        .from(customers).where(eq(customers.isDeleted, false));
      const endUserRows = await tx.select({ id: endUsers.id, name: endUsers.name, customerId: endUsers.customerId })
        .from(endUsers).where(eq(endUsers.isDeleted, false));
      const productModelRows = await tx.select({ id: productModels.id, modelName: productModels.modelName, kind: productModels.kind })
        .from(productModels).where(eq(productModels.isDeleted, false));
      const eligibleEngineers = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          and(
            eq(users.role, "AS_ENGINEER"),
            eq(users.approvalStatus, "APPROVED"),
            eq(users.isDeleted, false)
          )
        );
      const engineersByName = new Map<string, Array<{ id: string; name: string }>>();
      for (const engineer of eligibleEngineers) {
        const key = normalizeEntityName(engineer.name);
        engineersByName.set(key, [...(engineersByName.get(key) ?? []), engineer]);
      }
      const customersByName = new Map<string, typeof customerRows>();
      for (const customer of customerRows) {
        const key = normalizeEntityName(customer.name);
        customersByName.set(key, [...(customersByName.get(key) ?? []), customer]);
      }
      const endUsersByCustomerAndName = new Map<string, typeof endUserRows>();
      for (const endUser of endUserRows) {
        const key = `${endUser.customerId}:${normalizeEntityName(endUser.name)}`;
        endUsersByCustomerAndName.set(key, [...(endUsersByCustomerAndName.get(key) ?? []), endUser]);
      }
      const productModelsByName = new Map<string, typeof productModelRows>();
      for (const productModel of productModelRows) {
        const key = normalizeEntityName(productModel.modelName);
        productModelsByName.set(key, [...(productModelsByName.get(key) ?? []), productModel]);
      }
      const issueCodeCounts = { ...preview.summary.issueCodeCounts };
      const changeCodeCount = (code: string, amount: number) => {
        const next = (issueCodeCounts[code] ?? 0) + amount;
        if (next > 0) issueCodeCounts[code] = next;
        else delete issueCodeCounts[code];
      };
      const resolvedRows: ResolvedPreviewRow[] = preview.rows.map((row) => {
        const customerRaw = row.rawData.columns.D.value?.trim() ?? "";
        const customerMatches = customerRaw ? customersByName.get(normalizeEntityName(customerRaw)) ?? [] : [];
        const customerId = customerMatches.length === 1 ? customerMatches[0].id : null;
        const endUserRaw = row.rawData.columns.E.value?.trim() ?? "";
        const endUserMatches = customerId && endUserRaw
          ? endUsersByCustomerAndName.get(`${customerId}:${normalizeEntityName(endUserRaw)}`) ?? []
          : [];
        const endUserId = endUserMatches.length === 1 ? endUserMatches[0].id : null;
        const modelRaw = row.rawData.columns.G.value?.trim() ?? "";
        const productModelMatches = modelRaw
          ? productModelsByName.get(normalizeEntityName(modelRaw)) ?? []
          : [];
        const productModelId = productModelMatches.length === 1 ? productModelMatches[0].id : null;
        const assigneeRaw = row.rawData.columns.X.value?.trim() ?? "";
        const matches = engineersByName.get(normalizeEntityName(assigneeRaw)) ?? [];
        const assignedEngineerId = assigneeRaw && matches.length === 1 ? matches[0].id : null;
        const replacements = new Map<string, string>();
        if (customerId) replacements.set("CUSTOMER_MAPPING_PENDING", "CUSTOMER_AUTO_MATCHED");
        if (endUserId) replacements.set("END_USER_MAPPING_PENDING", "END_USER_AUTO_MATCHED");
        if (productModelId) replacements.set("PRODUCT_MODEL_MAPPING_PENDING", "PRODUCT_MODEL_AUTO_MATCHED");
        if (assignedEngineerId) replacements.set("ASSIGNEE_MAPPING_PENDING", "ASSIGNEE_AUTO_MATCHED");
        const issues = row.issues.map((issue) => {
          const replacement = replacements.get(issue.code);
          if (!replacement) return issue;
          changeCodeCount(issue.code, -1);
          changeCodeCount(replacement, 1);
          return { ...issue, code: replacement };
        });
        const decisions: Record<string, unknown> = { schemaVersion: "excel-import-master-mapping-v1" };
        if (customerId) decisions.customer = "AUTO_EXACT";
        if (endUserId) decisions.endUser = "AUTO_EXACT";
        if (productModelId) decisions.productModel = "AUTO_EXACT";
        if (assignedEngineerId) decisions.assignee = "AUTO_EXACT";
        const hasDecision = Object.keys(decisions).length > 1;
        const importStatus = row.sourceClassification === "SOURCE_REVIEW"
          ? "PENDING_REVIEW"
          : issues.some((issue) => issue.severity === "WARNING" && issue.code.endsWith("_MAPPING_PENDING"))
            ? "MAPPING_REQUIRED"
            : "IMPORT_READY";
        return {
          row: { ...row, issues, importStatus },
          customerId, endUserId, productModelId, assignedEngineerId,
          decisions: hasDecision ? decisions : null,
        };
      });
      const resolvedSummary: ExcelImportPreviewSummary = {
        ...preview.summary,
        issueCodeCounts: Object.fromEntries(
          Object.entries(issueCodeCounts).sort(([a], [b]) => a.localeCompare(b))
        ),
      };
      const resolvedBatchStatus = preview.summary.sourceReviewRows > 0 ? "REVIEW_REQUIRED" : "PREVIEWED";

      const summarize = async (batch: BatchRow): Promise<ExcelImportPreviewBatchInfo> => {
        const [counts] = await tx
          .select({
            total: sql<number>`count(*)::int`,
            sourceReady: sql<number>`count(*) filter (where ${excelImportRows.sourceClassification} = 'SOURCE_READY')::int`,
            sourceReview: sql<number>`count(*) filter (where ${excelImportRows.sourceClassification} = 'SOURCE_REVIEW')::int`,
          })
          .from(excelImportRows)
          .where(eq(excelImportRows.batchId, batch.id));
        return {
          batchId: batch.id,
          status: batch.status,
          rowCounts: counts ?? { total: 0, sourceReady: 0, sourceReview: 0 },
          version: batch.version,
        };
      };

      const findExactBatchForUpdate = async (): Promise<BatchRow | undefined> => {
        const [batch] = await tx
          .select()
          .from(excelImportBatches)
          .where(
            and(
              eq(excelImportBatches.sourceFileSha256, metadata.sourceFileSha256),
              eq(excelImportBatches.sourceSheet, metadata.sourceSheet)
            )
          )
          .for("update");
        return batch;
      };

      const insertRows = async (batchId: string) => {
        for (let offset = 0; offset < resolvedRows.length; offset += ROW_INSERT_CHUNK_SIZE) {
          const chunk = resolvedRows
            .slice(offset, offset + ROW_INSERT_CHUNK_SIZE)
            .map((row) => rowInsertValues(batchId, row));
          await tx.insert(excelImportRows).values(chunk);
        }
      };

      const handleExisting = async (
        existing: BatchRow
      ): Promise<PersistExcelImportPreviewResult> => {
        const isExpiredReset = existing.status === "EXPIRED";
        const isParserRefresh =
          !isExpiredReset &&
          ["PREVIEWED", "REVIEW_REQUIRED", "READY"].includes(existing.status) &&
          existing.parserVersion !== metadata.parserVersion;
        if (!isExpiredReset && !isParserRefresh) {
          return {
            ok: false,
            code: existingStateCode(existing.status),
            batch: await summarize(existing),
          };
        }

        const confirmation = isExpiredReset ? preview.reset : preview.refresh;
        if (!confirmation) {
          return {
            ok: false,
            code: isExpiredReset
              ? "EXPIRED_RESET_REQUIRES_CONFIRMATION"
              : "PARSER_REFRESH_REQUIRES_CONFIRMATION",
            batch: await summarize(existing),
          };
        }
        if (confirmation.batchId !== existing.id) {
          return { ok: false, code: "BATCH_RESET_NOT_ALLOWED", batch: await summarize(existing) };
        }
        if (confirmation.expectedVersion !== existing.version) {
          return { ok: false, code: "STALE_BATCH_VERSION", batch: await summarize(existing) };
        }
        if (existing.confirmedBy || existing.confirmedAt || existing.completedAt) {
          return { ok: false, code: "BATCH_RESET_NOT_ALLOWED", batch: await summarize(existing) };
        }

        const irreversibleStatuses = [
          "IMPORTING",
          "IMPORTED",
          "FAILED",
          "SKIPPED_EXISTING",
        ] as const;
        const [irreversibleRow] = await tx
          .select({ id: excelImportRows.id })
          .from(excelImportRows)
          .where(
            and(
              eq(excelImportRows.batchId, existing.id),
              or(
                inArray(excelImportRows.importStatus, irreversibleStatuses),
                // Customer/End-User/Product Model/assignee and other
                // preview-only choices are deliberately absent here. A
                // confirmed parser refresh discards the old staging rows and
                // recalculates those references from the re-uploaded v4 raw
                // source. In the current execution contract, the fields below
                // are written only after an Import attempt has started, so a
                // non-null value is conservative crash-window evidence.
                isNotNull(excelImportRows.productId),
                isNotNull(excelImportRows.workflowVersionId),
                isNotNull(excelImportRows.workflowStepId),
                isNotNull(excelImportRows.resultRepairCaseId),
                isNotNull(excelImportRows.importedBy),
                isNotNull(excelImportRows.importedAt),
                isNotNull(excelImportRows.lastErrorCode),
                isNotNull(excelImportRows.lastErrorAt)
              )
            )
          )
          .limit(1);
        if (irreversibleRow) {
          return { ok: false, code: "BATCH_RESET_NOT_ALLOWED", batch: await summarize(existing) };
        }

        const [attempt] = await tx
          .select({ id: excelImportRowAttempts.id })
          .from(excelImportRowAttempts)
          .innerJoin(excelImportRows, eq(excelImportRowAttempts.importRowId, excelImportRows.id))
          .where(eq(excelImportRows.batchId, existing.id))
          .limit(1);
        if (attempt) {
          return { ok: false, code: "BATCH_RESET_NOT_ALLOWED", batch: await summarize(existing) };
        }

        await tx.delete(excelImportRows).where(eq(excelImportRows.batchId, existing.id));
        const previewExpiresAt = new Date(
          metadata.now.getTime() + EXCEL_IMPORT_PREVIEW_RETENTION_MS
        );
        const [updated] = await tx
          .update(excelImportBatches)
          .set({
            parserVersion: metadata.parserVersion,
            headerFingerprint: metadata.headerFingerprint,
            originalFileName: metadata.originalFileName,
            fileSizeBytes: metadata.fileSizeBytes,
            mimeType: metadata.mimeType,
            status: resolvedBatchStatus,
            summary: resolvedSummary,
            uploadedBy: metadata.uploadedBy,
            uploadedAt: metadata.now,
            confirmedBy: null,
            confirmedAt: null,
            completedAt: null,
            previewExpiresAt,
            sensitiveDataRetainUntil: null,
            sensitiveDataPurgedAt: null,
            sourceFileDeletedAt: null,
            version: sql`${excelImportBatches.version} + 1`,
            updatedAt: metadata.now,
          })
          .where(
            and(
              eq(excelImportBatches.id, existing.id),
              eq(excelImportBatches.sourceFileSha256, metadata.sourceFileSha256),
              eq(excelImportBatches.sourceSheet, metadata.sourceSheet),
              eq(excelImportBatches.status, existing.status),
              eq(excelImportBatches.parserVersion, existing.parserVersion),
              eq(excelImportBatches.version, confirmation.expectedVersion),
              isNull(excelImportBatches.confirmedBy),
              isNull(excelImportBatches.confirmedAt),
              isNull(excelImportBatches.completedAt)
            )
          )
          .returning();
        if (!updated) {
          throw new Error("guarded preview replacement lost its locked batch");
        }
        await insertRows(existing.id);
        return {
          ok: true,
          outcome: isExpiredReset ? "RESET" : "REFRESH",
          batch: {
            batchId: existing.id,
            status: updated.status,
            rowCounts: {
              total: resolvedSummary.persistedRows,
              sourceReady: resolvedSummary.sourceReadyRows,
              sourceReview: resolvedSummary.sourceReviewRows,
            },
            version: updated.version,
          },
        };
      };

      const existing = await findExactBatchForUpdate();
      if (existing) return handleExisting(existing);

      const previewExpiresAt = new Date(
        metadata.now.getTime() + EXCEL_IMPORT_PREVIEW_RETENTION_MS
      );
      const [inserted] = await tx
        .insert(excelImportBatches)
        .values({
          sourceFileSha256: metadata.sourceFileSha256,
          parserVersion: metadata.parserVersion,
          sourceSheet: metadata.sourceSheet,
          headerFingerprint: metadata.headerFingerprint,
          originalFileName: metadata.originalFileName,
          fileSizeBytes: metadata.fileSizeBytes,
          mimeType: metadata.mimeType,
          status: resolvedBatchStatus,
          summary: resolvedSummary,
          uploadedBy: metadata.uploadedBy,
          uploadedAt: metadata.now,
          confirmedBy: null,
          confirmedAt: null,
          completedAt: null,
          previewExpiresAt,
          sensitiveDataRetainUntil: null,
          sensitiveDataPurgedAt: null,
          sourceFileDeletedAt: null,
          version: 1,
          createdAt: metadata.now,
          updatedAt: metadata.now,
        })
        .onConflictDoNothing({
          target: [excelImportBatches.sourceFileSha256, excelImportBatches.sourceSheet],
        })
        .returning();

      if (!inserted) {
        const raced = await findExactBatchForUpdate();
        if (!raced) throw new Error("exact-file conflict resolved without a batch");
        return handleExisting(raced);
      }

      await insertRows(inserted.id);
      return {
        ok: true,
        outcome: "CREATED",
        batch: {
          batchId: inserted.id,
          status: inserted.status,
          rowCounts: {
            total: resolvedSummary.persistedRows,
            sourceReady: resolvedSummary.sourceReadyRows,
            sourceReview: resolvedSummary.sourceReviewRows,
          },
          version: inserted.version,
        },
      };
    });
  } catch {
    return { ok: false, code: "DATABASE_UNAVAILABLE" };
  }
}
