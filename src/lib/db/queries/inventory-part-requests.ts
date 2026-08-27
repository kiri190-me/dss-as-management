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
  /** Parts Request 소유구분 checkpoint — NULL for every item created before migration 0024 (never backfilled/guessed). Display via stockOwnerLabelOrUnspecified, never stockOwnerLabels[owner] directly. */
  owner: StockOwner | null;
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
      owner: inventoryPartRequestItems.owner,
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
      owner: item.owner,
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

/**
 * 지금 걸려 있는 보류의 사유·누가·언제.
 *
 * 보류 사유는 요청 표에 컬럼으로 두지 않고 이력(history)에 남긴다 — 거절·취소
 * 사유와 같은 자리이고, 보류가 여러 번 반복돼도 그 때마다의 사유가 그대로
 * 남는다. 화면에 보여 줄 "지금" 사유는 그중 가장 최근 HELD 항목이다.
 */
export type PartRequestHoldInfo = {
  reason: string;
  heldByName: string;
  heldAt: string;
};

/**
 * 요청 여러 건의 최근 HELD 이력을 한 번에 읽는다.
 *
 * 상태가 ON_HOLD가 아닌 요청에도 과거 HELD 이력이 남아 있을 수 있으므로,
 * 부르는 쪽이 상태를 보고 붙일지 말지 정한다 — 여기서 상태까지 보지 않는 이유는
 * 이력 조회와 상태 판정을 한 함수에 섞으면 나중에 "왜 사유가 안 보이지"를
 * 두 곳에서 찾게 되기 때문이다.
 */
async function loadLatestHoldByRequest(requestIds: string[]): Promise<Map<string, PartRequestHoldInfo>> {
  if (requestIds.length === 0) return new Map();

  const rows = await db
    .select({
      requestId: inventoryPartRequestHistory.requestId,
      reason: inventoryPartRequestHistory.reason,
      actorName: users.name,
      createdAt: inventoryPartRequestHistory.createdAt,
    })
    .from(inventoryPartRequestHistory)
    .innerJoin(users, eq(inventoryPartRequestHistory.actorUserId, users.id))
    .where(
      and(
        inArray(inventoryPartRequestHistory.requestId, requestIds),
        eq(inventoryPartRequestHistory.actionType, "HELD")
      )
    )
    .orderBy(desc(inventoryPartRequestHistory.createdAt));

  const latest = new Map<string, PartRequestHoldInfo>();
  for (const row of rows) {
    // 내림차순이므로 처음 만나는 것이 가장 최근이다.
    if (latest.has(row.requestId)) continue;
    latest.set(row.requestId, {
      reason: row.reason ?? "",
      heldByName: row.actorName,
      heldAt: row.createdAt.toISOString(),
    });
  }
  return latest;
}

export type ManagerPartRequestRow = {
  id: string;
  createdAt: string;
  status: InventoryPartRequestStatus;
  note: string | null;
  version: number;
  /**
   * Nullable (repair-case permanent-delete schema foundation checkpoint):
   * NULL means the request's repair case has since been permanently purged
   * — the request row itself is preserved (inventory-accounting history),
   * it just no longer has a live case to link to. UI must never build a
   * `/repair-cases/${repairCaseId}` link when this is null.
   */
  repairCaseId: string | null;
  /** "삭제된 접수 건" fallback when repairCaseId is null — never the real intake number of an unrelated case. */
  intakeNumber: string;
  customerName: string;
  modelName: string;
  serialNumber: string;
  requestedByName: string;
  /** false (never locked) when the case no longer exists — there's nothing left to lock, and every mutation that actually cares (issuePartRequest) independently re-verifies repairCaseId itself rather than trusting this display flag. */
  isCaseLocked: boolean;
  /** 상태가 보류일 때만 채워진다. 왜 멈춰 있는지가 목록에서 바로 보여야 한다. */
  hold: PartRequestHoldInfo | null;
  items: PartRequestItemRow[];
};

/**
 * Every request across every repair case — the manager screen filters/sorts
 * client-side over this full list (small real catalog, same convention as
 * getPartList). LEFT JOIN to repairCases (was INNER JOIN): repair_case_id
 * is now nullable, and an INNER JOIN would silently drop every request
 * whose case has been permanently purged from this list entirely — this
 * table is the accounting-relevant record of what was requested/issued and
 * must keep showing up, with a "삭제된 접수 건" fallback in place of the
 * now-missing case fields, never hidden. For still-active cases (every real
 * row today, since no purge mutation exists yet) this produces byte-for-
 * byte identical results to the old INNER JOIN.
 */
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
    .leftJoin(repairCases, eq(inventoryPartRequests.repairCaseId, repairCases.id))
    .leftJoin(customers, eq(repairCases.customerId, customers.id))
    .leftJoin(products, eq(repairCases.productId, products.id))
    .innerJoin(users, eq(inventoryPartRequests.requestedByUserId, users.id))
    .orderBy(desc(inventoryPartRequests.createdAt));

  const itemsByRequest = await attachItemsWithAvailability(rows.map((r) => r.id));
  const holdByRequest = await loadLatestHoldByRequest(rows.map((r) => r.id));

  return rows.map((r) => ({
    hold: r.status === "ON_HOLD" ? (holdByRequest.get(r.id) ?? null) : null,
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    status: r.status,
    note: r.note,
    version: r.version,
    repairCaseId: r.repairCaseId,
    intakeNumber: r.intakeNumber ?? "삭제된 접수 건",
    customerName: r.customerName ?? "-",
    modelName: r.modelName ?? "-",
    serialNumber: r.serialNumber ?? "-",
    requestedByName: r.requestedByName,
    isCaseLocked: r.isCaseLocked ?? false,
    items: itemsByRequest.get(r.id) ?? [],
  }));
}

