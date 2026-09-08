import {
  contrastRatio,
  normalizeUiThemeValue,
  resolveUiTheme,
  UI_THEME_CONTRAST_WARN,
  UI_THEME_TOKENS,
  type UiThemeOverrideRow,
  type UiThemeToken,
} from "./ui-theme-tokens";
import { uiThemeDefaultFor, type UiThemeTokenChange } from "@/lib/validation/ui-theme-token-input";

/**
 * ============================================================================
 * 메인 컬러 — 색 하나에서 강조(primary) 램프 11단을 만든다
 * ============================================================================
 * 색상 톤 템플릿(ui-theme-templates.ts)이 **중립**을 한 벌 갈아 끼우는 자리라면,
 * 여기는 **강조색 하나**를 고르는 자리다. 관리자가 고르는 것은 색 하나이고,
 * 저장되는 것은 강조 램프 11단 × 라이트·다크 = 22칸이다.
 *
 * ── 🔴 새로 저장되는 것은 없다 ──────────────────────────────────────────
 * 표도 열도 만들지 않는다. 「지금 무슨 메인 컬러를 쓰는가」는 저장하지 않고
 * **저장된 값을 대조해** 알아낸다(detectUiThemeMainColor) — 톤 템플릿과 같은
 * 설계다. 이름을 따로 기억해 두면 색 화면에서 한 칸을 손으로 고친 날 이름과
 * 값이 어긋나고, 그때 어느 쪽이 옳은지 알 방법이 없다.
 *
 * ── 램프를 어떻게 만드는가 ──────────────────────────────────────────────
 * ① **밝기 곡선은 등록부의 zinc 11단에서 읽는다.** 이 앱이 실제로 어느 자리에
 *    어느 단계를 쓰는지 이미 검증된 곡선이고(50이 가장 연한 바탕, 900이 주 버튼),
 *    숫자 11개를 손으로 적어 두면 기본 팔레트를 손보는 날 두 벌이 어긋난다.
 *    곡선은 zinc 각 단계의 HSL 밝기를 0(가장 밝은 단계) ~ 1(가장 어두운 단계)로
 *    **정규화한 위치**로만 쓴다 — 값이 아니라 간격이 곡선이다.
 * ② **고른 색에서는 색상(hue)과 채도(saturation)만 가져온다.** 씨앗의 밝기는
 *    버린다 — 밝기는 곡선이 정하고, 그래야 어떤 색을 골라도 주 버튼이 주 버튼
 *    자리의 밝기를 갖는다.
 * ③ 🔴 **곡선의 어두운 끝은 채도만큼 들어 올린다.** zinc-900 은 밝기 10% 다.
 *    그 자리에 색을 그대로 얹으면 **어떤 색을 골라도 거의 검정**이 되어(파랑을
 *    골라도 #04122f), 「메인 컬러를 골랐는데 버튼은 그대로 검정」이 된다. 그래서
 *    주 버튼 단계(primary-900)의 목표를 **흰 글자와 7:1**(WCAG AAA)이 되는 가장
 *    밝은 색으로 잡고, 채도가 0이면 zinc 그대로 · 채도가 1이면 그 목표까지
 *    선형으로 옮긴다. 회색을 고르면 정확히 zinc 곡선으로 돌아온다.
 *    나머지 열 단계는 그 두 끝점 사이의 **같은 간격**으로 다시 놓는다(아핀
 *    변환이라 곡선의 모양이 그대로 남는다).
 * ④ 🔴 **만든 뒤 실제로 잰다.** 목표가 7:1 이어도 8비트로 떨어뜨리는 순간
 *    값이 조금 움직이고, 나중에 등록부의 기본 팔레트를 손보면 곡선 자체가
 *    바뀐다. 그래서 아래 두 짝을 **재서** 경고선(4.5) 밑이면 넘을 때까지
 *    끝점을 옮긴다 — 끝점을 옮기므로 램프 전체가 함께 움직이고, 한 단계만
 *    억지로 밀어 순서가 뒤집히는 일이 없다.
 * ⑤ 마지막으로 **앞 단계보다 반드시 어둡게** 다듬는다. 순서가 뒤집히면 hover
 *    (primary-800)가 원래 색(primary-900)보다 어두워지는 식으로 화면이 이상해진다.
 *
 * ── 🔴 이 램프가 스스로 읽힘을 책임진다 ─────────────────────────────────
 * 서버가 저장을 거절하는 4쌍(UI_THEME_CONTRAST_BLOCKING)에 강조색은 **들어 있지
 * 않다.** 즉 읽을 수 없는 주 버튼을 서버가 막아 주지 않는다. 막아 주는 것은
 * 이 파일과 ui-theme-primary-ramp.test.ts 뿐이고, 그래서 그 시험이 이 기능의
 * 절반이다.
 *
 * ── 색 라이브러리를 쓰지 않는다 ─────────────────────────────────────────
 * 이 저장소는 clsx 조차 쓰지 않는다. HSL ↔ sRGB 변환은 아래 30줄이 전부이고,
 * 휘도는 **등록부의 contrastRatio 를 그대로 쓴다** — 검정과의 대비는 상대휘도의
 * 단조증가 함수라서 밝기 순서를 재는 데 그대로 쓸 수 있고, WCAG 식을 두 벌
 * 적지 않아도 된다.
 * ============================================================================
 */

