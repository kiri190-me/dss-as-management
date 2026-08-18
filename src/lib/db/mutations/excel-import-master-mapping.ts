import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { canManageExcelImports } from "@/lib/auth/excel-import-authorization";
import {
  EXCEL_IMPORT_MASTER_MAPPING_PARSER_VERSION,
  excelImportMappingGroupKey,
  excelImportMappingSourceFromColumns,
  type ExcelImportMasterMappingType,
} from "@/lib/domain/excel-import-master-mapping";
import { insertAuditLog } from "./audit-logs";
import {
  resolveExistingCustomer,
  resolveExistingEndUser,
  resolveOrCreateCustomerByName,
  resolveOrCreateEndUserByName,
  resolveProductModelSelection,
} from "./intake-master-resolution";
import { db } from "../client";
import {
  customers,
  endUsers,
  excelImportBatches,
  excelImportRows,
  productModels,
  users,
} from "../schema";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUP_KEY_PATTERN = /^[0-9a-f]{64}$/;
const MUTABLE_BATCH_STATUSES = ["PREVIEWED", "REVIEW_REQUIRED", "READY"] as const;

type StoredRow = {
  id: string;
  rawData: Record<string, unknown> | null;
  issues: unknown[];
  decisions: Record<string, unknown> | null;
  customerId: string | null;
  endUserId: string | null;
  productModelId: string | null;
  assignedEngineerId: string | null;
};

export type ExcelImportMasterMappingResult =
  | {
      ok: true;
      batchId: string;
      version: number;
      affectedRows: number;
      counts: { ready: number; review: number; mappingPending: number; error: number };
    }
  | {
      ok: false;
      code:
        | "INVALID_INPUT"
        | "ACTOR_NOT_ALLOWED"
        | "BATCH_NOT_FOUND"
        | "BATCH_NOT_MUTABLE"
        | "PARSER_VERSION_NOT_SUPPORTED"
        | "STALE_BATCH_VERSION"
        | "GROUP_NOT_FOUND"
        | "TARGET_NOT_FOUND"
        | "RELATION_CONFLICT"
        | "DATABASE_UNAVAILABLE";
    };

export type ConfirmExcelImportMasterPlanResult =
  | {
      ok: true;
      batchId: string;
      version: number;
      affectedRows: number;
      plan: {
        customers: { reused: number; created: number };
        endUsers: { reused: number; created: number };
        productModels: { reused: number; created: number };
      };
      counts: { ready: number; review: number; mappingPending: number; error: number };
    }
  | {
      ok: false;
      code:
        | "INVALID_INPUT"
        | "ACTOR_NOT_ALLOWED"
        | "BATCH_NOT_FOUND"
        | "BATCH_NOT_MUTABLE"
        | "PARSER_VERSION_NOT_SUPPORTED"
        | "STALE_BATCH_VERSION"
        | "PLAN_CONFLICT"
        | "TARGET_NOT_FOUND"
        | "RELATION_CONFLICT"
        | "DATABASE_UNAVAILABLE";
    };

function rawColumns(value: Record<string, unknown> | null): Record<string, { value: string | null }> | null {
  if (!value || !["repair-case-list-raw-row-v1", "repair-case-list-raw-row-v2", "repair-case-list-raw-row-v3"].includes(value.schemaVersion as string) || !value.columns || typeof value.columns !== "object") return null;
  const result: Record<string, { value: string | null }> = {};
  for (const [column, cell] of Object.entries(value.columns as Record<string, unknown>)) {
    if (!cell || typeof cell !== "object") continue;
    const candidate = cell as Record<string, unknown>;
    if (candidate.value === null || typeof candidate.value === "string") result[column] = { value: candidate.value as string | null };
  }
  return result;
}

function safeIssues(value: unknown[]): Array<{ code: string; severity: "WARNING" | "REVIEW" }> {
  return value.flatMap((issue) => {
    if (!issue || typeof issue !== "object") return [];
    const row = issue as Record<string, unknown>;
    if (typeof row.code !== "string" || (row.severity !== "WARNING" && row.severity !== "REVIEW")) return [];
    return [{ code: row.code, severity: row.severity }];
  });
}

