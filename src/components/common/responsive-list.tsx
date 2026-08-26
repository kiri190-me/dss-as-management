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
 * **기본은 꺼짐이다.** 켜면 표 껍데기가 **부르는 쪽이 남긴 높이**를 받아, 비로소
 * **스스로 굴러가는** 세로 스크롤 상자가 된다.
 *
 * 왜 그것이 필요한가 — 표 껍데기에는 이미 overflow-x-auto 가 있고, 한 축이
 * visible 이 아니면 나머지 축의 visible 도 auto 로 계산된다(CSS 규칙). 즉 이
 * 래퍼는 진작부터 세로로도 스크롤 상자였다. 다만 높이가 자유라 표 높이만큼
 * 자라고 자기 안에서는 한 번도 굴러가지 않았다. position: sticky 는 **가장
 * 가까운 스크롤 상자**를 기준으로 붙으므로, 표 안의 <thead className="sticky
 * top-0"> 은 굴러가지 않는 그 상자에 붙어 아무 일도 하지 않는다 — 저장소의
 * sticky top-0 <thead> 셋이 지금 전부 그 상태다(`전체 A/S 현황`에서 확인했다).
 * 높이가 표 높이와 무관하게 정해지는 순간 그 상자가 진짜로 굴러가고, 그제서야
 * top-0 이 붙을 자리가 생긴다.
 *
 * ⚠️ **세로로 굴러가는 상자가 하나 더 생기는 것은 이번만은 고장이 아니다.** 이
 * 앱의 세로 스크롤 자리는 AppShell 의 <main> 하나뿐이고, 주간보고 화면 헤더에
 * 그 하나를 어긴 고장 둘이 길게 적혀 있다. 거기서는 스크롤 상자가 **의도치 않게** 생겼다
 * — overflow-x 가 세로 축까지 바꿔 놓은 래퍼에 flex 가 확정 높이를 얹었고,
 * 아무도 그걸 바라지 않았다. 여기서는 **같은 장치를 알고 쓴다** — 켠 목록만,
 * 그것도 머리글을 붙여 두기 위해서다. 22칼럼짜리 장부는 열 제목이 안 보이면
 * 지금 보는 칸이 무엇인지 알 길이 없어서, 스크롤바 하나를 더 보는 대가를 치르고
 * 제목을 붙여 두기로 한 것이다(사용자 결정). **이 높이 규칙을 걷어내면 머리글
 * 고정이 다시 헛돈다** — 걷어내기 전에 이 문단을 읽을 것.
 *
 * ── 높이는 값이 아니라 **자리**로 정해진다 ──────────────────────────────
 * 처음에는 70dvh 짜리 max-height 라는 어림값이었다(클래스 이름을 그대로 적지
 * 않는 것은 Tailwind 가 주석까지 훑어 쓰지도 않는 규칙을 만들어 내기 때문이다).
 * 화면 높이의 70% 는 어느 화면에서도 대충 맞지만 **정확히는 맞지 않아서**, 표
 * 아래에 남는 공간이 생기고 페이지가 표와 따로 굴러갔다 — 표를 끝까지 보려면
 * 페이지를 먼저 내려야 하고, 페이지는 표 아래로 더 내려갔다. 스크롤 둘이 서로
 * 어긋나 있으면 지금 어느 쪽을 굴려야 하는지 매번 생각해야 한다(사용자 지적).
 *
 * 그래서 상한을 걷어내고 **부르는 쪽이 남긴 높이를 그대로 받는다.** 부르는 쪽이
 * <main> 높이에 꼭 맞는 세로 flex 상자(h-full flex flex-col)이고 이 목록이 그
 * 마지막 칸이면, 위 요소들이 쓰고 남은 높이가 곧 이 목록의 높이가 된다. 그래서
 * **부르는 쪽에 확정 높이가 없으면 이 옵트인은 아무 일도 하지 않는다** — 켤 때
 * h-full 을 함께 확인할 것.
 *
 * ── ⚠️ 자리를 받는 것과 테두리를 가진 것을 **나눈다** ────────────────────
 * 둘을 한 요소에 얹으면 반드시 하나를 잃는다. 늘어나게 하면 줄 두어 개짜리 표가
 * 화면 높이만큼 늘어난 **테두리 친 빈 상자**가 되고, 안 늘어나게 하면 남는 높이를
 * 받을 길이 없다. 나누면 둘 다 된다 — 이 파일에는 나눌 요소가 이미 둘 있다.
 *
 *   **바깥(이 목록의 루트) — 자리를 받는다.** flex-1 로 남는 높이를 통째로
 *   받는다. 테두리도 배경도 없으므로 제 내용보다 크게 받아도 **눈에 보이는 것이
 *   없다.** 높이가 표 높이와 무관하게 정해지는 곳이 여기다.
 *
 *   **안(표 껍데기) — 제 내용만큼만.** flex-grow 를 주지 않는다(기본값 0). 줄이
 *   두어 개뿐이면 껍데기도 그만큼이고, 루트가 받아 둔 남는 자리는 **테두리 없는
 *   빈 자리**로 그 아래 남는다. 줄이 많으면 반대로 루트가 준 높이까지만 자라고
 *   나머지는 자기 안에서 굴러간다 — 껍데기는 overflow 가 visible 이 아니라 자동
 *   최소 높이가 0 이어서 거기까지 줄어들 수 있다.
 *
 * ── ⚠️ 진짜 걸림돌은 루트의 **자동 최소 높이**였다. min-h 를 지우지 말 것 ──
 * flex 항목의 min-height 초기값은 auto 이고 그 값은 **제 내용의 최소 높이**로
 * 계산된다(css-flexbox-1 §4.5의 automatic minimum size). 껍데기는 overflow 가
 * visible 이 아니라 그 규칙에서 빠지지만, **이 루트는 overflow 가 visible 이라
 * 그대로 걸린다** — min-height 를 명시하지 않으면 루트는 표 높이 아래로 한 픽셀도
 * 줄지 않는다. 부르는 쪽이 h-full 로 높이를 못 박아도 소용이 없다: 줄어들 수 없는
 * 항목이 하나 있으면 그 세로 flex 상자는 그냥 넘치고, 넘친 만큼 페이지가 굴러간다.
 *
 * 실측(헤드리스 크롬, 22칼럼 23줄, <main> clientHeight 855):
 *   min-height 없음 → scrollHeight 1327(=472px 넘침), 루트가 963px 을 그대로
 *   차지하고 껍데기 안쪽에는 스크롤이 **아예 생기지 않는다**(= sticky 머리글이
 *   붙을 자리가 없다). 아래 min-h 를 주면 같은 화면에서 scrollHeight 가 855 로
 *   떨어지고 껍데기가 433px 짜리 스크롤 상자가 된다.
 *
 * **바닥은 min-h-[18rem] 이고 껍데기가 아니라 이 목록 전체에 건다.** 이 한 줄이
 * 두 가지 일을 함께 한다 — 위의 자동 최소 높이를 걷어내는 것(그것이 없으면 위
 * 실측의 넘침으로 돌아간다), 그리고 위 요소가 길어질 때(`내자 정리` 의 `줄 수정`
 * 폼이 열리면 화면 절반이 폼이다) 표가 머리글만 남게 납작해지는 것을 막는 것.
 * 18rem 은 머리글 한 줄에 여섯 줄 남짓이 함께 보이는 높이다. 껍데기가 아니라
 * 목록에 거는 이유는 위 '나눈다' 항목 그대로다 — 껍데기에 걸면 줄이 두어 개뿐인
 * 표까지 288px 짜리 **테두리 친** 빈 상자가 된다. 바닥에 걸린 그때는 **페이지가
 * 굴러가는 것이 맞다**: 폼을 보려면 어차피 위로 올라가야 한다.
 *
 * ⚠️ **인쇄에는 flex-1 을 따로 되돌리지 않는다 — 실측으로 확인했다.** 인쇄에서는
 * 부르는 쪽이 print:h-auto 로 높이 못을 빼므로 "남는 높이"가 없어지는데, flex-basis
 * 가 0 인 항목이 바닥값 288px 로 주저앉을 것 같지만 그렇게 되지 않는다: 높이가 auto
 * 인 세로 flex 상자는 제 높이를 정할 때 flex-grow 를 가진 항목의 **max-content
 * 기여분**을 쓴다(css-flexbox-1 §9.9.1). 실측(같은 조건, 인쇄 규칙을 화면에 강제
 * 적용): 루트 948px · 표 912px 이 통째로 그려졌고, print:flex-none 을 함께 걸어도
 * 값이 한 픽셀도 다르지 않았다. **그래서 넣지 않았다** — 없어도 되는 클래스를
 * "혹시 몰라" 남기면 다음 사람이 그것을 근거로 읽는다.
 *
 * ⚠️ 재는 잣대를 높이에서 떼어 놓는다 — overflow-y-scroll ────────────────
 * 표가 지금 폭에 들어가는지는 껍데기의 scrollWidth <= clientWidth 로 판정한다
 * (useTableFitsWithoutOverflow). 세로 스크롤바가 있으면 그만큼 clientWidth 가
 * 줄기 때문에, **보이는 껍데기와 화면 밖에서 재는 껍데기의 스크롤바 유무가
 * 다르면 잣대가 어긋난다** — 딱 그 폭 구간(스크롤바 너비만큼)에서 카드↔표가
 * 서로를 되부르며 끝없이 뒤집힌다.
 *
 * 예전에는 양쪽에 같은 상한(70dvh)을 붙여 스크롤바 유무를 맞췄다. 이제 보이는
 * 쪽의 높이는 **남는 자리**가 정하는데 재는 쪽은 자리 밖(absolute)이라 그 높이를
 * 물려받을 길이 없다 — 높이로는 맞출 수 없다. 그래서 반대로 **높이와 무관하게**
 * 맞춘다: 양쪽 다 overflow-y-scroll 로 세로 스크롤바 자리를 **항상** 비워 둔다.
 * 그러면 표가 길든 짧든 clientWidth 가 같아서 잣대가 어긋날 여지 자체가 없다.
 * 대가는 줄이 몇 개뿐일 때도 오른쪽에 빈 스크롤바 자리가 보이는 것인데, 켠
 * 목록은 어차피 늘 굴러가는 장부 하나뿐이다. 재는 상자는 실제로 그려질 때와 같은
 * 모양이어야 한다는 규칙은 그대로다 — 맞추는 축만 높이에서 스크롤바로 옮겼다.
 *
 * 인쇄에서는 print:overflow-visible 로 상자를 아예 푼다. 스크롤 상자는 인쇄
 * 조각내기에서 **쪼갤 수 없는 덩어리**여서, 그대로 두면 한 장을 넘기는 표가
 * 첫 장에서 잘린다. 부르는 쪽도 print:h-auto 로 확정 높이를 풀어야 짝이 맞는다.
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

