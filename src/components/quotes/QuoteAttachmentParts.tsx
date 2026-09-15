"use client";

import { useEffect, useRef } from "react";
import type { QuoteAttachmentSlotCategory } from "@/lib/domain/attachment-category";
import {
  QUOTE_ATTACHMENT_PENDING_NOTE,
  QUOTE_ATTACHMENT_SAVED_NOTE,
  QUOTE_ATTACHMENT_SLOTS,
  describeQuoteAttachmentFile,
  describeQuoteLineCounts,
  formatPendingFileSize,
  quoteAttachmentDeleteText,
  quoteAttachmentDownloadUrl,
  quoteAttachmentViewUrl,
  quoteListFileBadges,
  type QuoteAttachmentSlotDefinition,
  type QuoteAttachmentSlotFileView,
  type QuoteLineCounts,
  type QuoteListFileBadge,
  type ResolvedQuoteSlots,
} from "./quote-attachment-files";

/**
 * ============================================================================
 * 견적서 파일 · 엑셀 전용 — 그리기 조각 (2026-09-15 Q3)
 * ============================================================================
 * 서버 액션을 부르지 않는다 — 올리기 · 지우기는 부르는 쪽이 넘긴 콜백이 한다. 그래서 이
 * 파일은 `server-only` 사슬 없이 그려 볼 수 있다(QuoteAttachmentParts.test.tsx). 상태는
 * QuoteAttachmentsSection.tsx 의 useQuoteAttachments 가, 문구와 판정은
 * quote-attachment-files.ts 가 갖는다.
 *
 * ■ 두 모드
 *   saved   — 저장된 견적서(수정 화면). 칸마다 지금 파일 · [보기] · [내려받기] · [바꾸기] ·
 *             [지우기], 비어 있으면 [파일 올리기]. 누르면 **곧바로** 반영된다.
 *   pending — 새 견적서. 아직 id 가 없어 고른 파일을 들고만 있다가 [저장] 뒤에 올린다.
 *
 * 수정 화면은 쓰기 권한이 있어야 들어온다(quotes/[id]/page.tsx). 보기 권한만 있는 사람이
 * 보는 목록 · 미리보기에는 이 조각이 없다 — 거기에는 올리기 · 지우기 단추가 아예 없다.
 *
 * ■ 확인창은 native `<dialog>` + `showModal()` — 이 앱의 관례(개선 요청 스크린샷과 같다).
 * 열려 있는 동안만 그린다.
 * ============================================================================
 */

const SMALL_BUTTON_CLASS =
  "inline-block rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300";
const SMALL_DANGER_BUTTON_CLASS =
  "rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:border-red-600 disabled:opacity-50 dark:border-red-800 dark:text-red-400";
const DIALOG_CLASS =
  "w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50";
const DIALOG_CANCEL_CLASS =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

// ────────────────────────────────────────────────── 파일 고르기 단추

/**
 * 숨긴 파일 칸을 여는 단추. 고른 뒤 칸을 비워 같은 파일을 다시 고를 수 있게 한다(그러지
 * 않으면 같은 파일을 두 번째 고를 때 change 가 오지 않는다). 칸마다 파일은 하나라 한 개만.
 */
export function QuoteAttachmentFilePicker({
  accept,
  label,
  ariaLabel,
  disabled,
  onFile,
}: {
  accept: string;
  label: string;
  ariaLabel: string;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label={ariaLabel}
        className={SMALL_BUTTON_CLASS}
      >
        {label}
      </button>
    </>
  );
}

// ────────────────────────────────────────────────── 칸 하나

export type PendingFileLike = { name: string; size: number };

export type QuoteAttachmentSlotsMode = "saved" | "pending";

