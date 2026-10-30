import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DOMESTIC_ORDER_DUE_DATE_LINK_NOTE,
  DOMESTIC_ORDER_DUE_DATE_NOT_LINKED_MESSAGE,
  DUE_DATE_FROM_DOMESTIC_ORDER_LABEL,
  DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL,
  DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_NOTE,
  DUE_DATE_FROM_REPAIR_CASE_LABEL,
  REPAIR_CASE_DUE_DATE_BLOCKED_BY_RECEIVED_AT_MESSAGE,
  REPAIR_CASE_DUE_DATE_LINK_NOTE,
  REPAIR_CASE_DUE_DATE_NOT_LINKED_MESSAGE,
  resolveDomesticOrderDueDateDisplay,
  resolveDomesticOrderDueDateForComparison,
  resolveDomesticOrderDueDateWriteThrough,
  resolveRepairCaseDueDateWriteThrough,
  resolveRepairCaseRequestedDueDate,
  resolveRequestedDueDateLinkShape,
} from "./requested-due-date-link";
import { buildDomesticOrderCellUpdateFields } from "./domestic-order-cell-edit";
import { pickEarliestDueDate } from "./weekly-report-delivery";

/**
 * ============================================================================
 * `납기요청일` ↔ `고객 요청 납기일` — 빌려 오기가 정말 한 방향인가
 * ============================================================================
 * 지키는 것은 여섯이다.
 *
 *  1. **자기 자리에 적힌 것이 먼저** — 양쪽 다 그렇다. 상대 값이 있어도 가리지
 *     않는다.
 *  2. **비었을 때만 빌린다** — 그리고 빌린 값에는 borrowed 표시가 붙는다.
 *  3. **양쪽 다 없으면 빈 값** — 화면이 "-"로 그린다. borrowed 는 거짓이다
 *     (빌려 온 것이 없으니 붙일 표시도 없다).
 *  4. **여럿 중 하나를 고르는 쪽은 주간보고와 같은 답** — 같은 함수를 부르므로
 *     같아야 한다. 그 사실을 시험이 직접 대조한다.
 *  5. **⚠️ 계산된 값은 저장 payload 에 실리지 않는다** — 빌려 온 날짜가
 *     dueDates 에 섞여 나가면 그 줄에 박제된다.
 *  6. **내자 한 줄을 하루로 접는 쪽도 같은 갈림을 쓴다**(2026-10-30, ③-b) —
 *     「납기 역전」이 그 하루로 재므로, 갈림이 ①과 어긋나면 화면은 이 줄의 날짜를
 *     그려 놓고 수리 건의 날짜로 재게 된다.
 *
 * 여기서 확인하지 않는 것: 여러 날짜를 어떤 글자로 적는가(메모 괄호 · 차례)는
 * domestic-order-list.test.ts 가 이미 본다. 이 파일이 보는 것은 **어느 쪽 값을
 * 쓰는가**뿐이다.
 * ============================================================================
 */

/** 내자 줄의 납기요청일 한 줄. 이 파일이 보는 두 칸만 만든다. */
function dueDate(date: string, note: string | null = null) {
  return { dueDate: date, note };
}

// ── ① 내자 정리 쪽 — 이 줄에 적힌 날짜가 먼저 ───────────────────────────

test("내자에 날짜가 있으면 내자 것이 보인다 — 수리 건 날짜가 있어도 가리지 않는다", () => {
  const display = resolveDomesticOrderDueDateDisplay({
    dueDates: [dueDate("2026-01-20")],
    repairCaseCustomerRequestedDueDate: "2026-03-31",
  });
  assert.deepEqual(display.lines, ["2026-01-20"]);
  assert.equal(display.borrowed, false, "이 줄에 적힌 값에 '빌려 옴' 표시가 붙었다");
});

test("내자 날짜가 여럿이면 전부 보이고, 수리 건 날짜는 끼어들지 않는다", () => {
  // 분할 납품이 이 모양이다. 사람이 늘어놓은 1차분·2차분 사이에 아무도 적지
  // 않은 날짜가 끼면, 이 칸은 "발주서에 이렇게 적혀 있다"는 기록이기를 그만둔다.
  const display = resolveDomesticOrderDueDateDisplay({
    dueDates: [dueDate("2026-01-20", "1차분"), dueDate("2026-02-15", "2차분")],
    repairCaseCustomerRequestedDueDate: "2026-03-31",
  });
  assert.deepEqual(display.lines, ["2026-01-20 (1차분)", "2026-02-15 (2차분)"]);
  assert.equal(display.borrowed, false);
});

test("내자가 비어 있으면 수리 건의 고객 요청 납기일이 보이고, 빌려 온 값임이 드러난다", () => {
  const display = resolveDomesticOrderDueDateDisplay({
    dueDates: [],
    repairCaseCustomerRequestedDueDate: "2026-03-31",
  });
  assert.deepEqual(display.lines, ["2026-03-31"]);
  assert.equal(display.borrowed, true, "빌려 온 값인데 표시가 없다 — 화면이 꼬리표를 못 붙인다");
});

test("빌려 온 값은 언제나 한 줄이다 — 메모 괄호가 붙지 않는다", () => {
  // 수리 건의 그 칸은 날짜 하나이고 메모가 없다. 줄이 둘 이상 나오면 화면의
  // 꼬리표가 두 번 그려진다.
  const display = resolveDomesticOrderDueDateDisplay({
    dueDates: [],
    repairCaseCustomerRequestedDueDate: "2026-03-31",
  });
  assert.equal(display.lines.length, 1);
  assert.equal(display.lines[0], "2026-03-31");
});

