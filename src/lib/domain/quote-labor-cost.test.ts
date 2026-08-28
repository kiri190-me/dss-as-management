import assert from "node:assert/strict";
import { test } from "node:test";

import { sumQuoteLaborCost, type QuoteLaborRow } from "./quote-labor-cost";

function row(patch: Partial<QuoteLaborRow> = {}): QuoteLaborRow {
  return { partId: "p1", partNameText: "커패시터", laborCost: "30000", ...patch };
}

test("🔴 수량과 무관하다 — 부품 작업비가 있는 그대로 한 번 붙는다", () => {
  // 같은 부품을 몇 개 갈든 작업비는 같다(사용자 정정 2026-08-28). 이 함수는
  // 수량을 받지도 않으므로, 이 시험은 '같은 줄이면 같은 답'을 못 박는다.
  assert.equal(sumQuoteLaborCost([row()]).total, 30000);
  assert.equal(sumQuoteLaborCost([row({ laborCost: "30000" })]).total, 30000);
});

test("여러 품목이면 품목마다 한 번씩 더한다", () => {
  const result = sumQuoteLaborCost([
    row({ partId: "p1", partNameText: "커패시터", laborCost: "30000" }),
    row({ partId: "p2", partNameText: "다이오드", laborCost: "12500" }),
  ]);
  assert.equal(result.total, 42500);
  assert.deepEqual(result.unknown, []);
});

test("같은 부품이 두 줄이면 두 번 붙는다 — 세는 단위는 줄(품목)이다", () => {
  const result = sumQuoteLaborCost([
    row({ partId: "p1", laborCost: "30000" }),
    row({ partId: "p1", laborCost: "30000" }),
  ]);
  assert.equal(result.total, 60000);
});

test("🔴 정하지 않은 작업비는 0 이 아니다 — 합계에서 빼고 이름을 돌려준다", () => {
  const result = sumQuoteLaborCost([
    row({ partId: "p1", partNameText: "커패시터", laborCost: "30000" }),
    row({ partId: "p2", partNameText: "정하지 않은 부품", laborCost: null }),
  ]);
  assert.equal(result.total, 30000, "정하지 않은 부품을 0 으로 채우지 않는다");
  assert.deepEqual(result.unknown, ["정하지 않은 부품"]);
});

test("0 원은 실제 값이다 — 정하지 않은 것으로 세지 않는다", () => {
  const result = sumQuoteLaborCost([row({ laborCost: "0" })]);
  assert.equal(result.total, 0);
  assert.deepEqual(result.unknown, [], "0 은 '무상'이지 '미정'이 아니다");
});

test("손으로 적은 줄은 재촉하지 않는다 — 어느 부품인지 알 수 없는 것이다", () => {
  const result = sumQuoteLaborCost([row({ partId: null, partNameText: "직접 적은 부품", laborCost: null })]);
  assert.equal(result.total, 0);
  assert.deepEqual(result.unknown, [], "재고에 없는 이름까지 작업비를 채우라고 하지 않는다");
});

test("품명이 빈 줄은 아직 아무것도 아니다", () => {
  const result = sumQuoteLaborCost([
    row({ partNameText: "   ", laborCost: "30000" }),
    row({ partNameText: "", laborCost: null }),
  ]);
  assert.equal(result.total, 0);
  assert.deepEqual(result.unknown, []);
});

test("숫자로 읽히지 않는 작업비가 합계를 NaN 으로 만들지 않는다", () => {
  const result = sumQuoteLaborCost([
    row({ partId: "p1", partNameText: "커패시터", laborCost: "30000" }),
    row({ partId: "p2", partNameText: "망가진 값", laborCost: "abc" }),
  ]);
  assert.equal(result.total, 30000);
  assert.deepEqual(result.unknown, ["망가진 값"]);
});

test("빈 목록은 0 이다", () => {
  assert.deepEqual(sumQuoteLaborCost([]), { total: 0, unknown: [] });
});
