"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/**
 * ============================================================================
 * 목록의 단 하나의 기준
 * ============================================================================
 * 이 서비스의 목록은 전부 같은 규칙을 따른다:
 *
 *     좁으면 **카드**(표가 들어가지 않는다).
 *     넓으면 **토글로 고른 대로** — 기본은 표.
 *
 * 폭이 정하는 것과 사람이 정하는 것을 나눈 이유는, 좁은 자리에서는 고를 것이
 * 없기 때문이다. 열 여덟 개짜리 표를 폭 30rem에 밀어 넣으면 가로 스크롤만
 * 남는다. 반대로 넓은 자리에서는 둘 다 쓸 만하고, 그날 무엇을 찾느냐에 따라
 * 답이 다르다 — 그래서 그때만 고르게 한다.
 *
 * ── 왜 이 파일이 생겼나 ─────────────────────────────────────────────────
 * 규칙 자체는 전부터 있었지만 화면마다 기준이 달랐다 — 접수 건·고객사·제품
 * 모델은 lg에서, 첨부파일은 md에서 바뀌었다. 같은 창 크기에서 어떤 목록은
 * 표이고 어떤 목록은 카드인 상태가 되고, 그러면 "이 화면은 왜 카드지?"를
 * 화면마다 따로 기억해야 한다. 기준을 한 곳에 적어 두면 그 질문이 사라진다.
 *
 * ── 화면 폭이 아니라 목록 폭이다 ────────────────────────────────────────
 * 컨테이너 쿼리(@container)를 쓴다. 이 앱은 사이드바를 접었다 폈다 하므로
 * **같은 창 크기에서도 목록에 주어지는 폭이 다르다.** 화면 폭으로 판단하면
 * 사이드바를 펼친 좁은 자리에 표를 밀어 넣게 되고, 접었을 때 남는 폭을 쓰지
 * 못한다. 목록 자신의 폭을 보면 둘 다 맞는다.
 *
 * ── 기준값 ──────────────────────────────────────────────────────────────
 * @4xl = 56rem(896px). 이 서비스의 목록은 대개 6~8열이라 그보다 좁아지면
 * 열이 짓눌리거나 가로 스크롤이 생긴다. 한 값으로 정한 이상 어떤 표에는 조금
 * 이르고 어떤 표에는 조금 늦지만, 목록마다 다른 값을 쓰는 쪽이 더 나쁘다.
 * ============================================================================
 */

/**
 * 카드 격자 — 한 행에 최대 3장.
 *
 * 좁을 때 1장, 중간에 2장, 넓을 때 3장. 세 장을 기준으로 잡은 이유는 그보다
 * 많으면 카드 하나가 표의 한 줄만큼 좁아져 카드로 만든 뜻이 없어지고, 적으면
 * 넓은 화면에서 오른쪽이 비기 때문이다.
 *
 * 이 값도 목록마다 다르게 두지 않는다 — 화면을 옮길 때마다 격자가 달라지면
 * 같은 서비스로 읽히지 않는다.
 */
export const LIST_CARD_GRID = "grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3";

/**
 * 고른 보기 방식.
 *
 * TABLE은 "항상 표"가 아니라 "넓으면 표"다 — 좁은 자리에서는 어차피 카드로
 * 내려간다. 그래서 토글은 좁을 때 감춘다: 눌러도 아무 일이 없는 버튼을 보여
 * 주면 고장으로 읽힌다.
 */
type ViewMode = "TABLE" | "CARD";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function storageKeyOf(listId: string): string {
  return `list-view-mode:${listId}`;
}

function read(listId: string): ViewMode {
  return window.localStorage.getItem(storageKeyOf(listId)) === "CARD" ? "CARD" : "TABLE";
}

/**
 * 서버에는 localStorage가 없다. 저장해 둔 값이 없는 사람과 같은 화면을 준다.
 *
 * 첫 렌더에서 그냥 읽으면 서버가 그린 것과 달라져 hydration이 어긋나고,
 * effect에서 읽어 setState하면 한 프레임 동안 잘못된 화면이 스쳐 지나간다.
 * useSyncExternalStore가 정확히 이 상황을 위한 것이다.
 */
function readServer(): ViewMode {
  return "TABLE";
}

function useViewMode(listId: string): ViewMode {
  return useSyncExternalStore(
    subscribe,
    () => read(listId),
    readServer
  );
}

function setViewMode(listId: string, next: ViewMode): void {
  window.localStorage.setItem(storageKeyOf(listId), next);
  for (const listener of listeners) listener();
}

/**
 * 같은 목록의 표와 카드를 함께 받아 폭과 선택에 따라 하나만 보인다.
 *
 * 둘 다 DOM에는 남는다(CSS로 감춘다). 이 서비스의 목록은 한 화면에 담기는
 * 규모라 그 비용이 문제가 되지 않고, 대신 창을 줄이는 즉시 바뀌며 서버 렌더와
 * 어긋날 일이 없다.
 *
 * @param listId 선택을 기억할 이름. 목록마다 따로 기억한다 — 재고는 카드로,
 *               요청 관리는 표로 보고 싶을 수 있는데 하나로 묶으면 한쪽을 바꿀
 *               때 다른 쪽이 따라 바뀐다.
 * @param meta   토글 왼쪽에 놓을 것(건수 등). 없으면 토글만 오른쪽에 붙는다.
 */
export function ResponsiveList({
  listId,
  table,
  cards,
  meta,
}: {
  listId: string;
  table: ReactNode;
  cards: ReactNode;
  meta?: ReactNode;
}) {
  const mode = useViewMode(listId);

  // 카드를 고르면 폭과 무관하게 카드다. 표를 고르면 넓을 때만 표이고 좁아지면
  // 카드로 내려간다 — 이 두 줄이 위에 적은 규칙의 전부다.
  const tableClass = mode === "CARD" ? "hidden" : "hidden @4xl:block";
  const cardsClass = mode === "CARD" ? "block" : "@4xl:hidden";

  return (
    <div className="@container flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        {meta}
        {/* 좁은 자리에서는 고를 것이 없으므로 토글 자체를 감춘다. */}
        <div className="hidden @4xl:block">
          <ViewModeToggle value={mode} onChange={(next) => setViewMode(listId, next)} />
        </div>
      </div>
      <div className={tableClass}>{table}</div>
      <div className={cardsClass}>{cards}</div>
    </div>
  );
}

function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
}) {
  const options: { mode: ViewMode; label: string }[] = [
    { mode: "TABLE", label: "표" },
    { mode: "CARD", label: "카드" },
  ];
  return (
    <div
      role="group"
      aria-label="보기 방식"
      className="flex overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700"
    >
      {options.map((option) => (
        <button
          key={option.mode}
          type="button"
          aria-pressed={value === option.mode}
          onClick={() => onChange(option.mode)}
          className={`px-2.5 py-1 text-xs ${
            value === option.mode
              ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
