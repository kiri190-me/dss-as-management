import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { QUOTE_EXCEL_MISSING_MESSAGE, decideQuoteDownloadSource } from "@/app/api/quotes/[id]/xlsx/download-source";
import { QuoteAttachmentRejectedError, createAttachmentRecord } from "@/lib/db/mutations/attachments";
import { recordQuoteExport } from "@/lib/db/mutations/quote-exports";
import { listLiveQuoteAttachments } from "@/lib/db/queries/attachments";
import { getQuoteForEdit, type QuoteEditData } from "@/lib/db/queries/quotes";
import { MAX_ATTACHMENT_SIZE_BYTES, canonicalMimeTypeForExtension } from "@/lib/domain/attachment-allowlist";
import { liveQuoteAttachmentInSlot } from "@/lib/domain/attachment-category";
import { decideAttachmentDownload } from "@/lib/domain/attachment-download-policy";
import { AttachmentPathError, buildQuoteAttachmentStoredPath } from "@/lib/domain/attachment-path";
import { quoteArchiveFileName, type QuoteArchiveNamingInput } from "@/lib/domain/quote-archive-naming";
import {
  QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE,
  canRenderQuoteDocument,
} from "@/lib/domain/quote-document-support";
import { buildQuoteFileName, type QuoteFileExtension } from "@/lib/domain/quote-file-name";
import type {
  QuoteIssueArchiveResult,
  QuoteIssueAttachmentResult,
  QuoteIssueResult,
} from "@/lib/domain/quote-issue-result";
import { saveToQuoteArchive } from "@/lib/storage/quote-archive";
import { QuoteTemplateError } from "@/lib/storage/quote-template";
import { AttachmentTooLargeError, type StorageAdapter } from "@/lib/storage/storage-adapter";
import { isValidQuoteId } from "@/lib/validation/quote-input";
import { renderQuoteWorkbook } from "./quote-workbook";

/**
 * ============================================================================
 * 수정 권한자의 [견적서 받기] — 만들고 · 공유폴더에 꽂고 · 첨부 칸에 올리고 · 돌려준다
 * ============================================================================
 * POST /api/quotes/{id}/issue 가 부르는 중심 함수다(2026-09-15 사용자 결정 1~4).
 * 결재 PDF 를 올린 뒤의 공유폴더 복사(archiveSignedQuotePdf)도 여기 있다.
 *
 * ── 권한은 보지 않는다 ──────────────────────────────────────────────────
 * quotes WRITE · 출처 · 세션은 라우트가 이미 봤다. 이 함수는 자료의 규칙만 본다 — 휴지통
 * 견적서는 없는 것이고(getQuoteForEdit 가 null), 첨부 칸의 휴지통 판정은 행을 넣는
 * mutation 이 견적서 행을 잠근 트랜잭션에서 다시 한다.
 *
 * ── 일반 견적서 ─────────────────────────────────────────────────────────
 *  1) 채우기 — GET 과 **같은 함수**(quote-workbook.ts). 같은 입력이면 같은 바이트다(zip 의
 *     시각을 고정한다 — xlsx/zip-writer.ts).
 *  2) 공유폴더 저장(루트가 있으면) — 같은 바이트의 파일이 이미 있으면 새로 쓰지 않는다
 *     (storage/quote-archive.ts 의 「내용이 같으면 새로 쓰지 않는다」).
 *  3) 「수기 견적서 엑셀」 칸 — 칸의 지금 파일이 새 바이트와 **같은 sha256** 이면 올리지 않는다
 *     (unchanged). 다르면 올리기 통로와 같은 차례로 올린다: writeTemp → commit →
 *     createAttachmentRecord(칸 교체 · FILE_UPLOAD 감사, 한 트랜잭션). 원래 이름은 공유폴더에
 *     쓴 파일의 이름이다(꺼졌거나 실패했으면 번호 없는 이름 규칙 값).
 *  4) 감사(EXCEL_EXPORT) — GET 과 같은 자리 · 같은 값. 그다음에 바이트를 돌려준다.
 *
 * ── 엑셀 전용 견적서 ────────────────────────────────────────────────────
 * 붙인 엑셀이 곧 문서다 — GET 과 같은 고르기(download-source.ts)와 같은 검사 판정
 * (decideAttachmentDownload)을 거쳐 저장소에서 읽고, 공유폴더에 **복사만** 한다(붙인 파일의
 * 확장자 그대로). 칸은 건드리지 않는다(skipped).
 *
 * ── 공유폴더 · 첨부가 실패해도 내려받기는 된다 ─────────────────────────────
 * 둘 다 결과로만 알린다(사용자 결정 4). 이 함수가 실패로 끝나는 것은 GET 이 실패하는
 * 자리(견적서 없음 · 양식 · 붙인 엑셀 없음 · 검사 · 저장소 경로)뿐이다.
 *
 * ── 로그 ────────────────────────────────────────────────────────────────
 * 오류 객체를 통째로 넘기지 않는다 — fs · DB 오류의 message 에는 경로 · 입력값이 섞인다.
 * 견적서 id · 단계 · 오류 코드 · 짧은 사유만 남긴다.
 * ============================================================================
 */

