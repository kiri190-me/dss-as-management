import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "../client";
import { repairCases, workflowSteps } from "../schema";
import { isDueDateOverdue, isRepairCaseOverdue } from "@/lib/domain/repair-case-overdue";
import { resolveRepairCaseRequestedDueDate } from "@/lib/domain/requested-due-date-link";
import { isRepairCaseShipmentFinished } from "@/lib/domain/shipment-finished";
import type { RepairStatus } from "@/lib/domain/types";
import {
  dueDateBorrowerIds,
  loadDomesticOrderDueDatesByCaseId,
} from "./repair-case-domestic-order-due-dates";

/**
 * ============================================================================
 * 납기 지연 — 종 알림 「납기 지연」의 원본 (2026-11-07)
 * ============================================================================
 * **SELECT 만 있다.** 이 파일은 아무것도 쓰지 않고, 쓸 표도 만들지 않는다 —
 * 알림은 저장되지 않고 매 요청마다 업무 데이터에서 다시 계산된다
 * (domain/notifications.ts 머리말). 그래서 그 건이 나가거나 날짜를 다시 잡으면 다음
 * 조회에서 저절로 빠지고, 되돌리면 저절로 돌아온다. 「납기 임박」·「납기 역전」 조회와
 * **같은 모양으로** 적었다 — 다음 사람이 셋을 나란히 읽을 수 있어야 한다.
 *
 * ── 🔴 판정을 여기서 새로 적지 않는다 ───────────────────────────────────
 * 뜨는 조건은 도메인의 isRepairCaseOverdue 하나다(domain/repair-case-overdue.ts) —
 * 곧 **전체 A/S 현황의 표·카드와 수리 건 상세 머리 카드에 「납기 지연」 배지를 세우는
 * 바로 그 함수**다. 그 함수 안에 세 겹이 이미 들어 있다:
 *   ① 출하 완료 거르기 — 이미 나간 건에는 안 뜬다(isRepairCaseShipmentFinished).
 *   ② 빌려 오기 — 고객 요청 납기일 칸이 비면 연결된 내자의 납기요청일 중 가장
 *      이른 하루로 잰다(resolveRepairCaseRequestedDueDate). 2026-11-07 사용자 요구.
 *   ③ 핵심 비교 — 그 날짜 < 오늘(한국 달력). 납기일 **당일**은 아직 지연이 아니다.
 * 셋을 SQL 로 옮기면 **배지는 떴는데 종은 조용하거나 그 반대인** 날이 온다. 그 함수가
 * 존재하는 이유가 그것이다.
 *
 * 🔴 **사내 목표 완료일을 보지 않는다**(2026-11-03 사용자 결정). 이 조회가 그 칸을
 * 아예 읽지 않는 것이 그 결정의 가장 단단한 표현이다 — 읽지 않으면 섞일 수가 없다.
 *
 * ── 누구에게 가는가 — **역할이 여기서 갈리지 않는다** ───────────────────
 * 🔴 받는 사람은 **전원**이다(2026-11-07). 그 결정은 이 조회가 아니라 알림 설정의
 * 역할 기본값이 담는다(domain/notification-settings.ts 의
 * defaultRoleReceivesNotification — 그 case 에 까닭 둘). 그래서 이 조회는 사용자 id 도
 * 역할도 받지 않고, 사람마다 결과가 달라지지도 않는다.
 *
 * ── 「오늘」을 본다 ─────────────────────────────────────────────────────
 * 「납기 역전」 조회는 `now` 를 받지 않지만 이쪽은 받는다 — 지연은 **시간이 흐르면
 * 저절로 켜지는 경보**라 「오늘이 언제인가」가 답을 바꾼다(「납기 임박」과 같다).
 * 시험이 경계를 박아 넣을 수 있어야 「오늘」에 따라 결과가 달라지는 시험이 되지 않는다.
 * 운영에서는 넘기지 않으며, 그때 「오늘」은 **서버의 한국 날짜**다(domain/date-only.ts).
 *
 * ── 빼는 것 셋 ──────────────────────────────────────────────────────────
 *  · 휴지통에 든 건(`repair_cases.is_deleted`) — 목록에도 없는 건을 챙기라는
 *    알림은 할 일이 아니다. 종 알림 셋이 모두 같은 조건을 건다.
 *  · 이미 나간 건 — 평탄화 상태가 `SHIPMENT_COMPLETED` 이거나 실제 출하일이
 *    찍힌 건. 판정은 SQL 이 아니라 도메인이 한다(위 ①).
 *  · 아직 안 지난 건 — 판정이 한다(위 ③).
 * 🔵 「납기 역전」이 `IS NOT NULL` 로 한 겹 좁히던 자리가 여기는 **없다.** 좁힐 만한
 *    칸이 고객 요청 납기일 하나인데, 그 칸이 **빈 건이야말로 내자에서 빌려 와야 하는
 *    건**이라(2026-11-07 결함의 본체) SQL 로 걸러 내면 고치려던 것을 도로 끈다.
 *
 * ── 조인하지 않고 따로 읽는다 ───────────────────────────────────────────
 * 한 수리 건에 내자 줄이 여럿이고(분할 발주) 줄 하나에 날짜가 또 여럿이다(분할
 * 납품). 그대로 조인하면 그 건이 날짜 수만큼 복제되어 종에 같은 알림이 여러 줄로
 * 선다. 그 두 번째 읽기는 이 파일이 갖고 있지 않다 — 목록 둘·건 하나 조회·알림 둘이
 * 쓰는 공용 조각을 그대로 부른다(queries/repair-case-domestic-order-due-dates.ts).
 * 「자기 칸이 적힌 건은 내자를 읽지 않는다」는 좁히기도 그 파일에 함께 있다
 * (dueDateBorrowerIds).
 *
 * ── 🔴 이 조회는 **모든 화면의 머리말**에서 돈다 ────────────────────────
 * 레지스트리는 각 load 를 try/catch 로 감싸지 않는다(queries/notifications.ts 의
 * listMyNotifications — Promise.all 그대로다). 여기서 던지면 종이 비는 것이 아니라
 * **그 화면이 통째로 못 그려진다.** 그래서 읽는 칸을 알림 한 줄에 필요한 것으로만
 * 묶고(접수 건 id · 인수번호 · 납기 칸 · 출하 칸 · 평탄화 상태), 던질 수 있는 계산을
 * 하지 않는다.
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * id · 인수번호 · 날짜만 읽는다. 고객사도 사람 이름도 연락처도 나오지 않는다.
 * ============================================================================
 */

