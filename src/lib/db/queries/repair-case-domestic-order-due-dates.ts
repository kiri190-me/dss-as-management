import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { domesticOrderDueDates, domesticOrders } from "../schema";
import { foldBlankToNull } from "@/lib/domain/domestic-order-list";

/**
 * ============================================================================
 * 「고객 요청 납기일이 빈 건」이 내자 정리에서 빌려 올 날짜 — 조회 쪽 공용 조각
 * ============================================================================
 * **SELECT 만 있다.** 규칙은 하나도 여기 없다 — 여럿 중 하나를 고르는 일도,
 * 자기 칸과 빌려 온 것 중 무엇이 이기는지도 전부 도메인이 정한다
 * (domain/requested-due-date-link.ts 의 resolveRepairCaseRequestedDueDate →
 * weekly-report-delivery.ts 의 pickEarliestDueDate). 이 파일이 하는 일은
 * **재료를 모아 건별로 묶어 주는 것**뿐이다.
 *
 * ── 왜 따로 떼어 두는가 ─────────────────────────────────────────────────
 * 2026-10-18 종 알림 「납기 임박」이 처음 이 조각을 썼고(queries/
 * repair-case-due-date-notifications.ts), 2026-10-19 에 목록 둘이 같은 것을
 * 필요로 하게 됐다 — 전체 A/S 현황(queries/repair-cases.ts 의 listRepairCases)과
 * 내 작업(queries/repair-cases-mine.ts). 세 곳이 각자 SQL 을 한 벌씩 들고 있으면
 * 언젠가 한 곳만 고쳐지고, 그때 **같은 건이 화면마다 다른 날짜로** 보인다
 * (바로 그 어긋남이 이번 결함이었다 — 알림엔 날짜가 뜨는데 표에는 "-" 였다).
 *
 * ── 🔴 조인하지 않고 따로 읽는다 ────────────────────────────────────────
 * 한 수리 건에 내자 줄이 여럿이고(분할 발주 — repair_case_id 에 유일 제약이
 * 없다) 줄 하나에 날짜가 또 여럿이다(분할 납품). 접수 건 조회에 그대로 조인하면
 * **그 건이 날짜 수만큼 복제된다** — 목록이라면 같은 줄이 서너 번 선다. 그래서
 * 접수 건을 먼저 읽고 날짜는 여기서 **따로 한 번** 읽어 건마다 묶는다. 질의는
 * 많아야 한 번 더이고, 건마다 묻지 않는다(N+1 없음).
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * 접수 건 id 와 날짜만 읽는다. 내자 줄의 자유 입력 메모(progress_note 등)는
 * 한 글자도 나오지 않는다.
 * ============================================================================
 */

/**
 * 그 건들 중 **내자에서 빌려야 하는 건의 id 만** 추린다.
 *
 * 🔵 자기 칸에 날짜가 적힌 건은 내자를 보지 않는다는 것이
 * resolveRepairCaseRequestedDueDate 의 규칙이라(자기 자리에 적힌 것이 먼저),
 * 그런 건의 날짜까지 읽어 봐야 쓰이지 않는다. 목록은 수백 건이라 이 좁히기가
 * 곧 질의 크기다.
 *
 * 접는 규칙은 화면이 쓰는 그 foldBlankToNull 이다 — 공백만 적힌 값도 「없음」
 * 으로 본다. 여기서 따로 판단하면 조회가 「있다」고 본 건을 화면이 「없다」고
 * 보는 날이 온다.
 */
export function dueDateBorrowerIds(
  rows: readonly { id: string; customerRequestedDueDate: string | null }[]
): string[] {
  return rows.filter((row) => foldBlankToNull(row.customerRequestedDueDate) === null).map((row) => row.id);
}

/**
 * 그 건들에 붙어 있는 **내자 납기요청일 전부**를 접수 건별로 묶은 것.
 *
 * 고르는 일은 하지 않는다 — 파일 머리말. 건별 조회(queries/domestic-orders.ts 의
 * listDomesticOrderDueDatesForRepairCase)와 읽는 조건이 같다: `is_deleted = false`
 * 인 발주 줄의 날짜만 센다 — 화면에서 지운 줄에 붙어 있던 날짜가 다른 화면의
 * 값을 정하면 안 된다.
 */
export async function loadDomesticOrderDueDatesByCaseId(
  caseIds: readonly string[]
): Promise<Map<string, string[]>> {
  const byCaseId = new Map<string, string[]>();
  // inArray 에 빈 배열을 넘기면 뜻 없는 SQL 이 만들어진다(주간보고 조회들과 같은 규칙).
  // 빌릴 건이 하나도 없으면 질의 자체가 돌지 않는다.
  if (caseIds.length === 0) return byCaseId;

  const rows = await db
    .select({
      repairCaseId: domesticOrders.repairCaseId,
      dueDate: domesticOrderDueDates.dueDate,
    })
    .from(domesticOrderDueDates)
    .innerJoin(domesticOrders, eq(domesticOrderDueDates.domesticOrderId, domesticOrders.id))
    .where(and(eq(domesticOrders.isDeleted, false), inArray(domesticOrders.repairCaseId, [...caseIds])));

  for (const row of rows) {
    // repair_case_id 는 nullable 이다(접수 건 영구 삭제 시 SET NULL). inArray 가
    // 이미 걸러 내지만 타입을 좁히기 위해 확인한다.
    if (row.repairCaseId === null) continue;
    const bucket = byCaseId.get(row.repairCaseId);
    if (bucket) bucket.push(row.dueDate);
    else byCaseId.set(row.repairCaseId, [row.dueDate]);
  }
  return byCaseId;
}