test("양쪽 다 없으면 그릴 줄이 없다 — 화면이 '-'로 그린다", () => {
  const display = resolveDomesticOrderDueDateDisplay({
    dueDates: [],
    repairCaseCustomerRequestedDueDate: null,
  });
  assert.deepEqual(display.lines, []);
  assert.equal(display.borrowed, false, "빌려 온 것이 없는데 표시가 붙었다");
});

test("수리 건 쪽이 공백뿐이면 없는 것과 같다 — 빈칸에 꼬리표만 붙지 않는다", () => {
  const display = resolveDomesticOrderDueDateDisplay({
    dueDates: [],
    repairCaseCustomerRequestedDueDate: "   ",
  });
  assert.deepEqual(display.lines, []);
  assert.equal(display.borrowed, false);
});

test("수리 건 연결이 없는 줄도 그냥 빈칸이다 — 터지지 않는다", () => {
  const display = resolveDomesticOrderDueDateDisplay({
    dueDates: [],
    repairCaseCustomerRequestedDueDate: null,
  });
  assert.deepEqual(display.lines, []);
});

// ── ② 수리 건 상세정보 쪽 — 이 건에 적힌 날짜가 먼저 ────────────────────

test("수리 건에 고객 요청 납기일이 있으면 자기 것이 보인다 — 내자 날짜가 있어도 가리지 않는다", () => {
  const display = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: "2026-03-31",
    domesticOrderDueDates: ["2026-01-20"],
  });
  assert.equal(display.dueDate, "2026-03-31");
  assert.equal(display.borrowed, false);
});

test("수리 건이 비어 있으면 내자의 납기요청일이 보이고, 빌려 온 값임이 드러난다", () => {
  const display = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: null,
    domesticOrderDueDates: ["2026-01-20"],
  });
  assert.equal(display.dueDate, "2026-01-20");
  assert.equal(display.borrowed, true);
});

test("⚠️ 내자에 날짜가 여러 개면 **가장 이른 하루**가 보인다", () => {
  const display = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: null,
    domesticOrderDueDates: ["2026-02-15", "2026-01-20", "2026-03-31"],
  });
  assert.equal(display.dueDate, "2026-01-20");
  assert.equal(display.borrowed, true);
});

test("여러 내자 줄에 걸친 날짜도 한 묶음으로 본다 — 줄마다 접은 뒤 다시 고르지 않는다", () => {
  // 분할 발주면 한 건에 내자 줄이 여럿이다(repair_case_id 에 유일 제약이 없다).
  // 부르는 쪽이 그 줄들의 날짜를 통틀어 넘기므로, 이 함수는 묶음이 몇 줄에서
  // 왔는지 알지 못한다.
  const display = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: null,
    domesticOrderDueDates: ["2026-05-01", "2026-04-02", "2026-04-01", "2026-06-01"],
  });
  assert.equal(display.dueDate, "2026-04-01");
});

test("⚠️ 주간보고 `입고 요청일`과 같은 날짜다 — 같은 함수를 부른다", () => {
  // 같은 자료를 두 화면이 다른 날짜로 보여 주면 어느 쪽도 믿을 수 없게 된다.
  // 규칙을 베껴 적은 구현으로 바뀌면 이 대조가 그 자리에서 깨져야 한다.
  const dates = ["2026-09-30", "2026-08-31", "2020-01-01", "2026-12-01"];
  assert.equal(
    resolveRepairCaseRequestedDueDate({
      customerRequestedDueDate: null,
      domesticOrderDueDates: dates,
    }).dueDate,
    pickEarliestDueDate(dates)
  );
});

test("이미 지난 날짜라도 그것이 가장 이르면 그것이다 — 오늘을 보지 않는다", () => {
  const display = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: null,
    domesticOrderDueDates: ["2020-01-01", "2026-08-31"],
  });
  assert.equal(display.dueDate, "2020-01-01");
});

test("양쪽 다 없으면 빈 값이다 — 화면이 '-'로 그린다", () => {
  const display = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: null,
    domesticOrderDueDates: [],
  });
  assert.equal(display.dueDate, null);
  assert.equal(display.borrowed, false, "빌려 온 것이 없는데 표시가 붙었다");
});

test("이 건 쪽이 공백뿐이면 없는 것과 같다 — 그때는 내자 날짜를 빌린다", () => {
  const display = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: "  ",
    domesticOrderDueDates: ["2026-01-20"],
  });
  assert.equal(display.dueDate, "2026-01-20");
  assert.equal(display.borrowed, true);
});

test("연결된 내자 줄이 하나도 없으면 그냥 빈칸이다", () => {
  const display = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: null,
    domesticOrderDueDates: [],
  });
  assert.equal(display.dueDate, null);
});

// ── ③ 두 방향이 서로 어긋나지 않는가 ────────────────────────────────────

