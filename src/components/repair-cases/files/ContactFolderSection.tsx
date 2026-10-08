"use client";

import { useEffect, useState } from "react";

import ContactFolderOpenButton from "@/components/repair-cases/detail/ContactFolderOpenButton";
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
import ContactFolderEntryOpenButton from "./ContactFolderEntryOpenButton";
import ContactFolderPlaceOpenButton from "./ContactFolderPlaceOpenButton";

/**
 * ============================================================================
 * 파일 관리 탭의 **공유폴더 구역** — 그 건의 연락서 폴더 안에 무엇이 있는가 (조각 3)
 * ============================================================================
 * 수리 건 하나당 사내 공유폴더에 연락서 폴더가 하나 있다. 그 안에 무엇이 들어 있는지
 * 보려고 탐색기를 따로 열던 것을, 이 자리에서 그대로 보여 준다.
 *
 * ── 🔴 만들지도 올리지도 지우지도 않는다 — 여는 것만 는다(조각 4) ─────────
 * 폴더를 만들지도, 파일을 올리지도, 지우지도 않는다. 🔴 **서버가 파일을 중계하는 길도 없다** —
 * 이 구역이 부르는 통로는 목록 하나뿐이다. 조각 4 에서 **줄마다 [열기]** 가 붙었고, 그것은
 * 그 PC 의 도우미에게 주소를 넘길 뿐이다(ContactFolderEntryOpenButton).
 *  · 🔴 [열기]는 **허용 목록에 든 확장자의 파일 줄에만** 그린다 — 폴더 줄 · 확장자 없는 이름 ·
 *    목록 밖 확장자(`.exe` 등)에는 **단추가 아예 없다**(isOpenableQuoteFolderFileName).
 *
 * ── 하위 폴더 안으로 들어간다 (조각 10) ──────────────────────────────────
 * 폴더 줄을 누르면 **그 안**을 읽는다 — 통로에 `?path=사진/2026` 을 붙일 뿐이고, 내려갈 수
 * 있는 깊이 · 줄 수 · 기다리는 시간의 상한은 서버가 쥔다. 지금 어디에 있는지는 길 표시로
 * 보이고(토막마다 눌러 그 자리로 돌아간다), [위로]가 한 칸 올려 준다.
 *  · 🔴 **자리는 이 조각이 쥔다** — 수리 건이 바뀌면 맨 위로 돌아가고, 다시 읽으라는 신호
 *    (reloadToken)가 와도 **보고 있던 자리는 그대로**다.
 *  · 🔴 줄의 [열기]에는 **폴더 이름에 지금 자리를 이어** 넘긴다 — 도우미는 여러 마디 경로를
 *    이미 받는다(조각 4 의 주소 모양은 한 글자도 바뀌지 않았다).
 *  · 맨 아래 [폴더 열기]는 **보고 있는 자리**를 연다: 맨 위에서는 조각 2 의 단추를 **그대로**
 *    쓰고(components/repair-cases/detail/ContactFolderOpenButton — 폴더가 없을 때 [폴더 만들고
 *    열기]가 거기 달려 있다), 하위 폴더에서는 그 자리를 여는 단추가 대신 선다
 *    (ContactFolderPlaceOpenButton).
 *
 * ── 🔴 서버 컴포넌트에서 읽지 않는다 ─────────────────────────────────────
 * 이 탭의 페이지(app/(app)/repair-cases/[id]/files/page.tsx)는 이미 DB 를 두 번 때리는
 * 서버 컴포넌트다. 거기에 공유폴더 읽기를 더하면 **NAS 가 느린 날 파일 관리 탭 자체가
 * 안 뜬다.** 화면이 뜬 뒤 여기서 따로 통로를 부른다 — 공유폴더가 느리거나 없거나 꺼져
 * 있어도 **DB 첨부 목록은 그대로 보인다.** 이 구역만 「불러오는 중…」 → 「읽지
 * 못했습니다」가 되고 나머지는 멀쩡하다.
 *
 * ── 🔴 인쇄에 안 찍힌다 ─────────────────────────────────────────────────
 * 이 화면도 그대로 인쇄해 쓴다. 공유폴더는 그때그때 달라지는 바깥 사정이라 종이에 남길
 * 것이 아니다 — 바깥 틀에 `print:hidden` 을 건다.
 *
 * ── 상태별로 무엇을 보이는가 ─────────────────────────────────────────────
 *  · `disabled`  → 🔴 **구역 자체를 그리지 않는다**(설정이 없는 환경에서 빈 상자가 늘지 않게)
 *  · 불러오는 중 → 「불러오는 중…」
 *  · `not-found` → 「아직 이 건의 폴더가 없습니다」(muted)
 *  · `found` + 빈 폴더 → 「폴더가 비어 있습니다」
 *  · `found` + 목록 → 🔴 **표**다(2026-10-08): `[이름] [수정날짜] [크기] [동작]` — 윈도우
 *                     탐색기와 같은 차례. 1fr 은 이름 하나뿐이고 나머지 세 칸은 고정
 *                     길이라 **단추가 있는 줄과 없는 줄의 날짜·크기가 같은 자리에 선다.**
 *                     수정날짜가 없는 줄도 · 단추가 없는 줄도 **칸은 남는다.** 좁은
 *                     화면에서는 예전처럼 접힌다
 *                     (lib/domain/share-folder-entry-meta.ts — 네 창이 한 벌을 쓴다).
 *  · `multiple`  → 🔴 「맞는 폴더가 여럿입니다」 — **목록을 내지 않는다**(어느 폴더인지
 *                   모르는데 내용을 보이면 남의 건 서류를 보일 수 있다)
 *  · `failed`    → 「공유폴더를 읽지 못했습니다」(warning)
 *
 * 설정이 꺼진 환경에서는 처음 한 번 「불러오는 중…」이 스쳤다가 구역이 사라진다. 서버가
 * 미리 알려 주지 않는 한 피할 수 없고, 꺼진 환경은 개발 PC 뿐이라 그대로 둔다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ──────────────────────────────────────
 * fetch 를 부르는 쪽이 바꿔 끼울 수 있다 — 네트워크 없이 값으로 시험한다. 그려지는 것은
 * 상태를 직접 넣어 본다(ContactFolderSection.test.tsx).
 * ============================================================================
 */

