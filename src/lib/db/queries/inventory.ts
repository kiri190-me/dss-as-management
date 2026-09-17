import "server-only";
import { and, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../client";
import {
  parts,
  partStockBalances,
  partUnitPrices,
  partOverhaulUnitPrices,
  stockTransactions,
  inventoryPartRequestItems,
  repairCases,
  users,
} from "../schema";
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

// ---- 부품 고르기 목록 (견적서의 품명 칸이 쓰는 가벼운 형제) ----

/**
 * 부품을 **알아보는 데 필요한 것만** 담은 한 줄. 견적서의 품명 칸이 쓰는 네 가지다 —
 * 품명 · 품명2(규격) · 도번 · 교산 품번(getPartList 가 검색하는 네 칸과 같다).
 */
export type PartPickerRow = {
  id: string;
  partName: string;
  partSpec: string | null;
  drawingNo: string | null;
  kyosanPartNo: string | null;
};

/**
 * 부품 마스터를 **고르기 위해서만** 읽는 목록. 견적서 화면(QuoteEditForm)의
 * 「부품 비용」 품명 칸이 이 목록 위에서 거른다 — 부품 마스터가 백 줄 안쪽이라
 * 통째로 한 번 내려보내고 브라우저에서 거르는 편이 글자마다 서버를 부르는 것보다
 * 빠르다(components/inventory/PartRequestSection.tsx 의 같은 판단).
 *
 * ── 🔴 getPartList 를 쓰지 않고 형제를 따로 둔 까닭 ─────────────────────────
 * getPartList 는 part_stock_balances 를 조인해 **재고 수량**을 함께 싣고, 그 곁의
 * getPartOwnerAvailability 는 **소유구분별 가용량**을 싣는다. 수리 건 상세가 그
 * 두 조회를 부품 요청 쓰기 권한(inventory.requests WRITE) 뒤에 감춰 둔 까닭이
 * 그것이다 — 재고와 소유구분은 재고 담당의 정보지, 견적서를 쓰는 사람이 보라고
 * 내보내는 값이 아니다.
 *
 * 견적서 화면은 **부품의 이름과 번호만** 있으면 된다. 그래서:
 *
 *  - 조인이 없다 — part_stock_balances 를 아예 건드리지 않는다(재고가 흘러갈 길
 *    자체를 없앤다. "화면에서 안 그리면 된다"는 조회가 이미 실어 보낸 뒤다).
 *  - notes(내부 비고)를 담지 않는다 — 부품 상세에서만 읽는 내부 메모다.
 *  - 지워진 부품은 빼고(is_deleted = false), 품명 차례로 돌려준다.
 *
 * getPartList 는 한 글자도 건드리지 않았다 — 재고 화면이 쓰는 그 조회는 그대로다.
 */
export async function getPartPickerList(): Promise<PartPickerRow[]> {
  return db
    .select({
      id: parts.id,
      partName: parts.partName,
      partSpec: parts.partSpec,
      drawingNo: parts.drawingNo,
      kyosanPartNo: parts.kyosanPartNo,
    })
    .from(parts)
    .where(eq(parts.isDeleted, false))
    .orderBy(parts.partName);
}

/**
 * 고르개가 **함께 받아 두는** 단가 한 줄. 부품마다 값이 둘이다 — 일반 단가와 O/H 단가
 * (domain/quote-part-price.ts 머리말). 둘 다 소유구분을 보지 않는다(2026-09-17 사용자 정정).
 *
 * 🔴 **null 은 "정하지 않았다"이고 `"0"` 은 "무상 부품"이다.** 행이 없는 것을 `"0"` 으로
 * 채워 돌려주면 그 구분이 화면에 닿기 전에 사라지고, 견적서가 그 부품을 0원으로 청구한다
 * (queries/part-unit-prices.ts 의 같은 규약).
 */
export type PartPickerPriceRow = {
  partId: string;
  /** 부품 상세에 적어 둔 일반 단가. 정해 두지 않았으면 null. */
  unitPrice: string | null;
  /** O/H 단가. 정해 두지 않았으면 null — 🔴 그때 일반 단가로 때우지 않는다. */
  overhaulUnitPrice: string | null;
};

/**
 * 부품을 고를 때 단가 칸까지 채우기 위한 **단가 목록**.
 *
 * ── 🔴 왜 목록을 통째로 미리 받는가 ─────────────────────────────────────────
 * 단가가 적혀 있는 부품은 통틀어 열몇이다(개발 DB 기준 일반 3 · O/H 12). 고를 때마다
 * 서버를 한 번씩 다녀오면 고른 순간과 칸이 채워지는 순간이 어긋나고, 빨리 고쳐 치면
 * 늦게 온 응답이 사람이 적은 금액을 덮을 수도 있다. 목록이 이렇게 작으니 페이지가 한 번
 * 실어 보내고 브라우저에서 찾는 편이 싸고 안전하다(getPartPickerList 의 같은 판단).
 *
 * ── 🔴 단가가 있는 부품만 돌아온다 ──────────────────────────────────────────
 * 둘 다 없는 부품은 아예 빠진다 — 부품 76개 중 단가가 있는 것은 열몇뿐이라 그만큼만
 * 실어 보낸다. **없는 것을 "0" 으로 채우지 않는다**(위 형의 그 규칙). 고르개에서 줄이
 * 없다는 것은 곧 "정하지 않았다"이고, 그때는 단가 칸을 비워 둔다.
 *
 * ── 🔴 재고는 여기에도 오지 않는다 ──────────────────────────────────────────
 * 조인하는 것은 단가 표 둘뿐이다. part_stock_balances 를 건드리지 않고, 소유구분 ·
 * 내부 비고도 담지 않는다(getPartPickerList 머리말의 그 경계 그대로다).
 *
 * numeric 은 Drizzle 이 **문자열로 읽는다**. 화면까지 문자열로 옮긴다 — Number 를 거치면
 * 오차가 쌓이고, 그 오차가 견적서 합계와 세금계산서 사이의 1원 차이가 된다
 * (queries/part-overhaul-unit-prices.ts 의 같은 이유).
 */
export async function getPartPickerUnitPrices(): Promise<PartPickerPriceRow[]> {
  return db
    .select({
      partId: parts.id,
      unitPrice: partUnitPrices.unitPrice,
      overhaulUnitPrice: partOverhaulUnitPrices.unitPrice,
    })
    .from(parts)
    .leftJoin(partUnitPrices, eq(partUnitPrices.partId, parts.id))
    .leftJoin(partOverhaulUnitPrices, eq(partOverhaulUnitPrices.partId, parts.id))
    .where(
      and(
        eq(parts.isDeleted, false),
        or(isNotNull(partUnitPrices.unitPrice), isNotNull(partOverhaulUnitPrices.unitPrice))
      )
    );
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
   * 이 부품의 작업비(원, 수량과 무관). **null 은 "정하지 않음"이고 "0"(작업비 없는 부품)과
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