function classify(row: StoredRow): "READY" | "REVIEW" | "MAPPING_PENDING" | "ERROR" {
  const columns = rawColumns(row.rawData);
  if (!columns) return "ERROR";
  const source = excelImportMappingSourceFromColumns(columns);
  const issues = safeIssues(row.issues);
  const review = issues.some((issue) =>
    issue.severity === "REVIEW" &&
    !(issue.code === "ASSIGNEE_MULTIPLE_MATCHES" && row.assignedEngineerId)
  );
  if (review) return "REVIEW";
  const masterPending =
    (!!source.customer && !row.customerId) ||
    (!!source.endUser && !row.endUserId) ||
    (!!source.model && !row.productModelId) ||
    (!!source.assignee && !row.assignedEngineerId);
  const otherPending = issues.some((issue) =>
    issue.severity === "WARNING" &&
    issue.code.endsWith("_MAPPING_PENDING") &&
    !["CUSTOMER_MAPPING_PENDING", "END_USER_MAPPING_PENDING", "PRODUCT_MODEL_MAPPING_PENDING", "ASSIGNEE_MAPPING_PENDING"].includes(issue.code)
  );
  return masterPending || otherPending ? "MAPPING_PENDING" : "READY";
}

function mappingValue(type: ExcelImportMasterMappingType, targetId: string | null) {
  if (type === "CUSTOMER") return { customerId: targetId };
  if (type === "END_USER") return { endUserId: targetId };
  if (type === "PRODUCT_MODEL") return { productModelId: targetId };
  return { assignedEngineerId: targetId };
}

function withTarget(row: StoredRow, type: ExcelImportMasterMappingType, targetId: string | null): StoredRow {
  if (type === "CUSTOMER") return { ...row, customerId: targetId };
  if (type === "END_USER") return { ...row, endUserId: targetId };
  if (type === "PRODUCT_MODEL") return { ...row, productModelId: targetId };
  return { ...row, assignedEngineerId: targetId };
}

