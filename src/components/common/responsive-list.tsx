"use client";

import { Fragment, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useTableFitsWithoutOverflow } from "@/lib/hooks/useTableFitsWithoutOverflow";

/**
 * ============================================================================
 * 목록의 단 하나의 기준
 * ============================================================================
 * 이 서비스의 목록은 전부 같은 규칙을 따른다:
 *
 *     아직 고른 적 없으면 → 표가 들어가면 **표**, 안 들어가면 **카드**
 *     한 번이라도 골랐으면 → **고른 대로**
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
 * ── 토글은 언제나 보인다 ────────────────────────────────────────────────
 * 예전에는 "표가 안 들어가면 눌러도 소용없으니 감춘다"였다. 그런데 이 서비스에서
 * 제일 넓은 표(전체 A/S 현황, 7열에 머리글이 두 줄)는 웬만한 창에서 늘 넘쳤고,
 * 그래서 정작 그 화면에서만 토글이 한 번도 보이지 않았다. 좁은 표를 쓰는 옆
 * 화면에는 있고 여기에는 없으니, 규칙이 아니라 누락으로 읽혔다.
 *
 * 그래서 반대로 뒤집었다 — 토글은 항상 보이고, 안 들어가는 폭에서 "표"를 고르면
 * **가로 스크롤로** 표를 준다. 열을 다 놓고 봐야 하는 순간이 실제로 있고, 그때
 * 옆으로 미는 것은 정상적인 표 읽기 방식이지 고장이 아니다.
 *
 * 대신 **고른 적이 없으면 예전 그대로**다. 저장된 값이 없을 때만 자동으로 정하고
 * (들어가면 표, 안 들어가면 카드), 한 번 고른 뒤에는 그 선택이 이긴다. 처음 오는
 * 사람이 보는 화면은 이 변경 전후가 같다.
 *
 * ── 표 껍데기는 여기가 소유한다 ─────────────────────────────────────────
 * 부르는 쪽은 <table>만 넘긴다. 스크롤 래퍼를 각자 들고 있으면 넘침이 그
 * 안쪽에서 흡수되어 바깥은 영원히 "들어간다"고 답한다. 테두리·모서리도 여기서
 * 주므로 목록마다 테두리 모양이 달라지지도 않는다.
 *
 * ── 열 제목을 붙여 두는 목록만 켠다 — stickyHeader ──────────────────────
 * **기본은 꺼짐이다.** 켜면 표 껍데기에 높이 상한(max-height)이 붙고, 그 상자가
 * 비로소 **스스로 굴러가는** 세로 스크롤 상자가 된다.
 *
 * 왜 그것이 필요한가 — 표 껍데기에는 이미 overflow-x-auto 가 있고, 한 축이
 * visible 이 아니면 나머지 축의 visible 도 auto 로 계산된다(CSS 규칙). 즉 이
 * 래퍼는 진작부터 세로로도 스크롤 상자였다. 다만 높이가 자유라 표 높이만큼
 * 자라고 자기 안에서는 한 번도 굴러가지 않았다. position: sticky 는 **가장
 * 가까운 스크롤 상자**를 기준으로 붙으므로, 표 안의 <thead className="sticky
 * top-0"> 은 굴러가지 않는 그 상자에 붙어 아무 일도 하지 않는다 — 저장소의
 * sticky top-0 <thead> 셋이 지금 전부 그 상태다(`전체 A/S 현황`에서 확인했다).
 * 높이 상한을 주는 순간 그 상자가 진짜로 굴러가고, 그제서야 top-0 이 붙을
 * 자리가 생긴다.
 *
 * ⚠️ **세로 스크롤바가 둘이 되는 것은 이번만은 고장이 아니다.** 이 앱의 세로
 * 스크롤 자리는 AppShell 의 <main> 하나뿐이고, 주간보고 화면 헤더에 그 하나를
 * 어긴 고장 둘이 길게 적혀 있다. 거기서는 스크롤 상자가 **의도치 않게** 생겼다
 * — overflow-x 가 세로 축까지 바꿔 놓은 래퍼에 flex-1 이 확정 높이를 얹었고,
 * 아무도 그걸 바라지 않았다. 여기서는 반대로 **높이를 명시해 일부러 만든다.**
 * 22칼럼짜리 장부는 열 제목이 안 보이면 지금 보는 칸이 무엇인지 알 길이 없어서,
 * 스크롤바 하나를 더 보는 대가를 치르고 제목을 붙여 두기로 한 것이다(사용자
 * 결정). **이 상한을 걷어내면 머리글 고정이 다시 헛돈다** — 걷어내기 전에 이
 * 문단을 읽을 것.
 *
 * 값이 70dvh 인 까닭 셋.
 *   1. **max-height 라서** 줄이 몇 개뿐인 표는 그 높이만 차지한다. height 로
 *      주면 짧은 목록이 빈 상자를 끌고 다닌다.
 *   2. 뷰포트 기준이라 노트북과 큰 모니터가 각자 알아서 맞는다. 고정 픽셀은
 *      한쪽에서 반드시 답답하거나 헐렁하다.
 *   3. 남는 30% 가 표 위의 제목·검색칸·합계 몫이라 **페이지 자체는 거의
 *      굴러가지 않는다.** 이게 중요한 이유는, 페이지가 크게 굴러가면 상자의
 *      윗변이 화면 위로 빠져나가고 거기 붙어 있는 머리글도 함께 화면 밖이 되기
 *      때문이다. 상한이 (main 높이 − 표 아래 여백)보다 작으면 그런 일이 생길 수
 *      없는데, 70dvh 는 그 조건을 어느 화면 높이에서도 만족한다.
 * vh 가 아니라 dvh 인 것은 이 앱의 높이 기준이 dvh 라서다(globals.css 의 body
 * 100dvh) — 모바일에서 툴바가 펼쳐져 실제 높이가 줄면 상한도 같이 줄어야 3번
 * 계산이 유지된다.
 *
 * ⚠️ 상한은 **화면 밖에서 재는 쪽에도 똑같이 붙인다.** 세로 스크롤바가 생기면
 * 그만큼 clientWidth 가 줄고, 표가 들어가는지는 바로 그 값으로 판정한다
 * (useTableFitsWithoutOverflow 의 scrollWidth <= clientWidth). 보이는 쪽에만
 * 붙이면 카드일 때와 표일 때의 잣대가 스크롤바 폭만큼 어긋나서, 딱 그 폭에서
 * 카드↔표가 서로를 되부르며 끝없이 뒤집힌다. 재는 상자는 실제로 그려질 때와
 * 같은 모양이어야 한다.
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
 * 사람이 고른 보기 방식. 아직 고른 적이 없으면 null이고, 그때만 폭을 보고
 * 자동으로 정한다(resolveShowTable 참조).
 */
