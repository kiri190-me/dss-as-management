import { and, eq, lte } from "drizzle-orm";
import { db } from "../connection";
import { repairCaseFlowcharts, repairCaseFlowchartNodes, repairCaseFlowchartEdges } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { FLOWCHART_TRASH_RETENTION_DAYS } from "@/lib/domain/repair-case-flowchart-retention";

// No "server-only" here, deliberately — same reasoning as db/connection.ts
// and audit-logs.ts: this module's only caller is
// scripts/purge-expired-flowcharts.ts, a standalone CLI entry point run via
// `tsx` outside Next.js's bundler and its "react-server" export condition.
// `db` is imported from ../connection (not ../client) for the same reason.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type PurgeFlowchartOutcome =
  | "PURGED"
  | "SKIPPED_RESTORED"
  | "SKIPPED_NOT_ELIGIBLE"
  | "SKIPPED_ALREADY_GONE";

/**
 * One flowchart, one transaction. Locks the row and re-checks eligibility
 * live — never trusts that the caller's earlier SELECT (listPurgeEligibleFlowchartIds)
 * is still true by the time this runs:
 *  - row missing entirely -> SKIPPED_ALREADY_GONE (a manual permanent
 *    delete, or a previous/concurrent sweep run, already removed it — a
 *    genuinely benign outcome, never an error).
 *  - is_deleted = false -> SKIPPED_RESTORED (restored between selection and
 *    this lock — restore wins the race by construction: whichever
 *    transaction acquires the row lock first determines the outcome the
 *    other one observes).
 *  - deleted_at newer than the 15-day threshold -> SKIPPED_NOT_ELIGIBLE
 *    (defensive re-check; not expected to trigger in normal operation
 *    since the caller only ever selects already-eligible ids, but this is
 *    the actual enforcement point, not the selection query).
 *  - otherwise: delete edges -> nodes -> flowchart (same explicit order as
 *    the manual permanentlyDeleteRepairCaseFlowchart, for the same reason —
 *    never left to ON DELETE CASCADE timing against edges' sideways
 *    RESTRICT on nodes), then write one audit_logs row.
 *
 * No repair_case_flowchart_edit_history row is written here (unlike manual
 * purge) — that table's actor_user_id stays NOT NULL even after migration
 * 0026 (only flowchart_id became nullable), so a no-human-actor event
 * cannot write there without inventing a fake user, which this checkpoint
 * explicitly forbids. audit_logs (actor_user_id = NULL) is the sink for
 * this action instead. Every PRE-EXISTING history row for this flowchart
 * still survives the hard delete regardless — flowchart_id ON DELETE SET
 * NULL fires at the DB level for any deletion of the parent row, not only
 * ones performed through a specific code path.
 */
export async function purgeExpiredRepairCaseFlowchart(
  flowchartId: string,
  now: Date = new Date()
): Promise<PurgeFlowchartOutcome> {
  return await db.transaction(async (tx) => {
    const [flowchart] = await tx
      .select()
      .from(repairCaseFlowcharts)
      .where(eq(repairCaseFlowcharts.id, flowchartId))
      .for("update");
    if (!flowchart) return "SKIPPED_ALREADY_GONE";
    if (!flowchart.isDeleted || !flowchart.deletedAt) return "SKIPPED_RESTORED";

    const thresholdMs = now.getTime() - FLOWCHART_TRASH_RETENTION_DAYS * MS_PER_DAY;
    if (flowchart.deletedAt.getTime() > thresholdMs) return "SKIPPED_NOT_ELIGIBLE";

    await tx.delete(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.flowchartId, flowchart.id));
    await tx.delete(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.flowchartId, flowchart.id));
    await tx.delete(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, flowchart.id));

    await insertAuditLog(tx, {
      actorUserId: null,
      actionType: "PURGE",
      targetEntity: "repair_case_flowcharts",
      targetRecordId: flowchart.id,
      previousValue: {
        id: flowchart.id,
        repairCaseId: flowchart.repairCaseId,
        title: flowchart.title,
        description: flowchart.description,
        isDeleted: flowchart.isDeleted,
        deletedAt: flowchart.deletedAt.toISOString(),
        deletedBy: flowchart.deletedBy,
        deleteReason: flowchart.deleteReason,
      },
      newValue: null,
    });

    return "PURGED";
  });
}

/** Read-only, unlocked — the sweep's candidate list. Each candidate is independently re-verified under its own row lock in purgeExpiredRepairCaseFlowchart; this query is never itself the enforcement point. */
export async function listPurgeEligibleFlowchartIds(thresholdDate: Date): Promise<string[]> {
  const rows = await db
    .select({ id: repairCaseFlowcharts.id })
    .from(repairCaseFlowcharts)
    .where(and(eq(repairCaseFlowcharts.isDeleted, true), lte(repairCaseFlowcharts.deletedAt, thresholdDate)));
  return rows.map((r) => r.id);
}

export type PurgeSweepSummary = {
  eligible: number;
  purged: number;
  skippedRestored: number;
  skippedNotEligible: number;
  skippedAlreadyGone: number;
  errored: number;
  errors: { flowchartId: string; message: string }[];
};

/**
 * Orchestrates one full sweep: select candidates once, then purge each in
 * its own transaction. A single row's failure is caught and recorded, never
 * allowed to abort the rest of the batch — the CLI script's own exit code
 * reflects `errored > 0`, but every other eligible flowchart still gets a
 * chance to purge in the same run.
 */
export async function runFlowchartPurgeSweep(now: Date = new Date()): Promise<PurgeSweepSummary> {
  const thresholdDate = new Date(now.getTime() - FLOWCHART_TRASH_RETENTION_DAYS * MS_PER_DAY);
  const eligibleIds = await listPurgeEligibleFlowchartIds(thresholdDate);

  const summary: PurgeSweepSummary = {
    eligible: eligibleIds.length,
    purged: 0,
    skippedRestored: 0,
    skippedNotEligible: 0,
    skippedAlreadyGone: 0,
    errored: 0,
    errors: [],
  };

  for (const flowchartId of eligibleIds) {
    try {
      const outcome = await purgeExpiredRepairCaseFlowchart(flowchartId, now);
      if (outcome === "PURGED") summary.purged += 1;
      else if (outcome === "SKIPPED_RESTORED") summary.skippedRestored += 1;
      else if (outcome === "SKIPPED_NOT_ELIGIBLE") summary.skippedNotEligible += 1;
      else summary.skippedAlreadyGone += 1;
    } catch (err) {
      summary.errored += 1;
      summary.errors.push({ flowchartId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}