/**
 * 목록 통로의 주소. 🔴 하위 폴더에 들어가 있을 때만 `?path=…` 가 붙는다 — 맨 위 칸을 읽는
 * 주소는 조각 3 때와 **한 글자도 같다**.
 */
export function contactFolderEntriesUrl(repairCaseId: string, insidePath = ""): string {
  const url = `/api/repair-cases/${encodeURIComponent(repairCaseId)}/contact-folder/entries`;
  return insidePath === "" ? url : `${url}?path=${encodeURIComponent(insidePath)}`;
}

/** 길 표시의 토막들 — 빈 마디는 버린다(`사진//2026` 같은 값이 들어와도 그려 볼 수 있게). */
export function contactFolderPathSegments(insidePath: string): string[] {
  return insidePath.split("/").filter((segment) => segment !== "");
}

/** 한 칸 위의 자리. 맨 위면 빈 글자다. */
export function contactFolderParentPath(insidePath: string): string {
  return contactFolderPathSegments(insidePath).slice(0, -1).join("/");
}

/**
 * 🔴 공유폴더 **루트 아래의 상대 경로** — 폴더 이름에 지금 자리를 잇는다. 도우미 주소
 * (폴더 열기 · 파일 열기)가 받는 모양이다. 폴더 이름을 모르면 빈 글자다(주소를 지어내지 않는다).
 */
export function contactFolderPlacePath(folderName: string, insidePath: string): string {
  if (folderName === "") return "";
  const segments = contactFolderPathSegments(insidePath);
  return segments.length === 0 ? folderName : `${folderName}/${segments.join("/")}`;
}

