import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../client";
import {
  intakeMailRecipients,
  inventoryPartIssueApprovals,
  procedureCaseExecutionNodes,
  repairCaseApprovals,
  repairCases,
  shipmentApprovalDelegations,
  users,
} from "../schema";
import { insertAuditLog } from "./audit-logs";
import {
  acquireShipmentApprovalRouteLock,
  approverBlockReason,
  saveShipmentApprovalRouteInTx,
  ShipmentApprovalRouteSaveRejected,
} from "./shipment-approval-routes";
import { writeRepresentativeFlagChange } from "./shipment-representatives";
import { writeDeveloperFlagChange } from "./developer-flag";
import { revokeActiveDelegationsInTx } from "./shipment-delegations";
import { INSPECTION_DECIDE_ELIGIBLE_ROLES } from "./repair-case-approvals";
import {
  collectUserDeletionImpact,
  inFlightOnOldRouteMessage,
  OPEN_NODE_STATUSES,
  routeUpdateRejectedMessage,
} from "../queries/user-deletion-impact";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import { mayManageDeveloperFlag } from "@/lib/auth/developer-flag-authorization";
import type { ShipmentApprovalRouteScope } from "@/lib/domain/shipment-approval-route";
import {
  approvalSuccessorBlock,
  collectSuccessorExclusions,
  countPendingApprovalsAssignedTo,
  engineerSuccessorBlock,
  replaceApproverInRouteSteps,
  resolveUserDeletionRequirements,
  routeScopeForApprovalKind,
} from "@/lib/domain/user-deletion-rules";
import { validateUserDeletionInput } from "@/lib/validation/user-deletion-input";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";

/**
 * ============================================================================
 * 사용자 계정 삭제 — 한 트랜잭션
 * ============================================================================
 * 사용자 결정(2026-09-13 · 14): 이 시스템의 삭제는 「목록에서 치우고 일을 넘기는 것」이다.
 * 진짜 차단은 통합 로그인 포털의 권한 회수이고, 포털로 다시 들어오면 같은 계정이
 * 되살아난다(queries/users.ts 의 restoreDeletedSsoUser). 그래서 여기서 하는 일은:
 *
 *  - 결재선: 지울 사람이 올라 있는 **현재 판**마다, 그 자리만 결재 이어받을 사람으로
 *    바꾼 새 판을 얹는다(판은 append-only).
 *  - 진행 중 결재: 지울 사람에게 열린 단계는 이어받을 사람에게, 지울 사람이 현재 판의
 *    뒤 단계에 있는 사슬은 새 판으로 옮긴다. 옛 판의 뒤 단계에 남아 있으면 멈춘다.
 *  - 출하 대표: 끈다. 마지막 활성 대표였으면 결재 이어받을 사람을 대표로 세운다.
 *  - 위임: 대표로서든 위임받은 사람으로서든 ACTIVE 인 것을 전부 닫는다.
 *  - 담당: 열린 접수 건은 담당 이어받을 사람에게, 열린 절차 노드는 「접수 건 담당을
 *    따른다」(NULL)로 되돌린다.
 *  - 개발자 표시를 끄고, 접수 메일 수신자 행을 지운다(되살려도 돌아오지 않는다).
 *  - 삭제 네 칸 · sessions_valid_from 을 쓰고 version 을 올린다.
 * 부품 요청 · 불출 신청은 그대로 둔다(사용자 결정 2026-09-14 — 재고 담당자가 반려 ·
 * 불출 · 실행할 수 있어 막히지 않는다).
 *
 * ── 🔴 인가: 진짜 최고관리자만 ────────────────────────────────────────────
 * mayManageDeveloperFlag 와 같은 판정이다 — 개발자 승격으로 최고관리자가 된 사람은
 * 지울 수 없다(사용자 결정 2026-09-13). 행위자의 개발자 표시는 읽지도 않는다. 자기
 * 자신은 지울 수 없다.
 *
 * ── 🔴 잠금 순서 ─────────────────────────────────────────────────────────
 *  1. 결재선 배타 잠금 — 결재선 저장과 같은 열쇠. 삭제끼리도 한 줄로 서므로 두
 *     최고관리자가 서로를 동시에 지워도 뒤에 온 쪽은 2 에서 FORBIDDEN 이 된다. 승인
 *     요청 · 결재 결정은 같은 열쇠의 공유 잠금을 첫 잠금으로 걸어 이 트랜잭션이 끝날
 *     때까지 기다린다.
 *  2. 행위자 재판정.
 *  3. collectUserDeletionImpact(lock) — 결재 행 → 위임 행 → 대상 사용자 행(결재 결정과
 *     같은 순서라 교착이 없다).
 *  4. 이어받을 사람들의 행 FOR SHARE — 고른 사이에 잠기거나 지워지지 않게.
 *
 * ── 🔴 거절은 전부 던진다 ────────────────────────────────────────────────
 * 트랜잭션 콜백에서 그냥 return 하면 **커밋된다** — 새 판을 얹은 뒤에 거절되면 반쯤
 * 지운 계정이 남는다. 그래서 UserDeletionRejected 를 던져 통째로 되돌리고 바깥에서
 * 결과로 바꾼다. 새 판 저장의 거절(ShipmentApprovalRouteSaveRejected)도 그대로
 * 던져지게 두고 바깥에서 ROUTE_UPDATE_REJECTED 로 바꾼다.
 *
 * ── 🔴 담당 이관은 updateRepairCase 를 쓰지 않는다 ────────────────────────
 * 그 함수는 저장마다 repair_cases.version 을 올리고, 승인은 요청 때 적은 버전이 지금
 * 버전과 다르면 무효(APPROVAL_STALE)가 된다 — 담당자만 바뀌었는데 받아 둔 검수 ·
 * 출하 승인이 전부 죽는다. 그래서 assigned_engineer_id · updated_at 만 바꾸고 버전은
 * 그대로 둔다(메인 판단 승인 2026-09-14). 담당 엔지니어는 승인이 평가한 업무 상태가
 * 아니다.
 *
 * ── 🔴 개인정보 ──────────────────────────────────────────────────────────
 * 이메일 · 전화 · sso_subject 는 건드리지도 싣지도 않는다. 둘을 지우면 포털 재로그인이
 * 이 행을 찾지 못하고 새 계정을 조용히 만들 수 있다(users_email_unique ·
 * users_sso_subject_unique 는 삭제된 행까지 포함한다).
 * ============================================================================
 */