test("양쪽 다 적혀 있으면 각자 자기 것을 본다 — 어느 쪽도 상대 값으로 덮이지 않는다", () => {
  const domestic = resolveDomesticOrderDueDateDisplay({
    dueDates: [dueDate("2026-01-20")],
    repairCaseCustomerRequestedDueDate: "2026-03-31",
  });
  const repairCase = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: "2026-03-31",
    domesticOrderDueDates: ["2026-01-20"],
  });
  assert.deepEqual(domestic.lines, ["2026-01-20"]);
  assert.equal(repairCase.dueDate, "2026-03-31");
  assert.equal(domestic.borrowed, false);
  assert.equal(repairCase.borrowed, false);
});

// ── ③-b 🔴 내자 한 줄을 **견줄 수 있는 하루**로 접기 (2026-10-30) ────────
//
// 「납기 역전」 판정이 쓰는 날짜다(due-date-inversion.ts). 여기서 지키는 것은
// 하나뿐이다 — **그 칸에 보이는 날짜로 잰다.** 갈림이 위 그리기 함수와 어긋나는
// 순간, 화면은 이 줄에 적힌 날짜를 그려 놓고 수리 건의 날짜로 재게 되고, 사람은
// 빨간 날짜를 보며 왜 빨간지 끝내 알 수 없다.

test("이 줄에 날짜가 있으면 그 날짜로 잰다 — 수리 건 날짜는 보지 않는다", () => {
  assert.equal(
    resolveDomesticOrderDueDateForComparison({
      dueDates: [dueDate("2026-01-20")],
      repairCaseCustomerRequestedDueDate: "2026-03-31",
    }),
    "2026-01-20"
  );
});

test("🔴 날짜가 여럿이면 **가장 이른 하루** — 뒤 회차의 여유가 첫 약속을 지우지 못한다", () => {
  // 🔴 가장 이른 날을 **가운데** 둔다. 끝에 두면 「마지막 줄을 고른다」로 바꿔도
  // 시험이 초록색으로 남는다(실제로 한 번 그렇게 적었다가 일부러 깨뜨려 보고
  // 잡았다 — 사람이 적는 차례는 1차분·2차분이라 보통 이르게 정렬돼 있다).
  const picked = resolveDomesticOrderDueDateForComparison({
    dueDates: [dueDate("2026-03-10", "2차분"), dueDate("2026-01-10", "1차분"), dueDate("2026-05-10")],
    repairCaseCustomerRequestedDueDate: null,
  });
  assert.equal(picked, "2026-01-10");
  // 고르는 일을 주간보고와 같은 함수에 맡겼다는 사실을 대조한다 — 규칙을 베껴
  // 적으면 같은 자료를 두 화면이 다른 날짜로 재게 된다.
  assert.equal(picked, pickEarliestDueDate(["2026-03-10", "2026-01-10", "2026-05-10"]));
});

test("이 줄이 비었을 때만 수리 건의 고객 요청 납기일을 빌린다", () => {
  assert.equal(
    resolveDomesticOrderDueDateForComparison({
      dueDates: [],
      repairCaseCustomerRequestedDueDate: "2026-03-31",
    }),
    "2026-03-31"
  );
});

test("양쪽 어디에도 없으면 null — 「아직 정해지지 않았다」이고, 그것으로 재지 않는다", () => {
  assert.equal(
    resolveDomesticOrderDueDateForComparison({
      dueDates: [],
      repairCaseCustomerRequestedDueDate: null,
    }),
    null
  );
  // 공백만 적힌 값은 없는 것으로 접는다 — 화면에는 빈칸인데 경보만 켜지는 줄이
  // 생기지 않게. 그리기 함수가 쓰는 규칙과 같다.
  assert.equal(
    resolveDomesticOrderDueDateForComparison({
      dueDates: [],
      repairCaseCustomerRequestedDueDate: "   ",
    }),
    null
  );
});

test("🔴 고른 하루는 **언제나 그 칸에 보이는 날짜다** — 갈림이 그리기와 어긋나지 않는다", () => {
  // 글자가 아니라 **갈림**을 맞대어 본다. 그리기 쪽 lines 는 메모가 붙은 글자라
  // (`"2026-01-10 (1차분)"`) 날짜로 견줄 수 없으므로, 고른 하루로 시작하는 줄이
  // 그 칸에 있는지를 본다.
  const rows = [
    { dueDates: [dueDate("2026-01-20")], repairCaseCustomerRequestedDueDate: "2026-03-31" },
    {
      dueDates: [dueDate("2026-03-10", "2차분"), dueDate("2026-01-10", "1차분"), dueDate("2026-05-10")],
      repairCaseCustomerRequestedDueDate: "2026-02-01",
    },
    { dueDates: [], repairCaseCustomerRequestedDueDate: "2026-03-31" },
    { dueDates: [], repairCaseCustomerRequestedDueDate: null },
  ];
  let compared = 0;
  let borrowedSeen = 0;
  for (const row of rows) {
    const display = resolveDomesticOrderDueDateDisplay(row);
    const picked = resolveDomesticOrderDueDateForComparison(row);
    if (picked === null) {
      assert.deepEqual(display.lines, [], `잴 날짜가 없는데 칸에는 보인다: ${JSON.stringify(row)}`);
      continue;
    }
    compared += 1;
    if (display.borrowed) borrowedSeen += 1;
    assert.ok(
      display.lines.some((line) => line.startsWith(picked)),
      `판정이 보는 날(${picked})이 칸에 없다: ${JSON.stringify(display.lines)}`
    );
  }
  // 표본이 비어 공짜로 통과하는 일을 막는다 — 빌려 온 줄도 한 번은 지나야 한다.
  assert.equal(compared, 3, "견준 줄이 셋이어야 한다");
  assert.equal(borrowedSeen, 1, "빌려 온 줄이 표본에 없다");
});

