"use server";

import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";
import { resolveTechnicalGraphActorId } from "./procedure-template-editor";
import { restoreProcedureTemplateChange, type RestoreResult } from "@/lib/db/mutations/procedure-template-restore";

/**
 * Phase 5C-5C UI — Server Action for the editor's [이 상태로 복원] button.
 * Same layering/TECHNICAL_TASK-only fast pre-check as
 * procedure-template-undo-redo.ts's own actions —
 * restoreProcedureTemplateChange re-checks actor/category/status/target-
 * origin-eligibility against the live DB regardless. Calls the one atomic
 * server Restore mutation directly — never a client-side loop of repeated
 * Undo/Redo calls.
 */
export async function restoreProcedureTemplateChangeAction(input: {
  templateId: string;
  targetChangeGroupId: string;
  expectedTemplateUpdatedAt: string;
}): Promise<RestoreResult> {
  const actorCheck = await resolveTechnicalGraphActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.templateId) || !isValidUuid(input.targetChangeGroupId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }

  try {
    return await restoreProcedureTemplateChange(input.templateId, actorCheck.userId, input.targetChangeGroupId, input.expectedTemplateUpdatedAt);
  } catch (err) {
    console.error("restoreProcedureTemplateChangeAction: unexpected DB error", err);
    return { ok: false, code: "FORBIDDEN", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
