import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import CustomerDetailScreen from "@/components/customers/CustomerDetailScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { resolveCustomerCapabilities } from "@/lib/auth/customer-capabilities";
import { getCustomerDetailById, listEndUserContactsByCustomerId, listEndUsersByCustomerId } from "@/lib/db/queries/customers";
import { listProductModelsForCustomer } from "@/lib/db/queries/product-model-customers";
import { listRepairCasesByCustomerId } from "@/lib/db/queries/repair-cases";

export const metadata: Metadata = {
  title: "고객사 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Customer Management detail (고객사 정보 + 관련 End-User 목록 + 연결된 제품
 * 모델 + A/S 이력).
 * canViewCustomers gates the whole page; every End-User/contact capability
 * flag below (canCreateEndUser/canRenameEndUser/canAddEndUserContact/
 * canEditEndUserContact/canRemoveEndUserContact) is a server-derived UX
 * hint only, same as canEditCustomers — each is re-verified independently
 * by its own Server Action in end-users.ts regardless of what this page
 * decided to render.
 */
export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="고객사 상세"
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
    return <PlaceholderPage title="고객사 상세" description="이 화면에 접근할 권한이 없습니다." />;
  }

  const customer = await getCustomerDetailById(id);
  if (!customer) {
    notFound();
  }

  const [endUsers, endUserContacts, productModels, repairCases] = await Promise.all([
    listEndUsersByCustomerId(customer.id),
    listEndUserContactsByCustomerId(customer.id),
    // 🔴 이 목록으로 /product-models/{id} 링크를 걸지만 권한 판정을 하나 더 두지
    // 않는다. canViewCustomers 와 canViewProductModels 가 **같은 역할 집합**
    // (SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES, INVENTORY_MANAGER 는 둘 다 못 본다)
    // 이라, 위 customers.view 문을 통과한 사람은 반드시 모델 상세도 볼 수 있다.
    // product-model-authorization.ts 가 그 사실을 "same role set as
    // canViewCustomers" 라고 명시한다. 🔴 언젠가 어느 한쪽 역할 집합이 바뀌면 이
    // 가정이 깨지고 링크가 막다른 길이 된다 — 그때 여기를 고쳐야 한다.
    listProductModelsForCustomer(customer.id),
    listRepairCasesByCustomerId(customer.id),
  ]);

  const capabilities = await resolveCustomerCapabilities(actingUser);

  return (
    <CustomerDetailScreen
      customer={customer}
      endUsers={endUsers}
      endUserContacts={endUserContacts}
      productModels={productModels}
      repairCases={repairCases}
      canEdit={capabilities.edit}
      canCreateEndUser={capabilities.createEndUser}
      canRenameEndUser={capabilities.renameEndUser}
      canAddEndUserContact={capabilities.editContact}
      canEditEndUserContact={capabilities.editContact}
      canRemoveEndUserContact={capabilities.removeContact}
    />
  );
}
