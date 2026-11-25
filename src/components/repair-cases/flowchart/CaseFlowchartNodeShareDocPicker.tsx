"use client";

import { useEffect, useState } from "react";

import ShareFolderEntryFilterInput, {
  SHARE_FOLDER_ENTRY_FILTER_EMPTY_TEXT,
  shareFolderEntryFilteredTruncatedText,
} from "@/components/common/ShareFolderEntryFilterInput";
import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";
import {
  contactFolderParentPath,
  contactFolderPathSegments,
} from "@/components/repair-cases/files/ContactFolderSection";
import { isOpenableQuoteFolderFileName } from "@/lib/domain/quote-folder-file-link";
import {
  SHARE_FOLDER_ENTRY_PLACE_ROOT,
  filterShareFolderEntriesByQuery,
  isShareFolderEntryQueryActive,
  shareFolderEntryPlaceAt,
} from "@/lib/domain/share-folder-entry-filter";
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
 * 진단 Flowchart **노드**가 가리킬 파일 — 고르는 창 (2026-11-25)
 * ============================================================================
 * 「파일을 업로드하는 게 아니라 **파일의 위치를 기억**해서 도우미를 통해 폴더에서
 * 파일을 여는 방식」(사용자 요구 2026-11-21). 제품 모델용 창
 * (components/product-models/ModelShareFolderPicker.tsx)을 **본떴다.** 🔴 그 파일은 한
 * 글자도 건드리지 않았다. 🔴 **저쪽이 바뀌는 날 이 파일도 함께 본다** — 2026-10-08
 * 「이름으로 거르기」 때 그랬듯, 창을 가진 자리가 늘 **같게** 보여야 한다는 요구가
 * 되풀이해서 왔다(거르기 칸 · 줄의 열 생김새 · 날짜 모양은 그래서 공용 한 벌이다).
 *
 * ── 🔴 본보기와 **다른 것 셋** ───────────────────────────────────────────
 *  ① **담지 않는다 — 고를 뿐이다.** 서버 액션을 부르지 않고 `onPick` 으로 경로 한 줄을
 *     올려보낸다. 노드 칸은 편집기의 「저장 전 초안」이라(CaseFlowchartEditorScreen 의
 *     편집 모델) 실제로 나가는 것은 화면 위쪽 [저장] 한 번이다. 그래서 이 창에는
 *     **진행 중 표시도 거절 문장도 없다** — 그 자리에서 날 실패가 없다.
 *  ② **폴더는 못 고른다.** 노드 표에는 경로 한 칸뿐이고 「파일인가 폴더인가」를 담을
 *     자리가 없다 — 담아 두면 나중에 **무엇으로 열지**(연결 프로그램 · 탐색기)를 가를
 *     수 없다. 폴더 줄은 **들어가는 길**로만 산다.
 *  ③ **하나만 가리킨다.** 노드당 파일 하나라는 결정(2026-11-21)이라 고르면 **바뀐다** —
 *     그 사실을 말하는 것은 부르는 쪽(속성 패널)이다.
 *
 * ── 🔴 [지정]과 [열기]는 **같은 한 줄에 함께 선다** ──────────────────────
 * 둘의 조건을 한 함수(canPickCaseFlowchartNodeShareDocEntry)로 묶었다. 까닭은 셋이다:
 *  · 폴더가 아니어야 하고 · 허용 목록에 든 확장자여야 하고(순수 함수 하나로만 센다)
 *  · 🔴 **하위 폴더에 들어가 있어야 한다** — 도우미 주소는 `폴더/파일` 모양이라 맨 위
 *    칸에 바로 놓인 파일은 앞에 붙일 폴더가 없어 주소를 만들 수 없다. 거기서는 [열기]도
 *    못 그리므로, 고르게 두면 **열 수 없는 자리를 가리킨 노드**가 남는다. 조건을 하나로
 *    둔 덕에 「고를 수 있는데 못 여는 줄」이 생길 수 없다.
 * 🔵 맨 위 칸에서는 그 까닭을 **글로 말한다** — 단추가 하나도 없는 창을 보고 「고장났나」
 *    로 읽히지 않게.
 *
 * ── 🔴 서버를 새로 만들었다(읽기 하나) ───────────────────────────────────
 * `GET /api/repair-cases/{id}/flowchart/share-folder/entries?path=…` — 🔴 그 통로에는
 * **출처 검사가 한 겹 더** 있다. `fetch` 로만 부른다(`<a href>` · 새 탭은 403).
 *
 * ── 상태별로 무엇을 보이는가 ─────────────────────────────────────────────
 *  · `disabled` → 🔴 **창 자체를 그리지 않는다**(설정이 없는 환경 = 지금 개발 PC)
 *  · 불러오는 중 → 「불러오는 중…」 / 빈 폴더 → 「이 폴더가 비어 있습니다」
 *  · `failed`   → 「공유폴더를 읽지 못했습니다」 + 짧은 사유
 *
 * ── 🔴 인쇄에 안 찍힌다 · 바꿔 끼울 수 있다 ───────────────────────────────
 * 바깥 틀에 `print:hidden`. fetch 는 부르는 쪽이 바꿔 끼울 수 있고, 그려지는 것은 상태를
 * 직접 넣어 본다(case-flowchart-node-share-doc.test.tsx).
 * ============================================================================
 */

