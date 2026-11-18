"use client";

import { useState } from "react";

import { isExecutableExtension, normalizeFileExtension } from "@/lib/domain/attachment-allowlist";
import {
  contactFolderSaveTargetLabel,
  type ContactFolderSaveTargetCategory,
} from "@/lib/domain/contact-folder-save-targets";
import { contactFolderShareDocSaveNotice, type ContactFolderCopyNote } from "./contact-folder-copy-notice";
import ShareDocFolderPickerDialog from "./ShareDocFolderPickerDialog";
import { saveShareDocToContactFolder } from "./share-doc-contact-folder-save";

/**
 * ============================================================================
 * 가리킴 한 줄의 [연락서 폴더에 저장] 단추 (2026-10-08)
 * ============================================================================
 * 수리 건 상세 「파일 관리」의 두 구역 — 「그 종류의 공통 서류」와 「이 제품 모델 전용
 * 서류」 — 에서 **[열기] 옆**에 선다. 누르면 그 줄이 가리킨 「1. 수리 관련」 서류함의
 * 파일이 **이 건의 연락서 폴더**에 들어간다.
 *
 * ── 🔴 누르면 **먼저 고르는 창**이 뜬다 (2026-11-18) ────────────────────
 * 2026-10-08 에는 누르는 즉시 `공통` 에 꽂았다. 이제 창이 하나 서고
 * (ShareDocFolderPickerDialog — `공통` + 서류 분류 열둘), 거기서 [저장]을 눌러야 요청이
 * 나간다. 🔴 **아무것도 고르지 않으면 `공통`** 이라 늘 하던 일은 한 걸음도 길어지지 않고,
 * 🔴 **[취소]면 요청이 한 번도 나가지 않는다**(창을 닫을 뿐이다).
 *
 * 🔴 **고를 거리를 이 파일이 정하지 않는다** — 목록도 이름표도 창도 아니고
 * domain/contact-folder-save-targets.ts 한 자리에서 온다.
 *
 * ── 🔴 [열기]와 **다른 물건**이다 ───────────────────────────────────────
 *  · [열기]는 **이 PC 의 도우미**가 하는 일이라 Windows 가 아니면 단추가 없다.
 *  · 이 단추는 **서버가** 읽어 **서버가** 쓴다 — 어느 PC 에서도 똑같이 된다. 그래서
 *    navigator 도 localStorage 도 보지 않는다(도우미 설치 안내와도 무관하다).
 *  · 🔴 바이트가 브라우저를 지나지 않는다 — 내려받기가 아니다.
 *
 * ── 🔴 **누를 수 있는 줄에만** 그린다 ───────────────────────────────────
 * 판정은 아래 canSaveShareDocToContactFolder 한 자리다. 두 줄은 단추가 아예 안 선다:
 *  · **폴더 줄** — 폴더째 복사는 범위가 다르고 상한을 셀 수 없다.
 *  · **실행 파일 줄** — 사내 서류함에 실행 파일을 퍼뜨리는 길이 되면 안 된다.
 * 눌러서 거절당하는 것보다 누를 단추가 없는 것이 낫다 — 바로 옆 [열기]가 허용 목록 밖
 * 확장자에 단추를 안 그리는 것과 **같은 판단**이다.
 *
 * 🔴 **화면이 확장자를 따로 세지 않는다** — 서버가 쓰는 그 함수 둘
 * (`normalizeFileExtension` · `isExecutableExtension`)을 그대로 부른다. 베끼면 목록이
 * 바뀌는 날 한쪽만 고쳐진다. 🔵 `.xlsm` 은 2026-10-08 부터 그 목록 밖이라 단추가 **선다**.
 *
 * 🔴 **서버의 거절은 그대로다.** 여기서 감추는 것은 「눌러도 막히는 단추를 안 내미는」
 * 일이지 안전장치가 아니다 — 주소는 아무 웹페이지나 만든다.
 *
 * ── 🔴 결과를 그 줄 옆에서 말한다 ───────────────────────────────────────
 * 넣었다 / 같은 내용이 이미 있다 / 연락서 폴더가 없다(만드는 길을 가리킨다) / 맞는
 * 폴더가 여럿이다 — 문장은 **[DATA에 저장]과 같은 몸통**에서 나온다
 * (contact-folder-copy-notice.ts 의 contactFolderShareDocSaveNotice). 🔴 **넣은 폴더
 * 이름을 그 문장에 함께 넘긴다** — 고른 자리가 열셋이라, 말이 `공통` 에 박혀 있으면
 * `견적서` 에 넣고도 화면은 `공통` 을 가리켜 사람이 빈 폴더를 열어 본다. 🔴 저장 팝업에
 * 싣지 않는다: 그 팝업은 0.5 초 뒤 저절로 닫히는 성공 전용이라 읽어야 하는 문장을 담을
 * 자리가 아니다.
 *
 * ── 🔴 넣고 나면 위 「공유폴더」 구역에 **다시 읽어라**고 알린다 (2026-11-18) ──
 * 넣는 자리는 **이 건의 연락서 폴더**이고, 그 안을 보여 주는 구역이 같은 화면 위쪽에 있다
 * (ContactFolderSection). 알리지 않으면 폴더는 실제로 생겼는데 화면에는 안 나타나 사람이
 * 브라우저를 새로 고쳐야 한다 — 사용자가 그 일을 겪고 요청했다. 🔴 신호는 **숫자 하나**라
 * (reloadToken) 그 구역이 **보고 있던 자리 그대로** 다시 읽는다.
 * 🔴 **받은 콜백이 없으면 아무 일도 안 난다** — 저장은 그대로 된다. 이 단추는 지금 두
 * 구역에서만 쓰지만, 다시 읽을 구역이 없는 화면에 서는 날 저장이 막히면 안 된다.
 *
 * 🔴 **설정이 비거나 권한이 없으면 이 단추는 아예 그려지지 않는다** — 그 판정은 서버
 * 컴포넌트가 하고(files/page.tsx), 부르는 구역이 참일 때만 이 조각을 세운다. 여기서
 * 권한을 다시 판정하지 않는다(실제 차단은 통로가 다시 한다).
 *
 * 서버 액션을 부르지 않는다 — `server-only` 사슬 없이 그려 볼 수 있다.
 * ============================================================================
 */

