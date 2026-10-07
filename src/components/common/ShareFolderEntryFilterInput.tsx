"use client";

/**
 * ============================================================================
 * 「공유폴더에서 고르기」 창의 **거르기 칸** — 공용 조각 (2026-10-08)
 * ============================================================================
 * 「[공유폴더에서 고르기]창을 가진 모든 곳에 동일하게」(사용자 요구 2026-10-08).
 * 그 창은 둘이다 — 제품 **종류**별 공통 서류와 제품 **상세**. 🔴 **둘이 이 한 조각을
 * 가져다 쓴다.** 베껴서 두 벌을 두면 한쪽만 고쳐져 두 창의 생김새와 말이 갈라진다.
 * (Picker 자체는 합치지 않는다 — 통로도 권한도 주인도 다르다. 공용은 **거르기만**이다.)
 *
 * 🔴 **값을 제 안에 쥐지 않는다.** 받은 값을 그리고 바뀐 글자를 올려 보낼 뿐이다 —
 * 자리를 옮길 때 칸을 비우는 일은 부르는 쪽이 shareFolderEntryPlaceAt 으로 한다.
 *
 * 🔴 **인쇄에 안 찍힌다**: 두 창 모두 바깥 틀에 print:hidden 이 걸려 있다.
 * 견주는 규칙은 여기 없다 — lib/domain/share-folder-entry-filter.ts 한 자리뿐이다.
 * ============================================================================
 */

export const SHARE_FOLDER_ENTRY_FILTER_LABEL = "이름으로 거르기";
export const SHARE_FOLDER_ENTRY_FILTER_PLACEHOLDER = "폴더·파일 이름의 일부";

/** 🔴 거른 결과가 0건일 때 — 목록을 그냥 비워 두지 않는다(「고장났나」를 부른다). */
export const SHARE_FOLDER_ENTRY_FILTER_EMPTY_TEXT = "맞는 이름이 없습니다 — 거르는 글자를 지우거나 바꿔 보세요.";

/**
 * 🔴 **잘린 목록을 거를 때의 곁말.** 거르기 전의 곁말(「앞의 N개만 보입니다 — 더
 * 있습니다…」)을 **없애지 않고 말만 바꾼다**: 거르는 중에도 「더 있습니다」가 그대로
 * 보여야 한다. 안 그러면 사람이 「없네」로 잘못 결론 내는데, 실제로는 상한(줄 수 200)
 * **뒤에** 있는 것이다.
 *
 * `loaded` 는 **받아 둔 줄 수**다 — 거른 뒤의 수가 아니다. 거르기는 받아 둔 그 N 개
 * 안에서만 일어난다는 사실이 이 문장의 전부다.
 */
export function shareFolderEntryFilteredTruncatedText(loaded: number, totalCount: number): string {
  return `앞의 ${loaded}개 안에서만 찾았습니다 — 더 있습니다(전체 ${totalCount}개). 하위 폴더로 들어가 좁혀 보세요.`;
}

/**
 * 거르기 칸 하나. 🔴 자리는 **길 표시 아래, 목록 위**다(두 창 모두).
 */
export default function ShareFolderEntryFilterInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label
      data-share-folder-entry-filter=""
      className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400"
    >
      <span className="shrink-0">{SHARE_FOLDER_ENTRY_FILTER_LABEL}</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={SHARE_FOLDER_ENTRY_FILTER_PLACEHOLDER}
        data-share-folder-entry-filter-input=""
        className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-700 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder:text-zinc-500"
      />
    </label>
  );
}
