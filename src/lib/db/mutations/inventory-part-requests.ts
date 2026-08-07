import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { parts, partStockBalances, repairCases, inventoryPartRequests, inventoryPartRequestItems, inventoryPartRequestIssues, inventoryPartRequestHistory } from "../schema";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
import { applyStockUseCore, type PrelockedBalanceState } from "./internal/inventory-stock-use";
import { claimOrReplayIdempotency, finalizeIdempotencySuccess } from "./internal/inventory-request-idempotency";
import {
  canCreatePartRequest,
  canCancelOwnRequest,
  canIssuePartRequest,
  canRejectPartRequest,
  canPartiallyCloseRequest,
} from "@/lib/auth/inventory-authorization";
import { computeRequestFingerprint } from "@/lib/domain/inventory-part-request-fingerprint";
import {
  validateRawRequestItems,
  mergeDuplicateRequestItems,
  validateRawIssueAllocations,
  mergeDuplicateAllocations,
  aggregateAllocationsByItem,
  safeAddQuantity,
  normalizeNote,
  validateRequiredReason,
  isIssuableStatus,
  computeStatusAfterIssue,
  type RawRequestItem,
  type RawIssueAllocation,
} from "@/lib/domain/inventory-part-request-rules";
import type { InventoryPartRequestStatus } from "@/lib/domain/inventory-types";

/**
 * Phase 5B-3 — Parts Request & Issue Workflow mutations. Every mutation
 * below is a SINGLE db.transaction spanning: idempotency claim -> request/
 * item/balance locking -> business validation -> writes -> idempotency
 * finalize -> commit. No separately-committed PROCESSING claim, no
 * separate markSucceeded/markFailed step — see internal/
 * inventory-request-idempotency.ts's doc comment for why this matters.
 *
 * Deterministic lock order, identical across every write mutation here, to
 * prevent cross-request deadlocks on multi-balance issues: idempotency key
 * row (via INSERT..ON CONFLICT) -> request header (FOR UPDATE) -> request
 * items (batch, id-sorted, FOR UPDATE) -> stock balances (batch, id-sorted,
 * FOR UPDATE, issue only) -> validation -> writes.
 *
 * All raw quantities are validated BEFORE any merge/aggregation (see
 * inventory-part-request-rules.ts) — an invalid raw line can never be
 * hidden by summing it with a valid one.
 */

export type InventoryPartRequestResultCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CASE_LOCKED"
  | "INVALID_INPUT"
  | "INSUFFICIENT_STOCK"
  | "EXCEEDS_REMAINING_REQUESTED"
  | "NOT_ISSUABLE"
  | "IDEMPOTENCY_PAYLOAD_MISMATCH"
  | "IDEMPOTENCY_UNRESOLVED";

type Failure = { ok: false; code: InventoryPartRequestResultCode; message: string };

class InventoryPartRequestMutationError extends Error {
  result: Failure;
  constructor(result: Failure) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: InventoryPartRequestResultCode, message: string): never {
  throw new InventoryPartRequestMutationError({ ok: false, code, message });
}

