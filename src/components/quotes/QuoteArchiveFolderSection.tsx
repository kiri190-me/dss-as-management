"use client";

import { useEffect, useState } from "react";

import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";
import ContactFolderPlaceOpenButton from "@/components/repair-cases/files/ContactFolderPlaceOpenButton";
import { formatBytes } from "@/lib/domain/image-shrink";
import { isOpenableQuoteFolderFileName } from "@/lib/domain/quote-folder-file-link";

/**
 * ============================================================================
 * **공유폴더 구역** — 그 견적서의 폴더 안에 무엇이 있는가 (2026-10-06)
 * ============================================================================
 * 견적서 하나당 사내 공유폴더에 폴더가 하나 있다(`연도 폴더/견적서 폴더`). 그 안에 무엇이
 * 들어 있는지 보려고 탐색기를 따로 열던 것을 그 자리에서 그대로 보여 준다. 수리 건
 * 「파일 관리」 탭의 연락서 폴더 구역
 * (components/repair-cases/files/ContactFolderSection.tsx)을 본떴다.
 *
 * ── 🔴 **서는 자리는 한 곳뿐이다** ───────────────────────────────────────
 * 수리 건 상세 「견적서」 탭 — 견적서 목록 **바로 아래**(사용자 결정 2026-10-06). 한 수리
 * 건에 견적서가 여러 장이라 **본 번호마다 한 구역**이 선다(폴더가 그 단위다 —
 * quote-archive-folder-groups.ts). 그래서 `label`(본 번호)을 머리에 적어 가른다.
 * 🔴 **견적서 편집 화면에는 세우지 않는다**(사용자 결정 2026-10-06 — 「견적서 수정에서는
 * 공유폴더가 보이지 않아도 돼」). 한때 편집 화면에도 세웠다가 걷어냈다 — 편집 화면 **머리의
 * 폴더 열기 단추는 그대로**이고, 걷어낸 것은 이 구역뿐이다. `label` 을 안 주면 머리가 그냥
 * 「공유폴더」가 되는 길은 남겨 둔다(쓰는 데가 없어도 값싸고, 시험이 지키고 있다).
 *
 * ── 🔴 만들지도 올리지도 지우지도 않는다 — 읽고 여는 것뿐이다 ─────────────
 * 폴더를 만들지도, 파일을 올리지도, 지우지도 않는다. 🔴 **서버가 파일을 중계하는 길도
 * 없다** — 이 구역이 부르는 통로는 목록 하나뿐이다. 줄의 [열기]는 그 PC 의 도우미에게
 * 주소를 넘길 뿐이다.
 *  · 🔴 [열기]는 **허용 목록에 든 확장자의 파일 줄에만** 그린다 — 폴더 줄 · 확장자 없는
 *    이름 · 목록 밖 확장자(`.exe` 등)에는 **단추가 아예 없다**(isOpenableQuoteFolderFileName).
 *
 * ── 🔴 여는 장치는 **이미 있는 것을 그대로 쓴다** — 둘 다 연락서 쪽 한 벌 ──
 * 줄의 [열기] 단추와 그 뒤 흐름(숨은 iframe · 도우미 감지 · 「늘 설치로 이끌기」)은
 * 연락서 쪽이 쓰는 ContactFolderEntryOpenButton 을 **한 글자도 고치지 않고 가져다 쓴다.**
 * 그 단추가 받는 `folderName` 은 **공유폴더 루트 아래의 폴더 경로**라 여기서는 통로가 준
 * `연도 폴더/견적서 폴더` 를 그대로 넘기면 된다(도우미는 전부터 여러 마디 경로를 받는다).
 * 구역 맨 아래의 [폴더 열기]도 마찬가지로 연락서 쪽 자리 열기 단추
 * (ContactFolderPlaceOpenButton)를 **한 글자도 고치지 않고** 쓴다 — 그것이 받는 값도 같은
 * `연도 폴더/견적서 폴더` 다. 옆 구역(QuoteArchiveProductFolderSection)이 이미 그 단추를
 * 그렇게 쓰고 있어 **셋째 벌이 생기지 않는다.**
 * 베껴 두 벌을 만들면 반드시 한쪽만 고쳐진다 — 설치되는 도우미는 **PC 당 한 벌**이다.
 * 🔴 그 흐름이 늘 함께 내는 줄(「열리지 않으면 [설치 명령 복사]로 도우미를 다시 설치해
 * 주세요 — 예전에 설치한 도우미는 파일 열기를 모릅니다」)도 그대로 따라온다. 예전 도우미는
 * 파일 열기 주소를 받으면 조용히 끝나고(exit 2) 화면은 그것을 알 수 없기 때문이다.
 * 🔴 **그 안내를 끄지 않는다** — 단추가 제 결과 줄로 함께 낸다.
 *
 * ── 🔴 하위 폴더로 들어가는 길이 **없다** ────────────────────────────────
 * 연락서 쪽에는 폴더 줄을 눌러 들어가는 길과 [위로]가 있지만 여기에는 **일부러 넣지
 * 않았다.** 실측(2026-10-06)에서 견적서 폴더 안의 하위 폴더는 **0 개**였다 — 평평하다.
 * 혹시 폴더가 하나 있으면 **폴더 한 줄**로만 보이고, 그 아래는 구역 맨 아래의 [폴더 열기]로
 * 탐색기를 열어 본다.
 *
 * ── 🔴 서버 컴포넌트에서 읽지 않는다 ─────────────────────────────────────
 * 편집 화면이 뜰 때 공유폴더를 읽으면 **NAS 가 느리거나 꺼져 있는 날 편집 화면 자체가 안
 * 뜬다.** 화면이 뜬 뒤 여기서 따로 통로를 부른다 — 이 구역만 「불러오는 중…」 → 「읽지
 * 못했습니다」가 되고 견적서 편집은 멀쩡하다.
 *
 * ── 🔴 인쇄에 안 찍힌다 ─────────────────────────────────────────────────
 * 공유폴더는 그때그때 달라지는 바깥 사정이라 종이에 남길 것이 아니다 — 바깥 틀에
 * `print:hidden` 을 건다.
 *
 * ── 🔴 구역 맨 아래의 [폴더 열기] — **새로 만든 것이 아니다** ────────────
 * 사용자 지시 2026-10-06: 「견적서 탭의 공유폴더 구역에 [폴더 열기] 단추를 만든다」. 목록만
 * 보여서는 폴더 안의 다른 것을 손댈 수 없어 결국 탐색기를 따로 열게 된다.
 *  · 🔴 **`found` 이고 폴더 경로를 받았을 때만 그린다.** `not-found` · `multiple` ·
 *    `disabled` · `failed` · 불러오는 중에는 **열 자리가 없다** — 단추를 그리지 않는다.
 *    (`multiple` 은 더욱이 **어느 폴더인지 모른다** — 아무 폴더나 열어 주면 안 된다.)
 *  · 자리는 **구역 맨 아래**다 — 연락서 쪽 공유폴더 구역이 목록 아래에 세우는 것과 같은 결
 *    (components/repair-cases/files/ContactFolderSection.tsx). 잘렸을 때 나오는 곁말
 *    (「나머지는 [폴더 열기]로 보세요」)이 가리키는 단추가 바로 이것이다.
 *  · 🔴 Windows 가 아니면 단추가 **스스로** 안 그려지고, 인쇄에도 안 찍힌다 — 가져다 쓰는
 *    단추가 이미 그렇게 한다. 이 파일이 그 판단을 다시 쓰지 않는다.
 * 🔴 **견적서 편집 화면 머리의 폴더 열기 단추 한 벌은 여기에 들어오지 않는다**(견적서 ④b —
 * 자리는 머리 한 곳이라고 2026-09-16 에 정했다). 그것은 **견적서 id** 로 서버에 폴더를 묻고
 * [위치 복사] · [설치 명령 복사]까지 내미는 다른 물건이고, 그것을 부르는 원본이 편집 화면과
 * 제 파일뿐이라는 것을 quote-folder-open-screens.test.ts 가 저장소 전체를 훑어 못 박고 있다 —
 * **이 파일에는 그 이름이 주석에도 들어오지 않는다.** 여기서 쓰는 것은 **루트 기준 상대
 * 경로**를 받아 그 자리를 여는 연락서 쪽 단추다(통로가 그 경로를 이미 준다).
 *
 * ── 상태별로 무엇을 보이는가 ─────────────────────────────────────────────
 *  · `disabled`  → 🔴 **구역 자체를 그리지 않는다**(설정이 없는 환경에서 빈 상자가 늘지 않게)
 *  · 불러오는 중 → 「불러오는 중…」
 *  · `not-found` → 「아직 이 견적서의 폴더가 없습니다」(muted)
 *  · `found` + 빈 폴더 → 「폴더가 비어 있습니다」
 *  · `found` + 목록 → 줄마다 이름 · 크기 · 수정시각, 폴더는 폴더 표시
 *  · `multiple`  → 🔴 「맞는 폴더가 여럿입니다」 — **목록을 내지 않는다**(어느 폴더인지
 *                   모르는데 내용을 보이면 남의 견적서 서류를 보일 수 있다)
 *  · `failed`    → 「공유폴더를 읽지 못했습니다」(warning) + 서버가 준 짧은 사유
 * 🔴 어느 문장에도 **경로를 적지 않는다** — 폴더 이름은 찾았을 때만, 머리 오른쪽에 보인다.
 * 🔴 맨 아래 [폴더 열기]는 **`found` + 경로가 있을 때만** 선다(위의 「새로 만든 것이 아니다」).
 *
 * 설정이 꺼진 환경에서는 처음 한 번 「불러오는 중…」이 스쳤다가 구역이 사라진다. 서버가
 * 미리 알려 주지 않는 한 피할 수 없고, 꺼진 환경은 개발 PC 뿐이라 그대로 둔다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ──────────────────────────────────────
 * fetch 를 부르는 쪽이 바꿔 끼울 수 있다 — 네트워크 없이 값으로 시험한다. 그려지는 것은
 * 상태를 직접 넣어 본다(QuoteArchiveFolderSection.test.tsx).
 * ============================================================================
 */

