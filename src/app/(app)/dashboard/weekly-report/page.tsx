import type { Metadata } from "next";
import WeeklyReportScreen from "@/components/dashboard/WeeklyReportScreen";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { listWeeklyReportCases } from "@/lib/db/queries/weekly-report";
import { buildWeeklyReport } from "@/lib/domain/weekly-report";

export const metadata: Metadata = {
  title: "주간보고 | DSS A/S 관리 시스템",
};

// 매 요청 시점의 진행 상황을 세는 화면이라 정적 캐시 대상이 아니다 —
// 대시보드(/dashboard)와 같은 이유, 같은 정책이다.
export const dynamic = "force-dynamic";

/**
 * 주간보고 — 대시보드의 하위메뉴(navigation.ts 의 parentKey). **조회 전용이다.**
 *
 * 매주 손으로 만들던 엑셀 현황판을 그대로 옮긴 화면이고, 고객사 × 종류(RFG/MB)
 * 블록마다 상태 집계 8칸과 상세표를 그린다. 무엇을 어느 칸에 넣을지는 전부
 * domain/weekly-report.ts 가 정한다 — 이 파일은 읽어서 넘기기만 한다.
 */
export default async function WeeklyReportPage() {
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("weeklyReport");

  // Mock 모드에는 이 화면이 읽을 자료가 없다. 빈 표를 그려 "진행 중인 건이
  // 없습니다"라고 말하면 자료가 없다는 뜻으로 읽히므로, 내자 정리 화면과 같이
  // 왜 못 쓰는지를 그대로 적는다.
  if (getRepairCaseReadSource() !== "database") {
    return (
      <PlaceholderPage
        title="주간보고"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const report = buildWeeklyReport(await listWeeklyReportCases());

  // 머리말의 "갱신 일". 클라이언트에서 new Date() 를 부르면 서버가 그린 것과
  // 달라져 hydration 이 어긋나므로 여기서 정해 내려보낸다. 표준시를 못 박는
  // 것도 같은 이유다 — 서버가 어디서 돌든 같은 날짜가 나와야 한다
  // (내자 정리 page.tsx 의 asOfDate 와 같은 방식).
  const asOfDate = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return <WeeklyReportScreen report={report} asOfDate={asOfDate} />;
}
