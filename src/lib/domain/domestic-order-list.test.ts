import { test } from "node:test";
import assert from "node:assert/strict";

import {
  collectDomesticOrderYears,
  countDomesticOrdersWithoutOrderYear,
  filterDomesticOrdersBySearch,
  filterDomesticOrdersByYear,
  foldBlankToNull,
  isDomesticOrderSearchActive,
  formatDomesticOrderDueDateLines,
  formatDomesticOrderDueDates,
  groupDomesticOrdersByCustomer,
  isDomesticOrderCompleted,
  orderIssuedYearOf,
  resolveDomesticOrderCustomerRowColor,
  resolveDomesticOrderValue,
  resolveInitialDomesticOrderYear,
  UNASSIGNED_CUSTOMER_LABEL,
} from "./domestic-order-list";

/**
 * 이 시험이 지키는 것 여섯.
 *  1. 년도 후보는 자료에 있는 해만이다.
 *  2. **발주일 없는 줄은 어느 년도에서도 살아남는다** — 이 파일이 존재하는
 *     가장 큰 이유다. 그 줄은 아직 발주가 나지 않았다는 뜻이라 잊히면 안 된다.
 *  3. 고객사 묶음의 순서는 원본 순서를 따르고, 미지정은 맨 뒤 하나다.
 *  4. 완료 판정은 completed_at 하나로만 한다.
 *  5. **이 행에 적힌 값이 먼저이고, 공백만 적힌 값은 "없음"이다** — 이 규칙이
 *     SQL 의 coalesce 안에 있었다면 시험할 자리가 없었다.
 *  6. **검색은 여덟 칸을 함께 보고, 빈 검색어는 아무것도 거르지 않는다** —
 *     한 칸이라도 빠지면 그 칸으로는 조용히 못 찾게 되고, 그 사실은 화면
 *     어디에도 드러나지 않는다.
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

// ─────────────────────────────────────────────── 납기요청일을 화면 글자로 만들기

/**
 * 한 발주에 납기일이 여럿일 수 있게 된 뒤, 22칼럼짜리 표의 좁은 칸에 그 목록을
 * 어떻게 적는가. 지키는 것은 셋이다.
 *  1. 없으면 빈 배열이다 — "-"로 바꾸는 일은 화면이 한다.
 *  2. **하나도 감추지 않는다** — 한 줄에 날짜 하나씩, 받은 만큼 전부. 접었던
 *     "첫 날짜 + 외 N건"으로 돌아가면 나머지는 다시 폼을 열어야 보인다.
 *  3. **순서를 다시 정하지 않는다** — 1차분·2차분처럼 차례가 곧 뜻이다.
 *
 * 한 줄로 잇는 formatDomesticOrderDueDates 는 남아 있다 — 수정 폼의 충돌 초안
 * 상자가 쓰는 글이고, 거기는 통째로 복사해 가는 자리라 한 줄이 맞다.
 */

test("납기일이 없으면 줄도 없고 한 줄 글자도 null이다", () => {
  assert.deepEqual(formatDomesticOrderDueDateLines([]), []);
  assert.equal(formatDomesticOrderDueDates([]), null);
});

test("납기일이 하나면 줄도 하나다", () => {
  assert.deepEqual(formatDomesticOrderDueDateLines([{ dueDate: "2026-01-20", note: null }]), [
    "2026-01-20",
  ]);
});

test("메모가 있으면 괄호로 함께 보인다 — 날짜만으로는 어느 분량인지 알 수 없다", () => {
  assert.deepEqual(formatDomesticOrderDueDateLines([{ dueDate: "2026-01-20", note: "1차분" }]), [
    "2026-01-20 (1차분)",
  ]);
  // 공백만 적힌 메모는 없는 것이다 — 이 파일의 다른 값들과 같은 규칙이다.
  assert.deepEqual(formatDomesticOrderDueDateLines([{ dueDate: "2026-01-20", note: "   " }]), [
    "2026-01-20",
  ]);
});

