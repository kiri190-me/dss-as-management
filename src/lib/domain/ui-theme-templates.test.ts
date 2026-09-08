import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contrastRatio,
  normalizeUiThemeValue,
  resolveUiTheme,
  UI_THEME_CONTRAST_BLOCKING,
  UI_THEME_CONTRAST_FLOOR,
  UI_THEME_CONTRAST_PAIRS,
  UI_THEME_CONTRAST_WARN,
  UI_THEME_TOKENS,
  type UiThemeOverrideRow,
  type UiThemeScope,
  type UiThemeToken,
} from "./ui-theme-tokens";
import {
  buildUiThemePrimaryRamp,
  findUiThemeMainColor,
  readUiThemePrimaryTint,
  uiThemePrimaryRampToChanges,
  uiThemeTintOf,
  type PrimaryRamp,
} from "./ui-theme-primary-ramp";
import {
  buildUiThemeTemplates,
  countUiThemeTemplateDiff,
  detectUiThemeTemplate,
  findUiThemeTemplate,
  resolveUiThemeWithTemplate,
  uiThemeTemplatesFor,
  uiThemeTemplateToChanges,
  UI_THEME_TEMPLATES,
  UI_THEME_TEMPLATE_TOKEN_KEYS,
  type UiThemeTemplate,
} from "./ui-theme-templates";

/**
 * ============================================================================
 * 색상 톤 템플릿 — 등록부와 생성기
 * ============================================================================
 * 🔴 이 시험이 이 기능의 절반이다. 템플릿은 화면에 **카드 한 장**으로만 보이고,
 * 값이 틀려도 눈으로는 아무 표시가 나지 않는다. 틀린 값 하나가 하는 일은 딱
 * 하나다 — 고르는 순간 서버가 저장을 거절하거나, 저장에는 성공했는데 전 직원이
 * 화면을 못 읽게 된다. 눌러 보기 전에는 아무도 모른다.
 *
 * 목록이 **함수가 만드는 것**이 된 뒤로는 한 겹 더 나쁘다 — 관리자는 미리 만든
 * 여섯이 아니라 **아무 메인 컬러에서나** 만들어진 여섯을 보게 되므로, 표본 몇
 * 개로는 못 박히지 않는다. 그래서 색상환을 통째로 훑는다.
 *
 *  1) **담당이 갈라져 있다.** 저장 형태에 강조색(primary) 칸이 **0개**다. 하나라도
 *     실리면 톤을 저장할 때마다 메인 컬러가 지워진다 — 이 판이 고친 버그다.
 *  2) **빠짐이 없다.** 이 화면이 맡는 색 24개가 전부 들어 있고, 등록부에 없는
 *     키가 섞여 있지도 않다.
 *  3) **서버 문을 지난다.** 모든 값이 검증기를 그대로 통과하고, 정규화 결과가
 *     적어 둔 값과 **글자까지** 같다.
 *  4) **저장 거절선을 넘는다.** 색상환 어디에서 만들어진 톤이든 대비 4쌍이 전부
 *     3:1 이상이다. 실측 최저값을 적어 두어 여유가 얼마나 있었는지 보이게 한다.
 *  5) **물들여도 대비가 움직이지 않는다.** 색조는 휘도를 그대로 두고 얹히므로,
 *     물든 톤의 대비는 물들기 전 톤과 사실상 같다(실측 최대 차이 0.15).
 *  6) **메인 컬러가 「회색 (기본)」이면 지금까지의 여섯이 그대로 나온다.** 아무
 *     것도 고르지 않은 관리자의 화면이 이 판 때문에 바뀌면 안 된다 — hex 표로
 *     못 박는다.
 * ============================================================================
 */

const COLOR_TOKENS: readonly UiThemeToken[] = UI_THEME_TOKENS.filter(
  (token) => token.kind === "color"
);
const TEMPLATE_TOKENS: readonly UiThemeToken[] = COLOR_TOKENS.filter((token) =>
  UI_THEME_TEMPLATE_TOKEN_KEYS.includes(token.key)
);

/** 라이트/다크가 다를 수 있는 유일한 둘. 나머지는 램프다. */
const SCOPED_APART_KEYS: ReadonlySet<string> = new Set(["background", "foreground"]);

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const ZINC_KEYS = STEPS.map((step) => `zinc-${step}`);
const RED_KEYS = STEPS.map((step) => `red-${step}`);

function templateByKey(key: string, templates = UI_THEME_TEMPLATES): UiThemeTemplate {
  const found = findUiThemeTemplate(key, templates);
  assert.ok(found, `템플릿 ${key}가 없다`);
  return found;
}

/** 템플릿을 「저장했다면 남았을 행」으로 바꾼다. 저장 경로가 만드는 것과 같은 목록이다. */
function rowsOf(template: UiThemeTemplate): UiThemeOverrideRow[] {
  const rows: UiThemeOverrideRow[] = [];
  for (const change of uiThemeTemplateToChanges(template)) {
    if (change.value === null) continue;
    rows.push({
      tokenKey: change.tokenKey,
      scope: change.scope as UiThemeScope,
      value: change.value,
    });
  }
  return rows;
}

