import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { repairCaseApprovals, users } from "../schema";
import type { RepairCaseApprovalType } from "@/lib/validation/repair-case-approval-input";

const requester = alias(users, "requester");
const decider = alias(users, "decider");
const delegator = alias(users, "delegator");

export type ApprovalRecordRow = {
  id: string;
  approvalType: RepairCaseApprovalType;
  status: "REQUESTED" | "APPROVED" | "REJECTED";
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: string;
  requestReason: string | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  delegatedFromUserId: string | null;
  delegatedFromName: string | null;
  repairCaseVersionAtRequest: number;
};

const SELECT_COLUMNS = {
  id: repairCaseApprovals.id,
  approvalType: repairCaseApprovals.approvalType,
  status: repairCaseApprovals.status,
  requestedByUserId: repairCaseApprovals.requestedByUserId,
  requestedByName: requester.name,
  requestedAt: repairCaseApprovals.requestedAt,
  requestReason: repairCaseApprovals.requestReason,
  decidedByUserId: repairCaseApprovals.decidedByUserId,
  decidedByName: decider.name,
  decidedAt: repairCaseApprovals.decidedAt,
  decisionReason: repairCaseApprovals.decisionReason,
  delegatedFromUserId: repairCaseApprovals.delegatedFromUserId,
  delegatedFromName: delegator.name,
  repairCaseVersionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
};

function baseQuery() {
  return db
    .select(SELECT_COLUMNS)
    .from(repairCaseApprovals)
    .innerJoin(requester, eq(repairCaseApprovals.requestedByUserId, requester.id))
    .leftJoin(decider, eq(repairCaseApprovals.decidedByUserId, decider.id))
    .leftJoin(delegator, eq(repairCaseApprovals.delegatedFromUserId, delegator.id));
}

function toRow(row: Awaited<ReturnType<typeof baseQuery>>[number]): ApprovalRecordRow {
  return {
    ...row,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

/**
 * Full request/decision history for a case, both approval types mixed,
 * newest first — feeds the database-mode approval timeline UI. Every
 * REQUESTED row is its own permanent record (append-only, see the schema
 * file), so this alone reconstructs the complete history without a
 * separate events table.
 */
export async function getApprovalHistoryForCase(repairCaseId: string): Promise<ApprovalRecordRow[]> {
  const rows = await baseQuery()
    .where(eq(repairCaseApprovals.repairCaseId, repairCaseId))
    .orderBy(desc(repairCaseApprovals.requestedAt));
  return rows.map(toRow);
}

export type CurrentApprovalState = {
  approvalType: RepairCaseApprovalType;
  /** null means NOT_REQUESTED — no row has ever been created for this (case, type) pair. */
  latest: ApprovalRecordRow | null;
};

/**
 * The single most recent row per approval type — mirrors the local-demo
 * layer's getDisplayStatus(findRecordFor(...)) derivation (NOT_REQUESTED is
 * "no row", not a stored state). Used by both the approval screen (what to
 * show/what actions to offer) and the workflow control panel (whether a
 * gated transition's requirement is currently satisfied).
 */
export async function getCurrentApprovalsForCase(repairCaseId: string): Promise<CurrentApprovalState[]> {
  const rows = await baseQuery()
    .where(eq(repairCaseApprovals.repairCaseId, repairCaseId))
    .orderBy(desc(repairCaseApprovals.requestedAt));

  const seen = new Set<RepairCaseApprovalType>();
  const latestByType = new Map<RepairCaseApprovalType, ApprovalRecordRow>();
  for (const row of rows) {
    if (seen.has(row.approvalType)) continue;
    seen.add(row.approvalType);
    latestByType.set(row.approvalType, toRow(row));
  }

  return (["REPAIR_INSPECTION", "FINAL_SHIPMENT"] as const).map((approvalType) => ({
    approvalType,
    latest: latestByType.get(approvalType) ?? null,
  }));
}

/**
 * Used by transitionWorkflow() (workflow-transitions.ts) to decide whether
 * a gated transition may proceed. A valid approval is: the most recent row
 * for (repairCaseId, approvalType), status APPROVED, and requested against
 * the repair case's *current* version (repair_case_version_at_request must
 * still match repair_cases.version) — an approval requested before a
 * material edit to the case must never silently authorize a transition
 * against the post-edit state.
 */
export type ApprovalValidityResult =
  | { state: "VALID"; approvalId: string }
  | { state: "MISSING" }
  | { state: "STALE" };

export async function resolveApprovalValidity(
  repairCaseId: string,
  approvalType: RepairCaseApprovalType,
  currentRepairCaseVersion: number
): Promise<ApprovalValidityResult> {
  const [latest] = await db
    .select({
      id: repairCaseApprovals.id,
      status: repairCaseApprovals.status,
      repairCaseVersionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
    })
    .from(repairCaseApprovals)
    .where(and(eq(repairCaseApprovals.repairCaseId, repairCaseId), eq(repairCaseApprovals.approvalType, approvalType)))
    .orderBy(desc(repairCaseApprovals.requestedAt))
    .limit(1);

  if (!latest || latest.status !== "APPROVED") {
    return { state: "MISSING" };
  }
  if (latest.repairCaseVersionAtRequest !== currentRepairCaseVersion) {
    return { state: "STALE" };
  }
  return { state: "VALID", approvalId: latest.id };
}
