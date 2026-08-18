"use server";

import { readSession } from "@/lib/auth/session";
import {
  createWorkflowDraft,
  discardWorkflowDraft,
  publishWorkflowDraft,
} from "@/lib/db/mutations/workflow-drafts";
import {
  addWorkflowDraftStep,
  removeWorkflowDraftStep,
  reorderWorkflowDraftSteps,
  updateWorkflowDraftStep,
} from "@/lib/db/mutations/workflow-draft-steps";
import { REPAIR_STATUS_CODES, type RepairStatus } from "@/lib/domain/types";
import { STEP_CATEGORY_CODES, type StepCategory } from "@/lib/domain/local/workflow/step-category";
import type { DraftValidationIssue } from "@/lib/domain/workflow-draft-validation";

/**
 * 워크플로 초안 편집의 Server Action 층. 이 파일이 하는 일은 세션 확인과 입력
 * 형식 검증뿐이며, 권한·상태(DRAFT인지)·구조 검증은 전부 mutation이 DB 상태를
 * 다시 읽어 판정한다 — 이 프로젝트의 다른 모든 Server Action과 같은 층위다.
 */

export type WorkflowDraftActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string; issues?: DraftValidationIssue[] };

async function requireSession(): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const session = await readSession();
  if (!session) return { ok: false, message: "로그인이 필요합니다." };
  if (session.approvalStatus !== "APPROVED") return { ok: false, message: "계정이 아직 승인되지 않았습니다." };
  return { ok: true, userId: session.userId };
}

function isRepairStatus(value: unknown): value is RepairStatus {
  return typeof value === "string" && (REPAIR_STATUS_CODES as readonly string[]).includes(value);
}

function isStepCategory(value: unknown): value is StepCategory {
  return typeof value === "string" && (STEP_CATEGORY_CODES as readonly string[]).includes(value);
}

export async function createWorkflowDraftAction(templateCode: string): Promise<WorkflowDraftActionResult> {
  const session = await requireSession();
  if (!session.ok) return session;
  const result = await createWorkflowDraft({ templateCode, actorUserId: session.userId });
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function publishWorkflowDraftAction(versionId: string): Promise<WorkflowDraftActionResult> {
  const session = await requireSession();
  if (!session.ok) return session;
  const result = await publishWorkflowDraft({ versionId, actorUserId: session.userId });
  if (result.ok) return { ok: true, message: `v${result.versionNumber}을(를) 발행했습니다.` };
  return { ok: false, message: result.message, issues: result.issues };
}

export async function discardWorkflowDraftAction(versionId: string): Promise<WorkflowDraftActionResult> {
  const session = await requireSession();
  if (!session.ok) return session;
  const result = await discardWorkflowDraft({ versionId, actorUserId: session.userId });
  return result.ok ? { ok: true, message: "초안을 폐기했습니다." } : { ok: false, message: result.message };
}

export async function addWorkflowDraftStepAction(input: {
  versionId: string;
  key: string;
  label: string;
  status: string;
  category: string | null;
}): Promise<WorkflowDraftActionResult> {
  const session = await requireSession();
  if (!session.ok) return session;
  if (!isRepairStatus(input.status)) return { ok: false, message: "상태 값을 확인할 수 없습니다." };
  if (input.category !== null && !isStepCategory(input.category)) {
    return { ok: false, message: "담당 구분 값을 확인할 수 없습니다." };
  }
  const result = await addWorkflowDraftStep({
    versionId: input.versionId,
    key: input.key,
    label: input.label,
    status: input.status,
    category: input.category,
    actorUserId: session.userId,
  });
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function updateWorkflowDraftStepAction(input: {
  stepId: string;
  label?: string;
  status?: string;
  category?: string | null;
  isActive?: boolean;
}): Promise<WorkflowDraftActionResult> {
  const session = await requireSession();
  if (!session.ok) return session;
  if (input.status !== undefined && !isRepairStatus(input.status)) {
    return { ok: false, message: "상태 값을 확인할 수 없습니다." };
  }
  if (input.category !== undefined && input.category !== null && !isStepCategory(input.category)) {
    return { ok: false, message: "담당 구분 값을 확인할 수 없습니다." };
  }
  const result = await updateWorkflowDraftStep({
    stepId: input.stepId,
    actorUserId: session.userId,
    label: input.label,
    status: input.status as RepairStatus | undefined,
    category: input.category as StepCategory | null | undefined,
    isActive: input.isActive,
  });
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function reorderWorkflowDraftStepsAction(input: {
  versionId: string;
  orderedStepIds: string[];
}): Promise<WorkflowDraftActionResult> {
  const session = await requireSession();
  if (!session.ok) return session;
  if (!Array.isArray(input.orderedStepIds) || input.orderedStepIds.some((id) => typeof id !== "string")) {
    return { ok: false, message: "순서 정보를 확인할 수 없습니다." };
  }
  const result = await reorderWorkflowDraftSteps({
    versionId: input.versionId,
    orderedStepIds: input.orderedStepIds,
    actorUserId: session.userId,
  });
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function removeWorkflowDraftStepAction(stepId: string): Promise<WorkflowDraftActionResult> {
  const session = await requireSession();
  if (!session.ok) return session;
  const result = await removeWorkflowDraftStep({ stepId, actorUserId: session.userId });
  if (result.ok) {
    return {
      ok: true,
      message:
        result.removedTransitions > 0
          ? `단계를 삭제하고 관련 이동 규칙 ${result.removedTransitions}개도 함께 정리했습니다.`
          : "단계를 삭제했습니다.",
    };
  }
  return { ok: false, message: result.message };
}