/** 칸 하나. 이름이 길어도 줄바꿈한다(break-all) — 폭 400px 에서 가로로 넘치지 않는다. */
export function QuoteAttachmentSlotCard({
  definition,
  mode,
  file,
  pending,
  error,
  busy,
  disabled,
  onPickFile,
  onRetry,
  onClearPending,
  onRequestDelete,
}: {
  definition: QuoteAttachmentSlotDefinition;
  mode: QuoteAttachmentSlotsMode;
  /** 지금 칸에 붙어 있는 파일(수정 화면). 새 견적서에서는 방금 올린 것만 온다. */
  file: QuoteAttachmentSlotFileView | null;
  /** 들고 있는 파일 — 새 견적서면 [저장] 뒤에 올릴 것, 수정 화면이면 올리지 못한 것. */
  pending: PendingFileLike | null;
  error: string | null;
  /** 이 칸을 올리는 중인가. */
  busy: boolean;
  disabled: boolean;
  onPickFile: (file: File) => void;
  onRetry: () => void;
  onClearPending: () => void;
  onRequestDelete: () => void;
}) {
  const { label, accept, viewableInBrowser } = definition;
  const failedHold = mode === "saved" && pending !== null;

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{label}</span>
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {definition.extensions.join(" · ")} · 20MB 까지
        </span>
      </div>

      {file ? (
        <div className="min-w-0">
          <p className="break-all text-sm text-zinc-800 dark:text-zinc-200">{file.originalFileName}</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{describeQuoteAttachmentFile(file)}</p>
        </div>
      ) : mode === "pending" && pending ? (
        <div className="min-w-0">
          <p className="break-all text-sm text-zinc-800 dark:text-zinc-200">{pending.name}</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {formatPendingFileSize(pending.size)} · [저장]하면 올라갑니다
          </p>
        </div>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {mode === "pending" ? "아직 고른 파일이 없습니다." : "아직 붙인 파일이 없습니다."}
        </p>
      )}

      {busy ? (
        <p role="status" className="text-xs text-zinc-700 dark:text-zinc-300">
          올리는 중…
        </p>
      ) : null}

      {failedHold && pending ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="break-all">
            올리지 못한 파일: {pending.name}
            {error ? ` — ${error}` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button type="button" onClick={onRetry} disabled={disabled} className={SMALL_BUTTON_CLASS}>
              다시 올리기
            </button>
            <button type="button" onClick={onClearPending} disabled={disabled} className={SMALL_BUTTON_CLASS}>
              빼기
            </button>
          </div>
        </div>
      ) : error ? (
        <p role="alert" className="break-all text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {file && mode === "saved" ? (
          <>
            {viewableInBrowser ? (
              // 새 탭에서 페이지 안으로 연다(받기 통로의 view=full → inline). 이 화면 안에
              // 끼워 보여 주지 않는 까닭은 모든 주소에 걸린 frame-ancestors 'none' 이다.
              <a
                href={quoteAttachmentViewUrl(file.id)}
                target="_blank"
                rel="noopener noreferrer"
                className={SMALL_BUTTON_CLASS}
              >
                보기
              </a>
            ) : null}
            <a href={quoteAttachmentDownloadUrl(file.id)} className={SMALL_BUTTON_CLASS}>
              내려받기
            </a>
            <QuoteAttachmentFilePicker
              accept={accept}
              label="바꾸기"
              ariaLabel={`${label} 바꾸기`}
              disabled={disabled}
              onFile={onPickFile}
            />
            <button
              type="button"
              onClick={onRequestDelete}
              disabled={disabled}
              aria-label={`${label} 지우기`}
              className={SMALL_DANGER_BUTTON_CLASS}
            >
              지우기
            </button>
          </>
        ) : mode === "pending" && pending ? (
          <>
            <QuoteAttachmentFilePicker
              accept={accept}
              label="다른 파일로"
              ariaLabel={`${label} 다른 파일로`}
              disabled={disabled}
              onFile={onPickFile}
            />
            <button type="button" onClick={onClearPending} disabled={disabled} className={SMALL_BUTTON_CLASS}>
              빼기
            </button>
          </>
        ) : file ? null : (
          <QuoteAttachmentFilePicker
            accept={accept}
            label="파일 올리기"
            ariaLabel={`${label} 파일 올리기`}
            disabled={disabled}
            onFile={onPickFile}
          />
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────── 두 칸

/** 「견적서 파일」 구역 — 안내 · 두 칸 · 방금 한 일의 한 줄. */
export function QuoteAttachmentSlotsView({
  mode,
  slots,
  pending,
  errors,
  busyCategory,
  statusText,
  statusDetails = null,
  notice,
  disabled,
  onPickFile,
  onRetry,
  onClearPending,
  onRequestDelete,
}: {
  mode: QuoteAttachmentSlotsMode;
  slots: ResolvedQuoteSlots;
  pending: Partial<Record<QuoteAttachmentSlotCategory, PendingFileLike>>;
  errors: Partial<Record<QuoteAttachmentSlotCategory, string>>;
  busyCategory: QuoteAttachmentSlotCategory | null;
  statusText: string | null;
  /**
   * 방금 한 일의 한 줄 아래에 붙는 것 — 결재 PDF 의 공유폴더 결과 줄(2026-09-15 B1c). 부르는
   * 쪽(QuoteAttachmentsSection)이 그려서 넘긴다. 안 주면 지금 그대로다.
   */
  statusDetails?: React.ReactNode;
  /** 엑셀 전용인데 엑셀이 없을 때의 안내(quote-attachment-files.ts 의 excelOnlyMissingExcelNotice). */
  notice: string | null;
  disabled: boolean;
  onPickFile: (category: QuoteAttachmentSlotCategory, file: File) => void;
  onRetry: (category: QuoteAttachmentSlotCategory) => void;
  onClearPending: (category: QuoteAttachmentSlotCategory) => void;
  onRequestDelete: (category: QuoteAttachmentSlotCategory) => void;
}) {
  return (
    <section
      aria-label="견적서 파일"
      className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">견적서 파일</h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">결재 PDF 1개 · 수기 엑셀 1개</span>
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {mode === "saved" ? QUOTE_ATTACHMENT_SAVED_NOTE : QUOTE_ATTACHMENT_PENDING_NOTE}
      </p>

      {notice ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {notice}
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {QUOTE_ATTACHMENT_SLOTS.map((definition) => (
          <QuoteAttachmentSlotCard
            key={definition.category}
            definition={definition}
            mode={mode}
            file={slots[definition.category]}
            pending={pending[definition.category] ?? null}
            error={errors[definition.category] ?? null}
            busy={busyCategory === definition.category}
            disabled={disabled}
            onPickFile={(file) => onPickFile(definition.category, file)}
            onRetry={() => onRetry(definition.category)}
            onClearPending={() => onClearPending(definition.category)}
            onRequestDelete={() => onRequestDelete(definition.category)}
          />
        ))}
      </div>

      {statusText ? (
        <p role="status" className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">
          {statusText}
        </p>
      ) : null}
      {statusDetails}
    </section>
  );
}

// ────────────────────────────────────────────────── 확인창

/** 그려지는 순간 모달로 연다. 닫기는 부모 상태를 걷어 이 조각을 치우는 것이다. */
function useShowModalOnMount() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return dialogRef;
}

/** 한 칸의 파일 지우기 확인 — 첨부 휴지통으로 간다. */
export function QuoteAttachmentDeleteDialog({
  category,
  file,
  isSubmitting,
  error,
  onConfirm,
  onCancel,
}: {
  category: QuoteAttachmentSlotCategory;
  file: QuoteAttachmentSlotFileView;
  isSubmitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useShowModalOnMount();
  const text = quoteAttachmentDeleteText(category);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="quote-attachment-delete-title"
      onCancel={(event) => {
        event.preventDefault();
        if (isSubmitting) return;
        onCancel();
      }}
      className={DIALOG_CLASS}
    >
      <h2 id="quote-attachment-delete-title" className="text-sm font-semibold">
        {text.title}
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{text.body}</p>
      <p className="mt-2 break-all text-xs text-zinc-700 dark:text-zinc-300">{file.originalFileName}</p>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={isSubmitting} className={DIALOG_CANCEL_CLASS}>
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "옮기는 중..." : "지우기"}
        </button>
      </div>
    </dialog>
  );
}

// ────────────────────────────────────────────────── 엑셀 전용

/**
 * 엑셀 전용 스위치. 켜고 끄는 판정(줄이 있으면 먼저 묻는다)은 부르는 쪽이 한다 — 여기서는
 * 사람이 누른 방향만 넘긴다. 체크 상태는 부르는 쪽의 값이라, 묻는 동안에는 꺼진 채다.
 */
export function ExcelOnlySwitch({
  checked,
  disabled,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(event.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 shrink-0"
      />
      <span className="min-w-0">
        <span className="font-medium text-zinc-900 dark:text-zinc-50">엑셀 전용 견적서</span>
        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
          손으로 만든 엑셀로 발행합니다 — 부품 · 수리 작업 · 작업 내역 · 작업비 구역을 쓰지 않고 공급가액을 직접
          적습니다. [견적서 받기]는 「수기 견적서 엑셀」 칸에 붙인 파일을 내려줍니다.
        </span>
      </span>
    </label>
  );
}

/**
 * 줄이 있는 견적서에서 엑셀 전용을 켜려 할 때. 서버는 줄이 있는 엑셀 전용 장을 **거절한다**
 * (조용히 지우지 않는다) — 그래서 켜는 순간 줄을 비울지 묻는다. 비운 줄은 저장 전에 끄면
 * 돌아온다.
 */
export function ExcelOnlyClearLinesDialog({
  counts,
  onConfirm,
  onCancel,
}: {
  counts: QuoteLineCounts;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useShowModalOnMount();
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="quote-excel-only-clear-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className={DIALOG_CLASS}
    >
      <h2 id="quote-excel-only-clear-title" className="text-sm font-semibold">
        엑셀 전용으로 바꾸려면 적힌 줄을 비워야 합니다
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        엑셀 전용 견적서에는 부품 · 작업 내역 · 수리 작업 줄을 둘 수 없습니다 — 줄이 있으면 저장이 거절됩니다.
        지금 적힌 {describeQuoteLineCounts(counts)}을 화면에서 비우고 켤까요?
      </p>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        저장하기 전에 엑셀 전용을 끄면 비운 줄이 그대로 돌아옵니다. 켠 채로 저장하면 줄 없이 저장됩니다.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={DIALOG_CANCEL_CLASS}>
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 dark:bg-primary-100 dark:text-zinc-900 dark:hover:bg-primary-300"
        >
          줄을 비우고 켜기
        </button>
      </div>
    </dialog>
  );
}

// ────────────────────────────────────────────────── 목록 표시

const BADGE_TONE_CLASS: Record<QuoteListFileBadge["tone"], string> = {
  info: "rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",
  neutral:
    "rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400",
  warning:
    "rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
};

/**
 * 목록 한 줄의 표시(엑셀 전용 · 결재 PDF · 엑셀 없음). 부르는 쪽의 `flex-wrap` 줄 안에
 * 그대로 흘러 들어가도록 조각(fragment)으로 돌려준다 — 좁은 화면에서는 줄바꿈된다.
 * 붙일 것이 없으면 아무것도 그리지 않는다(일반 견적서는 지금 그대로).
 */
export function QuoteFileBadges({
  row,
}: {
  row: { isExcelOnly: boolean; hasSignedPdf: boolean; hasExcel: boolean };
}) {
  const badges = quoteListFileBadges(row);
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map((badge) => (
        <span key={badge.key} title={badge.title} className={BADGE_TONE_CLASS[badge.tone]}>
          {badge.label}
        </span>
      ))}
    </>
  );
}
