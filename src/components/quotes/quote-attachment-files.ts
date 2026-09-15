import {
  CATEGORY_EXTENSION_ALLOWLIST,
  MAX_ATTACHMENT_SIZE_BYTES,
  getAllowedMimeTypesForExtension,
  isExtensionAllowedForCategory,
  normalizeFileExtension,
} from "@/lib/domain/attachment-allowlist";
import {
  QUOTE_ATTACHMENT_SLOT_CATEGORIES,
  attachmentCategoryLabels,
  type QuoteAttachmentSlotCategory,
} from "@/lib/domain/attachment-category";
import { formatBytes } from "@/lib/domain/image-shrink";
import type { QuoteAttachmentSlotFile, QuoteAttachmentSlots } from "@/lib/db/queries/attachments";

/**
 * ============================================================================
 * 견적서 파일(결재 PDF · 수기 엑셀) · 엑셀 전용 — 화면의 순수 도우미 (2026-09-15 Q3)
 * ============================================================================
 * DOM 도 fetch 도 서버 액션도 만지지 않는다 — 시험이 브라우저 없이 전부 돌린다.
 * 올리기 자체는 quote-attachment-upload.ts, 상태는 QuoteAttachmentsSection.tsx 의
 * useQuoteAttachments, 그리기는 QuoteAttachmentParts.tsx 가 한다.
 *
 * 🔴 **여기의 판정은 편의일 뿐이다.** 형식 · 크기는 올리기 통로
 * (api/quotes/[id]/attachments/route.ts)가 다시 본다 — 20MB 를 다 보내고 거절당하기 전에
 * 알려 주려는 것이다. 판정의 재료도 그 통로와 같은 것을 부른다(분류 허용목록 · 20MB).
 * 여기에 확장자를 따로 적으면 화면은 받는데 서버가 거절하는(또는 그 반대의) 날이 온다.
 *
 * 🔴 파일 이름은 사람이 붙인 것이라 고객사 이름이 섞일 수 있다. 화면에 보이는 것 말고는
 * 어디로도 내보내지 않는다 — console 에도 싣지 않는다.
 * ============================================================================
 */

// ────────────────────────────────────────────────── 칸 정의

export type QuoteAttachmentSlotDefinition = {
  category: QuoteAttachmentSlotCategory;
  /** 칸 이름 — 분류 이름표 그대로(「결재 견적서 PDF」 · 「수기 견적서 엑셀」). */
  label: string;
  /** 받는 확장자 — 분류 허용목록(attachment-allowlist.ts) 그대로. */
  extensions: readonly string[];
  /** 파일 고르기 칸의 accept — 확장자와 그 MIME. */
  accept: string;
  /** 브라우저가 새 탭에서 페이지 안으로 여는 형식인가 — PDF 만(받기 통로의 inline 목록). */
  viewableInBrowser: boolean;
};

/**
 * 형식이 틀렸을 때의 까닭 — 올리기 통로의 415 문구(SLOT_EXTENSION_HINTS)와 같은 말이다.
 * 사람이 화면에서 먼저 보든 서버에서 받든 같은 문장을 읽는다.
 */
const FORMAT_REJECTIONS: Record<QuoteAttachmentSlotCategory, string> = {
  SIGNED_QUOTE_PDF: "결재 견적서는 PDF 로만 올릴 수 있습니다",
  QUOTE_EXCEL: "수기 견적서는 엑셀(xlsx · xls)로만 올릴 수 있습니다",
};

function slotDefinition(category: QuoteAttachmentSlotCategory): QuoteAttachmentSlotDefinition {
  const extensions = CATEGORY_EXTENSION_ALLOWLIST[category] ?? [];
  const accept = [
    ...extensions.map((extension) => `.${extension}`),
    ...extensions.flatMap((extension) => getAllowedMimeTypesForExtension(extension)),
  ].join(",");
  return {
    category,
    label: attachmentCategoryLabels[category],
    extensions,
    accept,
    viewableInBrowser: extensions.length > 0 && extensions.every((extension) => extension === "pdf"),
  };
}

/** 화면의 칸 차례 — QUOTE_ATTACHMENT_SLOT_CATEGORIES 의 차례가 곧 이것이다. */
export const QUOTE_ATTACHMENT_SLOTS: readonly QuoteAttachmentSlotDefinition[] =
  QUOTE_ATTACHMENT_SLOT_CATEGORIES.map(slotDefinition);

