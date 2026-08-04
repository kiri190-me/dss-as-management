import { resolveDisplayApprovalRecord } from "@/lib/domain/local/workflow/approval-lookup";
import { workflowEventTypeLabels, type LocalWorkflowEvent } from "@/lib/domain/local/workflow/workflow-types";
import { approvalTypeLabels, type LocalApprovalRecord } from "@/lib/domain/local/approval/approval-types";
import { formatAttachmentDateTime } from "@/lib/domain/local/attachments/format";

function requiredApprovalTypeForEvent(event: LocalWorkflowEvent): "REPAIR_INSPECTION" | "FINAL_SHIPMENT" | null {
  if (event.eventType === "SHIPMENT_COMPLETED") return "FINAL_SHIPMENT";
  if (event.eventType === "STEP_ADVANCED" && event.toStatus === "WAITING_SHIPMENT_APPROVAL") {
    return "REPAIR_INSPECTION";
  }
  return null;
}

export default function WorkflowEventTimeline({
  events,
  approvalRecords,
}: {
  events: LocalWorkflowEvent[];
  approvalRecords: readonly LocalApprovalRecord[];
}) {
  const sorted = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">워크플로 이력</h2>

      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">아직 워크플로 관련 이력이 없습니다.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {sorted.map((event) => {
            const requiredApprovalType = requiredApprovalTypeForEvent(event);
            const relatedRecord = requiredApprovalType
              ? resolveDisplayApprovalRecord(
                  event.relatedApprovalRecordId,
                  event.repairCaseId,
                  requiredApprovalType,
                  approvalRecords
                )
              : null;

            return (
              <li key={event.id} className="rounded-md border border-zinc-100 p-3 text-sm dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {workflowEventTypeLabels[event.eventType]}
                  </span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    {formatAttachmentDateTime(event.occurredAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">처리자: {event.actorNameSnapshot}</p>
                {event.fromWorkflowStepKey !== event.toWorkflowStepKey && (
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {event.fromWorkflowStepKey} → {event.toWorkflowStepKey}
                  </p>
                )}
                {event.reason && (
                  <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">&ldquo;{event.reason}&rdquo;</p>
                )}
                {requiredApprovalType && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {relatedRecord
                      ? `관련 승인: ${approvalTypeLabels[relatedRecord.approvalType]}`
                      : "관련 승인 기록을 확인할 수 없습니다."}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
