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

/**
 * 한 모델에 붙일 수 있는 고객사 수의 상한.
 *
 * 실측상 가장 많은 모델(TG-100 · TG-300 · TG-200)이 4곳이고, 고객사 대장 자체가
 * 수십 곳 규모다. 그러니 100은 **실제 사용을 절대 막지 않는다.** 상한을 두는
 * 이유는 사용자를 막기 위해서가 아니라, 화면을 거치지 않고 이 액션을 부를 수 있는
 * 이상 uuid 수만 개짜리 배열이 들어와 mutation 의 존재 확인 조회(IN 절)와 INSERT
 * 를 그만큼 부풀리는 길을 미리 닫아 두기 위해서다. 값이 아니라 "여기 상한이
 * 있다"는 사실이 요점이라 넉넉하게 잡았다.
 */
const MAX_CUSTOMER_IDS = 100;

export const PRODUCT_MODEL_KIND_CODES = ["GENERATOR", "MATCHER", "TOTAL_CONTROLLER"] as const;
export type ProductModelKind = (typeof PRODUCT_MODEL_KIND_CODES)[number];

export type ProductModelUpdateFields = {
  modelName: string;
  kind: ProductModelKind | null;
  manufacturer: string | null;
  description: string | null;
  /** 이 모델에 붙일 고객사 id. **중복이 제거된 채로** 나온다(아래 참조). 빈 배열이
   * 정상값이다 — 고객사를 하나도 안 붙인 모델이 대부분이다. */
  customerIds: string[];
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
 *
 * ── customerIds 에 대해 여기서 내린 판단 셋 ─────────────────────────────
 *  1) **없으면 빈 배열이다(오류가 아니다).** "항상 전체 제출" 규약을 어기는 것이
 *     아니라, 위 규약 안에서 기존 필드들이 이미 하는 것과 같이 맞춘 것이다 —
 *     modelName 만 없으면 오류이고(모델에 이름 없는 상태는 뜻을 갖지 못한다),
 *     kind · manufacturer · description 은 셋 다 null/undefined/"" 를 "비어 있음"
 *     으로 받는다. customerIds 의 "비어 있음"은 `[]` 이고, 그것은 실제로 대부분의
 *     모델이 놓인 상태다. 여기만 undefined 를 오류로 잡으면 같은 화면의 같은
 *     구역인데 필드마다 규칙이 다른 판이 된다.
 *     (그 대가는 기존 필드들과 똑같다 — 화면이 이 칸을 빠뜨리고 보내면 연결이
 *     지워진다. manufacturer 를 빠뜨리면 제조사가 지워지는 것과 같은 성질이고,
 *     "화면은 늘 전체를 보낸다"는 이 함수의 규약이 그것을 막는 자리다.)
 *  2) **중복은 오류가 아니라 조용히 합친다.** 같은 고객사를 두 번 고르는 것은
 *     사람이 고칠 잘못이 아니라 "그 고객사를 붙인다"는 뜻이 두 번 적힌 것뿐이라,
 *     되돌려 보내 다시 고르게 할 이유가 없다. 여기서 합쳐 두면 mutation 의
 *     INSERT 가 유니크 인덱스에 걸려 사람이 읽을 수 없는 DB 오류로 터지는 길이
 *     막힌다. (mutation 도 제 몫으로 한 번 더 합친다 — 그쪽은 이 함수를 거치지
 *     않고도 불릴 수 있는 공개 함수라 스스로를 지켜야 한다.)
 *  3) **원소는 uuid 모양이어야 한다.** 실제로 있는 고객사인지 · 휴지통에 들어
 *     있지는 않은지는 여기서 알 수 없다 — 그것은 DB 를 봐야 하는 판정이라
 *     mutation 이 트랜잭션 안에서 다시 한다. 여기는 모양만 본다.
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

  let customerIds: string[] = [];
  const customerIdsRaw = raw.customerIds;
  if (customerIdsRaw === null || customerIdsRaw === undefined) {
    customerIds = [];
  } else if (!Array.isArray(customerIdsRaw)) {
    fieldErrors.customerIds = "고객사 값을 확인할 수 없습니다.";
  } else if (customerIdsRaw.length > MAX_CUSTOMER_IDS) {
    fieldErrors.customerIds = `고객사는 최대 ${MAX_CUSTOMER_IDS}곳까지 선택할 수 있습니다.`;
  } else if (!customerIdsRaw.every((value) => typeof value === "string" && UUID_PATTERN.test(value))) {
    fieldErrors.customerIds = "고객사 값을 확인할 수 없습니다.";
  } else {
    // 중복은 여기서 합친다(위 머리말 2). Set 은 처음 나온 차례를 지킨다.
    customerIds = [...new Set(customerIdsRaw as string[])];
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { modelName, kind, manufacturer, description, customerIds } };
}
