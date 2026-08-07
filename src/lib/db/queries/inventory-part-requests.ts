import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import {
  inventoryPartRequests,
  inventoryPartRequestItems,
  inventoryPartRequestIssues,
  inventoryPartRequestHistory,
  parts,
  partStockBalances,
  stockTransactions,
  repairCases,
  customers,
  products,
  users,
} from "../schema";
import type { InventoryPartRequestActionType, InventoryPartRequestStatus, StockOwner } from "@/lib/domain/inventory-types";

/**
 * Phase 5B-3 — read queries for the Parts Request & Issue Workflow. Always
 * read live, same convention as inventory queries.ts — availability shown
 * here is informational only (plan §12): the issue mutation re-checks
 * everything live, under lock, independently.
 */

export type PartRequestItemRow = {
  id: string;
  partId: string;
  partName: string;
  partSpec: string | null;
  requestedQuantity: number;
  issuedQuantity: number;
  note: string | null;
  totalAvailableQuantity: number;
};

async function attachItemsWithAvailability(requestIds: string[]): Promise<Map<string, PartRequestItemRow[]>> {
  if (requestIds.length === 0) return new Map();

  const items = await db
    .select({
      id: inventoryPartRequestItems.id,
      requestId: inventoryPartRequestItems.requestId,
      partId: inventoryPartRequestItems.partId,
      partName: parts.partName,
      partSpec: parts.partSpec,
      requestedQuantity: inventoryPartRequestItems.requestedQuantity,
      issuedQuantity: inventoryPartRequestItems.issuedQuantity,
      note: inventoryPartRequestItems.note,
    })
    .from(inventoryPartRequestItems)
    .innerJoin(parts, eq(inventoryPartRequestItems.partId, parts.id))
    .where(inArray(inventoryPartRequestItems.requestId, requestIds));

  const partIds = [...new Set(items.map((i) => i.partId))];
  const availability =
    partIds.length === 0
      ? []
      : await db
          .select({ partId: partStockBalances.partId, total: sql<number>`coalesce(sum(${partStockBalances.currentQuantity}), 0)::int` })
          .from(partStockBalances)
          .where(inArray(partStockBalances.partId, partIds))
          .groupBy(partStockBalances.partId);
  const availabilityByPart = new Map(availability.map((a) => [a.partId, a.total]));

  const byRequest = new Map<string, PartRequestItemRow[]>();
  for (const item of items) {
    const row: PartRequestItemRow = {
      id: item.id,
      partId: item.partId,
      partName: item.partName,
      partSpec: item.partSpec,
      requestedQuantity: item.requestedQuantity,
      issuedQuantity: item.issuedQuantity,
      note: item.note,
      totalAvailableQuantity: availabilityByPart.get(item.partId) ?? 0,
    };
    const list = byRequest.get(item.requestId) ?? [];
    list.push(row);
    byRequest.set(item.requestId, list);
  }
  return byRequest;
}

// ---- 부품 요청 관리 (inventory-manager list) ----

export type ManagerPartRequestRow = {
  id: string;
  createdAt: string;
  status: InventoryPartRequestStatus;
  note: string | null;
  version: number;
  repairCaseId: string;
  intakeNumber: string;
  customerName: string;
  modelName: string;
  serialNumber: string;
  requestedByName: string;
  isCaseLocked: boolean;
  items: PartRequestItemRow[];
};

/** Every request across every repair case — the manager screen filters/sorts client-side over this full list (small real catalog, same convention as getPartList). */
export async function getPartRequestsForManager(): Promise<ManagerPartRequestRow[]> {
  const rows = await db
    .select({
      id: inventoryPartRequests.id,
      createdAt: inventoryPartRequests.createdAt,
      status: inventoryPartRequests.status,
      note: inventoryPartRequests.note,
      version: inventoryPartRequests.version,
      repairCaseId: inventoryPartRequests.repairCaseId,
      intakeNumber: repairCases.intakeNumber,
      isCaseLocked: repairCases.isLocked,
      customerName: customers.name,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
      requestedByName: users.name,
    })
    .from(inventoryPartRequests)
    .innerJoin(repairCases, eq(inventoryPartRequests.repairCaseId, repairCases.id))
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .leftJoin(products, eq(repairCases.productId, products.id))
    .innerJoin(users, eq(inventoryPartRequests.requestedByUserId, users.id))
    .orderBy(desc(inventoryPartRequests.createdAt));

  const itemsByRequest = await attachItemsWithAvailability(rows.map((r) => r.id));

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    status: r.status,
    note: r.note,
    version: r.version,
    repairCaseId: r.repairCaseId,
    intakeNumber: r.intakeNumber,
    customerName: r.customerName,
    modelName: r.modelName ?? "-",
    serialNumber: r.serialNumber ?? "-",
    requestedByName: r.requestedByName,
    isCaseLocked: r.isCaseLocked,
    items: itemsByRequest.get(r.id) ?? [],
  }));
}

// ---- 내 요청 (AS_ENGINEER's own requests for one repair case) ----

export type OwnPartRequestRow = {
  id: string;
  createdAt: string;
  status: InventoryPartRequestStatus;
  note: string | null;
  version: number;
  items: PartRequestItemRow[];
};

