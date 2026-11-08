/**
 * ============================================================================
 * 내자 정리 — **완료된 것은 잠근다** (2026-11-08)
 * ============================================================================
 * 사용자 결정 원문: 「해제하지 않으면 **내자정리의 어떤 내용도 수정할 수 없도록**
 * 해줘. 이건 **수리건과 연동되는 내용들도 마찬가지**야.」
 * 되물어 받은 답: 「**1차가 완료되면 1차와 관련된 내용들만** 잠기도록 해줘.」
 *
 * DB 도 React 도 여기 들어오지 않는다. 이 파일이 가진 것은 **거절하는 두 까닭**과
 * 그때 사람에게 보여 줄 **글**뿐이다.
 *
 * ── 🔴 잠기는 단위가 둘이다 ─────────────────────────────────────────────
 *  · **회차 하나**가 완료되면 → 그 회차의 **납기요청일 · 비고 · 납품일 · 납품자**.
 *    🔵 다른 회차는 그대로 고쳐지고, 줄의 다른 칸(발주서번호·금액·현황 …)도 그대로다.
 *  · **줄 전체**가 완료되면(`domestic_orders.completed_at`) → 🔴 **그 줄의 모든 칸.**
 *
 * 🔴 **그 넷이 「그 회차와 관련된 것」의 전부**인 것은 재서 확인했다 —
 * `domestic_order_due_dates` 의 칸 가운데 **사람이 보내는 값**이 그 넷뿐이다
 * (validation 의 DomesticOrderDueDateInput). 나머지 넷(`completed_at` ·
 * `completed_by` · `display_order` · `id`)은 서버가 제 손으로 적는 값이라 애초에
 * 폼이 보내지 않는다.
 *
 * ── 🔴 울타리는 **서버 한 곳**이다 ──────────────────────────────────────
 * 내자 줄의 칸을 고치는 길을 전부 세었다(2026-11-08 실측 — `update(domesticOrders)` ·
 * `insert|delete(domesticOrderDueDates)` 를 부르는 자리):
 *
 *  ① 표·카드의 **자리편집** 칸 열넷(DomesticOrderTextCell · DomesticOrderDueDatesCell ·
 *     DomesticOrderDeliveriesCell) — 전부 `updateDomesticOrderAction` 하나로 모인다.
 *  ② **`줄 수정` 폼**(DomesticOrderEditForm) — 같은 액션이다.
 *  ③ 🔴 **수리 건 상세의 「내자 정리 발행일」**(mutations/domestic-order-issue-dates.ts).
 *     ①② 와 **다른 저장 경로**다 — 그쪽은 줄 전체를 SET 하고 이쪽은 두 칸만 SET 한다
 *     (그 파일 머리말의 「그러니 합치지 마라」). 그래서 울타리도 **따로 한 번 더** 친다.
 *
 * 🔵 PO 통로(`/api/v1/domestic-orders/{id}/completion`)는 이 셋에 없다 — 그 통로가
 * 하는 일은 **완료 처리·완료 해제**뿐이고 칸을 고치지 않는다(그 라우트 머리말).
 * 그래서 이번 잠금으로 그 통로의 응답은 한 글자도 달라지지 않는다.
 *
 * 🔴 **화면에서만 막으면 하나 빠진 날 조용히 뚫린다.** 화면은 같은 판정을 미리
 * 물어 단추를 막고 까닭을 적지만(아래 …BlockReason), 거절은 저장 통로가 한다.
 *
 * ── 🔴 「그 행만 안 바뀌었는가」를 **자리(index)로** 잰다 ────────────────
 * 납기요청일 저장은 그 줄의 행을 통째로 지우고 받은 목록으로 다시 넣는다
 * (mutations/domestic-orders.ts 의 replaceDueDates). 그래서 보내온 목록에는 **행을
 * 가리키는 열쇠가 없다** — 차례가 곧 열쇠다(validation 의 DomesticOrderDueDateInput).
 *
 * 그 차례로 재는 것이 **옳다**는 근거가 둘이다:
 *  · 저장이 회차별 완료 표시를 되얹는 방식이 바로 **자리**다(replaceDueDates 의
 *    `storedRows[index]`). 서버가 「몇 차인가」를 정하는 그 셈과 **같은 셈**으로 잰다.
 *  · 🔴 **줄이 줄어드는 저장은 여기까지 오지 못한다** — 완료된 회차가 하나라도 있으면
 *    조각 A 의 셋째 울타리가 먼저 거절한다
 *    (domain/domestic-order-due-date-rows.ts 의 COMPLETED_ROW_ON_SHRINKING_LIST).
 *    그래서 보내온 목록은 **저장돼 있던 목록보다 짧지 않고**, index i 가 양쪽에서 같은
 *    회차를 가리킨다. 🔴 **그 울타리보다 뒤에서 불러야 한다** — 앞에 두면 줄이는
 *    저장에서 자리가 한 칸씩 밀려 엉뚱한 회차를 가리킨다.
 * 🔵 그래도 `nextRows[index]` 가 없는 경우를 「바뀌었다」로 접는다 — 위 차례가 언젠가
 *    뒤바뀌어도 이 판정이 조용히 통과하지 않도록.
 *
 * ── 🔴 줄 전체가 완료면 **값을 견주지 않고** 거절한다 ───────────────────
 * 회차 쪽과 달리 「무엇이 바뀌었나」를 세지 않는다. 사용자가 못 박은 말이 「어떤
 * 내용도 수정할 수 없도록」이라 **저장 자체**가 막히는 것이 맞고, 스물넉 칸을 견주려면
 * numeric(금액)·정수(순번)를 저장된 글자 모양 그대로 되돌려 보냈는가까지 따져야
 * 하는데 — 그 셈이 한 칸이라도 틀리면 **잠겨야 할 저장이 조용히 통과**한다.
 * 🔵 막다른 길이 아니다: **[완료 해제]는 언제나 눌린다**(아래).
 *
 * ── 🔴 **잠그지 않는 것** ───────────────────────────────────────────────
 *  · **[완료 해제]** 와 회차 **[N차 해제]** — 잠그면 한 번 완료한 줄이 **영영 못 고치는
 *    문**이 된다. 둘 다 이 파일을 부르지 않는 다른 함수다
 *    (setDomesticOrderCompletion · setDomesticOrderDueDateRowCompletion).
 *  · **휴지통(보내기·되살리기·완전삭제)** — 재서 정했다. 세 가지 까닭이다:
 *    ① 사용자가 말한 것은 「내용 **수정**」이고 지우기는 칸을 고치는 일이 아니다.
 *    ② 관문이 이미 한 칸 좁다(`domesticOrders` MANAGE — 수정은 WRITE).
 *    ③ 🔴 막으면 **막다른 길**이 생긴다 — 잘못 만든 줄을 완료해 버리면 지우려고
 *       [완료 해제]를 눌러야 하는데, 그 해제는 붙어 있는 수리 건의 **출하 완료까지
 *       되돌린다**(services/release-domestic-order.ts). 줄 하나 지우자고 멀쩡한 수리
 *       건을 뒤로 물리게 만드는 쪽이 더 나쁘다.
 *    🔵 휴지통은 완료 두 칸을 그대로 두고 옮기기만 한다(mutations/domestic-orders-trash.ts)
 *       — 복원하면 완료 표시가 그대로 돌아오므로 값이 조용히 바뀌는 일이 없다.
 *  · **출하 승인 요청·결재** — 완료는 승인의 결과이지 승인의 대상이 아니다.
 *
 * ── 🔴 수리 건 쪽에서 잠기는 칸은 **정확히 둘** ─────────────────────────
 * `customerRequestedDueDate`(고객 요청 납기일) · `actualShipmentDate`(실제 출하일).
 * 그 둘만 내자 줄과 양방향으로 묶여 있다(domain/requested-due-date-link.ts ·
 * domain/delivered-date-link.ts). 🔴 **수리 내용 · 부품 · 보고서 같은 A/S 본업은 그대로
 * 돌아간다** — 거기까지 막으면 내자 정리의 완료가 수리 업무를 세우게 된다.
 *
 * 🔴 **`isBlockedByShipmentLock` 을 되살리는 것이 아니다.** 그쪽은 「출하 완료된 건은
 * 통째로 읽기 전용」이라는 2026-10 에 **뒤집힌** 제품 정책이고(그 함수는 지금 언제나
 * 거짓이다), 이쪽은 「내자 줄이 완료됐으면 그 줄과 묶인 두 칸만」이다. 서는 자리도
 * 다르다 — 저쪽은 역할 표(auth/repair-case-edit-authorization.ts), 이쪽은 **DB 값을
 * 읽어야 아는 판단**이라 잠근 줄에서 보는 mutation 안이다(실제 출하일의 「이미 출하
 * 완료된 건만」이 같은 자리에 같은 모양으로 서 있다).
 *
 * ── 🔴 막는 말은 **어디서 왔는지**까지 말한다 ───────────────────────────
 * 첫 문장은 사용자가 못 박은 그대로 쓰고(DOMESTIC_ORDER_COMPLETED_LOCK_MESSAGE),
 * 뒤에 **어느 줄·어느 회차인지**와 **무엇을 먼저 눌러야 하는지**를 보탠다. 그 말이
 * 없으면 수리 건 상세에서 막힌 사람은 어느 내자 줄을 풀어야 하는지 알 길이 없다.
 * ============================================================================
 */

