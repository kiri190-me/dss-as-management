"use server";

import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { createRepairCase as insertRepairCase } from "@/lib/db/mutations/repair-cases";
import {
  claimIdempotencyKey,
  markIdempotencyKeyFailed,
  markIdempotencyKeySucceeded,
} from "@/lib/db/mutations/idempotency-keys";
import {
  isValidIdempotencyKey,
  validateCreateRepairCaseInput,
  type CreateRepairCaseResult,
} from "@/lib/validation/repair-case-input";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import type { Role } from "@/lib/domain/types";

/**
 * Currently documented business rule (PROJECT_REQUIREMENTS.md's 5-role
 * table has no per-action restriction, and the existing intake screen has
 * no role gate today): any APPROVED session of any of the 5 roles may
 * create an intake. This is an explicit allow-list, not a bypassed check —
 * narrowing it later is a one-line change here.
 */
const ALLOWED_INTAKE_CREATOR_ROLES: readonly Role[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "AS_ENGINEER",
  "SALES",
  "INVENTORY_MANAGER",
];

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
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }
  if (!ALLOWED_INTAKE_CREATOR_ROLES.includes(session.role)) {
    return { ok: false, code: "FORBIDDEN", message: "A/S 접수 등록 권한이 없습니다." };
  }

  // Format-only check — never trusts the client label "idempotency key" for
  // anything beyond "is this a UUID". Business-field derivation is never
  // accepted (see isValidIdempotencyKey's own doc comment).
  if (!isValidIdempotencyKey(idempotencyKey)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { idempotencyKey: "제출 식별자를 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요." },
      message: "입력값을 확인해 주세요.",
    };
  }

  const validation = validateCreateRepairCaseInput(input);
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: "입력값을 확인해 주세요.",
    };
  }

  const claim = await claimIdempotencyKey(idempotencyKey, session.userId);

  if (claim.state === "IN_PROGRESS") {
    return {
      ok: false,
      code: "SUBMISSION_IN_PROGRESS",
      message: "이전 제출이 아직 처리 중입니다. 잠시 후 다시 시도해 주세요.",
    };
  }
  if (claim.state === "SUCCEEDED") {
    // Idempotent replay: the first request already created this exact
    // repair case — hand back the same id/intakeNumber, create nothing new.
    return { ok: true, id: claim.repairCaseId, intakeNumber: claim.intakeNumber };
  }
  if (claim.state === "USER_MISMATCH") {
    // Deliberately identical to the generic FORBIDDEN message — never
    // confirms to the caller that this key exists or belongs to someone
    // else.
    return { ok: false, code: "FORBIDDEN", message: "A/S 접수 등록 권한이 없습니다." };
  }
  // claim.state === "CLAIMED" — proceed. Fresh key, or a FAILED key this
  // request just reclaimed for a safe retry.

  try {
    const result = await insertRepairCase(validation.data);
    if (result.ok) {
      await markIdempotencyKeySucceeded(idempotencyKey, result.id, result.intakeNumber);
    } else {
      // A rejected-but-well-formed submission (e.g. REFERENCE_NOT_FOUND) is
      // still a "failure" for idempotency purposes — release the key so a
      // corrected resubmission under the same draft can retry.
      await markIdempotencyKeyFailed(idempotencyKey);
    }
    return result;
  } catch (err) {
    await markIdempotencyKeyFailed(idempotencyKey);
    // Never forward the raw error (may reference Postgres internals) to the
    // browser. Server-side log carries only a stable identifier, never the
    // error message/detail (which can echo back constraint values) and
    // never the input (which may contain the contact-snapshot PII fields).
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("createRepairCaseAction: unexpected DB error", { code });
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
