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
  countUiThemeTemplateDiff,
  detectUiThemeTemplate,
  findUiThemeTemplate,
  resolveUiThemeWithTemplate,
  uiThemeTemplateToChanges,
  UI_THEME_TEMPLATES,
  type UiThemeTemplate,
} from "./ui-theme-templates";

/**
 * ============================================================================
 * 색상 톤 템플릿 — 등록부
 * ============================================================================
 * 🔴 이 시험이 이 기능의 절반이다. 템플릿은 화면에 **카드 한 장**으로만 보이고,
 * 값이 틀려도 눈으로는 아무 표시가 나지 않는다. 틀린 값 하나가 하는 일은 딱
 * 하나다 — 고르는 순간 서버가 저장을 거절하거나, 저장에는 성공했는데 전 직원이
 * 화면을 못 읽게 된다. 눌러 보기 전에는 아무도 모른다. 그래서 못 박는다.
 *
 *  1) **빠짐이 없다.** 색 24개가 전부 들어 있고, 등록부에 없는 키가 섞여 있지도
 *     않다. 하나가 빠지면 절반만 바뀐 화면이 된다.
 *  2) **서버 문을 지난다.** 모든 값이 검증기를 그대로 통과하고, 정규화 결과가
 *     적어 둔 값과 **글자까지** 같다(대문자로 적어 두면 「기본으로 되돌렸는데
 *     행이 안 지워지는」 상태가 생긴다).
 *  3) **저장 거절선을 넘는다.** 대비 4쌍이 전부 3:1 이상이다. 실측값을 함께
 *     적어 두어, 나중에 색을 손볼 때 여유가 얼마나 있었는지 보이게 한다.
 *  4) **경고선에 걸리는 짝이 무엇인지 드러난다.** 막지는 않되 목록으로 못 박아,
 *     색을 고치다가 모르는 사이에 늘어나는 것을 막는다.
 *  5) **램프의 라이트/다크가 같다.** 다르면 다크의 카드 바탕과 라이트의 글자가
 *     따로 논다(ui-theme-templates.ts 머리말).
 * ============================================================================
 */

const COLOR_TOKENS: readonly UiThemeToken[] = UI_THEME_TOKENS.filter(
  (token) => token.kind === "color"
);
const COLOR_TOKEN_KEYS: readonly string[] = COLOR_TOKENS.map((token) => token.key);

/** 라이트/다크가 다를 수 있는 유일한 둘. 나머지는 램프다. */
const SCOPED_APART_KEYS: ReadonlySet<string> = new Set(["background", "foreground"]);

