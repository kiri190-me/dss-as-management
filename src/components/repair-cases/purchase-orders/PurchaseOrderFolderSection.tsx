"use client";

import { useEffect, useState } from "react";

import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";
import ContactFolderPlaceOpenButton from "@/components/repair-cases/files/ContactFolderPlaceOpenButton";
import { isOpenableQuoteFolderFileName } from "@/lib/domain/quote-folder-file-link";
import {
  SHARE_FOLDER_ENTRY_ACTIONS_CLASS,
  SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS,
  SHARE_FOLDER_ENTRY_META_SIZE_CLASS,
  SHARE_FOLDER_ENTRY_NAME_GROW_CLASS,
  SHARE_FOLDER_ENTRY_ROW_CLASS,
  shareFolderEntryMeta,
  type ShareFolderEntryMeta,
} from "@/lib/domain/share-folder-entry-meta";

/**
 * ============================================================================
 * 「발주서」 탭의 **공유폴더 구역** — 이 장비의 가장 최근 발주서 폴더 (2026-10-12)
 * ============================================================================
 * 고객사가 우리에게 낸 발주서(내자)가 사내 공유폴더에 발주 건마다 폴더 하나로 쌓여 있다
 * (`연도/고객사/발주 건`). 그 안을 보려고 탐색기를 따로 열던 것을 이 자리에서 그대로
 * 보여 준다. 수리 건 「견적서」 탭의 공유폴더 구역(components/quotes/QuoteArchiveFolderSection)
 * 과 **같은 생김새**다.
 *
 * ── 🔴 **이미 있는 것을 가져다 쓴다** — 베끼지 않았다 ───────────────────────
 *  · 표의 줄 모양(`이름 · 수정날짜 · 크기 · 동작`) — domain/share-folder-entry-meta.ts
 *    한 벌이다. 🔴 **열을 더하지 않는다** — 공유폴더를 보여 주는 다른 창들이 같은 한 벌을
 *    쓰고 있어, 다섯째 열을 더하면 그 한 벌이 갈라지거나 다른 창까지 따라 바뀐다.
 *  · 줄의 [열기] · 맨 아래 [폴더 열기] — 연락서 쪽 단추 두 벌을 **한 글자도 고치지 않고**
 *    쓴다. 설치되는 도우미는 **PC 당 한 벌**이라 베껴 두 벌을 만들면 반드시 한쪽만
 *    고쳐진다. 🔴 그 단추가 함께 내는 안내(「열리지 않으면 [설치 명령 복사]로 도우미를 다시
 *    설치해 주세요」)도 그대로 따라오고 **끄지 않는다.**
 *  · 줄에 [열기]를 그릴지 — `isOpenableQuoteFolderFileName` 하나다(허용 목록에 든 확장자의
 *    **파일** 줄에만). 화면이 확장자를 따로 세지 않는다.
 *
 * ── 🔴 **가장 최근 폴더 하나만** 보인다 ─────────────────────────────────────
 * 사용자 결정 2026-10-12. 가리는 잣대는 **폴더 이름의 날짜**이고, 그 일은 서버가 한다. 날짜가
 * 같은 폴더가 둘이면 `multiple` 이 와서 **목록을 내지 않는다** — 어느 폴더인지 모르는데
 * 내용을 보이면 남의 발주서를 보여 줄 수 있다.
 *
 * ── 🔴 **외자 발주서는 보이지 않는다** ─────────────────────────────────────
 * 외자 폴더 이름에는 날짜도 L/N 도 S/N 도 없어 「지금 수리건의 것인가」를 가릴 길이 없다
 * (사용자 결정 2026-10-12). 서버가 아예 후보로 삼지 않으므로 화면에는 올 일이 없다 — 그
 * 사실을 아래 「무엇만 보이는지」 한 줄로 적어 둔다. 폴더 밖은 [폴더 열기]로 본다.
 *
 * ── 🔴 **발주발행일이 비면 공유폴더를 아예 안 본다** ────────────────────────
 * 통로가 `no-order-date` 로 끝낸다(디스크를 보지 않는다). 그때 이 구역은 **차분한 한 줄**만
 * 세운다 — 고장이 아니라 「아직 그때가 아니다」라는 뜻이라, 빨간 글씨도 「없습니다」도 아니다.
 *
 * ── 🔴 서버 컴포넌트에서 읽지 않는다 ───────────────────────────────────────
 * 탭이 뜰 때 공유폴더를 읽으면 **NAS 가 느리거나 꺼진 날 탭 자체가 안 뜬다.** 화면이 뜬 뒤
 * 여기서 따로 통로를 부른다 — 이 구역만 「불러오는 중…」 → 「읽지 못했습니다」가 된다
 * (견적서 구역 · 보고서 구역과 같은 판단).
 *
 * ── 🔴 읽기만 한다 ─────────────────────────────────────────────────────────
 * 폴더를 만들지도, 파일을 올리지도, 지우지도 않는다. 부르는 통로는 **목록 하나**뿐이고,
 * 맨 아래 [폴더 열기]도 **여는 것만** 하는 단추다.
 *
 * ── 🔴 인쇄에 안 찍힌다 ───────────────────────────────────────────────────
 * 공유폴더는 그때그때 달라지는 바깥 사정이라 종이에 남길 것이 아니다.
 *
 * ── 상태별로 무엇을 보이는가 ───────────────────────────────────────────────
 *  · `disabled`      → 🔴 **구역 자체를 그리지 않는다**(설정이 없는 개발 PC 에서 빈 상자가 늘지 않게)
 *  · 불러오는 중     → 「불러오는 중…」
 *  · `no-order-date` → 차분한 한 줄(muted) — 공유폴더를 보지 않았다
 *  · `not-found`     → 「아직 이 장비의 발주서 폴더를 찾지 못했습니다 …」(muted)
 *  · `multiple`      → 🔴 「같은 날짜의 발주서 폴더가 여럿입니다 …」 — **목록을 내지 않는다**
 *  · `failed`        → 「공유폴더를 읽지 못했습니다」(warning) + 서버가 준 짧은 사유
 *  · `found` + 빈 폴더 → 「폴더가 비어 있습니다」
 *  · `found` + 목록  → 표 + 잘림 곁말 + 맨 아래 [폴더 열기]
 * 🔴 어느 문장에도 **경로를 적지 않는다** — 폴더 경로는 찾았을 때만, 머리 오른쪽에 보인다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ──────────────────────────────────────
 * fetch 를 부르는 쪽이 바꿔 끼울 수 있다 — 네트워크 없이 값으로 시험한다. 그려지는 것은
 * 상태를 직접 넣어 본다(PurchaseOrderFolderSection.test.tsx).
 * ============================================================================
 */

