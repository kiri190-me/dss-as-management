"use client";

import { useRef, useSyncExternalStore, type ReactNode } from "react";
import { useTableFitsWithoutOverflow } from "@/lib/hooks/useTableFitsWithoutOverflow";

/**
 * ============================================================================
 * 목록의 단 하나의 기준
 * ============================================================================
 * 이 서비스의 목록은 전부 같은 규칙을 따른다:
 *
 *     표가 안 들어가면 → **카드**
 *     들어가면        → **토글로 고른 대로** (기본 표)
 *
 * ── 왜 이 파일이 생겼나 ─────────────────────────────────────────────────
 * 규칙 자체는 전부터 있었지만 화면마다 기준이 달랐다 — 접수 건·고객사·제품
 * 모델은 lg, 첨부파일은 md, 진단 Flowchart는 실제 넘침 측정. 같은 창 크기에서
 * 어떤 목록은 표이고 어떤 목록은 카드인 상태가 되고, 그러면 "이 화면은 왜
 * 카드지?"를 화면마다 따로 기억해야 한다.
 *
 * ── "안 들어간다"를 어떻게 아는가 ───────────────────────────────────────
 * 고정 브레이크포인트로 정하지 않는다. 표마다 필요한 폭이 다르고, 같은 표라도
 * 열이 늘거나(권한에 따라 '관리' 열이 붙는다) 줄면 달라진다. 진단 Flowchart
 * 화면이 이미 그 이유로 useTableFitsWithoutOverflow를 쓰고 있었고, 거기 적힌
 * 근거가 옳다 — **표를 실제로 그려 놓고 넘치는지 재는 것**만이 정확하다.
 * 그래서 이미 있던 그 방식을 서비스 전체의 기준으로 삼았다.
 *
 * 창 크기가 아니라 이 목록이 실제로 차지한 폭을 재므로, 사이드바를 접었다
 * 폈다 해도 알아서 맞는다.
 *
 * ── 표는 안 보일 때도 DOM에 남는다 ──────────────────────────────────────
 * 재려면 진짜 레이아웃이 있어야 한다. 그래서 카드를 보여 주는 동안에도 표는
 * 화면 밖에 둔 채 계속 잰다. 그 덕에 자리가 다시 넓어지면 표로 돌아온다 —
 * 지워 버리면 잴 것이 없어져 영영 카드로 남는다.
 *
 * ── 표 껍데기는 여기가 소유한다 ─────────────────────────────────────────
 * 부르는 쪽은 <table>만 넘긴다. 스크롤 래퍼를 각자 들고 있으면 넘침이 그
 * 안쪽에서 흡수되어 바깥은 영원히 "들어간다"고 답한다. 테두리·모서리도 여기서
 * 주므로 목록마다 테두리 모양이 달라지지도 않는다.
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
 * TABLE은 "항상 표"가 아니라 "들어가면 표"다 — 안 들어가는 폭에서는 어차피
 * 카드로 내려간다. 그래서 토글은 표가 안 들어갈 때 감춘다: 눌러도 아무 일이
 * 없는 버튼을 보여 주면 고장으로 읽힌다.
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
  return useSyncExternalStore(subscribe, () => read(listId), readServer);
}

function setViewMode(listId: string, next: ViewMode): void {
  window.localStorage.setItem(storageKeyOf(listId), next);
  for (const listener of listeners) listener();
}

export function ResponsiveList({
  listId,
  table,
  cards,
  meta,
  measureKey,
}: {
  /** 선택을 기억할 이름. 목록마다 따로 기억한다. */
  listId: string;
  /** <table> 자체. 스크롤 래퍼로 감싸지 않는다 — 위 주석 참조. */
  table: ReactNode;
  cards: ReactNode;
  /** 토글 왼쪽에 놓을 것(건수 등). */
  meta?: ReactNode;
  /**
   * 내용이 바뀌어 표의 필요 폭이 달라지는 조건(행 수, 열을 늘리는 권한 플래그
   * 등). ResizeObserver는 래퍼의 **자기 폭** 변화만 잡으므로, 내용이 바뀌어
   * 생기는 변화는 이것으로 다시 재게 한다.
   */
  measureKey?: readonly unknown[];
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fits = useTableFitsWithoutOverflow(wrapperRef, measureKey ?? []);
  const mode = useViewMode(listId);
  const showTable = fits && mode === "TABLE";

  return (
    <div className="@container relative flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        {meta}
        {/* 표가 안 들어가면 고를 것이 없다. */}
        {fits && <ViewModeToggle value={mode} onChange={(next) => setViewMode(listId, next)} />}
      </div>

      <div
        ref={wrapperRef}
        aria-hidden={!showTable}
        className={
          showTable
            ? "overflow-x-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
            : "invisible pointer-events-none absolute inset-x-0 bottom-0 overflow-x-hidden"
        }
      >
        {table}
      </div>

      {!showTable && cards}
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