function templateByKey(key: string): UiThemeTemplate {
  const found = findUiThemeTemplate(key);
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

function pairKey(scope: string, fgKey: string, bgKey: string): string {
  return `${scope}:${fgKey}:${bgKey}`;
}

// ───────────────────────────────────────────────── 등록부 자기 정합성

test("템플릿의 키와 이름과 팔레트가 저마다 고유하다", () => {
  const keys = UI_THEME_TEMPLATES.map((item) => item.key);
  const names = UI_THEME_TEMPLATES.map((item) => item.name);

  assert.equal(UI_THEME_TEMPLATES.length, 6);
  assert.equal(new Set(keys).size, keys.length, "템플릿 키가 겹친다");
  assert.equal(new Set(names).size, names.length, "템플릿 이름이 겹친다");

  // 팔레트가 똑같은 템플릿이 둘 있으면 판정(detect)이 앞엣것만 돌려주고,
  // 뒤엣것은 골라도 영영 「지금 쓰는 템플릿」으로 표시되지 않는다.
  const palettes = UI_THEME_TEMPLATES.map((item) =>
    COLOR_TOKEN_KEYS.map((key) => item.colors[key].join("/")).join(",")
  );
  assert.equal(new Set(palettes).size, palettes.length, "값이 완전히 같은 템플릿이 둘 있다");

  for (const item of UI_THEME_TEMPLATES) {
    assert.ok(item.name.length > 0, `${item.key}의 이름이 비어 있다`);
    assert.ok(item.description.length > 0, `${item.key}의 설명이 비어 있다`);
  }

  // 되돌아올 자리가 맨 앞이다 — 화면이 그리는 순서가 이 순서다.
  assert.equal(UI_THEME_TEMPLATES[0].key, "default");
});

test("모든 템플릿이 색 24개를 빠짐없이 갖고 모르는 키가 섞여 있지 않다", () => {
  assert.equal(COLOR_TOKEN_KEYS.length, 24);

  for (const template of UI_THEME_TEMPLATES) {
    const keys = Object.keys(template.colors).sort();
    assert.deepEqual(
      keys,
      [...COLOR_TOKEN_KEYS].sort(),
      `${template.key}의 색 목록이 등록부와 다르다`
    );
  }
});

test("모든 템플릿 값이 검증기를 지나고 정규화해도 글자까지 같다", () => {
  // 하나라도 대문자·3자리 hex·oklch 가 섞이면 그 템플릿은 **고르는 순간**
  // 저장이 거절된다. 정규화 결과가 달라지기만 해도 「기본으로 되돌렸는데
  // 행이 안 지워지는」 자리가 생긴다.
  for (const template of UI_THEME_TEMPLATES) {
    for (const token of COLOR_TOKENS) {
      const [light, dark] = template.colors[token.key];
      assert.equal(
        normalizeUiThemeValue(token, light),
        light,
        `${template.key} · ${token.key} 라이트 값이 검증을 통과하지 못하거나 정규화되면서 달라진다`
      );
      assert.equal(
        normalizeUiThemeValue(token, dark),
        dark,
        `${template.key} · ${token.key} 다크 값이 검증을 통과하지 못하거나 정규화되면서 달라진다`
      );
    }
  }
});

test("램프(zinc·red)는 라이트와 다크가 같고, 바탕·본문 글자만 다르다", () => {
  for (const template of UI_THEME_TEMPLATES) {
    for (const token of COLOR_TOKENS) {
      const [light, dark] = template.colors[token.key];
      if (SCOPED_APART_KEYS.has(token.key)) {
        // 이 둘은 애초에 라이트와 다크가 다른 색이다. 같아지면 한쪽 화면이
        // 반드시 깨지므로 「달라야 한다」를 함께 못 박는다.
        assert.notEqual(light, dark, `${template.key} · ${token.key}의 라이트/다크가 같다`);
        continue;
      }
      assert.equal(
        light,
        dark,
        `${template.key} · ${token.key}의 라이트/다크가 다르다 — 램프는 한 벌이어야 한다`
      );
    }
  }

  // 램프가 22개, 따로 가는 것이 2개. 등록부에 색이 늘어 이 숫자가 흔들리면
  // 위의 규칙이 새 색을 어느 쪽으로 다루고 있는지 여기서 먼저 드러난다.
  const rampKeys = COLOR_TOKEN_KEYS.filter((key) => !SCOPED_APART_KEYS.has(key));
  assert.equal(rampKeys.length, 22);
});

test("default 템플릿은 등록부 기본값과 정확히 같다", () => {
  const template = templateByKey("default");
  for (const token of COLOR_TOKENS) {
    assert.deepEqual(
      template.colors[token.key],
      [token.defaultLight, token.defaultDark],
      `default 템플릿의 ${token.key}가 등록부 기본값과 다르다`
    );
  }
});

// ─────────────────────────────────────────────────────────── 대비

test("모든 템플릿이 저장 거절선(3:1)을 넘는다", () => {
  // 🔴 실측값을 그대로 적어 둔다. 색을 손볼 때 여유가 얼마나 있었는지 보이고,
  // 한 칸만 고쳤는데 다른 짝이 함께 움직이면 여기서 걸린다.
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

test("경고선(4.5:1) 미만인 짝은 이것뿐이다", () => {
  // 막지는 않는다. 다만 무엇이 걸려 있는지 목록으로 못 박아 두어야, 색을
  // 고치다가 모르는 사이에 늘어나는 것을 막을 수 있다.
  const found: string[] = [];
  for (const template of UI_THEME_TEMPLATES) {
    const resolved = resolveUiTheme(rowsOf(template));
    for (const pair of UI_THEME_CONTRAST_PAIRS) {
      const ratio = contrastRatio(
        resolved[pair.scope][pair.fgKey],
        resolved[pair.scope][pair.bgKey]
      );
      if (ratio < UI_THEME_CONTRAST_WARN) {
        found.push(`${template.key} · ${pairKey(pair.scope, pair.fgKey, pair.bgKey)} = ${ratio}`);
      }
    }
  }

  // 부드러운 대비는 이름 그대로 대비를 낮추는 템플릿이라 한 짝이 경고선 아래로
  // 내려간다. 기본 팔레트의 같은 짝이 4.62 로 이미 경고선에 붙어 있어서,
  // 대비를 조금이라도 눕히면 반드시 걸리는 자리다.
  assert.deepEqual(found, ["soft-contrast · light:zinc-500:zinc-50 = 3.85"]);
});

// ──────────────────────────────────────────────────── 저장 형태로 바꾸기

test("default 를 저장 형태로 바꾸면 48칸이 전부 value: null 이다", () => {
  const changes = uiThemeTemplateToChanges(templateByKey("default"));

  assert.equal(changes.length, 48, "색 24개 × 라이트/다크 = 48칸이어야 한다");
  for (const change of changes) {
    assert.equal(
      change.value,
      null,
      `${change.tokenKey}(${change.scope})가 기본값인데 값을 저장하려 한다`
    );
  }

  // 저장하면 행이 하나도 남지 않는다 = 이 기능을 넣기 전과 완전히 같은 화면.
  assert.deepEqual(rowsOf(templateByKey("default")), []);
});

test("기본값과 다른 값만 행으로 남고, 그 행을 되풀면 템플릿 값 그대로다", () => {
  for (const template of UI_THEME_TEMPLATES) {
    const changes = uiThemeTemplateToChanges(template);
    assert.equal(changes.length, 48, `${template.key}의 저장 칸 수가 48이 아니다`);

    // 모든 칸이 색 토큰의 라이트/다크다 — 모서리·글자 크기가 섞이면 톤을
    // 골랐는데 크기까지 바뀐다.
    for (const change of changes) {
      assert.ok(
        COLOR_TOKEN_KEYS.includes(change.tokenKey),
        `${template.key}가 색이 아닌 토큰(${change.tokenKey})을 저장하려 한다`
      );
      assert.ok(change.scope === "light" || change.scope === "dark");
    }

    const resolved = resolveUiTheme(rowsOf(template));
    for (const token of COLOR_TOKENS) {
      const [light, dark] = template.colors[token.key];
      assert.equal(resolved.light[token.key], light, `${template.key} · ${token.key} 라이트`);
      assert.equal(resolved.dark[token.key], dark, `${template.key} · ${token.key} 다크`);
    }
  }
});

test("템플릿은 모서리·글자 크기를 건드리지 않는다", () => {
  const shapeTokens = UI_THEME_TOKENS.filter((token) => token.kind !== "color");
  assert.ok(shapeTokens.length > 0);

  // 저장 형태에 모서리·글자 크기 칸이 아예 없다.
  for (const template of UI_THEME_TEMPLATES) {
    const keys = new Set(uiThemeTemplateToChanges(template).map((change) => change.tokenKey));
    for (const token of shapeTokens) {
      assert.ok(!keys.has(token.key), `${template.key}가 ${token.key}까지 저장하려 한다`);
    }
  }

  // 이미 저장돼 있는 모서리·글자 크기는 미리보기에서도 그대로 남는다.
  const saved: UiThemeOverrideRow[] = [{ tokenKey: "radius-md", scope: "both", value: "0" }];
  const preview = resolveUiThemeWithTemplate(saved, templateByKey("high-contrast"));
  assert.equal(preview.light["radius-md"], "0");
  assert.equal(preview.dark["radius-md"], "0");
  assert.equal(preview.light["zinc-900"], "#0e0e11");
  assert.equal(preview.dark.background, "#000000");
});

// ─────────────────────────────────────────────────────────── 판정

test("저장된 행이 없으면 기본 템플릿으로 판정한다", () => {
  const detected = detectUiThemeTemplate([]);
  assert.equal(detected?.key, "default");
  assert.equal(countUiThemeTemplateDiff(templateByKey("default"), []), 0);
});

test("어느 템플릿을 그대로 넣으면 그 템플릿으로 판정한다", () => {
  for (const template of UI_THEME_TEMPLATES) {
    const rows = rowsOf(template);
    assert.equal(detectUiThemeTemplate(rows)?.key, template.key);
    assert.equal(countUiThemeTemplateDiff(template, rows), 0);
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

test("기본 상태에서 각 템플릿까지 몇 칸이 다른지 센다", () => {
  // 화면이 카드에 적는 숫자다. 램프 11단계 × 라이트·다크 = 22칸이 중립을
  // 바꾸는 템플릿의 몫이고, 거기에 바탕·본문 글자가 붙는다.
  const diffs = Object.fromEntries(
    UI_THEME_TEMPLATES.map((template) => [template.key, countUiThemeTemplateDiff(template, [])])
  );

  assert.deepEqual(diffs, {
    default: 0,
    "cool-slate": 25,
    "warm-stone": 25,
    // 고대비는 라이트 바탕만 기본과 같다(둘 다 순백) — 그래서 47.
    "high-contrast": 47,
    "soft-contrast": 48,
    "calm-red": 22,
  });
});

test("등록되지 않은 키로는 템플릿을 찾을 수 없다", () => {
  assert.equal(findUiThemeTemplate("no-such-template"), null);
  assert.equal(findUiThemeTemplate(""), null);
  assert.equal(findUiThemeTemplate("default")?.key, "default");
});
