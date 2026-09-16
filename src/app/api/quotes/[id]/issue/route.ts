import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isTrustedOrigin } from "@/lib/auth/request-guards";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { quoteContentDisposition } from "@/lib/domain/quote-file-name";
import { QUOTE_ISSUE_RESULT_HEADER, encodeQuoteIssueResult } from "@/lib/domain/quote-issue-result";
import { issueQuoteFile, type QuoteIssueFailureCode } from "@/lib/server/services/quote-issue";
import { getAttachmentStorage } from "@/lib/storage/local-fs-adapter";
import { resolveQuoteArchiveRoot } from "@/lib/storage/quote-archive";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";
import { isValidQuoteId } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * POST /api/quotes/{id}/issue — 수정 권한자의 [견적서 받기]
 * ============================================================================
 * 견적서 엑셀을 만들어 ① 사내 공유폴더에 저장하고 ② 「수기 견적서 엑셀」 칸에 올리고
 * (칸 교체) ③ 파일 바이트를 돌려준다(2026-09-15 사용자 결정). 엑셀 전용 견적서는 붙인
 * 엑셀을 공유폴더에 복사만 한다. 무엇을 어떻게 하는지는 services/quote-issue.ts 에 있고,
 * 이 파일은 문지기와 응답 모양만 맡는다. 보기 권한자의 받기는 예전 그대로
 * GET /api/quotes/{id}/xlsx 다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 요청 출처 → 2) 저장 모드 → 3) 세션 · 살아 있는 계정 · 승인 → 4) 권한(quotes WRITE)
 *  → 5) id 형식 → 6) 만들기 · 공유폴더 · 첨부 칸 · 감사(EXCEL_EXPORT) → 7) 전송
 *
 * 4번이 견적서 조회보다 앞인 까닭은 GET 과 같다 — 권한이 없는 사람에게는 그 id 의
 * 견적서가 있다는 사실조차 알려 주지 않는다. 실패 응답의 모양 · 코드도 GET 과 같다
 * (`{ error, code }`). 출처 검사(UNTRUSTED_ORIGIN)만 더했다 — 쓰기 통로라서다.
 *
 * ── 왜 GET 이 아니라 POST 인가 ──────────────────────────────────────────
 * 부작용이 있다. 공유폴더에 파일이 생기고 첨부 칸이 바뀐다. GET 이면 링크 한 줄
 * (메일 · 채팅의 주소, img 태그, 미리 불러오기)로 그 일이 일어난다. POST 로 두고 출처를
 * 확인해야 사람이 누른 요청만 그 일을 한다.
 *
 * ── GET 머리말의 「만든 파일은 디스크에 남기지 않는다」와 왜 다른가 ────────
 * 사용자 결정(2026-09-15)이다. 공유폴더는 회사가 수년째 쓰는 기존 서류함이고, 거기에
 * 누가 접근하는지는 이 앱이 아니라 NAS 공유 권한이 정한다 — 앱이 여는 두 번째 통로가
 * 아니라 사람이 원래 쓰던 자리에 사본을 꽂아 주는 것이다. 앱 쪽 사본은 로그인 · 권한 ·
 * 감사 뒤의 첨부 칸에 있다. 그래서 이 일은 수정 권한자(quotes WRITE)만 한다.
 *
 * ── 결과는 응답 헤더 한 줄로 ────────────────────────────────────────────
 * 몸통은 파일이라, 공유폴더 · 첨부 칸이 어떻게 됐는지는 X-Quote-Issue-Result 헤더에 싣는다
 * (domain/quote-issue-result.ts — ASCII 로 접은 JSON). 공유폴더나 첨부가 실패해도 응답은
 * 200 이고 파일이 내려간다 — 결과만 알린다(사용자 결정 4). 헤더 이름은 전역 보안 헤더
 * (next.config.ts)와 겹치지 않는 새 이름이다 — 겹치면 Next 가 조용히 버린다.
 *
 * ── 실패 응답에 경로를 싣지 않는다 ──────────────────────────────────────
 * GET 과 같다. 공유폴더 실패 사유도 경로 없이 만든 짧은 문장이다.
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "UNTRUSTED_ORIGIN"
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | QuoteIssueFailureCode;

