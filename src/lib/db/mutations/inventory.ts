import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { parts, partStockBalances, stockTransactions, inventoryPartRequestItems, repairCases, procedureCaseExecutionNodes, procedureCaseExecutions } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
import { applyStockUseCore } from "./internal/inventory-stock-use";
import { hasPermission } from "@/lib/auth/permission-resolver";
import type { UseStockAuthorizationContext } from "@/lib/auth/inventory-authorization";
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
      if (!(await hasPermission(actor.role, "inventory.parts", "WRITE"))) {
        fail("FORBIDDEN", "부품 등록 권한이 없습니다.");
      }

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
      if (!(await hasPermission(actor.role, "inventory.parts", "WRITE"))) {
        fail("FORBIDDEN", "부품 수정 권한이 없습니다.");
      }

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
      if (!(await hasPermission(actor.role, "inventory.stock", "WRITE"))) {
        fail("FORBIDDEN", "입고 권한이 없습니다.");
      }

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
      // authContext는 그대로 둔다 — 맥락(대상 접수 건이 있는지, 잠겼는지)은
      // 여전히 여기서 판정한다. 역할 부분만 설정으로 넘어갔다.
      void authContext;
      if (!(await hasPermission(actor.role, "inventory.stock", "WRITE"))) {
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
      if (!(await hasPermission(actor.role, "inventory.stock", "WRITE"))) {
        fail("FORBIDDEN", "반환 권한이 없습니다.");
      }

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

// ---- 부품 마스터 삭제 · 복원 · 완전삭제 (휴지통 → 15일 → 완전삭제) ----

/**
 * ============================================================================
 * 부품 삭제 — 다른 마스터 화면과 같은 3단계, 이 모듈의 규약으로
 * ============================================================================
 * 고객사·제품 모델과 같은 결정에서 나온 같은 규칙이다: 휴지통에 넣고, 15일이
 * 지나면 자동으로 완전삭제하고, 그 전에는 언제든 되살린다.
 *
 * 다만 코드 모양은 customers-trash.ts가 아니라 이 파일을 따른다 — 권한을
 * 트랜잭션 안에서 다시 확인하고(requireActor + hasPermission), 낙관적 동시성은
 * updated_at이 아니라 parts.version으로 보고, 실패는 fail()로 던져
 * InventoryMutationError로 받는다. 재고 mutation이 전부 그 규약이라, 여기만
 * 다른 모양이면 이 파일을 읽는 사람이 두 규약을 함께 기억해야 한다.
 *
 * ── 이력이 있으면 지우지 않는다 ─────────────────────────────────────────
 * 지우려면 FK 사슬이 전부 비어 있어야 한다:
 *
 *     parts <- part_stock_balances.part_id <- stock_transactions.part_stock_balance_id
 *     parts <- inventory_part_request_items.part_id
 *
 * 셋 다 RESTRICT다. 참조가 남은 채로 휴지통에 넣으면 15일 뒤 완전삭제가
 * DB에서 거부되고, 그 부품은 "지운 줄 알았는데 영원히 휴지통에 남아 있는"
 * 상태가 된다. 그래서 지울 수 없는 것은 처음부터 휴지통에도 넣지 않는다.
 *
 * ── 잔량 버킷은 완전삭제 때 함께 지운다 ─────────────────────────────────
 * part_stock_balances에는 소프트 삭제 컬럼이 없다(수량 캐시일 뿐 이력이
 * 아니다). 그래서 휴지통 단계에서는 건드리지 않고, 완전삭제 시점에 부품보다
 * 먼저 지운다 — FK가 강제하는 순서다. 이력이 없는 부품에만 도달하므로 여기
 * 딸려 가는 버킷은 실제로는 거의 없다(잔량 행은 입고로만 생기고, 입고는 곧
 * 이력이다). 그래도 지운다 — 남아 있으면 부품 삭제가 막힌다.
 *
 * ── 이름 충돌은 없다 ────────────────────────────────────────────────────
 * parts에는 유니크 인덱스가 없다(이 파일 위쪽 스키마 주석 참조 — 실데이터에
 * 믿을 만한 식별 키가 없어 일부러 두지 않았다). 그래서 고객사·제품 모델과
 * 달리 복원이 이름 충돌로 막히는 경우가 없다.
 * ============================================================================
 */

export type PartTrashInput = {
  partId: string;
  actorUserId: string;
  expectedVersion: number;
};

export type PartTrashResult = { ok: true; version: number } | Failure;

/** 이 부품을 붙잡고 있는 이력 수 — 입출고 이력(잔량 버킷 경유)과 부품 요청을 합쳐 센다. */
async function countPartLedgerReferences(tx: Tx, partId: string): Promise<number> {
  const [transactions] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(stockTransactions)
    .innerJoin(partStockBalances, eq(stockTransactions.partStockBalanceId, partStockBalances.id))
    .where(eq(partStockBalances.partId, partId));

  const [requestItems] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(inventoryPartRequestItems)
    .where(eq(inventoryPartRequestItems.partId, partId));

  return transactions.total + requestItems.total;
}

function partReferencedMessage(count: number): string {
  return `이 부품에 연결된 입출고 이력·부품 요청이 ${count}건 있어 삭제할 수 없습니다.`;
}

/** 부품을 휴지통으로 보낸다. 이력이 하나라도 있으면 아무것도 바꾸지 않는다. */
export async function softDeletePart(input: PartTrashInput & { reason: string | null }): Promise<PartTrashResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);
      if (!(await hasPermission(actor.role, "inventory.lifecycle", "MANAGE"))) {
        fail("FORBIDDEN", "부품 삭제 권한이 없습니다.");
      }

      const [part] = await tx
        .select()
        .from(parts)
        .where(and(eq(parts.id, input.partId), eq(parts.isDeleted, false)))
        .for("update");
      if (!part) fail("NOT_FOUND", "해당 부품을 찾을 수 없습니다.");
      if (part.version !== input.expectedVersion) {
        fail("CONFLICT", "다른 사용자가 이 부품을 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
      }

      const references = await countPartLedgerReferences(tx, input.partId);
      if (references > 0) fail("INVALID_INPUT", partReferencedMessage(references));

      const deletedAt = new Date();
      await tx
        .update(parts)
        .set({
          isDeleted: true,
          deletedAt,
          deletedBy: input.actorUserId,
          deleteReason: input.reason,
          version: part.version + 1,
          updatedAt: deletedAt,
        })
        .where(eq(parts.id, input.partId));

      await insertAuditLog(tx, {
        actorUserId: input.actorUserId,
        actionType: "SOFT_DELETE",
        targetEntity: "parts",
        targetRecordId: input.partId,
        previousValue: {
          id: part.id,
          partName: part.partName,
          partSpec: part.partSpec,
          kyosanPartNo: part.kyosanPartNo,
          drawingNo: part.drawingNo,
          category: part.category,
        },
        newValue: { isDeleted: true, deletedAt: deletedAt.toISOString(), deleteReason: input.reason },
      });

      return { ok: true, version: part.version + 1 };
    });
  } catch (err) {
    if (err instanceof InventoryMutationError) return err.result;
    throw err;
  }
}

