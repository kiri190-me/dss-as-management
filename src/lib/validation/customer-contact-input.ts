/**
 * 고객사 담당자(customer_contacts) 한 줄의 입력 검증 — 추가와 수정이 함께 쓴다.
 *
 * 이름만 필수이고 직급·전화·이메일·메모는 선택이다. 모든 칸은 앞뒤 공백을 걷은
 * 뒤에 보고, 선택 칸이 걷고 나서 비면 null로 저장한다.
 *
 * ── 길이 상한 ───────────────────────────────────────────────────────────
 * 이름·직급·전화·이메일은 저장소의 짧은 글자 상한(200)을 따른다 — 같은 성격의
 * 칸인 대표 담당자(customer-update-input.ts)와 End-User 담당자
 * (end-user-input.ts)가 모두 200이다. 한 고객사의 담당자가 대표 칸과 목록 두
 * 곳에 적힐 수 있으므로 한쪽에서만 들어가는 값이 없게 맞춘다. 메모는 저장소의
 * 메모·비고 칸(내자 정리 머리말 내부 메모, 주간보고 납품 비고)과 같은 500이다.
 * DB에는 CHECK가 없다(schema/customers.ts) — 상한은 여기서만 지킨다.
 *
 * ── 이메일 ──────────────────────────────────────────────────────────────
 * 형식 규칙은 end-user-input.ts의 validateEndUserContactFields와 같다 — "@"가
 * 들어 있는지만 본다.
 *
 * ── 메모의 줄바꿈은 LF 로 통일한다 ──────────────────────────────────────
 * 폼으로 보낸 여러 줄 글은 줄바꿈이 CRLF 로 온다. 입력칸은 줄바꿈을 한 글자로
 * 세는데 CRLF 그대로 두면 두 글자가 되어, 화면에서 500자에 맞춘 메모가 서버에서
 * 넘친다고 거절된다. 그래서 걷고 세기 전에 LF 로 바꾼다 — 개선 요청 본문
 * (improvement-request-input.ts)과 같은 까닭·같은 규칙이다. 한 줄 칸(이름·직급·
 * 전화·이메일)은 입력칸이 줄바꿈을 받지 않으므로 손대지 않는다.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 수정·삭제가 받는 담당자 id — end-user-input.ts 의 isValidEndUserContactId 와 같은 모양. */
export function isValidCustomerContactId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export const CUSTOMER_CONTACT_NAME_MAX = 200;
export const CUSTOMER_CONTACT_TITLE_MAX = 200;
export const CUSTOMER_CONTACT_PHONE_MAX = 200;
export const CUSTOMER_CONTACT_EMAIL_MAX = 200;
export const CUSTOMER_CONTACT_MEMO_MAX = 500;

export type CustomerContactFields = {
  contactName: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  memo: string | null;
};

export type ValidateCustomerContactFieldsResult =
  | { ok: true; data: CustomerContactFields }
  | { ok: false; fieldErrors: Record<string, string> };

export function validateCustomerContactFields(
  raw: Record<string, unknown>
): ValidateCustomerContactFieldsResult {
  const fieldErrors: Record<string, string> = {};

  let contactName = "";
  const nameRaw = raw.contactName;
  if (typeof nameRaw !== "string" || nameRaw.trim() === "") {
    fieldErrors.contactName = "담당자명을 입력해 주세요.";
  } else {
    const trimmed = nameRaw.trim();
    if (trimmed.length > CUSTOMER_CONTACT_NAME_MAX) {
      fieldErrors.contactName = `담당자명은 ${CUSTOMER_CONTACT_NAME_MAX}자를 넘을 수 없습니다.`;
    } else {
      contactName = trimmed;
    }
  }

  /** 선택 칸 — 없거나 걷고 나서 비면 null, 글자가 아니면 오류, 상한을 넘으면 오류. */
  function optionalText(key: "title" | "phone" | "email" | "memo", label: string, max: number): string | null {
    const value = raw[key];
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") {
      fieldErrors[key] = `${label} 값을 확인할 수 없습니다.`;
      return null;
    }
    // 메모만 줄바꿈을 받는다 — 세기 전에 LF 로 통일한다(파일 머리 주석).
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

  let email = optionalText("email", "이메일", CUSTOMER_CONTACT_EMAIL_MAX);
  if (email !== null && !email.includes("@")) {
    fieldErrors.email = "올바른 이메일 형식이 아닙니다.";
    email = null;
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { contactName, title, phone, email, memo } };
}
