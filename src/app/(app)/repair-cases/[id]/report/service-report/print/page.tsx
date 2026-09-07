import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import PlaceholderPage from "@/components/layout/PlaceholderPage";
import ServiceReportPrintView from "@/components/repair-cases/report/service-report/ServiceReportPrintView";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getPermissionLevel } from "@/lib/auth/permission-resolver";
import {
  SERVICE_REPORT_PERMISSION_AREA,
  canViewServiceReports,
} from "@/lib/auth/service-report-authorization";
import { readSession } from "@/lib/auth/session";
import { getServiceReportForEdit } from "@/lib/db/queries/service-reports";
import { repairCaseDetailHrefs } from "@/lib/domain/repair-case-detail-tabs";
import { buildServiceReportRequestBody } from "@/lib/domain/service-report-form";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import {
  readServiceReportTemplate,
  ServiceReportTemplateError,
} from "@/lib/storage/service-report-template";
import { validateServiceReportFields } from "@/lib/validation/service-report-input";
import { serviceReportFormValues } from "@/lib/validation/service-report-save-input";
import {
  readSheetPrintGrid,
  type SheetPrintGrid,
} from "@/lib/xlsx/sheet-print-grid";
import {
  fillServiceReportWorkbook,
  SERVICE_REPORT_FINDINGS_INTRO,
  SERVICE_REPORT_SHEET_NAME,
  SERVICE_REPORT_TITLES,
} from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * /repair-cases/{건}/report/service-report/print?id={보고서} — 미리보기 · PDF
 * ============================================================================
 * 브라우저의 「PDF로 저장」이 곧 PDF 내려받기다. 🔴 PDF 라이브러리도, 서버 쪽
 * 변환 프로그램도 쓰지 않는다 — 견적서 미리보기가 이미 내린 판단이고, 곧 NAS 로
 * 옮길 예정이라 서버에 짐을 더하지 않는다.
 *
 * ── 🔴 문서를 다시 그리지 않는다 — 채우개가 만든 것을 읽는다 ────────────
 * 이 화면은 **내려받기와 똑같은 길로** 문서를 만든다:
 *
 *   저장된 장 → serviceReportFormValues → buildServiceReportRequestBody
 *            → validateServiceReportFields → fillServiceReportWorkbook
 *            → readSheetPrintGrid → 표 자료 → 화면
 *
 * 가운데 넷은 내려받기 라우트(`api/repair-cases/[id]/service-report/xlsx`)와
 * 작성 화면이 이미 쓰는 것 그대로다. 미리보기용 변환을 새로 만들면 그 순간
 * 문서가 두 벌이 되고, 언젠가 «미리보기와 파일이 다른 말을 하는» 날이 온다.
 *
 * ⚠️ 그래서 이 화면은 통합문서를 **실제로 만든다**(zip 을 짓고 다시 연다). 실측
 * 109ms 다. 그 값으로 «미리보기와 파일이 같다»는 보증을 산다.
 *
 * ── 🔴 왜 `?id=` 인가 ───────────────────────────────────────────────────
 * 형제 화면인 작성/수정 화면이 이미 `.../service-report?id={보고서}` 다. 「무엇을
 * 열 것인가」를 정하는 값을 형제와 **같은 자리**에 두는 편이, 한쪽은 질의문자열이고
 * 한쪽은 경로 조각인 것보다 읽기 쉽다(그 화면 머리말의 '왜 자식 경로가 아니라
 * `?id=` 인가').
 *
 * 탭 강조는 어느 쪽이든 같다 — `resolveActiveTabHref` 는 **경로**의 최장 일치라
 * 이 주소에서도 「보고서」 탭이 강조된 채로 남는다.
 *
 * ── 🔴 읽기 권한이면 된다 ───────────────────────────────────────────────
 * 아무것도 바꾸지 않고 **이미 저장된 값**을 보여 줄 뿐이다. 내려받기 라우트가
 * WRITE 를 요구하는 것은 그쪽이 «보내는 사람이 문서 내용을 그 자리에서 짓기»
 * 때문인데(그 라우트의 '왜 READ 가 아니라 WRITE 인가'), 여기서 그릴 수 있는 것은
 * 이미 누군가 WRITE 권한으로 저장해 둔 장뿐이다. 그러니 목록에서 그 보고서를 볼
 * 수 있는 사람이면 미리보기도 열 수 있는 것이 맞다 — 견적서 미리보기와 같은
 * 자리다. 문턱의 원본은 `auth/service-report-authorization.ts` 다.
 *
 * 볼 수 없는 사람에게는 **404 다.** "권한이 없습니다"라고 답하면 그 id 의 보고서가
 * 있다는 사실을 알려 주는 셈이다(내려받기 라우트가 권한을 조회보다 앞에 두는 것과
 * 같은 판단).
 *
 * 지워진 장은 없는 것이다(`getServiceReportForEdit` 이 이미 그렇게 좁힌다) —
 * 휴지통에 넣은 보고서를 주소만으로 계속 뽑을 수 있으면 휴지통이 뜻을 잃는다.
 *
 * ── 🔴 양식을 못 읽어도 화면이 죽지 않는다 ──────────────────────────────
 * 서버 컴포넌트에서 던지면 화면이 통째로 오류 페이지가 된다. 잡아서 한 줄로
 * 알려 준다 — 작성 화면이 드롭다운 목록에 대해 하는 것과 같다. 🔴 그 안내에
 * **경로를 담지 않는다**(오류가 디스크 구조를 알려 주는 창구가 되면 안 된다).
 * ============================================================================
 */

export const metadata: Metadata = {
  title: "보고서 미리보기 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

const TEMPLATE_UNAVAILABLE_MESSAGE =
  "양식을 읽을 수 없어 미리보기를 그리지 못했습니다. 관리자에게 문의해 주세요.";

const RENDER_FAILED_MESSAGE =
  "이 보고서로 미리보기를 그리지 못했습니다. 보고서를 열어 내용을 확인해 주세요.";

/**
 * 🔴 주소에 실려 온 보고서 id 를 **조회에 넣기 전에** 걸러 낸다. uuid 가 아닌
 * 글자가 그대로 조회로 들어가면 Postgres 가 22P02 로 던져 화면이 통째로 오류
 * 페이지가 된다 — 작성 화면과 같은 자리, 같은 규칙이다.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function serviceReportIdFromParam(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  return UUID_PATTERN.test(value) ? value : null;
}

/**
 * 양식의 제목에서 화면용 이름을 만든다. 🔴 두 이름을 여기 새로 적지 않는다 —
 * 「보고서」 탭이 이미 같은 곳에서 같은 방법으로 만든다(그 화면의 `screenTitle`).
 * 전각 공백은 문서의 자간을 벌리려고 넣은 것이라 화면에서만 걷어낸다.
 */
function screenTitle(templateTitle: string): string {
  return templateTitle.split("　").join("");
}

export default async function ServiceReportPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** 같은 이름이 두 번 올 수 있는 자리라 배열도 받는다. */
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await params;
  const { id: serviceReportIdParam } = await searchParams;

  // 상위 (app) 레이아웃이 이미 세션을 확인하지만, 이 화면은 고객사로 나가는
  // 문서를 그대로 그리는 자리라 방어적으로 한 번 더 본다. 살아 있는 계정을 다시
  // 읽는 것도 형제 화면들과 같은 이유다.
  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  const resolved = await resolveRepairCaseForServer(id);
  if (!resolved) notFound();

  // 🔴 권한을 **조회보다 앞에** 본다 — 위 '볼 수 없는 사람에게는 404 다'.
  const level = await getPermissionLevel(actingUser, SERVICE_REPORT_PERMISSION_AREA);
  if (!canViewServiceReports(level)) notFound();

  const serviceReportId = serviceReportIdFromParam(serviceReportIdParam);
  if (serviceReportId === null) notFound();

  const saved = await getServiceReportForEdit(serviceReportId);
  if (!saved) notFound();
  /**
   * 🔴 **이 접수 건의 보고서가 맞는가.** 아니면 남의 건의 보고서를 이 건의 주소로
   * 열어 보는 길이 된다 — 작성 화면과 같은 자리, 같은 규칙이다.
   */
  if (saved.repairCaseId !== resolved.id) notFound();

  const reportHref = repairCaseDetailHrefs(resolved.id).report;
  const backHref = `${reportHref}/service-report?id=${saved.id}`;

  /**
   * 저장된 값 → 폼 값 → 채우개 입력. **이미 있는 변환만 쓴다**(위 머리말).
   *
   * 🔴 `findingsIntro` 의 「안 줌」과 「일부러 비움」을 가르는 자리는
   * `serviceReportFormValues` 하나뿐이다 — 여기서 `?? ""` 같은 것을 새로 적으면
   * 사람이 지운 문장이 미리보기에서 되살아난다.
   */
  const validated = validateServiceReportFields(
    buildServiceReportRequestBody(
      serviceReportFormValues(saved.values, SERVICE_REPORT_FINDINGS_INTRO)
    )
  );

  let grid: SheetPrintGrid | null = null;
  let kindLabel = "";
  let notice: string | null = null;

  if (!validated.ok) {
    /**
     * 저장은 **적다 만 보고서도 받는다**(`validation/service-report-save-input.ts`).
     * 본문이 한 줄도 없는 장이 실제로 저장돼 있을 수 있고, 그 장은 문서로 만들 수
     * 없다. 화면을 죽이는 대신 왜 못 그리는지 알려 주고 돌아갈 길을 남긴다.
     *
     * 🔴 칸별 오류 메시지를 그대로 내보내지 않는다 — 셀 주소가 섞인 개발자용
     * 문장이다(UI_GUIDELINE 11).
     */
    notice = "아직 문서로 만들 수 없는 보고서입니다. 확인내용이나 조치를 한 줄이라도 적어 주세요.";
  } else {
    kindLabel = screenTitle(SERVICE_REPORT_TITLES[validated.data.kind]);
    try {
      const workbook = fillServiceReportWorkbook(
        await readServiceReportTemplate(validated.data.kind),
        validated.data
      );
      grid = readSheetPrintGrid(workbook, SERVICE_REPORT_SHEET_NAME);
    } catch (err) {
      if (err instanceof ServiceReportTemplateError) {
        // 🔴 err.message 에는 경로가 들어 있지 않다(storage 쪽이 그렇게 만든다).
        notice = TEMPLATE_UNAVAILABLE_MESSAGE;
      } else {
        // 양식이 바뀌어 라벨이 어긋나면 채우개가 던진다. 🔴 본문 내용은 로그에
        // 담지 않는다 — 보고서 id 와 오류 메시지뿐이다(내려받기 라우트와 같다).
        console.error("[service-report-print] 미리보기를 그리지 못했다", {
          serviceReportId: saved.id,
          kind: validated.data.kind,
          error: err instanceof Error ? err.message : String(err),
        });
        notice = RENDER_FAILED_MESSAGE;
      }
    }
  }

  if (grid === null) {
    return (
      <PlaceholderPage
        title="보고서 미리보기"
        description={`${notice ?? RENDER_FAILED_MESSAGE} 보고서로 돌아가려면 「보고서」 탭을 눌러 주세요.`}
      />
    );
  }

  return (
    <ServiceReportPrintView
      grid={grid}
      backHref={backHref}
      kindLabel={kindLabel}
      // 🔴 그림 라우트의 주소는 **서버가 정해 넘긴다** — 화면과 라우트가 각자
      //    주소를 들고 있으면 폴더 이름을 바꾸는 날 한쪽만 고쳐진다.
      templateImageBase="/api/service-reports/template-image/"
    />
  );
}