test("여럿이면 한 줄에 하나씩 전부 나온다 — '외 N건'으로 접지 않는다", () => {
  assert.deepEqual(
    formatDomesticOrderDueDateLines([
      { dueDate: "2026-01-20", note: "1차분" },
      { dueDate: "2026-02-15", note: "2차분" },
      { dueDate: "2026-03-10", note: null },
    ]),
    ["2026-01-20 (1차분)", "2026-02-15 (2차분)", "2026-03-10"]
  );
});

test("줄의 차례는 받은 차례 그대로다 — 날짜순으로 다시 세우지 않는다", () => {
  // 늦은 날짜가 앞에 놓인 목록. 여기서 몰래 날짜순으로 세우면, 사람이 폼에
  // 늘어놓은 차례와 표에 보이는 차례가 어긋난다.
  assert.deepEqual(
    formatDomesticOrderDueDateLines([
      { dueDate: "2026-03-10", note: "먼저 적은 줄" },
      { dueDate: "2026-01-20", note: null },
    ]),
    ["2026-03-10 (먼저 적은 줄)", "2026-01-20"]
  );
});

test("메모가 있는 줄·없는 줄·공백뿐인 줄이 섞여 있어도 줄마다 같은 규칙이다", () => {
  assert.deepEqual(
    formatDomesticOrderDueDateLines([
      { dueDate: "2026-01-20", note: "1차분" },
      { dueDate: "2026-02-15", note: null },
      { dueDate: "2026-03-10", note: "   " },
      { dueDate: "2026-04-05", note: "잔량" },
    ]),
    ["2026-01-20 (1차분)", "2026-02-15", "2026-03-10", "2026-04-05 (잔량)"]
  );
});

test("전체 한 줄은 받은 차례 그대로 전부를 적는다 — 수정 폼의 초안 상자가 쓴다", () => {
  assert.equal(
    formatDomesticOrderDueDates([
      { dueDate: "2026-03-10", note: "2차분" },
      { dueDate: "2026-01-20", note: null },
      { dueDate: "2026-02-15", note: "  " },
    ]),
    "2026-03-10 (2차분), 2026-01-20, 2026-02-15"
  );
});

// ─────────────────────────────────────────────────────────── 글자로 찾기 (검색)

/**
 * 검색칸은 하나이고, 그 한 칸이 여덟 칸을 함께 본다. 지키는 것은 넷이다.
 *  1. **여덟 칸 어디에 있어도 걸린다** — 사람은 자기가 쥔 번호 하나를 칠 뿐,
 *     그것이 무슨 번호인지 골라 주지 않는다. 한 칸이 빠지면 그 칸으로만
 *     조용히 못 찾게 되고, 화면에는 "없습니다"라고만 보인다.
 *  2. **대소문자·공백 모양을 무시하고 부분 일치로 본다** — 그 판단은 여기서
 *     새로 적지 않고 normalizeEntityName 을 부른다(접수 폼과 DB 유니크 인덱스가
 *     쓰는 바로 그 규칙).
 *  3. **빈 검색어·공백만 친 검색어는 아무것도 거르지 않는다** — 스페이스 한
 *     칸이 목록을 통째로 지우면 사람은 자료가 없다고 읽는다.
 *  4. **줄 차례가 그대로다** — 이 표에는 사람이 매긴 순번이 있다.
 */

type SearchRow = {
  id: string;
  customerName: string | null;
  displayIntakeNumber: string | null;
  purchaseOrderNumber: string | null;
  quoteNumber: string | null;
  projectName: string | null;
  modelName: string | null;
  serialNumber: string | null;
  lotNumber: string | null;
};

