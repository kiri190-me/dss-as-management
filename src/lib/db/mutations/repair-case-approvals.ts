import "server-only";
import { and, desc, eq, gt, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { repairCaseApprovals, repairCases, shipmentApprovalDelegations, users } from "../schema";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import { mayDecideAssignedApproval } from "@/lib/auth/approval-assignment";
import type {
  ApprovalActionResult,
  RepairCaseApprovalType,
} from "@/lib/validation/repair-case-approval-input";

const delegationRepresentative = alias(users, "delegation_representative");

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
 * FINAL_SHIPMENT decision eligibility: either the actor is a currently-
 * eligible representative (direct — delegated_from_user_id stays null), or
 * the actor is the currently-valid delegate of a currently-eligible
 * representative (delegated — delegated_from_user_id stores that
 * representative, decided_by_user_id stores the actual delegate; see
 * shipment-delegations.ts for delegation create/revoke). Both the
 * representative's and the delegate's eligibility are re-verified live,
 * inside this same transaction, never trusted from the delegation row
 * alone (a representative can be unflagged, or an account
 * deactivated/locked, after a delegation was granted).
 *
 * 지정 승인자(assigned_approver_user_id): 요청할 때 「누가 처리할지」를 고를 수
 * 있고, 고르지 않으면(NULL) 지금까지와 완전히 같다 — 자격 있는 사람 누구나
 * 처리한다. 지정이 있으면 그 사람(과 최고관리자)만 처리할 수 있다. 그 판정은
 * 여기서 새로 적지 않고 mayDecideAssignedApproval(auth/approval-assignment.ts)
 * 하나만 부른다 — 화면·서버 액션·알림 조회도 같은 함수를 본다. 이 관문은 아래
 * 자격 검사들을 **약하게 만들지 않고 그 위에 얹힌다**.
 *
 * No self-approval restriction: the local-demo layer's decideApproval never
 * checks requestedByUserId against the deciding actingUser, so none is
 * added here either (task instruction: preserve current local-mode
 * behavior when a rule isn't already defined).
 */

const REQUEST_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;
/**
 * 검수 승인을 **결재할 수 있는** 역할. 내보내는 이유는 하나뿐이다:
 * queries/repair-case-approvals.ts 의 「지정 후보 목록」이 **같은 목록**으로
 * 판정해야 하기 때문이다. 목록을 한 벌 더 만들면 화면에는 고를 수 있게
 * 나오는데 요청하면 서버가 거절하는(또는 그 반대의) 어긋남이 생긴다.
 */
export const INSPECTION_DECIDE_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;

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

/**
 * 「누구에게 보낼까」 — 선택이다. `null`(기본값)이면 **지정 없음**이고, 그것은
 * 이 인자가 생기기 전과 완전히 같은 동작이다(자격 있는 사람 누구나 처리).
 * 스키마 칸 주석(schema/repair-case-approvals.ts)에 뜻이 적혀 있다.
 */
export async function requestRepairCaseApproval(
  repairCaseId: string,
  approvalType: RepairCaseApprovalType,
  actorUserId: string,
  requestReason: string | null,
  assignedApproverUserId: string | null = null
): Promise<ApprovalActionResult> {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: repairCases.id, version: repairCases.version, isLocked: repairCases.isLocked, billingType: repairCases.billingType })
        .from(repairCases)
        .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));
      if (!current) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
      if (current.billingType === "PENDING_DECISION") {
        fail("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 승인을 요청할 수 있습니다.");
      }
      if (current.isLocked) {
        fail("CASE_LOCKED", "출하 완료 후 잠금된 접수 건입니다. 이 작업을 수행할 수 없습니다.");
      }

      const [actor] = await tx
        .select({ role: users.role, approvalStatus: users.approvalStatus, isDeveloper: users.isDeveloper })
        .from(users)
        .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
      if (!actor) fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
      if (
        actor.approvalStatus !== "APPROVED" ||
        !actorHasAllowedRole(actor, REQUEST_ELIGIBLE_ROLES)
      ) {
        fail("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      }

      // 🔴 지정 대상이 실제로 이 승인을 처리할 수 있는 사람인지 **이 트랜잭션
      // 안에서** 확인한다. 확인하지 않으면 자격 없는 사람에게 지정된 요청이
      // 영영 처리되지 않는 상태로 남는다(지정된 사람은 자격이 없어 막히고,
      // 다른 자격자는 지정 관문에 막힌다 — 최고관리자만 풀 수 있는 매듭이다).
      //
      // 판정하는 것은 두 가지뿐이고, 둘 다 이미 있는 규칙을 그대로 쓴다:
      //  - 계정 상태: 승인됨 · 활성 · 잠기지 않음 · 삭제 안 됨
      //  - 자격: INSPECTION_DECIDE_ELIGIBLE_ROLES (새 역할 목록을 만들지 않는다)
      //
      // 계정 상태를 결재 시점보다 넓게 보는 것은 의도다. 검수 결재 자격 검사는
      // 지금 역할+승인 상태만 보지만(그 검사를 건드리지 않는다), **앞으로
      // 처리해 줄 사람**을 고르는 자리에서는 비활성·잠긴 계정을 고르게 두면 안
      // 된다. 좁게 판정해도 권한이 생기는 방향으로는 실패하지 않는다 — 지정을
      // 못 하게 막을 뿐이다.
      if (assignedApproverUserId !== null) {
        if (approvalType !== "REPAIR_INSPECTION") {
          // FINAL_SHIPMENT 의 지정(순차 승인)은 다음 조각이다. **무시하지 않고
          // 거절한다** — 조용히 버리면 요청자는 지정한 줄 알고 넘어가는데
          // 실제로는 아무에게도 지정되지 않는다. 그 어긋남은 화면에 아무 표시도
          // 남기지 않으므로, 지금은 눈에 보이게 막는 쪽이 안전하다.
          fail(
            "ASSIGNEE_NOT_ELIGIBLE",
            "최종 출하 승인은 아직 처리자를 지정할 수 없습니다."
          );
        }
        const [assignee] = await tx
          .select({
            name: users.name,
            role: users.role,
            approvalStatus: users.approvalStatus,
            isActive: users.isActive,
            lockedAt: users.lockedAt,
            isDeveloper: users.isDeveloper,
          })
          .from(users)
          .where(and(eq(users.id, assignedApproverUserId), eq(users.isDeleted, false)));
        if (!assignee) {
          fail("ASSIGNEE_NOT_ELIGIBLE", "지정하려는 사용자를 찾을 수 없습니다.");
        }
        if (assignee.approvalStatus !== "APPROVED") {
          fail("ASSIGNEE_NOT_ELIGIBLE", `${assignee.name} 님의 계정이 아직 승인되지 않아 지정할 수 없습니다.`);
        }
        if (!assignee.isActive || assignee.lockedAt !== null) {
          fail("ASSIGNEE_NOT_ELIGIBLE", `${assignee.name} 님의 계정이 비활성화되었거나 잠겨 있어 지정할 수 없습니다.`);
        }
        if (!actorHasAllowedRole(assignee, INSPECTION_DECIDE_ELIGIBLE_ROLES)) {
          fail("ASSIGNEE_NOT_ELIGIBLE", `${assignee.name} 님은 수리 검수 승인을 처리할 수 있는 역할이 아닙니다.`);
        }
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
          assignedApproverUserId,
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
        .select({ id: repairCases.id, billingType: repairCases.billingType })
        .from(repairCases)
        .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));
      if (!current) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
      if (current.billingType === "PENDING_DECISION") {
        fail("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 승인 또는 반려할 수 있습니다.");
      }

      const [actor] = await tx
        .select({
          role: users.role,
          approvalStatus: users.approvalStatus,
          isShipmentRepresentative: users.isShipmentRepresentative,
          isActive: users.isActive,
          lockedAt: users.lockedAt,
          isDeveloper: users.isDeveloper,
        })
        .from(users)
        .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
      if (!actor) fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
      if (actor.approvalStatus !== "APPROVED") {
        fail("FORBIDDEN", "승인되지 않은 계정은 이 작업을 수행할 수 없습니다.");
      }
      let delegatedFromUserId: string | null = null;
      if (approvalType === "REPAIR_INSPECTION") {
        // Unchanged from before this task — REPAIR_INSPECTION eligibility
        // stays role + approvalStatus only, deliberately not touched here.
        if (!actorHasAllowedRole(actor, INSPECTION_DECIDE_ELIGIBLE_ROLES)) {
          fail("FORBIDDEN", "현재 역할로는 이 작업을 수행할 수 없습니다.");
        }
      } else if (!actor.isActive || actor.lockedAt !== null) {
        // Applies to both direct representatives and delegates alike (the
        // task's Delegation Validity list explicitly requires "the delegate
        // is active ... and non-locked"; a representative deciding directly
        // must meet the same bar — resolveShipmentDecideAuthorization's UI
        // hint already checks this, so the mutation must too). Deliberately
        // scoped to the FINAL_SHIPMENT branch only — REPAIR_INSPECTION's
        // eligibility above is untouched.
        fail("FORBIDDEN", "비활성화되었거나 잠긴 계정은 이 작업을 수행할 수 없습니다.");
      } else if (!actor.isShipmentRepresentative) {
        // Not a direct representative — check for a currently-valid active
        // delegation (window includes now, not revoked) whose representative
        // is still itself eligible right now.
        const now = new Date();
        const delegations = await tx
          .select({
            representativeUserId: shipmentApprovalDelegations.representativeUserId,
            representativeIsShipmentRepresentative: delegationRepresentative.isShipmentRepresentative,
            representativeApprovalStatus: delegationRepresentative.approvalStatus,
            representativeIsActive: delegationRepresentative.isActive,
            representativeLockedAt: delegationRepresentative.lockedAt,
            representativeIsDeleted: delegationRepresentative.isDeleted,
          })
          .from(shipmentApprovalDelegations)
          .innerJoin(
            delegationRepresentative,
            eq(shipmentApprovalDelegations.representativeUserId, delegationRepresentative.id)
          )
          .where(
            and(
              eq(shipmentApprovalDelegations.delegateUserId, actorUserId),
              eq(shipmentApprovalDelegations.status, "ACTIVE"),
              lte(shipmentApprovalDelegations.startsAt, now),
              gt(shipmentApprovalDelegations.endsAt, now)
            )
          )
          // Locks both the candidate delegation row(s) and the joined
          // representative's users row for this transaction's duration —
          // revokeShipmentDelegation() and setShipmentRepresentative() each
          // already lock exactly these same rows before writing, so a
          // decide() racing against either one serializes correctly instead
          // of reading a stale eligible/valid snapshot that a concurrent
          // revoke/unflag is simultaneously invalidating.
          .for("update");

        const validDelegation = delegations.find(
          (d) =>
            d.representativeIsShipmentRepresentative &&
            d.representativeApprovalStatus === "APPROVED" &&
            d.representativeIsActive &&
            d.representativeLockedAt === null &&
            !d.representativeIsDeleted
        );
        if (!validDelegation) {
          fail("FORBIDDEN", "대표 또는 유효한 위임을 받은 대리 승인자만 최종 출하 승인을 처리할 수 있습니다.");
        }
        delegatedFromUserId = validDelegation.representativeUserId;
      }

      // Row-lock the latest request for this (case, type) so a concurrent
      // decision on the same row blocks here instead of racing — the
      // second transaction re-reads post-commit and finds status no longer
      // 'REQUESTED', returning CONFLICT rather than double-deciding.
      const [latest] = await tx
        .select({
          id: repairCaseApprovals.id,
          status: repairCaseApprovals.status,
          assignedApproverUserId: repairCaseApprovals.assignedApproverUserId,
        })
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
      // 🔴 지정 관문 — **위의 자격 검사를 전부 통과한 뒤에** 얹는다. 순서가
      // 뒤집히면 자격 없는 사람도 지정만 되면 결재할 수 있게 된다(지정이
      // 권한을 만들어 낸다). 위의 검사들은 한 줄도 약해지지 않았다.
      //
      // 지정이 NULL 이면 이 관문은 언제나 참이다 — 지금까지의 동작 그대로다.
      const assignedApproverUserId = latest.assignedApproverUserId;
      if (
        !mayDecideAssignedApproval(assignedApproverUserId, {
          id: actorUserId,
          role: actor.role,
          isDeveloper: actor.isDeveloper,
        })
      ) {
        // 「권한이 없습니다」만 돌려주면 사람은 무엇을 해야 할지 모른다 —
        // 누구에게 지정되어 있는지 이름을 넣는다. 이름을 못 찾는 경우(있을 수
        // 없지만)에도 거절 자체는 유지한다.
        const [assignee] = assignedApproverUserId
          ? await tx.select({ name: users.name }).from(users).where(eq(users.id, assignedApproverUserId))
          : [];
        fail(
          "FORBIDDEN",
          assignee
            ? `이 승인 요청은 ${assignee.name} 님에게 지정되어 있어 다른 사람은 처리할 수 없습니다.`
            : "이 승인 요청은 지정된 승인자만 처리할 수 있습니다."
        );
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
          delegatedFromUserId,
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
