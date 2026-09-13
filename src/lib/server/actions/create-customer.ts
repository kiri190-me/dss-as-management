"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { validateCustomerUpdateFields } from "@/lib/validation/customer-update-input";
import { createCustomer } from "@/lib/db/mutations/customers";

export type CreateCustomerActionInput = {
  /** Raw, untrusted. 수정 폼과 같은 다섯 칸이다(이름·연락처 셋·줄 색). */
  fields: Record<string, unknown>;
};

export type CreateCustomerActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "DATABASE_UNAVAILABLE";

export type CreateCustomerActionResult =
  | { ok: true; id: string }
  | { ok: false; code: CreateCustomerActionResultCode; fieldErrors?: Record<string, string>; message: string };

/**
 * Server Action: 고객사 관리 화면의 [고객사 추가] (2026-09-13).
 *
 * 관문 순서는 updateCustomerAction 과 같다 — DB 모드 → 세션 → 승인 → 사용자 →
 * 권한 → 형식 검증 → mutation. 다른 것은 권한 노드 하나다: 수정은
 * customers.edit(관리자 이상)이고 추가는 customers.create(영업·엔지니어까지)다.
 * 화면이 버튼을 감추는 것은 안내일 뿐이고, 이 함수를 직접 부르는 요청도 여기서
 * 똑같이 걸러진다.
 *
 * 형식 검증은 수정과 같은 validateCustomerUpdateFields 를 쓴다 — 같은 다섯 칸에
 * 같은 규칙이다(이름 필수·앞뒤 공백 제거·길이, 이메일 형식, 팔레트 키만).
 */
export async function createCustomerAction(input: CreateCustomerActionInput): Promise<CreateCustomerActionResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }

  const session = await readSession();
  if (!session) {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  }

  if (!(await hasPermission(actingUser, "customers.create", "WRITE"))) {
    return { ok: false, code: "FORBIDDEN", message: "이 작업을 수행할 권한이 없습니다." };
  }

  // 클라이언트가 fields 자체를 빼먹거나 엉뚱한 값을 보내도 여기서 던지지 않고
  // "고객사명을 입력해 주세요."로 돌아가게 한다.
  const raw =
    input && typeof input.fields === "object" && input.fields !== null ? input.fields : {};
  const validation = validateCustomerUpdateFields(raw);
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: "입력값을 확인해 주세요.",
    };
  }

  try {
    return await createCustomer({ ...validation.data, actorUserId: actingUser.id });
  } catch (err) {
    console.error("createCustomerAction: unexpected DB error", err);
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}
