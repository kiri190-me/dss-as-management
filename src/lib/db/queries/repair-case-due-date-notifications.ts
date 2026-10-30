import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "../client";
import { repairCases, workflowSteps } from "../schema";
import { isRepairCaseDueDateWithinNotificationWindow } from "@/lib/domain/notifications";
import { resolveRepairCaseRequestedDueDate } from "@/lib/domain/requested-due-date-link";
import { isRepairCaseShipmentFinished } from "@/lib/domain/shipment-finished";
import {
  dueDateBorrowerIds,
  loadDomesticOrderDueDatesByCaseId,
} from "./repair-case-domestic-order-due-dates";

/**
 * ============================================================================
 * 납기 임박 — 종 알림 「고객 요청 납기일이 다가왔다」의 원본
 * ============================================================================
 * **SELECT 만 있다.** 이 파일은 아무것도 쓰지 않고, 쓸 표도 만들지 않는다 —
 * 알림은 저장되지 않고 매 요청마다 업무 데이터에서 다시 계산된다
 * (domain/notifications.ts 머리말).
 *
 * ── 누구에게 가는가 — 모두에게 ──────────────────────────────────────────
 * 🔴 역할을 보지 않는다(2026-10-19 사용자 결정). 재고 부족처럼 「상태가 그러한
 * 것」이지만 받을 사람을 정하는 축이 없다 — 납기가 다가온 건은 엔지니어·관리자·
 * 영업·재고 담당자에게 각자 다른 모양으로 걸린다. 그래서 load 가 역할을 받지도
 * 않고, 좁히는 일은 알림 설정 화면이 한다
 * (domain/notification-settings.ts 의 defaultRoleReceivesNotification).
 * 이 조회는 사용자별로 결과가 달라지지 않으므로 인자도 받지 않는다.
 *
 * ── 「화면에 보이는 날짜」로 판단한다 ───────────────────────────────────
 * 🔴 수리 건의 `customer_requested_due_date` 가 비어 있어도, 연결된 내자 정리의
 * 납기요청일이 있으면 **그것으로 친다.** 상세정보 화면이 이미 그렇게 그리고
 * 있어서(components/repair-cases/detail/IntakeInfoSection.tsx), 화면에는 날짜가
 * 보이는데 알림만 안 뜨는 일이 없어야 한다는 것이 승인된 결정이다.
 *
 * 그 규칙을 여기서 새로 짓지 않는다 — 화면이 쓰는 바로 그 함수
 * (domain/requested-due-date-link.ts 의 resolveRepairCaseRequestedDueDate)를
 * 그대로 부른다. 그 함수는 다시 주간보고 `입고 요청일` 과 같은 pickEarliestDueDate
 * 로 여럿 중 하나를 고르므로, 세 화면이 한 건에 대해 같은 날짜를 말한다. SQL 의
 * min() 으로 접으면 그 사슬이 끊기고, 어긋나도 아무 데서도 드러나지 않는다
 * (queries/weekly-report-deliveries.ts · queries/long-pending-po.ts 의 같은 판단).
 *
 * **양쪽 어디에도 날짜가 없으면 뜨지 않는다** — 그 함수가 `null` 을 주고,
 * isRepairCaseDueDateWithinNotificationWindow 가 `null` 을 거짓으로 돌려준다.
 *
 * ── 빼는 것 셋 ──────────────────────────────────────────────────────────
 *  · 휴지통에 든 건(`repair_cases.is_deleted`) — 목록에도 없는 건을 챙기라는
 *    알림은 할 일이 아니다. 결재 대기·결재 결과·장기 PO 미발행이 모두 같은
 *    조건을 건다.
 *  · 이미 나간 건 — 평탄화 상태가 `SHIPMENT_COMPLETED` 이거나 실제 출하일이
 *    찍힌 건. 판정은 SQL 이 아니라 도메인의 isRepairCaseShipmentFinished 가
 *    하고, 그 함수가 보는 두 사실은 「납기 지연」을 가리는 isRepairCaseOverdue
 *    가 보는 바로 그 둘이다(그 함수의 주석).
 *  · 창 밖 — 오늘보다 이르거나(이미 지난 납기) 오늘 + 7일보다 늦은 날짜.
 *    🔴 **지난 납기는 이 알림의 범위가 아니다**(domain/notifications.ts 의
 *    isRepairCaseDueDateWithinNotificationWindow 주석).
 *
 * ── 조인하지 않고 두 번 읽는다 ──────────────────────────────────────────
 * 한 수리 건에 내자 줄이 여럿이고(분할 발주) 줄 하나에 날짜가 또 여럿이다
 * (분할 납품). 그대로 조인하면 그 건이 날짜 수만큼 복제되어 알림이 여러 줄로
 * 선다. 그래서 접수 건을 먼저 읽고 날짜는 **따로 한 번** 읽어 건마다 묶는다.
 *
 * 🔴 그 두 번째 읽기는 이 파일이 갖고 있지 않다 — 목록 둘(전체 A/S 현황 ·
 * 내 작업)이 2026-10-19 에 같은 것을 쓰게 되면서 공용 조각으로 옮겼다
 * (queries/repair-case-domestic-order-due-dates.ts). 세 곳이 각자 SQL 을 들고
 * 있으면 한 곳만 고쳐지는 날 **같은 건이 화면마다 다른 날짜로** 보인다.
 * 「빌릴 건만 묻는다 · 빌릴 건이 없으면 질의가 아예 돌지 않는다」는 좁히기도
 * 그 파일(dueDateBorrowerIds)에 함께 있다.
 *
 * ── 🔴 이 조회는 **모든 화면의 머리말**에서 돈다 ────────────────────────
 * 레지스트리는 각 load 를 try/catch 로 감싸지 않는다(queries/notifications.ts 의
 * listMyNotifications — Promise.all 그대로다). 여기서 던지면 종이 비는 것이
 * 아니라 **그 화면이 통째로 못 그려진다.** 그래서 읽는 칸을 알림 한 줄에 필요한
 * 것으로만 묶고(접수 건 id · 인수번호 · 납기 칸 · 출하 칸 · 평탄화 상태), 던질
 * 수 있는 계산을 하지 않는다.
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * id · 인수번호 · 날짜만 읽는다. 연락처 스냅샷도 사람 이름도 나오지 않는다.
 * ============================================================================
 */

