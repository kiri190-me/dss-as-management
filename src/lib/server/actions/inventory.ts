"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  createPart,
  updatePart,
  receiveStock,
  consumeStock,
  returnStock,
  type CreatePartResult,
  type UpdatePartResult,
  type StockTransactionMutationResult,
} from "@/lib/db/mutations/inventory";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";
import type { StockOwner } from "@/lib/domain/inventory-types";

/**
 * Server Actions for Phase 5B-2 core inventory. Same layering as
 * procedure-case-execution.ts's actions: resolve the session, validate
 * input shape, delegate, redact unexpected DB errors. Role/assignment
 * authorization varies per action (general matrix vs. the detailed USE
 * rule) and is entirely re-checked inside the mutation layer — this file
 * only confirms a valid, approved session exists.
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

export async function createPartAction(input: {
  partName: string;
  partSpec?: string | null;
  kyosanPartNo?: string | null;
  drawingNo?: string | null;
  category?: string | null;
  itemType?: string | null;
  notes?: string | null;
}): Promise<CreatePartResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (typeof input.partName !== "string" || input.partName.trim().length === 0) {
    return { ok: false, code: "FORBIDDEN", message: "품명을 입력해 주세요." };
  }

  return withErrorRedaction("createPartAction", () => createPart({ ...input, actorUserId: actorCheck.userId }));
}

export async function updatePartAction(input: {
  partId: string;
  expectedVersion: number;
  patch: {
    partName?: string;
    partSpec?: string | null;
    kyosanPartNo?: string | null;
    drawingNo?: string | null;
    category?: string | null;
    itemType?: string | null;
    notes?: string | null;
    /** 부품 한 개당 작업비(원). null 은 "정하지 않음"이고 0 과 다르다(schema/inventory.ts). */
    laborCost?: string | null;
  };
}): Promise<UpdatePartResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.partId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  return withErrorRedaction("updatePartAction", () =>
    updatePart({ partId: input.partId, expectedVersion: input.expectedVersion, patch: input.patch, actorUserId: actorCheck.userId })
  );
}

export async function receiveStockAction(input: {
  partId: string;
  owner: StockOwner;
  location: string;
  quantity: number;
  reason?: string | null;
}): Promise<StockTransactionMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.partId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  return withErrorRedaction("receiveStockAction", () =>
    receiveStock({
      partId: input.partId,
      owner: input.owner,
      location: input.location,
      quantity: input.quantity,
      reason: input.reason?.trim() || null,
      actorUserId: actorCheck.userId,
    })
  );
}

export async function consumeStockAction(input: {
  partStockBalanceId: string;
  quantity: number;
  expectedVersion: number;
  repairCaseId?: string | null;
  destinationNote?: string | null;
  procedureExecutionNodeId?: string | null;
  reason?: string | null;
}): Promise<StockTransactionMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.partStockBalanceId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (input.repairCaseId != null && !isValidUuid(input.repairCaseId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }
  if (input.procedureExecutionNodeId != null && !isValidUuid(input.procedureExecutionNodeId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }

  return withErrorRedaction("consumeStockAction", () =>
    consumeStock({
      partStockBalanceId: input.partStockBalanceId,
      quantity: input.quantity,
      expectedVersion: input.expectedVersion,
      repairCaseId: input.repairCaseId ?? null,
      destinationNote: input.destinationNote?.trim() || null,
      procedureExecutionNodeId: input.procedureExecutionNodeId ?? null,
      reason: input.reason?.trim() || null,
      actorUserId: actorCheck.userId,
    })
  );
}

export async function returnStockAction(input: {
  reversalOfId: string;
  quantity: number;
  expectedVersion: number;
  reason?: string | null;
}): Promise<StockTransactionMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.reversalOfId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  return withErrorRedaction("returnStockAction", () =>
    returnStock({
      reversalOfId: input.reversalOfId,
      quantity: input.quantity,
      expectedVersion: input.expectedVersion,
      reason: input.reason?.trim() || null,
      actorUserId: actorCheck.userId,
    })
  );
}
