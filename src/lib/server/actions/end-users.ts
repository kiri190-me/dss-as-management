"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  canAddEndUserContact,
  canCreateEndUser,
  canEditEndUserContact,
  canRemoveEndUserContact,
  canRenameEndUser,
} from "@/lib/auth/customer-authorization";
import {
  isValidCustomerId,
  isValidEndUserContactId,
  isValidEndUserId,
  isValidExpectedUpdatedAt,
  validateEndUserContactFields,
  validateEndUserNameField,
} from "@/lib/validation/end-user-input";
import {
  createEndUser,
  createEndUserContact,
  removeEndUserContact,
  renameEndUser,
  updateEndUserContact,
} from "@/lib/db/mutations/end-users";

export type EndUserActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE";

export type EndUserActionResult =
  | { ok: true; id: string; name: string; updatedAt: string }
  | { ok: false; code: EndUserActionResultCode; fieldErrors?: Record<string, string>; message: string };

export type EndUserContactActionResult =
  | { ok: true; id: string; contactName: string; contactEmail: string | null; updatedAt: string }
  | { ok: false; code: EndUserActionResultCode; fieldErrors?: Record<string, string>; message: string };

export type RemoveEndUserContactActionResult =
  | { ok: true }
  | { ok: false; code: EndUserActionResultCode; message: string };

/**
 * Server Actions for End-User + multi-contact management (/customers/[id]).
 * Same layering as update-customer.ts: session/authorization checked here,
 * per-field format validation delegated to end-user-input.ts, data rules
 * (existence/concurrency/duplicate-name) delegated to the mutation layer.
 * Every check re-runs independently of whatever the UI happened to show —
 * a hidden button client-side is a UX convenience only.
 */
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

export async function createEndUserAction(input: {
  customerId: string;
  name: string;
}): Promise<EndUserActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!canCreateEndUser(auth.actingUser.role)) {
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
  const validation = validateEndUserNameField(input);
  if (!validation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", fieldErrors: validation.fieldErrors, message: "입력값을 확인해 주세요." };
  }

  try {
    return await createEndUser({ customerId: input.customerId, name: validation.data.name });
  } catch (err) {
    console.error("createEndUserAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function renameEndUserAction(input: {
  endUserId: string;
  expectedUpdatedAt: string;
  name: string;
}): Promise<EndUserActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!canRenameEndUser(auth.actingUser.role)) {
    return { ok: false, code: "FORBIDDEN", message: "이 작업을 수행할 권한이 없습니다." };
  }
  if (!isValidEndUserId(input.endUserId)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { endUserId: "End-User를 확인할 수 없습니다." },
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
  const validation = validateEndUserNameField(input);
  if (!validation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", fieldErrors: validation.fieldErrors, message: "입력값을 확인해 주세요." };
  }

  try {
    return await renameEndUser({
      endUserId: input.endUserId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      name: validation.data.name,
    });
  } catch (err) {
    console.error("renameEndUserAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function createEndUserContactAction(input: {
  endUserId: string;
  contactName: string;
  contactEmail: string | null;
}): Promise<EndUserContactActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!canAddEndUserContact(auth.actingUser.role)) {
    return { ok: false, code: "FORBIDDEN", message: "이 작업을 수행할 권한이 없습니다." };
  }
  if (!isValidEndUserId(input.endUserId)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { endUserId: "End-User를 확인할 수 없습니다." },
      message: "입력값을 확인해 주세요.",
    };
  }
  const validation = validateEndUserContactFields(input);
  if (!validation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", fieldErrors: validation.fieldErrors, message: "입력값을 확인해 주세요." };
  }

  try {
    return await createEndUserContact({
      endUserId: input.endUserId,
      contactName: validation.data.contactName,
      contactEmail: validation.data.contactEmail,
    });
  } catch (err) {
    console.error("createEndUserContactAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function updateEndUserContactAction(input: {
  contactId: string;
  expectedUpdatedAt: string;
  contactName: string;
  contactEmail: string | null;
}): Promise<EndUserContactActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!canEditEndUserContact(auth.actingUser.role)) {
    return { ok: false, code: "FORBIDDEN", message: "이 작업을 수행할 권한이 없습니다." };
  }
  if (!isValidEndUserContactId(input.contactId)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { contactId: "담당자를 확인할 수 없습니다." },
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
  const validation = validateEndUserContactFields(input);
  if (!validation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", fieldErrors: validation.fieldErrors, message: "입력값을 확인해 주세요." };
  }

  try {
    return await updateEndUserContact({
      contactId: input.contactId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      contactName: validation.data.contactName,
      contactEmail: validation.data.contactEmail,
    });
  } catch (err) {
    console.error("updateEndUserContactAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function removeEndUserContactAction(input: {
  contactId: string;
  expectedUpdatedAt: string;
}): Promise<RemoveEndUserContactActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!canRemoveEndUserContact(auth.actingUser.role)) {
    return { ok: false, code: "FORBIDDEN", message: "이 작업을 수행할 권한이 없습니다." };
  }
  if (!isValidEndUserContactId(input.contactId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "입력값을 확인해 주세요." };
  }
  if (!isValidExpectedUpdatedAt(input.expectedUpdatedAt)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "입력값을 확인해 주세요." };
  }

  try {
    return await removeEndUserContact({
      contactId: input.contactId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      actorUserId: auth.actingUser.id,
    });
  } catch (err) {
    console.error("removeEndUserContactAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
