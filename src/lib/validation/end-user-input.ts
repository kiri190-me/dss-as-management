import {
  CUSTOMER_CONTACT_MEMO_MAX,
  CUSTOMER_CONTACT_PHONE_MAX,
  CUSTOMER_CONTACT_TITLE_MAX,
} from "@/lib/validation/customer-contact-input";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidCustomerId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidEndUserId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidEndUserContactId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Always the server's own ISO string echoed back verbatim by the client — same convention as customer-update-input.ts's own isValidExpectedUpdatedAt. */
export function isValidExpectedUpdatedAt(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const MAX_SHORT_TEXT = 200;

export type EndUserNameField = { name: string };

export type ValidateEndUserNameResult =
  | { ok: true; data: EndUserNameField }
  | { ok: false; fieldErrors: Record<string, string> };

/** Shared by both create-End-User and rename-End-User — both submissions are just `{ name }`. */
export function validateEndUserNameField(raw: Record<string, unknown>): ValidateEndUserNameResult {
  const nameRaw = raw.name;
  if (typeof nameRaw !== "string" || nameRaw.trim() === "") {
    return { ok: false, fieldErrors: { name: "End-User명을 입력해 주세요." } };
  }
  const trimmed = nameRaw.trim();
  if (trimmed.length > MAX_SHORT_TEXT) {
    return { ok: false, fieldErrors: { name: "End-User명이 너무 깁니다." } };
  }
  return { ok: true, data: { name: trimmed } };
}

export type EndUserContactFields = {
  contactName: string;
  contactEmail: string | null;
  /**
   * 직급·전화·메모(2026-09-13 사용자 요청 — 고객사 담당자 customer_contacts 와
   * 같은 칸·같은 이름). 모두 선택이고, 상한·규칙은 customer-contact-input.ts 와
   * 같다(직급·전화 200, 메모 500·줄바꿈 LF 통일).
   */
  title: string | null;
  phone: string | null;
  memo: string | null;
};

export type ValidateEndUserContactFieldsResult =
  | { ok: true; data: EndUserContactFields }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Shared by both add-contact and edit-contact — 담당자명 required, 이메일·직급·전화·메모
 * optional. 직급·전화·메모는 2026-09-13 사용자 요청으로 더했다(예전에는 전화를 두지
 * 않는 것이 승인된 설계였다). 담당자명·이메일의 규칙과 문구는 예전 그대로다.
 */
export function validateEndUserContactFields(raw: Record<string, unknown>): ValidateEndUserContactFieldsResult {
  const fieldErrors: Record<string, string> = {};

  let contactName = "";
  const nameRaw = raw.contactName;
  if (typeof nameRaw !== "string" || nameRaw.trim() === "") {
    fieldErrors.contactName = "담당자명을 입력해 주세요.";
  } else {
    const trimmed = nameRaw.trim();
    if (trimmed.length > MAX_SHORT_TEXT) {
      fieldErrors.contactName = "담당자명이 너무 깁니다.";
    } else {
      contactName = trimmed;
    }
  }

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
   * 직급·전화·메모 — 고객사 담당자(customer-contact-input.ts)의 optionalText 와
   * 같은 규칙이다: 없거나 걷고 나서 비면 null, 글자가 아니면 오류, 상한을 넘으면
   * 오류. 메모만 줄바꿈을 받으므로 세기 전에 CRLF → LF 로 통일한다.
   */
  function optionalText(key: "title" | "phone" | "memo", label: string, max: number): string | null {
    const value = raw[key];
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") {
      fieldErrors[key] = `${label} 값을 확인할 수 없습니다.`;
      return null;
    }
    const trimmed = (key === "memo" ? value.replace(/\r\n?/g, "\n") : value).trim();
    if (trimmed === "") return null;
    if (trimmed.length > max) {
      fieldErrors[key] = `${label}은(는) ${max}자를 넘을 수 없습니다.`;
      return null;
    }
    return trimmed;
  }

  const title = optionalText("title", "직급", CUSTOMER_CONTACT_TITLE_MAX);
  const phone = optionalText("phone", "전화", CUSTOMER_CONTACT_PHONE_MAX);
  const memo = optionalText("memo", "메모", CUSTOMER_CONTACT_MEMO_MAX);

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { contactName, contactEmail, title, phone, memo } };
}
