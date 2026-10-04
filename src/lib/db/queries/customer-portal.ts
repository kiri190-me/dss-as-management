import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../client";
import {
  attachments,
  customerPortalSyncLog,
  customerRepairLinks,
  customerRepairRequests,
  customerStatusOptions,
  customers,
  repairCaseCustomerStatus,
  repairCases,
} from "../schema";
import { Q_CODE_SHAPE } from "../../ocr/pass-slip-goods";
import {
  findPortalFormById,
  groupCustomersByPortalForm,
  sortPortalRowsByReceivedAt,
} from "../../domain/customer-portal-forms";
import { listQuoteInfoForRepairCases } from "./domestic-orders";
import { listRepairCasesByCustomerId } from "./repair-cases";

/**
 * ============================================================================
 * 고객 안내 창구 — 조회
 * ============================================================================
 *
 * 담당자가 보는 「고객 안내 현황」 화면과, 그 화면이 내보내는 고객사 엑셀이 이
 * 파일을 읽는다. 🔴 **둘이 같은 함수를 쓴다**(listPortalItemsForForm). 각자
 * 조회를 가지면 담당자가 본 표와 저장된 파일이 갈리고, 그 어긋남은 아무도
 * 눈치채지 못한 채 굳는다.
 *
 * ── 단추의 근거는 「양식」이다 (2026-10-04) ──────────────────────────────
 * 전에는 **전용 주소가 발급된 고객사**가 화면 단추였다. 그 기능을 걷어내면서
 * 근거가 고객사 양식(domain/customer-portal-forms.ts)으로 옮겨 왔다 — 한 회사가
 * 여러 이름으로 등록돼 있어도 **한 표로 합쳐** 보인다.
 * ============================================================================
 */

/**
 * 고객에게 보여줄 한 줄. 화면과 스냅샷이 그대로 쓴다.
 *
 * 🔴 **이 타입에 칸이 늘어도 고객에게 나가는 것은 늘지 않는다.** 밖으로
 * 보내는 자리(server/services/customer-portal-sync.ts)는 이 줄을 펼치지 않고
 * 보낼 칸을 하나씩 적어 옮긴다. 아래 「고객사 양식」 쪽 칸들(endUserName ·
 * orderIssuedDate · customerRequestedDueDate · formValues ·
 * passSlipAttachmentIds · knownQCodes)이 그 목록에 없는 것은 **일부러**다 —
 * 담당자가 사내에서 쓰는 표에만 쓴다.
 */
export type CustomerPortalItem = {
  /**
   * 접수(CASE)인지 아직 접수 전 의뢰(REQUEST)인지.
   *
   * ⚠️ 2026-10-04 부터 이 파일이 내는 줄은 **전부 CASE 다** — 고객이 의뢰를 넣던
   * 길(전용 주소)이 없어졌다. 갈래를 하나로 좁히지 않고 그대로 둔다: 서버 쪽에
   * 아직 의뢰를 다루는 코드가 남아 있고, 그것을 걷어내는 일은 따로 한다.
   */
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

  // ───── 아래 여섯은 「고객사 양식」 표만 쓴다. 밖으로 나가지 않는다. ─────

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
  /**
   * 이 건에 **「통문증」 분류로 올라간 첨부**의 id 들. 없으면 빈 배열이다.
   *
   * 주성 양식 표의 [통문증에서 통문번호 읽기]가 이 id 로 사진을 받아 브라우저에서
   * 글자를 읽는다. 🔴 **사진도 주소도 여기 담지 않는다** — id 하나면 기존 첨부
   * 통로(api/attachments/{id}/download)가 권한을 다시 묻고 내준다.
   *
   * 🔴 **가장 나중에 올린 것이 앞**이다. 한 건에 통문증이 여러 장일 수 있는데
   * (다시 찍어 올리거나 반출·환입이 따로 있다), 사람이 마지막에 올린 것이 지금
   * 그 건의 통문증이다. 휴지통에 있는 것은 빠진다.
   */
  passSlipAttachmentIds: string[];
  /**
   * 🔴 **그 고객사에 이미 저장돼 있는 Q코드들.** 줄마다 같은 목록이 실린다
   * (한 벌을 만들어 모든 줄이 **같은 배열을 가리킨다** — 베껴 담지 않는다).
   *
   * 통문증에서 읽은 Q코드가 **글자 하나 틀린 채** 투표를 통과한 일이 측정에서
   * 140회 중 2회 있었다(`QDAC28594` → `QDAG28594`, 두 패스가 같은 실수를 했다).
   * 읽은 값이 이 목록에 있으면 초록, 없으면 「확인 필요(노랑)」로 보인다 —
   * 🔴 **값을 고치지도, 채우기를 거절하지도 않는다.** 목록이 얇은 처음에도
   * 기능이 서야 하고(개발 DB 는 건이 3개다), 목록이 쌓일수록 저절로 안전해진다.
   *
   * 🔴 **고객에게 나가는 값이 아니다** — 바로 위 다섯 칸과 같다. 밖으로 보내는
   * 자리(server/services/customer-portal-sync.ts)는 줄을 펼치지 않고 보낼 칸을
   * 하나씩 적어 옮기므로, 그 목록에 적지 않은 이 칸은 나가지 않는다.
   */
  knownQCodes: string[];
};