/** 논리 키("primary-900") → `#rrggbb`. 라이트/다크가 같은 한 벌이다. */
export type PrimaryRamp = Readonly<Record<string, string>>;

/** 미리 만들어 둔 메인 컬러 하나. `ramp` 는 씨앗에서 **생성기가** 만든다. */
export type UiThemeMainColor = {
  key: string;
  /** 화면에 보일 한글 이름 */
  name: string;
  /** 카드에 한 줄로 붙는 설명 */
  description: string;
  /**
   * 씨앗 색. **색상과 채도만** 쓰이고 밝기는 버려진다 — 카드에 값을 적지 않는
   * 이유도 그것이다(적으면 "이 색이 버튼 색"으로 읽힌다).
   */
  seed: string;
  ramp: PrimaryRamp;
};

// ────────────────────────────────────────────────────────── 등록부에서 읽기

const PRIMARY_PREFIX = "primary-";
const NEUTRAL_PREFIX = "zinc-";

/** 주 버튼이 앉는 단계. 어두운 끝의 목표를 이 단계로 잡는다. */
const ACCENT_ANCHOR_KEY = "primary-900";

/** 라이트 주 버튼의 글자. Tailwind `text-white` 라 등록부 토큰이 아니다. */
export const UI_THEME_PRIMARY_ON_LIGHT = "#ffffff";

const TOKEN_BY_KEY: ReadonlyMap<string, UiThemeToken> = new Map(
  UI_THEME_TOKENS.map((token) => [token.key, token])
);

/**
 * 강조 램프에 들어가는 토큰. 등록부에서 **매번 골라 낸다** — 목록을 여기 한 번
 * 더 적어 두면 단계가 늘어난 날 그 단계만 조용히 빠진 채로 "램프를 다 만들었다"고
 * 말하게 된다.
 *
 * 짝이 되는 중립(zinc) 단계가 없는 강조 단계는 곡선을 읽을 데가 없으므로
 * 제외한다. 그런 단계가 생기면 시험이 먼저 잡는다(램프 키 = 등록부의 강조 토큰).
 */
const PRIMARY_TOKENS: readonly UiThemeToken[] = UI_THEME_TOKENS.filter(
  (token) =>
    token.kind === "color" &&
    token.key.startsWith(PRIMARY_PREFIX) &&
    TOKEN_BY_KEY.has(`${NEUTRAL_PREFIX}${token.key.slice(PRIMARY_PREFIX.length)}`)
);

/** 화면이 띠를 그릴 때 쓰는 단계 순서. 등록부 순서 그대로다. */
export const UI_THEME_PRIMARY_RAMP_KEYS: readonly string[] = PRIMARY_TOKENS.map(
  (token) => token.key
);

/** 씨앗 색을 검증할 때 쓰는 토큰. 색 형식은 어느 색 토큰이나 같다. */
const SEED_TOKEN: UiThemeToken | undefined =
  TOKEN_BY_KEY.get(ACCENT_ANCHOR_KEY) ?? UI_THEME_TOKENS.find((token) => token.kind === "color");

