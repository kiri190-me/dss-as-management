import "server-only";

import { and, eq } from "drizzle-orm";
import { isExactNormalizedMatch } from "@/lib/domain/entity-name-match";
import type { CreateRepairCaseResult } from "@/lib/validation/repair-case-input";
import { db } from "../client";
import { customers, endUsers, productModels } from "../schema";

export type IntakeTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type RepairCaseFailure = Extract<CreateRepairCaseResult, { ok: false }>;
export type MasterResolutionOrigin = "EXISTING" | "CREATED";

function hasPgCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err &&
    (err as { code?: unknown }).code === code;
}

export function isUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
}

export type CustomerResolution =
  | { ok: true; customerId: string; origin: MasterResolutionOrigin }
  | { ok: false; result: RepairCaseFailure };

export async function resolveExistingCustomer(
  tx: IntakeTransaction,
  customerId: string
): Promise<CustomerResolution> {
  const [customer] = await tx.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.isDeleted, false)));
  if (!customer) {
    return { ok: false, result: { ok: false, code: "REFERENCE_NOT_FOUND", fieldErrors: { customerId: "선택한 고객사를 확인할 수 없습니다." }, message: "선택한 고객사를 확인할 수 없습니다." } };
  }
  return { ok: true, customerId: customer.id, origin: "EXISTING" };
}

export async function resolveOrCreateCustomerByName(
  tx: IntakeTransaction,
  name: string
): Promise<CustomerResolution> {
  const trimmed = name.trim();
  const active = await tx.select({ id: customers.id, name: customers.name }).from(customers)
    .where(eq(customers.isDeleted, false));
  const match = active.find((row) => isExactNormalizedMatch(row.name, trimmed));
  if (match) return { ok: true, customerId: match.id, origin: "EXISTING" };
  try {
    const created = await tx.transaction(async (tx2) => {
      const [row] = await tx2.insert(customers).values({ name: trimmed }).returning({ id: customers.id });
      return row;
    });
    return { ok: true, customerId: created.id, origin: "CREATED" };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const rows = await tx.select({ id: customers.id, name: customers.name }).from(customers)
        .where(eq(customers.isDeleted, false));
      const reMatch = rows.find((row) => isExactNormalizedMatch(row.name, trimmed));
      if (reMatch) return { ok: true, customerId: reMatch.id, origin: "EXISTING" };
    }
    throw err;
  }
}

export type EndUserResolution =
  | { ok: true; endUserId: string | null; origin: MasterResolutionOrigin }
  | { ok: false; result: RepairCaseFailure };

export async function resolveExistingEndUser(
  tx: IntakeTransaction,
  endUserId: string,
  customerId: string
): Promise<EndUserResolution> {
  const [endUser] = await tx.select({ id: endUsers.id, customerId: endUsers.customerId }).from(endUsers)
    .where(and(eq(endUsers.id, endUserId), eq(endUsers.isDeleted, false)));
  if (!endUser) {
    return { ok: false, result: { ok: false, code: "REFERENCE_NOT_FOUND", fieldErrors: { endUserId: "선택한 End-User를 확인할 수 없습니다." }, message: "선택한 End-User를 확인할 수 없습니다." } };
  }
  if (endUser.customerId !== customerId) {
    return { ok: false, result: { ok: false, code: "REFERENCE_MISMATCH", fieldErrors: { endUserId: "선택한 End-User가 고객사와 일치하지 않습니다." }, message: "선택한 End-User가 고객사와 일치하지 않습니다." } };
  }
  return { ok: true, endUserId: endUser.id, origin: "EXISTING" };
}

export async function resolveOrCreateEndUserByName(
  tx: IntakeTransaction,
  name: string,
  customerId: string
): Promise<EndUserResolution> {
  const trimmed = name.trim();
  const active = await tx.select({ id: endUsers.id, name: endUsers.name }).from(endUsers)
    .where(and(eq(endUsers.customerId, customerId), eq(endUsers.isDeleted, false)));
  const match = active.find((row) => isExactNormalizedMatch(row.name, trimmed));
  if (match) return { ok: true, endUserId: match.id, origin: "EXISTING" };
  try {
    const created = await tx.transaction(async (tx2) => {
      const [row] = await tx2.insert(endUsers).values({ customerId, name: trimmed }).returning({ id: endUsers.id });
      return row;
    });
    return { ok: true, endUserId: created.id, origin: "CREATED" };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const rows = await tx.select({ id: endUsers.id, name: endUsers.name }).from(endUsers)
        .where(and(eq(endUsers.customerId, customerId), eq(endUsers.isDeleted, false)));
      const reMatch = rows.find((row) => isExactNormalizedMatch(row.name, trimmed));
      if (reMatch) return { ok: true, endUserId: reMatch.id, origin: "EXISTING" };
    }
    throw err;
  }
}

export type ProductModelSelectionResolution =
  | { ok: true; productModelId: string; modelName: string; origin: MasterResolutionOrigin }
  | { ok: false; code: "REFERENCE_NOT_FOUND" | "VALIDATION_ERROR"; fieldErrors?: Record<string, string>; message: string };

export async function resolveProductModelSelection(
  tx: IntakeTransaction,
  input: { productModelId: string | null; newProductModelName: string | null }
): Promise<ProductModelSelectionResolution> {
  if (input.productModelId) {
    const [master] = await tx.select({ id: productModels.id, modelName: productModels.modelName }).from(productModels)
      .where(and(eq(productModels.id, input.productModelId), eq(productModels.isDeleted, false)));
    if (!master) return { ok: false, code: "REFERENCE_NOT_FOUND", fieldErrors: { modelName: "선택한 Model을 확인할 수 없습니다." }, message: "선택한 Model을 확인할 수 없습니다." };
    return { ok: true, productModelId: master.id, modelName: master.modelName, origin: "EXISTING" };
  }
  const trimmed = (input.newProductModelName ?? "").trim();
  if (!trimmed) return { ok: false, code: "VALIDATION_ERROR", fieldErrors: { modelName: "Model을 선택하거나 새로 등록해 주세요." }, message: "입력값을 확인해 주세요." };
  const active = await tx.select({ id: productModels.id, modelName: productModels.modelName }).from(productModels)
    .where(eq(productModels.isDeleted, false));
  const match = active.find((row) => isExactNormalizedMatch(row.modelName, trimmed));
  if (match) return { ok: true, productModelId: match.id, modelName: match.modelName, origin: "EXISTING" };
  try {
    const created = await tx.transaction(async (tx2) => {
      const [row] = await tx2.insert(productModels).values({ modelName: trimmed })
        .returning({ id: productModels.id, modelName: productModels.modelName });
      return row;
    });
    return { ok: true, productModelId: created.id, modelName: created.modelName, origin: "CREATED" };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const rows = await tx.select({ id: productModels.id, modelName: productModels.modelName }).from(productModels)
        .where(eq(productModels.isDeleted, false));
      const reMatch = rows.find((row) => isExactNormalizedMatch(row.modelName, trimmed));
      if (reMatch) return { ok: true, productModelId: reMatch.id, modelName: reMatch.modelName, origin: "EXISTING" };
    }
    throw err;
  }
}
