import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import {
  getPartDetail,
  getPartTransactionHistory,
  getDistinctCategories,
  getDistinctItemTypes,
  getReturnableUseTransactions,
} from "@/lib/db/queries/inventory";
import { listRepairCases } from "@/lib/db/queries/repair-cases";
import InventoryPartDetailScreen from "@/components/inventory/InventoryPartDetailScreen";
import { resolveInventoryCapabilities } from "@/lib/auth/inventory-capabilities";

export const metadata: Metadata = {
  title: "부품 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function InventoryPartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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

  const part = await getPartDetail(id);
  if (!part) {
    notFound();
  }

  const [history, categories, itemTypes, repairCases] = await Promise.all([
    getPartTransactionHistory(id),
    getDistinctCategories(),
    getDistinctItemTypes(),
    listRepairCases(),
  ]);
  // Not filtered by lock status here — ResolvedRepairCase doesn't expose
  // is_locked, and the mutation itself always re-checks it live and
  // unconditionally (plan §8) regardless of what this picker shows.
  // AS_ENGINEER only ever sees cases assigned to them here (plan §10) —
  // a UX narrowing only, the mutation re-checks assignment independently.
  const visibleRepairCases =
    actingUser.role === "AS_ENGINEER"
      ? repairCases.filter((c) => c.assignedEngineerId === actingUser.id)
      : repairCases;
  const repairCaseOptions = visibleRepairCases.map((c) => ({ id: c.id, intakeNumber: c.intakeNumber, assignedEngineerId: c.assignedEngineerId }));

  const returnableByBalanceId: Record<string, Awaited<ReturnType<typeof getReturnableUseTransactions>>> = {};
  await Promise.all(
    part.balances.map(async (balance) => {
      returnableByBalanceId[balance.id] = await getReturnableUseTransactions(balance.id);
    })
  );

  return (
    <InventoryPartDetailScreen
      capabilities={await resolveInventoryCapabilities(actingUser.role)}
      part={part}
      history={history}
      returnableByBalanceId={returnableByBalanceId}
      categorySuggestions={categories}
      itemTypeSuggestions={itemTypes}
      repairCaseOptions={repairCaseOptions}
      actingUser={{ id: actingUser.id, role: actingUser.role }}
    />
  );
}
