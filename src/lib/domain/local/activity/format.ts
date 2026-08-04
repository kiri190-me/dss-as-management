/**
 * 통합 타임라인 전용 한국어 날짜/시각 포매터다. work-history의 workedAt은
 * 고정 "+09:00" 오프셋 문자열이고, 워크플로/승인/첨부파일 이벤트는
 * "Z"(UTC) 문자열이다 — 두 형식이 섞여 있으므로 demo-clock.ts의
 * formatWorkedAt(문자열 슬라이싱, +09:00 형식만 정확함)을 여기서는 쓰지
 * 않는다. new Date()는 두 형식 모두 올바르게 파싱하므로 이 포매터 하나로
 * 통일한다.
 */
export function formatActivityDateTime(iso: string): string {
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
