import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preventShiftClickTextSelection, shiftKeyOf } from "./useShiftRangeSelection";

/**
 * ============================================================================
 * Shift 를 이벤트에서 읽고, 글자가 긁히지 않게 막는 두 조각
 * ============================================================================
 * 규칙 자체는 lib/domain/range-selection.test.ts 가 값으로 본다. 여기서 지키는
 * 것은 화면과 닿는 두 조각이다:
 *  · 🔴 체크박스의 onChange 는 React 가 click 으로 만든 것이라 이벤트 자체에는
 *    shiftKey 가 없고 nativeEvent 에 있다. 거기를 안 보면 Shift 를 눌러도
 *    **아무 일도 일어나지 않는다** — 고장이 조용하다.
 *  · Space 로 켤 때 브라우저가 쏘는 click 에 수식키가 없으면 보통 누르기다.
 *  · 글자 선택 막기는 Shift 일 때만 — 평소 누르기의 초점 이동을 막으면 안 된다.
 *  · 🔴 전역 user-select 를 건드리지 않는다.
 * ============================================================================
 */

test("단추의 onClick 은 이벤트에 shiftKey 가 바로 있다", () => {
  assert.equal(shiftKeyOf({ shiftKey: true }), true);
  assert.equal(shiftKeyOf({ shiftKey: false }), false);
});

test("🔴 체크박스의 onChange 는 nativeEvent(= click)에서 읽는다", () => {
  // React 의 ChangeEvent 모양 — 이벤트 자체에는 shiftKey 가 없다.
  assert.equal(shiftKeyOf({ nativeEvent: { shiftKey: true } }), true);
  assert.equal(shiftKeyOf({ nativeEvent: { shiftKey: false } }), false);
});

test("수식키가 실리지 않은 click(일부 브라우저의 Space·label)은 보통 누르기다", () => {
  assert.equal(shiftKeyOf({ nativeEvent: {} }), false);
  assert.equal(shiftKeyOf({ nativeEvent: null }), false);
  assert.equal(shiftKeyOf({}), false);
});

test("글자 선택 막기는 Shift 일 때만 — 평소 누르기는 그대로 둔다", () => {
  let prevented = 0;
  const preventDefault = () => {
    prevented += 1;
  };
  preventShiftClickTextSelection({ shiftKey: false, preventDefault });
  assert.equal(prevented, 0, "Shift 없이 누른 것까지 막으면 체크박스에 초점이 가지 않는다");
  preventShiftClickTextSelection({ shiftKey: true, preventDefault });
  assert.equal(prevented, 1);
});

test("🔴 전역 글자 선택(user-select)을 건드리지 않는다 — 누르는 요소에서만 막는다", () => {
  const source = readFileSync(new URL("./useShiftRangeSelection.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  for (const forbidden of ["userSelect", "user-select", "select-none", "document.", "getSelection"]) {
    assert.ok(!source.includes(forbidden), `${forbidden} — 목록의 글자를 복사하는 일은 그대로 되어야 한다`);
  }
});
