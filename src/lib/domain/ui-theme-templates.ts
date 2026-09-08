import {
  resolveUiTheme,
  UI_THEME_TOKENS,
  type UiThemeOverrideRow,
  type UiThemeScope,
  type UiThemeToken,
} from "./ui-theme-tokens";
import {
  readUiThemePrimaryTint,
  tintUiThemeColor,
  uiThemeTintOf,
  type UiThemeTint,
} from "./ui-theme-primary-ramp";
import {
  uiThemeDefaultFor,
  type UiThemeTokenChange,
} from "@/lib/validation/ui-theme-token-input";

/**
 * ============================================================================
 * 색상 톤 템플릿 — 중립·경고색 24개(라이트/다크 48값)를 한 번에 갈아 끼운다
 * ============================================================================
 * 화면 토큰 편집기(ThemeTokenEditor)는 70칸을 하나씩 고치는 화면이다. 그것으로
 * 「앱 전체의 인상」을 바꾸려면 수십 번을 서로 어울리게 골라야 하고, 그 사이 어느
 * 한 칸이라도 어긋나면 대비가 무너진다. 이 파일은 **미리 맞춰 둔 한 벌**을
 * 골라 넣는 지름길이다.
 *
 * ── 🔴 담당을 가른다 — 이 화면은 강조색(primary)을 건드리지 않는다 ──────
 * 예전에는 톤 템플릿이 강조색 11단까지 함께 채웠다. 「차분한 청색」을 골랐는데
 * 주 버튼만 옛 검정으로 남으면 어긋나 보인다는 이유였고, 그때는 강조색을 따로
 * 고르는 화면이 없었으므로 옳은 판단이었다.
 *
 * 지금은 **메인 컬러 화면**(theme/main-color)이 강조색 11단을 맡는다. 그래서 그
 * 전제가 깨졌다 — 톤이 강조색까지 채우면, 파랑을 고른 뒤 톤을 저장하는 순간
 * 주 버튼이 다시 검정이 된다(파랑의 primary-900 `#1043b3` → 톤의 `#0f172b`).
 * 두 화면이 서로를 덮어쓰므로 어느 쪽도 「고른 대로 남는다」를 말할 수 없다.
 *
 *     메인 컬러  →  primary-* 11단만
 *     색상 톤    →  zinc-* 11 · red-* 11 · background · foreground 만
 *
 * 아래 `TEMPLATE_COLOR_TOKENS` 가 그 경계이고, 저장·판정·미리보기가 **모두**
 * 그 목록 하나만 본다. 시험이 「저장 칸에 primary 가 0개」를 값으로 못 박는다.
 *
 * ── 🔴 톤 목록은 고정 배열이 아니라 **함수가 만든다** ───────────────────
 * 지금 고른 메인 컬러의 색조로 중립을 물들여 목록을 만든다
 * (`buildUiThemeTemplates`). 메인 컬러가 초록인데 고를 수 있는 톤이 「푸른 회색」
 * 뿐이면, 톤을 고르는 일이 곧 메인 컬러와 싸우는 일이 된다.
 *
 *   · 색조는 **저장된 강조색에서 읽는다**(readUiThemePrimaryTint). 따로 저장하는
 *     표를 만들지 않는 것이 이 축의 규율이다.
 *   · 색조가 없으면(= 메인 컬러가 「회색 (기본)」) **지금까지의 여섯을 그대로**
 *     낸다. 아무것도 고르지 않은 관리자의 화면이 이 판 때문에 바뀌면 안 된다.
 *   · 물드는 세기는 두 단계다. 세기 값을 지어내지 않았다 — 이미 「살짝 물든
 *     회색」의 실례인 warm-stone·cool-slate 의 가운데 단계(zinc-500)에서 잰
 *     채도를 그대로 쓴다(TINT_SOFT · TINT_STRONG).
 *   · 🔴 **휘도를 건드리지 않는다.** 색조만 갈아 끼운다(tintUiThemeColor). 대비비는
 *     두 색의 상대휘도만으로 정해지므로, 물든 톤의 대비는 물들기 전과 **같다** —
 *     거의 같은 것이 아니라 같다. 순백·순검은 아예 물들지 않는다.
 *
 * ── 🔴 새로 저장되는 것은 없다 ──────────────────────────────────────────
 * 템플릿은 표도 열도 만들지 않는다. 고르면 그 값들이 기존 `ui_theme_tokens`
 * 행으로 저장될 뿐이고, 「지금 무슨 템플릿을 쓰는가」는 **저장하지 않고**
 * 저장된 값을 대조해 알아낸다(detectUiThemeTemplate). 이름을 따로 기억해 두면
 * 색 화면에서 한 칸을 손으로 고친 날 이름과 값이 어긋나고, 그때 어느 쪽이
 * 옳은지 알 방법이 없다.
 *
 * ── 🔴 모서리·글자 크기는 템플릿에 들어오지 않는다 ──────────────────────
 * 톤을 고르는 일과 크기를 고르는 일이 한 단추에 묶이면, 「톤만 바꿨는데 글자
 * 크기까지 바뀐」 상태가 되고 되돌릴 때 무엇이 함께 움직였는지 알 수 없다.
 * 그래서 여기 담는 것은 등록부의 `kind === "color"` 토큰 가운데 강조색을 뺀
 * 것뿐이다.
 *
 * ── 🔴 램프의 라이트/다크는 같은 값이다 ─────────────────────────────────
 * zinc·red 는 팔레트이지 역할이 아니다 — 라이트 화면은 zinc-900 을 글자로,
 * 다크 화면은 같은 zinc-900 을 카드 바탕으로 쓴다(ui-theme-tokens.ts 머리말).
 * 램프의 라이트/다크를 서로 다른 색으로 만들면 다크의 카드 바탕과 라이트의
 * 글자가 따로 놀아 화면이 망가진다. 그래서 아래 `template()` 도우미가 램프를
 * **한 벌만** 받아 두 쪽에 같은 값을 넣는다 — 두 값을 따로 적을 자리 자체를
 * 만들지 않는다. 라이트/다크가 다른 것은 `background`·`foreground` 둘뿐이다.
 *
 * ── 색값을 지어내지 않았다 ──────────────────────────────────────────────
 * 아래 여섯 벌의 hex 는 이 저장소가 실제로 쓰는 변환 경로를 그대로 지나온 값이다.
 * Tailwind v4 는 팔레트를 `oklch()` 로 내보내고(node_modules/tailwindcss/theme.css),
 * 빌드가 그것을 sRGB hex 로 떨어뜨린다. 그 변환기(lightningcss)에 Tailwind 의
 * zinc·red oklch 를 그대로 넣으면 등록부에 이미 적혀 있는 22개 hex 가 한 자도
 * 틀리지 않게 나온다 — 그 사실을 확인한 뒤 같은 변환기로 아래 값들을 얻었다.
 *
 *   · cool-slate  — Tailwind `slate` 램프 그대로
 *   · warm-stone  — Tailwind `stone` 램프 그대로
 *   · high-contrast — zinc·red 의 oklch 명도를 0.63 을 축으로 바깥으로 민다
 *                     (지수 0.75). 다만 중립의 200·300·400 은 **반대로** 축
 *                     쪽으로 당긴다(계수 0.62) — 이 앱에서 램프의 밝은 절반은
 *                     라이트 화면의 **테두리와 바탕**이라, 그것까지 밝히면
 *                     「고대비」인데 화면의 뼈대가 더 흐려진다. 50 은 순백으로
 *                     못 박는다.
 *   · soft-contrast — 명도 범위를 [0.09, 0.965] 로 좁힌다(순백·순검을 피한다).
 *                     경고색은 채도를 0.9배로 함께 눕힌다.
 *   · calm-red    — 중립은 기본 그대로, 경고색만 채도 0.65배.
 *
 * ── 🔴 잘못된 템플릿 하나가 「고르는 순간 거절되는 선택지」가 된다 ──────
 * 서버는 색을 소문자 hex 6자리로만 받고, 대비 4쌍이 3:1 미만이면 저장을
 * 거절한다. 여기 적힌 값이 그 문을 못 지나면 화면에는 멀쩡히 보이는 카드가
 * 누르는 순간 오류를 뱉는다. 목록을 함수가 만들게 된 뒤로는 **관리자가 고른
 * 아무 색에서나** 그 일이 일어날 수 있으므로, 시험이 색상환을 통째로 훑는다 —
 * 그 시험이 이 파일의 절반이다(ui-theme-templates.test.ts).
 * ============================================================================
 */

