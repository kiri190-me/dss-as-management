"use client";

import { useMemo, useState } from "react";
import LoadingNotice from "@/components/domain/LoadingNotice";
import {
  activitySourceTypeLabels,
  type ActivitySourceType,
} from "@/lib/domain/local/activity/activity-types";
import {
  applyActivityFilters,
  buildActorOptions,
  DEFAULT_ACTIVITY_FILTERS,
  validateActivityDateRange,
  type ActivityFilters,
} from "@/lib/domain/local/activity/filters";
import { useUnifiedActivity } from "@/lib/domain/local/activity/normalize";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { useEffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import ActivityFilterPanel from "./ActivityFilterPanel";
import ActivityHeaderSummary from "./ActivityHeaderSummary";
import ActivityTimelineItem from "./ActivityTimelineItem";

const MALFORMED_SOURCE_MESSAGE: Partial<Record<ActivitySourceType, string>> = {
  WORKFLOW: "저장된 워크플로 이력 데이터를 확인할 수 없어 이번 세션에서는 워크플로 이력을 표시하지 않습니다.",
  APPROVAL: "저장된 승인 이력 데이터를 확인할 수 없어 이번 세션에서는 승인 이력을 표시하지 않습니다.",
  ATTACHMENT: "저장된 첨부파일 이력 데이터를 확인할 수 없어 이번 세션에서는 첨부파일 이력을 표시하지 않습니다.",
};

export default function ActivityTimelineScreen({ resolved }: { resolved: ResolvedRepairCase }) {
  const { effective, isHydrated: effectiveHydrated } = useEffectiveRepairCase(resolved);
  const { events, isHydrated: activityHydrated, malformedSources } = useUnifiedActivity(resolved);

  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_ACTIVITY_FILTERS);

  const dateValidation = useMemo(
    () => validateActivityDateRange(filters.dateFrom, filters.dateTo),
    [filters.dateFrom, filters.dateTo]
  );
  const actorOptions = useMemo(() => buildActorOptions(events), [events]);
  const filteredEvents = useMemo(() => applyActivityFilters(events, filters), [events, filters]);

  if (!effectiveHydrated || !activityHydrated || !effective) {
    return <LoadingNotice />;
  }

  function updateFilters(partial: Partial<ActivityFilters>) {
    setFilters((prev) => ({ ...prev, ...partial }));
  }

  return (
    <div className="flex flex-col gap-4">
      <ActivityHeaderSummary resolved={effective} />

      {malformedSources.map((source) => (
        <p
          key={source}
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          {MALFORMED_SOURCE_MESSAGE[source] ?? `${activitySourceTypeLabels[source]} 데이터를 확인할 수 없습니다.`}
        </p>
      ))}

      <ActivityFilterPanel
        filters={filters}
        actorOptions={actorOptions}
        dateValidation={dateValidation}
        onSourceTypeChange={(value) => updateFilters({ sourceType: value })}
        onCategoryChange={(value) => updateFilters({ category: value })}
        onActorChange={(value) => updateFilters({ actorKey: value })}
        onKeywordChange={(value) => updateFilters({ keyword: value })}
        onDateFromChange={(value) => updateFilters({ dateFrom: value })}
        onDateToChange={(value) => updateFilters({ dateTo: value })}
        onReset={() => setFilters(DEFAULT_ACTIVITY_FILTERS)}
      />

      <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
        조건에 맞는 활동 기록 {filteredEvents.length}건
      </p>

      {filteredEvents.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          조건에 맞는 활동 기록이 없습니다.
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {filteredEvents.map((event) => (
            <ActivityTimelineItem key={event.id} event={event} />
          ))}
        </ol>
      )}
    </div>
  );
}
