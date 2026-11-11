/**
 * ============================================================================
 * 체크박스 드롭다운(복수 선택 필터)의 **값으로 도는 부분**
 * ============================================================================
 * 2026-11-11 사용자 개선요청 — [전체 A/S 현황]·[기타건 현황]의 필터에서 한
 * 종류 안의 여러 값을 한꺼번에 고를 수 있게 한다. 지금은 [현재 상태] 하나가
 * 이것을 쓰고, 나머지 여섯(제품군·유·무상·고객사·우선순위 · 기타건 둘)이
 * 뒤이어 같은 부품을 쓴다.
 *
 * 그리는 쪽(CheckboxFilterDropdown.tsx)과 **일부러 나눠 두었다.** 닫힌 칸에
 * 뭐라고 적히는가 · 체크를 눌렀을 때 다음 값이 무엇인가 · 바깥을 눌렀을 때
 * 접는가는 전부 DOM 없이 판정할 수 있는 규칙인데, 컴포넌트 안에 묻어 두면
 * 정적 렌더(renderToStaticMarkup)로는 첫 화면밖에 못 보므로 영영 시험에
 * 안 걸린다. 이 저장소에는 jsdom 이 없다.
 *
 * 🔴 이 파일은 React 도 document 도 모른다. 아래 접기 규칙이 진짜 DOM 이
 *    아니라 `contains`/`close` 두 함수만 받는 것도 그래서다 — 가짜를 넣어
 *    브라우저 없이 잰다(@dss/ui 의 service-menu/DropdownDismiss.tsx 가 같은
 *    사정을 같은 방법으로 풀었다. 그쪽은 묶음 바깥으로 내보내지 않아서
 *    가져다 쓸 수 없어, 같은 결로 여기에 따로 적는다).
 * ============================================================================
 */

/** 고를 수 있는 한 줄. `value` 는 코드, `label` 은 사람이 읽는 글자다. */
export type CheckboxFilterOption<T extends string = string> = {
  value: T;
  label: string;
};

/**
 * 고른 값들을 **선택지에 적힌 차례**로 다시 세운다.
 *
 * 왜 차례를 맞추는가: 닫힌 칸에 적히는 글자가 「첫째 이름 외 N개」라서, 고른
 * 차례를 그대로 쓰면 같은 조합인데도 누른 순서에 따라 다른 글자가 적힌다
 * (접수→수리중으로 누르면 「접수 외 1개」, 거꾸로 누르면 「수리 중 외 1개」).
 * 주소줄로 들어온 값(`?status=IN_REPAIR,WAITING_PO`)까지 같은 자리를 지나므로
 * 어디서 왔든 같은 조합이면 같은 글자가 된다.
 *
 * 🔴 선택지에 없는 값은 **버리지 않고 뒤에 둔다.** 조용히 버리면 걸려 있는
 *    조건이 화면에서 사라져 칸에는 「전체」라고 적히는데 목록은 걸러진 채로
 *    남는다 — 사람이 풀 수 없는 필터가 된다. (고객사처럼 선택지가 지금 화면의
 *    줄에서 뽑히는 필터에서 실제로 일어날 수 있는 일이다.)
 */
export function orderSelection<T extends string>(
  options: readonly CheckboxFilterOption<T>[],
  selected: readonly T[]
): T[] {
  const picked = new Set<T>(selected);
  const known = options.filter((option) => picked.has(option.value)).map((option) => option.value);
  const knownValues = new Set<T>(known);
  // 받은 차례를 그대로 두되 같은 값이 두 번 들어오면 한 번만 남긴다.
  const unknown = [...picked].filter((value) => !knownValues.has(value));
  return [...known, ...unknown];
}

/**
 * 한 줄의 체크를 뒤집은 **다음 값**. 원본 배열은 건드리지 않는다.
 */
export function toggleSelection<T extends string>(
  options: readonly CheckboxFilterOption<T>[],
  selected: readonly T[],
  value: T
): T[] {
  const picked = new Set<T>(selected);
  if (picked.has(value)) picked.delete(value);
  else picked.add(value);
  return orderSelection(options, [...picked]);
}

/**
 * 고른 값들을 사람이 읽는 글자로. 선택지에 없는 값은 **코드를 그대로** 쓴다 —
 * 위 orderSelection 과 같은 까닭이다(걸려 있는 것이 안 보이면 안 된다).
 */
export function selectionLabels<T extends string>(
  options: readonly CheckboxFilterOption<T>[],
  selected: readonly T[]
): string[] {
  const labelByValue = new Map<T, string>(options.map((option) => [option.value, option.label]));
  return orderSelection(options, selected).map((value) => labelByValue.get(value) ?? value);
}

