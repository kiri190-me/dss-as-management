import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_ROW_COLORS,
  CUSTOMER_ROW_CUSTOM_COLOR_LABEL,
  CUSTOMER_ROW_DARK_SURFACE,
  CUSTOMER_ROW_TEXT_ON_DARK,
  CUSTOMER_ROW_TEXT_ON_LIGHT,
  NO_CUSTOMER_ROW_COLOR_KEY,
  computeCustomerRowCustomTones,
  customerRowColorClass,
  customerRowColorInteractiveClass,
  customerRowColorStyle,
  isCustomerRowColorGrayish,
  isCustomerRowColorKey,
  normalizeCustomerRowColorValue,
  readCustomerRowCustomContrast,
  resolveCustomerRowColor,
} from "./customer-row-color";
import { uiThemeTintOf } from "./ui-theme-primary-ramp";
import { contrastRatio, UI_THEME_CONTRAST_WARN, UI_THEME_TOKENS } from "./ui-theme-tokens";

/** 형식이 어긋난 색 코드. 저장도 안 되고, 읽어도 "없음"이다. */
const MALFORMED_CODES = ["#12345", "#1234567", "#fff", "ffe4b5", "#gggggg", "red", "rgb(255,0,0)"];

test("키로 색을 찾는다", () => {
  const color = resolveCustomerRowColor("amber");
  assert.notEqual(color, null);
  assert.equal(color?.kind, "palette");
  assert.equal(color?.key, "amber");
  assert.equal(color?.label, "노랑");
});

test("모르는 값은 '없음'으로 떨어진다 — 화면이 깨지지 않는다", () => {
  // 나중에 팔레트에서 색을 빼면 그 색을 골라 둔 고객사에 이런 값이 남는다.
  assert.equal(resolveCustomerRowColor("zinc"), null);
  assert.equal(resolveCustomerRowColor("AMBER"), null, "대소문자가 다르면 다른 값이다");
  assert.equal(customerRowColorClass("zinc"), "");
  assert.equal(customerRowColorInteractiveClass("zinc"), "");
  assert.equal(customerRowColorStyle("zinc"), undefined);
  // DB 를 손으로 고쳐 형식이 어긋난 색 코드가 남아도 마찬가지다.
  for (const bad of MALFORMED_CODES) {
    assert.equal(resolveCustomerRowColor(bad), null, `${bad} 는 없음이어야 한다`);
    assert.equal(customerRowColorClass(bad), "", `${bad} 는 클래스가 없어야 한다`);
    assert.equal(customerRowColorStyle(bad), undefined, `${bad} 는 style 이 없어야 한다`);
  }
});

test("🔴 설계 변경(2026-09-13 사용자 결정): 색 코드는 직접 고른 색으로 읽힌다", () => {
  // 예전에는 이 값이 "모르는 키"라 null 이었다. 사용자가 팔레트 밖의 색도 고를 수
  // 있게 하기로 하면서 뜻이 뒤집혔다 — 약화가 아니라 설계 변경이다.
  const color = resolveCustomerRowColor("#FFE4B5");
  assert.notEqual(color, null);
  assert.equal(color?.kind, "custom");
  assert.equal(color?.key, "#ffe4b5", "정리된(소문자) 색 코드로 읽는다");
  assert.equal(color?.label, `${CUSTOMER_ROW_CUSTOM_COLOR_LABEL} #ffe4b5`);
  assert.equal(color?.label, "직접 고른 색 #ffe4b5", "상세 화면에 적히는 글자");
});