/** 중심 함수의 실패 → 응답 코드. GET 받기 통로와 같은 짝이다. */
const STATUS_BY_ISSUE_FAILURE: Record<QuoteIssueFailureCode, number> = {
  NOT_FOUND: 404,
  EXCEL_NOT_ATTACHED: 404,
  // 🔴 아직 앱 양식이 없는 종류(케이블) — **고장이 아니라 안 만든 기능**이라 501 이다.
  // GET 받기 통로가 같은 코드에 같은 응답 코드를 쓴다(그쪽 FailureCode 의 그 항목).
  KIND_NOT_SUPPORTED: 501,
  SCAN_BLOCKED: 403,
  TEMPLATE_UNAVAILABLE: 503,
  RENDER_FAILED: 500,
  STORAGE_FAILED: 500,
};

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // ── 1) 요청 출처 — 다른 사이트가 사용자 몰래 부르는 요청을 막는다 ──────────
  if (!isTrustedOrigin(request)) {
    return fail(403, "UNTRUSTED_ORIGIN", "요청 출처를 확인할 수 없습니다.");
  }

  // ── 2) 저장 모드 ─────────────────────────────────────────────────────
  if (getAuthSource() !== "database") {
    return fail(403, "FORBIDDEN", "데이터베이스 저장 모드가 아닙니다.");
  }

  // ── 3) 세션 · 살아 있는 계정 · 승인 ──────────────────────────────────
  const session = await readSession();
  if (!session) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  if (session.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "계정이 아직 승인되지 않았습니다.");
  }
  // 세션에 박힌 값이 아니라 살아 있는 계정을 다시 읽는다 — 토큰이 발급된 뒤 계정이
  // 정지 · 삭제 · 강등됐을 수 있다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  if (actingUser.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "계정이 아직 승인되지 않았습니다.");
  }

  // ── 4) 권한 — 견적서를 고칠 수 있는 사람만. 조회보다 앞이다 ─────────────
  if (!(await hasPermission(actingUser, "quotes", "WRITE"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 5) id 형식 — 틀린 id 로 DB 를 때리지 않는다 ─────────────────────────
  const { id } = await context.params;
  if (!isValidQuoteId(id)) return fail(404, "NOT_FOUND", "해당 견적서를 찾을 수 없습니다.");

  // ── 6) 만들기 · 공유폴더 · 첨부 칸 · 감사 ─────────────────────────────
  let storage: StorageAdapter;
  try {
    storage = getAttachmentStorage();
  } catch {
    // 저장 루트 설정이 비었다. 값은 로그에도 싣지 않는다.
    console.error("[quote-issue] 첨부 저장소를 열지 못했다", { quoteId: id });
    return fail(500, "STORAGE_FAILED", "파일 저장소를 확인할 수 없습니다. 관리자에게 문의해 주세요.");
  }

  const outcome = await issueQuoteFile({
    quoteId: id,
    actorUserId: actingUser.id,
    archiveRoot: resolveQuoteArchiveRoot(),
    storage,
  });
  if (!outcome.ok) {
    return fail(STATUS_BY_ISSUE_FAILURE[outcome.code], outcome.code, outcome.message);
  }

  // ── 7) 전송 ──────────────────────────────────────────────────────────
  return new NextResponse(new Uint8Array(outcome.bytes), {
    status: 200,
    headers: {
      "Content-Type": outcome.contentType,
      "Content-Disposition": quoteContentDisposition(outcome.fileName),
      "Content-Length": String(outcome.bytes.byteLength),
      // 직인이 찍힌 문서다. 중간 캐시에 남지 않게 한다.
      "Cache-Control": "no-store, must-revalidate",
      [QUOTE_ISSUE_RESULT_HEADER]: encodeQuoteIssueResult(outcome.result),
    },
  });
}
