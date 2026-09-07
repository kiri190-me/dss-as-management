import "server-only";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "../client";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { shipmentApprovalDelegations, users } from "../schema";
import type { ShipmentManagementResult, ShipmentManagementResultCode } from "@/lib/validation/shipment-delegation-input";

/**
 * shipment_approval_delegations create/revoke — authorization per the
 * task's preferred rule (no can_assign_shipment_delegation flag, see the
 * Phase-1 report): the representative may delegate their own authority;
 * SUPER_ADMIN may assign/revoke on behalf of any representative; nobody
 * else.
 */

class DelegationMutationError extends Error {
  result: ShipmentManagementResult & { ok: false };
  constructor(result: ShipmentManagementResult & { ok: false }) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: ShipmentManagementResultCode, message: string): never {
  throw new DelegationMutationError({ ok: false, code, message });
}

type EligibleUser = {
  id: string;
  approvalStatus: string;
  isActive: boolean;
  lockedAt: Date | null;
  isDeleted: boolean;
};

function isEligibleActor(user: EligibleUser | undefined): user is EligibleUser {
  return !!user && !user.isDeleted && user.approvalStatus === "APPROVED" && user.isActive && user.lockedAt === null;
}

export async function createShipmentDelegation(
  representativeUserId: string,
  delegateUserId: string,
  startsAt: Date,
  endsAt: Date,
  actorUserId: string,
  reason: string | null
): Promise<ShipmentManagementResult> {
  if (representativeUserId === delegateUserId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "대표 자신을 대리 승인자로 지정할 수 없습니다." };
  }
  // Defense in depth: the Server Action layer already runs
  // validateDelegationDateRange on the raw string input before this
  // function is ever called, but this mutation is also called/tested
  // directly — without this check, an invalid range reaches the DB and
  // surfaces as a raw CHECK-constraint PostgresError instead of a clean
  // result, same reasoning as decideRepairCaseApproval's own inline
  // REJECTED-reason check.
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, code: "INVALID_TIME_RANGE", message: "종료 일시는 시작 일시보다 이후여야 합니다." };
  }

  try {
    return await db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus, isActive: users.isActive, lockedAt: users.lockedAt, isDeleted: users.isDeleted, isDeveloper: users.isDeveloper })
        .from(users)
        .where(eq(users.id, actorUserId));
      if (!isEligibleActor(actor)) fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
      const isSelfDelegating = actor.id === representativeUserId;
      // 본인 위임은 권한과 무관하게 열려 있다 — 설정으로 좁히더라도 대표가
      // 자기 위임을 못 하게 되면 대표 제도 자체가 멈춘다. 남을 대신할 때만
      // 권한을 본다.
      if (
        !isSelfDelegating &&
        !(await hasPermission(actor, "users.shipmentRepresentatives", "MANAGE"))
      ) {
        fail("FORBIDDEN", "대표 본인 또는 권한이 있는 관리자만 위임을 지정할 수 있습니다.");
      }

      const [representativeRow] = await tx
        .select({
          isShipmentRepresentative: users.isShipmentRepresentative,
          approvalStatus: users.approvalStatus,
          isActive: users.isActive,
          lockedAt: users.lockedAt,
          isDeleted: users.isDeleted,
        })
        .from(users)
        .where(eq(users.id, representativeUserId));
      if (
        !representativeRow ||
        representativeRow.isDeleted ||
        !representativeRow.isShipmentRepresentative ||
        representativeRow.approvalStatus !== "APPROVED" ||
        !representativeRow.isActive ||
        representativeRow.lockedAt !== null
      ) {
        fail("INVALID_USER", "대표로 지정된, 활성 상태의 계정만 위임의 근거가 될 수 있습니다.");
      }

      const [delegateRow] = await tx
        .select({ approvalStatus: users.approvalStatus, isActive: users.isActive, lockedAt: users.lockedAt, isDeleted: users.isDeleted })
        .from(users)
        .where(eq(users.id, delegateUserId));
      if (
        !delegateRow ||
        delegateRow.isDeleted ||
        delegateRow.approvalStatus !== "APPROVED" ||
        !delegateRow.isActive ||
        delegateRow.lockedAt !== null
      ) {
        fail("INVALID_USER", "활성 상태의 승인된 계정만 대리 승인자로 지정할 수 있습니다.");
      }

      // Advisory transaction lock keyed on the (representative, delegate)
      // pair — serializes concurrent create attempts for the SAME pair so
      // the overlap check below can never race (a plain SELECT-then-INSERT
      // has a phantom-row window: two concurrent transactions can both see
      // zero conflicting rows and both insert). Held only for this
      // transaction's duration, released automatically on commit/rollback.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${representativeUserId} || ':' || ${delegateUserId}, 0))`
      );

      const overlapping = await tx
        .select({ id: shipmentApprovalDelegations.id })
        .from(shipmentApprovalDelegations)
        .where(
          and(
            eq(shipmentApprovalDelegations.representativeUserId, representativeUserId),
            eq(shipmentApprovalDelegations.delegateUserId, delegateUserId),
            eq(shipmentApprovalDelegations.status, "ACTIVE"),
            lt(shipmentApprovalDelegations.startsAt, endsAt),
            gt(shipmentApprovalDelegations.endsAt, startsAt)
          )
        )
        .limit(1);
      if (overlapping.length > 0) {
        fail("OVERLAPPING_DELEGATION", "동일한 대표-대리 승인자 조합에 대해 기간이 겹치는 위임이 이미 존재합니다.");
      }

      const [inserted] = await tx
        .insert(shipmentApprovalDelegations)
        .values({
          representativeUserId,
          delegateUserId,
          startsAt,
          endsAt,
          status: "ACTIVE",
          assignedByUserId: actorUserId,
          reason,
        })
        .returning({ id: shipmentApprovalDelegations.id });

      return { ok: true, id: inserted.id };
    });
  } catch (err) {
    if (err instanceof DelegationMutationError) return err.result;
    throw err;
  }
}