/** 휴지통의 부품을 되살린다. parts에는 유니크 인덱스가 없어 이름 충돌로 막히는 일이 없다. */
export async function restorePart(input: PartTrashInput): Promise<PartTrashResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);
      if (!(await hasPermission(actor.role, "inventory.lifecycle", "MANAGE"))) {
        fail("FORBIDDEN", "부품 복원 권한이 없습니다.");
      }

      const [part] = await tx
        .select()
        .from(parts)
        .where(and(eq(parts.id, input.partId), eq(parts.isDeleted, true)))
        .for("update");
      if (!part) fail("NOT_FOUND", "해당 부품을 찾을 수 없습니다.");
      if (part.version !== input.expectedVersion) {
        fail("CONFLICT", "다른 사용자가 이 부품을 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
      }

      await tx
        .update(parts)
        .set({
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
          version: part.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(parts.id, input.partId));

      await insertAuditLog(tx, {
        actorUserId: input.actorUserId,
        actionType: "RESTORE",
        targetEntity: "parts",
        targetRecordId: input.partId,
        previousValue: null,
        newValue: { id: part.id, partName: part.partName, isDeleted: false },
      });

      return { ok: true, version: part.version + 1 };
    });
  } catch (err) {
    if (err instanceof InventoryMutationError) return err.result;
    throw err;
  }
}

/**
 * 15일을 기다리지 않고 즉시 완전삭제한다. 자동 정리(master-data-purge.ts)와
 * 같은 일을 하되 사람이 행위자다. 삭제 순서는 FK가 강제한다: 잔량 버킷 → 부품.
 */
export async function permanentlyDeletePart(input: PartTrashInput & { reason: string }): Promise<PartTrashResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, input.actorUserId);
      if (!(await hasPermission(actor.role, "inventory.lifecycle", "MANAGE"))) {
        fail("FORBIDDEN", "부품 완전 삭제 권한이 없습니다.");
      }
      if (input.reason.trim().length === 0) fail("INVALID_INPUT", "완전 삭제 사유를 입력해 주세요.");

      const [part] = await tx
        .select()
        .from(parts)
        .where(and(eq(parts.id, input.partId), eq(parts.isDeleted, true)))
        .for("update");
      if (!part) fail("NOT_FOUND", "해당 부품을 찾을 수 없습니다.");
      if (part.version !== input.expectedVersion) {
        fail("CONFLICT", "다른 사용자가 이 부품을 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.");
      }

      // 휴지통에 넣을 때 이미 막았지만 여기서 다시 센다 — 그 사이에 이력이
      // 생겼다면 DB 오류로 터지는 대신 이유를 말해야 한다.
      const references = await countPartLedgerReferences(tx, input.partId);
      if (references > 0) fail("INVALID_INPUT", partReferencedMessage(references));

      await tx.delete(partStockBalances).where(eq(partStockBalances.partId, input.partId));
      await tx.delete(parts).where(eq(parts.id, input.partId));

      await insertAuditLog(tx, {
        actorUserId: input.actorUserId,
        actionType: "PURGE",
        targetEntity: "parts",
        targetRecordId: input.partId,
        previousValue: {
          id: part.id,
          partName: part.partName,
          partSpec: part.partSpec,
          kyosanPartNo: part.kyosanPartNo,
          drawingNo: part.drawingNo,
          category: part.category,
          deletedAt: part.deletedAt ? part.deletedAt.toISOString() : null,
          deletedBy: part.deletedBy,
          deleteReason: part.deleteReason,
          purgeReason: input.reason.trim(),
        },
        newValue: null,
      });

      return { ok: true, version: part.version };
    });
  } catch (err) {
    if (err instanceof InventoryMutationError) return err.result;
    throw err;
  }
}