/** 기본은 전부 비어 있다 — 이 표에는 빈 칸이 흔하다는 사실이 시험의 기본값이다. */
function searchRow(overrides: Partial<SearchRow> = {}): SearchRow {
  return {
    id: "id",
    customerName: null,
    displayIntakeNumber: null,
    purchaseOrderNumber: null,
    quoteNumber: null,
    projectName: null,
    modelName: null,
    serialNumber: null,
    lotNumber: null,
    ...overrides,
  };
}

test("여덟 칸 어디에 값이 있어도 그 칸으로 찾을 수 있다", () => {
  // 칸을 하나씩 세워 놓고 각각으로 찾아 본다. 하나라도 빠뜨리면 이 시험이
  // 그 칸의 이름을 대며 실패한다 — 화면에서는 "안 걸린다"는 것 말고는 아무
  // 단서도 얻을 수 없는 고장이다.
  const cases: {
    field: Exclude<keyof SearchRow, "id">;
    label: string;
    value: string;
    query: string;
  }[] = [
    { field: "customerName", label: "고객사", value: "한빛전자", query: "한빛" },
    { field: "displayIntakeNumber", label: "인수번호", value: "RFG-2026-0007", query: "0007" },
    { field: "purchaseOrderNumber", label: "발주서번호", value: "PO-88231", query: "88231" },
    { field: "quoteNumber", label: "견적서번호", value: "QT-2024-115", query: "2024-115" },
    { field: "projectName", label: "PJT", value: "성층권 통신 시험", query: "성층권" },
    { field: "modelName", label: "형식", value: "ARC-200", query: "arc-200" },
    { field: "serialNumber", label: "S/N", value: "SN-9912", query: "9912" },
    { field: "lotNumber", label: "L/N", value: "LN-4417", query: "4417" },
  ];

  for (const c of cases) {
    const hit = searchRow({ id: "hit" });
    hit[c.field] = c.value;
    const rows = [hit, searchRow({ id: "miss", customerName: "동해정밀" })];
    assert.deepEqual(
      filterDomesticOrdersBySearch(rows, c.query).map((r) => r.id),
      ["hit"],
      `${c.label} 칸으로 찾을 수 없다`
    );
  }
});

test("대소문자는 무시한다 — 화면에 적힌 그대로 치지 않아도 걸린다", () => {
  const rows = [searchRow({ id: "hit", modelName: "ARC-200" })];
  assert.equal(filterDomesticOrdersBySearch(rows, "arc-200").length, 1);
  assert.equal(filterDomesticOrdersBySearch(rows, "Arc").length, 1);
  assert.equal(
    filterDomesticOrdersBySearch([searchRow({ id: "hit", quoteNumber: "qt-2026-9" })], "QT").length,
    1
  );
});

test("번호 일부만 쳐도 걸린다 — 앞자리를 외우고 있는 사람은 없다", () => {
  const rows = [searchRow({ id: "hit", purchaseOrderNumber: "20260115-DSS-0042" })];
  assert.equal(filterDomesticOrdersBySearch(rows, "0042").length, 1, "뒷자리");
  assert.equal(filterDomesticOrdersBySearch(rows, "DSS").length, 1, "가운데");
  assert.equal(filterDomesticOrdersBySearch(rows, "2026").length, 1, "앞자리");
});

test("앞뒤 공백과 사이 공백은 접힌다 — 붙여넣기한 글자도 걸려야 한다", () => {
  const rows = [searchRow({ id: "hit", customerName: "한빛  전자" })];
  assert.equal(filterDomesticOrdersBySearch(rows, "  한빛 전자  ").length, 1, "검색어 쪽 공백");
  assert.equal(
    filterDomesticOrdersBySearch([searchRow({ id: "hit", customerName: " 한빛 전자 " })], "한빛  전자")
      .length,
    1,
    "자료 쪽 공백"
  );
});

