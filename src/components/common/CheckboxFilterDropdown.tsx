"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  DEFAULT_EMPTY_LABEL,
  isShortcutActive,
  orderSelection,
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
 * ── 🔴 **아홉 칸이 이것을 쓴다** ───────────────────────────────────────────
 * [전체 A/S 현황]의 다섯(현재 상태·제품군·유·무상·고객사·우선순위)과 [기타건
 * 현황]의 둘(상태·공급처)이다 — 2026-11-11 에 일곱이 다 옮겨 왔다. 2026-11-18 에
 * [내자 정리]의 둘(상태·고객사)이 더해져 아홉이다. 그래서
 *   · 값의 종류를 T 로 열어 두고(코드 문자열이면 무엇이든),
 *   · 단축 단추(shortcut)는 **없어도 그려지게** 했다 — 아홉 중 여덟은 없다.
 * 이 파일에 [현재 상태]만 아는 것(상태 코드·「입고품 전체」)을 적지 않는다.
 *
 * 🔴 **이름표 자리는 두 모양이고, 기본이 예전 모양이다**(labelPlacement). 필터
 * 카드의 격자에 줄지어 서는 일곱은 이름이 칸 **위**(기본)이고, 이름이 옆에 붙은
 * 조작들과 한 줄에 나란히 서는 [내자 정리]의 둘만 **옆**을 넘긴다. 사본을 하나 더
 * 만들지 않은 까닭은 타입이 같아 둘이 갈라져도 tsc 가 영영 침묵하기 때문이다.
 *
 * 🔴 **고르는 방식도 두 가지이고, 기본이 「여럿」이다**(selectionMode, 2026-11-19).
 * 이 부품은 이름 그대로 복수 선택으로 태어났고 아홉 중 **여덟이 그 모양 그대로**다 —
 * 단독 선택으로 갈라진 것은 [내자 정리]의 [상태] 한 칸뿐이다(사용자 결정). 다른 것은
 * **펼친 목록 안**뿐이다: 체크 대신 동그라미가 서고, 맨 위에 「전체」 한 줄이 더 선다.
 * 여는 단추 · 닫힌 칸의 글자 · 접는 길 · 폭 맞춤은 둘이 **같은 코드**를 지난다.
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
  /**
   * 칸 이름. 칸 위(기본) 또는 옆(labelPlacement="inline")에 적히고, 펼친 목록의
   * 이름표도 된다(예: 「현재 상태」).
   */
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
   * 칸 이름을 **어디에 두는가**(2026-11-18 사용자 결정 — 「전부 옆으로」).
   *
   * 🔴 **기본은 `"top"`(칸 위)이고, 그것이 이 부품이 처음부터 하던 모양이다.** 이
   * 값을 안 넘기면 먼저 쓰고 있던 일곱 칸([전체 A/S 현황]의 다섯 · [기타건 현황]의
   * 둘)은 한 픽셀도 바뀌지 않는다 — 그 일곱은 칸이 격자에 줄지어 서는 필터 카드
   * 안에 있어, 이름이 위에 있어야 칸들의 왼쪽 끝이 맞는다.
   *
   * `"inline"` 은 이름표를 칸 **옆**에 둔다. **이름이 옆에 붙은 조작들과 한 줄에
   * 나란히 서는 자리**를 위한 모양이다(내자 정리의 조작 줄 — 「검색」·「발주 년도」가
   * 그 모양이다). 거기서는 위에 적힌 이름 하나가 그 칸만 한 줄치 높여 줄이
   * 들쭉날쭉해지고, 이 화면은 위가 쓰고 남은 높이를 표가 받는 구조라 그 높이가
   * 그대로 표에서 빠진다.
   *
   * 🔵 모양만 가른다 — 고르는 규칙도, 닫힌 칸의 글자도, 접는 길도 둘이 같다.
   */
  labelPlacement?: "top" | "inline";
  /**
   * **몇 개를 고를 수 있는가**(2026-11-19 사용자 결정 — 「[내자정리]의 [상태]필터를
   * 복수 선택이 아니라 단독선택으로 바꿔주고 … 브라우저 기본 드롭다운이 아니라
   * 복수선택 드롭다운처럼 자체적으로 만든 드롭다운 형식을 사용해줘」).
   *
   * 🔴 **기본은 `"multi"`(여럿)이고, 그것이 이 부품이 처음부터 하던 일이다.** 이 값을
   * 안 넘기는 여덟 칸([전체 A/S 현황]의 다섯 · [기타건 현황]의 둘 · [내자 정리]의
   * **고객사**)은 한 픽셀도 바뀌지 않는다. 사본을 하나 더 만들지 않은 까닭은
   * labelPlacement 와 같다 — 여는 단추 · 바깥 누르기로 접기 · 폭 맞춤 · 닫힌 칸의
   * 글자가 두 벌이 되면 나중에 한쪽만 고쳐진다.
   *
   * `"single"` 에서 달라지는 것은 **펼친 목록 안**뿐이다:
   *  · 체크 대신 **동그라미**(라디오)를 그린다.
   *  · 목록 **맨 위에 「전체」 한 줄**이 선다 — 누르면 빈 배열이 넘어간다.
   *  · 🔴 **이미 고른 줄을 다시 누르면 꺼진다**(빈 배열). 라디오의 기본 동작이
   *    아니라 이 부품이 따로 적은 규칙이다 — 사용자가 되돌아가는 길을 **둘 다**
   *    쓰겠다고 했다(「전체」 항목과 다시 누르기).
   *
   * 🔴 **넘어가는 값은 여전히 배열**이다(길이 0 또는 1). 부름받는 쪽의 타입을 가르지
   * 않은 까닭: 그래야 거르개 함수도 화면 상태도 지금 모양 그대로 남고, 어느 날
   * 복수 선택으로 되돌리더라도 이 prop 한 줄만 빼면 끝난다.
   *
   * 🔴 **`shortcut` 은 `"single"` 에서 그리지 않는다.** 여럿을 한 번에 채우는 장치라
   * 한 개만 고르는 칸에서는 누를 뜻이 없다(지금 그 단추를 쓰는 칸은 [전체 A/S 현황]의
   * [현재 상태] 하나이고 그 칸은 `"multi"` 다). 🔴 **조용히 무시하는 것이 아니라
   * 일부러 안 그리는 것**이고, 그래서 이 줄을 여기 적어 둔다 — 안 적으면 다음 사람이
   * 단축 단추가 사라진 것을 고장으로 읽는다.
   */
  selectionMode?: "multi" | "single";
  /**
   * 여는 단추의 id. 안 주면 React 가 짓는다 — 화면에서 이 칸을 집어 가리킬 일이
   * 있는 자리만 적어 준다(지금은 아홉 칸이 모두 적어 준다: 시험이 「어느 칸이
   * 복수 선택인가」를 이 id 로 집는다).
   */
  id?: string;
};

