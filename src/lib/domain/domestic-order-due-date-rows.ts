/**
 * ============================================================================
 * 내자 정리 — 납기요청일 **행을 더하고 지우는** 울타리 둘 (2026-11-08)
 * ============================================================================
 * DB 도 React 도 여기 들어오지 않는다. 이 파일이 가진 것은 **저장을 거절하는
 * 두 가지 까닭**뿐이고, 둘 다 사용자가 못 박은 결정이다(2026-11-07):
 *
 *   결정 5 — 🔴 **납품 기록이 있으면 납기요청일 줄을 못 지운다.**
 *   결정 9 — 🔴 **수리 건이 붙은 줄은 납기요청일을 둘 이상 못 만든다.**
 *            (「납품을 여러 날짜에 나눠서 하게 되는건 기타건 밖에 없어.」)
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
 * ============================================================================
 */

/** 판정이 보는 행 하나. 🔴 **날짜도 이름도 보지 않는다** — 「적혀 있나」뿐이다. */
export type DomesticOrderDueDateRowShape = {
  /** 이 행에 납품 기록(납품일 **또는** 납품자)이 적혀 있는가. */
  hasDelivery: boolean;
};

export type DomesticOrderDueDateRowGuardResult =
  | { ok: true }
  | {
      ok: false;
      /**
       * 거절 까닭. 🔴 **글자가 아니라 이 코드로 가른다** — 화면이 문장을 견주면
       * 문구를 다듬는 날 조용히 안 걸린다.
       */
      reason: "DELIVERY_ON_REMOVED_ROW" | "MULTIPLE_ROWS_ON_LINKED_LINE";
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
    nextRows: [...input.rows, { hasDelivery: false }],
    storedRepairCaseId: input.repairCaseId,
    nextRepairCaseId: input.repairCaseId,
  });
  return guard.ok ? null : guard.message;
}

/**
 * 화면이 **[삭제] 단추를 막아야 하는가.** 막아야 하면 까닭을, 아니면 null 이다.
 *
 * 위와 같은 방식으로 서버 판정에 물어본다 — 그 줄 하나를 뺀 목록이 통과하는가.
 * 🔵 납품 기록이 **없는** 줄을 지우는 것은 언제나 통과하므로, 이 함수가 글을
 * 돌려주는 줄은 곧 「납품 기록이 달린 줄」이다.
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