export type ViewMode = "TABLE" | "CARD";

/**
 * 표를 보여 줄지 카드를 보여 줄지 — 목록의 유일한 판단.
 *
 * 고른 적이 없으면(stored === null) 폭이 정한다. 한 번이라도 골랐으면 그 선택이
 * 이긴다 — TABLE을 골라 둔 사람은 안 들어가는 폭에서도 표를 본다(가로 스크롤).
 * 화면 밖에서 계속 재는 fits는 그래도 계속 유효하다: 자동으로 두는 사람에게는
 * 이것이 곧 답이고, 골라 둔 사람에게도 폭이 다시 넓어졌을 때 스크롤이 저절로
 * 사라지게 하는 것은 CSS(overflow-x-auto) 쪽이라 따로 되돌릴 것이 없다.
 */
export function resolveShowTable(stored: ViewMode | null, fits: boolean): boolean {
  if (stored === null) return fits;
  return stored === "TABLE";
}

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

function read(listId: string): ViewMode | null {
  const stored = window.localStorage.getItem(storageKeyOf(listId));
  return stored === "CARD" || stored === "TABLE" ? stored : null;
}

/**
 * 서버에는 localStorage가 없다. 저장해 둔 값이 없는 사람과 같은 화면을 준다.
 *
 * 첫 렌더에서 그냥 읽으면 서버가 그린 것과 달라져 hydration이 어긋나고,
 * effect에서 읽어 setState하면 한 프레임 동안 잘못된 화면이 스쳐 지나간다.
 * useSyncExternalStore가 정확히 이 상황을 위한 것이다.
 */
