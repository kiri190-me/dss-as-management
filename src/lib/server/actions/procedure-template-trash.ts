"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  permanentlyDeleteProcedureTemplate,
  restoreProcedureTemplate,
  softDeleteProcedureTemplate,
  type ProcedureTemplateTrashResult,
} from "@/lib/db/mutations/procedure-templates";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";

const MAX_BULK_ITEMS = 200;
const MAX_REASON_LENGTH = 2000;

/**
 * 절차 한 건. 낙관적 동시성 토큰이 없다 — mutation이 행을 잠그고 삭제 여부를
 * 다시 보는 것으로 충분하고, procedure_templates.version은 행 버전이 아니라
 * **발행 횟수**라 토큰으로 쓸 수 없다(mutations/procedure-templates.ts 주석).
 */
export type ProcedureTemplateTrashItem = { id: string };

export type ProcedureTemplateTrashItemResult = {
  id: string;
  ok: boolean;
  code?: string;
  message?: string;
};

export type ProcedureTemplateTrashActionResult =
  | { ok: true; results: ProcedureTemplateTrashItemResult[] }
  | { ok: false; code: "FORBIDDEN" | "VALIDATION_ERROR"; message: string };

/**
 * ============================================================================
 * 기술 절차 삭제·복원·완전삭제 서버 액션
 * ============================================================================
 * 한 건씩 순서대로, 건마다 자기 트랜잭션, 건마다 자기 결과 — 다른 마스터
 * 화면의 액션과 같은 모양이라 화면은 같은 훅(useMasterDataTrash)을 그대로
 * 쓴다.
 *
 * 권한은 여기서 보지 않는다. 절차 mutation은 트랜잭션 안에서 행위자를 다시
 * 읽고 **분류까지 확인해** 판정한다(canDeleteTechnicalTemplates는
 * TECHNICAL_TASK 전용). 이 파일은 다른 절차 액션들과 똑같이 "승인된 세션이
 * 있는가"만 확인하고 넘긴다 — 여기서 한 번 더 검사하면 판정이 두 곳에 생기고,
 * 분류 조건을 한쪽만 빠뜨리는 날이 온다.
 * ============================================================================
 */
async function resolveActorId(): Promise<
  { ok: true; userId: string } | { ok: false; result: ProcedureTemplateTrashActionResult }
> {
  if (getAuthSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." } };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." } };
  }
  return { ok: true, userId: session.userId };
}

function validateItems(
  items: ProcedureTemplateTrashItem[] | undefined,
  emptyMessage: string
): { ok: true } | { ok: false; result: ProcedureTemplateTrashActionResult } {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, result: { ok: false, code: "VALIDATION_ERROR", message: emptyMessage } };
  }
  if (items.length > MAX_BULK_ITEMS) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "VALIDATION_ERROR",
        message: `한 번에 최대 ${MAX_BULK_ITEMS}건까지 처리할 수 있습니다.`,
      },
    };
  }
  for (const item of items) {
    if (!isValidUuid(item?.id)) {
      return {
        ok: false,
        result: { ok: false, code: "VALIDATION_ERROR", message: "선택한 절차 정보를 확인할 수 없습니다." },
      };
    }
  }
  return { ok: true };
}

async function runEach(
  items: ProcedureTemplateTrashItem[],
  label: string,
  run: (item: ProcedureTemplateTrashItem) => Promise<ProcedureTemplateTrashResult>
): Promise<ProcedureTemplateTrashItemResult[]> {
  const results: ProcedureTemplateTrashItemResult[] = [];
  for (const item of items) {
    try {
      const result = await run(item);
      results.push(
        result.ok ? { id: item.id, ok: true } : { id: item.id, ok: false, code: result.code, message: result.message }
      );
    } catch (err) {
      const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: string }).code : undefined;
      console.error(`${label}: unexpected DB error`, { id: item.id, code });
      results.push({
        id: item.id,
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      });
    }
  }
  return results;
}

/** 절차를 휴지통으로 보낸다. 되돌릴 수 있는 조작이므로 사유는 선택 입력이다. */
export async function deleteProcedureTemplatesAction(input: {
  items: ProcedureTemplateTrashItem[];
  reason: string | null;
}): Promise<ProcedureTemplateTrashActionResult> {
  const actor = await resolveActorId();
  if (!actor.ok) return actor.result;

  const validated = validateItems(input.items, "삭제할 절차를 선택해 주세요.");
  if (!validated.ok) return validated.result;

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "삭제 사유가 너무 깁니다." };
  }

  const results = await runEach(input.items, "deleteProcedureTemplatesAction", (item) =>
    softDeleteProcedureTemplate({ templateId: item.id, actorUserId: actor.userId, reason: reason || null })
  );

  return { ok: true, results };
}

/** 휴지통의 절차를 되살린다. */
export async function restoreProcedureTemplatesAction(input: {
  items: ProcedureTemplateTrashItem[];
}): Promise<ProcedureTemplateTrashActionResult> {
  const actor = await resolveActorId();
  if (!actor.ok) return actor.result;

  const validated = validateItems(input.items, "복원할 절차를 선택해 주세요.");
  if (!validated.ok) return validated.result;

  const results = await runEach(input.items, "restoreProcedureTemplatesAction", (item) =>
    restoreProcedureTemplate({ templateId: item.id, actorUserId: actor.userId })
  );

  return { ok: true, results };
}

/** 15일을 기다리지 않고 즉시 완전삭제한다. 되돌릴 수 없으므로 사유가 필수다. */
export async function permanentlyDeleteProcedureTemplatesAction(input: {
  items: ProcedureTemplateTrashItem[];
  reason: string;
}): Promise<ProcedureTemplateTrashActionResult> {
  const actor = await resolveActorId();
  if (!actor.ok) return actor.result;

  const validated = validateItems(input.items, "완전 삭제할 절차를 선택해 주세요.");
  if (!validated.ok) return validated.result;

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") {
    return { ok: false, code: "VALIDATION_ERROR", message: "완전 삭제 사유를 입력해 주세요." };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "완전 삭제 사유가 너무 깁니다." };
  }

  const results = await runEach(input.items, "permanentlyDeleteProcedureTemplatesAction", (item) =>
    permanentlyDeleteProcedureTemplate({ templateId: item.id, actorUserId: actor.userId, reason })
  );

  return { ok: true, results };
}
