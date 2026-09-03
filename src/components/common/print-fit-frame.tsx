"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * ============================================================================
 * 미리보기 종이를 «화면 폭에 맞춰» 줄여 주는 상자
 * ============================================================================
 * 견적서·보고서 미리보기는 문서를 **실물 크기**로 그린다(견적서 약 713px, 보고서
 * A4 210mm ≈ 794px). 종이와 같은 크기여야 「인쇄하면 이렇게 나온다」가 참말이
 * 되기 때문이고, 그 크기는 인쇄 배율 계산의 바탕이기도 하다.
 *
 * 그런데 휴대폰 화면은 그보다 좁다. 그러면 문서가 화면 밖으로 나가는 데서 끝나지
 * 않는다 — `AppShell` 의 `<main>` 은 `flex-1` 인데 `min-w-0` 이 없어서, **넓은
 * 자식 하나가 앱 껍데기 전체를 옆으로 밀어낸다.** 상단바까지 딸려 나가고, 문서는
 * 오른쪽 절반이 잘린 채로 남는다.
 *
 * 이 상자가 하는 일은 둘이다.
 *   1. **스스로 스크롤 상자가 된다**(`overflow-x: auto`). 스크롤 상자의 최소
 *      너비는 0 이라, 안에 무엇이 들어 있든 바깥 배치를 밀지 않는다 — 껍데기가
 *      끌려 나가는 일이 이것만으로 사라진다. 아래 배율이 어떤 까닭으로든 1 로
 *      남더라도 문서는 «자기 상자 안에서» 옆으로 밀릴 뿐이다.
 *   2. 남은 폭을 재어 **배율을 CSS 변수로 내려 준다.** 문서 전체가 한눈에 들어와야
 *      미리보기가 제 일을 한다 — 옆으로 밀어 봐야 하는 미리보기는 「이대로 나가도
 *      되나」를 답해 주지 못한다.
 *
 * ── 🔴 인쇄에는 닿지 않는다 ────────────────────────────────────────────
 * 이 상자는 배율을 **변수로만** 싣는다. `zoom` 을 실제로 거는 규칙은 쓰는 쪽이
 * 자기 `@media screen` 블록 안에 둔다. 그래서 인쇄할 때는 규칙 자체가 적용되지
 * 않고, 남는 것은 아무 규칙도 없는 맨 `<div>` 하나다.
 *
 * ⚠️ `transform: scale()` 이 아니라 `zoom` 인 까닭이 둘이다. 하나는 두 미리보기가
 * 이미 적어 둔 판단 — `transform` 은 인쇄에서 브라우저마다 다르게 처리된다. 다른
 * 하나는 배치다: `zoom` 은 상자 크기까지 다시 잡아 주므로 줄어든 만큼 아래에 빈
 * 자리가 남지 않는다(`transform` 은 원래 크기의 자리를 그대로 차지한다).
 *
 * ── 🔴 훅이 여기 있는 까닭 ─────────────────────────────────────────────
 * `QuotePrintView` 본체에 두면 안 된다. 그 시험(`QuotePrintView.test.tsx`)이
 * 「상태가 없는 순수 함수」라는 이유로 컴포넌트를 **함수로 직접 부르기** 때문이다
 * — 훅이 하나라도 들어가면 그 자리에서 던진다. 자식 조각에 두면 그 시험이 걷는
 * 요소 나무에는 «원소»로만 나타나므로 아무것도 깨지지 않는다.
 * ============================================================================
 */

/**
 * 클라이언트에서는 `useLayoutEffect`(그려지기 전에 재므로 큰 문서가 한 번
 * 번쩍이지 않는다), 서버 렌더에서는 `useEffect`. 형제 훅
 * (`lib/hooks/useTableFitsWithoutOverflow.ts`)이 같은 자리에서 같은 판단을 했다.
 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export default function PrintFitFrame({
  naturalWidthPx,
  cssVariable,
  className,
  children,
}: {
  /**
   * 문서의 **실물 폭**(px). 쓰는 쪽이 자기 상수에서 계산해 넘긴다 — 이 조각이
   * 재어 볼 수는 없다(재려면 한 번 실물 크기로 그려야 하고, 그 한 프레임이 바로
   * 위에서 없애려는 그 번쩍임이다).
   */
  naturalWidthPx: number;
  /** 배율을 실어 보낼 변수 이름(`--qp-fit` 처럼). 쓰는 쪽의 CSS 가 이 이름을 읽는다. */
  cssVariable: string;
  className: string;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(1);

  useIsomorphicLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || naturalWidthPx <= 0) return;

    function measure() {
      if (!frame) return;
      // 스크롤 상자의 `clientWidth` 는 «안에 무엇이 있든» 남은 자리다. 아직 배치가
      // 안 잡혀 0 으로 나오는 순간이 있는데, 그때 0 으로 줄이면 문서가 사라진다.
      const available = frame.clientWidth;
      if (available <= 0) return;
      // 🔴 내림이다. 반올림하면 마지막 한 픽셀이 넘쳐 가로 스크롤 막대가 남는데,
      //    「폭에 맞췄다」면서 옆으로 밀리는 것이 가장 나쁜 결과다.
      const next = Math.min(1, Math.floor((available / naturalWidthPx) * 1000) / 1000);
      setFit((prev) => (prev === next ? prev : next));
    }

    measure();
    // 창 크기·기기 회전·사이드바 접힘까지 전부 이 상자의 폭 변화로 나타난다.
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [naturalWidthPx]);

  return (
    <div
      ref={frameRef}
      className={className}
      // 변수 하나만 싣는다 — `zoom` 을 여기서 걸면 인쇄용 규칙이 인라인 스타일을
      // 이기지 못한다(위 '인쇄에는 닿지 않는다').
      style={{ [cssVariable]: fit } as CSSProperties}
    >
      {children}
    </div>
  );
}
