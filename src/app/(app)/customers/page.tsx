import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import CustomerListScreen from "@/components/customers/CustomerListScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { listCustomersWithCounts, listDeletedCustomers } from "@/lib/db/queries/customers";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";

export const metadata: Metadata = {
  title: "고객사 관리 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Customer Management phase 1 — list/search. Same "database mode only" gate
 * as diagnosis-flowcharts/users pages: customers/end_users have no local/
 * mock CRUD layer, so this screen has no meaning outside database mode.
 * canViewCustomers is SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES — INVENTORY_MANAGER
 * gets the same PlaceholderPage "no permission" fallback a direct URL hit
 * from an unauthorized role gets everywhere else in this app.
 */
export default async function CustomersPage() {
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("customers");

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="고객사 관리"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  if (!session) {
    redirect("/login");
  }
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    redirect("/login");
  }

  if (!(await hasPermission(actingUser, "customers.view", "READ"))) {
    return <PlaceholderPage title="고객사 관리" description="이 화면에 접근할 권한이 없습니다." />;
  }

  // 삭제·복원 권한(기본값: 관리자 이상)이 있는 세션에만 휴지통을 읽는다.
  // 볼 수 없는 사람에게는 질의 자체가 일어나지 않는다 — 접수 건 휴지통이
  // serverTrashCases를 다루는 방식과 같다. 화면에서 감추는 것은 편의일 뿐
  // 경계가 아니므로, 삭제 서버 액션은 이 판정과 무관하게 다시 검사한다.
  const canDelete = await hasPermission(actingUser, "customers.lifecycle", "MANAGE");
  const [rows, trashRows] = await Promise.all([
    listCustomersWithCounts(),
    canDelete ? listDeletedCustomers() : Promise.resolve([]),
  ]);

  return <CustomerListScreen rows={rows} trashRows={trashRows} canDelete={canDelete} />;
}
