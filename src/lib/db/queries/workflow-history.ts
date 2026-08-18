import "server-only";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { statusChangeHistories, users, workflowSteps } from "../schema";

const fromStep = alias(workflowSteps, "from_step");
const toStep = alias(workflowSteps, "to_step");

export type WorkflowActionType =
  | "STEP_ADVANCED"
  | "STEP_RETURNED"
  | "HOLD_STARTED"
  | "HOLD_RELEASED"
  | "SHIPMENT_COMPLETED"
  | "LEGACY_IMPORT_STATE_SET";

export type WorkflowHistoryEntry = {
  id: string;
  actionType: WorkflowActionType;
  fromStepKey: string | null;
  fromStepLabel: string | null;
  toStepKey: string | null;
  toStepLabel: string | null;
  actorUserId: string;
  actorName: string;
  reason: string | null;
  createdAt: string;
};

/**
 * Newest first. No row content here is PII beyond what repair_cases itself
 * already exposes (actor name, step labels, free-text reason) — never joins
 * customer/contact data.
 */
export async function getWorkflowHistoryForCase(repairCaseId: string): Promise<WorkflowHistoryEntry[]> {
  const rows = await db
    .select({
      id: statusChangeHistories.id,
      actionType: statusChangeHistories.actionType,
      fromStepKey: fromStep.key,
      fromStepLabel: fromStep.label,
      toStepKey: toStep.key,
      toStepLabel: toStep.label,
      actorUserId: statusChangeHistories.actorUserId,
      actorName: users.name,
      reason: statusChangeHistories.reason,
      createdAt: statusChangeHistories.createdAt,
    })
    .from(statusChangeHistories)
    .innerJoin(users, eq(statusChangeHistories.actorUserId, users.id))
    .leftJoin(fromStep, eq(statusChangeHistories.fromStepId, fromStep.id))
    .leftJoin(toStep, eq(statusChangeHistories.toStepId, toStep.id))
    .where(eq(statusChangeHistories.repairCaseId, repairCaseId))
    .orderBy(desc(statusChangeHistories.createdAt));

  return rows.map((row) => ({
    ...row,
    fromStepKey: row.fromStepKey ?? null,
    fromStepLabel: row.fromStepLabel ?? null,
    toStepKey: row.toStepKey ?? null,
    toStepLabel: row.toStepLabel ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export type CurrentHoldState = {
  isOnHold: boolean;
  reason: string | null;
  startedByUserId: string | null;
  startedByName: string | null;
  startedAt: string | null;
};

export const RELEASED_HOLD_STATE: CurrentHoldState = {
  isOnHold: false,
  reason: null,
  startedByUserId: null,
  startedByName: null,
  startedAt: null,
};

/**
 * Event-sourced: no dedicated hold columns exist on repair_cases (see the
 * Phase-1 report) — current hold state is always the latest HOLD_STARTED/
 * HOLD_RELEASED row. `entriesNewestFirst` may be the full history (as
 * returned by getWorkflowHistoryForCase) or any other order-preserving
 * subset; only the first matching row is used.
 */
export function deriveCurrentHoldState(
  entriesNewestFirst: readonly WorkflowHistoryEntry[]
): CurrentHoldState {
  const latest = entriesNewestFirst.find(
    (e) => e.actionType === "HOLD_STARTED" || e.actionType === "HOLD_RELEASED"
  );
  if (!latest || latest.actionType === "HOLD_RELEASED") {
    return RELEASED_HOLD_STATE;
  }
  return {
    isOnHold: true,
    reason: latest.reason,
    startedByUserId: latest.actorUserId,
    startedByName: latest.actorName,
    startedAt: latest.createdAt,
  };
}