const triggerClass =
  "flex w-full items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-left text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";
/**
 * 이름표를 칸 **옆**에 둘 때의 모양(labelPlacement="inline").
 *
 * 글자를 위(text-xs · zinc-500)보다 크고 진하게 적는 것은 **옆에 서는 이름표는
 * 칸의 일부처럼 읽히기 때문**이다 — 내자 정리의 조작 줄에서 이 칸은 「검색」·
 * 「발주 년도」 <label> 과 나란히 서므로, 그 둘과 같은 크기·같은 색이라야 넷이 한
 * 종류의 조작으로 보인다(그 화면의 label className 과 같은 글자다).
 *
 * shrink-0 은 줄이 좁아질 때 **이름표 대신 칸이 줄어들게** 한다. 없으면 「고객사」가
 * 「고객…」으로 잘려, 무슨 필터인지 닫힌 채로는 알 수 없게 된다.
 */
const inlineLabelClass = "shrink-0 text-sm font-medium text-zinc-700 dark:text-zinc-300";

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
 * 펼친 목록의 **한 줄**. 체크박스(multi)와 동그라미(single)가 같은 모양으로 서야
 * 해서 class 를 한 곳에 둔다 — 한 칸이 두 방식을 오가는 일은 없지만, 줄 모양이 두
 * 벌이 되면 나중에 한쪽만 고쳐진다(이 파일이 사본을 안 만드는 것과 같은 까닭).
 */
