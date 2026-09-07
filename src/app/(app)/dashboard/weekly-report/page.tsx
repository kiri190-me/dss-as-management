import type { Metadata } from "next";
import WeeklyReportScreen from "@/components/dashboard/WeeklyReportScreen";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isFieldEditable } from "@/lib/auth/repair-case-edit-authorization";
import { getAuthSource } from "@/lib/config/auth-source";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { listRepairCaseLinkOptions } from "@/lib/db/queries/domestic-orders";
import { listWeeklyReportCases } from "@/lib/db/queries/weekly-report";
import { listWeeklyReportDeliveries } from "@/lib/db/queries/weekly-report-deliveries";
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
 * ── 어느 주를 보는가는 주소가 정한다. 그 한 값이 두 구역을 함께 움직인다 ──
 * `?week=2026-08-24` 다. 클라이언트 상태가 아니라 주소인 이유: 그 주의 목표와
 * 납입 예정 줄을 조회하는 것은 **서버**라서, 화면이 혼자 주를 바꾸면 표시만
 * 바뀌고 자료는 그대로 남는다. 주 이동 링크가 금주 목표 상자에만 있는 것도
 * 그래서다 — 고르개가 둘이면 두 구역이 다른 주를 가리킬 수 있다. 값이 없거나 날짜가 아니면 이번 주로 떨어뜨리고, 날짜이긴 한데
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
    (await hasPermission(actingUser, "weeklyReport", "WRITE"));

  // 상세표의 `비고` 는 위 두 구역과 **다른 권한**으로 열린다. 그 값은 주간보고가
  // 가진 자료가 아니라 **수리 건의 컬럼**(repair_cases.notes)이고, 저장도 수리 건
  // 상세와 같은 서버 액션으로 나간다. 그래서 판정도 수리 건 상세가 쓰는 그 식을
  // 그대로 베낀다(RepairCaseDetailView 의 canEditReportNumber) — 여기에 주간보고
  // 전용 권한 함수를 새로 만들면 같은 컬럼에 관문이 둘 생긴다.
  //
  // 'DB 읽기/쓰기 모드인가'는 이 함수 맨 위의 조기 반환이 이미 답했다
  // (getRepairCaseReadSource() !== "database" 이면 여기까지 오지 않는다).
  //
  // canEditGoals 와 마찬가지로 **화면을 그리기 위한 값일 뿐 관문이 아니다** —
  // 실제 저장은 server/actions/update-repair-case.ts 가 세션·역할·필드를 처음부터
  // 다시 확인한다.
  const canEditNotes = actingUser !== null && isFieldEditable(actingUser.role, "notes");

  const [cases, goalRows, deliveryRows, repairCaseOptions] = await Promise.all([
    listWeeklyReportCases(),
    listWeeklyReportGoals(weekStart),
    // 납입 예정 건도 **같은 weekStart** 를 본다 — 두 구역이 한 주 고르개를
    // 공유하기 때문이다(승인된 결정, domain/weekly-report-delivery.ts 헤더).
    // 여기서 주를 따로 정하면 위 상자와 아래 표가 다른 주를 가리킬 수 있다.
    listWeeklyReportDeliveries(weekStart),
    // 적을 수 없는 사람에게는 고르개 목록을 **아예 읽지 않는다** — 쓰지 않을
    // 값을 클라이언트로 내려보내지 않는다(내자 정리 page.tsx 와 같은 규칙).
    // 두 구역이 **이 한 벌을 나눠 쓴다** — 같은 목록을 두 번 읽지 않는다.
    canEditGoals ? listRepairCaseLinkOptions() : Promise.resolve([]),
  ]);

  // 이 화면이 말하는 "지금"은 **한 순간**이다. 아래 두 곳이 그것을 나눠 쓴다:
  // 머리말의 갱신 일, 그리고 상세표에서 `견적서 발행일` 을 빨갛게 만드는 장기
  // PO 미발행 판정(견적일 + 2개월 ≤ 오늘). 따로 new Date() 를 부르면 자정을
  // 걸친 요청에서 머리말의 날짜와 빨간 줄의 근거가 하루 어긋난다.
  const now = new Date();

  // 판정에 쓰는 "오늘"은 **여기서 정해 넘긴다.** 도메인 안에서 만들면 (1) 서버가
  // 그린 화면과 어긋나고, (2) 시험이 실제 오늘 날짜에 따라 달라진다
  // (domain/weekly-report.ts 헤더). 한국 날짜로 접는 일은 도메인이 한다.
  const report = buildWeeklyReport(cases, now);

  // 머리말의 "갱신 일". 클라이언트에서 new Date() 를 부르면 서버가 그린 것과
  // 달라져 hydration 이 어긋나므로 여기서 정해 내려보낸다. 표준시를 못 박는
  // 것도 같은 이유다 — 서버가 어디서 돌든 같은 날짜가 나와야 한다
  // (내자 정리 page.tsx 의 asOfDate 와 같은 방식).
  const asOfDate = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return (
    <WeeklyReportScreen
      report={report}
      asOfDate={asOfDate}
      canEditNotes={canEditNotes}
      goals={{
        weekStart,
        currentWeekStart,
        rows: goalRows,
        canEdit: canEditGoals,
        repairCaseOptions,
      }}
      // 주·권한·고르개 목록은 goals 가 실어 간 것을 그대로 나눠 쓴다 — 두 구역이
      // 한 주를 함께 보고 한 권한으로 열린다(WeeklyReportScreen 의 deliveries 주석).
      deliveries={deliveryRows}
    />
  );
}