/**
 * 씨앗 색을 정규화한다. 화면이 사람이 친 글자를 그대로 넘기므로, 램프를 만들기
 * 전에 여기서 한 번 거른다 — 생성기는 형식이 어긋난 값을 받으면 던진다.
 */
export function normalizeUiThemePrimarySeed(raw: unknown): string | null {
  return SEED_TOKEN ? normalizeUiThemeValue(SEED_TOKEN, raw) : null;
}

// ────────────────────────────────────────────────────────── sRGB ↔ HSL

const HEX_PATTERN = /^#[0-9a-f]{6}$/;

function channelsOf(hex: string): [number, number, number] {
  const lowered = hex.trim().toLowerCase();
  if (!HEX_PATTERN.test(lowered)) {
    // contrastRatio 와 같은 태도다 — 여기 오는 값은 이미 검증을 지난 값이어야
    // 하고, 아니라면 판정할 대상이 아니라 고쳐야 할 버그다.
    throw new Error(`램프를 만들 수 없는 색이다(#rrggbb 여섯 자리만 받는다): ${hex}`);
  }
  return [
    Number.parseInt(lowered.slice(1, 3), 16) / 255,
    Number.parseInt(lowered.slice(3, 5), 16) / 255,
    Number.parseInt(lowered.slice(5, 7), 16) / 255,
  ];
}

/** 0~1 채널 셋을 소문자 hex 여섯 자리로. 정규화 왕복이 어긋나지 않는 유일한 표기다. */
function hexOf(channels: readonly [number, number, number]): string {
  return `#${channels
    .map((value) => {
      const byte = Math.round(Math.min(1, Math.max(0, value)) * 255);
      return byte.toString(16).padStart(2, "0");
    })
    .join("")}`;
}

/** HSL 밝기(0~1). 색상·채도와 무관하게 "가장 밝은 채널과 가장 어두운 채널의 가운데"다. */
function lightnessOf(hex: string): number {
  const [r, g, b] = channelsOf(hex);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

/** 색상(0~360)과 채도(0~1). 밝기는 쓰지 않으므로 돌려주지 않는다. */
function hueAndSaturationOf(hex: string): { hue: number; saturation: number } {
  const [r, g, b] = channelsOf(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0 };

  const lightness = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));

  let hue: number;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;

  return { hue, saturation };
}

/**
 * 색상·채도·밝기로 색 하나를 만든다. 표준 HSL → sRGB 변환 그대로다.
 *
 * 채널은 밝기에 대해 **단조증가**한다(어느 구간에서도 기울기가 0 이상). 그래서
 * 밝기를 올리면 휘도가 절대 내려가지 않고, 아래의 이분 탐색과 단조 보정이
 * 성립한다.
 */