// ── ④ 표시 글자 ────────────────────────────────────────────────────────

test("설명 문장은 화면에 실제로 붙는 표시 글자를 가리킨다", () => {
  // 배지에 적히는 말과 설명에 적히는 말이 어긋나면, 설명이 화면에 없는 표시를
  // 가리키게 된다.
  assert.ok(
    DOMESTIC_ORDER_DUE_DATE_LINK_NOTE.includes(DUE_DATE_FROM_REPAIR_CASE_LABEL),
    "내자 정리 설명이 그 화면의 꼬리표 글자를 말하지 않는다"
  );
  assert.ok(
    REPAIR_CASE_DUE_DATE_LINK_NOTE.includes(DUE_DATE_FROM_DOMESTIC_ORDER_LABEL),
    "수리 건 설명이 그 화면의 꼬리표 글자를 말하지 않는다"
  );
});

test("두 표시는 서로 다른 글자다 — 어느 쪽에서 빌려 왔는지 구분돼야 한다", () => {
  assert.notEqual(DUE_DATE_FROM_REPAIR_CASE_LABEL, DUE_DATE_FROM_DOMESTIC_ORDER_LABEL);
});

// ── ⑤ ⚠️ 계산된 값은 저장에 실리지 않는다 ───────────────────────────────

/** 저장 payload 를 만들 때 쓰는 한 줄. 값은 이 시험이 보는 것만 채운다. */
function cellEditRow(dueDates: readonly { dueDate: string; note: string | null }[]) {
  return {
    repairCaseId: "case-1",
    intakeNumberText: null,
    customerId: null,
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    displayOrder: 1,
    purchaseOrderNumber: null,
    projectName: null,
    orderIssuedDate: null,
    dueDates,
    quoteIssuedDate: null,
    quoteNumber: null,
    // 칸 편집이 되실어 보내는 견적서 연결(2026-09-11, domestic-order-cell-edit.ts).
    quoteId: null,
    progressNote: null,
    deliveredDate: null,
    deliveredBy: null,
    taxInvoiceDate: null,
    amountExcludingVat: null,
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: null,
  };
}

test("⚠️ 빌려 온 날짜는 저장 payload 에 실리지 않는다 — 그 줄에 박제되면 안 된다", () => {
  // 화면에는 수리 건의 날짜가 보이는 줄이다. 그 상태로 다른 칸 하나를 고쳐
  // 저장했을 때, 보이던 그 날짜가 이 줄의 납기요청일로 굳으면 안 된다 —
  // 그때부터 "일부러 같게 적었다"와 "그냥 안 건드렸다"를 구분할 수 없고,
  // 나중에 수리 건 쪽이 고쳐져도 이 줄만 옛 값으로 남는다.
  const display = resolveDomesticOrderDueDateDisplay({
    dueDates: [],
    repairCaseCustomerRequestedDueDate: "2026-03-31",
  });
  assert.equal(display.borrowed, true, "이 시험의 전제가 깨졌다 — 빌려 온 상태가 아니다");

  const fields = buildDomesticOrderCellUpdateFields(cellEditRow([]), "quoteNumber", "Q-1");
  assert.deepEqual(fields.dueDates, [], "빌려 온 날짜가 저장에 섞여 나갔다");
  // 계산된 값이 자기 이름으로 키를 하나 더 만들지도 않는다.
  assert.equal(Object.keys(fields).length, 24);
});

test("이 줄에 적힌 납기요청일은 그대로 되실려 나간다 — 칸 하나 고친다고 지워지지 않는다", () => {
  const fields = buildDomesticOrderCellUpdateFields(
    cellEditRow([dueDate("2026-01-20", "1차분")]),
    "quoteNumber",
    "Q-1"
  );
  assert.deepEqual(fields.dueDates, [{ dueDate: "2026-01-20", note: "1차분" }]);
  assert.equal(Object.keys(fields).length, 24);
});

// ── ⑥ 목록용 짧은 표시 ──────────────────────────────────────────────────

test("목록용 짧은 표시는 상세정보의 긴 이름표와 다른 글자다 — 자리가 다르기 때문이다", () => {
  // 표에서 이 값이 사는 곳은 출하일 칸 안의 보조 줄 하나이고 줄바꿈을 하지
  // 않는다. 긴 이름표를 그대로 쓰면 그 열만 넓어져 표가 옆으로 길어진다.
  assert.notEqual(DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL, DUE_DATE_FROM_DOMESTIC_ORDER_LABEL);
  assert.ok(
    DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL.length < DUE_DATE_FROM_DOMESTIC_ORDER_LABEL.length,
    "좁은 자리에 쓰려고 만든 표시가 긴 쪽보다 짧지 않다"
  );
});

test("짧은 표시의 설명도 화면에 실제로 붙는 글자를 가리킨다", () => {
  assert.ok(
    DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_NOTE.includes(DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL),
    "목록 설명이 그 화면의 꼬리표 글자를 말하지 않는다"
  );
});

// ── ⑦ 🔴 목록 조회가 **빌려 올 재료를 실제로 싣고 오는가** ──────────────