export async function revokeShipmentDelegation(
  delegationId: string,
  actorUserId: string
): Promise<ShipmentManagementResult> {
  try {
    return await db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus, isActive: users.isActive, lockedAt: users.lockedAt, isDeleted: users.isDeleted, isDeveloper: users.isDeveloper })
        .from(users)
        .where(eq(users.id, actorUserId));
      if (!isEligibleActor(actor)) fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");

      const [delegation] = await tx
        .select({
          id: shipmentApprovalDelegations.id,
          representativeUserId: shipmentApprovalDelegations.representativeUserId,
          status: shipmentApprovalDelegations.status,
        })
        .from(shipmentApprovalDelegations)
        .where(eq(shipmentApprovalDelegations.id, delegationId))
        .for("update");
      if (!delegation) fail("NOT_FOUND", "해당 위임을 찾을 수 없습니다.");
      if (delegation.status === "REVOKED") {
        fail("CONFLICT", "이미 철회된 위임입니다. 최신 정보를 다시 불러와 주세요.");
      }

      const isSelfRevoking = actor.id === delegation.representativeUserId;
      if (
        !isSelfRevoking &&
        !(await hasPermission(actor, "users.shipmentRepresentatives", "MANAGE"))
      ) {
        fail("FORBIDDEN", "대표 본인 또는 권한이 있는 관리자만 위임을 철회할 수 있습니다.");
      }

      const updated = await tx
        .update(shipmentApprovalDelegations)
        .set({
          status: "REVOKED",
          revokedByUserId: actorUserId,
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(shipmentApprovalDelegations.id, delegationId), eq(shipmentApprovalDelegations.status, "ACTIVE")))
        .returning({ id: shipmentApprovalDelegations.id });

      if (updated.length === 0) {
        fail("CONFLICT", "이미 철회된 위임입니다. 최신 정보를 다시 불러와 주세요.");
      }

      return { ok: true, id: updated[0].id };
    });
  } catch (err) {
    if (err instanceof DelegationMutationError) return err.result;
    throw err;
  }
}