/** 템플릿 키. 저장되지 않는다 — 화면과 시험이 서로를 가리키는 이름일 뿐이다. */
export type UiThemeTemplateKey =
  | "default"
  | "cool-slate"
  | "warm-stone"
  | "tinted-soft"
  | "tinted-strong"
  | "high-contrast"
  | "soft-contrast"
  | "calm-red";

/** 논리 키 → [라이트, 다크]. 이 화면이 맡는 색 24개를 빠짐없이 담는다. */
export type UiThemeTemplateColors = Readonly<Record<string, readonly [string, string]>>;

export type UiThemeTemplate = {
  key: UiThemeTemplateKey;
  /** 화면에 보일 한글 이름 */
  name: string;
  /** 카드에 한 줄로 붙는 설명 */
  description: string;
  colors: UiThemeTemplateColors;
};

const RED_PREFIX = "red-";
const PRIMARY_PREFIX = "primary-";

/**
 * 템플릿이 값을 채우는 자리. 등록부에서 **매번 골라 낸다** — 색 토큰이 하나
 * 늘어난 날 목록을 여기 한 번 더 적어 두었다면 그 색만 조용히 빠진 채로
 * 「전부 바꿨다」고 말하는 템플릿이 된다.
 *
 * 🔴 강조색(primary)은 뺀다. 그 11단은 메인 컬러 화면의 몫이고, 여기서 함께
 * 저장하면 두 화면이 서로를 덮어쓴다(파일 머리말).
 */
