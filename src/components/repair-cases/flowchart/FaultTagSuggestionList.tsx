"use client";

/**
 * ============================================================================
 * 고장 개소 칸 밑에 뜨는 **후보 목록** (2026-11-19 사용자 요청)
 * ============================================================================
 * 사용자가 말한 것 — 「태그 목록은 부품요청에서 부품을 검색할 때 처럼 만들어줘.」
 * 그래서 본보기는 **부품 고르개**다(vendor/dss-core 의 ui/inventory/part-picker.tsx 의
 * `PartSuggestionList`, 쓰는 쪽은 repair-cases/detail/edit/UsedPartsEditForm.tsx).
 *
 * ── 🔴 왜 그 부품을 그대로 쓰지 않았는가 ───────────────────────────────────
 * `PartSuggestionList` 는 **부품 줄에 묶여 있다**. 받는 것이 `PartPickerRow`(id · 품명 ·
 * 품명2 · 고객사 품명 · 도번 · 교산 품번)이고, 그리는 것도 「고객사 품명 줄 + 품명 +
 * 꼬리표」이며, 고를 수 있는지까지 `canPickPartOption`(고객사 품명이 비면 막는다)이
 * 정한다. 고장 개소는 **글자 하나**라 그 줄을 채우려면 없는 품명·도번을 지어내야 하고,
 * 그러면 「부품이 아닌 것이 부품 줄 모양으로」 흘러 다닌다.
 * 🔴 그 파일을 글자 목록도 받게 고치는 길은 **닫혀 있다** — 서브모듈이고 재고·견적·수리
 * 건이 함께 쓴다(그 파일 머리말). 그래서 **같은 방식·같은 모양**으로 여기 하나를 뒀다.
 *
 * ── 🔴 본보기에서 그대로 가져온 것 ─────────────────────────────────────────
 *  · `onMouseDown` 에서 기본 동작을 막는다 — 막지 않으면 후보를 누르는 순간 입력 칸이
 *    먼저 포커스를 잃어(onBlur) 목록이 닫히고, `onClick` 이 닿을 곳이 없어진다.
 *    **「눌리지 않는 목록」이 되는 흔한 함정**이라 본보기도 여기에 🔴 를 달아 두었다.
 *  · 후보가 없으면 **아무것도 그리지 않는다**(빈 상자가 칸 밑에 뜨지 않게).
 *  · 칸 바로 밑에 띄우는 `absolute` 상자 — 흐름 안에 두면 목록이 뜰 때마다 밑의 것들이
 *    밀려 내려가, 고르려던 자리가 눈앞에서 움직인다. 🔴 **부르는 쪽이 `relative` 를
 *    두르고 있어야 한다.**
 *  · 상자 글자(테두리 · 그림자 · `max-h-48` 스크롤 · 줄 사이 옅은 선)도 그대로다 —
 *    같은 시스템에서 같은 동작이면 같아 보여야 한다.
 *
 * ── 🔵 여기만 다른 것 ───────────────────────────────────────────────────────
 * 줄에 **글자 하나**만 그린다. 부품은 같은 이름이 여럿이라 꼬리표(도번·품번)로 갈라야
 * 하지만, 고장 개소는 글자 그 자체가 값이라 갈릴 것이 없다.
 * ============================================================================
 */
export default function FaultTagSuggestionList({
  options,
  onPick,
  listLabel,
}: {
  /** 이미 좁혀진 후보 — 거르는 일은 validation/repair-case-flowchart-input.ts 가 한다(이 조각은 그리기만). */
  options: readonly string[];
  onPick: (tag: string) => void;
  /** 읽는 장치에 들리는 이 목록의 이름 — 같은 화면에 다른 목록이 생겨도 갈린다. */
  listLabel: string;
}) {
  if (options.length === 0) return null;
  return (
    <ul
      aria-label={listLabel}
      className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      {options.map((tag) => (
        <li key={tag} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
          <button
            type="button"
            // 🔴 이 한 줄이 「눌리지 않는 목록」을 막는다(위 머리말).
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(tag)}
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {tag}
          </button>
        </li>
      ))}
    </ul>
  );
}
