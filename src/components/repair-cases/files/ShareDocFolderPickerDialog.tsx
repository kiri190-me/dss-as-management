"use client";

import { useState } from "react";

import {
  checkContactFolderSaveFileName,
  contactFolderSaveFileNameDefault,
  contactFolderSaveFileNameToSend,
} from "@/lib/domain/contact-folder-save-file-name";
import {
  CONTACT_FOLDER_SAVE_TARGET_OPTIONS,
  type ContactFolderSaveTargetCategory,
} from "@/lib/domain/contact-folder-save-targets";

/**
 * ============================================================================
 * [연락서 폴더에 저장] — **어느 폴더에 넣을까요** 창 (2026-11-18)
 * ============================================================================
 * 2026-10-08 부터 [연락서 폴더에 저장]은 **누르면 곧바로** `공통` 에 꽂았다. 이제 그 사이에
 * 이 창이 선다 — 사람이 자리를 고르고 [저장]을 눌러야 요청이 나간다.
 *
 * 🔴 **고를 거리를 여기서 정하지 않는다.** 열넷(`공통` + 서류 분류 열셋)과 그 차례 · 보일
 * 글자는 전부 domain/contact-folder-save-targets.ts 한 자리에서 온다. 이름표를 베껴 적으면
 * 이름표가 바뀌는 날 이 창만 옛 글자로 남고, 그것은 오류 없이 화면에서만 드러난다.
 * (2026-11-18 에는 열셋이었다 — 2026-11-26 에 분류 `DATA` 가 들어와 하나 늘었고, 이
 * 파일은 **한 줄도 고치지 않았다.** 목록을 베끼지 않은 덕이다.)
 *
 * ── 🔴 기본 선택은 `공통` ───────────────────────────────────────────────
 * 아무것도 건드리지 않고 [저장]을 누르면 **2026-10-08 과 같은 일**이 일어난다. 창이 생겼다고
 * 해서 늘 하던 일이 한 걸음 더 어려워지면 안 된다.
 *
 * ── 🔴 **파일 이름 칸**이 하나 더 있다 (2026-11-26 사용자) ───────────────
 * 「저장될 폴더를 선택한 다음에 파일 이름을 어떻게 할지 적을 수 있도록 (기본적으로 기존
 * 이름이 적혀 있고, 변경할 수 있도록)」 — 그 말 그대로다. 라디오 **아래**에 선다(사용자가
 * 적은 차례가 폴더 먼저, 이름 나중이다).
 *
 * 🔴 **기본값은 「지금 저장될 이름」**이다 — 원본 이름 그대로가 아니라 다듬기를 지난 뒤다.
 * 🔴 **규칙을 이 창이 들고 있지 않다**: 기본값도 · 쓸 수 있는 이름인지도 · 통로에 실어
 * 보낼 값인지도 전부 domain/contact-folder-save-file-name.ts 한 자리에서 온다. 그 머리말에
 * 까닭이 다 적혀 있다(거절형을 고른 까닭 · 확장자를 지키는 까닭 · 비웠을 때).
 *
 * 🔴 **쓸 수 없는 이름이면 창이 안 닫힌다.** [저장]을 눌러도 요청이 나가지 않고 까닭 한
 * 줄이 칸 아래에 선다 — 사람이 **적던 글자를 그대로 쥔 채** 고칠 수 있어야 한다. 창을
 * 닫고 줄 옆에서 말하면 적은 글자가 사라져 처음부터 다시 적어야 한다. 🔴 그 까닭 글귀를
 * 여기서 짓지 않는다(저쪽이 적어 준 것을 그대로 보여 준다). 서버도 같은 함수로 다시 보므로
 * 이 가림막이 없어져도 울타리는 남는다.
 *
 * ── 🔴 이 창은 **아무것도 보내지 않는다** ───────────────────────────────
 * fetch 도 통로 주소도 이 파일에 없다. 고른 값을 `onSave` 로 넘길 뿐이고, [취소]는
 * `onCancel` 하나다 — 그래서 **취소하면 요청이 한 번도 나가지 않는다**(부르는 쪽
 * ShareDocContactFolderButton 이 그 둘을 잇는다). 결과 문장도 저쪽에 남는다.
 *
 * ── 🔴 줄 안에서 태어나지만 줄의 글자 모양을 물려받지 않는다 ────────────
 * 이 창은 가리킴 한 줄의 단추 **옆자리**에서 그려진다. 그 자리는 `text-xs` · `text-right`
 * 이고, `fixed` 로 띄워도 **글자 크기와 정렬은 DOM 부모를 따라 내려온다** — 실제로 표 칸
 * 안에서 태어난 팝업의 글이 오른쪽으로 쏠린 일이 있었다. 그래서 창 안쪽 상자에 `text-left`
 * 와 글자 크기를 **다시 적는다**(지우지 말 것 — 지우면 글이 오른쪽에 붙는다).
 *
 * 생김새는 이웃 ShrinkDownloadDialog 를 본떴다(`role="dialog"` · `aria-modal` ·
 * `fixed inset-0 … bg-black/50` · 아래에서 올라오는 폰 화면).
 * ============================================================================
 */

