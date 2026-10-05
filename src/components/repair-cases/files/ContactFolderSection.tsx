"use client";

import { useEffect, useState } from "react";

import ContactFolderOpenButton from "@/components/repair-cases/detail/ContactFolderOpenButton";
import { isOpenableQuoteFolderFileName } from "@/lib/domain/quote-folder-file-link";
import { formatBytes } from "@/lib/domain/image-shrink";
import ContactFolderEntryOpenButton from "./ContactFolderEntryOpenButton";

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
 *  · 하위 폴더로 내려가는 길은 없다 — 폴더 줄은 이름만 보인다.
 * 맨 아래 [폴더 열기]는 조각 2 가 만든 단추를 **그대로** 쓴다
 * (components/repair-cases/detail/ContactFolderOpenButton).
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
 *  · `found` + 목록 → 줄마다 이름 · 크기 · 수정시각, 폴더는 폴더 표시
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

export function contactFolderEntriesUrl(repairCaseId: string): string {
  return `/api/repair-cases/${encodeURIComponent(repairCaseId)}/contact-folder/entries`;
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
  fetchImpl: ContactFolderEntriesFetch = (url) => fetch(url)
): Promise<ContactFolderSectionState> {
  let response: EntriesResponse;
  try {
    response = await fetchImpl(contactFolderEntriesUrl(repairCaseId));
  } catch {
    return { kind: "failed", reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { kind: "failed", reason: await failureReason(response) };
  const answer = readContactFolderEntriesAnswer(await response.json().catch(() => null));
  return answer ?? { kind: "failed", reason: UNREADABLE_RESPONSE_REASON };
}

// ── 그리기 ───────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

/** 한 줄의 곁말 — 폴더는 크기 대신 「폴더」, 파일은 크기. 수정 시각은 있을 때만. */
export function entryMetaText(entry: ContactFolderEntryView): string {
  const pieces = [entry.isDirectory ? CONTACT_FOLDER_SECTION_FOLDER_LABEL : formatBytes(entry.sizeBytes)];
  if (entry.modifiedAt !== undefined) pieces.push(formatTimestamp(entry.modifiedAt));
  return pieces.join(" · ");
}

/**
 * 🔴 이 줄에 [열기]를 그릴 것인가 — **폴더는 아니고**, 이름이 허용 목록에 든 확장자인가.
 * 판단은 순수 함수 하나(domain/quote-folder-file-link.ts)에만 있다 — 화면이 확장자를 따로
 * 세지 않는다. `.exe` 가 목록에 섞여 있어도 누를 단추가 없어야 한다.
 */
export function canOpenContactFolderEntry(entry: ContactFolderEntryView): boolean {
  return !entry.isDirectory && isOpenableQuoteFolderFileName(entry.name);
}

function EntryList({ entries, folderName }: { entries: readonly ContactFolderEntryView[]; folderName: string }) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {entries.map((entry) => {
        const openable = folderName !== "" && canOpenContactFolderEntry(entry);
        return (
          <li
            key={`${entry.isDirectory ? "d" : "f"}:${entry.name}`}
            data-contact-folder-entry-openable={openable ? "" : undefined}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5"
          >
            <span className="min-w-0 break-all text-sm text-zinc-700 dark:text-zinc-300">
              {entry.isDirectory ? "📁 " : ""}
              {entry.name}
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{entryMetaText(entry)}</span>
              {/* 🔴 폴더 줄 · 허용 목록 밖 줄에는 아무것도 두지 않는다(단추 자리 자체가 없다). */}
              {openable && <ContactFolderEntryOpenButton folderName={folderName} fileName={entry.name} />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const MUTED_CLASS = "text-sm text-zinc-500 dark:text-zinc-400";
const WARNING_CLASS = "text-sm font-medium text-amber-700 dark:text-amber-400";

/** 상태 하나를 그린다. 🔴 `disabled` 면 **아무것도 그리지 않는다**(null). */
export function ContactFolderSectionView({
  state,
  repairCaseId,
}: {
  state: ContactFolderSectionState;
  repairCaseId: string;
}) {
  if (state.kind === "disabled") return null;

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
        {state.kind === "found" && state.folderName !== "" && (
          <span className="min-w-0 break-all text-xs text-zinc-500 dark:text-zinc-400">{state.folderName}</span>
        )}
      </div>

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
          <p className={MUTED_CLASS}>{CONTACT_FOLDER_SECTION_EMPTY_TEXT}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <EntryList entries={state.entries} folderName={state.folderName} />
            {state.truncated && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {truncatedText(state.entries.length, state.totalCount)}
              </p>
            )}
          </div>
        ))}

      {/* 🔴 조각 2 의 단추를 그대로 쓴다 — Windows 가 아니면 스스로 아무것도 그리지 않는다. */}
      <ContactFolderOpenButton repairCaseId={repairCaseId} />
    </section>
  );
}

/**
 * 화면이 뜬 **뒤에** 따로 통로를 부른다. 떠난 뒤에 답이 와도 상태를 건드리지 않는다.
 *
 * 받은 답은 **어느 수리 건의 것인지와 함께** 든다(조각 2 의 결과 줄과 같은 모양이다).
 * 그래야 수리 건이 바뀌었을 때 지난 폴더의 목록이 잠깐 비치지 않는다 — 효과 안에서
 * 상태를 「불러오는 중」으로 되돌리면 그릴 때마다 한 번 더 그리게 된다.
 */
export default function ContactFolderSection({ repairCaseId }: { repairCaseId: string }) {
  const [answer, setAnswer] = useState<{ repairCaseId: string; state: ContactFolderSectionState } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadContactFolderEntries(repairCaseId).then((state) => {
      if (!cancelled) setAnswer({ repairCaseId, state });
    });
    return () => {
      cancelled = true;
    };
  }, [repairCaseId]);

  const state: ContactFolderSectionState =
    answer !== null && answer.repairCaseId === repairCaseId ? answer.state : { kind: "loading" };

  return <ContactFolderSectionView state={state} repairCaseId={repairCaseId} />;
}
