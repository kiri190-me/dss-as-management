import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { listMyWorkRecords } from "@/lib/db/queries/my-work-records";
import MineTabs from "@/components/repair-cases/mine/MineTabs";
import MyWorkRecordsScreen from "@/components/repair-cases/mine/MyWorkRecordsScreen";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { toKstYearMonth } from "@/lib/domain/date-only";

export const metadata: Metadata = {
  title: "내 작업기록 | DSS A/S 관리 시스템",
};

// DB-backed rows must never be statically cached — always re-query at
// request time, same convention as /repair-cases and /repair-cases/mine.
export const dynamic = "force-dynamic";

/**
 * 「내 작업기록」 — 「내 담당 제품」 메뉴의 두 번째 탭. 관문은 옆 화면
 * (repair-cases/mine/page.tsx)과 **글자 그대로 같다**: 같은 영역 열쇠
 * (`myActiveWork`), 같은 권한(READ), 같은 mock-모드 처리. 탭으로 나란히 붙는
 * 두 화면의 관문이 서로 다르면, 한쪽은 막히고 한쪽은 열리는 상태가 조용히
 * 생긴다.
 *
 * 🔴 볼 수 있는 역할은 **AS_ENGINEER 하나뿐**이다
 * (auth/my-active-work-authorization.ts — ADMIN/SUPER_ADMIN 은 의도적으로
 * 제외돼 있고, 그 까닭이 그 파일에 적혀 있다). 이 화면은 그 정책을 **바꾸지
 * 않는다**.
 *
 * 🔴 조회에 넘기는 것은 세션에서 서버가 푼 `actingUser.id` 하나다 — 주소나
 * 검색어에서 온 식별자를 넘길 길이 없다(queries/my-work-records.ts 머리말).
 */
export default async function MyWorkRecordsPage() {
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("myActiveWork");

  const readSourceIsDatabase = getRepairCaseReadSource() === "database";
  if (!readSourceIsDatabase) {
    return (
      <PlaceholderPage
        title="내 작업기록"
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
        title="내 작업기록"
        description="이 화면에 접근할 권한이 없습니다."
      />
    );
  }

  const rows = await listMyWorkRecords(actingUser.id);

  return (
    <div className="flex flex-col gap-4">
      <MineTabs />
      {/* 「이번 달」은 서버가 한국시간으로 재서 넘긴다 — 화면이 제 시계로 재면
          브라우저와 서버가 서로 다른 달을 펼친다(MyWorkRecordsScreen 주석). */}
      <MyWorkRecordsScreen rows={rows} currentYearMonth={toKstYearMonth(new Date())} />
    </div>
  );
}