/**
 * 서버에는 localStorage가 없다. 저장해 둔 값이 없는 사람과 같은 화면을 준다.
 *
 * 첫 렌더에서 그냥 읽으면 서버가 그린 것과 달라져 hydration이 어긋나고,
 * effect에서 읽어 setState하면 한 프레임 동안 잘못된 화면이 스쳐 지나간다.
 * useSyncExternalStore가 정확히 이 상황을 위한 것이다.
 */
function readServer(): string | null {
  return null;
}

/**
 * 브라우저에 적어 둔 **사람이 고른 값 하나**를 읽는다. 아래 useViewMode 가
 * 이것으로 만들어져 있고, 목록이 아닌 화면도 같은 장치를 쓸 수 있게 내보낸다
 * (`내자 정리` 의 머리말 접기가 첫 사용처다).
 *
 * ⚠️ **각자 useSyncExternalStore 를 다시 쓰지 말고 이것을 쓸 것.** 저장한 값을
 * 첫 렌더에서 그냥 읽으면 서버가 그린 화면과 달라져 hydration 이 어긋나고,
 * effect 에서 읽어 setState 하면 저장값과 다른 화면이 한 프레임 스쳐 지나간다.
 * 위 readServer 주석이 그 함정과 답을 그대로 담고 있다 — 여기 한 벌만 두면
 * 새로 쓰는 곳이 그 함정을 다시 밟을 일이 없다.
 *
 * 돌려주는 것은 **적혀 있는 글자 그대로**다. 그 글자가 뜻이 있는 값인지는 부르는
 * 쪽이 판정한다(아래 useViewMode 가 "CARD"·"TABLE" 만 인정하는 것처럼) — 남이
 * 넣어 둔 엉뚱한 글자가 곧바로 화면의 상태가 되어서는 안 된다.
 *
 * 저장 키는 `무엇:어디` 꼴로 짓는다 — 위 storageKeyOf 의
 * `list-view-mode:<목록 이름>` 이 그 본이다. 화면마다 따로 기억하되, 무엇을
 * 기억한 값인지 키만 보고 알 수 있다.
 */
