import "server-only";

import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "../client";
import { repairCases, workflowSteps } from "../schema";
import { foldBlankToNull } from "@/lib/domain/domestic-order-list";
import { isDueDateInverted, isRepairCaseDueDateInverted } from "@/lib/domain/due-date-inversion";
import { isRepairCaseShipmentFinished } from "@/lib/domain/notifications";
import { resolveRepairCaseRequestedDueDate } from "@/lib/domain/requested-due-date-link";
import type { RepairStatus } from "@/lib/domain/types";
import {
  dueDateBorrowerIds,
  loadDomesticOrderDueDatesByCaseId,
} from "./repair-case-domestic-order-due-dates";

/**
 * ============================================================================
 * 납기 역전 — 종 알림 「납기 요청일 협의가 필요합니다.」의 원본
 * ============================================================================
 * **SELECT 만 있다.** 이 파일은 아무것도 쓰지 않고, 쓸 표도 만들지 않는다 —
 * 알림은 저장되지 않고 매 요청마다 업무 데이터에서 다시 계산된다
 * (domain/notifications.ts 머리말). 그래서 두 날짜 중 하나를 고치면 다음 조회에서
 * 저절로 빠지고, 되돌리면 저절로 돌아온다. 「납기 임박」 조회
 * (queries/repair-case-due-date-notifications.ts)와 **같은 모양으로** 적었다 —
 * 다음 사람이 둘을 나란히 읽을 수 있어야 한다.
 *
 * ── 🔴 판정을 여기서 새로 적지 않는다 ───────────────────────────────────
 * 뜨는 조건은 도메인의 isRepairCaseDueDateInverted 하나다
 * (domain/due-date-inversion.ts). 그 함수 안에 세 겹이 이미 들어 있다:
 *   ① 빌려 오기 — 고객 요청 납기일 칸이 비면 연결된 내자의 납기요청일 중 가장
 *      이른 하루로 잰다(resolveRepairCaseRequestedDueDate).
 *   ② 핵심 비교 — 사내 목표 출하일 > 고객 요청 납기일. 같은 날은 역전이 아니고,
 *      한쪽이라도 비면 거짓이다(isDueDateInverted).
 *   ③ 출하 완료 거르기 — 이미 나간 건에는 안 뜬다(isRepairCaseShipmentFinished).
 * 셋을 SQL 로 옮기면 화면 셋(수리 건 상세 · A/S 내자 정리 · PO 내자 정리)과 종이
 * **같은 건을 두고 다른 말을 하는 날**이 온다. 그 파일이 존재하는 이유가 그것이다.
 *
 * ── 누구에게 가는가 — **역할이 여기서 갈리지 않는다** ───────────────────
 * 🔴 받는 사람은 A/S 엔지니어·영업·관리자다(2026-10-30 사용자 결정). 그런데 그
 * 좁히기는 이 조회가 하지 않는다 — 알림 설정의 역할 기본값이 한다
 * (domain/notification-settings.ts 의 defaultRoleReceivesNotification). 까닭 셋이
 * 그 case 주석에 적혀 있고, 요약하면 이렇다: 싣는 것이 인수번호와 날짜 둘뿐이라
 * **인가 경계가 아니고**, 조회에 역할을 박으면 설정 화면의 역할 스위치가 죽은
 * 단추가 되며, 최고관리자 잠금이 화면에서 거짓말이 된다. 그래서 이 조회는 사용자
 * id 도 역할도 받지 않고, 사람마다 결과가 달라지지도 않는다.
 *
 * ── 「오늘」을 보지 않는다 ───────────────────────────────────────────────
 * 「납기 임박」 조회는 창을 재느라 `now` 를 옵션으로 받지만 이 조회는 받지 않는다 —
 * 역전은 두 날을 적는 순간 정해지고 내일이 된다고 달라지지 않는다
 * (domain/due-date-inversion.ts 머리말의 세 판정 비교). 그래서 시험이 박아 넣을
 * 「오늘」도 없다.
 *
 * ── 빼는 것 셋 ──────────────────────────────────────────────────────────
 *  · 휴지통에 든 건(`repair_cases.is_deleted`) — 목록에도 없는 건을 협의하라는
 *    알림은 할 일이 아니다. 결재 대기·납기 임박·사내 목표 출하일 미등록이 모두
 *    같은 조건을 건다.
 *  · 이미 나간 건 — 판정은 SQL 이 아니라 도메인이 한다(위 ③).
 *  · 사내 목표 출하일이 비어 있는 건 — 역전은 **두 날짜가 다 있어야** 성립한다.
 *    🔵 이 하나만 SQL 로도 좁힌다(`IS NOT NULL`). 규칙을 SQL 로 옮긴 것이 **아니고**
 *    (도메인이 공백까지 접어 다시 본다 — foldBlankToNull), 날짜를 아직 안 잡은 건이
 *    후보의 대부분이라 질의와 뒤이은 내자 읽기를 가볍게 하려는 것이다. 어긋날 수
 *    있는 쪽은 공백만 적힌 값뿐인데 `date` 칸이라 들어올 수 없고, 들어오더라도
 *    도메인이 「없음」으로 접어 알림을 끈다(알림이 더 뜨는 방향이 아니다).
 *
 * ── 조인하지 않고 따로 읽는다 ───────────────────────────────────────────
 * 한 수리 건에 내자 줄이 여럿이고(분할 발주) 줄 하나에 날짜가 또 여럿이다(분할
 * 납품). 그대로 조인하면 그 건이 날짜 수만큼 복제되어 종에 같은 알림이 여러 줄로
 * 선다. 그 두 번째 읽기는 이 파일이 갖고 있지 않다 — 「납기 임박」과 목록 둘이
 * 쓰는 공용 조각을 그대로 부른다(queries/repair-case-domestic-order-due-dates.ts).
 * 네 곳이 각자 SQL 을 들고 있으면 한 곳만 고쳐지는 날 **같은 건이 화면마다 다른
 * 날짜로** 보인다. 「자기 칸이 적힌 건은 내자를 읽지 않는다」는 좁히기도 그 파일에
 * 함께 있다(dueDateBorrowerIds).
 *
 * ── 🔴 이 조회는 **모든 화면의 머리말**에서 돈다 ────────────────────────
 * 레지스트리는 각 load 를 try/catch 로 감싸지 않는다(queries/notifications.ts 의
 * listMyNotifications — Promise.all 그대로다). 여기서 던지면 종이 비는 것이 아니라
 * **그 화면이 통째로 못 그려진다.** 그래서 읽는 칸을 알림 한 줄에 필요한 것으로만
 * 묶고(접수 건 id · 인수번호 · 납기 칸 둘 · 출하 칸 · 평탄화 상태), 던질 수 있는
 * 계산을 하지 않는다.
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * id · 인수번호 · 날짜만 읽는다. 고객사도 사람 이름도 연락처도 나오지 않는다.
 * ============================================================================
 */

