import { test } from "node:test";
import assert from "node:assert/strict";

import {
  collectDomesticOrderYears,
  countDomesticOrdersWithoutOrderYear,
  filterDomesticOrdersByYear,
  groupDomesticOrdersByCustomer,
  isDomesticOrderCompleted,
  orderIssuedYearOf,
  resolveInitialDomesticOrderYear,
  UNASSIGNED_CUSTOMER_LABEL,
} from "./domestic-order-list";

/**
 * 이 시험이 지키는 것 넷.
 *  1. 년도 후보는 자료에 있는 해만이다.
 *  2. **발주일 없는 줄은 어느 년도에서도 살아남는다** — 이 파일이 존재하는
 *     가장 큰 이유다. 그 줄은 아직 발주가 나지 않았다는 뜻이라 잊히면 안 된다.
 *  3. 고객사 묶음의 순서는 원본 순서를 따르고, 미지정은 맨 뒤 하나다.
 *  4. 완료 판정은 completed_at 하나로만 한다.
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
