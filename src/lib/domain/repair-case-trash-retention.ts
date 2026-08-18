/**
 * Repair Case Trash + Restore checkpoint — pure retention-window arithmetic
 * for the /repair-cases 휴지통 (trash) view. Same shape/precedent as
 * repair-case-flowchart-retention.ts's getFlowchartRetentionStatus, kept as
 * its own small module (rather than a shared generic across entities) for
 * the same reason that file is its own module: each trash view's retention
 * window is independently approved policy, not guaranteed to stay in sync.
 *
 * `deleted_at` is a real timestamptz instant, so the 15-day window is real
 * elapsed time from that instant, not KST-calendar-day differencing.
 *
 * This is display only — no purge/scheduler reads this; `isExpired` never
 * disables restore in this checkpoint.
 */

export const REPAIR_CASE_TRASH_RETENTION_DAYS = 15;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type RepairCaseTrashRetentionStatus = {
  /** ISO instant 15 days after deletedAt. */
  expiresAt: string;
  /** Whole days remaining until expiresAt, rounded up so "expires later today" still reads as 1, not 0. Negative once past expiry. */
  daysRemaining: number;
  isExpired: boolean;
};

export function getRepairCaseTrashRetentionStatus(
  deletedAt: string,
  now: Date = new Date()
): RepairCaseTrashRetentionStatus {
  const expiresAtMs = new Date(deletedAt).getTime() + REPAIR_CASE_TRASH_RETENTION_DAYS * MS_PER_DAY;
  const msRemaining = expiresAtMs - now.getTime();
  return {
    expiresAt: new Date(expiresAtMs).toISOString(),
    daysRemaining: Math.ceil(msRemaining / MS_PER_DAY),
    isExpired: msRemaining <= 0,
  };
}
