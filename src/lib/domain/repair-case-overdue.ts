import { toKstDateOnly } from "./date-only";
import { resolveRepairCaseRequestedDueDate } from "./requested-due-date-link";
import { isRepairCaseShipmentFinished } from "./shipment-finished";
import type { RepairStatus } from "./types";

/**
 * ============================================================================
 * 「납기 지연」 — **고객 요청 납기일**이 지났고 아직 안 나간 건
 * ============================================================================
 * 저장된 상태값이 아니라 계산된 조건이다. RepairStatus/exceptionStatus 에 넣지
 * 않는다 — 날짜가 하루 지나면 저절로 켜지는 경보라 어떤 칸에도 적어 둘 수 없다.
 *
 * ── 🔴 2026-11-03 — 기준 날짜가 바뀌었다 ────────────────────────────────────
 * 사용자 결정: 「사내 목표 완료일을 지났다고 해서 납기 지연 배지가 뜨지 않도록
 * 해줘. (고객 요청 납기일을 지났을 때만 [납기 지연]이 뜨도록 해줘.)」 그 전까지 이
 * 판정이 보던 날짜는 internalTargetShipmentDate(화면 이름: 사내 목표 완료일)였다.
 * 사내 날짜는 **우리가 스스로 잡은 일정**이라, 그것을 넘긴 것은 고객과의 약속을
 * 어긴 것이 아니다 — 「지연」이라는 말이 두 가지 다른 일을 가리키고 있었다.
 *
 * 🔴 **사내 날짜를 보던 다른 표시는 그대로다.** 「납기 역전」(사내 목표 완료일이
 * 고객 요청 납기일보다 늦다 — domain/due-date-inversion.ts)과 「사내 목표 완료일
 * 미등록」 알림은 그 결정에 포함되지 않았다.
 *
 * ── 🔴 2026-11-07 — **빌려 온 날짜도 본다**(사용자 요구) ────────────────────
 * 사용자 원문: 「고객 요청 납기일이 **내자정리에서 읽어온 경우 [납기지연]이 안뜨는**
 * 것 같아. **내자정리에서 쓰인 요청 납기일에 대해서도 수리건 상세에서 적은 것과 같은
 * 취급**을 해주도록 해줘」.
 *
 * 그 전까지 이 판정은 `customer_requested_due_date` 칸 하나만 봤고, 그 칸이 비면
 * 거기서 끝났다. 그런데 **화면은 그 칸이 비었을 때 연결된 내자 정리의 납기요청일 중
 * 가장 이른 하루를 빌려 그린다**(domain/requested-due-date-link.ts). 그래서 상세
 * 화면에 날짜가 **보이는데도** 배지가 안 뜨는 건이 있었다 — 같은 화면의 「납기 임박」·
 * 「납기 역전」은 이미 그 빌려 온 날짜로 재고 있었으므로, 한 칸 안에서 세 경보가 서로
 * 다른 날짜를 보고 있었던 셈이다.
 *
 * 🔴 **빌려 오는 규칙을 여기 베껴 적지 않는다.** 화면 넷과 경보 둘이 쓰는 그 함수를
 * 그대로 부른다(resolveRepairCaseRequestedDueDate → weekly-report-delivery.ts 의
 * pickEarliestDueDate). 두 벌이 되면 어느 날 한쪽만 고쳐지고, 그날 이 배지는 화면에
 * 그려진 날짜가 아닌 다른 날짜로 재게 된다.
 * 🔵 **「자기 자리에 적힌 것이 먼저」도 그 함수의 규칙이다** — 이 건의 칸에 날짜가
 * 적혀 있으면 내자는 쳐다보지 않는다. 빌리는 것은 **비었을 때뿐**이다.
 * 🔵 꼬리표(「내자 정리에서 작성됨」) 표시는 **그대로 둔다**(2026-10-30 결정 — 동기화
 * 해도 출처 표시는 남긴다). 이번에 넓힌 것은 판정뿐이고 화면 표시는 한 글자도 안
 * 건드렸다.
 *
 * ── 🔴 왜 types.ts 가 아니라 이 파일인가 ────────────────────────────────────
 * 2026-11-07 까지 이 함수는 domain/types.ts 에 살았다. 빌려 오게 하려면
 * requested-due-date-link.ts 를 들여와야 하는데, 그 파일은 local/validation.ts 를
 * 보고(인수일 잣대 isNotEarlierThan) 그쪽이 다시 types.ts 를 본다 — **types.ts 에
 * 그 import 를 더하는 순간 고리(circular import)가 된다.** types.ts 는 이 저장소에서
 * 거의 모든 파일이 들여오는 뿌리라, 고리가 지면 무엇이 먼저 초기화되는지에 따라
 * ReferenceError 로 앱이 통째로 안 선다(domain/shipment-finished.ts 머리말에 그
 * 저장소가 실제로 겪은 전말이 적혀 있다).
 *
 * 그래서 **제3의 파일로 내보냈다** — 2026-10-30 에 isRepairCaseShipmentFinished 를
 * 같은 까닭으로 같은 모양으로 내보낸 그 선례 그대로다. 사슬은 한 방향이다:
 *
 *     repair-case-overdue ──▶ requested-due-date-link ──▶ local/validation ──▶ types
 *              └──────────────▶ shipment-finished ──────────────────────────▶
 *
 * 🔴 **types.ts 에서 이 함수를 다시 export 하지 마라** — 편의로 한 줄만 다시 내보내도
 * 끊어 놓은 고리가 그 자리에서 되살아난다.
 *
 * ── 「출하 완료」는 경보 넷이 함께 쓰는 한 잣대로 가른다 ────────────────────
 * 보는 사실이 둘이다 — 워크플로 상태(SHIPMENT_COMPLETED)와 실제 출하일. 상태 하나에만
 * 기대면, 출하일은 찍혀 있는데 워크플로 단계가 따라가지 못한 건이 "출하일이 적혀
 * 있는데 그 옆에 납기 지연 배지가 붙는" 모순된 화면이 된다. 출하일이 찍혀 있으면 그
 * 물건은 이미 나간 것이고, 납기일보다 늦게 나갔더라도 지금 조치가 필요한 건은 아니다 —
 * 이 판정은 역사적 기록이 아니라 **살아 있는 경보**이므로 경보에서 빠지는 것이 맞다.
 * actualShipmentDate 는 여기서 납기일 대용이 아니라 오직 *빼는 조건*으로만 쓴다.
 *
 * 🔴 그 잣대를 베껴 적지 않고 isRepairCaseShipmentFinished 를 그대로 부른다
 * (domain/shipment-finished.ts) — 2026-11-07 이전에는 같은 두 줄을 이 함수가 제
 * 안에 손으로 적고 있었다. **값은 한 건도 달라지지 않는다**: 그 함수가 보는 두
 * 사실이 여기 적혀 있던 바로 그 둘이고, 빈 문자열("")도 양쪽 다 「아직 안 나갔다」로
 * 접는다. 넷이 「끝난 건」을 다르게 가르면 언젠가 한쪽만 고쳐진다.
 *
 * ── 날짜는 끝까지 문자열로 견준다 ───────────────────────────────────────────
 * 비교는 반드시 한국 달력 날짜("YYYY-MM-DD" 문자열)끼리 한다. 납기일은 PostgreSQL
 * `date` 컬럼에서 온 날짜 문자열이라 new Date() 로 파싱하면 UTC 자정이 되는데,
 * 여기에 실제 시각을 그대로 비교하면 한국시간 오전 9시(=UTC 0시)부터 "납기일이 바로
 * 오늘"인 건이 지연으로 뒤집힌다. "지연"은 납기일이 *지난* 것이지 납기일 *당일*이
 * 아니므로, 납기일 == 오늘(한국)은 지연이 아니다. "YYYY-MM-DD"는 사전순 비교가 곧
 * 날짜순 비교이므로 문자열 비교로 충분하다.
 * ============================================================================
 */

