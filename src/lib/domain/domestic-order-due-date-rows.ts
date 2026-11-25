/**
 * ============================================================================
 * 내자 정리 — 납기요청일 **행을 더하고 지우는** 울타리 넷 (2026-11-08 · 11-25)
 * ============================================================================
 * DB 도 React 도 여기 들어오지 않는다. 이 파일이 가진 것은 **저장을 거절하는
 * 까닭**뿐이고, 전부 사용자가 못 박은 결정이다(2026-11-07 · 2026-11-25):
 *
 *   결정 5 — 🔴 **납품 기록이 있으면 납기요청일 줄을 못 지운다.**
 *   결정 9 — 🔴 **수리 건이 붙은 줄은 납기요청일을 둘 이상 못 만든다.**
 *            (「납품을 여러 날짜에 나눠서 하게 되는건 기타건 밖에 없어.」)
 *   결정 13 의 짝 — 🔴 **완료 처리된 회차가 있으면 줄 수를 못 줄인다.**
 *            (결정 7·13 이 회차마다 [완료 처리]를 만들면서 따라 생긴 울타리다.
 *            아래 '완료 표시는 자리로 따라간다'에 까닭 전문이 있다.)
 *   🔴 **2026-11-25 — 확정된 회차의 납기요청일은 못 고치고 그 줄도 못 지운다.**
 *            (사용자 말 그대로: 「[확정 해제]를 해야만 날짜를 고칠 수 있도록 해줘.」
 *            아래 '확정은 잠금이다'에 까닭 전문이 있다.)
 *
 * ── 🔴 왜 **서버 한 곳**이 울타리인가 ───────────────────────────────────
 * 납기요청일 목록을 바꿀 수 있는 자리가 셋이다 — 표의 칸 편집
 * (DomesticOrderDueDatesCell) · 카드의 같은 칸 · `줄 수정` 폼
 * (DomesticOrderEditForm). 화면에서 막으면 **그 셋을 다 막아야 하고**, 한 곳이라도
 * 빠지면 조용히 뚫린다. 그래서 거절은 저장 통로 하나가 하고
 * (db/mutations/domestic-orders.ts 가 이 함수를 부른다), 화면은 **같은 까닭을 미리
 * 말해** 사람이 거기까지 가지 않게 한다.
 *
 * ── 🔴 왜 **저장돼 있던 모양까지 받는가** ───────────────────────────────
 * 둘 다 「지금 보내온 목록」만으로는 판정할 수 없다:
 *
 *  · 결정 5 는 **줄이 줄었는가**를 묻는다. 보내온 목록에 납품 기록이 몇이든, 줄이
 *    안 줄었으면 아무것도 지워지지 않았다.
 *  · 결정 9 는 **이미 둘 이상인 줄**을 막다른 길로 만들면 안 된다. 개발 DB 에
 *    실제로 그런 줄이 하나 있다(2026-11-07 실측 — 운영에는 0줄이다). 그 줄에서
 *    다른 칸 하나를 고치는 저장까지 거절하면, 그 줄은 **영영 고칠 수 없는 줄**이
 *    된다. 그래서 「둘 이상이면 거절」이 아니라 **「지금보다 늘리면 거절」**이다 —
 *    줄이는 쪽은 언제나 열려 있어서 사람이 스스로 정상 모양으로 돌아갈 수 있다.
 *    🔵 「DB 값으로 문을 열면 닫는 길도 봐야 한다」와 같은 자리의 같은 판단이다.
 *
 * ── 🔴 저장은 **지우고 다시 넣는다** — 그래서 이 울타리가 필요하다 ────────
 * 납기요청일 저장은 그 줄의 행을 통째로 지우고 받은 목록으로 다시 넣는다
 * (mutations/domestic-orders.ts 의 replaceDueDates). 납품 기록이 그 행에 달려
 * 있으므로, **보내온 목록이 그 기록을 들고 오지 않으면 같이 사라진다.** 2026-10-30
 * 에 「행을 지우지도 만들지도 않는다」를 정한 것도 같은 모양의 걱정이었다 — 거기서는
 * 행의 비고가 말없이 사라지는 것이었다(requested-due-date-link.ts 머리말 ③).
 * 다른 점은 **누가 지우느냐**다: 저쪽은 묶기가 멋대로 지우는 것이었고, 이쪽은 사람이
 * 줄을 지우는 것이라 **막고 까닭을 말하는** 쪽이 맞다.
 *
 * ── 🔴 **완료 표시는 자리로 따라간다** — 그래서 셋째 울타리가 필요하다 ────
 * 회차별 완료 표시(`domestic_order_due_dates.completed_at`)는 **폼이 보내는 값이
 * 아니다.** 보내게 두면 줄 수정 payload 하나로 승인 없이 완료를 찍을 수 있어서,
 * 저장 통로가 지우기 전에 읽어 두었다가 **같은 차례의 새 행에 서버가 직접** 되얹는다
 * (mutations/domestic-orders.ts 의 replaceDueDates).
 *
 * 그 되얹기는 **자리로** 한다(1차의 완료는 다시 1차에). 그래서 줄 수가 줄면 뒤 줄이
 * 한 칸씩 앞으로 당겨지고, **완료 표시가 엉뚱한 회차로 옮겨 붙거나 통째로 사라진다** —
 * 예를 들어 1차는 미완료, 2차는 완료인 줄에서 1차를 지우면 남은 한 줄은 1차의
 * (없는) 완료를 물려받고 2차의 완료는 사라진다.
 *
 * 🔴 그래서 **완료된 회차가 하나라도 있으면 줄을 지우는 저장을 통째로 거절한다.**
 * 결정 5 처럼 「기록이 함께 줄었나」로 세지 않고 더 좁게 막는 까닭은, 완료 표시가
 * 보내온 목록에 **없는 값**이라 「이 저장이 그 표시를 잃는가」를 목록만 보고는 가릴 수
 * 없기 때문이다(납품 기록은 목록에 실려 와서 셀 수 있다).
 *
 * 🔵 **늘리는 쪽은 열려 있다** — 뒤에 회차를 더해도 앞 자리는 그대로이고, 사람이
 * 분할 납품을 더 잡는 것은 막을 일이 아니다.
 * 🔵 **완료를 풀면 다시 지울 수 있다** — 회차별 [완료 처리]는 되돌릴 수 있으므로
 * (setDomesticOrderDueDateRowCompletion) 막다른 길이 아니다. 거절 문장이 그 차례를
 * 그대로 말한다.
 *
 * ── 🔴 **확정은 잠금이다** — 넷째 울타리 (2026-11-25) ────────────────────
 * [납기일 확정]은 「이 날짜가 더 이상 안 바뀐다」는 표시다. 그렇다면 **확정한 뒤에
 * 날짜가 바뀌는 길이 열려 있으면 안 된다** — 바뀌어도 확정이 남으면 「확정된 날짜」가
 * 아무도 확정한 적 없는 날짜를 가리키고, 바뀔 때 확정을 **조용히 푸는** 쪽을 고르면
 * 사람은 종이 다시 울리고 나서야 그 사실을 안다. 사용자 결정은 **막는 쪽**이다:
 * 「[확정 해제]를 해야만 날짜를 고칠 수 있도록 해줘.」
 *
 * 그래서 넷째 울타리는 **얼굴이 둘**이고, 둘 다 있어야 뜻이 선다:
 *  · 🔴 **확정된 회차의 납기요청일이 바뀌는 저장을 거절한다**(자리마다 날짜를 견준다).
 *  · 🔴 **확정된 회차가 있으면 줄 수를 줄이는 저장도 거절한다.** 하나만 두면
 *    「날짜는 못 고치는데 줄을 통째로 지우는 건 된다」가 되어, 날짜를 바꾸려는 사람이
 *    **지우고 새로 만들면 그만**이다 — 울타리가 있으나 마나 해진다. 모양은 바로 위
 *    셋째 울타리(완료)와 같다.
 *
 * 🔵 **비고·납품일·납품자는 그대로 고친다.** 확정은 **납기요청일**에 대한 표시이지
 * 그 행 전체에 대한 것이 아니다 — 다른 칸까지 잠그면 확정한 줄에 납품일을 적을
 * 길이 사라진다.
 * 🔵 **되얹기는 날짜를 보지 않는다**(mutations/domestic-orders.ts 의 replaceDueDates
 * — 완료와 똑같이 자리로 그대로 얹는다). 날짜가 바뀌는 일 자체를 여기서 막으므로,
 * 거기서 또 재면 **같은 규칙이 두 벌**이 되고 한쪽만 고쳐지는 날이 온다.
 * ============================================================================
 */

