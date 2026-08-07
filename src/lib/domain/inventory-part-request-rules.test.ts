import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PG_INTEGER_MAX,
  normalizeNote,
  validateRequiredReason,
  validateRawQuantity,
  safeAddQuantity,
  validateRawRequestItems,
  mergeDuplicateRequestItems,
  validateRawIssueAllocations,
  mergeDuplicateAllocations,
  aggregateAllocationsByItem,
  computeRemainingQuantity,
  computeStatusAfterIssue,
  isIssuableStatus,
  canCancelRequestStatus,
  canRejectRequestStatus,
  canPartiallyCloseRequestStatus,
} from "./inventory-part-request-rules";

const PART_A = "11111111-1111-1111-1111-111111111111";
const PART_B = "22222222-2222-2222-2222-222222222222";
const ITEM_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ITEM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const BALANCE_X = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const BALANCE_Y = "dddddddd-dddd-dddd-dddd-dddddddddddd";

test("normalizeNote: trims whitespace and converts blank to null", () => {
  assert.equal(normalizeNote("  hi  "), "hi");
  assert.equal(normalizeNote("   "), null);
  assert.equal(normalizeNote(""), null);
  assert.equal(normalizeNote(null), null);
  assert.equal(normalizeNote(undefined), null);
});

test("validateRequiredReason: rejects blank/whitespace-only, trims valid input", () => {
  assert.equal(validateRequiredReason("   ").ok, false);
  assert.equal(validateRequiredReason("").ok, false);
  assert.equal(validateRequiredReason(123).ok, false);
  const result = validateRequiredReason("  재고 부족  ");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.reason, "재고 부족");
});

test("validateRawQuantity: rejects 0, negative, fractional, NaN, Infinity, out-of-range", () => {
  assert.equal(validateRawQuantity(0).ok, false);
  assert.equal(validateRawQuantity(-2).ok, false);
  assert.equal(validateRawQuantity(1.5).ok, false);
  assert.equal(validateRawQuantity(NaN).ok, false);
  assert.equal(validateRawQuantity(Infinity).ok, false);
  assert.equal(validateRawQuantity(-Infinity).ok, false);
  assert.equal(validateRawQuantity(PG_INTEGER_MAX + 1).ok, false);
  assert.equal(validateRawQuantity("5").ok, false);
  assert.equal(validateRawQuantity(5).ok, true);
  assert.equal(validateRawQuantity(PG_INTEGER_MAX).ok, true);
});

test("safeAddQuantity: rejects overflow beyond the Postgres integer range", () => {
  assert.equal(safeAddQuantity(5, 3).ok, true);
  const overflow = safeAddQuantity(PG_INTEGER_MAX, 1);
  assert.equal(overflow.ok, false);
  const overflow2 = safeAddQuantity(PG_INTEGER_MAX - 1, 2);
  assert.equal(overflow2.ok, false);
});

test("validateRawRequestItems: rejects an empty cart", () => {
  const result = validateRawRequestItems([]);
  assert.equal(result.ok, false);
});

test("validateRawRequestItems: a single invalid raw line fails validation even if a duplicate positive line exists for the same part (must fail BEFORE merge)", () => {
  const result = validateRawRequestItems([
    { partId: PART_A, quantity: 5 },
    { partId: PART_A, quantity: -2 },
  ]);
  assert.equal(result.ok, false, "the -2 line must be rejected outright, never merged into a net 3");
});

test("validateRawRequestItems: rejects invalid partId, fractional/zero/negative/oversized quantity", () => {
  assert.equal(validateRawRequestItems([{ partId: "not-a-uuid", quantity: 1 }]).ok, false);
  assert.equal(validateRawRequestItems([{ partId: PART_A, quantity: 0 }]).ok, false);
  assert.equal(validateRawRequestItems([{ partId: PART_A, quantity: 1.5 }]).ok, false);
  assert.equal(validateRawRequestItems([{ partId: PART_A, quantity: PG_INTEGER_MAX + 1 }]).ok, false);
});

