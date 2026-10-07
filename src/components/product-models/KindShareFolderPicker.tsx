"use client";

import { useEffect, useState } from "react";

import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";
import {
  contactFolderParentPath,
  contactFolderPathSegments,
} from "@/components/repair-cases/files/ContactFolderSection";
import type { QuoteIssueNoticeLine } from "@/components/quotes/quote-issue-messages";
import { formatBytes } from "@/lib/domain/image-shrink";
import type { ProductModelKind } from "@/lib/domain/product-model-kind";
import { isOpenableQuoteFolderFileName } from "@/lib/domain/quote-folder-file-link";

/**
 * ============================================================================
 * 종류별 공통 서류 — **공유폴더에서 고르는 창** (2026-10-07)
 * ============================================================================
 * 「공통서류를 업로드 하는 곳에 파일 경로를 입력해서 파일을 직접 열 수 있도록 … 지정되는
 * 파일은 **업로드 되는게 아니라** … **파일 뿐 아니라 폴더도** 지정할 수 있도록」
 * (사용자 요구 2026-10-07). 사용자가 **수리 건 상세 「파일 관리」의 공유폴더 구역**을 직접
 * 가리키며 「그렇게 보일 수 있도록」이라고 했다 — 그래서 이 창은 그 구역
 * (repair-cases/files/ContactFolderSection.tsx)을 **본떠** 만들었다. 다른 점은 하나다:
 * 저기는 **보는 것**이 목적이고 여기는 **고르는 것**이 목적이라, 줄마다 [담기]가 있다.
 *
 * ── 🔴 폴더 줄에도 [담기]가 있다 ─────────────────────────────────────────
 * 사용자가 「파일 뿐 아니라 폴더도」라고 못 박았다. 파일 줄은 `FILE`, 폴더 줄은 `FOLDER`
 * 로 담기고, 그 둘의 차이는 **여는 쪽의 동작**이다(파일은 연결 프로그램, 폴더는 탐색기).
 *
 * ── 🔴 왜 [열기]도 함께 두는가 ───────────────────────────────────────────
 * 담기 전에 **그 파일이 맞는지** 확인하고 싶은 자리라서다. 본보기에도 있고, 단추는 그쪽
 * 것을 **그대로** 쓴다(ContactFolderEntryOpenButton — 베끼지 않는다).
 * 🔴 다만 **하위 폴더에 들어가 있을 때만** 그린다: 그 단추가 받는 주소는 `폴더/파일` 모양
 * 이고, 공유폴더 **맨 위 칸의 파일**은 앞에 붙일 폴더가 없어 주소를 만들 수 없다
 * (`/연락서.pdf` 는 경로 규칙이 거절한다). 눌러서 거절당하는 것보다 단추가 없는 것이 낫다.
 *
 * ── 🔴 서버를 새로 만들지 않았다 ─────────────────────────────────────────
 *  · 읽기 — `GET /api/product-model-kinds/{kind}/share-folder/entries?path=…`
 *    🔴 그 통로에는 **출처 검사가 한 겹 더** 있다. `fetch` 로만 부른다 —
 *    `<a href>` 나 새 탭으로 열면 403 이다.
 *  · 담기 — 서버 액션. 🔴 **이 파일은 그것을 import 하지 않는다**: `onAdd` 로 받는다.
 *    서버 액션을 직접 물면 사슬 끝의 `server-only` 때문에 test:components 에서 이 조각을
 *    **그려 볼 수조차 없게** 된다(이웃 ProductModelKindFilesScreen 이 그 상태다).
 *
 * ── 🔴 거절 사유는 서버 말을 그대로 ──────────────────────────────────────
 * `DUPLICATE` · `ENTRY_NOT_FOUND` · `ENTRY_KIND_MISMATCH` · `INVALID_PATH` ·
 * `SHARE_FOLDER_DISABLED` · `SHARE_FOLDER_FAILED` 에 딸린 한국어 한 줄이 액션에서 온다.
 * 여기서 말을 **새로 짓지 않는다** — 받은 문장을 그대로 보인다.
 *
 * ── 🔴 서버 컴포넌트에서 공유폴더를 읽지 않는다 ───────────────────────────
 * 화면이 뜬 **뒤**에 이 조각이 따로 통로를 부른다. NAS 가 느린 날 서류함 화면 자체가
 * 안 뜨는 것을 막는다(본보기의 같은 머리말).
 *
 * ── 상태별로 무엇을 보이는가 ─────────────────────────────────────────────
 *  · `disabled` → 🔴 **창 자체를 그리지 않는다**(설정이 없는 환경 = 지금 개발 PC)
 *  · 불러오는 중 → 「불러오는 중…」 / 빈 폴더 → 「이 폴더가 비어 있습니다」
 *  · `failed`   → 「공유폴더를 읽지 못했습니다」 + 짧은 사유
 *
 * ── 🔴 인쇄에 안 찍힌다 · 바꿔 끼울 수 있다 ───────────────────────────────
 * 바깥 틀에 `print:hidden`. fetch 는 부르는 쪽이 바꿔 끼울 수 있고, 그려지는 것은 상태를
 * 직접 넣어 본다(product-model-kind-share-docs-screen.test.tsx).
 * ============================================================================
 */