import { domesticOrderDueDateRowLabel } from "./domestic-order-due-date-label";

/**
 * 판정이 보는 행 하나.
 *
 * 🔴 **2026-11-25 에 `dueDate` 가 들어왔다** — 그 전까지 이 타입의 규칙은 「날짜도
 * 이름도 보지 않는다」였다. 넷째 울타리가 **자리마다 날짜를 견주는** 울타리라 그
 * 규칙을 깼다: 「적혀 있나」만으로는 **확정된 회차의 날짜가 바뀌었는가**를 가릴 수
 * 없다. 🔵 다른 셋은 여전히 날짜를 안 본다.
 */
export type DomesticOrderDueDateRowShape = {
  /** 이 행에 납품 기록(납품일 **또는** 납품자)이 적혀 있는가. */
  hasDelivery: boolean;
  /**
   * 🔴 이 회차가 **[완료 처리]되었는가**(2026-11-08). 새로 더하는 줄은 언제나 거짓이다.
   *
   * 🔴 **선택 칸으로 두지 않았다.** `isCompleted?: boolean` 이면 부르는 쪽이 빠뜨려도
   * tsc 가 침묵하고, 빠뜨린 자리에서는 셋째 울타리가 **조용히 꺼진다** — 울타리가
   * 꺼지는 실패는 화면에 아무 표시도 남기지 않는다.
   */
  isCompleted: boolean;
  /**
   * 🔴 그 회차의 **납기요청일**("YYYY-MM-DD", 2026-11-25). 편집 중에는 빈 문자열일 수
   * 있다(사람이 [납기요청일 추가]를 누르고 아직 날짜를 안 적은 줄).
   *
   * 🔴 넷째 울타리가 **저장 전후의 같은 자리**를 이 값으로 견준다. 다듬지 않고 그대로
   * 넘긴다 — 한쪽만 `trim()` 하면 공백 하나 차이로 「바뀌었다」가 되어 멀쩡한 저장이
   * 거절된다(빈 값을 접는 일은 검증 한 곳이 한다 — validation/domestic-order-input.ts).
   */
  dueDate: string;
  /**
   * 🔴 그 회차의 납기일이 **[납기일 확정]되었는가**(2026-11-25). 새로 더하는 줄은
   * 언제나 거짓이다 — 확정은 사람이 단추를 눌러야 찍힌다.
   *
   * 🔴 위 `isCompleted` 와 같은 까닭으로 **선택 칸이 아니다**: 빠뜨린 자리에서 넷째
   * 울타리가 조용히 꺼지고, 꺼진 울타리는 화면에 아무 표시도 남기지 않는다.
   */
  isConfirmed: boolean;
};

