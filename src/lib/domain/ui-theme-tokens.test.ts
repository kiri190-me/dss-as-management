import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NO_UI_THEME_OVERRIDES,
  UI_THEME_BYPASS_COOKIE,
  UI_THEME_BYPASS_MAX_AGE_SECONDS,
  UI_THEME_BYPASS_VALUE,
  UI_THEME_CONTRAST_BLOCKING,
  UI_THEME_CONTRAST_FLOOR,
  UI_THEME_CONTRAST_PAIRS,
  UI_THEME_CONTRAST_WARN,
  UI_THEME_TOKENS,
  contrastRatio,
  isUiThemeBypassed,
  normalizeUiThemeValue,
  resolveUiTheme,
  serializeUiThemeCss,
  type UiThemeToken,
} from "./ui-theme-tokens";

/**
 * ============================================================================
 * 화면 토큰 — 등록부·검증기·직렬화
 * ============================================================================
 * 이 시험이 지키려는 것은 셋이다.
 *
 *  1) **등록부가 스스로 앞뒤가 맞는다.** 기본값이 자기 검증기를 통과하지 못하면,
 *     나중에 붙일 "전부 기본값으로" 단추가 서버에 거절당하는 자가당착이 된다.
 *     기본 조합이 대비 하한을 못 넘겨도 같은 일이 벌어진다.
 *  2) **검증기가 좁다.** 색에 hex 여섯 자리 말고 아무것도 못 들어오는 것이 이
 *     축의 유일한 CSS 주입 방어선이다. 넓어지는 순간 저장된 문자열이 선택자를
 *     탈출한다.
 *  3) **직렬화의 선택자가 정확하다.** 특히 라이트 블록의 `:not(.dark)` —
 *     빠지면 다크 모드에서 배경이 흰색이 되고, 그 증상은 라이트로만 보는
 *     사람에게 영영 안 보인다.
 * ============================================================================
 */

function tokenByKey(key: string): UiThemeToken {
  const token = UI_THEME_TOKENS.find((candidate) => candidate.key === key);
  assert.ok(token, `등록부에 ${key}가 없다`);
  return token;
}

const COLOR_TOKEN = tokenByKey("zinc-900");
const RADIUS_TOKEN = tokenByKey("radius-md");
const FONT_SIZE_TOKEN = tokenByKey("text-sm");

// ───────────────────────────────────────────── 등록부 자기 정합성

test("등록부의 키와 CSS 변수 이름이 전부 고유하고 개수가 35다", () => {
  const keys = UI_THEME_TOKENS.map((token) => token.key);
  const cssVars = UI_THEME_TOKENS.map((token) => token.cssVar);

  assert.equal(UI_THEME_TOKENS.length, 35);
  assert.equal(new Set(keys).size, keys.length, "논리 키가 겹친다");
  assert.equal(new Set(cssVars).size, cssVars.length, "CSS 변수 이름이 겹친다");

  // 변수 이름은 반드시 `--`로 시작한다. 조립하지 않고 상수로 적는 규칙이
  // 지켜지고 있는지 여기서 한 번 확인한다.
  for (const token of UI_THEME_TOKENS) {
    assert.ok(token.cssVar.startsWith("--"), `${token.key}의 변수 이름이 CSS 변수 모양이 아니다`);
    assert.ok(token.label.length > 0, `${token.key}의 이름이 비어 있다`);
    assert.ok(token.usage.length > 0, `${token.key}의 쓰임 설명이 비어 있다`);
  }
});

test("모든 기본값이 자기 검증기를 통과한다", () => {
  // 기본값이 검증기를 못 넘으면 "전부 기본값으로" 단추가 서버에 거절당한다.
  // 정규화 결과가 기본값과 **글자까지 같아야** 한다 — 다르면 기본값으로
  // 되돌렸는데도 오버라이드 행이 남는다.
  for (const token of UI_THEME_TOKENS) {
    assert.equal(
      normalizeUiThemeValue(token, token.defaultLight),
      token.defaultLight,
      `${token.key}의 라이트 기본값이 검증을 통과하지 못하거나 정규화되면서 달라진다`
    );
    assert.equal(
      normalizeUiThemeValue(token, token.defaultDark),
      token.defaultDark,
      `${token.key}의 다크 기본값이 검증을 통과하지 못하거나 정규화되면서 달라진다`
    );
  }
});

