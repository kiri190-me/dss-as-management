import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_ROW_COLORS,
  NO_CUSTOMER_ROW_COLOR_KEY,
  customerRowColorClass,
  customerRowColorInteractiveClass,
  isCustomerRowColorKey,
  resolveCustomerRowColor,
} from "./customer-row-color";

test("키로 색을 찾는다", () => {
  const color = resolveCustomerRowColor("amber");
  assert.notEqual(color, null);
  assert.equal(color?.key, "amber");
  assert.equal(color?.label, "노랑");
});

test("모르는 키는 '없음'으로 떨어진다 — 화면이 깨지지 않는다", () => {
  // 나중에 팔레트에서 색을 빼면 그 색을 골라 둔 고객사에 이런 값이 남는다.
  assert.equal(resolveCustomerRowColor("zinc"), null);
  assert.equal(resolveCustomerRowColor("#FFE4B5"), null);
  assert.equal(resolveCustomerRowColor("AMBER"), null, "대소문자가 다르면 다른 값이다");
  assert.equal(customerRowColorClass("zinc"), "");
  assert.equal(customerRowColorInteractiveClass("zinc"), "");
});

test("null · undefined · 빈 문자열은 색이 없다", () => {
  assert.equal(resolveCustomerRowColor(null), null);
  assert.equal(resolveCustomerRowColor(undefined), null);
  assert.equal(resolveCustomerRowColor(NO_CUSTOMER_ROW_COLOR_KEY), null);
  assert.equal(customerRowColorClass(null), "");
  assert.equal(customerRowColorClass(undefined), "");
  assert.equal(customerRowColorClass(NO_CUSTOMER_ROW_COLOR_KEY), "");
  assert.equal(customerRowColorInteractiveClass(null), "");
});

test("색이 있으면 밝은 화면과 어두운 화면 클래스를 함께 내놓는다", () => {
  const classes = customerRowColorClass("sky").split(" ");
  assert.ok(classes.includes("bg-sky-100"));
  assert.ok(classes.includes("dark:bg-sky-950/50"));
});

test("누를 수 있는 줄은 hover 색조까지 받는다 — 색이 hover 에서 사라지지 않는다", () => {
  const classes = customerRowColorInteractiveClass("sky").split(" ");
  assert.ok(classes.includes("bg-sky-100"));
  assert.ok(classes.includes("dark:bg-sky-950/50"));
  assert.ok(classes.includes("hover:bg-sky-200"));
  assert.ok(classes.includes("dark:hover:bg-sky-900/50"));
});

test("팔레트의 모든 색이 밝은·어두운 클래스를 둘 다 갖는다", () => {
  assert.ok(CUSTOMER_ROW_COLORS.length >= 10, "고를 수 있는 색이 열 가지는 되어야 한다");
  for (const color of CUSTOMER_ROW_COLORS) {
    assert.ok(color.label.length > 0, `${color.key}: 이름이 있어야 한다`);
    assert.ok(color.lightClass.startsWith("bg-"), `${color.key}: 밝은 화면 배경이 있어야 한다`);
    assert.ok(color.darkClass.startsWith("dark:bg-"), `${color.key}: 어두운 화면 배경이 있어야 한다`);
    assert.ok(
      color.lightHoverClass.startsWith("hover:bg-"),
      `${color.key}: 밝은 화면 hover 배경이 있어야 한다`
    );
    assert.ok(
      color.darkHoverClass.startsWith("dark:hover:bg-"),
      `${color.key}: 어두운 화면 hover 배경이 있어야 한다`
    );
  }
});

test("키는 서로 겹치지 않는다", () => {
  const keys = CUSTOMER_ROW_COLORS.map((color) => color.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("완료된 줄의 회색과 헷갈릴 무채색은 팔레트에 없다", () => {
  // 완료 표시가 zinc 계열이라, 무채색을 고를 수 있으면 두 상태가 같은 모양이 된다.
  for (const color of CUSTOMER_ROW_COLORS) {
    for (const gray of ["zinc", "slate", "gray", "neutral", "stone"]) {
      assert.ok(
        !color.lightClass.includes(gray) && !color.darkClass.includes(gray),
        `${color.key}: 무채색(${gray}) 계열은 쓰지 않는다`
      );
    }
  }
});

test("isCustomerRowColorKey 는 팔레트 키만 통과시킨다", () => {
  assert.equal(isCustomerRowColorKey("amber"), true);
  assert.equal(isCustomerRowColorKey("fuchsia"), true);
  assert.equal(isCustomerRowColorKey("zinc"), false);
  assert.equal(isCustomerRowColorKey(""), false);
  assert.equal(isCustomerRowColorKey(null), false);
  assert.equal(isCustomerRowColorKey(undefined), false);
  assert.equal(isCustomerRowColorKey(123), false);
  assert.equal(isCustomerRowColorKey({ key: "amber" }), false);
});
