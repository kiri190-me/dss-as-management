"use client";

import { useEffect, useRef } from "react";

/**
 * ============================================================================
 * 목록 전체 선택 — 체크박스 열의 머리글, 그리고 카드 보기의 같은 자리
 * ============================================================================
 * 선택 체크박스가 있는 모든 목록(접수 건 삭제 모드·휴지통, 고객사·제품 모델의
 * 삭제 모드·휴지통)이 이 하나를 쓴다. 목록마다 따로 적으면 "여기서는 지금
 * 보이는 것만 골라지고 저기서는 전부 골라지는" 차이가 생기고, 그 차이는
 * 눌러 보기 전에는 알 수 없다.
 *
 * ── 무엇을 고르는가: '지금 이 목록에 보이는 것' ─────────────────────────
 * 검색으로 걸러졌거나 페이지가 나뉘어 있으면 **지금 화면에 있는 행**만
 * 대상이다. 보이지 않는 행까지 딸려 가면 "몇 건을 지우는지"를 눈으로 셀 수
 * 없게 되고, 삭제에서 그건 위험한 종류의 편리함이다. 실제로 무엇이 담기는지는
 * 부르는 쪽이 넘기는 목록이 정하고, 이 컴포넌트는 그 수만 받는다.
 *
 * 고를 수 없는 행(접수 건이 걸린 고객사, 서버에 없는 로컬 행 등)은 애초에
 * 세지 않는다 — selectableCount는 '고를 수 있는 것'의 수이고, 그래서 그런
 * 행만 남은 목록에서는 이 체크박스 자체가 비활성이 된다. 눌러도 아무 일이
 * 없는 컨트롤을 눌러 보게 두지 않는다.
 *
 * ── 해제는 '보이는 것만' 푼다 ───────────────────────────────────────────
 * 체크를 풀면 지금 보이는 행의 선택만 사라진다. 다른 페이지에서 골라 둔 것은
 * 그대로 남는다 — 그쪽을 한꺼번에 비우는 것은 선택 바의 '선택 해제'가 하는
 * 다른 일이다. 이 둘을 같은 동작으로 합치면, 검색어를 바꾼 뒤 체크를 한 번
 * 눌렀다가 보이지 않는 곳의 선택까지 잃는다.
 *
 * ── 일부만 골랐을 때 ────────────────────────────────────────────────────
 * indeterminate는 DOM 속성이라 JSX 속성으로는 넣을 수 없다(React가 그리는
 * 것은 checked뿐이다). ref로 매번 직접 맞춰 준다 — 이걸 빠뜨리면 3개 중
 * 1개만 고른 상태가 '전부 해제됨'과 똑같이 보인다.
 * ============================================================================
 */
export default function SelectAllCheckbox({
  selectableCount,
  selectedCount,
  onChange,
  label,
  ariaLabel = "전체 선택",
}: {
  /** 지금 이 목록에서 고를 수 있는 행 수. 0이면 비활성이다. */
  selectableCount: number;
  /** 그중 지금 골라져 있는 수. */
  selectedCount: number;
  onChange: (nextChecked: boolean) => void;
  /** 옆에 보일 글자. 카드 보기처럼 머리글이 없는 자리에서 쓴다. 표 머리글에서는 생략한다. */
  label?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const allSelected = selectableCount > 0 && selectedCount >= selectableCount;
  const someSelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someSelected;
  }, [someSelected]);

  const input = (
    <input
      ref={ref}
      type="checkbox"
      checked={allSelected}
      disabled={selectableCount === 0}
      aria-label={label ? undefined : ariaLabel}
      onChange={(event) => onChange(event.target.checked)}
      className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-40"
    />
  );

  if (!label) return input;

  return (
    <label className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
      {input}
      {label}
    </label>
  );
}
