"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import {
  DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT,
  WEEKLY_REPORT_WIDTH_PERCENT_RANGE,
  WEEKLY_REPORT_WIDTH_STEP_PERCENT,
  WEEKLY_REPORT_WIDTH_STORAGE_KEY,
  canNarrowWeeklyReport,
  canWidenWeeklyReport,
  clampWeeklyReportWidth,
  formatWeeklyReportWidth,
  readWeeklyReportWidth,
  stepWeeklyReportWidth,
  weeklyReportWidthStyle,
  writeWeeklyReportWidth,
  type WeeklyReportWidthStore,
} from "@/lib/domain/weekly-report-table-width";

/**
 * ============================================================================
 * 주간보고 가로폭 — 걸러 볼 때만 나오는 조절 바와, 화면을 감싸는 상자
 * ============================================================================
 * 판정은 전부 lib/domain/weekly-report-table-width.ts 가 한다. 여기 있는 것은
 * `window.localStorage` 를 실제로 두드리는 일과, 그 값이 바뀌었음을 화면에
 * 알리는 일, 그리고 **감싼 상자를 가운데에 두는 일** 셋뿐이다.
 *
 * ── 🔴 감싸는 쪽이 클라이언트가 되고, 감싸이는 쪽은 서버로 남는다 ────────
 * WeeklyReportScreen 은 서버 컴포넌트다 — "use client" 를 붙이면 고객사 블록
 * 58개와 상세표 250여 줄이 통째로 브라우저로 실려 간다(그 파일 헤더). 그래서
 * 이 상자는 화면을 `children` 으로 받는다. `children` 은 부르는 쪽(서버)에서
 * 이미 그려진 것이 내려오므로, 이 파일이 클라이언트여도 주간보고 본문은 서버에
 * 그대로 남는다.
 *
 * ── 🔴 `전체` 일 때는 한 픽셀도 바뀌지 않는다 ───────────────────────────
 * 걸러 보지 않는 화면에는 **조절 바도, 감싸는 <div> 조차도 없다** — 아래
 * 첫 줄이 children 을 그대로 돌려준다. 좌우 두 칸이 갈리는 폭이 이 화면의
 * 기준이라, 거기에 폭 한계가 끼어들면 두 칸이 갈리는 지점이 조용히 달라진다.
 *
 * ── 🔴 가운데를 잡는 것은 `mx-auto` 다 ──────────────────────────────────
 * 폭만 줄이면 **반드시 왼쪽으로 쏠린다.** 한 칸짜리 격자의 칸은 기본이
 * `stretch` 지만, 명시 폭(여기서는 max-width)이 정해지는 순간 `start` 로 떨어져
 * 왼쪽에 붙기 때문이다. 「가운데 중심을 유지해야 한다」는 요구가 그것을 가리킨
 * 것이고, mx-auto 가 그 한 줄이다.
 *
 * ── 🔴 종이에서는 원래 폭으로 돌아간다 ─────────────────────────────────
 * 조절 바는 print:hidden 이고(고르개와 같은 이유 — 눌리지 않는 단추가 종이에
 * 찍히면 안 된다), 감싼 상자는 `print:!max-w-none` 으로 한계를 푼다. 인라인
 * style 을 이기려면 `!important` 가 필요해서 그 자리만 `!` 를 쓴다. 종이는 폭이
 * 이미 A4 로 정해져 있어, 거기서 또 좁히면 글자만 작아지고 여백만 늘어난다.
 *
 * ⚠️ **이 상자에 높이(h-* · flex-1)를 주지 말 것.** 이 화면에서 그렇게 했다가
 * 세로 스크롤바가 둘로 보이는 고장이 난 적이 있다(WeeklyReportScreen 헤더의
 * `상세표 래퍼에 flex-1 을 주지 말 것`).
 * ============================================================================
 */

/**
 * 값이 바뀌었을 때 다시 그릴 화면들. useSyncExternalStore 를 쓰는 까닭은
 * StoredAttachmentList 와 같다 — 첫 렌더에서 그냥 읽으면 서버가 그린 것과 달라져
 * hydration 이 어긋나고, effect 에서 읽어 setState 하면 기본 폭이 한 프레임 스쳐
 * 지나간다.
 */
const weeklyReportWidthListeners = new Set<() => void>();

/**
 * 저장을 막아 둔 브라우저에서도 **이번 방문 동안은** 조절이 먹히게 하는 자리.
 *
 * 화면이 저장소만 보고 그리면, 적히지 않는 브라우저에서는 슬라이더를 아무리
 * 움직여도 값이 되돌아온다 — 고장으로 보인다. 적어 두기와 별개로 여기에 들고
 * 있으면 화면은 따라오고, 못 적은 대가는 다음에 열 때 기본값으로 돌아가는
 * 것뿐이다.
 */
let weeklyReportWidthInMemory: number | null = null;

/**
 * 저장소를 집는다. **속성을 읽는 것 자체가 던진다**(사생활 보호 창, 저장을 막아
 * 둔 브라우저). 그래서 접근을 통째로 감싼다.
 */
