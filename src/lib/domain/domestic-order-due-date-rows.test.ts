import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkDomesticOrderDueDateRows,
  COMPLETED_DUE_DATE_ROW_MESSAGE,
  confirmedDueDateRowChangedMessage,
  CONFIRMED_DUE_DATE_ROW_MESSAGE,
  domesticOrderAddDueDateBlockReason,
  domesticOrderDueDateChangeBlockReason,
  domesticOrderRemoveDueDateBlockReason,
  DUE_DATE_ROW_HAS_DELIVERY_MESSAGE,
  LINKED_LINE_SINGLE_DUE_DATE_MESSAGE,
} from "./domestic-order-due-date-rows";

/**
 * ============================================================================
 * 납기요청일 행을 더하고 지우는 울타리 셋 (2026-11-08)
 * ============================================================================
 * 이 시험이 지키는 것:
 *
 *  1. 🔴 **결정 5** — 납품 기록이 달린 줄을 지우는 저장은 거절된다. 🔴 그런데
 *     **기록을 지우기만 하는 저장은 통과해야 한다** — 막으면 그 줄은 영영 못
 *     지운다(닫는 길이 없는 문이 된다).
 *  2. 🔴 **결정 9** — 수리 건이 붙은 줄은 납기요청일을 **늘릴 수 없다**. 🔴 이미
 *     둘 이상인 줄은 **막다른 길이 되면 안 된다** — 줄이는 쪽은 열려 있다.
 *  3. 🔵 화면의 두 단추가 **서버가 거절하는 그 판정**에 물어본다 — 두 곳이 따로
 *     정하면 단추는 눌리는데 저장이 거절되거나, 멀쩡한 줄에서 단추가 죽는다.
 *  4. 🔴 **결정 13 의 짝**(2026-11-08) — 완료 처리된 회차가 있으면 줄 수를 **줄일 수
 *     없다**. 완료 표시가 자리로 따라가기 때문이고(그 파일 머리말), 늘리는 쪽과
 *     완료를 푸는 쪽은 열려 있어야 한다.
 *  5. 🔴 **확정 잠금**(2026-11-25 사용자 결정 — 「[확정 해제]를 해야만 날짜를 고칠 수
 *     있도록 해줘」) — 납기일이 확정된 회차는 **날짜를 못 고치고 그 줄도 못 지운다**.
 *     🔵 그 옆에 **통과해야 하는 저장**을 함께 잰다(비고·납품 고치기 · 뒤에 더하기 ·
 *     해제한 뒤 고치기) — 「막는다」만 재면 **전부 막아 버린 구현**도 통과한다.
 * ============================================================================
 */

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CASE_ID = "22222222-2222-4222-8222-222222222222";

/**
 * 🔴 **모든 표본이 같은 날짜를 쓴다**(2026-11-25). 넷째 울타리는 **자리마다 날짜를
 * 견주는** 울타리라, 표본마다 날짜가 다르면 ①~④ 의 시험들이 「날짜가 바뀐 저장」이
 * 되어 엉뚱한 까닭으로 거절된다 — 그 묶음들이 재려는 것은 날짜가 아니다.
 * 🔵 날짜를 **일부러 바꾸는** 시험은 아래 ⑤ 가 제 표본을 손으로 만든다.
 */
const DATE = "2026-01-20";

/**
 * 납품 기록이 있는 행 / 없는 행.
 *
 * 🔴 **2026-11-08 에 칸이 하나 늘었다**(`isCompleted`) — 회차별 [완료 처리]가 생기면서
 * 셋째 울타리가 붙었다. 이 묶음(① · ②)의 시험들은 **완료되지 않은 줄**을 재던 것이라
 * 전부 거짓으로 둔다: 아래 ③ 이 새로 생긴 울타리를 따로 잰다.
 * 🔴 **2026-11-25 에 둘 더 늘었다**(`dueDate` · `isConfirmed`) — 넷째 울타리(확정
 * 잠금)가 붙었다. 같은 까닭으로 ①~④ 의 표본은 전부 **확정 안 된 회차**다.
 */
