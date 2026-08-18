import "server-only";

import { canEditProductModels } from "@/lib/auth/product-model-authorization";
import {
  claimIdempotencyKey,
  markIdempotencyKeyFailed,
  markIdempotencyKeySucceeded,
} from "@/lib/db/mutations/idempotency-keys";
import { createRepairCase } from "@/lib/db/mutations/repair-cases";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import type { Role } from "@/lib/domain/types";
import {
  isValidIdempotencyKey,
  validateCreateRepairCaseInput,
  type CreateRepairCaseResult,
} from "@/lib/validation/repair-case-input";

export const ALLOWED_INTAKE_CREATOR_ROLES: readonly Role[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "AS_ENGINEER",
  "SALES",
  "INVENTORY_MANAGER",
];

export type RepairCaseCreator = {
  userId: string;
  role: Role;
  approvalStatus: "PENDING" | "APPROVED";
};

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

const LEGACY_IMPORT_TARGET_STEPS = new Set([
  "shipment_completed",
  "waiting_po",
  "parts_supply",
  "waiting_shipment",
  "repair_in_progress",
  "repair_or_defective_parts_replacement",
]);

function validLegacyImportState(input: NonNullable<Parameters<typeof createRepairCaseWithIdempotency>[0]["legacyImportState"]>): boolean {
  const completed = input.targetStepKey === "shipment_completed";
  return LEGACY_IMPORT_TARGET_STEPS.has(input.targetStepKey)
    && Number.isInteger(input.sourceRowNumber)
    && input.sourceRowNumber >= 4
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.batchId)
    && (completed
      ? input.actualShipmentDate === null || /^\d{4}-\d{2}-\d{2}$/.test(input.actualShipmentDate)
      : input.actualShipmentDate === null);
}

/**
 * Shared intake execution boundary. The interactive Server Action and Excel
 * chunk runner both enter here, so validation, authorization, idempotency and
 * the one-case transaction remain identical. It never reads a session and is
 * therefore safe to call repeatedly after a batch action resolved its actor.
 */
export async function createRepairCaseWithIdempotency(input: {
  actor: RepairCaseCreator;
  intake: IntakeSubmissionInput;
  idempotencyKey: string;
  logContext: "INTERACTIVE" | "EXCEL_IMPORT";
  legacyImportState?: {
    targetStepKey: string;
    actualShipmentDate: string | null;
    batchId: string;
    sourceRowNumber: number;
  };
  legacyReportNumber?: string | null;
}): Promise<CreateRepairCaseResult> {
  const { actor, intake, idempotencyKey } = input;
  if (
    actor.approvalStatus !== "APPROVED" ||
    !ALLOWED_INTAKE_CREATOR_ROLES.includes(actor.role)
  ) {
    return { ok: false, code: "FORBIDDEN", message: "A/S 접수 등록 권한이 없습니다." };
  }
  if (intake.newProductModelName && !canEditProductModels(actor.role)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      fieldErrors: { modelName: "새 Model 등록 권한이 없습니다. 등록된 Model을 선택해 주세요." },
      message: "새 Model 등록 권한이 없습니다.",
    };
  }
  if (!isValidIdempotencyKey(idempotencyKey)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { idempotencyKey: "제출 식별자를 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요." },
      message: "입력값을 확인해 주세요.",
    };
  }
  const validation = validateCreateRepairCaseInput(intake, {
    allowPendingBilling: input.logContext === "EXCEL_IMPORT",
  });
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: "입력값을 확인해 주세요.",
    };
  }
  if (input.legacyImportState && input.logContext !== "EXCEL_IMPORT") {
    return { ok: false, code: "FORBIDDEN", message: "과거 상태 지정은 Excel 이관에서만 사용할 수 있습니다." };
  }
  if (input.legacyReportNumber !== undefined && input.logContext !== "EXCEL_IMPORT") {
    return { ok: false, code: "FORBIDDEN", message: "레거시 보고서번호는 Excel 이관에서만 사용할 수 있습니다." };
  }
  if (input.legacyReportNumber !== undefined && input.legacyReportNumber !== null && input.legacyReportNumber.length > 32767) {
    return { ok: false, code: "VALIDATION_ERROR", message: "레거시 보고서번호를 확인할 수 없습니다." };
  }
  if (input.legacyImportState && !validLegacyImportState(input.legacyImportState)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "과거 상태 이관 정보를 확인할 수 없습니다." };
  }

  const claim = await claimIdempotencyKey(idempotencyKey, actor.userId);
  if (claim.state === "IN_PROGRESS") {
    return { ok: false, code: "SUBMISSION_IN_PROGRESS", message: "이전 제출이 아직 처리 중입니다. 잠시 후 다시 시도해 주세요." };
  }
  if (claim.state === "SUCCEEDED") {
    return { ok: true, id: claim.repairCaseId, intakeNumber: claim.intakeNumber };
  }
  if (claim.state === "USER_MISMATCH") {
    return { ok: false, code: "FORBIDDEN", message: "A/S 접수 등록 권한이 없습니다." };
  }

  try {
    const result = await createRepairCase(validation.data, {
      legacyReportNumber: input.legacyReportNumber,
      ...(input.legacyImportState
        ? {
            legacyImportState: {
              ...input.legacyImportState,
              actorUserId: actor.userId,
            },
          }
        : {}),
    });
    if (result.ok) {
      await markIdempotencyKeySucceeded(idempotencyKey, result.id, result.intakeNumber);
    } else {
      await markIdempotencyKeyFailed(idempotencyKey);
    }
    return result;
  } catch (err) {
    await markIdempotencyKeyFailed(idempotencyKey);
    console.error("createRepairCaseWithIdempotency: unexpected DB error", {
      context: input.logContext,
      code: isPgErrorLike(err) ? err.code : undefined,
    });
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}
