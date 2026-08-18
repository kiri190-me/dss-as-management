import "server-only";

import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "../client";
import { users, workflowSteps, workflowTransitions, workflowVersions } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { canEditWorkflowTemplates } from "@/lib/auth/workflow-template-authorization";
import type { RepairStatus } from "@/lib/domain/types";
import type { StepCategory } from "@/lib/domain/local/workflow/step-category";

/**
 * ============================================================================
 * 초안의 단계 편집 (Phase 4c)
 * ============================================================================
 * **DRAFT 버전에서만** 동작한다. 발행된 버전의 단계 구성은 불변이며
 * (DATABASE_DESIGN.md #13), 그 불변식을 여기서 무조건 확인한다 — 화면이 발행본
 * 편집 버튼을 실수로 렌더해도 서버가 막는다.
 *
 * ── 무엇을 바꿀 수 있고 무엇을 못 바꾸는가 ──────────────────────────────
 * 단계 key는 **만든 뒤 바꿀 수 없다.** 전이는 단계 id로 연결되므로 key를 바꿔도
 * 링크는 끊기지 않지만, key는 앱 곳곳에서 의미로 쓰인다 — 신규 접수는
 * intake_inspection에 배치되고(repair-cases.ts), 출하 완료 잠금은
 * shipment_completed를 본다. key를 바꾸면 그 연결이 조용히 끊어지고, 발행
 * 검증조차 "그 key가 없다"고만 말할 수 있다. 이름을 바꾸고 싶으면 label을
 * 바꾸면 된다 — 화면에 보이는 것은 label이다.
 *
 * 순서 변경은 개별 수정이 아니라 전체 목록을 받는 reorder로만 한다. (버전,
 * 순서) 유니크 인덱스 때문에 두 단계를 맞바꾸는 개별 UPDATE는 중간 상태에서
 * 충돌한다.
 * ============================================================================
 */

export type DraftStepResultCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_A_DRAFT"
  | "DUPLICATE_KEY"
  | "INVALID_INPUT"
  | "STEP_IN_USE";

export type DraftStepResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; code: DraftStepResultCode; message: string };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function requireEditableDraft(
  tx: Tx,
  versionId: string,
  actorUserId: string
): Promise<{ ok: true; actorId: string } | { ok: false; code: DraftStepResultCode; message: string }> {
  const [actor] = await tx
    .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus })
    .from(users)
    .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
  if (!actor || actor.approvalStatus !== "APPROVED" || !canEditWorkflowTemplates(actor.role)) {
    return { ok: false, code: "FORBIDDEN", message: "워크플로를 편집할 권한이 없습니다." };
  }

  const [version] = await tx
    .select({ id: workflowVersions.id, status: workflowVersions.status })
    .from(workflowVersions)
    .where(eq(workflowVersions.id, versionId))
    .for("update");
  if (!version) return { ok: false, code: "NOT_FOUND", message: "버전을 찾을 수 없습니다." };
  if (version.status !== "DRAFT") {
    return { ok: false, code: "NOT_A_DRAFT", message: "발행된 버전의 단계 구성은 변경할 수 없습니다. 새 초안을 만들어 주세요." };
  }
  return { ok: true, actorId: actor.id };
}

