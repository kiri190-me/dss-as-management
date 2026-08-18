"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { canEditProductModels } from "@/lib/auth/product-model-authorization";
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

  if (!canEditProductModels(actingUser.role)) {
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