/**
 * 그 날짜가 **지났는가** — 핵심 비교 한 줄.
 *
 * ⚠️ **행이 아니라 날짜 하나만 받는다.** 이웃한 두 경보가 같은 모양으로 핵심 비교를
 * 떼어 둔 것과 같은 자리다(due-date-inversion.ts 의 isDueDateInverted,
 * notifications.ts 의 isRepairCaseDueDateWithinNotificationWindow). 행을 통째로 받게
 * 해 두면 언젠가 사내 목표 완료일이 여기 섞여 들어오고, 그때 이 규칙은 조용히
 * 2026-11-03 이전으로 돌아간다.
 *
 * 🔴 **날짜가 없으면 거짓이다.** 「아직 모른다」와 「아니다」를 같은 칸에 넣는다 —
 * 없는 약속을 어겼다고 말할 수는 없고, 부르는 자리가 묻는 것은 언제나 「빨간 배지를
 * 붙일 것인가」 하나뿐이다. 「납기 임박」이 미기재를 거짓으로 접는 것과 같은 방향이다
 * (2026-10-19 사용자 결정 — 「납기일 미기재 시 알림 없음」).
 *
 * `.slice(0, 10)` 은 날짜 뒤에 시각이 붙어 들어오는 자리(문자열로 저장된 옛 자료)를
 * 위한 방어다. `date` 칸에서 온 값은 이미 열 글자뿐이라 아무 일도 하지 않는다.
 */