async function requireActor(tx: Tx, actorUserId: string) {
  try {
    return await resolveEligibleActor(tx, actorUserId);
  } catch {
    return fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
}

/** Every non-terminal idempotency claim outcome maps to a failure the same way across all five mutations. CLAIMED/REPLAY are handled by each mutation's own caller. */
function failOnNonClaimState(state: "USER_MISMATCH" | "OPERATION_MISMATCH" | "PAYLOAD_MISMATCH" | "UNRESOLVED"): never {
  if (state === "USER_MISMATCH") fail("FORBIDDEN", "요청을 처리할 수 없습니다.");
  if (state === "UNRESOLVED") fail("CONFLICT", "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  fail("IDEMPOTENCY_PAYLOAD_MISMATCH", "이전 제출과 요청 내용이 다릅니다. 새로고침 후 다시 시도해 주세요.");
}

// ---- 부품 요청 생성 (CREATE_REQUEST) ----

export type CreatePartRequestInput = {
  repairCaseId: string;
  items: RawRequestItem[];
  note?: string | null;
  actorUserId: string;
  idempotencyKey: string;
};

export type CreatePartRequestResult = { ok: true; requestId: string } | Failure;

export async function createPartRequest(input: CreatePartRequestInput): Promise<CreatePartRequestResult> {
  const rawCheck = validateRawRequestItems(input.items);
  if (!rawCheck.ok) return { ok: false, code: "INVALID_INPUT", message: rawCheck.message };

  const merged = mergeDuplicateRequestItems(input.items);
  if (!merged.ok) return { ok: false, code: "INVALID_INPUT", message: merged.message };

  const normalizedNote = normalizeNote(input.note);
  const fingerprint = computeRequestFingerprint({
    operationType: "CREATE_REQUEST",
    payload: { repairCaseId: input.repairCaseId, note: normalizedNote, items: merged.items },
  });

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);

      const claim = await claimOrReplayIdempotency<{ requestId: string }>(tx, {
        idempotencyKey: input.idempotencyKey,
        actorUserId: actor.id,
        operationType: "CREATE_REQUEST",
        fingerprint,
      });
      if (claim.state === "REPLAY") return { ok: true, requestId: claim.snapshot.requestId };
      if (claim.state !== "CLAIMED") failOnNonClaimState(claim.state);

      const [rc] = await tx
        .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId })
        .from(repairCases)
        .where(and(eq(repairCases.id, input.repairCaseId), eq(repairCases.isDeleted, false)));
      if (!rc) fail("NOT_FOUND", "해당 수리 건을 찾을 수 없습니다.");

      if (!canCreatePartRequest(actor.role, { isAssignedToCase: rc.assignedEngineerId === actor.id, isCaseLocked: rc.isLocked })) {
        if (rc.isLocked) fail("CASE_LOCKED", "잠금된 접수 건입니다. 새 요청을 생성할 수 없습니다.");
        fail("FORBIDDEN", "부품 요청 권한이 없습니다.");
      }

      const requestedPartIds = [...new Set(merged.items.map((i) => i.partId))];
      const existingParts = await tx
        .select({ id: parts.id })
        .from(parts)
        .where(and(inArray(parts.id, requestedPartIds), eq(parts.isDeleted, false)));
      if (existingParts.length !== requestedPartIds.length) fail("NOT_FOUND", "요청한 부품 중 존재하지 않는 항목이 있습니다.");

      const [request] = await tx
        .insert(inventoryPartRequests)
        .values({ repairCaseId: input.repairCaseId, requestedByUserId: actor.id, status: "PENDING", note: normalizedNote })
        .returning({ id: inventoryPartRequests.id });

      await tx.insert(inventoryPartRequestItems).values(
        merged.items.map((item) => ({ requestId: request.id, partId: item.partId, requestedQuantity: item.quantity, note: item.note }))
      );

      await tx.insert(inventoryPartRequestHistory).values({
        requestId: request.id,
        actionType: "SUBMITTED",
        afterState: { status: "PENDING", items: merged.items },
        actorUserId: actor.id,
      });

      const snapshot = { requestId: request.id };
      await finalizeIdempotencySuccess(tx, input.idempotencyKey, request.id, snapshot);

      return { ok: true, requestId: request.id };
    });
  } catch (err) {
    if (err instanceof InventoryPartRequestMutationError) return err.result;
    throw err;
  }
}

// ---- 부품 인수 요청 취소 (CANCEL — AS_ENGINEER, own PENDING request only) ----

export type CancelPartRequestInput = { requestId: string; reason: string; actorUserId: string; idempotencyKey: string };
export type RequestActionResult = { ok: true; requestId: string; status: InventoryPartRequestStatus } | Failure;

