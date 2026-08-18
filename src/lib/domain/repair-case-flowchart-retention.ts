/**
 * Checkpoint 3B — pure retention-window arithmetic for the 진단 Flowchart
 * 휴지통 (trash) view. `deleted_at` is a real timestamptz instant (not a
 * date-only value like 인수일), so the 15-day window is computed as real
 * elapsed time from that instant, not KST-calendar-day differencing
 * (contrast date-only.ts, which is deliberately calendar-day-based because
 * its inputs are date-only strings).
 *
 * This is eligibility-window display only for now — no purge/scheduler
 * reads this; `isExpired` never disables restore.
 */

export const FLOWCHART_TRASH_RETENTION_DAYS = 15;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type FlowchartRetentionStatus = {
  /** ISO instant 15 days after deletedAt. */
  expiresAt: string;
  /** Whole days remaining until expiresAt, rounded up so "expires later today" still reads as 1, not 0. Negative once past expiry. */
  daysRemaining: number;
  isExpired: boolean;
};

export function getFlowchartRetentionStatus(deletedAt: string, now: Date = new Date()): FlowchartRetentionStatus {
  const expiresAtMs = new Date(deletedAt).getTime() + FLOWCHART_TRASH_RETENTION_DAYS * MS_PER_DAY;
  const msRemaining = expiresAtMs - now.getTime();
  return {
    expiresAt: new Date(expiresAtMs).toISOString(),
    daysRemaining: Math.ceil(msRemaining / MS_PER_DAY),
    isExpired: msRemaining <= 0,
  };
}
