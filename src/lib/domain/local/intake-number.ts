import { mockRepairCases } from "../mock-data";
import type { LocalRepairCase } from "./local-types";

const INTAKE_NUMBER_PATTERN = /^D(\d{2})(\d{2})(\d{2})$/;

/**
 * Strict format check for a USER-TYPED intake-number override — matches
 * the database's own `repair_cases_intake_number_format` CHECK constraint
 * exactly (month must be 01-12), unlike the looser INTAKE_NUMBER_PATTERN
 * above (used only to PARSE numbers this module already generated itself,
 * where a stricter month check was never needed). Shared by both the local
 * and database-mode intake paths so an override is rejected with the same
 * rule everywhere, before ever reaching a DB round-trip.
 */
const INTAKE_NUMBER_STRICT_PATTERN = /^D[0-9]{2}(0[1-9]|1[0-2])[0-9]{2}$/;

export function isValidIntakeNumberFormat(value: string): boolean {
  return INTAKE_NUMBER_STRICT_PATTERN.test(value);
}

/**
 * "D" + YY + MM + 2자리 월별 순번 형식이다. 순번은 선택한 인수일의 연/월을
 * 기준으로 계산하며(데모 기준일이 아니라 폼에서 고른 날짜), 매달 최대
 * 99건까지만 허용한다.
 */
export function formatIntakeNumber(yy: string, mm: string, sequence: number): string {
  return `D${yy}${mm}${String(sequence).padStart(2, "0")}`;
}

export function yearMonthFromDate(receivedAt: string): { yy: string; mm: string } {
  const [year, month] = receivedAt.split("-");
  return { yy: year.slice(2), mm: month };
}

function maxSequenceForMonth(intakeNumbers: Iterable<string>, yy: string, mm: string): number {
  let max = 0;
  for (const number of intakeNumbers) {
    const match = INTAKE_NUMBER_PATTERN.exec(number);
    if (!match) continue;
    if (match[1] !== yy || match[2] !== mm) continue;
    max = Math.max(max, Number(match[3]));
  }
  return max;
}

function allIntakeNumbers(localCases: LocalRepairCase[]): string[] {
  return [...mockRepairCases.map((c) => c.intakeNumber), ...localCases.map((c) => c.intakeNumber)];
}

/** Local-mode duplicate check for a manually-typed intake-number override — mirrors the database's unique index (repair_cases_intake_number_unique), checked against the same mock+local case set the auto-generator itself already consults. */
export function isIntakeNumberTaken(intakeNumber: string, localCases: LocalRepairCase[]): boolean {
  return allIntakeNumbers(localCases).includes(intakeNumber);
}

/**
 * 화면에 표시되는 "예상 인수번호"다. 실제 저장은 하지 않으며, 제출 시점에
 * 다시 계산 + 중복 재확인을 거친 뒤에만 최종 번호로 확정된다.
 */
export function estimateIntakeNumber(receivedAt: string, localCases: LocalRepairCase[]): string | null {
  const [year, month, day] = receivedAt.split("-");
  if (!year || !month || !day) return null;
  const { yy, mm } = yearMonthFromDate(receivedAt);
  const nextSequence = maxSequenceForMonth(allIntakeNumbers(localCases), yy, mm) + 1;
  if (nextSequence > 99) return null;
  return formatIntakeNumber(yy, mm, nextSequence);
}

export type GenerateIntakeNumberResult =
  | { ok: true; intakeNumber: string }
  | { ok: false; reason: "SEQUENCE_EXHAUSTED" };

/**
 * 제출 시점에 호출된다. 호출자는 그 직전에 localStorage를 새로 읽어 만든
 * 최신 localCases를 넘겨야 한다. 중복 인수번호가 발견되면(이론적으로 같은
 * 브라우저의 다른 탭이 그 사이 먼저 썼을 경우) 순번을 올려 재확인한다.
 * 이 절차는 단일 브라우저·단일 탭을 가정한 데모용이며 동시성 안전을
 * 보장하지 않는다 — 실제 운영에서는 DB 트랜잭션으로 채번해야 한다.
 */
export function generateFinalIntakeNumber(
  receivedAt: string,
  localCases: LocalRepairCase[]
): GenerateIntakeNumberResult {
  const { yy, mm } = yearMonthFromDate(receivedAt);
  const existing = new Set(allIntakeNumbers(localCases));

  let sequence = maxSequenceForMonth(existing, yy, mm) + 1;
  while (sequence <= 99) {
    const candidate = formatIntakeNumber(yy, mm, sequence);
    if (!existing.has(candidate)) {
      return { ok: true, intakeNumber: candidate };
    }
    sequence += 1;
  }
  return { ok: false, reason: "SEQUENCE_EXHAUSTED" };
}
