import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  addStockRequestCartLine,
  applyStockRequestCartPatch,
  getOrCreateRequestKey,
  removeStockRequestCartLine,
  resetRequestKey,
  validateStockRequestCart,
  type StockRequestCartLine,
} from "./inventory-stock-request-cart";

/**
 * ============================================================================
 * 재고 관리에 올릴 부품 담기 — 화면 상태의 규칙 (2026-10-15)
 * ============================================================================
 * 🔴 여기서 지키는 두 가지가 이 조각의 울타리다:
 *
 *  ㉠ **유상/무상을 고르지 않으면 못 올린다.** 기본값이 없고, 저쪽도 빠지면 400 이다.
 *  ㉡ **두 번 눌러도 요청 번호가 같다.** 저쪽은 같은 열쇠면 신청을 새로 만들지 않고
 *     처음 신청을 돌려준다. 값이 매번 달라지면 그 보호가 통째로 사라져 같은 요청이 두 줄 선다.
 *     화면은 `useRef` 에 담아 쓰므로 브라우저 없이 재려면 **실제로 두 번 불러 봐야** 한다.
 *
 * 부품 이름은 전부 지어낸 것이다(공개 저장소).
 * ============================================================================
 */

function line(no: number, patch: Partial<StockRequestCartLine> = {}): StockRequestCartLine {
  return { no, name: `부품-${no}`, ownerLabel: "DSS", quantity: "1", chargeType: "", ...patch };
}

describe("담고 고치고 빼기", () => {
  test("🔴 같은 부품이 두 줄이 되지 않는다 — 저쪽이 거절한다", () => {
    const once = addStockRequestCartLine([], line(11));
    const twice = addStockRequestCartLine(once, line(11, { quantity: "5" }));
    assert.equal(twice.length, 1);
    // 말없이 수량을 더하지도 않는다 — 사람이 모르는 사이에 요청 수량이 불어난다.
    assert.equal(twice[0].quantity, "1");
  });

  test("한 칸만 고치면 그 줄의 다른 칸도, 다른 줄도 그대로다", () => {
    const cart = [line(11, { quantity: "3" }), line(12)];
    const patched = applyStockRequestCartPatch(cart, 11, { chargeType: "PAID" });
    assert.deepEqual(patched[0], { no: 11, name: "부품-11", ownerLabel: "DSS", quantity: "3", chargeType: "PAID" });
    assert.deepEqual(patched[1], cart[1]);
  });

  test("빼면 그 줄만 빠진다", () => {
    const cart = [line(11), line(12)];
    assert.deepEqual(removeStockRequestCartLine(cart, 11).map((l) => l.no), [12]);
  });
});

describe("🔴 올리기 전 검사 — 유상/무상이 없으면 못 올린다", () => {
  test("고르지 않은 줄이 하나라도 있으면 거절한다", () => {
    const result = validateStockRequestCart([line(11, { chargeType: "PAID" }), line(12)]);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /유상\/무상/);
    assert.match(result.ok ? "" : result.message, /부품-12/);
  });

  test("전부 고르면 통과하고, 글자로 들고 있던 수량이 숫자가 된다", () => {
    const result = validateStockRequestCart([
      line(11, { chargeType: "PAID", quantity: "2" }),
      line(12, { chargeType: "FREE", quantity: "1" }),
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.lines : null, [
      { no: 11, quantity: 2, chargeType: "PAID" },
      { no: 12, quantity: 1, chargeType: "FREE" },
    ]);
  });

  test("수량 칸이 비었거나 글자면 거절한다", () => {
    for (const quantity of ["", "   ", "두 개", "0", "1.5", "-1"]) {
      const result = validateStockRequestCart([line(11, { chargeType: "FREE", quantity })]);
      assert.equal(result.ok, false, `수량 "${quantity}" 가 통과했다`);
    }
  });

  test("빈 장바구니는 올라가지 않는다", () => {
    assert.equal(validateStockRequestCart([]).ok, false);
  });
});

describe("🔴 요청 번호 — 두 번 눌러도 같은 값이어야 한다", () => {
  test("같은 자리에서 두 번 부르면 **같은 값**이 나온다", () => {
    let made = 0;
    const make = () => `지어낸-번호-${(made += 1)}`;
    const holder: { current: string | null } = { current: null };

    const first = getOrCreateRequestKey(holder, make);
    const second = getOrCreateRequestKey(holder, make);

    assert.equal(first, second);
    // 두 번째 누름에서 새 번호를 만들지 **않았다**는 것까지 잰다 — 같은 값을 돌려주면서
    // 번호를 또 만들면, 자리를 옮겨 쓰는 다음 사람이 그 쪽을 쓰게 된다.
    assert.equal(made, 1);
  });

  test("🔴 올리기가 실패해도 그대로다 — 다시 누르는 것은 **같은 요청**이다", () => {
    let made = 0;
    const make = () => `지어낸-번호-${(made += 1)}`;
    const holder: { current: string | null } = { current: null };

    const first = getOrCreateRequestKey(holder, make);
    // (여기서 올리기가 실패했다 — 화면은 장바구니도 번호도 건드리지 않는다)
    const retry = getOrCreateRequestKey(holder, make);
    assert.equal(retry, first);
  });

  test("성공한 뒤에 비우면 다음 요청은 **새 번호**로 선다", () => {
    let made = 0;
    const make = () => `지어낸-번호-${(made += 1)}`;
    const holder: { current: string | null } = { current: null };

    const first = getOrCreateRequestKey(holder, make);
    resetRequestKey(holder);
    const next = getOrCreateRequestKey(holder, make);

    assert.notEqual(next, first);
    assert.equal(made, 2);
  });
});
