import "server-only";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../client";
import { parts, partStockBalances, stockTransactions, inventoryPartRequestItems, repairCases, users } from "../schema";
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
  /** 입출고 이력이나 부품 요청이 걸려 있는가 — 그러면 삭제할 수 없다(listPartIdsWithLedgerHistory 참조). */
  hasLedgerHistory: boolean;
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

  const withHistory = await listPartIdsWithLedgerHistory();
  return rows.map((row) => ({ ...row, hasLedgerHistory: withHistory.has(row.id) }));
}

/**
 * 입출고 이력이나 부품 요청이 한 번이라도 걸린 부품 id.
 *
 * 삭제 가능 여부의 근거다. 부품을 실제로 지우려면 FK 사슬 전체가 비어 있어야
 * 한다:
 *
 *     parts ← part_stock_balances.part_id ← stock_transactions.part_stock_balance_id
 *     parts ← inventory_part_request_items.part_id
 *
 * 셋 다 ON DELETE RESTRICT다. **stock_transactions는 parts를 직접 가리키지
 * 않는다** — 잔량 버킷(part_stock_balances)을 거쳐 이어져 있어서, 이력 여부를
 * 물으려면 그 조인을 타야 한다. 이 사슬에 걸린 부품은 15일 뒤 완전삭제가
 * DB에서 거부되므로, 목록에서 아예 고를 수 없게 하고(체크박스 비활성) 서버도
 * 같은 기준으로 다시 막는다(mutations/inventory.ts의 softDeletePart).
 *
 * 두 질의 모두 부품 단위로 접어서 읽는다 — 행 수가 아니라 **부품 수**만큼만
 * 돌아오므로 이력이 아무리 쌓여도 결과 크기가 부품 목록을 넘지 않는다.
 */
export async function listPartIdsWithLedgerHistory(): Promise<Set<string>> {
  const [transactionRows, requestItemRows] = await Promise.all([
    db
      .select({ partId: partStockBalances.partId })
      .from(stockTransactions)
      .innerJoin(partStockBalances, eq(stockTransactions.partStockBalanceId, partStockBalances.id))
      .groupBy(partStockBalances.partId),
    db
      .select({ partId: inventoryPartRequestItems.partId })
      .from(inventoryPartRequestItems)
      .groupBy(inventoryPartRequestItems.partId),
  ]);

  return new Set([...transactionRows, ...requestItemRows].map((row) => row.partId));
}

export type DeletedPartRow = {
  id: string;
  partName: string;
  partSpec: string | null;
  kyosanPartNo: string | null;
  drawingNo: string | null;
  category: string | null;
  /** 복원·완전삭제의 낙관적 동시성 검사값. parts에는 version 컬럼이 있어 그것을 쓴다(다른 휴지통의 updatedAt 자리). */
  version: number;
  deletedAt: string;
  deletedByUserName: string | null;
  deleteReason: string | null;
};

/**
 * 재고 관리 휴지통 목록. 삭제 권한이 있는 세션에서만 호출된다 — 페이지가
 * 그것을 판정하고, 이 함수는 권한을 보지 않는다(listDeletedCustomers와 같은
 * 역할 분담).
 *
 * 수량은 싣지 않는다. 지울 수 있는 부품은 입출고 이력이 없는 부품이고,
 * 잔량 행(part_stock_balances)은 입고로만 생기므로 여기 오는 부품의 재고는
 * 언제나 0이다 — 0만 나오는 열을 만들어 두면 "재고가 있는데 지워졌나"를
 * 잠깐이라도 의심하게 된다.
 */
export async function listDeletedParts(): Promise<DeletedPartRow[]> {
  const rows = await db
    .select({
      id: parts.id,
      partName: parts.partName,
      partSpec: parts.partSpec,
      kyosanPartNo: parts.kyosanPartNo,
      drawingNo: parts.drawingNo,
      category: parts.category,
      version: parts.version,
      deletedAt: parts.deletedAt,
      deleteReason: parts.deleteReason,
      deletedByUserName: users.name,
    })
    .from(parts)
    // leftJoin이어야 한다 — deleted_by는 nullable이고, inner join이면 삭제자를
    // 알 수 없는 행이 휴지통에서 통째로 사라진다.
    .leftJoin(users, eq(parts.deletedBy, users.id))
    .where(eq(parts.isDeleted, true))
    .orderBy(desc(parts.deletedAt));

  return rows.map((row) => ({
    ...row,
    // is_deleted = true인 행만 여기 온다. softDeletePart는 같은 UPDATE에서
    // deleted_at을 반드시 채운다(다른 휴지통 조회와 같은 근거).
    deletedAt: row.deletedAt!.toISOString(),
  }));
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
  /**
   * 부품 한 개당 작업비(원). **null 은 "정하지 않음"이고 "0"(작업비 없는 부품)과
   * 다르다**(schema/inventory.ts 의 laborCost). 견적서의 작업비가 이 값들의
   * 합이라, 정하지 않은 것을 0 으로 뭉개면 작업비를 실제보다 적게 부르게 된다.
   */
  laborCost: string | null;
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
    laborCost: part.laborCost,
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
