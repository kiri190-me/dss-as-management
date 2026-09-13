import type { CSSProperties } from "react";

import { normalizeUiThemePrimarySeed, uiThemeTintOf } from "./ui-theme-primary-ramp";
import { contrastRatio, UI_THEME_CONTRAST_WARN } from "./ui-theme-tokens";

/**
 * ============================================================================
 * 고객사 줄 배경색 — 팔레트와 직접 고른 색이 있는 단 한 곳
 * ============================================================================
 * 내자 정리 목록에서 고객사마다 줄을 다른 색으로 칠한다. 한 화면에 여러
 * 고객사의 줄이 순번 순서대로 섞여 있어서, 소제목만으로는 옆으로 스크롤하는
 * 동안 어느 고객사의 줄을 보고 있는지 놓치기 쉽다.
 *
 * ── DB 에는 **팔레트 키** 또는 **색 코드**가 들어간다 ─────────────────────
 * customers.row_color 에 담기는 값은 둘 중 하나다 — "amber" 같은 팔레트 키,
 * 또는 "#ffe4b5" 같은 **정리된 색 코드**(#rrggbb 여섯 자리, 소문자).
 *
 * 처음에는 키만 받았다. 까닭은 셋이었고, 앞의 둘은 **팔레트 색에는 지금도
 * 그대로 유효하다**:
 *
 *  1. 나중에 "색이 너무 진하다"고 느껴질 때 **DB 를 한 줄도 건드리지 않고**
 *     이 파일의 클래스만 고치면 팔레트를 고른 고객사의 색이 한꺼번에
 *     조절된다. 색 코드를 저장해 두면 같은 일이 데이터 마이그레이션이 된다.
 *  2. 밝은 화면과 어두운 화면은 **같은 색을 쓸 수 없다.** 밝은 쪽에서 읽히는
 *     옅은 색은 어두운 쪽에서 눈을 찌르고, 그 반대도 마찬가지다. 키 하나에
 *     색조 두 벌을 매달아 두면 이 문제가 없다.
 *  3. (이제는 아니다) 정해진 색 중에서만 고르는 화면이라 저장될 수 있는 값이
 *     목록으로 닫혀 있었다.
 *
 * ── 🔴 2026-09-13 사용자 요청: 열 가지 밖의 색도 고른다 ─────────────────
 * 고객사가 늘면서 열 가지로는 모자라다는 요청이 있었고, 팔레트는 그대로 둔 채
 * 개발자 모드 [메인 컬러]의 「직접 고르기」와 같은 방식으로 아무 색이나 고를 수
 * 있게 했다. 그래서 3번이 깨졌고, 저장값의 범위는 "팔레트 키 또는 올바른 색
 * 코드"가 되었다(검증: validation/customer-update-input.ts →
 * normalizeCustomerRowColorValue).
 *
 * 1번·2번이 직접 고른 색에서 무너지지 않게 한 방법이 **색조를 저장하지 않고
 * 계산한다**는 것이다. DB 에는 고른 색 하나만 들어가고, 밝은·어두운 화면의
 * 배경과 각각의 hover 색 네 가지는 화면을 그릴 때마다 이 파일이 그 한 색에서
 * 만든다(computeCustomerRowCustomTones). 그래서
 *   · 2번 — 한 값에서 두 화면의 색조가 따로 나온다.
 *   · 1번 — 옅기를 고치고 싶으면 아래 밝기 상수만 고치면 되고, 직접 고른 색을
 *     저장한 고객사들도 DB 를 건드리지 않고 함께 따라온다.
 *
 * ── 직접 고른 색의 색조는 이렇게 만든다 ─────────────────────────────────
 * ① 고른 색에서 **색상과 채도만** 가져온다(메인 컬러와 같은 규칙,
 *    domain/ui-theme-primary-ramp.ts 머리말 ②). 밝기는 버린다 — 아주 진한 색을
 *    골라도 줄은 옅게, 아주 옅은 색을 골라도 어두운 화면에서는 어둡게 칠해진다.
 * ② 밝기는 **팔레트 열 가지 색이 실제로 앉은 자리**로 맞춘다. 밝은 쪽 `-100`,
 *    hover `-200`, 어두운 쪽 `-950`, hover `-900` 의 HSL 밝기를 열 색에서 재어
 *    평균낸 값이다(아래 상수). 그래서 직접 고른 색이 팔레트 색 옆에 서도 한 벌로
 *    보인다.
 * ③ 어두운 쪽은 팔레트가 `/50`(반투명)으로 밑바탕 위에 얹힌다. 직접 고른 색은
 *    반투명을 쓰지 않고, **밑바탕(zinc-900)과 반반 섞인 결과를 불투명한 색
 *    하나로** 계산한다 — 그래야 대비를 정확히 잴 수 있다.
 * ④ 🔴 **만든 뒤 실제로 잰다.** 그 위에 얹히는 글자(밝은 화면 zinc-900, 어두운
 *    화면 zinc-50)와의 대비가 4.5(WCAG AA 본문) 밑이면, 넘을 때까지 밝은 쪽은
 *    더 밝게·어두운 쪽은 더 어둡게 옮긴다. 끝까지 옮기면 흰색·검정에 가까워지고
 *    그 둘은 반드시 기준을 넘으므로 이 고리는 항상 끝난다. 지금 밝기 자리에서는
 *    어떤 색을 골라도 이 보정이 돌 일이 없지만, 밝기 상수를 손보는 날의 안전줄이다.
 *
 * ── 배경만 칠하고 글자색은 건드리지 않는다 ──────────────────────────────
 * 팔레트는 밝은 쪽이 `-100`, 어두운 쪽이 `-950/50` 이다. 이 정도로 옅으면
 * 화면이 이미 쓰고 있는 글자색 토큰(zinc-900 / zinc-50 계열)이 그대로 통해서,
 * 색을 더하는 일이 글자 대비를 건드리지 않는다. 직접 고른 색도 같은 약속을
 * 지킨다 — 위 ④가 그 약속을 재서 확인하는 자리다.
 *
 * ── 완료된 줄의 회색과 겹치지 않는다 ────────────────────────────────────
 * 완료 표시는 zinc 계열 회색이다(DomesticOrderListScreen). 그래서 팔레트에는
 * **무채색 계열(zinc·slate·gray·neutral·stone)을 하나도 넣지 않는다** — 넣으면
 * "완료된 줄"과 "회색을 고른 고객사의 줄"이 같은 모양이 된다. 열 가지 색은
 * 색상환을 고르게 도는 유채색뿐이다.
 *
 * 직접 고르기에서는 회색을 막지 않는다(사람이 일부러 고를 수도 있다). 대신
 * 채도가 낮은 색이면 고르개가 "완료된 줄과 헷갈릴 수 있다"고 알린다
 * (isCustomerRowColorGrayish).
 *
 * ── 모르는 값은 조용히 "없음"이다 ───────────────────────────────────────
 * 나중에 팔레트에서 색 하나를 빼면 그 색을 골라 둔 고객사의 row_color 가
 * 팔레트에 없는 값으로 남는다. 그때 화면이 깨지거나 빈 클래스 문자열이
 * className 에 섞여 들어가면 안 된다 — resolveCustomerRowColor 가 null 을
 * 돌려주고, 그 고객사는 색을 칠하지 않은 것과 똑같이 보인다. 형식이 어긋난
 * 색 코드(DB 를 손으로 고친 경우 등)도 똑같이 "없음"이다.
 *
 * ── 클래스 이름은 반드시 **온전한 글자 그대로** 적는다 ──────────────────
 * Tailwind 는 소스 파일에서 클래스 이름을 글자로 찾아 CSS 를 만든다.
 * `` `bg-${hue}-100` `` 처럼 조립하면 그 클래스는 빌드 결과에 존재하지 않아
 * 화면에서 색이 아예 나오지 않는다. 아래 표의 모든 값이 조각나지 않은 완성된
 * 문자열인 이유가 그것이다.
 *
 * 직접 고른 색은 색이 몇 가지일지 모르므로 색마다 클래스를 만들 수 없다. 그래서
 * **CSS 변수를 읽는 고정된 클래스 네 개**(CUSTOM_CLASSES — 역시 온전한 글자
 * 그대로)를 쓰고, 변수의 값은 칠하는 자리가 `style` 로 곁들인다
 * (customerRowColorStyle). 클래스는 늘 같고 값만 줄마다 다르다.
 * ============================================================================
 */

