import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidExpectedUpdatedAt,
  isValidProductModelId,
  validateProductModelUpdateFields,
} from "./product-model-input";

const CUSTOMER_ID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CUSTOMER_ID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function validFields(overrides: Record<string, unknown> = {}) {
  return {
    modelName: "TG-350",
    kind: "GENERATOR",
    manufacturer: "Acme",
    description: "설명",
    customerIds: [],
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
      customerIds: [],
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

// ── 고객사 연결(customerIds) ─────────────────────────────────────────────
// 규칙의 근거는 product-model-input.ts 의 머리말에 적혀 있다.

test("validateProductModelUpdateFields: 빈 배열은 정상이다 — 고객사를 하나도 안 붙인 모델", () => {
  const result = validateProductModelUpdateFields(validFields({ customerIds: [] }));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data.customerIds, []);
});

test("validateProductModelUpdateFields: 여러 고객사를 그대로 통과시키고 차례를 지킨다", () => {
  const result = validateProductModelUpdateFields(
    validFields({ customerIds: [CUSTOMER_ID_B, CUSTOMER_ID_A] })
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data.customerIds, [CUSTOMER_ID_B, CUSTOMER_ID_A]);
});

test("validateProductModelUpdateFields: customerIds 가 없으면(null/undefined) 빈 배열이다", () => {
  for (const value of [null, undefined]) {
    const result = validateProductModelUpdateFields(validFields({ customerIds: value }));
    assert.equal(result.ok, true, `customerIds=${String(value)} should be accepted as "none selected"`);
    if (result.ok) assert.deepEqual(result.data.customerIds, []);
  }
  // 키 자체가 없는 제출도 같다.
  const { customerIds: _omitted, ...withoutKey } = validFields();
  void _omitted;
  const result = validateProductModelUpdateFields(withoutKey);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data.customerIds, []);
});

test("validateProductModelUpdateFields: 중복된 고객사 id 는 오류가 아니라 합쳐진다", () => {
  const result = validateProductModelUpdateFields(
    validFields({ customerIds: [CUSTOMER_ID_A, CUSTOMER_ID_B, CUSTOMER_ID_A] })
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      result.data.customerIds,
      [CUSTOMER_ID_A, CUSTOMER_ID_B],
      "중복은 처음 나온 차례를 지킨 채 하나로 합쳐져야 한다"
    );
  }
});

test("validateProductModelUpdateFields: UUID 모양이 아닌 원소를 거부한다", () => {
  for (const bad of ["not-a-uuid", "", 123, null, undefined, {}, [CUSTOMER_ID_A]]) {
    const result = validateProductModelUpdateFields(validFields({ customerIds: [CUSTOMER_ID_A, bad] }));
    assert.equal(result.ok, false, `customerIds element ${JSON.stringify(bad)} should be rejected`);
    if (!result.ok) assert.ok(result.fieldErrors.customerIds);
  }
});

test("validateProductModelUpdateFields: 배열이 아닌 customerIds 를 거부한다", () => {
  for (const bad of [CUSTOMER_ID_A, 123, true, {}]) {
    const result = validateProductModelUpdateFields(validFields({ customerIds: bad }));
    assert.equal(result.ok, false, `customerIds=${JSON.stringify(bad)} should be rejected`);
    if (!result.ok) assert.ok(result.fieldErrors.customerIds);
  }
});

test("validateProductModelUpdateFields: 고객사 100곳까지는 통과하고 101곳부터 거부한다", () => {
  function ids(count: number) {
    return Array.from({ length: count }, (_, i) => `aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12, "0")}`);
  }
  const atLimit = validateProductModelUpdateFields(validFields({ customerIds: ids(100) }));
  assert.equal(atLimit.ok, true);
  if (atLimit.ok) assert.equal(atLimit.data.customerIds.length, 100);

  const overLimit = validateProductModelUpdateFields(validFields({ customerIds: ids(101) }));
  assert.equal(overLimit.ok, false);
  if (!overLimit.ok) assert.ok(overLimit.fieldErrors.customerIds);
});
