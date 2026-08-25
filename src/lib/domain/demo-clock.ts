/**
 * 모의(mock) 데이터 전용 고정 기준일이다. mock-data.ts의 접수 건들이 고정된
 * 시점(2026-08)을 기준으로 작성되어 있어, 그 데이터의 "납기 지연" 계산이
 * 실제 벽시계 시각을 따르면 날짜가 지날수록 결과가 의도치 않게 달라진다.
 * 이 상수는 그 드리프트를 막기 위한 mock 한정 장치다.
 *
 * 현재 유일한 사용처는 local/resolved-repair-case.ts의 mock 해석 경로다.
 * 실제 운영 경로(DB 매퍼, 대시보드 집계, 접수 폼 기본값, 워크플로 재정의)는
 * 전부 실제 현재 시각을 쓰며, 한국 달력 날짜 비교는 date-only.ts의
 * toKstDateOnly/toKstYearMonth를 통한다 — 여기에 새 헬퍼를 추가하지 말 것.
 * mock 계층이 사라지면 이 파일도 함께 사라진다.
 */
export const DEMO_REFERENCE_DATE = new Date("2026-08-04T00:00:00.000Z");

/**
 * WorkHistory.workedAt("YYYY-MM-DDTHH:mm:00+09:00")을 "YYYY-MM-DD HH:mm"으로
 * 표시한다. 항상 +09:00 오프셋으로 데이터를 작성하므로, 서버 실행 환경의
 * 타임존과 무관하게 문자열을 직접 잘라 사용한다(Date 변환 후 로컬 타임존으로
 * 다시 포맷하면 서버 환경에 따라 시각이 달라질 수 있어 이를 피한다).
 */
export function formatWorkedAt(workedAt: string): string {
  const [datePart, timePart] = workedAt.split("T");
  return `${datePart} ${timePart.slice(0, 5)}`;
}
