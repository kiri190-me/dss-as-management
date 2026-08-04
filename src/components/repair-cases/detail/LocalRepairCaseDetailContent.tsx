"use client";

import { Suspense } from "react";
import LoadingNotice from "@/components/domain/LoadingNotice";
import RepairCaseDetailView from "@/components/repair-cases/detail/RepairCaseDetailView";
import RepairCaseNotFound from "@/components/repair-cases/detail/RepairCaseNotFound";
import RegisteredSuccessNotice from "@/components/repair-cases/detail/RegisteredSuccessNotice";
import { useLocalRepairCases } from "@/lib/domain/local/use-local-repair-cases";
import { resolveAllRepairCases, resolveRepairCaseById } from "@/lib/domain/local/resolved-repair-case";
import { findProductHistoryMatches } from "@/lib/domain/local/product-history-match";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";

export default function LocalRepairCaseDetailContent({
  id,
  actingUser,
}: {
  id: string;
  actingUser: ActingUser | null;
}) {
  const { cases: localCases, isHydrated } = useLocalRepairCases();

  if (!isHydrated) {
    return <LoadingNotice />;
  }

  const resolved = resolveRepairCaseById(id, localCases);
  if (!resolved) {
    return <RepairCaseNotFound />;
  }

  const all = resolveAllRepairCases(localCases);
  const related = findProductHistoryMatches(all, resolved);

  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={null}>
        <RegisteredSuccessNotice id={id} intakeNumber={resolved.intakeNumber} />
      </Suspense>
      <RepairCaseDetailView resolved={resolved} related={related} actingUser={actingUser} />
    </div>
  );
}
