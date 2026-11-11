"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  isShortcutActive,
  selectionSummary,
  toggleSelection,
  toggleShortcut,
  watchDropdownDismiss,
  type CheckboxFilterOption,
} from "./checkbox-filter-dropdown";

/**
 * ============================================================================
 * 한 종류 안에서 **여럿 고르는** 필터 칸 (2026-11-11 사용자 개선요청)
 * ============================================================================
 * 겉모습은 <select> 와 같은 칸 하나다. 누르면 체크박스 목록이 펼쳐지고, 고른
 * 것이 닫힌 칸에 「첫째 이름 외 N개」로 적힌다.
 *
 * ── 왜 <select multiple> 이 아닌가 ─────────────────────────────────────────
 * 브라우저의 multiple 은 Ctrl/Shift 를 눌러 고르게 되어 있어 모르면 못 쓰고,
 * 이미 고른 것을 Ctrl 없이 누르면 **전부 날아간다.** 폰에서는 아예 다른 화면이
 * 뜬다. 그리고 칸이 여러 줄로 늘 펼쳐져 있어 필터 카드의 격자가 무너진다.
 *
 * ── 왜 바깥 묶음을 안 쓰는가 ───────────────────────────────────────────────
 * 이 칸 하나 때문에 묶음을 더하지 않는다. HTML + CSS + React 로 되는 일이고,
 * 늘어나는 것은 아래 useEffect 하나뿐이다.
 *
 * ── 🔴 **일곱 칸이 이것을 쓴다** ───────────────────────────────────────────
 * [전체 A/S 현황]의 다섯(현재 상태·제품군·유·무상·고객사·우선순위)과 [기타건
 * 현황]의 둘(상태·공급처)이다 — 2026-11-11 에 일곱이 다 옮겨 왔다. 그래서
 *   · 값의 종류를 T 로 열어 두고(코드 문자열이면 무엇이든),
 *   · 단축 단추(shortcut)는 **없어도 그려지게** 했다 — 일곱 중 여섯은 없다.
 * 이 파일에 [현재 상태]만 아는 것(상태 코드·「입고품 전체」)을 적지 않는다.
 *
 * ── 값으로 도는 규칙은 옆 파일에 ───────────────────────────────────────────
 * 닫힌 칸의 글자 · 체크를 눌렀을 때의 다음 값 · 바깥 누르기/Esc 로 접기는
 * checkbox-filter-dropdown.ts 가 갖고 있다. 이 저장소에는 jsdom 이 없어
 * 컴포넌트는 첫 화면밖에 못 재기 때문이다(그 파일 머리말).
 * ============================================================================
 */

export type CheckboxFilterShortcut<T extends string> = {
  /** 단추에 적히는 글자(예: 「입고품 전체」). */
  label: string;
  /**
   * 누르면 **이 값들로 갈아 끼운다**(더하는 것이 아니다). 갈아 끼운 뒤에 남는
   * 것은 그냥 「여럿 고른 상태」라, 거기서 하나씩 빼거나 더할 수 있다 — 이 단추는
   * 체크 칸이 아니다(2026-11-11 사용자 결정).
   *
   * 🔴 다만 **눌린 토글**이다(2026-11-11 사용자 추가 요청). 고른 값이 이 값들과
   *    꼭 같으면 단추가 눌린 모습이 되고, 그때 누르면 체크가 **다 풀린다.**
   *    눌렸는지는 누른 적이 있는지로 기억하지 않고 **지금 고른 값으로** 판정한다
   *    — 손으로 하나씩 체크해 같은 묶음을 만들어도 같게 보여야 하기 때문이다
   *    (값 쪽 파일의 isShortcutActive).
   */
  values: readonly T[];
};

