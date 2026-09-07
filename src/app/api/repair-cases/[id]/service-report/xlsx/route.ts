import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  SERVICE_REPORT_PERMISSION_AREA,
  SERVICE_REPORT_REQUIRED_LEVELS,
} from "@/lib/auth/service-report-authorization";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { recordServiceReportExport } from "@/lib/db/mutations/service-report-exports";
import { getServiceReportForEdit } from "@/lib/db/queries/service-reports";
import { buildServiceReportRequestBody } from "@/lib/domain/service-report-form";
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
import { serviceReportFormValues } from "@/lib/validation/service-report-save-input";
import {
  fillServiceReportWorkbook,
  SERVICE_REPORT_FINDINGS_INTRO,
} from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * /api/repair-cases/{id}/service-report/xlsx
 *   — 검사·수리 보고서가 밖으로 나가는 단 하나의 통로(문 둘, 규칙 하나)
 * ============================================================================
 * 원본 양식에 값을 씌워 **그 자리에서 만든** xlsx 를 흘려보낸다. 만들어진 파일은
 * 디스크에 남기지 않는다 — 남기면 그 폴더가 로그인·권한·감사를 우회하는 두 번째
 * 통로가 된다(견적서 라우트와 같은 판단).
 *
 * 문이 둘인 것은 **값이 어디서 오는가**가 둘이기 때문이다:
 *
 *   · `POST` — 화면이 보낸 값. 아직 저장하지 않은 편집 중인 장을 뽑는다.
 *   · `GET  ?id={보고서}` — **저장된 장**을 읽어 그 값으로 뽑는다. 「보고서」
 *     탭의 목록에서 누르는 것이 이 문이다.
 *
 * ── 순서 — 두 문이 같다 ─────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 → 3) 계정 승인 → 4) 살아 있는 계정 → 5) 권한(WRITE)
 *  → 6) 접수 건 조회 → 7) 값 마련·검증 → 8) 양식 읽기·채우기
 *  → 9) 감사(EXCEL_EXPORT) → 10) 전송
 *
 * 다른 것은 7번 하나다 — POST 는 요청 본문을 검증하고, GET 은 저장된 장을 읽어
 * **같은 검증에 넣는다.**
 *
 * 5번이 6번보다 앞인 이유: 권한이 없는 사람에게는 "그 id 의 접수 건이 있다"는
 * 사실조차 알려 주지 않는다.
 *
 * ── 🔴 왜 POST 를 GET 으로 갈아치우지 않는가 ────────────────────────────
 * 예전에는 POST 하나뿐이었다. 그때는 **보고서에 DB 표가 없어서** 문서에 적힐
 * 것이 전부 요청과 함께 왔고, 주소 하나로는 문서가 정해지지 않았다. 이제
 * `service_reports` 표가 있으므로 저장된 장은 id 하나로 정해진다 — 그것이 GET
 * 이다(그때 이 자리에 적어 둔 「저장은 다음 단계의 일이고 이 통로는 그때도 그대로
 * 쓰인다」가 이것이다).
 *
 * 그렇다고 POST 가 필요 없어지지는 않는다. **작성/편집 화면은 아직 저장하지 않은
 * 값으로도 뽑아야 한다** — 저장 전에 한 장 뽑아 보는 것이 그 화면의 보통
 * 쓰임새다. 그래서 문이 둘이고, **뒤쪽 아홉 단계는 같은 것을 쓴다.**
 *
 * 접수 건은 **존재와 접근 권한을 확인하는 데만** 쓴다. 문서 내용은 하나도
 * 여기서 끌어오지 않는다 — 자동 채움은 화면의 몫이고, 그래야 사람이 고친 값이
 * 서버에서 되돌려지는 일이 없다.
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
 * 🔴 **GET 도 같은 문턱이다**(2026-09-03 사용자 결정). 저장된 장을 읽을 뿐이니
 * READ 로 낮출 수 있어 보이지만, 나가는 물건이 **직인이 찍힌 그 문서 그대로**라
 * 낮추지 않는다 — 문 두 짝의 자물쇠가 다르면 낮은 쪽이 곧 그 문의 문턱이다.
 * 미리보기 화면이 READ 인 것과는 다르다: 그쪽은 화면에 그림을 그릴 뿐 파일이
 * 나가지 않는다(그 페이지의 '읽기 권한이면 된다').
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
  if (!(await hasPermission(actingUser, "repairCases", "WRITE"))) {
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
  // 🔴 이름은 **장비 셋**으로 짓는다(`domain/service-report-file-name.ts`) —
  //    목록에 보이는 이름과 같은 규칙이다. 고객사명은 이름에서 빠졌으므로
  //    넘기지 않는다.
  const fileName = buildServiceReportFileName({
    kind: input.kind,
    modelName: input.modelName,
    lotNumber: input.lotNumber,
    serialNumber: input.serialNumber,
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

/**
 * 🔴 주소에 실려 온 보고서 id 를 **조회에 넣기 전에** 걸러 낸다. uuid 가 아닌
 * 글자가 그대로 조회로 들어가면 Postgres 가 22P02 로 던져 500 이 나간다 —
 * 미리보기 화면·작성 화면과 같은 자리, 같은 규칙이다.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * 🔴 **못 찾는 까닭을 나눠 알려 주지 않는다.** 「없다」·「지워졌다」·「남의 건의
 * 것이다」가 전부 같은 404, 같은 문장이다 — 갈라 놓으면 주소만 바꿔 가며 어느
 * id 가 실재하는지 알아낼 수 있다(권한을 조회보다 앞에 두는 것과 같은 판단).
 */
const REPORT_NOT_FOUND_MESSAGE = "해당 보고서를 찾을 수 없습니다.";

/**
 * ────────────────────────────────────────────────────────────────────────────
 * GET /api/repair-cases/{접수건}/service-report/xlsx?id={보고서}
 *   — 「보고서」 탭의 목록에서 저장된 장을 그대로 내려받는다
 * ────────────────────────────────────────────────────────────────────────────
 * 순서·문턱·감사·응답 헤더는 **위 POST 와 같다**(머리말의 '순서 — 두 문이
 * 같다'). 다른 것은 7번 하나 — 요청 본문 대신 **저장된 장**을 읽는다.
 *
 * ── 🔴 값을 여기서 짓지 않는다 ─────────────────────────────────────────
 * 저장된 장을 문서로 바꾸는 길은 **이미 있다.** 미리보기 화면이 쓰는 그 사슬을
 * 그대로 쓴다(`.../report/service-report/print/page.tsx`):
 *
 *   저장된 장 → serviceReportFormValues → buildServiceReportRequestBody
 *            → validateServiceReportFields → fillServiceReportWorkbook
 *
 * 여기서 `?? ""` 같은 것을 새로 적으면 규칙이 두 곳에 살고, 그 순간 **미리보기와
 * 내려받은 파일이 다른 말을 하는** 날이 예약된다. 특히 `findingsIntro` 의
 * 「안 줌」과 「일부러 비움」을 가르는 자리는 `serviceReportFormValues` 하나뿐이다.
 *
 * ── 🔴 `?id=` 인 것은 형제 화면과 같은 자리이기 때문이다 ────────────────
 * 작성 화면도 미리보기 화면도 `?id={보고서}` 로 「무엇을 열 것인가」를 싣는다.
 * 접수 건 id 는 경로에 있고 보고서 id 는 질의문자열에 있는 이 모양이 그 둘과
 * 같다(print/page.tsx 머리말의 '왜 자식 경로가 아니라 `?id=` 인가').
 */
export async function GET(
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
  // 계정이 토큰 만료 전까지 예전 권한으로 받아 가는 구멍을 막는다(POST 와 같다).
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");

  /**
   * ── 5) 권한 — 조회보다 앞이다. 머리말의 '왜 READ 가 아니라 WRITE 인가' ──
   *
   * 🔴 문턱을 **손으로 적지 않는다.** `auth/service-report-authorization.ts` 의
   * `SERVICE_REPORT_REQUIRED_LEVELS.edit` 가 원본이고, 그 파일이 적어 둔 부르는
   * 법이 이 모양이다. 여기에 `"WRITE"` 를 베껴 두면 그 파일이 정한 문턱과 이
   * 라우트가 어긋나기 시작한다.
   */
  if (
    !(await hasPermission(actingUser,
      SERVICE_REPORT_PERMISSION_AREA,
      SERVICE_REPORT_REQUIRED_LEVELS.edit
    ))
  ) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 6) 접수 건 — 있는지와 지워지지 않았는지만 본다 ───────────────────
  const { id } = await context.params;
  // 지워진 건은 여기서도 없는 것이다(getRepairCaseById 가 is_deleted 로 좁힌다).
  const repairCase = await resolveRepairCaseForServer(id);
  if (!repairCase) return fail(404, "NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

  // ── 7) 저장된 보고서 → 채우개 입력 ───────────────────────────────────
  const serviceReportId = request.nextUrl.searchParams.get("id");
  if (serviceReportId === null || !UUID_PATTERN.test(serviceReportId)) {
    return fail(404, "NOT_FOUND", REPORT_NOT_FOUND_MESSAGE);
  }

  // 🔴 지워진 장은 없는 것이다(`getServiceReportForEdit` 이 is_deleted 로
  //    좁힌다). 휴지통에 넣은 장을 주소만으로 계속 뽑을 수 있으면 휴지통이 뜻을
  //    잃는다 — 지워진 접수 건을 없는 것으로 보는 것과 같은 자리다.
  const saved = await getServiceReportForEdit(serviceReportId);
  if (!saved) return fail(404, "NOT_FOUND", REPORT_NOT_FOUND_MESSAGE);
  /**
   * 🔴 **이 접수 건의 보고서가 맞는가.** 이것이 없으면 A 고객사 건의 주소로 B
   * 고객사 건의 보고서를 뽑아 갈 수 있다 — 작성 화면·미리보기 화면과 같은 자리,
   * 같은 규칙이다.
   */
  if (saved.repairCaseId !== repairCase.id) {
    return fail(404, "NOT_FOUND", REPORT_NOT_FOUND_MESSAGE);
  }

  // 위 '값을 여기서 짓지 않는다' — 미리보기 화면과 **같은 사슬**이다.
  const validated = validateServiceReportFields(
    buildServiceReportRequestBody(
      serviceReportFormValues(saved.values, SERVICE_REPORT_FINDINGS_INTRO)
    )
  );
  if (!validated.ok) {
    /**
     * 저장은 **적다 만 보고서도 받는다**(`validation/service-report-save-input.ts`).
     * 본문이 한 줄도 없는 장이 실제로 저장돼 있고, 그 장은 문서로 만들 수 없다.
     *
     * 🔴 칸별 오류(`validated.fieldErrors`)는 **싣지 않는다.** 셀 주소가 섞인
     * 개발자용 문장이고(UI_GUIDELINE 11 · 미리보기 화면의 같은 판단), 이 응답은
     * 링크를 누른 사람의 브라우저에 **날것 그대로** 보인다. POST 쪽이 그것을
     * 싣는 것은 받는 쪽이 화면이라 칸마다 붙여 줄 수 있기 때문이다.
     */
    return fail(
      400,
      "INVALID_INPUT",
      "아직 문서로 만들 수 없는 보고서입니다. 보고서를 열어 확인내용이나 조치를 한 줄이라도 적어 주세요."
    );
  }
  const input = validated.data;

  // ── 8) 양식을 읽어 채운다 — POST 와 같은 채우개, 같은 처리 ───────────
  let workbook: Buffer;
  try {
    workbook = fillServiceReportWorkbook(await readServiceReportTemplate(input.kind), input);
  } catch (err) {
    if (err instanceof ServiceReportTemplateError) {
      // 🔴 err.message 에는 경로가 들어 있지 않다(storage 쪽이 그렇게 만든다).
      return fail(503, "TEMPLATE_UNAVAILABLE", err.message);
    }
    // 🔴 본문 내용은 로그에 담지 않는다 — id 와 오류 메시지뿐이다(POST 와 같다).
    console.error("[service-report-xlsx] 저장된 보고서를 만들지 못했다", {
      repairCaseId: repairCase.id,
      serviceReportId: saved.id,
      kind: input.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail(500, "RENDER_FAILED", "보고서를 만들지 못했습니다. 관리자에게 문의해 주세요.");
  }

  // ── 9) 감사 — 파일을 돌려주기 전에 남긴다 ────────────────────────────
  // 응답을 먼저 반환하면 기록이 누락될 수 있다(POST 와 같은 자리, 같은 이유).
  // 🔴 남기는 값은 mutations 쪽이 정한다 — 본문 내용은 담기지 않는다.
  const reportNumber = formatServiceReportNumber(input.reportNumber);
  await recordServiceReportExport({
    repairCaseId: repairCase.id,
    kind: input.kind,
    reportNumber,
    actorUserId: actingUser.id,
  });

  // ── 10) 전송 — 헤더는 POST 와 똑같다 ─────────────────────────────────
  const fileName = buildServiceReportFileName({
    kind: input.kind,
    modelName: input.modelName,
    lotNumber: input.lotNumber,
    serialNumber: input.serialNumber,
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
