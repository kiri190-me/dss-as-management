import type { CSSProperties } from "react";

/**
 * ============================================================================
 * 주간보고 화면의 가로폭 — 걸러 볼 때만 사람이 정한다
 * ============================================================================
 * `RFG 만` · `MB 만` 으로 걸러 보면 이 화면의 다섯 구역이 한꺼번에 **한 칸**이
 * 된다(WeeklyReportScreen 의 SINGLE_COLUMN_GRID). 두 칸이 쓰던 폭을 한 칸이
 * 그대로 다 쓰니, 넓은 화면에서는 상세표 한 줄이 끝에서 끝까지 늘어져 눈이
 * 가로로 멀리 간다. 그래서 **걸러 볼 때만** 가로폭을 좁힐 수 있게 한다.
 *
 * 이 파일은 그 계산만 한다 — 화면을 그리는 일도, `localStorage` 를 실제로
 * 두드리는 일도 여기 들어오지 않는다(attachment-gallery-zoom.ts 와 같은 모양이다).
 * 브라우저를 부르는 자리는 components/dashboard/WeeklyReportWidthFrame.tsx
 * 하나뿐이고, 그래서 아래 규칙이 Node 단위 테스트로 그대로 돌아간다.
 *
 * ── 폭은 퍼센트 정수다 ──────────────────────────────────────────────────
 * 화면에 `70%` 라고 적히는 그 숫자를 그대로 들고 다닌다. 0.7 같은 소수로 두면
 * 저장했다 읽는 사이에 오차가 끼어들어 단계 격자에서 미끄러지고, 그러면
 * `−`/`+` 를 눌러도 한 단계가 온전히 움직이지 않는다
 * (attachment-gallery-zoom.ts 의 같은 자리에 같은 사정이 적혀 있다).
 *
 * ── 좁히는 것은 **화면 전체**다 ─────────────────────────────────────────
 * 구역마다 따로 좁히지 않는다. 예전에 집계 구역에만 `max-w-3xl` 을 걸었다가
 * 「소제목과 상세표는 블록 폭을 꽉 채우는데 가운데 집계만 짧게 끝나 오른쪽이
 * 빈다」는 지적을 받고 걷어낸 적이 있다(WeeklyReportScreen.tsx 의 그 자리 주석).
 * 그래서 이 값은 다섯 구역을 통째로 감싼 상자 하나에만 걸린다 — 같은 폭에서
 * 같이 움직여야 화면이 한 장의 문서로 남는다.
 * ============================================================================
 */

/**
 * 가로폭이 움직이는 구간 — **40% ~ 100%** 다.
 *
 * 🔴 **위가 100% 인 것이 이 기능의 뜻이다.** 100% 가 지금 화면이고, 이 기능은
 * 넓히는 것이 아니라 **좁히는** 것이다. 100 을 넘기면 감싼 상자가 제 자리보다
 * 넓어져 화면 밖으로 나가고, 주간보고 전체에 가로 스크롤이 생긴다 — 상세표가
 * 이미 가로로 긴 화면이라 그 스크롤은 곧바로 읽기를 방해한다.
 *
 * 아래(40%):
 *   한 칸만 남은 화면을 종이 한 장 너비쯤으로 모으는 자리다. 그 아래로 더
 *   내리지 않는 까닭은 상세표가 칸 수가 정해진 표이기 때문이다 — 더 좁히면
 *   글자가 작아지는 것이 아니라 **칸 안에서 줄바꿈이 무너진다.**
 */
export const WEEKLY_REPORT_WIDTH_PERCENT_RANGE: { min: number; max: number } = {
  min: 40,
  max: 100,
};

/**
 * `−`/`+` 한 번에 움직이는 폭. 5% 다.
 *
 * 한 번 눌러 달라진 것이 눈에 보일 만큼은 되고, 끝에서 끝까지 12번이라 큰
 * 이동은 슬라이더가 · 미세 조정은 단추가 맡는 모양이 된다(미리보기 크기 조절
 * 바와 같은 갈래다).
 */
export const WEEKLY_REPORT_WIDTH_STEP_PERCENT = 5;