test("기본값 조합이 저장 거절선(3:1)을 라이트·다크 양쪽에서 넘긴다", () => {
  const resolved = resolveUiTheme(NO_UI_THEME_OVERRIDES);

  assert.ok(UI_THEME_CONTRAST_BLOCKING.length > 0, "저장을 막는 짝이 하나도 없다");
  assert.ok(
    UI_THEME_CONTRAST_BLOCKING.some((pair) => pair.scope === "light"),
    "라이트를 막는 짝이 없다"
  );
  assert.ok(
    UI_THEME_CONTRAST_BLOCKING.some((pair) => pair.scope === "dark"),
    "다크를 막는 짝이 없다"
  );

  // 막는 짝은 반드시 전체 짝 목록의 부분집합이어야 한다 — 두 벌로 갈라지면
  // 화면 경고와 서버 거절이 서로 다른 조합을 보게 된다.
  for (const pair of UI_THEME_CONTRAST_BLOCKING) {
    assert.ok(UI_THEME_CONTRAST_PAIRS.includes(pair), `${pair.label}이 전체 짝 목록에 없다`);
  }

  // 요구는 막는 짝뿐이지만, 실제로는 등록된 짝 **전부**가 하한을 넘는다.
  // 여기서 함께 못 박아 둔다 — 기본 팔레트를 손대다 하한 아래로 내려가면
  // 그 자리에서 알아야 한다.
  for (const pair of UI_THEME_CONTRAST_PAIRS) {
    const scope = resolved[pair.scope];
    const ratio = contrastRatio(scope[pair.fgKey], scope[pair.bgKey]);
    assert.ok(
      ratio >= UI_THEME_CONTRAST_FLOOR,
      `${pair.label}의 기본 대비가 저장 거절선 아래다: ${ratio}`
    );
  }

  assert.ok(UI_THEME_CONTRAST_FLOOR < UI_THEME_CONTRAST_WARN, "거절선이 경고선보다 높다");
});

test("라이트/다크를 나누지 않는 토큰은 두 기본값이 같다", () => {
  for (const token of UI_THEME_TOKENS) {
    if (token.scoped) continue;
    assert.equal(
      token.defaultLight,
      token.defaultDark,
      `${token.key}는 스코프를 나누지 않는데 기본값이 둘로 갈라져 있다`
    );
  }

  // 모서리·글자 크기는 전부 나누지 않고, 색은 전부 나눈다.
  for (const token of UI_THEME_TOKENS) {
    if (token.kind === "color") assert.equal(token.scoped, true, `${token.key}는 색인데 나뉘지 않는다`);
    else assert.equal(token.scoped, false, `${token.key}는 색이 아닌데 나뉘어 있다`);
  }
});

test("색 토큰의 기본값은 전부 소문자 hex 여섯 자리다", () => {
  for (const token of UI_THEME_TOKENS) {
    if (token.kind !== "color") continue;
    assert.match(token.defaultLight, /^#[0-9a-f]{6}$/, `${token.key}의 라이트 기본값 표기가 다르다`);
    assert.match(token.defaultDark, /^#[0-9a-f]{6}$/, `${token.key}의 다크 기본값 표기가 다르다`);
  }
});

// ───────────────────────────────────────────────────────── 검증기

test("색은 hex 여섯 자리만 받고 대문자는 소문자로 눕힌다", () => {
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "#ffffff"), "#ffffff");
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "#FFFFFF"), "#ffffff");
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "#AbCdEf"), "#abcdef");

  // 축약형·알파·이름·함수는 전부 거절한다. 함수를 하나라도 열어 주면
  // 괄호가 들어오고, 괄호가 들어오면 값이 규칙을 탈출할 길이 생긴다.
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "#fff"), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "#00000080"), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "red"), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "var(--x)"), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "url(#a)"), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "oklch(0.5 0.1 20)"), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "color-mix(in srgb, red, blue)"), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "ffffff"), null);

  // 규칙 탈출 시도. 여기가 뚫리면 <head>에 심는 <style> 안에서 새 선택자가
  // 열린다.
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "#000;}"), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "#000000;}body{display:none}"), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "#000000</style>"), null);

  // 문자열이 아닌 것과 빈 문자열.
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, ""), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, "   "), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, 0), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, 16777215), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, null), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, undefined), null);
  assert.equal(normalizeUiThemeValue(COLOR_TOKEN, { hex: "#ffffff" }), null);
});

