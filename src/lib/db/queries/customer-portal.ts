import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../client";
import {
  customerPortalSyncLog,
  customerRepairLinks,
  customerRepairRequests,
  customerStatusOptions,
  customers,
  repairCaseCustomerStatus,
} from "../schema";
import { listQuoteInfoForRepairCases } from "./domestic-orders";
import { listRepairCasesByCustomerId } from "./repair-cases";

/**
 * ============================================================================
 * 고객 안내 창구 — 조회
 * ============================================================================
 *
 * 담당자가 보는 「고객 안내 현황」 화면과, 밖으로 내보낼 스냅샷이 이 파일을
 * 읽는다. **둘이 같은 함수를 쓴다** — 화면이 미리보기를 겸하려면 그래야 한다.
 * 각자 조회를 가지면 담당자가 본 것과 고객이 보는 것이 갈리고, 그 어긋남은
 * 아무도 눈치채지 못한 채 굳는다.
 * ============================================================================
 */

/** 고객에게 보여줄 한 줄. 화면과 스냅샷이 그대로 쓴다. */
export type CustomerPortalItem = {
  /** 접수(CASE)인지 아직 접수 전 의뢰(REQUEST)인지. */
  sourceKind: "CASE" | "REQUEST";
  sourceId: string;
  intakeNumber: string | null;
  modelName: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  receivedAt: string | null;
  /** 고객 안내 상태. 정하지 않았으면 null → 고객 화면에 `-`. */
  statusLabel: string | null;
  statusNote: string | null;
  quoteNumber: string | null;
  quoteIssuedDate: string | null;
  /** 상태를 고칠 때 쓰는 낙관적 잠금 값. 행이 없으면 null. */
  statusVersion: number | null;
};

/**
 * 한 고객사가 볼 목록.
 *
 * ■ 출하 완료를 직접 판정하지 않는다
 *
 * `listRepairCases()`가 이미 `resolveRepairStatusFromStep()`을 거쳐 상태를
 * 확정해 준다. 여기서 `actual_shipment_date`를 보거나 워크플로 단계를 직접
 * 읽으면 판정이 두 벌이 되고, 언젠가 한쪽만 고쳐져 **출하된 물건이 고객
 * 화면에 남는다.**
 *
 * ■ 접수 전 의뢰도 함께 낸다
 *
 * 고객이 방금 넣은 의뢰가 목록에 없으면 "안 들어갔나" 하고 다시 넣거나
 * 전화한다. 아직 접수번호가 없을 뿐 그 사람이 맡긴 물건이다.
 */
export async function listPortalItemsForCustomer(
  customerId: string
): Promise<CustomerPortalItem[]> {
  // 조회를 새로 짜지 않는다. 이 저장소에 이미 고객사별 조회가 있고, 그것이
  // resolveRepairStatusFromStep 을 거쳐 상태를 확정해 준다. 여기서 8개 표
  // 조인을 한 벌 더 만들면 그 조인이 갈리는 날 화면마다 다른 값이 보인다.
  const allCases = await listRepairCasesByCustomerId(customerId);

  // 여기가 "출하 완료 제외"의 유일한 근거다.
  const cases = allCases.filter((row) => row.status !== "SHIPMENT_COMPLETED");

  const quoteInfo = await listQuoteInfoForRepairCases(cases.map((c) => c.id));

  const statusRows = await db
    .select({
      repairCaseId: repairCaseCustomerStatus.repairCaseId,
      label: customerStatusOptions.label,
      note: repairCaseCustomerStatus.note,
      version: repairCaseCustomerStatus.version,
    })
    .from(repairCaseCustomerStatus)
    .leftJoin(
      customerStatusOptions,
      eq(repairCaseCustomerStatus.statusOptionId, customerStatusOptions.id)
    );

  const statusByCase = new Map(statusRows.map((row) => [row.repairCaseId, row]));

  const caseItems: CustomerPortalItem[] = cases.map((row) => {
    const status = statusByCase.get(row.id);
    const quote = quoteInfo.get(row.id);
    return {
      sourceKind: "CASE",
      sourceId: row.id,
      intakeNumber: row.intakeNumber,
      modelName: row.modelName,
      lotNumber: row.lotNumber,
      serialNumber: row.serialNumber,
      receivedAt: row.receivedAt,
      statusLabel: status?.label ?? null,
      statusNote: status?.note ?? null,
      quoteNumber: quote?.quoteNumber ?? null,
      quoteIssuedDate: quote?.quoteIssuedDate ?? null,
      statusVersion: status?.version ?? null,
    };
  });

  const pending = await db
    .select({
      id: customerRepairRequests.id,
      productModelName: customerRepairRequests.productModelName,
      lotNumber: customerRepairRequests.lotNumber,
      serialNumber: customerRepairRequests.serialNumber,
      submittedAt: customerRepairRequests.submittedAt,
    })
    .from(customerRepairRequests)
    .where(
      and(
        eq(customerRepairRequests.customerId, customerId),
        // 접수로 바뀐 것은 접수 쪽 줄로 이미 보인다. 반려된 것은 보이지 않는다.
        sql`${customerRepairRequests.status} IN ('NEW', 'CONVERTING')`
      )
    )
    .orderBy(desc(customerRepairRequests.submittedAt));

  const pendingItems: CustomerPortalItem[] = pending.map((row) => ({
    sourceKind: "REQUEST",
    sourceId: row.id,
    intakeNumber: null,
    modelName: row.productModelName,
    lotNumber: row.lotNumber,
    serialNumber: row.serialNumber,
    // 접수일이 아직 없다. 고객이 보낸 날을 그 자리에 둔다.
    receivedAt: row.submittedAt.toISOString().slice(0, 10),
    statusLabel: null,
    statusNote: null,
    quoteNumber: null,
    quoteIssuedDate: null,
    statusVersion: null,
  }));

  // 접수 전 의뢰가 위, 그다음 접수를 접수일 최신순으로.
  return [...pendingItems, ...caseItems];
}

