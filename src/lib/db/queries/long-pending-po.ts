import "server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../client";
import { domesticOrders, repairCases, workflowSteps } from "../schema";
import { isLongPendingPo } from "@/lib/domain/long-pending-po";
import type { WeeklyReportOrderDates } from "@/lib/domain/weekly-report";

/**
 * ============================================================================
 * 장기 PO 미발행 — 읽는 쪽
 * ============================================================================
 * **SELECT 만 있다.** `전체 A/S 현황`의 체크박스가 대조할 접수 건 id 묶음을
 * 만드는 것이 전부다.
 *
 * ── 여기서는 판정하지 않는다 ────────────────────────────────────────────
 * "두 달이 지났는가"도 "어느 내자 줄을 볼 것인가"도 SQL 로 적지 않고
 * domain/long-pending-po.ts 의 순수 함수(isLongPendingPo)가 정한다 — 주간보고
 * 조회가 같은 판단을 한 이유와 같다(queries/weekly-report.ts 헤더). SQL 의
 * date 연산으로 접으면 그 규칙을 시험할 자리가 사라지고, 무엇보다 **주간보고와
 * 다른 규칙이 조용히 생긴다**.
 *
 * ── 후보는 내자 줄에서 나온다 ───────────────────────────────────────────
 * 견적서가 없으면 기다릴 PO 도 없으므로, 내자 줄이 하나도 없는 접수 건은
 * 애초에 후보가 아니다. 그래서 접수 건 전부를 훑지 않고 **내자 줄을 먼저 읽어**
 * 거기 붙은 접수 건만 상태를 묻는다.
 *
 * ── 조인하지 않고 두 번 읽는다 ──────────────────────────────────────────
 * 한 접수 건에 내자 줄이 여럿이라 그대로 조인하면 그 건이 여러 번 나온다
 * (분할 발주·추가 발주). 주간보고 조회가 같은 이유로 내자를 따로 읽는다.
 * 질의는 두 번이고, 건마다 따로 묻지 않는다(N+1 없음).
 *
 * `is_deleted = false` 인 내자 줄만 본다 — 지워진 줄의 발주일이 판정을 막거나,
 * 지워진 줄의 견적일이 판정을 만들어 내면 안 된다.
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * 이 조회는 id 와 날짜만 읽는다. 사람 이름도 연락처도 나오지 않는다.
 * ============================================================================
 */

/**
 * 지금 **장기 PO 미발행**인 접수 건의 id — 인수번호 오름차순.
 *
 * `now` 를 인자로 받는 것은 시험을 위해서만이 아니다. 오늘이 언제인지는
 * **서버가 정해야** 하고(한국 날짜), 화면이 스스로 new Date() 를 만들면 서버가
 * 그린 것과 달라져 hydration 이 어긋난다.
 *
 * 휴지통(`repair_cases.is_deleted`)에 든 건은 빠진다 — 목록에 없는 건의 id 를
 * 내려보내 봐야 대조될 일이 없고, 묶음의 뜻만 흐려진다.
 */
export async function listLongPendingPoCaseIds(now: Date = new Date()): Promise<string[]> {
  // 후보의 출발점. repair_case_id 는 nullable 이므로(접수 건 영구 삭제 시
  // SET NULL) 연결이 끊긴 정산 줄은 애초에 묻지 않는다 — 그런 줄은 대조할
  // 접수 건이 없다.
  const orderRows = await db
    .select({
      repairCaseId: domesticOrders.repairCaseId,
      quoteIssuedDate: domesticOrders.quoteIssuedDate,
      orderIssuedDate: domesticOrders.orderIssuedDate,
    })
    .from(domesticOrders)
    .where(and(eq(domesticOrders.isDeleted, false), isNotNull(domesticOrders.repairCaseId)));

  const orderRowsByCaseId = new Map<string, WeeklyReportOrderDates[]>();
  for (const row of orderRows) {
    // isNotNull 이 이미 걸러 내지만 타입을 좁히기 위해 확인한다.
    if (row.repairCaseId === null) continue;
    const item: WeeklyReportOrderDates = {
      quoteIssuedDate: row.quoteIssuedDate,
      orderIssuedDate: row.orderIssuedDate,
    };
    const bucket = orderRowsByCaseId.get(row.repairCaseId);
    if (bucket) bucket.push(item);
    else orderRowsByCaseId.set(row.repairCaseId, [item]);
  }

  // inArray 에 빈 배열을 넘기면 뜻 없는 SQL 이 만들어진다(주간보고 조회와 같은 규칙).
  if (orderRowsByCaseId.size === 0) return [];

  // 출하 완료 판정에 쓰는 평탄화 상태. 여기서 걸러 내지 않고 그대로 실어
  // 넘긴다 — 무엇을 빼는지는 도메인의 isExcludedFromWeeklyReport 하나가 정한다.
  const caseRows = await db
    .select({ id: repairCases.id, status: workflowSteps.repairStatus })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .where(
      and(eq(repairCases.isDeleted, false), inArray(repairCases.id, [...orderRowsByCaseId.keys()]))
    )
    // 정렬 없는 SELECT 는 순서를 보장하지 않는다. 묶음 자체는 순서를 쓰지
    // 않지만, 같은 자료에서 늘 같은 결과가 나와야 시험이 흔들리지 않는다.
    .orderBy(asc(repairCases.intakeNumber));

  return caseRows
    .filter((row) =>
      isLongPendingPo({ status: row.status, orderRows: orderRowsByCaseId.get(row.id) ?? [] }, now)
    )
    .map((row) => row.id);
}