/** 저장될 수 있는 팔레트 키. 이 열 가지가 전부다. */
export type CustomerRowColorKey =
  | "rose"
  | "orange"
  | "amber"
  | "lime"
  | "emerald"
  | "teal"
  | "sky"
  | "indigo"
  | "violet"
  | "fuchsia";

/** 팔레트 색 하나. */
export type CustomerRowColor = {
  kind: "palette";
  /** DB(customers.row_color)에 그대로 들어가는 값. */
  key: CustomerRowColorKey;
  /** 색 고르개에 적히는 이름. 색을 구분하기 어려운 사람에게는 이 글자가 단서다. */
  label: string;
  /** 밝은 화면의 배경. */
  lightClass: string;
  /** 어두운 화면의 배경. 같은 색의 훨씬 어두운 색조라야 글자가 읽힌다. */
  darkClass: string;
  /** 밝은 화면에서 마우스를 얹었을 때. 누를 수 있는 줄이라는 표시를 색이 지우면 안 된다. */
  lightHoverClass: string;
  /** 어두운 화면에서 마우스를 얹었을 때. */
  darkHoverClass: string;
};

/** 직접 고른 색이 칠하는 네 가지 색. 전부 소문자 `#rrggbb` 다. */
export type CustomerRowCustomTones = {
  light: string;
  dark: string;
  lightHover: string;
  darkHover: string;
};

