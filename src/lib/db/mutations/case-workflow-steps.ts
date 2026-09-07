import "server-only";

import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../client";
import {
  repairCases,
  users,
  workflowSteps,
  workflowTemplates,
  workflowTransitions,
  workflowVersions,
} from "../schema";
import { insertAuditLog } from "./audit-logs";
import { actorMay } from "@/lib/auth/developer-promotion";
import type { RepairStatus } from "@/lib/domain/types";
import type { StepCategory } from "@/lib/domain/local/workflow/step-category";

/**
 * ============================================================================
 * 접수 건 하나에만 단계 끼워넣기 (2026-08-19 승인)
 * ============================================================================
 * 템플릿 워크플로를 바탕으로 이 제품에만 필요한 단계를 하나 더 두는 기능이다.
 *
 * ── 왜 "건 전용 버전"인가 ───────────────────────────────────────────────
 * repair_cases.workflow_version_id는 원래부터 "이 접수 건이 따르는 규칙 집합"
 * 이고, 전이 엔진(Phase 2)은 버전 단위로 규칙을 읽는다. 그래서 이 건만의
 * 변주는 **이 건 전용 버전을 만들어 붙이는 것**으로 표현된다 — 전이 엔진,
 * 권한 판정, 화면 힌트가 한 줄도 바뀌지 않는다.
 *
 * 별도 테이블(케이스 전용 단계)을 두는 방안은 버렸다. current_workflow_step_id가
 * workflow_steps를 가리키므로 접수 건이 그 단계에 놓일 수조차 없고, 엔진 전체를
 * 고쳐야 한다.
 *
 * ── 무엇만 허용하는가 ───────────────────────────────────────────────────
 * **현재 단계 바로 다음에 끼워넣기만** 한다(사용자 결정). 삭제·순서 변경은
 * 하지 않는다 — 진행 중인 건에서 이미 지나온 단계를 지우는 상황을 만들지 않기
 * 위해서다. 끼워넣으면 전이도 자동으로 다시 이어 붙인다:
 *
 *     (전) 현재 ──진행──▶ 다음
 *     (후) 현재 ──진행──▶ 새 단계 ──진행──▶ 다음
 *                          └──되돌리기──▶ 현재
 *
 * 이 자동 재배선이 A-1을 고른 이유이기도 하다. 사람이 전이를 직접 이어야 하면
 * 빠뜨리기 쉽고, 빠뜨리면 그 건은 갇힌다(product_intake에서 실제로 겪었다).
 *
 * ── 알려진 제약 ─────────────────────────────────────────────────────────
 * 유·무상을 바꾸면 워크플로가 다른 템플릿의 current 버전으로 재배정되면서 이
 * 전용 버전이 버려진다(끼워넣은 단계도 함께). 사용자 결정에 따라 막지 않고
 * 화면에서 경고만 한다.
 * ============================================================================
 */

export type CaseWorkflowStepResultCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CASE_LOCKED"
  | "DUPLICATE_KEY"
  | "INVALID_INPUT";

export type CaseWorkflowStepResult =
  | { ok: true; versionId: string; stepId: string; createdCaseVersion: boolean; version: number }
  | { ok: false; code: CaseWorkflowStepResultCode; message: string };

/**
 * 이 건 전용 버전을 확보한다. 이미 전용 버전을 쓰고 있으면 그대로 쓰고,
 * 아직 템플릿의 공용 버전을 쓰고 있으면 통째로 복제한다.
 *
 * 복제본은 is_current=false이므로 다른 접수 건에는 절대 배정되지 않는다
 * (신규 접수·유·무상 재배정 모두 is_current=true인 버전만 찾는다).
 */
