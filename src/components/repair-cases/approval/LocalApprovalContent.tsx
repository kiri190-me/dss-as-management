"use client";

import LoadingNotice from "@/components/domain/LoadingNotice";
import RepairCaseNotFound from "@/components/repair-cases/detail/RepairCaseNotFound";
import ApprovalScreen from "./ApprovalScreen";
import { useLocalRepairCases } from "@/lib/domain/local/use-local-repair-cases";
import { resolveRepairCaseById } from "@/lib/domain/local/resolved-repair-case";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";

export default function LocalApprovalContent({
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

  return <ApprovalScreen resolved={resolved} actingUser={actingUser} />;
}
