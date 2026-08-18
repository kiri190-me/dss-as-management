"use server";

import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import {
  FINAL_BILLING_DECISION_CODES,
  resolveRepairCaseBillingDecision,
  type FinalBillingDecision,
  type ResolveRepairCaseBillingResult,
} from "@/lib/db/mutations/repair-case-billing-decision";
import { isValidExpectedVersion, isValidRepairCaseId } from "@/lib/validation/repair-case-update-input";

type ActionResult = ResolveRepairCaseBillingResult | {
  ok: false;
  code: "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION_ERROR" | "DATABASE_UNAVAILABLE";
  message: string;
};

export async function resolveRepairCaseBillingAction(input: {
  repairCaseId: string;
  expectedVersion: number;
  nextBillingType: string;
}): Promise<ActionResult> {
  if (getRepairCaseReadSource() !== "database" || getRepairCaseWriteSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }
  if (
    !isValidRepairCaseId(input.repairCaseId) ||
    !isValidExpectedVersion(input.expectedVersion) ||
    !(FINAL_BILLING_DECISION_CODES as readonly string[]).includes(input.nextBillingType)
  ) {
    return { ok: false, code: "VALIDATION_ERROR", message: "입력값을 확인해 주세요." };
  }

  try {
    return await resolveRepairCaseBillingDecision({
      repairCaseId: input.repairCaseId,
      expectedVersion: input.expectedVersion,
      nextBillingType: input.nextBillingType as FinalBillingDecision,
      actorUserId: session.userId,
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    console.error("resolveRepairCaseBillingAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
