import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import { repairCaseApprovals, repairCases, statusChangeHistories, users, workflowSteps, workflowTemplates, workflowVersions } from "../schema";
import {
  checkHoldEligibilityForCategory,
  checkManualStepSetEligibility,
  checkTransitionEligibility,
} from "@/lib/domain/local/workflow/permissions";
import {
  findTransitionInRules,
  isManuallySelectableStepInRules,
  loadWorkflowRules,
} from "../queries/workflow-rules";
import type { HoldState } from "@/lib/domain/local/workflow/workflow-types";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import type { WorkflowActionCode } from "@/lib/validation/workflow-transition-input";

/**
 * Server-side workflow transitions, reusing the exact same authorization
 * and transition-graph logic the local-demo layer already uses
 * (findTransitionDefinition, checkTransitionEligibility, checkHoldEligibility
 * — all pure, framework-agnostic functions with no browser/localStorage
 * dependency, confirmed safe to import here verbatim) — this file does NOT
 * reimplement or fork that logic, only re-evaluates it against fresh
 * database state instead of a localStorage snapshot.
 *
 * Approval-gated transitions (any TransitionDefinition with
 * requiredApprovalType set — every workflow's SHIPMENT_COMPLETED terminal
 * transition, plus one REPAIR_INSPECTION-gated advance per workflow) check
 * repair_case_approvals for a matching APPROVED row still bound to the
 * case's current version (see the approval-persistence task's final
 * report) — APPROVAL_REQUIRED when missing/rejected, APPROVAL_STALE when
 * the case changed materially since the approval was requested.
 */

export type TransitionMutationResultCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "REASON_REQUIRED"
  | "FORBIDDEN"
  | "CASE_LOCKED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_STALE"
  | "BILLING_DECISION_REQUIRED";

export type TransitionMutationResult =
  | { ok: true; id: string; version: number; currentWorkflowStepKey: string }
  | { ok: false; code: TransitionMutationResultCode; message: string };

const VERSION_CONFLICT_MESSAGE =
  "다른 사용자가 이 접수 건의 워크플로를 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.";

const STEP_MOVING_ACTIONS = new Set<WorkflowActionCode>(["STEP_ADVANCED", "STEP_RETURNED", "SHIPMENT_COMPLETED"]);

/** Thrown only after status_change_histories has already been INSERTed in
 * the same transaction — thrown (not returned) so postgres rolls back that
 * insert along with the failed state update, keeping "history exists iff
 * the transition actually succeeded" strictly true. Caught immediately
 * outside db.transaction() and translated back to a normal result. */
