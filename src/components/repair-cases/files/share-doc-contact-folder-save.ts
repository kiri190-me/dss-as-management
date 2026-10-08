"use client";

import { readContactFolderCopyNote, type ContactFolderCopyNote } from "./contact-folder-copy-notice";

/**
 * ============================================================================
 * [연락서 폴더에 저장] — 가리킨 공유폴더 서류를 이 건 폴더로 가져온다 (2026-10-08)
 * ============================================================================
 * 수리 건 상세 「파일 관리」의 두 구역(그 종류의 공통 서류 · 이 제품 모델 전용 서류)에서
 * 한 줄의 [열기] 옆에 선 단추가 쓴다. **바이트는 브라우저를 지나지 않는다** — 화면이
 * 하는 일은 「그 자리를 이 건 폴더로 가져와 달라」고 한 번 부르는 것뿐이고, 서버가 읽어
 * 서버가 쓴다.
 *
 * 이웃 [DATA에 저장](contact-folder-data-save.ts)을 **본떴다**:
 *  · 🔴 **던지지 않는다** — 무슨 일이 나도 note 하나로 끝난다(네트워크 끊김 · 서버 거절).
 *  · 🔴 **한 번에 한 줄** — 몰아 보내지 않는다. 결과도 그 줄 옆에 그대로 붙는다.
 *  · 응답 모양이 올리기 · [DATA에 저장]과 같아 **읽개를 그대로 쓴다**
 *    (readContactFolderCopyNote — 모르는 모양이면 null 이라 화면이 거짓말을 하지 않는다).
 *
 * 🔴 **다른 것은 보내는 값 하나**다 — 첨부 id 가 아니라 **공유폴더 루트 기준 상대 경로**다.
 * 그 값은 서버가 다시 검사한다(통로 머리말 — 화면이 보낸 경로를 믿지 않는다).
 *
 * fetch 를 바꿔 끼울 수 있다 — 네트워크 없이 값으로 시험한다.
 * ============================================================================
 */

/** 통로 주소. 가리킨 자리는 `?path=` 로 간다(목록 통로 둘과 같은 모양). */
export function shareDocContactFolderSaveUrl(repairCaseId: string, relativePath: string): string {
  return `/api/repair-cases/${encodeURIComponent(repairCaseId)}/share-docs/contact-folder?path=${encodeURIComponent(
    relativePath
  )}`;
}

export type ShareDocSaveRequest = {
  repairCaseId: string;
  /** 🔴 공유폴더 루트 **기준 상대 경로**. 가리킴 한 줄이 들고 있는 값 그대로다. */
  relativePath: string;
};

type ShareDocSaveResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type ShareDocSaveFetch = (url: string, init: { method: "POST" }) => Promise<ShareDocSaveResponse>;

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버 응답을 읽지 못했습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 실패 응답 `{ error, code }` 의 문장 — 서버 문장 그대로다(경로가 없는 문장이다). */
async function failureReason(response: ShareDocSaveResponse): Promise<string> {
  const payload = await response.json().catch(() => null);
  const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
  return error !== "" ? error : rejectedReason(response.status);
}

/** 한 줄을 이 건의 연락서 폴더로 가져온다. **던지지 않는다.** */
export async function saveShareDocToContactFolder(
  request: ShareDocSaveRequest,
  fetchImpl: ShareDocSaveFetch = (url, init) => fetch(url, init)
): Promise<ContactFolderCopyNote> {
  let response: ShareDocSaveResponse;
  try {
    response = await fetchImpl(shareDocContactFolderSaveUrl(request.repairCaseId, request.relativePath), {
      method: "POST",
    });
  } catch {
    return { status: "failed", reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { status: "failed", reason: await failureReason(response) };
  const note = readContactFolderCopyNote(await response.json().catch(() => null));
  return note ?? { status: "failed", reason: UNREADABLE_RESPONSE_REASON };
}
