"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * ============================================================================
 * 주간보고 상세표의 견적서 번호를 **한 번에 펼치고 접는다** — [견적서 번호 보기]
 * ============================================================================
 * 고르개(`전체 / RFG 만 / MB 만`) **옆**의 단추 하나가 이 화면의 모든 상세표에서
 * `견적서 발행일` 칸의 견적서 번호를 **전부 펼치고**, 한 번 더 누르면 **전부 접는다**
 * (사용자 지시 2026-10-07).
 *
 * ── 🔴 왜 Context 인가 — 화면을 클라이언트로 옮기지 않기 위해서다 ─────────
 * 단추는 머리말 카드에 있고 번호 칸은 고객사 블록 58개 × 상세표 250여 줄 안에 있다.
 * 그 둘이 **같은 상태**를 보려면 공통 조상이 상태를 들어야 하는데, 그 조상이
 * WeeklyReportScreen 이다 — 거기에 `"use client"` 를 붙이면 블록 58개와 상세표
 * 250여 줄이 통째로 브라우저로 실려 간다(그 파일 헤더).
 *
 * 그래서 이 Provider 가 화면 안쪽을 **children 으로 받아** 감싼다. 서버에서 렌더된
 * 자식을 클라이언트 컴포넌트의 children 으로 넘기는 구조라, 자식은 서버 컴포넌트로
 * 남고 그 사이에 끼어 있는 클라이언트 조각(이 단추 ·
 * WeeklyReportQuoteNumbersCell)만 이 context 를 구독한다. 같은 폴더의
 * WeeklyReportBlockStatusEdit 이 먼저 쓴 방식 그대로다.
 *
 * 🔴 **이 Provider 는 DOM 을 만들지 않는다.** 감싸는 자리가 flex 상자 안이라,
 * 여기서 `<div>` 하나라도 두르면 구역 사이 간격이 무너진다.
 *
 * ── 🔴 고르개와 **한 조각에 섞지 않는다** ────────────────────────────────
 * `전체 / RFG 만 / MB 만` 은 **링크**다 — 어느 종류를 보는지는 주소가 들고 있고
 * 서버가 그린다(WeeklyReportScreen 의 KindFilterTabs). 이 단추는 주소에 남지 않는
 * **보기 상태**라 클라이언트다. 둘을 한 컴포넌트로 묶으면 고르개가 클라이언트로
 * 끌려 들어가고, 새로고침·링크·인쇄에서 고른 종류가 사라진다.
 *
 * ── 🔴 전체 펼침과 **줄마다 펼침**이 어떻게 어울리는가 ───────────────────
 * 두 가지가 한 칸을 두고 다툰다. 규칙은 이렇다:
 *
 *   1. 평소에는 **줄마다의 역삼각**이 이긴다 — 전체를 펼친 뒤 한 줄만 접으면
 *      **그 줄만** 접히고 나머지는 펼친 채로 있다. 반대도 같다(전부 접힌 상태에서
 *      한 줄만 펼치면 그 줄만 펼쳐진다).
 *   2. 🔴 [견적서 번호 보기]를 **누르는 순간 줄마다 바꿔 둔 것은 전부 버려진다** —
 *      화면 전체가 「모두 펼침」이나 「모두 접힘」 **한 상태**가 된다. 그래야 단추의
 *      뜻이 흔들리지 않는다: 눌렀는데 어떤 줄은 펼쳐지지 않으면 사람은 그 줄을
 *      「번호가 없는 줄」로 읽는다.
 *
 * 그 2번을 **nonce(누른 횟수)** 로 푼다. 칸은 자기가 바꾼 값을 그때의 nonce 와 함께
 * 들고 있고, 단추를 누르면 nonce 가 올라가 그 값이 **저절로 낡은 것이 된다** — 칸이
 * 자기 상태를 지우는 useEffect 도, 줄 id 를 열쇠로 하는 Map 도 필요 없다. 🔴 Map 을
 * 두지 않은 까닭이 그것이다: 250여 줄의 id 를 브라우저로 내려보내지 않는다.
 *
 * ── 🔴 단추는 종이에 찍히지 않는다(`print:hidden`) ───────────────────────
 * 이 화면은 원본 엑셀을 대신하는 문서라 종이로 자주 나간다 — 눌리지 않는 단추가
 * 종이 맨 위에 찍히면 안 된다(고르개와 같은 규율).
 *
 * **펼쳐 둔 번호는 종이에 나온다.** 숨기지 않는 까닭: 이 화면은 그대로 인쇄해 쓰는
 * 문서이고, 번호를 보려고 펼친 사람이 뽑은 종이에 그것이 빠져 있으면 종이와 화면이
 * 다른 것을 말하게 된다. 접어 둔 줄의 번호는 애초에 그려지지 않으므로 종이에도
 * 없다 — 즉 **종이에 나오는 번호는 사람이 펼친 것뿐**이다.
 * ============================================================================
 */

