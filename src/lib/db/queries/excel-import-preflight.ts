import "server-only";

import { and, eq } from "drizzle-orm";
import { canManageExcelImports } from "@/lib/auth/excel-import-authorization";
import {
  buildExcelImportIntakeInput,
  intakeYearMonthMismatch,
  missingExcelImportRequiredFields,
  workflowKindFromLegacyProductName,
  type ExcelImportPreflightDisposition,
  type ExcelImportPreflightReason,
} from "@/lib/domain/excel-import-execution";
import { normalizeEntityName } from "@/lib/domain/entity-name-match";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import { deriveWorkflowType, workflowKindOf } from "@/lib/domain/workflow-kind";
import type {
  ExcelImportIssueDto,
  ExcelImportNormalizedCandidateInput,
  ExcelImportRawCellInput,
} from "@/lib/domain/excel-import-preview";
import { db } from "../client";
import {
  customers,
  endUsers,
  excelImportBatches,
  excelImportRows,
  productModels,
  products,
  repairCases,
  users,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";

export type ExcelImportPreflightRow = {
  id: string;
  sourceRowNumber: number;
  rowVersion: number;
  storedStatus: typeof excelImportRows.$inferSelect.importStatus;
  disposition: ExcelImportPreflightDisposition;
  candidate: ExcelImportNormalizedCandidateInput;
  reasons: ExcelImportPreflightReason[];
  intake: IntakeSubmissionInput | null;
  legacyState: {
    apply: boolean;
    targetStepKey: string | null;
    actualShipmentDate: string | null;
  };
  resolved: {
    customerId: string | null;
    endUserId: string | null;
    productModelId: string | null;
    productId: string | null;
    assignedEngineerId: string | null;
    workflowVersionId: string | null;
    workflowStepId: string | null;
  };
  plan: {
    customer: "REUSE" | "CREATE" | null;
    endUser: "REUSE" | "CREATE" | "NONE" | null;
    productModel: "REUSE" | "CREATE" | null;
    product: "REUSE" | "CREATE" | null;
    assignee: "LINK" | "UNASSIGNED";
  };
};

export type ExcelImportPreflightPlan = {
  batch: {
    id: string;
    version: number;
    status: typeof excelImportBatches.$inferSelect.status;
    parserVersion: string;
    fileName: string;
    sourceSheet: string;
    sourceFileDeletedAt: string | null;
  };
  rows: ExcelImportPreflightRow[];
  counts: {
    total: number;
    executable: number;
    autoExcluded: number;
    conflicts: number;
    imported: number;
    failed: number;
    intakeDuplicateInBatch: number;
    intakeDuplicateInDatabase: number;
    assigneeLinked: number;
    assigneeUnassigned: number;
    postImportStatusReview: number;
    legacyStatusApplied: number;
    legacyStatusNotApplied: number;
  };
  entities: {
    customer: { reuse: number; create: number };
    endUser: { reuse: number; create: number };
    productModel: { reuse: number; create: number };
    product: { reuse: number; create: number };
  };
};

export type GetExcelImportPreflightResult =
  | { ok: true; value: ExcelImportPreflightPlan }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_DATA" | "DATABASE_UNAVAILABLE" };

function candidateOf(value: unknown): ExcelImportNormalizedCandidateInput | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as Record<string, unknown>;
  if (!["repair-case-list-normalized-candidate-v1", "repair-case-list-normalized-candidate-v2", "repair-case-list-normalized-candidate-v3"].includes(envelope.schemaVersion as string) || !envelope.candidate || typeof envelope.candidate !== "object") return null;
  return envelope.candidate as ExcelImportNormalizedCandidateInput;
}

function rawOf(value: unknown): Record<string, ExcelImportRawCellInput> | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as Record<string, unknown>;
  if (!["repair-case-list-raw-row-v1", "repair-case-list-raw-row-v2", "repair-case-list-raw-row-v3"].includes(envelope.schemaVersion as string) || !envelope.columns || typeof envelope.columns !== "object") return null;
  return envelope.columns as Record<string, ExcelImportRawCellInput>;
}

function issuesOf(value: unknown): ExcelImportIssueDto[] {
  return Array.isArray(value) ? value.filter((item): item is ExcelImportIssueDto => !!item && typeof item === "object" && typeof (item as ExcelImportIssueDto).code === "string") : [];
}