export function quoteAttachmentSlotLabel(category: QuoteAttachmentSlotCategory): string {
  return attachmentCategoryLabels[category];
}

// ────────────────────────────────────────────────── 한 파일 사전 검사

function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)}MB`;
}

/**
 * 보내기 전에 거른다. 틀리면 사람이 읽을 까닭, 맞으면 null.
 *
 * 순서는 스크린샷 · 파일 화면과 같다 — 형식 → 빈 파일 → 크기. 형식은 **이름의 확장자**로
 * 본다(서버도 그렇게 본다). 이름만 바꾼 파일은 서버의 앞머리 바이트 대조가 막는다.
 */
export function checkQuoteAttachmentFile(
  file: { name: string; size: number },
  category: QuoteAttachmentSlotCategory
): string | null {
  const extension = normalizeFileExtension(file.name);
  if (!extension || !isExtensionAllowedForCategory(extension, category)) {
    return FORMAT_REJECTIONS[category];
  }
  if (file.size === 0) return "빈 파일은 올릴 수 없습니다";
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return `${formatMegabytes(MAX_ATTACHMENT_SIZE_BYTES)}를 넘습니다 (${formatMegabytes(file.size)})`;
  }
  return null;
}

// ────────────────────────────────────────────────── 주소

/** 올리기 통로. 본문은 파일 바이트 그대로이고 이름 · 칸은 쿼리 문자열이다(multipart 아님). */
export function quoteAttachmentUploadUrl(
  quoteId: string,
  category: QuoteAttachmentSlotCategory,
  fileName: string
): string {
  const query = new URLSearchParams({ fileName, category });
  return `/api/quotes/${encodeURIComponent(quoteId)}/attachments?${query.toString()}`;
}

/** 보기 — 받기 통로가 PDF 를 페이지 안(inline)으로 내준다(inline-view.ts 의 view=full). */
export function quoteAttachmentViewUrl(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}/download?view=full`;
}

