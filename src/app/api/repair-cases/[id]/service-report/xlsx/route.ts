import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { recordServiceReportExport } from "@/lib/db/mutations/service-report-exports";
import {
  buildServiceReportFileName,
  formatServiceReportNumber,
  serviceReportContentDisposition,
} from "@/lib/domain/service-report-file-name";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import {
  readServiceReportTemplate,
  ServiceReportTemplateError,
} from "@/lib/storage/service-report-template";
import { validateServiceReportFields } from "@/lib/validation/service-report-input";
import { fillServiceReportWorkbook } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * POST /api/repair-cases/{id}/service-report/xlsx
 *   — 검사·수리 보고서가 밖으로 나가는 단 하나의 통로
 * ============================================================================
 * 화면이 보낸 값에 원본 양식을 씌워 **그 자리에서 만든** xlsx 를 흘려보낸다.
 * 만들어진 파일은 디스크에 남기지 않는다 — 남기면 그 폴더가 로그인·권한·감사를
 * 우회하는 두 번째 통로가 된다(견적서 라우트와 같은 판단).
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 → 3) 계정 승인 → 4) 살아 있는 계정 → 5) 권한(WRITE)
 *  → 6) 접수 건 조회 → 7) 본문 검증 → 8) 양식 읽기·채우기
 *  → 9) 감사(EXCEL_EXPORT) → 10) 전송
 *
 * 5번이 6번보다 앞인 이유: 권한이 없는 사람에게는 "그 id 의 접수 건이 있다"는
 * 사실조차 알려 주지 않는다.
 *
 * ── 🔴 왜 GET 이 아니라 POST 인가 ───────────────────────────────────────
 * 견적서는 저장된 값(quotes 표)을 읽어 채우므로 id 하나면 문서가 정해진다.
 * **보고서는 아직 DB 에 표가 없다.** 문서에 적힐 것이 전부 요청과 함께 오므로
 * 주소 하나로는 부족하다. 저장은 다음 단계의 일이고, 이 통로는 그때도 그대로
 * 쓰인다 — 저장된 값을 읽어 이 본문을 만들어 보내면 된다.
 *
 * 접수 건은 **존재와 접근 권한을 확인하는 데만** 쓴다. 문서 내용은 하나도
 * 여기서 끌어오지 않는다 — 자동 채움은 화면의 몫이고(다음 단계), 그래야 사람이
 * 고친 값이 서버에서 되돌려지는 일이 없다.
 *
 * ── 🔴 왜 READ 가 아니라 WRITE 인가 ─────────────────────────────────────
 * 견적서 라우트는 READ 로 충분했다. 그쪽은 **이미 저장된 값을 보기 좋은
 * 형태로 옮겨 담을 뿐**이라, 목록에서 그 견적서를 볼 수 있는 사람이면 파일로도
 * 받을 수 있는 것이 맞다.
 *
 * 여기는 사정이 다르다. **보내는 사람이 문서 내용을 그 자리에서 짓는다.**
 * 확인내용·조치·정리·원인 체크가 전부 요청 본문에서 오고, 그것이 **법인 직인이
 * 찍힌 채 고객사로 나가는 문서**가 된다. 보기 권한만 가진 사람이 우리 회사
 * 이름으로 "이 장비를 점검했고 원인은 부품불량이었다"고 적은 문서를 만들 수
 * 있으면, 그것은 더 이상 보기가 아니다. 그래서 `repairCases` 의 **WRITE** 를
 * 요구한다.
 *
 * ── 실패 응답에 경로를 싣지 않는다 ──────────────────────────────────────
 * 양식을 못 읽었을 때 그 경로를 응답에 담으면 오류 메시지가 디스크 구조를
 * 알려 주는 창구가 된다. 경로는 서버 로그에만 남는다
 * (storage/service-report-template.ts).
 *
 * ── 🔴 본문 내용은 로그에도 감사에도 담지 않는다 ────────────────────────
 * 확인내용·조치·정리·비고에는 고객사 사정이 섞인다. 감사 로그는 3년 보관
 * 대상이라 거기에 사본을 한 벌 더 만들면 지워야 할 자료가 두 곳이 된다.
 * 남기는 것은 **누가 언제 어느 건의 어떤 종류 보고서를 뽑아 갔는가**뿐이다.
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
  // 계정이 토큰 만료 전까지 예전 권한으로 받아 가는 구멍을 막는다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");

  // ── 5) 권한 — 조회보다 앞이다. 위 '왜 WRITE 인가' ────────────────────
  if (!(await hasPermission(actingUser.role, "repairCases", "WRITE"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 6) 접수 건 — 있는지와 지워지지 않았는지만 본다 ───────────────────
  const { id } = await context.params;
  // 지워진 건은 여기서도 없는 것이다(getRepairCaseById 가 is_deleted 로 좁힌다).
  // 휴지통에 넣은 건을 주소만으로 계속 뽑을 수 있으면 휴지통이 뜻을 잃는다.
  const repairCase = await resolveRepairCaseForServer(id);
  if (!repairCase) return fail(404, "NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

  // ── 7) 요청 본문 ─────────────────────────────────────────────────────
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail(400, "INVALID_INPUT", "보고서 내용을 읽을 수 없습니다.");
  }

  const validated = validateServiceReportFields(payload);
  if (!validated.ok) {
    return fail(400, "INVALID_INPUT", "보고서 내용을 확인해 주세요.", validated.fieldErrors);
  }
  const input = validated.data;

  // ── 8) 양식을 읽어 채운다 ────────────────────────────────────────────
  let workbook: Buffer;
  try {
    workbook = fillServiceReportWorkbook(await readServiceReportTemplate(input.kind), input);
  } catch (err) {
    if (err instanceof ServiceReportTemplateError) {
      // 🔴 err.message 에는 경로가 들어 있지 않다(storage 쪽이 그렇게 만든다).
      return fail(503, "TEMPLATE_UNAVAILABLE", err.message);
    }
    /**
     * 양식이 바뀌어 라벨이 어긋난 경우가 여기로 온다(채우개는 조용히 넘어가지
     * 않고 던진다 — 엉뚱한 칸을 채운 보고서가 나가는 것보다 낫다).
     *
     * 🔴 본문 내용은 로그에 담지 않는다. 접수 건 id 와 오류 메시지뿐이다.
     */
    console.error("[service-report-xlsx] 보고서를 만들지 못했다", {
      repairCaseId: repairCase.id,
      kind: input.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail(500, "RENDER_FAILED", "보고서를 만들지 못했습니다. 관리자에게 문의해 주세요.");
  }

  // ── 9) 감사 — 파일을 돌려주기 전에 남긴다 ────────────────────────────
  // 응답을 먼저 반환하면 기록이 누락될 수 있다(견적서 내보내기·첨부 다운로드의
  // 같은 판단). EXCEL_EXPORT 인 이유도 같다 — 저장돼 있던 파일을 꺼내 간 것이
  // 아니라 요청을 받은 순간 만들어 낸 문서라, 나중에 찾아볼 파일이 없다.
  //
  // 🔴 남기는 값은 mutations 쪽이 정한다 — 본문 내용은 담기지 않는다
  // (mutations/service-report-exports.ts 의 '값은 담지 않는다').
  const reportNumber = formatServiceReportNumber(input.reportNumber);
  await recordServiceReportExport({
    repairCaseId: repairCase.id,
    kind: input.kind,
    reportNumber,
    actorUserId: actingUser.id,
  });

  // ── 10) 전송 ─────────────────────────────────────────────────────────
  const fileName = buildServiceReportFileName({
    kind: input.kind,
    customerName: input.customerName,
    reportNumber,
  });

  return new NextResponse(new Uint8Array(workbook), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": serviceReportContentDisposition(fileName),
      "Content-Length": String(workbook.byteLength),
      // 직인이 찍힌 문서다. 중간 캐시에 남지 않게 한다.
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}
