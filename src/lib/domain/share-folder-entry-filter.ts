import { normalizeShareFolderNameForCompare } from "./share-folder-naming";

/**
 * ============================================================================
 * 「공유폴더에서 고르기」 창의 **이름으로 거르기** — 순수 함수 (2026-10-08)
 * ============================================================================
 * 「[공유폴더에서 고르기]창을 가진 모든 곳에 동일하게 폴더·파일 이름으로 거를 수 있게」
 * (사용자 요구 2026-10-08). 그 창은 둘이다 — 제품 **종류**별 공통 서류와 제품 **상세**.
 * 🔴 **두 창이 이 한 벌을 쓴다.** 베껴서 두 벌을 두면 한쪽만 고쳐지고, 같은 이름을 쳤는데
 * 두 창의 결과가 달라진다.
 *
 * ── 🔴 지금 보고 있는 칸만 거른다 ────────────────────────────────────────
 * 하위 폴더 **안까지 뒤지지 않는다**(사용자가 그렇게 정했다, 2026-10-08). 그래서 이 일은
 * 서버도 통로도 DB 도 건드리지 않는다 — **이미 받아 둔 줄**을 화면에서 걸러 낼 뿐이다.
 * 목록을 받아 오는 쪽의 상한 셋(기다리기 3000ms · 줄 수 200 · 깊이 6,
 * storage/repair-docs-entries.ts)은 이 모듈과 아무 상관이 없고 바뀌지도 않는다.
 *
 * ── 🔴 견주기를 **새로 만들지 않았다** ───────────────────────────────────
 * 이 저장소의 규칙은 「비교할 때만 다듬고, 경로를 이을 때는 디스크의 실제 이름을 쓴다」다
 * (share-folder-naming.ts 머리말). 그 규칙의 **비교 쪽**이
 * `normalizeShareFolderNameForCompare` 이고 — NFC + 연속 공백 하나 + 앞뒤 걷기 —
 * 여기서는 거기에 **대소문자 접기**만 한 겹 더한다. 로케일을 `en-US` 로 못 박는다:
 * 터키어 로케일에서 `i` 가 `İ` 가 되는 일이 없게(matchesShareFolderPrefix 와 같은 까닭).
 *
 * 🔴 **거르는 것은 보이는 몫뿐이다.** 담을 때 서버로 가는 값은 늘 디스크의 실제 이름이다 —
 * 다듬은 이름으로 경로를 이으면 없는 폴더가 된다.
 * ============================================================================
 */

/**
 * 견줄 모양으로 다듬는다 — 다듬기 + 대소문자 접기. 거르기 칸의 글자와 줄 이름을 **같은
 * 자리에서** 다듬는다(한쪽만 다듬으면 「Mb」로 `MB` 를 못 찾는다).
 */
export function normalizeShareFolderEntryQuery(value: string): string {
  if (typeof value !== "string") return "";
  return normalizeShareFolderNameForCompare(value).toLocaleUpperCase("en-US");
}

/**
 * 지금 **거르는 중인가**. 빈 칸과 공백뿐인 칸은 거르지 않는 것으로 본다 —
 * 곁말을 바꿀지(「앞의 N개 안에서만 찾았습니다」) 가르는 자리다.
 */
export function isShareFolderEntryQueryActive(query: string): boolean {
  return normalizeShareFolderEntryQuery(query) !== "";
}

/**
 * 이 이름이 걸리는가 — **부분 일치**(포함)다. 거르는 글자가 없으면 모두 걸린다.
 * 🔴 폴더인지 파일인지를 보지 않는다 — 이름만 본다. 그래서 둘 다 걸린다.
 */
export function matchesShareFolderEntryQuery(name: string, query: string): boolean {
  const needle = normalizeShareFolderEntryQuery(query);
  if (needle === "") return true;
  return normalizeShareFolderEntryQuery(name).includes(needle);
}

/**
 * 받아 둔 줄에서 걸리는 것만 남긴다. 차례는 그대로다 — 서버가 준 차례를 흔들지 않는다.
 * 거르는 글자가 없으면 **받은 배열을 그대로** 돌려준다(새 배열을 만들지 않는다).
 */
export function filterShareFolderEntriesByQuery<T extends { name: string }>(
  entries: readonly T[],
  query: string
): readonly T[] {
  const needle = normalizeShareFolderEntryQuery(query);
  if (needle === "") return entries;
  return entries.filter((entry) => normalizeShareFolderEntryQuery(entry.name).includes(needle));
}

/** 고르는 창이 지금 보고 있는 **자리** — 어느 폴더인가와, 그 안에서 거르는 글자. */
export type ShareFolderEntryPlace = {
  /** 공유폴더 루트 기준 상대 경로. 맨 위 칸이면 빈 문자열이다. */
  insidePath: string;
  /** 🔴 사람이 친 **날것**이다. 다듬기는 견줄 때만 한다(위 함수들). */
  filterQuery: string;
};

/** 창이 처음 뜨는 자리 — 맨 위 칸, 거르지 않는 상태. */
export const SHARE_FOLDER_ENTRY_PLACE_ROOT: ShareFolderEntryPlace = { insidePath: "", filterQuery: "" };

/**
 * 🔴 **자리를 옮기면 거르기 칸이 비워진다.** 폴더를 눌러 들어갈 때도, [위로] 할 때도,
 * 길 표시의 토막을 눌러 돌아갈 때도 이 함수 하나를 지난다 — 그래서 「한 길만 안 비워지는」
 * 일이 생기지 않는다.
 *
 * 안 비우면 새로 들어간 자리가 **텅 비어 보인다**: 지난 폴더에서 치던 글자가 그대로 남아
 * 아무것도 안 걸리는데, 사람은 「이 폴더가 비었나」로 잘못 읽는다.
 */
export function shareFolderEntryPlaceAt(insidePath: string): ShareFolderEntryPlace {
  return { insidePath, filterQuery: "" };
}
