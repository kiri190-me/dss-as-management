import { repairStatusLabels } from "../../types";
import { attachmentCategoryLabels } from "../attachments/attachment-types";
import { isValidDateString } from "../validation";
import type { ActivityCategory, ActivitySourceType, UnifiedActivityEvent } from "./activity-types";
import { resolveStepLabel } from "./adapters";

/** actorUserId가 없는(CASE_CREATED) 이벤트를 선택하기 위한 액터가 아닌 값이다. */
export const NO_ACTOR_KEY = "__NO_ACTOR__";

export type ActivityFilters = {
  sourceType: "ALL" | ActivitySourceType;
  category: "ALL" | ActivityCategory;
  /** "ALL" | NO_ACTOR_KEY | 실제 actorUserId */
  actorKey: string;
  keyword: string;
  /** "" 또는 "YYYY-MM-DD". 빈 문자열은 "그 경계 없음"을 뜻한다. */
  dateFrom: string;
  dateTo: string;
};

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = {
  sourceType: "ALL",
  category: "ALL",
  actorKey: "ALL",
  keyword: "",
  dateFrom: "",
  dateTo: "",
};

function localDayStartMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
function localDayEndMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

export type DateRangeValidation = {
  fromError: string | null;
  toError: string | null;
  rangeError: string | null;
  /** 검증을 통과했을 때만 값을 가진다. 하나라도 유효하지 않으면 둘 다 null —
   * 호출부는 이 경우 날짜 필터링을 완전히 건너뛰어야 한다(0건을 반환하지
   * 않는다). */
  startMs: number | null;
  endMs: number | null;
};

const INVALID_DATE_MESSAGE = "올바른 날짜를 입력해 주세요.";
const INVERTED_RANGE_MESSAGE = "시작일이 종료일보다 늦을 수 없습니다.";

/**
 * new Date(y, m-1, d)만으로는 2월 30일 같은 존재하지 않는 날짜가 조용히
 * 다음 달로 넘어가 버리므로(JS의 날짜 정규화), 반드시 isValidDateString
 * (로컬 domain/local/validation.ts의 기존 검증 — 형식+실제 달력 유효성까지
 * 확인)로 먼저 구조적으로 검증한다.
 */
export function validateActivityDateRange(dateFrom: string, dateTo: string): DateRangeValidation {
  const fromError = dateFrom && !isValidDateString(dateFrom) ? INVALID_DATE_MESSAGE : null;
  const toError = dateTo && !isValidDateString(dateTo) ? INVALID_DATE_MESSAGE : null;

  let rangeError: string | null = null;
  if (!fromError && !toError && dateFrom && dateTo && dateFrom > dateTo) {
    rangeError = INVERTED_RANGE_MESSAGE;
  }

  const usable = !fromError && !toError && !rangeError;
  return {
    fromError,
    toError,
    rangeError,
    startMs: usable && dateFrom ? localDayStartMs(dateFrom) : null,
    endMs: usable && dateTo ? localDayEndMs(dateTo) : null,
  };
}

function buildSearchHaystack(e: UnifiedActivityEvent): string {
  const statusLabels = [e.previousStatus, e.nextStatus]
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => repairStatusLabels[s]);
  const stepLabels = [
    resolveStepLabel(e.workflowType, e.previousWorkflowStepKey),
    resolveStepLabel(e.workflowType, e.nextWorkflowStepKey),
  ].filter((v): v is string => Boolean(v));
  const attachmentCategoryLabel = e.relatedAttachmentCategory ? attachmentCategoryLabels[e.relatedAttachmentCategory] : null;
  const workDetailParts = e.workDetails
    ? [e.workDetails.symptom, e.workDetails.suspectedCause, e.workDetails.actionTaken, e.workDetails.partsUsed, e.workDetails.nextAction]
    : [];

  return [
    e.title,
    e.description,
    e.actorNameSnapshot,
    e.relatedAttachmentName,
    attachmentCategoryLabel,
    ...statusLabels,
    ...stepLabels,
    ...workDetailParts,
  ]
    .filter((v): v is string => Boolean(v))
    .join(" ")
    .toLowerCase();
}

export function applyActivityFilters(events: UnifiedActivityEvent[], filters: ActivityFilters): UnifiedActivityEvent[] {
  const keyword = filters.keyword.trim().toLowerCase();
  const { startMs, endMs } = validateActivityDateRange(filters.dateFrom, filters.dateTo);

  return events.filter((e) => {
    if (filters.sourceType !== "ALL" && e.sourceType !== filters.sourceType) return false;
    if (filters.category !== "ALL" && e.category !== filters.category) return false;

    if (filters.actorKey === NO_ACTOR_KEY) {
      if (e.actorUserId !== null) return false;
    } else if (filters.actorKey !== "ALL") {
      if (e.actorUserId !== filters.actorKey) return false;
    }

    if (startMs !== null || endMs !== null) {
      const t = Date.parse(e.occurredAt);
      if (startMs !== null && t < startMs) return false;
      if (endMs !== null && t > endMs) return false;
    }

    if (keyword && !buildSearchHaystack(e).includes(keyword)) return false;
    return true;
  });
}

export type ActorOption = { key: string; label: string };

/** 필터 드롭다운용 옵션 목록이다: "전체 담당자" + 등장한 실제 액터들 +
 * (등장했다면) "등록자 정보 없음". */
export function buildActorOptions(events: readonly UnifiedActivityEvent[]): ActorOption[] {
  const seen = new Map<string, string>();
  let hasNoActor = false;
  for (const e of events) {
    if (e.actorUserId) {
      if (!seen.has(e.actorUserId)) {
        seen.set(e.actorUserId, e.actorNameSnapshot ?? "사용자 정보 없음");
      }
    } else {
      hasNoActor = true;
    }
  }
  const options: ActorOption[] = Array.from(seen.entries()).map(([key, label]) => ({ key, label }));
  if (hasNoActor) {
    options.push({ key: NO_ACTOR_KEY, label: "등록자 정보 없음" });
  }
  return options;
}