/** 종 알림 「납기 지연」 한 줄의 원본. */
export type RepairCaseOverdueRow = {
  repairCaseId: string;
  intakeNumber: string;
  /** 화면에 보이는 그 고객 요청 납기일("YYYY-MM-DD"). 이미 지났다고 가려진 값이다. */
  dueDate: string;
  /** 이 건의 칸이 아니라 연결된 내자 정리에서 빌려 온 날짜인가. */
  borrowed: boolean;
};

/** 판정에 필요한 칸만 모은 접수 건 한 줄 + 그 건이 빌려 올 내자 납기요청일 전부. */
type CandidateRow = {
  id: string;
  intakeNumber: string;
  customerRequestedDueDate: string | null;
  actualShipmentDate: string | null;
  /** 평탄화된 지금 상태. 단계에 안 적혀 있으면 `null` — 「아직 안 나갔다」로 본다. */
  status: RepairStatus | null;
  domesticOrderDueDates: string[];
};

type OverdueOptions = {
  /** 「오늘」을 잴 기준 시각. 시험이 경계를 박아 넣는다. 기본은 지금이다. */
  now?: Date;
};

/**
 * 살아 있는 접수 건 전부 — 인수번호 오름차순. 지연 판정은 아직 하나도 하지 않는다
 * (빌려 올 날짜까지 모아 주기만 한다).
 *
 * 🔴 **세는 도구와 알림이 같은 자료를 본다**(아래 두 export 가 이 함수 하나를 나눠
 * 쓴다). 세는 길을 따로 적어 두면 「운영에서 몇 건이 뜨는가」를 재 놓고 실제로 다른
 * 수가 종에 뜨는 일이 생긴다 — 그러면 그 수를 보고 내린 판단이 통째로 틀린다
 * (queries/repair-case-due-date-inverted-notifications.ts 의 같은 판단).
 */
async function loadCandidates(): Promise<CandidateRow[]> {
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
    // 정렬 없는 SELECT 는 순서를 보장하지 않는다. 종 패널의 줄 차례가 새로 고칠
    // 때마다 흔들리지 않게 인수번호로 세운다(납기 임박·역전과 같은 차례).
    .orderBy(asc(repairCases.intakeNumber));

  // 🔵 이미 나간 건을 **먼저 뺀 뒤** 내자를 읽는다 — 끝난 건의 날짜까지 읽을 이유가
  //    없다(queries/repair-cases-mine.ts 가 같은 자리에서 같은 차례를 쓴다).
  //    판정은 아래에서 도메인이 처음부터 다시 한다. 여기 것은 질의를 줄이는 좁히기다.
  const live = caseRows.filter((row) => !isRepairCaseShipmentFinished(row));
  // 자기 칸이 비어 있는 건만 내자에서 빌린다(공용 조각의 dueDateBorrowerIds).
  const dueDatesByCaseId = await loadDomesticOrderDueDatesByCaseId(dueDateBorrowerIds(live));

  return live.map((row) => ({
    ...row,
    domesticOrderDueDates: dueDatesByCaseId.get(row.id) ?? [],
  }));
}

/**
 * 고객 요청 납기일이 **이미 지났고 아직 안 나간** 수리 건 전부 — 인수번호 오름차순.
 *
 * 인자는 「오늘」하나뿐이다(파일 머리말) — 사람마다 결과가 달라지지 않는다.
 */