/** 직접 고른 색 하나. 클래스는 고정이고, 색은 tones 에 계산돼 있다. */
export type CustomerRowCustomColor = {
  kind: "custom";
  /** DB 에 그대로 들어가는 값 — 정리된 색 코드(`#rrggbb`, 소문자). */
  key: string;
  /** "직접 고른 색 #ffe4b5". 상세 화면과 견본의 화면 낭독기 이름표가 이 글자를 쓴다. */
  label: string;
  lightClass: string;
  darkClass: string;
  lightHoverClass: string;
  darkHoverClass: string;
  tones: CustomerRowCustomTones;
};

/** 저장된 값을 읽은 결과. 팔레트 색이거나 직접 고른 색이다. */
export type ResolvedCustomerRowColor = CustomerRowColor | CustomerRowCustomColor;

/**
 * 고를 수 있는 색 전부. 순서는 색상환을 도는 순서다 — 목록에서 위아래로 훑을
 * 때 비슷한 색끼리 붙어 있어야 "이 둘 중 어느 쪽이었지"를 눈으로 가릴 수 있다.
 */
export const CUSTOMER_ROW_COLORS: readonly CustomerRowColor[] = [
  {
    kind: "palette",
    key: "rose",
    label: "분홍",
    lightClass: "bg-rose-100",
    darkClass: "dark:bg-rose-950/50",
    lightHoverClass: "hover:bg-rose-200",
    darkHoverClass: "dark:hover:bg-rose-900/50",
  },
  {
    kind: "palette",
    key: "orange",
    label: "주황",
    lightClass: "bg-orange-100",
    darkClass: "dark:bg-orange-950/50",
    lightHoverClass: "hover:bg-orange-200",
    darkHoverClass: "dark:hover:bg-orange-900/50",
  },
  {
    kind: "palette",
    key: "amber",
    label: "노랑",
    lightClass: "bg-amber-100",
    darkClass: "dark:bg-amber-950/50",
    lightHoverClass: "hover:bg-amber-200",
    darkHoverClass: "dark:hover:bg-amber-900/50",
  },
  {
    kind: "palette",
    key: "lime",
    label: "연두",
    lightClass: "bg-lime-100",
    darkClass: "dark:bg-lime-950/50",
    lightHoverClass: "hover:bg-lime-200",
    darkHoverClass: "dark:hover:bg-lime-900/50",
  },
  {
    kind: "palette",
    key: "emerald",
    label: "초록",
    lightClass: "bg-emerald-100",
    darkClass: "dark:bg-emerald-950/50",
    lightHoverClass: "hover:bg-emerald-200",
    darkHoverClass: "dark:hover:bg-emerald-900/50",
  },
  {
    kind: "palette",
    key: "teal",
    label: "청록",
    lightClass: "bg-teal-100",
    darkClass: "dark:bg-teal-950/50",
    lightHoverClass: "hover:bg-teal-200",
    darkHoverClass: "dark:hover:bg-teal-900/50",
  },
  {
    kind: "palette",
    key: "sky",
    label: "하늘",
    lightClass: "bg-sky-100",
    darkClass: "dark:bg-sky-950/50",
    lightHoverClass: "hover:bg-sky-200",
    darkHoverClass: "dark:hover:bg-sky-900/50",
  },
  {
    kind: "palette",
    key: "indigo",
    label: "남색",
    lightClass: "bg-indigo-100",
    darkClass: "dark:bg-indigo-950/50",
    lightHoverClass: "hover:bg-indigo-200",
    darkHoverClass: "dark:hover:bg-indigo-900/50",
  },
  {
    kind: "palette",
    key: "violet",
    label: "보라",
    lightClass: "bg-violet-100",
    darkClass: "dark:bg-violet-950/50",
    lightHoverClass: "hover:bg-violet-200",
    darkHoverClass: "dark:hover:bg-violet-900/50",
  },
  {
    kind: "palette",
    key: "fuchsia",
    label: "자주",
    lightClass: "bg-fuchsia-100",
    darkClass: "dark:bg-fuchsia-950/50",
    lightHoverClass: "hover:bg-fuchsia-200",
    darkHoverClass: "dark:hover:bg-fuchsia-900/50",
  },
];

