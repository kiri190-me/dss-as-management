import { and, eq, isNull } from "drizzle-orm";
import { db } from "../connection";
import {
  repairCases,
  repairCaseIdempotencyKeys,
  repairCaseFlowcharts,
  repairCaseFlowchartNodes,
  repairCaseFlowchartEdges,
  stockTransactions,
} from "../schema";
import { insertAuditLog } from "./audit-logs";
import { getRepairCaseTrashRetentionStatus } from "@/lib/domain/repair-case-trash-retention";

// No "server-only" here, deliberately — same reasoning as
// repair-case-flowchart-purge.ts and audit-logs.ts: this module's only
// caller is scripts/purge-expired-repair-cases.ts, a standalone CLI entry
// point run via `tsx` outside Next.js's bundler and its "react-server"
// export condition. `db` is imported from ../connection (not ../client, and
// not repair-cases.ts's own mutations — both carry `import "server-only"`
// at their top, which throws unconditionally outside a bundler's
// "react-server" resolution) for the same reason.
//
// This is deliberately self-contained rather than calling into
// repair-cases.ts's permanentlyDeleteRepairCase/repair-case-flowcharts.ts's
// purgeAllRepairCaseFlowchartsForCase — not a missed reuse opportunity, but
// the same hard architectural boundary the existing flowchart auto-purge
// already navigated (purgeExpiredRepairCaseFlowchart likewise never calls
// permanentlyDeleteRepairCaseFlowchart). What IS genuinely shared: the
// retention math (getRepairCaseTrashRetentionStatus — the exact function
// the 휴지통 UI's own retention badge calls, so eligibility here can never
// drift from what the UI displays) and insertAuditLog (already
// "server-only"-free for this exact reason). The delete order/snapshot
// shape below is kept byte-for-byte structurally identical to
// permanentlyDeleteRepairCase, just duplicated rather than imported.

export type PurgeRepairCaseOutcome = "PURGED" | "SKIPPED_RESTORED" | "SKIPPED_NOT_ELIGIBLE" | "SKIPPED_ALREADY_GONE";

/**
 * One repair case, one transaction. Locks the row and re-checks eligibility
 * live — never trusts that the caller's earlier SELECT
 * (listPurgeEligibleRepairCaseIds) is still true by the time this runs:
 *  - row missing entirely -> SKIPPED_ALREADY_GONE (a manual permanent
 *    delete, or a previous/concurrent sweep run, already removed it — a
 *    genuinely benign outcome, never an error).
 *  - is_deleted = false -> SKIPPED_RESTORED (restored between selection and
 *    this lock — restore wins the race by construction: whichever
 *    transaction acquires the row lock first determines the outcome the
 *    other one observes; restoreRepairCase's own plain UPDATE already
 *    takes an implicit row lock that correctly serializes against this
 *    function's FOR UPDATE select, same precedent as the manual permanent-
 *    delete checkpoint's own restore-vs-purge race handling).
 *  - not yet past the 15-day retention window (getRepairCaseTrashRetentionStatus,
 *    the same helper the 휴지통 UI's retention badge uses) -> SKIPPED_NOT_ELIGIBLE
 *    (defensive re-check; not expected to trigger in normal operation since
 *    the caller only ever selects already-eligible ids, but this is the
 *    actual enforcement point, not the selection query).
 *  - otherwise, same order as permanentlyDeleteRepairCase (manual purge):
 *    1. delete repair_case_idempotency_keys for this case.
 *    2. force-purge every attached repair_case_flowchart (active or
 *       already individually trashed — no orphans), edges -> nodes ->
 *       flowchart, same explicit order as
 *       purgeAllRepairCaseFlowchartsForCase/permanentlyDeleteRepairCaseFlowchart.
 *       No repair_case_flowchart_edit_history row is written here (unlike
 *       the manual/human-actor cascade) — that table's actor_user_id stays
 *       NOT NULL, so a no-human-actor event cannot write there without
 *       inventing a fake user, which this checkpoint explicitly forbids.
 *       audit_logs (actor_user_id = NULL, target_entity =
 *       "repair_case_flowcharts") is the sink for each purged flowchart
 *       instead — identical precedent to purgeExpiredRepairCaseFlowchart's
 *       own resolution of this same constraint.
 *    3. backfill stock_transactions.destination_note for this case's USE
 *       rows, only where it's still NULL (an operator-entered note is
 *       never overwritten) — a deterministic, non-PII, intake-number-based
 *       system note, required so stock_transactions_use_has_destination
 *       still holds once repair_case_id goes NULL next.
 *    4. delete the repair_cases row — the 6 preserved history/accounting
 *       tables go to repair_case_id = NULL automatically via their own
 *       ON DELETE SET NULL action (migration 0031); nothing here touches a
 *       single row in any of them, or in products/product_models/
 *       customers/end_users.
 *    5. insert exactly one audit_logs PURGE row for the case itself
 *       (actor_user_id = NULL, previousValue = the same PII-redacted
 *       snapshot shape as softDeleteRepairCase/permanentlyDeleteRepairCase,
 *       newValue = null).
 */
