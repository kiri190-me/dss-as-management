import ActivityTimelineItem from "@/components/repair-cases/work-history/ActivityTimelineItem";
import { reportSectionLabels } from "@/lib/domain/local/report/report-types";
import type { UnifiedActivityEvent } from "@/lib/domain/local/activity/activity-types";

const sectionBaseClass =
  "report-section rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";

/**
 * Stage F-1 전용. Stage E-2의 ActivityTimelineItem을 그대로 재사용한다 —
 * 이미 상호작용 요소가 없는 순수 표시 컴포넌트이므로 별도로 포크하지
 * 않는다. events는 호출부(ReportPreview)가 이미 정규화·중복 제거·날짜
 * 필터링·latest-20/50/all 제한·오래된 순 정렬까지 마친 배열이라고 가정한다
 * — 여기서 다시 정렬하거나 잘라내지 않는다. 스토어도 직접 읽지 않는다.
 */
export default function ReportTimelineSection({ events }: { events: readonly UnifiedActivityEvent[] }) {
  return (
    <section className={sectionBaseClass}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{reportSectionLabels.ACTIVITY_TIMELINE}</h2>

      {events.length === 0 ? (
        <p className="mt-3 rounded-lg border border-zinc-200 bg-white p-4 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          표시할 활동 이력이 없습니다.
        </p>
      ) : (
        // report-timeline-list: 이후 인쇄용 CSS가 `.report-timeline-list > li`에
        // break-inside 규칙을 걸 수 있는 훅이다. ActivityTimelineItem 자체가
        // <li>를 렌더링하므로 항목을 별도 래퍼로 다시 감싸지 않는다(ol > li
        // 구조를 깨지 않기 위함).
        <ol className="report-timeline-list mt-3 flex flex-col gap-3">
          {events.map((event) => (
            <ActivityTimelineItem key={event.id} event={event} />
          ))}
        </ol>
      )}
    </section>
  );
}
