import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import CustomerListScreen from "@/components/customers/CustomerListScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { canViewCustomers } from "@/lib/auth/customer-authorization";
import { listCustomersWithCounts } from "@/lib/db/queries/customers";

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

  if (!canViewCustomers(actingUser.role)) {
    return <PlaceholderPage title="고객사 관리" description="이 화면에 접근할 권한이 없습니다." />;
  }

  const rows = await listCustomersWithCounts();

  return <CustomerListScreen rows={rows} />;
}
