import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { listLiveQuoteAttachments } from "@/lib/db/queries/attachments";
import { getQuoteForEdit } from "@/lib/db/queries/quotes";
import { recordQuoteExport } from "@/lib/db/mutations/quote-exports";
import { decideAttachmentDownload } from "@/lib/domain/attachment-download-policy";
import {
  QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE,
  canRenderQuoteDocument,
} from "@/lib/domain/quote-document-support";
import { AttachmentPathError, resolveAttachmentAbsolutePath } from "@/lib/domain/attachment-path";
import { buildQuoteFileName, quoteContentDisposition } from "@/lib/domain/quote-file-name";
import { isValidQuoteId } from "@/lib/validation/quote-input";
import { QuoteTemplateError } from "@/lib/storage/quote-template";
import { getAttachmentStorage, resolveUploadsRoot } from "@/lib/storage/local-fs-adapter";
import { renderQuoteWorkbook } from "@/lib/server/services/quote-workbook";
import { QUOTE_EXCEL_MISSING_MESSAGE, decideQuoteDownloadSource } from "./download-source";

/**
 * ============================================================================
 * GET /api/quotes/{id}/xlsx — 견적서가 밖으로 나가는 단 하나의 통로
 * ============================================================================
 * 저장된 값(quotes + quote_items)에 원본 양식을 씌워 **그 자리에서 만든** xlsx 를
 * 흘려보낸다. 만들어진 파일은 디스크에 남기지 않는다 — 남기면 그 폴더가
 * 로그인·권한·감사를 우회하는 두 번째 통로가 된다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 → 3) 계정 승인 → 4) 권한(READ) → 5) 견적서 조회
 *  → 6) 양식 읽기 → 7) 채우기 → 8) 감사(EXCEL_EXPORT) → 9) 전송
 *
 * 4번이 5번보다 앞인 이유: 권한이 없는 사람에게는 "그 id 의 견적서가 있다"는
 * 사실조차 알려 주지 않는다.
 *
 * ── 엑셀 전용 견적서는 붙인 엑셀을 그대로 내려준다 (2026-09-15 Q2) ─────────
 * 품목 없이 손으로 만든 엑셀을 붙여 저장한 장(quotes.is_excel_only)은 그 엑셀이 곧
 * 보낸 문서다(사용자 결정). 그런 장이면 5번 뒤에서 갈라져 6~7번(양식 채우기) 대신
 * **엑셀 칸에 지금 붙어 있는 파일**을 저장소에서 읽어 그대로 흘려보낸다 — 무엇을 고르는지는
 * 형제 파일 download-source.ts, 그 파일을 내보내도 되는지(악성코드 검사 상태)는 첨부
 * 내려받기와 **같은 판정 함수**(decideAttachmentDownload)가 정한다. 파일 이름은 아래의
 * 이름 규칙 그대로에 확장자만 붙인 파일의 것(xlsx · xls)을 따른다. 붙인 엑셀이 없으면
 * 404 와 사람이 읽는 문장이다 — 앱 양식으로 대신 채우지 않는다(품목이 없어 빈 견적서가
 * 나간다). 권한(READ) · 감사(EXCEL_EXPORT)는 일반 견적서와 같다.
 *
 * **일반 견적서는 한 바이트도 달라지지 않는다** — 그 길에는 조회 하나 늘지 않는다.
 *
 * ── 왜 READ 로 충분한가 ─────────────────────────────────────────────────
 * 이 통로는 **아무것도 바꾸지 않는다.** 이미 저장된 값을 보기 좋은 형태로
 * 옮겨 줄 뿐이라, 목록에서 그 견적서를 볼 수 있는 사람이면 그 내용을 파일로도
 * 받을 수 있는 것이 맞다. WRITE 를 요구하면 "화면에서는 금액까지 다 보이는데
 * 파일로는 못 받는" 상태가 되고, 그 사람은 결국 화면을 보고 손으로 옮겨 적는다.
 *
 * 대신 **감사는 남긴다** — 직인이 찍힌 문서가 나가는 일이다(mutations/
 * quote-exports.ts 의 '왜 남기는가').
 *
 * ── 실패 응답에 경로를 싣지 않는다 ──────────────────────────────────────
 * 양식을 못 읽었을 때 그 경로를 응답에 담으면 오류 메시지가 디스크 구조를
 * 알려 주는 창구가 된다. 경로는 서버 로그에만 남는다
 * (storage/quote-template.ts). 붙인 엑셀의 저장 경로도 같다.
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  /**
   * 🔴 앱 양식이 아직 없는 종류다 — 케이블 견적서(2026-09-16). **잘못된 문서를 내려주는
   * 대신 거절한다**(domain/quote-document-support.ts). 「만들지 못했다(RENDER_FAILED)」와
   * 가른 것은 고장이 아니라 아직 안 만든 기능이기 때문이다 — 관리자에게 문의할 일이 아니다.
   */
  | "KIND_NOT_SUPPORTED"
  | "TEMPLATE_UNAVAILABLE"
  | "RENDER_FAILED"
  /** 엑셀 전용 견적서인데 붙인 엑셀이 없다(2026-09-15 Q2). */
  | "EXCEL_NOT_ATTACHED"
  /** 붙인 엑셀이 악성코드 검사에 막혔다 — 첨부 내려받기와 같은 판정. */
  | "SCAN_BLOCKED"
  | "STORAGE_FAILED";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (getAuthSource() !== "database") {
    return fail(403, "FORBIDDEN", "데이터베이스 저장 모드가 아닙니다.");
  }

  // ── 2~3) 세션과 계정 승인 ────────────────────────────────────────────
  const session = await readSession();
  if (!session) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  if (session.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "계정이 아직 승인되지 않았습니다.");
  }
  // 세션에 박혀 있는 role 이 아니라 살아 있는 계정을 다시 읽는다 — 강등된
  // 계정이 토큰 만료 전까지 예전 권한으로 받아 가는 구멍을 막는다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");

  // ── 4) 권한 — 조회보다 앞이다 ────────────────────────────────────────
  if (!(await hasPermission(actingUser, "quotes", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 5) 견적서 ────────────────────────────────────────────────────────
  const { id } = await context.params;
  // 형식이 틀린 id 로 DB 를 때리지 않는다.
  if (!isValidQuoteId(id)) return fail(404, "NOT_FOUND", "해당 견적서를 찾을 수 없습니다.");

  // 지워진 장은 여기서도 없는 것이다(getQuoteForEdit 이 is_deleted 로 좁힌다).
  // 화면에서 지운 견적서를 주소만으로 계속 뽑을 수 있으면 휴지통이 뜻을 잃는다.
  const quote = await getQuoteForEdit(id);
  if (!quote) return fail(404, "NOT_FOUND", "해당 견적서를 찾을 수 없습니다.");

  /**
   * ── 5-1) 🔴 앱 양식으로 만들 수 있는 장인가 (2026-09-16) ───────────────
   * 케이블 견적서를 아래 채우개로 보내면 **거절되는 것이 아니라 내자 양식에 케이블 값이
   * 채워진 문서**가 나온다. 화면에서 단추를 감추는 것으로는 이 주소를 직접 여는 길(목록
   * 링크 · 주소창)이 남아, **여기서 막는다**. 판정은 domain/quote-document-support.ts
   * 한 곳이다 — 엑셀 전용 장은 앱 양식을 쓰지 않으므로 종류와 무관하게 지나간다.
   *
   * 501 인 것은 **고장이 아니라 아직 만들지 않은 기능**이기 때문이다(양식 채우기는 다음
   * 조각이다). 사람에게는 까닭과 다음 차례를 그대로 말한다.
   */
  if (!canRenderQuoteDocument(quote)) {
    return fail(501, "KIND_NOT_SUPPORTED", QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE);
  }

  // ── 5-2) 엑셀 전용 견적서 — 붙인 엑셀을 그대로(파일 헤더) ──────────────
  if (quote.isExcelOnly) {
    return sendAttachedExcel(quote, actingUser.id);
  }

  // ── 6~7) 양식을 읽어 채운다 ──────────────────────────────────────────
  let workbook: Buffer;
  try {
    workbook = await renderQuoteWorkbook(quote);
  } catch (err) {
    if (err instanceof QuoteTemplateError) {
      return fail(503, "TEMPLATE_UNAVAILABLE", err.message);
    }
    // 양식이 바뀌어 셀을 못 찾은 경우가 여기로 온다(sheet-patch.ts 는 조용히
    // 넘어가지 않고 던진다 — 빈 칸짜리 견적서가 나가는 것보다 낫다).
    // 값 자체는 로그에 담지 않는다: 품명·신고증상에 고객사 사정이 섞인다.
    console.error("[quote-xlsx] 견적서를 만들지 못했다", {
      quoteId: quote.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail(500, "RENDER_FAILED", "견적서를 만들지 못했습니다. 관리자에게 문의해 주세요.");
  }

  // ── 8) 감사 — 파일을 돌려주기 전에 남긴다 ────────────────────────────
  // 응답을 먼저 반환하면 기록이 누락될 수 있다(첨부 다운로드의 같은 판단).
  await recordQuoteExport({
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    actorUserId: actingUser.id,
  });

  // ── 9) 전송 ──────────────────────────────────────────────────────────
  const fileName = buildQuoteFileName({
    quoteNumber: quote.quoteNumber,
    customerName: quote.customerNameText,
  });

  return new NextResponse(new Uint8Array(workbook), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": quoteContentDisposition(fileName),
      "Content-Length": String(workbook.byteLength),
      // 직인이 찍힌 문서다. 중간 캐시에 남지 않게 한다.
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}

/**
 * 엑셀 전용 견적서 — 엑셀 칸에 지금 붙어 있는 파일을 그대로 내려준다(파일 헤더).
 *
 * 첨부 내려받기 통로(api/attachments/[id]/download)와 같은 방어를 거친다: 판정 함수
 * (decideAttachmentDownload — 검사 상태), DB 에 적힌 경로도 믿지 않는 경로 검증
 * (resolveAttachmentAbsolutePath), 파일에 닿는 것은 StorageAdapter 로만. 감사는 이
 * 통로의 것(EXCEL_EXPORT)을 남긴다 — 무엇을 누가 받았는지는 견적서 id 와 발행번호가
 * 답한다(mutations/quote-exports.ts).
 */
async function sendAttachedExcel(
  quote: { id: string; quoteNumber: string; customerNameText: string; isExcelOnly: boolean },
  actorUserId: string
): Promise<NextResponse> {
  const source = decideQuoteDownloadSource(quote, await listLiveQuoteAttachments(quote.id));
  if (source.kind !== "ATTACHED_EXCEL") {
    // 엑셀 전용 장이라 앱 양식(TEMPLATE)으로 떨어질 일은 없다 — 남는 것은 「붙인 엑셀 없음」이다.
    return fail(404, "EXCEL_NOT_ATTACHED", QUOTE_EXCEL_MISSING_MESSAGE);
  }
  const { attachment, extension } = source;

  // 첨부 내려받기와 같은 판정 — 여기까지 온 파일은 주인이 살아 있는 견적서이고 휴지통에
  // 없으므로 막는 것은 검사 상태뿐이다.
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

  const storage = getAttachmentStorage();
  let stream: ReadableStream<Uint8Array>;
  try {
    // 루트 밖을 가리키면 여기서 던진다. 존재 여부는 read 가 알려 준다.
    resolveAttachmentAbsolutePath(resolveUploadsRoot(), attachment.storedPath);
    stream = await storage.read(attachment.storedPath);
  } catch (error) {
    if (error instanceof AttachmentPathError) {
      console.error("[quote-xlsx] 붙인 엑셀의 stored_path 가 저장 루트를 벗어난다", {
        quoteId: quote.id,
        attachmentId: attachment.id,
        reason: error.message,
      });
      return fail(500, "STORAGE_FAILED", "파일 경로를 확인할 수 없습니다. 관리자에게 문의해 주세요.");
    }
    console.error("[quote-xlsx] 붙인 엑셀을 읽지 못했다", {
      quoteId: quote.id,
      attachmentId: attachment.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return fail(404, "NOT_FOUND", "저장된 파일을 찾을 수 없습니다. 관리자에게 문의해 주세요.");
  }

  // 감사 — 파일을 돌려주기 전에 남긴다(일반 견적서와 같은 방식 · 같은 자리).
  await recordQuoteExport({ quoteId: quote.id, quoteNumber: quote.quoteNumber, actorUserId });

  // 이름 규칙은 그대로, 확장자만 붙인 파일의 것(xlsx · xls).
  const fileName = buildQuoteFileName({
    quoteNumber: quote.quoteNumber,
    customerName: quote.customerNameText,
    extension,
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      // 올릴 때 확장자에서 서버가 고른 정본 MIME 이다(브라우저가 보낸 값이 아니다).
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.fileSize),
      "Content-Disposition": quoteContentDisposition(fileName),
      // 사람이 올린 파일이다 — 형식을 다시 추측하지 않게 한다. 전역 헤더와 값이 같아
      // 실제로 나가는 것은 전역 쪽이지만 이 통로가 요구하는 값을 선언해 둔다(첨부
      // 내려받기 라우트의 같은 줄 주석).
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}
