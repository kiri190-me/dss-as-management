"use server";

import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { transitionWorkflow } from "@/lib/db/mutations/workflow-transitions";
import {
  isValidExpectedVersion,
  isValidRepairCaseId,
  isValidWorkflowActionCode,
  validateReasonFormat,
  type TransitionActionResult,
  type WorkflowActionCode,
} from "@/lib/validation/workflow-transition-input";

export type TransitionWorkflowActionInput = {
  repairCaseId: string;
  expectedVersion: number;
  actionCode: WorkflowActionCode;
  reason?: string | null;
};

/**
 * Server Action: database-backed workflow transitions
 * (ADVANCE/RETURN/HOLD/RELEASE_HOLD/COMPLETE_SHIPMENT). Never trusts any
 * client-supplied current-step or eligibility value — the mutation layer
 * re-reads and re-evaluates everything from scratch. Same layering as
 * create-repair-case.ts/update-repair-case.ts: this file only handles
 * auth + format validation + error redaction; all business logic lives in
 * transitionWorkflow().
 */
export async function transitionWorkflowAction(
  input: TransitionWorkflowActionInput
): Promise<TransitionActionResult> {
  const writeSource = getRepairCaseWriteSource();
  if (writeSource !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  if (getRepairCaseReadSource() !== "database") {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "서버 설정 오류로 처리할 수 없습니다. 관리자에게 문의해 주세요.",
    };
  }

  const session = await readSession();
  if (!session) {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "버전 정보를 확인할 수 없습니다." };
  }
  if (!isValidWorkflowActionCode(input.actionCode)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "작업 종류를 확인할 수 없습니다." };
  }
  const reasonValidation = validateReasonFormat(input.reason);
  if (!reasonValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reasonValidation.error };
  }

  try {
    const result = await transitionWorkflow(
      input.repairCaseId,
      input.expectedVersion,
      input.actionCode,
      session.userId,
      reasonValidation.reason
    );
    return result;
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("transitionWorkflowAction: unexpected DB error", { code });
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
