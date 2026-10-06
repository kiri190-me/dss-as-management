import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";

/** 부품 요청 상태 cell text — terminal states (FULLY_ISSUED/PARTIALLY_CLOSED/REJECTED/CANCELLED) are already excluded at the query layer and never reach here as anything but null. */
export function formatPartsRequestStatus(status: MyActiveWorkRow["activePartsRequestStatus"]): string {
  if (status === "PENDING") return "요청 대기";
  if (status === "PARTIALLY_ISSUED") return "일부 지급";
  return "-";
}

/** 이 화면의 시각 표기는 전부 이 한 곳을 지난다 — 같은 칸에 두 줄로 놓이므로 모양이 어긋나면 바로 눈에 띈다. */
function formatTimestamp(isoString: string): string {
  return new Date(isoString).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  return formatTimestamp(row.lastActivityAt);
}

/**
 * 작업기록 cell text — 값만 돌려주고 "작업기록" 이라는 머리말은 부르는 쪽이
 * 붙인다(표는 앞에 붙이고, 카드는 dt가 대신한다 — formatPartsRequestStatus와
 * 같은 약속이다).
 *
 * 마지막 작업과 달리 이 값은 작업기록 한 가지만 본다. 상태만 옮겨 놓은 건은
 * "마지막 작업"에는 시각이 찍히지만 여기서는 "없음"이고, 그 구분이 이 줄의
 * 존재 이유다.
 */
export function formatLastWorkRecord(row: Pick<MyActiveWorkRow, "lastWorkRecordAt">): string {
  if (!row.lastWorkRecordAt) return "없음";
  return formatTimestamp(row.lastWorkRecordAt);
}