/**
 * 「Q코드」의 꼴 — 🔴 **읽는 쪽과 같은 하나를 쓴다**(lib/ocr/pass-slip-goods.ts).
 *
 * 여기서 칸 이름(`qCode`)으로 고르지 않고 **값의 꼴**로 고르는 까닭: 어느 키가
 * 무슨 뜻인지는 고객사 양식이 아는 일이고 이 조회가 아니다(바로 위 toStringMap
 * 주석과 같은 이유). 꼴로 고르면 양식에서 칸 이름이 바뀌어도 목록이 비지 않는다.
 */
function collectKnownQCodes(
  rows: { repairCaseId: string; formValues: unknown }[],
  caseIds: Set<string>
): string[] {
  const found = new Set<string>();
  for (const row of rows) {
    if (!caseIds.has(row.repairCaseId)) continue;
    for (const value of Object.values(toStringMap(row.formValues))) {
      const normalized = value.trim().toUpperCase();
      if (Q_CODE_SHAPE.test(normalized)) found.add(normalized);
    }
  }
  return [...found].sort();
}

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
 * 접수 건들에 걸린 **「통문증」 첨부**를 건별로 모은다 — 건 id → 첨부 id 목록.
 *
 * 🔴 **가장 나중에 올린 것이 앞**이다. 올린 시각이 같은 행이 있을 수 있어
 * (한 번에 여러 장을 올리면 실제로 같아진다) id 를 둘째 기준으로 둔다 — 안 두면
 * 새로고침할 때마다 차례가 바뀌어 "어제는 잘 읽혔는데" 가 된다.
 *
 * 🔴 휴지통에 있는 것은 뺀다. 지운 통문증을 읽어 칸을 채우면, 사람이 "지웠다"고
 * 믿는 사진의 값이 표에 적힌다.
 *
 * 질의를 건마다 쏘지 않고 한 번에 읽는다. 한 고객사의 진행 중인 건이 수십 개라
 * 건마다 한 번이면 그만큼 왕복한다 — 이 파일의 다른 조회들과 같은 방식이다.
 */
async function listPassSlipAttachmentIds(
  repairCaseIds: string[]
): Promise<Map<string, string[]>> {
  const byCase = new Map<string, string[]>();
  if (repairCaseIds.length === 0) return byCase;

  const rows = await db
    .select({ id: attachments.id, repairCaseId: attachments.repairCaseId })
    .from(attachments)
    .where(
      and(
        inArray(attachments.repairCaseId, repairCaseIds),
        eq(attachments.category, "PASS_SLIP"),
        eq(attachments.isDeleted, false)
      )
    )
    .orderBy(desc(attachments.uploadedAt), desc(attachments.id));

  for (const row of rows) {
    // repairCaseId 는 NULL 을 허용하는 칸이다(접수를 영구 삭제하면 끊긴다).
    // inArray 로 걸렀으므로 여기 올 수 없지만, 타입이 말하는 대로 지키고 넘어간다.
    if (!row.repairCaseId) continue;
    const found = byCase.get(row.repairCaseId);
    if (found) found.push(row.id);
    else byCase.set(row.repairCaseId, [row.id]);
  }
  return byCase;
}