export async function listRepairCasesOverdue(
  options: OverdueOptions = {}
): Promise<RepairCaseOverdueRow[]> {
  const now = options.now ?? new Date();
  const candidates = await loadCandidates();

  const items: RepairCaseOverdueRow[] = [];
  for (const row of candidates) {
    // 🔴 뜰지 말지는 **이 한 줄**이 정한다. 배지를 세우는 바로 그 함수다.
    if (!isRepairCaseOverdue(row, now)) continue;

    // 알림 한 줄에 적을 날짜를 구한다 — 판정이 아니라 **표시할 값**이다. 저 함수가
    // 제 안에서 부르는 것과 **같은 함수에 같은 재료**라 둘이 갈라질 수 없다.
    // (「납기 임박」·「납기 역전」 조회도 같은 자리에서 같은 방법을 쓴다.)
    const { dueDate, borrowed } = resolveRepairCaseRequestedDueDate({
      customerRequestedDueDate: row.customerRequestedDueDate,
      domesticOrderDueDates: row.domesticOrderDueDates,
    });
    // 판정이 참이면 날짜가 있다(없으면 거짓이다). 타입을 좁히려는 것뿐이다.
    if (dueDate === null) continue;

    items.push({ repairCaseId: row.id, intakeNumber: row.intakeNumber, dueDate, borrowed });
  }
  return items;
}

/** 조건을 하나씩 걸었을 때 남는 건수 — 세는 도구가 찍는다. */
export type RepairCaseOverdueStageCounts = {
  /** ① 아직 안 나간 건(휴지통 제외). */
  live: number;
  /** ② ① 가운데 **제 칸에** 고객 요청 납기일이 적힌 건. */
  withOwnDueDate: number;
  /** ③ ① 가운데 제 칸이 비어 **내자에서 빌려 온** 날짜가 있는 건. */
  withBorrowedDueDate: number;
  /** ④ ② 가운데 그 날짜가 지난 건 — **고치기 전에도 뜨던 수**. */
  overdueByOwnDueDate: number;
  /** ⑤ ③ 가운데 그 날짜가 지난 건 — 🔴 **이번에 새로 뜨는 수**. */
  overdueByBorrowedDueDate: number;
  /** ⑥ ④ + ⑤ — **고친 뒤 실제로 뜨는 수**. */
  overdueTotal: number;
};

/**
 * 조건을 하나씩 거는 동안 건수가 어떻게 줄어드는지 — **읽기만 한다.**
 *
 * 🔴 **왜 앱 코드에 두는가.** 이 변경은 **지금까지 조용하던 건들에 경보를 한꺼번에
 * 켜는** 일이다(배지도 종도). 그러니 올리기 전에 「④ → ⑥ 으로 몇 건이 느는가」를
 * 알아야 하는데, 운영 DB 에 직접 붙지 않고 그 수를 보려면 **앱이 쓰는 그 길로** 세는
 * 수밖에 없다. 세는 SQL 을 도구 쪽에 따로 적으면 종에 뜨는 수와 조용히 달라지고,
 * 그때는 틀린 수를 보고 판단하게 된다. 찍는 일은 도구가 한다
 * (scripts/check-due-date-overdue.ts).
 *
 * 🔵 ⑥ 은 listRepairCasesOverdue 가 내놓는 줄 수와 **언제나 같다** — 같은 후보 묶음에
 * 같은 판정을 걸기 때문이고, 도구가 그것을 맞대어 본다.
 *
 * 🔴 **단계를 가르느라 조건을 베껴 적지 않는다.** ②③ 은 화면이 쓰는 빌려 오기 함수의
 * `borrowed` 를 그대로 읽고, ④⑤ 는 판정이 제 안에서 쓰는 핵심 비교(isDueDateOverdue)를
 * 그대로 부른다. ① 은 후보를 모으는 함수가 이미 걸러 둔 것이다(파일 머리말).
 *
 * 🔴 ④ 가 「고치기 전에도 뜨던 수」인 것은 **2026-11-07 이전 규칙이 제 칸만 봤기**
 * 때문이다 — 그 규칙은 지금 코드 어디에도 없으므로, 이 수는 옛 코드를 되살려 재는
 * 것이 아니라 **빌려 오지 않은 건만 세어** 같은 답을 내는 것이다.
 */
export async function countRepairCaseOverdueStages(): Promise<RepairCaseOverdueStageCounts> {
  const now = new Date();
  const candidates = await loadCandidates();

  const resolved = candidates.map((row) => ({
    ...resolveRepairCaseRequestedDueDate({
      customerRequestedDueDate: row.customerRequestedDueDate,
      domesticOrderDueDates: row.domesticOrderDueDates,
    }),
  }));

  const own = resolved.filter((entry) => entry.dueDate !== null && !entry.borrowed);
  const borrowed = resolved.filter((entry) => entry.dueDate !== null && entry.borrowed);
  const overdueByOwn = own.filter((entry) => isDueDateOverdue(entry.dueDate, now));
  const overdueByBorrowed = borrowed.filter((entry) => isDueDateOverdue(entry.dueDate, now));

  return {
    live: candidates.length,
    withOwnDueDate: own.length,
    withBorrowedDueDate: borrowed.length,
    overdueByOwnDueDate: overdueByOwn.length,
    overdueByBorrowedDueDate: overdueByBorrowed.length,
    overdueTotal: overdueByOwn.length + overdueByBorrowed.length,
  };
}
