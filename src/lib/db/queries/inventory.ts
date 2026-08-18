import "server-only";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../client";
import { parts, partStockBalances, stockTransactions, repairCases, users } from "../schema";
import { computeReturnableQuantity } from "@/lib/domain/inventory-return-rules";
import { groupPartOwnerAvailability, type StockOwner, type StockTransactionType } from "@/lib/domain/inventory-types";

/**
 * Phase 5B-2 — read queries for the core inventory ledger. Same convention
 * as procedure-case-execution.ts's query layer: content is always read
 * live, never cached beyond part_stock_balances.current_quantity (whose
 * authoritative source remains stock_transactions — see the mutation
 * layer's stock-balance authority model).
 */

// ---- 부품 재고 목록 (search/filter list) ----

export type PartListRow = {
  id: string;
  partName: string;
  partSpec: string | null;
  kyosanPartNo: string | null;
  drawingNo: string | null;
  category: string | null;
  itemType: string | null;
  version: number;
  totalQuantity: number;
};

export type PartListFilters = {
  search?: string | null;
  owner?: StockOwner | null;
  location?: string | null;
  category?: string | null;
};

/** Search across part_name/part_spec/drawing_no/kyosan_part_no; owner/location filters only affect the aggregated totalQuantity shown (a part with zero matching-bucket stock still lists, with totalQuantity 0). */
export async function getPartList(filters: PartListFilters = {}): Promise<PartListRow[]> {
  const searchTerm = filters.search?.trim();
  const conditions = [eq(parts.isDeleted, false)];
  if (searchTerm) {
    const pattern = `%${searchTerm}%`;
    conditions.push(
      or(
        ilike(parts.partName, pattern),
        ilike(parts.partSpec, pattern),
        ilike(parts.drawingNo, pattern),
        ilike(parts.kyosanPartNo, pattern)
      )!
    );
  }
  if (filters.category) {
    conditions.push(eq(parts.category, filters.category));
  }

  const balanceConditions = [];
  if (filters.owner) balanceConditions.push(eq(partStockBalances.owner, filters.owner));
  if (filters.location) balanceConditions.push(eq(partStockBalances.location, filters.location));

  const rows = await db
    .select({
      id: parts.id,
      partName: parts.partName,
      partSpec: parts.partSpec,
      kyosanPartNo: parts.kyosanPartNo,
      drawingNo: parts.drawingNo,
      category: parts.category,
      itemType: parts.itemType,
      version: parts.version,
      totalQuantity: sql<number>`coalesce(sum(${partStockBalances.currentQuantity}), 0)::int`,
    })
    .from(parts)
    .leftJoin(
      partStockBalances,
      balanceConditions.length > 0 ? and(eq(partStockBalances.partId, parts.id), ...balanceConditions) : eq(partStockBalances.partId, parts.id)
    )
    .where(and(...conditions))
    .groupBy(parts.id)
    .orderBy(parts.partName);

  return rows;
}

export type PartOwnerAvailabilityRow = { partId: string; owner: StockOwner; quantity: number };

/**
 * Parts Request 소유구분-scoped availability checkpoint — per (part, owner)
 * sum of part_stock_balances.current_quantity across every location bucket,
 * the exact same aggregate getPartList's totalQuantity already uses, just
 * grouped one level finer (by owner too, not only by part). A (part, owner)
 * pair with no balance row simply never appears in the result — callers
 * must treat a missing lookup as 0, never as "unknown".
 */
export async function getPartOwnerAvailability(): Promise<PartOwnerAvailabilityRow[]> {
  return db
    .select({
      partId: partStockBalances.partId,
      owner: partStockBalances.owner,
      quantity: sql<number>`coalesce(sum(${partStockBalances.currentQuantity}), 0)::int`,
    })
    .from(partStockBalances)
    .groupBy(partStockBalances.partId, partStockBalances.owner);
}

/** Re-exported for callers already importing from this query module — the actual pure grouping logic lives in inventory-types.ts (framework-free, so it stays unit-testable outside DB integration tests). */
export { groupPartOwnerAvailability };

// ---- 부품 상세 (part detail — master + balance grid) ----

export type PartBalanceRow = {
  id: string;
  owner: StockOwner;
  location: string;
  currentQuantity: number;
  version: number;
};

export type PartDetail = {
  id: string;
  partName: string;
  partSpec: string | null;
  kyosanPartNo: string | null;
  drawingNo: string | null;
  category: string | null;
  itemType: string | null;
  notes: string | null;
  version: number;
  balances: PartBalanceRow[];
};

export async function getPartDetail(partId: string): Promise<PartDetail | null> {
  const [part] = await db.select().from(parts).where(and(eq(parts.id, partId), eq(parts.isDeleted, false)));
  if (!part) return null;

  const balances = await db
    .select({
      id: partStockBalances.id,
      owner: partStockBalances.owner,
      location: partStockBalances.location,
      currentQuantity: partStockBalances.currentQuantity,
      version: partStockBalances.version,
    })
    .from(partStockBalances)
    .where(eq(partStockBalances.partId, partId))
    .orderBy(partStockBalances.owner, partStockBalances.location);

  return {
    id: part.id,
    partName: part.partName,
    partSpec: part.partSpec,
    kyosanPartNo: part.kyosanPartNo,
    drawingNo: part.drawingNo,
    category: part.category,
    itemType: part.itemType,
    notes: part.notes,
    version: part.version,
    balances,
  };
}

