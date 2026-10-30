import "server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../client";
import { domesticOrders, repairCases, workflowSteps } from "../schema";
import {
  earliestDomesticOrderIssuedDate,
  hasDomesticOrderIssued,
  isInternalTargetShipmentDateMissing,
  needsInternalTargetShipmentDate,
} from "@/lib/domain/notifications";
import { isRepairCaseShipmentFinished } from "@/lib/domain/shipment-finished";
import type { RepairStatus } from "@/lib/domain/types";

/**
 * ============================================================================
 * 사내 목표 출하일 미등록 — 종 알림 「사내 목표 출하일을 등록해 주세요」의 원본
 * ============================================================================
 * **SELECT 만 있다.** 이 파일은 아무것도 쓰지 않고, 쓸 표도 만들지 않는다 —
 * 알림은 저장되지 않고 매 요청마다 업무 데이터에서 다시 계산된다
 * (domain/notifications.ts 머리말). 「납기 임박」 조회
 * (queries/repair-case-due-date-notifications.ts)와 같은 모양으로 적었다 —
 * 다음 사람이 둘을 나란히 읽을 수 있어야 한다.
 *
 * ── 누구에게 가는가 — **역할이 여기서 갈리지 않는다** ───────────────────
 * 🔴 받는 사람은 A/S 엔지니어다(2026-10-29 사용자 결정). 그런데 그 좁히기는 이
 * 조회가 하지 않는다 — 알림 설정의 역할 기본값이 한다
 * (domain/notification-settings.ts 의 defaultRoleReceivesNotification).
 * 까닭 셋이 그 case 주석에 적혀 있고, 요약하면 이렇다: 싣는 것이 인수번호와 날짜
 * 뿐이라 **인가 경계가 아니고**, 조회에 역할을 박으면 설정 화면의 역할 스위치가
 * 죽은 단추가 되며, 최고관리자 잠금이 화면에서 거짓말이 된다. 그래서 이 조회는
 * 사용자 id 도 역할도 받지 않고, 사용자별로 결과가 달라지지도 않는다.
 *
 * ── 판정을 여기서 새로 적지 않는다 ──────────────────────────────────────
 * 「PO발행일이 있는가」·「사내 목표 출하일이 비었는가」·「이미 나갔는가」 세
 * 판정은 전부 도메인의 순수 함수가 한다(needsInternalTargetShipmentDate 와 그
 * 안의 셋). SQL 의 `IS NULL` 로 접으면 공백만 적힌 값을 「있다」로 세는 날이 오고
 * (화면은 foldBlankToNull 로 빈칸으로 그린다), 무엇보다 시험할 자리가 사라진다 —
 * 납기 임박·장기 PO 미발행 조회가 같은 이유로 같은 모양을 쓴다.
 *
 * ── 빼는 것 셋 ──────────────────────────────────────────────────────────
 *  · 휴지통에 든 건(`repair_cases.is_deleted`) — 목록에도 없는 건을 챙기라는
 *    알림은 할 일이 아니다. 결재 대기·결재 결과·납기 임박이 모두 같은 조건을 건다.
 *  · 지워진 내자 줄(`domestic_orders.is_deleted`) — 화면에서 지운 줄의 발주일이
 *    알림을 만들어 내면 안 된다(장기 PO 미발행·주간보고와 같은 규칙).
 *  · 이미 나간 건 — 평탄화 상태가 `SHIPMENT_COMPLETED` 이거나 실제 출하일이 찍힌
 *    건. 판정은 도메인의 isRepairCaseShipmentFinished 가 하고, 「납기 임박」·
 *    「납기 지연」·「납기 역전」이 쓰는 바로 그 함수다.
 *
 * 🔵 **연결이 끊긴 내자 줄은 애초에 묻지 않는다** — `repair_case_id` 는 nullable
 * 이다(접수 건 영구 삭제 시 SET NULL). 그런 줄에는 대조할 접수 건이 없다
 * (장기 PO 미발행 조회와 같은 처리).
 *
 * ── 조인하지 않고 두 번 읽는다 ──────────────────────────────────────────
 * 한 수리 건에 내자 줄이 여럿이다(분할 발주 — repair_case_id 에 유일 제약이 없다).
 * 그대로 조인하면 그 건이 줄 수만큼 복제되어 종에 같은 알림이 여러 줄로 선다.
 * 그래서 내자 줄을 먼저 읽어 건별로 묶고, 접수 건을 **따로 한 번** 읽는다. 질의는
 * 두 번이고, 건마다 묻지 않는다(N+1 없음).
 *
 * 🔵 후보를 내자 쪽에서 시작하는 것은 장기 PO 미발행 조회와 같은 판단이다 — PO 가
 * 한 줄도 없는 건은 이 알림의 후보가 아니라서, 접수 건 전부를 훑을 이유가 없다.
 *
 * ── 🔴 이 조회는 **모든 화면의 머리말**에서 돈다 ────────────────────────
 * 레지스트리는 각 load 를 try/catch 로 감싸지 않는다(queries/notifications.ts 의
 * listMyNotifications — Promise.all 그대로다). 여기서 던지면 종이 비는 것이 아니라
 * **그 화면이 통째로 못 그려진다.** 그래서 읽는 칸을 알림 한 줄에 필요한 것으로만
 * 묶고(접수 건 id · 인수번호 · 목표 출하일 · 실제 출하일 · 평탄화 상태 · 발주발행일),
 * 던질 수 있는 계산을 하지 않는다.
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * id · 인수번호 · 날짜만 읽는다. 고객사도 사람 이름도 연락처도 나오지 않는다.
 * ============================================================================
 */