/** 목록 통로의 주소. 🔴 하위 폴더 칸이 없다 — 받을 것도 보낼 것도 없다. */
export function purchaseOrderFolderEntriesUrl(repairCaseId: string): string {
  return `/api/repair-cases/${encodeURIComponent(repairCaseId)}/purchase-order-folder/entries`;
}

// ── 문장 ─────────────────────────────────────────────────────────────────

export const PURCHASE_ORDER_FOLDER_SECTION_TITLE = "공유폴더";
export const PURCHASE_ORDER_FOLDER_SECTION_LOADING_TEXT = "불러오는 중…";

/**
 * 🔴 **발주발행일이 비어 있다** — 공유폴더를 보지 않았다는 뜻이다(사용자 결정 2026-10-12).
 * 고장도 아니고 「없다」도 아니라 **차분한 한 줄**로 적는다: 무엇이 비었고, 그것이 적히면
 * 무슨 일이 일어나는지. 어디에 적는지(내자 정리)를 함께 적어 두어야 사람이 다음 걸음을 안다.
 */
export const PURCHASE_ORDER_FOLDER_SECTION_NO_ORDER_DATE_TEXT =
  "아직 발주발행일이 적혀 있지 않습니다 — 내자 정리에 적히면 그때 이 장비의 발주서 폴더를 찾습니다";