// ── 주소 · 길 ────────────────────────────────────────────────────────────

/**
 * 목록 통로의 주소. 🔴 하위 폴더에 들어가 있을 때만 `?path=…` 가 붙는다.
 * 🔴 **`fetch` 로만 부른다** — 그 통로는 출처를 본다(파일 머리말).
 */
export function kindShareFolderEntriesUrl(kind: string, insidePath = ""): string {
  const url = `/api/product-model-kinds/${encodeURIComponent(kind)}/share-folder/entries`;
  return insidePath === "" ? url : `${url}?path=${encodeURIComponent(insidePath)}`;
}

/**
 * 🔴 지금 자리에 이름을 이어 **루트 기준 상대 경로**를 만든다 — 담을 때 서버로 가는 값이다.
 * 맨 위 칸이면 이름 하나뿐이다.
 */
export function kindShareFolderEntryPath(insidePath: string, name: string): string {
  return [...contactFolderPathSegments(insidePath), name].join("/");
}

// ── 문장 ─────────────────────────────────────────────────────────────────

export const KIND_SHARE_FOLDER_PICKER_TITLE = "공유폴더에서 고르기";
export const KIND_SHARE_FOLDER_PICKER_HINT =
  "고른 자리는 가리켜 두기만 합니다 — 파일이 이 시스템으로 올라오지 않습니다.";
export const KIND_SHARE_FOLDER_LOADING_TEXT = "불러오는 중…";
export const KIND_SHARE_FOLDER_EMPTY_TEXT = "이 폴더가 비어 있습니다";
export const KIND_SHARE_FOLDER_FAILED_TEXT = "공유폴더를 읽지 못했습니다";
/** 폴더 한 줄에 붙는 표시 — 크기 자리를 대신한다. */
export const KIND_SHARE_FOLDER_FOLDER_LABEL = "폴더";
export const KIND_SHARE_FOLDER_TRAIL_LABEL = "공유폴더 위치";
/** 길 표시의 맨 앞 토막 — 루트는 이름이 없다(설정값이고, 화면으로 나오지 않는다). */
export const KIND_SHARE_FOLDER_TRAIL_ROOT_TEXT = "공유폴더";
export const KIND_SHARE_FOLDER_UP_TEXT = "위로";
export const KIND_SHARE_FOLDER_ADD_FILE_TEXT = "이 파일 담기";
export const KIND_SHARE_FOLDER_ADD_FOLDER_TEXT = "이 폴더 담기";

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버 응답을 읽지 못했습니다";
const UNKNOWN_REASON = "까닭을 알 수 없습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

/** 🔴 잘렸을 때의 곁말. 「더 있습니다」가 반드시 들어간다. */
export function kindShareFolderTruncatedText(shown: number, totalCount: number): string {
  return `앞의 ${shown}개만 보입니다 — 더 있습니다(전체 ${totalCount}개). 하위 폴더로 들어가 좁혀 보세요.`;
}

/** 담긴 뒤의 한 줄. 이름이 아니라 **담긴 경로**를 적는다 — 어느 자리인지가 중요하다. */
export function kindShareFolderAddedText(relativePath: string): string {
  return `담았습니다: ${relativePath}`;
}

// ── 값 ───────────────────────────────────────────────────────────────────

/** 🔴 **경로를 담는 칸이 없다** — 이름은 그 폴더 안에서의 이름뿐이다(통로의 응답 모양). */
export type KindShareFolderEntryView = {
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  /** 수정 시각(ISO). 서버가 못 읽었으면 칸이 통째로 없다. */
  modifiedAt?: string;
};

export type KindShareFolderPickerState =
  | { kind: "loading" }
  /** 🔴 이 상태에서는 창을 아예 그리지 않는다. */
  | { kind: "disabled" }
  | { kind: "failed"; reason: string }
  | { kind: "listed"; entries: KindShareFolderEntryView[]; totalCount: number; truncated: boolean };