import { domesticOrderDueDateRowLabel } from "./domestic-order-due-date-label";

/**
 * 🔴 **사용자가 못 박은 한 문장.** 다듬지 말 것 — 원문이 그대로 요구 사항이다
 * (「[내자정리에서 완료 상태이므로 수정이 불가능합니다.]라는 팝업이 뜨도록 해줘」).
 * 세 거절이 전부 이 문장으로 시작하고, 뒤에 붙는 말만 자리마다 다르다.
 */
export const DOMESTIC_ORDER_COMPLETED_LOCK_MESSAGE =
  "내자정리에서 완료 상태이므로 수정이 불가능합니다.";

/** 🔴 줄 전체가 완료된 줄을 고치려 했다 — 화면도 같은 글자를 쓴다(두 곳이 갈리지 않게). */
export const DOMESTIC_ORDER_LINE_COMPLETED_MESSAGE =
  `${DOMESTIC_ORDER_COMPLETED_LOCK_MESSAGE} 이 줄의 [완료 해제]를 먼저 누른 뒤에 고쳐 주세요.`;

/** 잠금 판정이 보는 행 하나 — **사람이 보내는 네 칸**이 전부다(머리말). */
export type DomesticOrderCompletionLockRow = {
  dueDate: string;
  note: string | null;
  deliveredDate: string | null;
  deliveredBy: string | null;
};