test("모서리는 rem·px과 0만 받고 상·하한 밖은 거절한다", () => {
  // 경계 바로 안.
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "0"), "0");
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "2rem"), "2rem");
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "32px"), "32px");
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "0.375rem"), "0.375rem");
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "6px"), "6px");

  // 같은 값의 다른 표기는 한 벌로 눕힌다 — 색의 대소문자와 같은 이유다.
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, ".5rem"), "0.5rem");
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "0.500rem"), "0.5rem");
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "0px"), "0");
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, " 0.5rem "), "0.5rem");

  // 경계 바로 밖.
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "2.01rem"), null);
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "33px"), null);
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "-1px"), null);
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "-0.5rem"), null);

  // 단위 없는 값은 0 말고 전부 거절한다. CSS에서 단위를 생략할 수 있는 길이는
  // 0뿐이고, 그 밖의 맨숫자는 무시되어 값이 조용히 사라진다.
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "1"), null);
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "0.5"), null);

  // 함수·백분율·단위 혼합은 거절한다.
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "calc(1rem)"), null);
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "50%"), null);
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "1em"), null);
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "1rem 2rem"), null);
  assert.equal(normalizeUiThemeValue(RADIUS_TOKEN, "#ffffff"), null);
});

test("글자 크기는 rem만 받고 상·하한 밖은 거절한다", () => {
  // 경계 바로 안.
  assert.equal(normalizeUiThemeValue(FONT_SIZE_TOKEN, "0.625rem"), "0.625rem");
  assert.equal(normalizeUiThemeValue(FONT_SIZE_TOKEN, "1.5rem"), "1.5rem");
  assert.equal(normalizeUiThemeValue(FONT_SIZE_TOKEN, "0.9375rem"), "0.9375rem");

  // 경계 바로 밖.
  assert.equal(normalizeUiThemeValue(FONT_SIZE_TOKEN, "0.624rem"), null);
  assert.equal(normalizeUiThemeValue(FONT_SIZE_TOKEN, "1.501rem"), null);
  assert.equal(normalizeUiThemeValue(FONT_SIZE_TOKEN, "0"), null);
  assert.equal(normalizeUiThemeValue(FONT_SIZE_TOKEN, "3rem"), null);

  // px을 받지 않는다 — 글자 크기를 px로 못 박으면 브라우저의 글자 확대 설정이
  // 통하지 않는다.
  assert.equal(normalizeUiThemeValue(FONT_SIZE_TOKEN, "12px"), null);
  assert.equal(normalizeUiThemeValue(FONT_SIZE_TOKEN, "14px"), null);

  assert.equal(normalizeUiThemeValue(FONT_SIZE_TOKEN, "1"), null);
  assert.equal(normalizeUiThemeValue(FONT_SIZE_TOKEN, "calc(1rem)"), null);
  assert.equal(normalizeUiThemeValue(FONT_SIZE_TOKEN, "larger"), null);
});

// ───────────────────────────────────────────────────────── 대비

test("대비비가 WCAG 정의대로 나온다", () => {
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  assert.equal(contrastRatio("#3f3f46", "#3f3f46"), 1);

  // 순서를 바꿔도 같은 값이다 — 밝은 쪽이 분자에 오도록 안에서 정렬한다.
  assert.equal(contrastRatio("#18181b", "#fafafa"), contrastRatio("#fafafa", "#18181b"));
  assert.equal(contrastRatio("#bf000f", "#fef2f2"), contrastRatio("#fef2f2", "#bf000f"));

  // 대문자로 넣어도 같은 색이다.
  assert.equal(contrastRatio("#FFFFFF", "#000000"), 21);

  // hex 여섯 자리가 아닌 것은 판정할 대상이 아니라 버그다.
  assert.throws(() => contrastRatio("#fff", "#000000"));
  assert.throws(() => contrastRatio("var(--x)", "#000000"));
});

// ───────────────────────────────────────────────────────── 병합

test("저장된 행이 없으면 기본값 그대로다", () => {
  const resolved = resolveUiTheme(NO_UI_THEME_OVERRIDES);
  for (const token of UI_THEME_TOKENS) {
    assert.equal(resolved.light[token.key], token.defaultLight, `${token.key} 라이트`);
    assert.equal(resolved.dark[token.key], token.defaultDark, `${token.key} 다크`);
  }
  assert.deepEqual(resolveUiTheme([]), resolved);
});

