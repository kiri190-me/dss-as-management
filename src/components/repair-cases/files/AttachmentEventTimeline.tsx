import {
  attachmentEventTypeLabels,
  type LocalAttachmentEvent,
  type LocalAttachmentMetadata,
} from "@/lib/domain/local/attachments/attachment-types";
import { formatAttachmentDateTime } from "@/lib/domain/local/attachments/format";

type AttachmentEventTimelineProps = {
  events: LocalAttachmentEvent[];
  recordsById: ReadonlyMap<string, LocalAttachmentMetadata>;
};

/**
 * 접수 건 단위 첨부파일 이벤트를 최신순으로 보여준다(개별 첨부파일별 타임라인은
 * 이 스테이지에서 만들지 않는다 — 단일 화면 유지가 여러 파일의 이력을 각각
 * 관리하는 것보다 구현이 단순하고, 표시 이름을 각 행 맨 앞에 두면 여러 파일의
 * 이력이 섞여도 스캔하기 쉽다는 트레이드오프를 택했다).
 */
export default function AttachmentEventTimeline({ events, recordsById }: AttachmentEventTimelineProps) {
  const sorted = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">첨부파일 이력</h2>

      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">아직 첨부파일 관련 이력이 없습니다.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {sorted.map((event) => {
            const attachmentName = recordsById.get(event.attachmentId)?.displayName ?? "(알 수 없는 파일)";
            return (
              <li key={event.id} className="rounded-md border border-zinc-100 p-3 text-sm dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium break-all text-zinc-900 dark:text-zinc-50">
                    {attachmentName} · {attachmentEventTypeLabels[event.eventType]}
                  </span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    {formatAttachmentDateTime(event.occurredAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">처리자: {event.actorNameSnapshot}</p>
                {event.eventType === "RENAMED" && event.previousDisplayName && event.newDisplayName && (
                  <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                    &ldquo;{event.previousDisplayName}&rdquo; → &ldquo;{event.newDisplayName}&rdquo;
                  </p>
                )}
                {event.comment && event.eventType !== "RENAMED" && (
                  <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">&ldquo;{event.comment}&rdquo;</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
