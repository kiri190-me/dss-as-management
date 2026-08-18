import "server-only";

import { and, asc, eq, lte } from "drizzle-orm";
import { deriveWorkflowType, workflowKindOf } from "@/lib/domain/workflow-kind";
import type { BillingType } from "@/lib/domain/types";
import type { db } from "../client";
import { workflowSteps, workflowTemplates, workflowVersions } from "../schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BillingWorkflowTarget =
  | {
      ok: true;
      workflowVersionId: string;
      workflowStepId: string;
      /** 대상 워크플로에 현재와 같은 key의 단계가 없어 이전 공통 단계로 물러난 경우 true. */
      movedToFallbackStep: boolean;
      /** 실제로 놓이게 될 단계 key(호출부가 확인 문구를 만들 때 쓴다). */
      targetStepKey: string;
      /** 워크플로 자체는 그대로이고 유·무상 값만 바뀌는 경우 true. */
      workflowUnchanged: boolean;
    }
  | { ok: false; code: "WORKFLOW_NOT_ALLOWED" | "NO_COMPATIBLE_STEP"; message: string };

/**
 * ============================================================================
 * 유·무상 변경 시 "어느 워크플로의 어느 단계로 갈 것인가"를 정하는 단일 지점
 * ============================================================================
 * 유·무상 변경 경로가 두 군데(확정 mutation, 접수 건 수정 폼)로 나뉘어 있었고
 * 각자 다른 규칙을 갖고 있었다 — 한쪽은 "인수점검 단계에서만", 다른 한쪽은
 * "Generator만, 진행 전에만". 규칙이 갈리면 같은 변경이 화면에 따라 되기도
 * 하고 안 되기도 한다. 두 경로가 이 함수를 함께 쓰도록 모아 둔다.
 *
 * 단계 매핑 규칙 — 실제 데이터로 확인한 구조에 기반한다(2026-08-18 측정):
 *   - 무상 워크플로의 단계 집합은 유상의 부분집합이다(Generator/Total
 *     Controller 기준 공통 10 + 유상 전용 6, 무상 전용 0). Matcher는 19단계가
 *     완전히 동일하다.
 *   - 따라서 무상 → 유상/일부유상은 **항상** 같은 key가 대상에 존재한다.
 *   - 반대 방향(→ 무상)만, 유상 전용 단계(견적 작성/견적 발송/PO 대기/PO 접수/
 *     최종 전원인가 판단·수행)에 있을 때 갈 곳이 없다.
 *
 * 그 경우 **현재 순서보다 앞선 단계 중 대상에도 존재하는 가장 뒤 단계**로
 * 물러난다. 앞으로 건너뛰지 않는 이유는, 하지 않은 작업을 완료한 것처럼
 * 만들어 버리기 때문이다. 되돌아가는 것은 사람이 다시 진행하면 되지만
 * 건너뛴 단계는 아무도 알아채지 못한다.
 *
 * 일부유상(PARTIAL_PAID)은 별도 워크플로가 없고 유상 워크플로를 쓴다
 * (deriveWorkflowType이 WARRANTY/PENDING이 아닌 값을 전부 PAID로 접는다).
 * 그래서 유상 ↔ 일부유상 변경은 워크플로가 바뀌지 않고 값만 바뀐다.
 * ============================================================================
 */