export const SHARE_DOC_CONTACT_FOLDER_SAVE_TEXT = "연락서 폴더에 저장";
export const SHARE_DOC_CONTACT_FOLDER_SAVE_BUSY_TEXT = "넣는 중…";
/** 🔴 「어느 폴더에 들어가는가」를 묻는 창이 먼저 뜬다는 사실까지 적는다(2026-11-18). */
export const SHARE_DOC_CONTACT_FOLDER_SAVE_TITLE =
  "넣을 폴더를 고른 뒤 이 서류의 사본을 이 건의 연락서 폴더에 넣습니다 — 공유폴더의 원본은 그대로입니다";

const BUTTON_CLASS =
  "rounded border border-zinc-300 px-1.5 py-0.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";

const NOTICE_TONE_CLASS = {
  success: "text-zinc-700 dark:text-zinc-300",
  error: "font-medium text-amber-700 dark:text-amber-400",
} as const;

/**
 * 🔴 **이 줄에 단추를 그릴 것인가.** 바로 옆 [열기]의 `canOpenKindShareDoc` 과 나란히 선
 * 순수 함수다 — 다만 묻는 것이 다르다: 저쪽은 「이 PC 가 열 수 있는 형식인가」이고,
 * 이쪽은 「사내 폴더에 꽂아도 되는 형식인가」다. 그래서 두 목록이 서로 다르다
 * (`.hwp` 는 열지 못해도 꽂을 수 있고, `.exe` 는 둘 다 안 된다).
 *
 * 🔴 확장자 목록을 여기 적지 않는다 — 서버가 거절에 쓰는 **그 함수 둘**을 그대로 부른다.
 * 확장자가 없는 이름은 실행 파일 목록에 들 수가 없어 통과한다.
 */
export function canSaveShareDocToContactFolder(entryKind: "FILE" | "FOLDER", fileName: string): boolean {
  if (entryKind !== "FILE") return false;
  const extension = normalizeFileExtension(fileName);
  return extension === null || !isExecutableExtension(extension);
}