/** 앱 양식을 채운 파일의 형식 — GET 받기 통로의 Content-Type 과 같은 값이다. */
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const QUOTE_NOT_FOUND_MESSAGE = "해당 견적서를 찾을 수 없습니다.";
const RENDER_FAILED_MESSAGE = "견적서를 만들지 못했습니다. 관리자에게 문의해 주세요.";
const STORED_PATH_INVALID_MESSAGE = "파일 경로를 확인할 수 없습니다. 관리자에게 문의해 주세요.";
const STORED_FILE_MISSING_MESSAGE = "저장된 파일을 찾을 수 없습니다. 관리자에게 문의해 주세요.";

const SLOT_TOO_LARGE_REASON = "견적서 파일이 20MB를 넘어 첨부 칸에 올리지 못했습니다.";
const SLOT_STORAGE_FAILED_REASON = "첨부 칸에 올릴 파일을 저장하지 못했습니다.";
const SLOT_RECORD_FAILED_REASON = "첨부 기록을 저장하지 못해 첨부 칸에 올리지 못했습니다.";

const SIGNED_PDF_QUOTE_MISSING_REASON = "견적서를 찾을 수 없어 결재 PDF 를 공유폴더에 복사하지 못했습니다.";
const SIGNED_PDF_READ_FAILED_REASON = "결재 PDF 를 읽지 못해 공유폴더에 복사하지 못했습니다.";

/** 실패 — 라우트가 GET 과 같은 코드 · 응답 코드로 바꾼다. */
export type QuoteIssueFailureCode =
  /** 견적서가 없다 · 휴지통이다 · 붙인 엑셀의 실물이 없다. */
  | "NOT_FOUND"
  /** 엑셀 전용 견적서인데 붙인 엑셀이 없다. */
  | "EXCEL_NOT_ATTACHED"
  /**
   * 🔴 앱 양식이 아직 없는 종류다 — 케이블 견적서(2026-09-16). GET 받기 통로와 **같은
   * 판정 · 같은 문장**이고, 라우트가 501 로 바꾼다(domain/quote-document-support.ts).
   */
  | "KIND_NOT_SUPPORTED"
  /** 붙인 엑셀이 악성코드 검사에 막혔다. */
  | "SCAN_BLOCKED"
  /** 원본 양식을 읽지 못했다. */
  | "TEMPLATE_UNAVAILABLE"
  /** 양식을 채우지 못했다. */
  | "RENDER_FAILED"
  /** 붙인 엑셀의 저장 경로가 저장 루트를 벗어난다. */
  | "STORAGE_FAILED";

export type IssueQuoteFileInput = {
  quoteId: string;
  actorUserId: string;
  /** 공유폴더 루트(resolveQuoteArchiveRoot). null 이면 저장이 꺼져 있다. 시험은 임시 폴더를 준다. */
  archiveRoot: string | null;
  /** 첨부 저장소(getAttachmentStorage). 시험은 임시 폴더의 어댑터를 준다. */
  storage: StorageAdapter;
};

