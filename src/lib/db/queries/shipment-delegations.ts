import "server-only";
import { and, desc, eq, gt, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { shipmentApprovalDelegations, users } from "../schema";

const representative = alias(users, "representative");
const delegate = alias(users, "delegate");
const assignedBy = alias(users, "assigned_by");
const revokedBy = alias(users, "revoked_by");

export type ShipmentDelegationRow = {
  id: string;
  representativeUserId: string;
  representativeName: string;
  delegateUserId: string;
  delegateName: string;
  startsAt: string;
  endsAt: string;
  status: "ACTIVE" | "REVOKED";
  assignedByUserId: string;
  assignedByName: string;
  revokedByUserId: string | null;
  revokedByName: string | null;
  revokedAt: string | null;
  reason: string | null;
  createdAt: string;
};

function toRow(row: {
  id: string;
  representativeUserId: string;
  representativeName: string;
  delegateUserId: string;
  delegateName: string;
  startsAt: Date;
  endsAt: Date;
  status: "ACTIVE" | "REVOKED";
  assignedByUserId: string;
  assignedByName: string;
  revokedByUserId: string | null;
  revokedByName: string | null;
  revokedAt: Date | null;
  reason: string | null;
  createdAt: Date;
}): ShipmentDelegationRow {
  return {
    ...row,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Full delegation list for the management UI — every delegation ever
 * created (append-only, never deleted), newest first. Display status
 * (ACTIVE/SCHEDULED/EXPIRED/REVOKED) is derived client-side-ready via
 * deriveDelegationDisplayStatus, not stored.
 */
export async function listShipmentDelegations(): Promise<ShipmentDelegationRow[]> {
  const rows = await db
    .select({
      id: shipmentApprovalDelegations.id,
      representativeUserId: shipmentApprovalDelegations.representativeUserId,
      representativeName: representative.name,
      delegateUserId: shipmentApprovalDelegations.delegateUserId,
      delegateName: delegate.name,
      startsAt: shipmentApprovalDelegations.startsAt,
      endsAt: shipmentApprovalDelegations.endsAt,
      status: shipmentApprovalDelegations.status,
      assignedByUserId: shipmentApprovalDelegations.assignedByUserId,
      assignedByName: assignedBy.name,
      revokedByUserId: shipmentApprovalDelegations.revokedByUserId,
      revokedByName: revokedBy.name,
      revokedAt: shipmentApprovalDelegations.revokedAt,
      reason: shipmentApprovalDelegations.reason,
      createdAt: shipmentApprovalDelegations.createdAt,
    })
    .from(shipmentApprovalDelegations)
    .innerJoin(representative, eq(shipmentApprovalDelegations.representativeUserId, representative.id))
    .innerJoin(delegate, eq(shipmentApprovalDelegations.delegateUserId, delegate.id))
    .innerJoin(assignedBy, eq(shipmentApprovalDelegations.assignedByUserId, assignedBy.id))
    .leftJoin(revokedBy, eq(shipmentApprovalDelegations.revokedByUserId, revokedBy.id))
    .orderBy(desc(shipmentApprovalDelegations.createdAt));

  return rows.map(toRow);
}

export type RepresentativeManagementUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  approvalStatus: string;
  isActive: boolean;
  isLocked: boolean;
  isShipmentRepresentative: boolean;
  /**
   * Linked to a DSS 통합 로그인 account. When true, `role` is decided by the
   * login portal and rewritten on every sign-in, so the screen shows where
   * the value comes from rather than presenting it as locally editable.
   */
  isSsoManaged: boolean;
};

/**
 * Every non-deleted user, for the admin flag/unflag list — includes
 * currently-ineligible users too (so the UI can show *why* a given user's
 * flag control is disabled: inactive/locked/unapproved), not just
 * currently-eligible ones.
 */
export async function listUsersForRepresentativeManagement(): Promise<RepresentativeManagementUserRow[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      approvalStatus: users.approvalStatus,
      isActive: users.isActive,
      lockedAt: users.lockedAt,
      isShipmentRepresentative: users.isShipmentRepresentative,
      ssoSubject: users.ssoSubject,
    })
    .from(users)
    .where(eq(users.isDeleted, false))
    .orderBy(users.name);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    approvalStatus: row.approvalStatus,
    isActive: row.isActive,
    isLocked: row.lockedAt !== null,
    isShipmentRepresentative: row.isShipmentRepresentative,
    // The subject itself never leaves the server — the screen only needs to
    // know that one exists.
    isSsoManaged: row.ssoSubject !== null,
  }));
}

export async function countActiveShipmentRepresentatives(): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.isShipmentRepresentative, true),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    );
  return rows.length;
}

export type ShipmentDecideAuthorization =
  | { allowed: true; mode: "DIRECT" }
  | { allowed: true; mode: "DELEGATED"; representativeId: string; representativeName: string }
  | { allowed: false };

/**
 * UI hint only (whether to show the FINAL_SHIPMENT approve/reject buttons,
 * and how to label them) — never the enforcement boundary.
 * decideRepairCaseApproval() (mutation layer) independently re-derives and
 * re-verifies every one of these conditions itself, inside its own
 * transaction, exactly like every other server-re-checks-what-the-UI-hid
 * pattern in this codebase.
 */
export async function resolveShipmentDecideAuthorization(
  actorUserId: string
): Promise<ShipmentDecideAuthorization> {
  const [actor] = await db
    .select({
      isShipmentRepresentative: users.isShipmentRepresentative,
      approvalStatus: users.approvalStatus,
      isActive: users.isActive,
      lockedAt: users.lockedAt,
    })
    .from(users)
    .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));

  if (!actor || actor.approvalStatus !== "APPROVED" || !actor.isActive || actor.lockedAt !== null) {
    return { allowed: false };
  }
  if (actor.isShipmentRepresentative) {
    return { allowed: true, mode: "DIRECT" };
  }

  const now = new Date();
  const candidates = await db
    .select({
      representativeUserId: shipmentApprovalDelegations.representativeUserId,
      representativeName: representative.name,
      representativeApprovalStatus: representative.approvalStatus,
      representativeIsActive: representative.isActive,
      representativeLockedAt: representative.lockedAt,
      representativeIsShipmentRepresentative: representative.isShipmentRepresentative,
      representativeIsDeleted: representative.isDeleted,
    })
    .from(shipmentApprovalDelegations)
    .innerJoin(representative, eq(shipmentApprovalDelegations.representativeUserId, representative.id))
    .where(
      and(
        eq(shipmentApprovalDelegations.delegateUserId, actorUserId),
        eq(shipmentApprovalDelegations.status, "ACTIVE"),
        lte(shipmentApprovalDelegations.startsAt, now),
        gt(shipmentApprovalDelegations.endsAt, now)
      )
    );

  const validCandidate = candidates.find(
    (c) =>
      c.representativeIsShipmentRepresentative &&
      c.representativeApprovalStatus === "APPROVED" &&
      c.representativeIsActive &&
      c.representativeLockedAt === null &&
      !c.representativeIsDeleted
  );
  if (validCandidate) {
    return {
      allowed: true,
      mode: "DELEGATED",
      representativeId: validCandidate.representativeUserId,
      representativeName: validCandidate.representativeName,
    };
  }
  return { allowed: false };
}