export const SHARE_DOC_FOLDER_PICKER_TITLE = "어느 폴더에 넣을까요?";
export const SHARE_DOC_FOLDER_PICKER_SAVE_TEXT = "저장";
export const SHARE_DOC_FOLDER_PICKER_CANCEL_TEXT = "취소";
/** 🔴 고른 자리가 **이 건의 연락서 폴더 안**이라는 사실을 적는다(공유폴더 원본은 그대로다). */
export const SHARE_DOC_FOLDER_PICKER_HINT =
  "이 건의 연락서 폴더 안에서 고른 폴더에 사본을 넣습니다 — 없으면 그 폴더를 만들고, 공유폴더의 원본은 그대로 둡니다.";

export const SHARE_DOC_FOLDER_PICKER_FILE_NAME_LABEL = "파일 이름";
/**
 * 🔴 칸 아래에 **두 가지를 미리 말해 둔다.** 둘 다 눌러 본 뒤에 알면 늦는 것이다:
 * 확장자를 지워도 돌아온다는 것과, 비우면 원본 이름이 된다는 것(domain 머리말).
 */
export const SHARE_DOC_FOLDER_PICKER_FILE_NAME_HINT =
  "확장자는 원본과 같게 유지됩니다. 비워 두면 원본 이름 그대로 넣습니다.";

export type ShareDocFolderPickerDialogProps = {
  /** 🔴 어느 줄을 가져오는 중인지 — 창이 여러 줄 위에 떠도 사람이 헷갈리지 않게 그대로 적는다. */
  relativePath: string;
  /**
   * [저장] — 고른 자리와 적은 이름을 넘긴다.
   *  · `category` 가 `null` 이면 `공통`(기본 선택)이다.
   *  · 🔴 `fileName` 이 `null` 이면 **원본 이름 그대로**다 — 손대지 않았거나 비웠다는 뜻이고,
   *    그때 나가는 주소는 2026-11-18 과 한 글자도 다르지 않다.
   */
  onSave: (category: ContactFolderSaveTargetCategory | null, fileName: string | null) => void;
  /** [취소] · [×] — 닫기만 한다. */
  onCancel: () => void;
};

