/**
 * 인수번호의 형식 규칙만 담은 순수 모듈이다. 채번(순번 계산)과 중복 검사는
 * 여기 있지 않다 — 데모 경로가 사라진 뒤로 실제 채번은 DB 트랜잭션
 * (repair_case_intake_sequences, db/mutations/repair-cases.ts)이 전담한다.
 * 파일 위치(local/)는 이 규칙이 처음 만들어진 곳에서 유래한 것일 뿐이며,
 * 지금 남은 export는 전부 DB 경로가 쓴다.
 */

/**
 * Strict format check for a USER-TYPED intake-number override — matches
 * the database's own `repair_cases_intake_number_format` CHECK constraint
 * exactly (month must be 01-12). Applied before ever reaching a DB
 * round-trip, and again server-side by validateCreateRepairCaseInput.
 */
const INTAKE_NUMBER_STRICT_PATTERN = /^D[0-9]{2}(0[1-9]|1[0-2])[0-9]{2}$/;

export function isValidIntakeNumberFormat(value: string): boolean {
  return INTAKE_NUMBER_STRICT_PATTERN.test(value);
}

/**
 * "D" + YY + MM + 2자리 월별 순번 형식이다. 순번은 선택한 인수일의 연/월을
 * 기준으로 계산하며(오늘이 아니라 폼에서 고른 날짜), 2자리이므로 매달
 * 99건까지만 표현할 수 있다 — 그 한계를 실제로 검사하는 곳은 채번을
 * 수행하는 DB 뮤테이션이다.
 */
export function formatIntakeNumber(yy: string, mm: string, sequence: number): string {
  return `D${yy}${mm}${String(sequence).padStart(2, "0")}`;
}

export function yearMonthFromDate(receivedAt: string): { yy: string; mm: string } {
  const [year, month] = receivedAt.split("-");
  return { yy: year.slice(2), mm: month };
}
