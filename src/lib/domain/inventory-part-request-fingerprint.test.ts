import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRequestFingerprint } from "./inventory-part-request-fingerprint";
import { mergeDuplicateRequestItems, mergeDuplicateAllocations } from "./inventory-part-request-rules";

const CASE_ID = "11111111-1111-1111-1111-111111111111";
const PART_A = "22222222-2222-2222-2222-222222222222";
const PART_B = "33333333-3333-3333-3333-333333333333";
const REQUEST_ID = "44444444-4444-4444-4444-444444444444";
const ITEM_A = "55555555-5555-5555-5555-555555555555";
const BALANCE_X = "66666666-6666-6666-6666-666666666666";

test("CREATE_REQUEST fingerprint: identical logical cart in different entry order produces the same fingerprint", () => {
  const mergedA = mergeDuplicateRequestItems([
    { partId: PART_A, quantity: 3, note: "a" },
    { partId: PART_B, quantity: 1 },
    { partId: PART_A, quantity: 2, note: "b" },
  ]);
  const mergedB = mergeDuplicateRequestItems([
    { partId: PART_B, quantity: 1 },
    { partId: PART_A, quantity: 2, note: "b" },
    { partId: PART_A, quantity: 3, note: "a" },
  ]);
  assert.equal(mergedA.ok, true);
  assert.equal(mergedB.ok, true);
  if (!mergedA.ok || !mergedB.ok) return;

  const fpA = computeRequestFingerprint({
    operationType: "CREATE_REQUEST",
    payload: { repairCaseId: CASE_ID, note: null, items: mergedA.items },
  });
  const fpB = computeRequestFingerprint({
    operationType: "CREATE_REQUEST",
    payload: { repairCaseId: CASE_ID, note: null, items: mergedB.items },
  });
  assert.equal(fpA, fpB);
  assert.match(fpA, /^[0-9a-f]{64}$/);
});

test("CREATE_REQUEST fingerprint: header note is included — changing it changes the fingerprint", () => {
  const merged = mergeDuplicateRequestItems([{ partId: PART_A, quantity: 1 }]);
  assert.equal(merged.ok, true);
  if (!merged.ok) return;

  const fp1 = computeRequestFingerprint({ operationType: "CREATE_REQUEST", payload: { repairCaseId: CASE_ID, note: "urgent", items: merged.items } });
  const fp2 = computeRequestFingerprint({ operationType: "CREATE_REQUEST", payload: { repairCaseId: CASE_ID, note: null, items: merged.items } });
  assert.notEqual(fp1, fp2);
});

test("CREATE_REQUEST fingerprint: different quantity produces a different fingerprint", () => {
  const merged3 = mergeDuplicateRequestItems([{ partId: PART_A, quantity: 3 }]);
  const merged5 = mergeDuplicateRequestItems([{ partId: PART_A, quantity: 5 }]);
  assert.equal(merged3.ok, true);
  assert.equal(merged5.ok, true);
  if (!merged3.ok || !merged5.ok) return;

  const fp3 = computeRequestFingerprint({ operationType: "CREATE_REQUEST", payload: { repairCaseId: CASE_ID, note: null, items: merged3.items } });
  const fp5 = computeRequestFingerprint({ operationType: "CREATE_REQUEST", payload: { repairCaseId: CASE_ID, note: null, items: merged5.items } });
  assert.notEqual(fp3, fp5);
});

test("ISSUE fingerprint: allocation order does not affect the fingerprint (merge sorts deterministically)", () => {
  const mergedA = mergeDuplicateAllocations([
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: 3 },
  ]);
  const mergedB = mergeDuplicateAllocations([
    { requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: 3 },
  ]);
  assert.equal(mergedA.ok, true);
  assert.equal(mergedB.ok, true);
  if (!mergedA.ok || !mergedB.ok) return;

  const fpA = computeRequestFingerprint({ operationType: "ISSUE", payload: { requestId: REQUEST_ID, allocations: mergedA.allocations, note: null } });
  const fpB = computeRequestFingerprint({ operationType: "ISSUE", payload: { requestId: REQUEST_ID, allocations: mergedB.allocations, note: null } });
  assert.equal(fpA, fpB);
});

test("ISSUE fingerprint: a different quantity (3 vs 5) produces a different fingerprint — this is what rejects a same-key retry with changed input", () => {
  const merged3 = mergeDuplicateAllocations([{ requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: 3 }]);
  const merged5 = mergeDuplicateAllocations([{ requestItemId: ITEM_A, partStockBalanceId: BALANCE_X, quantity: 5 }]);
  assert.equal(merged3.ok, true);
  assert.equal(merged5.ok, true);
  if (!merged3.ok || !merged5.ok) return;

  const fp3 = computeRequestFingerprint({ operationType: "ISSUE", payload: { requestId: REQUEST_ID, allocations: merged3.allocations, note: null } });
  const fp5 = computeRequestFingerprint({ operationType: "ISSUE", payload: { requestId: REQUEST_ID, allocations: merged5.allocations, note: null } });
  assert.notEqual(fp3, fp5);
});

test("CANCEL/REJECT/PARTIALLY_CLOSE fingerprint: differs by reason", () => {
  const fp1 = computeRequestFingerprint({ operationType: "REJECT", payload: { requestId: REQUEST_ID, reason: "재고 부족" } });
  const fp2 = computeRequestFingerprint({ operationType: "REJECT", payload: { requestId: REQUEST_ID, reason: "다른 사유" } });
  assert.notEqual(fp1, fp2);
});

test("same operation type and payload always produces the identical fingerprint (pure/deterministic)", () => {
  const fp1 = computeRequestFingerprint({ operationType: "CANCEL", payload: { requestId: REQUEST_ID, reason: "잘못 요청함" } });
  const fp2 = computeRequestFingerprint({ operationType: "CANCEL", payload: { requestId: REQUEST_ID, reason: "잘못 요청함" } });
  assert.equal(fp1, fp2);
});