export async function purgeExpiredRepairCase(id: string, now: Date = new Date()): Promise<PurgeRepairCaseOutcome> {
  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: repairCases.id,
        intakeNumber: repairCases.intakeNumber,
        customerId: repairCases.customerId,
        endUserId: repairCases.endUserId,
        productId: repairCases.productId,
        assignedEngineerId: repairCases.assignedEngineerId,
        billingType: repairCases.billingType,
        priority: repairCases.priority,
        receivedAt: repairCases.receivedAt,
        currentWorkflowStepId: repairCases.currentWorkflowStepId,
        actualShipmentDate: repairCases.actualShipmentDate,
        isLocked: repairCases.isLocked,
        version: repairCases.version,
        isDeleted: repairCases.isDeleted,
        deletedAt: repairCases.deletedAt,
        deletedBy: repairCases.deletedBy,
        deleteReason: repairCases.deleteReason,
        // contactNameSnapshot/contactPhoneSnapshot/contactEmailSnapshot are
        // deliberately never selected here — PII, must never reach
        // audit_logs.previous_value. This is the last surviving trace of
        // this case once the DELETE below runs, so this redaction is the
        // actual point contact PII is permanently erased from the system.
      })
      .from(repairCases)
      .where(eq(repairCases.id, id))
      .for("update");

    if (!current) return "SKIPPED_ALREADY_GONE";
    if (!current.isDeleted || !current.deletedAt) return "SKIPPED_RESTORED";

    const retention = getRepairCaseTrashRetentionStatus(current.deletedAt.toISOString(), now);
    if (!retention.isExpired) return "SKIPPED_NOT_ELIGIBLE";

    await tx.delete(repairCaseIdempotencyKeys).where(eq(repairCaseIdempotencyKeys.repairCaseId, id));

    const flowcharts = await tx.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.repairCaseId, id)).for("update");
    for (const flowchart of flowcharts) {
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
          deletedAt: flowchart.deletedAt ? flowchart.deletedAt.toISOString() : null,
          deletedBy: flowchart.deletedBy,
          deleteReason: flowchart.deleteReason,
        },
        newValue: null,
      });
    }

    await tx
      .update(stockTransactions)
      .set({ destinationNote: `자동 정리된 접수 건 (인수번호: ${current.intakeNumber})` })
      .where(
        and(
          eq(stockTransactions.repairCaseId, id),
          eq(stockTransactions.transactionType, "USE"),
          isNull(stockTransactions.destinationNote)
        )
      );

    await tx.delete(repairCases).where(eq(repairCases.id, id));

    await insertAuditLog(tx, {
      actorUserId: null,
      actionType: "PURGE",
      targetEntity: "repair_cases",
      targetRecordId: id,
      previousValue: current,
      newValue: null,
    });

    return "PURGED";
  });
}

/**
 * Read-only, unlocked — the sweep's candidate list. Each candidate is
 * independently re-verified under its own row lock in
 * purgeExpiredRepairCase; this query is never itself the enforcement point.
 * Eligibility is computed via getRepairCaseTrashRetentionStatus (the exact
 * same helper the 휴지통 UI's own retention badge calls) rather than
 * re-deriving the 15-day threshold math in SQL, so this list can never
 * silently drift from what an admin sees displayed as "만료됨" in the
 * trash view.
 */
export async function listPurgeEligibleRepairCaseIds(now: Date = new Date()): Promise<string[]> {
  const rows = await db
    .select({ id: repairCases.id, deletedAt: repairCases.deletedAt })
    .from(repairCases)
    .where(eq(repairCases.isDeleted, true));

  return rows
    .filter((row) => row.deletedAt !== null && getRepairCaseTrashRetentionStatus(row.deletedAt.toISOString(), now).isExpired)
    .map((row) => row.id);
}

export type RepairCasePurgeSweepSummary = {
  eligible: number;
  purged: number;
  skippedRestored: number;
  skippedNotEligible: number;
  skippedAlreadyGone: number;
  errored: number;
  errors: { repairCaseId: string; message: string }[];
};

/**
 * Orchestrates one full sweep: select candidates once, then purge each in
 * its own transaction. A single case's failure is caught and recorded,
 * never allowed to abort the rest of the batch — the CLI script's own exit
 * code reflects `errored > 0`, but every other eligible case still gets a
 * chance to purge in the same run.
 */
export async function runRepairCasePurgeSweep(now: Date = new Date()): Promise<RepairCasePurgeSweepSummary> {
  const eligibleIds = await listPurgeEligibleRepairCaseIds(now);

  const summary: RepairCasePurgeSweepSummary = {
    eligible: eligibleIds.length,
    purged: 0,
    skippedRestored: 0,
    skippedNotEligible: 0,
    skippedAlreadyGone: 0,
    errored: 0,
    errors: [],
  };

  for (const id of eligibleIds) {
    try {
      const outcome = await purgeExpiredRepairCase(id, now);
      if (outcome === "PURGED") summary.purged += 1;
      else if (outcome === "SKIPPED_RESTORED") summary.skippedRestored += 1;
      else if (outcome === "SKIPPED_NOT_ELIGIBLE") summary.skippedNotEligible += 1;
      else summary.skippedAlreadyGone += 1;
    } catch (err) {
      summary.errored += 1;
      summary.errors.push({ repairCaseId: id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}