test("저장된 행만 덮어쓰고 라이트가 다크로 새지 않는다", () => {
  const resolved = resolveUiTheme([
    { tokenKey: "zinc-900", scope: "light", value: "#111111" },
    { tokenKey: "radius-md", scope: "both", value: "0.5rem" },
  ]);

  assert.equal(resolved.light["zinc-900"], "#111111");
  // 여기가 이 시험의 핵심이다 — 라이트만 바꿨는데 다크까지 따라 바뀌면,
  // 관리자는 라이트를 손볼 때마다 다크를 모르게 망가뜨린다.
  assert.equal(resolved.dark["zinc-900"], tokenByKey("zinc-900").defaultDark);

  // 반대 방향도 같다.
  const darkOnly = resolveUiTheme([{ tokenKey: "background", scope: "dark", value: "#101010" }]);
  assert.equal(darkOnly.dark["background"], "#101010");
  assert.equal(darkOnly.light["background"], tokenByKey("background").defaultLight);

  // 스코프를 나누지 않는 토큰은 both 하나가 양쪽에 간다.
  assert.equal(resolved.light["radius-md"], "0.5rem");
  assert.equal(resolved.dark["radius-md"], "0.5rem");

  // 손대지 않은 토큰은 기본값 그대로다.
  assert.equal(resolved.light["zinc-50"], tokenByKey("zinc-50").defaultLight);
  assert.equal(resolved.light["text-sm"], tokenByKey("text-sm").defaultLight);

  // 값은 얹히면서 정규화된다 — 대문자로 저장된 옛 행도 같은 색으로 읽힌다.
  const uppercased = resolveUiTheme([{ tokenKey: "zinc-900", scope: "light", value: "#ABCDEF" }]);
  assert.equal(uppercased.light["zinc-900"], "#abcdef");
});

test("등록부에 없는 키와 맞지 않는 스코프는 예외 없이 무시된다", () => {
  // 토큰을 등록부에서 빼는 날 옛 행이 DB에 남아 있어도 화면이 떠야 한다.
  const resolved = resolveUiTheme([
    { tokenKey: "nope-999", scope: "light", value: "#111111" },
    { tokenKey: "--color-zinc-900", scope: "light", value: "#111111" },
    { tokenKey: "", scope: "both", value: "#111111" },
    // 스코프를 나누는 토큰에 "both"가 오면 어느 쪽으로도 짐작하지 않는다.
    { tokenKey: "zinc-900", scope: "both", value: "#222222" },
    // 나누지 않는 토큰에 "light"가 와도 마찬가지다.
    { tokenKey: "radius-md", scope: "light", value: "1rem" },
    // 검증을 통과 못 하는 값도 버린다.
    { tokenKey: "zinc-800", scope: "light", value: "oklch(0.2 0 0)" },
  ]);

  assert.equal(resolved.light["zinc-900"], tokenByKey("zinc-900").defaultLight);
  assert.equal(resolved.dark["zinc-900"], tokenByKey("zinc-900").defaultDark);
  assert.equal(resolved.light["radius-md"], tokenByKey("radius-md").defaultLight);
  assert.equal(resolved.light["zinc-800"], tokenByKey("zinc-800").defaultLight);
  assert.equal(resolved.light["nope-999"], undefined);
  assert.equal(resolved.light["--color-zinc-900"], undefined);
});

// ───────────────────────────────────────────────────────── 직렬화

test("오버라이드가 없으면 심을 CSS가 아예 없다", () => {
  assert.equal(serializeUiThemeCss(NO_UI_THEME_OVERRIDES), "");
  assert.equal(serializeUiThemeCss([]), "");
});