/** 고객사 한 곳의 링크 상태. 화면이 「발급 / 재발급 / 회수」를 그릴 때 쓴다. */
export type CustomerLinkInfo = {
  id: string;
  customerId: string;
  customerName: string;
  label: string | null;
  createdAt: Date;
  lastSyncedAt: Date | null;
  lastSyncedCount: number | null;
};

/**
 * 살아 있는 링크 목록.
 *
 * 평문 토큰은 어디에도 없으므로 여기서 낼 수 없다 — 발급 순간에만 존재한다.
 * 화면은 "발급됨 / 없음"만 알 수 있고, 주소를 다시 보려면 재발급뿐이다.
 */
export async function listActiveLinks(): Promise<CustomerLinkInfo[]> {
  const links = await db
    .select({
      id: customerRepairLinks.id,
      customerId: customerRepairLinks.customerId,
      customerName: customers.name,
      label: customerRepairLinks.label,
      createdAt: customerRepairLinks.createdAt,
    })
    .from(customerRepairLinks)
    .innerJoin(customers, eq(customerRepairLinks.customerId, customers.id))
    .where(isNull(customerRepairLinks.revokedAt))
    .orderBy(asc(customers.name));

  if (links.length === 0) return [];

  /*
   * 마지막 내보낸 기록은 조회를 나눠 붙인다.
   *
   * "링크마다 가장 늦은 한 줄"을 조인 하나로 잡으려면 상관 서브쿼리나
   * DISTINCT ON 이 필요한데, 링크는 고객사 수만큼(지금 37곳 이하)이라
   * 두 번 읽고 붙이는 편이 읽기 쉽고 결과도 같다. 여기서 아껴야 할 만큼
   * 큰 자료가 아니다.
   */
  const logs = await db
    .select({
      customerLinkId: customerPortalSyncLog.customerLinkId,
      syncedAt: customerPortalSyncLog.syncedAt,
      itemCount: customerPortalSyncLog.itemCount,
    })
    .from(customerPortalSyncLog)
    .orderBy(desc(customerPortalSyncLog.syncedAt));

  // 내림차순이므로 링크마다 처음 만난 것이 가장 늦은 것이다.
  const latest = new Map<string, { syncedAt: Date; itemCount: number }>();
  for (const log of logs) {
    if (!latest.has(log.customerLinkId)) {
      latest.set(log.customerLinkId, {
        syncedAt: log.syncedAt,
        itemCount: log.itemCount,
      });
    }
  }

  return links.map((link) => {
    const log = latest.get(link.id);
    return {
      ...link,
      lastSyncedAt: log?.syncedAt ?? null,
      lastSyncedCount: log?.itemCount ?? null,
    };
  });
}

/** 드롭다운에 뜨는 상태 목록. 비활성은 빠진다. */
export async function listActiveStatusOptions(): Promise<
  { id: string; label: string }[]
> {
  return db
    .select({ id: customerStatusOptions.id, label: customerStatusOptions.label })
    .from(customerStatusOptions)
    .where(eq(customerStatusOptions.isActive, true))
    .orderBy(asc(customerStatusOptions.displayOrder), asc(customerStatusOptions.label));
}

/** 설정 화면용 — 비활성까지 전부. */
export async function listAllStatusOptions(): Promise<
  { id: string; label: string; displayOrder: number; isActive: boolean }[]
> {
  return db
    .select({
      id: customerStatusOptions.id,
      label: customerStatusOptions.label,
      displayOrder: customerStatusOptions.displayOrder,
      isActive: customerStatusOptions.isActive,
    })
    .from(customerStatusOptions)
    .orderBy(asc(customerStatusOptions.displayOrder), asc(customerStatusOptions.label));
}

/** 아직 처리하지 않은 의뢰 — 목록 화면과 알림이 함께 쓴다. */
export async function listNewCustomerRepairRequests(): Promise<
  {
    id: string;
    customerName: string;
    productModelName: string;
    serialNumber: string;
    submittedAt: Date;
  }[]
> {
  return db
    .select({
      id: customerRepairRequests.id,
      customerName: customers.name,
      productModelName: customerRepairRequests.productModelName,
      serialNumber: customerRepairRequests.serialNumber,
      submittedAt: customerRepairRequests.submittedAt,
    })
    .from(customerRepairRequests)
    .innerJoin(customers, eq(customerRepairRequests.customerId, customers.id))
    .where(eq(customerRepairRequests.status, "NEW"))
    .orderBy(desc(customerRepairRequests.submittedAt));
}
