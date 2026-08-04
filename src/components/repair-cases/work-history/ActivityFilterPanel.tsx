"use client";

import {
  ACTIVITY_CATEGORY_CODES,
  ACTIVITY_SOURCE_TYPE_CODES,
  activityCategoryLabels,
  activitySourceTypeLabels,
} from "@/lib/domain/local/activity/activity-types";
import type { ActivityFilters, ActorOption, DateRangeValidation } from "@/lib/domain/local/activity/filters";

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const selectClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";
const errorClass = "text-xs text-red-600 dark:text-red-400";

type ActivityFilterPanelProps = {
  filters: ActivityFilters;
  actorOptions: ActorOption[];
  dateValidation: DateRangeValidation;
  onSourceTypeChange: (value: ActivityFilters["sourceType"]) => void;
  onCategoryChange: (value: ActivityFilters["category"]) => void;
  onActorChange: (value: string) => void;
  onKeywordChange: (value: string) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onReset: () => void;
};

export default function ActivityFilterPanel({
  filters,
  actorOptions,
  dateValidation,
  onSourceTypeChange,
  onCategoryChange,
  onActorChange,
  onKeywordChange,
  onDateFromChange,
  onDateToChange,
  onReset,
}: ActivityFilterPanelProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-1">
        <label htmlFor="activity-keyword" className={labelClass}>
          키워드 검색
        </label>
        <input
          id="activity-keyword"
          type="text"
          value={filters.keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          placeholder="제목, 설명, 담당자, 파일명, 상태/단계명으로 검색"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="activity-source" className={labelClass}>
            소스
          </label>
          <select
            id="activity-source"
            className={selectClass}
            value={filters.sourceType}
            onChange={(event) => onSourceTypeChange(event.target.value as ActivityFilters["sourceType"])}
          >
            <option value="ALL">전체</option>
            {ACTIVITY_SOURCE_TYPE_CODES.map((code) => (
              <option key={code} value={code}>
                {activitySourceTypeLabels[code]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="activity-category" className={labelClass}>
            분류
          </label>
          <select
            id="activity-category"
            className={selectClass}
            value={filters.category}
            onChange={(event) => onCategoryChange(event.target.value as ActivityFilters["category"])}
          >
            <option value="ALL">전체</option>
            {ACTIVITY_CATEGORY_CODES.map((code) => (
              <option key={code} value={code}>
                {activityCategoryLabels[code]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="activity-actor" className={labelClass}>
            담당자
          </label>
          <select
            id="activity-actor"
            className={selectClass}
            value={filters.actorKey}
            onChange={(event) => onActorChange(event.target.value)}
          >
            <option value="ALL">전체 담당자</option>
            {actorOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="activity-date-from" className={labelClass}>
            시작일
          </label>
          <input
            id="activity-date-from"
            type="date"
            value={filters.dateFrom}
            onChange={(event) => onDateFromChange(event.target.value)}
            aria-invalid={Boolean(dateValidation.fromError)}
            aria-describedby={dateValidation.fromError ? "activity-date-from-error" : undefined}
            className={inputClass}
          />
          {dateValidation.fromError && (
            <p id="activity-date-from-error" className={errorClass}>
              {dateValidation.fromError}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="activity-date-to" className={labelClass}>
            종료일
          </label>
          <input
            id="activity-date-to"
            type="date"
            value={filters.dateTo}
            onChange={(event) => onDateToChange(event.target.value)}
            aria-invalid={Boolean(dateValidation.toError)}
            aria-describedby={dateValidation.toError ? "activity-date-to-error" : undefined}
            className={inputClass}
          />
          {dateValidation.toError && (
            <p id="activity-date-to-error" className={errorClass}>
              {dateValidation.toError}
            </p>
          )}
        </div>
      </div>

      {dateValidation.rangeError && (
        <p role="alert" className={errorClass}>
          {dateValidation.rangeError}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          필터 초기화
        </button>
      </div>
    </div>
  );
}
