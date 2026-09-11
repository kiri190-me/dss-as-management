"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { planRangeToggle, setIdsChecked } from "@/lib/domain/range-selection";

/**
 * ============================================================================
 * Shift 로 사이를 한꺼번에 고르기 — 화면과 닿는 얇은 층
 * ============================================================================
 * 규칙(기준점·범위·켜고 끄기·건너뛰기)은 전부 lib/domain/range-selection.ts 에
 * 있다. 여기서 하는 일은 셋뿐이다: 기준점을 들고 있고, 누른 이벤트에서 Shift 를
 * 읽고, 결과를 목록의 선택 상태에 얹는다.
 *
 * ── Shift 는 어디서 읽는가 ─────────────────────────────────────────────────
 * 체크박스의 onChange 는 React 가 **click 이벤트로** 만든다(react-dom 의
 * ChangeEventPlugin 이 checkbox/radio 는 click 을 본다). 그래서 onChange 가 받은
 * 이벤트 자체에는 shiftKey 가 없고 `nativeEvent` 에 있다 — shiftKeyOf 가 둘 다
 * 본다. 단추(첨부 격자의 동그라미)는 onClick 이라 이벤트에 바로 있다.
 *
 * ── 키보드 ────────────────────────────────────────────────────────────────
 * Space 로 체크박스를 켤 때도 브라우저가 click 을 대신 쏜다. 그 click 에 누르고
 * 있던 수식키가 실리면 **Shift+Space 도 범위로 동작한다.** 실리지 않는 브라우저
 * 에서는 보통 누르기가 될 뿐 깨지지 않는다 — 어느 쪽이든 이 코드가 따로 할 일은
 * 없다. <label> 을 눌러 체크박스가 켜지는 경우도 같다(브라우저가 체크박스에
 * click 을 대신 쏜다). ⚠️ 두 경우 모두 실제 브라우저로는 아직 확인하지 않았다
 * (2026-09-11) — 마우스 Shift+누르기는 수식키가 click 에 그대로 있다.
 *
 * ── 글자가 긁히지 않게 ─────────────────────────────────────────────────────
 * 브라우저는 Shift+누르기를 "앞서 누른 자리부터 여기까지 글자 선택 늘리기"로도
 * 읽는다. 체크박스 두 개 사이의 글자가 파랗게 칠해지면 무엇을 골랐는지 오히려
 * 안 보인다. 그래서 **누르는 그 요소의 mousedown 에서만** Shift 일 때 기본
 * 동작을 막는다(preventShiftClickTextSelection). 전역 user-select 는 건드리지
 * 않는다 — 목록의 글자를 복사하는 일은 그대로 되어야 한다. mousedown 을 막아도
 * click 은 그대로 오므로 체크는 정상으로 바뀐다.
 * ============================================================================
 */

type RangeSelectionOptions = {
  /** 지금 화면에 그려진 순서 그대로의 id — 표와 카드가 같은 순서로 그린다. */
  orderedIds: readonly string[];
  /** 고를 수 있는가. 생략하면 전부 고를 수 있다. */
  isSelectable?: (id: string) => boolean;
} & (
  | {
      /** 선택을 Set 으로 들고 있는 목록(대부분). */
      selectedIds: ReadonlySet<string>;
      setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
    }
  | {
      /** 선택을 다른 모양(배열·행 안의 깃발)으로 들고 있는 목록. */
      isSelected: (id: string) => boolean;
      /** ids 를 모두 checked 로 맞춘다. */
      apply: (ids: string[], checked: boolean) => void;
    }
);

const everySelectable = () => true;

export function useShiftRangeSelection(options: RangeSelectionOptions) {
  // 기준점 — 마지막으로 Shift 없이 누른 항목. 한 번 누를 때마다 선택과 함께
  // 바뀌므로 같은 렌더로 묶인다.
  const [anchorId, setAnchorId] = useState<string | null>(null);

  /** 한 항목을 눌렀다. shiftKey 는 shiftKeyOf(event) 로 읽어 넘긴다. */
  function toggle(id: string, shiftKey = false) {
    const isSelected =
      "selectedIds" in options ? (candidate: string) => options.selectedIds.has(candidate) : options.isSelected;
    const plan = planRangeToggle({
      orderedIds: options.orderedIds,
      isSelectable: options.isSelectable ?? everySelectable,
      isSelected,
      anchorId,
      targetId: id,
      shiftKey,
    });
    if (plan === null) return;

    setAnchorId(plan.anchorId);
    if ("selectedIds" in options) {
      options.setSelectedIds((previous) => setIdsChecked(previous, plan.ids, plan.nextChecked));
    } else {
      options.apply(plan.ids, plan.nextChecked);
    }
  }

  return { toggle };
}

/**
 * 누른 이벤트에 Shift 가 실려 있었는가. 단추의 onClick 은 이벤트에, 체크박스의
 * onChange 는 nativeEvent(= click)에 있다 — 둘 다 본다.
 */
export function shiftKeyOf(event: { shiftKey?: boolean; nativeEvent?: object | null }): boolean {
  if (event.shiftKey === true) return true;
  const native = event.nativeEvent as { shiftKey?: unknown } | null | undefined;
  return native?.shiftKey === true;
}

/**
 * 누르는 요소의 onMouseDown 에 단다 — Shift 일 때만 글자 선택이 번지지 않게
 * 막는다. click 은 막지 않으므로 체크는 그대로 바뀐다. <label> 로 감싼 카드는
 * 그 <label> 에 단다(글자를 누른 것도 체크가 되기 때문이다).
 */
export function preventShiftClickTextSelection(event: { shiftKey: boolean; preventDefault: () => void }): void {
  if (event.shiftKey) event.preventDefault();
}
