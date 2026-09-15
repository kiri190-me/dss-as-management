import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { listLiveQuoteAttachments } from "@/lib/db/queries/attachments";
import { getQuoteForEdit } from "@/lib/db/queries/quotes";
import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/domain/attachment-allowlist";
import { decideAttachmentDownload } from "@/lib/domain/attachment-download-policy";
import { AttachmentPathError, resolveAttachmentAbsolutePath } from "@/lib/domain/attachment-path";
import {
  buildQuoteExcelPreview,
  QUOTE_EXCEL_PREVIEW_FAILURE_MESSAGES,
  readAttachmentBytesWithinLimit,
  type QuoteExcelPreviewFailureCode,
  type QuoteExcelPreviewResult,
} from "@/lib/server/services/quote-excel-preview";
import { getAttachmentStorage, resolveUploadsRoot } from "@/lib/storage/local-fs-adapter";
import { isValidQuoteId } from "@/lib/validation/quote-input";
import { QUOTE_EXCEL_MISSING_MESSAGE, decideQuoteDownloadSource } from "../xlsx/download-source";

/**
 * ============================================================================
 * GET /api/quotes/{id}/excel-preview — 엑셀 전용 견적서에 붙인 수기 엑셀을 인쇄 모양의 격자로 (견적서 ②b)
 * ============================================================================
 * 엑셀 전용 견적서의 미리보기(QuotePrintView 의 엑셀 전용 갈래)가 부른다. 붙인 수기 견적서
 * 엑셀(.xlsx)을 **PDF 로 만들었을 때의 모습**으로 그릴 표 자료(②a 의 격자)를 JSON 으로
 * 돌려준다. 읽는 일은 전부 services/quote-excel-preview.ts 가 하고, 이 파일은 문지기와 응답
 * 모양만 맡는다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 · 살아 있는 계정 · 승인 → 3) 권한(quotes READ) → 4) id 형식
 *  → 5) 견적서(휴지통이면 없는 것) → 6) 엑셀 전용인가(아니면 409) → 7) 붙인 엑셀 고르기
 *  (받기 통로와 같은 decideQuoteDownloadSource — 없으면 404) → 8) 검사 판정(첨부 내려받기와
 *  같은 decideAttachmentDownload) → 9) .xls 면 415(바이트를 읽지 않는다) → 10) 경로 검증 ·
 *  저장소에서 읽기(20MB 상한) → 11) 격자 → 12) JSON
 *
 * 3번이 5번보다 앞인 이유: 권한이 없는 사람에게는 "그 id 의 견적서가 있다"는 사실조차 알려
 * 주지 않는다(받기 통로와 같다).
 *
 * ── 왜 READ 로 충분한가 ─────────────────────────────────────────────────
 * 이 통로는 **아무것도 바꾸지 않는다.** 보기 권한자도 들어오는 인쇄 화면(quotes/[id]/print)이
 * 부르고, 그 사람은 받기 통로(GET …/xlsx, READ)로 같은 파일을 이미 받을 수 있다. 같은 파일을
 * 화면에 그려 보이는 것은 그보다 넓은 권한이 아니다. 🔴 문턱은 quotes READ 하나이고 그 밖으로
 * 넓히지 않는다.
 *
 * ── 🔴 감사를 남기지 않는다 ─────────────────────────────────────────────
 * 받기 통로(…/xlsx)는 파일이 **밖으로 나가는** 일이라 EXCEL_EXPORT 감사를 남긴다.
 * 여기는 화면에 그릴 표 자료를 줄 뿐이고, 미리보기를 열 때마다 줄이 쌓이면 "누가 무엇을
 * 가져갔는가"를 찾을 수 없게 된다 — 보고서 그림 통로(service-reports/template-image)와 같은
 * 판단이다. 사람이 [인쇄 · PDF로 저장]으로 만든 PDF 는 브라우저 안의 일이다.
 *
 * ── 🔴 요청 글자는 경로가 되지 않는다 ────────────────────────────────────
 * 요청에서 쓰는 것은 견적서 id 하나이고, 형식을 본 뒤 DB 조회의 열쇠로만 쓴다. 읽을 파일은
 * DB 의 첨부 줄(stored_path)에서 오고 그것도 믿지 않고 저장 루트 안인지 다시 본다
 * (resolveAttachmentAbsolutePath). 통합문서 안의 그림은 파일 안의 관계로만 찾는다(서비스 머리말).
 *
 * ── 로그 · 실패 응답에 값과 경로를 싣지 않는다 ──────────────────────────
 * 로그에는 견적서 · 첨부 id 와 오류 **이름**만 남긴다(메시지에는 경로나 파일의 글자가 섞일 수
 * 있다). 실패 응답은 `{ error, code }` 로 사람이 읽는 문장만 싣는다.
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ grid, warnings }` · `Cache-Control: no-store`(고객 견적서의 내용이다).
 *  · 409 엑셀 전용 아님 · 404 없음 / 붙인 엑셀 없음 · 403 검사 막힘 · 415 옛 .xls ·
 *    422 xlsx 아님 · 너무 큼 · 시트를 못 읽음.
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "DATABASE_MODE_REQUIRED"
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_EXCEL_ONLY"
  | "EXCEL_NOT_ATTACHED"
  | "SCAN_BLOCKED"
  | "FILE_TOO_LARGE"
  | "STORAGE_FAILED"
  | "PREVIEW_FAILED"
  | QuoteExcelPreviewFailureCode;

/** 서비스의 실패 → 응답 코드. 코드가 하나 늘면 컴파일러가 여기를 채우라고 짚는다. */
const STATUS_BY_PREVIEW_FAILURE: Record<QuoteExcelPreviewFailureCode, number> = {
  XLS_LEGACY: 415,
  NOT_XLSX: 422,
  CONTENT_TOO_LARGE: 422,
  SHEET_UNREADABLE: 422,
  SHEET_TOO_LARGE: 422,
};

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // ── 1) 저장 모드 ─────────────────────────────────────────────────────
  if (getAuthSource() !== "database") {
    return fail(403, "DATABASE_MODE_REQUIRED", "데이터베이스 저장 모드가 아닙니다.");
  }

  // ── 2) 세션 · 살아 있는 계정 · 승인 ──────────────────────────────────
  const session = await readSession();
  if (!session) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  // 세션에 박힌 값이 아니라 살아 있는 계정을 다시 읽는다 — 토큰이 발급된 뒤 계정이
  // 정지 · 삭제 · 강등됐을 수 있다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  if (actingUser.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "계정이 아직 승인되지 않았습니다.");
  }

  // ── 3) 권한 — 조회보다 앞이다 ────────────────────────────────────────
  if (!(await hasPermission(actingUser, "quotes", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 4~5) 견적서 ──────────────────────────────────────────────────────
  const { id } = await context.params;
  // 형식이 틀린 id 로 DB 를 때리지 않는다.
  if (!isValidQuoteId(id)) return fail(404, "NOT_FOUND", "해당 견적서를 찾을 수 없습니다.");
  // 지워진 장은 여기서도 없는 것이다(getQuoteForEdit 이 is_deleted 로 좁힌다).
  const quote = await getQuoteForEdit(id);
  if (!quote) return fail(404, "NOT_FOUND", "해당 견적서를 찾을 수 없습니다.");

  // ── 6) 엑셀 전용만 — 일반 견적서의 미리보기는 앱 양식이다 ─────────────────
  if (!quote.isExcelOnly) {
    return fail(409, "NOT_EXCEL_ONLY", "엑셀 전용 견적서가 아닙니다 — 이 견적서의 미리보기는 앱 양식입니다.");
  }

  // ── 7) 붙인 엑셀 — 받기 통로와 같은 고르기 ─────────────────────────────
  const source = decideQuoteDownloadSource(quote, await listLiveQuoteAttachments(quote.id));
  if (source.kind !== "ATTACHED_EXCEL") {
    return fail(404, "EXCEL_NOT_ATTACHED", QUOTE_EXCEL_MISSING_MESSAGE);
  }
  const { attachment, extension } = source;

  // ── 8) 검사 판정 — 첨부 내려받기와 같은 함수 ───────────────────────────
  // 여기까지 온 파일은 주인이 살아 있는 견적서이고 휴지통에 없으므로 막는 것은 검사 상태뿐이다.
  const decision = decideAttachmentDownload({
    repairCaseId: null,
    productModelId: null,
    improvementRequestId: null,
    quoteId: quote.id,
    isDeleted: attachment.isDeleted,
    quoteInTrash: false,
    malwareScanStatus: attachment.malwareScanStatus,
  });
  if (!decision.allowed) {
    return fail(403, "SCAN_BLOCKED", decision.message);
  }

  // ── 9) 옛 .xls — 그릴 수 없다. 바이트를 읽지 않는다 ──────────────────────
  if (extension === "xls") {
    return fail(415, "XLS_LEGACY", QUOTE_EXCEL_PREVIEW_FAILURE_MESSAGES.XLS_LEGACY);
  }

  // ── 10) 저장소에서 읽기 — 경로 검증 · 20MB 상한 ─────────────────────────
  let received: { ok: true; bytes: Buffer } | { ok: false };
  try {
    // 루트 밖을 가리키면 여기서 던진다. 존재 여부는 read 가 알려 준다.
    resolveAttachmentAbsolutePath(resolveUploadsRoot(), attachment.storedPath);
    const stream = await getAttachmentStorage().read(attachment.storedPath);
    received = await readAttachmentBytesWithinLimit(stream, MAX_ATTACHMENT_SIZE_BYTES);
  } catch (error) {
    if (error instanceof AttachmentPathError) {
      console.error("[quote-excel-preview] 붙인 엑셀의 stored_path 가 저장 루트를 벗어난다", {
        quoteId: quote.id,
        attachmentId: attachment.id,
        error: errorNameOf(error),
      });
      return fail(500, "STORAGE_FAILED", "파일 경로를 확인할 수 없습니다. 관리자에게 문의해 주세요.");
    }
    console.error("[quote-excel-preview] 붙인 엑셀을 읽지 못했다", {
      quoteId: quote.id,
      attachmentId: attachment.id,
      error: errorNameOf(error),
    });
    return fail(404, "NOT_FOUND", "저장된 파일을 찾을 수 없습니다. 관리자에게 문의해 주세요.");
  }
  if (!received.ok) {
    return fail(422, "FILE_TOO_LARGE", "붙인 엑셀이 20MB를 넘어 미리보기를 그리지 않았습니다.");
  }

  // ── 11) 격자 — 메모리에서만 읽는다 ─────────────────────────────────────
  let result: QuoteExcelPreviewResult;
  try {
    result = buildQuoteExcelPreview(received.bytes);
  } catch (error) {
    // 서비스는 내용 때문에 던지지 않는다. 여기로 오면 결함이다 — 오류 이름만 남긴다.
    console.error("[quote-excel-preview] 미리보기를 만들다 멈췄다", {
      quoteId: quote.id,
      attachmentId: attachment.id,
      error: errorNameOf(error),
    });
    return fail(500, "PREVIEW_FAILED", "미리보기를 만드는 중 문제가 발생했습니다.");
  }
  if (!result.ok) {
    return fail(STATUS_BY_PREVIEW_FAILURE[result.code], result.code, result.message);
  }

  // ── 12) JSON ────────────────────────────────────────────────────────
  return NextResponse.json(
    { grid: result.grid, warnings: result.warnings },
    {
      status: 200,
      // 고객 견적서의 내용이다. 중간 캐시에 남지 않게 한다.
      headers: { "Cache-Control": "no-store" },
    }
  );
}

/** 로그에 남길 짧은 표지 — 오류 이름만. message 에는 경로나 파일의 값이 섞일 수 있다. */
function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
