import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { getPartRequestsForManager, getIssuableBalancesForParts } from "@/lib/db/queries/inventory-part-requests";
import PartRequestManagerScreen from "@/components/inventory/PartRequestManagerScreen";

export const metadata: Metadata = {
  title: "부품 요청 관리 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function InventoryPartRequestsPage() {
  const session = await readSession();
  if (!session) redirect("/login");

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  // Server-side gate — SALES and AS_ENGINEER never reach this screen
  // (AS_ENGINEER manages their own requests from the repair-case page
  // instead); this is not merely nav-hiding, since a hidden nav link is a
  // UX convenience only and every mutation this screen triggers re-checks
  // authorization independently regardless.
  if (!(await hasPermission(actingUser.role, "inventory.requestProcessing", "MANAGE"))) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        이 화면에 접근할 권한이 없습니다.
      </p>
    );
  }

  const requests = await getPartRequestsForManager();
  const allPartIds = [...new Set(requests.flatMap((r) => r.items.map((i) => i.partId)))];
  const balancesByPartId = await getIssuableBalancesForParts(allPartIds);

  return <PartRequestManagerScreen requests={requests} balancesByPartId={Object.fromEntries(balancesByPartId)} />;
}
