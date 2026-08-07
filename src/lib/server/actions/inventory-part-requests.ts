"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  createPartRequest,
  cancelPartRequest,
  rejectPartRequest,
  partiallyCloseRequest,
  issuePartRequest,
  type CreatePartRequestResult,
  type RequestActionResult,
  type IssuePartRequestResult,
} from "@/lib/db/mutations/inventory-part-requests";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";

/**
 * Server Actions for Phase 5B-3's Parts Request & Issue Workflow. Same
 * layering as inventory.ts's actions: resolve the session, validate input
 * shape, delegate, redact unexpected DB errors. Role/status/lock
 * authorization is entirely re-checked inside the mutation layer — this
 * file only confirms a valid, approved session exists and that the
 * client-generated idempotencyKey is at least a well-formed UUID (never
 * derived from business fields, same discipline as the repair-case intake
 * idempotency key).
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

async function withErrorRedaction<T extends { ok: boolean }>(label: string, run: () => Promise<T>): Promise<T | Forbidden> {
  try {
    return await run();
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error(`${label}: unexpected DB error`, { code });
    return { ok: false, code: "FORBIDDEN", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

const IDEMPOTENCY_KEY_FIELD_ERROR: Forbidden = { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

export async function createPartRequestAction(input: {
  repairCaseId: string;
  items: { partId: string; quantity: number; note?: string | null }[];
  note?: string | null;
  idempotencyKey: string;
}): Promise<CreatePartRequestResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.repairCaseId) || !isValidUuid(input.idempotencyKey)) return IDEMPOTENCY_KEY_FIELD_ERROR;
  for (const item of input.items) {
    if (!isValidUuid(item.partId)) return IDEMPOTENCY_KEY_FIELD_ERROR;
  }

  return withErrorRedaction("createPartRequestAction", () =>
    createPartRequest({
      repairCaseId: input.repairCaseId,
      items: input.items,
      note: input.note ?? null,
      actorUserId: actorCheck.userId,
      idempotencyKey: input.idempotencyKey,
    })
  );
}

export async function cancelPartRequestAction(input: { requestId: string; reason: string; idempotencyKey: string }): Promise<RequestActionResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.requestId) || !isValidUuid(input.idempotencyKey)) return IDEMPOTENCY_KEY_FIELD_ERROR;

  return withErrorRedaction("cancelPartRequestAction", () =>
    cancelPartRequest({ requestId: input.requestId, reason: input.reason, actorUserId: actorCheck.userId, idempotencyKey: input.idempotencyKey })
  );
}

export async function rejectPartRequestAction(input: { requestId: string; reason: string; idempotencyKey: string }): Promise<RequestActionResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.requestId) || !isValidUuid(input.idempotencyKey)) return IDEMPOTENCY_KEY_FIELD_ERROR;

  return withErrorRedaction("rejectPartRequestAction", () =>
    rejectPartRequest({ requestId: input.requestId, reason: input.reason, actorUserId: actorCheck.userId, idempotencyKey: input.idempotencyKey })
  );
}

export async function partiallyCloseRequestAction(input: { requestId: string; reason: string; idempotencyKey: string }): Promise<RequestActionResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.requestId) || !isValidUuid(input.idempotencyKey)) return IDEMPOTENCY_KEY_FIELD_ERROR;

  return withErrorRedaction("partiallyCloseRequestAction", () =>
    partiallyCloseRequest({ requestId: input.requestId, reason: input.reason, actorUserId: actorCheck.userId, idempotencyKey: input.idempotencyKey })
  );
}

export async function issuePartRequestAction(input: {
  requestId: string;
  allocations: { requestItemId: string; partStockBalanceId: string; quantity: number }[];
  note?: string | null;
  idempotencyKey: string;
}): Promise<IssuePartRequestResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.requestId) || !isValidUuid(input.idempotencyKey)) return IDEMPOTENCY_KEY_FIELD_ERROR;
  for (const allocation of input.allocations) {
    if (!isValidUuid(allocation.requestItemId) || !isValidUuid(allocation.partStockBalanceId)) return IDEMPOTENCY_KEY_FIELD_ERROR;
  }

  return withErrorRedaction("issuePartRequestAction", () =>
    issuePartRequest({
      requestId: input.requestId,
      allocations: input.allocations,
      note: input.note ?? null,
      actorUserId: actorCheck.userId,
      idempotencyKey: input.idempotencyKey,
    })
  );
}