/**
 * "색 없음"을 나타내는 값. 화면의 고르개가 쓰는 값이고, 저장될 때는 null 이
 * 된다 — 빈 문자열과 null 두 가지 모양의 "없음"이 DB 에 섞이지 않게 검증이
 * 한 가지로 접는다(validation/customer-update-input.ts).
 */
export const NO_CUSTOMER_ROW_COLOR_KEY = "";

/** "없음"을 고르는 자리에 적히는 글자. 화면과 시험이 같은 글자를 쓴다. */
export const NO_CUSTOMER_ROW_COLOR_LABEL = "없음";

/** 직접 고른 색의 이름표 머리. 뒤에 색 코드가 붙는다("직접 고른 색 #ffe4b5"). */
export const CUSTOMER_ROW_CUSTOM_COLOR_LABEL = "직접 고른 색";

const BY_KEY = new Map<string, CustomerRowColor>(
  CUSTOMER_ROW_COLORS.map((color) => [color.key, color])
);

/**
 * 팔레트 키인가. **색 코드는 여기서 false 다** — 키와 색 코드는 다른 물건이고,
 * 저장해도 되는 값 전체는 normalizeCustomerRowColorValue 가 판정한다.
 */
export function isCustomerRowColorKey(value: unknown): value is CustomerRowColorKey {
  return typeof value === "string" && BY_KEY.has(value);
}

/**
 * 직접 고른 색 코드를 정리한다 — 앞뒤 공백을 떼고 소문자로, `#rrggbb` 여섯
 * 자리만 받는다. 아니면 null.
 *
 * 메인 컬러의 씨앗 정리(normalizeUiThemePrimarySeed)를 그대로 쓴다. 둘 다
 * "사람이 친 색 코드를 거르고 한 가지 표기로 모은다"는 같은 일이고, 표기가 두
 * 벌이면 `#FFE4B5` 와 `#ffe4b5` 가 다른 값으로 저장되는 날이 온다.
 */
export function normalizeCustomerRowCustomColor(raw: unknown): string | null {
  return normalizeUiThemePrimarySeed(raw);
}

