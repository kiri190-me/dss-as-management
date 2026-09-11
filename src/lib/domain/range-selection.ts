/**
 * ============================================================================
 * 목록에서 Shift 로 사이를 한꺼번에 고르는 규칙 — 파일 탐색기·Gmail 과 같은 손
 * ============================================================================
 * 체크박스로 여러 행을 골라 한꺼번에 처리하는 목록(접수 건 삭제 모드·휴지통,
 * 고객사·제품 모델·부품·기술 절차의 삭제 모드·휴지통, 첨부 목록, 찍은 사진)이
 * 모두 이 한 곳의 규칙을 쓴다(2026-09-11 사용자 요청). 목록마다 따로 적으면
 * "여기서는 끄기도 번지는데 저기서는 켜기만 번지는" 차이가 생기고, 그 차이는
 * 눌러 보기 전에는 알 수 없다.
 *
 * 화면과 닿는 부분(Shift 를 이벤트에서 읽기, 기준점을 들고 있기)은
 * lib/hooks/useShiftRangeSelection.ts 가 한다. 여기는 값만 다룬다.
 *
 * ── 기준점 ────────────────────────────────────────────────────────────────
 * 기준점은 **마지막으로 Shift 없이 누른 항목**이다. Shift 로 누른 것은 기준점을
 * 옮기지 않는다 — 그래야 범위를 잘못 잡았을 때 같은 기준점에서 다시 Shift 로
 * 눌러 고칠 수 있다.
 *
 * ── 범위와 켜고 끄기 ───────────────────────────────────────────────────────
 * Shift+누르기는 기준점부터 누른 항목까지를 **누른 항목의 새 상태로** 맞춘다.
 * 누른 항목이 꺼져 있었으면 범위를 켜고, 켜져 있었으면 범위를 끈다.
 * **범위 밖의 선택은 건드리지 않는다** — 탐색기처럼 범위 밖을 비우면, 조금
 * 전에 다른 곳에서 골라 둔 것이 말없이 사라진다. 삭제 목록에서 그것은 "몇 건을
 * 지우는지"를 눈으로 셀 수 없게 만든다.
 *
 * ── 순서는 '지금 화면에 보이는 순서'다 ──────────────────────────────────────
 * 정렬·검색·페이지를 적용한 뒤 그려진 순서 그대로를 받는다. 보이지 않는 행은
 * 범위에 들어갈 수 없다(select-all-checkbox.tsx 의 '보이는 것만' 과 같은 판단).
 * 그래서 **페이지를 넘나드는 범위는 만들지 않는다** — 기준점이 다른 페이지에
 * 있으면 지금 목록에 없는 것이므로 보통 누르기로 처리한다. 검색어를 바꿔
 * 기준점이 가려진 경우도 같다.
 *
 * ── 고를 수 없는 행은 건너뛴다 ────────────────────────────────────────────
 * 비활성 체크박스(접수 건이 걸린 고객사, 입출고 이력이 있는 부품, 로컬 임시
 * 접수 건 등)는 범위 한가운데 있어도 켜지지 않는다. 한 번에 여러 개를 켜는
 * 길이 생겼다고 해서 하나씩 누를 때 막혀 있던 행이 딸려 들어가면 안 된다.
 * ============================================================================
 */

export type RangeToggleInput = {
  /** 지금 화면에 그려진 순서 그대로의 id(정렬·검색·페이지 적용 뒤). */
  orderedIds: readonly string[];
  /** 고를 수 있는가 — 비활성 체크박스의 행은 거짓. */
  isSelectable: (id: string) => boolean;
  /** 지금 골라져 있는가. */
  isSelected: (id: string) => boolean;
  /** 기준점 — 마지막으로 Shift 없이 누른 항목. 아직 없으면 null. */
  anchorId: string | null;
  /** 방금 누른 항목. */
  targetId: string;
  /** Shift 를 누른 채였는가. */
  shiftKey: boolean;
};

export type RangeTogglePlan = {
  /** 이번에 상태를 맞출 id — 화면 순서, 중복 없음, 고를 수 없는 행은 빠져 있다. */
  ids: string[];
  /** 위 id 들을 이 상태로 맞춘다 — 누른 항목의 새 상태. */
  nextChecked: boolean;
  /** 다음 기준점. 범위로 처리했으면 그대로, 보통 누르기였으면 누른 항목. */
  anchorId: string;
  /** 범위로 처리했는가. */
  isRange: boolean;
};

/**
 * 한 번 누른 것을 "무엇을 어느 상태로 맞출지"로 바꾼다.
 *
 * 누른 항목 자체를 고를 수 없으면 null — 아무것도 바꾸지 않고 기준점도 그대로다
 * (비활성 체크박스는 애초에 눌리지 않지만, 규칙이 화면의 disabled 에 기대지
 * 않게 한다).
 */
export function planRangeToggle(input: RangeToggleInput): RangeTogglePlan | null {
  const { orderedIds, isSelectable, isSelected, anchorId, targetId, shiftKey } = input;
  if (!isSelectable(targetId)) return null;

  const nextChecked = !isSelected(targetId);
  const targetIndex = orderedIds.indexOf(targetId);
  const anchorIndex = anchorId === null ? -1 : orderedIds.indexOf(anchorId);

  // 보통 누르기: Shift 가 없거나, 기준점이 없거나, 기준점이 지금 목록에 없다
  // (다른 페이지·가려진 검색 결과·지워진 행). 누른 것 하나만 뒤집고 기준점이 된다.
  if (!shiftKey || anchorId === null || anchorIndex < 0 || targetIndex < 0) {
    return { ids: [targetId], nextChecked, anchorId: targetId, isRange: false };
  }

  const from = Math.min(anchorIndex, targetIndex);
  const to = Math.max(anchorIndex, targetIndex);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let index = from; index <= to; index += 1) {
    const id = orderedIds[index];
    if (seen.has(id) || !isSelectable(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return { ids, nextChecked, anchorId, isRange: true };
}

/** Set 으로 선택을 들고 있는 목록에 한 번의 결과를 얹는다. 받은 Set 은 건드리지 않는다. */
export function setIdsChecked(
  selected: ReadonlySet<string>,
  ids: Iterable<string>,
  checked: boolean
): Set<string> {
  const next = new Set(selected);
  for (const id of ids) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}

/**
 * 배열로 선택을 들고 있는 목록에 한 번의 결과를 얹는다. 이미 있는 순서는
 * 그대로 두고 새로 켜진 것만 뒤에 붙인다 — 같은 id 가 두 번 들어가지 않는다.
 */
export function setIdsCheckedInList(
  selected: readonly string[],
  ids: Iterable<string>,
  checked: boolean
): string[] {
  const targets = new Set(ids);
  if (!checked) return selected.filter((id) => !targets.has(id));
  const present = new Set(selected);
  const next = [...selected];
  for (const id of targets) {
    if (present.has(id)) continue;
    present.add(id);
    next.push(id);
  }
  return next;
}
