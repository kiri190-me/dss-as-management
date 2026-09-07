import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import ReportKindChoice from "@/components/repair-cases/report/ReportKindChoice";
import ServiceReportList, {
  type ServiceReportListRow,
} from "@/components/repair-cases/report/ServiceReportList";
import ServiceReportTabs, {
  type DeletedServiceReportListRow,
} from "@/components/repair-cases/report/ServiceReportTabs";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getPermissionLevel } from "@/lib/auth/permission-resolver";
import {
  SERVICE_REPORT_PERMISSION_AREA,
  canDeleteServiceReports,
  canEditServiceReports,
  canViewServiceReports,
} from "@/lib/auth/service-report-authorization";
import { readSession } from "@/lib/auth/session";
import {
  listDeletedServiceReportsForRepairCase,
  listServiceReportsForRepairCase,
} from "@/lib/db/queries/service-reports";
import { repairCaseDetailHrefs } from "@/lib/domain/repair-case-detail-tabs";
import { formatServiceReportKstDateTime } from "@/lib/domain/service-report-draft";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { SERVICE_REPORT_TITLES } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * /repair-cases/{id}/report — 「보고서」 탭: 저장해 둔 목록 + 갈림길
 * ============================================================================
 * 저장된 보고서가 있으면 그 목록을 먼저 보여 주고, 그 아래에 **언제나** 갈림길이
 * 남는다 — 한 접수 건에 여러 장이 붙는다(검사 한 장 + 수리 한 장).
 *
 * 검사냐 수리냐를 고르면 곧바로 작성 화면(`.../report/service-report`)으로
 * 넘어간다. 고른 종류는 주소에 실려 가고(`?kind=`), 작성 화면은 그것을
 * **시작값으로만** 쓴다 — 거기서 다시 바꿀 수 있다. 저장된 장을 여는 주소는
 * 대신 `?id=` 를 싣는다(작성 화면 머리말의 '왜 자식 경로가 아니라 `?id=` 인가').
 *
 * 작성 화면은 이 탭의 **자식 주소**라 그 화면에서도 「보고서」 탭이 강조된 채로
 * 남는다(`domain/repair-case-detail-tabs.ts` 의 `resolveActiveTabHref` — 최장
 * 일치).
 *
 * ── 🔴 두 이름을 여기 새로 적지 않는다 ──────────────────────────────────
 * 이름은 양식의 제목 하나에서 온다(`SERVICE_REPORT_TITLES`). 화면이 사본을 들고
 * 있으면 양식의 제목이 바뀐 날 화면과 문서가 서로 다른 이름을 부르는데, 아무
 * 오류도 안 나서 아무도 모른다 — 원인 라벨·드롭다운 목록을 채우개에서 받아 오는
 * 것과 같은 판단이다.
 *
 * ⚠️ **이 파일은 서버 컴포넌트라 `@/lib/xlsx/*` 를 값으로 가져와도 된다.**
 * 클라이언트 컴포넌트는 안 된다 — 채우개가 `node:fs`·`node:zlib` 를 끌고 온다.
 * 그래서 아래 `ReportKindChoice` 에는 **다 만들어진 글자**만 넘긴다.
 * `ServiceReportTabs` 도 같은 이유로 종류 이름을 글자로 받는다.
 *
 * ── 휴지통 탭 ───────────────────────────────────────────────────────────
 * 지운 장은 목록에서 사라지지만 없어지지는 않는다(소프트 삭제). 되살릴 자리가
 * 없으면 그 사실이 아무 쓸모가 없어서, **지울 수 있는 사람에게만** 「사용중 /
 * 휴지통」 탭을 그린다. 권한이 없으면 휴지통을 **읽지도 내려보내지도 않는다** —
 * 견적서 화면과 같은 규칙이다(`quotes/page.tsx`).
 * ============================================================================
 */