export async function getOwnPartRequestsForCase(repairCaseId: string, requestedByUserId: string): Promise<OwnPartRequestRow[]> {
  const rows = await db
    .select({
      id: inventoryPartRequests.id,
      createdAt: inventoryPartRequests.createdAt,
      status: inventoryPartRequests.status,
      note: inventoryPartRequests.note,
      version: inventoryPartRequests.version,
    })
    .from(inventoryPartRequests)
    .where(and(eq(inventoryPartRequests.repairCaseId, repairCaseId), eq(inventoryPartRequests.requestedByUserId, requestedByUserId)))
    .orderBy(desc(inventoryPartRequests.createdAt));

  const itemsByRequest = await attachItemsWithAvailability(rows.map((r) => r.id));

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    status: r.status,
    note: r.note,
    version: r.version,
    items: itemsByRequest.get(r.id) ?? [],
  }));
}

// ---- 요청 대상 수리 건 컨텍스트 (create-request gating) ----

export type RequestCaseContext = { id: string; isLocked: boolean; assignedEngineerId: string | null };

export async function getRequestCaseContext(repairCaseId: string): Promise<RequestCaseContext | null> {
  const [row] = await db
    .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId })
    .from(repairCases)
    .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));
  return row ?? null;
}

// ---- 불출 대상 재고 버킷 (issue dialog: concrete owner/location balances for one part) ----

export type IssuableBalanceRow = { id: string; partId: string; owner: StockOwner; location: string; currentQuantity: number; version: number };

export async function getIssuableBalancesForPart(partId: string): Promise<IssuableBalanceRow[]> {
  return db
    .select({
      id: partStockBalances.id,
      partId: partStockBalances.partId,
      owner: partStockBalances.owner,
      location: partStockBalances.location,
      currentQuantity: partStockBalances.currentQuantity,
      version: partStockBalances.version,
    })
    .from(partStockBalances)
    .where(and(eq(partStockBalances.partId, partId), sql`${partStockBalances.currentQuantity} > 0`))
    .orderBy(partStockBalances.owner, partStockBalances.location);
}

/** Batch form of getIssuableBalancesForPart — one query for every part referenced across the manager's whole request list, grouped by partId, rather than N queries. */
export async function getIssuableBalancesForParts(partIds: string[]): Promise<Map<string, IssuableBalanceRow[]>> {
  if (partIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: partStockBalances.id,
      partId: partStockBalances.partId,
      owner: partStockBalances.owner,
      location: partStockBalances.location,
      currentQuantity: partStockBalances.currentQuantity,
      version: partStockBalances.version,
    })
    .from(partStockBalances)
    .where(and(inArray(partStockBalances.partId, [...new Set(partIds)]), sql`${partStockBalances.currentQuantity} > 0`))
    .orderBy(partStockBalances.owner, partStockBalances.location);

  const byPart = new Map<string, IssuableBalanceRow[]>();
  for (const row of rows) {
    const list = byPart.get(row.partId) ?? [];
    list.push(row);
    byPart.set(row.partId, list);
  }
  return byPart;
}

// ---- 요청 이력 (traceability — lifecycle history for one request) ----

export type PartRequestHistoryRow = {
  id: string;
  actionType: InventoryPartRequestActionType;
  reason: string | null;
  actorName: string;
  createdAt: string;
};

export async function getPartRequestHistory(requestId: string): Promise<PartRequestHistoryRow[]> {
  const rows = await db
    .select({
      id: inventoryPartRequestHistory.id,
      actionType: inventoryPartRequestHistory.actionType,
      reason: inventoryPartRequestHistory.reason,
      actorName: users.name,
      createdAt: inventoryPartRequestHistory.createdAt,
    })
    .from(inventoryPartRequestHistory)
    .innerJoin(users, eq(inventoryPartRequestHistory.actorUserId, users.id))
    .where(eq(inventoryPartRequestHistory.requestId, requestId))
    .orderBy(desc(inventoryPartRequestHistory.createdAt));

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** Forward+reverse traceability: every stock_transactions USE row produced by one issue event. Joined lazily via inventoryPartRequestIssues.id — kept here rather than in inventory.ts's query module since it's request-workflow-specific. */
export async function getIssueEventStockMovements(requestIssueId: string) {
  return db
    .select({
      id: stockTransactions.id,
      partStockBalanceId: stockTransactions.partStockBalanceId,
      owner: partStockBalances.owner,
      location: partStockBalances.location,
      quantityDelta: stockTransactions.quantityDelta,
      resultingQuantity: stockTransactions.resultingQuantity,
      requestItemId: stockTransactions.requestItemId,
    })
    .from(stockTransactions)
    .innerJoin(partStockBalances, eq(stockTransactions.partStockBalanceId, partStockBalances.id))
    .where(eq(stockTransactions.requestIssueId, requestIssueId));
}

/** Confirms an issue event exists and belongs to the expected request — used by manager UI detail views, not by the mutation layer (which re-verifies independently). */
export async function getRequestIssueEvent(requestIssueId: string) {
  const [row] = await db
    .select({ id: inventoryPartRequestIssues.id, requestId: inventoryPartRequestIssues.requestId, note: inventoryPartRequestIssues.note, createdAt: inventoryPartRequestIssues.createdAt })
    .from(inventoryPartRequestIssues)
    .where(eq(inventoryPartRequestIssues.id, requestIssueId));
  return row ?? null;
}
