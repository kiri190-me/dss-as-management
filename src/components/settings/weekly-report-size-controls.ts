import {
  UI_THEME_TOKENS,
  uiThemeTokenScreen,
  type UiThemeToken,
} from "@/lib/domain/ui-theme-tokens";

/**
 * ============================================================================
 * 개발자 모드 [주간보고] — 슬라이더가 쓰는 순수 도우미
 * ============================================================================
 * ThemeTokenEditor 의 `group="weeklyReport"` 화면이 쓴다. 저장·검증은 이 파일이
 * 하지 않는다 — 값의 옳고 그름은 여전히 등록부의 normalizeUiThemeValue 하나가
 * 정하고(서버도 같은 함수), 여기는 **사람이 만지는 모양**(슬라이더의 양 끝·눈금,
 * 숫자 칸의 글자)만 정한다. React 가 없는 파일로 뺀 이유는 시험이 이 값을 직접
 * 부를 수 있게 하려는 것이다(ui-theme-tokens.test.ts).
 * ============================================================================
 */

/**
 * 주간보고 화면이 맡는 토큰. 🔴 종류(kind)가 아니라 uiThemeTokenScreen 으로
 * 고른다 — 편집기의 GROUP_SLOTS · 개발자 모드 목차의 「N칸 바뀜」과 같은 함수라
 * 셋이 어긋날 자리가 없다.
 */
export const WEEKLY_REPORT_SIZE_TOKENS: readonly UiThemeToken[] = UI_THEME_TOKENS.filter(
  (token) => uiThemeTokenScreen(token) === "weeklyReport"
);

/** 글자 크기 묶음(지금 8개). */
export const WEEKLY_REPORT_FONT_TOKENS: readonly UiThemeToken[] = WEEKLY_REPORT_SIZE_TOKENS.filter(
  (token) => token.kind === "fontSize"
);

/** 상자 크기 묶음(지금 7개) — 여백·간격·최소 높이. */
export const WEEKLY_REPORT_BOX_TOKENS: readonly UiThemeToken[] = WEEKLY_REPORT_SIZE_TOKENS.filter(
  (token) => token.kind === "spacing"
);

/**
 * 주간보고 몫인데 글자도 상자도 아닌 것. 지금은 비어 있다. 등록부에 그런 토큰이
 * 들어온 날 두 묶음 어디에도 안 그려지면 편집할 길이 사라지므로, 편집기가 이
 * 목록을 글자 칸으로 따로 그린다(슬라이더 범위를 모르는 종류라서).
 */
export const WEEKLY_REPORT_OTHER_TOKENS: readonly UiThemeToken[] = WEEKLY_REPORT_SIZE_TOKENS.filter(
  (token) => token.kind !== "fontSize" && token.kind !== "spacing"
);

/**
 * 글자 크기의 범위(rem). 🔴 등록부 검증기(normalizeUiThemeValue 의 fontSize)가
 * 받는 범위와 **같아야** 한다 — 그 상수는 밖으로 내보내지 않으므로 여기 옮겨
 * 적고, 시험이 양 끝을 검증기에 대어 본다(끝은 통과, 한 눈금 밖은 거절).
 */
const FONT_SIZE_RANGE_REM = { min: 0.625, max: 1.5 } as const;

/** 한 눈금 = 1px(1/16rem). 글자 기본값 여덟이 전부 이 눈금 위에 있다. */
const FINE_STEP_REM = 0.0625;

export type WeeklyReportSizeRange = { min: number; max: number; step: number };

/**
 * 슬라이더의 양 끝과 눈금. 슬라이더를 그릴 수 없는 종류면 null 이다.
 *
 * 상자 크기는 등록부의 rangeRem 을 그대로 쓴다. 눈금은 범위가 넓을수록 굵게 —
 * 0~20rem 을 1px 눈금으로 두면 슬라이더 한 칸이 너무 잘아서 손으로 원하는 값에
 * 멈출 수 없다. 🔴 기본값이 반드시 눈금 위에 있어야 한다(시험이 단언한다) — 아니면
 * 슬라이더를 한 번 건드린 순간 기본값으로는 다시 못 돌아온다.
 */
export function weeklyReportSizeRange(token: UiThemeToken): WeeklyReportSizeRange | null {
  if (token.kind === "fontSize") {
    return { min: FONT_SIZE_RANGE_REM.min, max: FONT_SIZE_RANGE_REM.max, step: FINE_STEP_REM };
  }
  if (token.kind === "spacing" && token.rangeRem) {
    const { min, max } = token.rangeRem;
    const step = max <= 1 ? FINE_STEP_REM : max <= 2 ? 0.125 : 0.25;
    return { min, max, step };
  }
  return null;
}

/**
 * 정규화된 값("0.75rem" · "0")을 슬라이더가 받는 숫자로. rem 도 0 도 아니면 null.
 * 정규화된 값만 들어온다고 가정하지 않는다 — 모르는 모양이면 null 로 답해 부르는
 * 쪽이 기본값으로 메우게 한다.
 */
export function remNumberOf(value: string): number | null {
  if (value === "0") return 0;
  const match = /^(\d+(?:\.\d+)?|\.\d+)rem$/.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * 편집 중인 원문을 숫자 칸의 글자로. 칸 옆에 `rem` 이 붙어 있으므로 뒤의 `rem` 을
 * 뗀다. 원문을 그대로 들고 있어야 사람이 치는 중인 `0.` 같은 글자가 사라지지
 * 않는다(색 칸이 원문을 들고 있는 것과 같은 이유 — ThemeTokenEditor 의 normalized 주석).
 */
export function remTextOf(raw: string): string {
  return raw.endsWith("rem") ? raw.slice(0, -"rem".length) : raw;
}

/**
 * 숫자 칸·슬라이더의 글자를 편집 중인 원문으로. 비우면 빈 값(형식 오류로 보인다),
 * 아니면 `rem` 을 붙인다. 판정은 하지 않는다 — `0rem` 은 검증기가 `0` 으로 눕힌다.
 */
export function remValueFromText(text: string): string {
  const trimmed = text.trim();
  return trimmed === "" ? "" : `${trimmed}rem`;
}

/**
 * 미리보기 래퍼에 거는 인라인 style — 주간보고 토큰의 CSS 변수 **전부**를 편집 중인
 * 값으로 건다.
 *
 * 🔴 기본값인 칸도 빼지 않는다. 래퍼는 구조선(#ui-theme-lifeboat) 안에 있어 거기서
 * 기본값을 물려받지만, 인라인 선언이 래퍼 자신에게 걸리므로 물려받는 값을 언제나
 * 이긴다(구조선이 !important 를 쓰지 않는 이유가 이것이다). 다 걸어 두면 미리보기가
 * 무엇을 물려받는지 따질 필요 없이 **편집 중인 값 그대로**다.
 *
 * `values` 는 토큰 키 → 값(편집기의 resolved.light). 값이 없는 키는 건너뛴다.
 */
export function weeklyReportPreviewStyle(
  values: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const style: Record<string, string> = {};
  for (const token of WEEKLY_REPORT_SIZE_TOKENS) {
    const value = values[token.key];
    if (value !== undefined) style[token.cssVar] = value;
  }
  return style;
}