/** 종 알림 「사내 목표 출하일 미등록」 한 줄의 원본. */
export type RepairCaseTargetShipmentMissingRow = {
  repairCaseId: string;
  intakeNumber: string;
  /** 가장 이른 PO발행일("YYYY-MM-DD"). 「있다」를 이미 가린 값이다. */
  orderIssuedDate: string;
};

/** 판정에 필요한 칸만 모은 접수 건 한 줄 + 그 건에 붙은 PO발행일 전부. */
type CandidateRow = {
  id: string;
  intakeNumber: string;
  internalTargetShipmentDate: string | null;
  actualShipmentDate: string | null;
  /** 평탄화된 지금 상태. 단계에 안 적혀 있으면 `null` — 「아직 안 나갔다」로 본다. */
  status: RepairStatus | null;
  orderIssuedDates: string[];
};

/**
 * PO발행일이 적힌 내자 줄이 **하나라도 있는** 살아 있는 접수 건 전부 — 인수번호
 * 오름차순. 판정은 아직 하나도 하지 않는다.
 *
 * 🔴 **세는 도구와 알림이 같은 자료를 본다**(아래 두 export 가 이 함수 하나를
 * 나눠 쓴다). 세는 길을 따로 적어 두면 「운영에서 몇 건이 뜨는가」를 재 놓고 실제로
 * 다른 수가 종에 뜨는 일이 생긴다 — 그러면 그 수를 보고 내린 판단이 통째로 틀린다.
 */
async function loadCandidates(): Promise<CandidateRow[]> {
  const orderRows = await db
    .select({
      repairCaseId: domesticOrders.repairCaseId,
      orderIssuedDate: domesticOrders.orderIssuedDate,
    })
    .from(domesticOrders)
    .where(
      and(
        eq(domesticOrders.isDeleted, false),
        isNotNull(domesticOrders.repairCaseId),
        // 발행일이 비어 있는 줄은 이 알림의 재료가 아니다. 「있는가」 판정 자체는
        // 도메인이 다시 하므로(hasDomesticOrderIssued) 여기서 좁히는 것은 질의를
        // 가볍게 하기 위한 것이고, 규칙을 SQL 로 옮긴 것이 아니다.
        isNotNull(domesticOrders.orderIssuedDate)
      )
    );

  const issuedDatesByCaseId = new Map<string, string[]>();
  for (const row of orderRows) {
    // isNotNull 이 이미 걸러 내지만 타입을 좁히기 위해 확인한다.
    if (row.repairCaseId === null || row.orderIssuedDate === null) continue;
    const bucket = issuedDatesByCaseId.get(row.repairCaseId);
    if (bucket) bucket.push(row.orderIssuedDate);
    else issuedDatesByCaseId.set(row.repairCaseId, [row.orderIssuedDate]);
  }

  // inArray 에 빈 배열을 넘기면 뜻 없는 SQL 이 만들어진다(주간보고 조회들과 같은 규칙).
  if (issuedDatesByCaseId.size === 0) return [];

  const caseRows = await db
    .select({
      id: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      internalTargetShipmentDate: repairCases.internalTargetShipmentDate,
      actualShipmentDate: repairCases.actualShipmentDate,
      // 평탄화 상태는 저장된 칸이 아니라 지금 놓인 단계에서 온다
      // (mappers/repair-status.ts · queries/long-pending-po.ts 와 같은 조인).
      status: workflowSteps.repairStatus,
    })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .where(
      and(eq(repairCases.isDeleted, false), inArray(repairCases.id, [...issuedDatesByCaseId.keys()]))
    )
    // 정렬 없는 SELECT 는 순서를 보장하지 않는다. 종 패널의 줄 차례가 새로 고칠
    // 때마다 흔들리지 않게 인수번호로 세운다(납기 임박·결재 대기와 같은 차례).
    .orderBy(asc(repairCases.intakeNumber));

  return caseRows.map((row) => ({
    ...row,
    orderIssuedDates: issuedDatesByCaseId.get(row.id) ?? [],
  }));
}

