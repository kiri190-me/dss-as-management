import "server-only";
import { eq } from "drizzle-orm";
import { partStockBalances, stockTransactions } from "../../schema";
import type { Tx } from "../procedure-templates";

/**
 * Low-level invariant-preserving primitive ONLY — balance row lock, version
 * check, live no-negative-stock check, USE ledger INSERT, cached balance
 * UPDATE, resulting_quantity snapshot. This is NOT an authorization
 * boundary: it carries no role logic and no repair-case/request validation
 * whatsoever. Every caller must complete its own authorization and business
 * validation (canUseStock / canIssuePartRequest, case-lock checks,
 * remaining-quantity checks, etc.) before ever invoking this.
 *
 * Not part of any public API. Import only from db/mutations/*.ts — never
 * from a server action, a domain/public module, UI, or the schema index.
 * The two approved callers are consumeStock (../inventory.ts) and
 * issuePartRequest (../inventory-part-requests.ts).
 */

export type ApplyStockUseCoreInput = {
  partStockBalanceId: string;
  quantity: number;
  actorUserId: string;
  repairCaseId?: string | null;
  destinationNote?: string | null;
  procedureExecutionNodeId?: string | null;
  requestItemId?: string | null;
  requestIssueId?: string | null;
  reason?: string | null;
};

export type ApplyStockUseCoreFailureCode = "NOT_FOUND" | "CONFLICT" | "INSUFFICIENT_STOCK";

export type ApplyStockUseCoreResult =
  | { ok: true; resultingQuantity: number; version: number }
  | { ok: false; code: ApplyStockUseCoreFailureCode };

/**
 * A balance row the caller has ALREADY locked (`FOR UPDATE`) itself — e.g.
 * issuePartRequest's batch pre-lock, which locks every distinct balance an
 * issue event touches in one deterministic id-sorted query, specifically to
 * avoid the multi-balance reverse-order deadlock two different requests
 * could otherwise hit. When supplied, applyStockUseCore trusts this state
 * as current and does NOT re-lock/re-select — the caller is responsible for
 * updating its own in-memory copy (from this call's returned
 * resultingQuantity/version) before passing the same balance into a second
 * call within the same issue event.
 */
export type PrelockedBalanceState = {
  id: string;
  currentQuantity: number;
  version: number;
};

export async function applyStockUseCore(
  tx: Tx,
  input: ApplyStockUseCoreInput,
  options?: { expectedVersion?: number; prelocked?: PrelockedBalanceState }
): Promise<ApplyStockUseCoreResult> {
  let balance: { id: string; currentQuantity: number; version: number };

  if (options?.prelocked) {
    // Direct consumeStock's single-balance behavior is untouched — this
    // branch only ever runs for the batch-prelocked issue path.
    balance = options.prelocked;
  } else {
    const [row] = await tx.select().from(partStockBalances).where(eq(partStockBalances.id, input.partStockBalanceId)).for("update");
    if (!row) return { ok: false, code: "NOT_FOUND" };
    if (options?.expectedVersion !== undefined && row.version !== options.expectedVersion) {
      return { ok: false, code: "CONFLICT" };
    }
    balance = row;
  }

  // No negative stock, ever, for any role — no override path exists.
  if (balance.currentQuantity < input.quantity) {
    return { ok: false, code: "INSUFFICIENT_STOCK" };
  }

  const resultingQuantity = balance.currentQuantity - input.quantity;

  await tx.insert(stockTransactions).values({
    partStockBalanceId: balance.id,
    transactionType: "USE",
    quantityDelta: -input.quantity,
    resultingQuantity,
    repairCaseId: input.repairCaseId ?? null,
    destinationNote: input.destinationNote ?? null,
    procedureExecutionNodeId: input.procedureExecutionNodeId ?? null,
    requestItemId: input.requestItemId ?? null,
    requestIssueId: input.requestIssueId ?? null,
    actorUserId: input.actorUserId,
    reason: input.reason ?? null,
  });

  const version = balance.version + 1;
  await tx.update(partStockBalances).set({ currentQuantity: resultingQuantity, version, updatedAt: new Date() }).where(eq(partStockBalances.id, balance.id));

  return { ok: true, resultingQuantity, version };
}