// ── 문장 ─────────────────────────────────────────────────────────────────

export const CONTACT_FOLDER_SECTION_TITLE = "공유폴더";
export const CONTACT_FOLDER_SECTION_LOADING_TEXT = "불러오는 중…";
export const CONTACT_FOLDER_SECTION_NOT_FOUND_TEXT = "아직 이 건의 폴더가 없습니다";
export const CONTACT_FOLDER_SECTION_EMPTY_TEXT = "폴더가 비어 있습니다";
/** 🔴 목록을 내지 않는다 — 사람이 공유폴더를 정리해야 한다. */
export const CONTACT_FOLDER_SECTION_MULTIPLE_TEXT = "맞는 폴더가 여럿입니다 — 공유폴더에서 하나로 정리해 주세요";
export const CONTACT_FOLDER_SECTION_FAILED_TEXT = "공유폴더를 읽지 못했습니다";
/** 폴더 한 줄에 붙는 표시 — 크기 자리를 대신한다. */
export const CONTACT_FOLDER_SECTION_FOLDER_LABEL = "폴더";

/** 길 표시 — 지금 어느 자리인가. */
export const CONTACT_FOLDER_SECTION_TRAIL_LABEL = "공유폴더 위치";
/** 길 표시의 맨 앞 토막 — 폴더 이름을 모를 때(실패 · 여럿) 쓰는 말. */
export const CONTACT_FOLDER_SECTION_TRAIL_ROOT_FALLBACK = "맨 위 폴더";
export const CONTACT_FOLDER_SECTION_UP_TEXT = "위로";
/** 하위 폴더에서 목록이 비었을 때 — 맨 위 칸과 말이 다르다(「이 폴더」). */
export const CONTACT_FOLDER_SECTION_INSIDE_EMPTY_TEXT = "이 폴더가 비어 있습니다";

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버 응답을 읽지 못했습니다";
const UNKNOWN_REASON = "까닭을 알 수 없습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

/** 🔴 잘렸을 때의 곁말. 「더 있습니다」가 반드시 들어간다. */
export function truncatedText(shown: number, totalCount: number): string {
  return `앞의 ${shown}개만 보입니다 — 더 있습니다(전체 ${totalCount}개). 나머지는 [폴더 열기]로 보세요.`;
}

// ── 값 ───────────────────────────────────────────────────────────────────

/** 🔴 **경로를 담는 칸이 없다** — 이름은 그 폴더 안에서의 이름뿐이다. */
export type ContactFolderEntryView = {
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  /** 수정 시각(ISO). 서버가 못 읽었으면 칸이 통째로 없다. */
  modifiedAt?: string;
};

