import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  mergeProductModelCustomers,
  mergedProductModelCustomerNames,
} from "./product-model-customer-merge";

/**
 * ============================================================================
 * 제품 모델의 고객사 합치기
 * ============================================================================
 * 못 박는 것은 넷이다.
 *
 *  1. 접수 기록에서 나온 고객사가 **나온다** — 이 기능이 있는 이유다(수기 연결은
 *     모델 104개 중 3개뿐인데 기록에는 39개가 있다).
 *  2. 한 모델에 여럿이면 **여럿 다** 나온다(실측 32개 모델이 2곳 이상, 최대 4곳).
 *  3. 같은 고객사가 양쪽에 있으면 **한 번만** 나온다.
 *  4. 🔴 **기록에 없는 수기 연결이 살아남는다.** 실측 수기 6줄 중 2줄
 *     (DEMO-GENERATOR-001 · MBK200-JS2)이 기록에 없다 — 합치다가 그 둘이 사라지면
 *     사람이 손으로 해 둔 일이 화면에서 없어진다.
 *
 * 소프트 삭제(휴지통에 든 고객사 · 삭제된 접수 건 · 삭제된 장비)를 거르는 것은 이
 * 함수의 일이 아니라 조회의 일이다 — queries/product-model-customers.ts 가 SQL 에서
 * 건다. 그 필터가 제자리에 있는지는 product-model-customer-source.test.ts 가 본다.
 * ============================================================================
 */

const c = (id: string, name: string) => ({ id, name });

describe("mergeProductModelCustomers", () => {
  test("접수 기록에서 나온 고객사가 나온다", () => {
    const merged = mergeProductModelCustomers([], [c("d1", "교산전기")]);
    assert.deepEqual(merged, [{ id: "d1", name: "교산전기", source: "REPAIR_CASE" }]);
  });

  test("한 모델에 여럿이면 여럿 다 나온다 — 대표 한 곳으로 좁히지 않는다", () => {
    const merged = mergeProductModelCustomers(
      [],
      [c("d1", "가나전자"), c("d2", "다라산업"), c("d3", "마바테크"), c("d4", "사아정밀")]
    );
    assert.equal(merged.length, 4, "네 곳이 그대로 나와야 한다");
    assert.deepEqual(
      merged.map((x) => x.name),
      ["가나전자", "다라산업", "마바테크", "사아정밀"]
    );
  });

  test("같은 고객사가 양쪽에 있으면 한 번만 나오고, 갈래는 수기다", () => {
    const merged = mergeProductModelCustomers([c("x", "겹치는전자")], [c("x", "겹치는전자")]);
    assert.deepEqual(merged, [{ id: "x", name: "겹치는전자", source: "MANUAL" }]);
  });

  test("기록 쪽에 같은 id 가 두 번 와도 한 번만 나온다", () => {
    // 조회가 selectDistinct 로 막지만, 이 함수는 그 조회 하나에만 매인 것이 아니다.
    const merged = mergeProductModelCustomers([], [c("d1", "한번만"), c("d1", "한번만")]);
    assert.equal(merged.length, 1);
  });

  test("🔴 기록에 없는 수기 연결이 살아남는다 (DEMO-GENERATOR-001 · MBK200-JS2)", () => {
    // 접수 기록이 아예 없는 모델에 사람이 미리 붙여 둔 경우다.
    const onlyManual = mergeProductModelCustomers([c("m1", "손으로붙인곳")], []);
    assert.deepEqual(onlyManual, [{ id: "m1", name: "손으로붙인곳", source: "MANUAL" }]);

    // 기록은 있는데 그 안에 없는 수기 연결도 마찬가지다.
    const mixed = mergeProductModelCustomers([c("m1", "손으로붙인곳")], [c("d1", "기록에서온곳")]);
    assert.deepEqual(
      mixed.map((x) => [x.name, x.source]),
      [
        ["손으로붙인곳", "MANUAL"],
        ["기록에서온곳", "REPAIR_CASE"],
      ]
    );
  });

  test("차례는 수기 먼저(이름순), 그다음 기록(이름순)", () => {
    const merged = mergeProductModelCustomers(
      [c("m2", "하수기"), c("m1", "가수기")],
      [c("d2", "하기록"), c("d1", "가기록")]
    );
    assert.deepEqual(
      merged.map((x) => x.name),
      ["가수기", "하수기", "가기록", "하기록"],
      "수기가 이름순으로 먼저 오고 기록이 이름순으로 뒤따라야 한다"
    );
  });

  test("이름이 같으면 id 로 갈라 같은 입력에 같은 차례가 나온다", () => {
    const merged = mergeProductModelCustomers([], [c("b", "같은이름"), c("a", "같은이름")]);
    assert.deepEqual(
      merged.map((x) => x.id),
      ["a", "b"]
    );
  });

  test("넘겨받은 배열을 바꾸지 않는다", () => {
    // 부르는 쪽이 넘기는 것은 조회 결과이거나 폼의 상태값이다 — 제자리 정렬을 하면
    // 남의 것을 바꾼다.
    const manual = [c("m2", "하수기"), c("m1", "가수기")];
    const derived = [c("d2", "하기록"), c("d1", "가기록")];
    mergeProductModelCustomers(manual, derived);
    assert.deepEqual(
      manual.map((x) => x.id),
      ["m2", "m1"]
    );
    assert.deepEqual(
      derived.map((x) => x.id),
      ["d2", "d1"]
    );
  });

  test("양쪽 다 비면 빈 배열이다", () => {
    assert.deepEqual(mergeProductModelCustomers([], []), []);
  });
});

describe("mergedProductModelCustomerNames", () => {
  test("하나도 없으면 `-`", () => {
    assert.equal(mergedProductModelCustomerNames([]), "-");
  });

  test("갈래와 상관없이 이름을 쉼표로 잇는다", () => {
    const merged = mergeProductModelCustomers([c("m1", "수기곳")], [c("d1", "기록곳")]);
    assert.equal(mergedProductModelCustomerNames(merged), "수기곳, 기록곳");
  });
});
