import { foldBlankToNull } from "./domestic-order-list";
import { isRepairCaseShipmentFinished } from "./notifications";
import { resolveRepairCaseRequestedDueDate } from "./requested-due-date-link";
import type { RepairStatus } from "./types";

/**
 * ============================================================================
 * 「납기 역전」 — 사내 목표 출하일이 고객 요청 납기일보다 **늦은** 건 (2026-10-29)
 * ============================================================================
 * 사용자 요구 그대로다: 「작성한 사내 목표 출하일이 고객 요청 납기일보다 늦으면
 * 그 날짜들을 빨간 볼드로 그리고, 옆에 『납기 요청일 협의가 필요합니다.』 라는
 * 메모가 뜨도록」. 우리가 잡아 둔 날이 고객이 달라고 한 날보다 뒤라면, 지금
 * 고쳐야 하는 것은 일정이 아니라 **고객과의 약속**이라 사람이 전화를 걸어야 한다.
 *
 * ── 🔴 DB 도 React 도 여기 들어오지 않는다 ──────────────────────────────────
 * 이 판정을 쓰게 될 자리가 넷이다 — A/S 수리 건 상세, A/S 내자 정리, PO 쪽 내자
 * 정리, 그리고 (언젠가) 알림. 네 자리에 조건을 각각 적으면 언젠가 한 곳만 고쳐져
 * **같은 건이 화면마다 다른 말을 한다.** requested-due-date-link.ts ·
 * weekly-report-delivery.ts 와 같은 자리에 둔 것도 같은 이유다: 저 둘도 "화면 둘이
 * 같은 답을 내야 하는 종류"의 규칙만 모아 둔 순수 함수 파일이다.
 *
 * ── 🔴 「오늘」을 쓰지 않는다. 이웃한 두 판정과 바로 그 점이 다르다 ──────────
 * 이 저장소에는 납기를 보는 판정이 이미 둘 있고, 셋을 섞으면 아무도 어느 경보가
 * 무슨 뜻인지 모르게 된다:
 *
 *   납기 지연(types.ts 의 isRepairCaseOverdue)
 *     사내 목표 출하일 **대 오늘** — 우리가 잡아 둔 날이 지났는데 아직 안 나갔다.
 *   납기 임박(notifications.ts 의 isRepairCaseDueDateNear)
 *     고객 요청 납기일 **대 오늘+7일** — 고객이 달라고 한 날이 코앞이다.
 *   납기 역전(이 파일)
 *     사내 목표 출하일 **대 고객 요청 납기일** — 두 날짜가 처음부터 어긋나 있다.
 *
 * 앞의 둘은 시간이 흐르면 저절로 켜지는 경보라 「오늘」이 필요하다. 역전은 두 날을
 * 적는 순간 이미 정해져 있고, 내일이 된다고 달라지지 않는다. 그래서 이 함수는
 * `now` 를 받지 않는다 — 받게 해 두면 언젠가 "지난 건은 빼자"가 몰래 들어오고,
 * 그날 이 판정은 위의 두 개와 구별되지 않는다.
 *
 * ── 🔴 출하가 끝난 건에는 **뜨지 않는다** (2026-10-30 사용자 결정) ───────────
 * 이미 나간 건에 「협의가 필요합니다」는 **할 일이 없는 말**이고, 지난 건을 열 때마다
 * 붉은 글이 뜨면 정작 살아 있는 경고가 그 속에 묻힌다. 위 두 판정이 같은 이유로 이미
 * 나간 건을 빼고 있어(isRepairCaseShipmentFinished), 이 결정으로 **셋의 잣대가
 * 하나가 된다** — 경보마다 「끝난 건」을 다르게 가르면 언젠가 한쪽만 고쳐진다.
 *
 * 🔴 **거르는 자리는 아래 isRepairCaseDueDateInverted 안이다.** 핵심 비교
 * (isDueDateInverted)는 여전히 날짜 둘만 본다 — 「두 날짜가 어긋나 있다」는 사실
 * 자체는 출하와 무관하고, 출하 여부는 **그 사실을 경보로 띄울 것인가**의 조건이기
 * 때문이다. 「납기 임박」이 쓰는 모양과 같다(notifications.ts 의
 * isRepairCaseDueDateNear 가 맨 먼저 그 함수로 걸러 낸다).
 *
 * ── 날짜는 끝까지 문자열로 견준다 ───────────────────────────────────────────
 * 두 칸 다 PostgreSQL `date` 에서 온 "YYYY-MM-DD" 다. `new Date()` 로 파싱하면 UTC
 * 자정이 되어 한국에서 하루가 밀린다(domain/date-only.ts 머리말 — 이 저장소가 실제로
 * 겪은 함정이다). 자리수가 고정된 0 채움 형식이라 사전순이 곧 날짜순이다.
 * ============================================================================
 */