const WITH = { hasDelivery: true, isCompleted: false, dueDate: DATE, isConfirmed: false };
const WITHOUT = { hasDelivery: false, isCompleted: false, dueDate: DATE, isConfirmed: false };
/** 🔴 **완료 처리된 회차**. 납품 기록은 따로 본다 — 완료가 납품을 뜻하지는 않는다. */
const DONE = { hasDelivery: true, isCompleted: true, dueDate: DATE, isConfirmed: false };
const DONE_WITHOUT_DELIVERY = {
  hasDelivery: false,
  isCompleted: true,
  dueDate: DATE,
  isConfirmed: false,
};
/**
 * 🔴 **납기일이 확정된 회차**(2026-11-25). 완료와 **따로 둔다** — 둘은 뜻이 다르고
 * (「끝났다」 ↔ 「이 날짜가 더 이상 안 바뀐다」), 한 표본에 둘 다 찍어 두면 둘 중
 * 하나만 보는 구현도 통과한다.
 */
const CONFIRMED = { hasDelivery: false, isCompleted: false, dueDate: DATE, isConfirmed: true };
/**
 * **보내온 목록**의 같은 자리인데 **날짜만 다른** 행 — 넷째 울타리가 걸러야 하는
 * 바로 그 모양이다.
 *
 * 🔴 `isConfirmed` 가 **거짓인 것이 실제 모양**이다: 보내온 목록에는 확정 표시가 없고
 * (저장 통로가 전부 거짓으로 넘긴다 — mutations/domestic-orders.ts 의
 * checkDueDateRowGuard), 울타리는 **저장돼 있던 쪽**의 확정만 본다.
 */
const MOVED = { ...WITHOUT, dueDate: "2026-03-09" };

function check(input: Parameters<typeof checkDomesticOrderDueDateRows>[0]) {
  return checkDomesticOrderDueDateRows(input);
}

// ── ① 결정 5 — 납품 기록이 달린 줄은 못 지운다 ────────────────────────────