/** 🔴 폴더를 세우는 일은 앱이 하지 않는다 — 공유폴더는 사람이 만든다. */
export const PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT =
  "아직 공유폴더에서 이 장비의 발주서 폴더를 찾지 못했습니다";

export const PURCHASE_ORDER_FOLDER_SECTION_EMPTY_TEXT = "폴더가 비어 있습니다";

/** 🔴 목록을 내지 않는다 — 사람이 공유폴더를 정리해야 한다. */
export const PURCHASE_ORDER_FOLDER_SECTION_MULTIPLE_TEXT =
  "같은 날짜의 발주서 폴더가 여럿입니다 — 공유폴더에서 하나로 정리해 주세요";

export const PURCHASE_ORDER_FOLDER_SECTION_FAILED_TEXT = "공유폴더를 읽지 못했습니다";

/** 폴더 한 줄에 붙는 표시 — 크기 자리를 대신한다. 🔴 낱말은 **창마다 제 상수**다. */
export const PURCHASE_ORDER_FOLDER_SECTION_FOLDER_LABEL = "폴더";

/**
 * 🔴 **무엇만 보이는지 미리 적는다.** 이 구역은 이 장비의 **가장 최근 내자 발주서 폴더
 * 하나**만 보여 준다 — 그 말이 없으면 「예전 발주서가 없어졌다」 · 「외자가 빠졌다」로 읽힌다.
 */
export const PURCHASE_ORDER_FOLDER_SECTION_SCOPE_TEXT =
  "이 장비(L/N · S/N)의 가장 최근 내자 발주서 폴더 하나만 보입니다 — 폴더 밖은 [폴더 열기]로 보세요.";

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버 응답을 읽지 못했습니다";
const UNKNOWN_REASON = "까닭을 알 수 없습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

/** 🔴 잘렸을 때의 곁말. 「더 있습니다」가 반드시 들어간다. */
export function purchaseOrderFolderTruncatedText(shown: number, totalCount: number): string {
  return `앞의 ${shown}개만 보입니다 — 더 있습니다(전체 ${totalCount}개). 나머지는 [폴더 열기]로 보세요.`;
}

/** 머리 오른쪽의 곁말 — 어느 발주 건을 보고 있는지. 🔴 **경로가 아니라 날짜**다. */
export function purchaseOrderFolderIssuedDateText(issuedDate: string): string {
  return issuedDate === "" ? "" : `발주발행 ${issuedDate}`;
}

// ── 값 ───────────────────────────────────────────────────────────────────

/** 🔴 **경로를 담는 칸이 없다** — 이름은 그 폴더 안에서의 이름뿐이다. */
export type PurchaseOrderFolderEntryView = {
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  /** 수정 시각(ISO). 서버가 못 읽었으면 칸이 통째로 없다. */
  modifiedAt?: string;
};