/** 목록 통로의 주소. 🔴 하위 폴더 칸이 없다 — 받을 것도 보낼 것도 없다. */
export function quoteArchiveFolderEntriesUrl(quoteId: string): string {
  return `/api/quotes/${encodeURIComponent(quoteId)}/archive-folder/entries`;
}

// ── 문장 ─────────────────────────────────────────────────────────────────

export const QUOTE_ARCHIVE_FOLDER_SECTION_TITLE = "공유폴더";

/**
 * 구역의 머리 — 🔴 **한 화면에 구역이 여럿 설 수 있다**(수리 건의 「견적서」 탭. 본 번호가
 * 다르면 폴더도 다르다). 그때 어느 폴더의 상자인지 알 수 있도록 **본 번호를 머리에 적는다.**
 * 이름을 주지 않으면(편집 화면 — 그 견적서 하나뿐이다) 예전 그대로 「공유폴더」다.
 */
export function quoteArchiveFolderSectionTitle(label: string): string {
  return label === "" ? QUOTE_ARCHIVE_FOLDER_SECTION_TITLE : `${QUOTE_ARCHIVE_FOLDER_SECTION_TITLE} — ${label}`;
}
export const QUOTE_ARCHIVE_FOLDER_SECTION_LOADING_TEXT = "불러오는 중…";
export const QUOTE_ARCHIVE_FOLDER_SECTION_NOT_FOUND_TEXT =
  "아직 공유폴더에 이 견적서의 폴더가 없습니다 — [견적서 받기]를 누르면 만들어집니다";
