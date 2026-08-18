import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidExpectedUpdatedAt,
  isValidProductModelId,
  validateProductModelUpdateFields,
} from "./product-model-input";

function validFields(overrides: Record<string, unknown> = {}) {
  return {
    modelName: "TG-350",
    kind: "GENERATOR",
    manufacturer: "Acme",
    description: "설명",
    ...overrides,
  };
}

test("isValidProductModelId: accepts a UUID, rejects everything else", () => {
  assert.equal(isValidProductModelId("11111111-1111-1111-1111-111111111111"), true);
  assert.equal(isValidProductModelId("not-a-uuid"), false);
  assert.equal(isValidProductModelId(""), false);
  assert.equal(isValidProductModelId(undefined), false);
});

test("isValidExpectedUpdatedAt: accepts any non-empty string, rejects empty/non-string", () => {
  assert.equal(isValidExpectedUpdatedAt("2026-01-01T00:00:00.000Z"), true);
  assert.equal(isValidExpectedUpdatedAt(""), false);
  assert.equal(isValidExpectedUpdatedAt(undefined), false);
  assert.equal(isValidExpectedUpdatedAt(123), false);
});

test("validateProductModelUpdateFields: accepts a fully valid submission", () => {
  const result = validateProductModelUpdateFields(validFields());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data, {
      modelName: "TG-350",
      kind: "GENERATOR",
      manufacturer: "Acme",
      description: "설명",
    });
  }
});

test("validateProductModelUpdateFields: trims modelName/manufacturer/description", () => {
  const result = validateProductModelUpdateFields(
    validFields({ modelName: "  TG-350  ", manufacturer: "  Acme  ", description: "  설명  " })
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.modelName, "TG-350");
    assert.equal(result.data.manufacturer, "Acme");
    assert.equal(result.data.description, "설명");
  }
});

test("validateProductModelUpdateFields: rejects empty/whitespace-only modelName", () => {
  for (const modelName of ["", "   "]) {
    const result = validateProductModelUpdateFields(validFields({ modelName }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.modelName);
  }
});

test("validateProductModelUpdateFields: rejects a modelName over 200 chars", () => {
  const result = validateProductModelUpdateFields(validFields({ modelName: "A".repeat(201) }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.modelName);
});

test("validateProductModelUpdateFields: kind null/undefined/'' all normalize to null (미지정)", () => {
  for (const kind of [null, undefined, ""]) {
    const result = validateProductModelUpdateFields(validFields({ kind }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.kind, null);
  }
});

test("validateProductModelUpdateFields: accepts all classification kinds and rejects an unknown code", () => {
  for (const kind of ["GENERATOR", "MATCHER", "TOTAL_CONTROLLER"]) {
    const result = validateProductModelUpdateFields(validFields({ kind }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.kind, kind);
  }
  const invalid = validateProductModelUpdateFields(validFields({ kind: "MYSTERY" }));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.ok(invalid.fieldErrors.kind);
});

test("validateProductModelUpdateFields: manufacturer/description null/undefined/'' all normalize to null", () => {
  for (const value of [null, undefined, ""]) {
    const result = validateProductModelUpdateFields(validFields({ manufacturer: value, description: value }));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.manufacturer, null);
      assert.equal(result.data.description, null);
    }
  }
});

test("validateProductModelUpdateFields: rejects manufacturer over 200 chars and description over 4000 chars", () => {
  const badManufacturer = validateProductModelUpdateFields(validFields({ manufacturer: "A".repeat(201) }));
  assert.equal(badManufacturer.ok, false);
  if (!badManufacturer.ok) assert.ok(badManufacturer.fieldErrors.manufacturer);

  const badDescription = validateProductModelUpdateFields(validFields({ description: "A".repeat(4001) }));
  assert.equal(badDescription.ok, false);
  if (!badDescription.ok) assert.ok(badDescription.fieldErrors.description);
});