export type ContactFolderSectionState =
  | { kind: "loading" }
  /** 🔴 이 상태에서는 구역을 아예 그리지 않는다. */
  | { kind: "disabled" }
  | { kind: "not-found" }
  | { kind: "multiple"; folderNames: string[] }
  | { kind: "failed"; reason: string }
  | {
      kind: "found";
      folderName: string;
      entries: ContactFolderEntryView[];
      totalCount: number;
      truncated: boolean;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 한 줄을 읽는다. 이름이 없으면 그 줄만 버린다 — 나머지 줄은 그대로 보인다. */
function readEntry(value: unknown): ContactFolderEntryView | null {
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
export function readContactFolderEntriesAnswer(payload: unknown): ContactFolderSectionState | null {
  if (!isRecord(payload)) return null;
  switch (payload.status) {
    case "found": {
      const entries = Array.isArray(payload.entries)
        ? payload.entries.map(readEntry).filter((entry): entry is ContactFolderEntryView => entry !== null)
        : [];
      const totalCount =
        typeof payload.totalCount === "number" && Number.isFinite(payload.totalCount) && payload.totalCount >= entries.length
          ? payload.totalCount
          : entries.length;
      return {
        kind: "found",
        folderName: typeof payload.folderName === "string" ? payload.folderName : "",
        entries,
        totalCount,
        truncated: payload.truncated === true && totalCount > entries.length,
      };
    }
    case "multiple": {
      const folderNames = Array.isArray(payload.folderNames)
        ? payload.folderNames.filter((name): name is string => typeof name === "string")
        : [];
      return { kind: "multiple", folderNames };
    }
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

export type ContactFolderEntriesFetch = (url: string) => Promise<EntriesResponse>;

/** 실패 응답 `{ error, code }` 의 문장 — 서버 문장 그대로다. */
async function failureReason(response: EntriesResponse): Promise<string> {
  const payload = await response.json().catch(() => null);
  const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
  return error !== "" ? error : rejectedReason(response.status);
}

/**
 * 통로를 한 번 부른다. **던지지 않는다** — 무슨 일이 나도 `failed` 한 상태로 끝난다.
 * 이 구역이 실패해도 같은 화면의 DB 첨부 목록은 아무 영향을 받지 않는다.
 */
export async function loadContactFolderEntries(
  repairCaseId: string,
  fetchImpl: ContactFolderEntriesFetch = (url) => fetch(url),
  /** 폴더 안에서의 자리. 비면 맨 위 칸이다(조각 10). */
  insidePath = ""
): Promise<ContactFolderSectionState> {
  let response: EntriesResponse;
  try {
    response = await fetchImpl(contactFolderEntriesUrl(repairCaseId, insidePath));
  } catch {
    return { kind: "failed", reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { kind: "failed", reason: await failureReason(response) };
  const answer = readContactFolderEntriesAnswer(await response.json().catch(() => null));
  return answer ?? { kind: "failed", reason: UNREADABLE_RESPONSE_REASON };
}

// ── 그리기 ───────────────────────────────────────────────────────────────

/**
 * 한 줄의 곁말 **두 조각** — 폴더는 크기 대신 「폴더」, 파일은 크기. 수정시각은 **따로**다
 * (2026-10-08 사용자 요구 「수정 날짜를 별도의 열로」).
 * 🔴 날짜 모양도 칸 생김새도 **공유폴더를 보여 주는 네 창이 같은 한 벌**을 쓴다
 * (lib/domain/share-folder-entry-meta.ts). 여기 남는 것은 **이 창의 「폴더」 글자**뿐이다 —
 * 창마다 말이 달라질 수 있어 낱말은 모으지 않는다.
 */
export function contactFolderEntryMeta(entry: ContactFolderEntryView): ShareFolderEntryMeta {
  return shareFolderEntryMeta(entry, CONTACT_FOLDER_SECTION_FOLDER_LABEL);
}

/**
 * 🔴 이 줄에 [열기]를 그릴 것인가 — **폴더는 아니고**, 이름이 허용 목록에 든 확장자인가.
 * 판단은 순수 함수 하나(domain/quote-folder-file-link.ts)에만 있다 — 화면이 확장자를 따로
 * 세지 않는다. `.exe` 가 목록에 섞여 있어도 누를 단추가 없어야 한다.
 */
export function canOpenContactFolderEntry(entry: ContactFolderEntryView): boolean {
  return !entry.isDirectory && isOpenableQuoteFolderFileName(entry.name);
}

const ENTRY_NAME_CLASS = `min-w-0 ${SHARE_FOLDER_ENTRY_NAME_GROW_CLASS} break-all text-left text-sm text-zinc-700 dark:text-zinc-300`;

/**
 * 한 줄의 이름. 🔴 **폴더 줄은 들어갈 수 있을 때만 단추**가 된다 — 들어갈 길(onEnter)을 주지
 * 않는 자리(시험 · 보여 주기만 하는 화면)에서는 조각 3 때처럼 이름만 선다.
 */
function EntryName({ entry, onEnter }: { entry: ContactFolderEntryView; onEnter?: (name: string) => void }) {
  if (!entry.isDirectory || onEnter === undefined) {
    return (
      <span className={ENTRY_NAME_CLASS}>
        {entry.isDirectory ? "📁 " : ""}
        {entry.name}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onEnter(entry.name)}
      data-contact-folder-enter=""
      title={`${entry.name} 폴더 안을 봅니다`}
      className={`${ENTRY_NAME_CLASS} underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100`}
    >
      📁 {entry.name}
    </button>
  );
}

function EntryList({
  entries,
  folderPath,
  onEnter,
}: {
  entries: readonly ContactFolderEntryView[];
  /** 🔴 루트 아래의 상대 경로(폴더 이름 + 지금 자리). 비어 있으면 [열기]를 아무 줄에도 안 그린다. */
  folderPath: string;
  onEnter?: (name: string) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {entries.map((entry) => {
        const openable = folderPath !== "" && canOpenContactFolderEntry(entry);
        const meta = contactFolderEntryMeta(entry);
        return (
          <li
            key={`${entry.isDirectory ? "d" : "f"}:${entry.name}`}
            data-contact-folder-entry-openable={openable ? "" : undefined}
            className={SHARE_FOLDER_ENTRY_ROW_CLASS}
          >
            <EntryName entry={entry} onEnter={onEnter} />
            {/* 🔴 수정시각이 없어도 **칸은 그대로** 그린다 — 빼면 그 줄만 열이 어긋난다. */}
            <span className={SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS}>{meta.modifiedText}</span>
            <span className={SHARE_FOLDER_ENTRY_META_SIZE_CLASS}>{meta.sizeText}</span>
            {/*
              🔴 동작 칸은 **비어도 그린다** — 폴더 줄 · 허용 목록 밖 줄에는 단추가 없지만
              칸까지 빼면 그 줄만 날짜·크기가 어긋난다(2026-10-08).
            */}
            <span className={SHARE_FOLDER_ENTRY_ACTIONS_CLASS}>
              {openable && <ContactFolderEntryOpenButton folderName={folderPath} fileName={entry.name} />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 길 표시 — 「D260891 … › 사진 › 2026」. 🔴 **하위 폴더에 들어가 있을 때만** 그린다
 * (맨 위에서는 머리의 폴더 이름이 그 일을 한다).
 *
 * 토막마다 그 자리로 돌아가는 단추가 되고, 마지막 토막(지금 자리)은 단추가 아니다 —
 * 눌러도 갈 곳이 같다. [위로]는 한 칸 위다. 돌아갈 길(onNavigate)이 없으면 글자만 선다.
 */
function PathTrail({
  rootLabel,
  insidePath,
  onNavigate,
}: {
  rootLabel: string;
  insidePath: string;
  onNavigate?: (insidePath: string) => void;
}) {
  const segments = contactFolderPathSegments(insidePath);
  const steps = [
    { label: rootLabel, path: "" },
    ...segments.map((segment, index) => ({ label: segment, path: segments.slice(0, index + 1).join("/") })),
  ];
  const lastIndex = steps.length - 1;
  return (
    <nav
      aria-label={CONTACT_FOLDER_SECTION_TRAIL_LABEL}
      data-contact-folder-trail=""
      className="flex flex-wrap items-baseline gap-1 text-xs text-zinc-500 dark:text-zinc-400"
    >
      {steps.map((step, index) => (
        <span key={`${index}:${step.path}`} className="flex min-w-0 items-baseline gap-1">
          {index > 0 && <span aria-hidden="true">›</span>}
          {index === lastIndex || onNavigate === undefined ? (
            <span
              {...(index === lastIndex ? { "aria-current": "true" as const } : {})}
              className="min-w-0 break-all font-medium text-zinc-700 dark:text-zinc-300"
            >
              {step.label}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate(step.path)}
              data-contact-folder-trail-step=""
              className="min-w-0 break-all text-left underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              {step.label}
            </button>
          )}
        </span>
      ))}
      {onNavigate !== undefined && (
        <button
          type="button"
          onClick={() => onNavigate(contactFolderParentPath(insidePath))}
          data-contact-folder-up=""
          className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {CONTACT_FOLDER_SECTION_UP_TEXT}
        </button>
      )}
    </nav>
  );
}

const MUTED_CLASS = "text-sm text-zinc-500 dark:text-zinc-400";
const WARNING_CLASS = "text-sm font-medium text-amber-700 dark:text-amber-400";

/**
 * 상태 하나를 그린다. 🔴 `disabled` 면 **아무것도 그리지 않는다**(null).
 *
 * `insidePath` 는 **지금 보고 있는 자리**다(조각 10). 비면 조각 3 때와 같은 화면이고,
 * 자리가 있으면 길 표시 · [위로]가 붙고 맨 아래 단추가 그 자리를 여는 것으로 바뀐다.
 * 🔴 옮겨 다닐 길(onNavigate)을 주지 않으면 **누를 수 있는 것이 하나도 생기지 않는다**.
 */
export function ContactFolderSectionView({
  state,
  repairCaseId,
  insidePath = "",
  onNavigate,
}: {
  state: ContactFolderSectionState;
  repairCaseId: string;
  insidePath?: string;
  onNavigate?: (insidePath: string) => void;
}) {
  if (state.kind === "disabled") return null;

  const folderName = state.kind === "found" ? state.folderName : "";
  // 🔴 루트 아래의 상대 경로 — 폴더 이름을 모르면 빈 글자다(주소를 지어내지 않는다).
  const placePath = contactFolderPlacePath(folderName, insidePath);
  const atTop = contactFolderPathSegments(insidePath).length === 0;

  return (
    <section
      aria-labelledby="contact-folder-section-title"
      data-contact-folder-section=""
      className="print:hidden flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="contact-folder-section-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {CONTACT_FOLDER_SECTION_TITLE}
        </h2>
        {atTop && state.kind === "found" && state.folderName !== "" && (
          <span className="min-w-0 break-all text-xs text-zinc-500 dark:text-zinc-400">{state.folderName}</span>
        )}
      </div>

      {/* 🔴 하위 폴더에 들어가 있을 때만 — 맨 위에서는 바로 위의 폴더 이름이 그 일을 한다. */}
      {!atTop && (
        <PathTrail
          rootLabel={folderName === "" ? CONTACT_FOLDER_SECTION_TRAIL_ROOT_FALLBACK : folderName}
          insidePath={insidePath}
          onNavigate={onNavigate}
        />
      )}

      {state.kind === "loading" && (
        <p aria-live="polite" className={MUTED_CLASS}>
          {CONTACT_FOLDER_SECTION_LOADING_TEXT}
        </p>
      )}

      {state.kind === "not-found" && <p className={MUTED_CLASS}>{CONTACT_FOLDER_SECTION_NOT_FOUND_TEXT}</p>}

      {/* 🔴 목록을 내지 않는다 — 어느 폴더인지 모르는 채로 내용을 보이면 안 된다. 이름만 적는다. */}
      {state.kind === "multiple" && (
        <div className="flex flex-col gap-1">
          <p className={WARNING_CLASS}>{CONTACT_FOLDER_SECTION_MULTIPLE_TEXT}</p>
          <ul className="flex flex-col gap-0.5">
            {state.folderNames.map((name) => (
              <li key={name} className="break-all text-xs text-zinc-500 dark:text-zinc-400">
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.kind === "failed" && (
        <div className="flex flex-col gap-0.5">
          <p className={WARNING_CLASS}>{CONTACT_FOLDER_SECTION_FAILED_TEXT}</p>
          <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">{state.reason}</p>
        </div>
      )}

      {state.kind === "found" &&
        (state.entries.length === 0 ? (
          <p className={MUTED_CLASS}>
            {atTop ? CONTACT_FOLDER_SECTION_EMPTY_TEXT : CONTACT_FOLDER_SECTION_INSIDE_EMPTY_TEXT}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <EntryList
              entries={state.entries}
              folderPath={placePath}
              // 🔴 들어갈 길은 부르는 쪽이 준다 — 없으면 폴더 줄이 단추가 되지 않는다.
              {...(onNavigate === undefined
                ? {}
                : {
                    onEnter: (name: string) =>
                      onNavigate([...contactFolderPathSegments(insidePath), name].join("/")),
                  })}
            />
            {state.truncated && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {truncatedText(state.entries.length, state.totalCount)}
              </p>
            )}
          </div>
        ))}

      {/*
        🔴 **보고 있는 자리를 연다.** 맨 위에서는 조각 2 의 단추를 그대로 쓰고(폴더가 없을 때
        [폴더 만들고 열기]가 거기 달려 있다), 하위 폴더에서는 그 자리를 여는 단추가 선다.
        둘 다 Windows 가 아니면 스스로 아무것도 그리지 않는다.
      */}
      {atTop || placePath === "" ? (
        <ContactFolderOpenButton repairCaseId={repairCaseId} />
      ) : (
        <ContactFolderPlaceOpenButton relativePath={placePath} />
      )}
    </section>
  );
}

/**
 * 화면이 뜬 **뒤에** 따로 통로를 부른다. 떠난 뒤에 답이 와도 상태를 건드리지 않는다.
 *
 * 받은 답은 **어느 수리 건의 · 어느 자리의 것인지와 함께** 든다(조각 2 의 결과 줄과 같은
 * 모양이다). 그래야 수리 건이나 자리가 바뀌었을 때 지난 폴더의 목록이 잠깐 비치지 않는다 —
 * 효과 안에서 상태를 「불러오는 중」으로 되돌리면 그릴 때마다 한 번 더 그리게 된다.
 *
 * ── 🔴 자리는 수리 건에 묶어 둔다 ────────────────────────────────────────
 * 다른 수리 건으로 넘어가면 **맨 위로** 돌아간다. 자리를 수리 건과 함께 들고 있으면 효과를
 * 하나 더 두지 않고 그릴 때 알 수 있다.
 *
 * ── 🔴 「다시 읽어라」(reloadToken) ──────────────────────────────────────
 * 숫자가 바뀌면 **보고 있던 자리 그대로** 다시 읽는다(파일 관리 화면이 올리기를 끝낸 뒤
 * 올린다 — FilesScreen). 읽는 동안에도 지난 목록이 그대로 보이고, 다시 읽기가 실패하면 이
 * 구역만 「읽지 못했습니다」가 된다 — 올리기 결과 알림은 저쪽 화면의 것이라 그대로 남는다.
 */
export default function ContactFolderSection({
  repairCaseId,
  reloadToken = 0,
}: {
  repairCaseId: string;
  /** 숫자가 바뀔 때마다 이 구역을 다시 읽는다. 자리는 그대로 둔다. */
  reloadToken?: number;
}) {
  const [place, setPlace] = useState<{ repairCaseId: string; path: string }>({ repairCaseId, path: "" });
  const insidePath = place.repairCaseId === repairCaseId ? place.path : "";
  const [answer, setAnswer] = useState<{
    repairCaseId: string;
    path: string;
    state: ContactFolderSectionState;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadContactFolderEntries(repairCaseId, undefined, insidePath).then((state) => {
      if (!cancelled) setAnswer({ repairCaseId, path: insidePath, state });
    });
    return () => {
      cancelled = true;
    };
  }, [repairCaseId, insidePath, reloadToken]);

  const state: ContactFolderSectionState =
    answer !== null && answer.repairCaseId === repairCaseId && answer.path === insidePath
      ? answer.state
      : { kind: "loading" };

  return (
    <ContactFolderSectionView
      state={state}
      repairCaseId={repairCaseId}
      insidePath={insidePath}
      onNavigate={(next) => setPlace({ repairCaseId, path: next })}
    />
  );
}