/** 종 알림 「납기 역전」 한 줄의 원본. */
export type RepairCaseDueDateInvertedRow = {
  repairCaseId: string;
  intakeNumber: string;
  /** 그 건의 사내 목표 출하일("YYYY-MM-DD"). 「적혀 있다」를 이미 가린 값이다. */
  internalTargetShipmentDate: string;
  /** 화면에 보이는 그 고객 요청 납기일("YYYY-MM-DD"). 빌려 온 값일 수 있다. */
  requestedDueDate: string;
  /** 이 건의 칸이 아니라 연결된 내자 정리에서 빌려 온 날짜인가. */
  borrowed: boolean;
};

/** 판정에 필요한 칸만 모은 접수 건 한 줄 + 그 건이 빌려 올 내자 납기요청일 전부. */
type CandidateRow = {
  id: string;
  intakeNumber: string;
  internalTargetShipmentDate: string | null;
  customerRequestedDueDate: string | null;
  actualShipmentDate: string | null;
  /** 평탄화된 지금 상태. 단계에 안 적혀 있으면 `null` — 「아직 안 나갔다」로 본다. */
  status: RepairStatus | null;
  domesticOrderDueDates: string[];
};

/**
 * 사내 목표 출하일이 적힌 살아 있는 접수 건 전부 — 인수번호 오름차순. 역전 판정은
 * 아직 하나도 하지 않는다(빌려 올 날짜까지 모아 주기만 한다).
 *
 * 🔴 **세는 도구와 알림이 같은 자료를 본다**(아래 두 export 가 이 함수 하나를 나눠
 * 쓴다). 세는 길을 따로 적어 두면 「운영에서 몇 건이 뜨는가」를 재 놓고 실제로 다른
 * 수가 종에 뜨는 일이 생긴다 — 그러면 그 수를 보고 내린 판단이 통째로 틀린다.
 */