export async function applyExcelImportMasterMapping(input: {
  batchId: string;
  actorUserId: string;
  expectedBatchVersion: number;
  type: ExcelImportMasterMappingType;
  groupKey: string;
  targetId: string | null;
}): Promise<ExcelImportMasterMappingResult> {
  if (
    !UUID_PATTERN.test(input.batchId) ||
    !UUID_PATTERN.test(input.actorUserId) ||
    !Number.isInteger(input.expectedBatchVersion) ||
    input.expectedBatchVersion < 1 ||
    !["CUSTOMER", "END_USER", "PRODUCT_MODEL", "ASSIGNEE"].includes(input.type) ||
    !GROUP_KEY_PATTERN.test(input.groupKey) ||
    (input.targetId !== null && !UUID_PATTERN.test(input.targetId))
  ) return { ok: false, code: "INVALID_INPUT" };

  try {
    return await db.transaction(async (tx): Promise<ExcelImportMasterMappingResult> => {
      const [actor] = await tx.select({ role: users.role, approvalStatus: users.approvalStatus, isDeleted: users.isDeleted })
        .from(users).where(eq(users.id, input.actorUserId)).limit(1);
      if (!actor || actor.isDeleted || actor.approvalStatus !== "APPROVED" || !canManageExcelImports(actor.role)) {
        return { ok: false, code: "ACTOR_NOT_ALLOWED" };
      }
      const [batch] = await tx.select().from(excelImportBatches)
        .where(and(eq(excelImportBatches.id, input.batchId), eq(excelImportBatches.uploadedBy, input.actorUserId)))
        .for("update");
      if (!batch) return { ok: false, code: "BATCH_NOT_FOUND" };
      if (batch.version !== input.expectedBatchVersion) return { ok: false, code: "STALE_BATCH_VERSION" };
      if (batch.parserVersion !== EXCEL_IMPORT_MASTER_MAPPING_PARSER_VERSION) return { ok: false, code: "PARSER_VERSION_NOT_SUPPORTED" };
      if (!MUTABLE_BATCH_STATUSES.includes(batch.status as (typeof MUTABLE_BATCH_STATUSES)[number]) || batch.confirmedAt) {
        return { ok: false, code: "BATCH_NOT_MUTABLE" };
      }

      const rows = await tx.select({
        id: excelImportRows.id, rawData: excelImportRows.rawData, issues: excelImportRows.issues,
        decisions: excelImportRows.decisions, customerId: excelImportRows.customerId,
        endUserId: excelImportRows.endUserId, productModelId: excelImportRows.productModelId,
        assignedEngineerId: excelImportRows.assignedEngineerId,
      }).from(excelImportRows).where(eq(excelImportRows.batchId, batch.id)).for("update") as StoredRow[];
      const affected = rows.filter((row) => {
        const columns = rawColumns(row.rawData);
        return columns && excelImportMappingGroupKey(input.type, excelImportMappingSourceFromColumns(columns)) === input.groupKey;
      });
      if (affected.length === 0) return { ok: false, code: "GROUP_NOT_FOUND" };

      if (input.targetId) {
        if (input.type === "CUSTOMER") {
          const [target] = await tx.select({ id: customers.id }).from(customers)
            .where(and(eq(customers.id, input.targetId), eq(customers.isDeleted, false))).for("update");
          if (!target) return { ok: false, code: "TARGET_NOT_FOUND" };
        } else if (input.type === "END_USER") {
          const [target] = await tx.select({ id: endUsers.id, customerId: endUsers.customerId }).from(endUsers)
            .where(and(eq(endUsers.id, input.targetId), eq(endUsers.isDeleted, false))).for("update");
          if (!target) return { ok: false, code: "TARGET_NOT_FOUND" };
          if (affected.some((row) => !row.customerId || row.customerId !== target.customerId)) {
            return { ok: false, code: "RELATION_CONFLICT" };
          }
        } else if (input.type === "PRODUCT_MODEL") {
          const [target] = await tx.select({ id: productModels.id }).from(productModels)
            .where(and(eq(productModels.id, input.targetId), eq(productModels.isDeleted, false))).for("update");
          if (!target) return { ok: false, code: "TARGET_NOT_FOUND" };
        } else {
          const [target] = await tx.select({ id: users.id }).from(users).where(and(
            eq(users.id, input.targetId), eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"),
            eq(users.isDeleted, false)
          )).for("update");
          if (!target) return { ok: false, code: "TARGET_NOT_FOUND" };
        }
      }
      if (input.type === "CUSTOMER") {
        const linkedEndUserIds = [...new Set(affected.map((row) => row.endUserId).filter((id): id is string => !!id))];
        if (linkedEndUserIds.length > 0) {
          if (!input.targetId) return { ok: false, code: "RELATION_CONFLICT" };
          const linkedEndUsers = await tx.select({ id: endUsers.id, customerId: endUsers.customerId })
            .from(endUsers).where(inArray(endUsers.id, linkedEndUserIds)).for("update");
          if (linkedEndUsers.length !== linkedEndUserIds.length || linkedEndUsers.some((row) => row.customerId !== input.targetId)) {
            return { ok: false, code: "RELATION_CONFLICT" };
          }
        }
      }

      const decisionKey = input.type === "CUSTOMER" ? "customer" : input.type === "END_USER" ? "endUser" : input.type === "PRODUCT_MODEL" ? "productModel" : "assignee";
      const simulated = rows.map((row) => affected.some((item) => item.id === row.id) ? withTarget(row, input.type, input.targetId) : row);
      const classifications = new Map(simulated.map((row) => [row.id, classify(row)]));
      const updateGroups = new Map<string, { classification: "READY" | "REVIEW" | "MAPPING_PENDING" | "ERROR"; decisions: Record<string, unknown>; ids: string[] }>();
      for (const row of affected) {
        const decisions: Record<string, unknown> = { schemaVersion: "excel-import-master-mapping-v1" };
        for (const key of ["customer", "endUser", "productModel", "assignee"] as const) {
          const value = row.decisions?.[key];
          if (value === "AUTO_EXACT" || value === "MANUAL" || value === "CLEARED") decisions[key] = value;
        }
        decisions[decisionKey] = input.targetId ? "MANUAL" : "CLEARED";
        const classification = classifications.get(row.id) ?? "ERROR";
        const key = `${classification}:${JSON.stringify(decisions)}`;
        const group = updateGroups.get(key) ?? { classification, decisions, ids: [] };
        group.ids.push(row.id);
        updateGroups.set(key, group);
      }
      for (const group of updateGroups.values()) {
        await tx.update(excelImportRows).set({
          ...mappingValue(input.type, input.targetId),
          decisions: group.decisions,
          sourceClassification: group.classification === "REVIEW" ? "SOURCE_REVIEW" : "SOURCE_READY",
          importStatus: group.classification === "REVIEW" ? "PENDING_REVIEW" : group.classification === "READY" ? "IMPORT_READY" : "MAPPING_REQUIRED",
          version: sql`${excelImportRows.version} + 1`, updatedAt: new Date(),
        }).where(inArray(excelImportRows.id, group.ids));
      }
      const counts = {
        ready: [...classifications.values()].filter((value) => value === "READY").length,
        review: [...classifications.values()].filter((value) => value === "REVIEW").length,
        mappingPending: [...classifications.values()].filter((value) => value === "MAPPING_PENDING").length,
        error: [...classifications.values()].filter((value) => value === "ERROR").length,
      };
      const nextStatus = counts.review > 0 ? "REVIEW_REQUIRED" : counts.mappingPending > 0 || counts.error > 0 ? "PREVIEWED" : "READY";
      const [updatedBatch] = await tx.update(excelImportBatches).set({ status: nextStatus, version: sql`${excelImportBatches.version} + 1`, updatedAt: new Date() })
        .where(and(eq(excelImportBatches.id, batch.id), eq(excelImportBatches.version, input.expectedBatchVersion)))
        .returning({ version: excelImportBatches.version });
      if (!updatedBatch) return { ok: false, code: "STALE_BATCH_VERSION" };
      await insertAuditLog(tx, {
        actorUserId: input.actorUserId, actionType: "EXCEL_IMPORT", targetEntity: "excel_import_batches",
        targetRecordId: batch.id, previousValue: null,
        newValue: { operation: "MASTER_MAPPING", mappingType: input.type, affectedRows: affected.length, connected: input.targetId !== null },
      });
      return { ok: true, batchId: batch.id, version: updatedBatch.version, affectedRows: affected.length, counts };
    });
  } catch {
    return { ok: false, code: "DATABASE_UNAVAILABLE" };
  }
}

