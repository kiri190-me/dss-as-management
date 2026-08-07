/**
 * Phase 5A — conservative product-relation classification for
 * "이전 수리 이력" (previous repair history), operating over the real
 * `products` table's identity fields (modelName required, serialNumber and
 * lotNumber both nullable — src/lib/db/schema/products.ts). L/N means LOT
 * NUMBER in this business; there is no separate line-number concept, and
 * this module reuses the existing `lotNumber` field only.
 *
 * Deliberately NOT a reuse of matchesNormalizedTriple
 * (src/lib/domain/local/product-history-match.ts): that function requires
 * model + lot + serial to ALL be non-empty before it will ever report a
 * match, so it would never classify a confident exact-serial-within-model
 * match as related whenever lot is absent — real intake data commonly
 * lacks lot and/or serial. Its own code comment also explicitly forbids
 * changing its behavior (it must stay exactly as-is for the existing
 * mock/local-demo comparison path), so a new, separate function is used
 * here instead of loosening that one.
 */

export type ProductIdentity = {
  modelName: string;
  serialNumber: string | null;
  lotNumber: string | null;
};

export type ProductRelation = "SAME_PRODUCT" | "SAME_MODEL_REFERENCE" | "NONE";

function normalize(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeNullable(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * Conservative tiering (Phase 5A plan §12):
 *  - SAME_PRODUCT: model matches AND both sides have a non-empty serial
 *    number that matches exactly. This alone is already "strong" — lot is
 *    not required to reach this tier. A matching lotNumber alongside a
 *    matching serial is simply additional corroboration, not a separate
 *    tier.
 *  - SAME_MODEL_REFERENCE: model matches but the above does not hold —
 *    covers serial mismatch, either side missing a serial number, and a
 *    lot-only match (lot-number uniqueness is not a confirmed business
 *    rule, so a lot-only match is never promoted to SAME_PRODUCT).
 *  - NONE: model itself does not match.
 */
export function classifyProductRelation(a: ProductIdentity, b: ProductIdentity): ProductRelation {
  if (normalize(a.modelName) !== normalize(b.modelName)) return "NONE";

  const aSerial = normalizeNullable(a.serialNumber);
  const bSerial = normalizeNullable(b.serialNumber);
  if (aSerial !== null && bSerial !== null && aSerial === bSerial) return "SAME_PRODUCT";

  return "SAME_MODEL_REFERENCE";
}
