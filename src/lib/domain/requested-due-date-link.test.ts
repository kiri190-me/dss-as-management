import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOMESTIC_ORDER_DUE_DATE_LINK_NOTE,
  DUE_DATE_FROM_DOMESTIC_ORDER_LABEL,
  DUE_DATE_FROM_REPAIR_CASE_LABEL,
  REPAIR_CASE_DUE_DATE_LINK_NOTE,
  resolveDomesticOrderDueDateDisplay,
  resolveRepairCaseRequestedDueDate,
} from "./requested-due-date-link";
import { buildDomesticOrderCellUpdateFields } from "./domestic-order-cell-edit";
import { pickEarliestDueDate } from "./weekly-report-delivery";

/**
 * ============================================================================
 * `납기요청일` ↔ `고객 요청 납기일` — 빌려 오기가 정말 한 방향인가
 * ============================================================================
 * 지키는 것은 다섯이다.
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
  assert.equal(Object.keys(fields).length, 23);
});

test("이 줄에 적힌 납기요청일은 그대로 되실려 나간다 — 칸 하나 고친다고 지워지지 않는다", () => {
  const fields = buildDomesticOrderCellUpdateFields(
    cellEditRow([dueDate("2026-01-20", "1차분")]),
    "quoteNumber",
    "Q-1"
  );
  assert.deepEqual(fields.dueDates, [{ dueDate: "2026-01-20", note: "1차분" }]);
  assert.equal(Object.keys(fields).length, 23);
});
