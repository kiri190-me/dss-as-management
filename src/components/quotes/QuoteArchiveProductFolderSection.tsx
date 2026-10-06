"use client";

import { useEffect, useState } from "react";

import ContactFolderPlaceOpenButton from "@/components/repair-cases/files/ContactFolderPlaceOpenButton";

/**
 * ============================================================================
 * **같은 장비의 지난 견적서** 구역 — 이 장비(L/N + S/N)가 예전에 받은 폴더들 (2026-10-06)
 * ============================================================================
 * 수리 건 「견적서」 탭의 맨 아래에 선다. 같은 장비가 해를 걸러 다시 들어오는 일이 흔해서,
 * 지난 견적서를 탐색기로 뒤지던 일을 그 자리에서 대신한다. 줄마다 [열기]로 **그 폴더**를
 * 탐색기에서 연다.
 *
 * ── 🔴 바로 위의 「이 건의 견적서 폴더」 구역과 **다른 것**이다 ───────────
 * 그 구역(QuoteArchiveFolderSection)은 **이 수리 건에 등록된 견적서**의 폴더 안을 보여 준다.
 * 여기는 **같은 장비가 예전에 받은** 폴더들이고, 그중에는 지금 수리 건과 무관한 옛날 건이
 * 섞인다. 그래서 구역을 나눠 따로 세운다(사용자 결정 2026-10-06). 🔴 **겹치는 폴더는
 * 서버가 뺀다** — 이 건에 등록된 견적서 번호의 폴더는 통로가 거르고 내려보내지 않는다.
 *
 * ── 🔴 여는 장치는 **이미 있는 것을 그대로 쓴다** ────────────────────────
 * 줄의 [열기]와 그 뒤 흐름(숨은 iframe · 도우미 감지 · 「설치 명령 복사」)은 연락서 쪽이 쓰는
 * 자리 열기 단추(ContactFolderPlaceOpenButton)를 **한 글자도 고치지 않고** 가져다 쓴다.
 * 그 단추가 받는 값은 **공유폴더 루트 아래의 폴더 경로**라, 통로가 준 `연도 폴더/견적서 폴더`
 * 를 그대로 넘기면 된다. 베껴 두 벌을 만들면 반드시 한쪽만 고쳐진다 — 설치되는 도우미는
 * **PC 당 한 벌**이다. 🔴 폴더 이름이 도우미 주소 규칙 밖이면 그 단추가 스스로 「공유폴더에서
 * 직접 열어 주세요」라고 알린다 — 화면이 줄을 미리 숨기지 않는다.
 *
 * ── 🔴 없으면 구역을 **아예 그리지 않는다** ──────────────────────────────
 *  · 불러오는 중 → 아무것도 안 그린다(빈 상자가 깜박였다 사라지지 않게)
 *  · `disabled`(공유폴더 설정이 없다) → 안 그린다
 *  · 찾은 것이 0 건 → 안 그린다. 「없습니다」 상자를 괜히 세우지 않는다
 *  · `failed` → **짧게 알린다.** 조용히 사라지면 「없는 것」인지 「못 읽은 것」인지 모른다
 * L/N 이나 S/N 이 없는 수리 건에서는 **부르는 쪽(탭)이** 이 구역을 아예 그리지 않는다
 * (quote-archive-product-keys.ts 의 hasQuoteArchiveProductKeys) — 통로를 부르지도 않는다.
 * 🔴 그 판정은 **이 파일에 두지 않는다** — 서버 컴포넌트가 부르는데 이 파일은 `"use client"`
 * 라, 여기서 내보내면 탭이 열리지 않는다. 까닭은 그 파일 머리말에 적었다.
 *
 * ── 🔴 서버 컴포넌트에서 공유폴더를 읽지 않는다 ───────────────────────────
 * 탭이 뜰 때 공유폴더를 읽으면 **NAS 가 느리거나 꺼져 있는 날 탭 자체가 안 뜬다.** 화면이 뜬
 * 뒤 여기서 따로 통로를 부른다 — 이 구역만 조용하고 견적서 목록은 멀쩡하다. 바로 위 구역과
 * 같은 규율이다.
 *
 * ── 🔴 인쇄에 안 찍힌다 ─────────────────────────────────────────────────
 * 공유폴더는 그때그때 달라지는 바깥 사정이라 종이에 남길 것이 아니다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ──────────────────────────────────────
 * fetch 를 부르는 쪽이 바꿔 끼울 수 있다 — 네트워크 없이 값으로 시험한다. 그려지는 것은
 * 상태를 직접 넣어 본다(QuoteArchiveProductFolderSection.test.tsx).
 * ============================================================================
 */

/** 목록 통로의 주소. */
export function quoteArchiveProductFoldersUrl(repairCaseId: string): string {
  return `/api/repair-cases/${encodeURIComponent(repairCaseId)}/quote-archive-folders`;
}

// ── 문장 ─────────────────────────────────────────────────────────────────

