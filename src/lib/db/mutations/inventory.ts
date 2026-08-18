import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { parts, partStockBalances, stockTransactions, repairCases, procedureCaseExecutionNodes, procedureCaseExecutions } from "../schema";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
import { applyStockUseCore } from "./internal/inventory-stock-use";
import {
  canCreateOrEditPart,
  canReceiveStock,
  canReturnStock,
  canUseStock,
  type UseStockAuthorizationContext,
} from "@/lib/auth/inventory-authorization";
import { computeAlreadyReversedQuantity, canReturnQuantity } from "@/lib/domain/inventory-return-rules";
import type { StockOwner } from "@/lib/domain/inventory-types";

/**
 * Phase 5B-2 — core inventory ledger mutations. Same conventions as
 * procedure-case-execution.ts:
 *  - re-checks the actor from the live DB (resolveEligibleActor, shared);
 *  - every write re-verifies its preconditions inside its own transaction,
 *    never trusting that the UI already checked them;
 *  - locks the row being mutated with `.for("update")`, then compares the
 *    caller's expected `version` against the freshly-locked row instead of
 *    a WHERE-clause race (the lock itself serializes concurrent writers
 *    within the transaction window);
 *  - writes exactly one append-only stock_transactions row per mutation,
 *    in the same transaction as the balance update;
 *  - no negative stock, ever, for any role — INSUFFICIENT_STOCK has no
 *    override path anywhere in this file;
 *  - repair-case lock (is_locked) blocks a repair-case-linked USE
 *    unconditionally for every role, including SUPER_ADMIN/ADMIN.
 */

export type InventoryMutationResultCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INSUFFICIENT_STOCK"
  | "CASE_LOCKED"
  | "INVALID_INPUT"
  | "INVALID_RETURN_TARGET"
  | "OVER_RETURN"
  | "BILLING_DECISION_REQUIRED";

type Failure = { ok: false; code: InventoryMutationResultCode; message: string };

class InventoryMutationError extends Error {
  result: Failure;
  constructor(result: Failure) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: InventoryMutationResultCode, message: string): never {
  throw new InventoryMutationError({ ok: false, code, message });
}

function hasPgCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === code;
}

/** drizzle-orm wraps the driver's PostgresError (the original is on `.cause`) — check both, same convention as repair-cases.ts's isUniqueViolation. */
function isUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
}

async function requireActor(tx: Tx, actorUserId: string) {
  try {
    return await resolveEligibleActor(tx, actorUserId);
  } catch {
    return fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
}

function requirePositiveIntegerQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    fail("INVALID_INPUT", "수량은 1 이상의 정수여야 합니다.");
  }
}

// ---- 부품 마스터 (part master) ----

export type CreatePartInput = {
  partName: string;
  partSpec?: string | null;
  kyosanPartNo?: string | null;
  drawingNo?: string | null;
  category?: string | null;
  itemType?: string | null;
  notes?: string | null;
  actorUserId: string;
};

export type CreatePartResult = { ok: true; partId: string } | Failure;

export async function createPart(input: CreatePartInput): Promise<CreatePartResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);
      if (!canCreateOrEditPart(actor.role)) fail("FORBIDDEN", "부품 등록 권한이 없습니다.");

      const trimmedName = input.partName.trim();
      if (trimmedName.length === 0) fail("INVALID_INPUT", "품명을 입력해 주세요.");

      const [row] = await tx
        .insert(parts)
        .values({
          partName: trimmedName,
          partSpec: input.partSpec ?? null,
          kyosanPartNo: input.kyosanPartNo ?? null,
          drawingNo: input.drawingNo ?? null,
          category: input.category ?? null,
          itemType: input.itemType ?? null,
          notes: input.notes ?? null,
        })
        .returning({ id: parts.id });

      return { ok: true, partId: row.id };
    });
  } catch (err) {
    if (err instanceof InventoryMutationError) return err.result;
    throw err;
  }
}

export type UpdatePartInput = {
  partId: string;
  actorUserId: string;
  expectedVersion: number;
  patch: {
    partName?: string;
    partSpec?: string | null;
    kyosanPartNo?: string | null;
    drawingNo?: string | null;
    category?: string | null;
    itemType?: string | null;
    notes?: string | null;
  };
};

