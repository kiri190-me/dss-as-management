"use client";

import { useEffect, useRef, useState } from "react";

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
 * ── 🔴 **목록은 팝업 안에서 산다** (2026-11-25 고침) ─────────────────────
 * 처음에는 이 창이 속성 패널 **안에** 통째로 들어가 있었고, 그래서 화면이 깨졌다 —
 * 폴더 이름이 「(삭 / 제 / 예 / 정) / 7. / 디 …」처럼 **한 글자에 한 줄씩** 세로로
 * 떨어졌다(사용자 신고 2026-11-25). 까닭은 폭이다: 목록 한 줄은
 * `[이름 minmax(0,1fr)] [수정날짜 10rem] [크기 5rem] [동작 9rem]` 짜리 grid 인데
 * (share-folder-entry-meta.ts) **고정 칸 24rem 이 먼저 자리를 가져가** 이름 칸이 0 에
 * 가깝게 눌린다. 🔴 그 grid 를 켜는 `sm:` 은 **화면 폭**을 보는 규칙이라 품은 상자가
 * 아무리 좁아도 그대로 켜진다 — 패널 안에서는 피할 길이 없었다.
 * 그래서 패널에는 [파일 고르기] 단추만 남기고 목록 · 경로 이동 · 거르기 칸은 전부
 * 이 파일의 **팝업**으로 옮겼다. 못 박아 둘 것 넷:
 *  · 🔴 native `<dialog>` + `showModal()` — 이 앱의 창들과 같은 방식이고(globals.css 가
 *    `margin:auto` 를 되살려 둔 그 틀), **최상위 층**에 떠서 좁은 패널의 폭도 바깥
 *    상자의 overflow 도 따라오지 않는다. 🔵 이웃 ShareDocFolderPickerDialog 는
 *    `fixed inset-0` 꼴인데, 그쪽은 transform 을 가진 조상이 있으면 그 안에 갇힌다 —
 *    여기는 React Flow 편집기 안이라 그 길을 피했다.
 *  · 🔴 **물려받는 글자 모양은 창 안에서 끊는다.** 팝업이 위층에 떠도 물려받는
 *    CSS(글자 크기 · 정렬 · word-break · white-space)는 **DOM 부모**를 따라 내려온다 —
 *    표 칸 안에서 태어난 팝업이 `nowrap` 을 물려받아 글이 넘친 일이 이 저장소에 있다.
 *    속성 패널은 `text-xs` 다. 창 상자에 `text-sm text-left whitespace-normal
 *    break-keep` 을 다시 적는다(**지우지 말 것**).
 *  · 🔴 이름은 `break-all` 이 아니라 **`break-keep wrap-anywhere`** 다 — 한글을 어절
 *    가운데서 끊지 않고(`keep-all`), 한 덩어리가 줄보다 길 때만 끊는다(`anywhere`).
 *    폭이 넉넉해도 긴 이름 하나가 남으면 또 쪼개지므로 둘을 함께 둔다.
 *  · 🔵 목록이 길면 **창 안에서만** 스크롤한다(`max-h-[85vh] overflow-y-auto`) —
 *    페이지가 통째로 늘어나지 않는다.
 *
 * ── 상태별로 무엇을 보이는가 ─────────────────────────────────────────────
 *  · `disabled` → 🔴 **창도 [파일 고르기] 단추도 그리지 않는다.** 눌렀는데 빈 창이
 *    뜨면 「고장났나」가 된다. 🔴 설정(REPAIR_DOCS_ARCHIVE_DIR)은 **이 개발 PC 에도
 *    있다**(2026-11-25 실측 — 화면에 폴더 목록이 실제로 뜬다). 전에 이 자리에
 *    「설정이 없는 환경 = 지금 개발 PC」라고 적혀 있었는데 **사실이 아니었다.**
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
/** 🔴 속성 패널에 **남는 것은 이 단추 하나**다 — 목록은 팝업 안에 있다(머리말). */
export const CASE_NODE_SHARE_DOC_OPEN_TEXT = "파일 고르기";
export const CASE_NODE_SHARE_DOC_CLOSE_TEXT = "닫기";
/**
 * 🔴 노드당 하나라는 결정(2026-11-21)을 **고르기 전에** 말한다. 🔵 2026-11-25 에 속성
 * 패널에서 **창 머리로 옮겼다** — 패널은 안내 한 줄만 둘 만큼 좁고, 이 말이 필요한
 * 순간은 줄을 고르기 직전이다(그 자리에서도 「고르기 전」이다).
 */