/** 머리 — 몇 건을 찾았는지 함께 적는다. */
export function quoteArchiveProductFolderSectionTitle(count: number): string {
  return `같은 장비의 지난 견적서 (${count}건)`;
}

export const QUOTE_ARCHIVE_PRODUCT_FOLDER_SECTION_FAILED_TEXT = "지난 견적서를 찾지 못했습니다";

/** 🔴 상한에 걸렸을 때의 곁말. 「더 있습니다」가 반드시 들어간다. */
export const QUOTE_ARCHIVE_PRODUCT_FOLDER_SECTION_TRUNCATED_TEXT =
  "찾은 폴더가 많아 앞의 것만 보입니다 — 더 있습니다. 나머지는 공유폴더에서 직접 보세요.";

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버 응답을 읽지 못했습니다";
const UNKNOWN_REASON = "까닭을 알 수 없습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

/** 줄의 번호 곁말 — 뽑은 번호가 없으면 빈 글자다(자리를 비워 둔다). */
export function quoteArchiveProductFolderNumbersText(quoteNumbers: readonly string[]): string {
  return quoteNumbers.length === 0 ? "" : `번호: ${quoteNumbers.join(" · ")}`;
}

/** 줄의 파일 수 곁말. */
export function quoteArchiveProductFolderFileCountText(fileCount: number): string {
  return `파일 ${fileCount}개`;
}

// ── 값 ───────────────────────────────────────────────────────────────────

/** 폴더 한 줄. 🔴 **절대 경로를 담는 칸이 없다.** */
export type QuoteArchiveProductFolderView = {
  year: number;
  folderName: string;
  /** 루트 기준 상대 경로 — `연도 폴더/견적서 폴더`. 줄의 [열기] 주소에 쓴다. */
  relativePath: string;
  quoteNumbers: string[];
  fileCount: number;
};

export type QuoteArchiveProductFolderSectionState =
  /** 🔴 아래 셋은 **아무것도 그리지 않는다.** */
  | { kind: "loading" }
  | { kind: "disabled" }
  | { kind: "failed"; reason: string }
  | { kind: "found"; folders: QuoteArchiveProductFolderView[]; truncated: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];
}

/** 한 줄을 읽는다. 폴더 이름이나 경로가 없으면 그 줄만 버린다 — 나머지 줄은 그대로 보인다. */
function readFolder(value: unknown): QuoteArchiveProductFolderView | null {
  if (!isRecord(value)) return null;
  if (typeof value.folderName !== "string" || value.folderName === "") return null;
  if (typeof value.relativePath !== "string" || value.relativePath === "") return null;
  return {
    year: typeof value.year === "number" && Number.isFinite(value.year) ? value.year : 0,
    folderName: value.folderName,
    relativePath: value.relativePath,
    quoteNumbers: readStrings(value.quoteNumbers),
    fileCount: typeof value.fileCount === "number" && Number.isFinite(value.fileCount) ? value.fileCount : 0,
  };
}

