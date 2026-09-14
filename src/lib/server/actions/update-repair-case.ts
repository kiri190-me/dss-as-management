"use server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { getRepairCaseEditGuardById } from "@/lib/db/queries/repair-cases";
import { updateRepairCase } from "@/lib/db/mutations/repair-cases";
import {
  authorizeSubmittedFields,
  isBlockedByShipmentLock,
} from "@/lib/auth/repair-case-edit-authorization";
import {
  SECTION_FIELD_NAMES,
  isValidExpectedVersion,
  isValidRepairCaseEditSection,
  isValidRepairCaseId,
  validateFaultServiceSectionFields,
  validateIntakeSectionFields,
  validateProductSectionFields,
  type RepairCaseEditSection,
  type UpdateRepairCaseActionResult,
} from "@/lib/validation/repair-case-update-input";

export type UpdateRepairCaseActionInput = {
  repairCaseId: string;
  expectedVersion: number;
  section: RepairCaseEditSection;
  /** Raw, untrusted — only the keys the user actually intends to change. */
  fields: Record<string, unknown>;
};

/**
 * Server Action: database-backed repair-case section editing. Every gate
 * below is independent of what the UI happens to render/hide — a malicious
 * client that calls this directly with a full, unrestricted `fields` object
 * gets the exact same rejection a well-behaved UI submission that violated
 * the same rule would get. Order matters: cheapest/most-generic checks
 * first, so an unauthenticated or unauthorized caller never reaches a real
 * DB query.
 *
 * 예외는 하나 — 계정 확인(resolveActingUserForSession)이 세션 확인 바로 다음에
 * 온다. 세션 토큰은 서명만 맞으면 최대 8시간 스스로 유효하므로, 토큰의
 * approvalStatus · role · userId 만 믿으면 삭제 · 사용 중지 · 잠김 · 세션 끊김
 * (sessionsValidFrom)인 사람도 열어 둔 화면에서 접수 건을 고칠 수 있었다. 그런
 * 사람에게는 입력 검사 결과조차 돌려주지 않는다(actions/attachments.ts 의
 * resolveWriteActor 와 같은 모양). 이 한 번의 읽기 뒤로는 값싼 검사 먼저가 그대로다.
 *
 * 승인 여부 · 역할 · 행위자 id 는 모두 살아 있는 계정에서 읽는다. 역할이 토큰
 * 값에서 살아 있는 값으로 바뀌었으므로 승격과 강등이 다음 로그인을 기다리지 않고
 * 즉시 반영된다 — 의도된 변화다.
 *
 * Never called unless REPAIR_CASE_WRITE_SOURCE=database — same
 * independent re-check pattern as create-repair-case.ts.
 */
export async function updateRepairCaseAction(
  input: UpdateRepairCaseActionInput
): Promise<UpdateRepairCaseActionResult> {
  const writeSource = getRepairCaseWriteSource();
  if (writeSource !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
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
  // 토큰이 아니라 살아 있는 계정을 다시 읽는다(파일 헤더) — 토큰이 발급된 뒤
  // 계정이 삭제 · 사용 중지 · 잠김됐거나 세션이 끊겼을 수 있다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false, code: "UNAUTHORIZED", message: "사용자 정보를 확인할 수 없습니다." };
  }
  if (actingUser.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { repairCaseId: "접수 건을 확인할 수 없습니다." },
      message: "입력값을 확인해 주세요.",
    };
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { expectedVersion: "버전 정보를 확인할 수 없습니다." },
      message: "입력값을 확인해 주세요.",
    };
  }
  if (!isValidRepairCaseEditSection(input.section)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { section: "편집 대상 구역을 확인할 수 없습니다." },
      message: "입력값을 확인해 주세요.",
    };
  }

  const submittedFieldNames = Object.keys(input.fields);
  if (submittedFieldNames.length === 0) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "변경할 내용이 없습니다.",
    };
  }

  // Allow-list gate: every submitted key must be a real field of this
  // section — an unknown key is a malformed request, not a permission
  // question, so it's VALIDATION_ERROR, not FORBIDDEN.
  const sectionFieldNames = new Set<string>(SECTION_FIELD_NAMES[input.section]);
  const unknownFieldNames = submittedFieldNames.filter((name) => !sectionFieldNames.has(name));
  if (unknownFieldNames.length > 0) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: Object.fromEntries(
        unknownFieldNames.map((name) => [name, "이 구역에서 허용되지 않는 필드입니다."])
      ),
      message: "입력값을 확인해 주세요.",
    };
  }

  const guard = await getRepairCaseEditGuardById(input.repairCaseId);
  if (!guard) {
    return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
  }
  if (isBlockedByShipmentLock(guard.isLocked)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "출하 완료 후 잠금된 접수 건입니다. 별도의 잠금 해제 승인 절차를 통해서만 수정할 수 있습니다.",
    };
  }

  // Reject unauthorized field changes even if a malicious client submits
  // them directly — never silently drop them, reject the whole request.
  // 역할은 살아 있는 계정의 값이다 — 승격 · 강등이 즉시 반영된다(파일 헤더).
  const authorization = authorizeSubmittedFields(actingUser.role, input.section, submittedFieldNames);
  if (!authorization.ok) {
    return { ok: false, code: "FORBIDDEN", message: "일부 필드를 수정할 권한이 없습니다." };
  }

  const formatValidation = validateSectionFields(input.section, input.fields);
  if (!formatValidation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: formatValidation.fieldErrors,
      message: "입력값을 확인해 주세요.",
    };
  }

  try {
    // actorUserId를 넘기는 것은 유·무상 변경 시 전용 이력(누가 바꿨는지)을
    // 남기기 위해서다 — 이 값을 빠뜨리면 변경은 되지만 이력이 비어 버린다.
    return await updateRepairCase(
      input.repairCaseId,
      input.expectedVersion,
      input.section,
      formatValidation.data,
      actingUser.id
    );
  } catch (err) {
    // Never forward the raw error (may reference Postgres internals, SQL
    // text, or schema details) to the browser — same discipline as
    // create-repair-case.ts.
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("updateRepairCaseAction: unexpected DB error", { code });
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}

function validateSectionFields(
  section: RepairCaseEditSection,
  rawFields: Record<string, unknown>
): { ok: true; data: Record<string, string | null> } | { ok: false; fieldErrors: Record<string, string> } {
  if (section === "INTAKE") {
    const result = validateIntakeSectionFields(rawFields);
    return result.ok ? { ok: true, data: result.data as Record<string, string | null> } : result;
  }
  if (section === "PRODUCT") {
    const result = validateProductSectionFields(rawFields);
    return result.ok ? { ok: true, data: result.data as Record<string, string | null> } : result;
  }
  const result = validateFaultServiceSectionFields(rawFields);
  return result.ok ? { ok: true, data: result.data as Record<string, string | null> } : result;
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