test("mergeDuplicateRequestItems: same part selected twice normalizes into one item with summed quantity", () => {
  const result = mergeDuplicateRequestItems([
    { partId: PART_A, quantity: 3 },
    { partId: PART_A, quantity: 4 },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].partId, PART_A);
  assert.equal(result.items[0].quantity, 7);
});

test("mergeDuplicateRequestItems: merges notes deterministically regardless of entry order", () => {
  const orderA = mergeDuplicateRequestItems([
    { partId: PART_A, quantity: 1, note: "urgent" },
    { partId: PART_A, quantity: 2, note: "for repair" },
  ]);
  const orderB = mergeDuplicateRequestItems([
    { partId: PART_A, quantity: 2, note: "for repair" },
    { partId: PART_A, quantity: 1, note: "urgent" },
  ]);
  assert.equal(orderA.ok, true);
  assert.equal(orderB.ok, true);
  if (!orderA.ok || !orderB.ok) return;
  assert.deepEqual(orderA.items, orderB.items, "same logical cart must normalize identically regardless of cart-entry order");
  assert.equal(orderA.items[0].quantity, 3);
});

test("mergeDuplicateRequestItems: exact duplicate notes are deduped; blank/whitespace-only notes drop out; no notes -> null", () => {
  const result = mergeDuplicateRequestItems([
    { partId: PART_A, quantity: 1, note: "same" },
    { partId: PART_A, quantity: 1, note: "same" },
    { partId: PART_A, quantity: 1, note: "   " },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items[0].note, "same");

  const noNotes = mergeDuplicateRequestItems([{ partId: PART_B, quantity: 1 }]);
  assert.equal(noNotes.ok, true);
  if (!noNotes.ok) return;
  assert.equal(noNotes.items[0].note, null);
});

test("mergeDuplicateRequestItems: result is sorted by partId", () => {
  const result = mergeDuplicateRequestItems([
    { partId: PART_B, quantity: 1 },
    { partId: PART_A, quantity: 1 },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.items.map((i) => i.partId), [PART_A, PART_B]);
});

test("mergeDuplicateRequestItems: rejects when duplicate quantities overflow the Postgres integer range", () => {
  const result = mergeDuplicateRequestItems([
    { partId: PART_A, quantity: PG_INTEGER_MAX },
    { partId: PART_A, quantity: 10 },
  ]);
  assert.equal(result.ok, false);
});

test("validateRawIssueAllocations: rejects an empty issue event", () => {
  assert.equal(validateRawIssueAllocations([]).ok, false);
});

test("validateRawIssueAllocations: a negative allocation must fail even alongside a positive one for the same item+balance (must fail BEFORE merge)", () => {
  const result = validateRawIssueAllocations([
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: 5 },
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: -2 },
  ]);
  assert.equal(result.ok, false, "the -2 allocation must be rejected outright, never merged into a net 3");
});

test("validateRawIssueAllocations: rejects fractional/oversized allocation, invalid ids", () => {
  assert.equal(validateRawIssueAllocations([{ requestItemId: "bad", partStockBalanceId: BALANCE_X, quantity: 1 }]).ok, false);
  assert.equal(validateRawIssueAllocations([{ requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: 1.2 }]).ok, false);
  assert.equal(validateRawIssueAllocations([{ requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: PG_INTEGER_MAX + 1 }]).ok, false);
});

test("mergeDuplicateAllocations: duplicate (requestItemId, partStockBalanceId) pairs merge by summing", () => {
  const result = mergeDuplicateAllocations([
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: 2 },
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: 3 },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.allocations.length, 1);
  assert.equal(result.allocations[0].quantity, 5);
});

test("mergeDuplicateAllocations: sorted by requestItemId then partStockBalanceId", () => {
  const result = mergeDuplicateAllocations([
    { requestItemId: ITEM_B, partStockBalanceId: BALANCE_X, quantity: 1 },
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_Y, quantity: 1 },
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: 1 },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.allocations.map((a) => `${a.requestItemId}:${a.partStockBalanceId}`),
    [`${ITEM_A}:${BALANCE_X}`, `${ITEM_A}:${BALANCE_Y}`, `${ITEM_B}:${BALANCE_X}`]
  );
});

