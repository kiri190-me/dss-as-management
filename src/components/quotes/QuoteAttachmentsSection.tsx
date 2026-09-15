"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { QuoteAttachmentSlotCategory } from "@/lib/domain/attachment-category";
import type { QuoteAttachmentSlots } from "@/lib/db/queries/attachments";
import { softDeleteAttachmentAction } from "@/lib/server/actions/attachments";
import {
  checkQuoteAttachmentFile,
  excelOnlyMissingExcelNotice,
  isQuoteExcelAttachedOrQueued,
  pendingQuoteAttachmentQueue,
  quoteAttachmentDeletedText,
  quoteAttachmentUploadedText,
  resolveQuoteSlots,
  signedPdfForPreview,
  withPendingQuoteAttachment,
  type PendingQuoteAttachments,
  type QuotePrintSignedPdf,
  type QuoteSlotLocalChanges,
  type ResolvedQuoteSlots,
} from "./quote-attachment-files";
import {
  uploadQuoteAttachment,
  uploadQueuedQuoteAttachments,
  type QueuedQuoteAttachmentsOutcome,
} from "./quote-attachment-upload";
import { QuoteAttachmentDeleteDialog, QuoteAttachmentSlotsView } from "./QuoteAttachmentParts";

/**
 * ============================================================================
 * 견적서 파일(결재 PDF 1 · 수기 엑셀 1) — 상태와 서버 부르기 (2026-09-15 Q3)
 * ============================================================================
 * 이 파일만 서버 액션(softDeleteAttachmentAction)을 부른다. 그리기는
 * QuoteAttachmentParts.tsx, 문구 · 판정은 quote-attachment-files.ts, 올리기 fetch 는
 * quote-attachment-upload.ts 에 있다 — 그 셋은 `server-only` 없이 시험된다.
 *
 * ── 🔴 상태는 훅(useQuoteAttachments)으로 **폼이** 들고 있는다 ─────────────
 * QuoteEditForm 의 [미리보기 · PDF] 는 폼을 통째로 미리보기로 갈아 그린다(그 자리에서
 * return). 이 구역이 상태를 제 안에 두면 미리보기를 여는 순간 사라진다 — 새 견적서에
 * 골라 둔 파일이 말없이 없어진다. 그래서 상태는 폼 컴포넌트가 부르는 훅에 두고, 이 구역은
 * 그 훅이 돌려준 것을 그리기만 한다. 폼의 다른 값(부품 줄 등)이 미리보기를 지나 살아남는
 * 것과 같은 자리다.
 *
 * ── 두 모드 ────────────────────────────────────────────────────────────
 *  · 새 견적서(quoteId 없음) — 고른 파일을 들고 있다가 폼의 [저장]이 견적서를 만든 **직후**
 *    uploadQueuedAfterCreate 로 차례로 올린다. 하나라도 실패하면 폼이 목록으로 넘기지
 *    않는다(QuoteEditForm 의 handleSubmit).
 *  · 저장된 견적서 — 올리기 · 바꾸기 · 지우기가 [저장]과 따로 **곧바로** 반영된다. 파일은
 *    견적서 칸이 아니고, 올려도 견적서의 version 이 오르지 않는다(mutations/attachments.ts
 *    는 견적서 행을 잠글 뿐 고치지 않는다) — 파일을 만진 뒤 [저장]해도 충돌하지 않는다.
 * ============================================================================
 */

type SlotMessages = Partial<Record<QuoteAttachmentSlotCategory, string>>;

export type QuoteAttachmentsController = {
  /** 저장된 견적서의 id — 새 견적서(아직 저장 전)면 null. */
  quoteId: string | null;
  slots: ResolvedQuoteSlots;
  pending: PendingQuoteAttachments<File>;
  errors: SlotMessages;
  busyCategory: QuoteAttachmentSlotCategory | null;
  statusText: string | null;
  deleteTarget: QuoteAttachmentSlotCategory | null;
  deleteError: string | null;
  isDeleting: boolean;
  /** 엑셀 칸이 차 있거나 새 견적서가 들고 있다 — 엑셀 전용 안내를 끈다. */
  excelAttachedOrQueued: boolean;
  /** 겹쳐 뜬 미리보기(엑셀 전용)에 보일 결재 PDF. */
  signedPdfForPreview: QuotePrintSignedPdf | null;
  pickFile: (category: QuoteAttachmentSlotCategory, file: File) => void;
  retry: (category: QuoteAttachmentSlotCategory) => void;
  clearPending: (category: QuoteAttachmentSlotCategory) => void;
  requestDelete: (category: QuoteAttachmentSlotCategory) => void;
  cancelDelete: () => void;
  confirmDelete: () => void;
  /**
   * 새 견적서를 만든 직후 들고 있던 파일을 올린다. 던지지 않는다. 올린 것은 칸에 그리고,
   * 못 올린 것은 까닭과 함께 들고 있는다([다시 올리기]).
   */
  uploadQueuedAfterCreate: (
    quoteId: string,
    onProgress: (current: number, total: number) => void
  ) => Promise<QueuedQuoteAttachmentsOutcome>;
};

