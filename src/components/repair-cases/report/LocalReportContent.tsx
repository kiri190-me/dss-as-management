"use client";

import LoadingNotice from "@/components/domain/LoadingNotice";
import RepairCaseNotFound from "@/components/repair-cases/detail/RepairCaseNotFound";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { resolveRepairCaseById } from "@/lib/domain/local/resolved-repair-case";
import { useLocalRepairCases } from "@/lib/domain/local/use-local-repair-cases";
import ReportScreen from "./ReportScreen";

/**
 * Stage F-1. work-history/approval/files의 LocalXContent와 완전히 동일한
 * 패턴을 따른다 — resolver 로직을 다시 만들지 않고 resolveRepairCaseById를
 * 그대로 재사용하며, localStorage에 직접 접근하지 않는다(useLocalRepairCases
 * 훅 하나를 통해서만 구독한다). setTimeout을 쓰지 않는다 — hydration 여부는
 * useLocalRepairCases가 이미 제공하는 isHydrated 플래그(마운트 이전 항상
 * false)로만 판단한다.
 *
 * 오래된(stale) local- id(로컬스토리지에서 이미 지워진 접수 건)는
 * resolveRepairCaseById가 null을 반환하며, 이때도 notFound()를 호출하지
 * 않고 기존 RepairCaseNotFound UI를 그대로 보여준다 — 다른 로컬 화면들과
 * 동일한 동작이다.
 */
export type LocalReportContentProps = {
  repairCaseId: string;
  generatedByUser: ActingUser | null;
};

export default function LocalReportContent({ repairCaseId, generatedByUser }: LocalReportContentProps) {
  const { cases: localCases, isHydrated } = useLocalRepairCases();

  if (!isHydrated) {
    return <LoadingNotice />;
  }

  const resolved = resolveRepairCaseById(repairCaseId, localCases);
  if (!resolved) {
    return <RepairCaseNotFound />;
  }

  return <ReportScreen resolved={resolved} generatedByUser={generatedByUser} />;
}
