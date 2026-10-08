import { formatBytes } from "./image-shrink";

/**
 * ============================================================================
 * 공유폴더 목록 한 줄을 **표로** — 이름 · 수정날짜 · 크기 · 동작 (2026-10-08)
 * ============================================================================
 * 「공유폴더 창에서 수정 날짜가 나오고 있는데 그걸 **별도의 열**로 해서 보여줘」 →
 * 화면을 보고 다시 「**표 중앙에 수정날짜 열을 따로** 만들어줘」(사용자 요구 2026-10-08).
 *
 * 그 창은 **넷**이고, 넷 다 제 손으로 날짜를 꾸며 `크기 · 수정시각` 한 덩어리로 이어
 * 붙이고 있었다:
 *  · 수리건 파일관리의 「공유폴더」  — components/repair-cases/files/ContactFolderSection.tsx
 *  · 제품 종류 「공유폴더에서 고르기」 — components/product-models/KindShareFolderPicker.tsx
 *  · 제품 모델 「공유폴더에서 고르기」 — components/product-models/ModelShareFolderPicker.tsx
 *  · 견적서 폴더                     — components/quotes/QuoteArchiveFolderSection.tsx
 * 🔴 **넷이 이 한 벌을 쓴다.** 날짜 모양도 열 폭도 넷이 따로 들고 있으면 한 곳만 고쳐지고,
 * 같은 공유폴더를 보는데 창마다 다르게 보인다. 2026-10-08 의 **거르기**
 * (share-folder-entry-filter.ts)를 공용으로 뽑은 것과 같은 결이다.
 *
 * ── 🔴 열 차례는 **윈도우 탐색기와 같게** ───────────────────────────────
 * `[이름] [수정날짜] [크기] [동작]`. 탐색기가 이름 다음에 수정한 날짜를 두고, 사용자가
 * 「표 **중앙에** 수정날짜」라고 했다. 예전의 `크기 → 수정시각` 차례와 **자리를 맞바꿨다.**
 *
 * ── 🔴 왜 flex 가 아니라 **grid** 인가 ──────────────────────────────────
 * 예전에는 `[이름] … [크기 수정시각 단추]` 를 오른쪽 끝에 몰아 두었다. 그래서 **줄마다
 * 구성이 다르면 자리가 어긋났다** — [열기] 단추가 있는 파일 줄은 단추 너비만큼 왼쪽으로
 * 밀려, 단추가 없는 폴더 줄과 날짜·크기가 한 줄로 서지 않았다.
 * 이제 1fr 은 **이름 하나뿐**이고 나머지 세 칸은 **고정 길이**다. 그래서 줄에 무엇이
 * 들었든 날짜·크기·동작 칸의 자리가 **모든 줄에서 똑같다.**
 *  · 🔴 **동작 칸은 비어도 그린다** — 단추가 없는 줄에서 칸을 빼면 그 줄만 어긋난다.
 *  · 🔴 [열기]의 결과 안내는 **동작 칸 안에서 아래로 자란다** — 줄 높이만 늘고 칸 폭은
 *    고정 길이라 **열이 밀리지 않는다.**
 *
 * ── 🔴 좁은 화면에서는 **예전처럼 접힌다** ──────────────────────────────
 * `sm`(640px) 아래에서는 grid 가 아니라 예전의 `flex flex-wrap` 그대로다 — 이름이 자리를
 * 다 쓰고(`flex-1`), 곁말과 단추가 모자라면 아랫줄로 접힌다. 좁은 화면에서 고정 길이 네
 * 칸을 세우면 이름 칸이 몇 글자로 눌린다.
 *
 * ── 🔴 수정시각이 없는 줄도 있다 ────────────────────────────────────────
 * 서버가 수정시각을 못 읽으면 칸이 통째로 없다(`modifiedAt` 이 `undefined`). 그때
 * `modifiedText` 는 **빈 글자**다 — 화면은 그 줄에도 **칸은 그대로 그리고 글자만 비운다.**
 *
 * ── 🔴 「폴더」 글자는 **공용이 아니다** ────────────────────────────────
 * 폴더 줄이 크기 자리에 무엇이라고 적는지는 **창마다 제 상수**다(네 창이 저마다
 * `…_FOLDER_LABEL` 을 들고 있다 — 창마다 말이 달라질 수 있다). 그래서 이 함수는 그 글자를
 * **받는다.** 여기서 모으는 것은 **짜임과 날짜 모양과 열 폭**이지 낱말이 아니다.
 *
 * ── 🔴 날짜 글자 모양을 바꾸지 않았다 ───────────────────────────────────
 * `toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })` — 네 창이 쓰던
 * 그대로다. 못 읽는 값(`NaN`)이면 **받은 글자를 그대로** 돌려주는 것도 그대로다.
 *
 * 🔴 순수하다 — fs · 통로 · 서버 · DB 가 한 글자도 없다.
 * ============================================================================
 */

/** 한 줄에서 곁말을 만드는 데 필요한 것만. 네 창의 줄 타입이 모두 이 모양을 갖추고 있다. */
export type ShareFolderEntryMetaSource = {
  isDirectory: boolean;
  sizeBytes: number;
  /** 수정 시각(ISO). 서버가 못 읽었으면 칸이 통째로 없다. */
  modifiedAt?: string;
};

