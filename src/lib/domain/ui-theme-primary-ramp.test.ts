import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contrastRatio,
  normalizeUiThemeValue,
  resolveUiTheme,
  UI_THEME_CONTRAST_FLOOR,
  UI_THEME_CONTRAST_WARN,
  UI_THEME_TOKENS,
  type UiThemeOverrideRow,
  type UiThemeScope,
  type UiThemeToken,
} from "./ui-theme-tokens";
import {
  buildUiThemePrimaryRamp,
  countUiThemePrimaryRampDiff,
  detectUiThemeMainColor,
  findUiThemeMainColor,
  normalizeUiThemePrimarySeed,
  readUiThemePrimaryContrast,
  resolveUiThemeWithPrimaryRamp,
  uiThemePrimaryRampToChanges,
  UI_THEME_MAIN_COLORS,
  UI_THEME_PRIMARY_CONTRAST_PAIRS,
  UI_THEME_PRIMARY_RAMP_KEYS,
  type PrimaryRamp,
} from "./ui-theme-primary-ramp";

/**
 * ============================================================================
 * 메인 컬러 램프 — 생성기
 * ============================================================================
 * 🔴 이 시험이 이 기능의 절반이다. 까닭은 템플릿 시험과 같으면서 한 겹 더 나쁘다 —
 * 서버가 저장을 거절하는 4쌍(UI_THEME_CONTRAST_BLOCKING)에 **강조색이 들어 있지
 * 않다.** 즉 읽을 수 없는 주 버튼은 아무도 막아 주지 않는다. 게다가 관리자는
 * 미리 만든 여덟 중 하나가 아니라 **아무 색이나** 고를 수 있으므로, 표본 몇 개로는
 * 못 박히지 않는다. 그래서 색상환을 통째로 훑는다.
 *
 *  1) **색상환 전체**(36색 × 채도 6단 = 216벌)에서 주 버튼 두 짝이 경고선(4.5)
 *     위에 있고, 값이 검증기를 지나고, 밝기가 단조롭다.
 *  2) 미리 만든 여덟도 같은 검사를 지나고, **실측 대비를 그대로 적어 둔다** —
 *     생성기를 손볼 때 어느 색이 얼마나 움직였는지 여기서 드러난다.
 *  3) 「회색(기본)」은 등록부 값과 글자 하나까지 같고, 저장 형태가 전부
 *     `value: null` 이다(= 고르면 저장된 행이 하나도 남지 않는다).
 *  4) 결정적이다 — 같은 씨앗이면 두 번 불러도 같은 값.
 *  5) 판정(detect)은 저장된 값을 대조해 알아낸다.
 * ============================================================================
 */

const TOKEN_BY_KEY: ReadonlyMap<string, UiThemeToken> = new Map(
  UI_THEME_TOKENS.map((token) => [token.key, token])
);

/** 오버라이드가 하나도 없는 상태의 라이트/다크 한 벌. 대비를 잴 때의 기준이다. */
const DEFAULTS = resolveUiTheme([]);