test("aggregateAllocationsByItem: split-bucket issue aggregates per request item before any remaining-quantity validation (10 requested, 2 already issued, this round DSS/A=4 + KYOSAN/B=5 -> round total 9)", () => {
  const merged = mergeDuplicateAllocations([
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: 4 },
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_Y, quantity: 5 },
  ]);
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  const aggregated = aggregateAllocationsByItem(merged.allocations);
  assert.equal(aggregated.ok, true);
  if (!aggregated.ok) return;
  assert.equal(aggregated.aggregates.length, 1);
  assert.equal(aggregated.aggregates[0].roundIssueQuantity, 9);
  // 2 already issued + 9 this round = 11 > 10 requested -> the caller must reject this atomically.
  const alreadyIssued = 2;
  const requested = 10;
  assert.equal(alreadyIssued + aggregated.aggregates[0].roundIssueQuantity > requested, true, "must fail atomically, not per-allocation");
});

test("aggregateAllocationsByItem: split-bucket issue succeeds when the aggregate is within remaining", () => {
  const merged = mergeDuplicateAllocations([
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: 3 },
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_Y, quantity: 2 },
  ]);
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  const aggregated = aggregateAllocationsByItem(merged.allocations);
  assert.equal(aggregated.ok, true);
  if (!aggregated.ok) return;
  assert.equal(aggregated.aggregates[0].roundIssueQuantity, 5);
  assert.equal(0 + 5 <= 10, true);
});

test("aggregateAllocationsByItem: rejects when a per-item aggregate overflows the Postgres integer range", () => {
  const merged = mergeDuplicateAllocations([
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: PG_INTEGER_MAX },
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_Y, quantity: 10 },
  ]);
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  const aggregated = aggregateAllocationsByItem(merged.allocations);
  assert.equal(aggregated.ok, false);
});

test("computeRemainingQuantity: never negative", () => {
  assert.equal(computeRemainingQuantity(10, 4), 6);
  assert.equal(computeRemainingQuantity(10, 10), 0);
  assert.equal(computeRemainingQuantity(10, 12), 0);
});

test("computeStatusAfterIssue", () => {
  assert.equal(computeStatusAfterIssue(true), "FULLY_ISSUED");
  assert.equal(computeStatusAfterIssue(false), "PARTIALLY_ISSUED");
});

test("isIssuableStatus", () => {
  assert.equal(isIssuableStatus("PENDING"), true);
  assert.equal(isIssuableStatus("PARTIALLY_ISSUED"), true);
  for (const status of ["FULLY_ISSUED", "PARTIALLY_CLOSED", "REJECTED", "CANCELLED"] as const) {
    assert.equal(isIssuableStatus(status), false, status);
  }
});

test("canCancelRequestStatus: PENDING only", () => {
  assert.equal(canCancelRequestStatus("PENDING"), true);
  assert.equal(canCancelRequestStatus("PARTIALLY_ISSUED"), false);
});

test("canRejectRequestStatus: PENDING and zero issued only", () => {
  assert.equal(canRejectRequestStatus("PENDING", 0), true);
  assert.equal(canRejectRequestStatus("PENDING", 1), false);
  assert.equal(canRejectRequestStatus("PARTIALLY_ISSUED", 0), false);
});

test("canPartiallyCloseRequestStatus: requires PARTIALLY_ISSUED, issued > 0, and remaining > 0", () => {
  assert.equal(canPartiallyCloseRequestStatus("PARTIALLY_ISSUED", 6, 4), true);
  assert.equal(canPartiallyCloseRequestStatus("PARTIALLY_ISSUED", 0, 10), false);
  assert.equal(canPartiallyCloseRequestStatus("PARTIALLY_ISSUED", 10, 0), false);
  assert.equal(canPartiallyCloseRequestStatus("PENDING", 6, 4), false);
});