/**
 * ============================================================================
 * 조회 소스를 글자로 읽는 시험 — 왜 이렇게까지 하는가
 * ============================================================================
 * 2026-10-19 사용자 신고: 「[내자정리]에서 고객 요청 납기일을 적으면 [전체 A/S
 * 현황] 표에는 그 날짜가 안 나온다」. 빌려 오는 규칙은 2026-08-26 에 이미
 * 있었는데 **상세정보와 내자 목록 두 화면에만** 붙어 있었고, 목록 조회는
 * domestic_orders 를 한 글자도 읽지 않았다.
 *
 * 🔴 **화면 시험만으로는 이 결함을 못 잡는다.** 화면 시험은 손으로 만든 줄을
 * 넘겨 그리므로, 조회가 재료를 빠뜨려도 전부 통과한다. 사람 눈에는 늘 "-"만
 * 보이고 그건 "날짜가 없는 건"과 구별되지 않아 아무도 신고하지 않는다
 * (queries/repair-cases-list-columns.integration.test.ts 머리말의 바로 그 말).
 *
 * 🔴 그리고 **빈 배열을 넘기는 실패**는 타입으로도 안 잡힌다 — 칸은 있고
 * 함수도 그대로 불리는데 빌려 오기만 조용히 꺼진다. 그래서 「재료를 묶어 오는
 * 호출이 있는가」와 「그 결과를 줄에 얹는가」를 따로 센다. 종 알림 조회에 같은
 * 가드가 걸려 있다(domain/notifications.test.ts).
 *
 * DB 없이 붙잡을 수 있는 것은 여기까지다. 실제로 값이 실려 오는지는 DB 시험이
 * 본다(queries/repair-cases-list-columns.integration.test.ts).
 * ============================================================================
 */
function querySource(fileName: string): string {
  return readFileSync(new URL(`../db/queries/${fileName}`, import.meta.url), "utf8");
}

test("🔴 전체 A/S 현황 목록 조회가 내자 납기요청일을 묶어 와 줄에 얹는다", () => {
  const source = querySource("repair-cases.ts");

  assert.ok(
    source.includes("loadDomesticOrderDueDatesByCaseId("),
    "목록 조회가 내자 납기요청일을 읽지 않는다 — 표는 영영 자기 칸만 그린다"
  );
  // 🔴 읽기만 하고 줄에 얹지 않으면 화면에는 아무 변화가 없다. 위 단언만으로는
  // 초록색으로 남는 자리다.
  assert.ok(
    source.includes("domesticOrderDueDates: dueDatesByCaseId.get(row.id)"),
    "읽어 온 날짜를 줄에 얹지 않는다 — 화면에 닿지 않는다"
  );
  // 🔵 「빌릴 건만」 좁혀 묻는다. 목록은 수백 건이라 이 좁히기가 곧 질의 크기다.
  assert.ok(
    source.includes("dueDateBorrowerIds("),
    "자기 칸이 찬 건의 내자 날짜까지 읽는다 — 쓰이지 않을 것을 묻는다"
  );
});

test("🔴 내 작업 화면 조회도 같은 재료를 싣고 온다", () => {
  const source = querySource("repair-cases-mine.ts");

  assert.ok(
    source.includes("loadDomesticOrderDueDatesByCaseId("),
    "내 작업 조회가 내자 납기요청일을 읽지 않는다"
  );
  assert.ok(
    source.includes("domesticOrderDueDates: dueDatesByCaseId.get(row.id)"),
    "읽어 온 날짜를 줄에 얹지 않는다"
  );
  assert.ok(source.includes("dueDateBorrowerIds("), "빌릴 건만 묻는 좁히기가 없다");
});

test("🔴 재료를 모으는 조각은 한 벌뿐이고, 지운 내자 줄의 날짜는 세지 않는다", () => {
  const source = querySource("repair-case-domestic-order-due-dates.ts");

  // 화면에서 지운 줄에 붙어 있던 날짜가 다른 화면의 값을 정하면 안 된다
  // (주간보고·종 알림과 같은 규칙).
  assert.ok(
    source.includes("eq(domesticOrders.isDeleted, false)"),
    "지워진 내자 줄의 날짜까지 빌려 온다"
  );
  // repair_case_id 는 nullable 이다(접수 건 영구 삭제 시 SET NULL).
  assert.ok(source.includes("row.repairCaseId === null"), "null 인 repair_case_id 를 거르지 않는다");
  // inArray 에 빈 배열을 넘기면 뜻 없는 SQL 이 만들어진다. 빌릴 건이 하나도
  // 없으면 질의 자체가 돌지 않아야 한다.
  assert.ok(source.includes("caseIds.length === 0"), "빌릴 건이 없을 때도 질의를 돌린다");

  // 🔴 세 곳(목록 둘 + 종 알림)이 이 한 벌을 쓴다. 한 곳이 제 SQL 을 들고 있으면
  // 언젠가 거기만 고쳐지고, 그때 같은 건이 화면마다 다른 날짜로 보인다.
  for (const caller of ["repair-cases.ts", "repair-cases-mine.ts", "repair-case-due-date-notifications.ts"]) {
    assert.match(
      querySource(caller),
      /from "\.\/repair-case-domestic-order-due-dates"/,
      `${caller} 가 공용 조각을 쓰지 않는다 — 규칙이 두 벌이 된다`
    );
  }
});