async function loadCandidates(): Promise<CandidateRow[]> {
  const caseRows = await db
    .select({
      id: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      internalTargetShipmentDate: repairCases.internalTargetShipmentDate,
      customerRequestedDueDate: repairCases.customerRequestedDueDate,
      actualShipmentDate: repairCases.actualShipmentDate,
      // 평탄화 상태는 저장된 칸이 아니라 지금 놓인 단계에서 온다
      // (mappers/repair-status.ts · queries/long-pending-po.ts 와 같은 조인).
      status: workflowSteps.repairStatus,
    })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .where(
      and(
        eq(repairCases.isDeleted, false),
        // 파일 머리말의 「빼는 것 셋」 세 번째 — 질의를 가볍게 하려는 좁히기이고
        // 규칙을 SQL 로 옮긴 것이 아니다. 판정은 아래에서 도메인이 다시 한다.
        isNotNull(repairCases.internalTargetShipmentDate)
      )
    )
    // 정렬 없는 SELECT 는 순서를 보장하지 않는다. 종 패널의 줄 차례가 새로 고칠
    // 때마다 흔들리지 않게 인수번호로 세운다(납기 임박·결재 대기와 같은 차례).
    .orderBy(asc(repairCases.intakeNumber));

  // 자기 칸이 비어 있는 건만 내자에서 빌린다(공용 조각의 dueDateBorrowerIds).
  const dueDatesByCaseId = await loadDomesticOrderDueDatesByCaseId(dueDateBorrowerIds(caseRows));

  return caseRows.map((row) => ({
    ...row,
    domesticOrderDueDates: dueDatesByCaseId.get(row.id) ?? [],
  }));
}

/**
 * 사내 목표 출하일이 **고객 요청 납기일보다 늦은** 수리 건 전부 — 인수번호
 * 오름차순. 이미 나간 건은 빠져 있다.
 *
 * 인자를 받지 않는다 — 사람마다 결과가 달라지지 않고, 「오늘」도 보지 않는다
 * (파일 머리말).
 */
export async function listRepairCasesWithDueDateInverted(): Promise<RepairCaseDueDateInvertedRow[]> {
  const candidates = await loadCandidates();

  const items: RepairCaseDueDateInvertedRow[] = [];
  for (const row of candidates) {
    // 🔴 뜰지 말지는 **이 한 줄**이 정한다. 화면 셋이 쓰는 바로 그 함수다.
    if (!isRepairCaseDueDateInverted(row)) continue;

    // 알림 한 줄에 적을 날짜를 구한다 — 판정이 아니라 **표시할 값**이다. 저 함수가
    // 제 안에서 부르는 것과 **같은 함수에 같은 재료**라 둘이 갈라질 수 없다.
    // (「납기 임박」 조회도 같은 자리에서 같은 방법을 쓴다.)
    const { dueDate, borrowed } = resolveRepairCaseRequestedDueDate({
      customerRequestedDueDate: row.customerRequestedDueDate,
      domesticOrderDueDates: row.domesticOrderDueDates,
    });
    const internalTargetShipmentDate = foldBlankToNull(row.internalTargetShipmentDate);
    // 판정이 참이면 두 날짜가 다 있다(isDueDateInverted 가 한쪽이라도 비면 거짓).
    // 타입을 좁히려는 것뿐이다.
    if (dueDate === null || internalTargetShipmentDate === null) continue;

    items.push({
      repairCaseId: row.id,
      intakeNumber: row.intakeNumber,
      internalTargetShipmentDate,
      requestedDueDate: dueDate,
      borrowed,
    });
  }
  return items;
}

