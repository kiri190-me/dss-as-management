import type { Metadata } from "next";
import { redirect } from "next/navigation";
import CustomerPortalScreen from "@/components/customer-portal/CustomerPortalScreen";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import {
  canEditCustomerStatus,
  canManageCustomerLinks,
  canViewCustomerPortal,
} from "@/lib/auth/customer-portal-authorization";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  listActiveLinks,
  listActiveStatusOptions,
  listPortalItemsForCustomer,
  type CustomerPortalItem,
} from "@/lib/db/queries/customer-portal";
import { listCustomerOptions } from "@/lib/db/queries/domestic-orders";

export const metadata: Metadata = {
  title: "고객 안내 현황 | DSS A/S 관리 시스템",
};

// 고객에게 나갈 값을 다루는 화면이라 캐시된 값을 보여주면 안 된다 —
// 방금 고친 상태가 화면에 안 보이면 담당자가 두 번 저장한다.
export const dynamic = "force-dynamic";

/**
 * 고객 안내 현황.
 *
 * 고객사가 전용 주소로 들어왔을 때 보게 될 목록을 담당자가 그대로 보고,
 * 거기서 상태와 비고를 정한다. **미리보기를 겸하는 것이 이 화면의 요점이다** —
 * 담당자가 딴 화면을 상상하며 값을 정하지 않게 된다.
 */
export default async function CustomerPortalPage() {
  // 역할별 접근 권한에서 이 메뉴가 꺼져 있으면 주소를 직접 입력해도 들어올 수
  // 없다 — 사이드바에서 감추는 것만으로는 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("customerPortal");

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="고객 안내 현황"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  if (!canViewCustomerPortal(actingUser.role)) {
    return (
      <PlaceholderPage
        title="고객 안내 현황"
        description="이 화면에 접근할 권한이 없습니다."
      />
    );
  }

  const [links, statusOptions, allCustomers] = await Promise.all([
    listActiveLinks(),
    listActiveStatusOptions(),
    listCustomerOptions(),
  ]);

  // 고객사마다 목록을 미리 읽어 둔다. 화면에서 고객사를 바꿀 때마다 서버를
  // 다시 부르지 않게 하려는 것인데, 지금 링크가 한 자릿수라 감당된다.
  // 링크가 수십 개로 늘면 고른 고객사만 읽도록 바꿔야 한다.
  const itemsByCustomer: Record<string, CustomerPortalItem[]> = {};
  for (const link of links) {
    itemsByCustomer[link.customerId] = await listPortalItemsForCustomer(
      link.customerId
    );
  }

  const linkedCustomerIds = new Set(links.map((l) => l.customerId));
  const customersWithoutLink = allCustomers.filter(
    (c) => !linkedCustomerIds.has(c.id)
  );

  return (
    <CustomerPortalScreen
      links={links}
      itemsByCustomer={itemsByCustomer}
      statusOptions={statusOptions}
      customersWithoutLink={customersWithoutLink}
      canManageLinks={canManageCustomerLinks(actingUser.role)}
      canEdit={canEditCustomerStatus(actingUser.role)}
    />
  );
}
