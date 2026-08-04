"use client";

import LoadingNotice from "@/components/domain/LoadingNotice";
import ApprovalHeaderSummary from "./ApprovalHeaderSummary";
import RepairInspectionCard from "./RepairInspectionCard";
import FinalShipmentCard from "./FinalShipmentCard";
import KyosanEvidenceCard from "./KyosanEvidenceCard";
import ApprovalEventTimeline from "./ApprovalEventTimeline";
import { useApprovalStore, useShipmentDelegations } from "@/lib/domain/local/approval/use-approval-data";
import { findRecordFor, isInspectionApprovedFor, type ActingUser } from "@/lib/domain/local/approval/transitions";
import { getKyosanEvidenceSnapshot } from "@/lib/domain/local/approval/kyosan-evidence";
import { useEffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";

/**
 * Stage E-1부터 검수/승인 탭 헤더도 워크플로 재정의 효과 상태를 반영해야
 * 하므로(원본 상태만 보여주고 방치하지 않는다) useEffectiveRepairCase로
 * 계산한 effective를 ApprovalHeaderSummary에 전달한다 — 승인 로직 자체는
 * 여전히 원본 resolved.id(=effective.id와 동일한 접수 건 id)만 사용한다.
 */
export default function ApprovalScreen({
  resolved,
  actingUser,
}: {
  resolved: ResolvedRepairCase;
  actingUser: ActingUser | null;
}) {
  const approvalStore = useApprovalStore();
  const delegationStore = useShipmentDelegations();
  const { effective, isHydrated: workflowHydrated } = useEffectiveRepairCase(resolved);

  if (!approvalStore.isHydrated || !delegationStore.isHydrated || !workflowHydrated || !effective) {
    return <LoadingNotice />;
  }

  if (!actingUser) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        현재 로그인한 데모 사용자 정보를 확인할 수 없습니다.
      </p>
    );
  }

  const caseRecords = approvalStore.records.filter((r) => r.repairCaseId === resolved.id);
  const caseEvents = approvalStore.events
    .filter((e) => e.repairCaseId === resolved.id)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const inspectionRecord = findRecordFor(caseRecords, resolved.id, "REPAIR_INSPECTION");
  const shipmentRecord = findRecordFor(caseRecords, resolved.id, "FINAL_SHIPMENT");
  const inspectionApproved = isInspectionApprovedFor(caseRecords, resolved.id);
  const evidence = getKyosanEvidenceSnapshot(resolved.id);

  return (
    <div className="flex flex-col gap-4">
      <ApprovalHeaderSummary resolved={effective} />

      {(approvalStore.isMalformed || delegationStore.isMalformed) && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          저장된 승인/위임 데이터를 확인할 수 없어 이번 세션에서는 빈 상태로 표시합니다.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RepairInspectionCard repairCaseId={resolved.id} record={inspectionRecord} actingUser={actingUser} />
        <FinalShipmentCard
          repairCaseId={resolved.id}
          record={shipmentRecord}
          actingUser={actingUser}
          inspectionApproved={inspectionApproved}
          delegations={delegationStore.delegations}
        />
      </div>

      <KyosanEvidenceCard evidence={evidence} />
      <ApprovalEventTimeline events={caseEvents} />
    </div>
  );
}
