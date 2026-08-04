"use client";

import LoadingNotice from "@/components/domain/LoadingNotice";
import RepairCaseNotFound from "@/components/repair-cases/detail/RepairCaseNotFound";
import { resolveRepairCaseById } from "@/lib/domain/local/resolved-repair-case";
import { useLocalRepairCases } from "@/lib/domain/local/use-local-repair-cases";
import ActivityTimelineScreen from "./ActivityTimelineScreen";

export default function LocalActivityContent({ id }: { id: string }) {
  const { cases: localCases, isHydrated } = useLocalRepairCases();

  if (!isHydrated) {
    return <LoadingNotice />;
  }

  const resolved = resolveRepairCaseById(id, localCases);
  if (!resolved) {
    return <RepairCaseNotFound />;
  }

  return <ActivityTimelineScreen resolved={resolved} />;
}
