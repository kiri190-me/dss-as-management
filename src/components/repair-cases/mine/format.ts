import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";

/** 부품 요청 상태 cell text — terminal states (FULLY_ISSUED/PARTIALLY_CLOSED/REJECTED/CANCELLED) are already excluded at the query layer and never reach here as anything but null. */
export function formatPartsRequestStatus(status: MyActiveWorkRow["activePartsRequestStatus"]): string {
  if (status === "PENDING") return "요청 대기";
  if (status === "PARTIALLY_ISSUED") return "일부 지급";
  return "-";
}

/**
 * 마지막 작업 cell text. Deliberately never formats `receivedAt` as if it
 * were a real activity timestamp — "no activity yet" and "activity
 * happened, coincidentally on the intake date" must stay visually and
 * textually distinct.
 */
export function formatLastActivity(row: Pick<MyActiveWorkRow, "lastActivityAt" | "receivedAt">): string {
  if (!row.lastActivityAt) {
    return `활동 없음 · 인수일 ${row.receivedAt}`;
  }
  return new Date(row.lastActivityAt).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