// ---- 종 알림 (처리 대기 중인 부품 요청) ----

/**
 * 알림 한 줄을 그리는 데 필요한 값만. 부품 목록·재고 가용량·보류 이력은
 * 들어 있지 않다.
 */
export type PendingPartRequestNotificationRow = {
  id: string;
  /**
   * NULL이면 접수 건이 영구 삭제된 요청이다(repair_case_id ON DELETE SET NULL).
   * 화면 문구로 바꾸는 것은 domain/notifications.ts가 한다 — 여기서는 데이터를
   * 있는 그대로 돌려준다.
   */
  intakeNumber: string | null;
  requestedByName: string;
  createdAt: string;
};

/**
 * 종 알림용 — 아직 아무도 손대지 않은 부품 요청.
 *
 * ── 왜 PENDING 하나뿐인가 ──────────────────────────────────────────────
 *  - REJECTED · CANCELLED · FULLY_ISSUED · PARTIALLY_CLOSED 는 끝난 것이다.
 *    알림은 "지금 내가 처리할 일"이고, 끝난 것에는 할 일이 없다.
 *  - ON_HOLD 는 관리자가 **일부러 세워 둔 것**이다. 보류해 둔 것을 계속
 *    알리면 보류가 알림을 끄는 방법이 되지 못해 소음만 남는다.
 *  - PARTIALLY_ISSUED 는 이미 손을 댄 것이라 "새로 온 요청"이 아니다. 남은
 *    수량은 부품 요청 관리 목록에서 이어서 처리한다.
 *
 * ── 왜 getPartRequestsForManager를 쓰지 않는가 ─────────────────────────
 * 그쪽은 상태를 거르지 않고 모든 요청 + 부품 목록 + 재고 가용량 + 보류 이력
 * 까지 끌어온다(attachItemsWithAvailability · loadLatestHoldByRequest, 조회
 * 세 번 이상). 알림은 **모든 페이지 로드마다** 돌기 때문에 그 비용을 낼 수
 * 없다. 여기는 조회 한 번, 컬럼 네 개다.
 *
 * ── 접수 건 연결이 끊긴 요청 ──────────────────────────────────────────
 * leftJoin이다. innerJoin이면 접수 건이 영구 삭제된 요청이 알림에서 통째로
 * 사라진다 — 그 요청은 여전히 처리 대기 중이고 재고 회계 기록이기도 하다.
 * (getPartRequestsForManager가 같은 이유로 leftJoin을 쓴다.)
 *
 * ── 차례 ───────────────────────────────────────────────────────────────
 * 최신순. 종 패널에는 결재 알림(listRepairCasesPendingMyApproval, 요청 시각
 * 내림차순)과 섞여 그려지므로 두 종류의 방향이 같아야 한다 — 한쪽만 오래된
 * 순이면 같은 목록 안에서 시간이 위아래로 뒤집힌다.
 *
 * 읽기 전용이다. 상태를 바꾸는 일은 mutations/inventory-part-requests.ts만
 * 한다.
 */
export async function getPendingPartRequestsForNotification(): Promise<PendingPartRequestNotificationRow[]> {
  const rows = await db
    .select({
      id: inventoryPartRequests.id,
      createdAt: inventoryPartRequests.createdAt,
      intakeNumber: repairCases.intakeNumber,
      requestedByName: users.name,
    })
    .from(inventoryPartRequests)
    .leftJoin(repairCases, eq(inventoryPartRequests.repairCaseId, repairCases.id))
    .innerJoin(users, eq(inventoryPartRequests.requestedByUserId, users.id))
    .where(eq(inventoryPartRequests.status, "PENDING"))
    .orderBy(desc(inventoryPartRequests.createdAt));

  return rows.map((r) => ({
    id: r.id,
    intakeNumber: r.intakeNumber,
    requestedByName: r.requestedByName,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---- 내 요청 (AS_ENGINEER's own requests for one repair case) ----

export type OwnPartRequestRow = {
  id: string;
  createdAt: string;
  status: InventoryPartRequestStatus;
  note: string | null;
  version: number;
  /**
   * 상태가 보류일 때만 채워진다.
   *
   * 요청을 올린 엔지니어가 접수 건 상세에서 이걸 본다 — 관리자가 왜 멈춰 뒀는지
   * 모르면 같은 요청을 다시 올리거나 담당자를 찾아다니게 된다.
   */
  hold: PartRequestHoldInfo | null;
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
  const holdByRequest = await loadLatestHoldByRequest(rows.map((r) => r.id));

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    status: r.status,
    note: r.note,
    version: r.version,
    hold: r.status === "ON_HOLD" ? (holdByRequest.get(r.id) ?? null) : null,
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
