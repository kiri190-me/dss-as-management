import "server-only";
import { and, desc, eq, gt, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { repairCaseApprovals, repairCases, shipmentApprovalDelegations, users } from "../schema";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import { approvalFollowsRoute, mayDecideAssignedApproval } from "@/lib/auth/approval-assignment";
import {
  getCurrentShipmentApprovalRouteChain,
  getShipmentApprovalRouteStep,
} from "../queries/shipment-approval-routes";
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
 * 결재선(순차 출하 승인): 최종 출하 승인을 요청할 때 결재선 판
 * (shipment_approval_routes)이 있으면 **1단계 행 하나만** 만들고, 그 행이
 * 승인될 때마다 같은 판의 다음 단계 행을 하나씩 이어 만든다(요청 행에
 * route_id · route_step_order 를 적어 둔다). 단계마다 요청 행이 하나씩이므로
 * 「한 번에 한 단계」는 repair_case_approvals_one_active_request 부분 유니크가
 * 그대로 보증하고, 출하 문(resolveApprovalValidity)은 「가장 최근 행이
 * APPROVED 인가」만 보므로 중간 단계에서는 저절로 닫혀 있다 — 그 두 곳은 한
 * 줄도 고치지 않았다. 결재선을 타는 행에서는 대표·위임 판정을 건너뛰고 지정
 * 관문만 본다(절차가 대표를 대신한다). 판이 없거나 단계가 0개면 세 칸이 전부
 * NULL 로 남아 이 기능이 생기기 전과 완전히 같이 돈다.
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

      // 🔴 최종 출하 승인은 결재선(판)이 있으면 그 **1단계**로 시작한다.
      //
      // 판이 없거나 단계가 0개면 세 칸(route_id · route_step_order ·
      // assigned_approver_user_id)이 전부 NULL 로 남고, 그때는 이 기능이 생기기
      // 전과 완전히 같이 돈다 — 「출하 대표」·위임 방식이다. 빈 판은 「절차를
      // 쓰지 않겠다」는 정상적인 뜻이라 판 없음과 구분하지 않는다.
      //
      // 지정은 **절차가 정한다.** 위에서 호출자가 넘긴 지정을 FINAL_SHIPMENT
      // 에서 거절하는 검사는 그대로 두었다 — 사람이 출하 요청 때 받는 사람을
      // 고르는 길은 여전히 없고, 조용히 무시하면 요청자는 지정한 줄 알지만
      // 실제로는 아무에게도 지정되지 않는다. 여기서 넣는 지정은 그 검사와
      // 별개의 경로다.
      //
      // 「현재 절차」의 정의(version 이 가장 큰 판)는 여기 적지 않는다 —
      // queries/shipment-approval-routes.ts 하나에만 있고, 이 트랜잭션 안에서
      // 읽기 위해 tx 를 받는 함수를 부른다.
      let routeId: string | null = null;
      let routeStepOrder: number | null = null;
      let routeAssignedApproverUserId: string | null = null;
      if (approvalType === "FINAL_SHIPMENT") {
        const route = await getCurrentShipmentApprovalRouteChain(tx);
        const firstStep = route?.steps[0];
        if (route && firstStep) {
          routeId = route.routeId;
          routeStepOrder = firstStep.stepOrder;
          routeAssignedApproverUserId = firstStep.approverUserId;
        }
      }

      const [inserted] = await tx
        .insert(repairCaseApprovals)
        .values({
          repairCaseId,
          approvalType,
          status: "REQUESTED",
          requestedByUserId: actorUserId,
          requestReason,
          assignedApproverUserId: routeAssignedApproverUserId ?? assignedApproverUserId,
          routeId,
          routeStepOrder,
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
      // Row-lock the latest request for this (case, type) so a concurrent
      // decision on the same row blocks here instead of racing — the
      // second transaction re-reads post-commit and finds status no longer
      // 'REQUESTED', returning CONFLICT rather than double-deciding.
      //
      // 🔴 자격 검사보다 **먼저** 읽는다(예전에는 뒤였다). 이 행의 route_id 가
      // 「누가 결재하는가」를 가르기 때문에, 그것을 알기 전에는 대표·위임
      // 판정을 할지 말지조차 정할 수 없다. 순서가 바뀐 결과로, 승인 요청 행이
      // 없는 건에는 자격과 무관하게 NOT_FOUND 가 먼저 나온다(예전에는 자격
      // 없는 사람이 FORBIDDEN 을 받았다). 요청이 없는데 「권한이 없습니다」라고
      // 말하는 쪽이 오히려 사실과 멀었다.
      const [latest] = await tx
        .select({
          id: repairCaseApprovals.id,
          status: repairCaseApprovals.status,
          assignedApproverUserId: repairCaseApprovals.assignedApproverUserId,
          routeId: repairCaseApprovals.routeId,
          routeStepOrder: repairCaseApprovals.routeStepOrder,
          requestedByUserId: repairCaseApprovals.requestedByUserId,
          requestReason: repairCaseApprovals.requestReason,
          repairCaseVersionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
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

      // 이 행이 결재선(판)의 한 단계인가. 그렇다면 「누가 결재하는가」는 절차가
      // 정한다 — 대표·위임 판정을 건너뛰고 아래 지정 관문 하나만 본다.
      // 절차가 「출하 대표」를 **대신하는** 것이 이 기능의 설계다.
      //
      // 판정은 여기 적지 않는다 — 화면(승인 카드)과 알림 조회도 같은 물음을
      // 물으므로 approvalFollowsRoute(auth/approval-assignment.ts) 하나만
      // 부른다. 「판만 적히고 지정이 빈 행」을 왜 결재선으로 보지 않는지도
      // 그 함수 주석에 있다.
      const followsRoute = approvalFollowsRoute(latest);

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
        //
        // 🔴 결재선 경로에도 그대로 걸린다 — 이 검사가 followsRoute 분기보다
        // 위에 있는 것은 의도다. 비활성·잠긴 계정은 단계 승인자로 지정돼
        // 있어도 결재할 수 없다.
        fail("FORBIDDEN", "비활성화되었거나 잠긴 계정은 이 작업을 수행할 수 없습니다.");
      } else if (followsRoute) {
        // 결재선 경로 — 대표·위임 판정을 하지 않는다. 여기서 대표를 요구하면
        // 절차에 올라간 사람이 대표가 아니라는 이유로 자기 단계를 결재하지
        // 못하게 되어, 절차가 대표를 대신한다는 설계 자체가 성립하지 않는다.
        // 좁히는 일은 아래 지정 관문이 한다 — 그 단계의 승인자(와 최고관리자)만
        // 통과한다. delegatedFromUserId 는 이 경로에서 언제나 null 이다(위임으로
        // 결재한 것이 아니다).
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

      // 🔴 사슬을 잇는다 — 승인됐고, 이 행이 결재선의 한 단계였고, 그 판에
      // 다음 단계가 있으면 다음 요청 행을 하나 만든다.
      //
      // 반드시 위의 UPDATE **뒤**다. 앞 행이 아직 REQUESTED 인 채로 INSERT 하면
      // repair_case_approvals_one_active_request(부분 유니크)에 걸린다. 그
      // 인덱스가 곧 「한 번에 한 단계」의 보증이므로 우회하지 않고 순서로 푼다.
      //
      // 반려면 아무것도 만들지 않는다 — 사슬이 끊기고 처음부터 다시 요청한다.
      if (decision === "APPROVED" && latest.routeId !== null && latest.routeStepOrder !== null) {
        // 「현재 판」이 아니라 **이 행에 적힌 판**으로 다음 단계를 찾는다.
        // 진행 중인 건은 관리자가 절차를 바꿔도 옛 판을 끝까지 따라간다.
        const nextStep = await getShipmentApprovalRouteStep(
          tx,
          latest.routeId,
          latest.routeStepOrder + 1
        );
        if (nextStep) {
          await tx.insert(repairCaseApprovals).values({
            repairCaseId,
            approvalType,
            status: "REQUESTED",
            // 🔴 요청은 여전히 그 사람이 한 것이다. 사슬이 나아갈 뿐이라
            // 요청자·사유를 물려받는다.
            requestedByUserId: latest.requestedByUserId,
            requestReason: latest.requestReason,
            // 🔴 버전도 물려받는다. 단계마다 새로 찍으면 접수 건이 중간에
            // 바뀌었을 때 1단계는 무효인데 3단계만 멀쩡해 보인다 — 접수 건이
            // 바뀌면 결재선 **전체**가 무효여야 한다.
            repairCaseVersionAtRequest: latest.repairCaseVersionAtRequest,
            // 🔴 requested_at 은 물려받지 않는다. 표 기본값(now())을 쓴다. 앞
            // 행과 같은 시각이 되면 「가장 최근 행」을 고르는 조회들
            // (resolveApprovalValidity · getCurrentApprovalsForCase · 알림
            // 조회)이 어느 행을 고를지 정해지지 않는다.
            assignedApproverUserId: nextStep.approverUserId,
            routeId: latest.routeId,
            routeStepOrder: nextStep.stepOrder,
            // delegatedFromUserId 는 결재선 경로에서 언제나 NULL 이다.
          });
        }
      }

      return { ok: true, id: updated[0].id };
    });
  } catch (err) {
    if (err instanceof ApprovalMutationError) return err.result;
    throw err;
  }
}