/**
 * ============================================================================
 * ⑧ 🔴 묶기 — 한쪽을 고치면 상대 칸도 같은 날짜가 되는가 (2026-10-30)
 * ============================================================================
 * 지키는 것은 다섯이다.
 *
 *  1. **안 바뀐 저장은 아무 일도 하지 않는다** — 두 화면 다 「칸 하나를 고쳐도 묶음
 *     전체를 다시 보내는」 폼이라, 이것이 깨지면 발주서번호 하나 고친 저장이 상대
 *     쪽 날짜를 덮는다.
 *  2. **빌려 그리는 쪽에는 쓰지 않는다** — 비어 있는 칸은 이미 상대 값을 보여 주고
 *     있어 **보이는 날짜가 같다.** 채워 넣으면 아무도 적지 않은 값이 박제된다.
 *  3. **행을 만들지도 지우지도 않는다** — 내자 쪽 날짜는 행이고 비고가 딸려 있다.
 *  4. **여럿이면 멈추고, 그 사실을 글로 내놓는다** — 조용히 건너뛰지 않는다.
 *  5. **인수일 잣대는 한 방향에만 있고, 우회하지 않는다**(내자 → 수리 건).
 * ============================================================================
 */

/** 그 건에 붙은 내자 줄들의 모양. 날짜 수만 적는다. */
function lines(...dueDateCounts: number[]) {
  return dueDateCounts.map((dueDateCount) => ({ dueDateCount }));
}

test("🔴 묶임이 성립하는 모양은 **줄 하나 · 날짜 하나**뿐이다", () => {
  assert.deepEqual(resolveRequestedDueDateLinkShape(lines(1)), { kind: "SINGLE" });
  assert.deepEqual(resolveRequestedDueDateLinkShape(lines(2)), {
    kind: "AMBIGUOUS",
    lineCount: 1,
    dueDateCount: 2,
  });
  assert.deepEqual(resolveRequestedDueDateLinkShape(lines(1, 1)), {
    kind: "AMBIGUOUS",
    lineCount: 2,
    dueDateCount: 2,
  });
  // 줄이 여럿인데 날짜는 하나 — 수리 건 상세의 「내자 정리 발행일」이 줄이 여럿일 때
  // 아예 막는 것과 같은 자리에 선다. 어느 줄의 날짜를 고르는 규칙을 새로 만들지 않는다.
  assert.deepEqual(resolveRequestedDueDateLinkShape(lines(1, 0)), {
    kind: "AMBIGUOUS",
    lineCount: 2,
    dueDateCount: 1,
  });
});

test("🔴 날짜 행이 하나도 없으면 **줄이 몇이든** 「없음」이지 「여럿」이 아니다", () => {
  // 이 갈림이 뒤집히면, 날짜를 한 번도 적지 않은 건을 고칠 때마다 「못 맞췄습니다」가
  // 뜬다 — 그 줄들은 전부 수리 건의 날짜를 빌려 그리는 중이라 보이는 날짜가 같다.
  assert.deepEqual(resolveRequestedDueDateLinkShape([]), { kind: "NO_ROW" });
  assert.deepEqual(resolveRequestedDueDateLinkShape(lines(0)), { kind: "NO_ROW" });
  assert.deepEqual(resolveRequestedDueDateLinkShape(lines(0, 0, 0)), { kind: "NO_ROW" });
});

// ── ⑧-a 수리 건 → 내자 ─────────────────────────────────────────────────

test("수리 건의 날짜를 고치면 내자의 그 한 행을 같은 날짜로 바꾼다", () => {
  assert.deepEqual(
    resolveDomesticOrderDueDateWriteThrough({
      previousCustomerRequestedDueDate: "2026-03-31",
      nextCustomerRequestedDueDate: "2026-04-15",
      lines: lines(1),
    }),
    { kind: "WRITE", dueDate: "2026-04-15" }
  );
});

test("🔴 안 바뀐 저장은 내자를 건드리지 않는다 — 공백만 다른 값도 같은 값이다", () => {
  // 인수정보 폼은 고칠 수 있는 칸을 늘 함께 보낸다. 여기가 깨지면 연락처 하나 고친
  // 저장이 내자의 날짜를 덮어쓴다.
  assert.deepEqual(
    resolveDomesticOrderDueDateWriteThrough({
      previousCustomerRequestedDueDate: "2026-03-31",
      nextCustomerRequestedDueDate: "2026-03-31",
      lines: lines(1),
    }),
    { kind: "NONE" }
  );
  assert.deepEqual(
    resolveDomesticOrderDueDateWriteThrough({
      previousCustomerRequestedDueDate: "  ",
      nextCustomerRequestedDueDate: null,
      lines: lines(1),
    }),
    { kind: "NONE" }
  );
});

test("🔴 수리 건의 날짜를 **지워도** 내자 행을 지우지 않는다 — 비고가 함께 사라진다", () => {
  assert.deepEqual(
    resolveDomesticOrderDueDateWriteThrough({
      previousCustomerRequestedDueDate: "2026-03-31",
      nextCustomerRequestedDueDate: null,
      lines: lines(1),
    }),
    { kind: "NONE" }
  );
});

