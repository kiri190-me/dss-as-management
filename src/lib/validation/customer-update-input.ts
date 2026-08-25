import { isCustomerRowColorKey } from "@/lib/domain/customer-row-color";

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
  /**
   * 내자 정리 목록에서 이 고객사의 줄에 칠할 색 — **팔레트 키**이거나 null 이다
   * (domain/customer-row-color.ts). 색 코드는 여기까지 오지 못한다.
   */
  rowColor: string | null;
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

  /**
   * 색은 **고르는 값**이지 적는 값이 아니다. 그래서 길이를 재거나 다듬지 않고
   * 팔레트에 있는 키인지만 본다 — 비어 있으면(고르지 않음) null 이고, 팔레트
   * 밖의 값은 거절한다. 화면이 무엇을 그렸든 서버 액션은 이 검증을 다시
   * 거치므로, 색 코드를 직접 보내는 요청은 여기서 멈춘다.
   */
  let rowColor: string | null = null;
  const rowColorRaw = raw.rowColor;
  if (rowColorRaw === null || rowColorRaw === undefined || rowColorRaw === "") {
    rowColor = null;
  } else if (isCustomerRowColorKey(rowColorRaw)) {
    rowColor = rowColorRaw;
  } else {
    fieldErrors.rowColor = "고를 수 없는 색입니다.";
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { name, contactName, contactEmail, contactPhone, rowColor } };
}
