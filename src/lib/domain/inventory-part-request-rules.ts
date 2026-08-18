import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";
import { STOCK_OWNER_CODES, type InventoryPartRequestStatus, type StockOwner } from "./inventory-types";

/**
 * Phase 5B-3 — pure rules for the Parts Request & Issue Workflow. No DOM,
 * no React, no DB access — the mutation layer is responsible for feeding
 * these functions already-loaded/already-parsed values and for re-deriving
 * anything that must be read live (remaining quantity, physical stock,
 * lock state). Kept independently testable, same convention as
 * inventory-return-rules.ts.
 *
 * Ordering discipline (approved plan — validate every raw quantity BEFORE
 * merging/aggregating, so an invalid line can never be hidden by
 * aggregation, e.g. `+5` and `-2` on the same part must never silently
 * become `3`): callers must call the `validateRaw*` function on the
 * caller-supplied list FIRST, and only call the corresponding `merge*`/
 * `aggregate*` function once that succeeds.
 */

// Matches the Postgres `integer` column type used throughout this schema
// (requested_quantity, issued_quantity, quantity_delta, etc.) — not bigint.
export const PG_INTEGER_MAX = 2147483647;
export const PG_INTEGER_MIN = -2147483648;

function compareOrdinal(a: string, b: string): number {
  // Deliberately NOT localeCompare — ICU/locale-aware collation can vary by
  // Node build/OS, which would make "same logical input -> same fingerprint"
  // environment-dependent. Plain UTF-16 code-unit ordering is stable
  // everywhere.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function normalizeNote(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const MAX_REASON_LENGTH = 2000;

/** REJECT/CANCEL/PARTIALLY_CLOSE all require a real, non-blank reason — whitespace-only is invalid, never silently normalized to null (unlike notes). */
export function validateRequiredReason(value: unknown): { ok: true; reason: string } | { ok: false; message: string } {
  if (typeof value !== "string") return { ok: false, message: "사유를 입력해 주세요." };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, message: "사유를 입력해 주세요." };
  if (trimmed.length > MAX_REASON_LENGTH) return { ok: false, message: `사유는 ${MAX_REASON_LENGTH}자를 초과할 수 없습니다.` };
  return { ok: true, reason: trimmed };
}

export type QuantityValidationResult = { ok: true } | { ok: false; message: string };

/** Rejects: non-number, fractional, NaN, Infinity (all caught by !Number.isInteger), 0, negative, and anything beyond the Postgres integer range. */
export function validateRawQuantity(value: unknown): QuantityValidationResult {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { ok: false, message: "수량은 1 이상의 정수여야 합니다." };
  }
  if (value <= 0) {
    return { ok: false, message: "수량은 1 이상의 정수여야 합니다." };
  }
  if (value > PG_INTEGER_MAX) {
    return { ok: false, message: "수량이 처리 가능한 범위를 초과했습니다." };
  }
  return { ok: true };
}

export type SafeAddResult = { ok: true; value: number } | { ok: false; message: string };

/** Overflow-safe accumulation — used for every duplicate-merge and per-item aggregate sum, so a legitimate-looking pair of raw quantities can never silently produce an out-of-range total. */
export function safeAddQuantity(a: number, b: number): SafeAddResult {
  const sum = a + b;
  if (!Number.isSafeInteger(sum) || sum > PG_INTEGER_MAX) {
    return { ok: false, message: "수량 합계가 처리 가능한 범위를 초과했습니다." };
  }
  return { ok: true, value: sum };
}

// ---- CREATE_REQUEST: raw item validation + duplicate-part merge ----

/** owner is `unknown` — raw, unvalidated client input, same discipline as every other raw field here (validated by validateRawOwner, never trusted). */
export type RawRequestItem = { partId: string; quantity: number; owner: unknown; note?: string | null };
export type NormalizedRequestItem = { partId: string; quantity: number; owner: StockOwner; note: string | null };

export type ValidateRawOwnerResult = { ok: true; owner: StockOwner } | { ok: false; message: string };

/**
 * Parts Request 소유구분 checkpoint — required on every NEW request item
 * (never optional, never guessed/defaulted). Validated against the exact
 * canonical stock_owner values (STOCK_OWNER_CODES) — reused, not
 * duplicated. Historical rows predating this checkpoint are NULL in the DB
 * (migration 0024) and are never produced by this validator; that NULL is
 * a read-path/display concern only (see stockOwnerLabelOrUnspecified), not
 * something this create-path validator ever emits.
 */
