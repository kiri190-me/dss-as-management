import DatabaseApprovalHeaderSummary from "./DatabaseApprovalHeaderSummary";
import DatabaseRepairInspectionCard from "./DatabaseRepairInspectionCard";
import DatabaseFinalShipmentCard from "./DatabaseFinalShipmentCard";
import DatabaseApprovalEventTimeline from "./DatabaseApprovalEventTimeline";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { ApprovalRecordRow, CurrentApprovalState } from "@/lib/db/queries/repair-case-approvals";
import type { ShipmentDecideAuthorization } from "@/lib/db/queries/shipment-delegations";

/**
 * Database-mode counterpart to ApprovalScreen.tsx (local-demo). Rendered by
 * repair-cases/[id]/approval/page.tsx instead of ApprovalScreen when
 * resolved.source === "DATABASE" — mirrors how RepairCaseDetailView.tsx
 * already branches DatabaseWorkflowControlPanel vs WorkflowControlPanel.
 */
export default function DatabaseApprovalScreen({
  resolved,
  actingUser,
  currentApprovals,
  history,
  decideAuthorization,
}: {
  resolved: ResolvedRepairCase;
  actingUser: ActingUser | null;
  currentApprovals: CurrentApprovalState[];
  history: ApprovalRecordRow[];
  decideAuthorization: ShipmentDecideAuthorization;
}) {
  if (!actingUser) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        현재 로그인한 사용자 정보를 확인할 수 없습니다.
      </p>
    );
  }

  const inspectionState = currentApprovals.find((a) => a.approvalType === "REPAIR_INSPECTION")?.latest ?? null;
  const shipmentState = currentApprovals.find((a) => a.approvalType === "FINAL_SHIPMENT")?.latest ?? null;
  const inspectionApproved = inspectionState?.status === "APPROVED";

  return (
    <div className="flex flex-col gap-4">
      <DatabaseApprovalHeaderSummary resolved={resolved} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DatabaseRepairInspectionCard repairCaseId={resolved.id} record={inspectionState} actingUser={actingUser} />
        <DatabaseFinalShipmentCard
          repairCaseId={resolved.id}
          record={shipmentState}
          actingUser={actingUser}
          decideAuthorization={decideAuthorization}
          inspectionApproved={inspectionApproved}
        />
      </div>

      <DatabaseApprovalEventTimeline records={history} />
    </div>
  );
}