/**
 * 아무것도 안 고른 사람이 보는 가로폭 — **100%, 지금 화면 그대로다.**
 *
 * 🔴 조절 기능이 생겼다고 남의 화면이 저절로 바뀌지는 않게 하려는 것이다. 폭이
 * 불만이었던 사람만 움직이면 된다. 이 약속은 말로만 두지 않는다 —
 * weeklyReportWidthStyle 이 100% 에서 **아무 style 도 내놓지 않아**, 고르지 않은
 * 사람의 화면에는 폭을 정하는 속성이 한 줄도 붙지 않는다.
 */
export const DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT = 100;

/**
 * 이 브라우저에 가로폭을 적어 둘 이름.
 *
 * `무엇:어디` 꼴은 목록 보기 방식(`list-view-mode:<목록 이름>`)이 쓰는 그
 * 규칙이다(common/responsive-list.tsx).
 *
 * 🔴 **열쇠에 `RFG` · `MB` 를 넣지 않는다 — 사용자 요구다.** 「RFG 만에서 조절한
 * 가로폭이 MB 만에도 적용되어야 한다」가 그 말 그대로였다. 종류마다 따로 적어
 * 두면 고르개를 옮길 때마다 폭이 튀어, 같은 문서를 보고 있다는 느낌이 깨진다.
 */
export const WEEKLY_REPORT_WIDTH_STORAGE_KEY = "weekly-report-table-width:dashboard";

/**
 * 범위 안으로 접고, **단계 격자에 붙인다.**
 *
 * 격자에 붙이는 것이 핵심이다. 어디선가 67 같은 값이 들어오면(저장소에 남은 옛
 * 값, 손으로 고친 값) 그 뒤로 `−`/`+` 가 62→57 로 흐르고 한계인 40 에는 영영
 * 정확히 닿지 못한다. 들어오는 자리에서 한 번 붙여 두면 그 뒤의 모든 계산이
 * 격자 위에서만 논다.
 *
 * NaN·Infinity 는 기본값(100%)으로 되돌린다. 이 값에는 「원래대로」가 분명히
 * 있고 그것이 기본값이라, 값이 성립하지 않을 때 돌아갈 곳도 거기다.
 */
export function clampWeeklyReportWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT;

  const { min, max } = WEEKLY_REPORT_WIDTH_PERCENT_RANGE;
  if (value <= min) return min;
  if (value >= max) return max;

  const steps = Math.round((value - min) / WEEKLY_REPORT_WIDTH_STEP_PERCENT);
  const snapped = min + steps * WEEKLY_REPORT_WIDTH_STEP_PERCENT;
  return snapped > max ? max : snapped;
}

/**
 * 한 단계 옮긴다. `+`(넓히기)는 1, `−`(좁히기)는 -1 이다.
 *
 * 한계 밖으로는 나가지 않는다(clamp 가 막는다) — 화면에서는 그때 단추가 눌리지
 * 않게 되지만, 키보드나 다른 길로 한 번 더 들어와도 값이 새지 않아야 한다.
 */
export function stepWeeklyReportWidth(percent: number, steps: number): number {
  const current = clampWeeklyReportWidth(percent);
  if (!Number.isFinite(steps)) return current;
  return clampWeeklyReportWidth(current + Math.round(steps) * WEEKLY_REPORT_WIDTH_STEP_PERCENT);
}

/** `+`(넓히기)를 누를 수 있는가. 못 누를 때 단추를 죽여 두는 데 쓴다. */
export function canWidenWeeklyReport(percent: number): boolean {
  return clampWeeklyReportWidth(percent) < WEEKLY_REPORT_WIDTH_PERCENT_RANGE.max;
}

/** `−`(좁히기)를 누를 수 있는가. */
export function canNarrowWeeklyReport(percent: number): boolean {
  return clampWeeklyReportWidth(percent) > WEEKLY_REPORT_WIDTH_PERCENT_RANGE.min;
}

/**
 * 감싸는 상자에 붙일 style. **100% 에서는 `undefined` 다.**
 *
 * 🔴 `undefined` 가 이 파일에서 가장 중요한 한 줄이다. 기본값인 사람의 화면에는
 * `style` 속성 자체가 붙지 않아, 「기능이 생겨도 남의 화면은 한 픽셀도 안
 * 바뀐다」가 말이 아니라 **코드로 보증된다**(시험이 이 값을 못 박는다).
 *
 * `width` 가 아니라 `maxWidth` 인 까닭: 감싸는 상자는 `w-full` 이라 제 자리를 다
 * 쓰려 하고, 여기서 그 위에 한계만 씌운다. 그러면 자리가 이 한계보다 좁은
 * 화면(폰·좁은 창)에서는 한계가 아무 일도 하지 않아, 좁혀 둔 채로 폰을 열어도
 * 화면이 더 쪼그라들지 않는다.
 *
 * 🔴 **가운데 정렬은 여기서 하지 않는다** — 감싸는 상자의 `mx-auto` 가 한다.
 * 폭만 줄이면 격자 칸의 `justify-self` 가 `start` 로 떨어져 왼쪽으로 쏠린다.
 */