function readServer(): ViewMode | null {
  return null;
}

function useViewMode(listId: string): ViewMode | null {
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
  stickyHeader = false,
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
  /**
   * 표 껍데기에 높이 상한을 주어 그 상자를 진짜 세로 스크롤 상자로 만든다.
   * <table> 안에 `<thead className="sticky top-0">` 을 둔 목록만 켠다 — 위
   * '열 제목을 붙여 두는 목록만 켠다' 항목에 까닭과 대가가 전부 적혀 있다.
   *
   * **기본은 꺼짐이고, 넘기지 않은 목록은 이 인자가 생기기 전과 한 픽셀도
   * 다르지 않다**(아래 heightCapClass 가 빈 문자열이라 클래스 문자열 자체가
   * 글자 하나까지 같다).
   */
  stickyHeader?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fits = useTableFitsWithoutOverflow(wrapperRef, measureKey ?? []);
  const mode = useViewMode(listId);
  const showTable = resolveShowTable(mode, fits);

  // 켠 목록에만 붙는다. 보이는 래퍼와 화면 밖에서 재는 래퍼에 **똑같이** 붙어야
  // 하는 이유는 파일 헤더의 마지막 ⚠️ 에 있다(잣대가 어긋나면 카드↔표가 무한히
  // 뒤집힌다). 끈 목록에서는 빈 문자열이라 아래 두 문자열이 예전 그대로다.
  const heightCapClass = stickyHeader ? " max-h-[70dvh]" : "";

  return (
    <div className="@container relative flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        {meta}
        {/* 지금 눌린 쪽은 "저장해 둔 값"이 아니라 "지금 화면에 있는 것"이다 —
            아직 고른 적이 없는 사람에게도 어느 쪽을 보고 있는지 맞게 보인다. */}
        <ViewModeToggle
          value={showTable ? "TABLE" : "CARD"}
          fits={fits}
          onChange={(next) => setViewMode(listId, next)}
        />
      </div>

      <div
        ref={wrapperRef}
        aria-hidden={!showTable}
        className={
          showTable
            ? // 안 들어가는 폭에서 표를 고른 경우에만 실제로 스크롤이 생긴다.
              // 들어갈 때는 넘칠 것이 없으므로 hidden이던 때와 화면이 같다.
              "overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800" +
              heightCapClass
            : "invisible pointer-events-none absolute inset-x-0 bottom-0 overflow-x-hidden" +
              heightCapClass
        }
      >
        {table}
      </div>

      {/* 카드만 Fragment로 감싸는 이유 — cards를 **서버 컴포넌트**에서 만들어 넘기면
          (워크플로 관리가 그렇다) RSC 경계를 건너오며 lazy로 감싸이고, 그러면 React가
          "이 자식은 key 검사 끝났다"는 표시를 붙이지 못한다. 이 자리는 형제가 여럿이라
          배열로 재조정되므로, 표시 없는 자식을 보고 없는 key를 찾는 경고가 뜬다.
          실제로는 위치가 고정된 한 자리라 key가 필요 없다 — 그래서 키를 가진
          Fragment로 그 자리를 대신 채운다. Fragment는 DOM을 만들지 않으므로 화면은
          그대로다. */}
      {!showTable && <Fragment key="cards">{cards}</Fragment>}
    </div>
  );
}

function ViewModeToggle({
  value,
  fits,
  onChange,
}: {
  /** 지금 화면에 실제로 있는 것. */
  value: ViewMode;
  /** 표가 지금 폭에 들어가는지. 안 들어가면 "표"는 가로 스크롤이 된다고 미리 알린다. */
  fits: boolean;
  onChange: (next: ViewMode) => void;
}) {
  const options: { mode: ViewMode; label: string; title?: string }[] = [
    { mode: "TABLE", label: "표", title: fits ? undefined : "지금 폭에는 표가 다 들어가지 않아 옆으로 밀어 봐야 합니다" },
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
          title={option.title}
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