export const QUOTE_ARCHIVE_FOLDER_SECTION_EMPTY_TEXT = "폴더가 비어 있습니다";
/** 🔴 목록을 내지 않는다 — 사람이 공유폴더를 정리해야 한다. */
export const QUOTE_ARCHIVE_FOLDER_SECTION_MULTIPLE_TEXT =
  "맞는 폴더가 여럿입니다 — 공유폴더에서 하나로 정리해 주세요";
export const QUOTE_ARCHIVE_FOLDER_SECTION_FAILED_TEXT = "공유폴더를 읽지 못했습니다";
/** 폴더 한 줄에 붙는 표시 — 크기 자리를 대신한다. */
export const QUOTE_ARCHIVE_FOLDER_SECTION_FOLDER_LABEL = "폴더";

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버 응답을 읽지 못했습니다";
const UNKNOWN_REASON = "까닭을 알 수 없습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

/** 🔴 잘렸을 때의 곁말. 「더 있습니다」가 반드시 들어간다. */
export function quoteArchiveFolderTruncatedText(shown: number, totalCount: number): string {
  return `앞의 ${shown}개만 보입니다 — 더 있습니다(전체 ${totalCount}개). 나머지는 [폴더 열기]로 보세요.`;
}

// ── 값 ───────────────────────────────────────────────────────────────────