/** 종 알림 「납기 임박」 한 줄의 원본. */
export type RepairCaseDueDateNearRow = {
  repairCaseId: string;
  intakeNumber: string;
  /** 화면에 보이는 그 날짜("YYYY-MM-DD"). 창 안이라고 이미 가려진 값이다. */
  dueDate: string;
  /** 이 건의 칸이 아니라 연결된 내자 정리에서 빌려 온 날짜인가. */
  borrowed: boolean;
};

type DueDateNearOptions = {
  /** 창을 잴 기준 시각. 시험이 창의 경계를 보려고 넘긴다. 기본은 지금이다. */
  now?: Date;
};

/**
 * 고객 요청 납기일이 **오늘부터 7일 안으로** 다가온 수리 건 전부 — 인수번호
 * 오름차순.
 *
 * `now` 를 옵션으로 받는 이유는 결재 결과 조회와 같다
 * (queries/approval-outcome-notifications.ts) — 시험이 창의 경계를 박아 넣어야
 * 「오늘이 언제인가」에 따라 결과가 달라지지 않는다. 운영에서는 넘기지 않으며,
 * 그때 「오늘」은 **서버의 한국 날짜**다(domain/date-only.ts).
 */
export async function listRepairCasesWithDueDateNear(
  options: DueDateNearOptions = {}
): Promise<RepairCaseDueDateNearRow[]> {
  const now = options.now ?? new Date();

  const caseRows = await db
    .select({
      id: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      customerRequestedDueDate: repairCases.customerRequestedDueDate,
      actualShipmentDate: repairCases.actualShipmentDate,
      // 평탄화 상태는 저장된 칸이 아니라 지금 놓인 단계에서 온다
      // (mappers/repair-status.ts · queries/long-pending-po.ts 와 같은 조인).
      status: workflowSteps.repairStatus,
    })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .where(eq(repairCases.isDeleted, false))
    // 정렬 없는 SELECT 는 순서를 보장하지 않는다. 종 패널의 줄 차례가 새로
    // 고칠 때마다 흔들리지 않게 인수번호로 세운다(결재 대기 목록과 같은 차례).
    .orderBy(asc(repairCases.intakeNumber));

  // 이미 나간 건을 먼저 뺀다 — 판정은 도메인의 순수 함수가 한다(파일 머리말).
  const live = caseRows.filter((row) => !isRepairCaseShipmentFinished(row));
  if (live.length === 0) return [];

  // 자기 칸이 비어 있는 건만 내자에서 빌린다(공용 조각의 dueDateBorrowerIds).
  const dueDatesByCaseId = await loadDomesticOrderDueDatesByCaseId(dueDateBorrowerIds(live));

  const items: RepairCaseDueDateNearRow[] = [];
  for (const row of live) {
    const { dueDate, borrowed } = resolveRepairCaseRequestedDueDate({
      customerRequestedDueDate: row.customerRequestedDueDate,
      domesticOrderDueDates: dueDatesByCaseId.get(row.id) ?? [],
    });
    if (!isRepairCaseDueDateWithinNotificationWindow(dueDate, now)) continue;
    // 창 안이면 날짜가 있다(위 함수가 null 을 거른다). 타입을 좁히려는 것뿐이다.
    if (dueDate === null) continue;
    items.push({ repairCaseId: row.id, intakeNumber: row.intakeNumber, dueDate, borrowed });
  }
  return items;
}