export type DomesticOrderDueDateRowGuardResult =
  | { ok: true }
  | {
      ok: false;
      /**
       * 거절 까닭. 🔴 **글자가 아니라 이 코드로 가른다** — 화면이 문장을 견주면
       * 문구를 다듬는 날 조용히 안 걸린다.
       */
      reason:
        | "DELIVERY_ON_REMOVED_ROW"
        | "MULTIPLE_ROWS_ON_LINKED_LINE"
        | "COMPLETED_ROW_ON_SHRINKING_LIST"
        /** 🔴 확정된 회차가 있는데 줄 수가 줄었다(2026-11-25, 넷째 울타리의 한 얼굴). */
        | "CONFIRMED_ROW_ON_SHRINKING_LIST"
        /** 🔴 확정된 회차의 납기요청일이 바뀌었다(2026-11-25, 넷째 울타리의 다른 얼굴). */
        | "CONFIRMED_ROW_DUE_DATE_CHANGED";
      /** 검증 오류로 올라갈 칸 이름. 목록 전체의 문제라 `dueDates` 하나다. */
      field: "dueDates";
      message: string;
    };

/** 🔴 결정 5 — 화면에도 같은 글자가 뜬다(두 곳이 다른 말을 하지 않게). */
export const DUE_DATE_ROW_HAS_DELIVERY_MESSAGE =
  "납품일이나 납품자가 적힌 납기요청일 줄은 지울 수 없습니다. " +
  "그 줄의 납품일·납품자를 먼저 지워 저장한 뒤에 줄을 지워 주세요.";

/** 🔴 결정 9 — 화면에도 같은 글자가 뜬다. */
export const LINKED_LINE_SINGLE_DUE_DATE_MESSAGE =
  "수리 건이 연결된 줄에는 납기요청일을 하나만 둘 수 있습니다. " +
  "분할 납품은 수리 건이 연결되지 않은 줄(기타건)에서만 여러 줄로 적습니다.";

