/**
 * Real-operational (non-demo) date-only helpers for Phase 5C-3's
 * "입고 후 경과일" column. Deliberately NOT in demo-clock.ts — that file's
 * DEMO_REFERENCE_DATE is explicitly documented as demo-only and "not for
 * real operational logic."
 *
 * This system operates in Korea. Calendar-day differences must be computed
 * against the KST calendar date, not the host process's timezone (which may
 * run in UTC) and not raw millisecond subtraction on Date objects (which is
 * only safe for two instants already known to be midnight-aligned in the
 * same timezone — getting that wrong is exactly the class of bug this file
 * exists to avoid).
 */

const KST_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" for the given instant, as a KST calendar date. */
export function toKstDateOnly(instant: Date): string {
  return KST_FORMATTER.format(instant);
}

/**
 * "YYYY-MM" for the given instant, as a KST calendar month — the month a
 * 대시보드 "금월 출하 완료" card means. Deliberately derived from
 * toKstDateOnly rather than getUTCFullYear/getUTCMonth: between 00:00 and
 * 09:00 KST on the 1st of a month, UTC is still in the previous month, and
 * a UTC-based implementation would silently count that window against the
 * wrong month.
 */
export function toKstYearMonth(instant: Date): string {
  return toKstDateOnly(instant).slice(0, 7);
}

/** Parses a "YYYY-MM-DD" (or any date-only prefix) string into a UTC-midnight synthetic instant, purely for calendar-day arithmetic — never a real point in time. */
function parseDateOnlyToUtcMidnight(dateOnly: string): number {
  const [year, month, day] = dateOnly.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * Whole calendar days between `receivedAt` (a date-only string, e.g.
 * repair_cases.received_at) and "today" in KST. Received today -> 0;
 * received yesterday (KST) -> 1. Never negative in practice (intake can't
 * be in the future), but not clamped here — a negative result is a
 * legitimate signal of bad input data, not something to silently hide.
 */
export function daysSinceIntake(receivedAt: string, now: Date = new Date()): number {
  const todayUtcMidnight = parseDateOnlyToUtcMidnight(toKstDateOnly(now));
  const receivedUtcMidnight = parseDateOnlyToUtcMidnight(receivedAt);
  return Math.round((todayUtcMidnight - receivedUtcMidnight) / 86_400_000);
}

/**
 * Adds `days` whole calendar days to a "YYYY-MM-DD" date-only string,
 * returning a new "YYYY-MM-DD" string — e.g. the A/S intake 일정 section's
 * 사내 목표 검수 완료일 default (receivedAt + 14). Built on the same
 * UTC-midnight parsing this file already uses for daysSinceIntake, so
 * month/year rollovers (e.g. 2026-12-25 + 14 -> 2027-01-08) are handled by
 * real date arithmetic, never string/field-by-field month math.
 */
export function addCalendarDays(dateOnly: string, days: number): string {
  const shifted = new Date(parseDateOnlyToUtcMidnight(dateOnly) + days * 86_400_000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Adds `months` whole calendar months to a "YYYY-MM-DD" date-only string —
 * the arithmetic behind "견적서를 낸 지 두 달이 지났다"(long-pending-po.ts).
 *
 * **달력 기준이지 60일이 아니다.** 6월 30일 + 2개월은 8월 30일이고, 그 사이의
 * 날 수(7월 31일 + 8월 30일)는 세지 않는다. 사람이 "두 달"이라고 말할 때
 * 뜻하는 것이 그것이라서다 — 일 수로 접으면 2월이 낀 두 달과 여름의 두 달이
 * 서로 다른 기준이 된다.
 *
 * **대응 날짜가 없으면 그 달의 말일로 접는다:** 12월 31일 + 2개월은 2월 28일
 * (윤년이면 2월 29일)이고, 1월 31일 + 1개월은 2월 28일이다. 접지 않고
 * Date 에 그대로 넘기면 "2월 31일"이 3월 3일로 넘어가, **두 달이 지나기 전에**
 * 걸리는 건이 생긴다.
 *
 * addCalendarDays 와 달리 밀리초 덧셈을 쓸 수 없다 — 한 달의 길이가 달마다
 * 다르기 때문이다. 그래서 연·월을 직접 옮기고, 말일은 `Date.UTC(y, m + 1, 0)`
 * (다음 달 0일 = 이 달 말일)로 달력에게 물어본다. 윤년 규칙을 이 파일에
 * 옮겨 적지 않기 위해서다.
 */
export function addCalendarMonths(dateOnly: string, months: number): string {
  const [year, month, day] = dateOnly.slice(0, 10).split("-").map(Number);

  // 0-based 월 index 로 옮겨 더한 뒤 연도로 되돌린다. Math.floor 와
  // ((x % 12) + 12) % 12 는 months 가 음수일 때도 성립한다(JS 의 % 는 음수
  // 피연산자에서 음수를 돌려주므로 그대로 쓰면 월이 -1 이 된다).
  const shiftedMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(shiftedMonthIndex / 12);
  const targetMonthIndex = ((shiftedMonthIndex % 12) + 12) % 12;

  // 다음 달 0일 = 목표 달의 말일. 윤년 판정을 여기서 다시 적지 않는다.
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}