/** 내려받기 — 첨부로 내려가고 감사(FILE_DOWNLOAD)가 남는다. */
export function quoteAttachmentDownloadUrl(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}/download`;
}

// ────────────────────────────────────────────────── 칸에 보이는 파일

/**
 * 칸에 그리는 파일. 서버 칸 조회(QuoteAttachmentSlotFile)와 같되 **올린 사람이 비어 있을
 * 수 있다** — 방금 올린 파일은 올리기 통로의 응답만 들고 있고, 그 응답에는 이름이 없다.
 */
export type QuoteAttachmentSlotFileView = Omit<QuoteAttachmentSlotFile, "uploadedByName"> & {
  uploadedByName: string | null;
};

/** 칸마다 이 화면에서 방금 한 일 — 서버가 다시 그려 오기 전까지 화면이 들고 있는다. */
export type QuoteSlotLocalChange =
  | { kind: "uploaded"; file: QuoteAttachmentSlotFileView }
  | { kind: "deleted"; attachmentId: string };

export type QuoteSlotLocalChanges = Partial<Record<QuoteAttachmentSlotCategory, QuoteSlotLocalChange>>;

function timeOf(iso: string): number {
  const parsed = new Date(iso).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * 칸에 지금 그릴 파일 — 서버가 준 칸과 이 화면에서 방금 한 일을 맞춘다.
 *
 *  · 방금 올렸다: 서버가 **같은 파일**을 돌려주면 서버 것(올린 사람 이름이 있다), 아직
 *    옛 것을 주면 방금 올린 것. 서버 쪽이 **더 나중에 올린 다른 파일**이면 그것이 이긴다 —
 *    그 사이 다른 사람이 칸을 바꿨다.
 *  · 방금 지웠다: 서버가 아직 그 파일을 주면 빈 칸, 다른 파일을 주면 그 파일.
 *
 * 새 견적서(서버 칸이 없다)는 방금 올린 것만으로 그린다.
 */
export function resolveQuoteSlotFile(
  server: QuoteAttachmentSlotFile | null | undefined,
  local: QuoteSlotLocalChange | undefined
): QuoteAttachmentSlotFileView | null {
  const serverFile = server ?? null;
  if (!local) return serverFile;
  if (local.kind === "deleted") {
    return serverFile && serverFile.id === local.attachmentId ? null : serverFile;
  }
  if (serverFile && (serverFile.id === local.file.id || timeOf(serverFile.uploadedAt) > timeOf(local.file.uploadedAt))) {
    return serverFile;
  }
  return local.file;
}

export type ResolvedQuoteSlots = Record<QuoteAttachmentSlotCategory, QuoteAttachmentSlotFileView | null>;

export function resolveQuoteSlots(
  serverSlots: QuoteAttachmentSlots | null,
  localChanges: QuoteSlotLocalChanges
): ResolvedQuoteSlots {
  const resolved = {} as ResolvedQuoteSlots;
  for (const category of QUOTE_ATTACHMENT_SLOT_CATEGORIES) {
    resolved[category] = resolveQuoteSlotFile(serverSlots?.[category], localChanges[category]);
  }
  return resolved;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 올린 때 — `YYYY-MM-DD HH:mm`(KST). 한국은 서머타임이 없어 +9 시간을 더해 UTC 로 읽는다. */
export function formatQuoteAttachmentUploadedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const kst = new Date(parsed.getTime() + KST_OFFSET_MS);
  return (
    `${kst.getUTCFullYear()}-${pad2(kst.getUTCMonth() + 1)}-${pad2(kst.getUTCDate())} ` +
    `${pad2(kst.getUTCHours())}:${pad2(kst.getUTCMinutes())}`
  );
}

/** 칸의 둘째 줄 — `크기 · 올린 때 · 올린 사람`. 방금 올려 이름을 모르면 「방금 올림」. */
export function describeQuoteAttachmentFile(file: QuoteAttachmentSlotFileView): string {
  return [
    formatBytes(file.fileSize),
    formatQuoteAttachmentUploadedAt(file.uploadedAt),
    file.uploadedByName ?? "방금 올림",
  ].join(" · ");
}

export function formatPendingFileSize(bytes: number): string {
  return formatBytes(bytes);
}

// ────────────────────────────────────────────────── 들고 있는 파일(새 견적서 · 실패한 것)

/**
 * 칸마다 들고 있는 파일 — **아직 올리지 않았다.** 새 견적서는 id 가 없어 [저장] 뒤에
 * 올리고, 수정 화면에서는 올리기에 실패한 파일을 [다시 올리기]까지 들고 있는다.
 */
export type PendingQuoteAttachments<F> = Partial<Record<QuoteAttachmentSlotCategory, F>>;

/** 한 칸의 파일을 바꾸거나(`file`) 뺀다(`null`). 다른 칸은 그대로다 — 새 객체를 돌려준다. */
export function withPendingQuoteAttachment<F>(
  pending: PendingQuoteAttachments<F>,
  category: QuoteAttachmentSlotCategory,
  file: F | null
): PendingQuoteAttachments<F> {
  const next = { ...pending };
  if (file === null) delete next[category];
  else next[category] = file;
  return next;
}

/** 올릴 차례 — 칸 차례(결재 PDF → 엑셀) 그대로. 비어 있는 칸은 건너뛴다. */
export function pendingQuoteAttachmentQueue<F>(
  pending: PendingQuoteAttachments<F>
): { category: QuoteAttachmentSlotCategory; file: F }[] {
  const queue: { category: QuoteAttachmentSlotCategory; file: F }[] = [];
  for (const category of QUOTE_ATTACHMENT_SLOT_CATEGORIES) {
    const file = pending[category];
    if (file !== undefined) queue.push({ category, file });
  }
  return queue;
}

// ────────────────────────────────────────────────── 문구

/** 수정 화면 — 파일은 [저장]과 따로 바로 반영된다(견적서 칸이 아니다). */
export const QUOTE_ATTACHMENT_SAVED_NOTE =
  "파일은 견적서 칸이 아니라서 올리기 · 바꾸기 · 지우기가 [저장]을 누르지 않아도 바로 반영됩니다. 다시 올리면 새 파일로 바뀌고 옛 파일은 첨부 휴지통으로 갑니다.";

/** 새 견적서 — 아직 id 가 없어 들고만 있다가 [저장] 뒤에 올린다. */
export const QUOTE_ATTACHMENT_PENDING_NOTE =
  "새 견적서는 아직 저장 전이라 고른 파일을 들고만 있습니다 — [저장]을 누르면 견적서를 만든 뒤 차례로 올립니다.";

export type QuoteAttachmentUploadFailure = {
  category: QuoteAttachmentSlotCategory;
  fileName: string;
  reason: string;
};

/**
 * `칸(이름): 까닭 · …`. 서버 문구는 마침표로 끝나므로 끝의 마침표를 떼어 잇는다 — 그대로
 * 두면 문장 안에서 「넘습니다. · …」, 끝에서 「넘습니다..」가 된다.
 */
export function formatQuoteAttachmentFailures(failures: readonly QuoteAttachmentUploadFailure[]): string {
  return failures
    .map(
      (failure) =>
        `${quoteAttachmentSlotLabel(failure.category)}(${failure.fileName}): ${failure.reason.trim().replace(/\.+$/, "")}`
    )
    .join(" · ");
}

/** 「파일 올리는 중 1/2…」 — `current` 는 지금 보내는 파일의 차례(1부터). */
export function quoteAttachmentUploadProgressText(current: number, total: number): string {
  return `파일 올리는 중 ${current}/${total}…`;
}

/**
 * 새 견적서는 저장됐는데 파일 일부를 못 올렸을 때. **견적서는 이미 있다** — 목록으로 넘기지
 * 않고 이 화면에 머물러 무엇을 왜 못 올렸는지와 다시 올리는 길을 알린다.
 */
export function createdWithAttachmentFailuresText(
  total: number,
  failures: readonly QuoteAttachmentUploadFailure[]
): string {
  return (
    `견적서는 등록됐습니다. 파일 ${total}개 중 ${failures.length}개를 올리지 못했습니다 — ` +
    `${formatQuoteAttachmentFailures(failures)}. 아래 「견적서 파일」 칸에서 [다시 올리기]를 눌러 주세요.`
  );
}

/** 수정 화면에서 한 칸을 올린 뒤. 칸 교체로 옛 파일이 밀려났으면 그렇다고 말한다. */
export function quoteAttachmentUploadedText(category: QuoteAttachmentSlotCategory, replaced: boolean): string {
  const label = quoteAttachmentSlotLabel(category);
  return replaced
    ? `「${label}」 파일을 바꿨습니다 — 옛 파일은 첨부 휴지통으로 옮겼습니다.`
    : `「${label}」 파일을 올렸습니다.`;
}

/** 지우기 확인 창의 두 줄. */
export function quoteAttachmentDeleteText(category: QuoteAttachmentSlotCategory): { title: string; body: string } {
  return {
    title: `「${quoteAttachmentSlotLabel(category)}」 파일을 지우시겠습니까?`,
    body: "첨부 휴지통으로 옮깁니다. [저장]을 누르지 않아도 바로 반영되고, 칸은 비어 새 파일을 올릴 수 있습니다.",
  };
}

export function quoteAttachmentDeletedText(category: QuoteAttachmentSlotCategory): string {
  return `「${quoteAttachmentSlotLabel(category)}」 파일을 첨부 휴지통으로 옮겼습니다.`;
}

// ────────────────────────────────────────────────── 엑셀 전용

/**
 * 엑셀 전용 견적서에 **있으면 안 되는 줄**의 수 — 서버 규칙(validation/quote-input.ts 의
 * quoteExcelOnlyFieldErrors)이 세는 그대로다. 줄이 하나라도 있으면 저장이 거절된다.
 *
 * 세는 법은 저장이 거르는 법과 같다: 부품 줄은 품명이나 단가가 적힌 줄(collectFields 가
 * 통째로 빈 줄을 보내지 않는다), 작업 내역은 글자가 있는 줄(검증이 빈 줄을 버린다), 수리
 * 작업은 저장될 그 목록의 줄 수.
 */
export type QuoteLineCounts = { items: number; workScopeLines: number; repairTasks: number };

export function countQuoteLinesForExcelOnly(input: {
  items: readonly { partNameText: string; unitPrice: string }[];
  workScopeTexts: readonly string[];
  repairTaskCount: number;
}): QuoteLineCounts {
  return {
    items: input.items.filter((row) => row.partNameText.trim() !== "" || row.unitPrice.trim() !== "").length,
    workScopeLines: input.workScopeTexts.filter((text) => text.trim() !== "").length,
    repairTasks: input.repairTaskCount,
  };
}

export function hasQuoteLines(counts: QuoteLineCounts): boolean {
  return counts.items + counts.workScopeLines + counts.repairTasks > 0;
}

/** 「부품 2줄 · 작업 내역 5줄 · 수리 작업 1건」 — 0 인 것은 뺀다. */
export function describeQuoteLineCounts(counts: QuoteLineCounts): string {
  const parts: string[] = [];
  if (counts.items > 0) parts.push(`부품 ${counts.items}줄`);
  if (counts.workScopeLines > 0) parts.push(`작업 내역 ${counts.workScopeLines}줄`);
  if (counts.repairTasks > 0) parts.push(`수리 작업 ${counts.repairTasks}건`);
  return parts.join(" · ");
}

/**
 * 엑셀 전용 스위치를 눌렀을 때 할 일 — `T` 는 화면이 들고 있는 줄 묶음(부품 · 작업 내역 ·
 * 손댐 표시 · 고른 수리 작업)이다.
 *
 *  · **켜는데 줄이 있고 아직 묻지 않았다** → 묻는다. 서버는 줄이 있는 엑셀 전용 장을
 *    거절하므로(조용히 지우지 않는다) 켜려면 비워야 한다 — 그 사실을 켜는 순간에 알린다.
 *  · **켠다** → 지금 줄을 `stash` 에 넣고 빈 묶음(`cleared`)으로 바꾼다. 줄이 없어도
 *    넣는다 — 빈 묶음은 「손댄 것」으로 표시돼 양식 기본값이 몰래 다시 채우지 않는다.
 *  · **끈다** → 넣어 둔 줄을 그대로 돌려놓는다(저장 전까지 되돌릴 수 있다). 넣어 둔 것이
 *    없으면(처음부터 엑셀 전용이던 장) 줄은 그대로다.
 */
export type ExcelOnlyTogglePlan<T> =
  | { kind: "ASK_TO_CLEAR"; counts: QuoteLineCounts }
  | { kind: "APPLY"; isExcelOnly: boolean; /** 바꿔 넣을 줄 — null 이면 그대로 둔다. */ lines: T | null; stash: T | null };

export function planExcelOnlyToggle<T>(params: {
  turnOn: boolean;
  counts: QuoteLineCounts;
  confirmedClear: boolean;
  current: T;
  cleared: T;
  stash: T | null;
}): ExcelOnlyTogglePlan<T> {
  if (params.turnOn) {
    if (hasQuoteLines(params.counts) && !params.confirmedClear) {
      return { kind: "ASK_TO_CLEAR", counts: params.counts };
    }
    return { kind: "APPLY", isExcelOnly: true, lines: params.cleared, stash: params.current };
  }
  return { kind: "APPLY", isExcelOnly: false, lines: params.stash, stash: null };
}

/**
 * 엑셀 칸이 차 있거나(서버) 새 견적서가 들고 있는가 — 들고 있으면 [저장] 뒤에 올라가므로
 * 비었다고 알리지 않는다. 수정 화면에서 **올리지 못하고 들고 있는** 파일은 세지 않는다.
 */
export function isQuoteExcelAttachedOrQueued(params: {
  isNewQuote: boolean;
  excelSlot: QuoteAttachmentSlotFileView | null;
  hasPendingExcel: boolean;
}): boolean {
  return params.excelSlot !== null || (params.isNewQuote && params.hasPendingExcel);
}

/**
 * 엑셀 전용인데 엑셀이 없을 때의 안내 — 저장은 된다(새 견적서는 저장한 뒤에야 올릴 수
 * 있다). 다만 그 장의 [견적서 받기]가 내줄 파일이 없으므로 눈에 띄게 알린다.
 */
export function excelOnlyMissingExcelNotice(params: { isExcelOnly: boolean; excelAttachedOrQueued: boolean }): string | null {
  if (!params.isExcelOnly || params.excelAttachedOrQueued) return null;
  return "수기 견적서 엑셀을 붙여 주세요 — 엑셀 전용 견적서의 [견적서 받기]는 붙인 엑셀을 내려줍니다. 붙이기 전에는 받을 파일이 없습니다(저장은 됩니다).";
}

// ────────────────────────────────────────────────── 목록 표시

export type QuoteListFileBadge = {
  key: "EXCEL_ONLY" | "SIGNED_PDF" | "EXCEL_MISSING";
  label: string;
  /** 마우스를 올리면 뜨는 설명. */
  title: string;
  tone: "info" | "neutral" | "warning";
};

/**
 * 목록 한 줄에 붙이는 표시 — 엑셀 전용 · 결재 PDF 있음 · 엑셀 전용인데 엑셀 없음. 없으면
 * 빈 배열이다(일반 견적서에 파일이 없는 줄은 지금 그대로 보인다).
 */
export function quoteListFileBadges(row: {
  isExcelOnly: boolean;
  hasSignedPdf: boolean;
  hasExcel: boolean;
}): QuoteListFileBadge[] {
  const badges: QuoteListFileBadge[] = [];
  if (row.isExcelOnly) {
    badges.push({
      key: "EXCEL_ONLY",
      label: "엑셀 전용",
      title: "품목 없이 손으로 만든 엑셀이 곧 보낸 견적서입니다 — [견적서 받기]가 붙인 엑셀을 내려줍니다.",
      tone: "info",
    });
  }
  if (row.hasSignedPdf) {
    badges.push({ key: "SIGNED_PDF", label: "결재 PDF", title: "결재 견적서 PDF 가 붙어 있습니다.", tone: "neutral" });
  }
  if (row.isExcelOnly && !row.hasExcel) {
    badges.push({
      key: "EXCEL_MISSING",
      label: "엑셀 없음",
      title: "엑셀 전용인데 수기 견적서 엑셀이 붙지 않아 [견적서 받기]가 내줄 파일이 없습니다. 견적서 수정 화면에서 붙여 주세요.",
      tone: "warning",
    });
  }
  return badges;
}

/** 금액 옆 괄호 — 일반 견적서는 품목 수, 엑셀 전용은 손으로 적은 금액이라는 것. */
export function quoteListAmountNote(row: { isExcelOnly: boolean; itemCount: number }): string {
  return row.isExcelOnly ? "수기 공급가액" : `${row.itemCount}품목`;
}

// ────────────────────────────────────────────────── 미리보기(엑셀 전용)

/** 미리보기가 보일 결재 PDF — 올라가 있는 것, 또는 새 견적서가 들고 있는 것. */
export type QuotePrintSignedPdf =
  | { kind: "saved"; id: string; originalFileName: string }
  | { kind: "pending"; fileName: string };

/** 인쇄 화면(서버)이 칸 조회에서 미리보기에 넘길 두 값을 고른다. */
export function excelOnlyPrintAttachments(slots: QuoteAttachmentSlots): {
  signedPdf: QuotePrintSignedPdf | null;
  hasExcel: boolean;
} {
  const pdf = slots.SIGNED_QUOTE_PDF;
  return {
    signedPdf: pdf ? { kind: "saved", id: pdf.id, originalFileName: pdf.originalFileName } : null,
    hasExcel: slots.QUOTE_EXCEL !== null,
  };
}

/** 편집 화면의 겹쳐 뜬 미리보기가 넘길 결재 PDF — 올라간 것이 먼저, 없으면 새 견적서가 든 것. */
export function signedPdfForPreview(params: {
  isNewQuote: boolean;
  slot: QuoteAttachmentSlotFileView | null;
  pendingFileName: string | null;
}): QuotePrintSignedPdf | null {
  if (params.slot) return { kind: "saved", id: params.slot.id, originalFileName: params.slot.originalFileName };
  if (params.isNewQuote && params.pendingFileName !== null) return { kind: "pending", fileName: params.pendingFileName };
  return null;
}

/** 엑셀 전용 미리보기에 결재 PDF 가 없을 때의 문장 — 사용자 결정(2026-09-15) 그대로. */
export const EXCEL_ONLY_NO_SIGNED_PDF_TEXT = "결재 PDF 가 아직 없습니다 — [견적서 받기]로 붙인 엑셀을 받으세요";