function weeklyReportWidthStore(): WeeklyReportWidthStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function subscribeWeeklyReportWidth(listener: () => void): () => void {
  weeklyReportWidthListeners.add(listener);
  return () => {
    weeklyReportWidthListeners.delete(listener);
  };
}

/**
 * 지금 가로폭. 숫자라 값으로 비교되므로 useSyncExternalStore 가 매번 같은 것으로
 * 본다(참조가 흔들려 무한히 다시 그리는 일이 없다).
 */
function readWeeklyReportWidthSnapshot(): number {
  if (weeklyReportWidthInMemory !== null) return weeklyReportWidthInMemory;
  return readWeeklyReportWidth(weeklyReportWidthStore(), WEEKLY_REPORT_WIDTH_STORAGE_KEY);
}

/** 서버에는 저장소가 없다. 아직 아무것도 안 고른 사람과 같은 화면(100%)을 준다. */
function readWeeklyReportWidthServerSnapshot(): number {
  return DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT;
}

function setWeeklyReportWidth(percent: number): void {
  weeklyReportWidthInMemory = clampWeeklyReportWidth(percent);
  writeWeeklyReportWidth(
    weeklyReportWidthStore(),
    WEEKLY_REPORT_WIDTH_STORAGE_KEY,
    weeklyReportWidthInMemory
  );
  for (const listener of weeklyReportWidthListeners) listener();
}

export default function WeeklyReportWidthFrame({
  /**
   * 🔴 걸러져 있는가(`RFG 만` · `MB 만`). 거짓이면 이 파일은 아무 일도 하지
   * 않는다 — 훅도 돌지 않게 아래에서 갈라 둔다.
   */
  isFiltered,
  children,
}: {
  isFiltered: boolean;
  children: ReactNode;
}) {
  // 🔴 `전체` 화면에는 상자도 조절 바도 붙지 않는다. Fragment 라 DOM 이 한 칸도
  //    늘지 않는다 — 지금 화면과 한 픽셀도 다르지 않다.
  if (!isFiltered) return <>{children}</>;
  return <FilteredWeeklyReportWidthFrame>{children}</FilteredWeeklyReportWidthFrame>;
}

/**
 * 걸러 볼 때의 화면. 훅은 여기에만 있다 — `전체` 일 때는 이 컴포넌트가 아예
 * 그려지지 않아, 조절하지 않는 사람의 브라우저는 저장소를 들여다보지도 않는다.
 */
function FilteredWeeklyReportWidthFrame({ children }: { children: ReactNode }) {
  const percent = useSyncExternalStore(
    subscribeWeeklyReportWidth,
    readWeeklyReportWidthSnapshot,
    readWeeklyReportWidthServerSnapshot
  );
  /** 100% 면 undefined 다 — 그때는 style 속성 자체가 붙지 않는다(도메인 주석). */
  const widthStyle = weeklyReportWidthStyle(percent);

  return (
    <div className="flex flex-col gap-2">
      {/* 조절 바도 본문과 같은 폭 안에 둔다 — 화면을 좁혀 놓았는데 조절 바만
          저 멀리 오른쪽 끝에 남아 있으면 무엇을 조절하는 바인지 흐려진다.
          🔴 종이에는 나오지 않는다(고르개와 같은 이유). */}
      <div className="mx-auto w-full print:hidden" style={widthStyle}>
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">가로폭</span>
          <button
            type="button"
            onClick={() => setWeeklyReportWidth(stepWeeklyReportWidth(percent, -1))}
            disabled={!canNarrowWeeklyReport(percent)}
            aria-label="가로폭 좁히기"
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium leading-none text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            −
          </button>
          {/* 키보드로도 조절된다 — `<input type="range">` 는 방향키를 저절로 받는다.
              지금 몇 %인지는 aria-valuetext 로 낭독기에 전해진다(오른쪽 글자는
              그래서 aria-hidden 이다 — 안 그러면 같은 값을 두 번 읽는다). */}
          <input
            type="range"
            min={WEEKLY_REPORT_WIDTH_PERCENT_RANGE.min}
            max={WEEKLY_REPORT_WIDTH_PERCENT_RANGE.max}
            step={WEEKLY_REPORT_WIDTH_STEP_PERCENT}
            value={percent}
            onChange={(event) => setWeeklyReportWidth(Number(event.target.value))}
            aria-label="주간보고 가로폭"
            aria-valuetext={formatWeeklyReportWidth(percent)}
            className="w-24 cursor-pointer accent-zinc-900 sm:w-40 dark:accent-zinc-100"
          />
          <button
            type="button"
            onClick={() => setWeeklyReportWidth(stepWeeklyReportWidth(percent, 1))}
            disabled={!canWidenWeeklyReport(percent)}
            aria-label="가로폭 넓히기"
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium leading-none text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            +
          </button>
          <span
            aria-hidden="true"
            className="w-10 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400"
          >
            {formatWeeklyReportWidth(percent)}
          </span>
        </div>
      </div>
      {/* 🔴 mx-auto 가 「가운데 중심 유지」의 핵심이고, print:!max-w-none 이
          종이에서 폭을 되돌린다(파일 헤더). */}
      <div className="mx-auto w-full print:!max-w-none" style={widthStyle}>
        {children}
      </div>
    </div>
  );
}