/**
 * 역전인 건의 날짜 옆에 붙는 메모. **사용자가 적어 준 글자 그대로**다(2026-10-29).
 *
 * 글자를 여기 한 곳에 두는 까닭은 위 머리말의 네 자리가 같은 말을 해야 하기
 * 때문이다 — 화면마다 적으면 「협의가 필요합니다」와 「협의 필요」가 섞이고, 그때
 * 사람은 둘을 다른 경보로 읽는다(requested-due-date-link.ts 의 이름표 상수들과
 * 같은 규율).
 */
export const DUE_DATE_INVERSION_NOTE = "납기 요청일 협의가 필요합니다.";

/**
 * 그 메모에 마우스를 올렸을 때 나오는 설명(title).
 *
 * 메모 자체는 **무엇을 해야 하는가**만 말한다. 왜 빨간지는 말하지 않는데, 같은
 * 자리의 빨강이 「납기 임박」일 수도 있어(둘은 겹칠 수 있다 — 2026-10-29 사용자
 * 결정으로 겹치면 둘 다 보인다) 까닭이 한 줄 더 있어야 사람이 어느 쪽을 보고 있는지
 * 안다. 짧게 적는 것은 이 글이 좁은 칸 안에 사는 title 이기 때문이다.
 */
export const DUE_DATE_INVERSION_REASON_NOTE =
  "사내 목표 출하일이 고객 요청 납기일보다 늦습니다.";

/**
 * 그 메모가 입는 옷. 말과 색을 **한 자리에** 둔다 — 글자는 여기서 가져다 쓰고 색은
 * 화면마다 적게 두면, 네 자리 중 하나가 회색으로 그려 놓고도 아무 오류가 나지 않는다.
 *
 * 🔴 **굵게는 없다.** 굵은 붉은색은 **날짜**가 입는 옷이고
 * (components/repair-cases/due-date-near.ts 의 DUE_DATE_NEAR_TEXT_CLASS), 메모까지
 * 같은 무게로 굵어지면 두 줄이 한 덩어리로 보여 눈이 날짜를 먼저 찾지 못한다. 색만
 * 같게 해서 「이 메모는 저 빨간 날짜 이야기」로 읽히게 한다.
 *
 * 🔴 **클래스 이름은 글자 그대로 적는다.** Tailwind 는 소스에서 글자로 찾은 것만 CSS
 * 로 만든다 — 조립하면 아무 오류 없이 색만 사라진다. 어두운 화면 짝(dark:)을 떼지 않는
 * 것도 같은 파일이 이미 겪은 함정이다.
 */
/**
 * 🔴 **테두리 있는 상자**다(2026-10-30 사용자 요청). 그냥 붉은 글자로 두면 바로 위
 * 날짜의 굵은 붉은색과 이어져 **한 덩어리로 읽힌다** — 날짜가 붉은 까닭이 둘(임박·역전)
 * 이라 더 그렇다. 상자로 떼어 놓아야 「이것은 날짜가 아니라 할 일」이 보인다.
 * 🔵 바로 위 `borrowedLabel`(출처 표시)도 같은 날 상자가 됐지만 **색이 다르다** —
 *    저쪽은 「어디서 온 값인가」, 이쪽은 「무엇을 해야 하는가」다. 같은 색으로 두면
 *    출처 표시까지 경보처럼 읽힌다.
 */