/**
 * Confirms the batch-wide relationship plan. Customer and End-User use the
 * exact same lookup-or-create functions as normal intake; Product Model is
 * global and keyed only by G. F remains untouched in raw/normalized JSON.
 */
export async function confirmExcelImportMasterPlan(input: {
  batchId: string;
  actorUserId: string;
  expectedBatchVersion: number;
}): Promise<ConfirmExcelImportMasterPlanResult> {
  if (!UUID_PATTERN.test(input.batchId) || !UUID_PATTERN.test(input.actorUserId) ||
    !Number.isInteger(input.expectedBatchVersion) || input.expectedBatchVersion < 1) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  try {
    return await db.transaction(async (tx): Promise<ConfirmExcelImportMasterPlanResult> => {
      const [actor] = await tx.select({ role: users.role, approvalStatus: users.approvalStatus, isDeleted: users.isDeleted })
        .from(users).where(eq(users.id, input.actorUserId)).limit(1);
      if (!actor || actor.isDeleted || actor.approvalStatus !== "APPROVED" || !canManageExcelImports(actor.role)) {
        return { ok: false, code: "ACTOR_NOT_ALLOWED" };
      }
      const [batch] = await tx.select().from(excelImportBatches)
        .where(and(eq(excelImportBatches.id, input.batchId), eq(excelImportBatches.uploadedBy, input.actorUserId)))
        .for("update");
      if (!batch) return { ok: false, code: "BATCH_NOT_FOUND" };
      if (batch.version !== input.expectedBatchVersion) return { ok: false, code: "STALE_BATCH_VERSION" };
      if (batch.parserVersion !== EXCEL_IMPORT_MASTER_MAPPING_PARSER_VERSION) return { ok: false, code: "PARSER_VERSION_NOT_SUPPORTED" };
      if (!MUTABLE_BATCH_STATUSES.includes(batch.status as (typeof MUTABLE_BATCH_STATUSES)[number]) || batch.confirmedAt) {
        return { ok: false, code: "BATCH_NOT_MUTABLE" };
      }

      const rows = await tx.select({
        id: excelImportRows.id, rawData: excelImportRows.rawData, issues: excelImportRows.issues,
        decisions: excelImportRows.decisions, customerId: excelImportRows.customerId,
        endUserId: excelImportRows.endUserId, productModelId: excelImportRows.productModelId,
        assignedEngineerId: excelImportRows.assignedEngineerId,
      }).from(excelImportRows).where(eq(excelImportRows.batchId, batch.id)).for("update") as StoredRow[];

      const sources = new Map<string, ReturnType<typeof excelImportMappingSourceFromColumns>>();
      for (const row of rows) {
        const columns = rawColumns(row.rawData);
        if (!columns) return { ok: false, code: "PLAN_CONFLICT" };
        sources.set(row.id, excelImportMappingSourceFromColumns(columns));
      }
      const planned = new Map(rows.map((row) => [row.id, { ...row }]));
      const plan = {
        customers: { reused: 0, created: 0 },
        endUsers: { reused: 0, created: 0 },
        productModels: { reused: 0, created: 0 },
      };

      const customerGroups = new Map<string, StoredRow[]>();
      for (const row of rows) {
        const source = sources.get(row.id)!;
        const key = excelImportMappingGroupKey("CUSTOMER", source);
        if (!key) continue;
        customerGroups.set(key, [...(customerGroups.get(key) ?? []), row]);
      }
      for (const group of customerGroups.values()) {
        const source = sources.get(group[0].id)!;
        const selected = [...new Set(group.map((row) => row.customerId).filter((id): id is string => !!id))];
        if (selected.length > 1) return { ok: false, code: "PLAN_CONFLICT" };
        const resolution = selected.length === 1
          ? await resolveExistingCustomer(tx, selected[0])
          : await resolveOrCreateCustomerByName(tx, source.customer!);
        if (!resolution.ok) return { ok: false, code: "TARGET_NOT_FOUND" };
        plan.customers[resolution.origin === "CREATED" ? "created" : "reused"] += 1;
        for (const row of group) planned.set(row.id, { ...planned.get(row.id)!, customerId: resolution.customerId });
      }

      const endUserGroups = new Map<string, StoredRow[]>();
      for (const row of rows) {
        const source = sources.get(row.id)!;
        const key = excelImportMappingGroupKey("END_USER", source);
        if (!key) continue;
        endUserGroups.set(key, [...(endUserGroups.get(key) ?? []), row]);
      }
      for (const group of endUserGroups.values()) {
        const source = sources.get(group[0].id)!;
        const customerIds = [...new Set(group.map((row) => planned.get(row.id)?.customerId).filter((id): id is string => !!id))];
        if (customerIds.length !== 1) return { ok: false, code: "RELATION_CONFLICT" };
        const selected = [...new Set(group.map((row) => row.endUserId).filter((id): id is string => !!id))];
        if (selected.length > 1) return { ok: false, code: "PLAN_CONFLICT" };
        const resolution = selected.length === 1
          ? await resolveExistingEndUser(tx, selected[0], customerIds[0])
          : await resolveOrCreateEndUserByName(tx, source.endUser!, customerIds[0]);
        if (!resolution.ok) return { ok: false, code: resolution.result.code === "REFERENCE_MISMATCH" ? "RELATION_CONFLICT" : "TARGET_NOT_FOUND" };
        plan.endUsers[resolution.origin === "CREATED" ? "created" : "reused"] += 1;
        for (const row of group) planned.set(row.id, { ...planned.get(row.id)!, endUserId: resolution.endUserId });
      }

      const modelGroups = new Map<string, StoredRow[]>();
      for (const row of rows) {
        const source = sources.get(row.id)!;
        const key = excelImportMappingGroupKey("PRODUCT_MODEL", source);
        if (!key) continue;
        modelGroups.set(key, [...(modelGroups.get(key) ?? []), row]);
      }
      for (const group of modelGroups.values()) {
        const source = sources.get(group[0].id)!;
        const selected = [...new Set(group.map((row) => row.productModelId).filter((id): id is string => !!id))];
        if (selected.length > 1) return { ok: false, code: "PLAN_CONFLICT" };
        const resolution = await resolveProductModelSelection(tx, selected.length === 1
          ? { productModelId: selected[0], newProductModelName: null }
          : { productModelId: null, newProductModelName: source.model });
        if (!resolution.ok) return { ok: false, code: resolution.code === "REFERENCE_NOT_FOUND" ? "TARGET_NOT_FOUND" : "PLAN_CONFLICT" };
        plan.productModels[resolution.origin === "CREATED" ? "created" : "reused"] += 1;
        for (const row of group) planned.set(row.id, { ...planned.get(row.id)!, productModelId: resolution.productModelId });
      }

      const classifications = new Map([...planned].map(([id, row]) => [id, classify(row)]));
      for (const row of rows) {
        const next = planned.get(row.id)!;
        const classification = classifications.get(row.id) ?? "ERROR";
        const decisions: Record<string, unknown> = { ...(row.decisions ?? {}), schemaVersion: "excel-import-master-mapping-v2" };
        if (next.customerId) decisions.customer = row.customerId ? (row.decisions?.customer ?? "AUTO_EXACT") : "PLAN_CONFIRMED";
        if (next.endUserId) decisions.endUser = row.endUserId ? (row.decisions?.endUser ?? "AUTO_EXACT") : "PLAN_CONFIRMED";
        if (next.productModelId) decisions.productModel = row.productModelId ? (row.decisions?.productModel ?? "AUTO_EXACT") : "PLAN_CONFIRMED";
        await tx.update(excelImportRows).set({
          customerId: next.customerId, endUserId: next.endUserId, productModelId: next.productModelId,
          decisions,
          sourceClassification: classification === "REVIEW" ? "SOURCE_REVIEW" : "SOURCE_READY",
          importStatus: classification === "REVIEW" ? "PENDING_REVIEW" : classification === "READY" ? "IMPORT_READY" : "MAPPING_REQUIRED",
          version: sql`${excelImportRows.version} + 1`, updatedAt: new Date(),
        }).where(eq(excelImportRows.id, row.id));
      }
      const counts = {
        ready: [...classifications.values()].filter((value) => value === "READY").length,
        review: [...classifications.values()].filter((value) => value === "REVIEW").length,
        mappingPending: [...classifications.values()].filter((value) => value === "MAPPING_PENDING").length,
        error: [...classifications.values()].filter((value) => value === "ERROR").length,
      };
      const nextStatus = counts.review > 0 ? "REVIEW_REQUIRED" : counts.mappingPending > 0 || counts.error > 0 ? "PREVIEWED" : "READY";
      const [updatedBatch] = await tx.update(excelImportBatches).set({ status: nextStatus, version: sql`${excelImportBatches.version} + 1`, updatedAt: new Date() })
        .where(and(eq(excelImportBatches.id, batch.id), eq(excelImportBatches.version, input.expectedBatchVersion)))
        .returning({ version: excelImportBatches.version });
      if (!updatedBatch) return { ok: false, code: "STALE_BATCH_VERSION" };
      await insertAuditLog(tx, {
        actorUserId: input.actorUserId, actionType: "EXCEL_IMPORT", targetEntity: "excel_import_batches", targetRecordId: batch.id,
        previousValue: null, newValue: { operation: "MASTER_PLAN_CONFIRMED", affectedRows: rows.length, plan },
      });
      return { ok: true, batchId: batch.id, version: updatedBatch.version, affectedRows: rows.length, plan, counts };
    });
  } catch {
    return { ok: false, code: "DATABASE_UNAVAILABLE" };
  }
}