class TransitionConflictError extends Error {
  code: "NOT_FOUND" | "CONFLICT";
  constructor(code: "NOT_FOUND" | "CONFLICT", message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * targetStepKey는 actionCode가 "STEP_SET_MANUALLY"일 때만 의미를 갖는다 —
 * 정규 전이 5종은 이동 대상을 전이표에서 스스로 결정하므로 이 값을 무시한다
 * (호출부가 실수로 넘겨도 영향이 없도록 해당 분기에서만 읽는다).
 */
export async function transitionWorkflow(
  repairCaseId: string,
  expectedVersion: number,
  actionCode: WorkflowActionCode | "STEP_SET_MANUALLY",
  actorUserId: string,
  reason: string | null,
  targetStepKey?: string
): Promise<TransitionMutationResult> {
  try {
    return await db.transaction(async (tx): Promise<TransitionMutationResult> => {
      const [current] = await tx
        .select({
          id: repairCases.id,
          version: repairCases.version,
          isLocked: repairCases.isLocked,
          assignedEngineerId: repairCases.assignedEngineerId,
          billingType: repairCases.billingType,
          workflowVersionId: repairCases.workflowVersionId,
          currentWorkflowStepId: repairCases.currentWorkflowStepId,
          currentStepKey: workflowSteps.key,
          workflowTypeCode: workflowTemplates.code,
        })
        .from(repairCases)
        .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
        .innerJoin(workflowVersions, eq(repairCases.workflowVersionId, workflowVersions.id))
        .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
        .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));

      if (!current) {
        return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
      }
      if (current.billingType === "PENDING_DECISION") {
        return {
          ok: false,
          code: "BILLING_DECISION_REQUIRED",
          message: "유·무상을 확정한 후 워크플로를 진행할 수 있습니다.",
        };
      }
      // 🔴 이 잠금을 **푸는 길은 이 파일 아래 revertShipmentCompletion 하나뿐**
      // 이다(2026-10-18). 여기를 느슨하게 만들지 말 것 — 그러면 출하 완료 뒤에
      // 막혀야 하는 다른 전이들까지 함께 열린다.
      if (current.isLocked) {
        return {
          ok: false,
          code: "CASE_LOCKED",
          message: "출하 완료 후 잠금된 접수 건입니다. 이 작업을 수행할 수 없습니다.",
        };
      }

      const [actor] = await tx
        .select({ id: users.id, name: users.name, role: users.role, approvalStatus: users.approvalStatus, isDeveloper: users.isDeveloper })
        .from(users)
        .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
      if (!actor) {
        return { ok: false, code: "FORBIDDEN", message: "사용자 정보를 확인할 수 없습니다." };
      }
      const actingUser: ActingUser = actor;

      // Event-sourced hold state (no dedicated columns — see Phase-1
      // report). Only `.isOnHold` is ever read by the reused permission
      // functions; the rest of HoldState is unused by them but required by
      // the shared type.
      const [latestHold] = await tx
        .select({ actionType: statusChangeHistories.actionType })
        .from(statusChangeHistories)
        .where(
          and(
            eq(statusChangeHistories.repairCaseId, repairCaseId),
            inArray(statusChangeHistories.actionType, ["HOLD_STARTED", "HOLD_RELEASED"])
          )
        )
        .orderBy(desc(statusChangeHistories.createdAt))
        .limit(1);
      const holdState: HoldState = {
        isOnHold: latestHold?.actionType === "HOLD_STARTED",
        reason: null,
        startedByUserId: null,
        startedByNameSnapshot: null,
        startedAt: null,
      };

      /**
       * Phase 2: 규칙의 출처가 transition-definitions.ts(TS 표)에서 DB로
       * 바뀌었다. 접수 건에 고정된 workflow_version_id의 규칙만 읽으므로,
       * 새 버전이 발행돼도 진행 중인 건은 예전 규칙 그대로 흘러간다.
       *
       * 규칙을 못 읽으면 조용히 "전이 없음"으로 처리하지 않고 명확히
       * 실패시킨다 — 빈 규칙으로 통과시키면 모든 이동이 이유 없이 막힌다.
       */
      const rules = await loadWorkflowRules(tx, current.workflowVersionId);
      if (!rules) {
        return {
          ok: false,
          code: "INVALID_TRANSITION",
          message: "이 접수 건의 워크플로 규칙을 확인할 수 없습니다.",
        };
      }

      let toStepId = current.currentWorkflowStepId;
      let toStepKeyForResult = current.currentStepKey;
      const setValues: Record<string, unknown> = {
        version: sql`${repairCases.version} + 1`,
        updatedAt: sql`now()`,
      };

      // actionCode !== "STEP_SET_MANUALLY" 를 먼저 두는 것은 타입 좁히기용이다 —
      // Set.has()는 TypeScript가 유니온을 좁혀 주지 못하므로, 이 명시적 비교가
      // 있어야 아래 findTransitionDefinition에 정규 액션 5종만 전달됨이
      // 컴파일 시점에 보장된다(단계 직접 변경은 전이표에 행이 없다).
      if (actionCode !== "STEP_SET_MANUALLY" && STEP_MOVING_ACTIONS.has(actionCode)) {
        const transition = findTransitionInRules(rules, actionCode, current.currentStepKey);
        if (!transition) {
          const message =
            actionCode === "STEP_ADVANCED"
              ? "이 단계에서는 다음 단계로 진행할 수 없습니다."
              : actionCode === "STEP_RETURNED"
                ? "이 단계에서는 이전 단계로 되돌릴 수 없습니다."
                : "현재 단계에서는 출하 완료 처리를 할 수 없습니다.";
          return { ok: false, code: "INVALID_TRANSITION", message };
        }
        const eligibility = checkTransitionEligibility(transition, actingUser, current.assignedEngineerId, holdState);
        if (!eligibility.allowed) {
          return { ok: false, code: "FORBIDDEN", message: eligibility.reason };
        }
        if (transition.requiresReason && !reason) {
          return {
            ok: false,
            code: "REASON_REQUIRED",
            message: actionCode === "SHIPMENT_COMPLETED" ? "출하 완료 메모를 입력해 주세요." : "되돌리기 사유를 입력해 주세요.",
          };
        }

        // Approval-gated transitions: the most recent
        // repair_case_approvals row for this (case, type) must be APPROVED
        // and still bound to the case's current version. A transition
        // never mutates repair_case_approvals itself — "consuming" an
        // approval happens implicitly, because this same transaction always
        // bumps repair_cases.version below, so a second attempt to reuse
        // the same approval immediately reads as APPROVAL_STALE.
        if (transition.requiredApprovalType) {
          const [latestApproval] = await tx
            .select({
              status: repairCaseApprovals.status,
              versionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
            })
            .from(repairCaseApprovals)
            .where(
              and(
                eq(repairCaseApprovals.repairCaseId, repairCaseId),
                eq(repairCaseApprovals.approvalType, transition.requiredApprovalType)
              )
            )
            .orderBy(desc(repairCaseApprovals.requestedAt))
            .limit(1);

          if (!latestApproval || latestApproval.status !== "APPROVED") {
            return {
              ok: false,
              code: "APPROVAL_REQUIRED",
              message:
                transition.requiredApprovalType === "REPAIR_INSPECTION"
                  ? "수리 검수 승인이 완료되어야 진행할 수 있습니다."
                  : "최종 출하 승인이 완료되어야 진행할 수 있습니다.",
            };
          }
          if (latestApproval.versionAtRequest !== current.version) {
            return {
              ok: false,
              code: "APPROVAL_STALE",
              message: "접수 건 정보가 승인 이후 변경되어 기존 승인을 다시 받아야 합니다.",
            };
          }
        }

        // 규칙과 함께 이미 읽어 둔 단계 목록에서 꺼낸다 — 같은 버전의 단계를
        // 다시 조회할 이유가 없다.
        const toStep = rules.stepByKey.get(transition.toStepKey);
        if (!toStep) {
          return { ok: false, code: "INVALID_TRANSITION", message: "대상 단계를 확인할 수 없습니다." };
        }
        toStepId = toStep.id;
        toStepKeyForResult = transition.toStepKey;

        setValues.currentWorkflowStepId = toStepId;
        if (actionCode === "SHIPMENT_COMPLETED") {
          setValues.isLocked = true;
          setValues.actualShipmentDate = new Date().toISOString().slice(0, 10);
        }
      } else if (actionCode === "STEP_SET_MANUALLY") {
        // ────────────────────────────────────────────────────────────────
        // 단계 직접 변경 — 정규 전이표를 거치지 않는 유일한 경로 (2026-08-18)
        // ────────────────────────────────────────────────────────────────
        // 전이표 조회(findTransitionDefinition) 대신 호출부가 지정한 단계로
        // 곧장 이동한다. 그래서 전이표가 평소 보장해 주던 것들을 여기서 직접
        // 다시 세운다 — 아래 검사 중 하나라도 빠지면 이 경로가 나머지 모든
        // 워크플로 규칙의 우회로가 된다.
        //
        // 잠금(is_locked)/버전 충돌은 이 분기보다 앞에서 이미 검사되었으므로
        // 여기서 반복하지 않는다(정규 전이와 완전히 동일한 지점에서 걸린다).
        const requestedStepKey = targetStepKey ?? "";
        if (!requestedStepKey) {
          return { ok: false, code: "VALIDATION_ERROR", message: "변경할 단계를 선택해 주세요." };
        }

        // 2026-10-04 완화: 단계 직접 변경의 사유가 필수에서 선택으로 바뀌었다.
        // 여기 있던 `if (!reason) REASON_REQUIRED` 반환을 제거한 것이 그 완화의
        // 전부다 — 보류 쪽(아래 분기)이 2026-08-18에 같은 방식으로 완화된 것과
        // 같은 꼴이다. 이전 결정은 「사유는 항상 필수다(2026-08-18) — 규칙을
        // 우회하는 경로라 사유가 유일한 추적 수단이기 때문이다」였고, 그것이
        // 2026-10-04 사용자 결정으로 뒤집혔다.
        //
        // 🔴 추적 자체는 사라지지 않는다. 사유를 적지 않으면
        // status_change_histories.reason만 null로 남고, 그 행의 나머지 —
        // 행위자(actor_user_id)·시각(created_at)·from_step_id·to_step_id·
        // action_type="STEP_SET_MANUALLY" — 는 전과 똑같이 기록된다. 사유를
        // 적으면 이전과 동일하게 그 문구가 함께 남는다.
        //
        // 이 완화는 이 분기(STEP_SET_MANUALLY)에만 적용된다. 정규 전이의
        // requiresReason(출하 완료 메모 등)은 위 분기에서 그대로 강제된다.

        const eligibility = checkManualStepSetEligibility(actingUser, holdState);
        if (!eligibility.allowed) {
          return { ok: false, code: "FORBIDDEN", message: eligibility.reason };
        }

        // 클라이언트가 보낸 단계 키를 신뢰하지 않는다. UI가 그리는 목록과
        // 정확히 같은 규칙(승인 게이트 단계 제외 + 상태 매핑 존재)을 서버가
        // 다시 평가한다 — 규칙의 실체는 db/queries/workflow-rules.ts의
        // listManuallySelectableStepsFromRules 하나다.
        if (!isManuallySelectableStepInRules(rules, requestedStepKey)) {
          return {
            ok: false,
            code: "INVALID_TRANSITION",
            message: "이 단계로는 직접 변경할 수 없습니다.",
          };
        }
        if (requestedStepKey === current.currentStepKey) {
          return {
            ok: false,
            code: "INVALID_TRANSITION",
            message: "이미 해당 단계입니다.",
          };
        }

        // 대상 단계는 반드시 이 접수 건의 워크플로 버전에 실제로 존재하는
        // 행이어야 한다(정규 전이가 toStepKey를 해석할 때와 같은 조회).
        const manualToStep = rules.stepByKey.get(requestedStepKey);
        if (!manualToStep) {
          return {
            ok: false,
            code: "INVALID_TRANSITION",
            message: "이 단계로는 직접 변경할 수 없습니다.",
          };
        }

        toStepId = manualToStep.id;
        toStepKeyForResult = requestedStepKey;
        setValues.currentWorkflowStepId = manualToStep.id;
      } else {
        // HOLD_STARTED / HOLD_RELEASED — never in transition-definitions.ts
        // (they don't move steps); eligibility is category-based, exactly
        // like the local-demo layer.
        const isRelease = actionCode === "HOLD_RELEASED";
        if (isRelease && !holdState.isOnHold) {
          return { ok: false, code: "INVALID_TRANSITION", message: "보류 중이 아닙니다." };
        }
        if (!isRelease && holdState.isOnHold) {
          return { ok: false, code: "INVALID_TRANSITION", message: "이미 보류 중입니다." };
        }

        // 단계의 담당 분류도 DB에서 읽은 규칙에서 가져온다(Phase 2) —
        // 이 mutation 안에 TS 표를 보는 경로가 하나라도 남으면 두 출처가
        // 갈라졌을 때 그 지점만 다르게 판정한다.
        const eligibility = checkHoldEligibilityForCategory(
          rules.stepByKey.get(current.currentStepKey)?.category ?? null,
          actingUser,
          current.assignedEngineerId
        );
        if (!eligibility.allowed) {
          return { ok: false, code: "FORBIDDEN", message: eligibility.reason };
        }
        // 보류 시작/해제의 사유는 사용자 승인(2026-08-18)에 따라 필수에서
        // 선택으로 완화되었다 — 여기 있던 `if (!reason) REASON_REQUIRED`
        // 반환을 제거한 것이 그 완화의 전부다. 입력창(HoldDialog/
        // ReleaseHoldDialog)은 그대로 뜨며, 사유를 적으면 이전과 동일하게
        // status_change_histories.reason에 기록된다. 적지 않으면 null로
        // 남는다. 되돌리기 쪽 완화가 transition-definitions.ts의
        // requiresReason 플래그로 표현되는 것과 달리, 보류는 그 표에 행이
        // 없어(단계를 옮기지 않으므로) 이 분기에서 직접 다룬다.
        //
        // REASON_REQUIRED 코드 자체는 남겨 둔다 — 출하 완료 메모와
        // requiresReason가 true인 전이가 여전히 이 코드를 사용한다.
        //
        // current_workflow_step_id intentionally omitted from setValues —
        // hold actions never move the step.
      }

      await tx.insert(statusChangeHistories).values({
        repairCaseId,
        workflowVersionId: current.workflowVersionId,
        fromStepId: current.currentWorkflowStepId,
        toStepId,
        actionType: actionCode,
        actorUserId: actor.id,
        reason,
      });

      const updatedRows = await tx
        .update(repairCases)
        .set(setValues)
        .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.version, expectedVersion)))
        .returning({ id: repairCases.id, version: repairCases.version });