/** 저장 **전**에 그 줄에 적혀 있던 행. 완료 표시가 함께 온다. */
export type DomesticOrderCompletionLockStoredRow = DomesticOrderCompletionLockRow & {
  /**
   * 🔴 이 회차가 [완료 처리]되었는가. **선택 칸으로 두지 않았다** — `?:` 면 부르는
   * 쪽이 빠뜨려도 tsc 가 침묵하고, 빠뜨린 자리에서 울타리가 **조용히 꺼진다**.
   */
  isCompleted: boolean;
};

export type DomesticOrderCompletionLockResult =
  | { ok: true }
  | {
      ok: false;
      /**
       * 거절 까닭. 🔴 **글자가 아니라 이 코드로 가른다** — 화면이 문장을 견주면
       * 문구를 다듬는 날 조용히 안 걸린다(조각 A 의 울타리와 같은 규칙).
       */
      reason: "LINE_COMPLETED" | "DUE_DATE_ROW_COMPLETED";
      /**
       * 거절을 붙일 칸 이름. 회차가 막은 것이면 목록 전체의 문제라 `dueDates` 하나이고,
       * 줄 전체가 잠긴 것이면 **어느 한 칸의 문제가 아니라서** null 이다.
       */
      field: "dueDates" | null;
      message: string;
    };

/**
 * 🔴 그 회차가 완료돼서 막혔을 때의 글 — **어느 회차인지**와 **무엇을 먼저 눌러야
 * 하는지**를 함께 말한다.
 *
 * 회차를 부르는 말은 지어내지 않고 **그 한 줄**을 그대로 받는다
 * (domain/domestic-order-due-date-label.ts). [승인] 탭의 회차 머리 · 드롭다운 ·
 * 회차별 완료 단추가 전부 그 말을 쓰므로, 여기서만 다르게 부르면 사람은 같은 회차인지
 * 알 수 없다.
 */