/**
 * 🔴 결정 13 의 짝 — 화면에도 같은 글자가 뜬다.
 *
 * **무엇을 해야 하는지까지 적는다.** 「지울 수 없습니다」만 뜨면 사람은 막다른 길로
 * 읽지만, 회차별 완료는 되돌릴 수 있으므로 길이 있다.
 */
export const COMPLETED_DUE_DATE_ROW_MESSAGE =
  "완료 처리된 회차가 있어 납기요청일 줄을 지울 수 없습니다. " +
  "그 회차의 [완료 해제]를 먼저 누른 뒤에 줄을 지워 주세요.";

/**
 * 🔴 넷째 울타리 — **줄을 지우는 쪽**(2026-11-25). 화면에도 같은 글자가 뜬다.
 *
 * 위 완료 쪽 문장과 **같은 모양**이다: 「지울 수 없습니다」로 끝내지 않고 **무엇을
 * 먼저 해야 하는지**를 적는다. 확정은 되돌릴 수 있으므로 막다른 길이 아니고, 그
 * 사실이 문장에 보여야 사람이 [확정 해제]를 찾아간다.
 */
export const CONFIRMED_DUE_DATE_ROW_MESSAGE =
  "납기일이 확정된 회차가 있어 납기요청일 줄을 지울 수 없습니다. " +
  "그 회차의 [확정 해제]를 먼저 누른 뒤에 줄을 지워 주세요.";

/**
 * 🔴 넷째 울타리 — **날짜를 고치는 쪽**(2026-11-25). 위 둘과 달리 **상수가 아니라
 * 함수**다: 막힌 회차가 어느 것인지 말해야 하기 때문이다.
 *
 * 🔴 **회차 이름을 지어내지 않는다** — [승인] 탭 · 회차별 완료 단추 · 승인 요청
 * 드롭다운이 쓰는 그 한 줄을 그대로 받는다(domestic-order-due-date-label.ts).
 * 두 화면이 같은 회차를 다른 말로 부르면 사람은 그것이 같은 회차인지 알 수 없다.
 *
 * 🔵 **비고는 안 싣는다**(`note: null`). 이 울타리가 받는 행 모양에 비고가 없고,
 * 비고를 받자고 모양을 넓히면 **울타리와 상관없는 값**을 부르는 쪽 넷이 전부 들고
 * 다녀야 한다 — 회차 번호와 날짜만으로도 어느 줄인지 가려진다.
 */
export function confirmedDueDateRowChangedMessage(rowOrder: number, dueDate: string): string {
  const label = domesticOrderDueDateRowLabel(rowOrder, { dueDate, note: null });
  return (
    `납기일이 확정된 회차의 납기요청일은 고칠 수 없습니다(${label}). ` +
    "그 회차의 [확정 해제]를 먼저 누른 뒤에 날짜를 고쳐 주세요."
  );
}

/**
 * 이 저장이 두 울타리를 지나는가. 지나면 `{ ok: true }`.
 *
 * ── 결정 5 의 판정 — **「줄이 줄었는데 기록이 함께 줄었는가」** ─────────────
 * 자리(index)로 짝을 맞추지 않는다. 가운데 줄을 지우면 뒤 줄들이 한 칸씩 올라와,
 * 자리로 재면 **아무 기록도 안 잃은 저장까지 걸린다.** 보는 것은 수 둘이다:
 *
 *   줄이 줄었다(next < stored)  **그리고**  기록을 가진 행이 줄었다(N < S)
 *
 * 그래야 세 가지가 전부 맞는다:
 *  · 기록 없는 줄을 지운다 → 줄은 줄었지만 기록 수는 그대로 → **통과**
 *  · 기록을 **지우기만** 한다(줄은 그대로) → 줄 수가 안 줄었으므로 → **통과**
 *    🔴 이 길이 열려 있어야 한다. 막으면 기록이 있는 줄은 **영영 못 지운다.**
 *  · 기록 있는 줄을 지운다 → 둘 다 줄었다 → **거절**
 *
 * 🔵 한 번에 「기록을 지우면서 줄도 지우는」 저장은 거절된다(두 수가 함께 줄기
 * 때문이다). 두 번에 나눠 하면 되고, 거절 문장이 그 차례를 그대로 말한다 — 한
 * 저장 안에서 그 둘을 갈라 보려면 행마다 열쇠가 있어야 하는데, 이 payload 는
 * **차례가 곧 열쇠**인 목록이라(validation 의 DomesticOrderDueDateInput) 그 열쇠가
 * 없다.
 *
 * ── 결정 9 의 판정 — **「늘리는가」** ───────────────────────────────────
 * 거절하는 것은 *수리 건이 붙게 되는* 줄이 납기요청일을 **둘 이상 갖게 되는**
 * 저장이고, 빠져나가는 길은 하나뿐이다: **이미 붙어 있었고, 지금보다 늘지 않는다.**
 * 그래서 연결이 없던 줄에 수리 건을 새로 이어 붙이면서 날짜 둘을 들고 오는 저장도
 * 걸린다 — 그 저장이 끝나면 「수리 건이 붙은 줄에 날짜가 둘」이 되기 때문이다.
 */