export type UpdatePartResult = { ok: true; version: number } | Failure;

export async function updatePart(input: UpdatePartInput): Promise<UpdatePartResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);
      if (!canCreateOrEditPart(actor.role)) fail("FORBIDDEN", "부품 수정 권한이 없습니다.");

      const [part] = await tx
        .select()
        .from(parts)
        .where(and(eq(parts.id, input.partId), eq(parts.isDeleted, false)))
        .for("update");
      if (!part) fail("NOT_FOUND", "해당 부품을 찾을 수 없습니다.");
      if (part.version !== input.expectedVersion) {
        fail("CONFLICT", "다른 사용자가 이 부품을 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
      }

      if (input.patch.partName !== undefined && input.patch.partName.trim().length === 0) {
        fail("INVALID_INPUT", "품명을 입력해 주세요.");
      }

      await tx
        .update(parts)
        .set({
          ...input.patch,
          partName: input.patch.partName !== undefined ? input.patch.partName.trim() : undefined,
          version: part.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(parts.id, input.partId));

      return { ok: true, version: part.version + 1 };
    });
  } catch (err) {
    if (err instanceof InventoryMutationError) return err.result;
    throw err;
  }
}

// ---- 입고 (RECEIPT) ----

export type ReceiveStockInput = {
  partId: string;
  owner: StockOwner;
  location: string;
  quantity: number;
  actorUserId: string;
  reason?: string | null;
};

export type StockTransactionMutationResult =
  | { ok: true; version: number; resultingQuantity: number; partStockBalanceId: string }
  | Failure;

export async function receiveStock(input: ReceiveStockInput): Promise<StockTransactionMutationResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);
      if (!canReceiveStock(actor.role)) fail("FORBIDDEN", "입고 권한이 없습니다.");

      requirePositiveIntegerQuantity(input.quantity);
      const trimmedLocation = input.location.trim();
      if (trimmedLocation.length === 0) fail("INVALID_INPUT", "위치를 입력해 주세요.");

      const [part] = await tx.select({ id: parts.id }).from(parts).where(and(eq(parts.id, input.partId), eq(parts.isDeleted, false)));
      if (!part) fail("NOT_FOUND", "해당 부품을 찾을 수 없습니다.");

      const matchCondition = and(
        eq(partStockBalances.partId, input.partId),
        eq(partStockBalances.owner, input.owner),
        eq(partStockBalances.location, trimmedLocation)
      );

      const [existing] = await tx.select({ id: partStockBalances.id }).from(partStockBalances).where(matchCondition);
      let balanceId = existing?.id;

      if (!balanceId) {
        // Find-or-create the (part, owner, location) bucket. The insert
        // runs inside a nested transaction (SAVEPOINT) — Postgres aborts
        // the entire enclosing transaction on any statement error, so a
        // plain try/catch around the insert alone would leave `tx`
        // unusable for the re-select below. Same pattern
        // repair-cases.ts's resolveProduct already uses (and needs) for
        // its own concurrent lookup-or-create race.
        try {
          const created = await tx.transaction(async (tx2) => {
            const [row] = await tx2
              .insert(partStockBalances)
              .values({ partId: input.partId, owner: input.owner, location: trimmedLocation })
              .returning({ id: partStockBalances.id });
            return row;
          });
          balanceId = created.id;
        } catch (err) {
          if (isUniqueViolation(err)) {
            const [reSelected] = await tx.select({ id: partStockBalances.id }).from(partStockBalances).where(matchCondition);
            if (!reSelected) throw err;
            balanceId = reSelected.id;
          } else {
            throw err;
          }
        }
      }

      const [balance] = await tx.select().from(partStockBalances).where(eq(partStockBalances.id, balanceId)).for("update");
      if (!balance) fail("NOT_FOUND", "해당 재고를 찾을 수 없습니다.");

      const resultingQuantity = balance.currentQuantity + input.quantity;

      await tx.insert(stockTransactions).values({
        partStockBalanceId: balance.id,
        transactionType: "RECEIPT",
        quantityDelta: input.quantity,
        resultingQuantity,
        actorUserId: actor.id,
        reason: input.reason ?? null,
      });

      await tx
        .update(partStockBalances)
        .set({ currentQuantity: resultingQuantity, version: balance.version + 1, updatedAt: new Date() })
        .where(eq(partStockBalances.id, balance.id));

      return { ok: true, version: balance.version + 1, resultingQuantity, partStockBalanceId: balance.id };
    });
  } catch (err) {
    if (err instanceof InventoryMutationError) return err.result;
    throw err;
  }
}