/**
 * PO발행일은 있는데 **사내 목표 출하일이 비어 있고 아직 안 나간** 수리 건 전부 —
 * 인수번호 오름차순.
 *
 * 인자를 받지 않는다 — 사람마다 결과가 달라지지 않고(파일 머리말), 「오늘」도 보지
 * 않는다. 이 알림은 시간이 흘러 켜지는 경보가 아니라 **두 칸의 상태**다(「납기
 * 역전」이 `now` 를 받지 않는 것과 같은 갈림: domain/due-date-inversion.ts 머리말).
 */
export async function listRepairCasesMissingTargetShipmentDate(): Promise<
  RepairCaseTargetShipmentMissingRow[]
> {
  const candidates = await loadCandidates();

  const items: RepairCaseTargetShipmentMissingRow[] = [];
  for (const row of candidates) {
    if (!needsInternalTargetShipmentDate(row)) continue;
    const orderIssuedDate = earliestDomesticOrderIssuedDate(row.orderIssuedDates);
    // 판정이 참이면 날짜가 있다(hasDomesticOrderIssued 가 그것을 본다). 타입을
    // 좁히려는 것뿐이다.
    if (orderIssuedDate === null) continue;
    items.push({ repairCaseId: row.id, intakeNumber: row.intakeNumber, orderIssuedDate });
  }
  return items;
}

/** 조건을 하나씩 걸었을 때 남는 건수 — 세는 도구가 찍는다. */
export type TargetShipmentMissingStageCounts = {
  /** ① PO발행일이 있는 건(휴지통 제외). */
  withOrderIssued: number;
  /** ② ① 가운데 사내 목표 출하일이 비어 있는 건. */
  andTargetMissing: number;
  /** ③ ② 가운데 아직 안 나간 건 — **실제로 종에 뜨는 수**. */
  andNotShipped: number;
};

/**
 * 조건을 하나씩 거는 동안 건수가 어떻게 줄어드는지 — **읽기만 한다.**
 *
 * 🔴 **왜 앱 코드에 두는가.** 이 알림은 A/S 엔지니어 **전원**에게 가고 지난 건도 함께
 * 뜬다. 그러니 배포 전에 「③이 몇 건인가」를 알아야 하는데, 운영 DB 에 직접 붙지 않고
 * 그 수를 보려면 **앱이 쓰는 그 길로** 세는 수밖에 없다. 세는 SQL 을 도구 쪽에 따로
 * 적으면 종에 뜨는 수와 조용히 달라지고, 그때는 틀린 수를 보고 판단하게 된다.
 * 찍는 일은 도구가 한다(scripts/check-target-shipment-missing.ts).
 *
 * 🔵 ③ 은 listRepairCasesMissingTargetShipmentDate 가 내놓는 줄 수와 **언제나 같다** —
 * 같은 후보 묶음에 같은 판정을 걸기 때문이고, 도구가 그것을 맞대어 본다.
 */
export async function countTargetShipmentMissingStages(): Promise<TargetShipmentMissingStageCounts> {
  const candidates = await loadCandidates();

  // ① 후보가 곧 「PO발행일이 있는 살아 있는 건」이다. 그래도 도메인 판정을 한 번 더
  //    거는 것은 SQL 의 IS NOT NULL 과 도메인의 「적혀 있는가」가 어긋날 수 있어서다
  //    (공백만 적힌 값). 어긋나면 ① 이 ② 보다 작아져 사람 눈에 바로 걸린다.
  const withOrderIssued = candidates.filter((row) => hasDomesticOrderIssued(row.orderIssuedDates));
  const andTargetMissing = withOrderIssued.filter((row) =>
    isInternalTargetShipmentDateMissing(row.internalTargetShipmentDate)
  );
  const andNotShipped = andTargetMissing.filter((row) => !isRepairCaseShipmentFinished(row));

  return {
    withOrderIssued: withOrderIssued.length,
    andTargetMissing: andTargetMissing.length,
    andNotShipped: andNotShipped.length,
  };
}
