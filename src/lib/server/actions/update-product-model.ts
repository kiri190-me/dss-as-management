"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  isValidExpectedUpdatedAt,
  isValidProductModelId,
  validateProductModelUpdateFields,
} from "@/lib/validation/product-model-input";
import { updateProductModel } from "@/lib/db/mutations/product-models";

export type UpdateProductModelActionInput = {
  id: string;
  expectedUpdatedAt: string;
  /** Raw, untrusted. */
  fields: Record<string, unknown>;
};

export type UpdateProductModelActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE";

export type UpdateProductModelActionResult =
  | { ok: true; id: string; modelName: string; updatedAt: string }
  | { ok: false; code: UpdateProductModelActionResultCode; fieldErrors?: Record<string, string>; message: string };

/**
 * Server Action: database-backed product model master editing. Same
 * layering as update-customer.ts — session/authorization checked here,
 * per-field format validation delegated to product-model-input.ts, data
 * rules (existence/concurrency/duplicate-name) delegated to the mutation
 * layer. Every check re-runs independently of whatever the UI happened to
 * show.
 */
export async function updateProductModelAction(
  input: UpdateProductModelActionInput
): Promise<UpdateProductModelActionResult> {
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

  if (!(await hasPermission(actingUser.role, "productModels.edit", "WRITE"))) {
    return { ok: false, code: "FORBIDDEN", message: "이 작업을 수행할 권한이 없습니다." };
  }

  if (!isValidProductModelId(input.id)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { id: "제품 모델을 확인할 수 없습니다." },
      message: "입력값을 확인해 주세요.",
    };
  }
  if (!isValidExpectedUpdatedAt(input.expectedUpdatedAt)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { expectedUpdatedAt: "수정 시각 정보를 확인할 수 없습니다." },
      message: "입력값을 확인해 주세요.",
    };
  }

  const validation = validateProductModelUpdateFields(input.fields);
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: "입력값을 확인해 주세요.",
    };
  }

  try {
    // validation.data 에는 고객사 연결 목록(customerIds)도 들어 있다 — 모델
    // 기본정보 한 구역을 한 번에 저장하는 값이라 별도 액션·별도 권한 항목을 만들지
    // 않는다. 권한은 위 productModels.edit WRITE 하나뿐이고, 목록이 실제로 있는
    // 고객사인지(휴지통에 든 것은 아닌지)는 mutation 이 트랜잭션 안에서 다시
    // 판정한다 — 이 함수는 모양만 통과시킨 것이다.
    return await updateProductModel({
      id: input.id,
      expectedUpdatedAt: input.expectedUpdatedAt,
      ...validation.data,
    });
  } catch (err) {
    console.error("updateProductModelAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