export function checkDomesticOrderDueDateRows(input: {
  /** 이 저장 **전에** 그 줄에 붙어 있던 행들. 새로 만드는 줄이면 빈 목록이다. */
  storedRows: readonly DomesticOrderDueDateRowShape[];
  /** 이 저장으로 그 줄에 남게 될 행들. */
  nextRows: readonly DomesticOrderDueDateRowShape[];
  /** 저장 **전**의 수리 건 연결. 새로 만드는 줄이면 null 이다. */
  storedRepairCaseId: string | null;
  /** 이 저장으로 적히는 수리 건 연결. */
  nextRepairCaseId: string | null;
}): DomesticOrderDueDateRowGuardResult {
  const storedWithDelivery = input.storedRows.filter((row) => row.hasDelivery).length;
  const nextWithDelivery = input.nextRows.filter((row) => row.hasDelivery).length;
  const rowsShrank = input.nextRows.length < input.storedRows.length;
  // 🔴 셋째 울타리를 **맨 앞에서** 친다. 완료된 회차가 있는데 줄이 줄면, 그 저장이
  //    납품 기록까지 잃는지와 **상관없이** 거절이다 — 뒤에 두면 「납품 기록은 그대로인
  //    저장」이 결정 5 를 통과해 완료 표시를 잃은 채 저장된다.
  if (rowsShrank && input.storedRows.some((row) => row.isCompleted)) {
    return {
      ok: false,
      reason: "COMPLETED_ROW_ON_SHRINKING_LIST",
      field: "dueDates",
      message: COMPLETED_DUE_DATE_ROW_MESSAGE,
    };
  }
  // 🔴 넷째 울타리 — **줄을 지우는 쪽**(2026-11-25). 바로 위 셋째와 같은 셈이고
  //    자리도 바로 뒤다. 🔵 둘 다 걸리는 저장에서는 **완료 쪽이 먼저** 말한다 —
  //    그 차례를 바꾸면 2026-11-08 부터 그 문장을 글자로 재던 시험이 깨지고, 사람이
  //    해야 할 일은 어차피 둘 다라 어느 쪽을 먼저 말해도 길이 막히지 않는다.
  if (rowsShrank && input.storedRows.some((row) => row.isConfirmed)) {
    return {
      ok: false,
      reason: "CONFIRMED_ROW_ON_SHRINKING_LIST",
      field: "dueDates",
      message: CONFIRMED_DUE_DATE_ROW_MESSAGE,
    };
  }
  // 🔴 넷째 울타리 — **날짜를 고치는 쪽**(2026-11-25). 줄 수가 그대로인 저장에서도
  //    쳐야 한다(가장 흔한 길이 「날짜만 고치는 저장」이다).
  const changed = findConfirmedRowWithChangedDueDate(input.storedRows, input.nextRows);
  if (changed !== null) {
    return {
      ok: false,
      reason: "CONFIRMED_ROW_DUE_DATE_CHANGED",
      field: "dueDates",
      message: confirmedDueDateRowChangedMessage(changed.rowOrder, changed.dueDate),
    };
  }
  if (rowsShrank && nextWithDelivery < storedWithDelivery) {
    return {
      ok: false,
      reason: "DELIVERY_ON_REMOVED_ROW",
      field: "dueDates",
      message: DUE_DATE_ROW_HAS_DELIVERY_MESSAGE,
    };
  }

  if (input.nextRepairCaseId !== null && input.nextRows.length > 1) {
    const alreadyLinked = input.storedRepairCaseId !== null;
    const notGrowing = input.nextRows.length <= input.storedRows.length;
    if (!(alreadyLinked && notGrowing)) {
      return {
        ok: false,
        reason: "MULTIPLE_ROWS_ON_LINKED_LINE",
        field: "dueDates",
        message: LINKED_LINE_SINGLE_DUE_DATE_MESSAGE,
      };
    }
  }

  return { ok: true };
}