export default function ShareDocFolderPickerDialog({
  relativePath,
  onSave,
  onCancel,
}: ShareDocFolderPickerDialogProps) {
  // 🔴 기본 선택은 `공통` — null 이 그 자리다(머리말).
  const [picked, setPicked] = useState<ContactFolderSaveTargetCategory | null>(null);
  /**
   * 🔴 칸에 **처음부터 적혀 있는 글자 = 지금 저장될 이름**(머리말). 창은 열릴 때마다 새로
   * 태어나므로(부르는 쪽이 `picking` 일 때만 세운다) 처음 한 번 읽는 것으로 충분하다 —
   * 그래서 `useEffect` 로 뒤따라 맞출 일이 없다.
   */
  const [fileName, setFileName] = useState(() => contactFolderSaveFileNameDefault(relativePath));
  /** 쓸 수 없는 이름을 적었을 때의 **까닭 한 줄**. 🔴 글귀는 domain 이 적어 준 그대로다. */
  const [fileNameError, setFileNameError] = useState<string | null>(null);

  function handleSave() {
    const reason = checkContactFolderSaveFileName(fileName);
    if (reason !== null) {
      // 🔴 창을 닫지 않는다 — 적던 글자를 쥔 채 그 자리에서 고치게 한다(머리말).
      setFileNameError(reason);
      return;
    }
    onSave(picked, contactFolderSaveFileNameToSend(fileName, relativePath));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={SHARE_DOC_FOLDER_PICKER_TITLE}
      data-share-doc-folder-picker=""
      className="print:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
    >
      {/* 🔴 `text-left` 와 글자 크기를 다시 적는다 — 줄에서 물려받는 `text-right`·`text-xs` 를 끊는다. */}
      <div className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-left text-sm text-zinc-900 sm:rounded-2xl sm:pb-5 dark:bg-zinc-900 dark:text-zinc-50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {SHARE_DOC_FOLDER_PICKER_TITLE}
            </h2>
            {/* 가리킨 자리를 그대로 적는다 — 긴 경로가 상자를 밀어내지 않게 글자를 끊는다. */}
            <p className="mt-0.5 min-w-0 break-all text-xs text-zinc-500 dark:text-zinc-400">{relativePath}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="닫기"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl leading-none text-zinc-500 dark:text-zinc-400"
          >
            ×
          </button>
        </div>

        <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
          {SHARE_DOC_FOLDER_PICKER_HINT}
        </p>

        <div className="flex flex-col gap-0.5">
          {CONTACT_FOLDER_SAVE_TARGET_OPTIONS.map((option) => (
            <label
              key={option.value}
              data-share-doc-folder-option={option.value}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <input
                type="radio"
                name="share-doc-folder-target"
                value={option.value}
                checked={picked === option.category}
                onChange={() => setPicked(option.category)}
                className="h-4 w-4"
              />
              <span className="min-w-0 break-all">{option.label}</span>
            </label>
          ))}
        </div>

        {/*
          🔴 라디오 **아래**다 — 사용자가 적은 차례가 「폴더를 선택한 다음에 파일 이름을」이다.
          🔴 `min-w-0` 과 `w-full` 을 둘 다 적는다: 이 창은 표 줄 안에서 태어나고, 긴 한글
             이름이 들어오면 칸이 상자를 밀어내 [저장]이 화면 밖으로 나간다.
        */}
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {SHARE_DOC_FOLDER_PICKER_FILE_NAME_LABEL}
          </span>
          <input
            type="text"
            value={fileName}
            onChange={(event) => {
              setFileName(event.target.value);
              // 고치기 시작하면 지난 까닭은 치운다 — 이미 고친 글자 옆에 옛 꾸지람이 남지 않게.
              setFileNameError(null);
            }}
            data-share-doc-folder-picker-file-name=""
            autoComplete="off"
            spellCheck={false}
            aria-invalid={fileNameError !== null}
            className="w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
          {/* 🔴 `break-all` 을 쓰지 않는다 — 한글이 글자마다 끊겨 읽기 어려워진다. */}
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {SHARE_DOC_FOLDER_PICKER_FILE_NAME_HINT}
          </span>
          {fileNameError !== null && (
            <span
              role="alert"
              data-share-doc-folder-picker-file-name-error=""
              className="text-xs font-medium text-amber-700 dark:text-amber-400"
            >
              {fileNameError}
            </span>
          )}
        </label>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            data-share-doc-folder-picker-cancel=""
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            {SHARE_DOC_FOLDER_PICKER_CANCEL_TEXT}
          </button>
          <button
            type="button"
            onClick={handleSave}
            data-share-doc-folder-picker-save=""
            className="rounded-md bg-primary-900 px-4 py-2 text-sm font-medium whitespace-nowrap text-white dark:bg-primary-50 dark:text-zinc-900"
          >
            {SHARE_DOC_FOLDER_PICKER_SAVE_TEXT}
          </button>
        </div>
      </div>
    </div>
  );
}
