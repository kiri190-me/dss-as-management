"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { canCreateProcedureTemplateDraft } from "@/lib/auth/procedure-template-authorization";
import { canCreateTechnicalTemplateDraftVersion, canManageTechnicalTemplates } from "@/lib/auth/technical-procedure-template-authorization";
import {
  createNewDraftVersion,
  createManualTechnicalProcedureTemplate,
  type ProcedureTemplateResult,
  type CreateManualTechnicalTemplateInput,
} from "@/lib/db/mutations/procedure-templates";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";
import { PROCEDURE_EQUIPMENT_TYPE_CODES } from "@/lib/domain/procedure-template-types";

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
  // Phase 5C-5B — fast pre-check broadened to admit either category's
  // permission (FULL_SERVICE's existing function OR TECHNICAL_TASK's);
  // createNewDraftVersion's own category-aware check remains authoritative.
  if (!canCreateProcedureTemplateDraft(session.role) && !canCreateTechnicalTemplateDraftVersion(session.role)) {
    return { ok: false, code: "FORBIDDEN", message: "새 버전 작성 권한이 없습니다." };
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

/**
 * Phase 5C-5B-1 — manual TECHNICAL_TASK template creation. Same
 * session/role short-circuit pattern as createNewDraftVersionAction;
 * category/isReferenceOnly/status/version/sourceType are all fixed inside
 * createManualTechnicalProcedureTemplate itself — this action only forwards
 * the four caller-supplied fields (code/name/equipmentType/description),
 * never a category or any other server-authoritative value.
 */
export async function createManualTechnicalProcedureTemplateAction(
  input: CreateManualTechnicalTemplateInput
): Promise<ProcedureTemplateResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }
  if (!canManageTechnicalTemplates(session.role)) {
    return { ok: false, code: "FORBIDDEN", message: "기술 절차 템플릿 생성 권한이 없습니다." };
  }
  if (!(PROCEDURE_EQUIPMENT_TYPE_CODES as readonly string[]).includes(input.equipmentType)) {
    return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 장비 유형입니다." };
  }

  try {
    return await createManualTechnicalProcedureTemplate(
      { code: input.code, name: input.name, equipmentType: input.equipmentType, description: input.description },
      session.userId
    );
  } catch (err) {
    console.error("createManualTechnicalProcedureTemplateAction: unexpected DB error", err);
    return { ok: false, code: "CONFLICT", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
