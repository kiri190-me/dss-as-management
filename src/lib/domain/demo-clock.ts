/**
 * 데모 전용 고정 기준일이다. 대시보드/전체 현황의 "이번 달", "납기 지연" 계산이
 * 실제 벽시계 시각(new Date())을 따르면, 모의 데이터가 고정된 시점(2026-08)을
 * 기준으로 작성되어 있어 실제 날짜가 지날수록 결과가 의도치 않게 달라진다.
 * 이 상수는 그 드리프트를 막기 위한 데모 한정 장치이며, 실제 운영 로직에서는
 * 사용하지 않는다(운영 전환 시 반드시 제거/대체할 것).
 */
export const DEMO_REFERENCE_DATE = new Date("2026-08-04T00:00:00.000Z");

export function formatDemoReferenceDateLabel(date: Date = DEMO_REFERENCE_DATE): string {
  return date.toISOString().slice(0, 10);
}

/** "YYYY-MM" 형식으로 변환한다(월별 출하 완료 필터 딥링크용). */
export function formatYearMonth(date: Date = DEMO_REFERENCE_DATE): string {
  return date.toISOString().slice(0, 7);
}
