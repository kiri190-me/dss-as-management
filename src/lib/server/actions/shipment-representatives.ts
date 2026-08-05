"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { setShipmentRepresentative } from "@/lib/db/mutations/shipment-representatives";
import {
  isValidUserId,
  validateReasonFormat,
  type ShipmentManagementResult,
} from "@/lib/validation/shipment-delegation-input";

/**
 * Server Action for users.is_shipment_representative flag management —
 * same auth + format-validation + error-redaction layering as
 * repair-case-approvals.ts's actions. Gated on AUTH_SOURCE=database (this
 * feature has no meaning in mock mode, same as every other DB-only action
 * in this codebase) rather than the repair-case read/write source flags,
 * since it isn't a repair-case feature.
 */

export type SetShipmentRepresentativeActionInput = {
  targetUserId: string;
  flag: boolean;
  reason?: string | null;
  confirmLastRepresentativeRemoval?: boolean;
};

async function resolveAuthorizedActorId(): Promise<
  { ok: true; userId: string } | { ok: false; result: ShipmentManagementResult & { ok: false } }
> {
  if (getAuthSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false, result: { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." } };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." } };
  }
  return { ok: true, userId: session.userId };
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

export async function setShipmentRepresentativeAction(
  input: SetShipmentRepresentativeActionInput
): Promise<ShipmentManagementResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidUserId(input.targetUserId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "대상 사용자를 확인할 수 없습니다." };
  }
  if (typeof input.flag !== "boolean") {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청 값을 확인할 수 없습니다." };
  }
  const reasonValidation = validateReasonFormat(input.reason);
  if (!reasonValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reasonValidation.error };
  }

  try {
    return await setShipmentRepresentative(
      input.targetUserId,
      input.flag,
      actorCheck.userId,
      reasonValidation.reason,
      input.confirmLastRepresentativeRemoval === true
    );
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("setShipmentRepresentativeAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
