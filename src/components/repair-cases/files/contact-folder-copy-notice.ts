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
 * ── 🔴 2026-10-05 조각 12 — 같은 몸통을 **[DATA에 저장]**도 쓴다 ─────────
 * [파일 관리]의 저장된 파일에 붙은 [DATA에 저장]은 그 파일을 연락서 폴더의 `DATA` 폴더에
 * 꽂는다. 결과의 **모양이 올리기와 같아서**(통로가 같은 칸으로 답한다) 읽개 하나로 읽고,
 * **말만 갈라 쓴다**(contactFolderDataSaveNotice) — 올리기는 분류 폴더로, 이 단추는 `DATA`
 * 로 가므로 같은 문장을 쓰면 사람이 어디를 열어야 할지 모른다.
 *
 * 그리고 조각 11 이 남긴 구멍을 메웠다 — 하위 폴더 자리를 **같은 이름의 파일**이 막아
 * 폴더 바로 아래로 비켜 갔을 때, 그 사실을 이제 화면이 말한다(아래 … BLOCKED_TEXT).
 *
 * 값으로 시험한다(contact-folder-copy-notice.test.ts) — DOM 도 네트워크도 없다.
 * ============================================================================
 */

/**
 * 응답의 `contactFolderCopy` 칸. 통로의 ContactFolderCopyNote 와 같은 모양이다.
 * 🔴 올리기 통로(조각 6·11)와 [DATA에 저장] 통로(조각 12)가 **같은 모양**으로 답한다.
 */
export type ContactFolderCopyNote =
  /** 새로 꽂았다. `fileName` 은 디스크에 실제로 쓴 이름(번호가 붙었을 수 있다). */
  | { status: "copied"; fileName: string; categoryFolderBlockedByFile?: boolean }
  /** 같은 내용이 이미 있어 쓰지 않았다. */
  | { status: "unchanged"; fileName: string; categoryFolderBlockedByFile?: boolean }
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

/**
 * 🔴 **조각 11 이 남긴 구멍을 메운다**(조각 12).
 *
 * 분류 폴더 자리에 **같은 이름의 파일**이 있으면 서버는 폴더를 만들지 못하고 연락서 폴더
 * **바로 아래**에 꽂은 뒤 `categoryFolderBlockedByFile` 을 싣는다. 그런데 이 모듈이 모르는
 * 칸을 버려서 **화면이 그 사실을 한 번도 말하지 않았다** — 사람은 파일이 분류 폴더에
 * 있으려니 하고 찾다가 못 찾는다. 🔴 앱은 막은 파일을 지우지 않으므로 치우는 것은 사람이다.
 */
export const CONTACT_FOLDER_COPY_CATEGORY_BLOCKED_TEXT =
  "분류 폴더 자리에 같은 이름의 파일이 있어 연락서 폴더 바로 아래에 넣었습니다 — 탐색기에서 그 파일을 치워 주세요.";

/** 같은 일이 `DATA` 자리에서 일어났을 때(조각 12). */
export const CONTACT_FOLDER_DATA_BLOCKED_TEXT =
  "DATA 자리에 같은 이름의 파일이 있어 연락서 폴더 바로 아래에 넣었습니다 — 탐색기에서 그 파일을 치워 주세요.";

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
  // 🔴 참일 때만 싣는다 — 칸이 없는(예전) 응답을 「막혔다」로 읽지 않는다.
  const blocked = (note as { categoryFolderBlockedByFile?: unknown }).categoryFolderBlockedByFile === true;

  if ((status === "copied" || status === "unchanged") && typeof fileName === "string" && fileName.length > 0) {
    return { status, fileName, ...(blocked ? { categoryFolderBlockedByFile: true } : {}) };
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

/** 넣기는 넣었는데 **자리가 밀렸는가**(같은 이름의 파일이 하위 폴더 자리를 막았다). */
function wasPlaceBlocked(notes: readonly ContactFolderCopyNote[]): boolean {
  return notes.some(
    (note) =>
      (note.status === "copied" || note.status === "unchanged") && note.categoryFolderBlockedByFile === true
  );
}

/**
 * 결과들을 한 줄로 모은다. 할 말이 없으면 null. 올리기와 [DATA에 저장]이 **같은 몸통**을
 * 쓰고 **말만 다르다**(어디에 넣는 일인지 사람이 알아야 한다).
 *
 * 한 번에 여러 장을 다루므로 같은 사유가 여러 번 나온다 — **사유는 겹치지 않게** 모으고
 * 몇 장이 빠졌는지를 앞에 적는다.
 */
function buildNotice(
  notes: readonly ContactFolderCopyNote[],
  words: { copied: string; unchanged: string; failedOne: string; failedMany: (count: number) => string; blocked: string }
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
    if (copied.length > 0) parts.push(`${words.copied} — ${copied.join(", ")}`);
    if (unchanged.length > 0) parts.push(`${words.unchanged} — ${unchanged.join(", ")}`);
    if (parts.length === 0) return null;
    // 🔴 넣기는 했어도 **자리가 밀렸으면** 그 사실을 말한다(조각 11 이 남긴 구멍).
    if (wasPlaceBlocked(notes)) parts.push(words.blocked);
    return { tone: "success", text: parts.join(" / ") };
  }

  const failedCount = notes.length - copied.length - unchanged.length;
  const head = notes.length === 1 ? words.failedOne : words.failedMany(failedCount);
  const text = `${head} — ${reasons.join(" / ")}`;
  return { tone: "error", text: wasPlaceBlocked(notes) ? `${text} / ${words.blocked}` : text };
}

/** 이번에 **올린** 것들의 공유폴더 결과(조각 6·11). */
export function contactFolderCopyNotice(
  notes: readonly ContactFolderCopyNote[]
): ContactFolderCopyNotice | null {
  return buildNotice(notes, {
    copied: "공유폴더에도 넣었습니다",
    unchanged: "공유폴더에 같은 파일이 이미 있어 그대로 두었습니다",
    failedOne: `${FAILED_PREFIX} 공유폴더에는 넣지 못했습니다`,
    failedMany: (count) => `${FAILED_PREFIX} ${count}장은 공유폴더에 넣지 못했습니다`,
    blocked: CONTACT_FOLDER_COPY_CATEGORY_BLOCKED_TEXT,
  });
}

/**
 * [DATA에 저장]의 결과(조각 12). 🔴 **어디에 넣은 일인지 말이 달라야 한다** — 올리기는
 * 분류 폴더로, 이 단추는 `DATA` 로 간다.
 */
export function contactFolderDataSaveNotice(
  notes: readonly ContactFolderCopyNote[]
): ContactFolderCopyNotice | null {
  return buildNotice(notes, {
    copied: "DATA 폴더에 넣었습니다",
    unchanged: "DATA 폴더에 같은 파일이 이미 있어 그대로 두었습니다",
    failedOne: "DATA 폴더에 넣지 못했습니다",
    failedMany: (count) => `${count}건은 DATA 폴더에 넣지 못했습니다`,
    blocked: CONTACT_FOLDER_DATA_BLOCKED_TEXT,
  });
}
