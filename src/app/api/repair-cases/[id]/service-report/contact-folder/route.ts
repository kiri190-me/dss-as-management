import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isTrustedOrigin } from "@/lib/auth/request-guards";
import {
  SERVICE_REPORT_PERMISSION_AREA,
  SERVICE_REPORT_REQUIRED_LEVELS,
} from "@/lib/auth/service-report-authorization";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getServiceReportForEdit } from "@/lib/db/queries/service-reports";
import {
  serviceReportContactFolderCategory,
  serviceReportContactFolderRelativePath,
} from "@/lib/domain/service-report-contact-folder";
import {
  buildServiceReportFileName,
  formatServiceReportNumber,
} from "@/lib/domain/service-report-file-name";
import { buildServiceReportRequestBody } from "@/lib/domain/service-report-form";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import {
  copyIntoContactFolder,
  resolveContactFolderArchiveRoot,
} from "@/lib/storage/contact-folder-archive";
import {
  readServiceReportTemplateForCase,
  ServiceReportTemplateError,
} from "@/lib/storage/service-report-template";
import {
  describeServiceReportBlockers,
  validateServiceReportFields,
} from "@/lib/validation/service-report-input";
import { serviceReportFormValues } from "@/lib/validation/service-report-save-input";
import { setActiveSheet } from "@/lib/xlsx/active-sheet";
import {
  fillServiceReportWorkbook,
  SERVICE_REPORT_FINDINGS_INTRO,
  SERVICE_REPORT_SHEET_NAME,
} from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * POST /api/repair-cases/{id}/service-report/contact-folder?id={보고서}
 *   — 저장된 보고서 엑셀을 그 건의 **연락서 폴더 분류 폴더**에 꽂는다 (2026-10-12)
 * ============================================================================
 * 사용자 요구(2026-10-12): 「보고서 탭에서 [저장]을 누르면 그 건의 연락서 폴더 안 분류
 * 폴더에 엑셀을 쓰고, 그 엑셀을 PDF 로 바꿔 같은 자리에 둔다.」 이 통로가 **앞의 절반**
 * (엑셀 쓰기)이고, 뒤의 절반(PDF)은 쓰는 분 PC 의 Excel 이 한다 — 화면이
 * `dss-folder://xlsx2pdf/?p=…` 를 열고 이웃 통로(`./pdf`)가 폴더를 다시 읽어 확인한다.
 *
 * ── 🔴 저장(DB)을 건드리지 않는다 ───────────────────────────────────────
 * 보고서 저장은 서버 액션(`server/actions/service-reports.ts`)이 이미 하고 있고 **한 글자도
 * 바뀌지 않았다.** 화면은 저장이 **끝난 뒤에** 이 통로를 부른다 — 그래서 공유폴더가 꺼져
 * 있든 느리든 실패하든 **보고서는 저장된 채**다. 이 파일에 보고서 표를 쓰는 코드가 없다
 * (DB 는 읽기만 한다).
 *
 * ── 🔴 양식 채우기를 다시 적지 않는다 ───────────────────────────────────
 * 엑셀을 만드는 사슬은 이웃 통로(`../xlsx` 의 GET)가 쓰는 **그것 그대로**다:
 *   저장된 장 → serviceReportFormValues → buildServiceReportRequestBody
 *            → validateServiceReportFields → fillServiceReportWorkbook
 * 여기서 `?? ""` 하나라도 새로 적으면 **미리보기 · 내려받기 · 공유폴더 사본이 서로 다른
 * 말을 하는** 날이 예약된다.
 *
 * ── 🔴 쓰는 길도 다시 적지 않는다 ───────────────────────────────────────
 * 꽂기는 올리기 사본이 쓰는 `copyIntoContactFolder` **그대로**다. 그래서 다음이 한 글자도
 * 다르지 않다: 루트 안 검사 · `"wx"` 로만 열기 · 같은 내용이면 다시 안 쓰기 · 번호 붙여
 * 비켜 가기 · NFC/NFD 접어 견주기 · 🔴 **연락서 폴더를 만들지 않기**(없으면 `no-folder`) ·
 * 🔴 **지우지 않기**. 이 파일에 `mkdir` · `writeFile` · `unlink` · `rm` · `rename` 이 한
 * 글자도 없다는 사실을 route-source.test.ts 가 원본을 글자로 읽어 못 박는다.
 *
 * ── 🔴 어느 분류 폴더인가 — 종류가 정한다 ───────────────────────────────
 * `INSPECTION` → `INSPECTION_REPORT`(「검사 보고서」) · `REPAIR` → `REPAIR_REPORT`
 * (「수리 보고서」). 표는 domain/service-report-contact-folder.ts 한 자리에 있고, 폴더
 * 이름은 `contactFolderCategoryFolderName` 이 짓는다 — 🔴 **쓰는 분류만 그때그때 만든다**
 * (분류 폴더를 미리 다 만들지 않는다 — 2026-10-05 사용자 결정).
 * 🔴 **종류는 저장된 장에서 읽는다** — 화면이 보낸 값으로 자리를 고르지 않는다.
 *
 * ── 🔴 파일 이름은 사람이 탐색기에서 찾을 수 있는 이름이다 ──────────────
 * `buildServiceReportFileName` 이 짓는 내려받기 이름 그대로를 넘긴다
 * (`검사보고서_T2RCONT-AD2_WN3947_1802034.xlsx`). 그 뒤 연락서 폴더의 이름 규칙
 * (`contactFolderCopyFileName`)이 다듬고 길이를 맞춘다 — 분류 라벨을 앞에 덧붙이지 않는다
 * (domain/contact-folder-naming.ts 의 「사람이 손으로 넣은 파일과 같은 모양」).
 *
 * ── 🔴 감사를 남기지 않는다 ─────────────────────────────────────────────
 * **견적서 [저장]에 딸린 공유폴더 사본과 같은 판단**이다(services/quote-issue.ts 의
 * copyToArchive — 거기에도 감사 기록이 없다). 이 길은 사람이 꺼내 가는 것도, 창고의 파일이
 * 움직이는 것도 아니고 **방금 저장한 그 장에서 파생된 사본**이다. 그 장의 저장 · 수정은
 * 보고서 쪽 mutation 이 이미 기록하고 있다. (올리기 사본 · [연락서 폴더에 저장]이 감사를
 * 남기는 것은 거기서는 **창고의 파일이나 다른 서류함의 파일이 움직이기** 때문이다.)
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 출처 → 3) 세션 · 살아 있는 계정 · 승인
 *  → 4) 권한(보고서 **편집** 문턱 — `../xlsx` 와 같은 원본에서 읽는다)
 *  → 5) 공유폴더 루트(비면 `disabled` — DB 도 디스크도 더 안 본다)
 *  → 6) 수리 건(휴지통이면 없는 것) → 7) 저장된 보고서(이 건의 것인가)
 *  → 8) 값 마련 · 검증 → 9) 양식 읽기 · 채우기 → 10) 분류 폴더에 꽂기 → 11) JSON
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ status: "copied" | "unchanged", fileName, categoryFolderName,
 *          categoryFolderBlockedByFile, relativePath? }`
 *    🔴 `relativePath` 는 **루트 기준 상대 폴더 경로**(이웃 연락서 통로가 이미 내는 값과
 *    같은 성질)이고, 도우미가 받을 수 없는 이름이면 **그 칸만 빠진다** — 화면은 그때
 *    변환 주소를 지어내지 않는다.
 *  · 200 `{ status: "no-folder" }` · `{ status: "multiple" }` · `{ status: "disabled" }`
 *  · 200 `{ status: "failed", reason }`
 *  · 실패 `{ error, code }` — 400 · 401 · 403 · 404 · 500 · 503.
 *    🔴 어느 쪽에도 절대 경로 · 루트 · 연락서 폴더 이름이 들어가지 않는다.
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "DATABASE_MODE_REQUIRED"
  | "UNTRUSTED_ORIGIN"
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "TEMPLATE_UNAVAILABLE"
  | "RENDER_FAILED";

/**
 * 응답 본문. 🔴 **컨테이너 안 경로 · 루트를 담는 칸이 타입 수준에 없다.** 나가는 것은 루트
 * 기준 상대 폴더 경로 · 그 폴더 안에서의 파일 이름 · 짧은 사유뿐이다.
 */
type ServiceReportContactFolderResponse =
  | {
      status: "copied" | "unchanged";
      /** 디스크에 **실제로 쓴** 이름(같은 이름이 있었으면 번호가 붙었다). */
      fileName: string;
      /** 꽂은 분류 폴더 이름. `null` 이면 연락서 폴더 **바로 아래**다. */
      categoryFolderName: string | null;
      /** 🔴 같은 이름의 **파일**이 분류 폴더 자리를 막아 바로 아래로 비켜 갔는가. */
      categoryFolderBlockedByFile: boolean;
      /** 🔴 도우미 주소를 만들 재료. 이름이 규칙 밖이면 **이 칸이 통째로 빠진다.** */
      relativePath?: string;
    }
  /** 🔴 연락서 폴더가 아직 없다 — **만들지 않았다.** 사람이 [폴더 만들고 열기]로 만든다. */
  | { status: "no-folder" }
  /** 맞는 폴더가 여럿이다 — 🔴 어디에 넣을지 앱이 고르지 않는다. */
  | { status: "multiple" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/** 🔴 못 찾는 까닭을 나눠 알려 주지 않는다(`../xlsx` 의 GET 과 같은 문장, 같은 판단). */
const REPORT_NOT_FOUND_MESSAGE = "해당 보고서를 찾을 수 없습니다.";

/**
 * 🔴 주소에 실려 온 보고서 id 를 **조회에 넣기 전에** 걸러 낸다 — uuid 가 아닌 글자가
 * 그대로 조회로 들어가면 Postgres 가 22P02 로 던져 500 이 나간다(`../xlsx` 와 같은 규칙).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function fail(status: number, code: FailureCode, message: string): NextResponse {
  // 🔴 실패 응답에 공유폴더 경로 · 루트 · 폴더 이름을 싣지 않는다(이웃 통로들과 같은 규율).
  return NextResponse.json({ error: message, code }, { status });
}

function respond(body: ServiceReportContactFolderResponse): NextResponse {
  return NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // ── 1) 저장 모드 ──────────────────────────────────────────────────────
  if (getAuthSource() !== "database") {
    return fail(403, "DATABASE_MODE_REQUIRED", "데이터베이스 저장 모드가 아닙니다.");
  }

  // ── 2) 출처 — 공유폴더에 파일을 하나 늘리는 요청이다 ──────────────────
  if (!isTrustedOrigin(request)) {
    return fail(403, "UNTRUSTED_ORIGIN", "요청 출처를 확인할 수 없습니다.");
  }

  // ── 3) 세션 · 살아 있는 계정 · 승인 ──────────────────────────────────
  const session = await readSession();
  if (!session) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  if (session.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "계정이 아직 승인되지 않았습니다.");
  }
  // 세션에 박힌 role 이 아니라 살아 있는 계정을 다시 읽는다 — 강등된 계정이 토큰 만료
  // 전까지 예전 권한으로 쓰는 구멍을 막는다(`../xlsx` 와 같은 자리).
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");

  /**
   * ── 4) 권한 — 조회보다 앞이다 ─────────────────────────────────────────
   * 🔴 문턱을 **손으로 적지 않는다.** `auth/service-report-authorization.ts` 의
   * `SERVICE_REPORT_REQUIRED_LEVELS.edit` 가 원본이고, 이웃 통로(`../xlsx`)도 같은
   * 자리에서 읽는다. 여기에 `"WRITE"` 를 베껴 두면 두 문의 자물쇠가 갈라진다.
   */
  if (
    !(await hasPermission(actingUser, SERVICE_REPORT_PERMISSION_AREA, SERVICE_REPORT_REQUIRED_LEVELS.edit))
  ) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 5) 공유폴더 루트 — 🔴 비면 여기서 끝난다(엑셀을 만들지도 않는다) ───
  const archiveRoot = resolveContactFolderArchiveRoot();
  if (archiveRoot === null) {
    return respond({ status: "disabled" });
  }

  // ── 6) 수리 건 — 지워진 건은 여기서도 없는 것이다 ─────────────────────
  const { id } = await context.params;
  const repairCase = await resolveRepairCaseForServer(id);
  if (!repairCase) return fail(404, "NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

  // ── 7) 저장된 보고서 — 🔴 **이 접수 건의 것인가**까지 본다 ─────────────
  const serviceReportId = request.nextUrl.searchParams.get("id");
  if (serviceReportId === null || !UUID_PATTERN.test(serviceReportId)) {
    return fail(404, "NOT_FOUND", REPORT_NOT_FOUND_MESSAGE);
  }
  const saved = await getServiceReportForEdit(serviceReportId);
  if (!saved) return fail(404, "NOT_FOUND", REPORT_NOT_FOUND_MESSAGE);
  // 이것이 없으면 A 고객사 건의 주소로 B 고객사 건의 보고서를 그 폴더에 꽂을 수 있다.
  if (saved.repairCaseId !== repairCase.id) {
    return fail(404, "NOT_FOUND", REPORT_NOT_FOUND_MESSAGE);
  }

  // ── 8) 값 마련 · 검증 — 🔴 `../xlsx` 의 GET 과 **같은 사슬**이다 ───────
  const validated = validateServiceReportFields(
    buildServiceReportRequestBody(serviceReportFormValues(saved.values, SERVICE_REPORT_FINDINGS_INTRO))
  );
  if (!validated.ok) {
    // 저장은 **적다 만 보고서도 받는다** — 그 장은 문서로 만들 수 없다. 막힌 칸의 **이름**만
    // 말한다(칸별 오류 메시지는 개발자용 문장이라 싣지 않는다 — `../xlsx` 와 같은 판단).
    return fail(400, "INVALID_INPUT", describeServiceReportBlockers(validated.fieldErrors));
  }
  const input = validated.data;

  // ── 9) 양식을 읽어 채운다 — 같은 채우개, 같은 처리 ────────────────────
  //    🔴 양식 넷(문서 종류 × 매쳐·제너레이터) 중 하나를 고르는 규칙도 `../xlsx`
  //    와 같은 자리에서 온다(`storage/service-report-template.ts`). 제품 축은
  //    6번에서 이미 읽어 둔 수리 건의 `workflowType` 에서 나오므로 조회가 늘지
  //    않는다.
  //    🔴 **활성 시트를 세우는 것도 `../xlsx` 와 같다**(2026-10-19 · 견적서와 같은
  //    함수 `xlsx/active-sheet.ts`). 🔴 **이 통로가 가장 중요한 자리다** — 여기서
  //    꽂은 엑셀을 그 PC 의 Excel 이 **활성 시트 하나만** PDF 로 바꿔 연락서 폴더에
  //    둔다. 양식 파일에 저장된 활성 탭에 기대면, 사람이 `Repair_Record` 를 켠 채
  //    양식을 저장한 날 **엉뚱한 시트가 고객에게 나간다**(아무 오류도 없다).
  let workbook: Buffer;
  try {
    workbook = setActiveSheet(
      fillServiceReportWorkbook(
        await readServiceReportTemplateForCase(input.kind, repairCase.workflowType),
        input
      ),
      SERVICE_REPORT_SHEET_NAME
    );
  } catch (err) {
    if (err instanceof ServiceReportTemplateError) {
      // 🔴 err.message 에는 경로가 들어 있지 않다(storage 쪽이 그렇게 만든다).
      return fail(503, "TEMPLATE_UNAVAILABLE", err.message);
    }
    // 🔴 본문 내용은 로그에 담지 않는다 — id 와 오류 메시지뿐이다(`../xlsx` 와 같다).
    console.error("[service-report-contact-folder] 보고서를 만들지 못했다", {
      repairCaseId: repairCase.id,
      serviceReportId: saved.id,
      kind: input.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail(500, "RENDER_FAILED", "보고서를 만들지 못했습니다. 관리자에게 문의해 주세요.");
  }

  // ── 10) 꽂는다 — 🔴 **그 종류의 분류 폴더**에. 연락서 폴더는 만들지 않는다 ──
  //     이름은 내려받기와 같은 규칙으로 짓고(사람이 탐색기에서 찾는 이름), 그 뒤의
  //     다듬기 · 길이 맞추기 · 번호 비켜 가기는 전부 저장 모듈이 쥔다.
  const category = serviceReportContactFolderCategory(input.kind);
  const copied = await copyIntoContactFolder({
    root: archiveRoot,
    intakeNumber: repairCase.intakeNumber,
    category,
    originalFileName: buildServiceReportFileName({
      kind: input.kind,
      modelName: input.modelName,
      lotNumber: input.lotNumber,
      serialNumber: input.serialNumber,
      reportNumber: formatServiceReportNumber(input.reportNumber),
    }),
    bytes: new Uint8Array(workbook),
  });

  // ── 11) JSON — 상대 폴더 경로 · 파일 이름 · 짧은 사유만 ────────────────
  if (copied.status === "copied" || copied.status === "unchanged") {
    // 🔴 꽂힌 자리는 **저장 모듈이 알려 준 그대로**다 — 여기서 다시 고르지 않는다
    //    (분류 폴더 자리를 파일이 막고 있으면 `categoryFolderName` 이 null 로 온다).
    const relativePath = serviceReportContactFolderRelativePath(
      copied.folderName,
      copied.categoryFolderName
    );
    return respond({
      status: copied.status,
      fileName: copied.fileName,
      categoryFolderName: copied.categoryFolderName,
      categoryFolderBlockedByFile: copied.categoryFolderBlockedByFile,
      // 도우미가 받지 않을 이름이면(사람이 NAS 에서 만든 이름 등) 이 칸만 빠진다.
      ...(relativePath === null ? {} : { relativePath }),
    });
  }
  if (copied.status === "no-folder") return respond({ status: "no-folder" });
  if (copied.status === "multiple") return respond({ status: "multiple" });
  if (copied.status === "disabled") {
    // 위 5) 에서 루트를 먼저 보았으므로 닿지 않는다. 상태가 하나 늘면 컴파일러가 짚게 둔다.
    return respond({ status: "disabled" });
  }
  return respond({ status: "failed", reason: copied.reason });
}
