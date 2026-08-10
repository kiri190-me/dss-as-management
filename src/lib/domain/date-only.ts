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
