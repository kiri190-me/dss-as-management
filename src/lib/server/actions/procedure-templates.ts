"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { canCreateProcedureTemplateDraft } from "@/lib/auth/procedure-template-authorization";
import { createNewDraftVersion, type ProcedureTemplateResult } from "@/lib/db/mutations/procedure-templates";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";

/**
 * "새 DRAFT 버전 만들기" from a PUBLISHED template's edit-route landing
 * page — same session/role short-circuit pattern as every other Server
 * Action in this codebase; createNewDraftVersion re-checks the actor and
 * the template's PUBLISHED status against the live DB regardless.
 */
export async function createNewDraftVersionAction(input: { templateId: string }): Promise<ProcedureTemplateResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }
  if (!canCreateProcedureTemplateDraft(session.role)) {
    return { ok: false, code: "FORBIDDEN", message: "새 버전 작성 권한이 없습니다 (SUPER_ADMIN 전용)." };
  }
  if (!isValidUuid(input.templateId)) {
    return { ok: false, code: "NOT_FOUND", message: "요청 정보를 확인할 수 없습니다." };
  }

  try {
    return await createNewDraftVersion(input.templateId, session.userId);
  } catch (err) {
    console.error("createNewDraftVersionAction: unexpected DB error", err);
    return { ok: false, code: "CONFLICT", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
