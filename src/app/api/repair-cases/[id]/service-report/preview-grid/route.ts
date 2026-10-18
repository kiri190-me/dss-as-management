import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  SERVICE_REPORT_PERMISSION_AREA,
  SERVICE_REPORT_REQUIRED_LEVELS,
} from "@/lib/auth/service-report-authorization";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { buildServiceReportPreviewGrid } from "@/lib/server/service-report-preview-grid";

/**
 * ============================================================================
 * POST /api/repair-cases/{id}/service-report/preview-grid
 *   — 🔴 **아직 저장하지 않은** 보고서를 문서 그대로 그려 돌려준다 (2026-10-19)
 * ============================================================================
 * 사용자 요구: 「보고서 수정하고서 저장을 누르지 않은 채 저장 옆에 있는 미리보기를
 * 눌렀을 때에 수정한 내용이 반영되도록 해줘.」
 *
 * 그 전까지 미리보기는 **저장된 장에만** 붙었다. 미리보기 화면이 서버 컴포넌트라
 * GET 이고, GET 에는 폼 값을 실을 자리가 없기 때문이다(주소에 실으면 본문이 길고
 * 고객 정보가 접근 로그·브라우저 기록에 그대로 남는다). 그래서 **저장 전에는 단추가
 * 아예 없었고, 저장한 뒤 고치면 옛 내용이 보였다.**
 *
 * 이 통로가 그 자리를 메운다. 하는 일은 하나다 — 화면이 보낸 값으로 문서를 지어
 * **격자**(`lib/xlsx/sheet-print-grid.ts` 의 `SheetPrintGrid`)로 돌려준다. 화면은
 * 그것을 그 자리에서 창으로 띄운다(새 탭이 열리지 않는다).
 *
 * ── 🔴 이웃 `../xlsx` 의 POST 와 **같은 관문**이다 ──────────────────────
 * 그 통로가 아직 저장하지 않은 폼 값으로 **엑셀 파일**을 내주는 자리이고, 이쪽은
 * 같은 값으로 **같은 문서를 화면에** 그리는 자리다. 보이는 것이 같으니 문턱도 같아야
 * 한다 — 보고서를 만들 수 없는 사람이 미리보기로 직인이 찍힌 문서를 읽을 수 있게
 * 되면 그것은 인가를 새로 뚫은 것이다.
 *
 *   1) 저장 모드 → 2) 세션 → 3) 계정 승인 → 4) 살아 있는 계정 → 5) 권한(WRITE)
 *   → 6) 접수 건 조회 → 7) 요청 본문 → 8) 양식 읽기·채우기·격자
 *
 * 🔴 문턱을 **손으로 적지 않는다** — `auth/service-report-authorization.ts` 의
 * `SERVICE_REPORT_REQUIRED_LEVELS.edit` 가 원본이다. 5번이 6번보다 앞인 것도 그쪽과
 * 같다: 권한이 없는 사람에게는 "그 id 의 접수 건이 있다"는 사실조차 알려 주지 않는다.
 *
 * ── 🔴 저장하지 않는다. 한 글자도 ──────────────────────────────────────
 * 보고서 표를 읽지도 쓰지도 않는다(`getServiceReportForEdit` 조차 부르지 않는다).
 * 화면이 보낸 값만으로 문서를 짓는다 — 저장된 장을 섞으면 «저장을 누르지 않은 채
 * 본다»가 거짓이 된다. 접수 건은 **존재와 접근 권한을 확인하고, 양식 넷 중 하나를
 * 고르는 데만** 쓴다.
 *
 * ── 🔴 감사를 남기지 않는다 ─────────────────────────────────────────────
 * `../xlsx` 는 EXCEL_EXPORT 를 남긴다 — 그쪽은 **파일이 나가기** 때문이다. 여기서는
 * 나가는 파일이 없고, 이것은 저장된 장의 미리보기 화면과 같은 일이다(그 화면도
 * 감사를 남기지 않는다). 글을 고치는 동안 사람이 여러 번 누르는 자리라, 누를 때마다
 * 줄이 쌓이면 "누가 무엇을 가져갔는가"를 찾을 수 없게 된다
 * (`api/service-reports/template-image/…` 의 같은 판단).
 *
 * ── 🔴 느려지지 않게 — **누를 때만 돈다** ───────────────────────────────
 * 양식을 채우고 zip 을 다시 여는 일은 가볍지 않다(실측 109ms). 그래서 이 통로는
 * 사람이 [전체 미리보기]를 **눌렀을 때만** 불린다 — 타자마다 도는 실시간 미리보기는
 * 작성 화면 옆의 본문 미리보기이고, 그쪽은 서버를 부르지 않는다
 * (`components/.../ServiceReportBodyPreview.tsx`).
 *
 * ── 실패 응답에 경로를 싣지 않는다 ──────────────────────────────────────
 * 양식을 못 읽었을 때 그 경로를 응답에 담으면 오류 메시지가 디스크 구조를 알려
 * 주는 창구가 된다. 🔴 원래 오류(`cause`)는 **서버 로그에만** 남기고 응답에는
 * 싣지 않는다 — 채우개가 던지는 말에는 셀 주소가 섞인다.
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "TEMPLATE_UNAVAILABLE"
  | "RENDER_FAILED";

function fail(
  status: number,
  code: FailureCode,
  message: string,
  fieldErrors?: Record<string, string>
): NextResponse {
  return NextResponse.json(
    fieldErrors ? { error: message, code, fieldErrors } : { error: message, code },
    { status }
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // ── 1) 저장 모드 ──────────────────────────────────────────────────────
  if (getAuthSource() !== "database") {
    return fail(403, "FORBIDDEN", "데이터베이스 저장 모드가 아닙니다.");
  }

  // ── 2~4) 세션과 계정 승인 ────────────────────────────────────────────
  const session = await readSession();
  if (!session) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  if (session.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "계정이 아직 승인되지 않았습니다.");
  }
  // 세션에 박혀 있는 role 이 아니라 살아 있는 계정을 다시 읽는다 — 강등된
  // 계정이 토큰 만료 전까지 예전 권한으로 받아 가는 구멍을 막는다(`../xlsx` 와 같다).
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");

  // ── 5) 권한 — 조회보다 앞이다. 위 '같은 관문' ────────────────────────
  if (
    !(await hasPermission(
      actingUser,
      SERVICE_REPORT_PERMISSION_AREA,
      SERVICE_REPORT_REQUIRED_LEVELS.edit
    ))
  ) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 6) 접수 건 — 있는지와 지워지지 않았는지만 본다 ───────────────────
  const { id } = await context.params;
  // 지워진 건은 여기서도 없는 것이다(`getRepairCaseById` 가 is_deleted 로 좁힌다).
  const repairCase = await resolveRepairCaseForServer(id);
  if (!repairCase) return fail(404, "NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

  // ── 7) 요청 본문 ─────────────────────────────────────────────────────
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail(400, "INVALID_INPUT", "보고서 내용을 읽을 수 없습니다.");
  }

  /**
   * ── 8) 검증 · 양식 · 채우기 · 격자 — 저장된 장의 미리보기와 **같은 사슬** ──
   * 여기서 `?? ""` 같은 것을 새로 적으면 규칙이 두 곳에 살고, 그 순간 «저장 전에
   * 본 문서»와 «저장 뒤에 본 문서»가 다른 말을 하는 날이 예약된다.
   */
  const built = await buildServiceReportPreviewGrid(payload, repairCase.workflowType);
  if (!built.ok) {
    if (built.code === "INVALID_INPUT") {
      // 🔴 칸별 오류는 받는 쪽이 작성 화면이라 그대로 넘긴다 — 칸마다 붙여 준다
      //    (`../xlsx` 의 POST 와 같은 판단).
      return fail(400, "INVALID_INPUT", built.message, built.fieldErrors);
    }
    if (built.code === "TEMPLATE_UNAVAILABLE") {
      return fail(503, "TEMPLATE_UNAVAILABLE", built.message);
    }
    // 🔴 본문 내용은 로그에 담지 않는다 — 접수 건 id 와 오류 메시지뿐이다.
    console.error("[service-report-preview-grid] 미리보기를 그리지 못했다", {
      repairCaseId: repairCase.id,
      error: built.cause instanceof Error ? built.cause.message : String(built.cause),
    });
    return fail(500, "RENDER_FAILED", built.message);
  }

  // ── 9) 전송 ──────────────────────────────────────────────────────────
  // 🔴 직인이 찍힌 문서다. 중간 캐시에 남지 않게 한다(`../xlsx` 와 같은 헤더).
  return NextResponse.json(
    { grid: built.grid, kindLabel: built.kindLabel, templateImageBase: built.templateImageBase },
    { status: 200, headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}