/**
 * 저장해도 되는 값으로 정리한다. 팔레트 키는 그대로, 색 코드는 정리해서
 * 돌려주고, 어느 쪽도 아니면 null 이다. 검증이 이 함수 하나로 거른다.
 *
 * 팔레트 키는 대소문자·공백을 고쳐 주지 않는다("AMBER" 는 null) — 키는 고르개가
 * 보내는 값이지 사람이 치는 값이 아니다.
 */
export function normalizeCustomerRowColorValue(raw: unknown): string | null {
  if (isCustomerRowColorKey(raw)) return raw;
  return normalizeCustomerRowCustomColor(raw);
}

// ─────────────────────────────────────────────────── 직접 고른 색의 색조

/**
 * 밝은 화면에서 줄 위에 얹히는 글자색. Tailwind v4 기본 팔레트의 zinc-900
 * (`oklch(21% 0.006 285.885)` → #18181b). 이 앱 색 등록부(ui-theme-tokens.ts)의
 * zinc-900 기본값과 같다 — 시험이 둘을 대조한다.
 *
 * 관리자가 색상 톤을 바꾼 화면에서는 실제 글자색이 조금 다를 수 있다. 팔레트 열
 * 가지 색도 같은 전제 위에 서 있다(배경만 칠하고 글자는 기본 톤을 믿는다).
 */
export const CUSTOMER_ROW_TEXT_ON_LIGHT = "#18181b";

/**
 * 어두운 화면에서 줄 위에 얹히는 글자색. Tailwind v4 기본 팔레트의 zinc-50
 * (`oklch(98.5% 0 0)` → #fafafa). 등록부의 zinc-50 기본값과 같다.
 */
export const CUSTOMER_ROW_TEXT_ON_DARK = "#fafafa";

/** 밝은 화면에서 줄 밑에 깔린 바탕(`bg-white`). 견본의 테두리 안쪽을 칠할 때만 쓴다. */
export const CUSTOMER_ROW_LIGHT_SURFACE = "#ffffff";

/**
 * 어두운 화면에서 줄 밑에 깔린 바탕 — 표·카드·주간보고 블록의 `dark:bg-zinc-900`
 * (Tailwind v4 zinc-900 → #18181b). 팔레트의 `/50` 이 이 위에 반투명으로 얹히므로,
 * 직접 고른 색은 이 색과 섞은 결과를 불투명하게 칠한다(머리말 ③).
 */
export const CUSTOMER_ROW_DARK_SURFACE = "#18181b";

/**
 * 네 가지 색의 HSL 밝기. 팔레트 열 색(Tailwind v4 기본값)의 해당 단계를 hex 로
 * 재어 평균낸 값이다 — `-100` 0.886~0.955, `-200` 0.76~0.92, `-950` 0.086~0.23,
 * `-900` 0.15~0.35.
 */
const LIGHT_LIGHTNESS = 0.92;
const LIGHT_HOVER_LIGHTNESS = 0.85;
const DARK_LIGHTNESS = 0.15;
const DARK_HOVER_LIGHTNESS = 0.25;

/** 팔레트의 `/50` — 어두운 쪽 색이 밑바탕 위에 얹히는 비율. */
const DARK_OPACITY = 0.5;

/** 대비 보정의 보폭과 횟수. 100번이면 밝기 0~1 전 구간을 지나고도 남는다. */
const GUARD_STEP = 0.01;
const GUARD_MAX = 100;