export function validateRawOwner(value: unknown): ValidateRawOwnerResult {
  if (typeof value !== "string" || !(STOCK_OWNER_CODES as readonly string[]).includes(value)) {
    return { ok: false, message: "소유구분을 선택해 주세요." };
  }
  return { ok: true, owner: value as StockOwner };
}

export type ValidateRawRequestItemsResult = { ok: true } | { ok: false; message: string };

/** Step 1-2 of the approved CREATE_REQUEST order: reject an empty cart, then validate every raw line independently (including owner) before any merge ever happens. */
export function validateRawRequestItems(rawItems: RawRequestItem[]): ValidateRawRequestItemsResult {
  if (rawItems.length === 0) return { ok: false, message: "요청할 부품을 1개 이상 선택해 주세요." };
  for (const item of rawItems) {
    if (!isValidUuid(item.partId)) return { ok: false, message: "부품 정보를 확인할 수 없습니다." };
    const quantityCheck = validateRawQuantity(item.quantity);
    if (!quantityCheck.ok) return quantityCheck;
    const ownerCheck = validateRawOwner(item.owner);
    if (!ownerCheck.ok) return ownerCheck;
  }
  return { ok: true };
}

export type MergeDuplicateRequestItemsResult = { ok: true; items: NormalizedRequestItem[] } | { ok: false; message: string };

/**
 * Steps 3-7: only ever called after validateRawRequestItems has already
 * succeeded on the exact same list. Deterministic merge: quantities summed
 * (overflow-safe), notes normalized/deduped/sorted-ordinal/joined with
 * "\n" (empty if none), result sorted by partId — so the same logical cart
 * always normalizes to the same item list regardless of entry order (this
 * is what makes the CREATE_REQUEST fingerprint order-independent).
 *
 * owner is carried through per part, never silently reconciled: two raw
 * lines for the same part with different owners is a genuine conflict
 * (this table has exactly one owner value per request-item row) and is
 * rejected outright, same discipline as the duplicate-quantity-sign
 * behavior this function already has for its neighbors.
 */
export function mergeDuplicateRequestItems(rawItems: RawRequestItem[]): MergeDuplicateRequestItemsResult {
  const byPart = new Map<string, { quantity: number; owner: StockOwner; notes: string[] }>();
  for (const item of rawItems) {
    const ownerCheck = validateRawOwner(item.owner);
    if (!ownerCheck.ok) return { ok: false, message: ownerCheck.message };
    const normalizedNote = normalizeNote(item.note);
    const existing = byPart.get(item.partId);
    if (existing) {
      if (existing.owner !== ownerCheck.owner) {
        return { ok: false, message: "동일 부품에 서로 다른 소유구분이 지정되었습니다." };
      }
      const sum = safeAddQuantity(existing.quantity, item.quantity);
      if (!sum.ok) return { ok: false, message: sum.message };
      existing.quantity = sum.value;
      if (normalizedNote) existing.notes.push(normalizedNote);
    } else {
      byPart.set(item.partId, { quantity: item.quantity, owner: ownerCheck.owner, notes: normalizedNote ? [normalizedNote] : [] });
    }
  }

  const items: NormalizedRequestItem[] = [...byPart.entries()]
    .map(([partId, { quantity, owner, notes }]) => {
      const dedupedSortedNotes = [...new Set(notes)].sort(compareOrdinal);
      return { partId, quantity, owner, note: dedupedSortedNotes.length > 0 ? dedupedSortedNotes.join("\n") : null };
    })
    .sort((a, b) => compareOrdinal(a.partId, b.partId));

  return { ok: true, items };
}

// ---- ISSUE: raw allocation validation + duplicate-allocation merge + per-item aggregation ----

export type RawIssueAllocation = { requestItemId: string; partStockBalanceId: string; quantity: number };
export type MergedIssueAllocation = { requestItemId: string; partStockBalanceId: string; quantity: number };
export type ItemRoundAggregate = { requestItemId: string; roundIssueQuantity: number };

export type ValidateRawIssueAllocationsResult = { ok: true } | { ok: false; message: string };

/** Steps 1-2 of the approved ISSUE order: reject an empty issue event, then validate every raw allocation independently before any merge/aggregation. */
export function validateRawIssueAllocations(rawAllocations: RawIssueAllocation[]): ValidateRawIssueAllocationsResult {
  if (rawAllocations.length === 0) return { ok: false, message: "불출할 항목을 1개 이상 선택해 주세요." };
  for (const allocation of rawAllocations) {
    if (!isValidUuid(allocation.requestItemId) || !isValidUuid(allocation.partStockBalanceId)) {
      return { ok: false, message: "요청 항목 정보를 확인할 수 없습니다." };
    }
    const quantityCheck = validateRawQuantity(allocation.quantity);
    if (!quantityCheck.ok) return quantityCheck;
  }
  return { ok: true };
}