export type PurchaseOrderFolderSectionState =
  | { kind: "loading" }
  /** 🔴 이 상태에서는 구역을 아예 그리지 않는다. */
  | { kind: "disabled" }
  /** 🔴 내자 정리에 발주발행일이 없다 — 공유폴더를 **보지 않았다**. */
  | { kind: "no-order-date" }
  | { kind: "not-found" }
  /** 🔴 목록도 경로도 없다. */
  | { kind: "multiple" }
  | { kind: "failed"; reason: string }
  | {
      kind: "found";
      /** 루트 기준 상대 경로 — `연도/고객사/발주 건`. 줄의 [열기] 주소에 쓴다. */
      relativePath: string;
      /** 폴더 이름에서 읽은 발주발행일 `YYYY-MM-DD`. 없으면 빈 글자다. */
      issuedDate: string;
      entries: PurchaseOrderFolderEntryView[];
      totalCount: number;
      truncated: boolean;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 한 줄을 읽는다. 이름이 없으면 그 줄만 버린다 — 나머지 줄은 그대로 보인다. */
function readEntry(value: unknown): PurchaseOrderFolderEntryView | null {
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
export function readPurchaseOrderFolderEntriesAnswer(payload: unknown): PurchaseOrderFolderSectionState | null {
  if (!isRecord(payload)) return null;
  switch (payload.status) {
    case "found": {
      const entries = Array.isArray(payload.entries)
        ? payload.entries.map(readEntry).filter((entry): entry is PurchaseOrderFolderEntryView => entry !== null)
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
        issuedDate: typeof payload.issuedDate === "string" ? payload.issuedDate : "",
        entries,
        totalCount,
        truncated: payload.truncated === true && totalCount > entries.length,
      };
    }
    case "multiple":
      return { kind: "multiple" };
    case "not-found":
      return { kind: "not-found" };
    case "no-order-date":
      return { kind: "no-order-date" };
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

export type PurchaseOrderFolderEntriesFetch = (url: string) => Promise<EntriesResponse>;

/** 실패 응답 `{ error, code }` 의 문장 — 서버 문장 그대로다. */
async function failureReason(response: EntriesResponse): Promise<string> {
  const payload = await response.json().catch(() => null);
  const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
  return error !== "" ? error : rejectedReason(response.status);
}

/**
 * 통로를 한 번 부른다. **던지지 않는다** — 무슨 일이 나도 `failed` 한 상태로 끝난다.
 * 이 구역이 실패해도 같은 화면의 다른 것은 아무 영향을 받지 않는다.
 */
export async function loadPurchaseOrderFolderEntries(
  repairCaseId: string,
  fetchImpl: PurchaseOrderFolderEntriesFetch = (url) => fetch(url)
): Promise<PurchaseOrderFolderSectionState> {
  let response: EntriesResponse;
  try {
    response = await fetchImpl(purchaseOrderFolderEntriesUrl(repairCaseId));
  } catch {
    return { kind: "failed", reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { kind: "failed", reason: await failureReason(response) };
  const answer = readPurchaseOrderFolderEntriesAnswer(await response.json().catch(() => null));
  return answer ?? { kind: "failed", reason: UNREADABLE_RESPONSE_REASON };
}

// ── 그리기 ───────────────────────────────────────────────────────────────

/**
 * 한 줄의 곁말 **두 조각** — 폴더는 크기 대신 「폴더」, 파일은 크기. 수정시각은 따로다.
 * 🔴 날짜 모양도 칸 생김새도 **공유폴더를 보여 주는 창들이 같은 한 벌**을 쓴다
 * (lib/domain/share-folder-entry-meta.ts). 여기 남는 것은 이 구역의 「폴더」 글자뿐이다.
 */
export function purchaseOrderFolderEntryMeta(entry: PurchaseOrderFolderEntryView): ShareFolderEntryMeta {
  return shareFolderEntryMeta(entry, PURCHASE_ORDER_FOLDER_SECTION_FOLDER_LABEL);
}

/**
 * 🔴 이 줄에 [열기]를 그릴 것인가 — **폴더는 아니고**, 이름이 허용 목록에 든 확장자인가.
 * 판단은 순수 함수 하나(domain/quote-folder-file-link.ts)에만 있다 — 도우미가 실제로 여는
 * 확장자 목록이 그것이고, 화면이 따로 세지 않는다.
 */
export function canOpenPurchaseOrderFolderEntry(entry: PurchaseOrderFolderEntryView): boolean {
  return !entry.isDirectory && isOpenableQuoteFolderFileName(entry.name);
}

/**
 * 🔴 **열 수 있는 폴더 경로** — 찾았고 통로가 경로를 줬을 때만 글자가 있고, 아니면 빈 글자다.
 * 줄의 [열기]와 구역 맨 아래의 [폴더 열기]가 **이 하나**를 함께 본다. 빈 글자면 둘 다 그리지
 * 않는다: `not-found` · `multiple`(어느 폴더인지 모른다) · `no-order-date` · `disabled` ·
 * `failed` · 불러오는 중에는 열 자리가 없고, 주소를 지어내서도 안 된다.
 */
export function purchaseOrderFolderOpenPath(state: PurchaseOrderFolderSectionState): string {
  return state.kind === "found" ? state.relativePath : "";
}

const ENTRY_NAME_CLASS = `min-w-0 ${SHARE_FOLDER_ENTRY_NAME_GROW_CLASS} break-all text-left text-sm text-zinc-700 dark:text-zinc-300`;
const MUTED_CLASS = "text-sm text-zinc-500 dark:text-zinc-400";
const WARNING_CLASS = "text-sm font-medium text-amber-700 dark:text-amber-400";
/** 목록 아래에 붙는 **차분한** 곁말 — 잘림 곁말(amber)과 달리 경고가 아니다. */
const NOTE_CLASS = "text-xs text-zinc-500 dark:text-zinc-400";

function EntryList({
  entries,
  relativePath,
}: {
  entries: readonly PurchaseOrderFolderEntryView[];
  /** 🔴 루트 아래의 폴더 경로. 비어 있으면 [열기]를 아무 줄에도 안 그린다(주소를 지어내지 않는다). */
  relativePath: string;
}) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {entries.map((entry) => {
        const openable = relativePath !== "" && canOpenPurchaseOrderFolderEntry(entry);
        const meta = purchaseOrderFolderEntryMeta(entry);
        return (
          <li
            key={`${entry.isDirectory ? "d" : "f"}:${entry.name}`}
            data-purchase-order-folder-entry-openable={openable ? "" : undefined}
            className={SHARE_FOLDER_ENTRY_ROW_CLASS}
          >
            <span className={ENTRY_NAME_CLASS}>
              {entry.isDirectory ? "📁 " : ""}
              {entry.name}
            </span>
            {/* 🔴 수정시각이 없어도 **칸은 그대로** 그린다 — 빼면 그 줄만 열이 어긋난다. */}
            <span className={SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS}>{meta.modifiedText}</span>
            <span className={SHARE_FOLDER_ENTRY_META_SIZE_CLASS}>{meta.sizeText}</span>
            {/* 🔴 동작 칸은 **비어도 그린다** — 칸까지 빼면 그 줄만 날짜·크기가 어긋난다. */}
            <span className={SHARE_FOLDER_ENTRY_ACTIONS_CLASS}>
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
export function PurchaseOrderFolderSectionView({ state }: { state: PurchaseOrderFolderSectionState }) {
  if (state.kind === "disabled") return null;

  // 🔴 줄의 [열기]와 맨 아래 [폴더 열기]가 **같은 하나**를 본다. 빈 글자면 둘 다 안 그린다.
  const relativePath = purchaseOrderFolderOpenPath(state);
  const issuedDateText = state.kind === "found" ? purchaseOrderFolderIssuedDateText(state.issuedDate) : "";

  return (
    <section
      aria-labelledby="purchase-order-folder-section-title"
      data-purchase-order-folder-section=""
      className="print:hidden flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="purchase-order-folder-section-title"
          className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
        >
          {PURCHASE_ORDER_FOLDER_SECTION_TITLE}
        </h2>
        {/* 🔴 찾았을 때만 — 발주발행일과 그 폴더의 루트 기준 경로다(절대 경로가 아니다). */}
        {state.kind === "found" && (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {issuedDateText !== "" && (
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{issuedDateText}</span>
            )}
            {state.relativePath !== "" && (
              <span className="min-w-0 break-all text-xs text-zinc-500 dark:text-zinc-400">
                {state.relativePath}
              </span>
            )}
          </span>
        )}
      </div>

      {state.kind === "loading" && (
        <p aria-live="polite" className={MUTED_CLASS}>
          {PURCHASE_ORDER_FOLDER_SECTION_LOADING_TEXT}
        </p>
      )}

      {/* 🔴 공유폴더를 **보지 않았다** — 고장이 아니라 아직 그때가 아니라는 차분한 한 줄. */}
      {state.kind === "no-order-date" && (
        <p className={MUTED_CLASS}>{PURCHASE_ORDER_FOLDER_SECTION_NO_ORDER_DATE_TEXT}</p>
      )}

      {state.kind === "not-found" && <p className={MUTED_CLASS}>{PURCHASE_ORDER_FOLDER_SECTION_NOT_FOUND_TEXT}</p>}

      {/* 🔴 목록을 내지 않는다 — 어느 폴더인지 모르는 채로 내용을 보이면 안 된다. */}
      {state.kind === "multiple" && <p className={WARNING_CLASS}>{PURCHASE_ORDER_FOLDER_SECTION_MULTIPLE_TEXT}</p>}

      {state.kind === "failed" && (
        <div className="flex flex-col gap-0.5">
          <p className={WARNING_CLASS}>{PURCHASE_ORDER_FOLDER_SECTION_FAILED_TEXT}</p>
          <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">{state.reason}</p>
        </div>
      )}

      {state.kind === "found" &&
        (state.entries.length === 0 ? (
          <p className={MUTED_CLASS}>{PURCHASE_ORDER_FOLDER_SECTION_EMPTY_TEXT}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <EntryList entries={state.entries} relativePath={relativePath} />
            {state.truncated && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {purchaseOrderFolderTruncatedText(state.entries.length, state.totalCount)}
              </p>
            )}
          </div>
        ))}

      {/* 🔴 무엇만 보이는지 — 찾았을 때만 적는다(못 찾은 화면에서는 할 말이 아니다). */}
      {state.kind === "found" && <p className={NOTE_CLASS}>{PURCHASE_ORDER_FOLDER_SECTION_SCOPE_TEXT}</p>}

      {/*
        🔴 **폴더를 찾았을 때만** 선다 — 못 찾았거나(not-found) 여럿이거나(multiple) 발주발행일이
        없거나(no-order-date) 설정이 꺼져 있거나(disabled) 읽다 실패했으면 **열 자리가 없다.**
        빈 폴더에는 그대로 선다(폴더는 있다).
        🔴 여는 장치는 연락서 쪽 자리 열기 단추 한 벌이다 — Windows 가 아니면 스스로 아무것도
        그리지 않고, 도우미 재설치 안내도 그 단추가 제 결과 줄로 함께 낸다. 여기서 끄지 않는다.
        🔴 **만들어 주는 단추가 아니다** — 이 구역은 읽고 여는 것뿐이다.
      */}
      {relativePath !== "" && <ContactFolderPlaceOpenButton relativePath={relativePath} />}
    </section>
  );
}

/**
 * 화면이 뜬 **뒤에** 따로 통로를 부른다. 떠난 뒤에 답이 와도 상태를 건드리지 않는다.
 *
 * 받은 답은 **어느 수리 건의 것인지와 함께** 든다 — 그래야 다른 건으로 넘어갔을 때 지난
 * 폴더의 목록이 잠깐 비치지 않는다(견적서 · 보고서 구역과 같은 모양이다).
 */
export default function PurchaseOrderFolderSection({ repairCaseId }: { repairCaseId: string }) {
  const [answer, setAnswer] = useState<{ repairCaseId: string; state: PurchaseOrderFolderSectionState } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    void loadPurchaseOrderFolderEntries(repairCaseId).then((state) => {
      if (!cancelled) setAnswer({ repairCaseId, state });
    });
    return () => {
      cancelled = true;
    };
  }, [repairCaseId]);

  const state: PurchaseOrderFolderSectionState =
    answer !== null && answer.repairCaseId === repairCaseId ? answer.state : { kind: "loading" };

  return <PurchaseOrderFolderSectionView state={state} />;
}
