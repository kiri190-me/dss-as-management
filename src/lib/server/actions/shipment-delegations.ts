"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { createShipmentDelegation, revokeShipmentDelegation } from "@/lib/db/mutations/shipment-delegations";
import {
  isValidUserId,
  validateDelegationDateRange,
  validateReasonFormat,
  type ShipmentManagementResult,
} from "@/lib/validation/shipment-delegation-input";

/**
 * Server Actions for shipment_approval_delegations create/revoke — same
 * layering as shipment-representatives.ts's action.
 */

export type CreateShipmentDelegationActionInput = {
  representativeUserId: string;
  delegateUserId: string;
  startsAt: string;
  endsAt: string;
  reason?: string | null;
};

export type RevokeShipmentDelegationActionInput = {
  delegationId: string;
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

export async function createShipmentDelegationAction(
  input: CreateShipmentDelegationActionInput
): Promise<ShipmentManagementResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidUserId(input.representativeUserId) || !isValidUserId(input.delegateUserId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "대표 또는 대리 승인자를 확인할 수 없습니다." };
  }
  const rangeValidation = validateDelegationDateRange(input.startsAt, input.endsAt);
  if (!rangeValidation.ok) {
    return { ok: false, code: "INVALID_TIME_RANGE", message: rangeValidation.error };
  }
  const reasonValidation = validateReasonFormat(input.reason);
  if (!reasonValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reasonValidation.error };
  }

  try {
    return await createShipmentDelegation(
      input.representativeUserId,
      input.delegateUserId,
      rangeValidation.startsAt,
      rangeValidation.endsAt,
      actorCheck.userId,
      reasonValidation.reason
    );
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("createShipmentDelegationAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function revokeShipmentDelegationAction(
  input: RevokeShipmentDelegationActionInput
): Promise<ShipmentManagementResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidUserId(input.delegationId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "위임 정보를 확인할 수 없습니다." };
  }

  try {
    return await revokeShipmentDelegation(input.delegationId, actorCheck.userId);
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("revokeShipmentDelegationAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
