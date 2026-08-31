import "server-only";

import { canEditProductModels } from "@/lib/auth/product-model-authorization";
import {
  claimIdempotencyKey,
  markIdempotencyKeyFailed,
  markIdempotencyKeySucceeded,
} from "@/lib/db/mutations/idempotency-keys";
import { createRepairCase } from "@/lib/db/mutations/repair-cases";
import { sendIntakeNotificationMail } from "./send-intake-mail";
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

      /*
       * 접수 알림 메일 — **접수가 확정된 뒤에, 대화형에서만.**
       *
       * ■ EXCEL_IMPORT 를 제외하는 이유
       *   과거 자료를 옮기는 경로다. 여기서 보내면 이관 한 번에 수백 통이
       *   전사원에게 나간다.
       *
       * ■ 실패해도 접수는 그대로다
       *   sendIntakeNotificationMail 은 던지지 않고 값을 돌려준다. 그래도
       *   여기서 한 번 더 감싸는 이유는, 그 약속이 깨져도 접수 응답이
       *   실패로 뒤집히지 않게 하기 위해서다 — 물건은 이미 들어와 있고
       *   접수 번호도 나갔다.
       *
       * ■ 기다렸다가 응답한다(뒤로 미루지 않는다)
       *   접수 등록은 사람이 버튼을 누르고 기다리는 조작이고, 메일 발송은
       *   보통 1~2초다. 응답 뒤에 보내려면 그 작업을 살려 둘 장치가 따로
       *   필요한데(서버리스에서는 응답과 함께 죽는다) 이 시스템에는 그런
       *   것이 없다. 늦어지는 만큼은 transport 의 타임아웃이 막는다.
       */
      if (input.logContext === "INTERACTIVE") {
        try {
          const mail = await sendIntakeNotificationMail({ repairCaseId: result.id });
          if (!mail.sent && mail.reason !== "DISABLED" && mail.reason !== "NO_RECIPIENTS") {
            // 껐거나 아무도 안 고른 것은 정상 상태라 시끄럽게 굴지 않는다.
            // 나머지는 아무도 모르게 지나가면 안 된다.
            console.error("접수 알림 메일을 보내지 못했습니다", {
              intakeNumber: result.intakeNumber,
              reason: mail.reason,
              detail: mail.detail,
            });
          }
        } catch (mailError) {
          console.error("접수 알림 메일에서 예상치 못한 오류", {
            intakeNumber: result.intakeNumber,
            message: mailError instanceof Error ? mailError.message : String(mailError),
          });
        }
      }
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
