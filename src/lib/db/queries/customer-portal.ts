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
  repairCases,
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

/**
 * 아직 접수로 만들지 않은 의뢰가 고객 화면에서 갖는 상태.
 *
 * 상태 목록에 넣지 않고 여기 상수로 둔다 — 관리자가 고칠 값이 아니라
 * 시스템이 아는 사실이기 때문이다(자세한 이유는 쓰는 자리 주석에 있다).
 */
export const PENDING_INTAKE_LABEL = "접수 대기 중";

/**
 * 고객에게 보여줄 한 줄. 화면과 스냅샷이 그대로 쓴다.
 *
 * 🔴 **이 타입에 칸이 늘어도 고객에게 나가는 것은 늘지 않는다.** 밖으로
 * 보내는 자리(server/services/customer-portal-sync.ts)는 이 줄을 펼치지 않고
 * 보낼 칸을 하나씩 적어 옮긴다. 아래 「고객사 양식」 쪽 칸 셋(endUserName ·
 * orderIssuedDate · formValues)이 그 목록에 없는 것은 **일부러**다 — 담당자가
 * 사내에서 쓰는 표에만 쓴다.
 */
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

  // ───── 아래 셋은 「고객사 양식」 표만 쓴다. 밖으로 나가지 않는다. ─────

  /**
   * End-User 이름. 고객사 엑셀의 「Site명」이 가리키는 것이 이것이다
   * (사용자 확인 2026-09-30).
   */
  endUserName: string | null;
  /** 발주발행일 — 엑셀의 「ICD PO 발행일」 · 「P.O 발행 일」. */
  orderIssuedDate: string | null;
  /**
   * 접수 건의 **고객 요청 납기일** — JUSUNG 표의 「납품 요청일」.
   *
   * ⚠️ 내자 정리의 납기요청일(domestic_order_due_dates)이 **아니다**
   * (2026-09-30 사용자 확인 — 까닭은 domain/customer-portal-forms.ts 의
   * PortalSystemField 주석에).
   */
  customerRequestedDueDate: string | null;
  /**
   * 그 고객사 양식에서 **사람이 줄마다 손으로 적은 값들**(키 → 글자).
   * 아직 아무것도 안 적었으면 빈 객체다. 어느 키가 뜻이 있는지는 양식이
   * 정한다(domain/customer-portal-forms.ts).
   */
  formValues: Record<string, string>;
};

/**
 * jsonb 에서 읽은 것을 「키 → 글자」로 눕힌다.
 *
 * jsonb 는 무엇이든 담을 수 있는 칸이라(배열 · 숫자 · 중첩 객체 · null) 읽는
 * 첫 자리에서 모양을 확정해 둔다. 여기서 확정하지 않으면 화면이 문자열인 줄
 * 알고 쓰다가 숫자를 만나 깨진다.
 *
 * 🔴 **어느 키가 뜻이 있는지는 여기서 판단하지 않는다.** 그것은 고객사 양식이
 * 아는 일이고(domain/customer-portal-forms.ts 의 readManualValues), 양식을
 * 아는 것은 이 조회가 아니라 화면이다. 여기서 한 벌 더 걸러 두면 양식이 바뀔
 * 때 두 곳을 고쳐야 한다.
 */
function toStringMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return result;
  }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") result[key] = raw;
  }
  return result;
}

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
      formValues: repairCaseCustomerStatus.formValues,
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
      endUserName: row.endUserName,
      orderIssuedDate: quote?.orderIssuedDate ?? null,
      // 「납품 요청일」 — 접수 건에 붙은 값이라 따로 읽을 것이 없다.
      customerRequestedDueDate: row.customerRequestedDueDate,
      formValues: toStringMap(status?.formValues),
    };
  });

  const pending = await db
    .select({
      id: customerRepairRequests.id,
      productModelName: customerRepairRequests.productModelName,
      lotNumber: customerRepairRequests.lotNumber,
      serialNumber: customerRepairRequests.serialNumber,
      endUser: customerRepairRequests.endUser,
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
    /**
     * 접수 전 의뢰의 상태는 정해진 한 가지뿐이다 — 아직 담당자가 보지 않았거나
     * 보는 중이다. 여기를 비워 `-`로 내보내면 고객은 "보냈는데 아무 일도
     * 일어나지 않았다"로 읽는다. 그러면 다시 넣거나 전화한다.
     *
     * 상태 목록(customer_status_options)에서 고르지 않고 글자를 박아 두는
     * 이유: 이건 담당자가 정하는 값이 아니라 **사실**이다. 목록에 두면
     * 관리자가 지우거나 이름을 바꿀 수 있게 되는데, 그러면 접수 전 의뢰의
     * 상태가 사라지거나 엉뚱한 말이 된다.
     */
    statusLabel: PENDING_INTAKE_LABEL,
    statusNote: null,
    quoteNumber: null,
    quoteIssuedDate: null,
    statusVersion: null,
    /**
     * 고객이 의뢰서에 적어 보낸 End-User 를 「Site명」 자리에 그대로 둔다.
     * 접수로 만들 때 담당자가 마스터의 End-User 로 고쳐 잡으므로 그때부터는
     * 접수 쪽 값이 보인다.
     */
    endUserName: row.endUser,
    // 접수가 아직 없으니 발주도, 손으로 적을 자리도 없다. 그 자리는
    // repair_case_customer_status 가 갖고 있고 그 표는 접수를 가리킨다.
    orderIssuedDate: null,
    customerRequestedDueDate: null,
    formValues: {},
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
 * 주소 자체는 여기서 내지 않는다. 이 목록은 페이지가 통째로 브라우저에
 * 내려보내는 값이라, 여기에 주소를 담으면 **화면을 연 것만으로 모든 고객사의
 * 주소가 HTML 에 실려 나간다.** 주소는 고객사를 고른 순간 그 하나만
 * revealCustomerLinkUrlAction 으로 따로 가져온다.
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


/**
 * 살아 있는 링크 하나의 **보관된 주소 사본**을 꺼낸다(암호문 그대로).
 *
 * 복호화는 여기서 하지 않는다 — 키를 쓰는 곳을 한 군데
 * (server/customer-link-token-cipher.ts)로 모아 두면 "어디서 풀리는가"를
 * grep 한 번으로 다 볼 수 있다. 조회 계층은 암호문을 나르기만 한다.
 *
 * 회수된 링크는 내주지 않는다. 회수한 주소를 다시 보여 주면 "끊었다"는 말이
 * 무색해지고, 실수로 그 주소를 다시 전달하는 길이 생긴다.
 */
export async function getActiveLinkCipher(
  linkId: string
): Promise<{ customerId: string; tokenCipher: string | null } | null> {
  const [row] = await db
    .select({
      customerId: customerRepairLinks.customerId,
      tokenCipher: customerRepairLinks.tokenCipher,
    })
    .from(customerRepairLinks)
    .where(
      and(eq(customerRepairLinks.id, linkId), isNull(customerRepairLinks.revokedAt))
    )
    .limit(1);
  return row ?? null;
}

/**
 * 이 접수가 어느 고객사의 것인가 — **이름으로**.
 *
 * 고객사 양식은 이름으로 가려진다(domain/customer-portal-forms.ts). 저장할 때
 * "이 줄에 적어도 되는 칸이 무엇인가"를 판정하려면 그 이름이 필요한데, 🔴 그
 * 이름을 **화면이 보낸 값으로 받으면 안 된다** — 보내는 쪽이 남의 고객사
 * 이름을 대면 그 양식의 칸을 이 접수에 적을 수 있게 된다. 서버가 접수에서
 * 거슬러 올라가 직접 읽는다.
 *
 * 지워진 고객사도 그대로 돌려준다. 접수는 남아 있고, 그 접수를 고치는 일이
 * 고객사가 지워졌다는 이유로 막힐 까닭이 없다.
 */
export async function getCustomerNameForRepairCase(
  repairCaseId: string
): Promise<string | null> {
  const [row] = await db
    .select({ name: customers.name })
    .from(repairCases)
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .where(eq(repairCases.id, repairCaseId))
    .limit(1);
  return row?.name ?? null;
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

/**
 * 수리 의뢰 전부 — 목록 화면이 쓴다.
 *
 * 처리 대기와 처리됨을 한 번에 읽는다. 나눠 읽으면 화면이 조회를 두 번 하고,
 * 그 사이에 한 건이 처리되면 양쪽에 동시에 보이거나 양쪽에서 사라진다.
 */
export async function listAllCustomerRepairRequests() {
  return db
    .select({
      id: customerRepairRequests.id,
      customerName: customers.name,
      companyName: customerRepairRequests.companyName,
      contactName: customerRepairRequests.contactName,
      contactPhone: customerRepairRequests.contactPhone,
      productModelName: customerRepairRequests.productModelName,
      lotNumber: customerRepairRequests.lotNumber,
      serialNumber: customerRepairRequests.serialNumber,
      endUser: customerRepairRequests.endUser,
      symptomDescription: customerRepairRequests.symptomDescription,
      alarmName: customerRepairRequests.alarmName,
      submittedAt: customerRepairRequests.submittedAt,
      status: customerRepairRequests.status,
      convertedRepairCaseId: customerRepairRequests.convertedRepairCaseId,
    })
    .from(customerRepairRequests)
    .innerJoin(customers, eq(customerRepairRequests.customerId, customers.id))
    .orderBy(desc(customerRepairRequests.submittedAt));
}