      if (updatedRows.length === 0) {
        const [stillExists] = await tx
          .select({ id: repairCases.id })
          .from(repairCases)
          .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));
        if (!stillExists) {
          throw new TransitionConflictError("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
        }
        throw new TransitionConflictError("CONFLICT", VERSION_CONFLICT_MESSAGE);
      }

      const updated = updatedRows[0];
      return { ok: true, id: updated.id, version: updated.version, currentWorkflowStepKey: toStepKeyForResult };
    });
  } catch (err) {
    if (err instanceof TransitionConflictError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }
}

/**
 * ============================================================================
 * 출하 완료 되돌리기 — `is_locked` 를 **푸는 하나뿐인 길** (2026-10-18)
 * ============================================================================
 * 위 transitionWorkflow 는 SHIPMENT_COMPLETED 에서 `is_locked = true` 를 찍고,
 * 그다음부터 **모든 전이를 그 잠금으로 막는다**(CASE_LOCKED). 그래서 그 함수로는
 * 출하 완료를 되돌릴 수 없다 — 되돌리기 전이를 아무리 잘 적어도 잠금 검사가
 * 먼저 걸린다. 이 함수가 생기기 전까지 저장소 전체에 `is_locked` 를 false 로
 * 되돌리는 코드가 **한 줄도 없었다.**
 *
 * 🔴 **위 함수를 고쳐 풀지 않았다.** 잠금 검사를 느슨하게 만들면 출하 완료 뒤에
 * 금지된 다른 전이들(보류·단계 직접 변경·되돌리기)까지 함께 열린다. 여는 문은
 * 하나여야 하고, 그 문이 여기다.
 *
 * ── 누가 쓰는가 ─────────────────────────────────────────────────────────
 * 지금은 내자 정리 [완료 해제] 하나다
 * (server/services/release-domestic-order.ts). 수리 건 상세 화면에는 되돌리기
 * 단추가 없다 — 2026-10-18 요청 범위 밖이다.
 *
 * ── 되돌아갈 단계를 **DB 에서 찾는다** ──────────────────────────────────
 * 단계 key 를 글자로 박지 않는다. 워크플로마다 출하 완료 **직전** 단계가 다르다
 * (실측: 매쳐 둘은 `waiting_shipment`, 제너레이터·토탈컨트롤러 넷은
 * `shipment_approved`). 그 건의 workflow_version_id 안에서 **지금 단계로
 * 들어오는 SHIPMENT_COMPLETED 전이**를 찾아 그 `from_step` 으로 돌아간다 —
 * 나갈 때 쓴 문으로 그대로 되돌아오는 셈이라, 전이표가 바뀌면 되돌아갈 자리도
 * 함께 따라간다. 못 찾으면 거부한다(지어내지 않는다).
 *
 * ── 역할 검사도 **그 전이의 것을 그대로 쓴다** ──────────────────────────
 * 🔵 「출하 완료를 누를 수 있는 사람이 되돌릴 수도 있다」가 규칙이다. 새 역할
 * 표를 만들지 않고 찾아낸 전이를 그대로 checkTransitionEligibility 에 넘긴다 —
 * 위 transitionWorkflow 가 정규 전이에서 쓰는 바로 그 함수다. 2026-10-18
 * 마이그레이션 0117 로 담당 엔지니어·영업이 그 목록에 들어갔으므로, 그 둘이
 * 되돌리기도 할 수 있다. 전이표를 고치면 양쪽이 함께 움직인다.
 *
 * ── 실제 출하일을 **지운다** ────────────────────────────────────────────
 * 🔵 「출하 완료인가」는 워크플로 단계와 `actual_shipment_date` **둘 중
 * 하나**로 판정된다(domain/types.ts). 날짜를 남겨 두면 단계만 되돌아가고 다른
 * 화면에서는 **여전히 출하된 것으로 읽히는** 건이 남는다. 내자 정리 목록의
 * `납품일` 이 바로 그 값이다(queries/domestic-orders.ts).
 *
 * ── 이력은 STEP_RETURNED 로 남긴다 ──────────────────────────────────────
 * 🔴 새 action_type 값을 만들지 않았다. 그 칸은 enum 이라 값을 늘리려면
 * 마이그레이션이 필요하고, 뜻이 맞는 값이 이미 있다(단계를 뒤로 옮겼다). 대신
 * **평범한 되돌리기와 갈라야** 하므로 `metadata` 에 표시를 남긴다 — 그 칸은
 * 스키마 주석이 "richer shipment-completion detail" 용으로 비워 둔 자리다.
 * `reason` 은 부르는 쪽이 준 문장이 그대로 들어간다.
 *
 * ── 승인은 **자동으로 다시 받아야 한다** ────────────────────────────────
 * 🔴 되돌리면 version 이 오른다. 최종 출하 승인은 `repair_case_version_at_request`
 * 로 그 건의 version 에 묶여 있으므로(위 transitionWorkflow 의 승인 검사),
 * 되돌린 뒤 다시 출하 완료를 하려면 **수리 검수 승인부터 다시** 받아야 한다.
 * 이 함수가 승인 행을 건드려 그 일을 대신하지는 않는다 — 승인이 version 에
 * 묶여 있다는 기존 규칙이 그대로 작용할 뿐이다.
 * ============================================================================
 */
export type RevertShipmentCompletionResultCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "INVALID_TRANSITION"
  /** 지금 출하 완료 상태가 아니다 — 되돌릴 것이 없다. */
  | "NOT_SHIPMENT_COMPLETED";

export type RevertShipmentCompletionResult =
  | { ok: true; id: string; version: number; currentWorkflowStepKey: string }
  | { ok: false; code: RevertShipmentCompletionResultCode; message: string };

/**
 * 이력(status_change_histories.metadata)에 박히는 표시.
 *
 * 🔴 이력을 읽는 사람이 **평범한 단계 되돌리기와 가르는 열쇠**다. action_type
 * 은 둘 다 STEP_RETURNED 라 그것만으로는 구분되지 않는다. 글자를 비교하는
 * 대신 이 상수를 가져다 쓴다.
 */
export const SHIPMENT_COMPLETION_REVERT_METADATA = {
  revertedShipmentCompletion: true,
} as const;

/**
 * 보류 상태를 읽는다(사건 기록에서 되살린다 — 전용 칼럼이 없다).
 *
 * ⚠️ 위 transitionWorkflow 가 제 본문에 **같은 읽기**를 갖고 있다. 이번 조각은
 * 그 함수를 한 글자도 건드리지 않기로 한 범위라 합치지 않았다 — 합칠 때는 둘을
 * 함께 본다.
 */