// ---- 사용 (USE) ----

export type ConsumeStockInput = {
  partStockBalanceId: string;
  quantity: number;
  repairCaseId?: string | null;
  destinationNote?: string | null;
  procedureExecutionNodeId?: string | null;
  actorUserId: string;
  expectedVersion: number;
  reason?: string | null;
};

export async function consumeStock(input: ConsumeStockInput): Promise<StockTransactionMutationResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);

      requirePositiveIntegerQuantity(input.quantity);
      if (!input.repairCaseId && !input.destinationNote) {
        fail("INVALID_INPUT", "수리 건 또는 사용처를 입력해 주세요.");
      }

      let repairCase: { id: string; isLocked: boolean; billingType: string | null } | null = null;
      if (input.repairCaseId) {
        const [rc] = await tx
          .select({ id: repairCases.id, isLocked: repairCases.isLocked, billingType: repairCases.billingType })
          .from(repairCases)
          .where(and(eq(repairCases.id, input.repairCaseId), eq(repairCases.isDeleted, false)));
        if (!rc) fail("NOT_FOUND", "해당 수리 건을 찾을 수 없습니다.");
        if (rc.billingType === "PENDING_DECISION") {
          fail("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 재고를 사용할 수 있습니다.");
        }
        repairCase = rc;
      }

      // procedureExecutionNodeId is kept as a general reverse-traceability
      // input for any role that supplies it (Phase 5B-3: no longer tied to
      // AS_ENGINEER authorization specifically, since AS_ENGINEER can never
      // reach this mutation at all now — see canUseStock) — still
      // re-validated live: it must belong to an execution whose repair case
      // is exactly the one submitted, never trusted at face value.
      if (input.procedureExecutionNodeId) {
        if (!input.repairCaseId) {
          fail("INVALID_INPUT", "절차 작업을 지정하려면 수리 건도 함께 지정해야 합니다.");
        }
        const [node] = await tx
          .select({ executionId: procedureCaseExecutionNodes.executionId })
          .from(procedureCaseExecutionNodes)
          .where(eq(procedureCaseExecutionNodes.id, input.procedureExecutionNodeId));
        if (!node) fail("INVALID_INPUT", "해당 절차 작업을 찾을 수 없습니다.");

        const [execution] = await tx
          .select({ repairCaseId: procedureCaseExecutions.repairCaseId })
          .from(procedureCaseExecutions)
          .where(eq(procedureCaseExecutions.id, node.executionId));
        // execution.repairCaseId is nullable (repair-case permanent-delete
        // schema foundation checkpoint) — input.repairCaseId is guaranteed
        // a real string by the guard above, so an orphaned (purged-case)
        // execution's null already correctly fails this `!==` comparison
        // (null can never equal a real uuid) and falls into the same
        // cross-case-mismatch rejection as any other unrelated execution —
        // no special-casing needed.
        if (!execution || execution.repairCaseId !== input.repairCaseId) {
          fail("INVALID_INPUT", "지정한 절차 작업이 해당 수리 건에 속하지 않습니다.");
        }
      }

      // Shipment-lock removal policy: USE is no longer blocked by
      // repair_cases.is_locked (see canUseStock's own doc comment) — this
      // explicit pre-check was the sole enforcement point and has been
      // removed accordingly, rather than left as a dead branch that could
      // still misfire a stale CASE_LOCKED message for an otherwise-
      // unauthorized caller.
      const authContext: UseStockAuthorizationContext = {
        hasRepairCase: input.repairCaseId != null,
        isCaseLocked: repairCase?.isLocked ?? false,
      };
      if (!canUseStock(actor.role, authContext)) {
        fail("FORBIDDEN", "재고를 사용할 권한이 없습니다.");
      }

      const result = await applyStockUseCore(
        tx,
        {
          partStockBalanceId: input.partStockBalanceId,
          quantity: input.quantity,
          actorUserId: actor.id,
          repairCaseId: input.repairCaseId ?? null,
          destinationNote: input.destinationNote ?? null,
          procedureExecutionNodeId: input.procedureExecutionNodeId ?? null,
          reason: input.reason ?? null,
        },
        { expectedVersion: input.expectedVersion }
      );

      if (!result.ok) {
        if (result.code === "NOT_FOUND") fail("NOT_FOUND", "해당 재고를 찾을 수 없습니다.");
        if (result.code === "CONFLICT") fail("CONFLICT", "다른 사용자가 이 재고를 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
        fail("INSUFFICIENT_STOCK", "재고가 부족합니다.");
      }

      return { ok: true, version: result.version, resultingQuantity: result.resultingQuantity, partStockBalanceId: input.partStockBalanceId };
    });
  } catch (err) {
    if (err instanceof InventoryMutationError) return err.result;
    throw err;
  }
}