test("🔴 내자에 날짜 행이 없으면 **만들지 않는다** — 그 줄은 이미 이 날짜를 빌려 그린다", () => {
  const plan = resolveDomesticOrderDueDateWriteThrough({
    previousCustomerRequestedDueDate: null,
    nextCustomerRequestedDueDate: "2026-04-15",
    lines: lines(0),
  });
  assert.deepEqual(plan, { kind: "NONE" });
  // 전제를 함께 못 박는다 — 그 줄이 정말 이 날짜를 그리고 있어야 「같은 날짜를 보고
  // 있다」가 참이다. 아니라면 이 결정은 그냥 안 맞춘 것이 된다.
  const display = resolveDomesticOrderDueDateDisplay({
    dueDates: [],
    repairCaseCustomerRequestedDueDate: "2026-04-15",
  });
  assert.deepEqual(display.lines, ["2026-04-15"]);
  assert.equal(display.borrowed, true);
});

test("🔴 내자 줄이나 날짜가 여럿이면 멈추고 **까닭을 내놓는다**", () => {
  const plan = resolveDomesticOrderDueDateWriteThrough({
    previousCustomerRequestedDueDate: "2026-03-31",
    nextCustomerRequestedDueDate: "2026-04-15",
    lines: lines(1, 2),
  });
  assert.equal(plan.kind, "NOT_LINKED");
  if (plan.kind !== "NOT_LINKED") return;
  assert.equal(plan.outcome.linked, false);
  assert.equal(plan.outcome.reason, "AMBIGUOUS");
  assert.equal(plan.outcome.message, DOMESTIC_ORDER_DUE_DATE_NOT_LINKED_MESSAGE);
  // 🔵 사람이 읽을 글이다 — **무엇이 저장됐고 무엇이 그대로인지**를 둘 다 말해야
  // 한다. 「안 됐습니다」만 적으면 저장 자체가 실패한 줄 안다.
  assert.match(plan.outcome.message, /고객 요청 납기일은 저장했습니다/);
  assert.match(plan.outcome.message, /내자 정리의 납기요청일은 그대로/);
});

// ── ⑧-b 내자 → 수리 건 ─────────────────────────────────────────────────

/** 이 방향의 기본 표본 — 수리 건에 날짜가 적혀 있고, 그 건의 줄은 이것 하나다. */
function toRepairCase(overrides: {
  previousDueDates?: readonly string[];
  nextDueDates: readonly string[];
  otherLines?: readonly { dueDateCount: number }[];
  customerRequestedDueDate?: string | null;
  receivedAt?: string;
}) {
  return resolveRepairCaseDueDateWriteThrough({
    editedLine: {
      previousDueDates: overrides.previousDueDates ?? ["2026-01-20"],
      nextDueDates: overrides.nextDueDates,
    },
    otherLines: overrides.otherLines ?? [],
    customerRequestedDueDate:
      overrides.customerRequestedDueDate === undefined
        ? "2026-03-31"
        : overrides.customerRequestedDueDate,
    receivedAt: overrides.receivedAt ?? "2026-01-05",
  });
}

test("내자의 날짜를 고치면 수리 건의 고객 요청 납기일이 같은 날짜가 된다", () => {
  assert.deepEqual(toRepairCase({ nextDueDates: ["2026-02-10"] }), {
    kind: "WRITE",
    dueDate: "2026-02-10",
  });
});

test("🔴 날짜가 안 바뀐 저장은 수리 건을 건드리지 않는다 — 차례와 비고는 보지 않는다", () => {
  // 내자 정리는 **어느 칸을 고쳐도 줄 전체를 다시 보낸다.** 여기가 깨지면 현황 메모
  // 하나 고친 저장이 수리 건의 날짜를 덮는다. 🔴 표본의 두 날짜를 **서로 다르게**
  // 둔다(수리 건 2026-03-31 ↔ 내자 2026-01-20) — 같게 두면 규칙이 깨져 WRITE 가 되어도
  // 「값이 같아서 NONE」과 구분되지 않는다.
  assert.deepEqual(
    toRepairCase({ previousDueDates: ["2026-01-20"], nextDueDates: ["2026-01-20"] }),
    { kind: "NONE" }
  );
  // 차례만 바꾼 저장도 「안 바뀐 저장」이다(1차분·2차분 순서를 바꾼 경우).
  assert.deepEqual(
    toRepairCase({
      previousDueDates: ["2026-01-20", "2026-02-15"],
      nextDueDates: ["2026-02-15", "2026-01-20"],
    }),
    { kind: "NONE" }
  );
  // 같은 날짜가 두 행에 적혀 있다가 하나를 지운 저장은 **바뀐 저장**이다 —
  // 중복을 접어 견주면 이것을 놓친다.
  assert.notDeepEqual(
    toRepairCase({ previousDueDates: ["2026-02-10", "2026-02-10"], nextDueDates: ["2026-02-10"] }),
    { kind: "NONE" }
  );
});

test("🔴 수리 건 쪽이 비어 있으면 **채우지 않는다** — 그 건은 이 날짜를 빌려 그린다", () => {
  const plan = toRepairCase({ nextDueDates: ["2026-02-10"], customerRequestedDueDate: null });
  assert.deepEqual(plan, { kind: "NONE" });
  // 전제를 함께 못 박는다 — 그 건이 정말 이 날짜를 그리고 있어야 한다.
  const display = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: null,
    domesticOrderDueDates: ["2026-02-10"],
  });
  assert.equal(display.dueDate, "2026-02-10");
  assert.equal(display.borrowed, true);
  // 공백만 적힌 값도 「비어 있다」로 본다(화면이 그렇게 읽는다).
  assert.deepEqual(
    toRepairCase({ nextDueDates: ["2026-02-10"], customerRequestedDueDate: "   " }),
    { kind: "NONE" }
  );
});