const optionRowClass =
  "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800";

/**
 * ============================================================================
 * 🔴 동그라미(단독 선택)가 `onChange` 가 아니라 `onClick` 을 쓰는 까닭 (2026-11-19)
 * ============================================================================
 * 라디오는 **이미 켜진 것을 다시 눌러도 `change` 가 나지 않는다** — 값이 안 바뀌기
 * 때문이다. 그런데 이 부품에서는 바로 그 누르기가 「전체로 되돌리기」다(사용자 결정 —
 * 되돌아가는 길을 「맨 위의 전체」와 「다시 누르기」 둘 다 둔다). 그래서 켜는 일과
 * 끄는 일을 **전부 `click` 으로** 받는다.
 *
 * 🔵 체크박스 쪽이 `onChange` 로 받는 것과 **같은 사건**이다(라디오·체크박스의
 * change 는 click 위에서 난다). 그러니 「굴리려고 짚은 손가락에 체크가 뒤집힌다」는
 * pointerdown 의 함정은 여기에도 없다 — 바깥 누르기만 pointerdown 으로 듣는다.
 *
 * 🔴 `readOnly` 는 **동작을 막는 표시가 아니다.** `checked` 만 주고 `onChange` 를 안
 * 주면 React 가 「controlled 인데 바꿀 길이 없다」고 콘솔에 경고하는데, 그 경고를 끄는
 * 표시가 그것이다. 라디오·체크박스에 readonly 는 브라우저가 따르지 않으므로 누르기는
 * 그대로 간다. 빈 `onChange={() => {}}` 를 대신 적지 않은 까닭은 아무 일도 안 하는
 * 손잡이가 보이면 다음 사람이 그쪽에 코드를 더하기 때문이다.
 *
 * 🔴 라디오의 `name` 은 **이 칸 하나 안에서만** 묶여야 한다. 한 화면에 단독 선택 칸이
 * 둘 서는 날, 이름이 겹치면 한쪽을 고르는 순간 다른 칸의 동그라미가 꺼진다 — 브라우저가
 * 같은 이름을 한 묶음으로 보기 때문이고, 오류 없이 화면에서만 드러난다. panelId 는
 * useId 로 지어져 칸마다 다르므로 그것을 그대로 쓴다.
 * ============================================================================
 */