// ── 주소 · 길 ────────────────────────────────────────────────────────────

/**
 * 목록 통로의 주소. 🔴 하위 폴더에 들어가 있을 때만 `?path=…` 가 붙는다.
 * 🔴 **`fetch` 로만 부른다** — 그 통로는 출처를 본다(파일 머리말).
 */
export function caseFlowchartNodeShareDocEntriesUrl(repairCaseId: string, insidePath = ""): string {
  const url = `/api/repair-cases/${encodeURIComponent(repairCaseId)}/flowchart/share-folder/entries`;
  return insidePath === "" ? url : `${url}?path=${encodeURIComponent(insidePath)}`;
}

/**
 * 🔴 지금 자리에 이름을 이어 **루트 기준 상대 경로**를 만든다 — 노드에 담길 값이다.
 * 맨 위 칸이면 이름 하나뿐이다(그 자리는 고를 수 없다 — 머리말).
 */
export function caseFlowchartNodeShareDocEntryPath(insidePath: string, name: string): string {
  return [...contactFolderPathSegments(insidePath), name].join("/");
}

/**
 * 🔴 **담긴 경로를 다시 쪼개는 자리도 여기 둔다** — 고르는 쪽과 여는 쪽이 같은 셈을 써야
 * 한다. 속성 패널이 이 셋을 가져다 쓴다(제 손으로 쪼개면 「고를 때는 됐는데 열 때는
 * 안 되는」 경로가 생기고, 그 어긋남은 오류를 한 번도 안 낸다).
 */
export function caseFlowchartNodeShareDocParentPath(relativePath: string): string {
  // 🔵 셈 자체는 연락서 쪽 공용 함수 그대로다 — 이름만 이 자리의 말로 바꿔 둔다.
  return contactFolderParentPath(relativePath);
}

/** 가리킨 파일의 이름 — 마디 하나다. */
export function caseFlowchartNodeShareDocFileName(relativePath: string): string {
  const segments = contactFolderPathSegments(relativePath);
  return segments.length === 0 ? relativePath : segments[segments.length - 1];
}

/**
 * 🔴 담긴 경로에 [열기]를 그릴 것인가 — **고를 때 쟀던 것과 같은 셋**이다
 * (canPickCaseFlowchartNodeShareDocEntry). 그래도 다시 재는 까닭은 지금 담겨 있는 값이
 * **이 창을 거치지 않고 들어왔을 수도** 있기 때문이다(옛 줄 · 손으로 고친 DB · 규칙이
 * 바뀐 뒤). 열 수 없는 값이면 단추를 안 그리고 **경로는 그대로 보인다.**
 */
export function canOpenCaseFlowchartNodeShareDoc(relativePath: string): boolean {
  return (
    caseFlowchartNodeShareDocParentPath(relativePath) !== "" &&
    isOpenableQuoteFolderFileName(caseFlowchartNodeShareDocFileName(relativePath))
  );
}

