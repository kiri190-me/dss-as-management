import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { listMyActiveRepairCases } from "@/lib/db/queries/repair-cases-mine";
import { listRepairCasesWithDueDateNear } from "@/lib/db/queries/repair-case-due-date-notifications";
import MyActiveWorkScreen from "@/components/repair-cases/mine/MyActiveWorkScreen";
import MineTabs from "@/components/repair-cases/mine/MineTabs";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";

export const metadata: Metadata = {
  title: "내 담당 제품 | DSS A/S 관리 시스템",
};

// DB-backed rows must never be statically cached — always re-query at
// request time, same convention as /repair-cases and /procedures.
export const dynamic = "force-dynamic";

/**
 * Phase 5C-3 — "내 담당 제품" / My Active Work. AS_ENGINEER-only, both here
 * (server-side, the real enforcement boundary) and in navigation.ts (the
 * nav-visibility UX convenience) — hiding the nav item alone is never
 * sufficient. This is a database-mode-only capability: it depends on a
 * real repair_cases.assigned_engineer_id matching a real session identity,
 * neither of which mock/local mode meaningfully provides, so mock mode
 * gets the same PlaceholderPage treatment /procedures already established
 * for this exact situation.
 */
export default async function MyActiveWorkPage() {
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("myActiveWork");

  const readSourceIsDatabase = getRepairCaseReadSource() === "database";
  if (!readSourceIsDatabase) {
    return (
      <PlaceholderPage
        title="내 담당 제품"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  if (!(await hasPermission(actingUser, "myActiveWork", "READ"))) {
    return (
      <PlaceholderPage
        title="내 담당 제품"
        description="이 화면에 접근할 권한이 없습니다."
      />
    );
  }

  const rows = await listMyActiveRepairCases(actingUser.id);

  /**
   * 「고객 요청 납기일」 글자를 굵은 붉은색으로 만들 건(2026-10-19 사용자 요구).
   * 배지는 달지 않는다 — 사용자가 배지를 말한 곳은 전체 A/S 현황과 상세 둘이다.
   *
   * 🔴 **종 알림이 쓰는 그 조회를 그대로 부른다.** 전체 A/S 현황은 행에 실린 칸으로
   * 직접 접지만(그쪽 page.tsx), 이 화면의 행에는 **실제 출하일 칸이 없어** 같은
   * 판정을 접을 수 없다 — 출하일이 찍혔는데 단계가 뒤처진 건을 가려낼 수가 없다.
   * 거기서 「대충 없는 셈 치고」 넘기면 종에는 없는 경보가 이 표에만 뜬다. 그래서
   * 짐작 대신 이미 다 가려 둔 묶음을 받아 온다. 이 조회는 머리말의 종이 어차피 이
   * 화면에서도 한 번 돌리는 것과 같은 것이고, 읽는 칸이 다섯뿐이다.
   */
  const dueDateNearCaseIds = (await listRepairCasesWithDueDateNear()).map(
    (row) => row.repairCaseId
  );

  // 탭 줄만 얹는다 — 이 화면이 보여 주는 것(조회·필터·정렬·표)은 한 글자도
  // 달라지지 않는다. 탭은 「내 작업기록」(/repair-cases/mine/work-records)과
  // 이 화면을 가른다(MineTabs).
  return (
    <div className="flex flex-col gap-4">
      <MineTabs />
      <MyActiveWorkScreen rows={rows} dueDateNearCaseIds={dueDateNearCaseIds} />
    </div>
  );
}