const TEMPLATE_COLOR_TOKENS: readonly UiThemeToken[] = UI_THEME_TOKENS.filter(
  (token) => token.kind === "color" && !token.key.startsWith(PRIMARY_PREFIX)
);

/** 이 화면이 정하는 색의 논리 키. 화면의 안내 문구가 이 수를 그대로 읽는다. */
export const UI_THEME_TEMPLATE_TOKEN_KEYS: readonly string[] = TEMPLATE_COLOR_TOKENS.map(
  (token) => token.key
);

/** 색 램프 한 벌. 라이트/다크가 같으므로 값을 한 번만 적는다. */
type Ramp = Readonly<Record<string, string>>;

/** 라이트/다크가 다른 둘. */
type Ends = {
  backgroundLight: string;
  backgroundDark: string;
  foregroundLight: string;
  foregroundDark: string;
};

/**
 * 램프 한 벌과 양 끝 넷으로 24색 표를 만든다.
 *
 * 램프를 두 번 적을 자리를 만들지 않는 것이 요점이다(머리말). 반대로
 * `background`·`foreground` 는 두 값을 반드시 따로 받는다 — 이 둘은 라이트와
 * 다크가 애초에 다른 색이고, 한 값으로 받으면 한쪽 화면이 반드시 깨진다.
 */
function template(ramp: Ramp, ends: Ends): UiThemeTemplateColors {
  const colors: Record<string, readonly [string, string]> = {};
  for (const [key, value] of Object.entries(ramp)) {
    colors[key] = [value, value];
  }
  colors.background = [ends.backgroundLight, ends.backgroundDark];
  colors.foreground = [ends.foregroundLight, ends.foregroundDark];
  return colors;
}

/**
 * 기본 템플릿. 🔴 값을 손으로 다시 적지 않고 **등록부에서 가져온다** — 손으로
 * 적으면 나중에 기본 팔레트를 손볼 때 둘이 어긋나고, 「기본」을 골랐는데 기본이
 * 아닌 상태가 된다.
 */
const DEFAULT_COLORS: UiThemeTemplateColors = Object.fromEntries(
  TEMPLATE_COLOR_TOKENS.map((token) => [token.key, [token.defaultLight, token.defaultDark] as const])
);

/** Tailwind v4 `slate` 램프. */
const COOL_SLATE_COLORS = template(
  {
    "zinc-50": "#f8fafc",
    "zinc-100": "#f1f5f9",
    "zinc-200": "#e2e8f0",
    "zinc-300": "#cad5e2",
    "zinc-400": "#90a1b9",
    "zinc-500": "#62748e",
    "zinc-600": "#45556c",
    "zinc-700": "#314158",
    "zinc-800": "#1d293d",
    "zinc-900": "#0f172b",
    "zinc-950": "#020618",
    // 경고색은 건드리지 않는다 — 중립만 바꾸는 템플릿이다.
    "red-50": "#fef2f2",
    "red-100": "#ffe2e2",
    "red-200": "#ffcaca",
    "red-300": "#ffa3a3",
    "red-400": "#ff6568",
    "red-500": "#fb2c36",
    "red-600": "#e40014",
    "red-700": "#bf000f",
    "red-800": "#9f0712",
    "red-900": "#82181a",
    "red-950": "#460809",
  },
  {
    backgroundLight: "#ffffff",
    backgroundDark: "#020618",
    foregroundLight: "#0f172b",
    foregroundDark: "#f1f5f9",
  }
);

