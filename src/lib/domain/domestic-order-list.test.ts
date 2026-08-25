import { test } from "node:test";
import assert from "node:assert/strict";

import {
  collectDomesticOrderYears,
  countDomesticOrdersWithoutOrderYear,
  filterDomesticOrdersByYear,
  foldBlankToNull,
  formatDomesticOrderDueDates,
  formatDomesticOrderDueDateSummary,
  groupDomesticOrdersByCustomer,
  isDomesticOrderCompleted,
  orderIssuedYearOf,
  resolveDomesticOrderCustomerRowColor,
  resolveDomesticOrderValue,
  resolveInitialDomesticOrderYear,
  UNASSIGNED_CUSTOMER_LABEL,
} from "./domestic-order-list";

/**
 * 이 시험이 지키는 것 다섯.
 *  1. 년도 후보는 자료에 있는 해만이다.
 *  2. **발주일 없는 줄은 어느 년도에서도 살아남는다** — 이 파일이 존재하는
 *     가장 큰 이유다. 그 줄은 아직 발주가 나지 않았다는 뜻이라 잊히면 안 된다.
 *  3. 고객사 묶음의 순서는 원본 순서를 따르고, 미지정은 맨 뒤 하나다.
 *  4. 완료 판정은 completed_at 하나로만 한다.
 *  5. **이 행에 적힌 값이 먼저이고, 공백만 적힌 값은 "없음"이다** — 이 규칙이
 *     SQL 의 coalesce 안에 있었다면 시험할 자리가 없었다.
 */

type Row = {
  id: string;
  orderIssuedDate: string | null;
  customerName: string | null;
  completedAt: string | null;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "id",
    orderIssuedDate: null,
    customerName: null,
    completedAt: null,
    ...overrides,
  };
}

// ── 년도 읽기 ──────────────────────────────────────────────────────────

test("발주 년도는 문자열 앞 4글자다 — Date로 파싱하지 않는다", () => {
  // 1월 1일은 UTC 로 파싱하면 한국 기준 전해 12월 31일로 밀린다. 앞 4글자를
  // 쓰면 그런 일이 생길 여지가 없다.
  assert.equal(orderIssuedYearOf(row({ orderIssuedDate: "2026-01-01" })), "2026");
  assert.equal(orderIssuedYearOf(row({ orderIssuedDate: "2025-12-31" })), "2025");
});

test("발주일이 없으면 년도도 없다", () => {
  assert.equal(orderIssuedYearOf(row({ orderIssuedDate: null })), null);
});

test("년도를 읽을 수 없는 값도 년도 없음으로 다룬다 — 어느 해로도 추측하지 않는다", () => {
  assert.equal(orderIssuedYearOf(row({ orderIssuedDate: "" })), null);
  assert.equal(orderIssuedYearOf(row({ orderIssuedDate: "알 수 없음" })), null);
});

// ── 고를 수 있는 년도 ──────────────────────────────────────────────────

test("년도 후보는 자료에 실제로 있는 해뿐이고 최신순이다", () => {
  const rows = [
    row({ orderIssuedDate: "2024-05-01" }),
    row({ orderIssuedDate: "2026-01-02" }),
    row({ orderIssuedDate: "2026-08-25" }),
    row({ orderIssuedDate: null }),
  ];
  assert.deepEqual(collectDomesticOrderYears(rows), ["2026", "2024"]);
});

test("발주일이 하나도 없으면 고를 년도도 없다", () => {
  assert.deepEqual(collectDomesticOrderYears([row(), row()]), []);
});

test("년도로 가릴 수 없는 줄이 몇 건인지 센다", () => {
  const rows = [
    row({ orderIssuedDate: "2026-01-01" }),
    row({ orderIssuedDate: null }),
    row({ orderIssuedDate: null }),
  ];
  assert.equal(countDomesticOrdersWithoutOrderYear(rows), 2);
});

// ── 년도로 거르기 ──────────────────────────────────────────────────────

test("고른 해의 줄만 남는다", () => {
  const rows = [
    row({ id: "2026", orderIssuedDate: "2026-03-01" }),
    row({ id: "2025", orderIssuedDate: "2025-11-30" }),
  ];
  assert.deepEqual(
    filterDomesticOrdersByYear(rows, "2026").map((r) => r.id),
    ["2026"]
  );
});

