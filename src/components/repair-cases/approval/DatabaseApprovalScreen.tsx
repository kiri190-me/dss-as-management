import DatabaseRepairInspectionCard from "./DatabaseRepairInspectionCard";
import DatabaseFinalShipmentCard from "./DatabaseFinalShipmentCard";
import DatabaseApprovalEventTimeline from "./DatabaseApprovalEventTimeline";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { ApprovalRecordRow, CurrentApprovalState } from "@/lib/db/queries/repair-case-approvals";
import type { ApprovalAssigneeOption } from "./ApprovalActionDialog";
import type { ShipmentDecideAuthorization } from "@/lib/db/queries/shipment-delegations";
import type { ShipmentApprovalRouteStepList } from "@/lib/db/queries/shipment-approval-routes";
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
  routeSteps,
}: {
  resolved: ResolvedRepairCase;
  actingUser: ActingUser | null;
  currentApprovals: CurrentApprovalState[];
  history: ApprovalRecordRow[];
  decideAuthorization: ShipmentDecideAuthorization;
  /** 검수 승인 요청 창의 「누구에게 보낼까요」 후보 — 서버에서 계산해 온다. */
  inspectionAssigneeCandidates: ApprovalAssigneeOption[];
  /**
   * 이 화면이 그릴 줄들이 가리키는 **결재선 판들**과 그 단계들. 서버(page.tsx)가
   * 지금 요청 행과 이력의 모든 행에서 판 id 를 모아 한 번에 읽어 내려보낸다 —
   * 클라이언트가 DB 를 읽게 두지 않는 것은 decideAuthorization 과 같은 이유다.
   *
   * 🔴 이력에는 **서로 다른 판**을 탄 줄이 섞여 있다(관리자가 절차를 바꾸면 새
   * 판이 얹히고, 그때 진행 중이던 건은 옛 판을 끝까지 따라간다). 그래서 판 하나가
   * 아니라 목록이고, 줄마다 **자기 판**을 골라 쓴다.
   */
  routeSteps: ShipmentApprovalRouteStepList[];
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
  // 출하 카드는 **자기 줄의 판** 하나만 그린다. 못 찾으면 null 이고, 그때 카드는
  // 진행 미리보기를 아예 그리지 않는다(결재선을 타지 않는 요청과 같다).
  const shipmentRouteSteps =
    routeSteps.find((route) => route.routeId === shipmentState?.routeId)?.steps ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/* 🔴 머리말 상자를 여기서 그리지 않는다 (2026-10-06 사용자 지시) — 탭 위의
          머리 카드(DetailHeader)가 인수번호 · 현재 상태 · 담당 엔지니어 · DB 배지를
          이미 한 줄로 보여 주고 있어 같은 정보가 두 상자에 나왔다.

          🔴 **안내문은 중복이 아니라서 남긴다.** 머리 카드가 하지 않는 말이고, 이
          화면에서만 뜻이 있다. 상자가 사라졌으니 두 승인 카드 바로 위로 올려, 카드를
          누르기 전에 읽히게 둔다. */}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        이 승인 기록은 데이터베이스에 저장되며, 서버에서 권한과 요청 상태를 재검증합니다.
      </p>

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
          routeSteps={shipmentRouteSteps}
          // 이미 이 화면에 와 있는 값이다 — 서버도 조회도 새로 부르지 않는다.
          // 카드는 이것을 확인 창에 읽기 전용으로 넘기기만 한다.
          internalTargetShipmentDate={resolved.internalTargetShipmentDate}
        />
      </div>

      <DatabaseApprovalEventTimeline records={history} routeSteps={routeSteps} />
    </div>
  );
}