export function domesticOrderDueDateRowLockedMessage(
  rowOrder: number,
  row: { dueDate: string | null; note: string | null }
): string {
  return (
    `${DOMESTIC_ORDER_COMPLETED_LOCK_MESSAGE} ` +
    // 🔵 이름표 **바로 뒤에 조사를 붙이지 않는다** — 그 글자는 날짜나 괄호로 끝나서
    //    「…2096-12-01 가」처럼 읽히는 자리가 생긴다. 「회차가」를 받치면 어떤
    //    이름표가 와도 말이 되고, 이름표는 **한 글자도 지어내지 않은 채** 그대로다.
    `${domesticOrderDueDateRowLabel(rowOrder, row)} 회차가 완료 처리되어 ` +
    `그 회차의 납기요청일·비고·납품일·납품자는 고칠 수 없습니다. ` +
    `[${rowOrder}차 해제]를 먼저 누른 뒤에 고쳐 주세요.`
  );
}

/**
 * 🔴 **수리 건 상세**에서 묶인 두 칸이 막혔을 때의 글.
 *
 * 🔴 **어느 줄인지를 반드시 말한다** — 한 수리 건에 내자 줄이 여럿일 수 있고, 첫
 * 문장만 뜨면 사람은 어느 줄의 [완료 해제]를 눌러야 하는지 알 수 없다. 줄을 알아보는
 * 단서로 **발주서번호**를 쓴다(그 화면에서 줄을 부르는 이름이고, 사람 이름이 섞이는
 * 칸이 아니라 PII 걱정도 없다 — schema 의 PII 항목에 그 칸은 없다).
 *
 * 🔵 발주서번호가 비어 있는 줄이 실제로 있다(견적서 없이 들어온 줄·손으로 만든 줄).
 * 그때는 그 사실을 그대로 적는다 — 빈 괄호를 남기면 글자가 깨진 것으로 읽힌다.
 */
export function domesticOrderLinkedFieldLockedMessage(line: {
  purchaseOrderNumber: string | null;
}): string {
  const number = (line.purchaseOrderNumber ?? "").trim();
  const which = number === "" ? "발주서번호가 비어 있는 줄" : `발주서번호 ${number}`;
  return (
    `${DOMESTIC_ORDER_COMPLETED_LOCK_MESSAGE} ` +
    `이 건에 연결된 내자 정리 줄(${which})이 완료 상태라, ` +
    `고객 요청 납기일과 실제 출하일은 그 줄과 함께 잠겨 있습니다. ` +
    `내자 정리에서 그 줄의 [완료 해제]를 먼저 누른 뒤에 고쳐 주세요.`
  );
}

/**
 * 이 저장이 잠금을 지나는가. 지나면 `{ ok: true }`.
 *
 * 보는 차례가 곧 뜻이다:
 *  ① **줄 전체가 완료**면 무엇을 보냈든 거절이다(머리말의 「값을 견주지 않고」).
 *  ② 아니면 **완료된 회차마다** 네 칸을 견준다. 하나라도 달라졌으면 그 회차의 거절이다.
 *
 * 🔴 **①② 둘 다 「저장돼 있던 쪽」이 기준이다** — 보내온 목록에는 완료 표시가 없다
 * (폼이 보내지 않는 값이라 서버가 제 손으로 되얹는다). 보내온 쪽을 보면 울타리가
 * 영영 안 걸린다.
 */