/** 단계를 맨 뒤에 추가한다. 중간에 끼워 넣으려면 추가 후 reorder를 부른다. */
export async function addWorkflowDraftStep(params: {
  versionId: string;
  key: string;
  label: string;
  status: RepairStatus;
  category: StepCategory | null;
  actorUserId: string;
}): Promise<DraftStepResult<{ stepId: string; order: number }>> {
  const key = params.key.trim();
  const label = params.label.trim();
  if (!/^[a-z][a-z0-9_]*$/.test(key)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "단계 키는 영문 소문자로 시작하고 소문자·숫자·밑줄만 쓸 수 있습니다.",
    };
  }
  if (!label) return { ok: false, code: "INVALID_INPUT", message: "단계 이름을 입력해 주세요." };

  return db.transaction(async (tx) => {
    const guard = await requireEditableDraft(tx, params.versionId, params.actorUserId);
    if (!guard.ok) return guard;

    const [duplicate] = await tx
      .select({ id: workflowSteps.id })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.workflowVersionId, params.versionId), eq(workflowSteps.key, key)));
    if (duplicate) return { ok: false as const, code: "DUPLICATE_KEY" as const, message: `이미 같은 키의 단계가 있습니다: ${key}` };

    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${workflowSteps.stepOrder}), 0)` })
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowVersionId, params.versionId));
    const order = Number(max) + 1;

    const [created] = await tx
      .insert(workflowSteps)
      .values({
        workflowVersionId: params.versionId,
        stepOrder: order,
        key,
        label,
        repairStatus: params.status,
        category: params.category,
        isActive: true,
      })
      .returning({ id: workflowSteps.id });

    await insertAuditLog(tx, {
      actorUserId: guard.actorId,
      actionType: "CREATE",
      targetEntity: "workflow_steps",
      targetRecordId: created.id,
      previousValue: null,
      newValue: { versionId: params.versionId, key, label, order, status: params.status, category: params.category },
    });

    return { ok: true as const, stepId: created.id, order };
  });
}

/**
 * 단계의 표시 내용과 상태·분류·활성 여부를 바꾼다. key와 order는 여기서 바꿀 수
 * 없다(위 파일 주석 참고).
 */
export async function updateWorkflowDraftStep(params: {
  stepId: string;
  actorUserId: string;
  label?: string;
  status?: RepairStatus;
  category?: StepCategory | null;
  isActive?: boolean;
}): Promise<DraftStepResult> {
  return db.transaction(async (tx) => {
    const [step] = await tx
      .select({
        id: workflowSteps.id,
        versionId: workflowSteps.workflowVersionId,
        key: workflowSteps.key,
        label: workflowSteps.label,
        status: workflowSteps.repairStatus,
        category: workflowSteps.category,
        isActive: workflowSteps.isActive,
      })
      .from(workflowSteps)
      .where(eq(workflowSteps.id, params.stepId));
    if (!step) return { ok: false as const, code: "NOT_FOUND" as const, message: "단계를 찾을 수 없습니다." };

    const guard = await requireEditableDraft(tx, step.versionId, params.actorUserId);
    if (!guard.ok) return guard;

    const nextLabel = params.label?.trim();
    if (params.label !== undefined && !nextLabel) {
      return { ok: false as const, code: "INVALID_INPUT" as const, message: "단계 이름을 입력해 주세요." };
    }

    await tx
      .update(workflowSteps)
      .set({
        ...(nextLabel !== undefined ? { label: nextLabel } : {}),
        ...(params.status !== undefined ? { repairStatus: params.status } : {}),
        ...(params.category !== undefined ? { category: params.category } : {}),
        ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(workflowSteps.id, step.id));

    await insertAuditLog(tx, {
      actorUserId: guard.actorId,
      actionType: "UPDATE",
      targetEntity: "workflow_steps",
      targetRecordId: step.id,
      previousValue: { label: step.label, status: step.status, category: step.category, isActive: step.isActive },
      newValue: {
        label: nextLabel ?? step.label,
        status: params.status ?? step.status,
        category: params.category !== undefined ? params.category : step.category,
        isActive: params.isActive ?? step.isActive,
      },
    });

    return { ok: true as const };
  });
}

/**
 * 단계 순서를 통째로 다시 매긴다. 개별 UPDATE로 두 단계를 맞바꾸면 (버전, 순서)
 * 유니크 인덱스가 중간 상태에서 걸리므로, 먼저 전부 음수 구간으로 옮긴 뒤
 * 최종 값을 넣는 2단계로 처리한다.
 */
export async function reorderWorkflowDraftSteps(params: {
  versionId: string;
  orderedStepIds: string[];
  actorUserId: string;
}): Promise<DraftStepResult> {
  return db.transaction(async (tx) => {
    const guard = await requireEditableDraft(tx, params.versionId, params.actorUserId);
    if (!guard.ok) return guard;

    const existing = await tx
      .select({ id: workflowSteps.id, order: workflowSteps.stepOrder })
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowVersionId, params.versionId))
      .orderBy(asc(workflowSteps.stepOrder));

    const existingIds = new Set(existing.map((s) => s.id));
    const givenIds = new Set(params.orderedStepIds);
    if (existingIds.size !== givenIds.size || params.orderedStepIds.some((id) => !existingIds.has(id))) {
      // 일부만 받으면 빠진 단계의 순서를 어떻게 할지 정할 수 없다 — 조용히
      // 뒤로 밀지 않고 거부한다.
      return {
        ok: false as const,
        code: "INVALID_INPUT" as const,
        message: "순서 목록이 이 버전의 단계 전체와 일치하지 않습니다.",
      };
    }

    for (const step of existing) {
      await tx
        .update(workflowSteps)
        .set({ stepOrder: -step.order })
        .where(eq(workflowSteps.id, step.id));
    }
    for (const [index, stepId] of params.orderedStepIds.entries()) {
      await tx
        .update(workflowSteps)
        .set({ stepOrder: index + 1, updatedAt: new Date() })
        .where(eq(workflowSteps.id, stepId));
    }

    await insertAuditLog(tx, {
      actorUserId: guard.actorId,
      actionType: "UPDATE",
      targetEntity: "workflow_versions",
      targetRecordId: params.versionId,
      previousValue: { order: existing.map((s) => s.id) },
      newValue: { order: params.orderedStepIds },
    });

    return { ok: true as const };
  });
}

/**
 * 단계를 지운다. 그 단계를 오가는 이동 규칙도 함께 지운다 — 남겨 두면 없는
 * 단계를 가리키는 규칙이 되어 발행 검증에서 걸리고, 무엇보다 FK가 restrict라
 * 애초에 지워지지 않는다.
 *
 * 지운 뒤 순서에 구멍이 남는 것은 그대로 둔다. 순서는 상대적 크기만 의미가
 * 있고, 다시 촘촘히 매기고 싶으면 reorder를 부르면 된다.
 */
export async function removeWorkflowDraftStep(params: {
  stepId: string;
  actorUserId: string;
}): Promise<DraftStepResult<{ removedTransitions: number }>> {
  return db.transaction(async (tx) => {
    const [step] = await tx
      .select({
        id: workflowSteps.id,
        versionId: workflowSteps.workflowVersionId,
        key: workflowSteps.key,
        label: workflowSteps.label,
      })
      .from(workflowSteps)
      .where(eq(workflowSteps.id, params.stepId));
    if (!step) return { ok: false as const, code: "NOT_FOUND" as const, message: "단계를 찾을 수 없습니다." };

    const guard = await requireEditableDraft(tx, step.versionId, params.actorUserId);
    if (!guard.ok) return guard;

    const removed = await tx
      .delete(workflowTransitions)
      .where(
        and(
          eq(workflowTransitions.workflowVersionId, step.versionId),
          sql`(${workflowTransitions.fromStepId} = ${step.id} or ${workflowTransitions.toStepId} = ${step.id})`
        )
      )
      .returning({ id: workflowTransitions.id });

    await tx.delete(workflowSteps).where(eq(workflowSteps.id, step.id));

    await insertAuditLog(tx, {
      actorUserId: guard.actorId,
      actionType: "SOFT_DELETE",
      targetEntity: "workflow_steps",
      targetRecordId: step.id,
      previousValue: { versionId: step.versionId, key: step.key, label: step.label },
      newValue: { removedTransitionCount: removed.length },
    });

    return { ok: true as const, removedTransitions: removed.length };
  });
}

/** 화면이 "이 순서 목록이 최신인가"를 확인할 때 쓰는 조회. */
export async function listWorkflowDraftStepIds(versionId: string): Promise<string[]> {
  const rows = await db
    .select({ id: workflowSteps.id })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.workflowVersionId, versionId), ne(workflowSteps.id, "")))
    .orderBy(asc(workflowSteps.stepOrder));
  return rows.map((r) => r.id);
}