// ── 문장 ─────────────────────────────────────────────────────────────────

export const CASE_NODE_SHARE_DOC_PICKER_TITLE = "공유폴더에서 고르기";
export const CASE_NODE_SHARE_DOC_PICKER_HINT =
  "고른 자리는 가리켜 두기만 합니다 — 파일이 이 시스템으로 올라오지 않습니다.";
export const CASE_NODE_SHARE_DOC_LOADING_TEXT = "불러오는 중…";
export const CASE_NODE_SHARE_DOC_EMPTY_TEXT = "이 폴더가 비어 있습니다";
export const CASE_NODE_SHARE_DOC_FAILED_TEXT = "공유폴더를 읽지 못했습니다";
/** 폴더 한 줄에 붙는 표시 — 크기 자리를 대신한다. */
export const CASE_NODE_SHARE_DOC_FOLDER_LABEL = "폴더";
export const CASE_NODE_SHARE_DOC_TRAIL_LABEL = "공유폴더 위치";
/** 길 표시의 맨 앞 토막 — 루트는 이름이 없다(설정값이고, 화면으로 나오지 않는다). */
export const CASE_NODE_SHARE_DOC_TRAIL_ROOT_TEXT = "공유폴더";
export const CASE_NODE_SHARE_DOC_UP_TEXT = "위로";
export const CASE_NODE_SHARE_DOC_PICK_TEXT = "이 파일 지정";
/** 🔴 맨 위 칸에서 단추가 하나도 없는 까닭 — 글로 말한다(머리말 🔵). */
export const CASE_NODE_SHARE_DOC_ROOT_HINT =
  "하위 폴더로 들어가서 파일을 고르세요 — 맨 위 칸에 바로 놓인 파일은 도우미로 열 수 없어 지정하지 않습니다.";

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버 응답을 읽지 못했습니다";
const UNKNOWN_REASON = "까닭을 알 수 없습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

/** 🔴 잘렸을 때의 곁말. 「더 있습니다」가 반드시 들어간다. */
export function caseFlowchartNodeShareDocTruncatedText(shown: number, totalCount: number): string {
  return `앞의 ${shown}개만 보입니다 — 더 있습니다(전체 ${totalCount}개). 하위 폴더로 들어가 좁혀 보세요.`;
}

// ── 값 ───────────────────────────────────────────────────────────────────

/** 🔴 **경로를 담는 칸이 없다** — 이름은 그 폴더 안에서의 이름뿐이다(통로의 응답 모양). */
export type CaseFlowchartNodeShareDocEntryView = {
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  /** 수정 시각(ISO). 서버가 못 읽었으면 칸이 통째로 없다. */
  modifiedAt?: string;
};