const DELETE_FAILED_MESSAGE = "지우기 요청이 끝나지 못했습니다. 잠시 후 다시 시도해 주세요.";

export function useQuoteAttachments({
  quoteId,
  serverSlots,
}: {
  quoteId: string | null;
  /** 수정 화면이 서버에서 읽은 칸(listQuoteAttachmentSlots). 새 견적서는 null. */
  serverSlots: QuoteAttachmentSlots | null;
}): QuoteAttachmentsController {
  const router = useRouter();
  const [pending, setPending] = useState<PendingQuoteAttachments<File>>({});
  const [errors, setErrors] = useState<SlotMessages>({});
  const [localChanges, setLocalChanges] = useState<QuoteSlotLocalChanges>({});
  const [busyCategory, setBusyCategory] = useState<QuoteAttachmentSlotCategory | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuoteAttachmentSlotCategory | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const slots = resolveQuoteSlots(serverSlots, localChanges);
  const isNewQuote = quoteId === null;

  function setSlotError(category: QuoteAttachmentSlotCategory, message: string | null) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message === null) delete next[category];
      else next[category] = message;
      return next;
    });
  }

  /**
   * 수정 화면이면 서버 칸을 다시 그려 온다 — 올린 사람 이름이 채워진다. 폼에 적어 둔 값은
   * 그대로다(상태는 다시 만들어지지 않는다). 새 견적서 화면(/quotes/new)은 다시 그려도
   * 칸이 오지 않으므로 부르지 않는다.
   */
  function refreshServerSlots() {
    if (serverSlots !== null) router.refresh();
  }

  async function uploadNow(targetQuoteId: string, category: QuoteAttachmentSlotCategory, file: File) {
    setBusyCategory(category);
    setStatusText(null);
    setSlotError(category, null);
    try {
      const result = await uploadQuoteAttachment(targetQuoteId, category, file);
      if (!result.ok) {
        // 못 올린 파일은 들고 있는다 — [다시 올리기]로 같은 파일을 다시 보낸다.
        setPending((prev) => withPendingQuoteAttachment(prev, category, file));
        setSlotError(category, result.reason);
        return;
      }
      setPending((prev) => withPendingQuoteAttachment(prev, category, null));
      setLocalChanges((prev) => ({ ...prev, [category]: { kind: "uploaded", file: result.file } }));
      setStatusText(quoteAttachmentUploadedText(category, result.replaced));
      refreshServerSlots();
    } finally {
      setBusyCategory(null);
    }
  }

  function pickFile(category: QuoteAttachmentSlotCategory, file: File) {
    // 형식 · 20MB 는 보내기 전에 막는다(서버가 다시 본다).
    const rejection = checkQuoteAttachmentFile(file, category);
    if (rejection !== null) {
      if (quoteId !== null) setPending((prev) => withPendingQuoteAttachment(prev, category, null));
      setSlotError(category, `${file.name}: ${rejection}`);
      return;
    }
    if (quoteId === null) {
      // 새 견적서 — 들고만 있는다. [저장] 뒤에 올린다.
      setPending((prev) => withPendingQuoteAttachment(prev, category, file));
      setSlotError(category, null);
      return;
    }
    void uploadNow(quoteId, category, file);
  }

  function retry(category: QuoteAttachmentSlotCategory) {
    const file = pending[category];
    if (file && quoteId !== null) void uploadNow(quoteId, category, file);
  }

  function clearPending(category: QuoteAttachmentSlotCategory) {
    setPending((prev) => withPendingQuoteAttachment(prev, category, null));
    setSlotError(category, null);
  }

  function requestDelete(category: QuoteAttachmentSlotCategory) {
    setDeleteTarget(category);
    setDeleteError(null);
  }

  function cancelDelete() {
    if (isDeleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function runDelete() {
    const category = deleteTarget;
    if (category === null || isDeleting) return;
    const file = slots[category];
    if (!file) {
      setDeleteTarget(null);
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      // 견적서 id 는 화면 갱신 경로만 정한다 — 권한은 액션이 첨부의 주인을 DB 에서 다시
      // 읽어 고른다(actions/attachments.ts 의 🔴). 성공하면 그 액션의 revalidatePath 가
      // 이 화면을 다시 그리므로 여기서 refresh 를 따로 부르지 않는다.
      const result = await softDeleteAttachmentAction({ attachmentId: file.id, quoteId: quoteId ?? undefined });
      if (!result.ok) {
        setDeleteError(result.message);
        return;
      }
      setLocalChanges((prev) => ({ ...prev, [category]: { kind: "deleted", attachmentId: file.id } }));
      setDeleteTarget(null);
      setStatusText(quoteAttachmentDeletedText(category));
    } catch {
      setDeleteError(DELETE_FAILED_MESSAGE);
    } finally {
      setIsDeleting(false);
    }
  }

  async function uploadQueuedAfterCreate(
    newQuoteId: string,
    onProgress: (current: number, total: number) => void
  ): Promise<QueuedQuoteAttachmentsOutcome> {
    const queue = pendingQuoteAttachmentQueue(pending);
    if (queue.length === 0) return { total: 0, uploaded: [], failures: [] };

    const outcome = await uploadQueuedQuoteAttachments(newQuoteId, queue, onProgress);
    setLocalChanges((prev) => {
      const next = { ...prev };
      for (const item of outcome.uploaded) next[item.category] = { kind: "uploaded", file: item.file };
      return next;
    });
    setPending((prev) => {
      let next = prev;
      for (const item of outcome.uploaded) next = withPendingQuoteAttachment(next, item.category, null);
      return next;
    });
    setErrors((prev) => {
      const next = { ...prev };
      for (const failure of outcome.failures) next[failure.category] = failure.reason;
      return next;
    });
    return outcome;
  }

  return {
    quoteId,
    slots,
    pending,
    errors,
    busyCategory,
    statusText,
    deleteTarget,
    deleteError,
    isDeleting,
    excelAttachedOrQueued: isQuoteExcelAttachedOrQueued({
      isNewQuote,
      excelSlot: slots.QUOTE_EXCEL,
      hasPendingExcel: pending.QUOTE_EXCEL !== undefined,
    }),
    signedPdfForPreview: signedPdfForPreview({
      isNewQuote,
      slot: slots.SIGNED_QUOTE_PDF,
      pendingFileName: pending.SIGNED_QUOTE_PDF?.name ?? null,
    }),
    pickFile,
    retry,
    clearPending,
    requestDelete,
    cancelDelete,
    confirmDelete: () => void runDelete(),
    uploadQueuedAfterCreate,
  };
}

/**
 * 「견적서 파일」 구역 — 폼의 상단 정보 바로 아래에 선다. 훅이 돌려준 것을 그리기만 한다.
 * 엑셀 전용인데 엑셀이 없으면 구역 맨 위에 눈에 띄는 안내를 단다(저장은 막지 않는다).
 */
export default function QuoteAttachmentsSection({
  controller,
  isExcelOnly,
  disabled,
}: {
  controller: QuoteAttachmentsController;
  isExcelOnly: boolean;
  disabled: boolean;
}) {
  const busy = controller.busyCategory !== null || controller.isDeleting;
  const deleteFile = controller.deleteTarget !== null ? controller.slots[controller.deleteTarget] : null;

  return (
    <>
      <QuoteAttachmentSlotsView
        mode={controller.quoteId === null ? "pending" : "saved"}
        slots={controller.slots}
        pending={controller.pending}
        errors={controller.errors}
        busyCategory={controller.busyCategory}
        statusText={controller.statusText}
        notice={excelOnlyMissingExcelNotice({
          isExcelOnly,
          excelAttachedOrQueued: controller.excelAttachedOrQueued,
        })}
        disabled={disabled || busy}
        onPickFile={controller.pickFile}
        onRetry={controller.retry}
        onClearPending={controller.clearPending}
        onRequestDelete={controller.requestDelete}
      />
      {controller.deleteTarget !== null && deleteFile ? (
        <QuoteAttachmentDeleteDialog
          category={controller.deleteTarget}
          file={deleteFile}
          isSubmitting={controller.isDeleting}
          error={controller.deleteError}
          onConfirm={controller.confirmDelete}
          onCancel={controller.cancelDelete}
        />
      ) : null}
    </>
  );
}