export type IssueQuoteFileOutcome =
  | {
      ok: true;
      bytes: Buffer;
      /** 내려받는 파일 이름 — 기존 이름 규칙(buildQuoteFileName) 그대로. */
      fileName: string;
      contentType: string;
      result: QuoteIssueResult;
    }
  | { ok: false; code: QuoteIssueFailureCode; message: string };

export async function issueQuoteFile(input: IssueQuoteFileInput): Promise<IssueQuoteFileOutcome> {
  // 형식이 틀린 id 로 DB 를 때리지 않는다(라우트도 먼저 거른다).
  if (!isValidQuoteId(input.quoteId)) return fail("NOT_FOUND", QUOTE_NOT_FOUND_MESSAGE);

  // 지워진 장은 없는 것이다 — 휴지통 견적서를 주소만으로 공유폴더에 꽂을 수 없다.
  const quote = await getQuoteForEdit(input.quoteId);
  if (!quote) return fail("NOT_FOUND", QUOTE_NOT_FOUND_MESSAGE);

  /**
   * 🔴 앱 양식이 아직 없는 종류(케이블)는 **여기서 멈춘다** — GET 받기 통로와 같은 판정
   * 하나를 본다(domain/quote-document-support.ts). 이 통로는 만든 파일을 **공유폴더와
   * 첨부 칸에 남기므로**, 잘못된 문서가 나가면 사람의 서류함에까지 들어간다.
   * 엑셀 전용 장은 앱 양식을 쓰지 않아 지나간다(종류와 무관하다).
   */
  if (!canRenderQuoteDocument(quote)) {
    return fail("KIND_NOT_SUPPORTED", QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE);
  }

  return quote.isExcelOnly ? issueAttachedExcel(quote, input) : issueRenderedWorkbook(quote, input);
}