test("🔴 납품 기록이 달린 줄을 지우는 저장은 거절된다", () => {
  const result = check({
    storedRows: [WITH],
    nextRows: [],
    storedRepairCaseId: null,
    nextRepairCaseId: null,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "DELIVERY_ON_REMOVED_ROW");
  assert.equal(result.field, "dueDates");
  assert.equal(result.message, DUE_DATE_ROW_HAS_DELIVERY_MESSAGE);
  // 🔴 **무엇을 먼저 해야 하는지**가 글에 있어야 한다 — 「못 지운다」만 적으면
  //    사람은 그 줄을 영영 못 지우는 줄 안다.
  assert.ok(result.message.includes("먼저 지워"), "지우는 차례를 안 말한다");
});

test("🔴 기록 **없는** 줄을 지우는 것은 통과한다 — 자리로 짝을 맞추면 이것까지 걸린다", () => {
  // 가운데(혹은 앞) 줄을 지우면 뒤 줄들이 한 칸씩 올라온다. 자리로 재면 아무
  // 기록도 안 잃은 이 저장까지 거절된다.
  assert.deepEqual(
    check({
      storedRows: [WITHOUT, WITH],
      nextRows: [WITH],
      storedRepairCaseId: null,
      nextRepairCaseId: null,
    }),
    { ok: true }
  );
});

test("🔴 기록을 **지우기만** 하는 저장은 통과한다 — 막으면 그 줄은 영영 못 지운다", () => {
  assert.deepEqual(
    check({
      storedRows: [WITH],
      nextRows: [WITHOUT],
      storedRepairCaseId: null,
      nextRepairCaseId: null,
    }),
    { ok: true }
  );
  // 그리고 그다음 저장에서 줄을 지울 수 있다(두 걸음이 실제로 통한다).
  assert.deepEqual(
    check({
      storedRows: [WITHOUT],
      nextRows: [],
      storedRepairCaseId: null,
      nextRepairCaseId: null,
    }),
    { ok: true }
  );
});

test("줄을 더하는 저장은 기록이 있어도 통과한다 — 줄 수가 줄지 않았다", () => {
  assert.deepEqual(
    check({
      storedRows: [WITH],
      nextRows: [WITH, WITHOUT],
      storedRepairCaseId: null,
      nextRepairCaseId: null,
    }),
    { ok: true }
  );
});

test("기록 둘 중 하나가 달린 줄을 지우면 거절된다 — 남은 하나로는 못 가린다", () => {
  const result = check({
    storedRows: [WITH, WITH],
    nextRows: [WITH],
    storedRepairCaseId: null,
    nextRepairCaseId: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "DELIVERY_ON_REMOVED_ROW");
});

// ── ② 결정 9 — 수리 건이 붙은 줄은 납기요청일 하나 ────────────────────────

test("🔴 수리 건이 붙은 새 줄에 납기요청일 둘을 달면 거절된다", () => {
  const result = check({
    storedRows: [],
    nextRows: [WITHOUT, WITHOUT],
    storedRepairCaseId: null,
    nextRepairCaseId: CASE_ID,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "MULTIPLE_ROWS_ON_LINKED_LINE");
  assert.equal(result.message, LINKED_LINE_SINGLE_DUE_DATE_MESSAGE);
  // 🔴 **어디서는 되는지**를 말한다 — 금지만 적으면 분할 납품을 아예 못 적는 줄 안다.
  assert.ok(result.message.includes("기타건"), "분할 납품을 어디서 적는지 안 말한다");
});

test("🔴 기타건(수리 건이 안 붙은 줄)에서는 둘 이상이 된다", () => {
  assert.deepEqual(
    check({
      storedRows: [WITHOUT],
      nextRows: [WITHOUT, WITHOUT, WITHOUT],
      storedRepairCaseId: null,
      nextRepairCaseId: null,
    }),
    { ok: true }
  );
});

test("🔴 이미 둘인 **붙은 줄**은 막다른 길이 되면 안 된다 — 늘리지만 않으면 통과", () => {
  // 운영에는 0줄이지만 개발 DB 에 실제로 하나 있다(2026-11-07 실측). 그 줄에서
  // 다른 칸 하나를 고치는 저장까지 거절하면 그 줄은 영영 고칠 수 없는 줄이 된다.
  assert.deepEqual(
    check({
      storedRows: [WITHOUT, WITHOUT],
      nextRows: [WITHOUT, WITHOUT],
      storedRepairCaseId: CASE_ID,
      nextRepairCaseId: CASE_ID,
    }),
    { ok: true }
  );
  // 줄이는 쪽도 열려 있다 — 사람이 스스로 정상 모양으로 돌아갈 수 있어야 한다.
  assert.deepEqual(
    check({
      storedRows: [WITHOUT, WITHOUT],
      nextRows: [WITHOUT],
      storedRepairCaseId: CASE_ID,
      nextRepairCaseId: CASE_ID,
    }),
    { ok: true }
  );
  // 늘리는 쪽만 막힌다.
  const grown = check({
    storedRows: [WITHOUT, WITHOUT],
    nextRows: [WITHOUT, WITHOUT, WITHOUT],
    storedRepairCaseId: CASE_ID,
    nextRepairCaseId: CASE_ID,
  });
  assert.equal(grown.ok, false);
  if (!grown.ok) assert.equal(grown.reason, "MULTIPLE_ROWS_ON_LINKED_LINE");
});

test("🔴 날짜 둘을 든 채 수리 건을 **새로 이어 붙이는** 저장도 거절된다", () => {
  // 그 저장이 끝나면 「수리 건이 붙은 줄에 날짜가 둘」이 된다 — 결과가 같으므로
  // 같은 자리에서 막혀야 한다.
  const result = check({
    storedRows: [WITHOUT, WITHOUT],
    nextRows: [WITHOUT, WITHOUT],
    storedRepairCaseId: null,
    nextRepairCaseId: CASE_ID,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "MULTIPLE_ROWS_ON_LINKED_LINE");
});

test("🔵 수리 건을 **갈아 끼우는** 저장은 이미 붙어 있던 줄로 친다", () => {
  // 「이미 붙어 있었고 늘지 않았다」가 빠져나가는 조건이다 — 어느 건에 붙어
  // 있었는지는 이 판정이 보지 않는다(그 판단은 저장 통로의 묶기가 따로 한다).
  assert.deepEqual(
    check({
      storedRows: [WITHOUT, WITHOUT],
      nextRows: [WITHOUT, WITHOUT],
      storedRepairCaseId: OTHER_CASE_ID,
      nextRepairCaseId: CASE_ID,
    }),
    { ok: true }
  );
});

test("붙은 줄에 하나만 두는 것은 언제나 통과한다", () => {
  assert.deepEqual(
    check({
      storedRows: [],
      nextRows: [WITHOUT],
      storedRepairCaseId: null,
      nextRepairCaseId: CASE_ID,
    }),
    { ok: true }
  );
});

// ── ③ 화면의 두 단추 ───────────────────────────────────────────────────────

test("🔵 [추가] 단추는 서버 판정에 물어본다 — 붙은 줄에 하나가 이미 있으면 막힌다", () => {
  assert.equal(
    domesticOrderAddDueDateBlockReason({ rows: [], repairCaseId: CASE_ID }),
    null,
    "첫 줄은 더할 수 있어야 한다"
  );
  assert.equal(
    domesticOrderAddDueDateBlockReason({ rows: [WITHOUT], repairCaseId: CASE_ID }),
    LINKED_LINE_SINGLE_DUE_DATE_MESSAGE
  );
  // 기타건에서는 몇이든 더할 수 있다.
  assert.equal(
    domesticOrderAddDueDateBlockReason({ rows: [WITHOUT, WITHOUT], repairCaseId: null }),
    null
  );
});

test("🔵 [삭제] 단추도 같은 판정에 물어본다 — 납품 기록이 달린 줄에서만 막힌다", () => {
  assert.equal(
    domesticOrderRemoveDueDateBlockReason({ rows: [WITHOUT], index: 0, repairCaseId: null }),
    null
  );
  assert.equal(
    domesticOrderRemoveDueDateBlockReason({ rows: [WITH], index: 0, repairCaseId: null }),
    DUE_DATE_ROW_HAS_DELIVERY_MESSAGE
  );
  // 기록이 있는 줄이 **다른 자리**에 있으면 이 줄은 지울 수 있다.
  assert.equal(
    domesticOrderRemoveDueDateBlockReason({ rows: [WITHOUT, WITH], index: 0, repairCaseId: null }),
    null
  );
  assert.equal(
    domesticOrderRemoveDueDateBlockReason({ rows: [WITHOUT, WITH], index: 1, repairCaseId: null }),
    DUE_DATE_ROW_HAS_DELIVERY_MESSAGE
  );
});

// ── ④ 🔴 결정 13 의 짝 — 완료 처리된 회차가 있으면 줄을 못 지운다 ────────────

test("🔴 완료 처리된 회차가 있으면 줄을 지우는 저장이 거절된다", () => {
  const result = check({
    storedRows: [DONE_WITHOUT_DELIVERY, WITHOUT],
    nextRows: [WITHOUT],
    storedRepairCaseId: null,
    nextRepairCaseId: null,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "COMPLETED_ROW_ON_SHRINKING_LIST");
  assert.equal(result.field, "dueDates");
  assert.equal(result.message, COMPLETED_DUE_DATE_ROW_MESSAGE);
  // 🔴 **무엇을 먼저 해야 하는지**가 글에 있어야 한다 — 회차별 완료는 되돌릴 수 있으니
  //    막다른 길이 아니고, 그 사실이 문장에 보여야 한다.
  assert.ok(result.message.includes("[완료 해제]"), "되돌리는 길을 안 말한다");
});

test("🔴 납품 기록이 **없는** 완료 회차도 막는다 — 결정 5 만으로는 안 걸린다", () => {
  // 🔵 이 표본이 바로 「두 울타리가 겹치지 않는」 자리다: 납품 기록이 없으므로 결정 5 의
  //    셈(기록을 가진 행이 줄었나)으로는 통과해 버린다. 셋째 울타리가 없으면 이 저장이
  //    **완료 표시를 조용히 잃은 채** 성공한다.
  const withoutThirdGuard = check({
    storedRows: [WITHOUT, DONE_WITHOUT_DELIVERY],
    nextRows: [WITHOUT],
    storedRepairCaseId: null,
    nextRepairCaseId: null,
  });
  assert.equal(withoutThirdGuard.ok, false);
  if (withoutThirdGuard.ok) return;
  assert.equal(withoutThirdGuard.reason, "COMPLETED_ROW_ON_SHRINKING_LIST");
});

test("🔴 셋째 울타리가 결정 5 보다 **먼저** 친다 — 둘 다 걸리는 저장에서", () => {
  // 완료되고 납품 기록도 있는 줄을 지우면 두 울타리에 다 걸린다. 사람이 먼저 해야 할
  // 일은 **완료 해제**이므로(완료를 풀지 않으면 납품을 지워도 여전히 막힌다) 그 말이
  // 나와야 한다.
  const result = check({
    storedRows: [DONE],
    nextRows: [],
    storedRepairCaseId: null,
    nextRepairCaseId: null,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "COMPLETED_ROW_ON_SHRINKING_LIST");
});

test("🔵 완료된 회차가 있어도 **늘리는** 저장은 통과한다 — 앞 자리가 그대로다", () => {
  assert.deepEqual(
    check({
      storedRows: [DONE_WITHOUT_DELIVERY],
      nextRows: [DONE_WITHOUT_DELIVERY, WITHOUT],
      storedRepairCaseId: null,
      nextRepairCaseId: null,
    }),
    { ok: true }
  );
});

test("🔵 완료된 회차가 있어도 **줄 수가 그대로면** 통과한다 — 날짜·비고 고치기", () => {
  assert.deepEqual(
    check({
      storedRows: [DONE_WITHOUT_DELIVERY, WITHOUT],
      nextRows: [WITHOUT, WITHOUT],
      storedRepairCaseId: null,
      nextRepairCaseId: null,
    }),
    { ok: true }
  );
});

test("🔴 완료를 풀면 다시 지울 수 있다 — 막다른 길이 아니다", () => {
  // 두 걸음이 실제로 통하는지 잰다: ① 완료 해제(이 표의 밖에서 일어난다) → ② 줄 지우기.
  assert.deepEqual(
    check({
      storedRows: [WITHOUT, WITHOUT],
      nextRows: [WITHOUT],
      storedRepairCaseId: null,
      nextRepairCaseId: null,
    }),
    { ok: true }
  );
});

test("🔴 [삭제] 단추는 **그 기타건의 모든 줄에서** 막힌다 — 완료 회차가 하나라도 있으면", () => {
  // 완료 표시가 자리로 따라가므로 어느 줄을 지워도 뒤 줄이 당겨져 어긋난다. 그래서
  // 「완료된 그 줄만」이 아니라 전부 막는 것이 맞다 — 까닭이 단추마다 보여야 한다.
  const rows = [WITHOUT, DONE_WITHOUT_DELIVERY, WITHOUT];
  for (const index of [0, 1, 2]) {
    assert.equal(
      domesticOrderRemoveDueDateBlockReason({ rows, index, repairCaseId: null }),
      COMPLETED_DUE_DATE_ROW_MESSAGE,
      `${index} 번째 줄에서 까닭이 안 나온다`
    );
  }
  // 🔵 **[추가] 는 막지 않는다** — 늘리는 쪽은 앞 자리를 건드리지 않는다.
  assert.equal(domesticOrderAddDueDateBlockReason({ rows, repairCaseId: null }), null);
});

// ── ⑤ 🔴 넷째 울타리 — 확정된 회차는 날짜를 못 고치고 그 줄도 못 지운다 ─────
//
// 🔴 **「막는다」만 재면 전부 막아 버린 구현도 통과한다.** 그래서 짝으로 잰다:
// 막히는 저장 바로 옆에 **통과해야 하는 저장**을 둔다(비고·납품 고치기 · 해제 뒤 고치기).

test("🔴 확정된 회차의 납기요청일을 고치는 저장은 거절된다", () => {
  const result = check({
    storedRows: [CONFIRMED],
    nextRows: [MOVED],
    storedRepairCaseId: null,
    nextRepairCaseId: null,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "CONFIRMED_ROW_DUE_DATE_CHANGED");
  assert.equal(result.field, "dueDates");
  // 🔴 **무엇을 먼저 해야 하는지**가 글에 있어야 한다 — 확정은 되돌릴 수 있으니
  //    막다른 길이 아니고, 그 사실이 문장에 보여야 사람이 [확정 해제]를 찾아간다.
  assert.ok(result.message.includes("[확정 해제]"), "되돌리는 길을 안 말한다");
  // 🔴 **어느 회차인지**까지 말한다 — 회차가 여럿인 줄에서 「어떤 날짜가 막혔는지」를
  //    모르면 사람은 셋을 다 풀어 본다. 번호도 **저장돼 있던 날짜**도 글에 있어야 한다.
  assert.ok(result.message.includes("1차"), `회차 번호가 없다: ${result.message}`);
  assert.ok(result.message.includes(DATE), `확정된 날짜가 없다: ${result.message}`);
});

test("🔴 확정된 회차가 **둘째**면 그 번호를 말한다 — 자리로 견주는지가 여기서 갈린다", () => {
  const result = check({
    storedRows: [WITHOUT, CONFIRMED],
    nextRows: [WITHOUT, MOVED],
    storedRepairCaseId: null,
    nextRepairCaseId: null,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "CONFIRMED_ROW_DUE_DATE_CHANGED");
  assert.ok(result.message.includes("2차"), `회차 번호가 1차로 나온다: ${result.message}`);
});

test("🔴 확정된 회차를 **지우는**(줄 수를 줄이는) 저장도 거절된다", () => {
  // 🔴 이것이 없으면 「날짜는 못 고치는데 줄을 통째로 지우는 건 된다」가 되어, 날짜를
  //    바꾸려는 사람이 **지우고 새로 만들면 그만**이다.
  const result = check({
    storedRows: [WITHOUT, CONFIRMED],
    nextRows: [WITHOUT],
    storedRepairCaseId: null,
    nextRepairCaseId: null,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "CONFIRMED_ROW_ON_SHRINKING_LIST");
  assert.equal(result.message, CONFIRMED_DUE_DATE_ROW_MESSAGE);
  assert.ok(result.message.includes("[확정 해제]"), "되돌리는 길을 안 말한다");
});

test("🔴 확정된 회차가 **앞자리**여도 줄이는 저장은 거절된다 — 확정이 자리로 따라간다", () => {
  const result = check({
    storedRows: [CONFIRMED, WITHOUT],
    nextRows: [CONFIRMED],
    storedRepairCaseId: null,
    nextRepairCaseId: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "CONFIRMED_ROW_ON_SHRINKING_LIST");
});

test("🔵 확정된 회차가 있어도 **날짜가 그대로면 통과한다** — 비고·납품을 고치는 저장", () => {
  // 🔴 이 길이 열려 있어야 한다. 막으면 확정한 회차에 「1차분」을 적을 수도, 납품일을
  //    찍을 수도 없다 — 확정이 잠그는 것은 **납기요청일 하나**다.
  assert.deepEqual(
    check({
      storedRows: [CONFIRMED],
      // 같은 날짜 · 납품 기록만 붙었다(hasDelivery 가 참으로 바뀌었다).
      nextRows: [{ ...WITHOUT, hasDelivery: true }],
      storedRepairCaseId: null,
      nextRepairCaseId: null,
    }),
    { ok: true }
  );
});

test("🔵 확정된 회차가 있어도 **뒤에 더하는** 저장은 통과한다 — 앞 자리가 그대로다", () => {
  assert.deepEqual(
    check({
      storedRows: [CONFIRMED],
      nextRows: [WITHOUT, WITHOUT],
      storedRepairCaseId: null,
      nextRepairCaseId: null,
    }),
    { ok: true }
  );
});

test("🔴 **확정을 풀면 날짜가 고쳐진다** — 막다른 길이 아니다", () => {
  // 두 걸음이 실제로 통하는지 잰다: ① [확정 해제](이 표의 밖에서 일어난다) →
  // ② 날짜 고치기. 🔵 「막는다」 쪽만 재면 **전부 막아 버린 구현**도 통과하므로,
  // 이 시험이 그 짝이다.
  assert.deepEqual(
    check({
      // 해제된 뒤의 저장돼 있던 모양 — 날짜는 그대로이고 확정만 풀렸다.
      storedRows: [WITHOUT],
      nextRows: [MOVED],
      storedRepairCaseId: null,
      nextRepairCaseId: null,
    }),
    { ok: true }
  );
  // 그리고 그 줄을 지우는 것도 다시 된다.
  assert.deepEqual(
    check({
      storedRows: [WITHOUT, WITHOUT],
      nextRows: [WITHOUT],
      storedRepairCaseId: null,
      nextRepairCaseId: null,
    }),
    { ok: true }
  );
});

test("🔴 [삭제] 단추는 **그 줄의 모든 자리에서** 막힌다 — 확정된 회차가 하나라도 있으면", () => {
  const rows = [WITHOUT, CONFIRMED, WITHOUT];
  for (const index of [0, 1, 2]) {
    assert.equal(
      domesticOrderRemoveDueDateBlockReason({ rows, index, repairCaseId: null }),
      CONFIRMED_DUE_DATE_ROW_MESSAGE,
      `${index} 번째 줄에서 까닭이 안 나온다`
    );
  }
  // 🔵 **[추가] 는 막지 않는다** — 늘리는 쪽은 앞 자리를 건드리지 않는다.
  assert.equal(domesticOrderAddDueDateBlockReason({ rows, repairCaseId: null }), null);
});

test("🔵 날짜 칸 잠금도 **서버 판정에 물어본다** — 확정된 그 줄에서만 잠긴다", () => {
  const rows = [WITHOUT, CONFIRMED];
  // 확정 안 된 1차는 그대로 고친다.
  assert.equal(
    domesticOrderDueDateChangeBlockReason({ rows, index: 0, repairCaseId: null }),
    null
  );
  // 확정된 2차만 잠긴다 — 그리고 그 글이 **어느 회차인지**를 말한다.
  const blocked = domesticOrderDueDateChangeBlockReason({ rows, index: 1, repairCaseId: null });
  assert.equal(blocked, confirmedDueDateRowChangedMessage(2, DATE));
  assert.ok(blocked !== null && blocked.includes("[확정 해제]"));
  // 🔴 **확정이 하나도 없는 줄에서는 한 칸도 안 잠긴다** — 이 셈이 뒤집히면 이 화면의
  //    납기요청일이 통째로 읽기 전용이 된다(그리고 아무도 고칠 수 없게 된다).
  for (const index of [0, 1]) {
    assert.equal(
      domesticOrderDueDateChangeBlockReason({ rows: [WITHOUT, WITH], index, repairCaseId: null }),
      null
    );
  }
});