test("발주일 없는 줄은 어느 년도를 골라도 남는다", () => {
  const rows = [
    row({ id: "2026", orderIssuedDate: "2026-03-01" }),
    row({ id: "2025", orderIssuedDate: "2025-11-30" }),
    row({ id: "미정", orderIssuedDate: null }),
  ];
  assert.deepEqual(
    filterDomesticOrdersByYear(rows, "2026").map((r) => r.id),
    ["2026", "미정"]
  );
  assert.deepEqual(
    filterDomesticOrdersByYear(rows, "2025").map((r) => r.id),
    ["2025", "미정"],
    "다른 해를 골라도 발주일 없는 줄은 그대로 있어야 한다"
  );
  assert.deepEqual(
    filterDomesticOrdersByYear(rows, "2019").map((r) => r.id),
    ["미정"],
    "자료가 한 줄도 없는 해에서도 발주일 없는 줄은 보여야 한다"
  );
});

test("년도가 null이면 아무것도 거르지 않는다", () => {
  const rows = [row({ id: "a", orderIssuedDate: "2026-01-01" }), row({ id: "b" })];
  assert.deepEqual(
    filterDomesticOrdersByYear(rows, null).map((r) => r.id),
    ["a", "b"]
  );
});

test("거르기가 순서를 흔들지 않는다 — 표에 사람이 매긴 순번이 있다", () => {
  const rows = [
    row({ id: "1", orderIssuedDate: "2026-01-01" }),
    row({ id: "2", orderIssuedDate: null }),
    row({ id: "3", orderIssuedDate: "2026-02-01" }),
  ];
  assert.deepEqual(
    filterDomesticOrdersByYear(rows, "2026").map((r) => r.id),
    ["1", "2", "3"]
  );
});

// ── 처음 보여 줄 년도 ──────────────────────────────────────────────────

test("기본값은 올해다", () => {
  assert.equal(resolveInitialDomesticOrderYear(["2026", "2025"], "2026"), "2026");
});

test("올해 자료가 없으면 있는 것 중 가장 최근 해로 내려온다", () => {
  assert.equal(resolveInitialDomesticOrderYear(["2025", "2024"], "2026"), "2025");
});

test("고를 년도가 하나도 없으면 null이다 — 그때는 거르지 않는다", () => {
  assert.equal(resolveInitialDomesticOrderYear([], "2026"), null);
});

// ── 고객사 묶기 ────────────────────────────────────────────────────────

test("고객사끼리 묶이고, 묶음 순서는 먼저 나온 순이다", () => {
  const rows = [
    row({ id: "a1", customerName: "한빛전자" }),
    row({ id: "b1", customerName: "동해정밀" }),
    row({ id: "a2", customerName: "한빛전자" }),
  ];
  const groups = groupDomesticOrdersByCustomer(rows);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["한빛전자", "동해정밀"]
  );
  assert.deepEqual(
    groups[0].rows.map((r) => r.id),
    ["a1", "a2"],
    "묶음 안의 순서는 원본 그대로여야 한다"
  );
});

test("고객사가 없는 줄은 맨 뒤 한 묶음이다", () => {
  const rows = [
    row({ id: "none1", customerName: null }),
    row({ id: "named", customerName: "한빛전자" }),
    row({ id: "none2", customerName: null }),
  ];
  const groups = groupDomesticOrdersByCustomer(rows);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["한빛전자", UNASSIGNED_CUSTOMER_LABEL],
    "미지정은 먼저 나왔더라도 맨 뒤여야 한다"
  );
  const last = groups[groups.length - 1];
  assert.equal(last.customerName, null);
  assert.deepEqual(
    last.rows.map((r) => r.id),
    ["none1", "none2"]
  );
});