/** 🔴 **경로를 담는 칸이 없다** — 이름은 그 폴더 안에서의 이름뿐이다. */
export type QuoteArchiveFolderEntryView = {
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  /** 수정 시각(ISO). 서버가 못 읽었으면 칸이 통째로 없다. */
  modifiedAt?: string;
};

export type QuoteArchiveFolderSectionState =
  | { kind: "loading" }
  /** 🔴 이 상태에서는 구역을 아예 그리지 않는다. */
  | { kind: "disabled" }
  | { kind: "not-found" }
  /** 🔴 목록도 경로도 없다. */
  | { kind: "multiple" }
  | { kind: "failed"; reason: string }
  | {
      kind: "found";
      /** 루트 기준 상대 경로 — `연도 폴더/견적서 폴더`. 줄의 [열기] 주소에 쓴다. */
      relativePath: string;
      entries: QuoteArchiveFolderEntryView[];
      totalCount: number;
      truncated: boolean;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 한 줄을 읽는다. 이름이 없으면 그 줄만 버린다 — 나머지 줄은 그대로 보인다. */
function readEntry(value: unknown): QuoteArchiveFolderEntryView | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== "string" || value.name === "") return null;
  const modifiedAt = typeof value.modifiedAt === "string" && value.modifiedAt !== "" ? value.modifiedAt : undefined;
  return {
    name: value.name,
    isDirectory: value.isDirectory === true,
    sizeBytes: typeof value.sizeBytes === "number" && Number.isFinite(value.sizeBytes) ? value.sizeBytes : 0,
    ...(modifiedAt === undefined ? {} : { modifiedAt }),
  };
}

/** 🔴 알려진 칸만 옮긴다 — 응답에 다른 칸이 끼어 있어도 화면까지 오지 않는다. 모양이 다르면 null. */
export function readQuoteArchiveFolderEntriesAnswer(payload: unknown): QuoteArchiveFolderSectionState | null {
  if (!isRecord(payload)) return null;
  switch (payload.status) {
    case "found": {
      const entries = Array.isArray(payload.entries)
        ? payload.entries.map(readEntry).filter((entry): entry is QuoteArchiveFolderEntryView => entry !== null)
        : [];
      const totalCount =
        typeof payload.totalCount === "number" &&
        Number.isFinite(payload.totalCount) &&
        payload.totalCount >= entries.length
          ? payload.totalCount
          : entries.length;
      return {
        kind: "found",
        relativePath: typeof payload.relativePath === "string" ? payload.relativePath : "",
        entries,
        totalCount,
        truncated: payload.truncated === true && totalCount > entries.length,
      };
    }
    case "multiple":
      return { kind: "multiple" };
    case "not-found":
      return { kind: "not-found" };
    case "disabled":
      return { kind: "disabled" };
    case "failed": {
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      return { kind: "failed", reason: reason === "" ? UNKNOWN_REASON : reason };
    }
    default:
      return null;
  }
}

type EntriesResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type QuoteArchiveFolderEntriesFetch = (url: string) => Promise<EntriesResponse>;

/** 실패 응답 `{ error, code }` 의 문장 — 서버 문장 그대로다. */
async function failureReason(response: EntriesResponse): Promise<string> {
  const payload = await response.json().catch(() => null);
  const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
  return error !== "" ? error : rejectedReason(response.status);
}

/**
 * 통로를 한 번 부른다. **던지지 않는다** — 무슨 일이 나도 `failed` 한 상태로 끝난다.
 * 이 구역이 실패해도 같은 화면의 편집 · 저장은 아무 영향을 받지 않는다.
 */