/** 🔴 알려진 칸만 옮긴다 — 응답에 다른 칸이 끼어 있어도 화면까지 오지 않는다. 모양이 다르면 null. */
export function readQuoteArchiveProductFoldersAnswer(
  payload: unknown
): QuoteArchiveProductFolderSectionState | null {
  if (!isRecord(payload)) return null;
  switch (payload.status) {
    case "found": {
      const folders = Array.isArray(payload.folders)
        ? payload.folders.map(readFolder).filter((folder): folder is QuoteArchiveProductFolderView => folder !== null)
        : [];
      return { kind: "found", folders, truncated: payload.truncated === true };
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

type FoldersResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type QuoteArchiveProductFoldersFetch = (url: string) => Promise<FoldersResponse>;

/** 실패 응답 `{ error, code }` 의 문장 — 서버 문장 그대로다. */
async function failureReason(response: FoldersResponse): Promise<string> {
  const payload = await response.json().catch(() => null);
  const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
  return error !== "" ? error : rejectedReason(response.status);
}

/**
 * 통로를 한 번 부른다. **던지지 않는다** — 무슨 일이 나도 `failed` 한 상태로 끝난다.
 * 이 구역이 실패해도 같은 화면의 견적서 목록은 아무 영향을 받지 않는다.
 */
export async function loadQuoteArchiveProductFolders(
  repairCaseId: string,
  fetchImpl: QuoteArchiveProductFoldersFetch = (url) => fetch(url)
): Promise<QuoteArchiveProductFolderSectionState> {
  let response: FoldersResponse;
  try {
    response = await fetchImpl(quoteArchiveProductFoldersUrl(repairCaseId));
  } catch {
    return { kind: "failed", reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { kind: "failed", reason: await failureReason(response) };
  const answer = readQuoteArchiveProductFoldersAnswer(await response.json().catch(() => null));
  return answer ?? { kind: "failed", reason: UNREADABLE_RESPONSE_REASON };
}

// ── 그리기 ───────────────────────────────────────────────────────────────

const MUTED_CLASS = "text-xs text-zinc-500 dark:text-zinc-400";
const WARNING_CLASS = "text-sm font-medium text-amber-700 dark:text-amber-400";

function FolderRow({ folder }: { folder: QuoteArchiveProductFolderView }) {
  const numbers = quoteArchiveProductFolderNumbersText(folder.quoteNumbers);
  return (
    <li
      data-quote-archive-product-folder=""
      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{folder.year}</span>
        <span className="min-w-0 break-all text-sm text-zinc-700 dark:text-zinc-300">{folder.folderName}</span>
        {numbers !== "" && <span className={`min-w-0 break-all ${MUTED_CLASS}`}>({numbers})</span>}
      </div>
      {/*
        🔴 **블록 자리**다 — 여기 서는 자리 열기 단추는 제 결과 줄을 아래에 쌓느라 블록 요소를
        그린다(연락서 쪽 한 벌). 인라인 자리로 두면 블록이 인라인 안에 들어가 올바르지 않은
        문서가 된다(줄의 [열기]를 쓰는 바로 위 구역이 인라인 단추를 쓰는 것과 갈리는 지점이다).
      */}
      <div className="flex shrink-0 items-baseline gap-2">
        <span className={MUTED_CLASS}>{quoteArchiveProductFolderFileCountText(folder.fileCount)}</span>
        {/* 🔴 여는 장치는 연락서 쪽 한 벌을 그대로 쓴다 — Windows 가 아니면 스스로 안 그린다. */}
        <ContactFolderPlaceOpenButton relativePath={folder.relativePath} />
      </div>
    </li>
  );
}

/**
 * 상태 하나를 그린다. 🔴 불러오는 중 · `disabled` · 찾은 것이 0 건이면 **아무것도 그리지
 * 않는다**(null). 상태를 직접 넣어 그려 볼 수 있게 따로 두었다(통로 · 네트워크 없이 시험한다).
 */
export function QuoteArchiveProductFolderSectionView({
  state,
}: {
  state: QuoteArchiveProductFolderSectionState;
}) {
  if (state.kind === "loading" || state.kind === "disabled") return null;

  // 🔴 읽다 실패했을 때만 짧게 알린다 — 조용히 사라지면 고장인지 없는 건지 알 수 없다.
  if (state.kind === "failed") {
    return (
      <section
        aria-label={QUOTE_ARCHIVE_PRODUCT_FOLDER_SECTION_FAILED_TEXT}
        data-quote-archive-product-folder-section=""
        className="print:hidden flex flex-col gap-0.5 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <p className={WARNING_CLASS}>{QUOTE_ARCHIVE_PRODUCT_FOLDER_SECTION_FAILED_TEXT}</p>
        <p className={`break-all ${MUTED_CLASS}`}>{state.reason}</p>
      </section>
    );
  }

  // 🔴 찾은 것이 없으면 구역 자체가 없다 — 「없습니다」 상자를 세우지 않는다.
  if (state.folders.length === 0) return null;

  const title = quoteArchiveProductFolderSectionTitle(state.folders.length);
  return (
    <section
      // 🔴 `aria-labelledby` 가 아니라 `aria-label` 이다 — 한 화면에 구역이 여럿 서는 탭이라
      //    같은 id 를 여러 번 내지 않는다(바로 위 구역과 같은 규율).
      aria-label={title}
      data-quote-archive-product-folder-section=""
      className="print:hidden flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {state.folders.map((folder) => (
          <FolderRow key={folder.relativePath} folder={folder} />
        ))}
      </ul>
      {state.truncated && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {QUOTE_ARCHIVE_PRODUCT_FOLDER_SECTION_TRUNCATED_TEXT}
        </p>
      )}
    </section>
  );
}

/**
 * 화면이 뜬 **뒤에** 따로 통로를 부른다. 떠난 뒤에 답이 와도 상태를 건드리지 않는다.
 *
 * 받은 답은 **어느 수리 건의 것인지와 함께** 든다 — 그래야 다른 건으로 넘어갔을 때 지난
 * 건의 목록이 잠깐 비치지 않는다(바로 위 구역과 같은 모양이다).
 */
export default function QuoteArchiveProductFolderSection({ repairCaseId }: { repairCaseId: string }) {
  const [answer, setAnswer] = useState<{
    repairCaseId: string;
    state: QuoteArchiveProductFolderSectionState;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadQuoteArchiveProductFolders(repairCaseId).then((state) => {
      if (!cancelled) setAnswer({ repairCaseId, state });
    });
    return () => {
      cancelled = true;
    };
  }, [repairCaseId]);

  const state: QuoteArchiveProductFolderSectionState =
    answer !== null && answer.repairCaseId === repairCaseId ? answer.state : { kind: "loading" };

  return <QuoteArchiveProductFolderSectionView state={state} />;
}
