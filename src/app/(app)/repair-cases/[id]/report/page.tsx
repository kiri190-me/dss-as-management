import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import ReportKindChoice from "@/components/repair-cases/report/ReportKindChoice";
import ServiceReportList, {
  type ServiceReportListRow,
} from "@/components/repair-cases/report/ServiceReportList";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getPermissionLevel } from "@/lib/auth/permission-resolver";
import {
  SERVICE_REPORT_PERMISSION_AREA,
  canViewServiceReports,
} from "@/lib/auth/service-report-authorization";
import { readSession } from "@/lib/auth/session";
import { listServiceReportsForRepairCase } from "@/lib/db/queries/service-reports";
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
  const level = await getPermissionLevel(actingUser.role, SERVICE_REPORT_PERMISSION_AREA);

  /**
   * 접수 건이 실제로 있는지는 `[id]/layout.tsx` 가 이미 본다. 그래도 여기서 한 번
   * 더 부르는 까닭은 **그 id 로 조회를 하기 때문**이다 — uuid 가 아닌 주소가 그대로
   * 조회에 들어가면 Postgres 가 22P02 로 던져 화면이 오류 페이지가 된다. 이 함수는
   * 요청마다 캐시되므로(`cache()`) 조회가 한 번 더 도는 것이 아니다.
   */
  const resolved = await resolveRepairCaseForServer(id);
  if (!resolved) notFound();

  const rows: ServiceReportListRow[] = canViewServiceReports(level)
    ? (await listServiceReportsForRepairCase(resolved.id)).map((item) => ({
        id: item.id,
        href: `${serviceReportHref}?id=${item.id}`,
        kindLabel: KIND_LABELS[item.kind],
        reportNumber: item.reportNumber,
        issuedOn: item.issuedOn,
        // 시각을 못 읽으면 지어내지 않고 뺀다 — 목록의 다른 값은 그대로 쓸모가 있다.
        updatedAtLabel: formatServiceReportKstDateTime(new Date(item.updatedAt)),
      }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      {/* 한 장도 없으면 갈림길만 보인다 — 빈 상자를 억지로 그리지 않는다. */}
      {rows.length > 0 && <ServiceReportList rows={rows} />}

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