export async function resolveBillingWorkflowTarget(
  tx: Tx,
  params: {
    currentWorkflowVersionId: string;
    currentWorkflowStepId: string;
    nextBillingType: BillingType;
  }
): Promise<BillingWorkflowTarget> {
  const [currentWorkflow] = await tx
    .select({
      workflowType: workflowTemplates.code,
      currentStepKey: workflowSteps.key,
      currentStepOrder: workflowSteps.stepOrder,
    })
    .from(workflowVersions)
    .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
    .innerJoin(workflowSteps, eq(workflowSteps.id, params.currentWorkflowStepId))
    .where(eq(workflowVersions.id, params.currentWorkflowVersionId));

  if (!currentWorkflow) {
    return { ok: false, code: "WORKFLOW_NOT_ALLOWED", message: "현재 워크플로 상태를 확인할 수 없습니다." };
  }

  // 레거시 MATCHER는 유·무상과 워크플로가 완전히 독립이다 — 유상/무상을 바꿔도
  // PAID_MATCHER/WARRANTY_MATCHER로 옮기지 않는다. 이 워크플로가 유·무상 구분이
  // 생기기 전부터 쓰이던 것이라, 옮기면 과거 이력의 의미가 바뀐다
  // (repair-cases-update.integration.test.ts의 48번이 이 불변식을 고정한다).
  // 이 워크플로 자체를 정리하는 것은 별도 작업으로 다룬다 — 유·무상을 고치다가
  // 슬그머니 이관되는 것은 그 작업이 아니다.
  if (currentWorkflow.workflowType === "MATCHER") {
    return {
      ok: true,
      workflowVersionId: params.currentWorkflowVersionId,
      workflowStepId: params.currentWorkflowStepId,
      movedToFallbackStep: false,
      targetStepKey: currentWorkflow.currentStepKey,
      workflowUnchanged: true,
    };
  }

  const targetWorkflowType = deriveWorkflowType(
    workflowKindOf(currentWorkflow.workflowType),
    params.nextBillingType
  );
  if (!targetWorkflowType) {
    return { ok: false, code: "WORKFLOW_NOT_ALLOWED", message: "대상 워크플로를 결정할 수 없습니다." };
  }

  // 유상 → 일부유상처럼 워크플로가 같은 경우. 단계를 다시 찾을 필요가 없고,
  // 찾으면 오히려 위험하다(같은 버전 안에서 굳이 이동시킬 이유가 없다).
  if (targetWorkflowType === currentWorkflow.workflowType) {
    return {
      ok: true,
      workflowVersionId: params.currentWorkflowVersionId,
      workflowStepId: params.currentWorkflowStepId,
      movedToFallbackStep: false,
      targetStepKey: currentWorkflow.currentStepKey,
      workflowUnchanged: true,
    };
  }

  const [targetVersion] = await tx
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
    .where(
      and(
        eq(workflowTemplates.code, targetWorkflowType),
        eq(workflowVersions.status, "PUBLISHED"),
        eq(workflowVersions.isCurrent, true)
      )
    );
  if (!targetVersion) {
    return {
      ok: false,
      code: "WORKFLOW_NOT_ALLOWED",
      message: "현재 사용할 수 있는 대상 워크플로를 찾을 수 없습니다.",
    };
  }

  const [sameKeyStep] = await tx
    .select({ id: workflowSteps.id })
    .from(workflowSteps)
    .where(
      and(
        eq(workflowSteps.workflowVersionId, targetVersion.id),
        eq(workflowSteps.key, currentWorkflow.currentStepKey)
      )
    );
  if (sameKeyStep) {
    return {
      ok: true,
      workflowVersionId: targetVersion.id,
      workflowStepId: sameKeyStep.id,
      movedToFallbackStep: false,
      targetStepKey: currentWorkflow.currentStepKey,
      workflowUnchanged: false,
    };
  }

  // 대상에 같은 단계가 없다 → 현재보다 앞선 단계 중 대상에도 있는 가장 뒤 단계.
  const earlierSteps = await tx
    .select({ key: workflowSteps.key, order: workflowSteps.stepOrder })
    .from(workflowSteps)
    .where(
      and(
        eq(workflowSteps.workflowVersionId, params.currentWorkflowVersionId),
        lte(workflowSteps.stepOrder, currentWorkflow.currentStepOrder)
      )
    )
    .orderBy(asc(workflowSteps.stepOrder));

  const targetSteps = await tx
    .select({ id: workflowSteps.id, key: workflowSteps.key })
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowVersionId, targetVersion.id));
  const targetByKey = new Map(targetSteps.map((s) => [s.key, s.id]));

  for (let i = earlierSteps.length - 1; i >= 0; i--) {
    const candidate = targetByKey.get(earlierSteps[i].key);
    if (candidate) {
      return {
        ok: true,
        workflowVersionId: targetVersion.id,
        workflowStepId: candidate,
        movedToFallbackStep: true,
        targetStepKey: earlierSteps[i].key,
        workflowUnchanged: false,
      };
    }
  }

  return {
    ok: false,
    code: "NO_COMPATIBLE_STEP",
    message: "현재 단계에 대응하는 단계가 대상 워크플로에 없습니다. 단계를 먼저 조정해 주세요.",
  };
}