export async function cancelPartRequest(input: CancelPartRequestInput): Promise<RequestActionResult> {
  const reasonCheck = validateRequiredReason(input.reason);
  if (!reasonCheck.ok) return { ok: false, code: "INVALID_INPUT", message: reasonCheck.message };

  const fingerprint = computeRequestFingerprint({ operationType: "CANCEL", payload: { requestId: input.requestId, reason: reasonCheck.reason } });

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);

      const claim = await claimOrReplayIdempotency<{ requestId: string; status: InventoryPartRequestStatus }>(tx, {
        idempotencyKey: input.idempotencyKey,
        actorUserId: actor.id,
        operationType: "CANCEL",
        fingerprint,
      });
      if (claim.state === "REPLAY") return { ok: true, requestId: claim.snapshot.requestId, status: claim.snapshot.status };
      if (claim.state !== "CLAIMED") failOnNonClaimState(claim.state);

      const [request] = await tx.select().from(inventoryPartRequests).where(eq(inventoryPartRequests.id, input.requestId)).for("update");
      if (!request) fail("NOT_FOUND", "해당 요청을 찾을 수 없습니다.");

      if (!canCancelOwnRequest(actor.role, { isOwnRequest: request.requestedByUserId === actor.id, status: request.status })) {
        fail("FORBIDDEN", "요청을 취소할 권한이 없습니다.");
      }

      await tx
        .update(inventoryPartRequests)
        .set({ status: "CANCELLED", version: request.version + 1, updatedAt: new Date() })
        .where(eq(inventoryPartRequests.id, request.id));

      await tx.insert(inventoryPartRequestHistory).values({
        requestId: request.id,
        actionType: "CANCELLED",
        beforeState: { status: request.status },
        afterState: { status: "CANCELLED" },
        reason: reasonCheck.reason,
        actorUserId: actor.id,
      });

      const snapshot = { requestId: request.id, status: "CANCELLED" as const };
      await finalizeIdempotencySuccess(tx, input.idempotencyKey, request.id, snapshot);

      return { ok: true, requestId: request.id, status: "CANCELLED" };
    });
  } catch (err) {
    if (err instanceof InventoryPartRequestMutationError) return err.result;
    throw err;
  }
}

// ---- 요청 거절 (REJECT — privileged roles, PENDING + zero issued only) ----

export type RejectPartRequestInput = { requestId: string; reason: string; actorUserId: string; idempotencyKey: string };

export async function rejectPartRequest(input: RejectPartRequestInput): Promise<RequestActionResult> {
  const reasonCheck = validateRequiredReason(input.reason);
  if (!reasonCheck.ok) return { ok: false, code: "INVALID_INPUT", message: reasonCheck.message };

  const fingerprint = computeRequestFingerprint({ operationType: "REJECT", payload: { requestId: input.requestId, reason: reasonCheck.reason } });

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);

      const claim = await claimOrReplayIdempotency<{ requestId: string; status: InventoryPartRequestStatus }>(tx, {
        idempotencyKey: input.idempotencyKey,
        actorUserId: actor.id,
        operationType: "REJECT",
        fingerprint,
      });
      if (claim.state === "REPLAY") return { ok: true, requestId: claim.snapshot.requestId, status: claim.snapshot.status };
      if (claim.state !== "CLAIMED") failOnNonClaimState(claim.state);

      const [request] = await tx.select().from(inventoryPartRequests).where(eq(inventoryPartRequests.id, input.requestId)).for("update");
      if (!request) fail("NOT_FOUND", "해당 요청을 찾을 수 없습니다.");

      const items = await tx
        .select({ issuedQuantity: inventoryPartRequestItems.issuedQuantity })
        .from(inventoryPartRequestItems)
        .where(eq(inventoryPartRequestItems.requestId, request.id));
      const totalIssued = items.reduce((sum, item) => sum + item.issuedQuantity, 0);

      if (!canRejectPartRequest(actor.role, { status: request.status, issuedQuantityAcrossItems: totalIssued })) {
        fail("FORBIDDEN", "요청을 거절할 권한이 없습니다.");
      }

      await tx
        .update(inventoryPartRequests)
        .set({ status: "REJECTED", version: request.version + 1, updatedAt: new Date() })
        .where(eq(inventoryPartRequests.id, request.id));

      await tx.insert(inventoryPartRequestHistory).values({
        requestId: request.id,
        actionType: "REJECTED",
        beforeState: { status: request.status },
        afterState: { status: "REJECTED" },
        reason: reasonCheck.reason,
        actorUserId: actor.id,
      });

      const snapshot = { requestId: request.id, status: "REJECTED" as const };
      await finalizeIdempotencySuccess(tx, input.idempotencyKey, request.id, snapshot);

      return { ok: true, requestId: request.id, status: "REJECTED" };
    });
  } catch (err) {
    if (err instanceof InventoryPartRequestMutationError) return err.result;
    throw err;
  }
}

