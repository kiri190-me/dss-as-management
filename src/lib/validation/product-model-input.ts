const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidProductModelId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Always the server's own ISO string echoed back verbatim — same convention as customer-update-input.ts's own isValidExpectedUpdatedAt. */
export function isValidExpectedUpdatedAt(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const MAX_SHORT_TEXT = 200;
const MAX_LONG_TEXT = 4000;

export const PRODUCT_MODEL_KIND_CODES = ["GENERATOR", "MATCHER", "TOTAL_CONTROLLER"] as const;
export type ProductModelKind = (typeof PRODUCT_MODEL_KIND_CODES)[number];

export type ProductModelUpdateFields = {
  modelName: string;
  kind: ProductModelKind | null;
  manufacturer: string | null;
  description: string | null;
};

export type ValidateProductModelUpdateResult =
  | { ok: true; data: ProductModelUpdateFields }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Always a full (never partial) update — one section, no role-conditional
 * per-field visibility (canEditProductModels gates the whole form or none
 * of it), so every field is required to be present in `raw`.
 *
 * kind is deliberately submitted as `null` for "미지정" (never inferred,
 * never defaulted to a guess) — the UI's "미지정" option submits `null`
 * explicitly, distinct from "field omitted."
 */
export function validateProductModelUpdateFields(
  raw: Record<string, unknown>
): ValidateProductModelUpdateResult {
  const fieldErrors: Record<string, string> = {};

  let modelName = "";
  const nameRaw = raw.modelName;
  if (typeof nameRaw !== "string" || nameRaw.trim() === "") {
    fieldErrors.modelName = "모델명을 입력해 주세요.";
  } else {
    const trimmed = nameRaw.trim();
    if (trimmed.length > MAX_SHORT_TEXT) {
      fieldErrors.modelName = "모델명이 너무 깁니다.";
    } else {
      modelName = trimmed;
    }
  }

  let kind: ProductModelKind | null = null;
  const kindRaw = raw.kind;
  if (kindRaw === null || kindRaw === undefined || kindRaw === "") {
    kind = null;
  } else if (typeof kindRaw !== "string" || !(PRODUCT_MODEL_KIND_CODES as readonly string[]).includes(kindRaw)) {
    fieldErrors.kind = "제품 종류 값을 확인할 수 없습니다.";
  } else {
    kind = kindRaw as ProductModelKind;
  }

  function normalizeNullableShortText(key: "manufacturer", label: string): string | null {
    const value = raw[key];
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") {
      fieldErrors[key] = `${label} 값을 확인할 수 없습니다.`;
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length > MAX_SHORT_TEXT) {
      fieldErrors[key] = `${label}이(가) 너무 깁니다.`;
      return null;
    }
    return trimmed === "" ? null : trimmed;
  }

  const manufacturer = normalizeNullableShortText("manufacturer", "제조사");

  let description: string | null = null;
  const descriptionRaw = raw.description;
  if (descriptionRaw === null || descriptionRaw === undefined || descriptionRaw === "") {
    description = null;
  } else if (typeof descriptionRaw !== "string") {
    fieldErrors.description = "설명 값을 확인할 수 없습니다.";
  } else {
    const trimmed = descriptionRaw.trim();
    if (trimmed.length > MAX_LONG_TEXT) {
      fieldErrors.description = "설명 내용이 너무 깁니다.";
    } else {
      description = trimmed === "" ? null : trimmed;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { modelName, kind, manufacturer, description } };
}
