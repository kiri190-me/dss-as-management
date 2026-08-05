import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import { repairCaseApprovals, repairCases, users } from "../schema";
import type {
  ApprovalActionResult,
  RepairCaseApprovalType,
} from "@/lib/validation/repair-case-approval-input";

/**
 * Database-backed approval request/decision persistence, replacing the
 * localStorage-only approval subsystem (src/lib/domain/local/approval/) for
 * DATABASE-sourced repair cases. Reuses the same role-eligibility values
 * the local layer already established (REQUEST_ELIGIBLE_ROLES/
 * INSPECTION_DECIDE_ELIGIBLE_ROLES in transitions.ts) as literals here
 * rather than importing them — this module deliberately has no dependency
 * on the local-demo domain layer (same layering choice
 * workflow-transitions.ts already makes for
 * checkTransitionEligibility/checkHoldEligibility, which it *does* import,
 * since those are pure/framework-agnostic; role-list literals are simple
 * enough to duplicate rather than reach across the mock/DB boundary for).
 *
 * FINAL_SHIPMENT decision eligibility uses users.is_shipment_representative
 * (direct only) — no delegation persistence exists yet (see the Phase-1
 * report's flagged architectural decision); delegated_from_user_id is
 * always NULL from this module.
 *
 * No self-approval restriction: the local-demo layer's decideApproval never
 * checks requestedByUserId against the deciding actingUser, so none is
 * added here either (task instruction: preserve current local-mode
 * behavior when a rule isn't already defined).
 */

const REQUEST_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;
const INSPECTION_DECIDE_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;

class ApprovalMutationError extends Error {
  result: ApprovalActionResult & { ok: false };
  constructor(result: ApprovalActionResult & { ok: false }) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: (ApprovalActionResult & { ok: false })["code"], message: string): never {
  throw new ApprovalMutationError({ ok: false, code, message });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

export async function requestRepairCaseApproval(
  repairCaseId: string,
  approvalType: RepairCaseApprovalType,
  actorUserId: string,
  requestReason: string | null
): Promise<ApprovalActionResult> {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: repairCases.id, version: repairCases.version, isLocked: repairCases.isLocked })
        .from(repairCases)
        .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));
      if (!current) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
      if (current.isLocked) {
        fail("CASE_LOCKED", "출하 완료 후 잠금된 접수 건입니다. 이 작업을 수행할 수 없습니다.");
      }

      const [actor] = await tx
        .select({ role: users.role, approvalStatus: users.approvalStatus })
        .from(users)
        .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
      if (!actor) fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
      if (
        actor.approvalStatus !== "APPROVED" ||
        !(REQUEST_ELIGIBLE_ROLES as readonly string[]).includes(actor.role)
      ) {
        fail("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      }

      if (approvalType === "FINAL_SHIPMENT") {
        const [latestInspection] = await tx
          .select({ status: repairCaseApprovals.status, versionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest })
          .from(repairCaseApprovals)
          .where(
            and(
              eq(repairCaseApprovals.repairCaseId, repairCaseId),
              eq(repairCaseApprovals.approvalType, "REPAIR_INSPECTION")
            )
          )
          .orderBy(desc(repairCaseApprovals.requestedAt))
          .limit(1);
        const inspectionValid =
          latestInspection?.status === "APPROVED" && latestInspection.versionAtRequest === current.version;
        if (!inspectionValid) {
          fail("FORBIDDEN", "수리 검수 승인이 완료된 후 최종 출하 승인을 요청할 수 있습니다.");
        }
      }

      const [existingActive] = await tx
        .select({ id: repairCaseApprovals.id })
        .from(repairCaseApprovals)
        .where(
          and(
            eq(repairCaseApprovals.repairCaseId, repairCaseId),
            eq(repairCaseApprovals.approvalType, approvalType),
            eq(repairCaseApprovals.status, "REQUESTED")
          )
        );
      if (existingActive) {
        fail("ALREADY_REQUESTED", "이미 처리 대기 중인 승인 요청이 있습니다.");
      }

      const [inserted] = await tx
        .insert(repairCaseApprovals)
        .values({
          repairCaseId,
          approvalType,
          status: "REQUESTED",
          requestedByUserId: actorUserId,
          requestReason,
          repairCaseVersionAtRequest: current.version,
        })
        .returning({ id: repairCaseApprovals.id });

      return { ok: true, id: inserted.id };
    });
  } catch (err) {
    if (err instanceof ApprovalMutationError) return err.result;
    if (isUniqueViolation(err)) {
      return { ok: false, code: "ALREADY_REQUESTED", message: "이미 처리 대기 중인 승인 요청이 있습니다." };
    }
    throw err;
  }
}