/** Tailwind v4 `stone` 램프. */
const WARM_STONE_COLORS = template(
  {
    "zinc-50": "#fafaf9",
    "zinc-100": "#f5f5f4",
    "zinc-200": "#e7e5e4",
    "zinc-300": "#d6d3d1",
    "zinc-400": "#a6a09b",
    "zinc-500": "#79716b",
    "zinc-600": "#57534d",
    "zinc-700": "#44403b",
    "zinc-800": "#292524",
    "zinc-900": "#1c1917",
    "zinc-950": "#0c0a09",
    "red-50": "#fef2f2",
    "red-100": "#ffe2e2",
    "red-200": "#ffcaca",
    "red-300": "#ffa3a3",
    "red-400": "#ff6568",
    "red-500": "#fb2c36",
    "red-600": "#e40014",
    "red-700": "#bf000f",
    "red-800": "#9f0712",
    "red-900": "#82181a",
    "red-950": "#460809",
  },
  {
    backgroundLight: "#ffffff",
    backgroundDark: "#0c0a09",
    foregroundLight: "#1c1917",
    foregroundDark: "#f5f5f4",
  }
);

/** 명도를 바깥으로 민 zinc·red. 200·300·400 만 반대로 당겼다(머리말). */
const HIGH_CONTRAST_COLORS = template(
  {
    "zinc-50": "#ffffff",
    "zinc-100": "#f7f7f7",
    "zinc-200": "#c0c0c3",
    "zinc-300": "#b7b7bb",
    "zinc-400": "#9696a0",
    "zinc-500": "#62626c",
    "zinc-600": "#40404a",
    "zinc-700": "#2e2e36",
    "zinc-800": "#1a1a1d",
    "zinc-900": "#0e0e11",
    "zinc-950": "#040406",
    "red-50": "#fff5f5",
    "red-100": "#ffe8e8",
    "red-200": "#ffd6d5",
    "red-300": "#ffb2b1",
    "red-400": "#ff7a7a",
    "red-500": "#ff323a",
    "red-600": "#d10003",
    "red-700": "#a10005",
    "red-800": "#800009",
    "red-900": "#6b0008",
    "red-950": "#350002",
  },
  {
    backgroundLight: "#ffffff",
    backgroundDark: "#000000",
    foregroundLight: "#000000",
    foregroundDark: "#ffffff",
  }
);

/** 명도 범위를 좁혀 순백·순검을 피한 zinc·red. */
const SOFT_CONTRAST_COLORS = template(
  {
    "zinc-50": "#efefef",
    "zinc-100": "#eaeaea",
    "zinc-200": "#dcdcdf",
    "zinc-300": "#ceced2",
    "zinc-400": "#9f9faa",
    "zinc-500": "#777782",
    "zinc-600": "#5b5b66",
    "zinc-700": "#4a4a52",
    "zinc-800": "#353538",
    "zinc-900": "#27272a",
    "zinc-950": "#19191b",
    "red-50": "#f3e8e8",
    "red-100": "#f4dada",
    "red-200": "#f5c4c4",
    "red-300": "#f8a2a2",
    "red-400": "#f96d6e",
    "red-500": "#f54445",
    "red-600": "#e52929",
    "red-700": "#c32724",
    "red-800": "#a42a26",
    "red-900": "#8a2d2a",
    "red-950": "#541d1a",
  },
  {
    backgroundLight: "#f3f3f3",
    backgroundDark: "#1a1a1a",
    foregroundLight: "#262626",
    foregroundDark: "#e4e4e4",
  }
);

/** 중립은 등록부 기본값 그대로, 경고색만 채도를 눕혔다. */
const CALM_RED_COLORS = template(
  {
    "zinc-50": "#fafafa",
    "zinc-100": "#f4f4f5",
    "zinc-200": "#e4e4e7",
    "zinc-300": "#d4d4d8",
    "zinc-400": "#9f9fa9",
    "zinc-500": "#71717b",
    "zinc-600": "#52525c",
    "zinc-700": "#3f3f46",
    "zinc-800": "#27272a",
    "zinc-900": "#18181b",
    "zinc-950": "#09090b",
    "red-50": "#fbf3f3",
    "red-100": "#f8e5e5",
    "red-200": "#f3cfcf",
    "red-300": "#edaead",
    "red-400": "#e37e7c",
    "red-500": "#d95f59",
    "red-600": "#c64b42",
    "red-700": "#a53e36",
    "red-800": "#88352f",
    "red-900": "#70302c",
    "red-950": "#3c1614",
  },
  {
    backgroundLight: "#ffffff",
    backgroundDark: "#0a0a0a",
    foregroundLight: "#171717",
    foregroundDark: "#ededed",
  }
);

// ──────────────────────────────────────────────── 색조를 얹어 목록 만들기

