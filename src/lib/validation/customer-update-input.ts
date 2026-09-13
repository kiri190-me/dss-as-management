import { normalizeCustomerRowColorValue } from "@/lib/domain/customer-row-color";
import { CUSTOMER_CONTACT_MEMO_MAX, CUSTOMER_CONTACT_TITLE_MAX } from "@/lib/validation/customer-contact-input";

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
   * 대표 담당자의 직급·메모(2026-09-13 사용자 요청 — 고객사 담당자
   * customer_contacts 와 같은 칸). 둘 다 선택이고, 상한·규칙은
   * customer-contact-input.ts 와 같다(직급 200, 메모 500·줄바꿈 LF 통일).
   */
  contactTitle: string | null;
  contactMemo: string | null;
  /**
   * 내자 정리 목록에서 이 고객사의 줄에 칠할 색 — **팔레트 키**, 「직접 고르기」로
   * 고른 **정리된 색 코드**(`#rrggbb`, 소문자), 또는 null 이다
   * (domain/customer-row-color.ts). 형식이 어긋난 색 코드는 여기까지 오지 못한다.
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

  /**
   * 대표 담당자 칸(성함·전화·이메일·직급·메모)의 오류 문구는 **화면 이름표와 같은
   * 이름**으로 부른다 — 「대표 담당자 성함」 · 「대표 연락처(전화)」 …(2026-09-13).
   * 같은 화면에 「고객사 담당자」 목록이 따로 생겨서 「담당자 성함이 너무 깁니다」만으로는
   * 어느 쪽 칸인지 알 수 없다. 조사는 이름마다 맞춰 적는다(「성함이」 · 「(전화)가」 —
   * 예전의 「이(가)」 틀은 버렸다). 칸 이름을 부르지 않는 형식 오류(「올바른 이메일
   * 형식이 아닙니다.」)는 그대로다. 규칙(길이·빈 값·글자 여부)은 하나도 바뀌지 않았다.
   */
  function normalizeNullableShortText(
    key: "contactName" | "contactPhone",
    label: string,
    tooLongMessage: string
  ): string | null {
    const value = raw[key];
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") {
      fieldErrors[key] = `${label} 값을 확인할 수 없습니다.`;
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length > MAX_SHORT_TEXT) {
      fieldErrors[key] = tooLongMessage;
      return null;
    }
    return trimmed === "" ? null : trimmed;
  }

  const contactName = normalizeNullableShortText(
    "contactName",
    "대표 담당자 성함",
    "대표 담당자 성함이 너무 깁니다."
  );
  const contactPhone = normalizeNullableShortText(
    "contactPhone",
    "대표 연락처(전화)",
    "대표 연락처(전화)가 너무 깁니다."
  );

  /**
   * 대표 담당자의 직급·메모 — 고객사 담당자(customer-contact-input.ts)의
   * optionalText 와 같은 규칙이다: 없거나 걷고 나서 비면 null, 글자가 아니면
   * 오류, 상한을 넘으면 오류. 메모만 줄바꿈을 받으므로 세기 전에 CRLF → LF 로
   * 통일한다(그 파일 머리 주석의 까닭). `topic` 은 조사까지 붙인 이름이다
   * (「대표 담당자 직급은」 — 위 문구 주석).
   */
  function optionalContactText(
    key: "contactTitle" | "contactMemo",
    label: string,
    topic: string,
    max: number
  ): string | null {
    const value = raw[key];
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") {
      fieldErrors[key] = `${label} 값을 확인할 수 없습니다.`;
      return null;
    }
    const trimmed = (key === "contactMemo" ? value.replace(/\r\n?/g, "\n") : value).trim();
    if (trimmed === "") return null;
    if (trimmed.length > max) {
      fieldErrors[key] = `${topic} ${max}자를 넘을 수 없습니다.`;
      return null;
    }
    return trimmed;
  }

  const contactTitle = optionalContactText(
    "contactTitle",
    "대표 담당자 직급",
    "대표 담당자 직급은",
    CUSTOMER_CONTACT_TITLE_MAX
  );
  const contactMemo = optionalContactText(
    "contactMemo",
    "대표 담당자 메모",
    "대표 담당자 메모는",
    CUSTOMER_CONTACT_MEMO_MAX
  );

  let contactEmail: string | null = null;
  const emailRaw = raw.contactEmail;
  if (emailRaw === null || emailRaw === undefined || emailRaw === "") {
    contactEmail = null;
  } else if (typeof emailRaw !== "string") {
    fieldErrors.contactEmail = "대표 연락처(이메일) 값을 확인할 수 없습니다.";
  } else {
    const trimmed = emailRaw.trim();
    if (trimmed.length > MAX_SHORT_TEXT) {
      fieldErrors.contactEmail = "대표 연락처(이메일)가 너무 깁니다.";
    } else if (!trimmed.includes("@")) {
      fieldErrors.contactEmail = "올바른 이메일 형식이 아닙니다.";
    } else {
      contactEmail = trimmed;
    }
  }

  /**
   * 색은 **고르는 값**이다 — 팔레트 키이거나, 「직접 고르기」로 고른 색 코드다
   * (2026-09-13 사용자 요청으로 색 코드를 받게 됐다). 길이를 재지 않고
   * normalizeCustomerRowColorValue 하나로 거른다: 팔레트 키는 그대로, 색 코드는
   * 소문자 `#rrggbb` 로 정리해 저장하고, 그 밖의 값은 거절한다. 비어 있으면
   * (고르지 않음) null 이다. 화면이 무엇을 그렸든 서버 액션은 이 검증을 다시
   * 거치므로, 형식이 어긋난 값을 직접 보내는 요청은 여기서 멈춘다.
   */
  let rowColor: string | null = null;
  const rowColorRaw = raw.rowColor;
  if (rowColorRaw === null || rowColorRaw === undefined || rowColorRaw === "") {
    rowColor = null;
  } else {
    const normalized = normalizeCustomerRowColorValue(rowColorRaw);
    if (normalized === null) {
      fieldErrors.rowColor = "고를 수 없는 색입니다.";
    } else {
      rowColor = normalized;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return {
    ok: true,
    data: { name, contactName, contactEmail, contactPhone, contactTitle, contactMemo, rowColor },
  };
}
