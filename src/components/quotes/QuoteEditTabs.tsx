"use client";

import { Fragment, useState, type ReactNode } from "react";

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
 *
 * ── 🔴 [견적서 결재] 칸에는 **두 구역**이 선다 (2026-10-08) ───────────────
 * 결재하는 사람이 **승인을 누르기 전에 그 견적서 폴더를 열어 확인**할 수 있어야
 * 한다(사용자 요구). 그래서 이 칸은 위에서부터 **공유폴더 구역 → 「견적서 승인」**
 * 두 덩이다.
 *
 * 🔴 **승인 패널 안에 끼워 넣지 않는다.** 뜻이 다른 둘이다 — 하나는 폴더를 보는
 * 곳, 하나는 결재하는 곳이다. 한 상자로 보이면 안 되므로 **슬롯을 하나 더 두고**
 * (`archiveFolderSection`) 사이를 띄우는 상자에 나란히 담는다. 둘 다 서버가 그려
 * 넘긴다 — 이 껍데기는 여전히 어느 쪽도 import 하지 않는다(위 머리말).
 *
 * 🔴 감추는 class 를 **바깥 칸에 그대로 둔다** — 띄우는 상자(`flex`)를 안쪽에
 * 하나 더 두는 까닭이 이것이다. 배치용 class 를 감출 칸에 직접 붙이면 작성자
 * 스타일이 `hidden` 속성을 이겨 **안 보여야 할 칸이 그대로 보인다**(바로 위 규율).
 *
 * ── 🔴 한 칸에 서버 슬롯이 둘이면 **key 를 얹는다** (2026-10-08) ──────────
 * 공유폴더 구역과 승인 패널은 둘 다 **서버 컴포넌트가 만들어 넘긴 요소**다. 그
 * 둘을 한 상자에 나란히 놓으면 React 는 그 자리를 「목록」으로 보고 자식마다
 * key 를 요구한다. 서버에서 건너온 요소에는 jsx 가 「확인했다」 표시를 남기지
 * 못한다 — 전달 과정에서 한 겹 감싸여 오고, 표시는 그 겉껍질에만 찍히기
 * 때문이다. 그래서 브라우저가 그릴 때
 * 「Each child in a list should have a unique "key" prop」 경고가 뜬다.
 *
 * 동작은 멀쩡하다. 다만 콘솔이 더러워지면 진짜 오류가 묻히므로 두 덩이를
 * `Fragment` 로 감싸고 거기에 key 를 얹었다. `Fragment` 는 **아무것도 그리지
 * 않아서** DOM 도 간격(`gap-4`)도 그대로다.
 *
 * ⚠️ 슬롯을 하나 더 더하는 사람에게 — [견적서 수정] 칸이 지금 멀쩡한 것은 자식이
 * `editForm` **하나뿐**이라 목록이 아니기 때문이다. 어느 칸이든 서버가 넘긴 것을
 * 둘 이상 나란히 놓는 순간 같은 경고가 난다. 그때는 여기처럼 key 를 얹는다.
 * ============================================================================
 */

export type QuoteEditTab = "edit" | "approval";

export default function QuoteEditTabs({
  editForm,
  archiveFolderSection = null,
  approvalPanel,
}: {
  /** [견적서 수정] — 지금까지의 편집 폼 그대로다. 서버가 그려 넘긴다. */
  editForm: ReactNode;
  /**
   * [견적서 결재] 칸의 **첫 덩이** — 그 견적서의 공유폴더를 보는 구역(2026-10-08).
   * 「견적서 승인」 **바로 위**에 선다. 결재하기 전에 폴더를 열어 보라고 둔 자리다.
   *
   * 🔴 비워 둘 수 있다 — 주지 않으면 이 칸은 예전처럼 승인 구역 하나다. 설정이
   * 꺼져 있거나 폴더가 없을 때 아무것도 그리지 않는 일은 **그 구역이 스스로** 한다.
   * 이 껍데기는 그 판단을 다시 쓰지 않는다.
   */
  archiveFolderSection?: ReactNode;
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
        {/*
          🔴 공유폴더 구역이 **위**, 「견적서 승인」이 아래다(2026-10-08 사용자 요구 —
          승인하기 전에 그 폴더를 열어 확인한다). 사이를 띄우는 상자는 **안쪽**에 둔다 —
          배치용 class 를 바깥 칸에 붙이면 감추는 장치가 진다(위 머리말).
        */}
        {/*
          🔴 두 덩이에 key 를 얹는다 — 둘 다 서버가 그려 넘긴 요소라 여기서 나란히
          놓이는 순간 React 가 목록으로 보고 key 를 요구한다(머리말의 마지막 절).
          감싸개는 아무것도 그리지 않으므로 보이는 모양은 그대로다.
        */}
        <div className="flex flex-col gap-4">
          <Fragment key="archive-folder-section">
            {archiveFolderSection}
          </Fragment>
          <Fragment key="approval-panel">
            {approvalPanel}
          </Fragment>
        </div>
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