test("🔴 내자의 날짜를 모두 지워도 수리 건의 날짜를 지우지 않는다", () => {
  // 지운 뒤에는 이 줄이 수리 건의 날짜를 빌려 그린다 — 두 화면이 같은 날짜를 본다.
  assert.deepEqual(toRepairCase({ nextDueDates: [] }), { kind: "NONE" });
});

test("같은 날짜면 할 일이 없다", () => {
  assert.deepEqual(
    toRepairCase({ nextDueDates: ["2026-03-31"], customerRequestedDueDate: "2026-03-31" }),
    { kind: "NONE" }
  );
});

test("🔴 인수일보다 이른 날짜는 수리 건에 넣지 않고 **알린다** — 잣대를 우회하지 않는다", () => {
  const plan = toRepairCase({ nextDueDates: ["2026-01-04"], receivedAt: "2026-01-05" });
  assert.equal(plan.kind, "NOT_LINKED");
  if (plan.kind !== "NOT_LINKED") return;
  assert.equal(plan.outcome.reason, "BLOCKED_BY_RECEIVED_AT");
  assert.equal(plan.outcome.message, REPAIR_CASE_DUE_DATE_BLOCKED_BY_RECEIVED_AT_MESSAGE);
  assert.match(plan.outcome.message, /납기요청일은 저장했습니다/);
  assert.match(plan.outcome.message, /인수일/);
});

test("인수일과 **같은 날**은 통과한다 — 저쪽 저장이 받아 주는 날짜와 한 글자도 다르지 않다", () => {
  assert.deepEqual(toRepairCase({ nextDueDates: ["2026-01-05"], receivedAt: "2026-01-05" }), {
    kind: "WRITE",
    dueDate: "2026-01-05",
  });
});

test("🔴 수리 건에 내자 줄이 여럿이면 멈추고 까닭을 내놓는다", () => {
  const plan = toRepairCase({ nextDueDates: ["2026-02-10"], otherLines: lines(1) });
  assert.equal(plan.kind, "NOT_LINKED");
  if (plan.kind !== "NOT_LINKED") return;
  assert.equal(plan.outcome.reason, "AMBIGUOUS");
  assert.equal(plan.outcome.message, REPAIR_CASE_DUE_DATE_NOT_LINKED_MESSAGE);
  assert.match(plan.outcome.message, /납기요청일은 저장했습니다/);
  assert.match(plan.outcome.message, /수리 건의 고객 요청 납기일은 그대로/);
  // 한 줄에 날짜가 여럿일 때도 같다(분할 납품).
  const split = toRepairCase({ nextDueDates: ["2026-02-10", "2026-03-10"] });
  assert.equal(split.kind, "NOT_LINKED");
});

test("🔴 다른 줄이 **비어 있기만 해도** 줄이 여럿이면 묶지 않는다", () => {
  // 날짜는 통틀어 하나지만 줄이 둘이다 — 그 둘째 줄은 수리 건의 날짜를 빌려 그리고
  // 있어서, 여기서 수리 건을 고치면 첫째 줄과 둘째 줄이 서로 다른 날짜를 보이게 된다.
  // 어느 쪽이 맞는지는 사람만 안다.
  const plan = toRepairCase({ nextDueDates: ["2026-02-10"], otherLines: lines(0) });
  assert.equal(plan.kind, "NOT_LINKED");
});

test("🔴 두 방향이 **같은 모양 판정**을 쓴다 — 한쪽만 고쳐지면 어느 쪽에서 고치느냐로 갈린다", () => {
  // 같은 줄 모양을 두 방향에 넣어 「묶이는가」가 언제나 같은지 본다. 표본에는
  // 묶이는 모양과 안 묶이는 모양이 둘 다 들어 있어야 한다(공짜 통과 막기).
  const shapes = [lines(1), lines(2), lines(1, 1), lines(1, 0)];
  let linked = 0;
  let blocked = 0;
  for (const shape of shapes) {
    const toDomestic = resolveDomesticOrderDueDateWriteThrough({
      previousCustomerRequestedDueDate: "2026-03-31",
      nextCustomerRequestedDueDate: "2026-04-15",
      lines: shape,
    });
    // 거울 쪽은 「고친 줄 하나 + 나머지」로 받는다 — 같은 모양이 되도록 첫 줄을 고친
    // 줄로 삼는다. 날짜 값은 여기서 중요하지 않다(모양만 본다).
    const edited = shape[0];
    const toCase = resolveRepairCaseDueDateWriteThrough({
      editedLine: {
        previousDueDates: [],
        nextDueDates: Array.from({ length: edited.dueDateCount }, (_, i) => `2026-02-${10 + i}`),
      },
      otherLines: shape.slice(1),
      customerRequestedDueDate: "2026-03-31",
      receivedAt: "2026-01-05",
    });
    assert.equal(
      toDomestic.kind === "WRITE",
      toCase.kind === "WRITE",
      `같은 모양인데 방향마다 답이 다르다: ${JSON.stringify(shape)}`
    );
    if (toDomestic.kind === "WRITE") linked += 1;
    if (toDomestic.kind === "NOT_LINKED") blocked += 1;
  }
  assert.equal(linked, 1, "묶이는 모양이 표본에 하나는 있어야 한다");
  assert.equal(blocked, 3, "안 묶이는 모양이 표본에 셋 있어야 한다");
});