export type ShareDocContactFolderButtonProps = {
  /** 꽂을 자리를 정하는 수리 건. 통로 주소에 그대로 간다. */
  repairCaseId: string;
  /** 🔴 공유폴더 루트 **기준 상대 경로** — 가리킴 한 줄이 들고 있는 값 그대로다. */
  relativePath: string;
  /**
   * 넣기가 **끝난 뒤** 한 번 불린다 — 위 「공유폴더」 구역을 다시 읽게 하는 신호다
   * (머리말). [DATA에 저장]이 올리는 그 신호와 **같은 이름 · 같은 규율**이다.
   * 🔴 **선택이다** — 안 주면 저장만 되고 아무 일도 일어나지 않는다.
   */
  onSavedToContactFolder?: () => void;
};

export default function ShareDocContactFolderButton({
  repairCaseId,
  relativePath,
  onSavedToContactFolder,
}: ShareDocContactFolderButtonProps) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<ContactFolderCopyNote | null>(null);
  /** 창이 떠 있는가. 🔴 처음에는 닫혀 있다 — 단추를 누르기 전에는 아무것도 안 그려진다. */
  const [picking, setPicking] = useState(false);
  /**
   * **이번에 넣은 폴더의 이름.** 결과 한 줄이 어느 폴더를 가리킬지가 여기서 정해진다 —
   * 🔴 결과와 함께 남아야 하므로 고른 값(picked)이 아니라 **말할 이름**을 담아 둔다.
   */
  const [savedFolderName, setSavedFolderName] = useState(contactFolderSaveTargetLabel(null));

  async function handleSave(category: ContactFolderSaveTargetCategory | null) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    setSavedFolderName(contactFolderSaveTargetLabel(category));
    try {
      // 🔴 던지지 않는다 — 무슨 일이 나도 note 하나로 끝난다(그 모듈의 약속).
      setNote(await saveShareDocToContactFolder({ repairCaseId, relativePath, category }));
    } finally {
      setBusy(false);
      // 🔴 끝나면 **무조건** 알린다 — 넣었든 못 넣었든. [DATA에 저장]이 하는 그대로다
      //    (StoredAttachmentList · ShrinkDownloadDialog 의 finally). 못 넣었을 때는 다시
      //    읽어도 달라질 것이 없을 뿐이고, 다시 읽기가 실패해도 바로 아래 결과 한 줄은
      //    그대로 남는다(그 구역만 「읽지 못했습니다」가 된다).
      //    🔴 성공만 가려 부르면 **같은 구역을 다시 읽는 두 단추**의 규율이 갈라져 나중에
      //    한쪽만 고쳐진다. 🔴 한 번 넣을 때 한 번만 간다 — 두 번째 누르기는 맨 위
      //    `if (busy) return;` 에서 요청도 신호도 없이 돌아선다.
      onSavedToContactFolder?.();
    }
  }

  // 한 줄짜리 결과지만 문장은 **여러 건을 모으는 그 함수**에서 나온다 — 말이 갈라지지 않게.
  const notice = note === null ? null : contactFolderShareDocSaveNotice([note], savedFolderName);

  return (
    <span className="print:hidden flex min-w-0 flex-col items-end gap-0.5 text-right">
      <button
        type="button"
        /* 🔴 여기서 꽂지 않는다 — 창을 열 뿐이다(머리말). 보내는 것은 창의 [저장]이다. */
        onClick={() => setPicking(true)}
        disabled={busy}
        aria-busy={busy}
        aria-haspopup="dialog"
        title={SHARE_DOC_CONTACT_FOLDER_SAVE_TITLE}
        data-share-doc-contact-folder-save=""
        className={BUTTON_CLASS}
      >
        {busy ? SHARE_DOC_CONTACT_FOLDER_SAVE_BUSY_TEXT : SHARE_DOC_CONTACT_FOLDER_SAVE_TEXT}
      </button>
      {notice && (
        <span role="status" className={`block break-all text-xs ${NOTICE_TONE_CLASS[notice.tone]}`}>
          {notice.text}
        </span>
      )}
      {picking && (
        <ShareDocFolderPickerDialog
          relativePath={relativePath}
          /* 🔴 [취소]는 닫기만 한다 — 요청이 한 번도 나가지 않는다. */
          onCancel={() => setPicking(false)}
          onSave={(category) => {
            setPicking(false);
            void handleSave(category);
          }}
        />
      )}
    </span>
  );
}
