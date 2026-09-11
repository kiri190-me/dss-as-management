import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  uiThemeTokenScreen,
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
  serializeUiThemeLifeboatCss,
  UI_THEME_LIFEBOAT_ID,
  type UiThemeToken,
  type UiThemeTokenScreen,
} from "./ui-theme-tokens";
import {
  remNumberOf,
  remTextOf,
  remValueFromText,
  WEEKLY_REPORT_BOX_TOKENS,
  WEEKLY_REPORT_FONT_TOKENS,
  WEEKLY_REPORT_OTHER_TOKENS,
  WEEKLY_REPORT_SIZE_TOKENS,
  weeklyReportPreviewStyle,
  weeklyReportSizeRange,
} from "../../components/settings/weekly-report-size-controls";

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

test("등록부의 키와 CSS 변수 이름이 전부 고유하고 개수가 61이다", () => {
  const keys = UI_THEME_TOKENS.map((token) => token.key);
  const cssVars = UI_THEME_TOKENS.map((token) => token.cssVar);

  // 앱 전체 46(색 35 · 모서리 5 · 글자 크기 6) + 주간보고 전용 15(글자 8 · 상자 7).
  assert.equal(UI_THEME_TOKENS.length, 61);
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

// ─────────────────────────────────────────────── 강조색(primary) 어긋남 방지

/**
 * 🔴 강조 램프의 기본값은 **두 곳**에 적혀 있다 — globals.css 의 `@theme` 블록과
 * 이 등록부다. 둘이 어긋나는 날은 반드시 오고, 그날의 증상은 "기본값으로
 * 되돌렸는데 색이 안 돌아옴"이다: 화면은 등록부를 기준으로 "기본값과 같으니
 * 저장할 것이 없다"고 판정해 오버라이드 행을 지우는데, 실제로 그려지는 값은
 * globals.css 가 정하기 때문이다. 눈으로는 원인을 찾을 수 없다.
 *
 * 그래서 시험이 CSS 파일을 직접 읽어 대조한다. 왜 한쪽을 지우고 한 곳에서만
 * 읽지 않는가 — globals.css 는 Tailwind 가 `.bg-primary-900` 유틸리티를 만드는
 * 근거이고(그 파일이 없으면 클래스 자체가 생기지 않는다), 등록부는 편집 화면과
 * 서버 검증이 보는 곳이다. 둘 다 필요하고, 그래서 대조가 필요하다.
 */
const GLOBALS_CSS = new URL("../../app/globals.css", import.meta.url);

/** globals.css 의 `@theme` 에 적힌 `--color-primary-*` 를 논리 키 → hex 로 읽는다. */
function primaryPaletteFromGlobalsCss(): Map<string, string> {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const found = new Map<string, string>();
  for (const match of css.matchAll(/--color-primary-(\d+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    found.set(`primary-${match[1]}`, match[2]);
  }
  return found;
}

const PRIMARY_TOKENS: readonly UiThemeToken[] = UI_THEME_TOKENS.filter((token) =>
  token.key.startsWith("primary-")
);

test("globals.css 의 강조 램프와 등록부의 기본값이 글자까지 같다", () => {
  const css = primaryPaletteFromGlobalsCss();

  assert.equal(PRIMARY_TOKENS.length, 11, "등록부의 강조 램프가 11단이 아니다");
  assert.equal(css.size, 11, `globals.css 의 강조 램프가 11단이 아니다: ${css.size}`);

  for (const token of PRIMARY_TOKENS) {
    assert.equal(
      css.get(token.key),
      token.defaultLight,
      `${token.key}가 globals.css 와 등록부에서 다르다`
    );
    // 램프는 한 벌이다 — 라이트/다크를 나눠 저장하되 기본값은 같은 색이다.
    assert.equal(token.defaultDark, token.defaultLight, `${token.key}의 기본값이 둘로 갈라져 있다`);
    assert.equal(token.cssVar, `--color-${token.key}`, `${token.key}의 변수 이름이 다르다`);
  }

  // 등록부에 없는 단계가 CSS 에만 있으면 그 색은 편집할 길이 없다.
  const registryKeys = new Set(PRIMARY_TOKENS.map((token) => token.key));
  for (const key of css.keys()) {
    assert.ok(registryKeys.has(key), `globals.css 의 ${key}가 등록부에 없다`);
  }
});

test("강조색 기본값이 같은 단계의 중립과 한 자도 다르지 않다", () => {
  // 🔴 이 판의 완료 조건이 「화면이 하나도 안 바뀌는 것」이었다는 기계적 증거다.
  // 주 버튼은 원래 `bg-zinc-900` 이었고, 이름만 `bg-primary-900` 으로 옮겼다.
  // 한 단계라도 값이 다르면 그 자리에서 화면이 바뀐 것이고, 그것은 갈아 끼우기가
  // 아니라 색을 고른 것이다 — 메인 컬러를 실제로 고르는 일은 다음 판이고, 그때
  // 이 시험이 먼저 걸려 "지금 무엇을 바꾸는 중인지"를 알려 준다.
  for (const token of PRIMARY_TOKENS) {
    const step = token.key.slice("primary-".length);
    const zinc = tokenByKey(`zinc-${step}`);
    assert.equal(token.defaultLight, zinc.defaultLight, `primary-${step} 라이트가 중립과 다르다`);
    assert.equal(token.defaultDark, zinc.defaultDark, `primary-${step} 다크가 중립과 다르다`);
  }
});

test("주 버튼의 흰 글자가 강조색 위에서 읽힌다", () => {
  // 주 버튼은 `bg-primary-900 text-white` 다. 글자색은 이 축이 여는 값이 아니라
  // 못 박힌 흰색이므로, 바닥이 밝아지는 만큼 그대로 안 보이게 된다 — 다음 판에서
  // 메인 컬러를 고르게 되면 실제로 밟는 함정이다. 그 방어의 바닥을 여기 깔아 둔다.
  //
  // 🔴 다크 쪽은 짝이 다르다: `dark:bg-primary-50 dark:text-zinc-900` 이라 바탕은
  // 강조 램프인데 글자는 중립 램프다. 두 램프가 갈라지는 날 그 짝도 함께 봐야
  // 한다 — 지금은 두 값이 같아서 문제가 드러나지 않는다.
  const ratio = contrastRatio("#ffffff", tokenByKey("primary-900").defaultLight);
  assert.ok(
    ratio >= UI_THEME_CONTRAST_WARN,
    `주 버튼의 흰 글자가 경고선 아래다: ${ratio} < ${UI_THEME_CONTRAST_WARN}`
  );
});

// ─────────────────────────────────────────────── 주간보고 전용 토큰

/**
 * 주간보고 전용 글자·상자 크기(`--text-wr-*` · `--spacing-wr-*`)도 강조 램프처럼
 * 기본값이 **두 곳**에 적혀 있다 — globals.css 의 `@theme` 과 이 등록부. 어긋나면
 * 「기본값으로 되돌렸는데 크기가 안 돌아옴」이 되고, 원인이 화면에 안 보인다
 * (위 강조 램프 대조의 머리말과 같은 사정). 그래서 여기서도 파일을 읽어 대조한다.
 */
const WEEKLY_REPORT_TOKENS: readonly UiThemeToken[] = UI_THEME_TOKENS.filter(
  (token) => token.area === "weeklyReport"
);

/**
 * globals.css 의 주간보고 전용 변수를 이름 → 값으로 읽는다. 줄 높이 짝
 * (`--text-wr-*--line-height`)은 등록부가 다루지 않는 값이라 뺀다. 주석을 먼저
 * 걷는다 — 그 블록의 머리말이 변수 이름을 설명으로 적고 있다.
 */
function weeklyReportSizesFromGlobalsCss(): Map<string, string> {
  const css = readFileSync(GLOBALS_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Map<string, string>();
  for (const match of css.matchAll(/(--(?:text|spacing)-wr-[a-z-]+)\s*:\s*([^;]+);/g)) {
    if (match[1].endsWith("--line-height")) continue;
    assert.ok(!found.has(match[1]), `globals.css 에 ${match[1]}가 두 번 적혀 있다`);
    found.set(match[1], match[2].trim());
  }
  return found;
}

test("globals.css 의 주간보고 크기 15개와 등록부의 기본값이 글자까지 같다", () => {
  const css = weeklyReportSizesFromGlobalsCss();

  assert.equal(WEEKLY_REPORT_TOKENS.length, 15, "등록부의 주간보고 토큰이 15개가 아니다");
  assert.equal(css.size, 15, `globals.css 의 주간보고 크기 변수가 15개가 아니다: ${css.size}`);

  for (const token of WEEKLY_REPORT_TOKENS) {
    assert.equal(
      css.get(token.cssVar),
      token.defaultLight,
      `${token.key}가 globals.css 와 등록부에서 다르다`
    );
    assert.equal(token.defaultDark, token.defaultLight, `${token.key}의 기본값이 둘로 갈라져 있다`);
  }

  // CSS 에만 있는 변수는 편집할 길이 없다.
  const registryVars = new Set(WEEKLY_REPORT_TOKENS.map((token) => token.cssVar));
  for (const cssVar of css.keys()) {
    assert.ok(registryVars.has(cssVar), `globals.css 의 ${cssVar}가 등록부에 없다`);
  }
});

test("주간보고 토큰의 모양 — 키는 변수 이름에서 -- 를 뗀 것, 글자 8 · 상자 7, 공용 스코프", () => {
  for (const token of WEEKLY_REPORT_TOKENS) {
    assert.equal(token.cssVar, `--${token.key}`, `${token.key}의 변수 이름이 키와 짝이 아니다`);
    assert.equal(token.scoped, false, `${token.key}가 라이트/다크로 나뉘어 있다`);
    if (token.key.startsWith("text-wr-")) {
      assert.equal(token.kind, "fontSize", `${token.key}는 글자 크기 종류여야 한다`);
    } else if (token.key.startsWith("spacing-wr-")) {
      assert.equal(token.kind, "spacing", `${token.key}는 상자 크기 종류여야 한다`);
    } else {
      assert.fail(`${token.key}는 주간보고 전용 변수 이름 모양이 아니다`);
    }
  }
  assert.equal(WEEKLY_REPORT_TOKENS.filter((token) => token.kind === "fontSize").length, 8);
  assert.equal(WEEKLY_REPORT_TOKENS.filter((token) => token.kind === "spacing").length, 7);

  // 반대 방향 — 주간보고 변수 이름인데 표시가 빠진 토큰이 있으면 「모서리 · 글자
  // 크기」 화면이 그 값을 자기 몫으로 센다.
  for (const token of UI_THEME_TOKENS) {
    if (/^--(?:text|spacing)-wr-/.test(token.cssVar)) {
      assert.equal(token.area, "weeklyReport", `${token.key}에 주간보고 표시가 없다`);
    }
  }
});

test("상자 크기(spacing)는 주간보고 전용이고 전부 범위가 있다 — 범위는 그 종류에만 있다", () => {
  const spacing = UI_THEME_TOKENS.filter((token) => token.kind === "spacing");
  assert.equal(spacing.length, 7);

  for (const token of UI_THEME_TOKENS) {
    if (token.kind === "spacing") {
      // 🔴 앱 전체 여백은 열지 않는다(HANDOFF Y11-5 결정 2) — 배율 하나라 건드리면
      // 모든 화면의 배치가 한꺼번에 움직인다.
      assert.equal(token.area, "weeklyReport", `${token.key}는 앱 전체 여백이다 — 열지 않기로 했다`);
      assert.ok(token.rangeRem, `${token.key}에 범위가 없다`);
      assert.ok(
        token.rangeRem.min >= 0 && token.rangeRem.min < token.rangeRem.max,
        `${token.key}의 범위가 이상하다: ${JSON.stringify(token.rangeRem)}`
      );
    } else {
      // 다른 종류는 종류 공통 범위를 쓴다. 여기 적힌 값은 읽히지 않는다.
      assert.equal(token.rangeRem, undefined, `${token.key}에 읽히지 않는 범위가 적혀 있다`);
    }
  }

  // 범위 표 자체를 못 박는다 — 넓히는 것도 좁히는 것도 여기서 한 번 걸린다.
  assert.deepEqual(Object.fromEntries(spacing.map((token) => [token.key, token.rangeRem])), {
    "spacing-wr-block": { min: 0, max: 2 },
    "spacing-wr-section": { min: 0, max: 2 },
    "spacing-wr-block-gap": { min: 0, max: 2 },
    "spacing-wr-cell-x": { min: 0, max: 1 },
    "spacing-wr-cell-y": { min: 0, max: 1 },
    "spacing-wr-table-min": { min: 0, max: 20 },
    "spacing-wr-box-min": { min: 0, max: 16 },
  });
});

test("화면 가르기 — 등록부를 남김없이 셋으로 가르고, 주간보고 토큰은 모서리·글자 크기 화면에 없다", () => {
  const byScreen: Record<UiThemeTokenScreen, string[]> = {
    colors: [],
    shapes: [],
    weeklyReport: [],
  };
  for (const token of UI_THEME_TOKENS) byScreen[uiThemeTokenScreen(token)].push(token.key);

  assert.equal(byScreen.colors.length, 35);
  assert.equal(byScreen.weeklyReport.length, 15);
  assert.equal(
    byScreen.colors.length + byScreen.shapes.length + byScreen.weeklyReport.length,
    UI_THEME_TOKENS.length,
    "어느 화면에도 안 걸리는 토큰이 있다"
  );

  // 🔴 「모서리 · 글자 크기」 화면은 앱 전체 모서리 5 · 글자 크기 6 뿐이다. 여기에
  // 주간보고 글자 크기가 섞이면 그 화면의 「이 화면 전부 기본값으로」가 주간보고
  // 값까지 지운다.
  assert.deepEqual(byScreen.shapes, [
    "radius-sm",
    "radius-md",
    "radius-lg",
    "radius-xl",
    "radius-2xl",
    "text-xs",
    "text-sm",
    "text-base",
    "text-lg",
    "text-xl",
    "text-2xl",
  ]);

  for (const token of UI_THEME_TOKENS) {
    const screen = uiThemeTokenScreen(token);
    if (token.area === "weeklyReport") assert.equal(screen, "weeklyReport", token.key);
    else if (token.kind === "color") assert.equal(screen, "colors", token.key);
    else assert.equal(screen, "shapes", token.key);
  }
});

/**
 * 앱 전체용 편집 화면과 개발자 모드 목차가 자기 몫을 uiThemeTokenScreen 으로
 * 가르는지 원본을 읽어 확인한다. 편집기 컴포넌트에는 시험 파일이 없고(렌더 시험
 * 목록에 없다), 이 가르기가 틀리면 증상이 「보이지 않는 값이 지워진다」라서
 * 눈으로도 못 잡는다. 주석은 걷고 본다 — 주석이 옛 조건을 설명으로 적고 있다.
 */
function readSourceWithoutComments(url: URL): string {
  return readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("편집기와 목차는 종류(kind)가 아니라 uiThemeTokenScreen 으로 자기 몫을 가른다", () => {
  const files = {
    editor: new URL("../../components/settings/ThemeTokenEditor.tsx", import.meta.url),
    index: new URL("../../app/(app)/settings/developer/page.tsx", import.meta.url),
  };
  for (const [name, url] of Object.entries(files)) {
    const source = readSourceWithoutComments(url);
    assert.match(source, /uiThemeTokenScreen\(/, `${name}가 uiThemeTokenScreen 을 쓰지 않는다`);
    // `kind === "color"` / `kind !== "color"` 는 색이 아닌 **모든** 것(주간보고
    // 크기까지)을 한 화면 몫으로 만든다 — 이 조건이 돌아오면 여기서 걸린다.
    assert.doesNotMatch(
      source,
      /kind\s*[!=]==\s*"color"/,
      `${name}가 색 여부만으로 화면 몫을 가른다`
    );
  }
});

// ─────────────────────────────── 개발자 모드 [주간보고] 편집 화면

/**
 * 주간보고 편집 화면은 색·모서리 화면과 같은 편집기(ThemeTokenEditor)에
 * `group="weeklyReport"` 로 그려진다. 슬라이더의 양 끝·눈금과 미리보기 style 은
 * React 없는 도우미(components/settings/weekly-report-size-controls.ts)가 정해서
 * 여기서 직접 부르고, 편집기·페이지·목차는 원본을 읽어 확인한다(편집기에는 렌더
 * 시험이 없다 — 서버 액션을 불러오는 클라이언트 컴포넌트라서).
 */
const THEME_TOKEN_EDITOR_FILE = new URL(
  "../../components/settings/ThemeTokenEditor.tsx",
  import.meta.url
);
const DEVELOPER_INDEX_FILE = new URL("../../app/(app)/settings/developer/page.tsx", import.meta.url);

/** 원본에서 함수 하나의 본문을 잘라 낸다(다음 최상위 function 앞까지). */
function sourceOfFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} 를 찾지 못했다`);
  const next = source.indexOf("\nfunction ", start + 1);
  return next < 0 ? source.slice(start) : source.slice(start, next);
}

test("주간보고 편집 화면이 그리는 토큰은 주간보고 몫 15개뿐이다 — 글자 8 · 상자 7, 그 밖 0", () => {
  assert.deepEqual(
    WEEKLY_REPORT_SIZE_TOKENS.map((token) => token.key),
    UI_THEME_TOKENS.filter((token) => uiThemeTokenScreen(token) === "weeklyReport").map((token) => token.key)
  );
  assert.equal(WEEKLY_REPORT_SIZE_TOKENS.length, 15);
  assert.equal(WEEKLY_REPORT_FONT_TOKENS.length, 8);
  assert.equal(WEEKLY_REPORT_BOX_TOKENS.length, 7);
  assert.equal(WEEKLY_REPORT_OTHER_TOKENS.length, 0);
  // 두 묶음이 겹치지 않고 합이 전부다 — 한 칸이 두 번 그려지거나 빠지지 않는다.
  assert.deepEqual(
    [...WEEKLY_REPORT_FONT_TOKENS, ...WEEKLY_REPORT_BOX_TOKENS].map((token) => token.key).sort(),
    WEEKLY_REPORT_SIZE_TOKENS.map((token) => token.key).sort()
  );
  // 전부 공용 스코프라 편집 칸도 정확히 15칸이다(편집기의 GROUP_SLOTS.weeklyReport).
  for (const token of WEEKLY_REPORT_SIZE_TOKENS) assert.equal(token.scoped, false, token.key);
  // 앱 전체 토큰은 한 칸도 섞이지 않는다.
  for (const token of WEEKLY_REPORT_SIZE_TOKENS) assert.equal(token.area, "weeklyReport", token.key);

  // 편집기가 실제로 그 목록을 그린다 — 칸을 GROUP_SLOTS.weeklyReport 에서 고르고,
  // 그 목록은 uiThemeTokenScreen 으로 갈린다.
  const editor = readSourceWithoutComments(THEME_TOKEN_EDITOR_FILE);
  assert.match(
    editor,
    /weeklyReport:\s*SLOTS\.filter\(\(slot\)\s*=>\s*uiThemeTokenScreen\(slot\.token\)\s*===\s*"weeklyReport"\)/,
    "GROUP_SLOTS 에 주간보고 몫이 uiThemeTokenScreen 으로 갈려 있지 않다"
  );
  const sliderGroup = sourceOfFunction(editor, "SizeSliderGroup");
  assert.match(sliderGroup, /GROUP_SLOTS\.weeklyReport\.filter\(/, "슬라이더가 저장 목록과 다른 곳에서 칸을 고른다");
  const layout = sourceOfFunction(editor, "WeeklyReportEditorLayout");
  assert.match(layout, /tokens=\{WEEKLY_REPORT_FONT_TOKENS\}/, "글자 묶음이 그려지지 않는다");
  assert.match(layout, /tokens=\{WEEKLY_REPORT_BOX_TOKENS\}/, "상자 묶음이 그려지지 않는다");
  // 🔴 앱 공용 견본은 주간보고 토큰을 하나도 읽지 않는다 — 여기서 그리면 슬라이더를
  // 움직여도 아무것도 안 바뀌는 견본이 된다.
  assert.doesNotMatch(layout, /ThemeTokenPreview/, "주간보고 화면이 앱 공용 견본을 그린다");
});

test("주간보고 슬라이더의 양 끝은 등록부 검증기의 범위와 같고, 기본값은 눈금 위에 있다", () => {
  for (const token of WEEKLY_REPORT_SIZE_TOKENS) {
    const range = weeklyReportSizeRange(token);
    assert.ok(range, `${token.key}의 슬라이더 범위가 없다`);
    const { min, max, step } = range;

    // 끝은 통과, 한 눈금 밖은 거절 — 슬라이더가 저장 못 할 값까지 가거나, 저장할 수
    // 있는 값에 못 닿는 일이 없다.
    assert.notEqual(normalizeUiThemeValue(token, remValueFromText(String(min))), null, `${token.key} 하한`);
    assert.notEqual(normalizeUiThemeValue(token, remValueFromText(String(max))), null, `${token.key} 상한`);
    assert.equal(normalizeUiThemeValue(token, remValueFromText(String(max + step))), null, `${token.key} 상한 밖`);
    if (min - step >= 0) {
      assert.equal(normalizeUiThemeValue(token, remValueFromText(String(min - step))), null, `${token.key} 하한 밖`);
    }
    if (token.kind === "spacing") assert.deepEqual({ min, max }, token.rangeRem, token.key);

    // 🔴 기본값이 눈금 위에 있어야 슬라이더로 기본값에 되돌아올 수 있다.
    const fallback = remNumberOf(token.defaultLight);
    assert.notEqual(fallback, null, `${token.key}의 기본값을 숫자로 못 읽는다`);
    const steps = (fallback! - min) / step;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `${token.key} 기본값 ${token.defaultLight}이 눈금 밖이다`);
    assert.ok(fallback! >= min && fallback! <= max, `${token.key} 기본값이 범위 밖이다`);

    // 슬라이더가 내보내는 모든 눈금이 저장되는 값이다.
    for (let value = min; value <= max + 1e-9; value += step) {
      const text = String(Math.round(value * 10000) / 10000);
      assert.notEqual(
        normalizeUiThemeValue(token, remValueFromText(text)),
        null,
        `${token.key}의 눈금 ${text}를 검증기가 거절한다`
      );
    }
  }
});

test("주간보고 숫자 칸은 원문을 그대로 들고, 비우면 형식 오류가 된다", () => {
  assert.equal(remNumberOf("0"), 0);
  assert.equal(remNumberOf("0.75rem"), 0.75);
  assert.equal(remNumberOf("12px"), null);
  assert.equal(remTextOf("0.75rem"), "0.75");
  assert.equal(remTextOf("0"), "0");
  // 치는 중인 글자가 사라지지 않는다 — 원문을 들고 있다.
  assert.equal(remTextOf(remValueFromText("1.")), "1.");
  assert.equal(remValueFromText("1.25"), "1.25rem");
  assert.equal(remValueFromText("  "), "");
  const token = tokenByKey("text-wr-title");
  assert.equal(normalizeUiThemeValue(token, remValueFromText("")), null, "빈 칸이 저장된다");
  assert.equal(normalizeUiThemeValue(token, remValueFromText("1.")), null, "치는 중인 값이 저장된다");
  // 0 은 검증기가 단위 없이 눕힌다(상자 크기).
  assert.equal(normalizeUiThemeValue(tokenByKey("spacing-wr-block"), remValueFromText("0")), "0");
});

test("미리보기 style 은 주간보고 CSS 변수 15개를 전부, 편집 중인 값으로 건다", () => {
  const values: Record<string, string> = {};
  for (const token of UI_THEME_TOKENS) values[token.key] = `값-${token.key}`;
  const style = weeklyReportPreviewStyle(values);
  assert.deepEqual(
    Object.keys(style).sort(),
    WEEKLY_REPORT_SIZE_TOKENS.map((token) => token.cssVar).sort(),
    "주간보고 변수가 아닌 것이 섞였거나 빠졌다"
  );
  for (const token of WEEKLY_REPORT_SIZE_TOKENS) {
    assert.equal(style[token.cssVar], `값-${token.key}`);
    assert.match(token.cssVar, /^--(?:text|spacing)-wr-/);
  }
});

test("🔴 미리보기 래퍼는 inert 이고 스크롤 상자가 아니다 — 편집 중인 값을 인라인 style 로 건다", () => {
  const editor = readSourceWithoutComments(THEME_TOKEN_EDITOR_FILE);
  const layout = sourceOfFunction(editor, "WeeklyReportEditorLayout");

  const wrapper = /<div\s[^>]*data-weekly-report-preview[^>]*>/.exec(layout)?.[0];
  assert.ok(wrapper, "미리보기 래퍼를 찾지 못했다");
  // 링크·단추가 편집 화면을 떠나지 않게. React 19 는 불리언 inert 를 inert="" 로 내보낸다.
  assert.match(wrapper, /\sinert(?:\s|=\{true\}|\/?>)/, "래퍼가 inert 가 아니다");
  // 편집 중인 값은 이 래퍼 자신에게 건다 — 구조선이 조상에서 내려 주는 기본값을 이긴다.
  assert.match(wrapper, /style=\{previewVars\}/, "래퍼가 편집 중인 값을 걸지 않는다");
  // 미리보기를 페이지 폭 그대로 두고, 높이를 주지 않는다(U-1 세로 스크롤바 두 개).
  assert.doesNotMatch(wrapper, /className=/, "래퍼에 클래스가 붙었다 — 여백·높이·overflow 는 금지다");
  assert.match(layout, /\{preview\}/, "넘겨받은 미리보기를 그리지 않는다");

  // 🔴 배치 전체에 스크롤 상자·확정 높이가 없다 — 붙어 있는 조절 칸(sticky)도
  // 스크롤 상자로 만들지 않는다.
  for (const className of layout.matchAll(/className="([^"]*)"/g)) {
    assert.doesNotMatch(
      className[1],
      /(?:^|\s)(?:[a-z0-9]+:)*(?:overflow-[a-z-]+|max-h-\S+|h-(?:\d|\[|full|screen|dvh|svh)\S*)/,
      `주간보고 편집 배치에 스크롤 상자·확정 높이 클래스가 있다: ${className[1]}`
    );
  }

  // 새 탭으로 여는 실제 주간보고 링크와, 저장하면 인쇄에도 반영된다는 안내.
  assert.match(layout, /href=\{WEEKLY_REPORT_HREF\}[\s\S]*?target="_blank"/);
  assert.match(editor, /const WEEKLY_REPORT_HREF = "\/dashboard\/weekly-report";/);
  assert.match(layout, /저장하면 전 직원의 주간보고 화면에 적용됩니다\. 브라우저 인쇄에도 반영됩니다\./);
});

test("목차의 [주간보고] 카드는 주간보고 몫만 센다 — 앱 전체 카드 둘의 셈은 그대로다", () => {
  const index = readSourceWithoutComments(DEVELOPER_INDEX_FILE);

  const countOf = (name: string) =>
    new RegExp(
      `const ${name} = countOverriddenSlots\\(\\s*savedThemeTokens,\\s*\\(token\\) => uiThemeTokenScreen\\(token\\) === "([a-zA-Z]+)"\\s*\\);`
    ).exec(index)?.[1];
  assert.equal(countOf("weeklyReportCount"), "weeklyReport", "주간보고 카드가 제 몫만 세지 않는다");
  assert.equal(countOf("colorCount"), "colors");
  assert.equal(countOf("shapeCount"), "shapes");

  const card = /<DeveloperMenuCard\s[^>]*href="\/settings\/developer\/weekly-report"[^>]*\/>/.exec(index)?.[0];
  assert.ok(card, "목차에 [주간보고] 카드가 없다");
  assert.match(card, /changedCount=\{weeklyReportCount\}/);
  assert.match(card, /title="주간보고"/);
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

test("주간보고 글자 크기도 같은 범위다 — 화면 제목 기본값이 그 안에 들고, 하한은 내리지 않는다", () => {
  const title = tokenByKey("text-wr-title");
  assert.equal(normalizeUiThemeValue(title, "1.25rem"), "1.25rem");
  assert.equal(normalizeUiThemeValue(title, "1.5rem"), "1.5rem");
  assert.equal(normalizeUiThemeValue(title, "1.501rem"), null);
  assert.equal(normalizeUiThemeValue(title, "20px"), null);

  // 기본값이 이미 하한(10px)인 자리 — 키울 수만 있다.
  const label = tokenByKey("text-wr-label");
  assert.equal(label.defaultLight, "0.625rem");
  assert.equal(normalizeUiThemeValue(label, "0.624rem"), null);
  assert.equal(normalizeUiThemeValue(label, "0.75rem"), "0.75rem");
});

test("🔴 상자 크기는 rem 과 0 만 받고, 범위는 항목마다 다르다 — 이 좁음이 곧 주입 차단이다", () => {
  const cellX = tokenByKey("spacing-wr-cell-x"); // 0 ~ 1rem
  const tableMin = tokenByKey("spacing-wr-table-min"); // 0 ~ 20rem

  // 경계 바로 안.
  assert.equal(normalizeUiThemeValue(cellX, "0"), "0");
  assert.equal(normalizeUiThemeValue(cellX, "1rem"), "1rem");
  assert.equal(normalizeUiThemeValue(tableMin, "20rem"), "20rem");
  assert.equal(normalizeUiThemeValue(tableMin, "12.5rem"), "12.5rem");

  // 같은 값의 다른 표기는 한 벌로 눕힌다 — 기본값으로 되돌렸는데 행이 남는 일을 막는다.
  assert.equal(normalizeUiThemeValue(cellX, "0rem"), "0");
  assert.equal(normalizeUiThemeValue(cellX, ".5rem"), "0.5rem");
  assert.equal(normalizeUiThemeValue(cellX, " 0.375rem "), "0.375rem");
  assert.equal(normalizeUiThemeValue(tableMin, "8.0rem"), "8rem");

  // 경계 바로 밖. 같은 1.01rem 이 표 칸 여백에서는 막히고 상세표 높이에서는 된다 —
  // 범위가 종류가 아니라 항목에 걸려 있다는 증거다.
  assert.equal(normalizeUiThemeValue(cellX, "1.01rem"), null);
  assert.equal(normalizeUiThemeValue(tableMin, "1.01rem"), "1.01rem");
  assert.equal(normalizeUiThemeValue(tableMin, "20.01rem"), null);
  assert.equal(normalizeUiThemeValue(cellX, "-0.25rem"), null);

  // px 는 받지 않는다(0px 도) — 글자를 키운 브라우저에서 상자만 그대로 남는다.
  assert.equal(normalizeUiThemeValue(cellX, "6px"), null);
  assert.equal(normalizeUiThemeValue(cellX, "0px"), null);
  assert.equal(normalizeUiThemeValue(tableMin, "128px"), null);

  // 단위 없는 맨숫자는 0 말고 전부 거절한다 — CSS 가 무시해 값이 조용히 사라진다.
  assert.equal(normalizeUiThemeValue(cellX, "1"), null);
  assert.equal(normalizeUiThemeValue(tableMin, "8"), null);

  // 함수·다른 단위·여러 값·키워드·색.
  for (const raw of [
    "calc(1rem)",
    "var(--spacing-wr-block)",
    "max(1rem, 2rem)",
    "1em",
    "10%",
    "1vh",
    "1rem 2rem",
    "auto",
    "#ffffff",
  ]) {
    assert.equal(normalizeUiThemeValue(tableMin, raw), null, `${raw} 가 통과했다`);
  }

  // 규칙 탈출 시도.
  for (const raw of ["0.5rem;}body{display:none}", "0.5rem</style>", "0.5rem !important", "0.5rem;"]) {
    assert.equal(normalizeUiThemeValue(tableMin, raw), null, `${raw} 가 통과했다`);
  }

  // 문자열이 아닌 것.
  for (const raw of [8, 0, null, undefined, { rem: 8 }]) {
    assert.equal(normalizeUiThemeValue(tableMin, raw), null, `${String(raw)} 가 통과했다`);
  }
});

test("범위가 적혀 있지 않은 상자 크기 토큰은 모든 값을 거절한다 — 여는 쪽이 아니라 닫는 쪽으로 틀린다", () => {
  const broken: UiThemeToken = { ...tokenByKey("spacing-wr-block"), rangeRem: undefined };
  assert.equal(normalizeUiThemeValue(broken, "0.5rem"), null);
  assert.equal(normalizeUiThemeValue(broken, "0"), null);
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

test("주간보고 크기는 공용 블록에 실리고, 앱 전체 글자 크기와 제 이름으로 갈린다", () => {
  const css = serializeUiThemeCss([
    { tokenKey: "text-sm", scope: "both", value: "1rem" },
    { tokenKey: "text-wr-body", scope: "both", value: ".875rem" },
    { tokenKey: "spacing-wr-table-min", scope: "both", value: "0rem" },
    // 아래 셋은 버려져야 한다.
    { tokenKey: "text-wr-title", scope: "light", value: "1.5rem" }, // 스코프가 안 맞는다
    { tokenKey: "spacing-wr-cell-x", scope: "both", value: "2rem" }, // 범위(1rem) 밖
    { tokenKey: "spacing-wr-block", scope: "both", value: "0.5rem;}body{display:none}" },
  ]);

  // 🔴 `:not(.dark)` 도 `.dark` 도 없는 공용 블록 하나다. 저장값이 globals.css 의
  // `@theme` 기본값(레이어 안)을 이기는 자리가 여기다.
  assert.equal(css, ":root:root{--text-sm:1rem;--text-wr-body:0.875rem;--spacing-wr-table-min:0}");

  // 주간보고 값만 바꾸면 앱 전체 글자 크기는 한 줄도 안 나온다.
  const weeklyOnly = serializeUiThemeCss([
    { tokenKey: "text-wr-body", scope: "both", value: "0.875rem" },
  ]);
  assert.equal(weeklyOnly, ":root:root{--text-wr-body:0.875rem}");

  // 기본값과 같은 값은 나오지 않는다.
  assert.equal(
    serializeUiThemeCss([
      { tokenKey: "text-wr-body", scope: "both", value: "0.75rem" },
      { tokenKey: "spacing-wr-table-min", scope: "both", value: "8.0rem" },
    ]),
    ""
  );
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

// ───────────────────────────────────────────────────── 구조선(lifeboat)

/** 구조선 CSS 에서 한 블록의 본문(`{…}` 안)을 꺼낸다. 없으면 null. */
function lifeboatBlockBody(css: string, selector: string): string | null {
  for (const block of css.split("\n")) {
    const brace = block.indexOf("{");
    if (brace === -1) continue;
    if (block.slice(0, brace) !== selector) continue;
    return block.slice(brace + 1, block.length - 1);
  }
  return null;
}

/** 블록 본문을 `--변수 → 값` 표로 바꾼다. */
function lifeboatDeclarations(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const declaration of body.split(";")) {
    const colon = declaration.indexOf(":");
    map.set(declaration.slice(0, colon), declaration.slice(colon + 1));
  }
  return map;
}

test("구조선 선택자는 페이지가 거는 id 하나에서 나온다", () => {
  // 이름이 어긋나면 구조선이 조용히 풀리고, 그 증상은 오버라이드로 화면이 안
  // 보이게 된 바로 그 순간에만 드러난다 — 그때는 고치러 들어갈 화면이 없다.
  assert.equal(UI_THEME_LIFEBOAT_ID, "ui-theme-lifeboat");

  const css = serializeUiThemeLifeboatCss();
  assert.ok(css.includes(`#${UI_THEME_LIFEBOAT_ID}{`), `라이트 블록 선택자가 다르다: ${css}`);
  assert.ok(css.includes(`.dark #${UI_THEME_LIFEBOAT_ID}{`), `다크 블록 선택자가 다르다: ${css}`);
});

test("등록부의 모든 토큰이 구조선 라이트 블록에 나온다", () => {
  // 하나라도 빠지면 그 값만 오버라이드를 뒤집어쓴다. 눈으로는 절대 못 찾는
  // 종류의 구멍이라 시험이 등록부 전체를 훑어 못 박는다.
  const body = lifeboatBlockBody(serializeUiThemeLifeboatCss(), `#${UI_THEME_LIFEBOAT_ID}`);
  assert.ok(body !== null, "라이트 블록이 없다");

  const declarations = lifeboatDeclarations(body);
  assert.equal(declarations.size, UI_THEME_TOKENS.length);
  for (const token of UI_THEME_TOKENS) {
    assert.equal(
      declarations.get(token.cssVar),
      token.defaultLight,
      `${token.key}의 라이트 기본값이 구조선에 없거나 다르다`
    );
  }
});

test("구조선이 주간보고 크기도 기본값으로 선언한다 — 라이트 블록에만", () => {
  // 개발자 모드 화면 안에는 주간보고가 없어 지금은 아무것도 바꾸지 않는다. 다음
  // 조각의 주간보고 미리보기는 인라인 style 로 이 선언을 이긴다(!important 가 없다).
  const css = serializeUiThemeLifeboatCss();
  const light = lifeboatBlockBody(css, `#${UI_THEME_LIFEBOAT_ID}`);
  const dark = lifeboatBlockBody(css, `.dark #${UI_THEME_LIFEBOAT_ID}`);
  assert.ok(light !== null && dark !== null);

  const lightDeclarations = lifeboatDeclarations(light);
  const darkDeclarations = lifeboatDeclarations(dark);
  for (const token of WEEKLY_REPORT_TOKENS) {
    assert.equal(lightDeclarations.get(token.cssVar), token.defaultLight, `${token.key}가 구조선에 없다`);
    assert.equal(darkDeclarations.has(token.cssVar), false, `${token.key}가 다크 블록에 있다`);
  }
});

test("구조선 다크 블록에는 scoped 토큰만, 다크 기본값으로 나온다", () => {
  const body = lifeboatBlockBody(serializeUiThemeLifeboatCss(), `.dark #${UI_THEME_LIFEBOAT_ID}`);
  assert.ok(body !== null, "다크 블록이 없다");

  const declarations = lifeboatDeclarations(body);
  const scoped = UI_THEME_TOKENS.filter((token) => token.scoped);
  assert.equal(declarations.size, scoped.length);
  for (const token of scoped) {
    assert.equal(
      declarations.get(token.cssVar),
      token.defaultDark,
      `${token.key}의 다크 기본값이 구조선에 없거나 다르다`
    );
  }

  // 모서리·글자 크기는 라이트/다크가 같은 값이라 여기 나올 것이 없다. 나오면
  // 같은 값을 두 곳에 적는 셈이고, 한쪽만 고쳐지는 길이 열린다.
  for (const token of UI_THEME_TOKENS) {
    if (token.scoped) continue;
    assert.equal(declarations.has(token.cssVar), false, `${token.key}가 다크 블록에 있다`);
  }
});

test("구조선의 다크 블록이 라이트 블록보다 강하고, 뒤에 온다", () => {
  // 순서(뒤)와 명시도(강함) 둘 다 다크 쪽이다. 하나만 맞아도 지금은 동작하지만,
  // 둘을 함께 못 박아 두면 나중에 어느 쪽을 건드려도 시험이 먼저 걸린다.
  const css = serializeUiThemeLifeboatCss();
  const lightAt = css.indexOf(`#${UI_THEME_LIFEBOAT_ID}{`);
  const darkAt = css.indexOf(`.dark #${UI_THEME_LIFEBOAT_ID}{`);
  assert.ok(lightAt < darkAt, `다크 블록이 라이트 블록보다 앞에 있다: ${css}`);

  // 다크 블록 선택자는 라이트 블록 선택자에 클래스 하나(.dark)를 더한 것이다 —
  // 같은 id 를 겨냥하므로 명시도가 (1,0,0) 대 (1,1,0)이 되어 다크가 이긴다.
  assert.equal(css.slice(darkAt).startsWith(`.dark #${UI_THEME_LIFEBOAT_ID}{`), true);
});

test("구조선 출력에 !important 도 규칙을 탈출하는 글자도 없다", () => {
  const css = serializeUiThemeLifeboatCss();

  // 🔴 !important 를 쓰면 미리보기가 인라인 style 로 같은 변수를 덮는 정당한
  // 길이 막힌다. 편집 중인 색을 견본에 걸 수 없게 되는 것이 이 한 단어의 값이다.
  assert.ok(!css.includes("!important"), "구조선에 !important 가 있다");

  assert.ok(!css.includes("<"), `꺾쇠가 출력에 있다: ${css}`);
  assert.ok(!css.includes(">"), `꺾쇠가 출력에 있다: ${css}`);
  assert.ok(!css.includes(";}"), `규칙을 닫는 자리에 세미콜론이 붙었다: ${css}`);
  assert.ok(!css.includes("("), "값 쪽에 함수가 들어왔다");
  assert.equal(css.split("{").length - 1, 2, "블록이 둘이 아니다");
  assert.equal(css.split("}").length - 1, 2, "블록이 둘이 아니다");
});

test("구조선 출력은 결정적이다", () => {
  // 등록부가 같으면 늘 같은 문자열이어야 한다 — 서버가 매 요청 찍어 내는 것이라
  // 순서가 흔들리면 HTML 이 요청마다 달라진다.
  assert.equal(serializeUiThemeLifeboatCss(), serializeUiThemeLifeboatCss());
});

test("구조선은 저장된 값을 전혀 보지 않는다", () => {
  // 인자가 없다는 것이 곧 이 성질이다. 그래도 오버라이드를 얹은 CSS 와 견주어
  // 두면, 나중에 누가 "저장된 값도 반영하자"고 고칠 때 시험이 먼저 걸린다.
  const overridden = serializeUiThemeCss([
    { tokenKey: "background", scope: "light", value: "#101010" },
    { tokenKey: "foreground", scope: "light", value: "#111111" },
  ]);
  assert.ok(overridden.includes("#101010"));

  const lifeboat = serializeUiThemeLifeboatCss();
  assert.ok(!lifeboat.includes("#101010"));
  assert.ok(!lifeboat.includes("#111111"));
  assert.ok(lifeboat.includes(`--background:${tokenByKey("background").defaultLight}`));
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