/**
 * 🔴 **한 줄로 둔다**(2026-10-30 사용자 요청 — 「글자 크기가 더 작아져도 좋으니까」).
 *    `whitespace-nowrap` 으로 접히는 것을 막고 `inline-block` 으로 상자가 **글자 폭
 *    만큼만** 되게 한다 — 칸 너비를 채우면 그 안에서 또 접힌다.
 * 🔵 이 칸은 2열 격자라 폭이 좁다. 글이 길어지면 상자가 칸 밖으로 비어져 나오므로,
 *    문구를 늘릴 때는 **화면에서 한 줄인지 먼저 보라.**
 */
export const DUE_DATE_INVERSION_NOTE_CLASS =
  "mt-1 inline-block whitespace-nowrap rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300";

/**
 * 이 두 날짜가 **역전인가** — 사내 목표 출하일이 고객 요청 납기일보다 늦으면 참.
 *
 * ⚠️ **행 전체가 아니라 보는 두 칸만 받는다.** 수리 건 행도 내자 행도 아닌 날짜
 * 둘이라, A/S 와 PO 가 서로 다른 표를 들고도 같은 함수를 부를 수 있다. 행을 통째로
 * 받게 해 두면 언젠가 실제 출하일이나 상태가 여기 섞여 들어오고, 그때 이 규칙은
 * 조용히 달라진다(resolveDomesticOrderDueDateDisplay 가 칸만 받는 것과 같은 이유).
 *
 * 🔴 **같은 날은 역전이 아니다.** 요구가 「늦으면」이기 때문이다 — 목표일 당일에
 * 나가면 약속은 지켜진다. 경계를 `>` 가 아니라 `>=` 로 적으면 제날짜에 맞춰 잡아 둔
 * 건 **전부**에 「협의가 필요합니다」가 떠서, 정말 어긋난 건이 그 속에 묻힌다.
 * (납기 지연이 「목표일 == 오늘」을 지연으로 보지 않는 것과 같은 갈림이다.)
 *
 * 🔴 **한쪽이라도 비면 거짓이다 — 「아직 모른다」를 「아니다」와 같은 칸에 넣는다.**
 * 셋으로 갈라 돌려줄 수도 있었지만 그러지 않았다: 부르는 자리가 묻는 것은 언제나
 * 「빨갛게 칠하고 메모를 띄울 것인가」 하나뿐이고, 모름과 아님은 그 물음에 **같은
 * 답**을 준다. 세 값으로 주면 네 화면이 저마다 둘을 한 가지에 묶게 되고, 그중 한
 * 곳이 빠뜨리는 날 날짜 하나만 적힌 건에 「협의가 필요합니다」가 뜬다 — 비교를
 * 한 적도 없는데 그렇다. 미기재가 알림을 끄는 쪽으로 접히는 것은 납기 임박이 이미
 * 쓰는 방향이기도 하다(2026-10-19 「납기일 미기재 시 알림 없음」).
 *
 * 공백만 적힌 값은 없는 것으로 접는다 — 화면에는 빈칸으로 보이는데 경보만 켜지는
 * 건이 생기지 않게 한다(domestic-order-list.ts 의 foldBlankToNull).
 *
 * 🔴 **이것만 보고 화면을 칠하지 마라.** 이 함수가 답하는 것은 「두 날짜가 어긋나
 * 있는가」뿐이고, **이미 나간 건을 빼는 일은 여기서 하지 않는다**(2026-10-30 결정 —
 * 파일 머리말). 수리 건을 쥐고 있다면 아래 isRepairCaseDueDateInverted 를 불러라.
 * 날짜 둘만 들고 오는 자리(내자 정리처럼)는 **출하 여부를 함께 구해 와야 한다** —
 * 그러지 않으면 그 화면에서만 끝난 건에도 붉은 글이 뜬다.
 */
