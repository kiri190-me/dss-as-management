"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  isValidCustomerId,
  isValidExpectedUpdatedAt,
  validateCustomerUpdateFields,
} from "@/lib/validation/customer-update-input";
import { updateCustomer } from "@/lib/db/mutations/customers";

export type UpdateCustomerActionInput = {
  customerId: string;
  expectedUpdatedAt: string;
  /** Raw, untrusted. */
  fields: Record<string, unknown>;
};

export type UpdateCustomerActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE";

export type UpdateCustomerActionResult =
  | { ok: true; id: string; updatedAt: string }
  | { ok: false; code: UpdateCustomerActionResultCode; fieldErrors?: Record<string, string>; message: string };

/**
 * Server Action: database-backed customer master editing (Customer
 * Management phase 1). Same gate ordering/independent-re-check discipline
 * as update-repair-case.ts — a malicious client calling this directly with
 * an unrestricted `fields` object gets exactly the same rejection a
 * well-behaved UI submission would get; canEditCustomers is re-verified
 * here regardless of what the UI happened to show.
 */
export async function updateCustomerAction(
  input: UpdateCustomerActionInput
): Promise<UpdateCustomerActionResult> {
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

  if (!(await hasPermission(actingUser.role, "customers.edit", "WRITE"))) {
    return { ok: false, code: "FORBIDDEN", message: "이 작업을 수행할 권한이 없습니다." };
  }

  if (!isValidCustomerId(input.customerId)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { customerId: "고객사를 확인할 수 없습니다." },
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

  const validation = validateCustomerUpdateFields(input.fields);
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: "입력값을 확인해 주세요.",
    };
  }

  try {
    return await updateCustomer({
      customerId: input.customerId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      ...validation.data,
    });
  } catch (err) {
    console.error("updateCustomerAction: unexpected DB error", err);
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}
