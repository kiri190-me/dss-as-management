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
};

export type ValidateEndUserContactFieldsResult =
  | { ok: true; data: EndUserContactFields }
  | { ok: false; fieldErrors: Record<string, string> };

/** Shared by both add-contact and edit-contact — 담당자명 required, 이메일 optional (no phone — approved design). */
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

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { contactName, contactEmail } };
}