export function isDueDateOverdue(dueDate: string | null, now: Date): boolean {
  if (dueDate === null) return false;
  return dueDate.slice(0, 10) < toKstDateOnly(now);
}

/**
 * 이 수리 건에 **「납기 지연」 배지를 붙이는가** — 화면에 보이는 그 날짜로 재고,
 * 이미 나간 건은 뺀다.
 *
 * 묶는 순서가 「납기 임박」(notifications.ts 의 isRepairCaseDueDateNear)·「납기 역전」
 * (due-date-inversion.ts 의 isRepairCaseDueDateInverted)과 **같다**. 셋 다 조건을 새로
 * 적지 않고 이미 있는 함수 셋을 한 줄씩 묶기만 한다:
 *
 *   1. 🔴 이미 나간 건을 뺀다 — isRepairCaseShipmentFinished
 *   2. 화면에 보이는 날짜를 구한다 — resolveRepairCaseRequestedDueDate
 *      (자기 칸이 먼저, 비면 연결된 내자 정리에서 가장 이른 하루를 빌린다)
 *   3. 지났는지 본다 — 위 isDueDateOverdue(오늘은 한국 달력으로)
 *
 * 🔴 **`domesticOrderDueDates` 를 선택 인자로 두지 않는다.** 기본값을 빈 배열로 두면
 * 재료를 안 넘기는 자리가 **아무 오류 없이** 2026-11-07 이전처럼 돌아, 한 화면만
 * 고쳐지고 다른 화면은 조용히 옛 판정을 쓴다 — 이 조각이 고친 결함이 정확히 그
 * 모양이었다. 필수로 두면 재료를 어디서 실어 오는지를 부르는 자리마다 한 번씩
 * 정하게 되고, 안 정하면 tsc 가 멈춘다(due-date-inversion.ts 의
 * isDomesticOrderDueDateInverted 가 「받는 칸을 줄이면 …」이라 적어 둔 그 판단).
 *
 * 🔵 재료가 **정말로 없는** 자리는 빈 배열을 넘긴다 — mock·local 소스에는 내자 정리라는
 * 자료 자체가 없다(domain/local/resolved-repair-case.ts 의 그 칸 주석).
 *
 * 🔵 `status` 가 `null` 이면 「아직 안 나갔다」로 둔다. isRepairCaseShipmentFinished 의
 * 결정이고(workflow_steps.repair_status 가 아직 nullable 이다), 여기서 뒤집지 않는다.
 *
 * `now` 는 테스트 주입용이다(기본값은 실제 현재 시각). 🔴 **화면에서 만들지 마라** —
 * 서버가 그린 HTML 과 어긋나 hydration 이 깨진다.
 */
export function isRepairCaseOverdue(
  repairCase: {
    /** 평탄화된 지금 상태(workflow_steps.repair_status). 모르면 `null`. */
    status: RepairStatus | null;
    customerRequestedDueDate: string | null;
    /** 이 건에 연결된 내자 정리 줄들의 납기요청일 전부. 없거나 안 빌리면 빈 배열이다. */
    domesticOrderDueDates: readonly string[];
    actualShipmentDate: string | null;
  },
  now: Date = new Date()
): boolean {
  if (isRepairCaseShipmentFinished(repairCase)) return false;
  const { dueDate } = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: repairCase.customerRequestedDueDate,
    domesticOrderDueDates: repairCase.domesticOrderDueDates,
  });
  return isDueDateOverdue(dueDate, now);
}
