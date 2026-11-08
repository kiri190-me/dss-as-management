import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkDomesticOrderDueDateRows,
  domesticOrderAddDueDateBlockReason,
  domesticOrderRemoveDueDateBlockReason,
  DUE_DATE_ROW_HAS_DELIVERY_MESSAGE,
  LINKED_LINE_SINGLE_DUE_DATE_MESSAGE,
} from "./domestic-order-due-date-rows";

/**
 * ============================================================================
 * 납기요청일 행을 더하고 지우는 울타리 둘 (2026-11-08)
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
 * ============================================================================
 */

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CASE_ID = "22222222-2222-4222-8222-222222222222";

/** 납품 기록이 있는 행 / 없는 행. 이 판정이 보는 것은 이 불리언 하나뿐이다. */
const WITH = { hasDelivery: true };
const WITHOUT = { hasDelivery: false };

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
