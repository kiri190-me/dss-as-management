"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * ============================================================================
 * 좁은 화면에서만 접히는 상세 조건 (2026-08-19 요구)
 * ============================================================================
 * 목록 화면의 필터 카드에서 검색칸만 늘 보이고, 나머지 선택 항목은 "더보기"를
 * 눌러야 나오게 한다. 모바일에서 필터 카드가 화면 한 판을 다 차지해 목록이
 * 아래로 밀려나 있었다.
 *
 * ── 왜 <details>가 아닌가 ───────────────────────────────────────────────
 * 이 앱의 다른 접기(ManualStepSetPanel, 워크플로 변경 이력)는 네이티브
 * <details>를 쓴다. 여기서는 못 쓴다 — 접히는 것이 **좁은 화면에서만**이고,
 * 넓은 화면에서는 늘 펼쳐져 있어야 하기 때문이다. <details>가 닫혔을 때
 * 브라우저가 내용을 숨기는 방식은 CSS로 되돌리기 어렵고(엔진마다 다르다),
 * 결국 화면 폭을 자바스크립트로 재서 open을 켜고 꺼야 한다. 그러면 첫 렌더와
 * 실제 폭이 어긋나는 순간이 생긴다.
 *
 * 대신 상태 하나(펼침 여부)와 `hidden lg:flex`로 푼다. 넓은 화면은 상태와
 * 무관하게 늘 펼쳐지고(토글 버튼도 lg:hidden으로 사라진다), 좁은 화면에서만
 * 상태가 의미를 갖는다. 폭을 재지 않으므로 서버 렌더 결과와 어긋나지 않는다.
 *
 * ── 접힌 채로 필터가 걸려 있는 경우 ────────────────────────────────────
 * 이게 이 컴포넌트의 진짜 이유다. 조건이 걸린 채 접히면 사용자는 목록이 왜
 * 짧은지 알 방법이 없다. 그래서 접혀 있어도 **몇 개가 걸려 있는지**를 늘
 * 보여 주고, 걸린 것이 있으면 펼치지 않고도 바로 지울 수 있게 한다.
 * ============================================================================
 */
export default function FilterDisclosure({
  activeCount,
  onReset,
  children,
}: {
  /** 접혔을 때 감춰지는 조건 중 지금 걸려 있는 개수. 0이면 안내를 띄우지 않는다. */
  activeCount: number;
  onReset: () => void;
  children: ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const panelId = useId();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 lg:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-expanded={isExpanded}
            aria-controls={panelId}
            className="flex items-center gap-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            상세 조건
            <span aria-hidden="true" className={`text-zinc-400 transition-transform dark:text-zinc-500 ${isExpanded ? "rotate-90" : ""}`}>
              ▸
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{isExpanded ? "접기" : "더보기"}</span>
          </button>
          {activeCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {activeCount}개 적용됨
            </span>
          )}
        </div>

        {/* 접힌 상태에서도 지울 수 있어야 한다 — 걸린 조건을 보려면 펼쳐야 하는데,
            지우기만 하려는 사람에게 펼치라고 시킬 이유가 없다. */}
        {!isExpanded && activeCount > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            필터 초기화
          </button>
        )}
      </div>

      <div id={panelId} className={`flex-col gap-3 ${isExpanded ? "flex" : "hidden lg:flex"}`}>
        {children}
      </div>
    </>
  );
}
