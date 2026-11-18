"use client";

import { useState } from "react";

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
 * 🔴 **고를 거리를 여기서 정하지 않는다.** 열셋(`공통` + 서류 분류 열둘)과 그 차례 · 보일
 * 글자는 전부 domain/contact-folder-save-targets.ts 한 자리에서 온다. 이름표를 베껴 적으면
 * 이름표가 바뀌는 날 이 창만 옛 글자로 남고, 그것은 오류 없이 화면에서만 드러난다.
 *
 * ── 🔴 기본 선택은 `공통` ───────────────────────────────────────────────
 * 아무것도 건드리지 않고 [저장]을 누르면 **2026-10-08 과 같은 일**이 일어난다. 창이 생겼다고
 * 해서 늘 하던 일이 한 걸음 더 어려워지면 안 된다.
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

export type ShareDocFolderPickerDialogProps = {
  /** 🔴 어느 줄을 가져오는 중인지 — 창이 여러 줄 위에 떠도 사람이 헷갈리지 않게 그대로 적는다. */
  relativePath: string;
  /** [저장] — 고른 자리를 넘긴다. 🔴 `null` 이면 `공통`(기본 선택)이다. */
  onSave: (category: ContactFolderSaveTargetCategory | null) => void;
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
            onClick={() => onSave(picked)}
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
