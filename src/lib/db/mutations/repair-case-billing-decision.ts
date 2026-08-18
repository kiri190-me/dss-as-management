import "server-only";

import { and, eq } from "drizzle-orm";
import { isFieldEditable } from "@/lib/auth/repair-case-edit-authorization";
import { resolveBillingWorkflowTarget } from "./billing-workflow-target";
import { db } from "../client";
import { repairCaseBillingDecisionHistories, repairCases } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { resolveEligibleActor } from "./procedure-templates";

export const FINAL_BILLING_DECISION_CODES = ["PAID", "PARTIAL_PAID", "WARRANTY"] as const;
export type FinalBillingDecision = (typeof FINAL_BILLING_DECISION_CODES)[number];

export type ResolveRepairCaseBillingResult =
  | {
      ok: true;
      repairCaseId: string;
      billingType: FinalBillingDecision;
      workflowVersionId: string;
      currentWorkflowStepId: string;
      version: number;
      historyId: string;
    }
  | {
      ok: false;
      code:
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "STALE_VERSION"
        | "BILLING_ALREADY_DECIDED"
        | "WORKFLOW_REASSIGNMENT_NOT_ALLOWED"
        | "RELATED_ACTIVITY_EXISTS"
        | "NO_COMPATIBLE_STEP"
        | "BILLING_NOT_SET"
        | "WORKFLOW_NOT_ALLOWED";
      message: string;
    };

class BillingDecisionError extends Error {
  constructor(readonly result: Extract<ResolveRepairCaseBillingResult, { ok: false }>) {
    super(result.message);
  }
}

function fail(
  code: Extract<ResolveRepairCaseBillingResult, { ok: false }>['code'],
  message: string
): never {
  throw new BillingDecisionError({ ok: false, code, message });
}


/**
 * 유·무상(유상/일부유상/무상) 변경. 원래는 Excel 이관 건의 "추후결정 →
 * 확정" 한 방향만 처리하던 함수였고, 대상이 아직 pending intake_inspection
 * 단계에서 손대지 않은 상태일 때만 허용했다.
 *
 * 2026-08-18 사용자 결정으로 원칙이 바뀌었다 — **유·무상은 언제든, 어느
 * 단계에서든 변경 가능하다.** 수리를 진행하다 일부만 유상 청구로 판단되는
 * 상황이 실제로 발생하며(일부유상), 그 판단은 본래 진행 중에 나온다. 그래서
 * 아래 네 가지 제약을 제거했다:
 *   - 현재 유·무상이 PENDING_DECISION이어야 한다
 *   - 현재 워크플로가 PENDING_* 이어야 한다
 *   - 현재 단계가 intake_inspection이어야 한다
 *   - 작업 기록/승인/이력 등 관련 활동이 없어야 한다
 *
 * 남겨 둔 것: 역할 권한, 낙관적 잠금(expectedVersion), 행 잠금(FOR UPDATE),
 * 같은 값으로의 무의미한 변경 거부, 그리고 변경 이력·감사 로그 기록.
 *
 * 대상 워크플로/단계 결정은 billing-workflow-target.ts가 전담한다(수정 폼
 * 경로와 공유). No source Excel text is copied to either history sink.
 */
