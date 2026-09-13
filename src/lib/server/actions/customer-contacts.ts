"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isValidCustomerId, isValidExpectedUpdatedAt } from "@/lib/validation/customer-update-input";
import {
  isValidCustomerContactId,
  validateCustomerContactFields,
} from "@/lib/validation/customer-contact-input";
import {
  createCustomerContact,
  removeCustomerContact,
  updateCustomerContact,
  type CustomerContactSaved,
} from "@/lib/db/mutations/customer-contacts";

/**
 * ============================================================================
 * 고객사 담당자 — 서버 액션 셋 (/customers/[id] 의 「고객사 담당자」 구역)
 * ============================================================================
 * End-User 담당자 액션(end-users.ts)과 같은 짜임이다: 세션·권한은 여기서, 칸 형식은
 * validation/customer-contact-input.ts 가, 존재·동시성은 mutation 이 본다. 화면이
 * 단추를 감춘 것은 안내일 뿐이라 모든 검사를 여기서 다시 한다.
 *
 * 권한은 End-User 담당자와 **같은 노드**(customers.contacts)다 — 추가·수정은
 * WRITE, 삭제는 한 단계 위 MANAGE. 관문 차례도 end-users.ts 와 같다:
 * 저장 모드 → 로그인 → 승인 → 살아 있는 계정 → 권한 → id → 수정 시각 → 칸.
 *
 * ── 🔴 오류 로그에 값을 싣지 않는다 ─────────────────────────────────────
 * 담당자 다섯 칸은 개인정보다(schema/customers.ts). drizzle 이 감싼 오류는 메시지에
 * 쿼리와 **인자**를 함께 싣기 때문에 `console.error(…, err)` 로 통째로 넘기면 이름·
 * 전화·이메일이 서버 로그에 남는다. 그래서 값이 없는 부분(오류 이름 · PG 코드 ·
 * 제약 이름)만 꺼내 적는다 — improvement-requests.ts 의 describeErrorWithoutValues
 * 와 같은 방식이다("use server" 파일은 async 함수만 내보낼 수 있어 그쪽 것을
 * 가져오지 못하고 여기 다시 적는다).
 * ============================================================================
 */

export type CustomerContactActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE";

export type CustomerContactActionResult =
  | ({ ok: true } & CustomerContactSaved)
  | { ok: false; code: CustomerContactActionResultCode; fieldErrors?: Record<string, string>; message: string };

export type RemoveCustomerContactActionResult =
  | { ok: true }
  | { ok: false; code: CustomerContactActionResultCode; message: string };

/** 폼이 보내는 다섯 칸. 선택 칸의 빈 값은 null 이든 "" 든 검증이 null 로 바꾼다. */
export type CustomerContactFieldsInput = {
  contactName: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  memo: string | null;
};

const FORBIDDEN_MESSAGE = "이 작업을 수행할 권한이 없습니다.";
const INVALID_MESSAGE = "입력값을 확인해 주세요.";
const DATABASE_UNAVAILABLE_MESSAGE = "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.";

async function resolveAuthorizedActingUser() {
  if (getAuthSource() !== "database") {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "계정이 아직 승인되지 않았습니다." };
  }
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }
  return { ok: true as const, actingUser };
}

/** 오류에서 값이 없는 부분만 꺼낸다 — 파일 머리의 '오류 로그에 값을 싣지 않는다'. */
function describeErrorWithoutValues(err: unknown): {
  name: string;
  code: string | null;
  constraint: string | null;
} {
  const name = err instanceof Error ? err.name : typeof err;
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") {
      return {
        name,
        code: candidate.code,
        constraint: typeof candidate.constraint_name === "string" ? candidate.constraint_name : null,
      };
    }
    current = candidate.cause;
  }
  return { name, code: null, constraint: null };
}

function logUnexpectedDbError(actionName: string, err: unknown): void {
  console.error(`${actionName}: unexpected DB error`, describeErrorWithoutValues(err));
}

function pickFields(input: CustomerContactFieldsInput): Record<string, unknown> {
  // 폼이 보낸 다섯 칸만 검증에 넘긴다 — id 같은 다른 칸이 섞여 들어가지 않게.
  return {
    contactName: input.contactName,
    title: input.title,
    phone: input.phone,
    email: input.email,
    memo: input.memo,
  };
}

export async function createCustomerContactAction(
  input: { customerId: string } & CustomerContactFieldsInput
): Promise<CustomerContactActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!(await hasPermission(auth.actingUser, "customers.contacts", "WRITE"))) {
    return { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }
  if (!isValidCustomerId(input.customerId)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { customerId: "고객사를 확인할 수 없습니다." },
      message: INVALID_MESSAGE,
    };
  }
  const validation = validateCustomerContactFields(pickFields(input));
  if (!validation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", fieldErrors: validation.fieldErrors, message: INVALID_MESSAGE };
  }

  try {
    return await createCustomerContact({ customerId: input.customerId, ...validation.data });
  } catch (err) {
    logUnexpectedDbError("createCustomerContactAction", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

export async function updateCustomerContactAction(
  input: { contactId: string; expectedUpdatedAt: string } & CustomerContactFieldsInput
): Promise<CustomerContactActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!(await hasPermission(auth.actingUser, "customers.contacts", "WRITE"))) {
    return { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }
  if (!isValidCustomerContactId(input.contactId)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { contactId: "담당자를 확인할 수 없습니다." },
      message: INVALID_MESSAGE,
    };
  }
  if (!isValidExpectedUpdatedAt(input.expectedUpdatedAt)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { expectedUpdatedAt: "수정 시각 정보를 확인할 수 없습니다." },
      message: INVALID_MESSAGE,
    };
  }
  const validation = validateCustomerContactFields(pickFields(input));
  if (!validation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", fieldErrors: validation.fieldErrors, message: INVALID_MESSAGE };
  }

  try {
    return await updateCustomerContact({
      contactId: input.contactId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      ...validation.data,
    });
  } catch (err) {
    logUnexpectedDbError("updateCustomerContactAction", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

export async function removeCustomerContactAction(input: {
  contactId: string;
  expectedUpdatedAt: string;
}): Promise<RemoveCustomerContactActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  // 삭제는 추가·수정보다 한 단계 위다.
  if (!(await hasPermission(auth.actingUser, "customers.contacts", "MANAGE"))) {
    return { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }
  if (!isValidCustomerContactId(input.contactId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: INVALID_MESSAGE };
  }
  if (!isValidExpectedUpdatedAt(input.expectedUpdatedAt)) {
    return { ok: false, code: "VALIDATION_ERROR", message: INVALID_MESSAGE };
  }

  try {
    return await removeCustomerContact({
      contactId: input.contactId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      actorUserId: auth.actingUser.id,
    });
  } catch (err) {
    logUnexpectedDbError("removeCustomerContactAction", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}
