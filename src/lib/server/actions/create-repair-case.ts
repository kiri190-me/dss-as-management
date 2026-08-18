"use server";

import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { createRepairCaseWithIdempotency } from "@/lib/server/services/create-repair-case";
import type { CreateRepairCaseResult } from "@/lib/validation/repair-case-input";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";

/**
 * Server Action: database-backed repair-case creation. Called directly
 * (not via <form action>) from IntakeFormInner.tsx's submit handler, which
 * already builds this exact IntakeSubmissionInput shape for the existing
 * local/localStorage path — reused verbatim here rather than defining a
 * parallel input type.
 *
 * Never called unless REPAIR_CASE_WRITE_SOURCE=database (the caller
 * branches on the flag; this function re-checks it independently too, so
 * it is never reachable via a stale/misconfigured caller either).
 *
 * `idempotencyKey`: client-generated crypto.randomUUID(), minted once per
 * intake draft (src/lib/domain/local/intake-idempotency-key.ts) and reused
 * verbatim across double-click/refresh/network-retry resubmissions of that
 * same draft. Claimed via claimIdempotencyKey() *before* insertRepairCase()
 * runs, and resolved (SUCCEEDED/FAILED) immediately after — three short,
 * independent statements rather than one long transaction spanning the
 * whole request, so a claim survives even if insertRepairCase() itself
 * throws (see idempotency-keys.ts's module comment).
 */
export async function createRepairCaseAction(
  input: IntakeSubmissionInput,
  idempotencyKey: string
): Promise<CreateRepairCaseResult> {
  const writeSource = getRepairCaseWriteSource();
  if (writeSource !== "database") {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "데이터베이스 저장 모드가 아닙니다.",
    };
  }

  // Approved policy: a DB write must never produce a case that then 404s
  // under a mock-mode detail resolver — fail clearly here rather than
  // silently falling back to either source.
  if (getRepairCaseReadSource() !== "database") {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "서버 설정 오류로 저장할 수 없습니다. 관리자에게 문의해 주세요.",
    };
  }

  const session = await readSession();
  if (!session) {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  }
  return createRepairCaseWithIdempotency({
    actor: {
      userId: session.userId,
      role: session.role,
      approvalStatus: session.approvalStatus,
    },
    intake: input,
    idempotencyKey,
    logContext: "INTERACTIVE",
  });
}
