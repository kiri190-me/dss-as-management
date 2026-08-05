import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../client";
import { repairCaseApprovals, representativeChangeHistory, users } from "../schema";
import type { ShipmentManagementResult, ShipmentManagementResultCode } from "@/lib/validation/shipment-delegation-input";

/**
 * users.is_shipment_representative flag management — SUPER_ADMIN only (the
 * most sensitive permission in this feature: who can ever approve
 * shipments), re-reading and row-locking the target inside the same
 * transaction as the write, with every change recorded to
 * representative_change_history (never a broad audit_logs table — see the
 * schema file's comment).
 */

class RepresentativeMutationError extends Error {
  result: ShipmentManagementResult & { ok: false };
  constructor(result: ShipmentManagementResult & { ok: false }) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: ShipmentManagementResultCode, message: string): never {
  throw new RepresentativeMutationError({ ok: false, code, message });
}

export async function setShipmentRepresentative(
  targetUserId: string,
  flag: boolean,
  actorUserId: string,
  reason: string | null,
  confirmLastRepresentativeRemoval: boolean
): Promise<ShipmentManagementResult> {
  try {
    return await db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ role: users.role, approvalStatus: users.approvalStatus })
        .from(users)
        .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
      if (!actor) fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
      if (actor.approvalStatus !== "APPROVED" || actor.role !== "SUPER_ADMIN") {
        fail("FORBIDDEN", "최고관리자만 출하 승인 대표 지정을 변경할 수 있습니다.");
      }

      // Row-locked re-read of the target — the transactional backstop that
      // makes two concurrent admin toggles on the same user resolve to
      // exactly one committed outcome (the second transaction blocks here,
      // then re-reads the post-commit state).
      const [target] = await tx
        .select({
          id: users.id,
          isShipmentRepresentative: users.isShipmentRepresentative,
          approvalStatus: users.approvalStatus,
          isActive: users.isActive,
          lockedAt: users.lockedAt,
          isDeleted: users.isDeleted,
        })
        .from(users)
        .where(eq(users.id, targetUserId))
        .for("update");
      if (!target || target.isDeleted) {
        fail("NOT_FOUND", "대상 사용자를 찾을 수 없습니다.");
      }
      if (target.isShipmentRepresentative === flag) {
        fail("CONFLICT", flag ? "이미 대표로 지정되어 있습니다." : "이미 대표가 아닙니다.");
      }

      if (flag) {
        if (target.approvalStatus !== "APPROVED") {
          fail("INVALID_USER", "승인되지 않은 계정은 대표로 지정할 수 없습니다.");
        }
        if (!target.isActive) {
          fail("INVALID_USER", "비활성화된 계정은 대표로 지정할 수 없습니다.");
        }
        if (target.lockedAt !== null) {
          fail("INVALID_USER", "잠긴 계정은 대표로 지정할 수 없습니다.");
        }
      } else {
        const remainingRepresentatives = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.isShipmentRepresentative, true),
              eq(users.isDeleted, false),
              eq(users.isActive, true),
              ne(users.id, targetUserId)
            )
          );
        if (remainingRepresentatives.length === 0) {
          const [pending] = await tx
            .select({ id: repairCaseApprovals.id })
            .from(repairCaseApprovals)
            .where(and(eq(repairCaseApprovals.approvalType, "FINAL_SHIPMENT"), eq(repairCaseApprovals.status, "REQUESTED")))
            .limit(1);
          if (pending && !confirmLastRepresentativeRemoval) {
            fail(
              "LAST_REPRESENTATIVE",
              "대기 중인 최종 출하 승인 요청이 있는 상태에서 마지막 대표를 해제하려고 합니다. 계속하려면 다시 확인해 주세요."
            );
          }
        }
      }

      await tx
        .update(users)
        .set({ isShipmentRepresentative: flag, updatedAt: new Date() })
        .where(eq(users.id, targetUserId));

      const [historyRow] = await tx
        .insert(representativeChangeHistory)
        .values({
          targetUserId,
          previousValue: target.isShipmentRepresentative,
          newValue: flag,
          changedByUserId: actorUserId,
          reason,
        })
        .returning({ id: representativeChangeHistory.id });

      return { ok: true, id: historyRow.id };
    });
  } catch (err) {
    if (err instanceof RepresentativeMutationError) return err.result;
    throw err;
  }
}