/**
 * 물드는 세기 두 단계.
 *
 * 🔴 숫자를 지어내지 않았다 — 이미 화면에 있는 두 톤의 **가운데 단계**(zinc-500)
 * 에서 잰 HSL 채도를 그대로 쓴다. warm-stone(stone)은 「회색인데 종이 같다」는
 * 정도로만 물든 톤이고, cool-slate(slate)는 「푸른 회색」이라고 부를 만큼 물든
 * 톤이다. 그 둘이 「살짝」과 「뚜렷이」의 실례이므로, 세기를 새로 고를 이유가 없다.
 *
 * 가운데 단계에서 재는 이유: HSL 채도는 밝기가 0이나 1에 가까울수록 같은 색차를
 * 크게 셈한다(분모 `1-|2l-1|` 가 0으로 간다). 램프의 양 끝에서 재면 0.8 같은
 * 숫자가 나오는데 그것은 「진하다」가 아니라 「어둡다」의 부작용이다. 가운데
 * 단계는 그 왜곡이 가장 작은 자리다.
 */
const TINT_SOFT = uiThemeTintOf(WARM_STONE_COLORS["zinc-500"][0]).saturation;
const TINT_STRONG = uiThemeTintOf(COOL_SLATE_COLORS["zinc-500"][0]).saturation;

/**
 * 팔레트 한 벌에 색조를 얹는다.
 *
 * ── 🔴 경고색(red)은 물들이지 않는다 ────────────────────────────────────
 * 빨강은 팔레트가 아니라 **뜻**이다. 삭제·오류·기한 초과가 전부 그 램프 위에
 * 있어서, 색조를 얹어 초록이나 파랑 쪽으로 돌리면 「위험」이라는 표시가 사라진다.
 * 메인 컬러가 빨강일 때도 마찬가지다 — 강조색과 경고색이 같은 색이 되면 주
 * 버튼과 삭제 버튼을 색으로 구별할 수 없다.
 *
 * ── 🔴 `background`·`foreground` 는 물들인다 ────────────────────────────
 * 세 가지 근거가 같은 쪽을 가리킨다.
 *  ① **선례가 이미 그렇다.** cool-slate 의 다크 바탕은 slate-950(`#020618`)이고
 *     warm-stone 은 stone-950(`#0c0a09`)이다. 지금 화면에 있는 두 「물든 톤」이
 *     이미 양 끝을 함께 물들이고 있고, 그것이 어색해 보인다는 말은 나온 적이 없다.
 *  ② **안 물들이면 다크 화면에 구멍이 뚫린다.** 카드 바탕(zinc-900)과 테두리
 *     (zinc-800)가 전부 그 색조인데 페이지 바탕만 순중립이면, 패널 뒤로 회색
 *     판이 하나 떠 보인다 — 지시서가 걱정한 「바탕만 순백으로 떠 보인다」가
 *     그대로 일어난다.
 *  ③ **위험이 없다.** 색조는 휘도를 그대로 둔 채 얹히므로(tintUiThemeColor) 바탕과
 *     글자의 대비가 물들기 전과 같다. 게다가 라이트 `background` 는 `#ffffff` 라
 *     목표 휘도가 1이고, 그 자리에서는 채도를 아무리 올려도 색차가 0이다
 *     (c = (1-|2l-1|)·s) — 라이트 페이지는 물들이기로 정해도 정확히 흰색이다.
 */
function tintPalette(colors: UiThemeTemplateColors, tint: UiThemeTint): UiThemeTemplateColors {
  const tinted: Record<string, readonly [string, string]> = {};
  for (const [key, pair] of Object.entries(colors)) {
    if (key.startsWith(RED_PREFIX)) {
      tinted[key] = pair;
      continue;
    }
    tinted[key] = [tintUiThemeColor(pair[0], tint), tintUiThemeColor(pair[1], tint)];
  }
  return tinted;
}

const TINT_NOTE = " 중립색에는 지금 고른 메인 컬러의 색조가 옅게 얹힙니다.";

const HIGH_CONTRAST_DESCRIPTION =
  "글자와 바탕을 순검·순백까지 벌리고 테두리를 진하게 합니다. 밝은 현장이나 눈이 불편한 분에게 맞춥니다.";
const SOFT_CONTRAST_DESCRIPTION =
  "순백과 순검을 피해 눈부심을 줄입니다. 대비가 전체적으로 낮아지므로 아주 밝은 곳에서는 읽기 어려울 수 있습니다.";
const CALM_RED_DESCRIPTION =
  "중립색은 그대로 두고 경고색(빨강)만 덜 쨍하게 낮춥니다. 삭제·오류·기한 초과 표시가 부드러워집니다.";