/** 조건을 하나씩 걸었을 때 남는 건수 — 세는 도구가 찍는다. */
export type DueDateInversionStageCounts = {
  /** ① 사내 목표 출하일이 적힌 건(휴지통 제외). */
  withTargetDate: number;
  /** ② ① 가운데 고객 요청 납기일을 아는 건 — 자기 칸이거나 내자에서 빌려 온 것. */
  andRequestedKnown: number;
  /** ③ ② 가운데 목표 출하일이 **더 늦은** 건(같은 날은 아니다). */
  andInverted: number;
  /** ④ ③ 가운데 아직 안 나간 건 — **실제로 종에 뜨는 수**. */
  andNotShipped: number;
};

/**
 * 조건을 하나씩 거는 동안 건수가 어떻게 줄어드는지 — **읽기만 한다.**
 *
 * 🔴 **왜 앱 코드에 두는가.** 이 알림은 엔지니어·영업·관리자 **전원**에게 가고 지난
 * 건도 함께 뜬다(판정이 매 요청마다 다시 계산되기 때문이다). 그러니 배포 전에 「④가
 * 몇 건인가」를 알아야 하는데, 운영 DB 에 직접 붙지 않고 그 수를 보려면 **앱이 쓰는
 * 그 길로** 세는 수밖에 없다. 세는 SQL 을 도구 쪽에 따로 적으면 종에 뜨는 수와 조용히
 * 달라지고, 그때는 틀린 수를 보고 판단하게 된다. 찍는 일은 도구가 한다
 * (scripts/check-due-date-inverted.ts).
 *
 * 🔵 ④ 는 listRepairCasesWithDueDateInverted 가 내놓는 줄 수와 **언제나 같다** — 같은
 * 후보 묶음에 같은 판정을 걸기 때문이고(③+④ 를 합친 것이 isRepairCaseDueDateInverted
 * 다), 도구가 그것을 맞대어 본다.
 *
 * 🔴 **단계를 가르느라 조건을 베껴 적지 않는다.** ③ 은 그 함수가 제 안에서 쓰는 핵심
 * 비교(isDueDateInverted)를 그대로 부르고, ④ 는 세 경보가 함께 쓰는 출하 판정
 * (isRepairCaseShipmentFinished)을 그대로 부른다. 가르는 차례가 함수 안과 **반대**인
 * 것은 일부러다 — 저쪽은 나간 건을 먼저 빼지만, 여기서는 「날짜가 어긋난 건이 몇 건이고
 * 그중 몇 건이 아직 살아 있는가」를 사람이 봐야 한다.
 */
export async function countDueDateInversionStages(): Promise<DueDateInversionStageCounts> {
  const candidates = await loadCandidates();

  // ① 후보가 곧 「사내 목표 출하일이 적힌 살아 있는 건」이다. 그래도 도메인 쪽
  //    접기를 한 번 더 거는 것은 SQL 의 IS NOT NULL 과 「적혀 있는가」가 어긋날 수
  //    있어서다(공백만 적힌 값). 어긋나면 ① 이 ② 보다 작아져 사람 눈에 바로 걸린다.
  const withTargetDate = candidates.filter(
    (row) => foldBlankToNull(row.internalTargetShipmentDate) !== null
  );
  const resolved = withTargetDate.map((row) => ({
    row,
    requested: resolveRepairCaseRequestedDueDate({
      customerRequestedDueDate: row.customerRequestedDueDate,
      domesticOrderDueDates: row.domesticOrderDueDates,
    }).dueDate,
  }));
  const andRequestedKnown = resolved.filter((entry) => entry.requested !== null);
  const andInverted = andRequestedKnown.filter((entry) =>
    isDueDateInverted({
      internalTargetShipmentDate: entry.row.internalTargetShipmentDate,
      customerRequestedDueDate: entry.requested,
    })
  );
  const andNotShipped = andInverted.filter((entry) => !isRepairCaseShipmentFinished(entry.row));

  return {
    withTargetDate: withTargetDate.length,
    andRequestedKnown: andRequestedKnown.length,
    andInverted: andInverted.length,
    andNotShipped: andNotShipped.length,
  };
}