test("빈 검색어와 공백뿐인 검색어는 아무것도 거르지 않는다", () => {
  const rows = [
    searchRow({ id: "1", customerName: "한빛전자" }),
    searchRow({ id: "2", customerName: "동해정밀" }),
    searchRow({ id: "3" }),
  ];
  for (const query of ["", " ", "   ", "\t\n"]) {
    assert.deepEqual(
      filterDomesticOrdersBySearch(rows, query).map((r) => r.id),
      ["1", "2", "3"],
      `검색어 ${JSON.stringify(query)} 가 목록을 지웠다`
    );
  }
});

test("여덟 칸이 모두 비어 있어도 터지지 않는다 — 그냥 안 걸리는 줄이다", () => {
  const rows = [searchRow({ id: "empty" }), searchRow({ id: "hit", quoteNumber: "QT-1" })];
  assert.deepEqual(
    filterDomesticOrdersBySearch(rows, "QT-1").map((r) => r.id),
    ["hit"]
  );
  assert.deepEqual(filterDomesticOrdersBySearch(rows, "없는번호"), []);
});

test("칸 하나만 걸려도 남는다 — 나머지가 비어 있어도 상관없다", () => {
  const rows = [
    searchRow({ id: "sn만", serialNumber: "SN-9912" }),
    searchRow({ id: "고객사만", customerName: "한빛전자" }),
  ];
  assert.deepEqual(
    filterDomesticOrdersBySearch(rows, "9912").map((r) => r.id),
    ["sn만"]
  );
});

test("검색이 줄 차례를 흔들지 않는다 — 표에 사람이 매긴 순번이 있다", () => {
  const rows = [
    searchRow({ id: "1", customerName: "한빛전자" }),
    searchRow({ id: "2", customerName: "동해정밀" }),
    searchRow({ id: "3", customerName: "한빛전자" }),
    searchRow({ id: "4", customerName: "한빛전자" }),
  ];
  assert.deepEqual(
    filterDomesticOrdersBySearch(rows, "한빛").map((r) => r.id),
    ["1", "3", "4"],
    "걸린 줄은 원본 차례 그대로여야 한다"
  );
});

test("빈 목록을 검색해도 빈 목록이다", () => {
  assert.deepEqual(filterDomesticOrdersBySearch([], "한빛"), []);
  assert.deepEqual(filterDomesticOrdersBySearch([], ""), []);
});

// ── 검색 중인가 (화면이 년도를 무시할지 정하는 판단) ───────────────────

test("공백만 친 것은 검색 중이 아니다 — 거르지 않는데 '검색 중'이라 적으면 안 된다", () => {
  assert.equal(isDomesticOrderSearchActive(""), false);
  assert.equal(isDomesticOrderSearchActive("   "), false);
  assert.equal(isDomesticOrderSearchActive("\t\n "), false);
});

test("글자가 한 자라도 있으면 검색 중이다", () => {
  assert.equal(isDomesticOrderSearchActive("한"), true);
  assert.equal(isDomesticOrderSearchActive("  QT-1  "), true);
});

test("검색 중이 아닌 검색어는 거르지도 않는다 — 한쪽만 참인 상태가 없다", () => {
  // 두 판단이 어긋나면 화면이 "모든 해에서 찾는 중"이라 적어 놓고 정작 년도
  // 거르기만 꺼진 목록(=전체)을 보여 주게 된다. 그 반대도 마찬가지로,
  // 걸러 놓고 아무 말도 하지 않으면 다른 해의 줄이 이유 없이 섞여 보인다.
  const rows = [searchRow({ id: "1", customerName: "한빛전자" }), searchRow({ id: "2" })];
  for (const query of ["", "   ", "\t\n"]) {
    assert.equal(isDomesticOrderSearchActive(query), false);
    assert.deepEqual(
      filterDomesticOrdersBySearch(rows, query).map((r) => r.id),
      ["1", "2"],
      `검색 중이 아닌 ${JSON.stringify(query)} 가 줄을 걸렀다`
    );
  }
  for (const query of ["한빛", " 한빛 ", "HANBIT"]) {
    assert.equal(isDomesticOrderSearchActive(query), true);
  }
});