/** 일반 견적서 — 채우기 → 공유폴더 → 첨부 칸 → 감사 → 바이트. */
async function issueRenderedWorkbook(quote: QuoteEditData, input: IssueQuoteFileInput): Promise<IssueQuoteFileOutcome> {
  let workbook: Buffer;
  try {
    workbook = await renderQuoteWorkbook(quote);
  } catch (err) {
    if (err instanceof QuoteTemplateError) return fail("TEMPLATE_UNAVAILABLE", err.message);
    // GET 과 같은 기록 — 값 자체는 담지 않는다(품명 · 신고증상에 고객사 사정이 섞인다).
    console.error("[quote-issue] 견적서를 만들지 못했다", {
      quoteId: quote.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail("RENDER_FAILED", RENDER_FAILED_MESSAGE);
  }

  const naming = archiveNamingOf(quote);
  const archive = await copyToArchive({
    quoteId: quote.id,
    archiveRoot: input.archiveRoot,
    quoteDate: quote.quoteDate,
    naming,
    bytes: workbook,
    target: { fileKind: "QUOTE_FILE", extension: "xlsx" },
  });

  const attachment = await placeInExcelSlot({
    quoteId: quote.id,
    actorUserId: input.actorUserId,
    storage: input.storage,
    bytes: workbook,
    originalFileName: slotFileName(archive, naming, quote),
  });

  // 감사 — 파일을 돌려주기 전에 남긴다(GET 과 같은 자리 · 같은 값).
  await recordQuoteExport({ quoteId: quote.id, quoteNumber: quote.quoteNumber, actorUserId: input.actorUserId });

  return {
    ok: true,
    bytes: workbook,
    fileName: buildQuoteFileName({ quoteNumber: quote.quoteNumber, customerName: quote.customerNameText }),
    contentType: XLSX_CONTENT_TYPE,
    result: { archive, attachment },
  };
}

/** 엑셀 전용 견적서 — 붙인 엑셀을 읽어 공유폴더에 복사만 하고 돌려준다. 칸은 건드리지 않는다. */
async function issueAttachedExcel(quote: QuoteEditData, input: IssueQuoteFileInput): Promise<IssueQuoteFileOutcome> {
  const source = decideQuoteDownloadSource(quote, await listLiveQuoteAttachments(quote.id));
  if (source.kind !== "ATTACHED_EXCEL") {
    // 엑셀 전용 장이라 앱 양식(TEMPLATE)으로 떨어질 일은 없다 — 남는 것은 「붙인 엑셀 없음」이다.
    return fail("EXCEL_NOT_ATTACHED", QUOTE_EXCEL_MISSING_MESSAGE);
  }
  const { attachment, extension } = source;

  // GET 과 같은 판정 — 여기까지 온 파일은 주인이 살아 있는 견적서의 살아 있는 파일이라
  // 막는 것은 검사 상태뿐이다.
  const decision = decideAttachmentDownload({
    repairCaseId: null,
    productModelId: null,
    improvementRequestId: null,
    quoteId: quote.id,
    isDeleted: attachment.isDeleted,
    quoteInTrash: false,
    malwareScanStatus: attachment.malwareScanStatus,
  });
  if (!decision.allowed) return fail("SCAN_BLOCKED", decision.message);

  let bytes: Buffer;
  try {
    // 저장 루트 밖을 가리키는 경로는 어댑터가 AttachmentPathError 로 거절한다.
    bytes = await readAllBytes(await input.storage.read(attachment.storedPath));
  } catch (error) {
    if (error instanceof AttachmentPathError) {
      console.error("[quote-issue] 붙인 엑셀의 stored_path 가 저장 루트를 벗어난다", {
        quoteId: quote.id,
        attachmentId: attachment.id,
      });
      return fail("STORAGE_FAILED", STORED_PATH_INVALID_MESSAGE);
    }
    console.error("[quote-issue] 붙인 엑셀을 읽지 못했다", {
      quoteId: quote.id,
      attachmentId: attachment.id,
      code: errorCodeOf(error),
    });
    return fail("NOT_FOUND", STORED_FILE_MISSING_MESSAGE);
  }

  const archive = await copyToArchive({
    quoteId: quote.id,
    archiveRoot: input.archiveRoot,
    quoteDate: quote.quoteDate,
    naming: archiveNamingOf(quote),
    bytes,
    target: { fileKind: "QUOTE_FILE", extension },
  });

  await recordQuoteExport({ quoteId: quote.id, quoteNumber: quote.quoteNumber, actorUserId: input.actorUserId });

  return {
    ok: true,
    bytes,
    // 이름 규칙은 그대로, 확장자만 붙인 파일의 것(xlsx · xls) — GET 과 같다.
    fileName: buildQuoteFileName({ quoteNumber: quote.quoteNumber, customerName: quote.customerNameText, extension }),
    // 올릴 때 확장자에서 서버가 고른 정본 MIME 이다(GET 과 같다).
    contentType: attachment.mimeType,
    result: { archive, attachment: { status: "skipped" } },
  };
}

/**
 * 결재 PDF 한 장을 공유폴더의 그 견적서 폴더에 `… - 有印.pdf` 로 복사한다. 올리기 통로가
 * 기록을 만든 **뒤에** 부른다. 루트가 null 이면 disabled. **던지지 않는다** — 올리기 응답의
 * 코드 · 기존 칸을 바꾸지 않기 위해서다.
 */
export async function archiveSignedQuotePdf(input: {
  quoteId: string;
  storedPath: string;
  archiveRoot: string | null;
  storage: StorageAdapter;
}): Promise<QuoteIssueArchiveResult> {
  if (input.archiveRoot === null) return { status: "disabled" };

  try {
    const quote = isValidQuoteId(input.quoteId) ? await getQuoteForEdit(input.quoteId) : null;
    if (!quote) {
      console.error("[quote-issue] 결재 PDF 를 복사할 견적서가 없다", { quoteId: input.quoteId });
      return { status: "failed", reason: SIGNED_PDF_QUOTE_MISSING_REASON };
    }
    const bytes = await readAllBytes(await input.storage.read(input.storedPath));
    return await copyToArchive({
      quoteId: quote.id,
      archiveRoot: input.archiveRoot,
      quoteDate: quote.quoteDate,
      naming: archiveNamingOf(quote),
      bytes,
      target: { fileKind: "SIGNED_PDF" },
    });
  } catch (error) {
    console.error("[quote-issue] 결재 PDF 를 공유폴더에 복사하지 못했다", {
      quoteId: input.quoteId,
      code: errorCodeOf(error),
    });
    return { status: "failed", reason: SIGNED_PDF_READ_FAILED_REASON };
  }
}

// ─────────────────────────────────────────────────── 공유폴더

type ArchiveTarget = { fileKind: "QUOTE_FILE"; extension: QuoteFileExtension } | { fileKind: "SIGNED_PDF" };

/** 공유폴더에 한 파일. 루트가 없으면 disabled. 저장 모듈이 던지지 않으므로 이 함수도 던지지 않는다. */
async function copyToArchive(params: {
  quoteId: string;
  archiveRoot: string | null;
  quoteDate: string;
  naming: QuoteArchiveNamingInput;
  bytes: Uint8Array;
  target: ArchiveTarget;
}): Promise<QuoteIssueArchiveResult> {
  if (params.archiveRoot === null) return { status: "disabled" };

  const saved = await saveToQuoteArchive({
    root: params.archiveRoot,
    quoteDate: params.quoteDate,
    naming: params.naming,
    bytes: params.bytes,
    ...params.target,
  });
  if (saved.status === "failed") {
    // 사유는 저장 모듈이 경로 없이 만든 짧은 문장이다.
    console.error("[quote-issue] 공유폴더에 저장하지 못했다", {
      quoteId: params.quoteId,
      fileKind: params.target.fileKind,
      reason: saved.reason,
    });
  }
  return saved;
}

function archiveNamingOf(quote: QuoteEditData): QuoteArchiveNamingInput {
  return {
    quoteNumber: quote.quoteNumber,
    kind: quote.kind,
    customerName: quote.customerNameText,
    modelName: quote.modelNameText,
    lotNumber: quote.lotNumberText,
    serialNumber: quote.serialNumberText,
  };
}

/**
 * 첨부 칸에 적을 원래 이름 — 공유폴더에 쓴(또는 같은 내용이 이미 있던) 파일의 이름.
 * 공유폴더가 꺼졌거나 실패했으면 번호 없는 이름 규칙 값이다. 이름 규칙이 이름을 만들지
 * 못하는 입력(발행번호가 빈 장 — 검증이 막는다)이면 내려받는 파일 이름으로 대신한다.
 */
function slotFileName(archive: QuoteIssueArchiveResult, naming: QuoteArchiveNamingInput, quote: QuoteEditData): string {
  if (archive.status === "saved" || archive.status === "unchanged") {
    const name = archive.relativePath.split("/").pop();
    if (name) return name;
  }
  try {
    return quoteArchiveFileName(naming, { extension: "xlsx" });
  } catch {
    return buildQuoteFileName({ quoteNumber: quote.quoteNumber, customerName: quote.customerNameText });
  }
}

// ─────────────────────────────────────────────────── 첨부 칸

/**
 * 「수기 견적서 엑셀」 칸에 새 바이트를 올린다 — 올리기 통로와 같은 차례(writeTemp → commit →
 * createAttachmentRecord). 칸의 지금 파일이 같은 sha256 이면 올리지 않는다. **던지지 않는다.**
 */
async function placeInExcelSlot(params: {
  quoteId: string;
  actorUserId: string;
  storage: StorageAdapter;
  bytes: Buffer;
  originalFileName: string;
}): Promise<QuoteIssueAttachmentResult> {
  const { quoteId, storage, bytes } = params;

  if (await excelSlotHoldsSameBytes(quoteId, storage, bytes)) return { status: "unchanged" };

  // ── 임시 자리로 흘려보낸다(상한은 올리기 통로와 같다) ──
  let written;
  try {
    written = await storage.writeTemp(streamOf(bytes), { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
  } catch (error) {
    // 임시 파일은 writeTemp 가 던지기 전에 이미 지웠다.
    logSlotFailure(quoteId, "writeTemp", error);
    return {
      status: "failed",
      reason: error instanceof AttachmentTooLargeError ? SLOT_TOO_LARGE_REASON : SLOT_STORAGE_FAILED_REASON,
    };
  }

  const attachmentId = randomUUID().toLowerCase();
  const storedPath = buildQuoteAttachmentStoredPath({ quoteId, attachmentId, extension: "xlsx" });

  // ── 최종 자리로 (DB 보다 먼저 — 올리기 통로의 ⚠️ 와 같은 까닭) ──
  try {
    await storage.commit(written.tempPath, storedPath);
  } catch (error) {
    await storage.discard(written.tempPath).catch(() => undefined);
    logSlotFailure(quoteId, "commit", error);
    return { status: "failed", reason: SLOT_STORAGE_FAILED_REASON };
  }

  // ── 그다음 DB (견적서 행 잠금 → 판정 · 칸 교체 → 행 + FILE_UPLOAD 감사, 한 트랜잭션) ──
  try {
    const created = await createAttachmentRecord({
      id: attachmentId,
      owner: { kind: "QUOTE", quoteId },
      category: "QUOTE_EXCEL",
      originalFileName: params.originalFileName,
      storedPath,
      mimeType: canonicalMimeTypeForExtension("xlsx") ?? "application/octet-stream",
      fileSize: written.size,
      checksumSha256: written.sha256,
      description: null,
      uploadedBy: params.actorUserId,
    });
    return { status: "replaced", displacedCount: created.displacedAttachmentIds.length };
  } catch (error) {
    // 기록을 만들지 못했으면 방금 놓은 파일은 주인이 없다 — 치워 본다(올리기 통로와 같다).
    await storage.delete(storedPath).catch(() => undefined);
    logSlotFailure(quoteId, "record", error);
    // 잠근 트랜잭션의 판정(견적서가 그 사이 휴지통으로 갔다 등) — 고정 문장이라 그대로 싣는다.
    if (error instanceof QuoteAttachmentRejectedError) return { status: "failed", reason: error.message };
    return { status: "failed", reason: SLOT_RECORD_FAILED_REASON };
  }
}

/**
 * 칸의 지금 파일이 새 바이트와 같은가(sha256). 크기가 다르면 읽지 않는다. 칸 조회
 * (listLiveQuoteAttachments)는 체크섬을 싣지 않으므로 저장소에서 읽어 셈한다 — 조회를
 * 고치는 일은 db 쪽 몫이라 이 조각에서 하지 않았다.
 *
 * 비교하지 못하면(조회 · 읽기 실패) 「다르다」로 친다 — 올리는 쪽으로 틀린다. 칸 교체는 옛
 * 파일을 첨부 휴지통으로 보낼 뿐 잃지 않는다.
 */
async function excelSlotHoldsSameBytes(quoteId: string, storage: StorageAdapter, bytes: Buffer): Promise<boolean> {
  try {
    const current = liveQuoteAttachmentInSlot(await listLiveQuoteAttachments(quoteId), "QUOTE_EXCEL");
    if (!current || current.fileSize !== bytes.byteLength) return false;
    const existing = await readAllBytes(await storage.read(current.storedPath));
    return sha256Hex(existing) === sha256Hex(bytes);
  } catch {
    return false;
  }
}

function logSlotFailure(quoteId: string, step: "writeTemp" | "commit" | "record", error: unknown): void {
  console.error("[quote-issue] 첨부 칸에 올리지 못했다", { quoteId, step, code: errorCodeOf(error) });
}

// ─────────────────────────────────────────────────── 작은 도구

function fail(code: QuoteIssueFailureCode, message: string): IssueQuoteFileOutcome {
  return { ok: false, code, message };
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** 저장소 스트림을 끝까지 읽는다. 첨부는 상한(20MB)이 있어 메모리에 담아도 된다. */
async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 로그에 남길 짧은 표지 — fs 오류 코드 · 오류 이름. message(경로 · 입력값이 섞인다)는 쓰지 않는다. */
function errorCodeOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
    if (error instanceof Error) return error.name;
  }
  return typeof error;
}