export function checkDomesticOrderCompletionLock(input: {
  /** 저장 **전**의 `domestic_orders.completed_at` 이 차 있는가. */
  lineCompleted: boolean;
  /** 저장 **전**에 그 줄에 붙어 있던 행들 — **차례대로**(display_order 순). */
  storedRows: readonly DomesticOrderCompletionLockStoredRow[];
  /** 이 저장으로 그 줄에 남게 될 행들 — 같은 차례다. */
  nextRows: readonly DomesticOrderCompletionLockRow[];
}): DomesticOrderCompletionLockResult {
  if (input.lineCompleted) {
    return {
      ok: false,
      reason: "LINE_COMPLETED",
      field: null,
      message: DOMESTIC_ORDER_LINE_COMPLETED_MESSAGE,
    };
  }

  for (const [index, stored] of input.storedRows.entries()) {
    if (!stored.isCompleted) continue;
    const next = input.nextRows[index];
    // 🔵 `next` 가 없는 길은 조각 A 가 먼저 막는다(머리말) — 그래도 「바뀌었다」로
    //    접는다. 차례가 언젠가 뒤바뀌어도 이 판정이 조용히 통과하지 않도록.
    if (next !== undefined && !dueDateRowChanged(stored, next)) continue;
    return {
      ok: false,
      reason: "DUE_DATE_ROW_COMPLETED",
      field: "dueDates",
      message: domesticOrderDueDateRowLockedMessage(index + 1, stored),
    };
  }

  return { ok: true };
}

/**
 * 🔴 **빈 값을 한 가지 모양으로 접는다** — 공백만 적힌 글자와 `null` 은 같은 뜻이다.
 *
 * 양쪽을 **똑같이** 접는 것이 요점이다. 보내오는 쪽은 저장 검증이 이미 다듬어
 * 놓지만(validation 의 `trim()` · `"" → null`), 저장돼 있는 쪽은 그렇지 않을 수
 * 있다 — 이 표는 PO 사이트와 함께 쓰고 옛 자료도 들어 있다. 접지 않으면 비고에
 * 공백 한 칸이 섞인 회차 하나가 **그 줄의 다른 칸을 고치는 저장까지** 막는다
 * (화면은 저장된 값을 그대로 되실어 보내는데, 검증이 그것을 다듬어 「바뀌었다」가
 * 되기 때문이다). 사람은 까닭을 알 길도, 고칠 길도 없다.
 */
function foldBlank(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 그 행의 **네 칸 가운데 하나라도** 달라졌는가.
 *
 * 🔴 날짜도 글자 그대로 견준다 — 양쪽 다 "YYYY-MM-DD" 이고(저장은 `date` 칼럼,
 * 입력은 그 형식만 통과시키는 검증), Date 로 바꿔 비교하면 시간대 때문에 같은 날이
 * 다르게 나올 수 있다.
 */
function dueDateRowChanged(
  stored: DomesticOrderCompletionLockRow,
  next: DomesticOrderCompletionLockRow
): boolean {
  return (
    foldBlank(stored.dueDate) !== foldBlank(next.dueDate) ||
    foldBlank(stored.note) !== foldBlank(next.note) ||
    foldBlank(stored.deliveredDate) !== foldBlank(next.deliveredDate) ||
    foldBlank(stored.deliveredBy) !== foldBlank(next.deliveredBy)
  );
}

/**
 * 화면이 **그 줄의 편집칸을 열어 줘도 되는가.** 막아야 하면 까닭을, 아니면 null 이다.
 *
 * 🔴 **서버의 울타리와 같은 규칙을 여기서 다시 적지 않는다** — 위 판정에 물어본다.
 * 두 곳이 따로 정하면 칸은 열리는데 저장이 거절되거나(혹은 그 반대로) 멀쩡한 줄에서
 * 칸이 죽는다.
 */
export function domesticOrderLineEditBlockReason(row: { completedAt: Date | string | null }): string | null {
  const guard = checkDomesticOrderCompletionLock({
    lineCompleted: row.completedAt !== null,
    storedRows: [],
    nextRows: [],
  });
  return guard.ok ? null : guard.message;
}

/**
 * 화면이 **그 회차의 입력칸을 열어 줘도 되는가.** 막아야 하면 까닭을, 아니면 null 이다.
 *
 * 🔵 편집 중인 목록을 그대로 넘긴다 — 아직 저장하지 않은 값이라도 「이 회차는 완료라
 * 못 고친다」는 답은 달라지지 않는다. 묻는 것은 **그 자리의 완료 표시** 하나다.
 */
export function domesticOrderDueDateRowEditBlockReason(input: {
  rowOrder: number;
  row: { dueDate: string | null; note: string | null; isCompleted: boolean };
}): string | null {
  if (!input.row.isCompleted) return null;
  return domesticOrderDueDateRowLockedMessage(input.rowOrder, input.row);
}