function hslToHex(hue: number, saturation: number, lightness: number): string {
  const l = Math.min(1, Math.max(0, lightness));
  const s = Math.min(1, Math.max(0, saturation));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const sector = ((((hue % 360) + 360) % 360) / 60) % 6;
  const x = c * (1 - Math.abs((sector % 2) - 1));
  const m = l - c / 2;

  let rgb: [number, number, number];
  if (sector < 1) rgb = [c, x, 0];
  else if (sector < 2) rgb = [x, c, 0];
  else if (sector < 3) rgb = [0, c, x];
  else if (sector < 4) rgb = [0, x, c];
  else if (sector < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return hexOf([rgb[0] + m, rgb[1] + m, rgb[2] + m]);
}

/**
 * 밝기 순서를 재는 자(尺). 검정과의 대비는 상대휘도의 단조증가 함수라서
 * "어느 쪽이 더 밝은가"를 그대로 말해 준다 — WCAG 식을 이 파일에 다시 적지
 * 않으려고 등록부의 contrastRatio 를 그대로 쓴다.
 */
const BLACK = "#000000";
function brightnessOf(hex: string): number {
  return contrastRatio(hex, BLACK);
}

// ──────────────────────────────────────────────────────────── 곡선과 끝점

/** 강조 단계에 짝이 되는 중립 단계의 색. 곡선을 여기서 읽는다. */
function neutralOf(primaryKey: string): UiThemeToken | undefined {
  return TOKEN_BY_KEY.get(`${NEUTRAL_PREFIX}${primaryKey.slice(PRIMARY_PREFIX.length)}`);
}

/**
 * zinc 에서 읽은 곡선.
 *
 *   · `position` — 값이 아니라 **자리**다. 0이 가장 밝은 단계, 1이 가장 어두운
 *     단계이고, 그 사이 간격이 zinc 램프의 간격 그대로다.
 *   · `lightEnd` — 가장 밝은 단계의 밝기. 라이트 쪽 시작점이다.
 *   · `anchorLightness` — 주 버튼 단계의 zinc 밝기. 채도가 0이면 램프가 정확히
 *     여기로 돌아온다(= 회색을 고르면 zinc 곡선 그대로).
 *   · `anchorPosition` — 곡선 위에서 주 버튼 단계가 있는 자리.
 */
const CURVE = buildCurve();

function buildCurve(): {
  position: ReadonlyMap<string, number>;
  lightEnd: number;
  anchorLightness: number;
  anchorPosition: number;
} {
  const lightness = new Map<string, number>();
  for (const token of PRIMARY_TOKENS) {
    const neutral = neutralOf(token.key);
    if (neutral) lightness.set(token.key, lightnessOf(neutral.defaultLight));
  }

  const values = [...lightness.values()];
  // 등록부에 강조 램프가 없는 상황은 시험이 막는다. 그래도 여기서 나눗셈이
  // 터지면 앱 전체가 안 뜨므로, 값이 없을 때의 자리만 잡아 둔다.
  const brightest = values.length > 0 ? Math.max(...values) : 1;
  const darkest = values.length > 0 ? Math.min(...values) : 0;
  const span = brightest - darkest;

  const position = new Map<string, number>();
  for (const [key, value] of lightness) {
    position.set(key, span === 0 ? 0 : (brightest - value) / span);
  }

  return {
    position,
    lightEnd: brightest,
    anchorLightness: lightness.get(ACCENT_ANCHOR_KEY) ?? darkest,
    anchorPosition: position.get(ACCENT_ANCHOR_KEY) ?? 1,
  };
}

/**
 * 주 버튼이 겨냥하는 대비. WCAG AAA 본문 기준이다.
 *
 * 경고선(4.5)을 겨냥하지 않는 이유: 그 선에 바짝 붙여 만들면 색을 조금만 밝게
 * 골라도 화면이 경고를 띄우고, 그 경고는 실제로 못 읽는 상태가 아니라서
 * "무시하는 법"만 배우게 된다. 7:1 은 흰 글자를 얹는 넓은 색면에 어울리는
 * 여유이면서, 고른 색이 색으로 보일 만큼은 밝은 자리다.
 */
const ACCENT_CONTRAST_AIM = 7;

/**
 * 이 색상·채도에서 **흰 글자와 목표 대비를 지키는 가장 밝은 밝기**.
 *
 * 채널이 밝기에 대해 단조증가하므로 대비는 단조감소한다 — 그래서 이분 탐색이
 * 성립한다. 재는 것은 8비트로 떨어뜨린 실제 색이다(계산상의 색이 아니라).
 */
function accentAnchorLightness(hue: number, saturation: number): number {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (contrastRatio(UI_THEME_PRIMARY_ON_LIGHT, hslToHex(hue, saturation, mid)) >= ACCENT_CONTRAST_AIM) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

// ───────────────────────────────────────────────────────────── 램프 만들기

/** 끝점을 옮기는 보폭과 횟수. 흰색·검정에 닿기 전에 반드시 조건을 만족한다. */
const GUARD_STEP = 0.01;
const GUARD_MAX = 120;

/** 단조 보정의 보폭과 횟수. 8비트 반올림이 두 단계를 같은 값으로 만들 때만 돈다. */
const MONOTONIC_STEP = 0.002;
const MONOTONIC_MAX = 60;

function rampFromAnchors(
  hue: number,
  saturation: number,
  lightEnd: number,
  darkEnd: number
): Record<string, string> {
  const ramp: Record<string, string> = {};
  let previous: string | null = null;

  for (const token of PRIMARY_TOKENS) {
    const position = CURVE.position.get(token.key) ?? 0;
    // 아핀 변환이라 곡선의 **간격**이 그대로 남는다. 두 끝점만 움직인다.
    const scaled = CURVE.anchorPosition === 0 ? 0 : position / CURVE.anchorPosition;
    let lightness = lightEnd + (darkEnd - lightEnd) * scaled;
    let hex = hslToHex(hue, saturation, lightness);

    // 앞 단계보다 반드시 어둡게. 8비트로 떨어뜨리면서 두 단계가 같은 값이 되는
    // 자리에서만 돈다 — 순서가 뒤집히면 hover 가 원래 색보다 어두워진다.
    for (let i = 0; previous !== null && i < MONOTONIC_MAX; i += 1) {
      if (brightnessOf(hex) < brightnessOf(previous)) break;
      lightness = Math.max(0, lightness - MONOTONIC_STEP);
      hex = hslToHex(hue, saturation, lightness);
    }

    ramp[token.key] = hex;
    previous = hex;
  }

  return ramp;
}

/**
 * 색 하나로 강조 램프 11단을 만든다.
 *
 * 결정적이다 — 같은 씨앗이면 언제나 같은 11값이고, 값은 전부 소문자 hex 여섯
 * 자리라 normalizeUiThemeValue 를 지나도 글자 하나 달라지지 않는다.
 */
export function buildUiThemePrimaryRamp(seed: string): PrimaryRamp {
  const { hue, saturation } = hueAndSaturationOf(seed);

  // 어두운 끝: 채도가 0이면 zinc 그대로, 1이면 "흰 글자와 7:1이 되는 가장 밝은
  // 색"까지. 그 사이는 선형이다 — 회색을 고르면 정확히 zinc 곡선으로 돌아오고,
  // 색을 진하게 고를수록 주 버튼이 색으로 보인다.
  const aim = Math.max(CURVE.anchorLightness, accentAnchorLightness(hue, saturation));
  let darkEnd = CURVE.anchorLightness + saturation * (aim - CURVE.anchorLightness);
  let lightEnd = CURVE.lightEnd;

  let ramp = rampFromAnchors(hue, saturation, lightEnd, darkEnd);

  // 🔴 여기서부터는 **잰 값**이다. 끝점을 옮기면 램프 전체가 함께 움직이므로
  // 한 단계만 억지로 밀어 순서가 뒤집히는 일이 없다. 끝까지 밀면 검정·흰색이
  // 되고 그 둘은 반드시 조건을 넘으므로, 이 두 고리는 항상 끝난다.
  const anchorKey = ACCENT_ANCHOR_KEY in ramp ? ACCENT_ANCHOR_KEY : null;
  const lightestKey = UI_THEME_PRIMARY_RAMP_KEYS[0];

  if (anchorKey) {
    for (let i = 0; i < GUARD_MAX; i += 1) {
      if (contrastRatio(UI_THEME_PRIMARY_ON_LIGHT, ramp[anchorKey]) >= UI_THEME_CONTRAST_WARN) break;
      darkEnd = Math.max(0, darkEnd - GUARD_STEP);
      ramp = rampFromAnchors(hue, saturation, lightEnd, darkEnd);
    }
  }

  if (lightestKey) {
    for (let i = 0; i < GUARD_MAX; i += 1) {
      if (contrastRatio(uiThemePrimaryTextOnDark(), ramp[lightestKey]) >= UI_THEME_CONTRAST_WARN) {
        break;
      }
      lightEnd = Math.min(1, lightEnd + GUARD_STEP);
      ramp = rampFromAnchors(hue, saturation, lightEnd, darkEnd);
    }
  }

  return ramp;
}

/**
 * 다크 주 버튼의 글자색(`dark:text-zinc-900`). 생성기는 **등록부 기본값**으로
 * 잰다 — 램프는 씨앗 하나만으로 결정돼야 하고(같은 씨앗이면 언제나 같은 값),
 * 중립까지 손본 화면의 실제 대비는 화면이 저장된 값으로 다시 잰다.
 */
function uiThemePrimaryTextOnDark(): string {
  return TOKEN_BY_KEY.get(`${NEUTRAL_PREFIX}900`)?.defaultDark ?? "#18181b";
}

/**
 * 등록부 기본값 그대로의 램프.
 *
 * 🔴 씨앗에서 만들지 않는다. 회색 씨앗에서 만들면 순수한 회색이 나오는데
 * zinc 는 아주 옅은 푸른 기가 있어(#9f9fa9) 값이 미세하게 어긋나고, 그러면
 * 「기본으로 되돌렸는데 저장된 행이 남는」 상태가 된다.
 */
function registryPrimaryRamp(): PrimaryRamp {
  const ramp: Record<string, string> = {};
  for (const token of PRIMARY_TOKENS) {
    const neutral = neutralOf(token.key);
    ramp[token.key] = neutral ? neutral.defaultLight : token.defaultLight;
  }
  return ramp;
}

// ────────────────────────────────────────────── 미리 만들어 둔 메인 컬러

/**
 * 고를 수 있는 메인 컬러 여덟. 화면에 나오는 순서가 이 순서다.
 *
 * 🔴 램프를 손으로 적지 않는다 — 씨앗 하나만 적고 생성기가 만든다. 11값을 적어
 * 두면 두 벌이 되고, 생성기를 손보는 날 카드의 띠와 저장되는 값이 어긋난다.
 *
 * 씨앗은 Tailwind v4 팔레트의 600 단계에서 가져왔다(색상과 채도만 쓰이므로
 * 몇 단계를 골랐는지는 결과에 남지 않는다). 「기본」이 맨 앞이다 — 되돌아올
 * 자리는 언제나 먼저 보여야 한다.
 */
export const UI_THEME_MAIN_COLORS: readonly UiThemeMainColor[] = [
  {
    key: "neutral",
    name: "회색 (기본)",
    description:
      "지금 앱이 쓰는 기본 강조색입니다. 주 버튼과 선택된 메뉴가 중립색(검정 계열)으로 돌아갑니다.",
    seed: "#71717b",
    ramp: registryPrimaryRamp(),
  },
  {
    key: "blue",
    name: "파랑",
    description: "가장 무난한 강조색입니다. 주 버튼이 짙은 파랑이 되고 선택된 메뉴가 옅게 물듭니다.",
    seed: "#2563eb",
    ramp: buildUiThemePrimaryRamp("#2563eb"),
  },
  {
    key: "teal",
    name: "청록",
    description: "파랑보다 차분하고 초록보다 차갑습니다. 경고색(빨강)과 가장 멀리 떨어진 색입니다.",
    seed: "#0d9488",
    ramp: buildUiThemePrimaryRamp("#0d9488"),
  },
  {
    key: "green",
    name: "초록",
    description: "완료·정상을 떠올리게 하는 색입니다. 상태 표시와 겹쳐 보일 수 있으니 함께 보고 정하세요.",
    seed: "#16a34a",
    ramp: buildUiThemePrimaryRamp("#16a34a"),
  },
  {
    key: "indigo",
    name: "남색",
    description: "파랑보다 어둡고 보라 쪽으로 기울어 있습니다. 회색 화면에 가장 얌전히 얹힙니다.",
    seed: "#4f46e5",
    ramp: buildUiThemePrimaryRamp("#4f46e5"),
  },
  {
    key: "violet",
    name: "보라",
    description: "또렷하지만 차갑지 않습니다. 주 버튼이 눈에 잘 들어옵니다.",
    seed: "#7c3aed",
    ramp: buildUiThemePrimaryRamp("#7c3aed"),
  },
  {
    key: "fuchsia",
    name: "자주",
    description: "보라와 빨강 사이입니다. 경고색과 인상이 가까우니 다크 화면에서 함께 확인하세요.",
    seed: "#c026d3",
    ramp: buildUiThemePrimaryRamp("#c026d3"),
  },
  {
    key: "orange",
    name: "주황",
    description: "가장 따뜻한 강조색입니다. 흰 글자를 얹으려면 색이 깊어져 벽돌빛에 가까워집니다.",
    seed: "#ea580c",
    ramp: buildUiThemePrimaryRamp("#ea580c"),
  },
];

const MAIN_COLOR_BY_KEY: ReadonlyMap<string, UiThemeMainColor> = new Map(
  UI_THEME_MAIN_COLORS.map((item) => [item.key, item])
);

/** 키로 메인 컬러를 찾는다. 없으면 null — 모르는 키로 화면이 멈추지 않게 한다. */
export function findUiThemeMainColor(key: string): UiThemeMainColor | null {
  return MAIN_COLOR_BY_KEY.get(key) ?? null;
}

// ────────────────────────────────────────────────────── 저장 형태로 바꾸기

/**
 * 램프를 저장 형태로 바꾼다. 강조 11단 × 라이트·다크 = 22칸이다.
 *
 * 🔴 기본값과 같은 값은 `value: null`(행 삭제)로 나간다. 이 판정을 화면이 따로
 * 하면 두 벌이 되고, 한쪽만 고쳐지는 날 「기본으로 되돌렸는데 행이 안 지워지는」
 * 상태가 생긴다 — 그러면 나중에 기본 팔레트를 손볼 때 옛 값이 오버라이드로
 * 굳어 아무 화면도 따라 바뀌지 않는다(ui-theme-templates.ts 와 같은 규율).
 *
 * 강조색 칸을 **전부** 싣는다. 지금 저장된 값과 견주어 달라진 것만 싣지 않는
 * 이유는, 기본값으로 돌아가는 칸도 「행을 지워라」라는 뜻으로 실려야 하기
 * 때문이다.
 */
export function uiThemePrimaryRampToChanges(ramp: PrimaryRamp): UiThemeTokenChange[] {
  const changes: UiThemeTokenChange[] = [];
  for (const token of PRIMARY_TOKENS) {
    const value = ramp[token.key];
    if (typeof value !== "string") continue;
    for (const scope of ["light", "dark"] as const) {
      const fallback = uiThemeDefaultFor(token, scope);
      changes.push({ tokenKey: token.key, scope, value: value === fallback ? null : value });
    }
  }
  return changes;
}

/**
 * 저장된 값과 이 램프가 **몇 칸** 다른가.
 *
 * 강조색 칸만 센다 — 이 화면이 정하지 않는 중립·경고색까지 세면 「고를 것이
 * 없는데 다르다고 적힌」 숫자가 된다.
 */
export function countUiThemePrimaryRampDiff(
  ramp: PrimaryRamp,
  rows: readonly UiThemeOverrideRow[]
): number {
  const resolved = resolveUiTheme(rows);
  let count = 0;
  for (const token of PRIMARY_TOKENS) {
    const value = ramp[token.key];
    if (typeof value !== "string") continue;
    if (resolved.light[token.key] !== value) count += 1;
    if (resolved.dark[token.key] !== value) count += 1;
  }
  return count;
}

/**
 * 지금 저장된 값이 어느 메인 컬러인가. 어느 것과도 다르면 null(= 직접 고른 색).
 *
 * 🔴 저장하지 않고 **값을 대조해** 알아낸다(detectUiThemeTemplate 과 같은 방식).
 */
export function detectUiThemeMainColor(
  rows: readonly UiThemeOverrideRow[]
): UiThemeMainColor | null {
  for (const mainColor of UI_THEME_MAIN_COLORS) {
    if (countUiThemePrimaryRampDiff(mainColor.ramp, rows) === 0) return mainColor;
  }
  return null;
}

/**
 * 저장된 값 위에 강조 램프만 얹은 한 벌. 미리보기와 대비 계산이 같은 것을 본다.
 *
 * 🔴 강조색만 덮는다. 중립·경고색과 모서리·글자 크기는 **저장된 값 그대로**
 * 남는다 — 견본이 기본 중립으로 그려지면, 톤을 고쳐 둔 관리자에게는 「메인
 * 컬러가 톤까지 되돌린다」로 읽힌다.
 */
export function resolveUiThemeWithPrimaryRamp(
  rows: readonly UiThemeOverrideRow[],
  ramp: PrimaryRamp
): { light: Record<string, string>; dark: Record<string, string> } {
  const resolved = resolveUiTheme(rows);
  const light = { ...resolved.light };
  const dark = { ...resolved.dark };
  for (const token of PRIMARY_TOKENS) {
    const value = ramp[token.key];
    if (typeof value !== "string") continue;
    light[token.key] = value;
    dark[token.key] = value;
  }
  return { light, dark };
}

// ──────────────────────────────────────────────────────────── 대비 짝

/**
 * 강조색이 실제로 글자와 겹치는 자리.
 *
 * 등록부의 UI_THEME_CONTRAST_PAIRS 에는 강조색 짝이 없다 — 그 목록은 중립·경고를
 * 재고, 서버의 저장 거절선도 거기서 나온다. 강조색은 **아무도 막아 주지 않으므로**
 * 여기 적어 두고 화면과 시험이 같은 목록을 본다.
 *
 * `required` 인 둘은 주 버튼이다. 이 둘이 4.5 미만이면 버튼의 글씨가 안 보이고,
 * 그래서 생성기가 그 둘만은 재서 보장한다. 나머지 둘(선택된 메뉴)은 글씨가
 * 흐려질 뿐 기능을 잃지 않아 화면에 숫자로만 적는다.
 */
export type UiThemePrimaryContrastPair = {
  key: string;
  scope: "light" | "dark";
  label: string;
  /** 글자색. 등록부 토큰이 아닌 고정색(흰색)이 하나 있다. */
  fg: { kind: "fixed"; value: string } | { kind: "token"; key: string };
  /** 바탕이 되는 강조 램프의 단계. */
  bgRampKey: string;
  /** 생성기가 보장하는 짝인가. */
  required: boolean;
};

export const UI_THEME_PRIMARY_CONTRAST_PAIRS: readonly UiThemePrimaryContrastPair[] = [
  {
    key: "light-button",
    scope: "light",
    label: "라이트 · 흰 글자 / 주 버튼 바탕",
    fg: { kind: "fixed", value: UI_THEME_PRIMARY_ON_LIGHT },
    bgRampKey: "primary-900",
    required: true,
  },
  {
    key: "dark-button",
    scope: "dark",
    label: "다크 · 어두운 글자 / 주 버튼 바탕",
    fg: { kind: "token", key: "zinc-900" },
    bgRampKey: "primary-50",
    required: true,
  },
  {
    key: "light-menu",
    scope: "light",
    label: "라이트 · 선택된 메뉴 글자 / 바탕",
    fg: { kind: "token", key: "zinc-900" },
    bgRampKey: "primary-100",
    required: false,
  },
  {
    key: "dark-menu",
    scope: "dark",
    label: "다크 · 선택된 메뉴 글자 / 바탕",
    fg: { kind: "token", key: "zinc-50" },
    bgRampKey: "primary-800",
    required: false,
  },
];

export type UiThemePrimaryContrastReading = {
  pair: UiThemePrimaryContrastPair;
  fg: string;
  bg: string;
  ratio: number;
};

/**
 * 위 짝들을 실제로 잰다. 화면과 시험이 **같은 함수**를 부른다 — 두 벌의 판정이
 * 어긋날 자리를 만들지 않는다.
 *
 * 글자색은 넘겨받은 라이트/다크 한 벌에서 읽는다. 중립을 함께 손본 화면에서는
 * 그 값으로 재야 실제 화면과 같은 숫자가 나온다.
 */
export function readUiThemePrimaryContrast(
  ramp: PrimaryRamp,
  resolved: { light: Record<string, string>; dark: Record<string, string> }
): UiThemePrimaryContrastReading[] {
  const readings: UiThemePrimaryContrastReading[] = [];
  for (const pair of UI_THEME_PRIMARY_CONTRAST_PAIRS) {
    const values = pair.scope === "dark" ? resolved.dark : resolved.light;
    const fg = pair.fg.kind === "fixed" ? pair.fg.value : values[pair.fg.key];
    const bg = ramp[pair.bgRampKey];
    if (typeof fg !== "string" || typeof bg !== "string") continue;
    readings.push({ pair, fg, bg, ratio: contrastRatio(fg, bg) });
  }
  return readings;
}
