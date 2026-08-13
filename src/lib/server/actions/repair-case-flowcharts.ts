"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  createRepairCaseFlowchart,
  updateRepairCaseFlowchartMetadata,
  softDeleteRepairCaseFlowchart,
} from "@/lib/db/mutations/repair-case-flowcharts";
import {
  isValidRepairCaseId,
  isValidFlowchartId,
  isValidExpectedUpdatedAt,
  validateFlowchartTitle,
  validateFlowchartDescription,
  validateFlowchartDeleteReason,
  type CreateRepairCaseFlowchartActionResult,
  type UpdateRepairCaseFlowchartMetadataActionResult,
  type SoftDeleteRepairCaseFlowchartActionResult,
} from "@/lib/validation/repair-case-flowchart-input";

/**
 * Server Actions for Phase 5C-6B flowchart-object management. Same layering
 * as repair-case-work-records.ts's actions: resolve the session, validate
 * input shape, delegate to the mutation layer, redact unexpected DB errors.
 * Role/assignment/lock authorization is entirely re-checked inside the
 * mutation layer — this file only confirms a valid, approved session
 * exists. Node/edge graph actions do not exist yet (5C-6C+).
 */

type Forbidden = { ok: false; code: "FORBIDDEN"; message: string };

async function resolveAuthorizedActorId(): Promise<{ ok: true; userId: string } | { ok: false; result: Forbidden }> {
  if (getAuthSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." } };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." } };
  }
  return { ok: true, userId: session.userId };
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

export async function createRepairCaseFlowchartAction(input: {
  repairCaseId: string;
  title: string;
  description?: string | null;
}): Promise<CreateRepairCaseFlowchartActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return { ok: false, code: "UNAUTHORIZED", message: actorCheck.result.message };

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  const titleValidation = validateFlowchartTitle(input.title);
  if (!titleValidation.ok) return { ok: false, code: "VALIDATION_ERROR", message: titleValidation.error };
  const descriptionValidation = validateFlowchartDescription(input.description);
  if (!descriptionValidation.ok) return { ok: false, code: "VALIDATION_ERROR", message: descriptionValidation.error };

  try {
    const result = await createRepairCaseFlowchart({
      repairCaseId: input.repairCaseId,
      actorUserId: actorCheck.userId,
      title: titleValidation.title,
      description: descriptionValidation.description,
    });
    return result;
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("createRepairCaseFlowchartAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function updateRepairCaseFlowchartMetadataAction(input: {
  repairCaseId: string;
  flowchartId: string;
  title: string;
  description?: string | null;
  expectedUpdatedAt: string;
}): Promise<UpdateRepairCaseFlowchartMetadataActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return { ok: false, code: "UNAUTHORIZED", message: actorCheck.result.message };

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidFlowchartId(input.flowchartId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "해당 Flowchart를 확인할 수 없습니다." };
  }
  if (!isValidExpectedUpdatedAt(input.expectedUpdatedAt)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요." };
  }
  const titleValidation = validateFlowchartTitle(input.title);
  if (!titleValidation.ok) return { ok: false, code: "VALIDATION_ERROR", message: titleValidation.error };
  const descriptionValidation = validateFlowchartDescription(input.description);
  if (!descriptionValidation.ok) return { ok: false, code: "VALIDATION_ERROR", message: descriptionValidation.error };

  try {
    const result = await updateRepairCaseFlowchartMetadata({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      actorUserId: actorCheck.userId,
      title: titleValidation.title,
      description: descriptionValidation.description,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
    return result;
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("updateRepairCaseFlowchartMetadataAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function softDeleteRepairCaseFlowchartAction(input: {
  repairCaseId: string;
  flowchartId: string;
  deleteReason?: string | null;
  expectedUpdatedAt: string;
}): Promise<SoftDeleteRepairCaseFlowchartActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return { ok: false, code: "UNAUTHORIZED", message: actorCheck.result.message };

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidFlowchartId(input.flowchartId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "해당 Flowchart를 확인할 수 없습니다." };
  }
  if (!isValidExpectedUpdatedAt(input.expectedUpdatedAt)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요." };
  }
  const reasonValidation = validateFlowchartDeleteReason(input.deleteReason);
  if (!reasonValidation.ok) return { ok: false, code: "VALIDATION_ERROR", message: reasonValidation.error };

  try {
    const result = await softDeleteRepairCaseFlowchart({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      actorUserId: actorCheck.userId,
      deleteReason: reasonValidation.reason,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
    return result;
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("softDeleteRepairCaseFlowchartAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