/**
 * **닫힌 칸에 적히는 글자.**
 *
 * - 하나도 안 골랐으면 `emptyLabel`(기본 「전체」). 빈 선택 = 아무것도 안 거는
 *   것이라, 예전 <select> 의 「전체」와 같은 뜻이고 같은 글자여야 한다.
 * - 하나면 그 이름 그대로. 복수 선택이 되었다고 「수리 중 외 0개」가 되면 안 된다.
 * - 여럿이면 「첫째 이름 외 N개」(2026-11-11 사용자 결정). 칸 폭이 한 줄이라
 *   이름을 다 적을 수 없는데, 수만 적으면(「4개 선택」) 무엇을 골랐는지 짐작할
 *   단서가 하나도 남지 않는다.
 */
export function selectionSummary<T extends string>(
  options: readonly CheckboxFilterOption<T>[],
  selected: readonly T[],
  emptyLabel = "전체"
): string {
  const labels = selectionLabels(options, selected);
  if (labels.length === 0) return emptyLabel;
  if (labels.length === 1) return labels[0];
  return `${labels[0]} 외 ${labels.length - 1}개`;
}

/**
 * 접을 수 있는 드롭다운 하나. **진짜 DOM 이 아니라 이 최소한의 모양**만 받는다.
 */
export type DropdownDismissHandle = {
  /** 누른 자리가 이 드롭다운 **안**인가. */
  contains(node: EventTarget | null): boolean;
  /**
   * 접는다. 접는 까닭을 함께 받는다 — 초점을 단추로 돌려줄지가 갈린다.
   *
   * 🔴 "escape" 에서만 돌려준다. 바깥을 눌러 접을 때도 돌려주면 방금 누른
   *    칸에서 초점을 빼앗아, 글자를 치려고 누른 입력칸에 글자가 안 들어간다.
   */
  dismiss(reason: "outside" | "escape"): void;
};

/** 사건을 듣는 곳(실제로는 document). 시험에서는 가짜를 넣는다. */
export type DropdownEventHost = {
  addEventListener(
    type: string,
    listener: (event: Event) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: (event: Event) => void,
    options?: boolean | EventListenerOptions
  ): void;
};

/**
 * 붙였다 뗄 때 **같은 옵션**을 넘겨야 브라우저가 같은 리스너로 보고 떼어 준다.
 * capture 로 듣는 까닭은 중간의 누군가가 stopPropagation 을 부르면 버블 단계의
 * 리스너에게는 사건이 오지 않기 때문이다. 우리는 듣기만 하고 preventDefault 도
 * stopPropagation 도 하지 않으므로 먼저 듣는다고 남의 동작을 가로채지 않는다.
 */
const LISTEN = { capture: true } as const;

/**
 * 펼쳐 둔 드롭다운을 **바깥을 눌렀을 때 · Esc 를 눌렀을 때** 접는다.
 * 듣기 시작하고 **떼어내는 함수**를 돌려준다 — useEffect 가 그대로 뒷정리로 쓴다.
 *
 * 무엇을 듣는가:
 *   - `pointerdown` — 마우스·손가락·펜을 한 번에 받는다. `click` 으로 들으면
 *     iOS 가 빈 바탕의 click 을 문서까지 올려 보내지 않아 폰에서만 바깥 누르기가
 *     안 먹는다. `mousedown` 도 손가락을 못 받는 기기가 있다.
 *     🔴 드롭다운 **안**의 고르기는 반대로 `click` 으로 받아야 한다(체크박스의
 *     onChange 가 그것이다) — pointerdown 으로 고르면 굴리려고 짚은 손가락에
 *     체크가 뒤집힌다. 그래서 이 함수는 바깥만 본다.
 *   - `keydown` 의 Esc — 바깥을 누를 수 없는 키보드 사용자에게는 **닫을 유일한
 *     길**이다. preventDefault 를 하지 않으므로 팝업 닫기 같은 다른 Esc 처리를
 *     가로채지 않는다.
 */
export function watchDropdownDismiss(
  host: DropdownEventHost,
  handle: DropdownDismissHandle
): () => void {
  const onPointerDown = (event: Event) => {
    // 안을 누른 것은 바깥이 아니다 — 체크를 하나 누를 때마다 접히면 복수 선택을
    // 할 수가 없다(이 부품이 있는 까닭 그 자체다).
    if (handle.contains(event.target)) return;
    handle.dismiss("outside");
  };

  const onKeyDown = (event: Event) => {
    // "keydown" 으로 받은 것이라 KeyboardEvent 다.
    if ((event as KeyboardEvent).key !== "Escape") return;
    handle.dismiss("escape");
  };

  host.addEventListener("pointerdown", onPointerDown, LISTEN);
  host.addEventListener("keydown", onKeyDown, LISTEN);

  return () => {
    host.removeEventListener("pointerdown", onPointerDown, LISTEN);
    host.removeEventListener("keydown", onKeyDown, LISTEN);
  };
}