export async function decideRepairCaseApproval(
  repairCaseId: string,
  approvalType: RepairCaseApprovalType,
  decision: "APPROVED" | "REJECTED",
  actorUserId: string,
  decisionReason: string | null
): Promise<ApprovalActionResult> {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: repairCases.id })
        .from(repairCases)
        .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));
      if (!current) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

      const [actor] = await tx
        .select({ role: users.role, approvalStatus: users.approvalStatus, isShipmentRepresentative: users.isShipmentRepresentative })
        .from(users)
        .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
      if (!actor) fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
      if (actor.approvalStatus !== "APPROVED") {
        fail("FORBIDDEN", "승인되지 않은 계정은 이 작업을 수행할 수 없습니다.");
      }
      if (approvalType === "REPAIR_INSPECTION") {
        if (!(INSPECTION_DECIDE_ELIGIBLE_ROLES as readonly string[]).includes(actor.role)) {
          fail("FORBIDDEN", "현재 역할로는 이 작업을 수행할 수 없습니다.");
        }
      } else {
        if (!actor.isShipmentRepresentative) {
          fail("FORBIDDEN", "대표만 최종 출하 승인을 처리할 수 있습니다.");
        }
      }

      // Row-lock the latest request for this (case, type) so a concurrent
      // decision on the same row blocks here instead of racing — the
      // second transaction re-reads post-commit and finds status no longer
      // 'REQUESTED', returning CONFLICT rather than double-deciding.
      const [latest] = await tx
        .select({ id: repairCaseApprovals.id, status: repairCaseApprovals.status })
        .from(repairCaseApprovals)
        .where(
          and(
            eq(repairCaseApprovals.repairCaseId, repairCaseId),
            eq(repairCaseApprovals.approvalType, approvalType)
          )
        )
        .orderBy(desc(repairCaseApprovals.requestedAt))
        .limit(1)
        .for("update");

      if (!latest) fail("NOT_FOUND", "관련 승인 요청을 찾을 수 없습니다.");
      if (latest.status !== "REQUESTED") {
        fail("CONFLICT", "이미 처리된 승인 요청입니다. 최신 정보를 다시 불러와 주세요.");
      }

      if (decision === "REJECTED" && !decisionReason) {
        fail("VALIDATION_ERROR", "반려 시에는 사유를 입력해야 합니다.");
      }

      const updated = await tx
        .update(repairCaseApprovals)
        .set({
          status: decision,
          decidedByUserId: actorUserId,
          decidedAt: new Date(),
          decisionReason,
          updatedAt: new Date(),
        })
        .where(and(eq(repairCaseApprovals.id, latest.id), eq(repairCaseApprovals.status, "REQUESTED")))
        .returning({ id: repairCaseApprovals.id });

      if (updated.length === 0) {
        fail("CONFLICT", "이미 처리된 승인 요청입니다. 최신 정보를 다시 불러와 주세요.");
      }

      return { ok: true, id: updated[0].id };
    });
  } catch (err) {
    if (err instanceof ApprovalMutationError) return err.result;
    throw err;
  }
}
