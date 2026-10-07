"use client";

import { useState } from "react";
import { useWeeklyReportQuoteNumbersRow } from "./WeeklyReportQuoteNumbersExpand";

/**
 * ============================================================================
 * 주간보고 상세표의 `견적서 발행일` 한 칸 — 날짜 옆 **작은 역삼각**
 * ============================================================================
 * 날짜 오른쪽의 역삼각을 누르면 **그 칸 안, 날짜 아래로** 그 건의 견적서 번호들이
 * 펼쳐진다(사용자가 고른 모양, 2026-10-07):
 *
 *     견적서 발행일   현 상태   PO 발행일
 *     ──────────────────────────────────
 *      2026-03-14 ▾   수리중    2026-04-02
 *       DSS 2026-100
 *       DSS 2026-100-1
 *
 *      2026-03-20 ▾   견적중    —
 *
 * 🔴 **번호가 하나도 없는 줄에는 이 조각이 아예 오지 않는다**(사용자 결정) — 흐릿한
 * 역삼각도 두지 않는다. 그 판정은 부르는 쪽이 하고, 거짓이면 지금까지와 **똑같이**
 * 날짜 글자만 그린다(WeeklyReportScreen). 그래서 번호가 없는 줄은 브라우저로
 * 내려가는 바이트가 한 글자도 늘지 않는다 — 상세표가 250여 줄인 화면의 기존 규율
 * 그대로다(그 파일 헤더의 `비고` · `현 상태` 칸 설명).
 *
 * ── 🔴 번호는 **고객 안내 현황과 같은 번호**다 ──────────────────────────
 * 여기서 고르거나 다듬지 않는다. 조회가 두 화면이 **같은 함수**로 구한 값을 그대로
 * 실어 보낸다(db/queries/repair-case-quote-numbers.ts — 내자 정리에 적힌 번호가
 * 있으면 그것만, 없을 때만 공유폴더의 견적서 폴더 안 파일 이름에서 읽는다).
 *
 * ── 🔴 장기 PO 미발행의 빨간 볼드를 떨어뜨리지 않는다 ────────────────────
 * 그 옷은 **칸(`<td>`)에 그대로 남아 있다** — 이 조각은 칸 안의 내용만 그리므로 색과
 * 굵기는 지금까지와 똑같이 상속된다(WeeklyReportScreen 의 LONG_PENDING_PO_TONE).
 * 펼친 번호도 같은 색을 물려받는다: 그 줄에서 빨강은 「손이 필요하다」는 뜻이고,
 * 칸 안의 한 부분만 회색으로 빼면 그 뜻이 칸 가운데서 끊긴다.
 *
 * ── 열이 넓어지지 않게 ──────────────────────────────────────────────────
 * 번호는 `text-wr-meta`(11px — 표 본문 12px 보다 작다)로 적는다. 번호 글자
 * (`DSS 2026-100-1`)가 날짜(`2026-03-14`)보다 길어서, 본문 크기로 적으면 펼칠 때마다
 * 이 열이 넓어진다. 작은 글자 + 날짜 줄에 붙은 역삼각 폭까지 합치면 펼쳐도 열 폭이
 * 거의 그대로다. 그래도 넘치면 **상세표를 감싼 가로 스크롤 상자 안에서만** 밀린다
 * (WeeklyReportScreen 의 '가로 스크롤은 넘치는 그 줄 안에서만').
 *
 * ── 🔴 역삼각은 종이에 찍히지 않는다(`print:hidden`) ─────────────────────
 * 눌리지 않는 단추가 250줄에 찍히면 종이가 읽히지 않는다. **펼쳐 둔 번호는 종이에
 * 나온다** — 까닭은 WeeklyReportQuoteNumbersExpand 머리말에 있다.
 * ============================================================================
 */

/**
 * 역삼각 단추의 옷. 글자 크기를 `text-wr-meta` 로 둔 것은 이 화면의 크기가 전부
 * 주간보고 전용 변수에서 오기 때문이다(WeeklyReportScreen 파일 헤더) — 여기만
 * 고정값으로 두면 설정을 움직여도 이 단추만 안 따라온다.
 *
 * `align-middle` 이 있어야 날짜 글자와 눈높이가 맞는다(역삼각은 글자보다 작다).
 */
const TRIANGLE_BUTTON_CLASS =
  "ml-0.5 shrink-0 align-middle text-wr-meta leading-none text-zinc-500 hover:text-zinc-900 print:hidden dark:text-zinc-400 dark:hover:text-zinc-50";

export default function WeeklyReportQuoteNumbersCell({
  date,
  numbers,
}: {
  /** 지금까지와 **한 글자도 같은** 날짜 글자. 빈 값의 `-` 까지 부르는 쪽이 만든다. */
  date: string;
  /** 🔴 하나 이상일 때만 이 조각이 쓰인다(파일 헤더). */
  numbers: readonly string[];
}) {
  // 🔴 이 줄에서 **스스로 바꾼 값**. 함께 든 nonce 가 [견적서 번호 보기]를 누른
  //    횟수라, 단추를 누르면 이 값이 저절로 낡은 것이 되어 버려진다(그 파일 헤더).
  const [localState, setLocalState] = useState<{ nonce: number; isOpen: boolean } | null>(null);
  const { isOpen, nonce } = useWeeklyReportQuoteNumbersRow(localState);

  return (
    <>
      {date}
      <button
        type="button"
        onClick={() => setLocalState({ nonce, isOpen: !isOpen })}
        aria-expanded={isOpen}
        // 낭독기가 읽을 이름 — 250줄에 같은 단추가 서므로 **몇 개인지**까지 적는다.
        // 날짜를 넣지 않는 까닭: 날짜가 비어 `-` 인 줄이 있고, 그때 이름이 "- 의
        // 견적서 번호"가 된다.
        aria-label={`견적서 번호 ${numbers.length}개 ${isOpen ? "접기" : "펼치기"}`}
        className={TRIANGLE_BUTTON_CLASS}
      >
        {/* 글자 그대로의 역삼각·정삼각. 아이콘 꾸러미를 들이지 않는다 — 이 화면에
            아이콘이 하나도 없고, 한 글자면 열 폭이 거의 늘지 않는다. */}
        <span aria-hidden="true">{isOpen ? "▴" : "▾"}</span>
      </button>
      {isOpen && (
        // 🔴 `whitespace-normal` 이 아니다 — 번호 하나가 중간에서 꺾이면 안 된다.
        //    `<tr>` 의 whitespace-nowrap 을 그대로 물려받고, 번호마다 `block` 으로
        //    줄을 바꾼다(고객 안내 현황의 견적서 번호 칸과 같은 방식).
        <span className="mt-0.5 block pl-2 text-wr-meta">
          {numbers.map((number) => (
            <span key={number} className="block">
              {number}
            </span>
          ))}
        </span>
      )}
    </>
  );
}