/** 단추의 글자. 사용자가 적어 준 그대로다(2026-10-07). */
export const WEEKLY_REPORT_QUOTE_NUMBERS_TOGGLE_LABEL = "견적서 번호 보기";

/**
 * 단추의 옷. 고르개 단추(KindFilterTabs)와 **같은 크기·같은 모서리**다 — 바로 옆에
 * 서는 자리라 높이가 다르면 줄이 어긋나 보인다. 다만 고르개는 링크라 「지금 보는 것」을
 * 짙게 칠하고, 이쪽은 눌린 상태를 같은 방식으로 보인다(아래 PRESSED).
 */
const TOGGLE_BASE = "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors print:hidden";
const TOGGLE_PRESSED =
  "border-primary-900 bg-primary-900 text-white dark:border-primary-50 dark:bg-primary-50 dark:text-zinc-900";
const TOGGLE_IDLE =
  "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

type QuoteNumbersExpandValue = {
  /** 지금 「모두 펼침」인가. 줄마다 바꾼 것이 없으면 모든 칸이 이 값을 따른다. */
  expandAll: boolean;
  /**
   * 🔴 단추를 누른 횟수. 칸이 자기 값을 **언제 버려야 하는지**를 이 숫자 하나로
   * 안다(파일 헤더의 2번 규칙). 값 자체에 뜻은 없고 **달라졌다는 사실**만 쓴다.
   */
  nonce: number;
  toggleAll: () => void;
};

const WeeklyReportQuoteNumbersContext = createContext<QuoteNumbersExpandValue | null>(null);

/**
 * context 가 없으면 **던진다.** 조용히 「접힘」으로 버티면 [견적서 번호 보기]를 눌러도
 * 아무 일도 일어나지 않는 화면이 되고, 사람은 그것을 「번호가 없다」로 읽는다 —
 * 이웃 WeeklyReportBlockStatusEdit 과 같은 판단이다. 감싸는 자리는 한 곳뿐이라
 * (WeeklyReportScreen) 화면을 열면 곧바로 드러난다.
 */
function useQuoteNumbersExpand(): QuoteNumbersExpandValue {
  const value = useContext(WeeklyReportQuoteNumbersContext);
  if (value === null) {
    throw new Error("WeeklyReportQuoteNumbersProvider 안에서만 쓸 수 있습니다.");
  }
  return value;
}

/**
 * 칸 하나가 지금 펼쳐져 있는가 — 그리고 그 칸이 스스로 바꿀 손잡이.
 *
 * `isOpen` 은 **그 칸이 단추를 누른 뒤에 스스로 바꿨으면 그 값**, 아니면 전체 값이다
 * (파일 헤더의 두 규칙이 이 한 줄에 있다).
 */
export function useWeeklyReportQuoteNumbersRow(
  localState: { nonce: number; isOpen: boolean } | null
): { isOpen: boolean; nonce: number } {
  const { expandAll, nonce } = useQuoteNumbersExpand();
  const isOpen = localState !== null && localState.nonce === nonce ? localState.isOpen : expandAll;
  return { isOpen, nonce };
}

/**
 * 고르개 옆에 서는 단추 하나 — 모두 펼치기 / 모두 접기.
 *
 * 🔴 **글자는 늘 `견적서 번호 보기` 다**(사용자가 적어 준 이름). 펼쳐져 있는지는
 * `aria-pressed` 와 **눌린 색**으로 말한다 — 글자를 「접기」로 바꾸면 사용자가 지정한
 * 이름이 화면에서 사라지고, 종류 고르개 옆에서 글자 폭이 왔다 갔다 해 줄이 흔들린다.
 */
export function WeeklyReportQuoteNumbersToggle() {
  const { expandAll, toggleAll } = useQuoteNumbersExpand();
  return (
    <button
      type="button"
      onClick={toggleAll}
      aria-pressed={expandAll}
      title={expandAll ? "견적서 번호 모두 접기" : "견적서 번호 모두 펼치기"}
      className={`${TOGGLE_BASE} ${expandAll ? TOGGLE_PRESSED : TOGGLE_IDLE}`}
    >
      {WEEKLY_REPORT_QUOTE_NUMBERS_TOGGLE_LABEL}
    </button>
  );
}

/**
 * 화면 하나에 **하나**. 🔴 DOM 을 만들지 않는다(파일 헤더).
 */
export function WeeklyReportQuoteNumbersProvider({ children }: { children: ReactNode }) {
  const [expandAll, setExpandAll] = useState(false);
  const [nonce, setNonce] = useState(0);

  function toggleAll() {
    setExpandAll((previous) => !previous);
    // 🔴 이 한 줄이 「줄마다 바꿔 둔 것을 전부 버린다」는 규칙이다(파일 헤더).
    setNonce((previous) => previous + 1);
  }

  return (
    <WeeklyReportQuoteNumbersContext.Provider value={{ expandAll, nonce, toggleAll }}>
      {children}
    </WeeklyReportQuoteNumbersContext.Provider>
  );
}