export const metadata: Metadata = {
  title: "보고서 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * 양식의 제목 → 화면에 쓸 이름.
 *
 * 🔴 양식의 제목은 **전각 공백(U+3000)으로 자간을 벌려 놓은 것**이다
 * (`검　사　보　고　서` — `SERVICE_REPORT_TITLES` 주석). 문서에는 그 모양 그대로
 * 찍혀야 하지만, 화면에 그대로 옮기면 그 두 줄만 자간이 벌어져 다른 글자들과
 * 어긋난다. 그래서 **화면에서만** 전각 공백을 걷어낸다 — 이름을 새로 적는 것이
 * 아니므로 양식의 제목이 바뀌면 이 화면도 따라간다.
 */
const IDEOGRAPHIC_SPACE = "　";

function screenTitle(templateTitle: string): string {
  return templateTitle.split(IDEOGRAPHIC_SPACE).join("");
}

/**
 * 목록에 찍을 종류 이름. **위 `screenTitle` 과 같은 곳에서 온다** — 목록과
 * 갈림길이 같은 화면에 나란히 있는데 서로 다른 이름을 부르면 안 된다.
 */
const KIND_LABELS = {
  INSPECTION: screenTitle(SERVICE_REPORT_TITLES.INSPECTION),
  REPAIR: screenTitle(SERVICE_REPORT_TITLES.REPAIR),
} as const;

export default async function RepairCaseReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 상위 (app) 레이아웃이 이미 세션을 확인했으므로 여기 도달했다면 정상적으로는
  // 항상 세션이 있다. 형제 탭들(approval/files/work-history)과 같은 모양으로
  // 방어적으로 한 번 더 본다. 접수 건이 실제로 있는지는 `[id]/layout.tsx` 가
  // 이미 확인하고 없으면 404 를 낸다 — 여기서 또 조회하지 않는다.
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  const serviceReportHref = `${repairCaseDetailHrefs(id).report}/service-report`;

  /**
   * 🔴 목록을 읽기 전에 **볼 수 있는 사람인지 다시 본다.** 상위 레이아웃이 접수
   * 건 영역을 이미 지키지만, 「무엇을 볼 수 있는가」의 원본은
   * `auth/service-report-authorization.ts` 다 — 화면이 그 판단을 건너뛰면 그
   * 파일이 정한 문턱과 실제 화면이 어긋나기 시작한다.
   *
   * 살아 있는 계정을 다시 읽는 것은 작성 화면·내려받기 라우트와 같은 이유다.
   */
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");
  const level = await getPermissionLevel(actingUser, SERVICE_REPORT_PERMISSION_AREA);

  /**
   * 접수 건이 실제로 있는지는 `[id]/layout.tsx` 가 이미 본다. 그래도 여기서 한 번
   * 더 부르는 까닭은 **그 id 로 조회를 하기 때문**이다 — uuid 가 아닌 주소가 그대로
   * 조회에 들어가면 Postgres 가 22P02 로 던져 화면이 오류 페이지가 된다. 이 함수는
   * 요청마다 캐시되므로(`cache()`) 조회가 한 번 더 도는 것이 아니다.
   */
  const resolved = await resolveRepairCaseForServer(id);
  if (!resolved) notFound();

  /**
   * 🔴 **내려받기는 고치기와 같은 문턱이다**(`SERVICE_REPORT_REQUIRED_LEVELS.edit`
   * — 그 파일의 '만들기·고치기가 WRITE 인 근거'). 그 판단을 화면이 여기서 한 번
   * 하고, 못 받는 사람에게는 **단추를 아예 그리지 않는다** — 눌러도 403 이 나는
   * 단추를 두지 않는다. 라우트는 화면이 감추든 말든 스스로 다시 확인한다.
   */
  const canDownload = canEditServiceReports(level);
  /**
   * 내려받기 라우트의 주소. 🔴 **여기서만 조립한다** — 목록 조각이 만들면 같은
   * 규칙이 두 곳에 산다(`href`·`printHref` 와 같은 판단). 보고서는 형제 화면들과
   * 같은 자리에 `?id=` 로 싣는다(그 라우트의 GET 머리말).
   */
  const xlsxHref = `/api/repair-cases/${resolved.id}/service-report/xlsx`;

  const rows: ServiceReportListRow[] = canViewServiceReports(level)
    ? (await listServiceReportsForRepairCase(resolved.id)).map((item) => ({
        id: item.id,
        href: `${serviceReportHref}?id=${item.id}`,
        // 🔴 주소는 **여기서만** 조립한다 — 목록 조각이 만들면 같은 규칙이 두
        //    곳에 살고, 한쪽만 고쳐지는 날이 온다(`href` 와 같은 판단).
        //    형제 화면과 같은 자리에 `?id=` 를 싣는다(print/page.tsx 머리말).
        printHref: `${serviceReportHref}/print?id=${item.id}`,
        // 🔴 못 받는 사람에게는 주소를 아예 내려보내지 않는다 — 위 `canDownload`.
        xlsxHref: canDownload ? `${xlsxHref}?id=${item.id}` : null,
        kindLabel: KIND_LABELS[item.kind],
        // 🔴 이름은 **조회가 만들어** 온다(`domain/service-report-list.ts`).
        //    여기서 잇지 않는 까닭은 휴지통 쪽과 규칙이 갈라지지 않게 하려는
        //    것이다 — 주소를 여기서만 조립하는 것과 정확히 반대쪽 판단이다.
        name: item.name,
        reportNumber: item.reportNumber,
        issuedOn: item.issuedOn,
        // 시각을 못 읽으면 지어내지 않고 뺀다 — 목록의 다른 값은 그대로 쓸모가 있다.
        updatedAtLabel: formatServiceReportKstDateTime(new Date(item.updatedAt)),
      }))
    : [];

  /**
   * 🔴 **휴지통은 지울 수 있는 사람만 읽는다.** 못 여는 탭의 내용을 클라이언트로
   * 실어 보내지 않는다(`quotes/page.tsx` 의 그 규칙). 문턱이 지우기와 같은 것은
   * `auth/service-report-authorization.ts` 가 정한 것이다 — "지울 수는 있는데
   * 되돌릴 수는 없는" 역할을 만들지 않는다.
   */
  const canDelete = canDeleteServiceReports(level);
  const trashRows: DeletedServiceReportListRow[] = canDelete
    ? (await listDeletedServiceReportsForRepairCase(resolved.id)).map((item) => ({
        id: item.id,
        version: item.version,
        kindLabel: KIND_LABELS[item.kind],
        // 사용중 목록과 **같은 길로 온 같은 이름**이다 — 위 주석 참조.
        name: item.name,
        reportNumber: item.reportNumber,
        issuedOn: item.issuedOn,
        // 시각을 못 읽으면 지어내지 않고 뺀다 — 목록 쪽과 같은 판단.
        deletedAtLabel: item.deletedAt
          ? formatServiceReportKstDateTime(new Date(item.deletedAt))
          : null,
        deletedByName: item.deletedByName,
        deleteReason: item.deleteReason,
      }))
    : [];

  // 한 장도 없으면 목록을 그리지 않는다 — 빈 상자를 억지로 그리지 않는다.
  const savedList = rows.length > 0 ? <ServiceReportList rows={rows} /> : null;

  /**
   * 탭 막대는 **지울 권한이 있고, 보여 줄 것이 하나라도 있을 때만** 그린다.
   * 저장된 것도 지운 것도 없는 건에서는 「사용중 (0) / 휴지통 (0)」 두 칸이
   * 갈림길 위에 앉아 아무것도 알려 주지 않는다.
   */
  const showTabs = canDelete && (rows.length > 0 || trashRows.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {showTabs ? (
        // 「사용중」 목록은 **서버가 그려서** 넘긴다 — 그 조각을 클라이언트로
        // 끌어들이지 않기 위해서다(ServiceReportTabs 머리말).
        <ServiceReportTabs savedCount={rows.length} trashRows={trashRows}>
          {savedList}
        </ServiceReportTabs>
      ) : (
        savedList
      )}

      <ReportKindChoice
        options={[
          {
            kind: "INSPECTION",
            title: KIND_LABELS.INSPECTION,
            // 두 양식의 실제 차이는 이것 하나다 — 채우개 머리말에 실측이 적혀 있다.
            description: "확인내용과 조치를 적습니다. 「정리」 구역과 「조치 완료」 칸이 없습니다.",
            href: `${serviceReportHref}?kind=INSPECTION`,
          },
          {
            kind: "REPAIR",
            title: KIND_LABELS.REPAIR,
            description: "검사 보고서에 「정리」 구역과 「조치 완료」 칸이 더해집니다.",
            href: `${serviceReportHref}?kind=REPAIR`,
          },
        ]}
      />
    </div>
  );
}