function sourcePresent(raw: Record<string, ExcelImportRawCellInput>, field: string): boolean {
  const column = ({ intakeNumber: "B", receivedAt: "C", customer: "D", workflowKind: "F", modelName: "G", lotNumber: "H", serialNumber: "J", billingType: "L" } as Record<string, string>)[field];
  return !!column && !!raw[column]?.value?.trim();
}

function addReason(reasons: ExcelImportPreflightReason[], reason: ExcelImportPreflightReason) {
  if (!reasons.some((item) => item.code === reason.code && item.field === reason.field)) reasons.push(reason);
}

function entityTotals(rows: ExcelImportPreflightRow[], field: "customer" | "endUser" | "productModel" | "product") {
  const keys = new Map<string, "REUSE" | "CREATE">();
  for (const row of rows) {
    if (row.disposition !== "EXECUTABLE") continue;
    const mode = row.plan[field];
    if (mode !== "REUSE" && mode !== "CREATE") continue;
    let key = "";
    if (field === "customer") key = normalizeEntityName(row.candidate.customerName!);
    if (field === "endUser") key = `${normalizeEntityName(row.candidate.customerName!)}\u0000${normalizeEntityName(row.candidate.endUserName!)}`;
    if (field === "productModel") key = normalizeEntityName(row.candidate.modelName!);
    if (field === "product") key = `${row.candidate.modelName}\u0000${row.candidate.lotNumber}\u0000${row.candidate.serialNumber}`;
    keys.set(key, mode);
  }
  return {
    reuse: [...keys.values()].filter((value) => value === "REUSE").length,
    create: [...keys.values()].filter((value) => value === "CREATE").length,
  };
}