export function isDueDateInverted(dates: {
  internalTargetShipmentDate: string | null;
  customerRequestedDueDate: string | null;
}): boolean {
  const target = foldBlankToNull(dates.internalTargetShipmentDate);
  const requested = foldBlankToNull(dates.customerRequestedDueDate);
  if (target === null || requested === null) return false;
  return target > requested;
}

/**
 * 수리 건 하나에 **역전 경보를 띄우는가** — 화면에 보이는 그 날짜로 재고, 이미
 * 나간 건은 뺀다.
 *
 * 🔴 **맨 먼저 출하 완료를 거른다**(2026-10-30 사용자 결정 — 파일 머리말). 조건을
 * 새로 적지 않고 「납기 임박」·「납기 지연」이 쓰는 그 함수를 그대로 부른다
 * (notifications.ts 의 isRepairCaseShipmentFinished): 보는 사실이 **둘**이고
 * — 평탄화 상태가 `SHIPMENT_COMPLETED` 이거나 실제 출하일이 찍혔거나 — 둘 중
 * 하나면 나간 것이다. 상태 하나만 보면 **출하일은 찍혔는데 워크플로 단계가 따라가지
 * 못한 건**에 경보가 남고, 날짜 하나만 보면 그 반대가 샌다. 잣대를 베껴 적지 않는
 * 까닭도 같다 — 세 경보가 「끝난 건」을 다르게 가르면 한쪽만 고쳐지는 날이 온다.
 *
 * 🔵 `status` 가 `null` 이면 「아직 안 나갔다」로 둔다. 그 함수의 결정이고
 * (workflow_steps.repair_status 가 아직 nullable 이다), 여기서 뒤집지 않는다.
 *
 * 🔴 빌려 오기를 **이 함수가 한다.** 고객 요청 납기일 칸이 비어 있으면 연결된 내자
 * 정리의 납기요청일 중 가장 이른 하루를 대신 보여 주는 규칙이 이미 있고
 * (requested-due-date-link.ts), 사용자가 2026-10-29 에 **그 빌려 온 값도 비교
 * 대상**이라고 정했다. 빌려 오기를 부르는 쪽마다 적게 두면 세 자리 중 한 곳이
 * 빠지는 날이 오고, 그날 그 화면은 날짜를 빨갛게 그려 놓고 메모는 안 띄운다 —
 * 보이는 날짜와 판정이 본 날짜가 다른 것이다.
 *
 * 그래서 규칙을 베껴 적지 않고 **그 함수를 그대로 부른다.** 「납기 임박」이 같은
 * 자리에서 같은 방법을 쓴다(notifications.ts 의 isRepairCaseDueDateNear) — 묶는
 * 모양이 둘일 뿐 날짜를 고르는 함수는 하나도 다르지 않다.
 *
 * 🔵 날짜 둘을 이미 손에 쥔 쪽(내자 정리처럼 빌릴 것이 없는 화면)은 위
 * isDueDateInverted 를 바로 부를 수 있지만, 그때는 **출하 여부를 그 화면이 함께
 * 구해 와야 한다** — 이 함수는 빌려 오기와 출하 거르기 **두 겹**을 얹은 것이고,
 * 날짜 비교 자체는 전부 저 아래 한 줄에서 난다.
 */
export function isRepairCaseDueDateInverted(row: {
  internalTargetShipmentDate: string | null;
  customerRequestedDueDate: string | null;
  domesticOrderDueDates: readonly string[];
  /** 평탄화된 지금 상태(workflow_steps.repair_status). 모르면 `null` — 안 나간 것으로 본다. */
  status: RepairStatus | null;
  actualShipmentDate: string | null;
}): boolean {
  if (isRepairCaseShipmentFinished(row)) return false;
  const { dueDate } = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: row.customerRequestedDueDate,
    domesticOrderDueDates: row.domesticOrderDueDates,
  });
  return isDueDateInverted({
    internalTargetShipmentDate: row.internalTargetShipmentDate,
    customerRequestedDueDate: dueDate,
  });
}