// ---- 실행 이력 (transaction history) ----

export type StockTransactionRow = {
  id: string;
  partStockBalanceId: string;
  owner: StockOwner;
  location: string;
  transactionType: StockTransactionType;
  quantityDelta: number;
  resultingQuantity: number;
  repairCaseIntakeNumber: string | null;
  destinationNote: string | null;
  reversalOfId: string | null;
  reason: string | null;
  actorName: string;
  createdAt: string;
};

/** Every transaction across every bucket belonging to one part — newest first. */
export async function getPartTransactionHistory(partId: string): Promise<StockTransactionRow[]> {
  const rows = await db
    .select({
      id: stockTransactions.id,
      partStockBalanceId: stockTransactions.partStockBalanceId,
      owner: partStockBalances.owner,
      location: partStockBalances.location,
      transactionType: stockTransactions.transactionType,
      quantityDelta: stockTransactions.quantityDelta,
      resultingQuantity: stockTransactions.resultingQuantity,
      repairCaseIntakeNumber: repairCases.intakeNumber,
      destinationNote: stockTransactions.destinationNote,
      reversalOfId: stockTransactions.reversalOfId,
      reason: stockTransactions.reason,
      actorName: users.name,
      createdAt: stockTransactions.createdAt,
    })
    .from(stockTransactions)
    .innerJoin(partStockBalances, eq(stockTransactions.partStockBalanceId, partStockBalances.id))
    .innerJoin(users, eq(stockTransactions.actorUserId, users.id))
    .leftJoin(repairCases, eq(stockTransactions.repairCaseId, repairCases.id))
    .where(eq(partStockBalances.partId, partId))
    .orderBy(desc(stockTransactions.createdAt));

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

// ---- 반환 대상 조회 (returnable prior USE transactions, for the RETURN dialog) ----

export type ReturnableUseRow = {
  useTransactionId: string;
  originalQuantity: number;
  returnableQuantity: number;
  repairCaseIntakeNumber: string | null;
  destinationNote: string | null;
  createdAt: string;
};

/** Every USE transaction on one balance that still has a nonzero returnable remainder, newest first. */
export async function getReturnableUseTransactions(partStockBalanceId: string): Promise<ReturnableUseRow[]> {
  const useTransactions = await db
    .select({
      id: stockTransactions.id,
      quantityDelta: stockTransactions.quantityDelta,
      repairCaseIntakeNumber: repairCases.intakeNumber,
      destinationNote: stockTransactions.destinationNote,
      createdAt: stockTransactions.createdAt,
    })
    .from(stockTransactions)
    .leftJoin(repairCases, eq(stockTransactions.repairCaseId, repairCases.id))
    .where(and(eq(stockTransactions.partStockBalanceId, partStockBalanceId), eq(stockTransactions.transactionType, "USE")))
    .orderBy(desc(stockTransactions.createdAt));

  if (useTransactions.length === 0) return [];

  const allReturns = await db
    .select({ reversalOfId: stockTransactions.reversalOfId, quantity: stockTransactions.quantityDelta })
    .from(stockTransactions)
    .where(and(eq(stockTransactions.partStockBalanceId, partStockBalanceId), eq(stockTransactions.transactionType, "RETURN")));

  const returnsByUseId = new Map<string, { quantity: number }[]>();
  for (const r of allReturns) {
    if (!r.reversalOfId) continue;
    const list = returnsByUseId.get(r.reversalOfId) ?? [];
    list.push({ quantity: r.quantity });
    returnsByUseId.set(r.reversalOfId, list);
  }

  return useTransactions
    .map((use) => {
      const originalQuantity = Math.abs(use.quantityDelta);
      const returnableQuantity = computeReturnableQuantity(originalQuantity, returnsByUseId.get(use.id) ?? []);
      return {
        useTransactionId: use.id,
        originalQuantity,
        returnableQuantity,
        repairCaseIntakeNumber: use.repairCaseIntakeNumber,
        destinationNote: use.destinationNote,
        createdAt: use.createdAt.toISOString(),
      };
    })
    .filter((row) => row.returnableQuantity > 0);
}

// ---- 자동완성 (category/item_type suggestions — never blocks a new value) ----

export async function getDistinctCategories(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ category: parts.category })
    .from(parts)
    .where(and(eq(parts.isDeleted, false), sql`${parts.category} is not null`));
  return rows.map((r) => r.category).filter((c): c is string => c !== null).sort();
}

export async function getDistinctItemTypes(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ itemType: parts.itemType })
    .from(parts)
    .where(and(eq(parts.isDeleted, false), sql`${parts.itemType} is not null`));
  return rows.map((r) => r.itemType).filter((t): t is string => t !== null).sort();
}