/** 어느 목록에나 맨 앞에 있는 「기본」. 되돌아올 자리는 언제나 먼저 보여야 한다. */
const DEFAULT_TEMPLATE: UiThemeTemplate = {
  key: "default",
  name: "기본",
  description:
    "지금 앱이 쓰는 기본 팔레트입니다. 색조가 없는 회색이고, 이것을 고르고 저장하면 저장된 중립·경고색이 모두 지워지고 처음 상태로 돌아갑니다.",
  colors: DEFAULT_COLORS,
};

/**
 * 색조가 없을 때의 여섯. 메인 컬러가 「회색 (기본)」이면 이 목록이 그대로 나온다.
 *
 * 🔴 값도 순서도 이 판 이전과 같다(강조색 22칸이 빠진 것만 다르다). 아무것도
 * 고르지 않은 관리자의 화면이 이 판 때문에 바뀌면 안 되고, 시험이 그것을 hex
 * 표로 못 박는다.
 */
const UNTINTED_TEMPLATES: readonly UiThemeTemplate[] = [
  DEFAULT_TEMPLATE,
  {
    key: "cool-slate",
    name: "차분한 청색",
    description:
      "중립색을 푸른 회색(slate)으로 바꿉니다. 글자와 테두리, 다크 화면의 바탕이 파랗게 가라앉습니다. 경고색은 기본과 같습니다.",
    colors: COOL_SLATE_COLORS,
  },
  {
    key: "warm-stone",
    name: "따뜻한 회색",
    description:
      "중립색을 누런 회색(stone)으로 바꿉니다. 종이에 가까운 인상이 되고 오래 봐도 차갑지 않습니다. 경고색은 기본과 같습니다.",
    colors: WARM_STONE_COLORS,
  },
  {
    key: "high-contrast",
    name: "고대비",
    description: HIGH_CONTRAST_DESCRIPTION,
    colors: HIGH_CONTRAST_COLORS,
  },
  {
    key: "soft-contrast",
    name: "부드러운 대비",
    description: SOFT_CONTRAST_DESCRIPTION,
    colors: SOFT_CONTRAST_COLORS,
  },
  {
    key: "calm-red",
    name: "차분한 경고색",
    description: CALM_RED_DESCRIPTION,
    colors: CALM_RED_COLORS,
  },
];

/**
 * 고를 수 있는 톤 여섯을 만든다. 화면에 나오는 순서가 이 순서다.
 *
 * ── 무엇이 색조를 따라 바뀌고 무엇이 안 바뀌는가 ────────────────────────
 *   · `default` — 안 바뀐다. **되돌아올 자리**라서 색조가 얹히면 안 된다.
 *   · `tinted-soft` · `tinted-strong` — 기본 팔레트의 **밝기 곡선 위에** 색조만
 *     두 세기로 얹은 둘. 색조가 없을 때의 cool-slate·warm-stone 자리를 대신한다.
 *   · `high-contrast` · `soft-contrast` · `calm-red` — 대비·경고색 축이라 색조와
 *     독립이지만, **살짝 세기로 함께 물들인다.** 근거: 이 셋만 순중립으로 남으면
 *     한 목록 안에서 「색조가 있는 톤 둘」과 「없는 톤 셋」이 갈라져, 고르는 사람
 *     눈에는 어느 쪽이 이 앱의 톤인지가 흐려진다. 뚜렷이(TINT_STRONG)가 아니라
 *     살짝(TINT_SOFT)인 이유는, 고대비를 고르는 사람이 원하는 것은 색이 아니라
 *     글자가 보이는 것이기 때문이다 — 살짝 세기는 양 끝(순백·순검)을 한 자도
 *     건드리지 않으므로 고대비의 대비값이 그대로 남는다.
 *
 * ── 세기가 메인 컬러의 채도를 따라가지 않는 이유 ────────────────────────
 * 색조에서 **색상만** 쓰고 채도는 위의 두 상수로 고정한다. 메인 컬러의 채도를
 * 그대로 쓰면 파스텔 색을 고른 관리자에게는 「살짝」과 「뚜렷이」가 둘 다 회색으로
 * 보여 카드 두 장이 같은 것이 된다. 채도는 「색조가 있는가 없는가」를 가르는
 * 데에만 쓰인다(readUiThemePrimaryTint).
 *
 * 🔴 결정적이다 — 같은 색상이면 언제나 같은 여섯이다.
 */