export type CaseFlowchartNodeShareDocPickerState =
  | { kind: "loading" }
  /** 🔴 이 상태에서는 창을 아예 그리지 않는다. */
  | { kind: "disabled" }
  | { kind: "failed"; reason: string }
  | { kind: "listed"; entries: CaseFlowchartNodeShareDocEntryView[]; totalCount: number; truncated: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 한 줄을 읽는다. 이름이 없으면 그 줄만 버린다 — 나머지 줄은 그대로 보인다. */
function readEntry(value: unknown): CaseFlowchartNodeShareDocEntryView | null {
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
export function readCaseFlowchartNodeShareDocEntriesAnswer(
  payload: unknown
): CaseFlowchartNodeShareDocPickerState | null {
  if (!isRecord(payload)) return null;
  switch (payload.status) {
    case "listed": {
      const entries = Array.isArray(payload.entries)
        ? payload.entries
            .map(readEntry)
            .filter((entry): entry is CaseFlowchartNodeShareDocEntryView => entry !== null)
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

export type CaseFlowchartNodeShareDocEntriesFetch = (url: string) => Promise<EntriesResponse>;

/** 실패 응답 `{ error, code }` 의 문장 — 서버 문장 그대로다. */
async function failureReason(response: EntriesResponse): Promise<string> {
  const payload = await response.json().catch(() => null);
  const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
  return error !== "" ? error : rejectedReason(response.status);
}

/**
 * 통로를 한 번 부른다. **던지지 않는다** — 무슨 일이 나도 `failed` 한 상태로 끝난다.
 * 이 창이 실패해도 편집기의 나머지(그림 · 다른 칸 · [저장])는 아무 영향을 받지 않는다.
 */
export async function loadCaseFlowchartNodeShareDocEntries(
  repairCaseId: string,
  fetchImpl: CaseFlowchartNodeShareDocEntriesFetch = (url) => fetch(url),
  insidePath = ""
): Promise<CaseFlowchartNodeShareDocPickerState> {
  let response: EntriesResponse;
  try {
    response = await fetchImpl(caseFlowchartNodeShareDocEntriesUrl(repairCaseId, insidePath));
  } catch {
    return { kind: "failed", reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { kind: "failed", reason: await failureReason(response) };
  const answer = readCaseFlowchartNodeShareDocEntriesAnswer(await response.json().catch(() => null));
  return answer ?? { kind: "failed", reason: UNREADABLE_RESPONSE_REASON };
}

// ── 그리기 ───────────────────────────────────────────────────────────────

/**
 * 한 줄의 곁말 **두 조각** — 폴더는 크기 대신 「폴더」, 파일은 크기. 수정시각은 따로다.
 * 🔴 날짜 모양도 칸 생김새도 **공유폴더를 보여 주는 창들이 같은 한 벌**을 쓴다
 * (lib/domain/share-folder-entry-meta.ts).
 */
export function caseFlowchartNodeShareDocEntryMeta(
  entry: CaseFlowchartNodeShareDocEntryView
): ShareFolderEntryMeta {
  return shareFolderEntryMeta(entry, CASE_NODE_SHARE_DOC_FOLDER_LABEL);
}

/**
 * 🔴 이 줄을 **고를 수 있는가 = 열 수 있는가**. 셋을 모두 만족해야 한다(머리말):
 *  ① 폴더가 아니다 ② 허용 목록에 든 확장자다 ③ 하위 폴더에 들어가 있다.
 */
export function canPickCaseFlowchartNodeShareDocEntry(
  entry: CaseFlowchartNodeShareDocEntryView,
  insidePath: string
): boolean {
  if (insidePath === "") return false;
  return !entry.isDirectory && isOpenableQuoteFolderFileName(entry.name);
}

const ENTRY_NAME_CLASS = `min-w-0 ${SHARE_FOLDER_ENTRY_NAME_GROW_CLASS} break-all text-left text-sm text-zinc-700 dark:text-zinc-300`;
const SMALL_BUTTON_CLASS =
  "shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";

const MUTED_CLASS = "text-sm text-zinc-500 dark:text-zinc-400";
const WARNING_CLASS = "text-sm font-medium text-amber-700 dark:text-amber-400";

/**
 * 한 줄의 이름. 폴더 줄은 **들어갈 수 있을 때만** 단추가 된다 — 들어갈 길(onEnter)을 주지
 * 않는 자리(시험 · 보여 주기만 하는 화면)에서는 이름만 선다.
 */
function EntryName({
  entry,
  onEnter,
}: {
  entry: CaseFlowchartNodeShareDocEntryView;
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
      data-case-node-share-doc-enter=""
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
  onEnter,
  onPick,
}: {
  entries: readonly CaseFlowchartNodeShareDocEntryView[];
  insidePath: string;
  onEnter?: (name: string) => void;
  /** 🔴 주지 않으면 지정 단추가 **한 줄에도** 그려지지 않는다(고칠 수 없는 사람). */
  onPick?: (relativePath: string) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {entries.map((entry) => {
        const pickable = canPickCaseFlowchartNodeShareDocEntry(entry, insidePath);
        const meta = caseFlowchartNodeShareDocEntryMeta(entry);
        return (
          <li
            key={`${entry.isDirectory ? "d" : "f"}:${entry.name}`}
            data-case-node-share-doc-entry=""
            data-case-node-share-doc-entry-pickable={pickable ? "" : undefined}
            className={SHARE_FOLDER_ENTRY_ROW_CLASS}
          >
            <EntryName entry={entry} onEnter={onEnter} />
            {/* 🔴 수정시각이 없어도 **칸은 그대로** 그린다 — 빼면 그 줄만 열이 어긋난다. */}
            <span className={SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS}>{meta.modifiedText}</span>
            <span className={SHARE_FOLDER_ENTRY_META_SIZE_CLASS}>{meta.sizeText}</span>
            {/* 🔴 동작 칸은 **비어도 그린다** — 단추가 없는 줄에서 칸까지 빼면 그 줄만 열이 어긋난다. */}
            <span className={SHARE_FOLDER_ENTRY_ACTIONS_CLASS}>
              {/* 🔴 여는 단추는 **그대로 가져다 쓴다** — 도우미 주소를 여기서 짓지 않는다. */}
              {pickable && <ContactFolderEntryOpenButton folderName={insidePath} fileName={entry.name} />}
              {pickable && onPick !== undefined && (
                <button
                  type="button"
                  onClick={() => onPick(caseFlowchartNodeShareDocEntryPath(insidePath, entry.name))}
                  data-case-node-share-doc-pick=""
                  className={SMALL_BUTTON_CLASS}
                >
                  {CASE_NODE_SHARE_DOC_PICK_TEXT}
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
 * 길 표시 — 「공유폴더 › 1. 수리 관련 › 2026」. 토막마다 그 자리로 돌아가는 단추가 되고,
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
    { label: CASE_NODE_SHARE_DOC_TRAIL_ROOT_TEXT, path: "" },
    ...segments.map((segment, index) => ({ label: segment, path: segments.slice(0, index + 1).join("/") })),
  ];
  const lastIndex = steps.length - 1;
  return (
    <nav
      aria-label={CASE_NODE_SHARE_DOC_TRAIL_LABEL}
      data-case-node-share-doc-trail=""
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
              data-case-node-share-doc-trail-step=""
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
          data-case-node-share-doc-up=""
          className={SMALL_BUTTON_CLASS}
        >
          {CASE_NODE_SHARE_DOC_UP_TEXT}
        </button>
      )}
    </nav>
  );
}

/**
 * 상태 하나를 그린다. 🔴 `disabled` 면 **아무것도 그리지 않는다**(null).
 * 🔴 옮겨 다닐 길(onNavigate) · 고를 길(onPick)을 주지 않으면 **누를 수 있는 것이 생기지 않는다**.
 */
export function CaseFlowchartNodeShareDocPickerView({
  state,
  insidePath = "",
  filterQuery = "",
  onNavigate,
  onFilterQueryChange,
  onPick,
}: {
  state: CaseFlowchartNodeShareDocPickerState;
  insidePath?: string;
  /** 🔴 거르기 칸의 **날것** 글자. 다듬기는 견줄 때만 한다(domain 의 순수 함수). */
  filterQuery?: string;
  onNavigate?: (insidePath: string) => void;
  /** 🔴 주지 않으면 거르기 칸이 그려지지 않는다(보여 주기만 하는 자리 · 시험). */
  onFilterQueryChange?: (filterQuery: string) => void;
  onPick?: (relativePath: string) => void;
}) {
  if (state.kind === "disabled") return null;

  // 🔴 **이미 받아 둔 줄**만 거른다 — 서버를 다시 부르지 않는다.
  const filtering = isShareFolderEntryQueryActive(filterQuery);
  const visibleEntries = state.kind === "listed" ? filterShareFolderEntriesByQuery(state.entries, filterQuery) : [];

  return (
    <div
      data-case-node-share-doc-picker=""
      className="print:hidden flex flex-col gap-2 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h5 className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">{CASE_NODE_SHARE_DOC_PICKER_TITLE}</h5>
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{CASE_NODE_SHARE_DOC_PICKER_HINT}</span>
      </div>

      <PathTrail insidePath={insidePath} onNavigate={onNavigate} />

      {/* 🔴 맨 위 칸에서는 지정 단추가 한 줄에도 없다 — 그 까닭을 글로 말한다(머리말). */}
      {insidePath === "" && state.kind === "listed" && (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{CASE_NODE_SHARE_DOC_ROOT_HINT}</p>
      )}

      {state.kind === "loading" && (
        <p aria-live="polite" className={MUTED_CLASS}>
          {CASE_NODE_SHARE_DOC_LOADING_TEXT}
        </p>
      )}

      {state.kind === "failed" && (
        <div className="flex flex-col gap-0.5">
          <p className={WARNING_CLASS}>{CASE_NODE_SHARE_DOC_FAILED_TEXT}</p>
          <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">{state.reason}</p>
        </div>
      )}

      {state.kind === "listed" &&
        (state.entries.length === 0 ? (
          <p className={MUTED_CLASS}>{CASE_NODE_SHARE_DOC_EMPTY_TEXT}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {/* 🔴 길 표시 아래 · 목록 위. 빈 폴더에는 거를 것이 없어 서지 않는다. */}
            {onFilterQueryChange !== undefined && (
              <ShareFolderEntryFilterInput value={filterQuery} onChange={onFilterQueryChange} />
            )}
            {visibleEntries.length === 0 ? (
              // 🔴 목록을 그냥 비워 두지 않는다 — 왜 아무것도 없는지 말해 준다.
              <p className={MUTED_CLASS}>{SHARE_FOLDER_ENTRY_FILTER_EMPTY_TEXT}</p>
            ) : (
              <EntryList
                entries={visibleEntries}
                insidePath={insidePath}
                {...(onNavigate === undefined
                  ? {}
                  : {
                      onEnter: (name: string) =>
                        onNavigate(caseFlowchartNodeShareDocEntryPath(insidePath, name)),
                    })}
                {...(onPick === undefined ? {} : { onPick })}
              />
            )}
            {/* 🔴 거르는 중에도 **없애지 않는다** — 말만 바꿔 「더 있습니다」를 계속 보인다. */}
            {state.truncated && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {filtering
                  ? shareFolderEntryFilteredTruncatedText(state.entries.length, state.totalCount)
                  : caseFlowchartNodeShareDocTruncatedText(state.entries.length, state.totalCount)}
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
export default function CaseFlowchartNodeShareDocPicker({
  repairCaseId,
  onPick,
}: {
  /** 🔴 수리 건의 id(UUID)다 — 주소의 마디로 그대로 간다(파일 머리말: 권한의 단위). */
  repairCaseId: string;
  /** 🔴 주지 않으면 지정 단추가 하나도 안 그려진다 — 권한 판정은 부르는 쪽이 한다. */
  onPick?: (relativePath: string) => void;
}) {
  // 🔴 자리와 거르기 칸을 **한 값으로** 쥔다 — 자리를 옮기는 길이 칸을 비우는 길이다.
  const [place, setPlace] = useState(SHARE_FOLDER_ENTRY_PLACE_ROOT);
  const [answer, setAnswer] = useState<{ path: string; state: CaseFlowchartNodeShareDocPickerState } | null>(null);
  const insidePath = place.insidePath;

  useEffect(() => {
    let cancelled = false;
    void loadCaseFlowchartNodeShareDocEntries(repairCaseId, undefined, insidePath).then((state) => {
      if (!cancelled) setAnswer({ path: insidePath, state });
    });
    return () => {
      cancelled = true;
    };
  }, [repairCaseId, insidePath]);

  const state: CaseFlowchartNodeShareDocPickerState =
    answer !== null && answer.path === insidePath ? answer.state : { kind: "loading" };

  return (
    <CaseFlowchartNodeShareDocPickerView
      state={state}
      insidePath={insidePath}
      filterQuery={place.filterQuery}
      onNavigate={(next) => {
        // 🔴 자리를 옮기면 거르기 칸이 함께 비워진다 — 그 규칙은 저 함수 하나가 쥔다.
        setPlace(shareFolderEntryPlaceAt(next));
      }}
      onFilterQueryChange={(filterQuery) => setPlace((previous) => ({ ...previous, filterQuery }))}
      {...(onPick === undefined ? {} : { onPick })}
    />
  );
}
