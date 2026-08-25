import type { Metadata } from "next";
import WeeklyReportScreen from "@/components/dashboard/WeeklyReportScreen";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { canEditWeeklyReportGoals } from "@/lib/auth/weekly-report-authorization";
import { getAuthSource } from "@/lib/config/auth-source";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { listRepairCaseLinkOptions } from "@/lib/db/queries/domestic-orders";
import { listWeeklyReportCases } from "@/lib/db/queries/weekly-report";
import { listWeeklyReportGoals } from "@/lib/db/queries/weekly-report-goals";
import { buildWeeklyReport } from "@/lib/domain/weekly-report";
import { weekStartOfKst } from "@/lib/domain/weekly-report-goal";
import { normalizeWeekStart } from "@/lib/validation/weekly-report-goal-input";

export const metadata: Metadata = {
  title: "주간보고 | DSS A/S 관리 시스템",
};

// 매 요청 시점의 진행 상황을 세는 화면이라 정적 캐시 대상이 아니다 —
// 대시보드(/dashboard)와 같은 이유, 같은 정책이다.
export const dynamic = "force-dynamic";

/**
 * 주간보고 — 대시보드의 하위메뉴(navigation.ts 의 parentKey).
 *
 * 매주 손으로 만들던 엑셀 현황판을 그대로 옮긴 화면이고, 고객사 × 종류(RFG/MB)
 * 블록마다 상태 집계 8칸과 상세표를 그린다. 무엇을 어느 칸에 넣을지는 전부
 * domain/weekly-report.ts 가 정한다 — 이 파일은 읽어서 넘기기만 한다.
 *
 * ── 어느 주를 보는가는 주소가 정한다 ────────────────────────────────────
 * `?week=2026-08-24` 다. 클라이언트 상태가 아니라 주소인 이유: 그 주의 목표를
 * 조회하는 것은 **서버**라서, 화면이 혼자 주를 바꾸면 표시만 바뀌고 자료는
 * 그대로 남는다. 값이 없거나 날짜가 아니면 이번 주로 떨어뜨리고, 날짜이긴 한데
 * 월요일이 아니면 그 주 월요일로 접는다 — 접는 규칙은 여기 적지 않고 저장 쪽과
 * **같은 함수**를 부른다(validation 의 normalizeWeekStart). 저장과 조회가 서로
 * 다른 규칙으로 주를 정하면 방금 적은 줄이 보이지 않는 화면이 만들어진다.
 *
 * 집계(고객사 블록·총합)는 `?week=` 과 무관하게 **언제나 지금의 진행 상황**이다.
 * 그 사실을 사람에게 말해 주는 일은 상자가 한다(WeeklyReportGoalsPanel).
 */
export default async function WeeklyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string | string[] }>;
}) {
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

  // 같은 이름이 두 번 올 수 있는 자리라(?week=a&week=b) 배열이 올 수 있다.
  // 그때는 고르지 않고 통째로 버린다 — 어느 쪽을 고르든 근거가 없고,
  // normalizeWeekStart 가 이번 주로 떨어뜨려 준다.
  const { week } = await searchParams;
  const currentWeekStart = weekStartOfKst();
  const weekStart = (typeof week === "string" ? normalizeWeekStart(week) : null) ?? currentWeekStart;

  // 역할 정책과 관리자 설정을 둘 다 본다 — 서버 액션이 쓰는 것과 같은 두 관문
  // 이라 화면과 저장 가부가 어긋나지 않는다. 인증이 DB 모드가 아니면 액션이
  // 첫 줄에서 거절하므로 여기서도 못 고치는 것으로 취급한다. 세션이 없으면 위
  // 가드가 이미 로그인으로 보냈다.
  //
  // canEdit 은 **화면을 그리기 위한 값일 뿐 관문이 아니다.** 실제 저장은
  // server/actions/weekly-report-goals.ts 가 세션부터 다시 확인한다.
  const session = getAuthSource() === "database" ? await readSession() : null;
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  const canEditGoals =
    actingUser !== null &&
    canEditWeeklyReportGoals(actingUser.role) &&
    (await hasPermission(actingUser.role, "weeklyReport", "WRITE"));

  const [cases, goalRows, repairCaseOptions] = await Promise.all([
    listWeeklyReportCases(),
    listWeeklyReportGoals(weekStart),
    // 적을 수 없는 사람에게는 고르개 목록을 **아예 읽지 않는다** — 쓰지 않을
    // 값을 클라이언트로 내려보내지 않는다(내자 정리 page.tsx 와 같은 규칙).
    canEditGoals ? listRepairCaseLinkOptions() : Promise.resolve([]),
  ]);

  const report = buildWeeklyReport(cases);

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

  return (
    <WeeklyReportScreen
      report={report}
      asOfDate={asOfDate}
      goals={{
        weekStart,
        currentWeekStart,
        rows: goalRows,
        canEdit: canEditGoals,
        repairCaseOptions,
      }}
    />
  );
}
