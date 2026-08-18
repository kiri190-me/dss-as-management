const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidCustomerId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** expectedUpdatedAt is always the server's own ISO string echoed back verbatim by the client (never hand-typed) — a plain non-empty-string check is enough, same convention as the repair-case-flowchart edit actions' expectedUpdatedAt. */
export function isValidExpectedUpdatedAt(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const MAX_SHORT_TEXT = 200;

export type CustomerUpdateFields = {
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

export type ValidateCustomerUpdateResult =
  | { ok: true; data: CustomerUpdateFields }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Always a full (never partial) update — unlike repair-case section edits,
 * the customer edit form has exactly one section and no role-conditional
 * per-field visibility (canEditCustomers gates the whole form or none of
 * it), so every field is required to be present in `raw` and always
 * resubmitted together.
 */
export function validateCustomerUpdateFields(
  raw: Record<string, unknown>
): ValidateCustomerUpdateResult {
  const fieldErrors: Record<string, string> = {};

  let name = "";
  const nameRaw = raw.name;
  if (typeof nameRaw !== "string" || nameRaw.trim() === "") {
    fieldErrors.name = "고객사명을 입력해 주세요.";
  } else {
    const trimmed = nameRaw.trim();
    if (trimmed.length > MAX_SHORT_TEXT) {
      fieldErrors.name = "고객사명이 너무 깁니다.";
    } else {
      name = trimmed;
    }
  }

  function normalizeNullableShortText(key: "contactName" | "contactPhone", label: string): string | null {
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

  const contactName = normalizeNullableShortText("contactName", "담당자 성함");
  const contactPhone = normalizeNullableShortText("contactPhone", "연락처");

  let contactEmail: string | null = null;
  const emailRaw = raw.contactEmail;
  if (emailRaw === null || emailRaw === undefined || emailRaw === "") {
    contactEmail = null;
  } else if (typeof emailRaw !== "string") {
    fieldErrors.contactEmail = "이메일 값을 확인할 수 없습니다.";
  } else {
    const trimmed = emailRaw.trim();
    if (trimmed.length > MAX_SHORT_TEXT) {
      fieldErrors.contactEmail = "이메일이 너무 깁니다.";
    } else if (!trimmed.includes("@")) {
      fieldErrors.contactEmail = "올바른 이메일 형식이 아닙니다.";
    } else {
      contactEmail = trimmed;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { name, contactName, contactEmail, contactPhone } };
}