export type CheckboxFilterDropdownProps<T extends string> = {
  /** 칸 이름. 칸 위에 적히고 펼친 목록의 이름표도 된다(예: 「현재 상태」). */
  label: string;
  options: readonly CheckboxFilterOption<T>[];
  /** 지금 고른 값들. **빈 배열이면 「전체」**다(아무것도 안 거는 것). */
  selected: readonly T[];
  onChange: (next: T[]) => void;
  /** 있을 수도 없을 수도 있다. 없으면 목록만 그린다. */
  shortcut?: CheckboxFilterShortcut<T>;
  /** 하나도 안 골랐을 때 닫힌 칸에 적히는 글자. 기본은 「전체」. */
  emptyLabel?: string;
  /**
   * 여는 단추의 id. 안 주면 React 가 짓는다 — 화면에서 이 칸을 집어 가리킬 일이
   * 있는 자리만 적어 준다(지금은 일곱 칸이 모두 적어 준다: 시험이 「어느 칸이
   * 복수 선택인가」를 이 id 로 집는다).
   */
  id?: string;
};

const triggerClass =
  "flex w-full items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-left text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";

/**
 * 단축 단추의 모양. **눌린 모습과 안 눌린 모습이 눈에 띄게 달라야** 한다 —
 * aria-pressed 만 바뀌고 색이 그대로면 화면을 보는 사람은 토글인 줄 모른다.
 * 색은 이 저장소의 다른 토글 단추(주간보고의 「견적서 번호 보기」)와 같은 결로
 * 맞췄다: 눌리면 바탕이 진해지고 글자가 뒤집힌다.
 */
const shortcutBaseClass = "w-full px-3 py-1.5 text-left text-sm font-medium transition-colors";
const shortcutIdleClass =
  "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800";
const shortcutPressedClass =
  "bg-primary-900 text-white hover:bg-primary-800 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200";

/**
 * **펼쳤을 때 보이는 목록.** 따로 내보내는 까닭은 시험이다 — 아래 본체는 접힌
 * 채로 태어나고(useState(false)) 정적 렌더(renderToStaticMarkup)는 효과도
 * 누르기도 돌리지 못하므로, 한 덩어리로 두면 **펼친 모습을 영영 못 잰다**
 * (이 저장소에는 jsdom 이 없다). 펼침 여부 말고는 바깥에서 받은 것을 그리기만
 * 하는 조각이라 떼어 내도 잃는 것이 없다.
 */