/**
 * 🔴 **확정된 회차 가운데 납기요청일이 달라진 첫 자리**(2026-11-25). 없으면 null.
 *
 * ── 🔴 왜 **자리(index)로** 견주는가 ────────────────────────────────────
 * 확정 두 칸은 **보내온 목록에 없는 값**이라(완료와 같다), 저장 통로가 지우기 전에
 * 읽어 두었다가 **같은 자리의 새 행에** 되얹는다(mutations 의 replaceDueDates).
 * 그러니 「1차의 확정」은 저장 뒤에도 1차에 얹힌다 — 그 자리의 날짜가 달라졌다면
 * **확정된 적 없는 날짜에 확정이 얹히는** 셈이고, 그것이 정확히 막아야 하는 일이다.
 *
 * 🔵 **줄이 줄어든 경우는 위에서 이미 걸린다.** 그래도 `next === undefined` 를 여기서
 * 「달라졌다」로 세는 것은, 이 함수만 떼어 불러도 답이 온전하기 위해서다 — 울타리의
 * 차례가 바뀌는 날 조용히 뚫리지 않는다.
 *
 * 🔴 **처음 걸린 것에서 멈춘다.** 전부 모아 말하면 문장이 길어지고, 사람이 해야 할
 * 다음 행동은 어차피 회차 하나씩이다(승인 관문이 같은 자리에서 같은 판단을 한다 —
 * mutations/domestic-orders.ts 의 checkMiscCaseCompletionApproval).
 */
function findConfirmedRowWithChangedDueDate(
  storedRows: readonly DomesticOrderDueDateRowShape[],
  nextRows: readonly DomesticOrderDueDateRowShape[]
): { rowOrder: number; dueDate: string } | null {
  for (const [index, stored] of storedRows.entries()) {
    if (!stored.isConfirmed) continue;
    const next = nextRows[index];
    if (next !== undefined && next.dueDate === stored.dueDate) continue;
    // 🔴 번호는 **차례**다(1부터) — 저장이 목록 index + 1 로 적으므로 화면의 「N차」와
    //    같은 번호이고, 승인 행이 회차를 가리키는 값과도 같다.
    return { rowOrder: index + 1, dueDate: stored.dueDate };
  }
  return null;
}

/**
 * 화면이 **[납기요청일 추가] 단추를 막아야 하는가.** 막아야 하면 까닭을, 아니면
 * null 을 돌려준다.
 *
 * 🔴 **서버의 울타리와 같은 규칙을 여기서 다시 적지 않는다** — 위 판정에 「한 줄
 * 더하면 어떻게 되나」를 그대로 물어본다. 두 곳이 따로 정하면 단추는 눌리는데 저장이
 * 거절되거나(혹은 그 반대로) 멀쩡한 줄에서 단추가 죽는다.
 *
 * 🔵 지금 화면에 보이는 줄 수를 `storedRows` 로 넘긴다 — 사람이 아직 저장하지 않은
 * 편집 중 목록이다. 그래서 「이미 둘인 줄」에서는 단추가 서고(늘지 않는 범위), 셋째를
 * 누르려는 순간에 막힌다. 서버가 거절하는 그 자리와 정확히 같다.
 */
export function domesticOrderAddDueDateBlockReason(input: {
  rows: readonly DomesticOrderDueDateRowShape[];
  repairCaseId: string | null;
}): string | null {
  const guard = checkDomesticOrderDueDateRows({
    storedRows: input.rows,
    // 🔴 새로 더하는 줄은 납품 기록도 완료 표시도 확정도 없다 — 셋 다 사람이 나중에
    //    적는다. 🔵 날짜도 빈 문자열이다(아직 안 적었다). 넷째 울타리는 **앞 자리**를
    //    견주므로 뒤에 붙는 이 줄 때문에 걸리는 일이 없다.
    nextRows: [
      ...input.rows,
      { hasDelivery: false, isCompleted: false, dueDate: "", isConfirmed: false },
    ],
    storedRepairCaseId: input.repairCaseId,
    nextRepairCaseId: input.repairCaseId,
  });
  return guard.ok ? null : guard.message;
}