export async function resolveRepairCaseBillingDecision(params: {
  repairCaseId: string;
  expectedVersion: number;
  nextBillingType: FinalBillingDecision;
  actorUserId: string;
}): Promise<ResolveRepairCaseBillingResult> {
  try {
    return await db.transaction(async (tx) => {
      let actor: Awaited<ReturnType<typeof resolveEligibleActor>>;
      try {
        actor = await resolveEligibleActor(tx, params.actorUserId);
      } catch {
        fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
      }
      if (!isFieldEditable(actor.role, "billingType")) {
        fail("FORBIDDEN", "유·무상을 확정할 권한이 없습니다.");
      }

      const [current] = await tx
        .select({
          id: repairCases.id,
          version: repairCases.version,
          billingType: repairCases.billingType,
          workflowVersionId: repairCases.workflowVersionId,
          currentWorkflowStepId: repairCases.currentWorkflowStepId,
        })
        .from(repairCases)
        .where(and(eq(repairCases.id, params.repairCaseId), eq(repairCases.isDeleted, false)))
        .for("update");
      if (!current) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
      if (current.version !== params.expectedVersion) {
        fail("STALE_VERSION", "다른 사용자가 접수 건을 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.");
      }
      // 유·무상이 아예 비어 있는 레거시 행(billing_type NULL)만 거부한다.
      // 변경 이력의 previous_billing_type이 NOT NULL이라 기록할 수 없기
      // 때문이며, 그 행들은 데이터 정리로 값을 채운 뒤 정상 대상이 된다.
      if (!current.billingType) {
        fail("BILLING_NOT_SET", "유·무상이 설정되지 않은 접수 건입니다. 먼저 값을 지정해 주세요.");
      }
      if (current.billingType === params.nextBillingType) {
        fail("BILLING_ALREADY_DECIDED", "이미 같은 유·무상 상태입니다.");
      }
      // 대상 워크플로/단계 결정은 수정 폼 경로와 공유하는 단일 지점에 맡긴다
      // (billing-workflow-target.ts). 여기서 다시 계산하면 두 경로의 규칙이
      // 갈라지는, 원래 이 작업이 없애려던 문제가 그대로 재현된다.
      const target = await resolveBillingWorkflowTarget(tx, {
        currentWorkflowVersionId: current.workflowVersionId,
        currentWorkflowStepId: current.currentWorkflowStepId,
        nextBillingType: params.nextBillingType,
      });
      if (!target.ok) fail(target.code, target.message);


      const [updated] = await tx
        .update(repairCases)
        .set({
          billingType: params.nextBillingType,
          workflowVersionId: target.workflowVersionId,
          currentWorkflowStepId: target.workflowStepId,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(repairCases.id, current.id),
            eq(repairCases.version, current.version),
            // 읽은 시점의 실제 값으로 잠근다. 전에는 "PENDING_DECISION"이
            // 하드코딩되어 있었는데, 그대로 두면 추후결정이 아닌 모든 변경이
            // 0행 갱신 → STALE_VERSION으로 조용히 실패한다.
            eq(repairCases.billingType, current.billingType)
          )
        )
        .returning({ version: repairCases.version });
      if (!updated) fail("STALE_VERSION", "다른 사용자가 접수 건을 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.");

      const [history] = await tx
        .insert(repairCaseBillingDecisionHistories)
        .values({
          repairCaseId: current.id,
          previousBillingType: current.billingType,
          nextBillingType: params.nextBillingType,
          previousWorkflowVersionId: current.workflowVersionId,
          nextWorkflowVersionId: target.workflowVersionId,
          previousWorkflowStepId: current.currentWorkflowStepId,
          nextWorkflowStepId: target.workflowStepId,
          decidedBy: actor.id,
        })
        .returning({ id: repairCaseBillingDecisionHistories.id });

      await insertAuditLog(tx, {
        actorUserId: actor.id,
        actionType: "UPDATE",
        targetEntity: "repair_cases",
        targetRecordId: current.id,
        previousValue: {
          billingType: current.billingType,
          workflowVersionId: current.workflowVersionId,
          workflowStepId: current.currentWorkflowStepId,
        },
        newValue: {
          billingType: params.nextBillingType,
          workflowVersionId: target.workflowVersionId,
          workflowStepId: target.workflowStepId,
        },
      });

      return {
        ok: true,
        repairCaseId: current.id,
        billingType: params.nextBillingType,
        workflowVersionId: target.workflowVersionId,
        currentWorkflowStepId: target.workflowStepId,
        version: updated.version,
        historyId: history.id,
      };
    });
  } catch (error) {
    if (error instanceof BillingDecisionError) return error.result;
    throw error;
  }
}