test("라이트 블록 선택자에 :not(.dark)가 있다", () => {
  // 이 한 조각이 빠지면 라이트 오버라이드가 다크를 이겨 버려서, 다크 모드에서
  // 배경이 흰색이 된다. 라이트로만 보는 사람에게는 영영 안 보이는 고장이다.
  const css = serializeUiThemeCss([{ tokenKey: "background", scope: "light", value: "#f0f0f0" }]);
  assert.ok(css.includes(":root:root:not(.dark){"), `라이트 블록 선택자가 다르다: ${css}`);
  assert.ok(!css.includes(":root:root{"), "라이트 오버라이드가 공용 블록으로 새어 나왔다");

  const both = serializeUiThemeCss([
    { tokenKey: "zinc-900", scope: "light", value: "#111111" },
    { tokenKey: "background", scope: "light", value: "#f0f0f0" },
    { tokenKey: "zinc-900", scope: "dark", value: "#000000" },
    { tokenKey: "radius-md", scope: "both", value: "0.5rem" },
    { tokenKey: "text-sm", scope: "both", value: "0.9375rem" },
  ]);
  assert.equal(
    both,
    ":root:root:not(.dark){--color-zinc-900:#111111;--background:#f0f0f0}\n" +
      ":root:root.dark{--color-zinc-900:#000000}\n" +
      ":root:root{--radius-md:0.5rem;--text-sm:0.9375rem}"
  );

  // 다크 블록과 라이트 블록은 명시도가 같아야 순서 다툼이 없다. 둘 다 클래스
  // 세 자리(:root:root + .dark / :not(.dark))다.
  assert.ok(both.includes(":root:root.dark{"), "다크 블록 선택자가 다르다");
});

test("스코프를 나누지 않는 토큰은 공용 블록에만 나온다", () => {
  const css = serializeUiThemeCss([
    { tokenKey: "radius-md", scope: "both", value: "0.5rem" },
    { tokenKey: "text-sm", scope: "both", value: "1rem" },
  ]);

  assert.ok(css.startsWith(":root:root{"), `공용 블록만 있어야 한다: ${css}`);
  assert.ok(!css.includes(":not(.dark)"), "모서리·글자 크기에 라이트 전용 선택자가 붙었다");
  assert.ok(!css.includes(".dark{"), "모서리·글자 크기에 다크 전용 선택자가 붙었다");
  assert.ok(css.includes("--radius-md:0.5rem"));
  assert.ok(css.includes("--text-sm:1rem"));
});

test("등록부에 없는 키는 출력에 나타나지 않는다", () => {
  // 변수 이름은 저장된 키로 조립하지 않고 등록부 상수를 쓴다. 그래서 DB에 무엇이
  // 들어 있든 선택자 안으로 흘러들 수 없다.
  const css = serializeUiThemeCss([
    { tokenKey: "nope-999", scope: "light", value: "#111111" },
    { tokenKey: "zinc-900;}html{display:none", scope: "light", value: "#111111" },
    { tokenKey: "zinc-900", scope: "light", value: "#111111" },
  ]);

  assert.equal(css, ":root:root:not(.dark){--color-zinc-900:#111111}");
  assert.ok(!css.includes("nope-999"));
  assert.ok(!css.includes("html"));
});

test("검증을 통과하지 못하는 값은 출력에 나타나지 않는다", () => {
  // 저장 경로가 뚫려도 출력 경로가 한 번 더 막는다는 것이 이 시험의 요점이다.
  const css = serializeUiThemeCss([
    { tokenKey: "zinc-900", scope: "light", value: "#000;}body{display:none}" },
    { tokenKey: "zinc-800", scope: "light", value: "var(--evil)" },
    { tokenKey: "background", scope: "dark", value: "#fff" },
    { tokenKey: "radius-md", scope: "both", value: "calc(100vw)" },
    { tokenKey: "text-sm", scope: "both", value: "99rem" },
  ]);

  assert.equal(css, "", `아무것도 나오면 안 된다: ${css}`);
});

test("기본값과 같은 값은 출력에 나타나지 않는다", () => {
  const zinc900 = tokenByKey("zinc-900");
  const radiusMd = tokenByKey("radius-md");

  // 기본값과 같은 값이 그대로 실리면, 나중에 기본 팔레트를 손볼 때 옛 기본값이
  // 오버라이드로 굳어 아무 화면도 따라 바뀌지 않는다.
  assert.equal(
    serializeUiThemeCss([
      { tokenKey: "zinc-900", scope: "light", value: zinc900.defaultLight },
      { tokenKey: "zinc-900", scope: "dark", value: zinc900.defaultDark },
      { tokenKey: "radius-md", scope: "both", value: radiusMd.defaultLight },
    ]),
    ""
  );

  // 표기만 다른 같은 값도 마찬가지다 — 정규화가 먼저 눕히기 때문이다.
  assert.equal(
    serializeUiThemeCss([
      { tokenKey: "zinc-900", scope: "light", value: zinc900.defaultLight.toUpperCase() },
      { tokenKey: "radius-md", scope: "both", value: ".375rem" },
    ]),
    ""
  );

  // 한쪽만 기본값이면 그쪽만 빠진다.
  assert.equal(
    serializeUiThemeCss([
      { tokenKey: "zinc-900", scope: "light", value: zinc900.defaultLight },
      { tokenKey: "zinc-900", scope: "dark", value: "#000000" },
    ]),
    ":root:root.dark{--color-zinc-900:#000000}"
  );
});