/**
 * 🔴 화면이 **그 회차의 납기요청일 입력칸을 잠가야 하는가**(2026-11-25). 잠가야
 * 하면 까닭을, 아니면 null 을 돌려준다.
 *
 * 🔴 **규칙을 여기서 다시 적지 않는다** — 위 두 단추와 똑같이 **서버가 거절하는 그
 * 판정에** 물어본다: 「그 자리의 날짜를 무엇으로든 바꿔 보면 어떻게 되나」. 두 곳이
 * 따로 정하면 칸은 고쳐지는데 저장이 거절되거나, 멀쩡한 줄에서 칸이 죽는다.
 *
 * 🔵 이 잠금이 없어도 **자료는 안전하다**(거절은 서버가 한다). 잠그는 까닭은 사람이
 * 날짜를 다 고쳐 놓고 저장을 누른 뒤에야 「확정을 풀어라」를 듣는 일이 없게 하려는
 * 것이고, 까닭을 글로 함께 적는 것도 같은 이유다 — 까닭 없이 안 눌리는 칸은
 * 고장으로 읽힌다.
 */
export function domesticOrderDueDateChangeBlockReason(input: {
  rows: readonly DomesticOrderDueDateRowShape[];
  index: number;
  repairCaseId: string | null;
}): string | null {
  const guard = checkDomesticOrderDueDateRows({
    storedRows: input.rows,
    nextRows: input.rows.map((row, index) =>
      index === input.index ? { ...row, dueDate: DUE_DATE_CHANGE_PROBE } : row
    ),
    storedRepairCaseId: input.repairCaseId,
    nextRepairCaseId: input.repairCaseId,
  });
  return guard.ok ? null : guard.message;
}

/**
 * 🔴 위 물음에 쓰는 **있을 수 없는 날짜**. 실제 값은 언제나 `"YYYY-MM-DD"` 이거나
 * 빈 문자열이라(검증이 그 둘만 통과시킨다 — validation/domestic-order-input.ts),
 * 이 글자와 같아질 수 없다. 🔵 빈 문자열을 쓰면 **날짜를 아직 안 적은 줄**에서
 * 「안 바뀌었다」가 되어 그 줄만 잠금이 조용히 풀린다.
 */
const DUE_DATE_CHANGE_PROBE = "(다른 날짜)";

/**
 * 화면이 **[삭제] 단추를 막아야 하는가.** 막아야 하면 까닭을, 아니면 null 이다.
 *
 * 위와 같은 방식으로 서버 판정에 물어본다 — 그 줄 하나를 뺀 목록이 통과하는가.
 *
 * 🔴 **막히는 까닭이 셋이다**(2026-11-08 · 2026-11-25 에 하나씩 늘었다):
 *  · 그 줄에 납품 기록이 달려 있다(결정 5) — 그 줄만 막힌다.
 *  · 🔴 **그 기타건에 완료 처리된 회차가 있다**(결정 13 의 짝) — 그러면 **모든 줄의
 *    [삭제]가 막힌다.** 완료 표시가 자리로 따라가기 때문이고(파일 머리말), 어느 줄을
 *    지워도 뒤 줄들이 한 칸씩 당겨져 표시가 어긋난다. 「어떤 줄은 되고 어떤 줄은
 *    안 되는」 것처럼 보이지 않도록 **까닭을 단추마다 그대로 보여 준다.**
 *  · 🔴 **그 줄에 납기일이 확정된 회차가 있다**(2026-11-25, 넷째 울타리) — 위와
 *    **같은 모양으로 모든 줄의 [삭제]가 막힌다.** 까닭도 같다(확정도 자리로 따라간다).
 */
export function domesticOrderRemoveDueDateBlockReason(input: {
  rows: readonly DomesticOrderDueDateRowShape[];
  index: number;
  repairCaseId: string | null;
}): string | null {
  const guard = checkDomesticOrderDueDateRows({
    storedRows: input.rows,
    nextRows: input.rows.filter((_, index) => index !== input.index),
    storedRepairCaseId: input.repairCaseId,
    nextRepairCaseId: input.repairCaseId,
  });
  return guard.ok ? null : guard.message;
}
