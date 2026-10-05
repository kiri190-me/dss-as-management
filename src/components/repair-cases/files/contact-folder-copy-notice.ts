/**
 * ============================================================================
 * 올린 파일이 **공유폴더에도 들어갔는가** — 사실대로 말하는 한 줄 (연락서 조각 6)
 * ============================================================================
 * 올리기 통로는 시스템 창고에 저장한 **뒤에** 그 건의 연락서 폴더에 사람이 읽는 이름으로
 * 사본을 꽂는다. 🔴 **그 사본이 실패해도 올리기는 성공(201)이다** — 대신 응답에 무슨 일이
 * 있었는지 실어 보내고(`contactFolderCopy`), 화면이 그것을 한 줄로 말한다.
 *
 * 적어도 셋을 **갈라** 말한다:
 *  · 공유폴더에도 넣었다(이름이 바뀌었으면 **그 이름**을 그대로 보여 준다)
 *  · 폴더가 없어 못 넣었다 → 「[폴더 만들고 열기]로 폴더를 먼저 만들어 주세요」
 *  · 넣지 못했다(권한 · 연결 · 폴더가 여럿) → 사유
 *
 * 🔴 **저장 팝업에 싣지 않는다.** 저장 팝업은 0.5 초 뒤 저절로 닫히는 성공 전용이라
 * 읽어야 하는 문장을 담을 자리가 아니다 — 이 줄은 화면에 남는 알림 칸으로 간다.
 *
 * 🔴 기능이 꺼진 환경(CONTACT_FOLDER_ARCHIVE_DIR 이 비어 있다)에서는 응답에 그 칸이 아예
 * 붙지 않는다. 그때는 이 모듈도 **아무 말도 하지 않는다**(null) — 올리기 화면이 예전과
 * 한 글자도 달라지지 않아야 한다.
 *
 * 값으로 시험한다(contact-folder-copy-notice.test.ts) — DOM 도 네트워크도 없다.
 * ============================================================================
 */

/** 올리기 응답의 `contactFolderCopy` 칸. 통로의 ContactFolderCopyNote 와 같은 모양이다. */
export type ContactFolderCopyNote =
  /** 새로 꽂았다. `fileName` 은 디스크에 실제로 쓴 이름(번호가 붙었을 수 있다). */
  | { status: "copied"; fileName: string }
  /** 같은 내용이 이미 있어 쓰지 않았다. */
  | { status: "unchanged"; fileName: string }
  /** 🔴 연락서 폴더가 아직 없다 — 앱은 폴더를 만들지 않는다. */
  | { status: "no-folder" }
  /** 맞는 폴더가 여럿이라 앱이 고르지 않았다. */
  | { status: "multiple" }
  | { status: "failed"; reason: string };

export type ContactFolderCopyNotice = { tone: "success" | "error"; text: string };

export const CONTACT_FOLDER_COPY_NO_FOLDER_TEXT =
  "연락서 폴더가 아직 없습니다 — 「기본 정보」의 [폴더 만들고 열기]로 폴더를 먼저 만들어 주세요.";

export const CONTACT_FOLDER_COPY_MULTIPLE_TEXT =
  "연락서 폴더가 여럿이라 어디에 넣을지 알 수 없습니다 — 공유폴더에서 하나로 정리해 주세요.";

const FAILED_PREFIX = "시스템에는 저장했지만";

/**
 * 서버가 보낸 값에서 그 칸을 읽는다. 🔴 **모르는 모양이면 null** — 응답이 바뀌거나 예전
 * 서버가 답해도 화면이 거짓말을 하지 않게(「넣었습니다」를 지어내지 않는다).
 */
export function readContactFolderCopyNote(payload: unknown): ContactFolderCopyNote | null {
  if (typeof payload !== "object" || payload === null) return null;
  const note = (payload as { contactFolderCopy?: unknown }).contactFolderCopy;
  if (typeof note !== "object" || note === null) return null;
  const status = (note as { status?: unknown }).status;
  const fileName = (note as { fileName?: unknown }).fileName;
  const reason = (note as { reason?: unknown }).reason;

  if ((status === "copied" || status === "unchanged") && typeof fileName === "string" && fileName.length > 0) {
    return { status, fileName };
  }
  if (status === "no-folder" || status === "multiple") return { status };
  if (status === "failed" && typeof reason === "string" && reason.length > 0) return { status, reason };
  return null;
}

/** 못 넣은 까닭 한 줄 — 상태마다 사람이 **다음에 할 일**을 알 수 있어야 한다. */
function failureReason(note: ContactFolderCopyNote): string | null {
  if (note.status === "no-folder") return CONTACT_FOLDER_COPY_NO_FOLDER_TEXT;
  if (note.status === "multiple") return CONTACT_FOLDER_COPY_MULTIPLE_TEXT;
  if (note.status === "failed") return note.reason;
  return null;
}

/**
 * 이번에 올린 것들의 공유폴더 결과를 한 줄로 모은다. 할 말이 없으면 null.
 *
 * 한 번에 여러 장을 올리므로 같은 사유가 여러 번 나온다 — **사유는 겹치지 않게** 모으고
 * 몇 장이 빠졌는지를 앞에 적는다.
 */
export function contactFolderCopyNotice(
  notes: readonly ContactFolderCopyNote[]
): ContactFolderCopyNotice | null {
  if (notes.length === 0) return null;

  const copied = notes.filter((note) => note.status === "copied").map((note) => note.fileName);
  const unchanged = notes.filter((note) => note.status === "unchanged").map((note) => note.fileName);

  const reasons: string[] = [];
  for (const note of notes) {
    const reason = failureReason(note);
    if (reason !== null && !reasons.includes(reason)) reasons.push(reason);
  }

  if (reasons.length === 0) {
    const parts: string[] = [];
    if (copied.length > 0) parts.push(`공유폴더에도 넣었습니다 — ${copied.join(", ")}`);
    if (unchanged.length > 0) {
      parts.push(`공유폴더에 같은 파일이 이미 있어 그대로 두었습니다 — ${unchanged.join(", ")}`);
    }
    if (parts.length === 0) return null;
    return { tone: "success", text: parts.join(" / ") };
  }

  const failedCount = notes.length - copied.length - unchanged.length;
  const head =
    notes.length === 1
      ? `${FAILED_PREFIX} 공유폴더에는 넣지 못했습니다`
      : `${FAILED_PREFIX} ${failedCount}장은 공유폴더에 넣지 못했습니다`;
  return { tone: "error", text: `${head} — ${reasons.join(" / ")}` };
}
