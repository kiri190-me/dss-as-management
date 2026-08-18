import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getPartList, getPartOwnerAvailability, groupPartOwnerAvailability, getDistinctCategories, getDistinctItemTypes } from "@/lib/db/queries/inventory";
import InventoryListScreen from "@/components/inventory/InventoryListScreen";

export const metadata: Metadata = {
  title: "재고 관리 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        현재 로그인한 사용자 정보를 확인할 수 없습니다.
      </p>
    );
  }

  const [parts, ownerAvailabilityRows, categories, itemTypes] = await Promise.all([
    getPartList(),
    getPartOwnerAvailability(),
    getDistinctCategories(),
    getDistinctItemTypes(),
  ]);
  const ownerAvailabilityByPartId = groupPartOwnerAvailability(ownerAvailabilityRows);

  return (
    <InventoryListScreen
      parts={parts}
      ownerAvailabilityByPartId={ownerAvailabilityByPartId}
      categories={categories}
      itemTypes={itemTypes}
      actingUserRole={actingUser.role}
    />
  );
}
