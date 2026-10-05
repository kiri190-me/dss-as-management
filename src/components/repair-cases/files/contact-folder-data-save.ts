"use client";

import { readContactFolderCopyNote, type ContactFolderCopyNote } from "./contact-folder-copy-notice";

/**
 * ============================================================================
 * [DATA에 저장] — 고른 파일을 그 건의 `DATA` 폴더에 꽂게 한다 (연락서 조각 12)
 * ============================================================================
 * 사용자는 「내려받을 때 기본으로 `DATA` 에 저장되게」를 바랐지만 **웹페이지는 브라우저의
 * 저장 위치를 지정할 수 없다**(보안). 그래서 **서버가 직접 꽂는다** — 「받아서 탐색기로
 * 옮기기」 두 걸음이 한 번 누르기가 된다(2026-10-05 승인).
 *
 * ── 🔴 묶지 않는다 ──────────────────────────────────────────────────────
 * 내려받기가 여러 개를 ZIP 으로 묶는 것은 기능이 아니라 **브라우저가 연속 내려받기를
 * 막기 때문**이다(zip-store.ts 머리말). 이 길은 내려받기가 아니므로 그 제약이 없다 —
 * 🔴 **낱개로 각각** 꽂는다. 공유폴더에 ZIP 을 두면 탐색기에서 또 풀어야 하고 [열기]로
 * 바로 못 연다. 그래서 이 파일은 zip-store 를 **가져오지 않는다**.
 *
 * ── 🔴 한 건씩 차례로 ───────────────────────────────────────────────────
 * 몰아 보내지 않는다(올리기 · 지우기와 같은 규율). 한 건이 막혀도 나머지는 간다 —
 * 여러 개를 고른 사람에게 「하나가 안 되니 전부 취소」는 도움이 안 된다. 결과는
 * **건마다** 돌려주고, 어느 것이 되고 어느 것이 안 됐는지는 화면이 한 줄로 말한다
 * (contact-folder-copy-notice.ts 의 contactFolderDataSaveNotice).
 *
 * ── 🔴 던지지 않는다 ────────────────────────────────────────────────────
 * 무슨 일이 나도 그 건의 note 하나로 끝난다(네트워크 끊김 · 서버 거절 · 사진 줄이기
 * 실패). 화면이 멈추지 않아야 하고, 이미 꽂힌 것은 그대로 남는다.
 *
 * fetch 를 바꿔 끼울 수 있다 — 네트워크 없이 값으로 시험한다.
 * ============================================================================
 */

/** 통로 주소. `shrunk` 가 붙으면 본문이 **브라우저가 줄인 사진의 바이트**다. */
export function contactFolderDataSaveUrl(attachmentId: string, shrunkLabel?: string): string {
  const url = `/api/attachments/${encodeURIComponent(attachmentId)}/contact-folder`;
  return shrunkLabel === undefined ? url : `${url}?shrunk=${encodeURIComponent(shrunkLabel)}`;
}

/** 한 건을 꽂으라는 부탁. 🔴 **파일 이름을 보내지 않는다** — 이름은 서버가 짓는다. */
export type DataSaveRequest = {
  attachmentId: string;
  /**
   * 줄여서 꽂을 때만. `label` 은 줄여받기가 파일 이름에 붙이는 꼬리와 **같은 값**이고
   * (`50pct` · `500KB`), `body` 는 브라우저가 줄인 바이트다. 없으면 서버가 **저장된
   * 원본**을 읽어 꽂는다(원본은 그대로다).
   */
  shrunk?: { label: string; body: Blob };
};

type DataSaveResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type DataSaveFetch = (url: string, init: { method: "POST"; body?: Blob }) => Promise<DataSaveResponse>;

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버 응답을 읽지 못했습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 실패 응답 `{ error, code }` 의 문장 — 서버 문장 그대로다. */
async function failureReason(response: DataSaveResponse): Promise<string> {
  const payload = await response.json().catch(() => null);
  const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
  return error !== "" ? error : rejectedReason(response.status);
}

/** 한 건을 꽂는다. **던지지 않는다** — 무슨 일이 나도 note 하나로 끝난다. */
export async function saveOneToDataFolder(
  request: DataSaveRequest,
  fetchImpl: DataSaveFetch = (url, init) => fetch(url, init)
): Promise<ContactFolderCopyNote> {
  let response: DataSaveResponse;
  try {
    response = await fetchImpl(contactFolderDataSaveUrl(request.attachmentId, request.shrunk?.label), {
      method: "POST",
      ...(request.shrunk === undefined ? {} : { body: request.shrunk.body }),
    });
  } catch {
    return { status: "failed", reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { status: "failed", reason: await failureReason(response) };
  const note = readContactFolderCopyNote(await response.json().catch(() => null));
  return note ?? { status: "failed", reason: UNREADABLE_RESPONSE_REASON };
}

export type DataSaveProgress = { current: number; total: number };

/**
 * 고른 것들을 **한 건씩 차례로** 꽂는다. 결과는 **건마다** 같은 차례로 돌아온다.
 *
 * `prepare` 가 그 건의 부탁을 만든다 — 저장된 파일은 id 하나면 되고, 줄여서 꽂을 때는
 * 거기서 사진을 줄인다(🔴 한 장씩 줄여야 폰에서 메모리가 터지지 않는다 — 기존 줄여받기와
 * 같은 규율). `prepare` 가 실패해도 그 건만 실패로 적고 다음으로 간다.
 */
export async function saveEachToDataFolder<T>(
  items: readonly T[],
  prepare: (item: T, index: number) => Promise<DataSaveRequest>,
  options: {
    fetchImpl?: DataSaveFetch;
    onProgress?: (progress: DataSaveProgress) => void;
  } = {}
): Promise<ContactFolderCopyNote[]> {
  const notes: ContactFolderCopyNote[] = [];
  for (const [index, item] of items.entries()) {
    options.onProgress?.({ current: index + 1, total: items.length });
    let request: DataSaveRequest;
    try {
      request = await prepare(item, index);
    } catch (caught) {
      notes.push({
        status: "failed",
        reason: caught instanceof Error && caught.message.length > 0 ? caught.message : UNREADABLE_RESPONSE_REASON,
      });
      continue;
    }
    notes.push(await saveOneToDataFolder(request, options.fetchImpl));
  }
  return notes;
}