/** 담아 달라고 할 때 넘기는 것 — 종류는 부르는 쪽이 안다. */
export type KindShareFolderAddRequest = {
  entryKind: "FILE" | "FOLDER";
  /** 🔴 공유폴더 루트 **기준 상대 경로**. 마디 구분은 `/` 다. */
  relativePath: string;
};

/** 담기의 답. 🔴 거절 문장은 **서버 말 그대로** 올라온다. */
export type KindShareFolderAddAnswer = { ok: true } | { ok: false; message: string };

export type KindShareFolderAdd = (request: KindShareFolderAddRequest) => Promise<KindShareFolderAddAnswer>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 한 줄을 읽는다. 이름이 없으면 그 줄만 버린다 — 나머지 줄은 그대로 보인다. */
function readEntry(value: unknown): KindShareFolderEntryView | null {
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
export function readKindShareFolderEntriesAnswer(payload: unknown): KindShareFolderPickerState | null {
  if (!isRecord(payload)) return null;
  switch (payload.status) {
    case "listed": {
      const entries = Array.isArray(payload.entries)
        ? payload.entries.map(readEntry).filter((entry): entry is KindShareFolderEntryView => entry !== null)
        : [];
      const totalCount =
        typeof payload.totalCount === "number" &&
        Number.isFinite(payload.totalCount) &&
        payload.totalCount >= entries.length
          ? payload.totalCount
          : entries.length;
      return {
        kind: "listed",
        entries,
        totalCount,
        truncated: payload.truncated === true && totalCount > entries.length,
      };
    }
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

export type KindShareFolderEntriesFetch = (url: string) => Promise<EntriesResponse>;

/** 실패 응답 `{ error, code }` 의 문장 — 서버 문장 그대로다. */
async function failureReason(response: EntriesResponse): Promise<string> {
  const payload = await response.json().catch(() => null);
  const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
  return error !== "" ? error : rejectedReason(response.status);
}

/**
 * 통로를 한 번 부른다. **던지지 않는다** — 무슨 일이 나도 `failed` 한 상태로 끝난다.
 * 이 창이 실패해도 같은 화면의 올린 파일 목록 · 가리킴 목록은 아무 영향을 받지 않는다.
 */
export async function loadKindShareFolderEntries(
  kind: string,
  fetchImpl: KindShareFolderEntriesFetch = (url) => fetch(url),
  insidePath = ""
): Promise<KindShareFolderPickerState> {
  let response: EntriesResponse;
  try {
    response = await fetchImpl(kindShareFolderEntriesUrl(kind, insidePath));
  } catch {
    return { kind: "failed", reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { kind: "failed", reason: await failureReason(response) };
  const answer = readKindShareFolderEntriesAnswer(await response.json().catch(() => null));
  return answer ?? { kind: "failed", reason: UNREADABLE_RESPONSE_REASON };
}

// ── 그리기 ───────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

/** 한 줄의 곁말 — 폴더는 크기 대신 「폴더」, 파일은 크기. 수정 시각은 있을 때만. */
export function kindShareFolderEntryMetaText(entry: KindShareFolderEntryView): string {
  const pieces = [entry.isDirectory ? KIND_SHARE_FOLDER_FOLDER_LABEL : formatBytes(entry.sizeBytes)];
  if (entry.modifiedAt !== undefined) pieces.push(formatTimestamp(entry.modifiedAt));
  return pieces.join(" · ");
}

/**
 * 🔴 이 줄에 [열기]를 그릴 것인가. 셋을 **모두** 만족해야 한다:
 *  ① 폴더가 아니다 ② 이름이 허용 목록에 든 확장자다(domain 의 순수 함수 하나로만 센다)
 *  ③ 🔴 하위 폴더에 들어가 있다 — 맨 위 칸의 파일은 앞에 붙일 폴더가 없어 도우미 주소를
 *     만들 수 없다(파일 머리말).
 */
export function canOpenKindShareFolderEntry(entry: KindShareFolderEntryView, insidePath: string): boolean {
  if (insidePath === "") return false;
  return !entry.isDirectory && isOpenableQuoteFolderFileName(entry.name);
}

const ENTRY_NAME_CLASS = "min-w-0 break-all text-left text-sm text-zinc-700 dark:text-zinc-300";
const SMALL_BUTTON_CLASS =
  "shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";

const MUTED_CLASS = "text-sm text-zinc-500 dark:text-zinc-400";
const WARNING_CLASS = "text-sm font-medium text-amber-700 dark:text-amber-400";

const NOTICE_TONE_CLASS: Record<QuoteIssueNoticeLine["tone"], string> = {
  normal: "text-zinc-700 dark:text-zinc-300",
  muted: "text-zinc-400 dark:text-zinc-500",
  warning: "font-medium text-amber-700 dark:text-amber-400",
};

/**
 * 한 줄의 이름. 폴더 줄은 **들어갈 수 있을 때만** 단추가 된다 — 들어갈 길(onEnter)을 주지
 * 않는 자리(시험 · 보여 주기만 하는 화면)에서는 이름만 선다.
 */
function EntryName({
  entry,
  onEnter,
}: {
  entry: KindShareFolderEntryView;
  onEnter?: (name: string) => void;
}) {
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
      data-kind-share-folder-enter=""
      title={`${entry.name} 폴더 안을 봅니다`}
      className={`${ENTRY_NAME_CLASS} underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100`}
    >
      📁 {entry.name}
    </button>
  );
}

function EntryList({
  entries,
  insidePath,
  busy,
  onEnter,
  onAdd,
}: {
  entries: readonly KindShareFolderEntryView[];
  insidePath: string;
  busy: boolean;
  onEnter?: (name: string) => void;
  /** 🔴 주지 않으면 담기 단추가 **한 줄에도** 그려지지 않는다(권한이 없는 사람). */
  onAdd?: (request: KindShareFolderAddRequest) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {entries.map((entry) => {
        const openable = canOpenKindShareFolderEntry(entry, insidePath);
        return (
          <li
            key={`${entry.isDirectory ? "d" : "f"}:${entry.name}`}
            data-kind-share-folder-entry=""
            data-kind-share-folder-entry-openable={openable ? "" : undefined}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5"
          >
            <EntryName entry={entry} onEnter={onEnter} />
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {kindShareFolderEntryMetaText(entry)}
              </span>
              {/* 🔴 폴더 줄 · 허용 목록 밖 줄 · 맨 위 칸에는 아무것도 두지 않는다. */}
              {openable && (
                <ContactFolderEntryOpenButton folderName={insidePath} fileName={entry.name} />
              )}
              {/* 🔴 **폴더 줄에도 있다** — 사용자가 「파일 뿐 아니라 폴더도」라고 했다. */}
              {onAdd !== undefined && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    onAdd({
                      entryKind: entry.isDirectory ? "FOLDER" : "FILE",
                      relativePath: kindShareFolderEntryPath(insidePath, entry.name),
                    })
                  }
                  data-kind-share-folder-add=""
                  className={SMALL_BUTTON_CLASS}
                >
                  {entry.isDirectory ? KIND_SHARE_FOLDER_ADD_FOLDER_TEXT : KIND_SHARE_FOLDER_ADD_FILE_TEXT}
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 길 표시 — 「공유폴더 › 2. 인수시 서류 › MB」. 토막마다 그 자리로 돌아가는 단추가 되고,
 * 마지막 토막(지금 자리)은 단추가 아니다. 돌아갈 길(onNavigate)이 없으면 글자만 선다.
 * 🔴 맨 위에서도 그린다 — 여기는 「어느 서류함인가」를 머리에 적어 줄 폴더 이름이 없다.
 */
function PathTrail({
  insidePath,
  onNavigate,
}: {
  insidePath: string;
  onNavigate?: (insidePath: string) => void;
}) {
  const segments = contactFolderPathSegments(insidePath);
  const steps = [
    { label: KIND_SHARE_FOLDER_TRAIL_ROOT_TEXT, path: "" },
    ...segments.map((segment, index) => ({ label: segment, path: segments.slice(0, index + 1).join("/") })),
  ];
  const lastIndex = steps.length - 1;
  return (
    <nav
      aria-label={KIND_SHARE_FOLDER_TRAIL_LABEL}
      data-kind-share-folder-trail=""
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
              data-kind-share-folder-trail-step=""
              className="min-w-0 break-all text-left underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              {step.label}
            </button>
          )}
        </span>
      ))}
      {/* 맨 위에서는 올라갈 곳이 없다 — 단추 자체를 두지 않는다. */}
      {onNavigate !== undefined && segments.length > 0 && (
        <button
          type="button"
          onClick={() => onNavigate(contactFolderParentPath(insidePath))}
          data-kind-share-folder-up=""
          className={SMALL_BUTTON_CLASS}
        >
          {KIND_SHARE_FOLDER_UP_TEXT}
        </button>
      )}
    </nav>
  );
}

/**
 * 상태 하나를 그린다. 🔴 `disabled` 면 **아무것도 그리지 않는다**(null).
 * 🔴 옮겨 다닐 길(onNavigate) · 담을 길(onAdd)을 주지 않으면 **누를 수 있는 것이 생기지 않는다**.
 */
export function KindShareFolderPickerView({
  state,
  insidePath = "",
  busy = false,
  notice = null,
  onNavigate,
  onAdd,
}: {
  state: KindShareFolderPickerState;
  insidePath?: string;
  busy?: boolean;
  /** 담기의 결과 한 줄. 🔴 거절이면 **서버 문장 그대로**다. */
  notice?: QuoteIssueNoticeLine | null;
  onNavigate?: (insidePath: string) => void;
  onAdd?: (request: KindShareFolderAddRequest) => void;
}) {
  if (state.kind === "disabled") return null;

  return (
    <div
      data-kind-share-folder-picker=""
      className="print:hidden flex flex-col gap-2 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
          {KIND_SHARE_FOLDER_PICKER_TITLE}
        </h3>
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{KIND_SHARE_FOLDER_PICKER_HINT}</span>
      </div>

      <PathTrail insidePath={insidePath} onNavigate={onNavigate} />

      {notice && (
        <p role="status" className={`break-all text-xs ${NOTICE_TONE_CLASS[notice.tone]}`}>
          {notice.text}
        </p>
      )}

      {state.kind === "loading" && (
        <p aria-live="polite" className={MUTED_CLASS}>
          {KIND_SHARE_FOLDER_LOADING_TEXT}
        </p>
      )}

      {state.kind === "failed" && (
        <div className="flex flex-col gap-0.5">
          <p className={WARNING_CLASS}>{KIND_SHARE_FOLDER_FAILED_TEXT}</p>
          <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">{state.reason}</p>
        </div>
      )}

      {state.kind === "listed" &&
        (state.entries.length === 0 ? (
          <p className={MUTED_CLASS}>{KIND_SHARE_FOLDER_EMPTY_TEXT}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <EntryList
              entries={state.entries}
              insidePath={insidePath}
              busy={busy}
              {...(onNavigate === undefined
                ? {}
                : { onEnter: (name: string) => onNavigate(kindShareFolderEntryPath(insidePath, name)) })}
              {...(onAdd === undefined ? {} : { onAdd })}
            />
            {state.truncated && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {kindShareFolderTruncatedText(state.entries.length, state.totalCount)}
              </p>
            )}
          </div>
        ))}
    </div>
  );
}

/**
 * 화면이 뜬 **뒤에** 따로 통로를 부른다. 떠난 뒤에 답이 와도 상태를 건드리지 않는다.
 * 받은 답은 **어느 자리의 것인지와 함께** 든다 — 자리가 바뀌었을 때 지난 폴더의 목록이
 * 잠깐 비치지 않게.
 */
export default function KindShareFolderPicker({
  kind,
  onAdd,
}: {
  kind: ProductModelKind;
  /** 🔴 주지 않으면 담기 단추가 하나도 안 그려진다 — 권한 판정은 부르는 쪽이 한다. */
  onAdd?: KindShareFolderAdd;
}) {
  const [insidePath, setInsidePath] = useState("");
  const [answer, setAnswer] = useState<{ path: string; state: KindShareFolderPickerState } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<QuoteIssueNoticeLine | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadKindShareFolderEntries(kind, undefined, insidePath).then((state) => {
      if (!cancelled) setAnswer({ path: insidePath, state });
    });
    return () => {
      cancelled = true;
    };
  }, [kind, insidePath]);

  const state: KindShareFolderPickerState =
    answer !== null && answer.path === insidePath ? answer.state : { kind: "loading" };

  async function handleAdd(request: KindShareFolderAddRequest) {
    if (busy || onAdd === undefined) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await onAdd(request);
      // 🔴 거절 문장을 지어내지 않는다 — 서버가 준 말을 그대로 적는다.
      setNotice(
        result.ok
          ? { text: kindShareFolderAddedText(request.relativePath), tone: "normal" }
          : { text: result.message, tone: "warning" }
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KindShareFolderPickerView
      state={state}
      insidePath={insidePath}
      busy={busy}
      notice={notice}
      onNavigate={(next) => {
        setNotice(null);
        setInsidePath(next);
      }}
      {...(onAdd === undefined ? {} : { onAdd: (request: KindShareFolderAddRequest) => void handleAdd(request) })}
    />
  );
}