export function buildUiThemeTemplates(tint: UiThemeTint | null): readonly UiThemeTemplate[] {
  if (!tint) return UNTINTED_TEMPLATES;

  const soft: UiThemeTint = { hue: tint.hue, saturation: TINT_SOFT };
  const strong: UiThemeTint = { hue: tint.hue, saturation: TINT_STRONG };

  return [
    DEFAULT_TEMPLATE,
    {
      key: "tinted-soft",
      name: "살짝 물든 회색",
      description:
        "기본 팔레트의 밝기는 그대로 두고 메인 컬러의 색조만 옅게 얹습니다. 여전히 회색으로 보이지만 화면 전체가 그 색 쪽으로 조금 기웁니다. 경고색은 기본과 같습니다.",
      colors: tintPalette(DEFAULT_COLORS, soft),
    },
    {
      key: "tinted-strong",
      name: "뚜렷이 물든 회색",
      description:
        "기본 팔레트의 밝기는 그대로 두고 메인 컬러의 색조를 뚜렷하게 얹습니다. 글자와 테두리, 다크 화면의 바탕이 그 색으로 가라앉습니다. 경고색은 기본과 같습니다.",
      colors: tintPalette(DEFAULT_COLORS, strong),
    },
    {
      key: "high-contrast",
      name: "고대비",
      description: HIGH_CONTRAST_DESCRIPTION + TINT_NOTE,
      colors: tintPalette(HIGH_CONTRAST_COLORS, soft),
    },
    {
      key: "soft-contrast",
      name: "부드러운 대비",
      description: SOFT_CONTRAST_DESCRIPTION + TINT_NOTE,
      colors: tintPalette(SOFT_CONTRAST_COLORS, soft),
    },
    {
      key: "calm-red",
      name: "차분한 경고색",
      description: CALM_RED_DESCRIPTION + TINT_NOTE,
      colors: tintPalette(CALM_RED_COLORS, soft),
    },
  ];
}

/**
 * 저장된 값에서 색조를 읽어 톤 목록을 만든다. 화면과 판정이 **같은 함수**를
 * 부른다 — 카드에 그린 목록과 「지금 쓰는 톤」 판정이 서로 다른 목록을 보면
 * 어느 카드에도 표시가 붙지 않는 상태가 생긴다.
 */
export function uiThemeTemplatesFor(
  rows: readonly UiThemeOverrideRow[]
): readonly UiThemeTemplate[] {
  return buildUiThemeTemplates(readUiThemePrimaryTint(rows));
}

/**
 * 색조가 없을 때의 여섯. 「메인 컬러를 고르기 전에는 무엇이 보이는가」를 가리키는
 * 이름이고, 화면은 이것 대신 `uiThemeTemplatesFor(saved)` 를 쓴다.
 */
export const UI_THEME_TEMPLATES: readonly UiThemeTemplate[] = UNTINTED_TEMPLATES;

/**
 * 키로 템플릿을 찾는다. 없으면 null — 모르는 키로 화면이 멈추지 않게 한다.
 *
 * 목록을 함께 받는다. 색조가 있는 화면에서 `UI_THEME_TEMPLATES`(색조 없는 여섯)
 * 만 뒤지면 `tinted-soft` 를 영영 못 찾는다.
 */
export function findUiThemeTemplate(
  key: string,
  templates: readonly UiThemeTemplate[] = UI_THEME_TEMPLATES
): UiThemeTemplate | null {
  return templates.find((template) => template.key === key) ?? null;
}

/** 이 (토큰, 스코프)에 템플릿이 넣을 값. scoped:false 인 색이 생기면 라이트 값을 쓴다. */
function templateValueFor(
  template: UiThemeTemplate,
  token: UiThemeToken,
  scope: UiThemeScope
): string | undefined {
  const pair = template.colors[token.key];
  if (!pair) return undefined;
  return scope === "dark" ? pair[1] : pair[0];
}

/** 이 토큰이 실제로 갖는 칸. 편집기의 SLOTS 와 같은 규칙이다. */
function scopesOf(token: UiThemeToken): readonly UiThemeScope[] {
  return token.scoped ? (["light", "dark"] as const) : (["both"] as const);
}

/**
 * 템플릿을 저장 형태로 바꾼다.
 *
 * 🔴 기본값과 같은 값은 `value: null`(행 삭제)로 나간다. 이 판정을 화면이 따로
 * 하면 두 벌이 되고, 한쪽만 고쳐지는 날 「기본으로 되돌렸는데 행이 안 지워지는」
 * 상태가 생긴다 — 그러면 나중에 기본 팔레트를 손볼 때 옛 값이 오버라이드로
 * 굳어 아무 화면도 따라 바뀌지 않는다.
 *
 * 이 화면이 맡는 색 칸을 **전부** 싣는다(48칸). 지금 저장된 값과 견주어 달라진
 * 것만 싣지 않는 이유는, 기본값으로 돌아가는 칸도 「행을 지워라」라는 뜻으로
 * 실려야 하기 때문이다. 이미 행이 없는 자리에 대한 삭제 요청은 mutation 이 0으로
 * 세고 넘어간다(applyOneChange).
 *
 * 🔴 강조색 칸은 **하나도 실리지 않는다.** 실리면 톤을 저장할 때마다 메인 컬러가
 * 지워진다(파일 머리말). 시험이 「primary 로 시작하는 칸 0개」를 못 박는다.
 */