async function readHoldStateForRevert(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  repairCaseId: string
): Promise<HoldState> {
  const [latestHold] = await tx
    .select({ actionType: statusChangeHistories.actionType })
    .from(statusChangeHistories)
    .where(
      and(
        eq(statusChangeHistories.repairCaseId, repairCaseId),
        inArray(statusChangeHistories.actionType, ["HOLD_STARTED", "HOLD_RELEASED"])
      )
    )
    .orderBy(desc(statusChangeHistories.createdAt))
    .limit(1);
  return {
    isOnHold: latestHold?.actionType === "HOLD_STARTED",
    reason: null,
    startedByUserId: null,
    startedByNameSnapshot: null,
    startedAt: null,
  };
}

export async function revertShipmentCompletion(
  repairCaseId: string,
  expectedVersion: number,
  actorUserId: string,
  /** 이력에 남을 사유. 부르는 쪽이 어디서 비롯된 일인지 적어 넘긴다. */
  reason: string
): Promise<RevertShipmentCompletionResult> {
  return db.transaction(async (tx): Promise<RevertShipmentCompletionResult> => {
    // ── 1 · 행 잠금으로 읽는다 ────────────────────────────────────────────
    // 조인 없이 이 표만 읽는다 — 조인한 채 FOR UPDATE 를 걸면 모든 워크플로가
    // 함께 쓰는 workflow_steps 행까지 잠근다(단계·상태는 아래 규칙에서 꺼낸다).
    const [current] = await tx
      .select({
        id: repairCases.id,
        version: repairCases.version,
        isLocked: repairCases.isLocked,
        assignedEngineerId: repairCases.assignedEngineerId,
        workflowVersionId: repairCases.workflowVersionId,
        currentWorkflowStepId: repairCases.currentWorkflowStepId,
      })
      .from(repairCases)
      .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)))
      .for("update");

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
    }

    const rules = await loadWorkflowRules(tx, current.workflowVersionId);
    if (!rules) {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        message: "이 접수 건의 워크플로 규칙을 확인할 수 없습니다.",
      };
    }

    // ── 2 · 지금 출하 완료 상태인가 ──────────────────────────────────────
    // 🔴 단계 key 를 글자로 비교하지 않는다 — workflow_steps.repair_status 로
    // 본다. 내자 줄이 같은 판정을 할 때 쓰는 기준과 같다
    // (queries/domestic-orders.ts 의 getDomesticOrderShipmentLink).
    const currentStep = rules.steps.find((step) => step.id === current.currentWorkflowStepId);
    if (!currentStep || currentStep.status !== "SHIPMENT_COMPLETED") {
      return {
        ok: false,
        code: "NOT_SHIPMENT_COMPLETED",
        message: "출하 완료 상태인 접수 건만 되돌릴 수 있습니다.",
      };
    }

    // ── 3 · 낙관적 잠금 ──────────────────────────────────────────────────
    if (current.version !== expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // ── 4 · 되돌아갈 단계를 전이표에서 찾는다(위 머리말) ──────────────────
    const shipmentTransition = rules.transitions.find(
      (transition) =>
        transition.actionCode === "SHIPMENT_COMPLETED" && transition.toStepKey === currentStep.key
    );
    if (!shipmentTransition) {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        message: "이 접수 건의 워크플로에서 출하 완료 직전 단계를 찾을 수 없습니다.",
      };
    }
    const toStep = rules.stepByKey.get(shipmentTransition.fromStepKey);
    if (!toStep) {
      return { ok: false, code: "INVALID_TRANSITION", message: "되돌릴 단계를 확인할 수 없습니다." };
    }

    // ── 5 · 역할 검사 — 찾아낸 그 전이의 허용 역할 그대로 ─────────────────
    const [actor] = await tx
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        approvalStatus: users.approvalStatus,
        isDeveloper: users.isDeveloper,
      })
      .from(users)
      .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
    if (!actor) {
      return { ok: false, code: "FORBIDDEN", message: "사용자 정보를 확인할 수 없습니다." };
    }
    const actingUser: ActingUser = actor;

    const holdState = await readHoldStateForRevert(tx, repairCaseId);
    const eligibility = checkTransitionEligibility(
      shipmentTransition,
      actingUser,
      current.assignedEngineerId,
      holdState
    );
    if (!eligibility.allowed) {
      return { ok: false, code: "FORBIDDEN", message: eligibility.reason };
    }

    // ── 6 · 되돌린다 ─────────────────────────────────────────────────────
    // 🔴 **갱신이 먼저, 이력이 나중이다.** 위 transitionWorkflow 와 차례가
    // 반대인 데에는 까닭이 있다: 트랜잭션 콜백에서 `return` 하면 그 트랜잭션은
    // **커밋된다.** 이력을 먼저 넣어 두고 아래에서 CONFLICT 를 반환하면 아무
    // 일도 없었던 건에 이력 한 줄만 남는다(그래서 그쪽은 던져서 되돌린다).
    // 이 차례면 0행일 때 그냥 반환해도 쓴 것이 없고, 이력 삽입이 실패하면
    // 갱신까지 함께 롤백된다 — "이력은 성공했을 때만 남는다"가 양방향으로
    // 지켜진다.
    const [updated] = await tx
      .update(repairCases)
      .set({
        currentWorkflowStepId: toStep.id,
        isLocked: false,
        // 🔴 날짜도 지운다(위 머리말 '실제 출하일을 지운다').
        actualShipmentDate: null,
        version: sql`${repairCases.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.version, expectedVersion)))
      .returning({ id: repairCases.id, version: repairCases.version });

    if (!updated) {
      // 행 잠금을 쥐고 version 까지 대조한 뒤라 정상 경로로는 오지 않는다.
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    await tx.insert(statusChangeHistories).values({
      repairCaseId,
      workflowVersionId: current.workflowVersionId,
      fromStepId: current.currentWorkflowStepId,
      toStepId: toStep.id,
      actionType: "STEP_RETURNED",
      actorUserId: actor.id,
      reason,
      metadata: SHIPMENT_COMPLETION_REVERT_METADATA,
    });

    return {
      ok: true,
      id: updated.id,
      version: updated.version,
      currentWorkflowStepKey: toStep.key,
    };
  });
}
