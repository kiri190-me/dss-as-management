"use client";

import { useState, type ReactNode } from "react";

/**
 * ============================================================================
 * 견적서 한 장의 탭 — [견적서 수정] · [견적서 결재]
 * ============================================================================
 * 저장된 견적서 화면(`/quotes/[id]`)의 껍데기다. 생김새는 이 저장소의 다른
 * 탭과 같다(repair-cases/report/ServiceReportTabs 의 TabButton) — 탭이 화면마다
 * 다르게 생기면 같은 것인지 알 수 없다.
 *
 * ── 왜 클라이언트 껍데기 하나에 두 화면을 children 으로 받는가 ────────────
 * 페이지(`quotes/[id]/page.tsx`)는 **서버 컴포넌트**이고 탭 전환은 브라우저
 * 상태다. 그래서 탭만 아는 얇은 클라이언트 조각을 하나 두고, 두 화면은 페이지가
 * 서버에서 그려 넘긴다. 이렇게 하면 이 조각이 편집 폼도 결재 화면도 import 하지
 * 않는다 — 둘 다 자기 사슬(서버 액션 · 부품 고르개 · 첨부)을 물고 있어서, 여기서
 * 가져오면 이 껍데기를 렌더해 보는 시험이 그 사슬에 걸려 죽는다.
 *
 * ── 🔴 탭을 바꿔도 적던 내용이 날아가지 않는다 ──────────────────────────
 * 🔴 **두 화면을 언제나 함께 그린다.** 보이지 않는 쪽은 CSS 로 감출 뿐
 * 떼어내지 않는다(언마운트하지 않는다).
 *
 * 까닭: [견적서 수정] 은 3000 줄짜리 폼이고 사람이 품목·금액을 한참 적어 넣는
 * 자리다. 그 값은 전부 그 컴포넌트의 useState 에 들어 있어서, 탭을 바꿀 때
 * `{tab === "edit" ? 편집폼 : 결재화면}` 처럼 **갈라 그리면 컴포넌트가 떼어지고
 * 그 순간 적던 것이 통째로 사라진다.** 결재 상태를 한 번 확인하고 돌아오면 빈
 * 폼이 기다리는 것이다.
 *
 * ⚠️ **「안 보이는 걸 왜 그려 두지?」 하고 고치지 말 것.** 그 한 줄이 이 사고를
 * 되살린다. 보이지 않는 동안 그 폼은 아무 일도 하지 않는다 — 브라우저가 그리지
 * 않고(`display:none`), 접근성 트리에서도 빠지며(`hidden`), 그 안의 입력칸은
 * 초점을 받지 못한다. 값이 남아 있는 것이 이 코드가 하는 일의 전부다.
 *
 * 감추는 장치를 **둘 다** 쓰는 것도 일부러다:
 *  · `hidden` 속성 — 접근성 트리에서 빼 준다. 다만 그 `display:none` 은 브라우저
 *    기본 스타일시트에서 오므로, 감출 칸에 배치용 class(`flex` 같은)가 하나라도
 *    붙으면 **작성자 스타일이 이겨서 그대로 보인다.**
 *  · `hidden` class(Tailwind 의 `display:none`) — 작성자 스타일이라 그 싸움에서
 *    진 적이 없다. 실제로 감추는 것은 이쪽이다.
 * ============================================================================
 */

export type QuoteEditTab = "edit" | "approval";

export default function QuoteEditTabs({
  editForm,
  approvalPanel,
}: {
  /** [견적서 수정] — 지금까지의 편집 폼 그대로다. 서버가 그려 넘긴다. */
  editForm: ReactNode;
  /**
   * [견적서 결재] — 결재를 올리고 처리하고 되짚는 자리.
   *
   * 🔴 저장된 견적서에만 있다. 새 견적서(`/quotes/new`)는 이 껍데기를 쓰지 않고
   * 편집 폼을 그대로 그린다 — 아직 저장되지 않아 결재를 걸 대상이 없다.
   */
  approvalPanel: ReactNode;
}) {
  const [tab, setTab] = useState<QuoteEditTab>("edit");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <TabButton
          isActive={tab === "edit"}
          controls="quote-tab-panel-edit"
          onClick={() => setTab("edit")}
        >
          견적서 수정
        </TabButton>
        <TabButton
          isActive={tab === "approval"}
          controls="quote-tab-panel-approval"
          onClick={() => setTab("approval")}
        >
          견적서 결재
        </TabButton>
      </div>

      {/* 🔴 두 칸 다 언제나 그린다 — 위 머리말의 '탭을 바꿔도 적던 내용이 날아가지 않는다'. */}
      <div
        id="quote-tab-panel-edit"
        hidden={tab !== "edit"}
        className={tab === "edit" ? undefined : "hidden"}
      >
        {editForm}
      </div>
      <div
        id="quote-tab-panel-approval"
        hidden={tab !== "approval"}
        className={tab === "approval" ? undefined : "hidden"}
      >
        {approvalPanel}
      </div>
    </div>
  );
}

function TabButton({
  isActive,
  controls,
  onClick,
  children,
}: {
  isActive: boolean;
  controls: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "true" : undefined}
      aria-controls={controls}
      className={
        isActive
          ? "-mb-px border-b-2 border-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
          : "-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      }
    >
      {children}
    </button>
  );
}