export function weeklyReportWidthStyle(percent: number): CSSProperties | undefined {
  const value = clampWeeklyReportWidth(percent);
  if (value >= WEEKLY_REPORT_WIDTH_PERCENT_RANGE.max) return undefined;
  return { maxWidth: `${value}%` };
}

/** 조절 바 오른쪽에 적는 글자. `70%` 꼴이다. */
export function formatWeeklyReportWidth(percent: number): string {
  return `${clampWeeklyReportWidth(percent)}%`;
}

// ────────────────────────────────────────────────── 그 브라우저에 적어 두기

/**
 * `localStorage` 처럼 생긴 것. 실물을 직접 부르지 않고 이 모양으로 받는 이유는
 * 두 가지다 — 시험에서 **던지는 저장소**를 그대로 흉내 낼 수 있고, 이 파일이
 * 브라우저 전역에 손대지 않아 Node 에서 그대로 돈다.
 * (attachment-gallery-zoom.ts 의 GalleryZoomStore 와 같은 장치다.)
 */
export type WeeklyReportWidthStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * 적혀 있던 글자를 가로폭으로 읽는다. **무엇이 적혀 있어도 쓸 수 있는 값이 나온다.**
 *
 * 없음·빈 글자·숫자가 아닌 글자·`NaN`·`Infinity` 는 전부 기본값이고, 범위 밖
 * 숫자는 한계로 접힌다. 남이 넣어 둔 엉뚱한 글자가 곧바로 화면의 상태가 되어서는
 * 안 된다는 규칙(responsive-list 의 useStoredChoice 주석)을 여기서 지킨다.
 */
export function parseWeeklyReportWidth(raw: string | null): number {
  if (raw === null) return DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT;
  const text = raw.trim();
  if (text === "") return DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT;

  const value = Number(text);
  if (!Number.isFinite(value)) return DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT;
  return clampWeeklyReportWidth(value);
}

/**
 * 적어 둔 가로폭을 읽는다. **어떤 경우에도 던지지 않는다.**
 *
 * 사생활 보호 창이나 저장을 막아 둔 브라우저에서는 저장소에 손대는 것 자체가
 * 터진다. 그때 여기서 던지면 주간보고 화면 전체가 죽는다 — 가로폭 하나 때문에
 * 이번 주 현황을 못 보게 되는 것이다. 못 읽으면 기본값(100%)으로 그린다.
 */
export function readWeeklyReportWidth(
  store: WeeklyReportWidthStore | null,
  storageKey: string
): number {
  if (!store) return DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT;
  try {
    return parseWeeklyReportWidth(store.getItem(storageKey));
  } catch {
    return DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT;
  }
}

/**
 * 적어 둔다. 읽기와 같은 이유로 **어떤 경우에도 던지지 않는다**(저장 공간이 꽉 찬
 * 경우 포함).
 *
 * 🔴 적지 못했을 때를 부르는 쪽이 받쳐 준다 — WeeklyReportWidthFrame 이 고른
 * 값을 제 안에 따로 들고 있어서, 저장이 막힌 브라우저에서도 **이번 방문 동안은**
 * 슬라이더가 그대로 먹힌다. 그 받침이 없으면 움직일 때마다 값이 제자리로 튀어
 * 고장으로 보인다. 못 적은 대가는 다음에 열었을 때 기본값으로 돌아가는 것뿐이다.
 */
export function writeWeeklyReportWidth(
  store: WeeklyReportWidthStore | null,
  storageKey: string,
  percent: number
): void {
  if (!store) return;
  try {
    store.setItem(storageKey, String(clampWeeklyReportWidth(percent)));
  } catch {
    // 이번 방문 동안은 화면이 그대로 따라온다(부르는 쪽이 값을 들고 있다).
  }
}
