/**
 * Phase 5B-2 — pure RETURN-quantity rules. No DOM, no React, no DB access.
 * A RETURN always reverses a specific prior USE (plan §6) — a single USE
 * may be partially returned across multiple RETURN rows, so "how much is
 * still returnable" must be recomputed fresh from the full ledger every
 * time, never cached. These functions take already-loaded numbers (the
 * mutation layer is responsible for summing the real
 * stock_transactions rows) so the arithmetic itself stays independently
 * testable.
 */

export type PriorReturn = { quantity: number };

/** Sum of every RETURN already recorded against one original USE. */
export function computeAlreadyReversedQuantity(priorReturns: PriorReturn[]): number {
  return priorReturns.reduce((sum, r) => sum + r.quantity, 0);
}

/**
 * How much of an original USE (given as a positive quantity — the absolute
 * value of that transaction's negative quantity_delta) remains eligible
 * for a future RETURN. Never negative.
 */
export function computeReturnableQuantity(originalUseQuantity: number, priorReturns: PriorReturn[]): number {
  const alreadyReversed = computeAlreadyReversedQuantity(priorReturns);
  return Math.max(0, originalUseQuantity - alreadyReversed);
}

/** Whether a specific requested RETURN quantity is valid against the original USE and its prior returns. */
export function canReturnQuantity(originalUseQuantity: number, priorReturns: PriorReturn[], requestedQuantity: number): boolean {
  if (requestedQuantity <= 0) return false;
  return requestedQuantity <= computeReturnableQuantity(originalUseQuantity, priorReturns);
}
