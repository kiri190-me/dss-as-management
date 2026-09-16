import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getQuoteForEdit } from "@/lib/db/queries/quotes";
import { isQuoteFolderRelativePath } from "@/lib/domain/quote-folder-link";
import { resolveQuoteFolderHelperUncPath } from "@/lib/server/quote-folder-helper";
import { findQuoteArchiveFolder, resolveQuoteArchiveRoot } from "@/lib/storage/quote-archive";
import { isValidQuoteId } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * GET /api/quotes/{id}/archive-folder — 그 견적서의 공유폴더 폴더가 어디인가 (견적서 ④a)
 * ============================================================================
 * 견적서 화면의 [폴더 열기]가 부른다. 공유폴더(QUOTE_ARCHIVE_DIR)에서 저장과 **같은 찾기
 * 규칙**으로 연도 폴더 › 견적서 폴더를 찾아, 루트 기준 상대 경로만 돌려준다. 화면은 그 경로로
 * `dss-folder://open/?p=…` 주소를 만들고(domain/quote-folder-link.ts), PC 의 도우미가 자기 루트
 * (UNC)에 붙여 탐색기로 연다(server/quote-folder-helper.ts).
 *
 * ── 🔴 컨테이너 안 경로는 싣지 않는다 ─────────────────────────────────────
 * 공유폴더가 서버 안에 마운트된 경로(QUOTE_ARCHIVE_DIR)는 서버 구조를 알려 준다 — 이 통로가
 * 알릴 까닭이 없다. 응답에 나가는 것은 상대 경로와, 사람이 탐색기에 붙여넣을 전체 주소뿐이고,
 * 실패 사유도 경로 없는 짧은 문장이다(storage/quote-archive.ts 머리말).
 *
 * ── 전체 주소(uncPath) ────────────────────────────────────────────────────
 * 도우미 설치가 막힌 PC 를 위한 우회로다 — 사람이 `\\서버\공유\…` 를 탐색기 주소창에 붙여넣으면
 * 도우미 없이도 폴더가 열린다. 사람이 보는 루트(QUOTE_ARCHIVE_UNC_ROOT)에 상대 경로를 이어
 * server/quote-folder-helper.ts 가 만든다. 그 견적서를 볼 수 있는 사람에게 그 폴더의 주소만 간다.
 * 🔴 설정이 비었거나 틀리면 **이 칸만 빠진다** — 폴더 열기(상대 경로 · 도우미 주소)는 그대로 돈다.
 *
 * ── 🔴 아무것도 만들지 않는다 ──────────────────────────────────────────────
 * 폴더가 없으면 `not-found` 로 끝난다(폴더는 [견적서 받기] · 결재 PDF 저장이 만든다). mkdir ·
 * 파일 쓰기 · DB 쓰기가 없고, 감사도 남기지 않는다 — 기록할 변경이 없다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 · 살아 있는 계정 · 승인 → 3) 권한(quotes READ) → 4) id 형식
 *  → 5) 견적서(휴지통이면 없는 것) → 6) 공유폴더 루트(꺼져 있으면 disabled) → 7) 찾기 → 8) JSON
 *
 * 권한이 READ 인 까닭: 그 견적서를 볼 수 있는 사람이면 그 서류가 꽂힌 자리도 볼 수 있다. 권한이
 * 조회보다 앞이다 — 권한이 없는 사람에게는 그 id 의 견적서가 있다는 사실도 알려 주지 않는다.
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ status: "found", relativePath, multipleFolderMatches, uncPath? }` — 경로는 `연도 폴더/견적서
 *    폴더`, 디스크의 실제 이름. 도우미가 받지 않을 이름(규칙 밖)이면 대신 `failed` 다.
 *  · 200 `{ status: "not-found" }` · `{ status: "disabled" }` · `{ status: "failed", reason }`
 *  · 실패 `{ error, code }` — 401 · 403 · 404. 모두 `Cache-Control: no-store`(JSON 성공 응답).
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode = "DATABASE_MODE_REQUIRED" | "UNAUTHENTICATED" | "ACCOUNT_NOT_APPROVED" | "FORBIDDEN" | "NOT_FOUND";

/** 응답 본문. 🔴 컨테이너 안 경로를 담는 칸이 없다. uncPath 는 설정이 있을 때만 붙는다. */
type ArchiveFolderResponse =
  | { status: "found"; relativePath: string; multipleFolderMatches: boolean; uncPath?: string }
  | { status: "not-found" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

const UNOPENABLE_FOLDER_REASON =
  "견적서 폴더 이름에 탐색기 도우미가 열 수 없는 글자가 있습니다. 공유폴더에서 직접 열어 주세요.";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function respond(body: ArchiveFolderResponse): NextResponse {
  return NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // ── 1) 저장 모드 ──────────────────────────────────────────────────────
  if (getAuthSource() !== "database") {
    return fail(403, "DATABASE_MODE_REQUIRED", "데이터베이스 저장 모드가 아닙니다.");
  }

  // ── 2) 세션 · 살아 있는 계정 · 승인 ──────────────────────────────────
  const session = await readSession();
  if (!session) {
    return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  }
  // 세션에 박힌 값이 아니라 살아 있는 계정을 다시 읽는다 — 정지 · 삭제 · 강등됐을 수 있다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return fail(401, "UNAUTHENTICATED", "사용자 정보를 확인할 수 없습니다.");
  }
  if (actingUser.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "계정이 아직 승인되지 않았습니다.");
  }

  // ── 3) 권한 — 조회보다 앞이다 ────────────────────────────────────────
  if (!(await hasPermission(actingUser, "quotes", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 4~5) 견적서 ──────────────────────────────────────────────────────
  const { id } = await context.params;
  if (!isValidQuoteId(id)) {
    return fail(404, "NOT_FOUND", "해당 견적서를 찾을 수 없습니다.");
  }
  // 휴지통의 장은 없는 것이다(getQuoteForEdit 이 is_deleted 로 좁힌다).
  const quote = await getQuoteForEdit(id);
  if (!quote) {
    return fail(404, "NOT_FOUND", "해당 견적서를 찾을 수 없습니다.");
  }

  // ── 6) 공유폴더 루트 — 이 값은 찾기에만 쓰고 응답에 싣지 않는다 ─────────
  const archiveRoot = resolveQuoteArchiveRoot();
  if (archiveRoot === null) {
    return respond({ status: "disabled" });
  }

  // ── 7) 찾기 — 읽기만 한다 ────────────────────────────────────────────
  const result = await findQuoteArchiveFolder({
    root: archiveRoot,
    quoteDate: quote.quoteDate,
    naming: {
      quoteNumber: quote.quoteNumber,
      kind: quote.kind,
      customerName: quote.customerNameText,
      modelName: quote.modelNameText,
      lotNumber: quote.lotNumberText,
      serialNumber: quote.serialNumberText,
    },
  });

  // ── 8) JSON — 상대 경로 · 짧은 사유만 ────────────────────────────────
  if (result.status === "found") {
    // 도우미가 받지 않을 이름이면(사람이 NAS 에서 만든 이름 등) 주소를 만들 수 없다 — 미리 알린다.
    if (!isQuoteFolderRelativePath(result.relativePath)) {
      return respond({ status: "failed", reason: UNOPENABLE_FOLDER_REASON });
    }
    // 탐색기 주소창에 붙여넣을 전체 주소 — 설정이 비었거나 틀리면 null 이고, 그 칸만 빠진다.
    const uncPath = resolveQuoteFolderHelperUncPath(result.relativePath);
    return respond({
      status: "found",
      relativePath: result.relativePath,
      multipleFolderMatches: result.multipleFolderMatches,
      ...(uncPath === null ? {} : { uncPath }),
    });
  }
  if (result.status === "not-found") {
    return respond({ status: "not-found" });
  }
  return respond({ status: "failed", reason: result.reason });
}