export function useStoredChoice(storageKey: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(storageKey),
    readServer
  );
}

/**
 * 고른 값을 적어 두고, 이 장치를 쓰는 화면 전부에 알린다. 알리지 않으면 같은
 * 값을 보고 있는 다른 자리가 낡은 채로 남는다.
 */
export function setStoredChoice(storageKey: string, value: string): void {
  window.localStorage.setItem(storageKey, value);
  for (const listener of listeners) listener();
}

function useViewMode(listId: string): ViewMode | null {
  const stored = useStoredChoice(storageKeyOf(listId));
  return stored === "CARD" || stored === "TABLE" ? stored : null;
}

function setViewMode(listId: string, next: ViewMode): void {
  setStoredChoice(storageKeyOf(listId), next);
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
   * 이 목록이 **부르는 쪽에서 남은 높이**를 받고, 그 안에서 표 껍데기가 진짜
   * 세로 스크롤 상자가 되게 한다. <table> 안에 `<thead className="sticky top-0">`
   * 을 둔 목록만 켠다 — 위 '열 제목을 붙여 두는 목록만 켠다' 항목에 까닭과 대가가
   * 전부 적혀 있다.
   *
   * ⚠️ **부르는 쪽이 확정 높이를 가진 세로 flex 상자여야 한다**(<main> 에 꼭 맞는
   * `flex h-full flex-col` 상자의 마지막 칸). 이 목록이 flex-1 로 **남는 높이를
   * 받기** 때문이다 — 확정 높이가 없으면 받을 자리 자체가 없고, 세로가 아니라
   * 가로 배치면 flex-1 이 높이가 아니라 폭을 먹는다. 지금 켠 곳은 `내자 정리`
   * 하나뿐이고 그 조건을 만족한다. 위 '자리를 받는 것과 테두리를 가진 것을
   * 나눈다' 항목 참조.
   *
   * **기본은 꺼짐이고, 넘기지 않은 목록은 이 인자가 생기기 전과 한 픽셀도
   * 다르지 않다**(아래 두 조각이 빈 문자열이라 클래스 문자열 자체가 글자
   * 하나까지 같다).
   */
  stickyHeader?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fits = useTableFitsWithoutOverflow(wrapperRef, measureKey ?? []);
  const mode = useViewMode(listId);
  const showTable = resolveShowTable(mode, fits);

  // 켠 목록에만 붙는다. 보이는 래퍼와 화면 밖에서 재는 래퍼에 **똑같이** 붙어야
  // 하는 이유는 파일 헤더의 마지막 ⚠️ 에 있다(잣대가 어긋나면 카드↔표가 무한히
  // 뒤집힌다). 높이는 여기서 정하지 않는다 — 남는 자리가 정한다.
  // 끈 목록에서는 빈 문자열이라 아래 두 문자열이 예전 그대로다.
  const shellScrollClass = stickyHeader ? " overflow-y-scroll print:overflow-visible" : "";
  // **자리를 받는 쪽**이 여기다(테두리는 아래 껍데기가 갖는다 — 파일 헤더의
  // '자리를 받는 것과 테두리를 가진 것을 나눈다'). 두 조각이 한 덩어리라 따로
  // 떼지 말 것:
  //   min-h-[18rem] — flex 자동 최소 높이(auto = 제 내용)를 걷어낸다. **이것이
  //                   없으면 루트가 표 높이 아래로 줄지 않아 페이지가 넘친다**
  //                   (파일 헤더에 실측이 있다). 겸해서 `줄 수정` 폼이 열렸을 때
  //                   표가 납작해지는 것을 막는 바닥이기도 하다.
  //   flex-1        — 남는 높이를 통째로 받는다. 루트에는 테두리도 배경도 없어
  //                   제 내용보다 크게 받아도 화면에 보이는 것이 없다.
  // **표를 그리는 동안에만** 건다 — 카드일 때는 이 목록이 곧 카드 격자라,
  // 카드가 한두 장뿐인데 288px 를 차지하거나 남는 높이를 받을 이유가 없다.
  const fillClass = stickyHeader && showTable ? " min-h-[18rem] flex-1" : "";

  return (
    <div className={"@container relative flex flex-col gap-2" + fillClass}>
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

      {/* **테두리를 가진 쪽**이 여기다. 위 루트와 달리 **늘리지 않는다** —
          flex-grow 를 주지 않으므로(기본값 0) 줄이 두어 개뿐이면 이 상자도
          그만큼이고, 루트가 받아 둔 남는 자리는 테두리 없는 빈 자리로 아래
          남는다. 여기에 flex-1 이나 h-full 을 붙이면 그 순간 화면 높이만큼 늘어난
          **빈 테두리 상자**가 된다(파일 헤더의 '나눈다'). 줄이 많을 때 이 상자가
          루트가 준 높이까지만 자라고 나머지를 자기 안에서 굴리는 것은 flex 의
          shrink 와 overflow 가 이미 해 준다 — 이 상자는 overflow 가 visible 이
          아니라 자동 최소 높이가 0 이다. */}
      <div
        ref={wrapperRef}
        aria-hidden={!showTable}
        className={
          showTable
            ? // 안 들어가는 폭에서 표를 고른 경우에만 실제로 스크롤이 생긴다.
              // 들어갈 때는 넘칠 것이 없으므로 hidden이던 때와 화면이 같다.
              "overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800" +
              shellScrollClass
            : "invisible pointer-events-none absolute inset-x-0 bottom-0 overflow-x-hidden" +
              shellScrollClass
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
