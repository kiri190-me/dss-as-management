import type { StockOwner } from "./inventory-types";

/**
 * Parts Request creation-form cart line — pure client-state shape, kept in
 * its own framework-free module (no React/Next imports) specifically so it
 * stays independently testable, same convention as
 * inventory-part-request-rules.ts. PartRequestSection.tsx owns the actual
 * useState wiring; this module only owns the pure per-line patch operation.
 */
export type CartLine = { partId: string; partName: string; quantity: string; owner: StockOwner | ""; note: string };

/** A patch touching only one field (e.g. owner) must never mutate any other field on the matched line, nor touch any other line. */
export function applyCartLinePatch(cart: CartLine[], partId: string, patch: Partial<CartLine>): CartLine[] {
  return cart.map((line) => (line.partId === partId ? { ...line, ...patch } : line));
}