test("이름이 공백뿐인 줄도 같은 미지정 묶음으로 간다 — 묶음이 둘로 갈라지지 않는다", () => {
  const groups = groupDomesticOrdersByCustomer([
    row({ id: "blank", customerName: "   " }),
    row({ id: "null", customerName: null }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, UNASSIGNED_CUSTOMER_LABEL);
  assert.equal(groups[0].rows.length, 2);
});

test("미지정 줄이 없으면 미지정 묶음도 없다", () => {
  const groups = groupDomesticOrdersByCustomer([row({ customerName: "한빛전자" })]);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["한빛전자"]
  );
});

test("빈 목록은 묶음도 없다", () => {
  assert.deepEqual(groupDomesticOrdersByCustomer([]), []);
});

test("어느 줄도 잃어버리지 않는다", () => {
  const rows = [
    row({ id: "1", customerName: "가" }),
    row({ id: "2", customerName: null }),
    row({ id: "3", customerName: "나" }),
    row({ id: "4", customerName: "가" }),
  ];
  const flattened = groupDomesticOrdersByCustomer(rows).flatMap((g) => g.rows.map((r) => r.id));
  assert.deepEqual(flattened.sort(), ["1", "2", "3", "4"]);
});

// ── 완료 판정 ──────────────────────────────────────────────────────────

test("완료 판정은 completed_at 하나로 한다", () => {
  assert.equal(isDomesticOrderCompleted(row({ completedAt: "2026-08-25T01:00:00.000Z" })), true);
  assert.equal(isDomesticOrderCompleted(row({ completedAt: null })), false);
});

// ── 값 고르기 (이 행의 값이 먼저) ──────────────────────────────────────

test("빈 값은 한 가지 모양으로 접힌다 — null·undefined·빈 문자열·공백", () => {
  assert.equal(foldBlankToNull(null), null);
  assert.equal(foldBlankToNull(undefined), null);
  assert.equal(foldBlankToNull(""), null);
  assert.equal(foldBlankToNull("   "), null);
  assert.equal(foldBlankToNull("\n\t "), null);
});

test("값이 있으면 앞뒤 공백을 떼고 돌려준다 — 화면과 묶기가 같은 글자를 본다", () => {
  assert.equal(foldBlankToNull("  ARC-200  "), "ARC-200");
  assert.equal(foldBlankToNull("ARC-200"), "ARC-200");
});

test("이 행에 적힌 값이 있으면 그것을 쓴다 — 수리 건 값이 있어도 가리지 않는다", () => {
  // 발주서의 형식이 수리 건의 형식과 다를 수 있고, 그때 청구 근거는 발주서다.
  assert.equal(resolveDomesticOrderValue("발주서 형식", "수리 건 형식"), "발주서 형식");
});

test("이 행이 비어 있으면 연결된 수리 건의 값을 쓴다", () => {
  assert.equal(resolveDomesticOrderValue(null, "수리 건 형식"), "수리 건 형식");
  assert.equal(resolveDomesticOrderValue(undefined, "수리 건 형식"), "수리 건 형식");
});

test("둘 다 없으면 없음이다 — 수리 건 연결이 없는 줄이 그렇다", () => {
  assert.equal(resolveDomesticOrderValue(null, null), null);
  assert.equal(resolveDomesticOrderValue(undefined, undefined), null);
});

test("빈 문자열·공백만 적힌 값은 '적힌 값'으로 치지 않는다", () => {
  // 실수로 스페이스 한 칸이 들어간 줄이 수리 건의 값을 영영 가리면, 화면에는
  // 빈칸으로 보이는데 원본에는 값이 있는 상태가 되고 이유를 알 길이 없다.
  assert.equal(resolveDomesticOrderValue("", "수리 건 형식"), "수리 건 형식");
  assert.equal(resolveDomesticOrderValue("   ", "수리 건 형식"), "수리 건 형식");
  assert.equal(resolveDomesticOrderValue("\t\n", "수리 건 형식"), "수리 건 형식");
});

test("수리 건 쪽이 공백뿐이어도 없음으로 접힌다 — 공백이 값처럼 보이지 않는다", () => {
  assert.equal(resolveDomesticOrderValue(null, "   "), null);
  assert.equal(resolveDomesticOrderValue("   ", "   "), null);
});

test("이 행의 값이 우선이라는 규칙은 다섯 칸 모두에 같게 쓴다", () => {
  // 고객사 · 형식 · L/N · S/N · 고장내역이 같은 함수를 부른다 — 칸마다 다른
  // 규칙을 두면 "왜 형식만 수리 건을 따라가는가" 같은 질문이 생긴다.
  const own = { customer: "한빛전자", model: "ARC-200", lot: null, serial: "  ", fault: null };
  const fromCase = {
    customer: "동해정밀",
    model: "ARC-100",
    lot: "LN-9",
    serial: "SN-9",
    fault: "전원 안 들어옴",
  };
  assert.equal(resolveDomesticOrderValue(own.customer, fromCase.customer), "한빛전자");
  assert.equal(resolveDomesticOrderValue(own.model, fromCase.model), "ARC-200");
  assert.equal(resolveDomesticOrderValue(own.lot, fromCase.lot), "LN-9");
  assert.equal(resolveDomesticOrderValue(own.serial, fromCase.serial), "SN-9");
  assert.equal(resolveDomesticOrderValue(own.fault, fromCase.fault), "전원 안 들어옴");
});

test("줄 색은 이름을 고른 쪽 고객사의 색이다 — 이 행에 고객사가 있으면 그쪽", () => {
  assert.equal(
    resolveDomesticOrderCustomerRowColor({
      ownCustomerName: "한빛전자",
      ownCustomerRowColor: "amber",
      repairCaseCustomerRowColor: "sky",
    }),
    "amber"
  );
});

test("이 행에 고객사가 있는데 색이 없으면 색도 없다 — 수리 건 고객사의 색을 빌려 오지 않는다", () => {
  // 이것이 이 함수가 따로 있는 이유다. resolveDomesticOrderValue 처럼 두 값을
  // 접으면, 화면에는 "한빛전자"라고 적힌 줄에 동해정밀의 색이 칠해진다.
  assert.equal(
    resolveDomesticOrderCustomerRowColor({
      ownCustomerName: "한빛전자",
      ownCustomerRowColor: null,
      repairCaseCustomerRowColor: "sky",
    }),
    null
  );
});

test("이 행에 고객사가 없으면 수리 건 고객사의 색을 쓴다", () => {
  assert.equal(
    resolveDomesticOrderCustomerRowColor({
      ownCustomerName: null,
      ownCustomerRowColor: null,
      repairCaseCustomerRowColor: "sky",
    }),
    "sky"
  );
});

test("공백만 적힌 고객사 이름은 없는 것과 같다 — 이름과 색이 같은 판단을 쓴다", () => {
  assert.equal(
    resolveDomesticOrderCustomerRowColor({
      ownCustomerName: "   ",
      ownCustomerRowColor: "amber",
      repairCaseCustomerRowColor: "sky",
    }),
    "sky",
    "이름이 수리 건을 따라갔으면 색도 따라가야 한다"
  );
});

test("고객사가 어느 쪽에도 없으면 색도 없다", () => {
  assert.equal(
    resolveDomesticOrderCustomerRowColor({
      ownCustomerName: null,
      ownCustomerRowColor: null,
      repairCaseCustomerRowColor: null,
    }),
    null
  );
});

// ─────────────────────────────────────────────── 납기요청일을 화면 글자로 접기

/**
 * 한 발주에 납기일이 여럿일 수 있게 된 뒤, 22칼럼짜리 표의 좁은 칸에 그 목록을
 * 어떻게 적는가. 지키는 것은 셋이다.
 *  1. 없으면 null 이다 — "-"로 바꾸는 일은 화면이 한다.
 *  2. 여럿이면 **첫 날짜 + 외 N건**이고, 나머지는 전체 한 줄로 되찾는다.
 *  3. **순서를 다시 정하지 않는다** — 1차분·2차분처럼 차례가 곧 뜻이다.
 */

test("납기일이 없으면 요약도 전체도 null이다", () => {
  assert.equal(formatDomesticOrderDueDateSummary([]), null);
  assert.equal(formatDomesticOrderDueDates([]), null);
});

test("납기일이 하나면 그 날짜 그대로다 — '외 0건'이 붙지 않는다", () => {
  assert.equal(
    formatDomesticOrderDueDateSummary([{ dueDate: "2026-01-20", note: null }]),
    "2026-01-20"
  );
});

test("메모가 있으면 괄호로 함께 보인다 — 날짜만으로는 어느 분량인지 알 수 없다", () => {
  assert.equal(
    formatDomesticOrderDueDateSummary([{ dueDate: "2026-01-20", note: "1차분" }]),
    "2026-01-20 (1차분)"
  );
  // 공백만 적힌 메모는 없는 것이다 — 이 파일의 다른 값들과 같은 규칙이다.
  assert.equal(
    formatDomesticOrderDueDateSummary([{ dueDate: "2026-01-20", note: "   " }]),
    "2026-01-20"
  );
});

test("여럿이면 첫 날짜 + '외 N건'이다", () => {
  assert.equal(
    formatDomesticOrderDueDateSummary([
      { dueDate: "2026-01-20", note: "1차분" },
      { dueDate: "2026-02-15", note: "2차분" },
      { dueDate: "2026-03-10", note: null },
    ]),
    "2026-01-20 (1차분) 외 2건"
  );
});

test("요약은 받은 차례의 첫 번째다 — 날짜순으로 다시 세우지 않는다", () => {
  // 2차분이 앞에 놓인 목록. 여기서 몰래 날짜순으로 세우면, 사람이 폼에
  // 늘어놓은 차례와 표에 보이는 첫 날짜가 어긋난다.
  assert.equal(
    formatDomesticOrderDueDateSummary([
      { dueDate: "2026-03-10", note: "먼저 적은 줄" },
      { dueDate: "2026-01-20", note: null },
    ]),
    "2026-03-10 (먼저 적은 줄) 외 1건"
  );
});

test("전체 한 줄은 받은 차례 그대로 전부를 적는다", () => {
  assert.equal(
    formatDomesticOrderDueDates([
      { dueDate: "2026-03-10", note: "2차분" },
      { dueDate: "2026-01-20", note: null },
      { dueDate: "2026-02-15", note: "  " },
    ]),
    "2026-03-10 (2차분), 2026-01-20, 2026-02-15"
  );
});