async function ensureCaseScopedVersion(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: { repairCaseId: string; currentVersionId: string; currentStepId: string; actorId: string }
): Promise<{ versionId: string; currentStepId: string; created: boolean }> {
  const [version] = await tx
    .select({
      id: workflowVersions.id,
      templateId: workflowVersions.workflowTemplateId,
      versionNumber: workflowVersions.versionNumber,
      isCaseScoped: workflowVersions.isCaseScoped,
    })
    .from(workflowVersions)
    .where(eq(workflowVersions.id, params.currentVersionId));
  if (version?.isCaseScoped) {
    return { versionId: version.id, currentStepId: params.currentStepId, created: false };
  }

  const [{ max }] = await tx
    .select({ max: sql<number>`coalesce(max(${workflowVersions.versionNumber}), 0)` })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowTemplateId, version.templateId));

  const [copy] = await tx
    .insert(workflowVersions)
    .values({
      workflowTemplateId: version.templateId,
      versionNumber: Number(max) + 1,
      // PUBLISHED + is_current=false: 규칙으로서는 확정본이지만 신규 배정
      // 대상은 아니다. DRAFT로 두면 초안 편집기가 이 버전을 "작성 중인 초안"
      // 으로 착각해 워크플로 관리 화면에 끌어올린다.
      status: "PUBLISHED",
      isCurrent: false,
      isCaseScoped: true,
      repairCaseId: params.repairCaseId,
      publishedAt: new Date(),
      createdBy: params.actorId,
    })
    .returning({ id: workflowVersions.id });

  const sourceSteps = await tx.select().from(workflowSteps).where(eq(workflowSteps.workflowVersionId, version.id));
  const stepIdMap = new Map<string, string>();
  for (const step of sourceSteps) {
    const [copied] = await tx
      .insert(workflowSteps)
      .values({
        workflowVersionId: copy.id,
        stepOrder: step.stepOrder,
        key: step.key,
        label: step.label,
        repairStatus: step.repairStatus,
        category: step.category,
        isActive: step.isActive,
      })
      .returning({ id: workflowSteps.id });
    stepIdMap.set(step.id, copied.id);
  }

  const sourceTransitions = await tx
    .select()
    .from(workflowTransitions)
    .where(eq(workflowTransitions.workflowVersionId, version.id));
  for (const transition of sourceTransitions) {
    const from = stepIdMap.get(transition.fromStepId);
    const to = stepIdMap.get(transition.toStepId);
    if (!from || !to) continue;
    await tx.insert(workflowTransitions).values({
      workflowVersionId: copy.id,
      actionCode: transition.actionCode,
      fromStepId: from,
      toStepId: to,
      allowedRoles: transition.allowedRoles,
      requiresAssignedEngineer: transition.requiresAssignedEngineer,
      requiresReason: transition.requiresReason,
      requiredApprovalType: transition.requiredApprovalType,
    });
  }

  const mappedCurrentStep = stepIdMap.get(params.currentStepId);
  if (!mappedCurrentStep) {
    // 현재 단계를 복제본에서 찾지 못하면 접수 건을 옮길 수 없다. 조용히
    // 넘어가면 그 건이 남의 버전 단계를 가리키게 된다.
    throw new Error("현재 단계를 전용 버전으로 옮기지 못했습니다.");
  }
  return { versionId: copy.id, currentStepId: mappedCurrentStep, created: true };
}