test("null · undefined · 빈 문자열은 색이 없다", () => {
  assert.equal(resolveCustomerRowColor(null), null);
  assert.equal(resolveCustomerRowColor(undefined), null);
  assert.equal(resolveCustomerRowColor(NO_CUSTOMER_ROW_COLOR_KEY), null);
  assert.equal(customerRowColorClass(null), "");
  assert.equal(customerRowColorClass(undefined), "");
  assert.equal(customerRowColorClass(NO_CUSTOMER_ROW_COLOR_KEY), "");
  assert.equal(customerRowColorInteractiveClass(null), "");
  assert.equal(customerRowColorStyle(null), undefined);
  assert.equal(customerRowColorStyle(undefined), undefined);
  assert.equal(customerRowColorStyle(NO_CUSTOMER_ROW_COLOR_KEY), undefined);
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

test("팔레트 색의 클래스는 직접 고르기가 생기기 전과 한 글자도 같다 — style 도 붙지 않는다", () => {
  for (const color of CUSTOMER_ROW_COLORS) {
    const hue = color.key;
    assert.equal(color.kind, "palette");
    assert.equal(customerRowColorClass(hue), `bg-${hue}-100 dark:bg-${hue}-950/50`);
    assert.equal(
      customerRowColorInteractiveClass(hue),
      `bg-${hue}-100 dark:bg-${hue}-950/50 hover:bg-${hue}-200 dark:hover:bg-${hue}-900/50`
    );
    assert.equal(customerRowColorStyle(hue), undefined, `${hue}: 팔레트 색은 클래스만으로 칠한다`);
  }
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

test("isCustomerRowColorKey 는 팔레트 키만 통과시킨다 — 색 코드는 키가 아니다", () => {
  assert.equal(isCustomerRowColorKey("amber"), true);
  assert.equal(isCustomerRowColorKey("fuchsia"), true);
  assert.equal(isCustomerRowColorKey("zinc"), false);
  assert.equal(isCustomerRowColorKey(""), false);
  assert.equal(isCustomerRowColorKey(null), false);
  assert.equal(isCustomerRowColorKey(undefined), false);
  assert.equal(isCustomerRowColorKey(123), false);
  assert.equal(isCustomerRowColorKey({ key: "amber" }), false);
  assert.equal(isCustomerRowColorKey("#ffe4b5"), false);
});

test("normalizeCustomerRowColorValue: 팔레트 키는 그대로, 색 코드는 소문자로 정리, 나머지는 null", () => {
  assert.equal(normalizeCustomerRowColorValue("amber"), "amber");
  assert.equal(normalizeCustomerRowColorValue("#FFE4B5"), "#ffe4b5");
  assert.equal(normalizeCustomerRowColorValue("  #ffe4b5  "), "#ffe4b5", "앞뒤 공백은 뗀다");
  assert.equal(normalizeCustomerRowColorValue("AMBER"), null, "키는 고쳐 주지 않는다");
  assert.equal(normalizeCustomerRowColorValue("zinc"), null);
  assert.equal(normalizeCustomerRowColorValue(""), null);
  assert.equal(normalizeCustomerRowColorValue(null), null);
  assert.equal(normalizeCustomerRowColorValue(123), null);
  for (const bad of MALFORMED_CODES) {
    assert.equal(normalizeCustomerRowColorValue(bad), null, `${bad} 는 거절해야 한다`);
  }
});

test("직접 고른 색은 늘 같은 고정 클래스를 쓴다 — 조립하지 않은 온전한 글자다", () => {
  for (const code of ["#ffe4b5", "#000080", "#ffffff"]) {
    assert.equal(
      customerRowColorClass(code),
      "bg-[var(--customer-row-bg)] dark:bg-[var(--customer-row-bg-dark)]"
    );
    assert.equal(
      customerRowColorInteractiveClass(code),
      "bg-[var(--customer-row-bg)] dark:bg-[var(--customer-row-bg-dark)] hover:bg-[var(--customer-row-bg-hover)] dark:hover:bg-[var(--customer-row-bg-dark-hover)]"
    );
  }
});

test("직접 고른 색의 style 은 클래스가 읽는 변수를 빠짐없이, 계산된 색으로 채운다", () => {
  const code = "#ffe4b5";
  const style = customerRowColorStyle(code) as Record<string, string> | undefined;
  assert.ok(style, "직접 고른 색에는 style 이 붙어야 한다");

  // 클래스가 읽는 변수와 style 이 담는 변수가 한 짝이어야 한다 — 한쪽만 고치면
  // 그 자리의 색이 사라진다.
  const readByClasses = [...customerRowColorInteractiveClass(code).matchAll(/var\((--[a-z-]+)\)/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(Object.keys(style).sort(), readByClasses);

  const tones = computeCustomerRowCustomTones(code);
  assert.equal(style["--customer-row-bg"], tones.light);
  assert.equal(style["--customer-row-bg-dark"], tones.dark);
  assert.equal(style["--customer-row-bg-hover"], tones.lightHover);
  assert.equal(style["--customer-row-bg-dark-hover"], tones.darkHover);

  const resolved = resolveCustomerRowColor(code);
  assert.equal(resolved?.kind, "custom");
  if (resolved?.kind === "custom") assert.deepEqual(resolved.tones, tones);
});

/** 대비를 확인할 씨앗. 지시서의 다섯(흰색·검정·노랑·남색·회색)에 극단 몇을 더했다. */
const SEEDS = {
  white: "#ffffff",
  black: "#000000",
  yellow: "#ffff00",
  navy: "#000080",
  gray: "#808080",
  red: "#ff0000",
  blue: "#0000ff",
  lime: "#00ff00",
  moccasin: "#ffe4b5",
  snow: "#fffafa",
} as const;

const HEX = /^#[0-9a-f]{6}$/;

/** 밝기 순서를 재는 자 — 검정과의 대비는 상대휘도의 단조증가 함수다. */
function brightnessOf(hex: string): number {
  return contrastRatio(hex, "#000000");
}

function hslLightnessOf(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  return (Math.max(...channels) + Math.min(...channels)) / 2;
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

test("어떤 색을 골라도 네 자리 모두 글자와의 대비가 4.5 이상이다", () => {
  for (const [name, seed] of Object.entries(SEEDS)) {
    const tones = computeCustomerRowCustomTones(seed);
    for (const tone of Object.values(tones)) {
      assert.match(tone, HEX, `${name}: 계산된 색은 소문자 #rrggbb 여야 한다`);
    }

    const readings = readCustomerRowCustomContrast(tones);
    assert.equal(readings.length, 4, `${name}: 네 자리를 모두 잰다`);
    for (const reading of readings) {
      assert.ok(
        reading.ratio >= UI_THEME_CONTRAST_WARN,
        `${name} ${reading.scope}/${reading.state}: ${reading.fg} on ${reading.bg} = ${reading.ratio}`
      );
    }

    // 잰 짝이 실제 화면의 짝인지 — 밝은 화면은 zinc-900 글자, 어두운 화면은 zinc-50 글자.
    assert.equal(contrastRatio(CUSTOMER_ROW_TEXT_ON_LIGHT, tones.light) >= UI_THEME_CONTRAST_WARN, true);
    assert.equal(contrastRatio(CUSTOMER_ROW_TEXT_ON_LIGHT, tones.lightHover) >= UI_THEME_CONTRAST_WARN, true);
    assert.equal(contrastRatio(CUSTOMER_ROW_TEXT_ON_DARK, tones.dark) >= UI_THEME_CONTRAST_WARN, true);
    assert.equal(contrastRatio(CUSTOMER_ROW_TEXT_ON_DARK, tones.darkHover) >= UI_THEME_CONTRAST_WARN, true);
  }
});

test("팔레트처럼 옅은 색조다 — 밝은 쪽은 아주 밝고 어두운 쪽은 아주 어둡고, hover 는 평소와 다르다", () => {
  for (const [name, seed] of Object.entries(SEEDS)) {
    const tones = computeCustomerRowCustomTones(seed);
    assert.ok(hslLightnessOf(tones.light) >= 0.9, `${name}: 밝은 배경이 옅어야 한다 (${tones.light})`);
    assert.ok(hslLightnessOf(tones.dark) <= 0.2, `${name}: 어두운 배경이 어두워야 한다 (${tones.dark})`);
    assert.ok(
      brightnessOf(tones.lightHover) < brightnessOf(tones.light),
      `${name}: 밝은 화면 hover 는 평소보다 한 단계 짙다 (${tones.light} → ${tones.lightHover})`
    );
    assert.ok(
      brightnessOf(tones.darkHover) > brightnessOf(tones.dark),
      `${name}: 어두운 화면 hover 는 평소보다 한 단계 밝다 (${tones.dark} → ${tones.darkHover})`
    );
  }
});

test("고른 색의 색상이 밝은 화면 배경에 그대로 남는다 — 밝기만 옮긴다", () => {
  for (const name of ["yellow", "navy", "red", "lime", "moccasin"] as const) {
    const seed = SEEDS[name];
    const tones = computeCustomerRowCustomTones(seed);
    const seedHue = uiThemeTintOf(seed).hue;
    for (const tone of [tones.light, tones.lightHover]) {
      assert.ok(
        hueDistance(uiThemeTintOf(tone).hue, seedHue) <= 3,
        `${name}: ${seed} 의 색상 ${seedHue.toFixed(1)}° 가 ${tone} 에서 ${uiThemeTintOf(tone).hue.toFixed(1)}° 가 됐다`
      );
    }
  }
});

test("무채색은 밝기를 버리므로 흰색·검정·회색이 같은 색조가 된다", () => {
  const gray = computeCustomerRowCustomTones(SEEDS.gray);
  assert.deepEqual(computeCustomerRowCustomTones(SEEDS.white), gray);
  assert.deepEqual(computeCustomerRowCustomTones(SEEDS.black), gray);
  assert.equal(gray.light, "#ebebeb");
});

test("같은 색이면 언제나 같은 네 값이다", () => {
  assert.deepEqual(computeCustomerRowCustomTones("#ffe4b5"), computeCustomerRowCustomTones("#ffe4b5"));
});

test("글자색·밑바탕 상수는 색 등록부의 기본값과 같다 — 둘이 어긋나면 대비를 엉뚱한 색으로 잰다", () => {
  const byKey = new Map(UI_THEME_TOKENS.map((token) => [token.key, token]));
  assert.equal(byKey.get("zinc-900")?.defaultLight, CUSTOMER_ROW_TEXT_ON_LIGHT);
  assert.equal(byKey.get("zinc-50")?.defaultDark, CUSTOMER_ROW_TEXT_ON_DARK);
  assert.equal(byKey.get("zinc-900")?.defaultDark, CUSTOMER_ROW_DARK_SURFACE);
});

test("회색에 가까운 색을 가려낸다 — 고르개가 완료된 줄과 헷갈린다고 알리는 기준", () => {
  for (const grayish of ["#808080", "#ffffff", "#000000", "#71717b", "#9a9090"]) {
    assert.equal(isCustomerRowColorGrayish(grayish), true, `${grayish} 는 회색에 가깝다`);
  }
  for (const colorful of ["#ff0000", "#000080", "#ffe4b5", "#ffff00", "#0d9488"]) {
    assert.equal(isCustomerRowColorGrayish(colorful), false, `${colorful} 는 색이 있다`);
  }
});