// ---- 부분 불출 종료 (PARTIALLY_CLOSE — privileged roles, issued>0 and remaining>0 only) ----

export type PartiallyCloseRequestInput = { requestId: string; reason: string; actorUserId: string; idempotencyKey: string };

export async function partiallyCloseRequest(input: PartiallyCloseRequestInput): Promise<RequestActionResult> {
  const reasonCheck = validateRequiredReason(input.reason);
  if (!reasonCheck.ok) return { ok: false, code: "INVALID_INPUT", message: reasonCheck.message };

  const fingerprint = computeRequestFingerprint({ operationType: "PARTIALLY_CLOSE", payload: { requestId: input.requestId, reason: reasonCheck.reason } });

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);

      const claim = await claimOrReplayIdempotency<{ requestId: string; status: InventoryPartRequestStatus }>(tx, {
        idempotencyKey: input.idempotencyKey,
        actorUserId: actor.id,
        operationType: "PARTIALLY_CLOSE",
        fingerprint,
      });
      if (claim.state === "REPLAY") return { ok: true, requestId: claim.snapshot.requestId, status: claim.snapshot.status };
      if (claim.state !== "CLAIMED") failOnNonClaimState(claim.state);

      const [request] = await tx.select().from(inventoryPartRequests).where(eq(inventoryPartRequests.id, input.requestId)).for("update");
      if (!request) fail("NOT_FOUND", "해당 요청을 찾을 수 없습니다.");

      const items = await tx
        .select({ requestedQuantity: inventoryPartRequestItems.requestedQuantity, issuedQuantity: inventoryPartRequestItems.issuedQuantity })
        .from(inventoryPartRequestItems)
        .where(eq(inventoryPartRequestItems.requestId, request.id));
      const totalIssued = items.reduce((sum, item) => sum + item.issuedQuantity, 0);
      const totalRemaining = items.reduce((sum, item) => sum + Math.max(0, item.requestedQuantity - item.issuedQuantity), 0);

      if (
        !canPartiallyCloseRequest(actor.role, {
          status: request.status,
          issuedQuantityAcrossItems: totalIssued,
          remainingQuantityAcrossItems: totalRemaining,
        })
      ) {
        fail("FORBIDDEN", "요청을 종료할 권한이 없습니다.");
      }

      await tx
        .update(inventoryPartRequests)
        .set({ status: "PARTIALLY_CLOSED", version: request.version + 1, updatedAt: new Date() })
        .where(eq(inventoryPartRequests.id, request.id));

      await tx.insert(inventoryPartRequestHistory).values({
        requestId: request.id,
        actionType: "PARTIALLY_CLOSED",
        beforeState: { status: request.status },
        afterState: { status: "PARTIALLY_CLOSED" },
        reason: reasonCheck.reason,
        actorUserId: actor.id,
      });

      const snapshot = { requestId: request.id, status: "PARTIALLY_CLOSED" as const };
      await finalizeIdempotencySuccess(tx, input.idempotencyKey, request.id, snapshot);

      return { ok: true, requestId: request.id, status: "PARTIALLY_CLOSED" };
    });
  } catch (err) {
    if (err instanceof InventoryPartRequestMutationError) return err.result;
    throw err;
  }
}

// ---- 불출 확정 (ISSUE — privileged roles only; the only action that ever creates a USE transaction) ----

export type IssuePartRequestInput = {
  requestId: string;
  allocations: RawIssueAllocation[];
  note?: string | null;
  actorUserId: string;
  idempotencyKey: string;
};

export type IssuePartRequestResult =
  | { ok: true; requestId: string; requestIssueId: string; status: InventoryPartRequestStatus }
  | Failure;