export function uiThemeTemplateToChanges(template: UiThemeTemplate): UiThemeTokenChange[] {
  const changes: UiThemeTokenChange[] = [];
  for (const token of TEMPLATE_COLOR_TOKENS) {
    for (const scope of scopesOf(token)) {
      const value = templateValueFor(template, token, scope);
      if (value === undefined) continue;
      const fallback = uiThemeDefaultFor(token, scope);
      changes.push({ tokenKey: token.key, scope, value: value === fallback ? null : value });
    }
  }
  return changes;
}

/**
 * 저장된 값과 이 템플릿이 **몇 칸** 다른가.
 *
 * 강조색과 모서리·글자 크기는 세지 않는다 — 템플릿이 정하지 않는 값이라, 세면
 * 「고를 것이 없는데 다르다고 적힌」 숫자가 된다. 특히 강조색을 세면 메인 컬러를
 * 고른 순간 모든 톤 카드에 「22칸 다름」이 붙고, 어느 톤도 「지금 쓰는 톤」으로
 * 표시되지 않는다.
 */
export function countUiThemeTemplateDiff(
  template: UiThemeTemplate,
  rows: readonly UiThemeOverrideRow[]
): number {
  const resolved = resolveUiTheme(rows);
  let count = 0;
  for (const token of TEMPLATE_COLOR_TOKENS) {
    const light = templateValueFor(template, token, "light");
    const dark = templateValueFor(template, token, "dark");
    if (light !== undefined && resolved.light[token.key] !== light) count += 1;
    if (dark !== undefined && resolved.dark[token.key] !== dark) count += 1;
  }
  return count;
}

/**
 * 지금 저장된 값이 어느 템플릿인가. 어느 것과도 다르면 null(= 직접 고친 값).
 *
 * 🔴 저장하지 않고 **값을 대조해** 알아낸다. 「지금 무슨 템플릿을 쓰는가」를
 * 따로 기억해 두면, 색 화면에서 한 칸을 손으로 고친 날 이름과 값이 어긋나고
 * 그때 어느 쪽이 옳은지 알 방법이 없다.
 *
 * 위의 diff 와 **같은 비교**를 쓴다 — 카드에 "3칸 다름"이라 적혀 있는데
 * 판정은 "이 템플릿을 쓰는 중"이라고 말하는 일이 생기지 않는다.
 *
 * 🔴 대조하는 목록은 **지금 저장된 메인 컬러에서 만든 여섯**이다. 메인 컬러를
 * 바꾸면 톤 목록의 색조도 바뀌므로, 옛 색조로 저장해 둔 중립은 어느 톤과도 맞지
 * 않게 되어 「직접 고친 값」이 된다. 그것이 사실이다 — 화면이 그렇게 적고,
 * 톤을 다시 고르면 맞아떨어진다.
 */
export function detectUiThemeTemplate(
  rows: readonly UiThemeOverrideRow[]
): UiThemeTemplate | null {
  for (const template of uiThemeTemplatesFor(rows)) {
    if (countUiThemeTemplateDiff(template, rows) === 0) return template;
  }
  return null;
}

/**
 * 저장된 값 위에 템플릿의 색만 얹은 한 벌. 미리보기와 대비 계산이 같은 것을 본다.
 *
 * 🔴 이 화면이 맡는 색만 덮는다. 강조색(주 버튼)과 모서리·글자 크기는 **저장된
 * 값 그대로** 남는다 — 견본이 기본 강조색으로 그려지면, 메인 컬러를 고쳐 둔
 * 관리자에게는 「톤이 메인 컬러까지 되돌린다」로 읽힌다. 실제로 저장되는 것도
 * 그렇지 않다.
 */
export function resolveUiThemeWithTemplate(
  rows: readonly UiThemeOverrideRow[],
  template: UiThemeTemplate
): { light: Record<string, string>; dark: Record<string, string> } {
  const resolved = resolveUiTheme(rows);
  const light = { ...resolved.light };
  const dark = { ...resolved.dark };
  for (const token of TEMPLATE_COLOR_TOKENS) {
    const lightValue = templateValueFor(template, token, "light");
    const darkValue = templateValueFor(template, token, "dark");
    if (lightValue !== undefined) light[token.key] = lightValue;
    if (darkValue !== undefined) dark[token.key] = darkValue;
  }
  return { light, dark };
}
