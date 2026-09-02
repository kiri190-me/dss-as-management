import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ReportKindChoice from "@/components/repair-cases/report/ReportKindChoice";
import { readSession } from "@/lib/auth/session";
import { repairCaseDetailHrefs } from "@/lib/domain/repair-case-detail-tabs";
import { SERVICE_REPORT_TITLES } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * /repair-cases/{id}/report — 「보고서」 탭은 갈림길이다
 * ============================================================================
 * 검사냐 수리냐를 고르면 곧바로 작성 화면(`.../report/service-report`)으로
 * 넘어간다. 고른 종류는 주소에 실려 가고(`?kind=`), 작성 화면은 그것을
 * **시작값으로만** 쓴다 — 거기서 다시 바꿀 수 있다.
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

  return (
    <ReportKindChoice
      options={[
        {
          kind: "INSPECTION",
          title: screenTitle(SERVICE_REPORT_TITLES.INSPECTION),
          // 두 양식의 실제 차이는 이것 하나다 — 채우개 머리말에 실측이 적혀 있다.
          description: "확인내용과 조치를 적습니다. 「정리」 구역과 「조치 완료」 칸이 없습니다.",
          href: `${serviceReportHref}?kind=INSPECTION`,
        },
        {
          kind: "REPAIR",
          title: screenTitle(SERVICE_REPORT_TITLES.REPAIR),
          description: "검사 보고서에 「정리」 구역과 「조치 완료」 칸이 더해집니다.",
          href: `${serviceReportHref}?kind=REPAIR`,
        },
      ]}
    />
  );
}