test("출력 어디에도 규칙을 탈출하는 글자가 없다", () => {
  const css = serializeUiThemeCss([
    { tokenKey: "zinc-900", scope: "light", value: "#111111" },
    { tokenKey: "background", scope: "light", value: "#F0F0F0" },
    { tokenKey: "foreground", scope: "dark", value: "#EEEEEE" },
    { tokenKey: "radius-2xl", scope: "both", value: "0" },
    { tokenKey: "text-2xl", scope: "both", value: "1.25rem" },
    // 아래 셋은 전부 버려져야 한다.
    { tokenKey: "zinc-800", scope: "light", value: "#000000</style><script>alert(1)</script>" },
    { tokenKey: "</style>", scope: "light", value: "#000000" },
    { tokenKey: "zinc-700", scope: "light", value: "#000000;}*{color:red}" },
  ]);

  assert.ok(!css.includes("<"), `꺾쇠가 출력에 있다: ${css}`);
  assert.ok(!css.includes(">"), `꺾쇠가 출력에 있다: ${css}`);
  assert.ok(!css.includes("</style>"));
  assert.ok(!css.includes(";}"), `규칙을 닫는 자리에 세미콜론이 붙었다: ${css}`);
  assert.ok(!css.includes("!important"), "!important는 쓰지 않는다");
  assert.ok(!css.includes("script"));
  assert.ok(!css.includes("*{"));

  // 괄호는 라이트 블록의 `:not(.dark)` 한 자리에만 있어야 한다 — 값 쪽에
  // 함수가 들어오면 그 안에서 무엇이든 열 수 있다.
  assert.equal(css.split("(").length - 1, 1, `괄호가 :not(.dark) 말고 다른 데도 있다: ${css}`);
  assert.ok(!css.includes("url("));
  assert.ok(!css.includes("calc("));
  assert.ok(!css.includes("var("));

  // 실려야 할 것은 그대로 실렸다.
  assert.equal(
    css,
    ":root:root:not(.dark){--color-zinc-900:#111111;--background:#f0f0f0}\n" +
      ":root:root.dark{--foreground:#eeeeee}\n" +
      ":root:root{--radius-2xl:0;--text-2xl:1.25rem}"
  );
});

test("우회 판정은 정해진 값 하나만 받는다", () => {
  // 쿠키가 없는 상태가 기본이다 — 아무도 우회하고 있지 않다.
  assert.equal(isUiThemeBypassed(undefined), false);
  assert.equal(isUiThemeBypassed(""), false);

  assert.equal(isUiThemeBypassed(UI_THEME_BYPASS_VALUE), true);

  // 비슷하지만 다른 값은 우회가 아니다. 여기를 느슨하게 하면(예: truthy 판정)
  // 지우려고 빈 문자열을 구운 쿠키가 남았을 때 판정이 갈린다.
  assert.equal(isUiThemeBypassed("0"), false);
  assert.equal(isUiThemeBypassed("true"), false);
  assert.equal(isUiThemeBypassed(" 1"), false);
});

test("우회 쿠키 상수가 굽는 쪽과 보는 쪽에서 같은 것을 가리킨다", () => {
  // 이름이 어긋나면 우회가 조용히 안 걸리고, 그 증상은 정말 화면이 안 보이는
  // 순간에만 드러난다. 이름 자체를 시험이 못 박아 둔다.
  assert.equal(UI_THEME_BYPASS_COOKIE, "ui-theme-bypass");
  assert.equal(UI_THEME_BYPASS_VALUE, "1");

  // 하루. 세션 쿠키도 영구 쿠키도 아니어야 하는 이유는 상수 주석에 있다.
  assert.equal(UI_THEME_BYPASS_MAX_AGE_SECONDS, 24 * 60 * 60);
});