export async function getExcelImportPreflightPlan(input: {
  batchId: string;
  actorUserId: string;
}): Promise<GetExcelImportPreflightResult> {
  try {
    const [actor] = await db.select({ role: users.role, approvalStatus: users.approvalStatus, isDeleted: users.isDeleted }).from(users).where(eq(users.id, input.actorUserId)).limit(1);
    if (!actor || actor.isDeleted || actor.approvalStatus !== "APPROVED" || !canManageExcelImports(actor.role)) return { ok: false, code: "FORBIDDEN" };
    const [batch] = await db.select().from(excelImportBatches).where(and(eq(excelImportBatches.id, input.batchId), eq(excelImportBatches.uploadedBy, input.actorUserId))).limit(1);
    if (!batch) return { ok: false, code: "NOT_FOUND" };

    const [storedRows, customerRows, endUserRows, modelRows, productRows, intakeRows, engineerRows, workflowRows] = await Promise.all([
      db.select({ id: excelImportRows.id, sourceRowNumber: excelImportRows.sourceRowNumber, version: excelImportRows.version, importStatus: excelImportRows.importStatus, normalizedData: excelImportRows.normalizedData, rawData: excelImportRows.rawData, issues: excelImportRows.issues, resultRepairCaseId: excelImportRows.resultRepairCaseId }).from(excelImportRows).where(eq(excelImportRows.batchId, batch.id)),
      db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.isDeleted, false)),
      db.select({ id: endUsers.id, name: endUsers.name, customerId: endUsers.customerId }).from(endUsers).where(eq(endUsers.isDeleted, false)),
      db.select({ id: productModels.id, modelName: productModels.modelName }).from(productModels).where(eq(productModels.isDeleted, false)),
      db.select({ id: products.id, modelName: products.modelName, lotNumber: products.lotNumber, serialNumber: products.serialNumber, productModelId: products.productModelId, isDeleted: products.isDeleted }).from(products),
      db.select({ intakeNumber: repairCases.intakeNumber }).from(repairCases),
      db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false))),
      db.select({ workflowType: workflowTemplates.code, versionId: workflowVersions.id, stepId: workflowSteps.id, stepKey: workflowSteps.key }).from(workflowTemplates).innerJoin(workflowVersions, and(eq(workflowVersions.workflowTemplateId, workflowTemplates.id), eq(workflowVersions.status, "PUBLISHED"), eq(workflowVersions.isCurrent, true))).innerJoin(workflowSteps, eq(workflowSteps.workflowVersionId, workflowVersions.id)),
    ]);

    const byName = <T extends { name: string }>(values: T[]) => {
      const map = new Map<string, T[]>();
      for (const value of values) map.set(normalizeEntityName(value.name), [...(map.get(normalizeEntityName(value.name)) ?? []), value]);
      return map;
    };
    const customersByName = byName(customerRows);
    const engineersByName = byName(engineerRows);
    const modelsByName = new Map<string, typeof modelRows>();
    for (const row of modelRows) modelsByName.set(normalizeEntityName(row.modelName), [...(modelsByName.get(normalizeEntityName(row.modelName)) ?? []), row]);
    const endUsersByContext = new Map<string, typeof endUserRows>();
    for (const row of endUserRows) {
      const key = `${row.customerId}:${normalizeEntityName(row.name)}`;
      endUsersByContext.set(key, [...(endUsersByContext.get(key) ?? []), row]);
    }
    const productsByTriple = new Map<string, typeof productRows>();
    for (const row of productRows) {
      const key = `${row.modelName}\u0000${row.lotNumber ?? ""}\u0000${row.serialNumber ?? ""}`;
      productsByTriple.set(key, [...(productsByTriple.get(key) ?? []), row]);
    }
    const intakeSet = new Set(intakeRows.map((row) => row.intakeNumber));
    const batchIntakeCounts = new Map<string, number>();
    for (const row of storedRows) {
      const candidate = candidateOf(row.normalizedData);
      if (candidate?.intakeNumber) batchIntakeCounts.set(candidate.intakeNumber, (batchIntakeCounts.get(candidate.intakeNumber) ?? 0) + 1);
    }
    const workflowByType = new Map<string, { versionId: string; steps: Map<string, string> }>();
    for (const row of workflowRows) {
      const entry = workflowByType.get(row.workflowType) ?? { versionId: row.versionId, steps: new Map<string, string>() };
      entry.steps.set(row.stepKey, row.stepId);
      workflowByType.set(row.workflowType, entry);
    }

    const plannedRows: ExcelImportPreflightRow[] = [];
    for (const stored of storedRows.sort((a, b) => a.sourceRowNumber - b.sourceRowNumber)) {
      const candidate = candidateOf(stored.normalizedData);
      const raw = rawOf(stored.rawData);
      if (!candidate || !raw) return { ok: false, code: "INVALID_DATA" };
      const reasons: ExcelImportPreflightReason[] = [];
      if (stored.importStatus === "IMPORTED" && stored.resultRepairCaseId) {
        plannedRows.push({ id: stored.id, sourceRowNumber: stored.sourceRowNumber, rowVersion: stored.version, storedStatus: stored.importStatus, disposition: "IMPORTED", candidate, reasons, intake: null, legacyState: { apply: false, targetStepKey: null, actualShipmentDate: null }, resolved: { customerId: null, endUserId: null, productModelId: null, productId: null, assignedEngineerId: null, workflowVersionId: null, workflowStepId: null }, plan: { customer: null, endUser: null, productModel: null, product: null, assignee: "UNASSIGNED" } });
        continue;
      }

      const missing = missingExcelImportRequiredFields(candidate, raw);
      for (const field of missing) addReason(reasons, { code: `REQUIRED_${field.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}_MISSING`, kind: sourcePresent(raw, field) ? "CONFLICT" : "EXCLUSION", field });
      for (const issue of issuesOf(stored.issues)) {
        if (["STATUS_MAPPING_PENDING", "MULTIPLE_DATES_IN_CELL"].includes(issue.code)) continue;
        if (issue.severity === "REVIEW") addReason(reasons, { code: issue.code, kind: "CONFLICT" });
      }
      if (candidate.intakeNumber && (batchIntakeCounts.get(candidate.intakeNumber) ?? 0) > 1) addReason(reasons, { code: "INTAKE_NUMBER_DUPLICATE_IN_BATCH", kind: "CONFLICT", field: "intakeNumber" });
      if (candidate.intakeNumber && intakeSet.has(candidate.intakeNumber)) addReason(reasons, { code: "INTAKE_NUMBER_DUPLICATE_IN_DATABASE", kind: "CONFLICT", field: "intakeNumber" });
      if (intakeYearMonthMismatch(candidate.intakeNumber, candidate.receivedDate)) addReason(reasons, { code: "INTAKE_RECEIVED_MONTH_MISMATCH", kind: "NOTICE" });
      const customerMatches = candidate.customerName ? customersByName.get(normalizeEntityName(candidate.customerName)) ?? [] : [];
      if (customerMatches.length > 1) addReason(reasons, { code: "CUSTOMER_MULTIPLE_MATCHES", kind: "CONFLICT" });
      const customerId = customerMatches.length === 1 ? customerMatches[0].id : null;
      let endUserId: string | null = null;
      let endUserMode: "REUSE" | "CREATE" | "NONE" | null = candidate.endUserName ? "CREATE" : "NONE";
      if (candidate.endUserName && customerId) {
        const matches = endUsersByContext.get(`${customerId}:${normalizeEntityName(candidate.endUserName)}`) ?? [];
        if (matches.length > 1) addReason(reasons, { code: "END_USER_MULTIPLE_MATCHES", kind: "CONFLICT" });
        if (matches.length === 1) { endUserId = matches[0].id; endUserMode = "REUSE"; }
      }
      const modelMatches = candidate.modelName ? modelsByName.get(normalizeEntityName(candidate.modelName)) ?? [] : [];
      if (modelMatches.length > 1) addReason(reasons, { code: "PRODUCT_MODEL_MULTIPLE_MATCHES", kind: "CONFLICT" });
      const productModelId = modelMatches.length === 1 ? modelMatches[0].id : null;
      const canonicalModelName = modelMatches.length === 1 ? modelMatches[0].modelName : candidate.modelName;
      const productMatches = canonicalModelName && candidate.lotNumber && candidate.serialNumber ? productsByTriple.get(`${canonicalModelName}\u0000${candidate.lotNumber}\u0000${candidate.serialNumber}`) ?? [] : [];
      if (productMatches.length > 1 || productMatches.some((row) => row.isDeleted || (row.productModelId && row.productModelId !== productModelId))) addReason(reasons, { code: "PRODUCT_IDENTITY_CONFLICT", kind: "CONFLICT" });
      const productId = productMatches.length === 1 && !productMatches[0].isDeleted ? productMatches[0].id : null;

      const assigneeText = raw.X?.value?.trim() ?? "";
      const assigneeMatches = assigneeText ? engineersByName.get(normalizeEntityName(assigneeText)) ?? [] : [];
      if (assigneeMatches.length > 1) addReason(reasons, { code: "ASSIGNEE_MULTIPLE_MATCHES", kind: "CONFLICT" });
      const assignedEngineerId = assigneeMatches.length === 1 ? assigneeMatches[0].id : null;
      const kind = workflowKindFromLegacyProductName(candidate.productName);
      const workflowType = kind ? deriveWorkflowType(kind, candidate.billingType) : null;
      if (candidate.productName && !kind) addReason(reasons, { code: "WORKFLOW_KIND_UNRESOLVED", kind: "CONFLICT", field: "workflowKind" });
      const workflow = workflowType ? workflowByType.get(workflowType) : undefined;
      if (workflowType && !workflow) addReason(reasons, { code: "WORKFLOW_NOT_AVAILABLE", kind: "CONFLICT", field: "workflowKind" });
      let targetStepKey: string | null = null;
      if (candidate.legacyDisposition === "COMPLETED") {
        if (candidate.billingType === "PENDING_DECISION") {
          addReason(reasons, { code: "PENDING_COMPLETED_REQUIRES_BILLING", kind: "CONFLICT", field: "billingType" });
        } else {
          targetStepKey = "shipment_completed";
        }
      } else if (candidate.legacyDisposition === "IN_PROGRESS") {
        if (candidate.status === "WAITING_PO") targetStepKey = "waiting_po";
        if (candidate.status === "WAITING_PARTS_SUPPLY") targetStepKey = "parts_supply";
        if (candidate.status === "WAITING_SHIPMENT") targetStepKey = "waiting_shipment";
        if (candidate.status === "WAITING_INTAKE_INSPECTION") targetStepKey = "intake_inspection";
        if (candidate.status === "IN_REPAIR" && workflowType) {
          targetStepKey = workflowKindOf(workflowType) === "MATCHER" ? "repair_in_progress" : "repair_or_defective_parts_replacement";
        }
      }
      if (targetStepKey && workflow && !workflow.steps.has(targetStepKey)) {
        addReason(reasons, { code: "LEGACY_STATUS_NOT_APPLIED", kind: "NOTICE", field: "legacyStatus" });
        targetStepKey = null;
      } else if (candidate.legacyDisposition === "IN_PROGRESS" && !targetStepKey) {
        addReason(reasons, { code: "LEGACY_STATUS_NOT_APPLIED", kind: "NOTICE", field: "legacyStatus" });
      }

      const hasConflict = reasons.some((reason) => reason.kind === "CONFLICT");
      const hasExclusion = reasons.some((reason) => reason.kind === "EXCLUSION");
      const disposition: ExcelImportPreflightDisposition = hasConflict ? "CONFLICT" : hasExclusion ? "AUTO_EXCLUDED" : stored.importStatus === "FAILED" ? "FAILED" : "EXECUTABLE";
      const intake = buildExcelImportIntakeInput({ candidate, rawColumns: raw, customerId, endUserId, productModelId, assignedEngineerId });
      plannedRows.push({
        id: stored.id, sourceRowNumber: stored.sourceRowNumber, rowVersion: stored.version, storedStatus: stored.importStatus, disposition, candidate, reasons, intake,
        legacyState: { apply: !!targetStepKey && targetStepKey !== "intake_inspection", targetStepKey, actualShipmentDate: targetStepKey === "shipment_completed" ? candidate.actualShipmentDate ?? null : null },
        resolved: { customerId, endUserId, productModelId, productId, assignedEngineerId, workflowVersionId: workflow?.versionId ?? null, workflowStepId: targetStepKey && workflow ? workflow.steps.get(targetStepKey) ?? null : workflow?.steps.get("intake_inspection") ?? null },
        plan: { customer: candidate.customerName ? (customerId ? "REUSE" : "CREATE") : null, endUser: endUserMode, productModel: candidate.modelName ? (productModelId ? "REUSE" : "CREATE") : null, product: candidate.modelName && candidate.lotNumber && candidate.serialNumber ? (productId ? "REUSE" : "CREATE") : null, assignee: assignedEngineerId ? "LINK" : "UNASSIGNED" },
      });
    }

    const counts = {
      total: plannedRows.length,
      executable: plannedRows.filter((row) => row.disposition === "EXECUTABLE").length,
      autoExcluded: plannedRows.filter((row) => row.disposition === "AUTO_EXCLUDED").length,
      conflicts: plannedRows.filter((row) => row.disposition === "CONFLICT").length,
      imported: plannedRows.filter((row) => row.disposition === "IMPORTED").length,
      failed: plannedRows.filter((row) => row.disposition === "FAILED").length,
      intakeDuplicateInBatch: plannedRows.filter((row) => row.reasons.some((reason) => reason.code === "INTAKE_NUMBER_DUPLICATE_IN_BATCH")).length,
      intakeDuplicateInDatabase: plannedRows.filter((row) => row.reasons.some((reason) => reason.code === "INTAKE_NUMBER_DUPLICATE_IN_DATABASE")).length,
      assigneeLinked: plannedRows.filter((row) => row.disposition === "EXECUTABLE" && row.plan.assignee === "LINK").length,
      assigneeUnassigned: plannedRows.filter((row) => row.disposition === "EXECUTABLE" && row.plan.assignee === "UNASSIGNED").length,
      postImportStatusReview: plannedRows.filter((row) => row.reasons.some((reason) => reason.code === "POST_IMPORT_STATUS_REVIEW_REQUIRED")).length,
      legacyStatusApplied: plannedRows.filter((row) => row.legacyState.apply).length,
      legacyStatusNotApplied: plannedRows.filter((row) => row.reasons.some((reason) => reason.code === "LEGACY_STATUS_NOT_APPLIED")).length,
    };
    return { ok: true, value: { batch: { id: batch.id, version: batch.version, status: batch.status, parserVersion: batch.parserVersion, fileName: batch.originalFileName, sourceSheet: batch.sourceSheet, sourceFileDeletedAt: batch.sourceFileDeletedAt?.toISOString() ?? null }, rows: plannedRows, counts, entities: { customer: entityTotals(plannedRows, "customer"), endUser: entityTotals(plannedRows, "endUser"), productModel: entityTotals(plannedRows, "productModel"), product: entityTotals(plannedRows, "product") } } };
  } catch {
    return { ok: false, code: "DATABASE_UNAVAILABLE" };
  }
}
