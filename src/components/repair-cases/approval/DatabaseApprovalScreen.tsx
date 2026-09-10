import DatabaseApprovalHeaderSummary from "./DatabaseApprovalHeaderSummary";
import DatabaseRepairInspectionCard from "./DatabaseRepairInspectionCard";
import DatabaseFinalShipmentCard from "./DatabaseFinalShipmentCard";
import DatabaseApprovalEventTimeline from "./DatabaseApprovalEventTimeline";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { ApprovalRecordRow, CurrentApprovalState } from "@/lib/db/queries/repair-case-approvals";
import type { ApprovalAssigneeOption } from "./ApprovalActionDialog";
import type { ShipmentDecideAuthorization } from "@/lib/db/queries/shipment-delegations";
import { resolveApprovalState } from "@/lib/domain/local/workflow/shipment-approval-checklist";

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
  inspectionAssigneeCandidates,
  shipmentRouteTotalSteps,
}: {
  resolved: ResolvedRepairCase;
  actingUser: ActingUser | null;
  currentApprovals: CurrentApprovalState[];
  history: ApprovalRecordRow[];
  decideAuthorization: ShipmentDecideAuthorization;
  /** 검수 승인 요청 창의 「누구에게 보낼까요」 후보 — 서버에서 계산해 온다. */
  inspectionAssigneeCandidates: ApprovalAssigneeOption[];
  /**
   * 지금 최종 출하 승인 요청이 타고 있는 결재선 판의 전체 단계 수. 결재선을
   * 타지 않으면 null. 서버(page.tsx)가 **그 행에 적힌 판**으로 세어 내려보낸다
   * — 클라이언트가 DB 를 읽게 두지 않는 것은 decideAuthorization 과 같은 이유다.
   */
  shipmentRouteTotalSteps: number | null;
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
  // status만 보면 안 된다 — 승인 이후 version이 바뀌면(단계 진행 포함) 서버는
  // 그 승인을 없는 것으로 본다. 화면이 status만 보고 요청 버튼을 열면 눌러도
  // 서버가 거절한다.
  const inspectionApproved = resolveApprovalState(inspectionState, resolved.version) === "APPROVED";

  return (
    <div className="flex flex-col gap-4">
      <DatabaseApprovalHeaderSummary resolved={resolved} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DatabaseRepairInspectionCard
          repairCaseId={resolved.id}
          record={inspectionState}
          actingUser={actingUser}
          currentVersion={resolved.version}
          assigneeCandidates={inspectionAssigneeCandidates}
        />
        <DatabaseFinalShipmentCard
          repairCaseId={resolved.id}
          record={shipmentState}
          actingUser={actingUser}
          decideAuthorization={decideAuthorization}
          inspectionApproved={inspectionApproved}
          currentVersion={resolved.version}
          routeTotalSteps={shipmentRouteTotalSteps}
        />
      </div>

      <DatabaseApprovalEventTimeline records={history} />
    </div>
  );
}
