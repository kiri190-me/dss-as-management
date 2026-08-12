"use server";

import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";
import { resolveTechnicalGraphActorId } from "./procedure-template-editor";
import { undoProcedureTemplateChange, redoProcedureTemplateChange, type UndoRedoResult } from "@/lib/db/mutations/procedure-template-undo-redo";

/**
 * Phase 5C-5C UI — Server Actions for the editor's [이전]/[앞으로] buttons.
 * Same layering as every other action here: resolve the session, apply the
 * TECHNICAL_TASK-only fast pre-check (a UX short-circuit only —
 * undoProcedureTemplateChange/redoProcedureTemplateChange re-check the
 * actor and the template's category/status against the live DB
 * regardless), validate input shape, delegate, redact unexpected DB
 * errors. Never a client-memory undo stack — every call is a fresh,
 * server-authoritative mutation against the live 0018 history model.
 */

export async function undoProcedureTemplateChangeAction(input: { templateId: string; expectedTemplateUpdatedAt: string }): Promise<UndoRedoResult> {
  const actorCheck = await resolveTechnicalGraphActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.templateId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  try {
    return await undoProcedureTemplateChange(input.templateId, actorCheck.userId, input.expectedTemplateUpdatedAt);
  } catch (err) {
    console.error("undoProcedureTemplateChangeAction: unexpected DB error", err);
    return { ok: false, code: "FORBIDDEN", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function redoProcedureTemplateChangeAction(input: { templateId: string; expectedTemplateUpdatedAt: string }): Promise<UndoRedoResult> {
  const actorCheck = await resolveTechnicalGraphActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.templateId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  try {
    return await redoProcedureTemplateChange(input.templateId, actorCheck.userId, input.expectedTemplateUpdatedAt);
  } catch (err) {
    console.error("redoProcedureTemplateChangeAction: unexpected DB error", err);
    return { ok: false, code: "FORBIDDEN", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
