import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyProductRelation, type ProductIdentity } from "./product-relation";

function product(overrides: Partial<ProductIdentity>): ProductIdentity {
  return { modelName: "RFG-1000", serialNumber: null, lotNumber: null, ...overrides };
}

test("classifyProductRelation: exact serial match within the same model is SAME_PRODUCT, lot not required", () => {
  const a = product({ serialNumber: "SN-001", lotNumber: null });
  const b = product({ serialNumber: "SN-001", lotNumber: null });
  assert.equal(classifyProductRelation(a, b), "SAME_PRODUCT");
});

test("classifyProductRelation: exact serial AND lot match is still SAME_PRODUCT (lot is corroboration, not a separate tier)", () => {
  const a = product({ serialNumber: "SN-001", lotNumber: "L-2024-01" });
  const b = product({ serialNumber: "SN-001", lotNumber: "L-2024-01" });
  assert.equal(classifyProductRelation(a, b), "SAME_PRODUCT");
});

test("classifyProductRelation: same model, different serial is SAME_MODEL_REFERENCE, never SAME_PRODUCT", () => {
  const a = product({ serialNumber: "SN-001" });
  const b = product({ serialNumber: "SN-002" });
  assert.equal(classifyProductRelation(a, b), "SAME_MODEL_REFERENCE");
});

test("classifyProductRelation: same model, lot matches but serial is missing on one side, is SAME_MODEL_REFERENCE not SAME_PRODUCT", () => {
  const a = product({ serialNumber: null, lotNumber: "L-2024-01" });
  const b = product({ serialNumber: "SN-002", lotNumber: "L-2024-01" });
  assert.equal(classifyProductRelation(a, b), "SAME_MODEL_REFERENCE");
});

test("classifyProductRelation: same model, lot-only match on both sides (both missing serial) is SAME_MODEL_REFERENCE, never promoted to SAME_PRODUCT", () => {
  const a = product({ serialNumber: null, lotNumber: "L-2024-01" });
  const b = product({ serialNumber: null, lotNumber: "L-2024-01" });
  assert.equal(classifyProductRelation(a, b), "SAME_MODEL_REFERENCE");
});

test("classifyProductRelation: same model, both sides missing serial and lot is SAME_MODEL_REFERENCE (never treated as the same physical unit)", () => {
  const a = product({});
  const b = product({});
  assert.equal(classifyProductRelation(a, b), "SAME_MODEL_REFERENCE");
});

test("classifyProductRelation: different model is always NONE regardless of matching serial/lot", () => {
  const a = product({ modelName: "RFG-1000", serialNumber: "SN-001", lotNumber: "L-1" });
  const b = product({ modelName: "MB-2000", serialNumber: "SN-001", lotNumber: "L-1" });
  assert.equal(classifyProductRelation(a, b), "NONE");
});

test("classifyProductRelation: model comparison is normalized (trim + case-insensitive), matching the rest of this codebase's normalize() convention", () => {
  const a = product({ modelName: "  rfg-1000 ", serialNumber: "sn-001" });
  const b = product({ modelName: "RFG-1000", serialNumber: "SN-001" });
  assert.equal(classifyProductRelation(a, b), "SAME_PRODUCT");
});

test("classifyProductRelation: an empty-string serial is treated as missing, not as a matching empty value", () => {
  const a = product({ serialNumber: "" });
  const b = product({ serialNumber: "" });
  assert.equal(classifyProductRelation(a, b), "SAME_MODEL_REFERENCE");
});