export function CheckboxFilterPanel<T extends string>({
  panelId,
  labelId,
  options,
  selected,
  onChange,
  shortcut,
}: {
  panelId: string;
  labelId: string;
  options: readonly CheckboxFilterOption<T>[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
  shortcut?: CheckboxFilterShortcut<T>;
}) {
  const pickedValues = new Set<T>(selected);
  // 🔴 「눌렀는가」가 아니라 **「지금 고른 것이 그 묶음인가」**다. 손으로 하나씩
  //    체크해 같은 묶음을 만든 사람도 눌린 모습을 봐야 한다(값 쪽 파일의 주석).
  const shortcutPressed = shortcut ? isShortcutActive(shortcut.values, selected) : false;

  return (
    // 🔴 자리를 차지하지 않고 **떠 있어야** 한다. 흐름에 끼면 펼칠 때마다 격자
    //    한 칸이 세로로 늘어 옆 칸들이 밀려 내려간다.
    <div
      id={panelId}
      role="group"
      aria-labelledby={labelId}
      className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      {/* 🔴 단축 단추는 **있을 수도 없을 수도** 있다. 없으면 목록만 그린다 —
          이 부품을 쓰는 일곱 칸 가운데 여섯은 단축 단추가 없다(있는 것은 [전체
          A/S 현황]의 [현재 상태] 하나다). */}
      {shortcut && (
        <>
          <button
            type="button"
            // 읽어 주는 프로그램에도 「눌린 토글」로 전해져야 한다. 글자는 늘
            // 그대로다(「입고품 전체」) — 눌렸을 때 「해제」로 바꾸면 사용자가
            // 지정한 이름이 화면에서 사라진다.
            aria-pressed={shortcutPressed}
            className={`${shortcutBaseClass} ${shortcutPressed ? shortcutPressedClass : shortcutIdleClass}`}
            onClick={() => onChange(toggleShortcut(shortcut.values, selected))}
          >
            {shortcut.label}
          </button>
          <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
        </>
      )}

      {/* 선택지가 많은 필터(전체 A/S 현황의 고객사 · 기타건 현황의 공급처)도 이
          부품을 쓴다 — 목록이 화면 밖까지 자라지 않도록 높이를 묶고 제 안에서
          굴린다. */}
      <div className="max-h-60 overflow-y-auto">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {/* 고르는 것은 `click`(체크박스의 onChange)으로 받는다 — 바깥 누르기만
                pointerdown 이다. 여기서 pointerdown 으로 고르면 목록을 굴리려고
                짚은 손가락에 체크가 뒤집힌다. */}
            <input
              type="checkbox"
              className="shrink-0"
              checked={pickedValues.has(option.value)}
              onChange={() => onChange(toggleSelection(options, selected, option.value))}
            />
            <span className="min-w-0 break-words">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function CheckboxFilterDropdown<T extends string>({
  label,
  options,
  selected,
  onChange,
  shortcut,
  emptyLabel,
  id,
}: CheckboxFilterDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const generatedId = useId();
  const triggerId = id ?? `${generatedId}-trigger`;
  const labelId = `${generatedId}-label`;
  const panelId = `${generatedId}-panel`;

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // 접혀 있을 때는 아무것도 듣지 않는다. 한 화면에 이 칸이 다섯까지 서므로
    // ([전체 A/S 현황] — 기타건 현황은 둘), 늘 듣고 있으면 누를 때마다 하는 일이
    // 그만큼 는다.
    if (!isOpen) return;

    return watchDropdownDismiss(document, {
      // node 가 아닌 것(창 자체 같은)이 오면 contains 가 던진다 — 그런 것은
      // 어차피 이 칸 안이 아니므로 「바깥」으로 친다.
      contains: (node) => node instanceof Node && containerRef.current?.contains(node) === true,
      dismiss: (reason) => {
        setIsOpen(false);
        // 🔴 Esc 일 때만 초점을 단추로 돌려준다. 키보드로 목록을 훑다 Esc 를
        //    누른 사람은 초점이 문서 맨 앞으로 튀면 처음부터 Tab 을 다시 쳐야
        //    한다. 바깥을 눌러 접을 때 돌려주면 반대로 방금 누른 칸에서 초점을
        //    빼앗는다.
        if (reason === "escape") triggerRef.current?.focus();
      },
    });
  }, [isOpen]);

  const summary = selectionSummary(options, selected, emptyLabel);

  return (
    <div className="flex flex-col gap-1">
      {/* <label htmlFor> 이 아니라 <span> 이다 — 가리키는 곳이 입력칸이 아니라
          단추라, label 을 누르면 단추가 눌려 목록이 펼쳐졌다 접힌다. 대신
          aria-labelledby 로 단추와 목록에 이름을 붙인다. */}
      <span id={labelId} className={labelClass}>
        {label}
      </span>

      <div ref={containerRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          id={triggerId}
          className={triggerClass}
          aria-expanded={isOpen}
          aria-haspopup="true"
          // 접혀 있으면 가리킬 마디가 없다 — 없는 id 를 가리키면 읽어 주는
          // 프로그램이 "없는 것을 연다"고 말한다.
          aria-controls={isOpen ? panelId : undefined}
          aria-labelledby={`${labelId} ${triggerId}`}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <span className="min-w-0 truncate">{summary}</span>
          <span aria-hidden="true" className="shrink-0 text-zinc-400 dark:text-zinc-500">
            ▾
          </span>
        </button>

        {isOpen && (
          <CheckboxFilterPanel
            panelId={panelId}
            labelId={labelId}
            options={options}
            selected={selected}
            onChange={onChange}
            shortcut={shortcut}
          />
        )}
      </div>
    </div>
  );
}