/** 메인 컬러를 저장했다면 남았을 행. 강조색 화면이 만드는 것과 같은 목록이다. */
function primaryRowsOf(ramp: PrimaryRamp): UiThemeOverrideRow[] {
  const rows: UiThemeOverrideRow[] = [];
  for (const change of uiThemePrimaryRampToChanges(ramp)) {
    if (change.value === null) continue;
    rows.push({
      tokenKey: change.tokenKey,
      scope: change.scope as UiThemeScope,
      value: change.value,
    });
  }
  return rows;
}

function pairKey(scope: string, fgKey: string, bgKey: string): string {
  return `${scope}:${fgKey}:${bgKey}`;
}

/**
 * 씨앗 하나. 색상환을 도는 순색이다(HSL 밝기 0.5) — 메인 컬러 램프 시험과 같은
 * 도우미다. 관리자가 고르개로 고를 수 있는 색을 넓게 대신한다.
 */
function seedAt(hue: number, saturation: number, lightness = 0.5): string {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = ((hue % 360) / 60) % 6;
  const x = c * (1 - Math.abs((sector % 2) - 1));
  const m = lightness - c / 2;
  const rgb =
    sector < 1
      ? [c, x, 0]
      : sector < 2
        ? [x, c, 0]
        : sector < 3
          ? [0, c, x]
          : sector < 4
            ? [0, x, c]
            : sector < 5
              ? [x, 0, c]
              : [c, 0, x];
  return `#${rgb
    .map((value) =>
      Math.round(Math.min(1, Math.max(0, value + m)) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

/** 「이 씨앗을 메인 컬러로 저장해 둔 상태」의 행. */
function savedSeedRows(seed: string): UiThemeOverrideRow[] {
  return primaryRowsOf(buildUiThemePrimaryRamp(seed));
}

/** 색상환 훑기의 격자. 시험 넷이 같은 격자를 쓴다 — 실측값이 서로 견줄 수 있어야 한다. */
const SWEEP_HUE_STEP = 10;
const SWEEP_SATURATIONS = [0.2, 0.4, 0.6, 0.8, 1] as const;

function forEachSweepSeed(visit: (seed: string, rows: UiThemeOverrideRow[]) => void): number {
  let count = 0;
  for (let hue = 0; hue < 360; hue += SWEEP_HUE_STEP) {
    for (const saturation of SWEEP_SATURATIONS) {
      const seed = seedAt(hue, saturation);
      visit(seed, savedSeedRows(seed));
      count += 1;
    }
  }
  return count;
}

// ───────────────────────────────────────────── 🔴 담당 가르기 (버그 수정)

test("톤을 저장해도 강조색은 한 칸도 실리지 않는다", () => {
  // 🔴 이 판이 고친 버그다. 예전에는 톤이 강조색 11단까지 함께 채워서, 메인
  // 컬러를 고른 뒤 톤을 저장하면 주 버튼이 다시 검정이 됐다. 담당이 갈린 지금은
  // 저장 칸에 primary 가 하나도 없어야 한다.
  const templates = [...UI_THEME_TEMPLATES, ...buildUiThemeTemplates({ hue: 210, saturation: 0.8 })];

  for (const template of templates) {
    const changes = uiThemeTemplateToChanges(template);
    assert.equal(changes.length, 48, `${template.key}의 저장 칸 수가 48이 아니다`);

    const primary = changes.filter((change) => change.tokenKey.startsWith("primary-"));
    assert.deepEqual(primary, [], `${template.key}가 강조색 칸을 저장하려 한다`);

    for (const change of changes) {
      assert.ok(
        UI_THEME_TEMPLATE_TOKEN_KEYS.includes(change.tokenKey),
        `${template.key}가 이 화면의 색이 아닌 토큰(${change.tokenKey})을 저장하려 한다`
      );
      assert.ok(change.scope === "light" || change.scope === "dark");
    }
  }
});

test("메인 컬러를 저장한 뒤 톤을 저장해도 주 버튼 색이 그대로 남는다", () => {
  // 화면 둘이 서로를 덮어쓰지 않는다는 것을 **저장 경로가 만드는 행**으로 확인한다.
  const blue = findUiThemeMainColor("blue");
  assert.ok(blue);
  assert.equal(blue.ramp["primary-900"], "#1043b3");

  const afterMainColor = primaryRowsOf(blue.ramp);
  const tone = templateByKey("tinted-strong", uiThemeTemplatesFor(afterMainColor));
  const afterTone = [...afterMainColor, ...rowsOf(tone)];

  const resolved = resolveUiTheme(afterTone);
  assert.equal(resolved.light["primary-900"], "#1043b3", "톤 저장이 주 버튼 색을 덮어썼다");
  assert.equal(resolved.dark["primary-900"], "#1043b3");
  // 중립은 실제로 톤 값으로 바뀌었다 — 「아무것도 안 바뀐다」가 아니다.
  assert.equal(resolved.light["zinc-900"], tone.colors["zinc-900"][0]);

  // 두 화면의 판정이 서로를 흐리지 않는다.
  assert.equal(detectUiThemeTemplate(afterTone)?.key, "tinted-strong");
});

test("미리보기도 저장된 강조색을 그대로 남긴다", () => {
  const saved: UiThemeOverrideRow[] = [
    { tokenKey: "radius-md", scope: "both", value: "0" },
    { tokenKey: "primary-900", scope: "light", value: "#1043b3" },
  ];
  const preview = resolveUiThemeWithTemplate(saved, templateByKey("high-contrast"));

  assert.equal(preview.light["primary-900"], "#1043b3", "견본이 강조색을 덮었다");
  assert.equal(preview.light["radius-md"], "0");
  assert.equal(preview.dark["radius-md"], "0");
  assert.equal(preview.light["zinc-900"], "#0e0e11");
  assert.equal(preview.dark.background, "#000000");
});

test("템플릿은 모서리·글자 크기를 건드리지 않는다", () => {
  const shapeTokens = UI_THEME_TOKENS.filter((token) => token.kind !== "color");
  assert.ok(shapeTokens.length > 0);

  for (const template of UI_THEME_TEMPLATES) {
    const keys = new Set(uiThemeTemplateToChanges(template).map((change) => change.tokenKey));
    for (const token of shapeTokens) {
      assert.ok(!keys.has(token.key), `${template.key}가 ${token.key}까지 저장하려 한다`);
    }
  }
});

// ───────────────────────────────────────────────── 등록부 자기 정합성

test("이 화면이 맡는 색은 24개이고 강조색은 그중에 없다", () => {
  // 색 35개 = 중립 11 + 강조 11 + 경고 11 + 바탕·글자 2. 강조 11을 빼면 24다.
  assert.equal(COLOR_TOKENS.length, 35);
  assert.equal(UI_THEME_TEMPLATE_TOKEN_KEYS.length, 24);
  assert.deepEqual(
    UI_THEME_TEMPLATE_TOKEN_KEYS.filter((key) => key.startsWith("primary-")),
    []
  );
  assert.deepEqual(
    [...UI_THEME_TEMPLATE_TOKEN_KEYS].sort(),
    [...ZINC_KEYS, ...RED_KEYS, "background", "foreground"].sort()
  );
});

test("톤 여섯의 키와 이름과 팔레트가 저마다 고유하다", () => {
  for (const templates of [
    UI_THEME_TEMPLATES,
    buildUiThemeTemplates({ hue: 30, saturation: 0.9 }),
    buildUiThemeTemplates({ hue: 265, saturation: 0.4 }),
  ]) {
    const keys = templates.map((item) => item.key);
    const names = templates.map((item) => item.name);

    assert.equal(templates.length, 6);
    assert.equal(new Set(keys).size, keys.length, "템플릿 키가 겹친다");
    assert.equal(new Set(names).size, names.length, "템플릿 이름이 겹친다");

    // 팔레트가 똑같은 템플릿이 둘 있으면 판정(detect)이 앞엣것만 돌려주고,
    // 뒤엣것은 골라도 영영 「지금 쓰는 톤」으로 표시되지 않는다.
    const palettes = templates.map((item) =>
      UI_THEME_TEMPLATE_TOKEN_KEYS.map((key) => item.colors[key].join("/")).join(",")
    );
    assert.equal(new Set(palettes).size, palettes.length, "값이 완전히 같은 템플릿이 둘 있다");

    for (const item of templates) {
      assert.ok(item.name.length > 0, `${item.key}의 이름이 비어 있다`);
      assert.ok(item.description.length > 0, `${item.key}의 설명이 비어 있다`);
    }

    // 되돌아올 자리가 맨 앞이다 — 화면이 그리는 순서가 이 순서다.
    assert.equal(templates[0].key, "default");
  }
});

test("default 템플릿은 등록부 기본값과 정확히 같고 색조가 얹히지 않는다", () => {
  for (const templates of [UI_THEME_TEMPLATES, buildUiThemeTemplates({ hue: 120, saturation: 1 })]) {
    const template = templateByKey("default", templates);
    for (const token of TEMPLATE_TOKENS) {
      assert.deepEqual(
        template.colors[token.key],
        [token.defaultLight, token.defaultDark],
        `default 템플릿의 ${token.key}가 등록부 기본값과 다르다`
      );
    }
  }
});

test("등록되지 않은 키로는 템플릿을 찾을 수 없다", () => {
  assert.equal(findUiThemeTemplate("no-such-template"), null);
  assert.equal(findUiThemeTemplate(""), null);
  assert.equal(findUiThemeTemplate("default")?.key, "default");

  // 색조가 있는 키는 색조가 있는 목록에서만 나온다 — 화면이 목록을 함께 넘기지
  // 않으면 「고른 톤이 사라지는」 상태가 된다.
  const tinted = buildUiThemeTemplates({ hue: 210, saturation: 0.8 });
  assert.equal(findUiThemeTemplate("tinted-soft"), null);
  assert.equal(findUiThemeTemplate("tinted-soft", tinted)?.key, "tinted-soft");
  assert.equal(findUiThemeTemplate("cool-slate", tinted), null);
});

// ────────────────────────── 🔴 메인 컬러가 「회색 (기본)」일 때의 여섯

test("메인 컬러가 「회색 (기본)」이면 톤 목록이 지금까지의 여섯 그대로다", () => {
  // 🔴 아무것도 고르지 않은 관리자의 화면이 이 판 때문에 바뀌면 안 된다.
  // 저장된 행이 없다 = 메인 컬러가 「회색 (기본)」이다.
  assert.equal(readUiThemePrimaryTint([]), null);
  const templates = uiThemeTemplatesFor([]);
  assert.deepEqual(templates.map((item) => item.key), [
    "default",
    "cool-slate",
    "warm-stone",
    "high-contrast",
    "soft-contrast",
    "calm-red",
  ]);
  assert.deepEqual(templates, UI_THEME_TEMPLATES);

  // 값을 그대로 적어 둔다. 램프는 라이트/다크가 같으므로 한 벌만, 바탕·본문
  // 글자는 「라이트/다크」로 적는다.
  const expected: Record<string, { zinc: string; red: string; ends: string }> = {
    default: {
      zinc: "#fafafa #f4f4f5 #e4e4e7 #d4d4d8 #9f9fa9 #71717b #52525c #3f3f46 #27272a #18181b #09090b",
      red: "#fef2f2 #ffe2e2 #ffcaca #ffa3a3 #ff6568 #fb2c36 #e40014 #bf000f #9f0712 #82181a #460809",
      ends: "#ffffff/#0a0a0a #171717/#ededed",
    },
    "cool-slate": {
      zinc: "#f8fafc #f1f5f9 #e2e8f0 #cad5e2 #90a1b9 #62748e #45556c #314158 #1d293d #0f172b #020618",
      red: "#fef2f2 #ffe2e2 #ffcaca #ffa3a3 #ff6568 #fb2c36 #e40014 #bf000f #9f0712 #82181a #460809",
      ends: "#ffffff/#020618 #0f172b/#f1f5f9",
    },
    "warm-stone": {
      zinc: "#fafaf9 #f5f5f4 #e7e5e4 #d6d3d1 #a6a09b #79716b #57534d #44403b #292524 #1c1917 #0c0a09",
      red: "#fef2f2 #ffe2e2 #ffcaca #ffa3a3 #ff6568 #fb2c36 #e40014 #bf000f #9f0712 #82181a #460809",
      ends: "#ffffff/#0c0a09 #1c1917/#f5f5f4",
    },
    "high-contrast": {
      zinc: "#ffffff #f7f7f7 #c0c0c3 #b7b7bb #9696a0 #62626c #40404a #2e2e36 #1a1a1d #0e0e11 #040406",
      red: "#fff5f5 #ffe8e8 #ffd6d5 #ffb2b1 #ff7a7a #ff323a #d10003 #a10005 #800009 #6b0008 #350002",
      ends: "#ffffff/#000000 #000000/#ffffff",
    },
    "soft-contrast": {
      zinc: "#efefef #eaeaea #dcdcdf #ceced2 #9f9faa #777782 #5b5b66 #4a4a52 #353538 #27272a #19191b",
      red: "#f3e8e8 #f4dada #f5c4c4 #f8a2a2 #f96d6e #f54445 #e52929 #c32724 #a42a26 #8a2d2a #541d1a",
      ends: "#f3f3f3/#1a1a1a #262626/#e4e4e4",
    },
    "calm-red": {
      zinc: "#fafafa #f4f4f5 #e4e4e7 #d4d4d8 #9f9fa9 #71717b #52525c #3f3f46 #27272a #18181b #09090b",
      red: "#fbf3f3 #f8e5e5 #f3cfcf #edaead #e37e7c #d95f59 #c64b42 #a53e36 #88352f #70302c #3c1614",
      ends: "#ffffff/#0a0a0a #171717/#ededed",
    },
  };

  const actual = Object.fromEntries(
    templates.map((item) => [
      item.key,
      {
        zinc: ZINC_KEYS.map((key) => item.colors[key][0]).join(" "),
        red: RED_KEYS.map((key) => item.colors[key][0]).join(" "),
        ends: `${item.colors.background.join("/")} ${item.colors.foreground.join("/")}`,
      },
    ])
  );
  assert.deepEqual(actual, expected);
});

test("색조가 없는 여섯의 저장 거절선 대비는 이 판 이전과 같다", () => {
  // 🔴 실측값을 그대로 적어 둔다. 강조색이 저장 목록에서 빠졌어도 이 넷은
  // 중립·바탕/글자 짝이라 값이 한 자도 달라지지 않아야 한다.
  const expected: Record<string, Record<string, number>> = {
    default: {
      "light:foreground:background": 17.93,
      "light:zinc-900:background": 17.72,
      "dark:foreground:background": 16.91,
      "dark:zinc-50:background": 18.97,
    },
    "cool-slate": {
      "light:foreground:background": 17.83,
      "light:zinc-900:background": 17.83,
      "dark:foreground:background": 18.4,
      "dark:zinc-50:background": 19.27,
    },
    "warm-stone": {
      "light:foreground:background": 17.49,
      "light:zinc-900:background": 17.49,
      "dark:foreground:background": 18.11,
      "dark:zinc-50:background": 18.92,
    },
    "high-contrast": {
      "light:foreground:background": 21,
      "light:zinc-900:background": 19.27,
      "dark:foreground:background": 21,
      "dark:zinc-50:background": 21,
    },
    "soft-contrast": {
      "light:foreground:background": 13.64,
      "light:zinc-900:background": 13.42,
      "dark:foreground:background": 13.69,
      "dark:zinc-50:background": 15.14,
    },
    "calm-red": {
      "light:foreground:background": 17.93,
      "light:zinc-900:background": 17.72,
      "dark:foreground:background": 16.91,
      "dark:zinc-50:background": 18.97,
    },
  };

  assert.equal(UI_THEME_CONTRAST_BLOCKING.length, 4);

  for (const template of UI_THEME_TEMPLATES) {
    // 🔴 「템플릿을 저장했다면」의 모습으로 잰다. 서버(mutation)가 저장 직전에
    // 재는 것과 같은 함수·같은 자료다.
    const resolved = resolveUiTheme(rowsOf(template));
    const table = expected[template.key];
    assert.ok(table, `${template.key}의 실측 대비값이 시험에 없다`);

    for (const pair of UI_THEME_CONTRAST_BLOCKING) {
      const key = pairKey(pair.scope, pair.fgKey, pair.bgKey);
      const ratio = contrastRatio(
        resolved[pair.scope][pair.fgKey],
        resolved[pair.scope][pair.bgKey]
      );
      assert.equal(ratio, table[key], `${template.key} · ${pair.label}의 대비가 달라졌다`);
      assert.ok(
        ratio >= UI_THEME_CONTRAST_FLOOR,
        `${template.key} · ${pair.label}이 저장 거절선 미만이다 (${ratio}:1)`
      );
    }
  }
});

// ──────────────────────────────────────────────── 색조를 따라 만들기

test("물드는 세기는 지금 화면에 있는 두 톤에서 잰 채도다", () => {
  // 🔴 세기를 지어내지 않았다. warm-stone(stone)과 cool-slate(slate)의 가운데
  // 단계에서 잰 HSL 채도가 그대로 「살짝」과 「뚜렷이」다. 여기 적힌 두 색이
  // 바뀌면 목록의 인상이 통째로 달라지므로 값으로 못 박는다.
  assert.equal(templateByKey("warm-stone").colors["zinc-500"][0], "#79716b");
  assert.equal(templateByKey("cool-slate").colors["zinc-500"][0], "#62748e");
  assert.equal(uiThemeTintOf("#79716b").saturation, 0.0614035087719298);
  assert.equal(uiThemeTintOf("#62748e").saturation, 0.18333333333333332);

  // 「살짝」이 「뚜렷이」보다 확실히 옅다 — 두 카드가 같아 보이면 고를 수 없다.
  const tinted = buildUiThemeTemplates({ hue: 210, saturation: 0.9 });
  const soft = templateByKey("tinted-soft", tinted).colors["zinc-500"][0];
  const strong = templateByKey("tinted-strong", tinted).colors["zinc-500"][0];
  assert.ok(uiThemeTintOf(soft).saturation < uiThemeTintOf(strong).saturation);
  assert.notEqual(soft, templateByKey("default").colors["zinc-500"][0]);
});

test("색조는 저장된 강조색에서 읽고, 회색 계열이면 색조가 없다", () => {
  // 「회색 (기본)」은 물론이고, 손으로 고른 옅은 회색도 물들일 색조가 없다.
  const neutral = findUiThemeMainColor("neutral");
  assert.ok(neutral);
  assert.equal(readUiThemePrimaryTint(primaryRowsOf(neutral.ramp)), null);
  assert.equal(readUiThemePrimaryTint(savedSeedRows(seedAt(210, 0.14))), null);

  // 그 위로는 색조가 있다. 미리 만든 여덟 가운데 「회색 (기본)」만 없다.
  assert.notEqual(readUiThemePrimaryTint(savedSeedRows(seedAt(210, 0.15))), null);
  const blue = findUiThemeMainColor("blue");
  assert.ok(blue);
  const blueTint = readUiThemePrimaryTint(primaryRowsOf(blue.ramp));
  assert.ok(blueTint);
  assert.equal(blueTint.hue, 221.22699386503066);

  // 중립을 손봐도 색조 판정은 강조색만 본다 — 톤과 메인 컬러가 서로의 표시를
  // 흐리면 어느 쪽도 못 믿는다.
  const withTone = [...primaryRowsOf(blue.ramp), ...rowsOf(templateByKey("cool-slate"))];
  assert.equal(readUiThemePrimaryTint(withTone)?.hue, blueTint.hue);
});

test("메인 컬러 「파랑」에서 만들어진 톤의 실측값", () => {
  // 🔴 값을 그대로 적어 둔다. 생성기를 손볼 때 목록이 얼마나 움직였는지 여기서
  // 드러난다 — 카드에는 아무 표시도 나지 않는다.
  const blue = findUiThemeMainColor("blue");
  assert.ok(blue);
  const templates = uiThemeTemplatesFor(primaryRowsOf(blue.ramp));

  assert.deepEqual(templates.map((item) => item.key), [
    "default",
    "tinted-soft",
    "tinted-strong",
    "high-contrast",
    "soft-contrast",
    "calm-red",
  ]);

  const expected: Record<string, string> = {
    default:
      "#fafafa #f4f4f5 #e4e4e7 #d4d4d8 #9f9fa9 #71717b #52525c #3f3f46 #27272a #18181b #09090b",
    "tinted-soft":
      "#fafafa #f4f4f5 #e4e4e7 #d3d4d8 #9ca0a8 #6d727c #4f535a #3d3f45 #26272a #18181b #09090a",
    "tinted-strong":
      "#fafafb #f3f4f7 #e2e4eb #d0d4df #96a0b7 #647290 #485369 #383f51 #232732 #15191f #080a0c",
    "high-contrast":
      "#ffffff #f7f7f7 #bec0c6 #b5b7bd #93979f #5f636b #3e4146 #2d2e33 #191a1c #0d0e0f #040505",
    "soft-contrast":
      "#efeff0 #e9eaec #dbdcdf #cdced3 #9ca0a8 #737883 #585c63 #484b51 #33353a #26272a #181a1c",
    "calm-red":
      "#fafafa #f4f4f5 #e4e4e7 #d3d4d8 #9ca0a8 #6d727c #4f535a #3d3f45 #26272a #18181b #09090a",
  };
  assert.deepEqual(
    Object.fromEntries(
      templates.map((item) => [item.key, ZINC_KEYS.map((key) => item.colors[key][0]).join(" ")])
    ),
    expected
  );

  // 🔴 경고색은 물들지 않는다 — 빨강은 팔레트가 아니라 「위험」이라는 뜻이다.
  assert.equal(
    RED_KEYS.map((key) => templateByKey("tinted-strong", templates).colors[key][0]).join(" "),
    RED_KEYS.map((key) => templateByKey("default").colors[key][0]).join(" ")
  );

  // 🔴 고대비의 순백·순검은 물들지 않는다(휘도가 1과 0이면 색차가 0이다).
  const highContrast = templateByKey("high-contrast", templates);
  assert.deepEqual(highContrast.colors.background, ["#ffffff", "#000000"]);
  assert.deepEqual(highContrast.colors.foreground, ["#000000", "#ffffff"]);
  assert.equal(highContrast.colors["zinc-50"][0], "#ffffff");
});

test("색조가 달라도 키는 그대로고, 같은 색조면 언제나 같은 목록이다", () => {
  const keysAt = (hue: number) => buildUiThemeTemplates({ hue, saturation: 0.8 }).map((t) => t.key);
  assert.deepEqual(keysAt(20), keysAt(200));
  assert.deepEqual(keysAt(20), [
    "default",
    "tinted-soft",
    "tinted-strong",
    "high-contrast",
    "soft-contrast",
    "calm-red",
  ]);

  // 🔴 결정적이다 — 같은 색상이면 두 번 불러도 같은 값.
  for (const hue of [0, 77, 180, 300]) {
    assert.deepEqual(
      buildUiThemeTemplates({ hue, saturation: 0.6 }),
      buildUiThemeTemplates({ hue, saturation: 0.6 }),
      `h=${hue}`
    );
  }

  // 채도는 「색조가 있는가」를 가르는 데에만 쓰인다 — 물드는 세기는 고정이다.
  assert.deepEqual(
    buildUiThemeTemplates({ hue: 120, saturation: 0.2 }),
    buildUiThemeTemplates({ hue: 120, saturation: 1 })
  );
});

// ────────────────────────────────────────────── 🔴 색상환 전체 훑기

test("색상환 36색 × 채도 5단 어디를 골라도 만들어진 톤이 안전하다", () => {
  // 🔴 관리자는 아무 색이나 메인 컬러로 고를 수 있고, 그 색이 톤 목록을 만든다.
  // 표본 몇 개가 아니라 넓게 훑어야 「어떤 메인 컬러에서도」가 실제로 못 박힌다.
  let worst = Infinity;
  let worstLabel = "";

  const count = forEachSweepSeed((seed, savedRows) => {
    const templates = uiThemeTemplatesFor(savedRows);
    assert.equal(templates.length, 6, `${seed}: 톤이 여섯이 아니다`);

    for (const template of templates) {
      const label = `${seed} · ${template.key}`;

      // ① 빠짐이 없고 모르는 키가 없다.
      assert.deepEqual(
        Object.keys(template.colors).sort(),
        [...UI_THEME_TEMPLATE_TOKEN_KEYS].sort(),
        `${label}: 색 목록이 이 화면이 맡는 24개와 다르다`
      );

      for (const token of TEMPLATE_TOKENS) {
        const [light, dark] = template.colors[token.key];

        // ② 서버 문을 지나고 정규화 왕복이 글자까지 같다.
        assert.equal(normalizeUiThemeValue(token, light), light, `${label} · ${token.key} 라이트`);
        assert.equal(normalizeUiThemeValue(token, dark), dark, `${label} · ${token.key} 다크`);

        // ③ 램프는 한 벌이고, 바탕·본문 글자만 라이트/다크가 다르다.
        if (SCOPED_APART_KEYS.has(token.key)) {
          assert.notEqual(light, dark, `${label} · ${token.key}의 라이트/다크가 같다`);
        } else {
          assert.equal(light, dark, `${label} · ${token.key}의 라이트/다크가 다르다`);
        }
      }

      // ④ 밝기가 단조롭다 — 50이 가장 밝고 950이 가장 어둡다. 뒤집히면 마우스를
      //    올린 줄이 원래 줄보다 어두워지는 식으로 화면이 이상해진다.
      for (const ramp of [ZINC_KEYS, RED_KEYS]) {
        let previous = Infinity;
        for (const key of ramp) {
          const brightness = contrastRatio(template.colors[key][0], "#000000");
          assert.ok(brightness < previous, `${label} · ${key}가 앞 단계보다 밝거나 같다`);
          previous = brightness;
        }
      }

      // ⑤ 🔴 저장 거절선을 넘는다. 「메인 컬러 + 이 톤을 저장했다면」의 모습으로
      //    잰다 — 서버가 저장 직전에 재는 것과 같은 함수·같은 자료다.
      const resolved = resolveUiTheme([...savedRows, ...rowsOf(template)]);
      for (const pair of UI_THEME_CONTRAST_BLOCKING) {
        const ratio = contrastRatio(
          resolved[pair.scope][pair.fgKey],
          resolved[pair.scope][pair.bgKey]
        );
        assert.ok(
          ratio >= UI_THEME_CONTRAST_FLOOR,
          `${label} · ${pair.label}이 저장 거절선 미만이다 (${ratio}:1)`
        );
        if (ratio < worst) {
          worst = ratio;
          worstLabel = `${label} · ${pairKey(pair.scope, pair.fgKey, pair.bgKey)}`;
        }
      }
    }
  });

  assert.equal(count, 180);
  // 실측 최저값. 거절선(3)의 네 배가 넘는 자리라 여유가 넓다 — 가장 나쁜 자리는
  // 이름 그대로 대비를 낮추는 「부드러운 대비」의 라이트 제목 글자다.
  assert.equal(worstLabel, "#919966 · soft-contrast · light:zinc-900:background");
  assert.equal(worst, 13.38);
});

test("색상환을 훑어도 경고선(4.5:1) 미만인 짝은 이것뿐이다", () => {
  // 막지는 않는다. 다만 무엇이 걸려 있는지 목록으로 못 박아 두어야, 색조를
  // 손보다가 모르는 사이에 늘어나는 것을 막을 수 있다.
  const found = new Map<string, number>();

  forEachSweepSeed((seed, savedRows) => {
    for (const template of uiThemeTemplatesFor(savedRows)) {
      const resolved = resolveUiTheme([...savedRows, ...rowsOf(template)]);
      for (const pair of UI_THEME_CONTRAST_PAIRS) {
        const ratio = contrastRatio(
          resolved[pair.scope][pair.fgKey],
          resolved[pair.scope][pair.bgKey]
        );
        if (ratio >= UI_THEME_CONTRAST_WARN) continue;
        const key = `${template.key} · ${pairKey(pair.scope, pair.fgKey, pair.bgKey)}`;
        found.set(key, Math.min(found.get(key) ?? Infinity, ratio));
      }
    }
  });

  // 색조를 얹기 전과 **같은 한 짝**이다. 부드러운 대비는 이름 그대로 대비를
  // 낮추는 톤이고, 기본 팔레트의 같은 짝이 4.62 로 이미 경고선에 붙어 있어서
  // 대비를 조금이라도 눕히면 반드시 걸리는 자리다.
  assert.deepEqual(Object.fromEntries([...found].sort()), {
    "soft-contrast · light:zinc-500:zinc-50": 3.83,
  });
});

test("색조를 얹어도 대비가 움직이지 않는다", () => {
  // 🔴 이것이 이 판의 안전 근거다. 색조는 **휘도를 그대로 두고** 얹히므로
  // (tintUiThemeColor), 물든 톤의 대비는 물들기 전 톤과 사실상 같다. 그래서 위의
  // 훑기가 통과하는 것은 우연이 아니고, 앞으로 대비 짝을 더 적어도 함께 안전하다.
  const baseOf: Record<string, string> = {
    default: "default",
    "tinted-soft": "default",
    "tinted-strong": "default",
    "high-contrast": "high-contrast",
    "soft-contrast": "soft-contrast",
    "calm-red": "calm-red",
  };

  let worst = 0;
  let worstLabel = "";
  forEachSweepSeed((seed, savedRows) => {
    for (const template of uiThemeTemplatesFor(savedRows)) {
      const base = templateByKey(baseOf[template.key]);
      for (const pair of UI_THEME_CONTRAST_PAIRS) {
        const index = pair.scope === "dark" ? 1 : 0;
        const delta = Math.abs(
          contrastRatio(template.colors[pair.fgKey][index], template.colors[pair.bgKey][index]) -
            contrastRatio(base.colors[pair.fgKey][index], base.colors[pair.bgKey][index])
        );
        if (delta > worst) {
          worst = delta;
          worstLabel = `${seed} · ${template.key} · ${pairKey(pair.scope, pair.fgKey, pair.bgKey)}`;
        }
      }
    }
  });

  // 실측 최대 차이. 대비비가 소수 두 자리로 반올림되므로 0은 될 수 없고, 8비트
  // 색이 갖는 한 계단만큼만 움직인다.
  assert.equal(Math.round(worst * 100) / 100, 0.15, `가장 많이 움직인 자리: ${worstLabel}`);
});

// ─────────────────────────────────────────────────────────── 판정

test("저장된 행이 없으면 기본 템플릿으로 판정한다", () => {
  const detected = detectUiThemeTemplate([]);
  assert.equal(detected?.key, "default");
  assert.equal(countUiThemeTemplateDiff(templateByKey("default"), []), 0);
});

test("어느 톤을 그대로 넣으면 그 톤으로 판정한다 — 색조가 있어도 마찬가지다", () => {
  const blue = findUiThemeMainColor("blue");
  assert.ok(blue);
  const blueRows = primaryRowsOf(blue.ramp);

  for (const [savedRows, templates] of [
    [[] as UiThemeOverrideRow[], UI_THEME_TEMPLATES],
    [blueRows, uiThemeTemplatesFor(blueRows)],
  ] as const) {
    for (const template of templates) {
      const rows = [...savedRows, ...rowsOf(template)];
      assert.equal(detectUiThemeTemplate(rows)?.key, template.key);
      assert.equal(countUiThemeTemplateDiff(template, rows), 0);
    }
  }
});

test("한 칸만 달라도 판정은 null 이다 — 「직접 고친 값」", () => {
  const coolSlate = templateByKey("cool-slate");
  const rows = rowsOf(coolSlate);

  const target = rows.findIndex((row) => row.tokenKey === "zinc-500" && row.scope === "light");
  assert.ok(target >= 0, "cool-slate 가 zinc-500 라이트를 저장하지 않는다");

  const tweaked = rows.map((row, index) =>
    index === target ? { ...row, value: "#123456" } : row
  );
  assert.equal(detectUiThemeTemplate(tweaked), null);
  assert.equal(countUiThemeTemplateDiff(coolSlate, tweaked), 1);

  // 기본값으로 돌아온 자리 하나(행 삭제)도 마찬가지로 「직접 고친 값」이다.
  const removed = rows.filter((_, index) => index !== target);
  assert.equal(detectUiThemeTemplate(removed), null);
  assert.equal(countUiThemeTemplateDiff(coolSlate, removed), 1);
});

test("메인 컬러를 바꾸면 옛 색조의 톤은 「직접 고친 값」이 된다", () => {
  // 목록이 지금 메인 컬러에서 만들어지므로, 색조를 바꾼 뒤 톤을 다시 저장하지
  // 않으면 저장된 중립은 새 목록의 어느 것과도 맞지 않는다. 그것이 사실이고,
  // 화면이 그렇게 적는다 — 톤을 다시 고르면 곧바로 맞아떨어진다.
  const blue = findUiThemeMainColor("blue");
  const green = findUiThemeMainColor("green");
  assert.ok(blue && green);

  const blueRows = primaryRowsOf(blue.ramp);
  const tone = templateByKey("tinted-strong", uiThemeTemplatesFor(blueRows));
  const withBlue = [...blueRows, ...rowsOf(tone)];
  assert.equal(detectUiThemeTemplate(withBlue)?.key, "tinted-strong");

  const withGreen = [...rowsOf(tone), ...primaryRowsOf(green.ramp)];
  assert.equal(detectUiThemeTemplate(withGreen), null);

  // 같은 자리에서 초록의 톤을 다시 저장하면 판정이 돌아온다.
  const greenRows = primaryRowsOf(green.ramp);
  const greenTone = templateByKey("tinted-strong", uiThemeTemplatesFor(greenRows));
  assert.equal(detectUiThemeTemplate([...greenRows, ...rowsOf(greenTone)])?.key, "tinted-strong");
});

test("기본 상태에서 각 톤까지 몇 칸이 다른지 센다", () => {
  // 화면이 카드에 적는 숫자다. 🔴 강조색을 세지 않으므로 예전보다 작다 — 중립
  // 11단 × 라이트·다크 = 22칸에 경고색과 바탕·본문 글자가 붙는다.
  const diffs = Object.fromEntries(
    UI_THEME_TEMPLATES.map((template) => [template.key, countUiThemeTemplateDiff(template, [])])
  );

  assert.deepEqual(diffs, {
    default: 0,
    // 중립 22칸 + 다크 바탕 + 라이트·다크 본문 글자 = 25.
    "cool-slate": 25,
    "warm-stone": 25,
    // 고대비는 라이트 바탕만 기본과 같다(둘 다 순백) — 그래서 47.
    "high-contrast": 47,
    "soft-contrast": 48,
    // 차분한 경고색은 중립을 건드리지 않는다 — 경고 11단 × 라이트·다크 = 22칸.
    "calm-red": 22,
  });
});

test("기본값과 다른 값만 행으로 남고, 그 행을 되풀면 톤 값 그대로다", () => {
  const changes = uiThemeTemplateToChanges(templateByKey("default"));
  assert.equal(changes.length, 48);
  for (const change of changes) {
    assert.equal(
      change.value,
      null,
      `${change.tokenKey}(${change.scope})가 기본값인데 값을 저장하려 한다`
    );
  }
  // 저장하면 행이 하나도 남지 않는다 = 이 기능을 넣기 전과 완전히 같은 화면.
  assert.deepEqual(rowsOf(templateByKey("default")), []);

  for (const template of [
    ...UI_THEME_TEMPLATES,
    ...buildUiThemeTemplates({ hue: 30, saturation: 0.9 }),
  ]) {
    const resolved = resolveUiTheme(rowsOf(template));
    for (const token of TEMPLATE_TOKENS) {
      const [light, dark] = template.colors[token.key];
      assert.equal(resolved.light[token.key], light, `${template.key} · ${token.key} 라이트`);
      assert.equal(resolved.dark[token.key], dark, `${template.key} · ${token.key} 다크`);
    }
  }
});