export const CASE_NODE_SHARE_DOC_REPLACE_HINT =
  "노드마다 파일 하나만 가리킵니다 — 새로 고르면 지금 가리킨 자리가 바뀝니다.";
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

/**
 * 🔴 **`break-all` 이 아니다**(2026-11-25 고침). `break-all` 은 한글을 어절 가운데서
 * 늘 끊는다 — 칸이 좁아지면 「디 / 에 / 스」처럼 한 글자씩 떨어진다. `break-keep` 은
 * 어절을 지키고, `wrap-anywhere` 는 **한 덩어리가 줄보다 길 때만** 끊어 준다(긴
 * `현황_20220707.xlsx` 하나가 칸 밖으로 삐져나가지 않게). 🔵 `wrap-anywhere` 는
 * `break-words` 와 달리 **최소 폭 계산에도 든다** — grid/flex 칸이 이름 때문에 벌어지는
 * 일을 막는다(WeeklyReportScreen 의 같은 까닭).
 */
const ENTRY_NAME_CLASS = `min-w-0 ${SHARE_FOLDER_ENTRY_NAME_GROW_CLASS} break-keep wrap-anywhere text-left text-sm text-zinc-700 dark:text-zinc-300`;
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
              className="min-w-0 break-keep wrap-anywhere font-medium text-zinc-700 dark:text-zinc-300"
            >
              {step.label}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate(step.path)}
              data-case-node-share-doc-trail-step=""
              className="min-w-0 break-keep wrap-anywhere text-left underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
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
 * 상태 하나를 그린다 — **팝업의 속**이다. 🔴 `disabled` 면 **아무것도 그리지 않는다**(null).
 * 🔴 옮겨 다닐 길(onNavigate) · 고를 길(onPick)을 주지 않으면 **누를 수 있는 것이 생기지 않는다**.
 *
 * 🔵 2026-11-25 에 **제목 줄과 바깥 테두리를 뺐다** — 그 둘은 이제 팝업 틀
 * (CaseFlowchartNodeShareDocPickerDialog)이 그린다. 팝업 안에 또 상자를 두면 테두리가
 * 두 겹으로 겹치고 제목이 두 번 적힌다.
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
    <div data-case-node-share-doc-picker="" className="print:hidden flex flex-col gap-2">
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
          {/* 🔴 사유는 **문장**이다(서버가 쓴 한국어) — `break-all` 로 끊으면 글자가 쪼개진다. */}
          <p className="break-keep wrap-anywhere text-xs text-zinc-500 dark:text-zinc-400">{state.reason}</p>
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
 * 고르는 창의 **팝업 틀** — 머리말 · 목록 · 닫는 길.
 *
 * 🔴 native `<dialog>` 에 `showModal()` 이다. **떠 있는 동안만 태어난다** — 부르는 쪽이
 * 안 열었으면 이 조각이 아예 없다. 그래서 효과의 의존 목록이 비어 있고(`[]`), 닫는 일은
 * 제 안에서 `close()` 를 부르는 것이 아니라 **부르는 쪽이 그리기를 멈추는 것**이다
 * (열림 여부의 주인은 React 상태다 — NoticePopup 과 같은 규약).
 *
 * 🔴 닫는 길은 **셋**이다: [×] · [닫기] · `Esc`(`onCancel`). 🔵 셋 다 `onClose` 하나로
 * 모인다 — 그 함수에는 **고르는 일이 한 글자도 없다.** 그래서 그냥 닫으면 초안이 바뀌지
 * 않는다(`onPick` 을 안 부른다).
 *
 * 🔴 창 상자에 적힌 `text-sm text-left whitespace-normal break-keep` 을 **지우지 마라** —
 * 속성 패널(`text-xs`)에서 물려받는 글자 모양을 여기서 끊는다(파일 머리말).
 */
