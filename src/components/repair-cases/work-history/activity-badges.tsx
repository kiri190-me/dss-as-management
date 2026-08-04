import {
  activityCategoryLabels,
  activitySourceTypeLabels,
  type ActivityCategory,
  type ActivitySourceType,
} from "@/lib/domain/local/activity/activity-types";

const baseBadgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const SOURCE_TYPE_TONE: Record<ActivitySourceType, string> = {
  WORK_HISTORY: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  WORKFLOW: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400",
  APPROVAL: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  ATTACHMENT: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  CASE_CREATED: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
};

export function ActivitySourceTypeBadge({ sourceType }: { sourceType: ActivitySourceType }) {
  return (
    <span className={`${baseBadgeClass} ${SOURCE_TYPE_TONE[sourceType]}`}>
      {activitySourceTypeLabels[sourceType]}
    </span>
  );
}

export function ActivityCategoryBadge({ category }: { category: ActivityCategory }) {
  return (
    <span className={`${baseBadgeClass} border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400`}>
      {activityCategoryLabels[category]}
    </span>
  );
}

/** 이벤트 자체의 출처(SEEDED_MOCK|LOCAL_DEMO) — 접수 건 수준 SourceBadge와는
 * 다른 값 집합이므로 별도 컴포넌트로 둔다(혼용하지 않는다). */
export function ActivityEventSourceBadge({ source }: { source: "SEEDED_MOCK" | "LOCAL_DEMO" }) {
  const tone =
    source === "LOCAL_DEMO"
      ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  return (
    <span className={`${baseBadgeClass} ${tone}`}>{source === "LOCAL_DEMO" ? "로컬 데모" : "시드 데이터"}</span>
  );
}