export async function loadQuoteArchiveFolderEntries(
  quoteId: string,
  fetchImpl: QuoteArchiveFolderEntriesFetch = (url) => fetch(url)
): Promise<QuoteArchiveFolderSectionState> {
  let response: EntriesResponse;
  try {
    response = await fetchImpl(quoteArchiveFolderEntriesUrl(quoteId));
  } catch {
    return { kind: "failed", reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { kind: "failed", reason: await failureReason(response) };
  const answer = readQuoteArchiveFolderEntriesAnswer(await response.json().catch(() => null));
  return answer ?? { kind: "failed", reason: UNREADABLE_RESPONSE_REASON };
}

// ── 그리기 ───────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

/** 한 줄의 곁말 — 폴더는 크기 대신 「폴더」, 파일은 크기. 수정 시각은 있을 때만. */
export function quoteArchiveFolderEntryMetaText(entry: QuoteArchiveFolderEntryView): string {
  const pieces = [entry.isDirectory ? QUOTE_ARCHIVE_FOLDER_SECTION_FOLDER_LABEL : formatBytes(entry.sizeBytes)];
  if (entry.modifiedAt !== undefined) pieces.push(formatTimestamp(entry.modifiedAt));
  return pieces.join(" · ");
}

/**
 * 🔴 이 줄에 [열기]를 그릴 것인가 — **폴더는 아니고**, 이름이 허용 목록에 든 확장자인가.
 * 판단은 순수 함수 하나(domain/quote-folder-file-link.ts)에만 있다 — 화면이 확장자를 따로
 * 세지 않는다. `.exe` 가 목록에 섞여 있어도 누를 단추가 없어야 한다.
 */
export function canOpenQuoteArchiveFolderEntry(entry: QuoteArchiveFolderEntryView): boolean {
  return !entry.isDirectory && isOpenableQuoteFolderFileName(entry.name);
}

/**
 * 🔴 **열 수 있는 폴더 경로** — 찾았고 통로가 경로를 줬을 때만 글자가 있고, 아니면 빈 글자다.
 * 줄의 [열기]와 구역 맨 아래의 [폴더 열기]가 **이 하나**를 함께 본다 — 두 군데에서 따로
 * 판단하면 한쪽만 고쳐지는 날이 온다. 빈 글자면 **둘 다 그리지 않는다**: `not-found` ·
 * `multiple`(어느 폴더인지 모른다) · `disabled` · `failed` · 불러오는 중에는 열 자리가 없고,
 * 주소를 지어내서도 안 된다.
 */
export function quoteArchiveFolderOpenPath(state: QuoteArchiveFolderSectionState): string {
  return state.kind === "found" ? state.relativePath : "";
}

const ENTRY_NAME_CLASS = "min-w-0 break-all text-left text-sm text-zinc-700 dark:text-zinc-300";
const MUTED_CLASS = "text-sm text-zinc-500 dark:text-zinc-400";
const WARNING_CLASS = "text-sm font-medium text-amber-700 dark:text-amber-400";

function EntryList({
  entries,
  relativePath,
}: {
  entries: readonly QuoteArchiveFolderEntryView[];
  /** 🔴 루트 아래의 폴더 경로. 비어 있으면 [열기]를 아무 줄에도 안 그린다(주소를 지어내지 않는다). */
  relativePath: string;
}) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {entries.map((entry) => {
        const openable = relativePath !== "" && canOpenQuoteArchiveFolderEntry(entry);
        return (
          <li
            key={`${entry.isDirectory ? "d" : "f"}:${entry.name}`}
            data-quote-archive-folder-entry-openable={openable ? "" : undefined}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5"
          >
            <span className={ENTRY_NAME_CLASS}>
              {entry.isDirectory ? "📁 " : ""}
              {entry.name}
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {quoteArchiveFolderEntryMetaText(entry)}
              </span>
              {/* 🔴 폴더 줄 · 허용 목록 밖 줄에는 아무것도 두지 않는다(단추 자리 자체가 없다). */}
              {openable && <ContactFolderEntryOpenButton folderName={relativePath} fileName={entry.name} />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 상태 하나를 그린다. 🔴 `disabled` 면 **아무것도 그리지 않는다**(null).
 * 상태를 직접 넣어 그려 볼 수 있게 따로 두었다(통로 · 네트워크 없이 시험한다).
 */
export function QuoteArchiveFolderSectionView({
  state,
  label = "",
}: {
  state: QuoteArchiveFolderSectionState;
  /** 🔴 어느 폴더의 상자인지 — 본 번호. 한 화면에 여럿 설 때 이것으로 가른다. */
  label?: string;
}) {
  if (state.kind === "disabled") return null;

  // 🔴 줄의 [열기]와 맨 아래 [폴더 열기]가 **같은 하나**를 본다. 빈 글자면 둘 다 안 그린다.
  const relativePath = quoteArchiveFolderOpenPath(state);
  const title = quoteArchiveFolderSectionTitle(label);

  return (
    <section
      // 🔴 `aria-labelledby` 가 아니라 `aria-label` 이다 — 한 화면에 구역이 여럿 서면 같은
      //    id 가 여러 번 나와 어느 머리를 가리키는지 알 수 없게 된다.
      aria-label={title}
      data-quote-archive-folder-section=""
      className="print:hidden flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {state.kind === "found" && state.relativePath !== "" && (
          <span className="min-w-0 break-all text-xs text-zinc-500 dark:text-zinc-400">{state.relativePath}</span>
        )}
      </div>

      {state.kind === "loading" && (
        <p aria-live="polite" className={MUTED_CLASS}>
          {QUOTE_ARCHIVE_FOLDER_SECTION_LOADING_TEXT}
        </p>
      )}

      {state.kind === "not-found" && <p className={MUTED_CLASS}>{QUOTE_ARCHIVE_FOLDER_SECTION_NOT_FOUND_TEXT}</p>}

      {/* 🔴 목록을 내지 않는다 — 어느 폴더인지 모르는 채로 내용을 보이면 안 된다. */}
      {state.kind === "multiple" && <p className={WARNING_CLASS}>{QUOTE_ARCHIVE_FOLDER_SECTION_MULTIPLE_TEXT}</p>}

      {state.kind === "failed" && (
        <div className="flex flex-col gap-0.5">
          <p className={WARNING_CLASS}>{QUOTE_ARCHIVE_FOLDER_SECTION_FAILED_TEXT}</p>
          <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">{state.reason}</p>
        </div>
      )}

      {state.kind === "found" &&
        (state.entries.length === 0 ? (
          <p className={MUTED_CLASS}>{QUOTE_ARCHIVE_FOLDER_SECTION_EMPTY_TEXT}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <EntryList entries={state.entries} relativePath={relativePath} />
            {state.truncated && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {quoteArchiveFolderTruncatedText(state.entries.length, state.totalCount)}
              </p>
            )}
          </div>
        ))}

      {/*
        🔴 **폴더를 찾았을 때만** 선다 — 못 찾았거나(not-found) 여럿이거나(multiple) 설정이
        꺼져 있거나(disabled) 읽다 실패했으면 **열 자리가 없다.** 빈 폴더에는 그대로 선다
        (폴더는 있다 — 거기에 파일을 넣으러 연다).
        🔴 여는 장치는 연락서 쪽 자리 열기 단추 한 벌이다 — Windows 가 아니면 스스로 아무것도
        그리지 않고, 「열리지 않으면 [설치 명령 복사]로 도우미를 다시 설치해 주세요」 안내도
        그 단추가 제 결과 줄로 함께 낸다. 이 파일이 끄지 않는다.
      */}
      {relativePath !== "" && <ContactFolderPlaceOpenButton relativePath={relativePath} />}
    </section>
  );
}

/**
 * 화면이 뜬 **뒤에** 따로 통로를 부른다. 떠난 뒤에 답이 와도 상태를 건드리지 않는다.
 *
 * 받은 답은 **어느 견적서의 것인지와 함께** 든다 — 그래야 다른 견적서로 넘어갔을 때 지난
 * 폴더의 목록이 잠깐 비치지 않는다(효과 안에서 「불러오는 중」으로 되돌리면 그릴 때마다 한
 * 번 더 그리게 된다).
 *
 * 🔴 「다시 읽어라」를 받는 칸을 두지 않았다 — 지금 이 구역을 다시 읽게 만드는 자리가 화면에
 * 없기 때문이다([견적서 받기]가 끝난 뒤 목록을 갱신하는 일은 받기 쪽 결과 처리를 건드려야
 * 한다). 쓰지 않을 칸을 미리 들이지 않는다 — 필요해지면 그 조각에서 더한다.
 */
export default function QuoteArchiveFolderSection({
  quoteId,
  label = "",
}: {
  quoteId: string;
  /**
   * 🔴 구역의 머리에 적는 **본 번호**. 수리 건의 「견적서」 탭은 한 화면에 구역을 여럿
   * 그리므로(폴더가 여럿일 수 있다) 반드시 준다. 편집 화면은 그 견적서 하나뿐이라 안 준다.
   */
  label?: string;
}) {
  const [answer, setAnswer] = useState<{ quoteId: string; state: QuoteArchiveFolderSectionState } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadQuoteArchiveFolderEntries(quoteId).then((state) => {
      if (!cancelled) setAnswer({ quoteId, state });
    });
    return () => {
      cancelled = true;
    };
  }, [quoteId]);

  const state: QuoteArchiveFolderSectionState =
    answer !== null && answer.quoteId === quoteId ? answer.state : { kind: "loading" };

  return <QuoteArchiveFolderSectionView state={state} label={label} />;
}