export type UserDeletionResultCode =
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "SELF_DELETE_FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "APPROVAL_SUCCESSOR_REQUIRED"
  | "ENGINEER_SUCCESSOR_REQUIRED"
  | "INVALID_SUCCESSOR"
  | "SUCCESSOR_ALREADY_IN_ROUTE"
  | "SUCCESSOR_IS_REQUESTER"
  | "IN_FLIGHT_ON_OLD_ROUTE"
  | "ROUTE_UPDATE_REJECTED";

/** 삭제가 실제로 한 일 — 화면이 「넘겼습니다」 안내에 쓴다. */
export type UserDeletionSummary = {
  routeVersions: { scope: ShipmentApprovalRouteScope; version: number }[];
  reassignedApprovals: number;
  repinnedApprovals: number;
  /** 마지막 대표였으면 대표를 이어받은 사람. */
  representativeHandedTo: string | null;
  revokedDelegations: number;
  reassignedRepairCases: number;
  releasedExecutionNodes: number;
  developerFlagCleared: boolean;
  intakeMailRecipientRemoved: boolean;
};

export type DeleteUserAccountResult =
  | { ok: true; summary: UserDeletionSummary }
  | { ok: false; code: UserDeletionResultCode; message: string };

export type DeleteUserAccountParams = {
  targetUserId: string;
  /** 미리보기가 돌려준 대상 계정의 version. */
  expectedVersion: number;
  actorUserId: string;
  /** 필수다 — 대표 이력 · 감사 기록에 남는다. */
  reason: string;
  approvalSuccessorUserId: string | null;
  engineerSuccessorUserId: string | null;
};

type Failure = Extract<DeleteUserAccountResult, { ok: false }>;

class UserDeletionRejected extends Error {
  constructor(readonly result: Failure) {
    super(result.message);
    this.name = "UserDeletionRejected";
  }
}

function reject(code: UserDeletionResultCode, message: string): never {
  throw new UserDeletionRejected({ ok: false, code, message });
}

const FORBIDDEN_MESSAGE = "사용자 계정을 삭제할 권한이 없습니다.";
const CONFLICT_MESSAGE = "다른 사용자가 이 계정이나 관련된 일을 먼저 바꿨습니다. 새로고침 후 다시 시도해 주세요.";