export async function addCaseWorkflowStep(params: {
  repairCaseId: string;
  expectedVersion: number;
  /**
   * 생략하면 case_step_N으로 자동 생성한다. 화면에서는 키를 묻지 않는다 —
   * 앱이 의미로 읽는 키(intake_inspection, shipment_completed 등)는 정해져
   * 있고, 이 건에만 있는 단계는 그 어느 것도 아니어야 하기 때문이다. 뜻이 없는
   * 키를 자동으로 붙이면 사용자가 실수로 의미 있는 키를 가로챌 일이 없다.
   */
  key?: string;
  label: string;
  status: RepairStatus;
  category: StepCategory | null;
  actorUserId: string;
}): Promise<CaseWorkflowStepResult> {
  const requestedKey = params.key?.trim() ?? "";
  const label = params.label.trim();
  if (requestedKey && !/^[a-z][a-z0-9_]*$/.test(requestedKey)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "단계 키는 영문 소문자로 시작하고 소문자·숫자·밑줄만 쓸 수 있습니다.",
    };
  }
  if (!label) return { ok: false, code: "INVALID_INPUT", message: "단계 이름을 입력해 주세요." };

  return db.transaction(async (tx): Promise<CaseWorkflowStepResult> => {
    const [current] = await tx
      .select({
        id: repairCases.id,
        version: repairCases.version,
        isLocked: repairCases.isLocked,
        assignedEngineerId: repairCases.assignedEngineerId,
        workflowVersionId: repairCases.workflowVersionId,
        currentWorkflowStepId: repairCases.currentWorkflowStepId,
        templateCode: workflowTemplates.code,
      })
      .from(repairCases)
      .innerJoin(workflowVersions, eq(workflowVersions.id, repairCases.workflowVersionId))
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
      .where(and(eq(repairCases.id, params.repairCaseId), eq(repairCases.isDeleted, false)))
      .for("update");
    if (!current) return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
    if (current.version !== params.expectedVersion) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "다른 사용자가 이 접수 건을 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.",
      };
    }
    if (current.isLocked) {
      return { ok: false, code: "CASE_LOCKED", message: "출하 완료 후 잠금된 접수 건입니다." };
    }

    const [actor] = await tx
      .select({
        id: users.id,
        role: users.role,
        approvalStatus: users.approvalStatus,
        // 개발자 표시. 아래 역할 관문이 「최고관리자 동급」을 더해 판정한다 —
        // 이 칸을 안 읽으면 화면(evaluateAddCaseStepAvailability)만 열리고
        // 서버가 거절하는 어긋남이 된다.
        isDeveloper: users.isDeveloper,
      })
      .from(users)
      .where(and(eq(users.id, params.actorUserId), eq(users.isDeleted, false)));
    if (!actor || actor.approvalStatus !== "APPROVED") {
      return { ok: false, code: "FORBIDDEN", message: "사용자 정보를 확인할 수 없습니다." };
    }
    // 담당 엔지니어 본인만(사용자 결정). 관리자는 이 앱의 다른 모든 권한
    // 검사와 마찬가지로 담당 일치 검사를 우회한다.
    //
    // 문을 **여는** 자리다 — 승격은 개발자가 이 문을 통과하는 방향으로 작동한다
    // (developer-promotion.ts). 아래 두 검사는 개발자가 여기서 이미 통과하므로
    // 닿지 않는다: 승인 검사(위)는 승격 대상이 아니고, 배정 사실도 그대로다.
    const isAdmin = actorMay(actor, (role) => role === "SUPER_ADMIN" || role === "ADMIN");
    if (!isAdmin) {
      if (actor.role !== "AS_ENGINEER") {
        return { ok: false, code: "FORBIDDEN", message: "담당 엔지니어 또는 관리자만 단계를 추가할 수 있습니다." };
      }
      if (current.assignedEngineerId !== actor.id) {
        return { ok: false, code: "FORBIDDEN", message: "이 접수 건의 담당 엔지니어만 단계를 추가할 수 있습니다." };
      }
    }

    const scoped = await ensureCaseScopedVersion(tx, {
      repairCaseId: current.id,
      currentVersionId: current.workflowVersionId,
      currentStepId: current.currentWorkflowStepId,
      actorId: actor.id,
    });

    // 키 확정. 자동 생성은 이 버전 안에서만 유일하면 되므로(키의 유니크 범위가
    // 버전 단위다) 트랜잭션 안에서 현재 키 목록을 보고 빈 번호를 고른다.
    const existingKeys = new Set(
      (
        await tx
          .select({ key: workflowSteps.key })
          .from(workflowSteps)
          .where(eq(workflowSteps.workflowVersionId, scoped.versionId))
      ).map((s) => s.key)
    );
    let key = requestedKey;
    if (!key) {
      let n = 1;
      while (existingKeys.has(`case_step_${n}`)) n += 1;
      key = `case_step_${n}`;
    } else if (existingKeys.has(key)) {
      return { ok: false, code: "DUPLICATE_KEY", message: `이미 같은 키의 단계가 있습니다: ${key}` };
    }

    const [currentStep] = await tx
      .select({ id: workflowSteps.id, order: workflowSteps.stepOrder, label: workflowSteps.label })
      .from(workflowSteps)
      .where(eq(workflowSteps.id, scoped.currentStepId));

    // 뒤 단계들의 순서를 한 칸씩 민다. (버전, 순서) 유니크 인덱스 때문에
    // 큰 번호부터 내림차순으로 옮겨야 중간 상태에서 충돌하지 않는다.
    const following = await tx
      .select({ id: workflowSteps.id, order: workflowSteps.stepOrder })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.workflowVersionId, scoped.versionId), gt(workflowSteps.stepOrder, currentStep.order)))
      .orderBy(desc(workflowSteps.stepOrder));
    for (const step of following) {
      await tx.update(workflowSteps).set({ stepOrder: step.order + 1 }).where(eq(workflowSteps.id, step.id));
    }

    const [inserted] = await tx
      .insert(workflowSteps)
      .values({
        workflowVersionId: scoped.versionId,
        stepOrder: currentStep.order + 1,
        key,
        label,
        repairStatus: params.status,
        category: params.category,
        isActive: true,
      })
      .returning({ id: workflowSteps.id });

    // ── 전이 재배선 ────────────────────────────────────────────────────
    // 현재 단계의 정방향 전이가 있으면 그 목적지를 새 단계로 돌리고, 원래
    // 목적지로 가는 전이를 새 단계에서 새로 만든다. 없으면(막다른 단계였다면)
    // 현재 → 새 단계만 만든다.
    const [advance] = await tx
      .select({
        id: workflowTransitions.id,
        toStepId: workflowTransitions.toStepId,
        allowedRoles: workflowTransitions.allowedRoles,
        requiresAssignedEngineer: workflowTransitions.requiresAssignedEngineer,
        requiresReason: workflowTransitions.requiresReason,
        requiredApprovalType: workflowTransitions.requiredApprovalType,
      })
      .from(workflowTransitions)
      .where(
        and(
          eq(workflowTransitions.workflowVersionId, scoped.versionId),
          eq(workflowTransitions.actionCode, "STEP_ADVANCED"),
          eq(workflowTransitions.fromStepId, currentStep.id)
        )
      );

    // 새 단계에서 나가는 전이는 원래 전이의 조건(역할·사유·승인)을 물려받는다.
    // 끼워넣기는 흐름을 한 칸 늘리는 것이지 규칙을 바꾸는 것이 아니다.
    const inheritedRoles = advance?.allowedRoles ?? (["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const);
    if (advance) {
      await tx
        .update(workflowTransitions)
        .set({ toStepId: inserted.id, requiredApprovalType: null, updatedAt: new Date() })
        .where(eq(workflowTransitions.id, advance.id));

      await tx.insert(workflowTransitions).values({
        workflowVersionId: scoped.versionId,
        actionCode: "STEP_ADVANCED",
        fromStepId: inserted.id,
        toStepId: advance.toStepId,
        allowedRoles: advance.allowedRoles,
        requiresAssignedEngineer: advance.requiresAssignedEngineer,
        requiresReason: advance.requiresReason,
        // 승인 요건은 원래 목적지로 들어갈 때 지켜야 하므로 새 단계 → 원래
        // 목적지 쪽에 남긴다. 앞 구간(현재 → 새 단계)에서는 떼어 낸다.
        requiredApprovalType: advance.requiredApprovalType,
      });

      // 되돌리는 길도 같이 옮긴다. 원래 다음 단계에서 되돌리면 현재 단계로
      // 갔는데, 그대로 두면 새로 끼워넣은 단계를 건너뛴다 — 앞으로 갈 때는
      // 거치고 뒤로 올 때는 건너뛰는 흐름이 된다. 목적지가 현재 단계일 때만
      // 손댄다(다른 곳을 가리키는 규칙은 이 끼워넣기와 무관하다).
      await tx
        .update(workflowTransitions)
        .set({ toStepId: inserted.id, updatedAt: new Date() })
        .where(
          and(
            eq(workflowTransitions.workflowVersionId, scoped.versionId),
            eq(workflowTransitions.actionCode, "STEP_RETURNED"),
            eq(workflowTransitions.fromStepId, advance.toStepId),
            eq(workflowTransitions.toStepId, currentStep.id)
          )
        );
    } else {
      await tx.insert(workflowTransitions).values({
        workflowVersionId: scoped.versionId,
        actionCode: "STEP_ADVANCED",
        fromStepId: currentStep.id,
        toStepId: inserted.id,
        allowedRoles: [...inheritedRoles],
        requiresAssignedEngineer: false,
        requiresReason: false,
        requiredApprovalType: null,
      });
    }

    // 새 단계에서 현재 단계로 돌아오는 길. 없으면 잘못 넘어갔을 때 되돌릴
    // 방법이 없다.
    await tx.insert(workflowTransitions).values({
      workflowVersionId: scoped.versionId,
      actionCode: "STEP_RETURNED",
      fromStepId: inserted.id,
      toStepId: currentStep.id,
      allowedRoles: [...inheritedRoles],
      requiresAssignedEngineer: true,
      requiresReason: false,
      requiredApprovalType: null,
    });

    const [updated] = await tx
      .update(repairCases)
      .set({
        workflowVersionId: scoped.versionId,
        currentWorkflowStepId: scoped.currentStepId,
        version: sql`${repairCases.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(repairCases.id, current.id), eq(repairCases.version, current.version)))
      .returning({ version: repairCases.version });
    if (!updated) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "다른 사용자가 이 접수 건을 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.",
      };
    }

    await insertAuditLog(tx, {
      actorUserId: actor.id,
      actionType: "CREATE",
      targetEntity: "workflow_steps",
      targetRecordId: inserted.id,
      previousValue: {
        repairCaseId: current.id,
        workflowVersionId: current.workflowVersionId,
        templateCode: current.templateCode,
      },
      newValue: {
        repairCaseId: current.id,
        workflowVersionId: scoped.versionId,
        createdCaseVersion: scoped.created,
        key,
        label,
        insertedAfter: currentStep.label,
        status: params.status,
        category: params.category,
      },
    });

    return {
      ok: true,
      versionId: scoped.versionId,
      stepId: inserted.id,
      createdCaseVersion: scoped.created,
      version: updated.version,
    };
  });
}
