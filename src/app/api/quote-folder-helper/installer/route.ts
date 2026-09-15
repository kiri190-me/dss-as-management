import { NextResponse } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  QUOTE_FOLDER_HELPER_INSTALLER_FILE_NAME,
  buildQuoteFolderHelperInstaller,
  resolveQuoteFolderHelperRoot,
} from "@/lib/server/quote-folder-helper";

/**
 * ============================================================================
 * GET /api/quote-folder-helper/installer — 「견적서 폴더 열기」 도우미 설치 파일 (견적서 ④a)
 * ============================================================================
 * PC 마다 한 번, 현재 사용자에게만(HKCU · 관리자 권한 없음) 도우미를 설치하는
 * install-dss-folder-helper.cmd 를 내려준다. 사람이 내려받은 파일을 한 번 더블클릭한다 —
 * 브라우저는 설치를 스스로 하지 못한다. 무엇을 설치하는지 · 왜 그렇게 옮기는지는
 * server/quote-folder-helper.ts 머리말.
 *
 * ── 🔴 본문은 요청마다 만든다 ─────────────────────────────────────────────
 * 설치 파일에는 사람이 탐색기에서 보는 공유폴더 루트(UNC — QUOTE_ARCHIVE_UNC_ROOT)가 들어간다.
 * 파일로 만들어 두면 그 값이 저장소 · 이미지에 남는다. 그래서 부를 때마다 환경변수로 만든다.
 * 값은 로그 · 오류 응답에 싣지 않는다(설정이 비었거나 틀렸다는 사실만 알린다).
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 · 살아 있는 계정 · 승인 → 3) 권한(quotes READ)
 *  → 4) UNC 루트(비었거나 틀리면 409) → 5) 설치 파일(첨부)
 *
 * 권한이 READ 인 까닭: 도우미는 견적서 폴더를 **여는** 도구이고, 견적서를 볼 수 있는 사람이
 * [폴더 열기]를 누른다. 아무것도 바꾸지 않으므로 감사를 남기지 않는다.
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "DATABASE_MODE_REQUIRED"
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | "HELPER_ROOT_NOT_CONFIGURED"
  | "HELPER_ROOT_INVALID";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(): Promise<NextResponse> {
  // ── 1) 저장 모드 ──────────────────────────────────────────────────────
  if (getAuthSource() !== "database") {
    return fail(403, "DATABASE_MODE_REQUIRED", "데이터베이스 저장 모드가 아닙니다.");
  }

  // ── 2) 세션 · 살아 있는 계정 · 승인 ──────────────────────────────────
  const session = await readSession();
  if (!session) {
    return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  }
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return fail(401, "UNAUTHENTICATED", "사용자 정보를 확인할 수 없습니다.");
  }
  if (actingUser.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "계정이 아직 승인되지 않았습니다.");
  }

  // ── 3) 권한 ──────────────────────────────────────────────────────────
  if (!(await hasPermission(actingUser, "quotes", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 4) UNC 루트 — 값은 설치 파일 본문에만 들어간다 ─────────────────────
  const helperRoot = resolveQuoteFolderHelperRoot();
  if (helperRoot.status === "unset") {
    return fail(409, "HELPER_ROOT_NOT_CONFIGURED", "관리자가 공유폴더 주소를 설정해야 합니다.");
  }
  if (helperRoot.status === "invalid") {
    return fail(409, "HELPER_ROOT_INVALID", "공유폴더 주소 설정이 올바르지 않습니다. 관리자에게 문의해 주세요.");
  }

  // ── 5) 설치 파일 — ASCII 본문, 첨부로 ──────────────────────────────────
  const body = new TextEncoder().encode(buildQuoteFolderHelperInstaller({ uncRoot: helperRoot.root }));
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${QUOTE_FOLDER_HELPER_INSTALLER_FILE_NAME}"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