/** 🔴 **두 조각**이다 — 이어 붙이는 일은 더 하지 않는다. */
export type ShareFolderEntryMeta = {
  /** 크기 칸 — 파일이면 크기, 폴더면 부르는 쪽이 준 「폴더」 글자. 늘 글자가 있다. */
  sizeText: string;
  /** 🔴 수정날짜 칸 — **없으면 빈 글자**다(칸은 화면이 그대로 둔다). */
  modifiedText: string;
};

// ── 🔴 표의 생김새 — **네 창이 같은 한 벌을 쓴다** ───────────────────────
//
// 열 폭을 여기 한 곳에 둔다. 창마다 적으면 한 창만 넓어져 같은 공유폴더가 창마다 다르게
// 보인다. 🔴 폭은 **칸이 아니라 줄(grid-cols)** 이 쥔다 — 칸에 폭을 걸면 좁은 화면의
// 접히는 배치에서도 그 폭이 따라와 이름 칸을 눌러 버린다.
//
// 🔴 Tailwind 는 **글자 그대로** 긁는다 — 아래 클래스를 쪼개 이어 붙이면 그 클래스는
// 빌드 결과에 없다(customer-row-color.ts 머리말의 같은 까닭). 통째로 적는다.

/**
 * 줄 하나. 🔴 **1fr 은 이름 하나뿐**이고 수정날짜(10rem) · 크기(5rem) · 동작(9rem)은
 * 고정 길이다 — 그래서 줄에 단추가 있든 없든 세 칸의 자리가 **모든 줄에서 같다.**
 *  · 수정날짜 `10rem`(160px) — 가장 긴 「2026. 12. 28. 오후 12:34」(≈140px)가 넉넉히 든다
 *  · 크기 `5rem`(80px) — 가장 긴 「1234.56 MB」(≈70px)가 든다
 *  · 동작 `9rem`(144px) — 고르는 창의 [열기]+[담기] 둘(≈127px)이 한 줄에 들어간다.
 *    더 길어지면(「여는 중…」) 칸 **안에서** 접힐 뿐 열은 밀리지 않는다.
 * 🔴 `sm` 아래에서는 grid 가 아니라 예전의 접히는 배치 그대로다.
 */
export const SHARE_FOLDER_ENTRY_ROW_CLASS =
  "flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 sm:grid sm:grid-cols-[minmax(0,1fr)_10rem_5rem_9rem]";

/**
 * 이름 칸에 **더 붙이는** 것. 🔴 좁은 화면(접히는 배치)에서 이름이 남은 자리를 다 쓰게
 * 한다 — grid 에서는 `minmax(0,1fr)` 이 그 일을 하므로 아무 일도 하지 않는다.
 * 창마다 제 글씨·색을 들고 있으므로 **글씨까지 모으지는 않는다.**
 */
export const SHARE_FOLDER_ENTRY_NAME_GROW_CLASS = "flex-1";

/**
 * 🔴 수정날짜 칸 — **왼쪽 맞춤**. 줄마다 날짜가 **같은 자리에서 시작한다**(이번 요구의
 * 알맹이). 오른쪽 맞춤으로 하면 「2026. 1. 2.」와 「2026. 12. 28.」의 시작이 어긋난다.
 * 🔴 못 읽는 값이 그대로 나오는 길이 있어 `break-all` 을 함께 둔다 — 긴 날것이 와도 칸
 * 밖으로 삐져나가 옆 칸을 덮지 않는다.
 */
export const SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS =
  "min-w-0 break-all text-left text-xs tabular-nums text-zinc-500 dark:text-zinc-400";

/** 크기 칸 — 오른쪽 맞춤이라 「512 B」와 「12.34 MB」의 **끝자리**가 맞는다. */
export const SHARE_FOLDER_ENTRY_META_SIZE_CLASS =
  "min-w-0 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400";

/**
 * 🔴 동작 칸 — 단추가 **하나도 없어도 그린다.** 빼면 그 줄만 열이 어긋난다.
 * `min-w-0` 과 `flex-wrap` 이 있어 안의 것이 칸보다 길어지면(두 단추 · [열기]의 결과
 * 안내) **칸 안에서 접히고 아래로 자란다** — 줄 높이만 늘고 **열은 밀리지 않는다.**
 */
export const SHARE_FOLDER_ENTRY_ACTIONS_CLASS = "flex min-w-0 flex-wrap items-baseline justify-end gap-2";

/**
 * 수정시각 한 줄. 🔴 **못 읽는 값이면 받은 글자를 그대로** 돌려준다 — 날짜가 아닌 것이
 * 와도 줄이 비어 보이지 않게(네 창이 쓰던 동작 그대로다).
 */
export function formatShareFolderEntryModifiedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * 한 줄의 곁말 **두 조각**. `folderLabel` 은 폴더 줄이 크기 자리에 적을 글자 —
 * 🔴 **창마다 제 상수를 준다**(여기서 낱말을 정하지 않는다).
 */
export function shareFolderEntryMeta(
  entry: ShareFolderEntryMetaSource,
  folderLabel: string
): ShareFolderEntryMeta {
  return {
    sizeText: entry.isDirectory ? folderLabel : formatBytes(entry.sizeBytes),
    modifiedText: entry.modifiedAt === undefined ? "" : formatShareFolderEntryModifiedAt(entry.modifiedAt),
  };
}