/**
 * 한 고객사의 목록.
 *
 * 🔴 **출하 완료 제외 · 상태 · 견적 · 통문증 첨부가 모두 이 한 함수를 지난다.**
 * 양식 표(listPortalItemsForForm)도 밖으로 내보내는 스냅샷도 이것을 거쳐 간다 —
 * 조건을 한 군데에 모아 두지 않으면 같은 건이 화면마다 다르게 보인다.
 *
 * ■ 출하 완료를 직접 판정하지 않는다
 *
 * `listRepairCases()`가 이미 `resolveRepairStatusFromStep()`을 거쳐 상태를
 * 확정해 준다. 여기서 `actual_shipment_date`를 보거나 워크플로 단계를 직접
 * 읽으면 판정이 두 벌이 되고, 언젠가 한쪽만 고쳐져 **출하된 물건이 고객
 * 화면에 남는다.**
 *
 * ■ 접수 전 의뢰 줄은 내지 않는다 (2026-10-04)
 *
 * 고객이 의뢰를 넣던 길(전용 주소)이 없어졌으므로 「접수 대기 중」 줄도 없다.
 * `customer_repair_requests` 표와 그것을 읽는 다른 조회는 그대로 둔다 —
 * 지난 자료이고, 걷어내는 일은 따로 한다.
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

  const passSlipsByCase = await listPassSlipAttachmentIds(cases.map((c) => c.id));

  /**
   * 🔴 **출하 완료까지 포함한 그 고객사 전부**(`allCases`)에서 모은다 — 위에서
   * 걸러 낸 진행 중인 건만 보면 목록이 그만큼 얇아지는데, 지난 건에 적어 둔
   * Q코드야말로 「우리가 아는 값」이다. 다른 고객사의 값은 섞이지 않는다
   * (statusRows 는 표 전체를 읽으므로 **반드시 이 집합으로 거른다**).
   */
  const customerCaseIds = new Set(allCases.map((row) => row.id));
  const knownQCodes = collectKnownQCodes(statusRows, customerCaseIds);

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
      passSlipAttachmentIds: passSlipsByCase.get(row.id) ?? [],
      // 줄마다 **같은 배열**을 가리킨다(베껴 담지 않는다 — 건이 수십 개다).
      knownQCodes,
    };
  });

  return caseItems;
}

/** 화면 단추 하나 — 양식 하나와, 그 양식에 묶인 고객사 ids. */
export type CustomerPortalFormGroup = {
  formId: string;
  /** 🔴 하나가 아니다 — 같은 회사가 여러 이름으로 등록돼 있을 수 있다. */
  customerIds: string[];
};

/**
 * 「고객 안내 현황」에 단추로 설 양식들.
 *
 * 지워진 고객사는 세지 않는다 — 그 고객사의 건은 표에도 나오지 않아야 하고,
 * 그것만으로 단추가 서면 누를 때마다 빈 표가 나온다.
 *
 * 가르는 규칙(이름 맞추기 · 여러 이름 합치기 · 빈 양식 빼기 · 차례)은 전부
 * domain/customer-portal-forms.ts 의 groupCustomersByPortalForm 이 갖는다.
 * 여기서 한 벌 더 적으면 시험이 붙은 규칙과 실제로 도는 규칙이 갈린다.
 */
export async function listPortalFormGroups(): Promise<CustomerPortalFormGroup[]> {
  const rows = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .orderBy(asc(customers.name));

  return groupCustomersByPortalForm(rows).map((group) => ({
    formId: group.form.id,
    customerIds: group.customerIds,
  }));
}

/**
 * 양식 하나의 표에 들어갈 줄 전부.
 *
 * 🔴 **그 양식에 묶인 고객사를 모두 모아 한 배열로 낸다** — `INVENIA` 와
 * `INVENIA Co.,Ltd` 처럼 같은 회사가 둘로 등록돼 있어도 한 표다.
 *
 * 🔴 차례는 **「반출일」 오름차순**(오래된 것이 위, 값이 없으면 맨 뒤)이다 —
 * 규칙과 그 까닭은 domain/customer-portal-forms.ts 의
 * sortPortalRowsByReceivedAt 에 있다. 합친 뒤에 한 번만 정렬한다.
 *
 * 🔴 **아는 Q코드 목록은 묶음 전체에서 모은다.** 이제 표가 회사 하나를 뜻하므로,
 * `JUSUNG` 에 적어 둔 Q코드를 `주성 엔지니어링` 줄에서도 「아는 값」으로 봐야
 * 한다 — 아니면 같은 회사인데 줄마다 색이 달라진다.
 */
export async function listPortalItemsForForm(
  formId: string
): Promise<CustomerPortalItem[]> {
  const form = findPortalFormById(formId);
  if (form === null) return [];

  const groups = await listPortalFormGroups();
  const group = groups.find((candidate) => candidate.formId === form.id);
  if (group === undefined) return [];

  const lists = await Promise.all(
    group.customerIds.map((customerId) => listPortalItemsForCustomer(customerId))
  );
  const items = lists.flat();

  // 한 벌을 만들어 **모든 줄이 같은 배열을 가리킨다**(베껴 담지 않는다).
  const knownQCodes = [...new Set(items.flatMap((item) => item.knownQCodes))].sort();
  const merged =
    group.customerIds.length > 1
      ? items.map((item) => ({ ...item, knownQCodes }))
      : items;

  return sortPortalRowsByReceivedAt(merged);
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