const radioGroupName = (panelId: string) => `${panelId}-option`;

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
  selectionMode = "multi",
  emptyLabel = DEFAULT_EMPTY_LABEL,
}: {
  panelId: string;
  labelId: string;
  options: readonly CheckboxFilterOption<T>[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
  shortcut?: CheckboxFilterShortcut<T>;
  /** 기본은 `"multi"` — 안 넘기는 여덟 칸이 기대고 있는 값이다(prop 쪽 주석). */
  selectionMode?: "multi" | "single";
  /**
   * `"single"` 에서 **맨 위 한 줄에 적히는 글자**. 닫힌 칸이 아무것도 안 골랐을 때
   * 적는 그 글자와 **같아야** 해서 바깥에서 받는다 — 여기서 "전체"를 따로 박아 두면,
   * emptyLabel 을 바꾼 칸에서 닫힌 칸과 목록 맨 줄이 서로 다른 말을 한다.
   */
  emptyLabel?: string;
}) {
  const isSingle = selectionMode === "single";
  const pickedValues = new Set<T>(selected);
  // 🔴 「눌렀는가」가 아니라 **「지금 고른 것이 그 묶음인가」**다. 손으로 하나씩
  //    체크해 같은 묶음을 만든 사람도 눌린 모습을 봐야 한다(값 쪽 파일의 주석).
  const shortcutPressed = shortcut ? isShortcutActive(shortcut.values, selected) : false;
  /**
   * 🔴 **단독 선택인데 `selected` 에 값이 둘 이상 들어왔을 때 무엇을 켜 보일 것인가**
   * — **선택지에 적힌 차례의 첫 값**이고, 나머지는 안 그린다(orderSelection).
   *
   * 아무 말도 안 하면 다음 사람이 깨진 화면을 보므로 여기서 정한다. 첫 값을 고른
   * 까닭은 **닫힌 칸이 말하는 그 이름**이기 때문이다 — 닫힌 칸의 글자도 같은
   * orderSelection 을 지나(selectionSummary → selectionLabels) 맨 앞 이름을 적는다.
   * 둘이 어긋나면 칸에는 「완료됨」이라고 적혀 있는데 목록에서는 「미완료」에 동그라미가
   * 켜져 있는 모습이 된다.
   *
   * 🔵 선택지에 **없는** 값 하나만 들어온 경우에는 어느 줄에도 동그라미가 안 켜지고
   * 「전체」도 안 켜진다(고른 것이 있으므로). 그 값은 닫힌 칸에 코드 그대로 적히고
   * 「전체」를 눌러 풀 수 있다 — 복수 선택이 「모르는 값을 버리지 않는다」로 푼 그
   * 문제와 같은 자리다(checkbox-filter-dropdown.ts 의 orderSelection).
   */
  const singlePicked = isSingle ? orderSelection(options, selected)[0] : undefined;

  return (
    // 🔴 자리를 차지하지 않고 **떠 있어야** 한다. 흐름에 끼면 펼칠 때마다 격자
    //    한 칸이 세로로 늘어 옆 칸들이 밀려 내려간다.
    <div
      id={panelId}
      // 🔴 동그라미 목록은 role 이 다르다 — 「여럿 고를 수 있는 묶음」으로 전해지면
      //    읽어 주는 프로그램을 쓰는 사람이 둘을 켜려고 시도한다.
      role={isSingle ? "radiogroup" : "group"}
      aria-labelledby={labelId}
      className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      {/* 🔴 단축 단추는 **있을 수도 없을 수도** 있다. 없으면 목록만 그린다 —
          이 부품을 쓰는 아홉 칸 가운데 여덟은 단축 단추가 없다(있는 것은 [전체
          A/S 현황]의 [현재 상태] 하나다).
          🔴 단독 선택에서는 **넘어와도 안 그린다**(prop 쪽 주석) — 여럿을 한 번에
          채우는 장치라 한 개만 고르는 칸에서는 누를 뜻이 없다. */}
      {shortcut && !isSingle && (
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
        {/* 🔴 「전체」로 되돌아가는 길 **(가)** — 단독 선택에서만 선다(2026-11-19
            사용자 결정: 되돌아가는 길을 (가) 맨 위의 「전체」 항목과 (나) 고른 것을
            다시 누르기, **둘 다** 쓸 수 있게).

            목록 **안**에 두는 까닭: 이것은 단추가 아니라 **항목 하나**다. 단축 단추처럼
            목록 밖(줄 위)에 두면 동그라미 줄들과 왼쪽 끝이 어긋나 다른 종류의 조작으로
            보이고, 아무것도 안 골랐을 때 「무엇이 켜져 있는가」가 화면에서 사라진다.

            적는 글자는 닫힌 칸이 쓰는 그 글자다(emptyLabel) — 둘이 갈라지면 같은 상태를
            두 말로 부르게 된다. */}
        {isSingle && (
          <label className={optionRowClass}>
            <input
              type="radio"
              name={radioGroupName(panelId)}
              className="shrink-0"
              // 🔴 **아무것도 안 골랐을 때 이것이 켜져 있어야** 한다 — 동그라미가 하나도
              //    없는 목록은 「아직 아무 일도 안 일어난 칸」으로 읽히지 않는다.
              checked={selected.length === 0}
              readOnly
              onClick={() => onChange([])}
            />
            <span className="min-w-0 break-words">{emptyLabel}</span>
          </label>
        )}

        {options.map((option) => (
          <label key={option.value} className={optionRowClass}>
            {/* 고르는 것은 `click`(체크박스의 onChange · 동그라미의 onClick)으로 받는다
                — 바깥 누르기만 pointerdown 이다. 여기서 pointerdown 으로 고르면 목록을
                굴리려고 짚은 손가락에 체크가 뒤집힌다. */}
            {isSingle ? (
              <input
                type="radio"
                name={radioGroupName(panelId)}
                className="shrink-0"
                checked={singlePicked === option.value}
                readOnly
                // 🔴 **이미 고른 줄을 다시 누르면 꺼진다** — 길 (나). 라디오가 거저 주는
                //    동작이 아니라 여기 적힌 규칙이고, 지우면 「전체」 한 줄만 남는다.
                onClick={() => onChange(singlePicked === option.value ? [] : [option.value])}
              />
            ) : (
              <input
                type="checkbox"
                className="shrink-0"
                checked={pickedValues.has(option.value)}
                onChange={() => onChange(toggleSelection(options, selected, option.value))}
              />
            )}
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
  labelPlacement = "top",
  selectionMode = "multi",
}: CheckboxFilterDropdownProps<T>) {
  const isInlineLabel = labelPlacement === "inline";
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
    // 🔴 **두 모양의 차이는 이 한 줄과 아래 두 줄뿐이다.** 위(기본)는 세로로
    //    쌓고, 옆(inline)은 가로로 세운다 — 가지를 늘리지 않는 것은 이 칸을
    //    아홉 자리가 함께 쓰기 때문이다(한쪽만 고쳐지는 일이 없어야 한다).
    <div className={isInlineLabel ? "flex items-center gap-2" : "flex flex-col gap-1"}>
      {/* <label htmlFor> 이 아니라 <span> 이다 — 가리키는 곳이 입력칸이 아니라
          단추라, label 을 누르면 단추가 눌려 목록이 펼쳐졌다 접힌다. 대신
          aria-labelledby 로 단추와 목록에 이름을 붙인다. */}
      <span id={labelId} className={isInlineLabel ? inlineLabelClass : labelClass}>
        {label}
      </span>

      {/* 🔴 펼친 목록이 기대는 `relative` 는 **이름표를 뺀 칸만** 덮는다 — 목록은
          이 상자에 left-0 right-0 으로 붙으므로(CheckboxFilterPanel), 이름표까지
          덮으면 목록이 이름표 아래에서 시작해 칸과 어긋난다.
          옆 모양에서 flex-1 min-w-0 을 주는 까닭: flex 칸의 기본값은 min-width:auto
          라 닫힌 칸의 글자가 길면(「완료됨 외 1개」) 칸이 안 줄어들고 이름표를
          밀어낸다. 줄어들어야 truncate 가 일한다. */}
      <div
        ref={containerRef}
        className={isInlineLabel ? "relative min-w-0 flex-1" : "relative"}
      >
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
            selectionMode={selectionMode}
            // 🔵 닫힌 칸(summary)과 단독 선택 목록 맨 위의 「전체」가 **같은 글자**를
            //    적어야 해서 같은 값을 둘 다에 넘긴다. 안 넘어온 경우의 기본값은
            //    양쪽이 같은 상수(DEFAULT_EMPTY_LABEL)에서 받는다.
            emptyLabel={emptyLabel}
          />
        )}
      </div>
    </div>
  );
}
