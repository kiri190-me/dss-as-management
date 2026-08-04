import { StatusBadge } from "@/components/repair-cases/badges";
import { resolveActorDisplay, resolveStepLabel } from "@/lib/domain/local/activity/adapters";
import type { UnifiedActivityEvent } from "@/lib/domain/local/activity/activity-types";
import { formatActivityDateTime } from "@/lib/domain/local/activity/format";
import { approvalStatusLabels, approvalTypeLabels } from "@/lib/domain/local/approval/approval-types";
import { attachmentCategoryLabels } from "@/lib/domain/local/attachments/attachment-types";
import { ActivityCategoryBadge, ActivityEventSourceBadge, ActivitySourceTypeBadge } from "./activity-badges";

function DetailField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

/**
 * 모든 소스(WORK_HISTORY/WORKFLOW/APPROVAL/ATTACHMENT/CASE_CREATED)를 이
 * 컴포넌트 하나가 렌더링한다 — UnifiedActivityEvent 필드만 읽으며, 어떤
 * 소스별 원본 타입도 알지 못한다. EffectiveRepairCase는 절대 받지 않는다
 * (이 항목들은 전부 과거 시점 값이며 현재 유효 상태로 대체하지 않는다).
 */
export default function ActivityTimelineItem({ event }: { event: UnifiedActivityEvent }) {
  const actorLabel = resolveActorDisplay(event.actorUserId, event.actorNameSnapshot);
  const previousStepLabel = resolveStepLabel(event.workflowType, event.previousWorkflowStepKey);
  const nextStepLabel = resolveStepLabel(event.workflowType, event.nextWorkflowStepKey);

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium break-words text-zinc-900 dark:text-zinc-50">{event.title}</span>
        <time dateTime={event.occurredAt} className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
          {formatActivityDateTime(event.occurredAt)}
        </time>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <ActivitySourceTypeBadge sourceType={event.sourceType} />
        <ActivityCategoryBadge category={event.category} />
        <ActivityEventSourceBadge source={event.source} />
      </div>

      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">처리자: {actorLabel}</p>

      {event.description && (
        <p className="mt-2 text-sm break-words text-zinc-900 dark:text-zinc-50">{event.description}</p>
      )}

      {event.previousStatus && event.nextStatus && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={event.previousStatus} />
          <span className="text-zinc-500 dark:text-zinc-400">→</span>
          <StatusBadge status={event.nextStatus} />
        </div>
      )}

      {previousStepLabel && nextStepLabel && (
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
          단계: {previousStepLabel} <span className="text-zinc-500 dark:text-zinc-400">→</span> {nextStepLabel}
        </p>
      )}

      {event.relatedApprovalType && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          관련 승인: {approvalTypeLabels[event.relatedApprovalType]}
          {event.relatedApprovalDecision ? ` · ${approvalStatusLabels[event.relatedApprovalDecision]}` : ""}
        </p>
      )}

      {event.relatedAttachmentId && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          대상 파일: {event.relatedAttachmentName}
          {event.relatedAttachmentCategory ? ` (${attachmentCategoryLabels[event.relatedAttachmentCategory]})` : ""}
        </p>
      )}

      {event.workDetails && (
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          <DetailField label="증상" value={event.workDetails.symptom} />
          <DetailField label="추정 원인" value={event.workDetails.suspectedCause} />
          <DetailField label="조치 내용" value={event.workDetails.actionTaken} />
          <DetailField label="사용 부품" value={event.workDetails.partsUsed} />
          <DetailField label="다음 조치" value={event.workDetails.nextAction} />
        </dl>
      )}
    </li>
  );
}