export function CaseFlowchartNodeShareDocPickerDialog({
  state,
  insidePath,
  filterQuery,
  onNavigate,
  onFilterQueryChange,
  onPick,
  onClose,
}: {
  state: CaseFlowchartNodeShareDocPickerState;
  insidePath: string;
  filterQuery: string;
  onNavigate: (insidePath: string) => void;
  onFilterQueryChange: (filterQuery: string) => void;
  /** 🔴 주지 않으면 지정 단추가 한 줄에도 없다 — 권한 판정은 부르는 쪽이 한다. */
  onPick?: (relativePath: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={CASE_NODE_SHARE_DOC_PICKER_TITLE}
      data-case-node-share-doc-dialog=""
      // Esc. 기본 동작으로 닫으면 React 는 아직 열려 있다고 알아 다시 못 연다.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      /*
        🔴 폭은 **화면 기준**이다(`min(56rem,95vw)`) — 품은 속성 패널의 폭을 따라가면
        2026-11-25 의 그 결함으로 되돌아간다. 목록 한 줄의 고정 칸 24rem 을 빼고도
        이름 칸에 32rem 이 남는다.
        🔵 길면 **창 안에서** 스크롤한다(`max-h-[85vh] overflow-y-auto`).
      */
      className="print:hidden max-h-[85vh] w-[min(56rem,95vw)] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 text-left text-sm break-keep whitespace-normal text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {CASE_NODE_SHARE_DOC_PICKER_TITLE}
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{CASE_NODE_SHARE_DOC_PICKER_HINT}</p>
          {/* 🔴 「새로 고르면 바뀐다」는 **줄을 고르기 전에** 읽혀야 한다 — 그래서 머리에 있다. */}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{CASE_NODE_SHARE_DOC_REPLACE_HINT}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={CASE_NODE_SHARE_DOC_CLOSE_TEXT}
          data-case-node-share-doc-dialog-close=""
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xl leading-none text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          ×
        </button>
      </div>

      <div className="mt-3">
        <CaseFlowchartNodeShareDocPickerView
          state={state}
          insidePath={insidePath}
          filterQuery={filterQuery}
          onNavigate={onNavigate}
          onFilterQueryChange={onFilterQueryChange}
          {...(onPick === undefined ? {} : { onPick })}
        />
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          data-case-node-share-doc-dialog-close=""
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {CASE_NODE_SHARE_DOC_CLOSE_TEXT}
        </button>
      </div>
    </dialog>
  );
}

/**
 * 속성 패널에 서는 것 — **[파일 고르기] 단추 하나**와, 눌렀을 때 뜨는 팝업.
 *
 * 🔴 통로는 **그려지자마자** 한 번 부른다(단추를 누를 때가 아니다). 까닭 둘:
 *  ① 설정이 비었는지(`disabled`)를 그때 알게 되고, 그래야 **단추를 안 세울 수 있다** —
 *    눌렀는데 빈 창이 뜨면 「고장났나」가 된다.
 *  ② 창을 열었을 때 맨 위 칸이 **이미 담겨 있다** — 열자마자 기다리지 않는다.
 * 떠난 뒤에 답이 와도 상태를 건드리지 않는다. 받은 답은 **어느 자리의 것인지와 함께**
 * 든다 — 자리가 바뀌었을 때 지난 폴더의 목록이 잠깐 비치지 않게.
 *
 * 🔵 창을 닫아도 **보던 자리는 그대로 둔다**(place 를 맨 위로 되돌리지 않는다) — 다시
 * 여는 까닭은 대개 「같은 폴더에서 다른 파일」이고, 되돌리면 통로를 한 번 더 부른다.
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
  const [isOpen, setIsOpen] = useState(false);
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

  // 🔴 설정이 비면 **단추도 창도 없다.** 가리킨 줄과 [지우기]는 패널 쪽에 있고
  // 그쪽은 DB 값이라 그대로 선다(패널의 같은 자리 주석).
  if (state.kind === "disabled") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        data-case-node-share-doc-open=""
        className="print:hidden self-start rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {CASE_NODE_SHARE_DOC_OPEN_TEXT}
      </button>

      {isOpen && (
        <CaseFlowchartNodeShareDocPickerDialog
          state={state}
          insidePath={insidePath}
          filterQuery={place.filterQuery}
          onNavigate={(next) => {
            // 🔴 자리를 옮기면 거르기 칸이 함께 비워진다 — 그 규칙은 저 함수 하나가 쥔다.
            setPlace(shareFolderEntryPlaceAt(next));
          }}
          onFilterQueryChange={(filterQuery) => setPlace((previous) => ({ ...previous, filterQuery }))}
          onClose={() => setIsOpen(false)}
          {...(onPick === undefined
            ? {}
            : {
                // 🔴 고르면 **창이 닫힌다.** 나가는 것은 여기서도 초안 한 줄뿐이고,
                // 실제 저장은 화면 위쪽 [저장] 한 번이다(파일 머리말 ①).
                onPick: (relativePath: string) => {
                  onPick(relativePath);
                  setIsOpen(false);
                },
              })}
        />
      )}
    </>
  );
}