/** 이미 정리된 `#rrggbb` 를 0~1 채널 셋으로. */
function channelsOf(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

/** 0~1 채널 셋을 소문자 `#rrggbb` 로. 범위를 벗어난 값은 자른다. */
function hexOf(channels: readonly number[]): string {
  return `#${channels
    .map((value) => {
      const byte = Math.round(Math.min(1, Math.max(0, value)) * 255);
      return byte.toString(16).padStart(2, "0");
    })
    .join("")}`;
}

/** 두 색을 섞는다. `weightOfA` 가 1이면 a 그대로, 0이면 b 그대로다. */
function mixHex(a: string, b: string, weightOfA: number): string {
  const ca = channelsOf(a);
  const cb = channelsOf(b);
  return hexOf(ca.map((value, index) => value * weightOfA + cb[index] * (1 - weightOfA)));
}

/**
 * 고른 색의 **색상과 채도는 그대로 두고** HSL 밝기만 `lightness` 로 옮긴다.
 *
 * HSL 에서 밝기를 올리는 것은 흰색과 섞는 것, 내리는 것은 검정과 섞는 것과
 * 같다 — 어느 쪽이든 색상과 채도는 그대로 남는다. 그래서 먼저 "같은 색상·채도의
 * 밝기 0.5"(가장 진한 자리)로 되돌린 뒤, 목표 밝기까지 흰색이나 검정과 섞는다.
 *
 * (ui-theme-primary-ramp.ts 에도 HSL → sRGB 변환이 있지만 내보내지 않는 함수라,
 * 여기서는 같은 결과를 섞기 두 번으로 얻는다.)
 */
function atLightness(hex: string, lightness: number): string {
  const channels = channelsOf(hex);
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  const current = (max + min) / 2;

  // 무채색(흰색·검정·회색)은 채도가 0이라 밝기 0.5 자리가 가운데 회색이다.
  // max !== min 이면 current 는 0과 1 사이에 있어 아래 두 나눗셈이 안전하다.
  const pure =
    max === min
      ? [0.5, 0.5, 0.5]
      : current >= 0.5
        ? channels.map((value) => 1 - (1 - value) / (2 * (1 - current)))
        : channels.map((value) => value / (2 * current));

  const target = Math.min(1, Math.max(0, lightness));
  return hexOf(
    target >= 0.5
      ? pure.map((value) => 1 - (1 - value) * 2 * (1 - target))
      : pure.map((value) => value * 2 * target)
  );
}

/** 밝은 화면의 한 색. 글자와의 대비가 모자라면 더 밝게 옮긴다(머리말 ④). */
function lightTone(seed: string, lightness: number): string {
  let current = lightness;
  let hex = atLightness(seed, current);
  for (let i = 0; i < GUARD_MAX; i += 1) {
    if (contrastRatio(CUSTOMER_ROW_TEXT_ON_LIGHT, hex) >= UI_THEME_CONTRAST_WARN) break;
    current = Math.min(1, current + GUARD_STEP);
    hex = atLightness(seed, current);
  }
  return hex;
}

/** 어두운 화면의 한 색. 밑바탕과 섞은 뒤 재고, 모자라면 더 어둡게 옮긴다(머리말 ③④). */
function darkTone(seed: string, lightness: number): string {
  let current = lightness;
  let hex = mixHex(atLightness(seed, current), CUSTOMER_ROW_DARK_SURFACE, DARK_OPACITY);
  for (let i = 0; i < GUARD_MAX; i += 1) {
    if (contrastRatio(CUSTOMER_ROW_TEXT_ON_DARK, hex) >= UI_THEME_CONTRAST_WARN) break;
    current = Math.max(0, current - GUARD_STEP);
    hex = mixHex(atLightness(seed, current), CUSTOMER_ROW_DARK_SURFACE, DARK_OPACITY);
  }
  return hex;
}

/**
 * 고른 색 하나로 네 가지 색을 만든다(머리말 '직접 고른 색의 색조는 이렇게
 * 만든다'). 결정적이다 — 같은 색이면 언제나 같은 네 값이다.
 *
 * `seed` 는 정리된 색 코드여야 한다(normalizeCustomerRowCustomColor 를 지난 값).
 */
export function computeCustomerRowCustomTones(seed: string): CustomerRowCustomTones {
  return {
    light: lightTone(seed, LIGHT_LIGHTNESS),
    lightHover: lightTone(seed, LIGHT_HOVER_LIGHTNESS),
    dark: darkTone(seed, DARK_LIGHTNESS),
    darkHover: darkTone(seed, DARK_HOVER_LIGHTNESS),
  };
}

/** 직접 고른 색이 칠하는 네 자리의 대비를 잰 결과 하나. */
export type CustomerRowCustomContrastReading = {
  scope: "light" | "dark";
  state: "rest" | "hover";
  /** "평소" / "마우스를 얹었을 때" */
  label: string;
  fg: string;
  bg: string;
  ratio: number;
};

/**
 * 네 자리의 대비를 실제로 잰다. 고르개와 시험이 **같은 함수**를 부른다 — 화면에
 * 적힌 숫자와 시험이 확인하는 숫자가 어긋날 자리를 만들지 않는다.
 */
export function readCustomerRowCustomContrast(
  tones: CustomerRowCustomTones
): CustomerRowCustomContrastReading[] {
  const pairs: Omit<CustomerRowCustomContrastReading, "ratio">[] = [
    { scope: "light", state: "rest", label: "평소", fg: CUSTOMER_ROW_TEXT_ON_LIGHT, bg: tones.light },
    {
      scope: "light",
      state: "hover",
      label: "마우스를 얹었을 때",
      fg: CUSTOMER_ROW_TEXT_ON_LIGHT,
      bg: tones.lightHover,
    },
    { scope: "dark", state: "rest", label: "평소", fg: CUSTOMER_ROW_TEXT_ON_DARK, bg: tones.dark },
    {
      scope: "dark",
      state: "hover",
      label: "마우스를 얹었을 때",
      fg: CUSTOMER_ROW_TEXT_ON_DARK,
      bg: tones.darkHover,
    },
  ];
  return pairs.map((pair) => ({ ...pair, ratio: contrastRatio(pair.fg, pair.bg) }));
}

/**
 * "회색에 가깝다"고 볼 채도의 윗선(HSL 채도, 0~1).
 *
 * 줄은 밝기 0.92 에 칠해지므로 채도 s 인 색의 채널 폭은 2 × (1 − 0.92) × s =
 * 0.16s 다. 팔레트 열 색은 채도가 0.9 이상이라 폭이 0.15 쯤 되고, s 가 0.25 밑이면
 * 폭이 그 4분의 1(한 채널에 10/255 남짓)도 안 되어 **거의 흰 회색**으로 보인다 —
 * 완료된 줄(zinc-200)과 나란히 놓였을 때 가려지지 않는 자리다.
 *
 * 메인 컬러의 UI_THEME_TINT_MIN_SATURATION(0.15)을 쓰지 않는 까닭: 그 값은 주
 * 버튼처럼 **진하게 칠해지는 자리**에서 "색조가 있는가"를 가르는 선이다. 같은
 * 채도라도 옅게 칠하면 색이 훨씬 덜 보인다.
 */
export const CUSTOMER_ROW_GRAYISH_SATURATION = 0.25;

/**
 * 완료된 줄의 회색과 헷갈릴 만큼 채도가 낮은 색인가. 막지는 않는다 — 고르개가
 * 알리기만 한다(머리말 '완료된 줄의 회색과 겹치지 않는다').
 *
 * `seed` 는 정리된 색 코드여야 한다.
 */
export function isCustomerRowColorGrayish(seed: string): boolean {
  return uiThemeTintOf(seed).saturation < CUSTOMER_ROW_GRAYISH_SATURATION;
}

/**
 * 직접 고른 색이 쓰는 클래스 — 색이 무엇이든 **늘 이 넷**이다. 값은 CSS 변수로
 * 받는다(customerRowColorStyle). 🔴 온전한 글자 그대로 둘 것(머리말).
 *
 * 변수 이름은 아래 CUSTOM_STYLE_VARIABLES 와 짝이다. 한쪽만 고치면 색이 사라지므로
 * 시험이 두 목록을 대조한다.
 */
const CUSTOM_CLASSES = {
  lightClass: "bg-[var(--customer-row-bg)]",
  darkClass: "dark:bg-[var(--customer-row-bg-dark)]",
  lightHoverClass: "hover:bg-[var(--customer-row-bg-hover)]",
  darkHoverClass: "dark:hover:bg-[var(--customer-row-bg-dark-hover)]",
} as const;

/** 위 클래스가 읽는 변수 → 네 가지 색 중 어느 것인가. */
const CUSTOM_STYLE_VARIABLES: Readonly<Record<string, keyof CustomerRowCustomTones>> = {
  "--customer-row-bg": "light",
  "--customer-row-bg-dark": "dark",
  "--customer-row-bg-hover": "lightHover",
  "--customer-row-bg-dark-hover": "darkHover",
};

function buildCustomColor(hex: string): CustomerRowCustomColor {
  return {
    kind: "custom",
    key: hex,
    label: `${CUSTOMER_ROW_CUSTOM_COLOR_LABEL} ${hex}`,
    ...CUSTOM_CLASSES,
    tones: computeCustomerRowCustomTones(hex),
  };
}

// ──────────────────────────────────────────────────────────── 읽기·칠하기

/**
 * 저장된 값 → 색. 팔레트 키면 팔레트 색, 올바른 색 코드면 직접 고른 색(정리된
 * 코드로 읽는다)이다. **없음이거나 모르는 값이면 null 이다**(파일 헤더의 '모르는
 * 값은 조용히 없음이다'). 부르는 쪽은 null 을 "색을 칠하지 않는다"로만 읽으면 된다.
 */
export function resolveCustomerRowColor(
  key: string | null | undefined
): ResolvedCustomerRowColor | null {
  if (key === null || key === undefined) return null;
  const palette = BY_KEY.get(key);
  if (palette) return palette;
  const hex = normalizeCustomerRowCustomColor(key);
  return hex === null ? null : buildCustomColor(hex);
}

/**
 * 칠할 배경 클래스. 색이 없으면 **빈 문자열**이다 — 부르는 쪽이 className 에
 * 그대로 이어 붙여도 아무 일도 일어나지 않는다.
 *
 * 직접 고른 색이면 변수를 읽는 고정 클래스가 나온다 — 🔴 그 자리에는
 * customerRowColorStyle 도 함께 붙여야 색이 보인다.
 *
 * 누를 수 없는 자리(묶음 소제목)가 쓴다. 누를 수 있는 줄은 아래 쪽이다.
 */
export function customerRowColorClass(key: string | null | undefined): string {
  const color = resolveCustomerRowColor(key);
  return color === null ? "" : `${color.lightClass} ${color.darkClass}`;
}

/**
 * 누를 수 있는 줄이 쓰는 배경 클래스 — 위 배경에 hover 색조까지 함께.
 *
 * hover 를 함께 주는 이유: 이 표의 줄은 눌러서 수정 폼을 여는 줄이고, 그 사실을
 * 알리는 것이 hover 색이다. 고객사 색만 칠하고 기존 회색 hover 를 그대로 두면
 * 마우스를 얹는 순간 고객사 색이 사라져 다른 줄처럼 보인다.
 */
export function customerRowColorInteractiveClass(key: string | null | undefined): string {
  const color = resolveCustomerRowColor(key);
  if (color === null) return "";
  return `${color.lightClass} ${color.darkClass} ${color.lightHoverClass} ${color.darkHoverClass}`;
}

/**
 * 칠하는 자리에 클래스와 **함께** 붙이는 style. 직접 고른 색일 때만 네 가지 색을
 * CSS 변수로 담아 돌려주고, 팔레트 색이거나 없음이면 undefined 다 — 그대로
 * `style={...}` 에 넘기면 아무것도 붙지 않는다.
 *
 * 변수만 담는다. 칠하는 것은 여전히 클래스이고(밝은/어두운 화면과 hover 를
 * 브라우저가 고른다), 이 값은 그 클래스가 읽을 색을 줄마다 알려 줄 뿐이다.
 * 값은 이 파일이 만든 소문자 hex 여섯 자리뿐이라 규칙을 탈출할 글자가 없다.
 */
export function customerRowColorStyle(key: string | null | undefined): CSSProperties | undefined {
  const color = resolveCustomerRowColor(key);
  if (color === null || color.kind !== "custom") return undefined;
  const style: Record<string, string> = {};
  for (const [variable, tone] of Object.entries(CUSTOM_STYLE_VARIABLES)) {
    style[variable] = color.tones[tone];
  }
  return style as CSSProperties;
}