// ---- 반환 (RETURN — always reverses a specific prior USE) ----

export type ReturnStockInput = {
  reversalOfId: string;
  quantity: number;
  actorUserId: string;
  expectedVersion: number;
  reason?: string | null;
};

export async function returnStock(input: ReturnStockInput): Promise<StockTransactionMutationResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);
      if (!canReturnStock(actor.role)) fail("FORBIDDEN", "반환 권한이 없습니다.");

      requirePositiveIntegerQuantity(input.quantity);

      const [originalUse] = await tx.select().from(stockTransactions).where(eq(stockTransactions.id, input.reversalOfId));
      if (!originalUse) fail("NOT_FOUND", "원본 사용 이력을 찾을 수 없습니다.");
      if (originalUse.transactionType !== "USE") {
        fail("INVALID_RETURN_TARGET", "사용(USE) 이력만 반환의 대상이 될 수 있습니다.");
      }

      const [balance] = await tx
        .select()
        .from(partStockBalances)
        .where(eq(partStockBalances.id, originalUse.partStockBalanceId))
        .for("update");
      if (!balance) fail("NOT_FOUND", "해당 재고를 찾을 수 없습니다.");
      if (balance.version !== input.expectedVersion) {
        fail("CONFLICT", "다른 사용자가 이 재고를 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
      }

      // "Already reversed" is recomputed fresh from the ledger every time
      // — never cached — so it stays correct under concurrent RETURN
      // attempts against the same USE (protected by the balance-row lock
      // above).
      const priorReturns = await tx
        .select({ quantity: stockTransactions.quantityDelta })
        .from(stockTransactions)
        .where(and(eq(stockTransactions.reversalOfId, input.reversalOfId), eq(stockTransactions.transactionType, "RETURN")));

      const originalUseQuantity = Math.abs(originalUse.quantityDelta);
      if (!canReturnQuantity(originalUseQuantity, priorReturns, input.quantity)) {
        const remaining = Math.max(0, originalUseQuantity - computeAlreadyReversedQuantity(priorReturns));
        fail("OVER_RETURN", `반환 가능한 최대 수량은 ${remaining}개입니다.`);
      }

      const resultingQuantity = balance.currentQuantity + input.quantity;

      await tx.insert(stockTransactions).values({
        partStockBalanceId: balance.id,
        transactionType: "RETURN",
        quantityDelta: input.quantity,
        resultingQuantity,
        reversalOfId: input.reversalOfId,
        actorUserId: actor.id,
        reason: input.reason ?? null,
      });

      await tx
        .update(partStockBalances)
        .set({ currentQuantity: resultingQuantity, version: balance.version + 1, updatedAt: new Date() })
        .where(eq(partStockBalances.id, balance.id));

      return { ok: true, version: balance.version + 1, resultingQuantity, partStockBalanceId: balance.id };
    });
  } catch (err) {
    if (err instanceof InventoryMutationError) return err.result;
    throw err;
  }
}