export async function issuePartRequest(input: IssuePartRequestInput): Promise<IssuePartRequestResult> {
  const rawCheck = validateRawIssueAllocations(input.allocations);
  if (!rawCheck.ok) return { ok: false, code: "INVALID_INPUT", message: rawCheck.message };

  const merged = mergeDuplicateAllocations(input.allocations);
  if (!merged.ok) return { ok: false, code: "INVALID_INPUT", message: merged.message };

  const aggregated = aggregateAllocationsByItem(merged.allocations);
  if (!aggregated.ok) return { ok: false, code: "INVALID_INPUT", message: aggregated.message };

  const normalizedNote = normalizeNote(input.note);
  const fingerprint = computeRequestFingerprint({
    operationType: "ISSUE",
    payload: { requestId: input.requestId, allocations: merged.allocations, note: normalizedNote },
  });

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);

      const claim = await claimOrReplayIdempotency<{ requestId: string; requestIssueId: string; status: InventoryPartRequestStatus }>(tx, {
        idempotencyKey: input.idempotencyKey,
        actorUserId: actor.id,
        operationType: "ISSUE",
        fingerprint,
      });
      if (claim.state === "REPLAY") {
        return { ok: true, requestId: claim.snapshot.requestId, requestIssueId: claim.snapshot.requestIssueId, status: claim.snapshot.status };
      }
      if (claim.state !== "CLAIMED") failOnNonClaimState(claim.state);

      // Lock order: request header first.
      const [request] = await tx.select().from(inventoryPartRequests).where(eq(inventoryPartRequests.id, input.requestId)).for("update");
      if (!request) fail("NOT_FOUND", "해당 요청을 찾을 수 없습니다.");

      const [rc] = await tx.select({ isLocked: repairCases.isLocked }).from(repairCases).where(eq(repairCases.id, request.repairCaseId));
      const isCaseLocked = rc?.isLocked ?? false;

      if (!canIssuePartRequest(actor.role, { isCaseLocked, status: request.status })) {
        if (isCaseLocked) fail("CASE_LOCKED", "잠금된 접수 건입니다. 불출을 진행할 수 없습니다.");
        if (!isIssuableStatus(request.status)) fail("NOT_ISSUABLE", "처리할 수 없는 요청 상태입니다.");
        fail("FORBIDDEN", "불출 권한이 없습니다.");
      }

      // Batch-lock every touched request item, in one id-sorted query.
      const itemIds = [...new Set(aggregated.aggregates.map((a) => a.requestItemId))].sort();
      const lockedItems = await tx
        .select()
        .from(inventoryPartRequestItems)
        .where(inArray(inventoryPartRequestItems.id, itemIds))
        .orderBy(inventoryPartRequestItems.id)
        .for("update");
      if (lockedItems.length !== itemIds.length) fail("NOT_FOUND", "요청 항목을 찾을 수 없습니다.");
      for (const item of lockedItems) {
        if (item.requestId !== request.id) fail("INVALID_INPUT", "요청 항목이 해당 요청에 속하지 않습니다.");
      }
      const itemById = new Map(lockedItems.map((item) => [item.id, item]));

      // Batch-lock every distinct balance touched, in one id-sorted query —
      // this, combined with the identical ordering used by every other
      // write path in this module, is what prevents two different requests
      // that both touch the same two balances (in opposite client-supplied
      // order) from deadlocking each other.
      const balanceIds = [...new Set(merged.allocations.map((a) => a.partStockBalanceId))].sort();
      const lockedBalances = await tx
        .select()
        .from(partStockBalances)
        .where(inArray(partStockBalances.id, balanceIds))
        .orderBy(partStockBalances.id)
        .for("update");
      if (lockedBalances.length !== balanceIds.length) fail("NOT_FOUND", "재고 정보를 찾을 수 없습니다.");
      const balanceStateById = new Map<string, PrelockedBalanceState & { partId: string }>(
        lockedBalances.map((b) => [b.id, { id: b.id, currentQuantity: b.currentQuantity, version: b.version, partId: b.partId }])
      );

      // Part-match: the request item's part must equal the selected balance's part.
      for (const allocation of merged.allocations) {
        const item = itemById.get(allocation.requestItemId)!;
        const balance = balanceStateById.get(allocation.partStockBalanceId)!;
        if (item.partId !== balance.partId) fail("INVALID_INPUT", "선택한 재고의 부품이 요청 항목과 일치하지 않습니다.");
      }

      // Aggregate validation per item — the roundIssueQuantity (already
      // summed across every bucket touched for that item this round) is
      // what gets compared to the remaining requested amount, never any
      // individual allocation in isolation.
      for (const aggregate of aggregated.aggregates) {
        const item = itemById.get(aggregate.requestItemId)!;
        const sum = safeAddQuantity(item.issuedQuantity, aggregate.roundIssueQuantity);
        if (!sum.ok) fail("INVALID_INPUT", sum.message);
        if (sum.value > item.requestedQuantity) {
          const remaining = Math.max(0, item.requestedQuantity - item.issuedQuantity);
          fail("EXCEEDS_REMAINING_REQUESTED", `요청 항목의 남은 수량(${remaining}개)을 초과하여 불출할 수 없습니다.`);
        }
      }

      // Only now — after every lock is held and every validation has
      // passed — do any writes happen. One issue event groups everything
      // this confirmation produces.
      const [issueEvent] = await tx
        .insert(inventoryPartRequestIssues)
        .values({ requestId: request.id, issuedByUserId: actor.id, note: normalizedNote })
        .returning({ id: inventoryPartRequestIssues.id });

      for (const allocation of merged.allocations) {
        const balanceState = balanceStateById.get(allocation.partStockBalanceId)!;
        const result = await applyStockUseCore(
          tx,
          {
            partStockBalanceId: allocation.partStockBalanceId,
            quantity: allocation.quantity,
            actorUserId: actor.id,
            repairCaseId: request.repairCaseId,
            requestItemId: allocation.requestItemId,
            requestIssueId: issueEvent.id,
          },
          { prelocked: balanceState }
        );
        if (!result.ok) {
          // Already pre-locked and pre-validated against the balance state
          // read in this same transaction — INSUFFICIENT_STOCK is still
          // possible if two allocations in this same event target the same
          // balance for more than it holds.
          fail("INSUFFICIENT_STOCK", "재고가 부족합니다.");
        }
        // Track the running balance state in-process so a second
        // allocation against the same balance later in this same loop
        // validates against the up-to-date quantity, not the originally
        // locked snapshot.
        balanceStateById.set(allocation.partStockBalanceId, { ...balanceState, currentQuantity: result.resultingQuantity, version: result.version });
      }

      for (const aggregate of aggregated.aggregates) {
        const item = itemById.get(aggregate.requestItemId)!;
        await tx
          .update(inventoryPartRequestItems)
          .set({ issuedQuantity: item.issuedQuantity + aggregate.roundIssueQuantity, updatedAt: new Date() })
          .where(eq(inventoryPartRequestItems.id, item.id));
      }

      // Recompute overall status from every item on the request (not just
      // the ones touched this round) — read fresh, post-update.
      const allItems = await tx
        .select({ requestedQuantity: inventoryPartRequestItems.requestedQuantity, issuedQuantity: inventoryPartRequestItems.issuedQuantity })
        .from(inventoryPartRequestItems)
        .where(eq(inventoryPartRequestItems.requestId, request.id));
      const allFullyIssued = allItems.every((item) => item.issuedQuantity >= item.requestedQuantity);
      const newStatus = computeStatusAfterIssue(allFullyIssued);

      await tx
        .update(inventoryPartRequests)
        .set({ status: newStatus, version: request.version + 1, updatedAt: new Date() })
        .where(eq(inventoryPartRequests.id, request.id));

      await tx.insert(inventoryPartRequestHistory).values({
        requestId: request.id,
        requestIssueId: issueEvent.id,
        actionType: "ISSUED",
        beforeState: { status: request.status },
        afterState: { status: newStatus, allocations: merged.allocations },
        actorUserId: actor.id,
      });

      const snapshot = { requestId: request.id, requestIssueId: issueEvent.id, status: newStatus };
      await finalizeIdempotencySuccess(tx, input.idempotencyKey, request.id, snapshot);

      return { ok: true, requestId: request.id, requestIssueId: issueEvent.id, status: newStatus };
    });
  } catch (err) {
    if (err instanceof InventoryPartRequestMutationError) return err.result;
    throw err;
  }
}
