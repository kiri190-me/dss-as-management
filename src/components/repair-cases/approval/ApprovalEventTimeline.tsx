import {
  approvalEventTypeLabels,
  approvalTypeLabels,
  type LocalApprovalEvent,
} from "@/lib/domain/local/approval/approval-types";

function formatEventTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 오래된 이벤트부터(ascending) 표시한다 — 감사 이력을 위에서 아래로 읽어
 * 내려가는 순서로 보여주기 위한 선택이다.
 */
export default function ApprovalEventTimeline({ events }: { events: LocalApprovalEvent[] }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">승인 이력</h2>

      {events.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">아직 승인 관련 이력이 없습니다.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="rounded-md border border-zinc-100 p-3 text-sm dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {approvalTypeLabels[event.approvalType]} · {approvalEventTypeLabels[event.eventType]}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatEventTimestamp(event.occurredAt)}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                처리자: {event.actorNameSnapshot}
                {event.delegationId && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                    위임 승인 처리
                  </span>
                )}
              </p>
              {event.comment && (
                <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">&ldquo;{event.comment}&rdquo;</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