/** 램프를 「저장했다면 남았을 행」으로 바꾼다. 저장 경로가 만드는 것과 같은 목록이다. */
function rowsOf(ramp: PrimaryRamp): UiThemeOverrideRow[] {
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

function readingOf(ramp: PrimaryRamp, key: string): number {
  const found = readUiThemePrimaryContrast(ramp, DEFAULTS).find(
    (reading) => reading.pair.key === key
  );
  assert.ok(found, `대비 짝 ${key}가 없다`);
  return found.ratio;
}

/**
 * 씨앗 하나. 색상환을 도는 순색이다(HSL 밝기 0.5).
 *
 * 생성기는 씨앗에서 **색상과 채도만** 가져가므로 밝기는 무엇이든 상관없다 —
 * 그 사실 자체를 아래 「씨앗의 밝기는 결과를 바꾸지 않는다」가 못 박는다.
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

/** 한 램프가 지켜야 하는 것 전부. 훑기와 미리 만든 색이 같은 검사를 지난다. */
function assertRampIsSound(ramp: PrimaryRamp, label: string): void {
  assert.deepEqual(
    Object.keys(ramp).sort(),
    [...UI_THEME_PRIMARY_RAMP_KEYS].sort(),
    `${label}: 램프의 단계가 등록부의 강조 토큰과 다르다`
  );

  // ① 서버 문을 지난다. 정규화 결과가 낸 값과 **글자까지** 같아야 한다 —
  //    대문자가 섞이면 「기본으로 되돌렸는데 행이 안 지워지는」 자리가 생긴다.
  for (const key of UI_THEME_PRIMARY_RAMP_KEYS) {
    const token = TOKEN_BY_KEY.get(key);
    assert.ok(token, `${label}: 등록부에 ${key}가 없다`);
    assert.equal(
      normalizeUiThemeValue(token, ramp[key]),
      ramp[key],
      `${label}: ${key} 값이 검증을 통과하지 못하거나 정규화되면서 달라진다`
    );
  }

  // ② 주 버튼의 글씨가 읽힌다. 이 둘이 이 파일의 존재 이유다.
  for (const reading of readUiThemePrimaryContrast(ramp, DEFAULTS)) {
    if (!reading.pair.required) continue;
    assert.ok(
      reading.ratio >= UI_THEME_CONTRAST_WARN,
      `${label}: ${reading.pair.label}이 경고선 미만이다 (${reading.ratio}:1)`
    );
  }

  // ③ 밝기가 단조롭다. 뒤집히면 hover(800)가 원래 색(900)보다 어두워진다.
  let previous = Infinity;
  for (const key of UI_THEME_PRIMARY_RAMP_KEYS) {
    const brightness = contrastRatio(ramp[key], "#000000");
    assert.ok(
      brightness < previous,
      `${label}: ${key}가 앞 단계보다 밝거나 같다 (${brightness} → 앞 ${previous})`
    );
    previous = brightness;
  }
}

// ─────────────────────────────────────────────── 등록부 자기 정합성

test("램프의 단계가 등록부의 강조 토큰 11단과 같다", () => {
  const registryKeys = UI_THEME_TOKENS.filter(
    (token) => token.kind === "color" && token.key.startsWith("primary-")
  ).map((token) => token.key);

  assert.equal(registryKeys.length, 11, "강조 램프가 11단이 아니다");
  assert.deepEqual([...UI_THEME_PRIMARY_RAMP_KEYS], registryKeys);

  // 화면이 띠를 그리는 순서다. 50이 맨 앞(가장 밝은 단계)이어야 한다.
  assert.equal(UI_THEME_PRIMARY_RAMP_KEYS[0], "primary-50");
  assert.equal(UI_THEME_PRIMARY_RAMP_KEYS[UI_THEME_PRIMARY_RAMP_KEYS.length - 1], "primary-950");
});

test("대비 짝은 넷이고 주 버튼 둘만 생성기가 보장한다", () => {
  assert.equal(UI_THEME_PRIMARY_CONTRAST_PAIRS.length, 4);
  const required = UI_THEME_PRIMARY_CONTRAST_PAIRS.filter((pair) => pair.required);
  assert.deepEqual(
    required.map((pair) => pair.key),
    ["light-button", "dark-button"]
  );

  // 짝이 가리키는 단계와 글자 토큰이 등록부에 실제로 있어야 한다 — 없으면
  // 화면이 조용히 그 줄만 빼고 그린다.
  for (const pair of UI_THEME_PRIMARY_CONTRAST_PAIRS) {
    assert.ok(
      UI_THEME_PRIMARY_RAMP_KEYS.includes(pair.bgRampKey),
      `${pair.key}의 바탕 단계 ${pair.bgRampKey}가 램프에 없다`
    );
    if (pair.fg.kind === "token") {
      assert.ok(TOKEN_BY_KEY.has(pair.fg.key), `${pair.key}의 글자 토큰이 등록부에 없다`);
    }
  }
});

test("메인 컬러의 키와 이름과 씨앗이 저마다 고유하다", () => {
  const keys = UI_THEME_MAIN_COLORS.map((item) => item.key);
  const names = UI_THEME_MAIN_COLORS.map((item) => item.name);
  const seeds = UI_THEME_MAIN_COLORS.map((item) => item.seed);

  assert.equal(UI_THEME_MAIN_COLORS.length, 8);
  assert.equal(new Set(keys).size, keys.length, "메인 컬러 키가 겹친다");
  assert.equal(new Set(names).size, names.length, "메인 컬러 이름이 겹친다");
  assert.equal(new Set(seeds).size, seeds.length, "씨앗 색이 겹친다");

  // 램프가 완전히 같은 메인 컬러가 둘 있으면 판정(detect)이 앞엣것만 돌려주고,
  // 뒤엣것은 골라도 영영 「지금 쓰는 색」으로 표시되지 않는다.
  const ramps = UI_THEME_MAIN_COLORS.map((item) =>
    UI_THEME_PRIMARY_RAMP_KEYS.map((key) => item.ramp[key]).join(",")
  );
  assert.equal(new Set(ramps).size, ramps.length, "값이 완전히 같은 메인 컬러가 둘 있다");

  for (const item of UI_THEME_MAIN_COLORS) {
    assert.ok(item.name.length > 0, `${item.key}의 이름이 비어 있다`);
    assert.ok(item.description.length > 0, `${item.key}의 설명이 비어 있다`);
    assert.equal(normalizeUiThemePrimarySeed(item.seed), item.seed, `${item.key}의 씨앗 형식`);
  }

  // 되돌아올 자리가 맨 앞이다 — 화면이 그리는 순서가 이 순서다.
  assert.equal(UI_THEME_MAIN_COLORS[0].key, "neutral");
});

test("등록되지 않은 키로는 메인 컬러를 찾을 수 없다", () => {
  assert.equal(findUiThemeMainColor("no-such-color"), null);
  assert.equal(findUiThemeMainColor(""), null);
  assert.equal(findUiThemeMainColor("blue")?.key, "blue");
});

// ────────────────────────────────────────────────────── 색상환 전체 훑기

test("색상환 36색 × 채도 6단 어디를 골라도 주 버튼이 읽힌다", () => {
  // 🔴 관리자는 아무 색이나 고를 수 있다. 표본 몇 개가 아니라 넓게 훑어야
  // 「어떤 색을 골라도」가 실제로 못 박힌다.
  const saturations = [0.15, 0.35, 0.55, 0.75, 0.9, 1];
  let count = 0;

  for (let hue = 0; hue < 360; hue += 10) {
    for (const saturation of saturations) {
      const seed = seedAt(hue, saturation);
      assertRampIsSound(buildUiThemePrimaryRamp(seed), `${seed}(h=${hue} s=${saturation})`);
      count += 1;
    }
  }

  assert.equal(count, 216);
});

test("색상환을 훑어도 선택된 메뉴가 저장 거절선 위에 남는다", () => {
  // 주 버튼과 달리 생성기가 보장하지 않는 짝이다(글씨가 흐려질 뿐 기능을 잃지
  // 않는다). 그래도 「아예 안 보임」 선(3:1)만은 넘어야 하고, 실측 최저값을
  // 함께 적어 두어 곡선을 손볼 때 여유가 얼마나 있었는지 보이게 한다.
  let worst = Infinity;
  let worstLabel = "";

  for (let hue = 0; hue < 360; hue += 10) {
    for (const saturation of [0.55, 0.9, 1]) {
      const seed = seedAt(hue, saturation);
      const ramp = buildUiThemePrimaryRamp(seed);
      for (const reading of readUiThemePrimaryContrast(ramp, DEFAULTS)) {
        if (reading.pair.required) continue;
        if (reading.ratio < worst) {
          worst = reading.ratio;
          worstLabel = `${seed} · ${reading.pair.key}`;
        }
      }
    }
  }

  assert.ok(
    worst >= UI_THEME_CONTRAST_FLOOR,
    `선택된 메뉴가 저장 거절선 미만이다: ${worstLabel} = ${worst}:1`
  );
  // 가장 나쁜 자리는 순노랑의 다크 선택된 메뉴다 — 노랑은 밝아서 같은 대비를
  // 지키려면 색이 깊어지고, 그만큼 흰 글자 쪽 여유가 줄어든다.
  assert.equal(worstLabel, "#ffff00 · dark-menu");
  assert.equal(worst, 4.49);
});

test("씨앗의 밝기는 램프를 흔들지 않는다 — 색상과 채도만 쓴다", () => {
  // 밝기는 곡선이 정한다. 그래야 어떤 색을 골라도 주 버튼이 주 버튼 자리의
  // 밝기를 갖는다 — 밝은 하늘색을 골랐다고 주 버튼이 하늘색이 되면 흰 글자가
  // 사라진다.
  //
  // 「글자까지 같다」로는 못 박지 않는다. 씨앗이 8비트 hex 이므로 같은 색상·채도를
  // 어느 밝기에서 적어 두느냐에 따라 되읽은 채도가 소수점 아래에서 흔들린다 —
  // 그 흔들림이 램프를 눈에 띄게 움직이지 않는다는 것이 여기서 볼 것이다.
  for (const hue of [0, 45, 120, 210, 300]) {
    const ratios = [0.25, 0.5, 0.75].map((lightness) =>
      readingOf(buildUiThemePrimaryRamp(seedAt(hue, 0.8, lightness)), "light-button")
    );
    const spread = Math.max(...ratios) - Math.min(...ratios);
    assert.ok(spread < 0.5, `h=${hue}: 씨앗 밝기에 따라 주 버튼 대비가 ${spread} 만큼 흔들린다`);
  }
});

test("같은 씨앗이면 언제나 같은 11값이다", () => {
  for (const seed of ["#2563eb", "#ea580c", "#0d9488", "#000000", "#ffffff"]) {
    assert.deepEqual(buildUiThemePrimaryRamp(seed), buildUiThemePrimaryRamp(seed), seed);
  }
});

test("형식이 어긋난 씨앗은 램프를 만들기 전에 걸린다", () => {
  assert.equal(normalizeUiThemePrimarySeed("#ABC"), null);
  assert.equal(normalizeUiThemePrimarySeed("oklch(0.5 0.2 260)"), null);
  assert.equal(normalizeUiThemePrimarySeed(""), null);
  assert.equal(normalizeUiThemePrimarySeed(null), null);
  // 대문자는 소문자로 눕혀서 통과시킨다(<input type="color">가 그렇게 준다).
  assert.equal(normalizeUiThemePrimarySeed("#2563EB"), "#2563eb");

  // 생성기 자신은 던진다 — 여기 오는 값은 이미 검증을 지난 값이어야 한다.
  assert.throws(() => buildUiThemePrimaryRamp("#abc"), /램프를 만들 수 없는 색/);
});

// ────────────────────────────────────────────── 미리 만든 메인 컬러 여덟

test("미리 만든 메인 컬러 여덟이 모두 같은 검사를 지난다", () => {
  for (const mainColor of UI_THEME_MAIN_COLORS) {
    assertRampIsSound(mainColor.ramp, `${mainColor.key}(${mainColor.name})`);
  }
});

test("미리 만든 메인 컬러의 실측 대비와 주 버튼 색", () => {
  // 🔴 실측값을 그대로 적어 둔다. 생성기를 손볼 때 어느 색이 얼마나 움직였는지
  // 여기서 드러나고, 「읽히기는 하는데 눈에 띄게 어두워진」 변화도 숫자로 남는다.
  const expected: Record<string, { button: string; readings: Record<string, number> }> = {
    neutral: {
      button: "#18181b",
      readings: {
        "light-button": 17.72,
        "dark-button": 16.97,
        "light-menu": 16.12,
        "dark-menu": 14.27,
      },
    },
    blue: {
      button: "#1043b3",
      readings: {
        "light-button": 8.48,
        "dark-button": 16.68,
        "light-menu": 16.06,
        "dark-menu": 7.13,
      },
    },
    teal: {
      button: "#085c54",
      readings: {
        "light-button": 7.87,
        "dark-button": 17.31,
        "light-menu": 16.92,
        "dark-menu": 5.4,
      },
    },
    green: {
      button: "#0c5a29",
      readings: {
        "light-button": 8.37,
        "dark-button": 17.26,
        "light-menu": 16.86,
        "dark-menu": 5.87,
      },
    },
    indigo: {
      button: "#261cc9",
      readings: {
        "light-button": 10.04,
        "dark-button": 16.51,
        "light-menu": 15.71,
        "dark-menu": 8.82,
      },
    },
    violet: {
      button: "#5a13d2",
      readings: {
        "light-button": 8.54,
        "dark-button": 16.57,
        "light-menu": 15.84,
        "dark-menu": 7.38,
      },
    },
    fuchsia: {
      button: "#74177f",
      readings: {
        "light-button": 9.67,
        "dark-button": 16.79,
        "light-menu": 15.91,
        "dark-menu": 7.79,
      },
    },
    orange: {
      button: "#903607",
      readings: {
        "light-button": 7.73,
        "dark-button": 16.98,
        "light-menu": 16.25,
        "dark-menu": 6.03,
      },
    },
  };

  for (const mainColor of UI_THEME_MAIN_COLORS) {
    const table = expected[mainColor.key];
    assert.ok(table, `${mainColor.key}의 실측값이 시험에 없다`);
    assert.equal(mainColor.ramp["primary-900"], table.button, `${mainColor.key}의 주 버튼 색`);
    for (const [key, ratio] of Object.entries(table.readings)) {
      assert.equal(readingOf(mainColor.ramp, key), ratio, `${mainColor.key} · ${key}`);
    }
  }
});

test("「회색(기본)」은 등록부의 중립 값과 글자 하나까지 같다", () => {
  const neutral = findUiThemeMainColor("neutral");
  assert.ok(neutral);

  for (const key of UI_THEME_PRIMARY_RAMP_KEYS) {
    const step = key.slice("primary-".length);
    const zinc = TOKEN_BY_KEY.get(`zinc-${step}`);
    const primary = TOKEN_BY_KEY.get(key);
    assert.ok(zinc && primary, `${key}의 짝이 등록부에 없다`);

    // 🔴 씨앗에서 만들지 않고 등록부에서 가져온다. 한 자라도 어긋나면
    // 「기본으로 되돌렸는데 저장된 행이 남는」 상태가 된다.
    assert.equal(neutral.ramp[key], zinc.defaultLight, `${key}가 중립 기본값과 다르다`);
    assert.equal(neutral.ramp[key], primary.defaultLight, `${key}가 강조 기본값과 다르다`);
    assert.equal(neutral.ramp[key], primary.defaultDark, `${key}가 다크 기본값과 다르다`);
  }
});

// ─────────────────────────────────────────────────── 저장 형태로 바꾸기

test("「회색(기본)」을 저장 형태로 바꾸면 22칸이 전부 value: null 이다", () => {
  const neutral = findUiThemeMainColor("neutral");
  assert.ok(neutral);

  const changes = uiThemePrimaryRampToChanges(neutral.ramp);
  assert.equal(changes.length, 22, "강조 11단 × 라이트/다크 = 22칸이어야 한다");
  for (const change of changes) {
    assert.equal(
      change.value,
      null,
      `${change.tokenKey}(${change.scope})가 기본값인데 값을 저장하려 한다`
    );
  }

  // 저장하면 강조색 행이 하나도 남지 않는다 = 메인 컬러를 고르기 전과 같은 화면.
  assert.deepEqual(rowsOf(neutral.ramp), []);
});

test("강조색 22칸만 싣고 중립·경고색과 모서리·글자 크기는 건드리지 않는다", () => {
  for (const mainColor of UI_THEME_MAIN_COLORS) {
    const changes = uiThemePrimaryRampToChanges(mainColor.ramp);
    assert.equal(changes.length, 22, `${mainColor.key}의 저장 칸 수가 22가 아니다`);

    for (const change of changes) {
      assert.ok(
        UI_THEME_PRIMARY_RAMP_KEYS.includes(change.tokenKey),
        `${mainColor.key}가 강조색이 아닌 토큰(${change.tokenKey})을 저장하려 한다`
      );
      assert.ok(change.scope === "light" || change.scope === "dark");
    }

    // 저장했다면 남았을 행을 되풀면 램프 값 그대로다.
    const resolved = resolveUiTheme(rowsOf(mainColor.ramp));
    for (const key of UI_THEME_PRIMARY_RAMP_KEYS) {
      assert.equal(resolved.light[key], mainColor.ramp[key], `${mainColor.key} · ${key} 라이트`);
      assert.equal(resolved.dark[key], mainColor.ramp[key], `${mainColor.key} · ${key} 다크`);
    }
  }
});

test("미리보기는 강조색만 덮고 저장된 중립·모서리는 그대로 남는다", () => {
  const saved: UiThemeOverrideRow[] = [
    { tokenKey: "radius-md", scope: "both", value: "0" },
    { tokenKey: "zinc-900", scope: "light", value: "#123456" },
  ];
  const blue = findUiThemeMainColor("blue");
  assert.ok(blue);

  const preview = resolveUiThemeWithPrimaryRamp(saved, blue.ramp);
  assert.equal(preview.light["radius-md"], "0");
  assert.equal(preview.dark["radius-md"], "0");
  assert.equal(preview.light["zinc-900"], "#123456");
  assert.equal(preview.light["primary-900"], blue.ramp["primary-900"]);
  assert.equal(preview.dark["primary-900"], blue.ramp["primary-900"]);
});

// ─────────────────────────────────────────────────────────── 판정

test("저장된 행이 없으면 「회색(기본)」으로 판정한다", () => {
  const detected = detectUiThemeMainColor([]);
  assert.equal(detected?.key, "neutral");

  const neutral = findUiThemeMainColor("neutral");
  assert.ok(neutral);
  assert.equal(countUiThemePrimaryRampDiff(neutral.ramp, []), 0);
});

test("어느 메인 컬러를 그대로 넣으면 그 색으로 판정한다", () => {
  for (const mainColor of UI_THEME_MAIN_COLORS) {
    const rows = rowsOf(mainColor.ramp);
    assert.equal(detectUiThemeMainColor(rows)?.key, mainColor.key);
    assert.equal(countUiThemePrimaryRampDiff(mainColor.ramp, rows), 0);
  }
});

test("한 칸만 달라도 판정은 null 이다 — 「직접 고른 색」", () => {
  const blue = findUiThemeMainColor("blue");
  assert.ok(blue);
  const rows = rowsOf(blue.ramp);

  const target = rows.findIndex((row) => row.tokenKey === "primary-900" && row.scope === "light");
  assert.ok(target >= 0, "파랑이 주 버튼 단계를 저장하지 않는다");

  const tweaked = rows.map((row, index) => (index === target ? { ...row, value: "#123456" } : row));
  assert.equal(detectUiThemeMainColor(tweaked), null);
  assert.equal(countUiThemePrimaryRampDiff(blue.ramp, tweaked), 1);

  // 기본값으로 돌아온 자리 하나(행 삭제)도 마찬가지로 「직접 고른 색」이다.
  const removed = rows.filter((_, index) => index !== target);
  assert.equal(detectUiThemeMainColor(removed), null);
  assert.equal(countUiThemePrimaryRampDiff(blue.ramp, removed), 1);
});

test("기본 상태에서 각 메인 컬러까지 몇 칸이 다른지 센다", () => {
  // 화면이 카드에 적는 숫자다. 「기본」만 0이고 나머지는 22칸(11단 × 라이트·다크)
  // 전부가 바뀐다 — 강조 램프는 한 단계도 겹치지 않는다.
  const diffs = Object.fromEntries(
    UI_THEME_MAIN_COLORS.map((item) => [item.key, countUiThemePrimaryRampDiff(item.ramp, [])])
  );

  assert.deepEqual(diffs, {
    neutral: 0,
    blue: 22,
    teal: 22,
    green: 22,
    indigo: 22,
    violet: 22,
    fuchsia: 22,
    orange: 22,
  });
});

test("중립을 손봐도 강조색 판정은 흔들리지 않는다", () => {
  // 톤 템플릿으로 중립을 바꾼 상태에서도 「지금 쓰는 메인 컬러」는 강조색만
  // 보고 판정해야 한다 — 두 화면이 서로의 표시를 흐리면 어느 쪽도 못 믿는다.
  const blue = findUiThemeMainColor("blue");
  assert.ok(blue);
  const rows: UiThemeOverrideRow[] = [
    ...rowsOf(blue.ramp),
    { tokenKey: "zinc-900", scope: "light", value: "#0f172b" },
    { tokenKey: "red-600", scope: "dark", value: "#c64b42" },
  ];
  assert.equal(detectUiThemeMainColor(rows)?.key, "blue");
});