/** 삭제 네 칸에 적는 원인 — 결재선 판 · 개발자 표시 · 재지정 감사에 함께 싣는다. */
type DeletionCause = { kind: "USER_DELETION"; deletedUserId: string };

export async function deleteUserAccount(params: DeleteUserAccountParams): Promise<DeleteUserAccountResult> {
  // 서버 액션이 이미 봤지만 이 함수는 직접 불릴 수 있다 — 형식은 한 번 더 본다(순수 함수).
  const validated = validateUserDeletionInput({
    targetUserId: params.targetUserId,
    expectedVersion: params.expectedVersion,
    reason: params.reason,
    approvalSuccessorUserId: params.approvalSuccessorUserId,
    engineerSuccessorUserId: params.engineerSuccessorUserId,
  });
  if (!validated.ok) return { ok: false, code: "VALIDATION_ERROR", message: validated.message };
  if (!isValidUuid(params.actorUserId)) return { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE };

  const input = validated.value;
  // 🔴 uuid 는 DB 에서 대소문자를 가리지 않지만 === 는 가린다 — 표에 적힌 모양(소문자)으로
  // 맞춘 뒤에만 견준다. 그러지 않으면 대문자로 보낸 자기 자신이 「자기 자신」 판정을 빠져나간다.
  const targetId = input.targetUserId.toLowerCase();
  const actorId = params.actorUserId.toLowerCase();
  const requestedApprovalSuccessorId = input.approvalSuccessorUserId?.toLowerCase() ?? null;
  const requestedEngineerSuccessorId = input.engineerSuccessorUserId?.toLowerCase() ?? null;

  try {
    return await db.transaction(async (tx): Promise<DeleteUserAccountResult> => {
      // 1. 결재선 배타 잠금 — 가장 먼저(파일 머리말 「잠금 순서」).
      await acquireShipmentApprovalRouteLock(tx);

      // 2. 행위자를 살아 있는 행에서 다시 판정한다. 개발자 표시는 읽지 않는다.
      const [actor] = await tx
        .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus })
        .from(users)
        .where(and(eq(users.id, actorId), eq(users.isDeleted, false)));
      if (!actor || !mayManageDeveloperFlag(actor)) reject("FORBIDDEN", FORBIDDEN_MESSAGE);
      if (targetId === actor.id) reject("SELF_DELETE_FORBIDDEN", "자기 자신의 계정은 삭제할 수 없습니다.");

      // 3. 걸린 것을 모으며 잠근다 — 미리보기와 같은 수집 함수다.
      const snapshot = await collectUserDeletionImpact(tx, targetId, { lock: true });
      if (!snapshot) reject("NOT_FOUND", "대상 사용자를 찾을 수 없습니다.");
      if (snapshot.target.version !== input.expectedVersion) reject("CONFLICT", CONFLICT_MESSAGE);

      // 멈춤 — 옛 판의 뒤 단계에 남아 있는 진행 중 결재(사용자 결정 2026-09-14).
      const stopped = snapshot.openApprovals.filter((entry) => entry.plan.action === "STOP");
      if (stopped.length > 0) {
        reject(
          "IN_FLIGHT_ON_OLD_ROUTE",
          inFlightOnOldRouteMessage(
            snapshot.target.name,
            stopped.map((entry) => entry.label)
          )
        );
      }
      // 멈춤 — 새 판 저장이 거절할 사람이 같은 판의 다른 단계에 있다. 저장도 같은 판정으로
      // 거절하지만(아래 catch), 미리보기와 같은 문장으로 먼저 말한다.
      for (const slot of snapshot.routeSlots) {
        const blocked = slot.ineligibleOtherSteps[0];
        if (blocked) reject("ROUTE_UPDATE_REJECTED", routeUpdateRejectedMessage(slot.scope, blocked));
      }

      // 어느 이어받을 사람이 필요한가 — 미리보기와 같은 규칙.
      const pendingApprovals = countPendingApprovalsAssignedTo(
        snapshot.openApprovals.map((entry) => entry.facts),
        targetId
      );
      const requires = resolveUserDeletionRequirements({
        routeSlotCount: snapshot.routeSlots.length,
        pendingApprovals,
        isLastRepresentative: snapshot.isLastRepresentative,
        openAssignedCaseCount: snapshot.openAssignedCaseIds.length,
      });
      if (requires.approvalSuccessor && !requestedApprovalSuccessorId) {
        reject(
          "APPROVAL_SUCCESSOR_REQUIRED",
          `${snapshot.target.name} 님이 맡은 결재 자리 · 결재 대기 · 출하 대표를 넘겨받을 사람을 골라 주세요.`
        );
      }
      if (requires.engineerSuccessor && !requestedEngineerSuccessorId) {
        reject(
          "ENGINEER_SUCCESSOR_REQUIRED",
          `${snapshot.target.name} 님이 담당 중인 접수 건을 넘겨받을 사람을 골라 주세요.`
        );
      }
      // 필요 없는 쪽은 받아도 쓰지 않는다 — 미리보기가 낡아 필요가 사라진 것을 거절하지
      // 않기 위해서다. 감사 기록에는 실제로 쓴 사람만 남는다.
      const approvalSuccessorId = requires.approvalSuccessor ? requestedApprovalSuccessorId : null;
      const engineerSuccessorId = requires.engineerSuccessor ? requestedEngineerSuccessorId : null;

      // 4. 이어받을 사람들 — FOR SHARE 로 잡고 미리보기와 같은 규칙으로 자격을 본다.
      const successorIds = [
        ...new Set([approvalSuccessorId, engineerSuccessorId].filter((id): id is string => id !== null)),
      ];
      const successorRows =
        successorIds.length === 0
          ? []
          : await tx
              .select({
                id: users.id,
                name: users.name,
                role: users.role,
                isDeveloper: users.isDeveloper,
                approvalStatus: users.approvalStatus,
                isActive: users.isActive,
                lockedAt: users.lockedAt,
                isDeleted: users.isDeleted,
                isShipmentRepresentative: users.isShipmentRepresentative,
              })
              .from(users)
              .where(inArray(users.id, successorIds))
              .for("share");
      const successorById = new Map(successorRows.map((row) => [row.id, row]));

      let approvalSuccessor: (typeof successorRows)[number] | null = null;
      if (approvalSuccessorId !== null) {
        const row = successorById.get(approvalSuccessorId);
        if (!row) {
          reject("INVALID_SUCCESSOR", "결재 이어받을 사람을 찾을 수 없습니다. 목록을 새로 불러온 뒤 다시 골라 주세요.");
        }
        const exclusions = collectSuccessorExclusions({
          targetUserId: targetId,
          routeSlotSteps: snapshot.routeSlots.map((slot) => slot.steps),
          openApprovals: snapshot.openApprovals,
        });
        const block = approvalSuccessorBlock(
          {
            id: row.id,
            name: row.name,
            accountBlockReason: approverBlockReason(row),
            canDecideInspection: actorHasAllowedRole(row, INSPECTION_DECIDE_ELIGIBLE_ROLES),
          },
          {
            targetUserId: targetId,
            mustInspect: requires.approvalSuccessorMustInspect,
            routeMemberIds: exclusions.routeMemberIds,
            requesterIds: exclusions.requesterIds,
          }
        );
        if (block) reject(block.code, block.message);
        approvalSuccessor = row;
      }

      let engineerSuccessor: (typeof successorRows)[number] | null = null;
      if (engineerSuccessorId !== null) {
        const row = successorById.get(engineerSuccessorId);
        if (!row) {
          reject("INVALID_SUCCESSOR", "담당 이어받을 사람을 찾을 수 없습니다. 목록을 새로 불러온 뒤 다시 골라 주세요.");
        }
        const block = engineerSuccessorBlock(
          { id: row.id, name: row.name, role: row.role, accountBlockReason: approverBlockReason(row) },
          { targetUserId: targetId }
        );
        if (block) reject(block.code, block.message);
        engineerSuccessor = row;
      }

      const requireApprovalSuccessor = () => {
        // 필요 판정(requires)을 지났으면 닿지 않는 가지다 — 조용히 NULL 을 쓰지 않는다.
        if (!approvalSuccessor) {
          reject("APPROVAL_SUCCESSOR_REQUIRED", "결재를 넘겨받을 사람을 골라 주세요.");
        }
        return approvalSuccessor;
      };

      // ── 쓰기 ────────────────────────────────────────────────────────────
      const now = new Date();
      const cause: DeletionCause = { kind: "USER_DELETION", deletedUserId: targetId };

      // (1) 새 판 — 지울 사람 자리만 이어받을 사람으로. 잠금은 1 에서 이미 걸었다.
      const newRouteIdByScope = new Map<ShipmentApprovalRouteScope, string>();
      const routeVersions: { scope: ShipmentApprovalRouteScope; routeId: string; version: number }[] = [];
      for (const slot of snapshot.routeSlots) {
        const successor = requireApprovalSuccessor();
        const saved = await saveShipmentApprovalRouteInTx(tx, {
          approverUserIds: replaceApproverInRouteSteps(slot.steps, targetId, successor.id),
          actorUserId: actor.id,
          scope: slot.scope,
          auditCause: cause,
        });
        if (!saved.changed) reject("CONFLICT", CONFLICT_MESSAGE);
        newRouteIdByScope.set(slot.scope, saved.routeId);
        routeVersions.push({ scope: slot.scope, routeId: saved.routeId, version: saved.version });
      }

      // (2) 진행 중 결재 — 넘기거나 새 판으로 옮긴다(planOpenApproval 의 결과대로).
      const reassignedApprovalIds = { repairCase: [] as string[], partIssue: [] as string[] };
      const repinnedApprovalIds = { repairCase: [] as string[], partIssue: [] as string[] };
      for (const entry of snapshot.openApprovals) {
        const plan = entry.plan;
        if (plan.action !== "REASSIGN" && plan.action !== "REPIN") continue;
        const successor = requireApprovalSuccessor();

        const reassign = plan.action === "REASSIGN" || plan.reassign;
        let nextRouteId = entry.facts.routeId;
        if (plan.action === "REPIN") {
          const scope = routeScopeForApprovalKind(entry.facts.kind);
          const newRouteId = scope === null ? undefined : newRouteIdByScope.get(scope);
          // 옮기는 사슬은 현재 판을 따라가므로 그 판에는 지울 사람이 있고, 그래서 위에서
          // 새 판이 생겼다. 없다면 그 사이 무엇이 바뀐 것이다.
          if (!newRouteId) reject("CONFLICT", CONFLICT_MESSAGE);
          nextRouteId = newRouteId;
        }
        const nextAssignedApproverUserId = reassign ? successor.id : entry.facts.assignedApproverUserId;
        const isPartIssue = entry.facts.kind === "PART_ISSUE";

        const updated = isPartIssue
          ? await tx
              .update(inventoryPartIssueApprovals)
              .set({ assignedApproverUserId: nextAssignedApproverUserId, routeId: nextRouteId, updatedAt: now })
              .where(
                and(
                  eq(inventoryPartIssueApprovals.id, entry.approvalId),
                  eq(inventoryPartIssueApprovals.status, "REQUESTED")
                )
              )
              .returning({ id: inventoryPartIssueApprovals.id })
          : await tx
              .update(repairCaseApprovals)
              .set({ assignedApproverUserId: nextAssignedApproverUserId, routeId: nextRouteId, updatedAt: now })
              .where(and(eq(repairCaseApprovals.id, entry.approvalId), eq(repairCaseApprovals.status, "REQUESTED")))
              .returning({ id: repairCaseApprovals.id });
        // 3 에서 잠갔으므로 닿지 않는 가지다. 0행 쓰기를 조용히 성공으로 넘기지 않는다.
        if (updated.length === 0) reject("CONFLICT", CONFLICT_MESSAGE);

        await insertAuditLog(tx, {
          actorUserId: actor.id,
          actionType: "UPDATE",
          targetEntity: isPartIssue ? "inventory_part_issue_approvals" : "repair_case_approvals",
          targetRecordId: entry.approvalId,
          previousValue: {
            assignedApproverUserId: entry.facts.assignedApproverUserId,
            routeId: entry.facts.routeId,
            routeStepOrder: entry.facts.routeStepOrder,
          },
          newValue: {
            assignedApproverUserId: nextAssignedApproverUserId,
            routeId: nextRouteId,
            routeStepOrder: entry.facts.routeStepOrder,
            cause,
          },
        });

        const bucket = isPartIssue ? "partIssue" : "repairCase";
        if (reassign) reassignedApprovalIds[bucket].push(entry.approvalId);
        if (plan.action === "REPIN") repinnedApprovalIds[bucket].push(entry.approvalId);
      }

      // (3) 출하 대표 — 지울 사람은 끄고, 마지막 활성 대표였으면 결재 이어받을 사람을 세운다.
      let representativeHandedTo: string | null = null;
      if (snapshot.target.isShipmentRepresentative) {
        await writeRepresentativeFlagChange(tx, {
          targetUserId: targetId,
          previousValue: true,
          newValue: false,
          actorUserId: actor.id,
          reason: `[계정 삭제] ${input.reason}`,
        });
        if (snapshot.isLastRepresentative) {
          const successor = requireApprovalSuccessor();
          // 이어받을 사람이 이미 활성 대표였다면 지울 사람은 마지막이 아니었다 — 방어로만 본다.
          if (!successor.isShipmentRepresentative) {
            await writeRepresentativeFlagChange(tx, {
              targetUserId: successor.id,
              previousValue: false,
              newValue: true,
              actorUserId: actor.id,
              reason: `[계정 삭제] ${snapshot.target.name} 님의 출하 대표를 이어받음 — ${input.reason}`,
            });
          }
          representativeHandedTo = successor.id;
        }
      }

      // (4) 위임 — **대상 행을 잠근 뒤에** 다시 읽는다. 위임 생성은 대표 · 대리인 행을
      // FOR SHARE 로 잡으므로, 3 에서 대상 행을 잠그기 직전에 들어온 위임은 그 생성이
      // 커밋된 뒤라야 우리가 잠금을 얻는다 — 그래서 여기서 다시 읽으면 빠짐없이 보인다.
      const activeDelegationIds = (
        await tx
          .select({ id: shipmentApprovalDelegations.id })
          .from(shipmentApprovalDelegations)
          .where(
            and(
              eq(shipmentApprovalDelegations.status, "ACTIVE"),
              or(
                eq(shipmentApprovalDelegations.representativeUserId, targetId),
                eq(shipmentApprovalDelegations.delegateUserId, targetId)
              )
            )
          )
      ).map((row) => row.id);
      const revokedDelegationIds = await revokeActiveDelegationsInTx(tx, {
        delegationIds: activeDelegationIds,
        actorUserId: actor.id,
      });

      // (5) 담당 이관 — 🔴 version 을 올리지 않는다(파일 머리말). 지금 열린 건을 다시
      // 잠그며 고른다 — 모은 뒤에 출하되었거나 새로 배정된 건을 놓치지 않게.
      const openCases = await tx
        .select({ id: repairCases.id, intakeNumber: repairCases.intakeNumber })
        .from(repairCases)
        .where(
          and(
            eq(repairCases.assignedEngineerId, targetId),
            eq(repairCases.isDeleted, false),
            eq(repairCases.isLocked, false)
          )
        )
        .for("update");
      if (openCases.length > 0) {
        if (!engineerSuccessor) {
          // 모을 때는 없던 담당 건이 그 사이 생겼다 — 이어받을 사람 없이 NULL 로 두지 않는다.
          reject(
            "ENGINEER_SUCCESSOR_REQUIRED",
            `${snapshot.target.name} 님이 담당 중인 접수 건을 넘겨받을 사람을 골라 주세요.`
          );
        }
        const engineer = engineerSuccessor;
        await tx
          .update(repairCases)
          .set({ assignedEngineerId: engineer.id, updatedAt: now })
          .where(inArray(repairCases.id, openCases.map((row) => row.id)));
        for (const row of openCases) {
          // 연락처 스냅숏은 싣지 않는다 — 접수번호와 담당 id 뿐이다.
          await insertAuditLog(tx, {
            actorUserId: actor.id,
            actionType: "UPDATE",
            targetEntity: "repair_cases",
            targetRecordId: row.id,
            previousValue: { intakeNumber: row.intakeNumber, assignedEngineerId: targetId },
            newValue: { intakeNumber: row.intakeNumber, assignedEngineerId: engineer.id, cause },
          });
        }
      }

      // (6) 열린 절차 노드 — 담당을 NULL(「접수 건 담당을 따른다」)로 되돌린다. 노드의
      // 낙관적 동시성 칸이라 version 은 올린다(접수 건 버전과 달리 승인과 무관하다).
      const releasedNodes =
        snapshot.openClaimedNodeIds.length === 0
          ? []
          : await tx
              .update(procedureCaseExecutionNodes)
              .set({
                assignedEngineerId: null,
                version: sql`${procedureCaseExecutionNodes.version} + 1`,
                updatedAt: now,
              })
              .where(
                and(
                  inArray(procedureCaseExecutionNodes.id, snapshot.openClaimedNodeIds),
                  eq(procedureCaseExecutionNodes.assignedEngineerId, targetId),
                  inArray(procedureCaseExecutionNodes.status, [...OPEN_NODE_STATUSES])
                )
              )
              .returning({ id: procedureCaseExecutionNodes.id });
      for (const row of releasedNodes) {
        await insertAuditLog(tx, {
          actorUserId: actor.id,
          actionType: "UPDATE",
          targetEntity: "procedure_case_execution_nodes",
          targetRecordId: row.id,
          previousValue: { assignedEngineerId: targetId },
          newValue: { assignedEngineerId: null, cause },
        });
      }

      // (7) 개발자 표시 — 끈다(되살려도 돌아오지 않는다).
      const developerFlagCleared = snapshot.target.isDeveloper;
      if (developerFlagCleared) {
        await writeDeveloperFlagChange(tx, {
          targetUserId: targetId,
          previousValue: true,
          newValue: false,
          actorUserId: actor.id,
          auditCause: cause,
        });
      }

      // (8) 접수 메일 수신자 행 — 지운다(사용자 결정 2026-09-14). 고객사 · S/N · 증상이
      // 가는 권한이라, 되살아난 사람이 조용히 다시 받게 두지 않는다. 감사에는 id 만.
      const removedRecipients = await tx
        .delete(intakeMailRecipients)
        .where(eq(intakeMailRecipients.userId, targetId))
        .returning({ id: intakeMailRecipients.id });

      // (9) 삭제 표시 — 기대 버전일 때만. 기존 세션은 sessions_valid_from 으로 즉시 끊긴다.
      const [deletedRow] = await tx
        .update(users)
        .set({
          isDeleted: true,
          deletedAt: now,
          deletedBy: actor.id,
          deleteReason: input.reason,
          sessionsValidFrom: now,
          updatedAt: now,
          version: sql`${users.version} + 1`,
        })
        .where(
          and(eq(users.id, targetId), eq(users.isDeleted, false), eq(users.version, input.expectedVersion))
        )
        .returning({ version: users.version });
      if (!deletedRow) reject("CONFLICT", CONFLICT_MESSAGE);

      // (10) 감사 — 한 줄에 무엇이 어디로 갔는지 전부. 이메일 · 전화 · sso_subject 는 없다.
      await insertAuditLog(tx, {
        actorUserId: actor.id,
        actionType: "SOFT_DELETE",
        targetEntity: "users",
        targetRecordId: targetId,
        previousValue: {
          id: targetId,
          name: snapshot.target.name,
          role: snapshot.target.role,
          version: snapshot.target.version,
          isShipmentRepresentative: snapshot.target.isShipmentRepresentative,
          isDeveloper: snapshot.target.isDeveloper,
        },
        newValue: {
          isDeleted: true,
          deletedAt: now.toISOString(),
          deleteReason: input.reason,
          sessionsValidFrom: now.toISOString(),
          version: deletedRow.version,
          approvalSuccessor: approvalSuccessor ? { id: approvalSuccessor.id, name: approvalSuccessor.name } : null,
          engineerSuccessor: engineerSuccessor ? { id: engineerSuccessor.id, name: engineerSuccessor.name } : null,
          routeVersions,
          reassignedApprovalIds,
          repinnedApprovalIds,
          representativeHandedTo,
          revokedDelegationIds,
          reassignedRepairCaseIds: openCases.map((row) => row.id),
          releasedExecutionNodeIds: releasedNodes.map((row) => row.id),
          developerFlagCleared,
          removedIntakeMailRecipientIds: removedRecipients.map((row) => row.id),
        },
      });

      return {
        ok: true,
        summary: {
          routeVersions: routeVersions.map(({ scope, version }) => ({ scope, version })),
          reassignedApprovals: reassignedApprovalIds.repairCase.length + reassignedApprovalIds.partIssue.length,
          repinnedApprovals: repinnedApprovalIds.repairCase.length + repinnedApprovalIds.partIssue.length,
          representativeHandedTo,
          revokedDelegations: revokedDelegationIds.length,
          reassignedRepairCases: openCases.length,
          releasedExecutionNodes: releasedNodes.length,
          developerFlagCleared,
          intakeMailRecipientRemoved: removedRecipients.length > 0,
        },
      };
    });
  } catch (err) {
    if (err instanceof UserDeletionRejected) return err.result;
    if (err instanceof ShipmentApprovalRouteSaveRejected) {
      return { ok: false, code: "ROUTE_UPDATE_REJECTED", message: err.result.message };
    }
    throw err;
  }
}
