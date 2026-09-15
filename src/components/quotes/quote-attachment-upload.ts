import type { QuoteAttachmentSlotCategory } from "@/lib/domain/attachment-category";
import {
  quoteAttachmentUploadUrl,
  type QuoteAttachmentSlotFileView,
  type QuoteAttachmentUploadFailure,
} from "./quote-attachment-files";

/**
 * ============================================================================
 * 견적서 파일 올리기 — 올리기 통로(POST /api/quotes/{id}/attachments)를 부르는 곳 하나
 * ============================================================================
 * 서버 액션이 아니라 fetch 다(본문이 파일 바이트라 통로가 Route Handler 다 — 그 파일
 * 헤더). 서버 액션을 부르지 않으므로 이 파일은 `server-only` 사슬 없이 시험할 수 있다 —
 * fetch 는 부르는 쪽이 바꿔 끼울 수 있다(quote-attachment-upload.test.ts).
 *
 * 새 견적서의 [저장] 뒤 올리기(QuoteEditForm)와 수정 화면의 즉시 올리기
 * (QuoteAttachmentsSection)가 **같은 함수**를 부른다 — 두 벌이면 응답을 읽는 법이 갈린다.
 * ============================================================================
 */

type UploadResponse = { ok: boolean; status: number; json(): Promise<unknown> };

/** 부르는 쪽이 바꿔 끼울 수 있는 fetch — 쓰는 것만 적었다. 기본은 브라우저의 fetch. */
export type QuoteAttachmentFetch = (url: string, init: { method: "POST"; body: Blob }) => Promise<UploadResponse>;

const browserFetch: QuoteAttachmentFetch = (url, init) => fetch(url, init);

export type QuoteAttachmentUploadResult =
  | {
      ok: true;
      file: QuoteAttachmentSlotFileView;
      /** 같은 칸의 옛 파일이 첨부 휴지통으로 갔는가(칸 교체). */
      replaced: boolean;
    }
  | { ok: false; reason: string; status: number | null; code: string | null };

/** 이 응답이면 뒤의 파일도 같은 까닭으로 막힌다(권한 · 없는 견적서 · 휴지통) — 보내지 않는다. */
const STOP_STATUSES = new Set([401, 403, 404, 409]);

/** 한 칸에 파일 하나를 올린다. 던지지 않는다 — 네트워크가 끊겨도 까닭을 돌려준다. */
export async function uploadQuoteAttachment(
  quoteId: string,
  category: QuoteAttachmentSlotCategory,
  file: File,
  fetchImpl: QuoteAttachmentFetch = browserFetch
): Promise<QuoteAttachmentUploadResult> {
  let response: UploadResponse;
  try {
    response = await fetchImpl(quoteAttachmentUploadUrl(quoteId, category, file.name), { method: "POST", body: file });
  } catch {
    return { ok: false, reason: "네트워크 문제로 보내지 못했습니다", status: null, code: null };
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    return {
      ok: false,
      reason: typeof payload?.error === "string" ? payload.error : "서버가 거절했습니다",
      status: response.status,
      code: typeof payload?.code === "string" ? payload.code : null,
    };
  }

  // 올리기는 됐는데 응답을 못 읽었다 — 칸에 무엇을 그릴지 모르므로 실패로 알리고 다시
  // 불러오게 한다(다시 올려도 칸 교체라 파일이 두 개가 되지 않는다).
  if (typeof payload?.id !== "string") {
    return {
      ok: false,
      reason: "올렸지만 서버 응답을 읽지 못했습니다 — 화면을 새로고침해 칸을 확인해 주세요",
      status: response.status,
      code: null,
    };
  }

  const displaced = Array.isArray(payload.displacedAttachmentIds) ? payload.displacedAttachmentIds : [];
  return {
    ok: true,
    file: {
      id: payload.id,
      originalFileName: typeof payload.originalFileName === "string" ? payload.originalFileName : file.name,
      fileSize: typeof payload.fileSize === "number" ? payload.fileSize : file.size,
      uploadedAt: typeof payload.uploadedAt === "string" ? payload.uploadedAt : new Date().toISOString(),
      // 응답에는 올린 사람이 없다 — 칸이 「방금 올림」으로 그리고, 다시 불러오면 이름이 온다.
      uploadedByName: null,
    },
    replaced: displaced.length > 0,
  };
}

export type QueuedQuoteAttachmentsOutcome = {
  total: number;
  uploaded: { category: QuoteAttachmentSlotCategory; file: QuoteAttachmentSlotFileView }[];
  failures: QuoteAttachmentUploadFailure[];
};

/**
 * 새 견적서의 [저장] 뒤 — 들고 있던 파일을 **칸 차례대로 하나씩** 올린다. 권한 · 없는
 * 견적서 · 휴지통(401 · 403 · 404 · 409)에 막히면 뒤의 파일은 보내지 않고 같은 까닭을
 * 붙인다. 던지지 않는다 — 견적서는 이미 저장됐으므로, 여기서 던지면 화면이 「저장이 끝나지
 * 못했다」로 읽고 사람이 다시 눌러 같은 견적서가 두 장 생긴다.
 *
 * `onProgress(지금 보내는 파일의 차례, 전체)`.
 */
export async function uploadQueuedQuoteAttachments(
  quoteId: string,
  queue: readonly { category: QuoteAttachmentSlotCategory; file: File }[],
  onProgress: (current: number, total: number) => void,
  fetchImpl: QuoteAttachmentFetch = browserFetch
): Promise<QueuedQuoteAttachmentsOutcome> {
  const uploaded: QueuedQuoteAttachmentsOutcome["uploaded"] = [];
  const failures: QuoteAttachmentUploadFailure[] = [];
  let stopReason: string | null = null;

  for (let index = 0; index < queue.length; index += 1) {
    const { category, file } = queue[index];
    if (stopReason !== null) {
      failures.push({ category, fileName: file.name, reason: stopReason });
      continue;
    }
    onProgress(index + 1, queue.length);
    const result = await uploadQuoteAttachment(quoteId, category, file, fetchImpl);
    if (result.ok) {
      uploaded.push({ category, file: result.file });
      continue;
    }
    failures.push({ category, fileName: file.name, reason: result.reason });
    if (result.status !== null && STOP_STATUSES.has(result.status)) stopReason = result.reason;
  }

  return { total: queue.length, uploaded, failures };
}