export type MergeDuplicateAllocationsResult = { ok: true; allocations: MergedIssueAllocation[] } | { ok: false; message: string };

/** Step 3-5: merges exact-duplicate (requestItemId, partStockBalanceId) pairs by summing (overflow-safe), sorted by requestItemId then partStockBalanceId. Only called after validateRawIssueAllocations succeeds. */
export function mergeDuplicateAllocations(rawAllocations: RawIssueAllocation[]): MergeDuplicateAllocationsResult {
  const byKey = new Map<string, MergedIssueAllocation>();
  for (const allocation of rawAllocations) {
    const key = `${allocation.requestItemId}::${allocation.partStockBalanceId}`;
    const existing = byKey.get(key);
    if (existing) {
      const sum = safeAddQuantity(existing.quantity, allocation.quantity);
      if (!sum.ok) return { ok: false, message: sum.message };
      existing.quantity = sum.value;
    } else {
      byKey.set(key, { ...allocation });
    }
  }

  const allocations = [...byKey.values()].sort(
    (a, b) => compareOrdinal(a.requestItemId, b.requestItemId) || compareOrdinal(a.partStockBalanceId, b.partStockBalanceId)
  );
  return { ok: true, allocations };
}

export type AggregateAllocationsByItemResult = { ok: true; aggregates: ItemRoundAggregate[] } | { ok: false; message: string };

/**
 * Step 6-8: groups merged allocations by requestItemId (a single item may be
 * issued from several buckets in one event) and computes each item's
 * roundIssueQuantity — the number that must be validated against
 * `requested_quantity - issued_quantity`, never any individual allocation
 * validated in isolation (that's exactly what would let `+5`/`-2` — or,
 * post-validation, two valid allocations that together exceed remaining —
 * slip through).
 */
export function aggregateAllocationsByItem(allocations: MergedIssueAllocation[]): AggregateAllocationsByItemResult {
  const byItem = new Map<string, number>();
  for (const allocation of allocations) {
    const previous = byItem.get(allocation.requestItemId) ?? 0;
    const sum = safeAddQuantity(previous, allocation.quantity);
    if (!sum.ok) return { ok: false, message: sum.message };
    byItem.set(allocation.requestItemId, sum.value);
  }
  const aggregates = [...byItem.entries()]
    .map(([requestItemId, roundIssueQuantity]) => ({ requestItemId, roundIssueQuantity }))
    .sort((a, b) => compareOrdinal(a.requestItemId, b.requestItemId));
  return { ok: true, aggregates };
}

// ---- Remaining quantity / status lifecycle ----

export function computeRemainingQuantity(requestedQuantity: number, issuedQuantity: number): number {
  return Math.max(0, requestedQuantity - issuedQuantity);
}

/** Whichever of the two terminal-vs-non-terminal outcomes an issue round produces — never anything else. */
export function computeStatusAfterIssue(allItemsFullyIssued: boolean): InventoryPartRequestStatus {
  return allItemsFullyIssued ? "FULLY_ISSUED" : "PARTIALLY_ISSUED";
}

export function isIssuableStatus(status: InventoryPartRequestStatus): boolean {
  return status === "PENDING" || status === "PARTIALLY_ISSUED";
}

/** AS_ENGINEER may cancel only their own PENDING request — even PARTIALLY_ISSUED is no longer cancellable (some stock has already moved). */
export function canCancelRequestStatus(status: InventoryPartRequestStatus): boolean {
  return status === "PENDING";
}

/** Reject is a PENDING-only, zero-issued transition — a partially issued request that will never be completed uses PARTIALLY_CLOSED instead. */
export function canRejectRequestStatus(status: InventoryPartRequestStatus, totalIssuedQuantity: number): boolean {
  return status === "PENDING" && totalIssuedQuantity === 0;
}

/** Requires both: something has already been issued, and something remains unfulfilled. */
export function canPartiallyCloseRequestStatus(
  status: InventoryPartRequestStatus,
  totalIssuedQuantity: number,
  totalRemainingQuantity: number
): boolean {
  return status === "PARTIALLY_ISSUED" && totalIssuedQuantity > 0 && totalRemainingQuantity > 0;
}
